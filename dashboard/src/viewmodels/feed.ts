// Live data feed scoring: how accurate were the forecasts made before each month arrived?

import { evaluate, type MetricResult } from "../lib/metrics";
import type { ForecastLogEntry } from "../state/store";

export interface FeedLogView {
  rows: (ForecastLogEntry & { errorPct: number; insideRange: boolean | null })[];
  summary: MetricResult | null;
  coverage: { inside: number; total: number } | null;
}

export function feedLogView(log: ForecastLogEntry[]): FeedLogView {
  const rows = log.map((e) => ({
    ...e,
    errorPct: e.actual ? ((e.forecast - e.actual) / e.actual) * 100 : 0,
    insideRange: e.lower95 == null || e.upper95 == null ? null : e.actual >= e.lower95 && e.actual <= e.upper95,
  }));
  const ranged = rows.filter((r) => r.insideRange !== null);
  return {
    rows,
    summary: log.length ? evaluate(log.map((e) => e.actual), log.map((e) => e.forecast)) : null,
    coverage: ranged.length ? { inside: ranged.filter((r) => r.insideRange).length, total: ranged.length } : null,
  };
}
