// Global dashboard state (Zustand): the data scenario, the engine's status and
// latest results, and the live data feed's forecast-vs-actual log.

import { create } from "zustand";
import { type Filters, formatMonth, type MonthlyCube } from "../data/cube";
import {
  buildSeries,
  initialScenario,
  LAUNCH_YEAR_END,
  MAX_HORIZON,
  MIN_HORIZON,
  MIN_TEST,
  nextEntryMonth,
  type ScenarioState,
} from "../data/scenario";
import type { EngineProgress, PipelineResult } from "../engine/types";

export interface ChangeLogEntry {
  version: number;
  at: string; // ISO time
  text: string;
}

/** A forecast made before a month's actual sales arrived, scored once they do. */
export interface ForecastLogEntry {
  month: string;
  model: string;
  forecast: number;
  lower95: number | null;
  upper95: number | null;
  actual: number;
}

interface DashboardState {
  cube: MonthlyCube | null;
  cubeError: string | null;
  scenario: ScenarioState;
  changeLog: ChangeLogEntry[];
  forecastLog: ForecastLogEntry[];

  engine: EngineProgress;
  result: PipelineResult | null;
  resultHash: string | null;
  running: boolean;
  runError: string | null;
  lastRunMs: number | null;

  setCube: (cube: MonthlyCube) => void;
  setCubeError: (message: string) => void;
  setEngine: (p: EngineProgress) => void;
  setResult: (result: PipelineResult, hash: string, ms: number | null) => void;
  setRunning: (running: boolean) => void;
  setRunError: (message: string | null) => void;

  setFilters: (filters: Partial<Filters>) => void;
  setTestSize: (n: number) => void;
  setHorizon: (n: number) => void;
  advanceFeed: () => void;
  setFeedIndex: (index: number) => void;
  resetData: () => void;
  addCustomMonth: (units: number) => void;
  removeLastCustomMonth: () => void;
  setOverride: (month: string, units: number | null) => void;
}

function fmtUnits(n: number) {
  return Math.round(n).toLocaleString("en-GB");
}

export const useDashboard = create<DashboardState>((set, get) => {
  /** Apply a data change: bump the data version and record what changed. */
  const commit = (scenario: ScenarioState, text: string, extra: Partial<DashboardState> = {}) => {
    const version = get().scenario.dataVersion + 1;
    set({
      scenario: { ...scenario, dataVersion: version, lastChange: text },
      changeLog: [{ version, at: new Date().toISOString(), text }, ...get().changeLog].slice(0, 50),
      ...extra,
    });
  };

  return {
    cube: null,
    cubeError: null,
    scenario: initialScenario(),
    changeLog: [{ version: 1, at: new Date().toISOString(), text: "Launch-year data loaded (Jan-Dec 2021)" }],
    forecastLog: [],

    engine: { status: "idle", step: "Waiting", pct: 0 },
    result: null,
    resultHash: null,
    running: false,
    runError: null,
    lastRunMs: null,

    setCube: (cube) => set({ cube, cubeError: null }),
    setCubeError: (message) => set({ cubeError: message }),
    setEngine: (engine) => set({ engine }),
    setResult: (result, hash, ms) => set({ result, resultHash: hash, lastRunMs: ms, runError: null }),
    setRunning: (running) => set({ running }),
    setRunError: (runError) => set({ runError }),

    setFilters: (filters) => {
      const s = get().scenario;
      // User-entered data belongs to one series, so a new filter starts from the dataset again
      set({
        scenario: { ...s, filters: { ...s.filters, ...filters }, overrides: {}, customMonths: [] },
        forecastLog: [],
      });
    },
    setTestSize: (n) => set({ scenario: { ...get().scenario, testSize: Math.max(MIN_TEST, Math.round(n)) } }),
    setHorizon: (n) =>
      set({ scenario: { ...get().scenario, horizon: Math.min(MAX_HORIZON, Math.max(MIN_HORIZON, Math.round(n))) } }),

    advanceFeed: () => {
      const { cube, scenario, result, forecastLog } = get();
      if (!cube || scenario.customMonths.length || scenario.feedIndex >= cube.months.length - 1) return;
      const next = { ...scenario, feedIndex: scenario.feedIndex + 1 };
      const month = cube.months[next.feedIndex];
      const actual = buildSeries(cube, next).at(-1)!.units;

      // Score the forecast that was made before this month arrived
      const log = [...forecastLog];
      const key = result?.recommended_model;
      const fc = key ? result?.models[key]?.forecast : undefined;
      if (result && key && fc && fc.months[0] === month) {
        log.push({
          month,
          model: result.models[key].label,
          forecast: fc.point[0],
          lower95: fc.lower95?.[0] ?? null,
          upper95: fc.upper95?.[0] ?? null,
          actual,
        });
      }
      commit(next, `New actual received: ${month} = ${fmtUnits(actual)} units`, { forecastLog: log });
    },

    setFeedIndex: (index) => {
      const { cube, scenario } = get();
      if (!cube) return;
      const i = Math.min(cube.months.length - 1, Math.max(LAUNCH_YEAR_END, Math.round(index)));
      if (i === scenario.feedIndex) return;
      commit({ ...scenario, feedIndex: i, customMonths: [] }, `Data window set to Jan 2021 - ${formatMonth(cube.months[i])}`, {
        forecastLog: [],
      });
    },

    resetData: () => {
      const s = get().scenario;
      commit({ ...s, feedIndex: LAUNCH_YEAR_END, overrides: {}, customMonths: [] }, "Data reset to the launch year", {
        forecastLog: [],
      });
    },

    addCustomMonth: (units) => {
      const { cube, scenario } = get();
      if (!cube) return;
      const month = nextEntryMonth(cube, scenario);
      commit(
        { ...scenario, customMonths: [...scenario.customMonths, { month, units }] },
        `User entered ${month} = ${fmtUnits(units)} units`,
      );
    },

    removeLastCustomMonth: () => {
      const s = get().scenario;
      const last = s.customMonths.at(-1);
      if (!last) return;
      commit({ ...s, customMonths: s.customMonths.slice(0, -1) }, `User removed ${last.month}`);
    },

    setOverride: (month, units) => {
      const s = get().scenario;
      const overrides = { ...s.overrides };
      if (units === null) delete overrides[month];
      else overrides[month] = units;
      const text =
        units === null ? `User restored the original figure for ${month}` : `User corrected ${month} to ${fmtUnits(units)} units`;
      commit({ ...s, overrides }, text);
    },
  };
});
