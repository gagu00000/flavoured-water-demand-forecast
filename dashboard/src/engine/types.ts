// Types mirroring the JSON produced by forecasting_core.run_pipeline (Python).

export type ModelKey = "naive" | "seasonal_naive" | "calendar_naive" | "arima" | "random_forest" | "xgboost";

export const MODEL_KEYS: ModelKey[] = ["naive", "seasonal_naive", "calendar_naive", "arima", "random_forest", "xgboost"];

export interface SeriesRecord {
  month: string; // YYYY-MM
  units: number;
  days?: number;
  revenue?: number | null;
}

export interface EngineContext {
  product: string;
  region: string;
  customer_type: string;
  view: string;
  unit: string;
  data_version: number;
  last_change?: string;
  notes: string[];
}

export interface EngineRequest {
  records: SeriesRecord[];
  test_size: number;
  horizon: number;
  context: EngineContext;
  regional?: Record<string, number[]> | null;
}

export interface Metrics {
  mape: number | null;
  wape: number | null;
  bias: number | null;
  mape_excluded: number;
  n: number;
}

export interface Forecast {
  months: string[];
  point: number[];
  lower80: number[] | null;
  upper80: number[] | null;
  lower95: number[] | null;
  upper95: number[] | null;
}

export interface BacktestFold {
  origin: string;
  months: string[];
  actual: number[];
  forecast: number[];
}

export interface ModelResult {
  key: ModelKey;
  label: string;
  family: string;
  description: string;
  interval_type: "analytic" | "native" | "empirical" | "none";
  available: boolean;
  reason: string;
  test?: { months: string[]; actual: number[]; forecast: number[] };
  metrics_test?: Metrics;
  forecast?: Forecast;
  params?: { order?: number[]; aicc?: number; order_selection?: string; training_rows?: number; features?: string[] };
  importance?: Record<string, number> | null;
  backtest?: { metrics: Metrics | null; folds: BacktestFold[] };
}

export interface TrendTest {
  slope_per_month: number | null;
  pct_per_year: number | null;
  p_value: number | null;
  r2: number | null;
  significant: boolean | null;
  fitted: number[] | null;
}

export interface Analysis {
  trend_units_per_day: TrendTest;
  seasonality: {
    index: { month: string; index: number | null; n: number; sd: number | null }[];
    f_stat: number | null;
    p_value: number | null;
    significant: boolean | null;
    peak_trough_pct: number | null;
    reason: string;
  };
  calendar: { r2: number | null; corr: number | null; units_per_day: number };
  acf: { lags: number[]; acf: number[]; bound: number | null };
  volatility: { cv_units_pct: number | null; cv_daily_rate_pct: number | null; mean_units: number; min_units: number; max_units: number };
  revenue_trend: TrendTest | null;
}

export interface FeatureRow {
  month: string;
  [column: string]: number | string | null;
}

export interface Interpretation {
  seasonality_trend: string;
  best_model: string;
  recommendations: string[];
  limitations: string[];
  confidence: "low" | "medium" | "high";
  source: "llm" | "rule-based";
}

export interface RegionalAllocation {
  basis_months: number;
  months: string[];
  regions: { region: string; share: number; units: number[] }[];
}

export interface PipelineResult {
  meta: {
    core_version: string;
    n_months: number;
    first_month: string;
    last_month: string;
    test_size: number;
    horizon: number;
    train_months: [string, string];
    test_months: [string, string];
    n_train: number;
    backtest_origins: string[];
    ranking_basis: string;
  };
  context: Partial<EngineContext>;
  series: SeriesRecord[];
  features: {
    columns: string[];
    rows: FeatureRow[];
    availability: { feature: string; available: boolean; note: string }[];
    rows_lost_to_lags: number;
  };
  analysis: Analysis;
  models: Record<ModelKey, ModelResult>;
  ranking: ModelKey[];
  best_model: ModelKey | null;
  recommended_model: ModelKey | null;
  regional_allocation: RegionalAllocation | null;
  snapshot: Record<string, unknown>;
  fallback: Interpretation;
}

export type EngineResponse =
  | { ok: true; result: PipelineResult; ms: number }
  | { ok: false; error: string; ms: number };

export type EngineStatus = "idle" | "loading" | "ready" | "error";

export interface EngineProgress {
  status: EngineStatus;
  step: string;
  pct: number;
  error?: string;
}
