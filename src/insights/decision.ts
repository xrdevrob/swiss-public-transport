import type { Connection, Leg, WeatherInsight } from "../types";

export interface DecisionPreferences {
  maxTransfers?: number;
  preferLowWalking?: boolean;
  minimizeOutdoorIfRaining?: boolean;
}

export interface DecisionOption {
  id: string;
  rank: number;
  label: string;
  departureTime: string;
  arrivalTime: string;
  durationMinutes: number;
  transfersCount: number;
  minTransferMinutes?: number;
  walkingMinutes: number;
  transferWaitMinutes: number;
  exposureMinutes: number;
  riskScore: number;
  riskLevel: "low" | "medium" | "high";
  reasons: string[];
  suggestedDepartureTime: string;
  suggestedLeaveByTime?: string;
  arrivalBufferMinutes?: number;
  alerts: {
    delays: string[];
    platformChanges: string[];
  };
  weather?: {
    level: "low" | "medium" | "high";
    summary?: string;
  };
}

export interface DecisionSummary {
  from: string;
  to: string;
  requestedTimeISO: string;
  isArrivalTime: boolean;
  arrivalBufferMinutes?: number;
  departureBufferMinutes?: number;
  constraints: DecisionPreferences;
  constraintNote?: string;
  options: DecisionOption[];
  recommendedOptionId?: string;
  summaryText: string;
  dataCoverage: {
    realtimeDelays: boolean;
    platformChanges: boolean;
    cancellations: boolean;
    serviceNotices: boolean;
  };
}

interface ConnectionMetrics {
  walkingMinutes: number;
  transferWaitMinutes: number;
  minTransferMinutes?: number;
  transferStation?: string;
  exposureMinutes: number;
  delayMinutesTotal: number;
  delayAlerts: string[];
  platformChanges: string[];
}

interface DecisionContext {
  from: string;
  to: string;
  requestedTimeISO: string;
  isArrivalTime: boolean;
  arrivalBufferMinutes?: number;
  departureBufferMinutes?: number;
  preferences?: DecisionPreferences;
}

const OPTION_LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

const formatTime = (iso: string) => {
  if (!iso) return "--:--";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
};

const minutesBetween = (startISO?: string, endISO?: string) => {
  if (!startISO || !endISO) return 0;
  const start = new Date(startISO).getTime();
  const end = new Date(endISO).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 60000));
};

const subtractMinutes = (iso: string, minutes: number) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  date.setMinutes(date.getMinutes() - minutes);
  return date.toISOString();
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const normalize = (value: number, min: number, max: number) => {
  if (max <= min) return 0;
  return clamp((value - min) / (max - min), 0, 1);
};

const isWetWeather = (weather?: WeatherInsight) => {
  if (!weather?.samples?.length) return false;
  return weather.samples.some((sample) => sample.precipitation > 0 || sample.snowfall > 0);
};

const getWeatherConditionLabel = (weather?: WeatherInsight) => {
  if (!weather?.samples?.length) return undefined;
  const sample = weather.samples[0];
  if (sample.snowfall > 0) return "snow";
  if (sample.precipitation > 0) return "rain";
  if (sample.windGusts > 50) return "wind";
  return undefined;
};

const buildMetrics = (legs: Leg[]): ConnectionMetrics => {
  const walkLegs = legs.filter((leg) => leg.type === "walk");
  const rideLegs = legs.filter((leg) => leg.type === "ride");

  const walkingMinutes = walkLegs.reduce((sum, leg) => {
    const minutes = minutesBetween(
      leg.from.timeActual || leg.from.timePlanned,
      leg.to.timeActual || leg.to.timePlanned
    );
    return sum + minutes;
  }, 0);

  const transferWaitMinutesList: number[] = [];
  for (let i = 0; i < rideLegs.length - 1; i += 1) {
    const currentArrival = rideLegs[i].to.timeActual || rideLegs[i].to.timePlanned;
    const nextDeparture = rideLegs[i + 1].from.timeActual || rideLegs[i + 1].from.timePlanned;
    const wait = minutesBetween(currentArrival, nextDeparture);
    transferWaitMinutesList.push(wait);
  }

  const transferWaitMinutes = transferWaitMinutesList.reduce((sum, val) => sum + val, 0);
  const minTransferMinutes = transferWaitMinutesList.length
    ? Math.min(...transferWaitMinutesList)
    : undefined;
  const tightTransferIndex = transferWaitMinutesList.findIndex(
    (minutes) => minTransferMinutes !== undefined && minutes === minTransferMinutes
  );
  const transferStation =
    tightTransferIndex >= 0 ? rideLegs[tightTransferIndex]?.to.name : undefined;

  const delayAlerts: string[] = [];
  let delayMinutesTotal = 0;
  for (const leg of rideLegs) {
    if (leg.delayMinutes && leg.delayMinutes > 0) {
      delayMinutesTotal += leg.delayMinutes;
      const label = leg.line ? `${leg.line} +${leg.delayMinutes} min` : `Delay +${leg.delayMinutes} min`;
      if (!delayAlerts.includes(label)) delayAlerts.push(label);
    }
  }

  const platformChanges: string[] = [];
  const addPlatformChange = (station: string, platform?: string) => {
    if (!platform || !platform.includes("!")) return;
    const label = `${station} (Pl. ${platform})`;
    if (!platformChanges.includes(label)) platformChanges.push(label);
  };

  for (const leg of legs) {
    addPlatformChange(leg.from.name, leg.from.platform);
    addPlatformChange(leg.to.name, leg.to.platform);
  }

  return {
    walkingMinutes,
    transferWaitMinutes,
    minTransferMinutes,
    transferStation,
    exposureMinutes: walkingMinutes + transferWaitMinutes,
    delayMinutesTotal,
    delayAlerts,
    platformChanges,
  };
};

