// Trend, seasonality, calendar effect and autocorrelation (Task 7a evidence).

import { useMemo } from "react";
import type { PipelineResult } from "../engine/types";
import { fmtNum, fmtP, fmtUnits, monthLabel } from "../lib/format";
import { acfView, calendarView, seasonalityView, trendView } from "../viewmodels/analysis";
import { ACTUAL_COLOR } from "../viewmodels/models";
import { EChart } from "./EChart";
import { C, categoryAxis, legend, tooltip, valueAxis } from "./theme";

const ABOVE = "#3987e5"; // diverging pair: blue above average ...
const BELOW = "#e66767"; // ... red below average

export function TrendChart({ result, height = 280 }: { result: PipelineResult; height?: number }) {
  const t = useMemo(() => trendView(result), [result]);
  const option = useMemo(
    () => ({
      grid: { left: 8, right: 12, top: 40, bottom: 4 },
      legend: legend(),
      tooltip: tooltip({ valueFormatter: (v: number) => `${fmtUnits(v)} / day` }),
      xAxis: categoryAxis(t.months),
      yAxis: valueAxis(),
      series: [
        {
          name: "Units per day", type: "line", data: t.dailyRate, symbol: "circle", symbolSize: 6,
          lineStyle: { color: ACTUAL_COLOR, width: 2 }, itemStyle: { color: ACTUAL_COLOR, borderColor: C.surface, borderWidth: 1.5 },
        },
        ...(t.fitted
          ? [{
              name: `Linear trend (${t.pctPerYear! > 0 ? "+" : ""}${fmtNum(t.pctPerYear)}%/yr, ${fmtP(t.pValue)})`,
              type: "line", data: t.fitted, symbol: "none", lineStyle: { color: C.accent, width: 2, type: "dashed" }, itemStyle: { color: C.accent },
            }]
          : []),
      ],
    }),
    [t],
  );
  return <EChart option={option} height={height} label={`Units per sales day over time. ${t.verdict}`} />;
}

export function SeasonalityChart({ result, height = 280 }: { result: PipelineResult; height?: number }) {
  const s = useMemo(() => seasonalityView(result), [result]);
  const option = useMemo(() => {
    const pct = s.index.map((v) => (v == null ? null : (v - 1) * 100));
    const sd = s.sd.map((v) => (v == null ? null : v * 100));
    return {
      grid: { left: 8, right: 8, top: 24, bottom: 4 },
      tooltip: tooltip({
        trigger: "axis",
        axisPointer: { type: "shadow", shadowStyle: { color: "rgba(148,226,255,0.05)" } },
        formatter: (params: unknown) => {
          const p = (params as { dataIndex: number }[])[0];
          const i = p.dataIndex;
          const v = pct[i];
          return `<b>${s.months[i]}</b><br/>${v == null ? "no data" : `${v > 0 ? "+" : ""}${v.toFixed(2)}% vs average day`}${
            sd[i] != null ? `<br/><span style="color:${C.ink2}">± ${sd[i]!.toFixed(2)}% year-to-year (n = ${s.n[i]})</span>` : `<br/><span style="color:${C.ink2}">seen ${s.n[i]}×</span>`
          }`;
        },
      }),
      xAxis: { type: "category", data: s.months, axisLine: { lineStyle: { color: C.axis } }, axisTick: { show: false }, axisLabel: { color: C.muted } },
      yAxis: { type: "value", splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, formatter: (v: number) => `${v > 0 ? "+" : ""}${v}%` } },
      series: [
        {
          name: "vs average", type: "bar", barMaxWidth: 26,
          data: pct.map((v) => ({ value: v, itemStyle: { color: (v ?? 0) >= 0 ? ABOVE : BELOW, borderRadius: (v ?? 0) >= 0 ? [4, 4, 0, 0] : [0, 0, 4, 4] } })),
          markLine: { silent: true, symbol: "none", lineStyle: { color: C.muted }, label: { show: false }, data: [{ yAxis: 0 }] },
        },
        {
          // error bars: ± one standard deviation across years
          name: "_sd", type: "custom", z: 5,
          data: pct.map((v, i) => [i, v == null || sd[i] == null ? null : v - sd[i]!, v == null || sd[i] == null ? null : v + sd[i]!]),
          renderItem: (_params: unknown, api: { value: (i: number) => number; coord: (p: number[]) => number[] }) => {
            const lo = api.value(1);
            const hi = api.value(2);
            if (lo == null || hi == null || Number.isNaN(lo)) return null;
            const a = api.coord([api.value(0), lo]);
            const b = api.coord([api.value(0), hi]);
            const style = { stroke: C.ink2, lineWidth: 1.2 };
            return {
              type: "group",
              children: [
                { type: "line", shape: { x1: a[0], y1: a[1], x2: b[0], y2: b[1] }, style },
                { type: "line", shape: { x1: a[0] - 4, y1: a[1], x2: a[0] + 4, y2: a[1] }, style },
                { type: "line", shape: { x1: b[0] - 4, y1: b[1], x2: b[0] + 4, y2: b[1] }, style },
              ],
            };
          },
          tooltip: { show: false },
        },
      ],
    };
  }, [s]);
  return <EChart option={option} height={height} label={`Month-of-year effect on units per day. ${s.verdict}`} />;
}

