// The monthly data cube exported by the notebook (monthly_water.json) and the
// functions that turn the user's filters into the series the engine forecasts.

import type { SeriesRecord } from "../engine/types";

export interface MonthlyCube {
  source: { dataset: string; license: string; category: string; synthetic: boolean; note: string };
  months: string[];
  days: number[];
  products: string[];
  regions: string[];
  customer_types: string[];
  /** units[product][region][customerType][month] */
  units: number[][][][];
  /** revenue[product][region][customerType][month] (EUR) */
  revenue: number[][][][];
}

export const ALL = "all";

export interface Filters {
  product: string;
  region: string; // region name or ALL
  customerType: string; // "B2B" | "B2C" | ALL
}

function indices(all: string[], pick: string): number[] {
  if (pick === ALL) return all.map((_, i) => i);
  const i = all.indexOf(pick);
  if (i < 0) throw new Error(`Unknown value "${pick}"`);
  return [i];
}

/** Monthly units and revenue for the filtered slice, for every month in the cube. */
export function sliceSeries(cube: MonthlyCube, filters: Filters): SeriesRecord[] {
  const p = cube.products.indexOf(filters.product);
  if (p < 0) throw new Error(`Unknown product "${filters.product}"`);
  const regions = indices(cube.regions, filters.region);
  const types = indices(cube.customer_types, filters.customerType);
  return cube.months.map((month, m) => {
    let units = 0;
    let revenue = 0;
    for (const r of regions) {
      for (const t of types) {
        units += cube.units[p][r][t][m];
        revenue += cube.revenue[p][r][t][m];
      }
    }
    return { month, units, days: cube.days[m], revenue: Math.round(revenue * 100) / 100 };
  });
}

/** Units per region (for distribution allocation), restricted to the first `upTo` months. */
export function regionalUnits(cube: MonthlyCube, filters: Filters, upTo: number): Record<string, number[]> {
  const p = cube.products.indexOf(filters.product);
  const types = indices(cube.customer_types, filters.customerType);
  const out: Record<string, number[]> = {};
  cube.regions.forEach((region, r) => {
    out[region] = cube.months.slice(0, upTo).map((_, m) => types.reduce((s, t) => s + cube.units[p][r][t][m], 0));
  });
  return out;
}

/** Calendar days in a YYYY-MM month (leap years included). */
export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The month after a YYYY-MM month. */
export function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function formatMonth(month: string, style: "short" | "long" = "short"): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", {
    month: style === "short" ? "short" : "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export async function loadCube(baseUrl: string): Promise<MonthlyCube> {
  const res = await fetch(`${baseUrl}data/monthly_water.json`);
  if (!res.ok) throw new Error(`Could not load sales data (HTTP ${res.status})`);
  return (await res.json()) as MonthlyCube;
}
