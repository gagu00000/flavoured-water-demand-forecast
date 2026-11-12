// The "real-time data" section: release actual months one by one (replay), enter
// or correct sales figures, and see how earlier forecasts compared with what
// actually happened. Every change re-runs all models and the AI interpretation.

import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Pause, Play, Plus, RotateCcw, Undo2 } from "lucide-react";
import { type FormEvent, useEffect, useId, useMemo, useState } from "react";
import { Badge, Button, Panel } from "../components/ui";
import { sliceSeries } from "../data/cube";
import { LAUNCH_YEAR_END, nextEntryMonth, validateUnits } from "../data/scenario";
import type { PipelineResult } from "../engine/types";
import { fmtPct, fmtSignedPct, fmtUnits, monthLabel } from "../lib/format";
import { useDashboard } from "../state/store";
import { feedLogView } from "../viewmodels/feed";

const AUTOPLAY_MS = 2500;

export function DataFeed({ result }: { result: PipelineResult }) {
  const cube = useDashboard((s) => s.cube)!;
  const scenario = useDashboard((s) => s.scenario);
  const running = useDashboard((s) => s.running);
  const engineReady = useDashboard((s) => s.engine.status === "ready");
  const changeLog = useDashboard((s) => s.changeLog);
  const forecastLog = useDashboard((s) => s.forecastLog);
  const { advanceFeed, setFeedIndex, resetData } = useDashboard.getState();
  const [playing, setPlaying] = useState(false);

  const atEnd = scenario.feedIndex >= cube.months.length - 1;
  const blocked = scenario.customMonths.length > 0;

  // Auto-play: release a month every few seconds, waiting for each re-run to finish
  useEffect(() => {
    if (!playing) return;
    if (atEnd || blocked) {
      setPlaying(false);
      return;
    }
    const id = window.setTimeout(() => {
      if (!useDashboard.getState().running && engineReady) advanceFeed();
    }, AUTOPLAY_MS);
    return () => window.clearTimeout(id);
  }, [playing, scenario.feedIndex, running, atEnd, blocked, engineReady, advanceFeed]);

  const log = feedLogView(forecastLog);

  return (
    <div className="space-y-4">
      <Panel
        title="Live data feed"
        task="Real-time data"
        subtitle="The dashboard starts at the end of the launch year. Release the following months one at a time as if sales were arriving; each arrival re-runs every model and refreshes the AI interpretation."
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setFeedIndex(scenario.feedIndex - 1)} disabled={scenario.feedIndex <= LAUNCH_YEAR_END || blocked} aria-label="Previous month">
            <ChevronLeft size={14} aria-hidden />
          </Button>
          <div className="num min-w-[150px] rounded-xl bg-black/30 px-3 py-1.5 text-center text-[13px] ring-1 ring-white/10">
            Through <b>{monthLabel(cube.months[scenario.feedIndex])}</b>
          </div>
          <Button variant="primary" onClick={advanceFeed} disabled={atEnd || blocked}>
            Next month arrives <ChevronRight size={14} aria-hidden />
          </Button>
          <Button onClick={() => setPlaying((p) => !p)} disabled={(atEnd || blocked) && !playing} aria-pressed={playing}>
            {playing ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />} {playing ? "Pause" : "Auto-play"}
          </Button>
          <Button onClick={resetData}>
            <RotateCcw size={13} aria-hidden /> Reset to launch year
          </Button>
          <Badge tone="accent" className="ml-auto">
            data version {scenario.dataVersion}
          </Badge>
        </div>
        {blocked && (
          <p className="mt-2 text-[12px] text-warning">Remove the months you entered to continue the replay from the dataset.</p>
        )}
        <Timeline months={cube.months} feedIndex={scenario.feedIndex} custom={scenario.customMonths.map((c) => c.month)} />
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <AddMonth result={result} />
        <Panel title="Forecast vs what actually happened" subtitle="Each time a month arrives, the forecast the planning model made for it beforehand is scored against the actual.">
          {log.rows.length === 0 ? (
            <p className="text-[13px] text-ink-2">Release a month with “Next month arrives” to start the log.</p>
          ) : (
            <>
              <div className="mb-2 flex flex-wrap gap-2 text-[12.5px]">
                <Badge tone="accent">live WAPE {fmtPct(log.summary?.wape)}</Badge>
                <Badge>live MAPE {fmtPct(log.summary?.mape)}</Badge>
                {log.coverage && (
                  <Badge tone={log.coverage.inside === log.coverage.total ? "good" : "warning"}>
                    {log.coverage.inside}/{log.coverage.total} inside the 95% range
                  </Badge>
                )}
              </div>
              <div className="scroll-thin max-h-[300px] overflow-auto">
                <table className="w-full min-w-[460px]">
                  <thead className="sticky top-0 bg-[rgba(8,22,38,0.95)]">
                    <tr className="text-left text-[11px] tracking-wide text-muted uppercase">
                      <th className="px-2 py-1">Month</th>
                      <th className="px-2 py-1">Model</th>
                      <th className="px-2 py-1 text-right">Forecast</th>
                      <th className="px-2 py-1 text-right">Actual</th>
                      <th className="px-2 py-1 text-right">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...log.rows].reverse().map((r) => (
                      <tr key={r.month} className="border-t border-white/5 text-[12.5px]">
                        <td className="px-2 py-1">{monthLabel(r.month)}</td>
                        <td className="px-2 py-1 text-ink-2">{r.model}</td>
                        <td className="num px-2 py-1 text-right">{fmtUnits(r.forecast)}</td>
                        <td className="num px-2 py-1 text-right">{fmtUnits(r.actual)}</td>
                        <td className={`num px-2 py-1 text-right ${r.insideRange === false ? "text-warning" : "text-ink-2"}`}>{fmtSignedPct(r.errorPct, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <CorrectMonths />
        <Panel title="Change log" subtitle="Every data change gets a new version; the AI interpretation names the version it describes.">
          <ol className="scroll-thin max-h-[320px] space-y-1.5 overflow-auto">
            <AnimatePresence initial={false}>
              {changeLog.map((c) => (
                <motion.li
                  key={c.version}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex items-baseline gap-2 text-[12.5px]"
                >
                  <Badge tone="accent">v{c.version}</Badge>
                  <span className="text-ink">{c.text}</span>
                  <span className="ml-auto shrink-0 text-[11px] text-muted">{new Date(c.at).toLocaleTimeString("en-GB")}</span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ol>
        </Panel>
      </div>
    </div>
  );
}

function Timeline({ months, feedIndex, custom }: { months: string[]; feedIndex: number; custom: string[] }) {
  return (
    <div className="mt-4" aria-label="Months released so far">
      <div className="flex gap-[3px]">
        {months.map((m, i) => (
          <motion.span
            key={m}
            title={monthLabel(m)}
            className="h-6 flex-1 rounded-[4px]"
            animate={{
              backgroundColor: i <= LAUNCH_YEAR_END ? "#2a78d6" : i <= feedIndex ? "#5eead4" : "rgba(255,255,255,0.06)",
              scale: i === feedIndex ? [1, 1.25, 1] : 1,
            }}
            transition={{ duration: 0.5 }}
          />
        ))}
        {custom.map((m) => (
          <span key={m} title={`${monthLabel(m)} (entered)`} className="h-6 flex-1 rounded-[4px] bg-[#c4f36b]" />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-ink-2">
        <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-[#2a78d6]" />Launch year (2021)</span>
        <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-[#5eead4]" />Released by the feed</span>
        <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-white/10" />Not yet arrived</span>
        {custom.length > 0 && <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-[#c4f36b]" />Entered by you</span>}
      </div>
    </div>
  );
}

function AddMonth({ result }: { result: PipelineResult }) {
  const cube = useDashboard((s) => s.cube)!;
  const scenario = useDashboard((s) => s.scenario);
  const { addCustomMonth, removeLastCustomMonth } = useDashboard.getState();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const month = nextEntryMonth(cube, scenario);
  const recent = result.series.slice(-6).map((r) => r.units);
  const inDataset = cube.months.includes(month);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const units = Number(value.replace(/[,\s]/g, ""));
    const problem = value.trim() === "" ? "Enter a number." : validateUnits(units, recent);
    setError(problem);
    if (problem) return;
    addCustomMonth(units);
    setValue("");
  };

  return (
    <Panel
      title="Add new sales data"
      subtitle={
        inDataset
          ? `Type your own figure for ${monthLabel(month)} instead of waiting for the dataset's actual. Useful for testing "what if sales were…" scenarios.`
          : `Enter the actual sales for ${monthLabel(month)}, the first month after the dataset ends.`
      }
    >
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2" noValidate>
        <div className="min-w-[200px] flex-1">
          <label htmlFor={id} className="mb-1 block text-[11.5px] font-medium tracking-wide text-ink-2 uppercase">
            Units sold in {monthLabel(month)}
          </label>
          <input
            id={id}
            inputMode="numeric"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={`e.g. ${fmtUnits(recent.at(-1) ?? 0)}`}
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-err` : undefined}
            className="num w-full rounded-xl border border-[var(--border-strong)] bg-black/40 px-3 py-2 text-[14px]"
          />
        </div>
        <Button type="submit" variant="primary">
          <Plus size={14} aria-hidden /> Add {monthLabel(month, true)}
        </Button>
        <Button onClick={removeLastCustomMonth} disabled={!scenario.customMonths.length}>
          <Undo2 size={13} aria-hidden /> Remove last entered
        </Button>
      </form>
      {error && (
        <p id={`${id}-err`} role="alert" className="mt-2 text-[12.5px] text-critical">
          {error}
        </p>
      )}
      {scenario.customMonths.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {scenario.customMonths.map((c) => (
            <li key={c.month}>
              <Badge tone="citrus">
                {monthLabel(c.month)}: <span className="num">{fmtUnits(c.units)}</span>
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function CorrectMonths() {
  const cube = useDashboard((s) => s.cube)!;
  const scenario = useDashboard((s) => s.scenario);
  const { setOverride } = useDashboard.getState();
  const base = cube.months.slice(0, scenario.feedIndex + 1);
  // Original dataset figures (before any correction), for placeholders and validation
  const original = useMemo(
    () => new Map(sliceSeries(cube, scenario.filters).map((r) => [r.month, r.units] as const)),
    [cube, scenario.filters],
  );

  return (
    <Panel title="Correct a past month" subtitle="Change any released month's figure (for example after a late delivery report). Press Enter to apply; clear the box to restore the original.">
      <div className="scroll-thin grid max-h-[320px] grid-cols-2 gap-2 overflow-auto sm:grid-cols-3">
        {base.map((m) => {
          const overridden = m in scenario.overrides;
          return (
            <label key={m} className={`rounded-xl p-2 ring-1 ring-inset ${overridden ? "bg-[rgba(196,243,107,0.06)] ring-[rgba(196,243,107,0.3)]" : "ring-white/8"}`}>
              <span className="mb-0.5 block text-[11px] text-muted">
                {monthLabel(m)} {overridden && <span className="text-citrus">· edited</span>}
              </span>
              <input
                key={`${m}-${scenario.dataVersion}`}
                inputMode="numeric"
                defaultValue={overridden ? String(scenario.overrides[m]) : ""}
                placeholder={fmtUnits(original.get(m))}
                aria-label={`Units sold in ${monthLabel(m)}`}
                className="num w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-[13px]"
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  const raw = (e.target as HTMLInputElement).value.replace(/[,\s]/g, "");
                  if (raw === "") {
                    if (overridden) setOverride(m, null);
                    return;
                  }
                  const n = Number(raw);
                  const input = e.target as HTMLInputElement;
                  const problem = validateUnits(n, [original.get(m) ?? n]);
                  if (problem === null) setOverride(m, n);
                  else {
                    input.setCustomValidity(problem);
                    input.reportValidity();
                  }
                }}
                onInput={(e) => (e.target as HTMLInputElement).setCustomValidity("")}
              />
            </label>
          );
        })}
      </div>
    </Panel>
  );
}
