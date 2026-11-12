// Feature-engineering views (Task 1): the live feature table, training-row budget and importances.

import type { ModelKey, PipelineResult } from "../engine/types";

export const FEATURE_LABELS: Record<string, string> = {
  units: "Units (target)",
  t: "Trend index t",
  daily_rate: "Units per day",
  lag_1: "Lag 1",
  lag_2: "Lag 2",
  lag_3: "Lag 3",
  rolling_mean_3: "3-month mean",
  days_in_month: "Days in month",
  month_sin: "Month (sin)",
  month_cos: "Month (cos)",
  lag_12: "Lag 12",
};

export interface FeatureTableView {
  columns: string[];
  rows: { month: string; values: (number | null)[]; lostToLags: boolean }[];
  rowsLost: number;
  trainingRows: number;
  testSize: number;
  usableForTreesInTest: number;
}

export function featureTable(result: PipelineResult): FeatureTableView {
  const columns = result.features.columns;
  const lost = result.features.rows_lost_to_lags;
  const rows = result.features.rows.map((r, i) => ({
    month: r.month,
    values: columns.map((c) => (typeof r[c] === "number" ? (r[c] as number) : null)),
    lostToLags: i < lost,
  }));
  return {
    columns,
    rows,
    rowsLost: lost,
    trainingRows: Math.max(rows.length - lost, 0),
    testSize: result.meta.test_size,
    // rows a tree model can learn from when tested on the hold-out window (lag 12 only from 24 months)
    usableForTreesInTest: Math.max(result.meta.n_train - (result.meta.n_train >= 24 ? 12 : 3), 0),
  };
}

export interface ImportanceView {
  key: ModelKey;
  label: string;
  items: { feature: string; label: string; share: number }[];
  trainingRows: number | null;
}

export function importances(result: PipelineResult): ImportanceView[] {
  return (["random_forest", "xgboost"] as ModelKey[])
    .filter((k) => result.models[k].available && result.models[k].importance)
    .map((k) => {
      const imp = result.models[k].importance!;
      return {
        key: k,
        label: result.models[k].label,
        items: Object.entries(imp)
          .map(([feature, share]) => ({ feature, label: FEATURE_LABELS[feature] ?? feature, share }))
          .sort((a, b) => b.share - a.share),
        trainingRows: result.models[k].params?.training_rows ?? null,
      };
    });
}

/** Lag-1 scatter: does last month predict this month? */
export function lagScatter(result: PipelineResult): { x: number; y: number; month: string }[] {
  const s = result.series;
  return s.slice(1).map((r, i) => ({ x: s[i].units, y: r.units, month: r.month }));
}
