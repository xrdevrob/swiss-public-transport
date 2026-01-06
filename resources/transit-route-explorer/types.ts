import { z } from "zod";

export interface Station {
  id?: string;
  name: string;
}

export interface StopTime {
  name: string;
  timePlanned: string;
  timeActual?: string;
  platform?: string;
}

export interface Leg {
  type: "walk" | "ride";
  line?: string;
  lineId?: string;
  lineDisplay?: string;
  lineType?: string;
  operator?: string;
  from: StopTime;
  to: StopTime;
  stops?: StopTime[];
  delayMinutes?: number;
}

export interface TransferRisk {
  fromStation: string;
  toStation: string;
  marginMinutes: number;
  riskLevel: "low" | "medium" | "high";
  isBigStation: boolean;
}

export interface ReliabilityReason {
  code: string;
  label: string;
  penalty: number;
}

export interface ReliabilityInsight {
  score: number;
  level: "low" | "medium" | "high";
  reasons: ReliabilityReason[];
  transferRisks: TransferRisk[];
}

export interface WeatherSample {
  station: string;
  time: string;
  lat: number;
  lon: number;
  temperature: number;
  precipitation: number;
  snowfall: number;
  windSpeed: number;
  windGusts: number;
  weatherCode: number;
}

export interface WeatherReason {
  code: string;
  label: string;
  penalty: number;
}

export interface WeatherInsight {
  level: "low" | "medium" | "high";
  penalty: number;
  reasons: WeatherReason[];
  samples: WeatherSample[];
}

export interface Connection {
  id: string;
  departureTime: string;
  arrivalTime: string;
  durationMinutes: number;
  transfersCount: number;
  legs: Leg[];
  reliabilityScore?: number;
  reliability?: ReliabilityInsight;
  weather?: WeatherInsight;
  tags: string[];
}

export interface TransitWidgetProps {
  query: { from: string; to: string; datetimeISO: string };
  stationsResolved?: { fromStation?: Station; toStation?: Station };
  connections: Connection[];
  generatedAtISO: string;
  [key: string]: unknown;
}

export const propSchema = z.object({
  query: z.any(),
  stationsResolved: z.any().optional(),
  connections: z.any(),
  generatedAtISO: z.string(),
});
