// Chart-ready series for "actual vs predicted" and the forecast fan chart.
// Everything is aligned to one month axis: history months, then forecast months.

import type { ModelKey, PipelineResult } from "../engine/types";

export type Point = number | null;

export interface TimeAxis {
  months: string[];
  nHistory: number;
  testStart: number; // index of the first test month
  index: Record<string, number>;
}

export function timeAxis(result: PipelineResult, key?: ModelKey | null): TimeAxis {
  const history = result.series.map((r) => r.month);
  const future = key ? result.models[key].forecast?.months ?? [] : result.models.naive.forecast?.months ?? [];
  const months = [...history, ...future];
  return {
    months,
    nHistory: history.length,
    testStart: history.indexOf(result.meta.test_months[0]),
    index: Object.fromEntries(months.map((m, i) => [m, i])),
  };
}

function place(axis: TimeAxis, months: string[], values: number[]): Point[] {
  const out: Point[] = Array(axis.months.length).fill(null);
  months.forEach((m, i) => {
    const j = axis.index[m];
    if (j !== undefined) out[j] = values[i];
  });
  return out;
}

export interface ActualVsPredicted {
  axis: TimeAxis;
  actual: Point[];
  test: Point[];
  folds: { origin: string; values: Point[] }[];
  forecast: Point[];
  /** Forecast line joined to the last actual so the chart has no gap. */
  forecastJoined: Point[];
  lower80: Point[] | null;
  upper80: Point[] | null;
  lower95: Point[] | null;
  upper95: Point[] | null;
}

export function actualVsPredicted(result: PipelineResult, key: ModelKey): ActualVsPredicted | null {
  const m = result.models[key];
  if (!m.available || !m.forecast || !m.test) return null;
  const axis = timeAxis(result, key);
  const fc = m.forecast;
  const actual = place(axis, result.series.map((r) => r.month), result.series.map((r) => r.units));
  const forecast = place(axis, fc.months, fc.point);
  const joined = [...forecast];
  joined[axis.nHistory - 1] = actual[axis.nHistory - 1];
  const band = (v: number[] | null) => (v ? place(axis, fc.months, v) : null);
  return {
    axis,
    actual,
    test: place(axis, m.test.months, m.test.forecast),
    folds: (m.backtest?.folds ?? []).map((f) => ({ origin: f.origin, values: place(axis, f.months, f.forecast) })),
    forecast,
    forecastJoined: joined,
    lower80: band(fc.lower80),
    upper80: band(fc.upper80),
    lower95: band(fc.lower95),
    upper95: band(fc.upper95),
  };
}

export interface ForecastRow {
  month: string;
  point: number;
  lower80: number | null;
  upper80: number | null;
  lower95: number | null;
  upper95: number | null;
}

export function forecastRows(result: PipelineResult, key: ModelKey): ForecastRow[] {
  const fc = result.models[key].forecast;
  if (!fc) return [];
  return fc.months.map((month, i) => ({
    month,
    point: fc.point[i],
    lower80: fc.lower80?.[i] ?? null,
    upper80: fc.upper80?.[i] ?? null,
    lower95: fc.lower95?.[i] ?? null,
    upper95: fc.upper95?.[i] ?? null,
  }));
}

/** Every available model's test-window forecast on one axis (for the comparison overlay). */
export function testOverlay(result: PipelineResult): { axis: TimeAxis; actual: Point[]; models: { key: ModelKey; values: Point[] }[] } {
  const axis = timeAxis(result);
  const actual = place(axis, result.series.map((r) => r.month), result.series.map((r) => r.units));
  const models = (Object.keys(result.models) as ModelKey[])
    .filter((k) => result.models[k].available && result.models[k].test)
    .map((k) => {
      const t = result.models[k].test!;
      const values = place(axis, t.months, t.forecast);
      // join to the last training actual so each test line starts from known data
      values[axis.testStart - 1] = actual[axis.testStart - 1];
      return { key: k, values };
    });
  return { axis, actual, models };
}
