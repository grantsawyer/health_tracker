import type { DailySummary } from "../../shared/summary";
import type { UnitSystem } from "../units";
import { typicalRange } from "./baseline";
import { S, type ViewCtx } from "./ctx";

/**
 * Recovery vitals (S1): Google's overnight daily summaries. One definition per vital drives both the Body tab's
 * charts and the Today cards, so labels, units and formatting stay in step. Every vital is compared with the
 * owner's own last 30 days (mean ± 1 SD, baseline.ts), never population norms.
 */
export type VitalId = "hrv" | "spo2" | "breathingRate" | "skinTemp" | "vo2Max";

export interface VitalDef {
  id: VitalId;
  label: string;
  /** Short unit after the value ("ms", "%", …). */
  unit: (units: UnitSystem) => string;
  color: string;
  tone: "heart" | "body";
  /** The plotted value for a day (already in display units). Some need the context (skin temperature's baseline). */
  pick: (ctx: Pick<ViewCtx, "units" | "data" | "baseline">) => (d: DailySummary) => number | undefined;
  format: (v: number, units: UnitSystem) => string;
  /** Shorter label for chart points when the full unit is long (the headline and table keep `format`). */
  compact?: (v: number) => string;
  /** One line under the chart title saying what the number is. */
  about: string;
}

const nf = (digits: number) => new Intl.NumberFormat(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Mean nightly skin temperature over everything loaded (the fallback baseline when Google sends none). */
function ownSkinBaseline(ctx: Pick<ViewCtx, "data" | "baseline">): number | undefined {
  return typicalRange([...(ctx.baseline?.days ?? []), ...ctx.data.days].map((d) => d.skinTempC), 3)?.mean;
}

export const VITALS: VitalDef[] = [
  {
    id: "hrv", label: "Heart rate variability", unit: () => "ms", color: S.heart, tone: "heart",
    pick: () => (d) => d.hrvMs,
    format: (v) => `${nf(0).format(v)} ms`,
    about: "Average variation between heartbeats overnight. Higher than usual often means better recovery.",
  },
  {
    id: "spo2", label: "Oxygen saturation (SpO2)", unit: () => "%", color: S.heart, tone: "heart",
    pick: () => (d) => d.spo2Pct,
    format: (v) => `${nf(1).format(v)}%`,
    about: "Average blood oxygen while asleep.",
  },
  {
    id: "breathingRate", label: "Breathing rate", unit: () => "breaths/min", color: S.heart, tone: "heart",
    pick: () => (d) => d.breathingRate,
    format: (v) => `${nf(1).format(v)} breaths/min`,
    compact: (v) => nf(1).format(v),
    about: "Average breaths per minute while asleep.",
  },
  {
    id: "skinTemp", label: "Skin temperature", unit: (u) => (u === "imperial" ? "°F" : "°C"), color: S.body, tone: "body",
    // Shown as the night's variation from baseline (as Fitbit does): Google's personal baseline when sent, else
    // the mean of the nights loaded here.
    pick: (ctx) => {
      const own = ownSkinBaseline(ctx);
      const k = ctx.units === "imperial" ? 1.8 : 1;
      return (d) => {
        const base = d.skinTempBaselineC ?? own;
        return d.skinTempC !== undefined && base !== undefined ? (d.skinTempC - base) * k : undefined;
      };
    },
    format: (v, u) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${nf(1).format(Math.abs(v))} ${u === "imperial" ? "°F" : "°C"}`,
    about: "Variation from your baseline skin temperature overnight.",
  },
  {
    id: "vo2Max", label: "Cardio fitness (VO2 max)", unit: () => "mL/kg/min", color: S.heart, tone: "heart",
    pick: () => (d) => d.vo2Max,
    format: (v) => `${nf(1).format(v)} mL/kg/min`,
    compact: (v) => nf(1).format(v),
    about: "Estimated maximum oxygen use during exercise.",
  },
];

export const vitalById = (id: VitalId) => VITALS.find((v) => v.id === id)!;

/** Google's cardio fitness level for display ("VERY_GOOD" → "Very good"). */
export const fitnessLevel = (level: string | undefined) =>
  level ? level.charAt(0) + level.slice(1).toLowerCase().replace(/_/g, " ") : undefined;