export function CalendarScatter({ result, height = 260 }: { result: PipelineResult; height?: number }) {
  const c = useMemo(() => calendarView(result), [result]);
  const option = useMemo(
    () => ({
      grid: { left: 8, right: 16, top: 24, bottom: 4 },
      tooltip: {
        ...tooltip({ trigger: "item" }),
        formatter: (p: { data: [number, number, string] }) => `<b>${monthLabel(p.data[2])}</b><br/>${p.data[0]} days · ${fmtUnits(p.data[1])} units`,
      },
      xAxis: { type: "value", min: 27.5, max: 31.5, interval: 1, splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, formatter: (v: number) => (Number.isInteger(v) ? `${v} days` : "") }, name: "Sales days in month", nameLocation: "middle", nameGap: 26, nameTextStyle: { color: C.muted } },
      yAxis: valueAxis({ name: "Units" }),
      series: [
        {
          type: "scatter", symbolSize: 11,
          data: c.points.map((p) => [p.days, p.units, p.month]),
          itemStyle: { color: "#199e70", borderColor: C.surface, borderWidth: 1.5, opacity: 0.9 },
          emphasis: { scale: 1.4 },
        },
      ],
    }),
    [c],
  );
  return <EChart option={option} height={height} label={`Units sold against days in the month. R squared ${fmtNum(c.r2)}.`} />;
}

export function AcfChart({ result, height = 260 }: { result: PipelineResult; height?: number }) {
  const a = useMemo(() => acfView(result), [result]);
  const option = useMemo(
    () => ({
      grid: { left: 8, right: 8, top: 24, bottom: 4 },
      tooltip: tooltip({ trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(148,226,255,0.05)" } }, valueFormatter: (v: number) => v.toFixed(2) }),
      xAxis: { type: "category", data: a.lags.map((l) => `${l}`), name: "Lag (months)", nameLocation: "middle", nameGap: 24, nameTextStyle: { color: C.muted }, axisLine: { lineStyle: { color: C.axis } }, axisTick: { show: false }, axisLabel: { color: C.muted } },
      yAxis: { type: "value", min: -1, max: 1, splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted } },
      series: [
        {
          name: "Autocorrelation", type: "bar", barMaxWidth: 10,
          data: a.values.map((v, i) => ({ value: v, itemStyle: { color: a.outside.includes(a.lags[i]) ? "#c98500" : "#3987e5", borderRadius: 3 } })),
          markArea: a.bound == null ? undefined : {
            silent: true, itemStyle: { color: "rgba(148,226,255,0.07)" },
            label: { color: C.muted, fontSize: 10, position: "insideTopRight", formatter: "95% noise band" },
            data: [[{ yAxis: -a.bound }, { yAxis: a.bound }]],
          },
        },
      ],
    }),
    [a],
  );
  return (
    <EChart
      option={option}
      height={height}
      label={`Autocorrelation of units per day. ${a.outside.length} of ${a.lags.length} lags fall outside the noise band.`}
    />
  );
}
