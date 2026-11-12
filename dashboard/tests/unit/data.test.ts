import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ALL, daysInMonth, type MonthlyCube, nextMonth, regionalUnits, sliceSeries } from "../../src/data/cube";
import { buildRequest, initialScenario, maxTestSize, nextEntryMonth, validateUnits } from "../../src/data/scenario";
import type { PipelineResult } from "../../src/engine/types";
import { hashJson } from "../../src/lib/hash";
import { useDashboard } from "../../src/state/store";

const DATA = join(__dirname, "..", "..", "public", "data");
const cube = JSON.parse(readFileSync(join(DATA, "monthly_water.json"), "utf8")) as MonthlyCube;
const fixtures = JSON.parse(readFileSync(join(DATA, "parity_fixtures.json"), "utf8"));
const defaultResult = JSON.parse(readFileSync(join(DATA, "snapshot_default.json"), "utf8")) as PipelineResult;
const VT = { product: "Volvic Touch", region: ALL, customerType: ALL };

describe("data cube", () => {
  it("has the expected shape", () => {
    expect(cube.months).toHaveLength(36);
    expect(cube.products).toHaveLength(9);
    expect(cube.regions).toHaveLength(16);
    expect(cube.days.at(-1)).toBe(30); // Dec 2023 is a partial month
  });

  it("aggregates to exactly the notebook's launch-year series", () => {
    const series = sliceSeries(cube, VT).slice(0, 12);
    const expected = fixtures.launch_default.input.records as { month: string; units: number; revenue: number }[];
    expect(series.map((r) => r.units)).toEqual(expected.map((r) => r.units));
    series.forEach((r, i) => expect(Math.abs((r.revenue ?? 0) - expected[i].revenue)).toBeLessThan(0.5));
  });

  it("regional and customer-type slices add up to the total", () => {
    const total = sliceSeries(cube, VT).map((r) => r.units);
    const regions = regionalUnits(cube, VT, 36);
    const summed = total.map((_, m) => Object.values(regions).reduce((s, v) => s + v[m], 0));
    expect(summed).toEqual(total);
    const b2b = sliceSeries(cube, { ...VT, customerType: "B2B" }).map((r) => r.units);
    const b2c = sliceSeries(cube, { ...VT, customerType: "B2C" }).map((r) => r.units);
    expect(b2b.map((v, i) => v + b2c[i])).toEqual(total);
  });

  it("matches the notebook's Bayern B2C slice", () => {
    const s = sliceSeries(cube, { product: "Volvic Touch", region: "Bayern", customerType: "B2C" }).slice(0, 24);
    expect(s.map((r) => r.units)).toEqual(fixtures.bayern_b2c_24.input.records.map((r: { units: number }) => r.units));
  });

  it("calendar helpers", () => {
    expect(daysInMonth("2024-02")).toBe(29);
    expect(daysInMonth("2023-02")).toBe(28);
    expect(nextMonth("2023-12")).toBe("2024-01");
  });
});

describe("engine request", () => {
  it("default request reproduces the notebook's launch-year scenario", () => {
    const req = buildRequest(cube, initialScenario());
    expect(req.records).toHaveLength(12);
    expect(req.test_size).toBe(3);
    expect(req.horizon).toBe(3);
    expect(req.context).toEqual({ ...defaultResult.context, notes: [] });
    expect(Object.keys(req.regional ?? {})).toHaveLength(16);
  });

  it("caps the test window so at least 6 months remain for training", () => {
    expect(maxTestSize(12)).toBe(6);
    expect(maxTestSize(36)).toBe(12);
    const req = buildRequest(cube, { ...initialScenario(), testSize: 12 });
    expect(req.test_size).toBe(6);
  });

  it("corrections drop revenue for that month and are noted", () => {
    const req = buildRequest(cube, { ...initialScenario(), overrides: { "2021-06": 150000 } });
    const june = req.records.find((r) => r.month === "2021-06")!;
    expect(june.units).toBe(150000);
    expect(june.revenue).toBeNull();
    expect(req.context.notes.join(" ")).toMatch(/entered or corrected by the user/);
  });

  it("no regional allocation for a single-region view", () => {
    expect(buildRequest(cube, { ...initialScenario(), filters: { ...VT, region: "Berlin" } }).regional).toBeNull();
  });

  it("user-entered sales are validated", () => {
    expect(validateUnits(-5, [100])).toMatch(/negative/);
    expect(validateUnits(1.5, [100])).toMatch(/whole/);
    expect(validateUnits(5000, [100])).toMatch(/10 times/);
    expect(validateUnits(150, [100])).toBeNull();
  });
});

describe("live data feed (store)", () => {
  beforeEach(() => {
    useDashboard.setState({ cube, scenario: initialScenario(), forecastLog: [], changeLog: [] });
    useDashboard.getState().setResult(defaultResult, hashJson(buildRequest(cube, initialScenario())), null);
  });

  it("releasing the next month bumps the data version and scores the earlier forecast", () => {
    useDashboard.getState().advanceFeed();
    const s = useDashboard.getState();
    expect(s.scenario.feedIndex).toBe(12);
    expect(s.scenario.dataVersion).toBe(2);
    expect(s.scenario.lastChange).toBe("New actual received: 2022-01 = 166,182 units");
    expect(s.forecastLog).toHaveLength(1);
    expect(s.forecastLog[0]).toMatchObject({ month: "2022-01", actual: 166182, model: "Calendar-adjusted Naive" });
    expect(buildRequest(cube, s.scenario).context.last_change).toBe(s.scenario.lastChange);
  });

  it("user months can only be appended after the last dataset month", () => {
    const st = useDashboard.getState();
    expect(nextEntryMonth(cube, st.scenario)).toBe("2022-01");
    st.setFeedIndex(35);
    st.addCustomMonth(150000);
    st.addCustomMonth(140000);
    const s = useDashboard.getState().scenario;
    expect(s.customMonths.map((c) => c.month)).toEqual(["2024-01", "2024-02"]);
    const req = buildRequest(cube, s);
    expect(req.records.at(-1)).toMatchObject({ month: "2024-02", units: 140000, days: 29 });
    useDashboard.getState().advanceFeed(); // blocked while user months exist
    expect(useDashboard.getState().scenario.feedIndex).toBe(35);
    useDashboard.getState().removeLastCustomMonth();
    expect(useDashboard.getState().scenario.customMonths).toHaveLength(1);
  });

  it("reset returns to the launch year and clears user data", () => {
    const st = useDashboard.getState();
    st.advanceFeed();
    st.setOverride("2021-03", 1);
    st.resetData();
    const s = useDashboard.getState().scenario;
    expect(s.feedIndex).toBe(11);
    expect(s.overrides).toEqual({});
    expect(s.lastChange).toBe("Data reset to the launch year");
  });
});
