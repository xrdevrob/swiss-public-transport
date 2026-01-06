import type { Leg } from "../types";

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

const BIG_STATIONS = [
  "Zürich HB", "Bern", "Basel SBB", "Lausanne", "Genève", 
  "Luzern", "Winterthur", "Olten", "Zürich Flughafen"
];

function isBigStation(name: string): boolean {
  return BIG_STATIONS.some(s => name.toLowerCase().includes(s.toLowerCase()));
}

function isPeakTime(dateStr: string): boolean {
  const date = new Date(dateStr);
  const day = date.getDay();
  if (day === 0 || day === 6) return false; // weekend
  const hour = date.getHours();
  const minute = date.getMinutes();
  const time = hour + minute / 60;
  return (time >= 7 && time <= 9) || (time >= 16.5 && time <= 18.5);
}

export function calculateReliability(legs: Leg[], departureTime: string): ReliabilityInsight {
  const reasons: ReliabilityReason[] = [];
  const transferRisks: TransferRisk[] = [];
  let totalPenalty = 0;

  // Get only ride legs
  const rideLegs = legs.filter(l => l.type === "ride");
  const realTransfers = rideLegs.length - 1;

  if (realTransfers > 0) {
    const penalty = 0.12 * realTransfers;
    totalPenalty += penalty;
    reasons.push({
      code: "transfers",
      label: `${realTransfers} transfer${realTransfers > 1 ? "s" : ""}`,
      penalty,
    });
  }

  // Analyze transfer risks between consecutive ride legs
  for (let i = 0; i < rideLegs.length - 1; i++) {
    const currentRide = rideLegs[i];
    const nextRide = rideLegs[i + 1];

    // Calculate margin from this ride's arrival to next ride's departure
    const arrivalTime = new Date(currentRide.to.timeActual || currentRide.to.timePlanned).getTime();
    const departureTimeNext = new Date(nextRide.from.timePlanned).getTime();
    const marginMin = Math.round((departureTimeNext - arrivalTime) / 60000);
    
    const transferStation = currentRide.to.name;
    const bigStation = isBigStation(transferStation);
    
    let transferPenalty = 0;
    let riskLevel: "low" | "medium" | "high" = "low";

    if (marginMin < 4) {
      transferPenalty = 0.35;
      riskLevel = "high";
      reasons.push({
        code: "tight_transfer",
        label: `${marginMin}min transfer at ${transferStation}`,
        penalty: transferPenalty,
      });
    } else if (marginMin < 6) {
      transferPenalty = 0.20;
      riskLevel = "medium";
      reasons.push({
        code: "short_transfer",
        label: `${marginMin}min transfer`,
        penalty: transferPenalty,
      });
    } else if (marginMin < 8) {
      transferPenalty = 0.10;
      riskLevel = "low";
    }

    if (bigStation && realTransfers > 0) {
      const stationPenalty = 0.08;
      totalPenalty += stationPenalty;
      if (!reasons.find(r => r.code === "big_station")) {
        reasons.push({
          code: "big_station",
          label: `Large station transfer`,
          penalty: stationPenalty,
        });
      }
    }

    totalPenalty += transferPenalty;

    transferRisks.push({
      fromStation: currentRide.to.name,
      toStation: nextRide.from.name,
      marginMinutes: marginMin,
      riskLevel,
      isBigStation: bigStation,
    });
  }

  if (isPeakTime(departureTime)) {
    const penalty = 0.08;
    totalPenalty += penalty;
    reasons.push({
      code: "peak_time",
      label: "Rush hour travel",
      penalty,
    });
  }

  for (const leg of legs) {
    if (leg.delayMinutes && leg.delayMinutes > 3) {
      const penalty = 0.05;
      totalPenalty += penalty;
      if (!reasons.find(r => r.code === "current_delay")) {
        reasons.push({
          code: "current_delay",
          label: `Current delay (+${leg.delayMinutes}min)`,
          penalty,
        });
      }
    }
  }

  const score = Math.max(0, Math.min(1, 1 - totalPenalty));
  
  let level: "low" | "medium" | "high";
  if (score >= 0.75) level = "low";
  else if (score >= 0.55) level = "medium";
  else level = "high";

  reasons.sort((a, b) => b.penalty - a.penalty);

  return {
    score,
    level,
    reasons: reasons.slice(0, 3),
    transferRisks,
  };
}

