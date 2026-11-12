// Global controls: what to forecast (product, region, customer type), how much
// data the live feed has released, and the train-test split / horizon.

import { ChevronRight, RotateCcw, SlidersHorizontal } from "lucide-react";
import { ALL } from "../data/cube";
import { LAUNCH_YEAR_END, MAX_HORIZON, maxTestSize, MIN_HORIZON, MIN_TEST } from "../data/scenario";
import { monthLabel } from "../lib/format";
import { useDashboard } from "../state/store";
import { useUi } from "../state/ui";
import { Button, Segmented, Slider } from "./ui";

export function ControlBar() {
  const cube = useDashboard((s) => s.cube);
  const scenario = useDashboard((s) => s.scenario);
  const { setFilters, setTestSize, setHorizon, setFeedIndex, advanceFeed, resetData } = useDashboard.getState();
  const open = useUi((s) => s.controlsOpen);
  const setOpen = useUi((s) => s.setControlsOpen);
  if (!cube) return null;

  const n = scenario.feedIndex + 1 + scenario.customMonths.length;
  const maxTest = maxTestSize(n);
  const userData = scenario.customMonths.length > 0 || Object.keys(scenario.overrides).length > 0;
  const atEnd = scenario.feedIndex >= cube.months.length - 1;

  return (
    <div className="glass p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2 lg:hidden">
        <span className="text-[13px] text-ink-2">
          {scenario.filters.product} · through {monthLabel(cube.months[scenario.feedIndex])}
        </span>
        <Button onClick={() => setOpen(!open)} aria-pressed={open}>
          <SlidersHorizontal size={14} aria-hidden /> Controls
        </Button>
      </div>

      <div className={`${open ? "mt-3 grid" : "hidden"} gap-4 lg:mt-0 lg:grid lg:grid-cols-[1.15fr_1.4fr_1fr_1fr]`}>
        {/* What to forecast */}
        <fieldset className="min-w-0 space-y-2">
          <legend className="mb-1 text-[11.5px] font-medium tracking-wide text-ink-2 uppercase">Series</legend>
          <div className="grid grid-cols-2 gap-2">
            <label className="sr-only" htmlFor="product">Product</label>
            <select
              id="product"
              value={scenario.filters.product}
              onChange={(e) => setFilters({ product: e.target.value })}
              className="px-2 py-1.5 text-[13px]"
            >
              {cube.products.map((p) => (
                <option key={p} value={p}>
                  {p === "Volvic Touch" ? `${p} (new)` : p}
                </option>
              ))}
            </select>
            <label className="sr-only" htmlFor="region">Region</label>
            <select
              id="region"
              value={scenario.filters.region}
              onChange={(e) => setFilters({ region: e.target.value })}
              className="px-2 py-1.5 text-[13px]"
            >
              <option value={ALL}>All 16 regions</option>
              {cube.regions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <Segmented
            label="Customer type"
            value={scenario.filters.customerType}
            onChange={(v) => setFilters({ customerType: v })}
            options={[
              { value: ALL, label: "All customers" },
              { value: "B2B", label: "B2B" },
              { value: "B2C", label: "B2C" },
            ]}
          />
          {userData && <p className="text-[11px] text-warning">Changing the series clears data you entered.</p>}
        </fieldset>

        {/* Live data feed */}
        <div className="min-w-0 space-y-2">
          <Slider
            label="Data available through"
            value={scenario.feedIndex}
            min={LAUNCH_YEAR_END}
            max={cube.months.length - 1}
            onChange={setFeedIndex}
            format={(i) => monthLabel(cube.months[i])}
            hint={
              scenario.customMonths.length
                ? `+ ${scenario.customMonths.length} month(s) you entered`
                : scenario.feedIndex === LAUNCH_YEAR_END
                  ? "Launch year: the first 12 months of sales"
                  : `${scenario.feedIndex + 1} months released by the live feed`
            }
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              onClick={advanceFeed}
              disabled={atEnd || scenario.customMonths.length > 0}
              title={atEnd ? "All dataset months are released; add your own on the Live Data Feed tab" : "Release the next month of actual sales"}
            >
              Next month arrives <ChevronRight size={14} aria-hidden />
            </Button>
            <Button onClick={resetData} title="Back to the launch year and clear entered data">
              <RotateCcw size={13} aria-hidden /> Reset
            </Button>
          </div>
        </div>

        <Slider
          label="Test window"
          value={Math.min(scenario.testSize, maxTest)}
          min={MIN_TEST}
          max={maxTest}
          onChange={setTestSize}
          format={(v) => `${v} months`}
          hint={`Chronological: last ${Math.min(scenario.testSize, maxTest)} months held out; ${n - Math.min(scenario.testSize, maxTest)} to train`}
        />
        <Slider
          label="Forecast horizon"
          value={scenario.horizon}
          min={MIN_HORIZON}
          max={MAX_HORIZON}
          onChange={setHorizon}
          format={(v) => `${v} month${v > 1 ? "s" : ""}`}
          hint="The brief asks for the next 3 months"
        />
      </div>
    </div>
  );
}
