import { MCPServer, widget, text, object } from "mcp-use/server";
import { z } from "zod";
import { findConnections, checkDisruptions, getStationboard } from "./src/api/transport.js";
import { buildDecisionSummary } from "./src/insights/decision.js";

const server = new MCPServer({
  name: "swiss-transit-explorer",
  version: "1.0.0",
  description: "Swiss public transit explorer - find connections, compare routes, check delays",
  baseUrl: process.env.MCP_URL || "http://localhost:3000",
});

server.tool(
  {
    name: "find_connections",
    description: "Find Swiss connections with risk-ranked options. Use maxTransfers for max/at most N transfers. Use detailLevel=full for detailed/complete plans. Use includeWeather for weather/clothing.",
    schema: z.object({
      from: z.string(),
      to: z.string(),
      datetime: z.string().optional(),
      isArrivalTime: z.boolean().optional().default(false),
      limit: z.number().optional().default(3),
      maxTransfers: z.number().optional()
        .describe("Use when user says max/at most/maximum N transfers or stops."),
      preferLowWalking: z.boolean().optional().default(false),
      minimizeOutdoorIfRaining: z.boolean().optional().default(false),
      bufferMinutes: z.number().optional().default(0),
      detailLevel: z.enum(["compact", "full"]).optional().default("compact")
        .describe("Use full for detailed/complete plan."),
      includeWeather: z.boolean().optional().default(false)
        .describe("Use true for weather/clothing questions."),
    }),
    widget: {
      name: "transit-route-explorer",
      invoking: "Finding Swiss transit connections...",
      invoked: "Found connections",
    },
  },
  async ({
    from,
    to,
    datetime,
    isArrivalTime,
    limit,
    maxTransfers,
    preferLowWalking,
    minimizeOutdoorIfRaining,
    bufferMinutes,
    detailLevel,
    includeWeather,
  }) => {
    try {
      const requestTime = parseDateTime(datetime);
      const safeBuffer = Math.max(0, Math.round(bufferMinutes ?? 0));
      let searchTime = requestTime;
      let arrivalBufferMinutes = 0;
      let departureBufferMinutes = 0;
      let resolvedDetailLevel = detailLevel ?? "compact";

      if (includeWeather && resolvedDetailLevel === "compact") {
        resolvedDetailLevel = "full";
      }

      const resolvedIncludeWeather = includeWeather && resolvedDetailLevel === "full";

      if (isArrivalTime && safeBuffer > 0) {
        arrivalBufferMinutes = safeBuffer;
        const buffered = new Date(requestTime);
        buffered.setMinutes(buffered.getMinutes() - safeBuffer);
        searchTime = buffered.toISOString();
      } else if (safeBuffer > 0) {
        departureBufferMinutes = safeBuffer;
      }

      const result = await findConnections(
        from,
        to,
        searchTime,
        isArrivalTime,
        limit,
        resolvedIncludeWeather
      );

      if (result.connections.length === 0) {
        return text(`No connections found from "${from}" to "${to}".`);
      }

      const allConnections = result.connections;
      let filteredConnections = allConnections;
      if (maxTransfers !== undefined) {
        const transferLimit = Math.max(0, Math.floor(maxTransfers));
        const matches = allConnections.filter((connection) => connection.transfersCount <= transferLimit);
        if (matches.length > 0) filteredConnections = matches;
      }

      const fromName = result.fromStation?.name || from;
      const toName = result.toStation?.name || to;
      const decision = buildDecisionSummary(allConnections, {
        from: fromName,
        to: toName,
        requestedTimeISO: requestTime,
        isArrivalTime,
        arrivalBufferMinutes,
        departureBufferMinutes,
        preferences: {
          maxTransfers,
          preferLowWalking,
          minimizeOutdoorIfRaining,
        },
      });

      const connectionsForWidget = resolvedDetailLevel === "full"
        ? filteredConnections
        : filteredConnections.map((connection) => ({
            id: connection.id,
            departureTime: connection.departureTime,
            arrivalTime: connection.arrivalTime,
            durationMinutes: connection.durationMinutes,
            transfersCount: connection.transfersCount,
            legs: connection.legs,
            reliabilityScore: connection.reliability?.score ?? connection.reliabilityScore,
            tags: connection.tags,
          }));

      const widgetProps: Record<string, unknown> = {
        query: { from, to, datetimeISO: requestTime },
        stationsResolved: { fromStation: result.fromStation, toStation: result.toStation },
        connections: connectionsForWidget,
        generatedAtISO: new Date().toISOString(),
      };

      if (resolvedDetailLevel === "full") {
        widgetProps.decision = decision;
      }

      return widget({
        props: widgetProps,
        output: text(decision.summaryText),
      });
    } catch (error) {
      return text(`Failed to find connections: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
);

server.tool(
  {
    name: "check_disruptions",
    description: "Check delays/disruptions around a station.",
    schema: z.object({
      station: z.string(),
    }),
  },
  async ({ station }) => {
    try {
      const result = await checkDisruptions(station);
      const statusEmoji = { normal: "✅", minor_delays: "🟡", major_delays: "🟠", disrupted: "⚠️" };
      const formatTime = (iso: string) => iso ? new Date(iso).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" }) : "N/A";

      let details = `**${result.station}** - ${statusEmoji[result.status]} ${result.status.replace("_", " ").toUpperCase()}\n\n`;
      details += `${result.summary}\n\n`;
      details += `Routes checked: ${result.routesChecked.join(", ")}\n`;
      details += `Connections: ${result.totalConnectionsChecked} checked, ${result.delayedConnectionsCount} delayed\n`;
      details += `Delays: avg ${result.averageDelayMinutes}min, max ${result.maxDelayMinutes}min\n`;

      if (result.delayedRoutes.length > 0) {
        details += `\nDelayed:\n`;
        for (const dr of result.delayedRoutes) {
          details += `• ${dr.line}: ${dr.route} (+${dr.delayMinutes}min)\n`;
        }
      }
      details += `\n_Checked ${formatTime(result.checkedAt)}_`;

      return object({ ...result, _humanSummary: details });
    } catch (error) {
      return text(`Failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
);

server.tool(
  {
    name: "check_route_delays",
    description: "Check delays for a specific route, including station disruptions.",
    schema: z.object({
      from: z.string(),
      to: z.string(),
      datetime: z.string().optional(),
      isArrivalTime: z.boolean().optional().default(false),
      limit: z.number().optional().default(1),
    }),
  },
  async ({ from, to, datetime, isArrivalTime, limit }) => {
    try {
      const requestTime = parseDateTime(datetime);
      const result = await findConnections(from, to, requestTime, isArrivalTime, limit, false);

      if (result.connections.length === 0) {
        return text(`No connections found from "${from}" to "${to}".`);
      }

      const connection = result.connections[0];
      const rideLegs = connection.legs.filter((leg) => leg.type === "ride");
      const delayedLegs = connection.legs
        .filter((leg) => leg.delayMinutes && leg.delayMinutes > 0)
        .map((leg) => ({
          line: leg.lineDisplay || leg.line || "unknown",
          from: leg.from.name,
          to: leg.to.name,
          delayMinutes: leg.delayMinutes,
        }));

      const stations = new Set<string>();
      if (rideLegs[0]) stations.add(rideLegs[0].from.name);
      for (let i = 0; i < rideLegs.length - 1; i++) {
        stations.add(rideLegs[i].to.name);
      }

      const stationsToCheck = Array.from(stations).slice(0, 4);
      const disruptions = await Promise.all(
        stationsToCheck.map(async (station) => {
          try {
            const disruption = await checkDisruptions(station);
            return {
              station,
              status: disruption.status,
              summary: disruption.summary,
              checkedAt: disruption.checkedAt,
              delayedRoutes: disruption.delayedRoutes.slice(0, 3),
            };
          } catch (error) {
            return {
              station,
              status: "unknown",
              summary: "Unable to check disruptions.",
            };
          }
        })
      );

      const formatTime = (iso: string) =>
        iso ? new Date(iso).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" }) : "N/A";

      let summary = `Route ${result.fromStation?.name || from} → ${result.toStation?.name || to} at ${formatTime(connection.departureTime)}. `;
      if (delayedLegs.length > 0) {
        summary += `Delayed legs: ${delayedLegs.map((leg) => `${leg.line} (+${leg.delayMinutes}min)`).join(", ")}. `;
      } else {
        summary += "No delays reported on current legs. ";
      }
      if (disruptions.length > 0) {
        summary += `Station disruptions: ${disruptions.map((d) => `${d.station} (${d.status.replace("_", " ")})`).join(", ")}.`;
      }

      return object({
        from,
        to,
        connectionId: connection.id,
        departureTime: connection.departureTime,
        arrivalTime: connection.arrivalTime,
        delayedLegs,
        stationDisruptions: disruptions,
        summary,
      });
    } catch (error) {
      return text(`Failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
);

server.tool(
  {
    name: "get_route_weather",
    description: "Get destination weather for a route. Use for clothing/temperature questions.",
    schema: z.object({
      from: z.string(),
      to: z.string(),
      datetime: z.string().optional(),
      isArrivalTime: z.boolean().optional().default(false),
      limit: z.number().optional().default(1),
    }),
  },
  async ({ from, to, datetime, isArrivalTime, limit }) => {
    try {
      const requestTime = parseDateTime(datetime);
      const result = await findConnections(from, to, requestTime, isArrivalTime, limit, true);

      if (result.connections.length === 0) {
        return text(`No connections found from "${from}" to "${to}".`);
      }

      const connection = result.connections[0];
      const weather = connection.weather;
      if (!weather?.samples?.length) {
        return text(`No weather data available for "${to}".`);
      }

      const destinationName = result.toStation?.name || to;
      const destinationSample = [...weather.samples].reverse().find((sample) => {
        const sampleName = sample.station.toLowerCase();
        const destName = destinationName.toLowerCase();
        return sampleName.includes(destName) || destName.includes(sampleName);
      }) || weather.samples[weather.samples.length - 1];

      const formatTime = (iso: string) =>
        iso ? new Date(iso).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" }) : "N/A";

      const temperature = Math.round(destinationSample.temperature);
      let conditions = "Clear";
      if (destinationSample.snowfall > 0) conditions = "Snowing";
      else if (destinationSample.precipitation > 5) conditions = "Heavy rain";
      else if (destinationSample.precipitation > 0) conditions = "Light rain";
      else if (destinationSample.windGusts > 50) conditions = "Windy";
      else if (destinationSample.temperature <= 2) conditions = "Cold";

      let advice = "Dress comfortably.";
      if (destinationSample.temperature <= 5) advice = "Bring warm layers.";
      else if (destinationSample.precipitation > 0) advice = "Bring a jacket or umbrella.";
      else if (destinationSample.windGusts > 40) advice = "Bring a windproof layer.";

      const summary = `${destinationName} around ${formatTime(destinationSample.time)}: ${temperature}°C, ${conditions}. ${advice}`;

      return object({
        from,
        to,
        arrivalTime: connection.arrivalTime,
        destination: destinationName,
        weather: destinationSample,
        summary,
      });
    } catch (error) {
      return text(`Failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
);

server.tool(
  {
    name: "get_departures",
    description: "Get live departures board for a station.",
    schema: z.object({
      station: z.string(),
      limit: z.number().optional().default(10),
    }),
    widget: {
      name: "departures-board",
      invoking: "Loading departure board...",
      invoked: "Departure board loaded",
    },
  },
  async ({ station, limit }) => {
    try {
      const result = await getStationboard(station, limit, "departure");
      
      if (result.entries.length === 0) {
        return text(`No departures found for "${station}".`);
      }

      const formatTime = (iso: string) => new Date(iso).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
      const nextDep = result.entries[0];
      const delayedCount = result.entries.filter(d => d.delayMinutes && d.delayMinutes > 0).length;

      let summary = `${result.station}: ${result.entries.length} upcoming departures. `;
      summary += `Next: ${nextDep.line} to ${nextDep.destination} at ${formatTime(nextDep.timePlanned)}`;
      if (nextDep.platform) summary += ` (Pl. ${nextDep.platform})`;
      if (delayedCount > 0) summary += `. ${delayedCount} train(s) delayed.`;

      return widget({
        props: {
          station: result.station,
          mode: "departures",
          entries: result.entries,
          generatedAt: result.generatedAt,
        },
        output: text(summary),
      });
    } catch (error) {
      return text(`Failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
);

server.tool(
  {
    name: "get_arrivals",
    description: "Get live arrivals board for a station.",
    schema: z.object({
      station: z.string(),
      limit: z.number().optional().default(10),
    }),
    widget: {
      name: "departures-board",
      invoking: "Loading arrivals board...",
      invoked: "Arrivals board loaded",
    },
  },
  async ({ station, limit }) => {
    try {
      const result = await getStationboard(station, limit, "arrival");

      if (result.entries.length === 0) {
        return text(`No arrivals found for "${station}".`);
      }

      const formatTime = (iso: string) => new Date(iso).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
      const nextArr = result.entries[0];
      const delayedCount = result.entries.filter(d => d.delayMinutes && d.delayMinutes > 0).length;

      let summary = `${result.station}: ${result.entries.length} upcoming arrivals. `;
      summary += `Next: ${nextArr.line}`;
      if (nextArr.destination) summary += ` towards ${nextArr.destination}`;
      summary += ` at ${formatTime(nextArr.timePlanned)}`;
      if (nextArr.platform) summary += ` (Pl. ${nextArr.platform})`;
      if (delayedCount > 0) summary += `. ${delayedCount} train(s) delayed.`;

      return widget({
        props: {
          station: result.station,
          mode: "arrivals",
          entries: result.entries,
          generatedAt: result.generatedAt,
        },
        output: text(summary),
      });
    } catch (error) {
      return text(`Failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }
);

function parseDateTime(datetime?: string): string {
  if (!datetime) return new Date().toISOString();
  
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(datetime)) {
    const today = new Date();
    const [hours, minutes] = datetime.split(":").map(Number);
    today.setHours(hours, minutes, 0, 0);
    return today.toISOString();
  }
  
  if (/^\d{1,2}(am|pm)$/i.test(datetime)) {
    const today = new Date();
    const match = datetime.match(/^(\d{1,2})(am|pm)$/i);
    if (match) {
      let hours = parseInt(match[1]);
      if (match[2].toLowerCase() === "pm" && hours !== 12) hours += 12;
      if (match[2].toLowerCase() === "am" && hours === 12) hours = 0;
      today.setHours(hours, 0, 0, 0);
      return today.toISOString();
    }
  }
  
  const parsed = new Date(datetime);
  return isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

server.prompt(
  {
    name: "template_router",
    description: "Template: tool routing policy + user request",
    schema: z.object({
      request: z.string(),
    }),
  },
  async ({ request }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: [
            "Routing policy:",
            "- Use find_connections for routes; map phrases:",
            "  - arrive by / be there by -> isArrivalTime true + datetime from phrase",
            "  - add buffer / leave extra X min -> bufferMinutes X",
            "  - max N transfers / no more than N / maximum N / at most N / max N stops -> maxTransfers N",
            "  - after 9pm / after 21:00 -> datetime 21:00 (or specified time) with isArrivalTime false",
            "  - minimize walking / low walking -> preferLowWalking true",
            "  - if raining / minimize outdoor time -> minimizeOutdoorIfRaining true",
            "  - detailed / complete plan -> detailLevel full",
            "- weather / temperature / what to wear -> get_route_weather",
            "- delays on this route -> check_route_delays",
            "- station disruptions / delays around station -> check_disruptions",
            "- departures board -> get_departures",
            "- arrivals board -> get_arrivals",
            "Use tools for data, do not guess. Answer only after tools return.",
            `User request: ${request}`,
          ].join("\n"),
        },
      },
    ],
  })
);

server.listen().then(() => console.log("🚂 Swiss Transit Explorer running"));
