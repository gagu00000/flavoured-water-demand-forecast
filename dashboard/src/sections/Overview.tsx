import { ForecastChart } from "../charts/ForecastChart";
import { KpiTiles } from "../components/KpiTiles";
import { ModelPicker, useFocusModel } from "../components/ModelPicker";
import { ForecastTable } from "../components/tables";
import { Panel } from "../components/ui";
import type { PipelineResult } from "../engine/types";
import { monthRange } from "../lib/format";

export function Overview({ result }: { result: PipelineResult }) {
  const model = useFocusModel(result);
  const m = result.meta;
  return (
    <div className="space-y-4">
      <KpiTiles result={result} />
      <Panel
        title="Actual vs predicted sales and the next-months forecast"
        task="Tasks 4 & 6"
        subtitle={
          <>
            Trained on {monthRange(m.train_months[0], m.train_months[1])}, tested on {monthRange(m.test_months[0], m.test_months[1])} (shaded),
            then refitted on all {m.n_months} months to forecast ahead. Dashed thin lines are forecasts made at earlier backtest cut-offs.
          </>
        }
      >
        <div className="mb-3">
          <ModelPicker result={result} />
        </div>
        <ForecastChart result={result} model={model} height={380} />
      </Panel>
      <Panel title="Forecast table" subtitle="Point forecast with uncertainty ranges where the model supports them.">
        <ForecastTable result={result} model={model} />
      </Panel>
    </div>
  );
}
