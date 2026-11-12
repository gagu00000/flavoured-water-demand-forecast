// Trend, seasonality, calendar-effect and autocorrelation views (Task 7a evidence).

import type { PipelineResult } from "../engine/types";

const ALPHA = 0.05;

export interface TrendView {
  months: string[];
  dailyRate: number[];
  fitted: number[] | null;
  pctPerYear: number | null;
  pValue: number | null;
  significant: boolean | null;
  revenuePctPerYear: number | null;
  revenuePValue: number | null;
  verdict: string;
}

export function trendView(result: PipelineResult): TrendView {
  const t = result.analysis.trend_units_per_day;
  const rv = result.analysis.revenue_trend;
  const verdict =
    t.p_value == null
      ? "Too few months to test for a trend."
      : t.significant
        ? `Significant volume trend: ${t.pct_per_year! > 0 ? "rising" : "falling"} about ${Math.abs(t.pct_per_year!).toFixed(2)}% a year.`
        : "No significant volume trend: sales per day are stable.";
  return {
    months: result.series.map((r) => r.month),
    dailyRate: result.series.map((r) => r.units / (r.days ?? 30)),
    fitted: t.fitted,
    pctPerYear: t.pct_per_year,
    pValue: t.p_value,
    significant: t.significant,
    revenuePctPerYear: rv?.pct_per_year ?? null,
    revenuePValue: rv?.p_value ?? null,
    verdict,
  };
}

export interface SeasonalityView {
  months: string[]; // Jan..Dec
  index: (number | null)[];
  sd: (number | null)[];
  n: number[];
  pValue: number | null;
  testable: boolean;
  peakTroughPct: number | null;
  verdict: string;
}

export function seasonalityView(result: PipelineResult): SeasonalityView {
  const s = result.analysis.seasonality;
  const testable = s.p_value != null;
  const verdict = !testable
    ? "Seasonality cannot be tested yet: each calendar month has been seen only once (needs 24+ months)."
    : s.significant
      ? "Significant month-of-year pattern."
      : "No significant seasonality: month-to-month differences are within the noise.";
  return {
    months: s.index.map((r) => r.month),
    index: s.index.map((r) => r.index),
    sd: s.index.map((r) => r.sd),
    n: s.index.map((r) => r.n),
    pValue: s.p_value,
    testable,
    peakTroughPct: s.peak_trough_pct,
    verdict,
  };
}

export interface CalendarView {
  points: { month: string; days: number; units: number }[];
  r2: number | null;
  unitsPerDay: number;
}

export function calendarView(result: PipelineResult): CalendarView {
  return {
    points: result.series.map((r) => ({ month: r.month, days: r.days ?? 30, units: r.units })),
    r2: result.analysis.calendar.r2,
    unitsPerDay: result.analysis.calendar.units_per_day,
  };
}

export interface AcfView {
  lags: number[];
  values: number[];
  bound: number | null;
  outside: number[]; // lags outside the noise band
}

export function acfView(result: PipelineResult): AcfView {
  const a = result.analysis.acf;
  return {
    lags: a.lags,
    values: a.acf,
    bound: a.bound,
    outside: a.bound == null ? [] : a.lags.filter((_, i) => Math.abs(a.acf[i]) > a.bound!),
  };
}

export function isSignificant(p: number | null): boolean | null {
  return p == null ? null : p < ALPHA;
}
