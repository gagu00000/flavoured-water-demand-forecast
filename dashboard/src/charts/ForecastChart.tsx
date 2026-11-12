// Actual vs predicted for one model: history, backtest forecasts, the test-window
// forecast, and the future forecast with 80% / 95% ranges (Tasks 4 and 6).

import { useMemo } from "react";
import type { ModelKey, PipelineResult } from "../engine/types";
import { fmtUnits, monthLabel } from "../lib/format";
import { ACTUAL_COLOR, MODEL_COLORS } from "../viewmodels/models";
import { actualVsPredicted, type Point, testOverlay } from "../viewmodels/series";
import { EChart } from "./EChart";
import { C, categoryAxis, legend, tooltip, unitsTooltip, valueAxis } from "./theme";

const diff = (hi: Point[] | null, lo: Point[] | null) =>
  hi && lo ? hi.map((h, i) => (h == null || lo[i] == null ? null : h - (lo[i] as number))) : null;

function hexAlpha(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

interface Props {
  result: PipelineResult;
  model: ModelKey;
  height?: number;
  compact?: boolean;
}

export function ForecastChart({ result, model, height = 360, compact = false }: Props) {
  const v = useMemo(() => actualVsPredicted(result, model), [result, model]);

  const option = useMemo(() => {
    if (!v) return {};
    const color = MODEL_COLORS[model];
    const { months, testStart, nHistory } = v.axis;
    const band95 = diff(v.upper95, v.lower95);
    const band80 = diff(v.upper80, v.lower80);
    const series: Record<string, unknown>[] = [];

    if (band95 && v.lower95) {
      series.push(
        { name: "_lo95", type: "line", data: v.lower95, stack: "b95", symbol: "none", lineStyle: { opacity: 0 }, silent: true },
        { name: "95% range", type: "line", data: band95, stack: "b95", symbol: "none", lineStyle: { opacity: 0 },
          areaStyle: { color: hexAlpha(color, 0.16) }, silent: true, itemStyle: { color: hexAlpha(color, 0.35) } },
      );
    }
    if (band80 && v.lower80) {
      series.push(
        { name: "_lo80", type: "line", data: v.lower80, stack: "b80", symbol: "none", lineStyle: { opacity: 0 }, silent: true },
        { name: "80% range", type: "line", data: band80, stack: "b80", symbol: "none", lineStyle: { opacity: 0 },
          areaStyle: { color: hexAlpha(color, 0.28) }, silent: true, itemStyle: { color: hexAlpha(color, 0.6) } },
      );
    }
    v.folds.forEach((f) =>
      series.push({
        name: "Backtest forecasts", type: "line", data: f.values, symbol: "none", connectNulls: false,
        lineStyle: { color, width: 1, type: "dashed", opacity: 0.7 }, itemStyle: { color }, z: 2,
      }),
    );
    series.push(
      {
        name: "Actual", type: "line", data: v.actual, symbol: "circle", symbolSize: compact ? 4 : 6,
        lineStyle: { color: ACTUAL_COLOR, width: 2 }, itemStyle: { color: ACTUAL_COLOR, borderColor: C.surface, borderWidth: 1.5 }, z: 4,
        markArea: {
          silent: true,
          itemStyle: { color: C.testBand },
          label: { show: !compact, color: C.muted, fontSize: 10, position: "insideTop" },
          data: [[{ xAxis: months[testStart], name: "Test window" }, { xAxis: months[nHistory - 1] }]],
        },
      },
      {
        name: "Test-window forecast", type: "line", data: v.test, symbol: "circle", symbolSize: compact ? 5 : 7,
        lineStyle: { color, width: 2.5 }, itemStyle: { color, borderColor: C.surface, borderWidth: 1.5 }, z: 5,
      },
      {
        name: "Forecast", type: "line", data: v.forecastJoined, symbol: "circle", symbolSize: compact ? 5 : 8,
        lineStyle: { color, width: 2.5, type: [6, 4] }, itemStyle: { color, borderColor: C.surface, borderWidth: 2 }, z: 6,
        markLine: compact ? undefined : {
          silent: true, symbol: "none",
          lineStyle: { color: C.muted, type: "dotted" },
          label: { color: C.muted, fontSize: 10, formatter: "Latest data" },
          data: [{ xAxis: months[nHistory - 1] }],
        },
      },
    );

    return {
      grid: { left: 8, right: 12, top: compact ? 10 : 40, bottom: 4 },
      legend: compact ? { show: false } : legend({ data: ["Actual", "Test-window forecast", "Backtest forecasts", "Forecast", "80% range", "95% range"] }),
      tooltip: tooltip({
        formatter: (params: unknown) => {
          const list = params as { seriesName: string; value: number | null; dataIndex: number }[];
          const i = list[0]?.dataIndex ?? 0;
          const lines = list.filter((p) => !p.seriesName.startsWith("_") && !p.seriesName.endsWith("range"));
          let html = unitsTooltip(lines.map((p) => ({ ...p, axisValue: months[i], color: p.seriesName === "Actual" ? ACTUAL_COLOR : color })));
          if (v.lower95?.[i] != null && v.upper95?.[i] != null) {
            html += `<div style="color:${C.ink2};margin-top:4px">95% range: ${fmtUnits(v.lower95[i])} – ${fmtUnits(v.upper95[i])}</div>`;
          }
          return html;
        },
      }),
      xAxis: categoryAxis(months),
      yAxis: valueAxis(),
      series,
    };
  }, [v, model, compact]);

  if (!v) return null;
  const fc = result.models[model].forecast!;
  return (
    <EChart
      option={option}
      height={height}
      label={`${result.models[model].label}: actual monthly units and forecast. Forecast for ${fc.months
        .map((m, i) => `${monthLabel(m)} ${fmtUnits(fc.point[i])}`)
        .join(", ")}.`}
    />
  );
}

/** All available models' test-window forecasts against the actuals. */
export function TestOverlayChart({ result, height = 320 }: { result: PipelineResult; height?: number }) {
  const option = useMemo(() => {
    const o = testOverlay(result);
    const start = Math.max(0, o.axis.testStart - 8);
    const months = o.axis.months.slice(start, o.axis.nHistory);
    const cut = (p: Point[]) => p.slice(start, o.axis.nHistory);
    return {
      grid: { left: 8, right: 12, top: 40, bottom: 4 },
      legend: legend(),
      tooltip: tooltip({ formatter: unitsTooltip }),
      xAxis: categoryAxis(months),
      yAxis: valueAxis(),
      series: [
        {
          name: "Actual", type: "line", data: cut(o.actual), symbol: "circle", symbolSize: 6,
          lineStyle: { color: ACTUAL_COLOR, width: 2.5 }, itemStyle: { color: ACTUAL_COLOR }, z: 5,
          markArea: { silent: true, itemStyle: { color: C.testBand },
            data: [[{ xAxis: months[o.axis.testStart - start] }, { xAxis: months[months.length - 1] }]] },
        },
        ...o.models.map((m) => ({
          name: result.models[m.key].label, type: "line", data: cut(m.values), symbol: "circle", symbolSize: 6,
          lineStyle: { color: MODEL_COLORS[m.key], width: 2 }, itemStyle: { color: MODEL_COLORS[m.key], borderColor: C.surface, borderWidth: 1.5 },
        })),
      ],
    };
  }, [result]);
  return <EChart option={option} height={height} label="Every model's forecast for the test window compared with actual sales." />;
}
