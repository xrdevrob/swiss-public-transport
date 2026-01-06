import type { Station, Connection, Leg, WeatherInsight } from "../types/index.js";
import { calculateReliability } from "../insights/reliability.js";
import { getWeatherInsights } from "../insights/weather.js";
import { getGtfsLookup, resolveLineInfo } from "../gtfs/lookup.js";

const BASE_URL = "https://transport.opendata.ch/v1";

export interface StationboardEntry {
  line: string;
  lineId?: string;
  lineDisplay?: string;
  lineType?: string;
  operator?: string;
  destination: string;
  timePlanned: string;
  timeActual?: string;
  platform?: string;
  delayMinutes?: number;
}

export async function getStationboard(
  station: string,
  limit = 10,
  boardType: "departure" | "arrival" = "departure"
): Promise<{
  station: string;
  entries: StationboardEntry[];
  generatedAt: string;
}> {
  const url = new URL(`${BASE_URL}/stationboard`);
  url.searchParams.set("station", station);
  url.searchParams.set("limit", limit.toString());
  url.searchParams.set("type", boardType);

  const response = await fetch(url.toString(), {
    headers: { "User-Agent": "SwissTransitExplorer/1.0", "Accept": "application/json" },
  });

  if (!response.ok) throw new Error(`API error: ${response.status}`);

  const data = await response.json();
  
  const gtfsLookup = await getGtfsLookup();

  const entries: StationboardEntry[] = (data.stationboard || []).map((entry: {
    stop?: {
      arrival?: string;
      departure?: string;
      platform?: string;
      prognosis?: { arrival?: string; departure?: string; platform?: string };
    };
    name?: string;
    to?: string;
    category?: string;
    number?: string;
    operator?: string;
  }) => {
    const planned = boardType === "arrival"
      ? entry.stop?.arrival || entry.stop?.departure || ""
      : entry.stop?.departure || "";
    const actual = boardType === "arrival"
      ? entry.stop?.prognosis?.arrival || entry.stop?.prognosis?.departure
      : entry.stop?.prognosis?.departure;
    let delayMinutes: number | undefined;
    
    if (planned && actual) {
      const diff = (new Date(actual).getTime() - new Date(planned).getTime()) / 60000;
      if (diff > 0) delayMinutes = Math.round(diff);
    }

    const lineInfo = resolveLineInfo(
      {
        lineId: entry.name,
        category: entry.category,
        number: entry.number,
        operator: entry.operator,
      },
      gtfsLookup
    );

    return {
      line: lineInfo.lineDisplay || entry.name || "",
      lineId: lineInfo.lineId,
      lineDisplay: lineInfo.lineDisplay || entry.name || "",
      lineType: lineInfo.lineType,
      operator: lineInfo.operator || entry.operator,
      destination: entry.to || "",
      timePlanned: planned,
      timeActual: actual && actual !== planned ? actual : undefined,
      platform: entry.stop?.prognosis?.platform || entry.stop?.platform,
      delayMinutes,
    };
  });

  return {
    station: data.station?.name || station,
    entries,
    generatedAt: new Date().toISOString(),
  };
}

interface TransportLocation {
  id?: string;
  name: string;
  coordinate?: { x: number; y: number };
}

interface TransportCheckpoint {
  station: TransportLocation;
  arrival?: string;
  departure?: string;
  platform?: string;
  prognosis?: {
    arrival?: string;
    departure?: string;
    platform?: string;
  };
}

interface TransportSection {
  journey?: {
    name?: string;
    category?: string;
    number?: string;
    operator?: string;
  };
  walk?: { duration?: number };
  departure: TransportCheckpoint;
  arrival: TransportCheckpoint;
}

interface TransportConnection {
  from: TransportCheckpoint;
  to: TransportCheckpoint;
  duration?: string;
  transfers: number;
  sections: TransportSection[];
}