const computeRisk = (
  connection: Connection,
  metrics: ConnectionMetrics
): { score: number; level: "low" | "medium" | "high" } => {
  const reliabilityScore = connection.reliability?.score ?? connection.reliabilityScore ?? 0.7;
  const delayLikelihood = 1 - reliabilityScore;

  const weatherPenalty = connection.weather?.penalty ?? 0;
  const exposureFactor = clamp(metrics.exposureMinutes / 20, 0, 1);
  const weatherExposureRisk = weatherPenalty * (0.3 + 0.7 * exposureFactor);

  const tightTransferPenalty =
    metrics.minTransferMinutes !== undefined && metrics.minTransferMinutes < 6
      ? 0.12
      : metrics.minTransferMinutes !== undefined && metrics.minTransferMinutes < 8
        ? 0.06
        : 0;

  const score = clamp(delayLikelihood + weatherExposureRisk + tightTransferPenalty, 0, 1);

  let level: "low" | "medium" | "high";
  if (score >= 0.6) level = "high";
  else if (score >= 0.35) level = "medium";
  else level = "low";

  return { score, level };
};

const buildReasons = (
  connection: Connection,
  metrics: ConnectionMetrics,
  preferences?: DecisionPreferences
): string[] => {
  const reasons: Array<{ label: string; priority: number }> = [];
  const addReason = (label: string | undefined, priority: number) => {
    if (!label) return;
    if (reasons.some((r) => r.label === label)) return;
    reasons.push({ label, priority });
  };

  if (metrics.minTransferMinutes !== undefined && metrics.minTransferMinutes < 8) {
    const station = metrics.transferStation ? ` at ${metrics.transferStation}` : "";
    addReason(`${metrics.minTransferMinutes} min transfer${station}`, 1);
  }

  if (metrics.delayMinutesTotal > 0) {
    addReason(`current delay +${metrics.delayMinutesTotal} min`, 2);
  }

  const weatherCondition = getWeatherConditionLabel(connection.weather);
  if (weatherCondition && metrics.exposureMinutes > 0) {
    addReason(`${weatherCondition} + ${metrics.exposureMinutes} min exposed`, 3);
  } else if (connection.weather?.reasons?.length) {
    addReason(connection.weather.reasons[0].label, 4);
  }

  const walkingThreshold = preferences?.preferLowWalking ? 1 : 6;
  if (metrics.walkingMinutes >= walkingThreshold) {
    addReason(`${metrics.walkingMinutes} min walk`, 5);
  }

  if (connection.transfersCount > 0) {
    addReason(
      `${connection.transfersCount} transfer${connection.transfersCount > 1 ? "s" : ""}`,
      6
    );
  }

  if (metrics.platformChanges.length > 0) {
    addReason(
      `${metrics.platformChanges.length} platform change${metrics.platformChanges.length > 1 ? "s" : ""}`,
      7
    );
  }

  if (connection.reliability?.reasons?.some((reason) => reason.code === "peak_time")) {
    addReason("rush hour", 8);
  }

  return reasons.sort((a, b) => a.priority - b.priority).slice(0, 3).map((r) => r.label);
};

