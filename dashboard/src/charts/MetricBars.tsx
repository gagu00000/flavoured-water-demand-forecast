// MAPE or WAPE for every model: single test window (solid) vs rolling-origin
// backtest (hatched), coloured by model (Task 5).

import { useMemo } from "react";
import { fmtPct } from "../lib/format";
import type { MetricRow } from "../viewmodels/models";
import { EChart } from "./EChart";
import { C, legend, tooltip } from "./theme";

const HATCH = { symbol: "rect", dashArrayX: [1, 0], dashArrayY: [2, 5], rotation: -Math.PI / 4, color: "rgba(5, 13, 24, 0.55)" };

export function MetricBars({ rows, metric, height = 300 }: { rows: MetricRow[]; metric: "wape" | "mape"; height?: number }) {
  const shown = rows.filter((r) => r.available);
  const option = useMemo(() => {
    const test = shown.map((r) => ({ value: metric === "wape" ? r.testWape : r.testMape, itemStyle: { color: r.color } }));
    const bt = shown.map((r) => ({
      value: metric === "wape" ? r.btWape : r.btMape,
      itemStyle: { color: r.color, opacity: 0.55, decal: HATCH },
    }));
    return {
      grid: { left: 8, right: 8, top: 40, bottom: 4 },
      legend: legend({ data: ["Single test window", "Rolling-origin backtest"] }),
      tooltip: tooltip({
        trigger: "axis",
        axisPointer: { type: "shadow", shadowStyle: { color: "rgba(148,226,255,0.05)" } },
        valueFormatter: (v: number) => fmtPct(v),
      }),
      xAxis: {
        type: "category",
        data: shown.map((r) => r.label),
        axisLine: { lineStyle: { color: C.axis } },
        axisTick: { show: false },
        axisLabel: { color: C.ink2, interval: 0, fontSize: 10, formatter: (s: string) => s.replace(" ", "\n") },
      },
      yAxis: {
        type: "value",
        splitLine: { lineStyle: { color: C.grid } },
        axisLabel: { color: C.muted, formatter: (v: number) => `${v}%` },
      },
      series: [
        { name: "Single test window", type: "bar", data: test, barGap: "12%", barMaxWidth: 28, itemStyle: { color: "#8aa1b1", borderRadius: [4, 4, 0, 0] } },
        {
          name: "Rolling-origin backtest", type: "bar", data: bt, barMaxWidth: 28,
          itemStyle: { color: "#8aa1b1", opacity: 0.55, decal: HATCH, borderRadius: [4, 4, 0, 0] },
          label: { show: true, position: "top", color: C.ink2, fontSize: 10, formatter: (p: { value: number | null }) => (p.value == null ? "" : p.value.toFixed(2)) },
        },
      ],
    };
  }, [shown, metric]);

  return (
    <EChart
      option={option}
      height={height}
      label={`${metric.toUpperCase()} by model. ${shown.map((r) => `${r.label}: test ${fmtPct(metric === "wape" ? r.testWape : r.testMape)}, backtest ${fmtPct(metric === "wape" ? r.btWape : r.btMape)}`).join("; ")}.`}
    />
  );
}