export async function findConnections(
  from: string,
  to: string,
  datetime?: string,
  isArrivalTime = false,
  limit = 6,
  includeWeather = false
): Promise<{ connections: Connection[]; fromStation?: Station; toStation?: Station }> {
  const url = new URL(`${BASE_URL}/connections`);
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  url.searchParams.set("limit", limit.toString());

  if (datetime) {
    const date = new Date(datetime);
    url.searchParams.set("date", date.toISOString().split("T")[0]);
    url.searchParams.set("time", date.toTimeString().slice(0, 5));
    url.searchParams.set("isArrivalTime", isArrivalTime ? "1" : "0");
  }

  const response = await fetch(url.toString(), {
    headers: { "User-Agent": "SwissTransitExplorer/1.0", "Accept": "application/json" },
  });

  if (!response.ok) throw new Error(`API error: ${response.status}`);

  const data = await response.json();

  const gtfsLookup = await getGtfsLookup();
  let fastestDuration = Infinity;
  let fewestTransfers = Infinity;
  const processed = data.connections.map((conn: TransportConnection, index: number) => {
    const duration = parseDuration(conn.duration);
    if (duration < fastestDuration) fastestDuration = duration;
    if (conn.transfers < fewestTransfers) fewestTransfers = conn.transfers;
    return { conn, duration, index };
  });

  const connections: Connection[] = await Promise.all(
    processed.map(async ({ conn, duration, index }: { conn: TransportConnection; duration: number; index: number }) => {
      const legs = normalizeLegs(conn.sections, gtfsLookup);
      const tags: string[] = [];
      if (duration === fastestDuration) tags.push("fastest");
      if (conn.transfers === fewestTransfers) tags.push("fewest transfers");
      if (index === 0) tags.push("recommended");

      const reliability = calculateReliability(legs, conn.from.departure || new Date().toISOString());

      let weather: WeatherInsight | undefined;
      if (includeWeather) {
        weather = await getWeatherForConnection(conn);
      }

      return {
        id: generateConnectionId(conn),
        departureTime: conn.from.departure || "",
        arrivalTime: conn.to.arrival || "",
        durationMinutes: duration,
        transfersCount: conn.transfers,
        legs,
        reliabilityScore: reliability.score,
        reliability,
        weather,
        tags,
      };
    })
  );

  let fromStation: Station | undefined;
  let toStation: Station | undefined;
  if (data.connections.length > 0) {
    fromStation = { name: data.connections[0].from.station.name };
    toStation = { name: data.connections[0].to.station.name };
  }

  return { connections, fromStation, toStation };
}

async function getWeatherForConnection(conn: TransportConnection): Promise<WeatherInsight | undefined> {
  const stations: { name: string; lat: number; lon: number; time: string }[] = [];
  const seenStations = new Set<string>();

  const addStation = (name: string, coord: { x: number; y: number }, time: string) => {
    const key = name.split(",")[0].trim(); // Normalize "Lenzburg, Bahnhof" to "Lenzburg"
    if (seenStations.has(key)) return;
    seenStations.add(key);
    stations.push({ name, lat: coord.x, lon: coord.y, time });
  };

  // Origin at departure (Transport API: x=lat, y=lon)
  if (conn.from.station.coordinate) {
    addStation(conn.from.station.name, conn.from.station.coordinate, conn.from.departure || new Date().toISOString());
  }

  // Transfer stations - only add arrivals from ride legs (skip walks)
  for (let i = 0; i < conn.sections.length - 1 && stations.length < 3; i++) {
    const section = conn.sections[i];
    if (section.walk) continue; // Skip walk segments
    const arrival = section.arrival;
    if (arrival.station.coordinate) {
      addStation(arrival.station.name, arrival.station.coordinate, arrival.arrival || new Date().toISOString());
    }
  }

  // Destination at arrival
  if (conn.to.station.coordinate) {
    addStation(conn.to.station.name, conn.to.station.coordinate, conn.to.arrival || new Date().toISOString());
  }

  if (stations.length === 0) return undefined;

  try {
    return await getWeatherInsights(stations);
  } catch {
    return undefined;
  }
}

function parseDuration(duration?: string): number {
  if (!duration) return 0;
  const match = duration.match(/(?:(\d+)d)?(\d{2}):(\d{2}):(\d{2})/);
  if (!match) return 0;
  return parseInt(match[1] || "0") * 24 * 60 + parseInt(match[2]) * 60 + parseInt(match[3]);
}

function normalizeLegs(sections: TransportSection[], gtfsLookup: Awaited<ReturnType<typeof getGtfsLookup>>): Leg[] {
  return sections.map((section): Leg => {
    const isWalk = !!section.walk;
    const departure = section.departure;
    const arrival = section.arrival;

    let delayMinutes: number | undefined;
    if (departure.prognosis?.departure && departure.departure) {
      const planned = new Date(departure.departure).getTime();
      const actual = new Date(departure.prognosis.departure).getTime();
      delayMinutes = Math.round((actual - planned) / 60000);
    }

    const fromPlatform = departure.prognosis?.platform || departure.platform;
    const toPlatform = arrival.prognosis?.platform || arrival.platform;
    const fromActual = departure.prognosis?.departure;
    const toActual = arrival.prognosis?.arrival;

    const leg: Leg = {
      type: isWalk ? "walk" : "ride",
      from: {
        name: departure.station.name,
        timePlanned: departure.departure || "",
        ...(fromActual && fromActual !== departure.departure && { timeActual: fromActual }),
        ...(fromPlatform && { platform: fromPlatform }),
      },
      to: {
        name: arrival.station.name,
        timePlanned: arrival.arrival || "",
        ...(toActual && toActual !== arrival.arrival && { timeActual: toActual }),
        ...(toPlatform && { platform: toPlatform }),
      },
    };

    if (!isWalk && section.journey) {
      const lineInfo = resolveLineInfo(
        {
          lineId: section.journey.name,
          category: section.journey.category,
          number: section.journey.number,
          operator: section.journey.operator,
        },
        gtfsLookup
      );

      const fallbackLine = section.journey.name || section.journey.category;
      const displayLine = lineInfo.lineDisplay || fallbackLine || "";

      leg.lineId = lineInfo.lineId || section.journey.name;
      leg.lineDisplay = lineInfo.lineDisplay || displayLine;
      leg.lineType = lineInfo.lineType;
      leg.operator = lineInfo.operator || section.journey.operator;
      leg.line = displayLine;
    }
    if (delayMinutes && delayMinutes > 0) {
      leg.delayMinutes = delayMinutes;
    }

    return leg;
  });
}

