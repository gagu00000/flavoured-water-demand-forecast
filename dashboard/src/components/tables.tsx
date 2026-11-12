// Tabular views: every chart's numbers are also available as a table.

import { Check, Star } from "lucide-react";
import type { ModelKey, PipelineResult } from "../engine/types";
import { DASH, fmtNum, fmtPct, fmtSignedPct, fmtUnits, monthLabel } from "../lib/format";
import { FEATURE_LABELS, featureTable } from "../viewmodels/features";
import { INTERVAL_LABEL, type MetricRow } from "../viewmodels/models";
import { allocationRows } from "../viewmodels/regions";
import { forecastRows } from "../viewmodels/series";
import { Badge } from "./ui";

const th = "px-2 py-1.5 text-left text-[11px] font-medium tracking-wide text-muted uppercase";
const td = "px-2 py-1.5 text-[12.5px] num";

export function MetricTable({ rows, basis }: { rows: MetricRow[]; basis: string }) {
  return (
    <div className="scroll-thin overflow-x-auto">
      <table className="w-full min-w-[640px] border-separate border-spacing-0">
        <caption className="sr-only">Accuracy of every model; ranking basis: {basis}</caption>
        <thead>
          <tr className="border-b border-white/10">
            <th className={th}>Rank</th>
            <th className={th}>Model</th>
            <th className={`${th} text-right`}>Test MAPE</th>
            <th className={`${th} text-right`}>Test WAPE</th>
            <th className={`${th} text-right`}>Test bias</th>
            <th className={`${th} text-right`}>Backtest MAPE</th>
            <th className={`${th} text-right`}>Backtest WAPE</th>
            <th className={th}>Calendar effect</th>
          </tr>
        </thead>
        <tbody>
          {[...rows].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)).map((r) => (
            <tr key={r.key} className={`${r.isRecommended ? "bg-[rgba(94,234,212,0.06)]" : ""} ${r.available ? "" : "opacity-55"}`}>
              <td className={td}>{r.rank ?? DASH}</td>
              <td className="px-2 py-1.5 text-[12.5px]">
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: r.color }} />
                  <span className="font-medium text-ink">{r.label}</span>
                  {r.isBest && (
                    <Badge tone="citrus">
                      <Star size={10} aria-hidden /> best
                    </Badge>
                  )}
                  {r.isRecommended && (
                    <Badge tone="accent">
                      <Check size={10} aria-hidden /> planning model
                    </Badge>
                  )}
                </span>
                {!r.available && <div className="mt-0.5 text-[11px] text-muted">Disabled: {r.reason}</div>}
              </td>
              <td className={`${td} text-right`}>
                {fmtPct(r.testMape)}
                {r.mapeExcluded > 0 && <span className="text-warning" title={`${r.mapeExcluded} near-zero month(s) excluded from MAPE`}>*</span>}
              </td>
              <td className={`${td} text-right`}>{fmtPct(r.testWape)}</td>
              <td className={`${td} text-right`}>{fmtSignedPct(r.testBias)}</td>
              <td className={`${td} text-right`}>{fmtPct(r.btMape)}</td>
              <td className={`${td} text-right font-semibold`}>{fmtPct(r.btWape)}</td>
              <td className="px-2 py-1.5 text-[12px] text-ink-2">{r.usesCalendar ? "uses days-in-month" : "no"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ForecastTable({ result, model }: { result: PipelineResult; model: ModelKey }) {
  const rows = forecastRows(result, model);
  const m = result.models[model];
  return (
    <div className="scroll-thin overflow-x-auto">
      <table className="w-full min-w-[420px]">
        <caption className="mb-1 text-left text-[11.5px] text-muted">
          {m.label} · {INTERVAL_LABEL[m.interval_type]}
        </caption>
        <thead>
          <tr>
            <th className={th}>Month</th>
            <th className={`${th} text-right`}>Forecast</th>
            <th className={`${th} text-right`}>80% range</th>
            <th className={`${th} text-right`}>95% range</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.month} className="border-t border-white/5">
              <td className="px-2 py-1.5 text-[12.5px]">{monthLabel(r.month)}</td>
              <td className={`${td} text-right font-semibold text-ink`}>{fmtUnits(r.point)}</td>
              <td className={`${td} text-right text-ink-2`}>{r.lower80 == null ? "not available" : `${fmtUnits(r.lower80)} – ${fmtUnits(r.upper80)}`}</td>
              <td className={`${td} text-right text-ink-2`}>{r.lower95 == null ? "not available" : `${fmtUnits(r.lower95)} – ${fmtUnits(r.upper95)}`}</td>
            </tr>
          ))}
          <tr className="border-t border-white/10">
            <td className="px-2 py-1.5 text-[12.5px] font-medium">Total</td>
            <td className={`${td} text-right font-semibold text-ink`}>{fmtUnits(rows.reduce((s, r) => s + r.point, 0))}</td>
            <td colSpan={2} />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function FeatureTableView({ result }: { result: PipelineResult }) {
  const f = featureTable(result);
  const cols = f.columns.filter((c) => c !== "t");
  return (
    <div className="scroll-thin max-h-[420px] overflow-auto">
      <table className="w-full min-w-[820px]">
        <caption className="sr-only">Engineered features for every month</caption>
        <thead className="sticky top-0 bg-[rgba(8,22,38,0.95)]">
          <tr>
            <th className={th}>Month</th>
            {cols.map((c) => (
              <th key={c} className={`${th} text-right`}>
                {FEATURE_LABELS[c] ?? c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {f.rows.map((r) => (
            <tr key={r.month} className={`border-t border-white/5 ${r.lostToLags ? "bg-[rgba(250,178,25,0.06)]" : ""}`}>
              <td className="px-2 py-1 text-[12px] whitespace-nowrap">
                {monthLabel(r.month)}
                {r.lostToLags && <span className="ml-1 text-[10px] text-warning">lag rows</span>}
              </td>
              {cols.map((c) => {
                const v = r.values[f.columns.indexOf(c)];
                const digits = c.startsWith("month_") ? 2 : c === "daily_rate" ? 1 : 0;
                return (
                  <td key={c} className={`px-2 py-1 text-right text-[12px] num ${v == null ? "text-muted" : "text-ink-2"}`}>
                    {v == null ? "n/a" : digits ? fmtNum(v, digits) : fmtUnits(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AllocationTable({ result }: { result: PipelineResult }) {
  const a = allocationRows(result);
  if (!a) return <p className="text-[13px] text-ink-2">Select “All 16 regions” to allocate the forecast across regions.</p>;
  return (
    <div className="scroll-thin max-h-[420px] overflow-auto">
      <table className="w-full min-w-[520px]">
        <caption className="mb-1 text-left text-[11.5px] text-muted">
          Shares from the last {a.basisMonths} months of sales, applied to the planning model's forecast
        </caption>
        <thead className="sticky top-0 bg-[rgba(8,22,38,0.95)]">
          <tr>
            <th className={th}>Region</th>
            <th className={`${th} text-right`}>Share</th>
            {a.months.map((m) => (
              <th key={m} className={`${th} text-right`}>
                {monthLabel(m, true)}
              </th>
            ))}
            <th className={`${th} text-right`}>Total</th>
          </tr>
        </thead>
        <tbody>
          {a.rows.map((r) => (
            <tr key={r.region} className="border-t border-white/5">
              <td className="px-2 py-1 text-[12.5px]">{r.region}</td>
              <td className={`${td} text-right text-ink-2`}>{(r.share * 100).toFixed(1)}%</td>
              {r.units.map((u, i) => (
                <td key={i} className={`${td} text-right`}>
                  {fmtUnits(u)}
                </td>
              ))}
              <td className={`${td} text-right font-semibold`}>{fmtUnits(r.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
