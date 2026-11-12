import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL, type MonthlyCube } from "../../src/data/cube";
import { MODEL_KEYS, type ModelResult, type PipelineResult } from "../../src/engine/types";
import { fmtP, fmtPct, fmtUnits, monthLabel } from "../../src/lib/format";
import { evaluate } from "../../src/lib/metrics";
import { acfView, calendarView, seasonalityView, trendView } from "../../src/viewmodels/analysis";
import { feedLogView } from "../../src/viewmodels/feed";
import { featureTable, importances, lagScatter } from "../../src/viewmodels/features";
import { kpis, metricRows } from "../../src/viewmodels/models";
import { allocationRows, regionHeatmap } from "../../src/viewmodels/regions";
import { actualVsPredicted, forecastRows, testOverlay } from "../../src/viewmodels/series";

const DATA = join(__dirname, "..", "..", "public", "data");
const read = <T>(f: string) => JSON.parse(readFileSync(join(DATA, f), "utf8")) as T;
const launch = read<PipelineResult>("snapshot_default.json");
const cube = read<MonthlyCube>("monthly_water.json");
const fixtures = read<Record<string, { expected: { models: Record<string, ModelResult> } }>>("parity_fixtures.json");

const close = (a: number | null, b: number | null) => {
  if (a === null || b === null) return expect(a).toBe(b);
  expect(Math.abs(a - b)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(b)));
};

describe("TypeScript metrics", () => {
  it("match the hand calculation", () => {
    const m = evaluate([167105, 158642, 160396], [158666, 158666, 158666]);
    expect(m.mape).toBeCloseTo(2.0479, 4);
    expect(m.wape).toBeCloseTo(2.0967, 4);
  });

  it("handle zero actuals exactly like the Python engine", () => {
    const m = evaluate([100, 0, 200], [110, 5, 180]);
    expect(m.mapeExcluded).toBe(1);
    expect(m.mape).toBeCloseTo(10, 12);
    expect(evaluate([0, 0], [1, 1]).mape).toBeNull();
    expect(evaluate([0, 0], [1, 1]).wape).toBeNull();
  });

  // Independent cross-check: recompute every metric the engine reported, for every scenario
  const scenarios: [string, Record<string, ModelResult>][] = [
    ["default snapshot", launch.models as unknown as Record<string, ModelResult>],
    ...Object.entries(fixtures).map(([k, v]) => [k, v.expected.models] as [string, Record<string, ModelResult>]),
  ];
  for (const [name, models] of scenarios) {
    it(`reproduce every engine metric: ${name}`, () => {
      for (const m of Object.values(models)) {
        if (!m.available) continue;
        const t = evaluate(m.test!.actual, m.test!.forecast);
        close(t.mape, m.metrics_test!.mape);
        close(t.wape, m.metrics_test!.wape);
        close(t.bias, m.metrics_test!.bias);
        const folds = m.backtest!.folds;
        const bt = evaluate(folds.flatMap((f) => f.actual), folds.flatMap((f) => f.forecast));
        close(bt.wape, m.backtest!.metrics!.wape);
        close(bt.mape, m.backtest!.metrics!.mape);
      }
    });
  }
});

describe("model views", () => {
  it("metric rows keep model order and flag best/recommended", () => {
    const rows = metricRows(launch);
    expect(rows.map((r) => r.key)).toEqual(MODEL_KEYS);
    expect(rows.find((r) => r.isBest)?.key).toBe("random_forest");
    expect(rows.find((r) => r.isRecommended)?.key).toBe("calendar_naive");
    expect(rows.find((r) => r.key === "seasonal_naive")).toMatchObject({ available: false, score: null, rank: null });
    expect(rows.find((r) => r.key === "random_forest")?.score).toBeCloseTo(1.78, 2);
  });

  it("KPIs describe the recommended forecast", () => {
    const k = kpis(launch);
    expect(k.recommendedLabel).toBe("Calendar-adjusted Naive");
    expect(k.sameAsBest).toBe(false);
    expect(k.forecastMonths).toEqual(["2022-01", "2022-02", "2022-03"]);
    expect(Math.round(k.forecastTotal!)).toBe(465666);
    expect(k.dataThrough).toBe("2021-12");
  });
});