const formatOptionLine = (
  option: DecisionOption,
  context: DecisionContext
) => {
  const transferLabel =
    option.transfersCount === 0
      ? "direct"
      : `${option.transfersCount} transfer${option.transfersCount > 1 ? "s" : ""}`;

  const connectionPart =
    option.minTransferMinutes !== undefined && option.transfersCount > 0
      ? `, ${option.minTransferMinutes} min connection`
      : "";

  const reasons = option.reasons.length ? ` (${option.reasons.join(", ")})` : "";

  const bufferNote =
    context.isArrivalTime && option.arrivalBufferMinutes !== undefined && option.arrivalBufferMinutes > 0
      ? ` Buffer: ${option.arrivalBufferMinutes} min.`
      : "";

  const leaveByNote =
    !context.isArrivalTime && option.suggestedLeaveByTime
      ? ` Leave by ${formatTime(option.suggestedLeaveByTime)}.`
      : "";

  const riskScore = option.riskScore.toFixed(2);
  return `${option.label}: ${formatTime(option.departureTime)} -> ${formatTime(option.arrivalTime)} (${option.durationMinutes} min), ${transferLabel}${connectionPart}. Risk: ${option.riskLevel} (${riskScore})${reasons}.${bufferNote}${leaveByNote}`.trim();
};

const buildSummaryText = (
  options: DecisionOption[],
  context: DecisionContext,
  constraintNote?: string
) => {
  if (!options.length) {
    return `No connections found from ${context.from} to ${context.to}.`;
  }

  const constraintParts: string[] = [];
  if (context.isArrivalTime) {
    const arrivalTarget = formatTime(context.requestedTimeISO);
    constraintParts.push(`Arrive by ${arrivalTarget}`);
    if (context.arrivalBufferMinutes) {
      constraintParts.push(`buffer ${context.arrivalBufferMinutes} min`);
    }
  } else {
    constraintParts.push(`Depart around ${formatTime(context.requestedTimeISO)}`);
    if (context.departureBufferMinutes) {
      constraintParts.push(`leave ${context.departureBufferMinutes} min early`);
    }
  }

  if (context.preferences?.maxTransfers !== undefined) {
    constraintParts.push(`max ${context.preferences.maxTransfers} transfer${context.preferences.maxTransfers === 1 ? "" : "s"}`);
  }
  if (context.preferences?.preferLowWalking) {
    constraintParts.push("prefer low walking");
  }
  if (context.preferences?.minimizeOutdoorIfRaining) {
    constraintParts.push("minimize outdoor if raining");
  }

  const lines = [constraintParts.join("; ")];
  if (constraintNote) lines.push(constraintNote);

  options.slice(0, 3).forEach((option, index) => {
    const labelSuffix = index === 0 ? " (best)" : "";
    const line = formatOptionLine(
      { ...option, label: `${option.label}${labelSuffix}` },
      context
    );
    lines.push(line);
  });

  const topOption = options[0];
  if (topOption) {
    if (context.isArrivalTime) {
      const buffer =
        topOption.arrivalBufferMinutes && topOption.arrivalBufferMinutes > 0
          ? `, buffer ${topOption.arrivalBufferMinutes} min`
          : "";
      lines.push(`Suggested departure: ${formatTime(topOption.departureTime)}${buffer}.`);
    } else if (context.departureBufferMinutes && topOption.suggestedLeaveByTime) {
      lines.push(`Suggested departure: leave by ${formatTime(topOption.suggestedLeaveByTime)}.`);
    }

    const alertParts: string[] = [];
    if (topOption.alerts.delays.length) {
      alertParts.push(`delays: ${topOption.alerts.delays.join(", ")}`);
    }
    if (topOption.alerts.platformChanges.length) {
      alertParts.push(`platform changes: ${topOption.alerts.platformChanges.join(", ")}`);
    }
    if (alertParts.length) {
      lines.push(`Live alerts: ${alertParts.join("; ")}.`);
    }
  }

  return lines.join("\n");
};

