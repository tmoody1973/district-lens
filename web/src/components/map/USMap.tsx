"use client";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import type { AppMode, RaceRow } from "@/types/agent-state";

const GEO_URL = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";

const FIPS_TO_STATE: Record<string, string> = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA",
  "08": "CO", "09": "CT", "10": "DE", "12": "FL", "13": "GA",
  "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA",
  "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD",
  "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO",
  "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ",
  "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
  "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC",
  "46": "SD", "47": "TN", "48": "TX", "49": "UT", "50": "VT",
  "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY",
};

// Finance ratio classifies RACE COMPETITIVENESS only — never a candidate position signal.
const COMPETITIVE_RATIO_MAX = 1.5;
const LEAN_RATIO_MAX = 3;

const COLOR_NO_DATA = "#e2e8f0"; // slate-200
const COLOR_COMPETITIVE = "#fca5a5"; // red-300
const COLOR_LEAN = "#fcd34d"; // amber-300
const COLOR_SAFE = "#86efac"; // green-300

function receiptsRatio(race: RaceRow): number | null {
  if (!race.incumbentReceipts || !race.topChallengerReceipts) return null;
  return race.incumbentReceipts / race.topChallengerReceipts;
}

function heatmapColor(stateCode: string, races: RaceRow[]): string {
  const stateRaces = races.filter((race) => race.state === stateCode);
  if (stateRaces.length === 0) return COLOR_NO_DATA;

  const ratios = stateRaces
    .map(receiptsRatio)
    .filter((ratio): ratio is number => ratio !== null);

  const hasCompetitive = ratios.some((ratio) => ratio < COMPETITIVE_RATIO_MAX);
  if (hasCompetitive) return COLOR_COMPETITIVE;

  const hasLean = ratios.some(
    (ratio) => ratio >= COMPETITIVE_RATIO_MAX && ratio < LEAN_RATIO_MAX,
  );
  if (hasLean) return COLOR_LEAN;

  return COLOR_SAFE;
}

interface Props {
  focusedState: string | null;
  onStateClick: (stateCode: string) => void;
  mode?: AppMode;
  heatmapData?: RaceRow[];
}

export function USMap({
  focusedState,
  onStateClick,
  mode = "voter",
  heatmapData = [],
}: Props) {
  const isHeatmap = mode === "journalist" && heatmapData.length > 0;

  return (
    <div className="w-full border-2 border-slate-900 rounded-[2px] bg-slate-50 overflow-hidden">
      <ComposableMap
        projection="geoAlbersUsa"
        projectionConfig={{ scale: 1000 }}
        style={{ width: "100%", height: "auto" }}
      >
        <Geographies geography={GEO_URL}>
          {({ geographies }) =>
            geographies.map((geo) => {
              const stateCode = FIPS_TO_STATE[geo.id as string] ?? "";
              const isFocused = stateCode === focusedState;
              const fill = isFocused
                ? "#1d4ed8"
                : isHeatmap
                  ? heatmapColor(stateCode, heatmapData)
                  : COLOR_NO_DATA;
              return (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  onClick={() => stateCode && onStateClick(stateCode)}
                  style={{
                    default: {
                      fill,
                      stroke: "#94a3b8",
                      strokeWidth: 0.5,
                      outline: "none",
                      cursor: stateCode ? "pointer" : "default",
                    },
                    hover: {
                      fill: isFocused ? "#1e40af" : "#94a3b8",
                      stroke: "#64748b",
                      strokeWidth: 0.5,
                      outline: "none",
                    },
                    pressed: {
                      fill: "#1e3a8a",
                      outline: "none",
                    },
                  }}
                />
              );
            })
          }
        </Geographies>
      </ComposableMap>
      {isHeatmap && (
        <div className="flex gap-4 justify-center px-3 pb-2 text-xs text-slate-500">
          <span>
            <span className="inline-block w-3 h-3 rounded-sm bg-red-300 mr-1" />
            Competitive
          </span>
          <span>
            <span className="inline-block w-3 h-3 rounded-sm bg-amber-300 mr-1" />
            Lean
          </span>
          <span>
            <span className="inline-block w-3 h-3 rounded-sm bg-green-300 mr-1" />
            Safe
          </span>
        </div>
      )}
    </div>
  );
}
