import React from "react";

export type SortMode = "recommended" | "fastest" | "fewest-transfers" | "earliest";

interface SortControlsProps {
  sortMode: SortMode;
  onSortChange: (mode: SortMode) => void;
}

export const SortControls: React.FC<SortControlsProps> = ({
  sortMode,
  onSortChange,
}) => {
  const sortOptions: { value: SortMode; label: string }[] = [
    { value: "recommended", label: "Recommended" },
    { value: "fastest", label: "Fastest" },
    { value: "fewest-transfers", label: "Fewest transfers" },
    { value: "earliest", label: "Earliest departure" },
  ];

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-tertiary">Sort:</span>
      <div className="flex flex-wrap gap-1">
        {sortOptions.map((option) => (
          <button
            key={option.value}
            onClick={() => onSortChange(option.value)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-all ${
              sortMode === option.value
                ? "bg-blue-500 text-white shadow-sm"
                : "bg-surface-elevated text-secondary hover:bg-surface border border-default"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
};

export default SortControls;