export const buildDecisionSummary = (
  connections: Connection[],
  context: DecisionContext
): DecisionSummary => {
  if (!connections.length) {
    return {
      from: context.from,
      to: context.to,
      requestedTimeISO: context.requestedTimeISO,
      isArrivalTime: context.isArrivalTime,
      arrivalBufferMinutes: context.arrivalBufferMinutes,
      departureBufferMinutes: context.departureBufferMinutes,
      constraints: context.preferences || {},
      options: [],
      summaryText: `No connections found from ${context.from} to ${context.to}.`,
      dataCoverage: {
        realtimeDelays: true,
        platformChanges: true,
        cancellations: false,
        serviceNotices: false,
      },
    };
  }

  const computed = connections.map((connection) => {
    const metrics = buildMetrics(connection.legs);
    return { connection, metrics };
  });

  const maxTransfers =
    context.preferences?.maxTransfers !== undefined
      ? Math.max(0, Math.floor(context.preferences.maxTransfers))
      : undefined;

  let filtered = maxTransfers === undefined
    ? computed
    : computed.filter((item) => item.connection.transfersCount <= maxTransfers);

  let constraintNote: string | undefined;
  if (maxTransfers !== undefined && filtered.length === 0) {
    filtered = computed;
    constraintNote = `No routes within ${maxTransfers} transfer${maxTransfers === 1 ? "" : "s"}; showing closest matches.`;
  }

  const durations = filtered.map((item) => item.connection.durationMinutes);
  const transfers = filtered.map((item) => item.connection.transfersCount);
  const walking = filtered.map((item) => item.metrics.walkingMinutes);
  const exposure = filtered.map((item) => item.metrics.exposureMinutes);

  const minDuration = Math.min(...durations);
  const maxDuration = Math.max(...durations);
  const maxTransfersObserved = Math.max(1, ...transfers);
  const maxWalking = Math.max(1, ...walking);
  const maxExposure = Math.max(1, ...exposure);

  const preferLowWalking = !!context.preferences?.preferLowWalking;
  const minimizeOutdoor = !!context.preferences?.minimizeOutdoorIfRaining;

  const optionsWithScore = filtered.map(({ connection, metrics }, index) => {
    const risk = computeRisk(connection, metrics);
    const durationScore = normalize(connection.durationMinutes, minDuration, maxDuration);
    const transferScore = normalize(connection.transfersCount, 0, maxTransfersObserved);
    const walkingScore = normalize(metrics.walkingMinutes, 0, maxWalking);
    const exposureScore = normalize(metrics.exposureMinutes, 0, maxExposure);

    const isWet = isWetWeather(connection.weather);
    const weights = {
      risk: 0.55,
      duration: 0.2,
      transfer: 0.1,
      walking: preferLowWalking ? 0.1 : 0,
      exposure: minimizeOutdoor && isWet ? 0.1 : 0,
    };

    const weightSum = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
    const decisionScore =
      (risk.score * weights.risk +
        durationScore * weights.duration +
        transferScore * weights.transfer +
        walkingScore * weights.walking +
        exposureScore * weights.exposure) /
      weightSum;

    const arrivalBufferMinutes =
      context.isArrivalTime && context.requestedTimeISO
        ? minutesBetween(connection.arrivalTime, context.requestedTimeISO)
        : undefined;

    const suggestedLeaveByTime =
      !context.isArrivalTime && context.departureBufferMinutes
        ? subtractMinutes(connection.departureTime, context.departureBufferMinutes)
        : undefined;

    const reasons = buildReasons(connection, metrics, context.preferences);

    return {
      option: {
        id: connection.id,
        rank: index + 1,
        label: OPTION_LABELS[index] ? `Option ${OPTION_LABELS[index]}` : `Option ${index + 1}`,
        departureTime: connection.departureTime,
        arrivalTime: connection.arrivalTime,
        durationMinutes: connection.durationMinutes,
        transfersCount: connection.transfersCount,
        minTransferMinutes: metrics.minTransferMinutes,
        walkingMinutes: metrics.walkingMinutes,
        transferWaitMinutes: metrics.transferWaitMinutes,
        exposureMinutes: metrics.exposureMinutes,
        riskScore: risk.score,
        riskLevel: risk.level,
        reasons,
        suggestedDepartureTime: connection.departureTime,
        suggestedLeaveByTime,
        arrivalBufferMinutes,
        alerts: {
          delays: metrics.delayAlerts,
          platformChanges: metrics.platformChanges,
        },
        weather: connection.weather
          ? {
              level: connection.weather.level,
              summary: connection.weather.reasons?.[0]?.label,
            }
          : undefined,
      },
      decisionScore,
    };
  });

  optionsWithScore.sort((a, b) => a.decisionScore - b.decisionScore);

  const options: DecisionOption[] = optionsWithScore.map((entry, index) => ({
    ...entry.option,
    rank: index + 1,
    label: OPTION_LABELS[index] ? `Option ${OPTION_LABELS[index]}` : `Option ${index + 1}`,
  }));

  const summaryText = buildSummaryText(options, context, constraintNote);

  return {
    from: context.from,
    to: context.to,
    requestedTimeISO: context.requestedTimeISO,
    isArrivalTime: context.isArrivalTime,
    arrivalBufferMinutes: context.arrivalBufferMinutes,
    departureBufferMinutes: context.departureBufferMinutes,
    constraints: context.preferences || {},
    constraintNote,
    options,
    recommendedOptionId: options[0]?.id,
    summaryText,
    dataCoverage: {
      realtimeDelays: true,
      platformChanges: true,
      cancellations: false,
      serviceNotices: false,
    },
  };
};
