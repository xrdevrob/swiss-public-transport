import { AppsSDKUIProvider } from "@openai/apps-sdk-ui/components/AppsSDKUIProvider";
import { McpUseProvider, useWidget, type WidgetMetadata } from "mcp-use/react";
import React from "react";
import { Link } from "react-router";
import { z } from "zod";
import "../styles.css";

interface BoardEntry {
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

interface DeparturesBoardProps {
  station: string;
  mode: "departures" | "arrivals";
  entries: BoardEntry[];
  generatedAt: string;
  [key: string]: unknown;
}

export const widgetMetadata: WidgetMetadata = {
  description: "Live departures/arrivals board showing upcoming trains at a Swiss transit station.",
  props: z.object({
    station: z.string(),
    mode: z.enum(["departures", "arrivals"]),
    entries: z.any(),
    generatedAt: z.string(),
  }),
  exposeAsTool: false,
};

const formatTime = (iso: string) => {
  if (!iso) return "--:--";
  return new Date(iso).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
};

const getLineBadgeColor = (line: string) => {
  if (line.startsWith("IC")) return "bg-red-600";
  if (line.startsWith("IR")) return "bg-red-500";
  if (line.startsWith("S")) return "bg-blue-500";
  if (line.startsWith("RE")) return "bg-orange-500";
  if (line.startsWith("TGV")) return "bg-purple-600";
  if (line.startsWith("EC") || line.startsWith("EN")) return "bg-gray-700";
  return "bg-teal-500";
};

const DeparturesBoard: React.FC = () => {
  const { props } = useWidget<DeparturesBoardProps>();

  if (!props?.entries) {
    return (
      <McpUseProvider debugger viewControls autoSize>
        <AppsSDKUIProvider linkComponent={Link}>
          <div className="bg-surface-elevated border border-default rounded-2xl p-8 text-center">
            <p className="text-secondary">Loading board...</p>
          </div>
        </AppsSDKUIProvider>
      </McpUseProvider>
    );
  }

  const boardLabel = props.mode === "arrivals" ? "Arrivals" : "Departures";

  return (
    <McpUseProvider debugger viewControls autoSize>
      <AppsSDKUIProvider linkComponent={Link}>
        <div className="bg-surface-elevated border border-default rounded-2xl overflow-hidden">
          <div className="bg-gradient-to-r from-red-600 to-red-700 px-5 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z" />
                  <path d="M12.5 7H11v6l5.25 3.15.75-1.23-4.5-2.67z" />
                </svg>
                <span className="text-white font-semibold text-sm tracking-wide">
                  {boardLabel}
                </span>
              </div>
              <span className="text-white/70 text-xs">
                Updated {formatTime(props.generatedAt)}
              </span>
            </div>
          </div>

          <div className="p-5 space-y-4">
            <h1 className="text-xl font-bold text-default">{props.station}</h1>

            <div className="space-y-2">
              {props.entries.map((entry: BoardEntry, i: number) => {
                const displayLine = entry.lineDisplay || entry.line || "";
                return (
                  <div
                    key={i}
                    className="bg-surface border border-default rounded-xl p-4 flex items-center gap-4 hover:border-blue-500/50 transition-colors"
                  >
                    <div className="text-center min-w-[60px]">
                      <div className="text-xl font-semibold text-default tabular-nums">
                        {formatTime(entry.timeActual || entry.timePlanned)}
                      </div>
                      {entry.delayMinutes && entry.delayMinutes > 0 && (
                        <div className="text-xs text-red-500 font-medium">
                          +{entry.delayMinutes}′
                        </div>
                      )}
                    </div>

                    <div className="min-w-[60px]">
                      <span className={`px-2 py-1 text-xs font-bold text-white rounded ${getLineBadgeColor(displayLine)}`}>
                        {displayLine}
                      </span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <span className="text-default font-medium truncate block">
                        {entry.destination}
                      </span>
                    </div>

                    {entry.platform && (
                      <div className="text-right">
                        <span
                          className={`text-xs px-2 py-1 rounded ${
                            entry.platform.includes("!")
                              ? "bg-red-500/20 text-red-600 dark:text-red-400 font-medium"
                              : "text-tertiary bg-surface-elevated"
                          }`}
                          title={entry.platform.includes("!") ? "⚠️ Platform changed!" : undefined}
                        >
                          Pl. {entry.platform}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="pt-3 border-t border-default">
              <p className="text-xs text-tertiary">
                Live data from transport.opendata.ch
              </p>
            </div>
          </div>
        </div>
      </AppsSDKUIProvider>
    </McpUseProvider>
  );
};

export default DeparturesBoard;
