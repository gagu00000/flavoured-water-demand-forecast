// Turns the dashboard state (filters, live data feed position, user-entered
// data, split settings) into the exact request the forecasting engine runs.

import type { EngineContext, EngineRequest, SeriesRecord } from "../engine/types";
import { ALL, daysInMonth, type Filters, type MonthlyCube, nextMonth, regionalUnits, sliceSeries } from "./cube";

export const LAUNCH_YEAR_END = 11; // index of Dec 2021, the last month of the launch year
export const MIN_TEST = 3;
export const MAX_TEST = 12;
export const MIN_TRAIN_FOR_SPLIT = 6;
export const MIN_HORIZON = 1;
export const MAX_HORIZON = 6;
const PARTIAL_MONTH_NOTE = "December 2023 contains 30 of 31 days because the data ends on 30 Dec 2023.";

export interface UserMonth {
  month: string;
  units: number;
}

export interface ScenarioState {
  filters: Filters;
  /** Index (into cube.months) of the last dataset month released by the live data feed. */
  feedIndex: number;
  /** User corrections to dataset months, by month. */
  overrides: Record<string, number>;
  /** Months entered by the user after the last dataset month shown. */
  customMonths: UserMonth[];
  testSize: number;
  horizon: number;
  dataVersion: number;
  lastChange?: string;
}

export const DEFAULT_PRODUCT = "Volvic Touch";

export function initialScenario(): ScenarioState {
  return {
    filters: { product: DEFAULT_PRODUCT, region: ALL, customerType: ALL },
    feedIndex: LAUNCH_YEAR_END,
    overrides: {},
    customMonths: [],
    testSize: 3,
    horizon: 3,
    dataVersion: 1,
  };
}

/** The series the engine will forecast: released dataset months, corrections, then user months. */
export function buildSeries(cube: MonthlyCube, s: ScenarioState): SeriesRecord[] {
  const base = sliceSeries(cube, s.filters).slice(0, s.feedIndex + 1);
  const records: SeriesRecord[] = base.map((r) =>
    r.month in s.overrides ? { month: r.month, units: s.overrides[r.month], days: r.days, revenue: null } : r,
  );
  for (const c of s.customMonths) records.push({ month: c.month, units: c.units, days: daysInMonth(c.month), revenue: null });
  return records;
}

/** Largest test window that still leaves enough months to train on. */
export function maxTestSize(nMonths: number): number {
  return Math.max(MIN_TEST, Math.min(MAX_TEST, nMonths - MIN_TRAIN_FOR_SPLIT));
}

export function regionLabel(region: string): string {
  return region === ALL ? "All regions" : region;
}

export function customerLabel(type: string): string {
  return type === ALL ? "All customers" : `${type} customers`;
}

function viewLabel(n: number, userMonths: number): string {
  if (n === 12 && userMonths === 0) return "Launch year (first 12 months)";
  return `${n} months of history (launch year + live data feed${userMonths ? ", including user-entered data" : ""})`;
}

/** Corrections that fall inside the months currently in the series (later ones wait for the feed). */
function activeOverrides(s: ScenarioState, months: string[]): string[] {
  return Object.keys(s.overrides).filter((m) => months.includes(m));
}

export function buildRequest(cube: MonthlyCube, s: ScenarioState): EngineRequest {
  const records = buildSeries(cube, s);
  const months = records.map((r) => r.month);
  const notes: string[] = [];
  if (records.some((r) => r.month === "2023-12" && !(r.month in s.overrides))) notes.push(PARTIAL_MONTH_NOTE);
  const userMonths = s.customMonths.length + activeOverrides(s, months).length;
  if (userMonths > 0) notes.push(`${userMonths} month(s) of sales were entered or corrected by the user.`);

  const context: EngineContext = {
    product: s.filters.product,
    region: regionLabel(s.filters.region),
    customer_type: customerLabel(s.filters.customerType),
    view: viewLabel(records.length, userMonths),
    unit: "units",
    data_version: s.dataVersion,
    notes,
  };
  if (s.lastChange) context.last_change = s.lastChange;

  return {
    records,
    test_size: Math.min(s.testSize, maxTestSize(records.length)),
    horizon: s.horizon,
    context,
    regional: s.filters.region === ALL ? regionalUnits(cube, s.filters, s.feedIndex + 1) : null,
  };
}

/** The month a user can enter next (directly after the last month in the series). */
export function nextEntryMonth(cube: MonthlyCube, s: ScenarioState): string {
  const last = s.customMonths.length ? s.customMonths[s.customMonths.length - 1].month : cube.months[s.feedIndex];
  return nextMonth(last);
}

/** Validate a user-entered unit figure; returns an error message or null. */
export function validateUnits(value: number, recent: number[]): string | null {
  if (!Number.isFinite(value)) return "Enter a number.";
  if (value < 0) return "Sales cannot be negative.";
  if (!Number.isInteger(value)) return "Enter whole units.";
  const typical = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
  if (typical > 0 && value > typical * 10) return "That is more than 10 times recent monthly sales. Please check the figure.";
  return null;
}
