// Parity: the dashboard's in-browser engine (Pyodide, same package versions as the
// notebook) must reproduce the notebook's results for several configurations.
//
// Tolerance policy
//   * every model except ARIMA: exact (relative difference <= 1e-9)
//   * ARIMA: its maximum-likelihood optimiser runs on different floating-point
//     libraries in WebAssembly, so metrics may differ by <= 0.01 percentage
//     points and unit forecasts by <= 0.1%. Ranking, best and recommended model
//     and all non-numeric fields must be identical.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadPyodide, type PyodideInterface } from "pyodide";
import { beforeAll, describe, expect, it } from "vitest";
import { installCore, PY_PACKAGES, runRequest } from "../../src/engine/python";
import type { EngineRequest } from "../../src/engine/types";

const DASHBOARD = join(__dirname, "..", "..");
const CORE = join(DASHBOARD, "..", "forecasting_core");
const FILES = ["__init__.py", "series.py", "metrics.py", "features.py", "models.py", "backtest.py", "analysis.py",
  "pipeline.py", "fallback.py", "grounding.py"];

type Fixture = { input: { records: EngineRequest["records"]; test_size: number; horizon: number }; expected: Record<string, unknown> };
const fixtures = JSON.parse(readFileSync(join(DASHBOARD, "public", "data", "parity_fixtures.json"), "utf8")) as Record<string, Fixture>;

let py: PyodideInterface;

beforeAll(async () => {
  py = await loadPyodide();
  await py.loadPackage(PY_PACKAGES, { messageCallback: () => {}, errorCallback: () => {} });
  await installCore(py, FILES.map((name) => ({ name, content: readFileSync(join(CORE, name), "utf8") })));
});

function compare(actual: unknown, expected: unknown, path: string, problems: string[]) {
  if (typeof expected === "number" && typeof actual === "number") {
    const isArima = path.includes(".models.arima.");
    const isPctMetric = /\.(mape|wape|bias)$/.test(path);
    const diff = Math.abs(actual - expected);
    const rel = diff / Math.max(Math.abs(expected), 1e-12);
    const ok = !isArima ? rel <= 1e-9 || diff <= 1e-12 : isPctMetric ? diff <= 0.01 : rel <= 1e-3 || diff <= 1e-6;
    if (!ok) problems.push(`${path}: ${actual} vs ${expected}`);
  } else if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) problems.push(`${path}: array length differs`);
    else expected.forEach((e, i) => compare(actual[i], e, `${path}[${i}]`, problems));
  } else if (expected && typeof expected === "object") {
    const a = actual as Record<string, unknown>;
    const keys = new Set([...Object.keys(expected), ...Object.keys(a ?? {})]);
    for (const k of keys) compare(a?.[k], (expected as Record<string, unknown>)[k], `${path}.${k}`, problems);
  } else if (actual !== expected) {
    problems.push(`${path}: ${JSON.stringify(actual)} vs ${JSON.stringify(expected)}`);
  }
}

describe("browser engine reproduces the notebook", () => {
  for (const [name, fx] of Object.entries(fixtures)) {
    it(name, async () => {
      const response = await runRequest(py, {
        records: fx.input.records,
        test_size: fx.input.test_size,
        horizon: fx.input.horizon,
        context: { product: "", region: "", customer_type: "", view: "", unit: "units", data_version: 1, notes: [] },
      });
      expect(response.ok).toBe(true);
      if (!response.ok) return;
      const problems: string[] = [];
      const result = response.result as unknown as Record<string, unknown>;
      for (const key of Object.keys(fx.expected)) compare(result[key], fx.expected[key], `.${key}`, problems);
      expect(problems).toEqual([]);
      // Must stay fast enough to feel interactive in the browser
      expect(response.ms).toBeLessThan(10_000);
    });
  }

  it("returns a friendly error instead of crashing on too little data", async () => {
    const response = await runRequest(py, {
      records: fixtures.launch_default.input.records.slice(0, 4),
      test_size: 3,
      horizon: 3,
      context: { product: "", region: "", customer_type: "", view: "", unit: "units", data_version: 1, notes: [] },
    });
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error).toMatch(/Need at least/);
  });
});
