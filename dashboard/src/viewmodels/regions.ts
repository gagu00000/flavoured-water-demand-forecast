// Regional views for distribution planning: units-per-day heatmap and forecast allocation.

import { ALL, type Filters, type MonthlyCube } from "../data/cube";
import type { PipelineResult } from "../engine/types";

export interface RegionHeatmap {
  regions: string[]; // sorted by total volume, largest first
  months: string[];
  /** [monthIndex, regionIndex, unitsPerDay] triples for the heatmap */
  cells: [number, number, number][];
  min: number;
  max: number;
  shares: { region: string; share: number }[];
}

/** Units per day by region and month, for the months released so far. */
export function regionHeatmap(cube: MonthlyCube, filters: Filters, upTo: number): RegionHeatmap {
  const p = cube.products.indexOf(filters.product);
  const types = filters.customerType === ALL ? cube.customer_types.map((_, i) => i) : [cube.customer_types.indexOf(filters.customerType)];
  const months = cube.months.slice(0, upTo);
  const totals = cube.regions.map((_, r) =>
    months.reduce((s, _m, m) => s + types.reduce((t, ti) => t + cube.units[p][r][ti][m], 0), 0),
  );
  const order = cube.regions.map((_, i) => i).sort((a, b) => totals[b] - totals[a]);
  const grand = totals.reduce((a, b) => a + b, 0);
  const cells: [number, number, number][] = [];
  let min = Infinity;
  let max = -Infinity;
  order.forEach((r, row) => {
    months.forEach((_m, m) => {
      const v = types.reduce((t, ti) => t + cube.units[p][r][ti][m], 0) / cube.days[m];
      cells.push([m, row, Math.round(v * 10) / 10]);
      min = Math.min(min, v);
      max = Math.max(max, v);
    });
  });
  return {
    regions: order.map((r) => cube.regions[r]),
    months,
    cells,
    min,
    max,
    shares: order.map((r) => ({ region: cube.regions[r], share: grand ? totals[r] / grand : 0 })),
  };
}

export interface AllocationRow {
  region: string;
  share: number;
  units: number[];
  total: number;
}

export function allocationRows(result: PipelineResult): { months: string[]; rows: AllocationRow[]; basisMonths: number } | null {
  const a = result.regional_allocation;
  if (!a) return null;
  return {
    months: a.months,
    basisMonths: a.basis_months,
    rows: a.regions.map((r) => ({ region: r.region, share: r.share, units: r.units, total: r.units.reduce((x, y) => x + y, 0) })),
  };
}
