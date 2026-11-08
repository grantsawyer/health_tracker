import { useCallback, useState } from "react";

export type UnitSystem = "imperial" | "metric";
const KEY = "health-tracker:units";

/** Per-viewer display preference (data is stored metric everywhere). */
export function useUnits(): [UnitSystem, (u: UnitSystem) => void] {
  const [units, setUnitsState] = useState<UnitSystem>(() => {
    try {
      return localStorage.getItem(KEY) === "metric" ? "metric" : "imperial";
    } catch {
      return "imperial";
    }
  });
  const setUnits = useCallback((u: UnitSystem) => {
    setUnitsState(u);
    try {
      localStorage.setItem(KEY, u);
    } catch {
      /* storage unavailable: preference lasts for this session */
    }
  }, []);
  return [units, setUnits];
}

const nf = (digits = 0) => new Intl.NumberFormat(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });

export const fmtInt = (v: number) => nf(0).format(Math.round(v));
export const fmtKcal = (v: number) => `${fmtInt(v)} kcal`;
export const fmtMin = (v: number) => `${fmtInt(v)} min`;
export const fmtBpm = (v: number) => `${fmtInt(v)} bpm`;
export const fmtPct = (v: number) => `${nf(1).format(v)}%`;
export const fmtGrams = (v: number) => `${fmtInt(v)} g`;

/** 327 → "5h 27m" */
export const fmtDuration = (mins: number) => {
  const m = Math.round(mins);
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
};

export const distance = (units: UnitSystem) => ({
  unit: units === "imperial" ? "mi" : "km",
  convert: (km: number) => (units === "imperial" ? km * 0.621371 : km),
  format: (km: number) => `${nf(1).format(units === "imperial" ? km * 0.621371 : km)} ${units === "imperial" ? "mi" : "km"}`,
});

export const weight = (units: UnitSystem) => ({
  unit: units === "imperial" ? "lb" : "kg",
  convert: (kg: number) => (units === "imperial" ? kg * 2.20462 : kg),
  /** Formats an already-converted value. */
  formatConverted: (v: number) => `${nf(1).format(v)} ${units === "imperial" ? "lb" : "kg"}`,
});
