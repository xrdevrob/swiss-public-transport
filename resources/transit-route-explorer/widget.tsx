import { AppsSDKUIProvider } from "@openai/apps-sdk-ui/components/AppsSDKUIProvider";
import { McpUseProvider, useWidget, type WidgetMetadata } from "mcp-use/react";
import React, { useState, useMemo, useCallback } from "react";
import { Link } from "react-router";
import { ConnectionCard } from "./components/ConnectionCard";
import { Header } from "./components/Header";
import { SortControls, type SortMode } from "./components/SortControls";
import { propSchema, type TransitWidgetProps, type Connection } from "./types";
import "../styles.css";

export const widgetMetadata: WidgetMetadata = {
  description:
    "Display Swiss public transit connections with route details, transfers, and reliability scores. Supports sorting and expanding connection details.",
  props: propSchema,
  exposeAsTool: false,
};

const TransitRouteExplorer: React.FC = () => {
  const { props, callTool, state, setState } = useWidget<TransitWidgetProps>();
  const [sortMode, setSortMode] = useState<SortMode>(
    (state?.sortMode as SortMode) || "recommended"
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [localConnections, setLocalConnections] = useState<Connection[] | null>(null);

  const connections = localConnections || props?.connections || [];

  const sortedConnections = useMemo(() => {
    if (!connections.length) return [];
    const sorted = [...connections];
    switch (sortMode) {
      case "fastest":
        return sorted.sort((a, b) => a.durationMinutes - b.durationMinutes);
      case "fewest-transfers":
        return sorted.sort((a, b) => a.transfersCount - b.transfersCount);
      case "earliest":
        return sorted.sort(
          (a, b) =>
            new Date(a.departureTime).getTime() -
            new Date(b.departureTime).getTime()
        );
      case "recommended":
      default:
        return sorted.sort((a, b) => {
          const aRecommended = a.tags.includes("recommended") ? -1 : 0;
          const bRecommended = b.tags.includes("recommended") ? -1 : 0;
          if (aRecommended !== bRecommended) return aRecommended - bRecommended;
          return (
            new Date(a.departureTime).getTime() -
            new Date(b.departureTime).getTime()
          );
        });
    }
  }, [connections, sortMode]);

  const handleSortChange = useCallback(
    async (mode: SortMode) => {
      setSortMode(mode);
      await setState({ ...state, sortMode: mode });
    },
    [state, setState]
  );

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const result = await callTool("find_connections", {
        from: props.query.from,
        to: props.query.to,
        datetime: new Date().toISOString(),
      });

      if (result?.content) {
        for (const item of result.content) {
          if (item.type === "text" && item.text) {
            try {
              const data = JSON.parse(item.text);
              if (data.connections) {
                setLocalConnections(data.connections);
              }
            } catch {}
          }
        }
      }
    } catch (error) {
      console.error("Failed to refresh:", error);
    } finally {
      setIsRefreshing(false);
    }
  }, [callTool, props?.query]);

  if (!props?.query || !props?.connections) {
    return (
      <McpUseProvider debugger viewControls autoSize>
        <AppsSDKUIProvider linkComponent={Link}>
          <div className="bg-surface-elevated border border-default rounded-2xl p-8 text-center">
            <p className="text-secondary">Loading transit data...</p>
          </div>
        </AppsSDKUIProvider>
      </McpUseProvider>
    );
  }

  const fromName = props.stationsResolved?.fromStation?.name || props.query.from;
  const toName = props.stationsResolved?.toStation?.name || props.query.to;

  return (
    <McpUseProvider debugger viewControls autoSize>
      <AppsSDKUIProvider linkComponent={Link}>
        <div className="bg-surface-elevated border border-default rounded-2xl overflow-hidden">
          <div className="bg-gradient-to-r from-red-600 to-red-700 px-5 py-3">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z" />
                <path d="M9 16h6v-2H9zm0-4h6v-2H9zm0-4h6V6H9z" />
              </svg>
              <span className="text-white font-semibold text-sm tracking-wide">
                Swiss Transit Explorer
              </span>
            </div>
          </div>

          <div className="p-5 space-y-4">
            <Header
              from={fromName}
              to={toName}
              datetimeISO={props.query.datetimeISO}
              generatedAt={props.generatedAtISO}
              onRefresh={handleRefresh}
              isRefreshing={isRefreshing}
            />

            <SortControls sortMode={sortMode} onSortChange={handleSortChange} />

            <div className="space-y-3">
              {sortedConnections.length === 0 ? (
                <div className="text-center py-8 text-secondary">
                  <p className="font-medium">No connections found</p>
                </div>
              ) : (
                sortedConnections.map((connection, index) => (
                  <ConnectionCard
                    key={connection.id}
                    connection={connection}
                    isExpanded={index === 0}
                  />
                ))
              )}
            </div>

            <div className="pt-3 border-t border-default">
              <p className="text-xs text-tertiary">
                Risk scores based on transfers, transfer time, and delays.
              </p>
            </div>
          </div>
        </div>
      </AppsSDKUIProvider>
    </McpUseProvider>
  );
};

export default TransitRouteExplorer;
