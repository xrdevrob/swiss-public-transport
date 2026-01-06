import React from "react";

interface HeaderProps {
  from: string;
  to: string;
  datetimeISO: string;
  generatedAt: string;
  onRefresh: () => void;
  isRefreshing?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  from,
  to,
  datetimeISO,
  generatedAt,
  onRefresh,
  isRefreshing = false,
}) => {
  const formatDateTime = (isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const isTomorrow = date.toDateString() === tomorrow.toDateString();

    const timeStr = date.toLocaleTimeString("de-CH", {
      hour: "2-digit",
      minute: "2-digit",
    });

    if (isToday) {
      const diffMinutes = Math.round((date.getTime() - now.getTime()) / 60000);
      if (diffMinutes >= -5 && diffMinutes <= 5) {
        return "Leaving now";
      }
      return `Today at ${timeStr}`;
    }
    if (isTomorrow) {
      return `Tomorrow at ${timeStr}`;
    }
    return date.toLocaleDateString("de-CH", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatLastUpdated = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString("de-CH", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="space-y-3">
      {/* Route title */}
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="text-xl font-bold text-default">{from}</h1>
        <svg className="w-5 h-5 text-secondary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
        </svg>
        <h1 className="text-xl font-bold text-default">{to}</h1>
      </div>

      {/* Meta info row */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-4 text-sm text-secondary">
          <span className="flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {formatDateTime(datetimeISO)}
          </span>
          <span className="text-tertiary text-xs">
            Updated {formatLastUpdated(generatedAt)}
          </span>
        </div>

        {/* Refresh button */}
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded-lg transition-colors disabled:opacity-50"
        >
          <svg
            className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          {isRefreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>
    </div>
  );
};

export default Header;