function generateConnectionId(conn: TransportConnection): string {
  const lines = conn.sections.filter((s) => s.journey).map((s) => s.journey?.name).join("-");
  return `${conn.from.departure || ""}-${lines}`.replace(/[^a-zA-Z0-9-]/g, "_");
}

interface DelayedRoute {
  route: string;
  line: string;
  scheduledDeparture: string;
  delayMinutes: number;
}

export async function checkDisruptions(stationName: string): Promise<{
  station: string;
  checkedAt: string;
  routesChecked: string[];
  totalConnectionsChecked: number;
  delayedConnectionsCount: number;
  cancelledOrMissing: number;
  averageDelayMinutes: number;
  maxDelayMinutes: number;
  delayedRoutes: DelayedRoute[];
  status: "normal" | "minor_delays" | "major_delays" | "disrupted";
  summary: string;
}> {
  const majorHubs = ["Zürich HB", "Bern", "Basel SBB", "Genève", "Lausanne", "Luzern", "Winterthur", "St. Gallen"]
    .filter(hub => !stationName.toLowerCase().includes(hub.toLowerCase().split(" ")[0]));

  const delays: number[] = [];
  const delayedRoutes: DelayedRoute[] = [];
  let cancelledOrMissing = 0;
  let totalChecked = 0;

  const hubsToCheck = majorHubs.sort(() => Math.random() - 0.5).slice(0, 4);

  for (const hub of hubsToCheck) {
    try {
      const result = await findConnections(stationName, hub, new Date().toISOString(), false, 2, false);
      totalChecked += result.connections.length;

      for (const conn of result.connections) {
        for (const leg of conn.legs) {
          if (leg.delayMinutes && leg.delayMinutes > 0) {
            delays.push(leg.delayMinutes);
            delayedRoutes.push({
              route: `${leg.from.name} → ${leg.to.name}`,
              line: leg.line || "walk",
              scheduledDeparture: leg.from.timePlanned,
              delayMinutes: leg.delayMinutes,
            });
          }
        }
      }
      if (result.connections.length === 0) cancelledOrMissing++;
    } catch {
      cancelledOrMissing++;
    }
  }

  const delayedConnectionsCount = delayedRoutes.length;
  const averageDelay = delays.length > 0 ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length) : 0;
  const maxDelay = delays.length > 0 ? Math.max(...delays) : 0;

  let status: "normal" | "minor_delays" | "major_delays" | "disrupted";
  if (cancelledOrMissing >= 2 || maxDelay > 30) status = "disrupted";
  else if (maxDelay > 15 || delayedConnectionsCount > totalChecked * 0.5) status = "major_delays";
  else if (maxDelay > 5 || delayedConnectionsCount > 0) status = "minor_delays";
  else status = "normal";

  const summaries = {
    disrupted: `⚠️ Significant disruptions around ${stationName}. ${delayedConnectionsCount} delayed, max ${maxDelay}min.`,
    major_delays: `🟠 Major delays around ${stationName}. Average ${averageDelay}min.`,
    minor_delays: `🟡 Minor delays around ${stationName}. ${delayedConnectionsCount} delayed, avg ${averageDelay}min.`,
    normal: `✅ Service normal around ${stationName}.`,
  };

  return {
    station: stationName,
    checkedAt: new Date().toISOString(),
    routesChecked: hubsToCheck.map(h => `${stationName} → ${h}`),
    totalConnectionsChecked: totalChecked,
    delayedConnectionsCount,
    cancelledOrMissing,
    averageDelayMinutes: averageDelay,
    maxDelayMinutes: maxDelay,
    delayedRoutes,
    status,
    summary: summaries[status],
  };
}
