import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export interface GtfsRouteInfo {
  shortName?: string;
  longName?: string;
  type?: number;
  agencyId?: string;
}

export interface GtfsLookup {
  routes: Record<string, GtfsRouteInfo>;
  trips: Record<string, string>;
  routeShortNameToId?: Record<string, string>;
  agencies: Record<string, string>;
  defaultAgencyId?: string;
  generatedAt?: string;
  source?: string;
}

export interface LineInfo {
  lineId?: string;
  lineDisplay: string;
  lineType?: string;
  operator?: string;
  routeId?: string;
  source: "gtfs" | "fallback";
}

const DEFAULT_LOOKUP_PATH = path.resolve(
  process.cwd(),
  process.env.GTFS_LOOKUP_PATH || "data/gtfs-lookup.json"
);

let cachedLookup: GtfsLookup | null | undefined;

export async function getGtfsLookup(): Promise<GtfsLookup | null> {
  if (cachedLookup !== undefined) return cachedLookup;

  if (!existsSync(DEFAULT_LOOKUP_PATH)) {
    cachedLookup = null;
    return null;
  }

  try {
    const raw = await readFile(DEFAULT_LOOKUP_PATH, "utf-8");
    cachedLookup = JSON.parse(raw) as GtfsLookup;
    return cachedLookup;
  } catch {
    cachedLookup = null;
    return null;
  }
}

export function resolveLineInfo(
  {
    lineId,
    category,
    number,
    operator,
  }: { lineId?: string; category?: string; number?: string; operator?: string },
  lookup?: GtfsLookup | null
): LineInfo {
  const trimmedLineId = lineId?.trim() || undefined;
  const fallbackDisplay = [category, number].filter(Boolean).join(" ").trim();

  let lineDisplay = fallbackDisplay || trimmedLineId || "";
  let routeId: string | undefined;
  let lineType: string | undefined;
  let resolvedOperator = operator;
  let source: "gtfs" | "fallback" = "fallback";

  const lookupKey = trimmedLineId || fallbackDisplay;

  if (lookup && lookupKey) {
    routeId = lookup.trips[lookupKey];
    if (!routeId && lookup.routes[lookupKey]) {
      routeId = lookupKey;
    }
    if (!routeId && lookup.routeShortNameToId) {
      routeId = lookup.routeShortNameToId[lookupKey] || routeId;
    }

    if (routeId) {
      const route = lookup.routes[routeId];
      const display = route?.shortName || route?.longName;
      if (display) {
        lineDisplay = display.trim();
      }

      if (route?.type !== undefined) {
        lineType = mapRouteType(route.type);
      }

      const agencyId = route?.agencyId || lookup.defaultAgencyId;
      if (agencyId && lookup.agencies[agencyId]) {
        resolvedOperator = lookup.agencies[agencyId];
      }

      source = "gtfs";
    }
  }

  if (!lineDisplay) {
    lineDisplay = trimmedLineId || fallbackDisplay || "";
  }

  if (!lineType && category) {
    const upper = category.toUpperCase();
    if (upper.startsWith("B")) lineType = "bus";
    else if (upper.includes("TRAM") || upper === "T") lineType = "tram";
    else if (["IC", "IR", "RE", "R", "EC", "EN", "ICE", "S"].includes(upper)) lineType = "train";
  }

  return {
    lineId: trimmedLineId,
    lineDisplay,
    lineType,
    operator: resolvedOperator,
    routeId,
    source,
  };
}

function mapRouteType(routeType: number): string {
  if (routeType >= 100 && routeType < 200) return "train";
  if (routeType >= 700 && routeType < 800) return "bus";

  switch (routeType) {
    case 0:
      return "tram";
    case 1:
      return "metro";
    case 2:
      return "train";
    case 3:
      return "bus";
    case 4:
      return "ferry";
    case 5:
      return "cable_tram";
    case 6:
      return "aerial_lift";
    case 7:
      return "funicular";
    case 11:
      return "trolleybus";
    case 12:
      return "monorail";
    default:
      return "train";
  }
}
