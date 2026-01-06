import React, { useState } from "react";
import type { Connection, Leg, TransferRisk, WeatherSample, WeatherInsight } from "../types";

const formatTime = (isoString: string) => {
  if (!isoString) return "--:--";
  const date = new Date(isoString);
  return date.toLocaleTimeString("de-CH", {
    hour: "2-digit",
    minute: "2-digit",
  });
};

const isPlatformChanged = (platform?: string) => platform?.includes("!");

const PlatformBadge: React.FC<{ platform?: string; className?: string }> = ({ platform, className = "" }) => {
  if (!platform) return null;
  const changed = isPlatformChanged(platform);
  return (
    <span
      className={`text-xs px-1.5 py-0.5 rounded ${
        changed 
          ? "bg-red-500/20 text-red-600 dark:text-red-400 font-medium" 
          : "text-tertiary bg-surface"
      } ${className}`}
      title={changed ? "⚠️ Platform changed! Check departure boards." : undefined}
    >
      Pl. {platform}
    </span>
  );
};

interface ConnectionCardProps {
  connection: Connection;
  isExpanded?: boolean;
}

export const ConnectionCard: React.FC<ConnectionCardProps> = ({
  connection,
  isExpanded: defaultExpanded = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const formatDuration = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours === 0) return `${mins}min`;
    return `${hours}h ${mins}min`;
  };

  const getLineBadgeColor = (line?: string) => {
    if (!line) return "bg-gray-500";
    if (line.startsWith("IC")) return "bg-red-600";
    if (line.startsWith("IR")) return "bg-red-500";
    if (line.startsWith("S")) return "bg-blue-500";
    if (line.startsWith("RE")) return "bg-orange-500";
    if (line.startsWith("TGV")) return "bg-purple-600";
    if (line.startsWith("EC") || line.startsWith("EN")) return "bg-gray-700";
    return "bg-teal-500";
  };

  const getRiskLevelStyle = (level?: "low" | "medium" | "high") => {
    switch (level) {
      case "low": return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
      case "medium": return "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300";
      case "high": return "bg-red-500/15 text-red-700 dark:text-red-300";
      default: return "bg-gray-500/15 text-gray-600 dark:text-gray-300";
    }
  };

  const getRiskLevelLabel = (level?: "low" | "medium" | "high") => {
    switch (level) {
      case "low": return "Low Risk";
      case "medium": return "Mid Risk";
      case "high": return "High Risk";
      default: return "Risk";
    }
  };

  const getRiskLevel = (score?: number, level?: "low" | "medium" | "high") => {
    if (level) return level;
    if (score === undefined) return undefined;
    if (score >= 0.75) return "low";
    if (score >= 0.55) return "medium";
    return "high";
  };

  const getWeatherIcon = (weather?: WeatherInsight) => {
    if (!weather?.samples?.length) return "⛅";
    const sample = weather.samples[0];
    if (sample.snowfall > 0) return "❄️";
    if (sample.precipitation > 5) return "🌧️";
    if (sample.precipitation > 0) return "🌦️";
    if (sample.windGusts > 50) return "💨";
    if (sample.temperature > 25) return "☀️";
    if (sample.temperature <= 2) return "🥶";
    return "⛅";
  };

  return (
    <div className="bg-surface border border-default rounded-xl overflow-hidden transition-all duration-200 hover:border-blue-500/50">
      <button
        className="w-full p-4 text-left"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="text-center">
              <div className="text-xl font-semibold text-default tabular-nums">
                {formatTime(connection.departureTime)}
              </div>
              {connection.legs[0]?.from.platform && (
                <div className="mt-0.5">
                  <PlatformBadge platform={connection.legs[0].from.platform} />
                </div>
              )}
              {!connection.legs[0]?.from.platform && (
                <div className="mt-0.5 h-4" />
              )}
            </div>
            <div className="flex items-center gap-1 text-tertiary">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </div>
            <div className="text-center">
              <div className="text-xl font-semibold text-default tabular-nums">
                {formatTime(connection.arrivalTime)}
              </div>
              {connection.legs[connection.legs.length - 1]?.to.platform && (
                <div className="mt-0.5">
                  <PlatformBadge platform={connection.legs[connection.legs.length - 1].to.platform} />
                </div>
              )}
              {!connection.legs[connection.legs.length - 1]?.to.platform && (
                <div className="mt-0.5 h-4" />
              )}
            </div>
          </div>

          <div className="flex-1 flex flex-col items-center gap-1.5">
            <div className="flex flex-wrap justify-center gap-1">
              {connection.legs
                .filter((leg) => leg.type === "ride" && (leg.lineDisplay || leg.line))
                .map((leg, i) => {
                  const label = leg.lineDisplay || leg.line || "";
                  return (
                    <span
                      key={i}
                      className={`px-2 py-0.5 text-xs font-semibold text-white rounded ${getLineBadgeColor(label)}`}
                    >
                      {label}
                    </span>
                  );
                })}
            </div>
          </div>

          <div className="flex items-center gap-4 text-sm">
            <div className="text-right">
              <div className="font-medium text-default">
                {formatDuration(connection.durationMinutes)}
              </div>
              <div className="text-tertiary text-xs">
                {connection.transfersCount === 0
                  ? "Direct"
                  : `${connection.transfersCount} transfer${connection.transfersCount > 1 ? "s" : ""}`}
              </div>
            </div>
            {connection.weather && (
              <div 
                className="flex items-center gap-1 px-2 py-1 rounded-lg border border-default text-secondary"
                title={connection.weather.reasons.map(r => r.label).join(", ") || "Good weather"}
              >
                <span className="text-base">{getWeatherIcon(connection.weather)}</span>
                {connection.weather.samples[0] && (
                  <span className="text-xs font-medium text-default">
                    {Math.round(connection.weather.samples[0].temperature)}°
                  </span>
                )}
              </div>
            )}
            {(connection.reliability || connection.reliabilityScore !== undefined) && (() => {
              const riskLevel = getRiskLevel(
                connection.reliability?.score ?? connection.reliabilityScore,
                connection.reliability?.level
              );
              if (!riskLevel) return null;
              const title = connection.reliability
                ? "Risk based on transfers, timing margins, station complexity, rush hour, and current delays."
                : "Risk based on transfers and current delays.";
              return (
                <span
                  className={`px-2 py-1 text-xs font-semibold rounded ${getRiskLevelStyle(riskLevel)}`}
                  title={title}
                >
                  {getRiskLevelLabel(riskLevel)}
                </span>
              );
            })()}
            <svg
              className={`w-5 h-5 text-tertiary transition-transform duration-200 ${
                isExpanded ? "rotate-180" : ""
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-default px-4 py-3 bg-surface-elevated space-y-4">
          {connection.reliability && connection.reliability.reasons.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-secondary uppercase tracking-wide">Risk Factors</div>
              <div className="flex flex-wrap gap-1.5">
                {connection.reliability.reasons.map((reason, i) => (
                  <span
                    key={i}
                    className="px-2 py-1 text-xs rounded-full bg-surface border border-default text-secondary"
                    title={`Impact: -${Math.round(reason.penalty * 100)}%`}
                  >
                    {reason.label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {connection.reliability && connection.reliability.transferRisks.length > 0 && (
            <TransferRisksTable risks={connection.reliability.transferRisks} />
          )}

          {connection.weather && connection.weather.samples.length > 0 && (
            <WeatherPanel weather={connection.weather} />
          )}

          <LegTimeline legs={connection.legs} />
        </div>
      )}
    </div>
  );
};

const TransferRisksTable: React.FC<{ risks: TransferRisk[] }> = ({ risks }) => {
  if (risks.length === 0) return null;

  const getRiskBadge = (level: "low" | "medium" | "high") => {
    const styles = {
      low: "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400",
      medium: "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400",
      high: "bg-red-500/20 text-red-600 dark:text-red-400",
    };
    return (
      <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${styles[level]}`}>
        {level}
      </span>
    );
  };

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-secondary uppercase tracking-wide">Transfer Analysis</div>
      <div className="rounded-lg border border-default overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-surface">
            <tr className="text-left text-tertiary">
              <th className="px-3 py-2 font-medium">Station</th>
              <th className="px-3 py-2 font-medium text-center">Margin</th>
              <th className="px-3 py-2 font-medium text-center">Risk</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-default">
            {risks.map((risk, i) => (
              <tr key={i} className="bg-surface-elevated">
                <td className="px-3 py-2">
                  <span className="text-default">{risk.fromStation}</span>
                  {risk.isBigStation && (
                    <span className="ml-1 text-tertiary text-[10px]">(large station)</span>
                  )}
                </td>
                <td className="px-3 py-2 text-center font-mono tabular-nums text-default">
                  {risk.marginMinutes}min
                </td>
                <td className="px-3 py-2 text-center">
                  {getRiskBadge(risk.riskLevel)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const WeatherPanel: React.FC<{ weather: WeatherInsight }> = ({ weather }) => {
  const getWeatherEmoji = (sample: WeatherSample) => {
    if (sample.snowfall > 0) return "❄️";
    if (sample.precipitation > 5) return "🌧️";
    if (sample.precipitation > 0) return "🌦️";
    if (sample.windGusts > 50) return "💨";
    if (sample.temperature > 25) return "☀️";
    if (sample.temperature <= 2) return "🥶";
    return "⛅";
  };

  const formatWeather = (sample: WeatherSample) => {
    const parts: string[] = [`${Math.round(sample.temperature)}°C`];
    if (sample.precipitation > 0) parts.push(`${sample.precipitation.toFixed(1)}mm`);
    if (sample.snowfall > 0) parts.push(`${sample.snowfall.toFixed(1)}cm snow`);
    if (sample.windGusts > 30) parts.push(`${Math.round(sample.windGusts)}km/h gusts`);
    return parts.join(", ");
  };

  const formatTime = (iso: string) => {
    if (!iso) return "--:--";
    return new Date(iso).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
  };

  const sortedSamples = [...weather.samples].sort((a, b) => 
    new Date(a.time).getTime() - new Date(b.time).getTime()
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="text-xs font-medium text-secondary uppercase tracking-wide">Weather Conditions</div>
        {weather.reasons.length > 0 && (
          <div className="flex gap-1">
            {weather.reasons.map((reason, i) => (
              <span
                key={i}
                className="px-1.5 py-0.5 text-[10px] rounded-full bg-orange-500/20 text-orange-600 dark:text-orange-400"
              >
                {reason.label}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="rounded-lg border border-default overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-surface">
            <tr className="text-left text-tertiary">
              <th className="px-3 py-2 font-medium">Location</th>
              <th className="px-3 py-2 font-medium text-center">Time</th>
              <th className="px-3 py-2 font-medium text-right">Conditions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-default">
            {sortedSamples.map((sample, i) => (
              <tr key={i} className="bg-surface-elevated">
                <td className="px-3 py-2">
                  <span className="text-default">{sample.station}</span>
                </td>
                <td className="px-3 py-2 text-center font-mono tabular-nums text-tertiary">
                  {formatTime(sample.time)}
                </td>
                <td className="px-3 py-2 text-right">
                  <span className="mr-1">{getWeatherEmoji(sample)}</span>
                  <span className="text-default">{formatWeather(sample)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const LegTimeline: React.FC<{ legs: Leg[] }> = ({ legs }) => {
  // Only show ride legs, skip walks
  const rideLegs = legs.filter(l => l.type === "ride");

  // Calculate transfer time between consecutive ride legs (includes walk time)
  const getTransferTime = (rideIndex: number): number | null => {
    if (rideIndex >= rideLegs.length - 1) return null;
    const arrival = new Date(rideLegs[rideIndex].to.timeActual || rideLegs[rideIndex].to.timePlanned).getTime();
    const departure = new Date(rideLegs[rideIndex + 1].from.timePlanned).getTime();
    return Math.round((departure - arrival) / 60000);
  };

  return (
    <div className="space-y-0">
      {rideLegs.map((leg, index) => {
        const transferTime = getTransferTime(index);
        const isTightTransfer = transferTime !== null && transferTime < 6;

        return (
          <React.Fragment key={index}>
            <div className="flex gap-3">
              <div className="flex flex-col items-center w-8">
                <div className="w-3 h-3 rounded-full border-2 border-blue-500 bg-blue-500" />
                <div className="flex-1 w-0.5 min-h-8 bg-blue-500" />
                <div className="w-3 h-3 rounded-full border-2 border-blue-500 bg-blue-500" />
              </div>

              <div className="flex-1 pb-2">
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="font-mono text-sm tabular-nums text-default">
                    {formatTime(leg.from.timeActual || leg.from.timePlanned)}
                  </span>
                  <span className="text-sm font-medium text-default">{leg.from.name}</span>
                  <PlatformBadge platform={leg.from.platform} />
                  {leg.delayMinutes && leg.delayMinutes > 0 && (
                    <span className="text-xs text-red-500 font-medium">
                      +{leg.delayMinutes}′
                    </span>
                  )}
                </div>

                <div className="text-xs text-secondary ml-1 my-2">
                  <span className="font-medium">{leg.lineDisplay || leg.line}</span>
                  {leg.operator && <span className="text-tertiary"> · {leg.operator}</span>}
                </div>

                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-sm tabular-nums text-default">
                    {formatTime(leg.to.timeActual || leg.to.timePlanned)}
                  </span>
                  <span className="text-sm font-medium text-default">{leg.to.name}</span>
                  <PlatformBadge platform={leg.to.platform} />
                </div>
              </div>
            </div>

            {transferTime !== null && (
              <div className="flex gap-3 py-2">
                <div className="w-8 flex justify-center">
                  <svg className="w-4 h-4 text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                  </svg>
                </div>
                <div
                  className={`text-xs ${
                    isTightTransfer ? "text-orange-500 font-medium" : "text-tertiary"
                  }`}
                >
                  {transferTime} min transfer
                  {isTightTransfer && " ⚠️"}
                </div>
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

export default ConnectionCard;
