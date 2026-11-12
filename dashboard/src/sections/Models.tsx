import { ForecastChart, TestOverlayChart } from "../charts/ForecastChart";
import { MetricBars } from "../charts/MetricBars";
import { MetricTable } from "../components/tables";
import { Badge, InfoTip, Panel } from "../components/ui";
import type { PipelineResult } from "../engine/types";
import { MODEL_KEYS } from "../engine/types";
import { fmtPct, monthRange } from "../lib/format";
import { metricRows, MODEL_COLORS } from "../viewmodels/models";

const FORMULAS =
  "MAPE = average of |actual − forecast| / actual, over months with actual sales above 1 unit (near-zero months are excluded and counted). " +
  "WAPE = total |actual − forecast| / total actual: robust to zero months and weighted by volume, so it is the ranking metric. " +
  "Bias = total (forecast − actual) / total actual: positive means over-forecasting.";

export function Models({ result }: { result: PipelineResult }) {
  const rows = metricRows(result);
  const m = result.meta;
  const origins = m.backtest_origins.length;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel
          title="WAPE by model"
          task="Task 5"
          subtitle={`Solid: single test window (${monthRange(m.test_months[0], m.test_months[1])}). Hatched: rolling-origin backtest over ${origins} cut-off${origins === 1 ? "" : "s"}.`}
          actions={<InfoTip text={FORMULAS} />}
        >
          <MetricBars rows={rows} metric="wape" />
        </Panel>
        <Panel title="MAPE by model" task="Task 5" subtitle="Same split and horizon for every model, so the comparison is fair." actions={<InfoTip text={FORMULAS} />}>
          <MetricBars rows={rows} metric="mape" />
        </Panel>
      </div>

      <Panel
        title="Model ranking"
        task="Tasks 2 & 5"
        subtitle={
          <>
            Ranked by <b className="text-ink">{m.ranking_basis}</b>
            {m.ranking_basis.startsWith("test") && " (fewer than 3 backtest cut-offs were possible)"}. The planning model is the simplest one within 0.5 WAPE
            points of the best: near-ties are noise, and simpler models are easier to trust.
          </>
        }
      >
        <MetricTable rows={rows} basis={m.ranking_basis} />
      </Panel>

      <Panel title="All models on the test window" task="Task 6" subtitle="Each model trained only on data before the shaded window, then forecasting it.">
        <TestOverlayChart result={result} />
      </Panel>

      <Panel title="Actual vs predicted, model by model" task="Task 6" subtitle="Test-window forecast (bold), backtest forecasts (dashed) and the future forecast with its range.">
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {MODEL_KEYS.map((k) => {
            const mr = result.models[k];
            return (
              <div key={k} className="rounded-2xl bg-black/20 p-3 ring-1 ring-white/5">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-[13px] font-medium">
                    <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: MODEL_COLORS[k] }} />
                    {mr.label}
                  </span>
                  {mr.available ? (
                    <span className="num text-[12px] text-ink-2">test WAPE {fmtPct(mr.metrics_test?.wape)}</span>
                  ) : (
                    <Badge>disabled</Badge>
                  )}
                </div>
                {mr.available ? (
                  <ForecastChart result={result} model={k} height={200} compact />
                ) : (
                  <p className="grid h-[200px] place-items-center px-4 text-center text-[12.5px] text-ink-2">{mr.reason}</p>
                )}
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
