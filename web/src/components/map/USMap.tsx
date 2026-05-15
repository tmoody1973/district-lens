"use client";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";

const GEO_URL =
  "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";

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

interface Props {
  focusedState: string | null;
  onStateClick: (stateCode: string) => void;
}

export function USMap({ focusedState, onStateClick }: Props) {
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
              return (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  onClick={() => stateCode && onStateClick(stateCode)}
                  style={{
                    default: {
                      fill: isFocused ? "#1d4ed8" : "#e2e8f0",
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
    </div>
  );
}
