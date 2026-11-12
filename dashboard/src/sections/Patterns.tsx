import { AcfChart, CalendarScatter, SeasonalityChart, TrendChart } from "../charts/AnalysisCharts";
import { Badge, Panel } from "../components/ui";
import type { PipelineResult } from "../engine/types";
import { fmtNum, fmtP, fmtSignedPct } from "../lib/format";
import { acfView, calendarView, seasonalityView, trendView } from "../viewmodels/analysis";

export function Patterns({ result }: { result: PipelineResult }) {
  const t = trendView(result);
  const s = seasonalityView(result);
  const c = calendarView(result);
  const a = acfView(result);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Fact label="Volume trend" value={`${fmtSignedPct(t.pctPerYear)} / yr`} note={fmtP(t.pValue)} ok={t.significant === false} />
        <Fact label="Seasonality" value={s.testable ? fmtP(s.pValue) : "not testable yet"} note={s.testable ? "month-of-year ANOVA" : "needs 24+ months"} ok={s.testable ? !(s.pValue! < 0.05) : null} />
        <Fact label="Days-in-month effect" value={`R² = ${fmtNum(c.r2)}`} note="share of monthly variation explained" ok={null} />
        <Fact label="Revenue trend" value={t.revenuePctPerYear == null ? "n/a" : `${fmtSignedPct(t.revenuePctPerYear)} / yr`} note={t.revenuePctPerYear == null ? "not available with edited data" : fmtP(t.revenuePValue)} ok={null} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Trend: units per sales day" task="Task 7a" subtitle={t.verdict}>
          <TrendChart result={result} />
        </Panel>
        <Panel title="Seasonality: month-of-year effect" task="Task 7a" subtitle={s.verdict}>
          <SeasonalityChart result={result} />
        </Panel>
        <Panel
          title="The calendar effect"
          task="Seasonal indicator"
          subtitle={`The number of days explains R² = ${fmtNum(c.r2)} of the monthly variation, so February always dips. Calendar-aware models capture this.`}
        >
          <CalendarScatter result={result} />
        </Panel>
        <Panel
          title="Autocorrelation"
          subtitle={
            a.bound == null
              ? "Too few months to estimate."
              : `${a.outside.length} of ${a.lags.length} lags outside the noise band (±${fmtNum(a.bound)}): last month says little about next month beyond the overall level.`
          }
        >
          <AcfChart result={result} />
        </Panel>
      </div>
    </div>
  );
}

function Fact({ label, value, note, ok }: { label: string; value: string; note: string; ok: boolean | null }) {
  return (
    <div className="glass p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11.5px] font-medium tracking-wide text-ink-2 uppercase">{label}</span>
        {ok === true && <Badge tone="neutral">not significant</Badge>}
        {ok === false && <Badge tone="citrus">significant</Badge>}
      </div>
      <div className="num mt-1 font-display text-xl font-semibold">{value}</div>
      <div className="text-[12px] text-muted">{note}</div>
    </div>
  );
}
