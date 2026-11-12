// Feature importance (Random Forest, XGBoost) and the lag-1 scatter (Task 1).

import { useMemo } from "react";
import type { PipelineResult } from "../engine/types";
import { fmtUnits, monthLabel } from "../lib/format";
import { importances, lagScatter } from "../viewmodels/features";
import { MODEL_COLORS } from "../viewmodels/models";
import { EChart } from "./EChart";
import { C, legend, tooltip, valueAxis } from "./theme";

export function ImportanceChart({ result, height = 280 }: { result: PipelineResult; height?: number }) {
  const views = useMemo(() => importances(result), [result]);
  const option = useMemo(() => {
    const features = views[0]?.items.map((i) => i.label).reverse() ?? [];
    return {
      grid: { left: 8, right: 36, top: 36, bottom: 4 },
      legend: legend(),
      tooltip: tooltip({ trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(148,226,255,0.05)" } }, valueFormatter: (v: number) => `${(v * 100).toFixed(1)}%` }),
      xAxis: { type: "value", max: 1, splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, formatter: (v: number) => `${Math.round(v * 100)}%` } },
      yAxis: { type: "category", data: features, axisLine: { lineStyle: { color: C.axis } }, axisTick: { show: false }, axisLabel: { color: C.ink2 } },
      series: views.map((v) => ({
        name: v.label, type: "bar", barMaxWidth: 10, barGap: "30%",
        data: features.map((f) => v.items.find((i) => i.label === f)?.share ?? 0),
        itemStyle: { color: MODEL_COLORS[v.key], borderRadius: [0, 3, 3, 0] },
      })),
    };
  }, [views]);
  if (!views.length) return null;
  return (
    <EChart
      option={option}
      height={height}
      label={`Feature importance. ${views.map((v) => `${v.label}: top feature ${v.items[0].label} at ${(v.items[0].share * 100).toFixed(1)}%`).join("; ")}.`}
    />
  );
}

export function LagScatter({ result, height = 260 }: { result: PipelineResult; height?: number }) {
  const pts = useMemo(() => lagScatter(result), [result]);
  const option = useMemo(
    () => ({
      grid: { left: 8, right: 16, top: 24, bottom: 4 },
      tooltip: {
        ...tooltip({ trigger: "item" }),
        formatter: (p: { data: [number, number, string] }) =>
          `<b>${monthLabel(p.data[2])}</b><br/>Previous month ${fmtUnits(p.data[0])}<br/>This month ${fmtUnits(p.data[1])}`,
      },
      xAxis: valueAxis({ name: "Last month (lag 1)", nameLocation: "middle", nameGap: 26 }),
      yAxis: valueAxis({ name: "This month" }),
      series: [{
        type: "scatter", symbolSize: 10, data: pts.map((p) => [p.x, p.y, p.month]),
        itemStyle: { color: "#3987e5", borderColor: C.surface, borderWidth: 1.5 },
      }],
    }),
    [pts],
  );
  return <EChart option={option} height={height} label="Each month's sales against the previous month's sales." />;
}
