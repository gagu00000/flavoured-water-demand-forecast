// Regional views for distribution: units-per-day heatmap and share of volume.

import { useMemo } from "react";
import { fmtUnits, monthLabel } from "../lib/format";
import type { RegionHeatmap } from "../viewmodels/regions";
import { EChart } from "./EChart";
import { C, SEQUENTIAL, tooltip } from "./theme";

export function RegionHeatmapChart({ data, height = 460 }: { data: RegionHeatmap; height?: number }) {
  const option = useMemo(
    () => ({
      grid: { left: 8, right: 16, top: 8, bottom: 56 },
      tooltip: {
        ...tooltip({ trigger: "item" }),
        formatter: (p: { data: [number, number, number] }) =>
          `<b>${data.regions[p.data[1]]}</b> · ${monthLabel(data.months[p.data[0]])}<br/>${fmtUnits(p.data[2])} units per day`,
      },
      xAxis: { type: "category", data: data.months, axisLine: { show: false }, axisTick: { show: false }, splitArea: { show: false }, axisLabel: { color: C.muted, formatter: (m: string) => monthLabel(m, true), hideOverlap: true } },
      yAxis: { type: "category", data: data.regions, inverse: true, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: C.ink2, fontSize: 11 } },
      visualMap: {
        min: Math.floor(data.min), max: Math.ceil(data.max), calculable: false, orient: "horizontal", left: "center", bottom: 0,
        itemWidth: 12, itemHeight: 160, text: ["more", "fewer units / day"], textStyle: { color: C.muted, fontSize: 10 },
        inRange: { color: SEQUENTIAL },
      },
      series: [{
        type: "heatmap", data: data.cells,
        itemStyle: { borderColor: C.surface, borderWidth: 1.5, borderRadius: 2 },
        emphasis: { itemStyle: { borderColor: C.ink, borderWidth: 1.5 } },
      }],
    }),
    [data],
  );
  return (
    <EChart
      option={option}
      height={height}
      label={`Units per day by region and month. Largest region ${data.regions[0]}, smallest ${data.regions[data.regions.length - 1]}.`}
    />
  );
}

export function ShareBars({ data, height = 460 }: { data: RegionHeatmap; height?: number }) {
  const option = useMemo(
    () => ({
      grid: { left: 8, right: 44, top: 8, bottom: 4 },
      tooltip: tooltip({ trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(148,226,255,0.05)" } }, valueFormatter: (v: number) => `${v.toFixed(1)}%` }),
      // values are labelled on the bars, so the value axis stays silent
      xAxis: { type: "value", splitLine: { show: false }, axisLabel: { show: false } },
      yAxis: { type: "category", data: data.shares.map((s) => s.region), inverse: true, axisLine: { lineStyle: { color: C.axis } }, axisTick: { show: false }, axisLabel: { color: C.ink2, fontSize: 11 } },
      series: [{
        name: "Share of volume", type: "bar", barMaxWidth: 14,
        data: data.shares.map((s) => +(s.share * 100).toFixed(2)),
        itemStyle: { color: "#3987e5", borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: "right", color: C.ink2, fontSize: 10, formatter: (p: { value: number }) => `${p.value.toFixed(1)}%` },
      }],
    }),
    [data],
  );
  return <EChart option={option} height={height} label={`Share of volume by region. ${data.shares.map((s) => `${s.region} ${(s.share * 100).toFixed(1)}%`).join(", ")}.`} />;
}
