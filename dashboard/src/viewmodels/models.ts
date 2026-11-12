// Model identity (colour, labels) and the metric-comparison / KPI view models.

import type { ModelKey, PipelineResult } from "../engine/types";
import { MODEL_KEYS } from "../engine/types";

/**
 * One fixed colour per model, used in every chart. Same hue order as the notebook,
 * stepped for the dark surface; validated colour-blind safe (adjacent CVD ΔE >= 8.4)
 * with >= 3:1 contrast on the navy chart surface.
 */
export const MODEL_COLORS: Record<ModelKey, string> = {
  naive: "#3987e5",
  seasonal_naive: "#d95926",
  calendar_naive: "#199e70",
  arima: "#c98500",
  random_forest: "#d55181",
  xgboost: "#008300",
};

export const ACTUAL_COLOR = "#e6f1f5";

export const INTERVAL_LABEL: Record<string, string> = {
  analytic: "Analytic range (spread of past changes)",
  native: "Native ARIMA prediction interval",
  empirical: "Approximate range from backtest errors",
  none: "No range available",
};

export const CALENDAR_USE: Record<ModelKey, boolean> = {
  naive: false,
  seasonal_naive: false,
  calendar_naive: true,
  arima: true,
  random_forest: true,
  xgboost: true,
};

export interface MetricRow {
  key: ModelKey;
  label: string;
  color: string;
  available: boolean;
  reason: string;
  testMape: number | null;
  testWape: number | null;
  testBias: number | null;
  btMape: number | null;
  btWape: number | null;
  /** WAPE on the ranking basis (backtest when >= 3 origins, otherwise test). */
  score: number | null;
  rank: number | null;
  isBest: boolean;
  isRecommended: boolean;
  usesCalendar: boolean;
  mapeExcluded: number;
}

export function rankingUsesBacktest(result: PipelineResult): boolean {
  return result.meta.ranking_basis.startsWith("backtest");
}

/** One row per model, in fixed model order (colour follows the model, never its rank). */
export function metricRows(result: PipelineResult): MetricRow[] {
  const useBt = rankingUsesBacktest(result);
  return MODEL_KEYS.map((key) => {
    const m = result.models[key];
    const bt = m.backtest?.metrics ?? null;
    const rankIdx = result.ranking.indexOf(key);
    return {
      key,
      label: m.label,
      color: MODEL_COLORS[key],
      available: m.available,
      reason: m.reason,
      testMape: m.metrics_test?.mape ?? null,
      testWape: m.metrics_test?.wape ?? null,
      testBias: m.metrics_test?.bias ?? null,
      btMape: bt?.mape ?? null,
      btWape: bt?.wape ?? null,
      score: m.available ? (useBt ? bt?.wape ?? null : m.metrics_test?.wape ?? null) : null,
      rank: rankIdx >= 0 ? rankIdx + 1 : null,
      isBest: key === result.best_model,
      isRecommended: key === result.recommended_model,
      usesCalendar: CALENDAR_USE[key],
      mapeExcluded: m.metrics_test?.mape_excluded ?? 0,
    };
  });
}

export interface Kpis {
  recommendedKey: ModelKey | null;
  recommendedLabel: string;
  bestLabel: string;
  sameAsBest: boolean;
  score: number | null;
  naiveScore: number | null;
  basis: string;
  forecastTotal: number | null;
  forecastMonths: string[];
  forecastPoints: number[];
  firstMonthRange: [number, number] | null;
  dataThrough: string;
  nMonths: number;
}

export function kpis(result: PipelineResult): Kpis {
  const rows = metricRows(result);
  const rec = result.recommended_model;
  const recRow = rows.find((r) => r.key === rec);
  const best = rows.find((r) => r.key === result.best_model);
  const fc = rec ? result.models[rec].forecast : undefined;
  return {
    recommendedKey: rec,
    recommendedLabel: recRow?.label ?? "–",
    bestLabel: best?.label ?? "–",
    sameAsBest: rec === result.best_model,
    score: recRow?.score ?? null,
    naiveScore: rows.find((r) => r.key === "naive")?.score ?? null,
    basis: result.meta.ranking_basis,
    forecastTotal: fc ? fc.point.reduce((a, b) => a + b, 0) : null,
    forecastMonths: fc?.months ?? [],
    forecastPoints: fc?.point ?? [],
    firstMonthRange: fc?.lower95 && fc.upper95 ? [fc.lower95[0], fc.upper95[0]] : null,
    dataThrough: result.meta.last_month,
    nMonths: result.meta.n_months,
  };
}
