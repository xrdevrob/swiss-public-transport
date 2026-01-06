import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";

type RouteInfo = {
  shortName?: string;
  longName?: string;
  type?: number;
  agencyId?: string;
};

type Lookup = {
  routes: Record<string, RouteInfo>;
  trips: Record<string, string>;
  routeShortNameToId?: Record<string, string>;
  agencies: Record<string, string>;
  defaultAgencyId?: string;
  generatedAt: string;
  source: string;
};

const input = process.argv[2] || process.env.GTFS_STATIC_PATH || process.env.GTFS_STATIC_URL;
const output =
  process.argv[3] ||
  process.env.GTFS_LOOKUP_PATH ||
  path.resolve(process.cwd(), "data/gtfs-lookup.json");

if (!input) {
  console.error("Usage: npm run gtfs:build -- <gtfs.zip|gtfs-folder|url> [output.json]");
  process.exit(1);
}

const isUrl = /^https?:\/\//i.test(input);

const readGtfsFiles = async (): Promise<Record<string, string>> => {
  if (isUrl) {
    const response = await fetch(input);
    if (!response.ok) {
      throw new Error(`Failed to download GTFS: ${response.status}`);
    }
    const buffer = new Uint8Array(await response.arrayBuffer());
    return unzipGtfs(buffer);
  }

  let stats;
  try {
    stats = await stat(input);
  } catch {
    throw new Error(`GTFS input not found: ${input}`);
  }
  if (stats.isDirectory()) {
    return {
      "routes.txt": await readFile(path.join(input, "routes.txt"), "utf-8"),
      "trips.txt": await readFile(path.join(input, "trips.txt"), "utf-8"),
      "agency.txt": await readFile(path.join(input, "agency.txt"), "utf-8"),
    };
  }

  if (!input.toLowerCase().endsWith(".zip")) {
    throw new Error("GTFS input must be a .zip file, folder, or URL");
  }

  const buffer = new Uint8Array(await readFile(input));
  return unzipGtfs(buffer);
};

const unzipGtfs = (buffer: Uint8Array): Record<string, string> => {
  const entries = unzipSync(buffer);
  const decoder = new TextDecoder("utf-8");
  const lookup: Record<string, string> = {};

  const getEntry = (name: string) => {
    const key = Object.keys(entries).find((entry) => entry.toLowerCase() === name);
    return key ? entries[key] : undefined;
  };

  const routes = getEntry("routes.txt");
  const trips = getEntry("trips.txt");
  const agencies = getEntry("agency.txt");

  if (!routes || !trips || !agencies) {
    throw new Error("GTFS zip missing routes.txt, trips.txt, or agency.txt");
  }

  lookup["routes.txt"] = decoder.decode(routes);
  lookup["trips.txt"] = decoder.decode(trips);
  lookup["agency.txt"] = decoder.decode(agencies);

  return lookup;
};

const forEachCsvRow = (content: string, onRow: (row: string[], rowIndex: number) => void) => {
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let rowIndex = 0;

  const flushField = () => {
    row.push(field);
    field = "";
  };

  const flushRow = () => {
    if (row.length > 0) {
      onRow(row, rowIndex);
      rowIndex += 1;
    }
    row = [];
  };

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    if (char === '"') {
      if (inQuotes && content[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      flushField();
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && content[i + 1] === "\n") {
        i += 1;
      }
      flushField();
      flushRow();
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    flushField();
    flushRow();
  }
};

const parseRoutes = (routesTxt: string): Record<string, RouteInfo> => {
  const routes: Record<string, RouteInfo> = Object.create(null);
  let idxRouteId = -1;
  let idxShort = -1;
  let idxLong = -1;
  let idxType = -1;
  let idxAgency = -1;

  forEachCsvRow(routesTxt, (row, rowIndex) => {
    if (rowIndex === 0) {
      if (row[0]) row[0] = row[0].replace(/^\uFEFF/, "");
      idxRouteId = row.indexOf("route_id");
      idxShort = row.indexOf("route_short_name");
      idxLong = row.indexOf("route_long_name");
      idxType = row.indexOf("route_type");
      idxAgency = row.indexOf("agency_id");
      return;
    }

    const routeId = (row[idxRouteId] || "").trim();
    if (!routeId) return;

    const typeValue = row[idxType];
    const routeType = typeValue ? Number(typeValue) : undefined;
    routes[routeId] = {
      shortName: row[idxShort]?.trim() || undefined,
      longName: row[idxLong]?.trim() || undefined,
      type: Number.isFinite(routeType) ? routeType : undefined,
      agencyId: row[idxAgency]?.trim() || undefined,
    };
  });

  return routes;
};

const parseTrips = (tripsTxt: string): Record<string, string> => {
  const trips: Record<string, string> = Object.create(null);
  let idxTripId = -1;
  let idxRouteId = -1;

  forEachCsvRow(tripsTxt, (row, rowIndex) => {
    if (rowIndex === 0) {
      if (row[0]) row[0] = row[0].replace(/^\uFEFF/, "");
      idxTripId = row.indexOf("trip_id");
      idxRouteId = row.indexOf("route_id");
      return;
    }

    const tripId = (row[idxTripId] || "").trim();
    const routeId = (row[idxRouteId] || "").trim();
    if (!tripId || !routeId) return;
    trips[tripId] = routeId;
  });

  return trips;
};

const parseAgencies = (agencyTxt: string) => {
  const agencies: Record<string, string> = Object.create(null);
  let idxId = -1;
  let idxName = -1;
  let fallbackId = "default";

  forEachCsvRow(agencyTxt, (row, rowIndex) => {
    if (rowIndex === 0) {
      if (row[0]) row[0] = row[0].replace(/^\uFEFF/, "");
      idxId = row.indexOf("agency_id");
      idxName = row.indexOf("agency_name");
      return;
    }

    const name = (row[idxName] || "").trim();
    if (!name) return;

    const id = idxId >= 0 ? (row[idxId] || fallbackId).trim() : fallbackId;
    agencies[id] = name;
    fallbackId = id;
  });

  const defaultAgencyId = Object.keys(agencies).length === 1 ? Object.keys(agencies)[0] : undefined;

  return { agencies, defaultAgencyId };
};

const buildLookup = async () => {
  const files = await readGtfsFiles();
  const routes = parseRoutes(files["routes.txt"]);
  const trips = parseTrips(files["trips.txt"]);
  const routeShortNameToId: Record<string, string> = Object.create(null);
  for (const [routeId, info] of Object.entries(routes)) {
    if (!info.shortName) continue;
    if (!routeShortNameToId[info.shortName]) {
      routeShortNameToId[info.shortName] = routeId;
    }
  }
  const { agencies, defaultAgencyId } = parseAgencies(files["agency.txt"]);

  const lookup: Lookup = {
    routes,
    trips,
    routeShortNameToId,
    agencies,
    defaultAgencyId,
    generatedAt: new Date().toISOString(),
    source: input,
  };

  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(lookup));

  console.log(`GTFS lookup written to ${output}`);
  console.log(`Routes: ${Object.keys(routes).length}, Trips: ${Object.keys(trips).length}, Agencies: ${Object.keys(agencies).length}`);
};

buildLookup().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
