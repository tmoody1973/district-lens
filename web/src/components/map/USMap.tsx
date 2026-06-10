"use client";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import type { RaceRow } from "@/types/agent-state";

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

// Single-hue intensity ramp keyed to the SIZE of the fundraising gap.
// This shows money, never a prediction or a candidate-position signal.
const SMALL_GAP_MAX = 1.5; // within ~1.5x receipts = roughly even money
const MEDIUM_GAP_MAX = 3; // up to 3x = moderate gap

const COLOR_NO_DATA = "#52525b"; // zinc-600 — dimmed for dark background (was slate-200 glare)
const COLOR_GAP_SMALL = "#ddd6fe"; // violet-200 — fundraising near parity
const COLOR_GAP_MEDIUM = "#a78bfa"; // violet-400
const COLOR_GAP_LARGE = "#6d28d9"; // violet-700 — one candidate far out-raises the other

function receiptsRatio(race: RaceRow): number | null {
  const incumbent = race.incumbentReceipts;
  const challenger = race.topChallengerReceipts;
  // Only null/undefined means "missing"; $0 is a real, meaningful value.
  if (incumbent == null || challenger == null) return null;
  if (incumbent === 0 && challenger === 0) return 1; // no money either side → no gap
  if (challenger === 0) return Infinity; // one side raised nothing → maximal gap
  return incumbent / challenger;
}

// Direction-agnostic gap magnitude: how lopsided the fundraising is, either way.
function fundraisingGap(race: RaceRow): number | null {
  const ratio = receiptsRatio(race);
  if (ratio === null) return null;
  return ratio >= 1 ? ratio : 1 / ratio;
}

function fundraisingAdvantageColor(stateCode: string, races: RaceRow[]): string {
  const gaps = races
    .filter((race) => race.state === stateCode)
    .map(fundraisingGap)
    .filter((gap): gap is number => gap !== null);

  if (gaps.length === 0) return COLOR_NO_DATA;

  const maxGap = Math.max(...gaps);
  if (maxGap < SMALL_GAP_MAX) return COLOR_GAP_SMALL;
  if (maxGap < MEDIUM_GAP_MAX) return COLOR_GAP_MEDIUM;
  return COLOR_GAP_LARGE;
}

interface Props {
  focusedState: string | null;
  onStateClick: (stateCode: string) => void;
  heatmapData?: RaceRow[];
}

export function USMap({
  focusedState,
  onStateClick,
  heatmapData = [],
}: Props) {
  const isHeatmap = heatmapData.length > 0;

  return (
    <div className="w-full border-2 border-edge-strong rounded-[2px] bg-surface-raised overflow-hidden">
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
                  ? fundraisingAdvantageColor(stateCode, heatmapData)
                  : COLOR_NO_DATA;
              return (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  onClick={() => stateCode && onStateClick(stateCode)}
                  style={{
                    default: {
                      fill,
                      stroke: "#52525b",
                      strokeWidth: 0.5,
                      outline: "none",
                      cursor: stateCode ? "pointer" : "default",
                    },
                    hover: {
                      fill: isFocused ? "#1e40af" : "#3f3f46",
                      stroke: "#52525b",
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
        <div className="space-y-1 px-3 pb-2">
          <p className="text-center text-xs font-medium uppercase tracking-widest text-ink-muted">
            Fundraising Advantage
          </p>
          <div className="flex items-center justify-center gap-2 text-xs text-ink-muted">
            <span>Smaller gap</span>
            <span className="inline-block h-3 w-4 rounded-sm" style={{ background: COLOR_GAP_SMALL }} />
            <span className="inline-block h-3 w-4 rounded-sm" style={{ background: COLOR_GAP_MEDIUM }} />
            <span className="inline-block h-3 w-4 rounded-sm" style={{ background: COLOR_GAP_LARGE }} />
            <span>Larger gap</span>
          </div>
          <p className="text-center text-[11px] text-ink-faint">
            Fundraising, not a prediction. Most seats are safe regardless of money.
          </p>
        </div>
      )}
    </div>
  );
}
