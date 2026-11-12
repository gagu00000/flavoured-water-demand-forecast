import { useMemo } from "react";
import { RegionHeatmapChart, ShareBars } from "../charts/RegionCharts";
import { AllocationTable } from "../components/tables";
import { Panel } from "../components/ui";
import { ALL } from "../data/cube";
import type { PipelineResult } from "../engine/types";
import { useDashboard } from "../state/store";
import { regionHeatmap } from "../viewmodels/regions";

export function Regions({ result }: { result: PipelineResult }) {
  const cube = useDashboard((s) => s.cube);
  const scenario = useDashboard((s) => s.scenario);
  const filters = useMemo(() => ({ ...scenario.filters, region: ALL }), [scenario.filters]);
  const heat = useMemo(() => (cube ? regionHeatmap(cube, filters, scenario.feedIndex + 1) : null), [cube, filters, scenario.feedIndex]);
  if (!heat) return null;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Panel title="Units per day by region" subtitle={`${scenario.filters.product}, all regions, months released so far. Per-day rates remove the month-length effect.`}>
          <RegionHeatmapChart data={heat} />
        </Panel>
        <Panel
          title="Share of volume"
          subtitle={`Largest: ${heat.shares[0].region} (${(heat.shares[0].share * 100).toFixed(1)}%). Smallest: ${heat.shares[heat.shares.length - 1].region} (${(heat.shares[heat.shares.length - 1].share * 100).toFixed(1)}%).`}
        >
          <ShareBars data={heat} />
        </Panel>
      </div>
      <Panel
        title="Distribution plan: forecast allocated by region"
        task="Recommendation"
        subtitle="Single-region series are much noisier than the national series (see the notebook, §4.2), so regional plans allocate the national forecast by recent share."
      >
        <AllocationTable result={result} />
      </Panel>
    </div>
  );
}