describe("series views", () => {
  it("actual vs predicted aligns history, test window and forecast", () => {
    const v = actualVsPredicted(launch, "calendar_naive")!;
    expect(v.axis.months).toHaveLength(15);
    expect(v.axis.testStart).toBe(9);
    expect(v.actual.slice(0, 12).every((x) => x !== null)).toBe(true);
    expect(v.actual[12]).toBeNull();
    expect(v.test.filter((x) => x !== null)).toHaveLength(3);
    expect(v.forecast.slice(12).every((x) => x !== null)).toBe(true);
    expect(v.forecastJoined[11]).toBe(v.actual[11]);
    expect(v.folds).toHaveLength(3);
    expect(v.lower95![13]!).toBeLessThan(v.forecast[13]!);
  });

  it("disabled models have no series", () => {
    expect(actualVsPredicted(launch, "seasonal_naive")).toBeNull();
  });

  it("forecast rows and test overlay", () => {
    expect(forecastRows(launch, "arima")).toHaveLength(3);
    const o = testOverlay(launch);
    expect(o.models.map((m) => m.key)).not.toContain("seasonal_naive");
    expect(o.models[0].values[8]).toBe(o.actual[8]); // joined to the last training month
  });
});

describe("analysis views", () => {
  it("launch year: no trend, seasonality not yet testable", () => {
    expect(trendView(launch).verdict).toMatch(/No significant volume trend/);
    const s = seasonalityView(launch);
    expect(s.testable).toBe(false);
    expect(s.verdict).toMatch(/cannot be tested yet/);
    expect(calendarView(launch).r2).toBeCloseTo(0.76, 2);
    const a = acfView(launch);
    expect(a.lags.length).toBe(a.values.length);
  });
});

describe("feature views", () => {
  it("marks the rows lost to lags and the training budget", () => {
    const f = featureTable(launch);
    expect(f.rowsLost).toBe(3);
    expect(f.rows.filter((r) => r.lostToLags)).toHaveLength(3);
    expect(f.usableForTreesInTest).toBe(6);
    expect(lagScatter(launch)).toHaveLength(11);
    const imp = importances(launch);
    expect(imp.map((i) => i.key)).toEqual(["random_forest", "xgboost"]);
    expect(imp[0].items.reduce((s, i) => s + i.share, 0)).toBeCloseTo(1, 6);
  });
});

describe("regional views", () => {
  it("heatmap covers released months and shares sum to 1", () => {
    const h = regionHeatmap(cube, { product: "Volvic Touch", region: ALL, customerType: ALL }, 12);
    expect(h.months).toHaveLength(12);
    expect(h.cells).toHaveLength(16 * 12);
    expect(h.shares.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1, 9);
    expect(h.shares[0].share).toBeGreaterThanOrEqual(h.shares[15].share);
  });

  it("allocation splits the recommended forecast", () => {
    const a = allocationRows(launch)!;
    const total = a.rows.reduce((s, r) => s + r.total, 0);
    const fc = launch.models.calendar_naive.forecast!.point.reduce((x, y) => x + y, 0);
    expect(total).toBeCloseTo(fc, 3);
  });
});

describe("feed log and formatting", () => {
  it("scores live forecasts", () => {
    const v = feedLogView([
      { month: "2022-01", model: "M", forecast: 160396, lower95: 152520, upper95: 168272, actual: 166182 },
      { month: "2022-02", model: "M", forecast: 144874, lower95: 134814, upper95: 154934, actual: 150224 },
    ]);
    expect(v.coverage).toEqual({ inside: 2, total: 2 });
    expect(v.summary!.wape).toBeCloseTo(((166182 - 160396) + (150224 - 144874)) / (166182 + 150224) * 100, 9);
    expect(v.rows[0].errorPct).toBeLessThan(0);
  });

  it("formats numbers for display", () => {
    expect(fmtUnits(465666.4)).toBe("465,666");
    expect(fmtPct(2.0967)).toBe("2.10%");
    expect(fmtP(0.0001)).toBe("p < 0.001");
    expect(fmtP(0.2123)).toBe("p = 0.212");
    expect(monthLabel("2022-02")).toBe("Feb 2022");
  });
});
