// Shared chart styling: recessive axes and grid, glass tooltip, unit formatting.

import { fmtCompact, fmtUnits, monthLabel } from "../lib/format";

export const C = {
  surface: "#0c1b2b",
  ink: "#e6f1f5",
  ink2: "#a9bcc6",
  muted: "#7b93a3",
  grid: "#1b3045",
  axis: "#2b4559",
  accent: "#5eead4",
  testBand: "rgba(148, 226, 255, 0.06)",
};

/** Sequential blue ramp for magnitude (dark end recedes into the dark surface). */
export const SEQUENTIAL = ["#104281", "#1c5cab", "#2a78d6", "#5598e7", "#86b6ef", "#b7d3f6"];

export const textStyle = { color: C.ink2, fontFamily: "Inter, system-ui, sans-serif", fontSize: 11 };

export const tooltip = (extra: Record<string, unknown> = {}) => ({
  trigger: "axis",
  confine: true,
  backgroundColor: "rgba(8, 22, 38, 0.94)",
  borderColor: "rgba(148, 226, 255, 0.22)",
  borderWidth: 1,
  padding: [8, 10],
  textStyle: { color: C.ink, fontSize: 12 },
  extraCssText: "backdrop-filter: blur(8px); border-radius: 10px; box-shadow: 0 10px 30px -12px rgba(0,0,0,.8);",
  axisPointer: { type: "line", lineStyle: { color: C.muted, type: "dashed", width: 1 } },
  ...extra,
});

export function categoryAxis(months: string[], extra: Record<string, unknown> = {}) {
  return {
    type: "category",
    data: months,
    boundaryGap: false,
    axisLine: { lineStyle: { color: C.axis } },
    axisTick: { show: false },
    axisLabel: { color: C.muted, formatter: (m: string) => monthLabel(m, true), hideOverlap: true },
    ...extra,
  };
}

export function valueAxis(extra: Record<string, unknown> = {}) {
  return {
    type: "value",
    scale: true,
    splitLine: { lineStyle: { color: C.grid } },
    axisLine: { show: false },
    axisLabel: { color: C.muted, formatter: (v: number) => fmtCompact(v) },
    nameTextStyle: { color: C.muted, align: "left" },
    ...extra,
  };
}

export const legend = (extra: Record<string, unknown> = {}) => ({
  top: 0,
  left: 0,
  icon: "roundRect",
  itemWidth: 14,
  itemHeight: 4,
  textStyle: { color: C.ink2, fontSize: 11 },
  inactiveColor: "#3b5163",
  ...extra,
});

/** Tooltip rows: colour chip + series name + formatted value (text stays in ink colours). */
export function unitsTooltip(params: unknown): string {
  const list = (Array.isArray(params) ? params : [params]) as {
    axisValue?: string;
    seriesName: string;
    value: number | null | (number | null)[];
    color: string;
  }[];
  const month = list[0]?.axisValue ? monthLabel(list[0].axisValue) : "";
  const rows = list
    .filter((p) => !p.seriesName.startsWith("_") && p.value != null && !(Array.isArray(p.value) && p.value[1] == null))
    .map((p) => {
      const v = Array.isArray(p.value) ? p.value[1] : p.value;
      return `<div style="display:flex;gap:8px;align-items:center;justify-content:space-between"><span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${p.color};margin-right:6px"></span>${p.seriesName}</span><b style="font-variant-numeric:tabular-nums">${fmtUnits(v as number)}</b></div>`;
    })
    .join("");
  return `<div style="font-weight:600;margin-bottom:4px">${month}</div>${rows}`;
}
