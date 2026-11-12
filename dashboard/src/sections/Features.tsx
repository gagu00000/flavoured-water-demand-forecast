import { ImportanceChart, LagScatter } from "../charts/FeatureCharts";
import { FeatureTableView } from "../components/tables";
import { Badge, Panel } from "../components/ui";
import type { PipelineResult } from "../engine/types";
import { featureTable } from "../viewmodels/features";

export function Features({ result }: { result: PipelineResult }) {
  const f = featureTable(result);
  const avail = result.features.availability;
  const tooFew = f.usableForTreesInTest < 12;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
        <Panel title="What the history allows" task="Task 1" subtitle={`With ${result.meta.n_months} months of data:`}>
          <ul className="space-y-2">
            {avail.map((a) => (
              <li key={a.feature} className="flex items-start gap-2.5">
                <Badge tone={a.available ? "good" : "warning"} className="mt-0.5 shrink-0">
                  {a.available ? "available" : "not yet"}
                </Badge>
                <div>
                  <div className="text-[13px] font-medium text-ink">{a.feature}</div>
                  <div className="text-[12px] leading-snug text-ink-2">{a.note}</div>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Training-row budget for the ML models" subtitle="Lag features cost the earliest months as training rows.">
          <div className="space-y-3">
            <Budget label="Months of data" value={result.meta.n_months} max={result.meta.n_months} color="#5598e7" />
            <Budget label="Training window (before the test months)" value={result.meta.n_train} max={result.meta.n_months} color="#86b6ef" />
            <Budget label="Rows a tree model can learn from" value={f.usableForTreesInTest} max={result.meta.n_months} color={tooFew ? "#fab219" : "#199e70"} />
          </div>
          {tooFew && (
            <p className="mt-3 text-[12.5px] leading-snug text-warning">
              Only {f.usableForTreesInTest} training rows: too few for Random Forest or XGBoost to learn reliable patterns. Treat their results with caution.
            </p>
          )}
        </Panel>
      </div>
      <Panel title="Engineered features, month by month" task="Task 1" subtitle={`Lags and rolling mean use only earlier months, so nothing leaks from the future. Highlighted rows are lost to lags (${f.rowsLost}).`}>
        <FeatureTableView result={result} />
      </Panel>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Feature importance" subtitle="Share of each tree model's splits, after refitting on all data.">
          <ImportanceChart result={result} />
        </Panel>
        <Panel title="Does last month predict this month?" subtitle="Lag-1 scatter. A tight diagonal would mean strong memory; a cloud means random variation around a level.">
          <LagScatter result={result} />
        </Panel>
      </div>
    </div>
  );
}

function Budget({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-[12.5px]">
        <span className="text-ink-2">{label}</span>
        <span className="num font-semibold">{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/8">
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${(value / Math.max(max, 1)) * 100}%`, background: color }} />
      </div>
    </div>
  );
}
