import { MotionConfig, motion } from "framer-motion";
import { AlertTriangle, Sparkles } from "lucide-react";
import { type ComponentType, type KeyboardEvent, useRef } from "react";
import { AiAnalystPanel } from "./ai/AiAnalystPanel";
import { ControlBar } from "./components/ControlBar";
import { Header } from "./components/Header";
import type { PipelineResult } from "./engine/types";
import { useInterpretationSync } from "./llm/interpretation";
import { DataFeed } from "./sections/DataFeed";
import { Features } from "./sections/Features";
import { Models } from "./sections/Models";
import { Overview } from "./sections/Overview";
import { Patterns } from "./sections/Patterns";
import { Regions } from "./sections/Regions";
import { useDashboard } from "./state/store";
import { SECTIONS, type SectionId, useUi } from "./state/ui";
import { useEngineSync } from "./state/useEngineSync";

const VIEWS: Record<SectionId, ComponentType<{ result: PipelineResult }>> = {
  overview: Overview,
  models: Models,
  patterns: Patterns,
  features: Features,
  regions: Regions,
  data: DataFeed,
};

function Tabs() {
  const section = useUi((s) => s.section);
  const setSection = useUi((s) => s.setSection);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  // Arrow-key navigation between tabs (WAI-ARIA tabs pattern)
  const onKey = (e: KeyboardEvent, i: number) => {
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = (i + dir + SECTIONS.length) % SECTIONS.length;
    setSection(SECTIONS[next].id);
    refs.current[next]?.focus();
  };

  return (
    <nav className="glass scroll-thin sticky top-2 z-20 overflow-x-auto p-1" aria-label="Dashboard sections">
      <div role="tablist" className="flex min-w-max gap-1">
        {SECTIONS.map((s, i) => {
          const active = s.id === section;
          return (
            <button
              key={s.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              role="tab"
              id={`tab-${s.id}`}
              aria-selected={active}
              aria-controls={`panel-${s.id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => setSection(s.id)}
              onKeyDown={(e) => onKey(e, i)}
              className={`relative rounded-[12px] px-3.5 py-2 text-[13px] font-medium whitespace-nowrap transition-colors ${active ? "text-ink" : "text-ink-2 hover:text-ink"}`}
            >
              {active && (
                <motion.span
                  layoutId="tab-pill"
                  className="absolute inset-0 rounded-[12px] bg-white/10 ring-1 ring-inset ring-white/15"
                  transition={{ type: "spring", stiffness: 420, damping: 36 }}
                />
              )}
              <span className="relative">{s.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export default function App() {
  useEngineSync();
  useInterpretationSync();
  const result = useDashboard((s) => s.result);
  const cubeError = useDashboard((s) => s.cubeError);
  const runError = useDashboard((s) => s.runError);
  const section = useUi((s) => s.section);
  const View = VIEWS[section];

  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto max-w-[1680px] space-y-3 px-4 py-4 sm:px-6 sm:py-6">
        <Header />
        <ControlBar />

        {(cubeError || runError) && (
          <div role="alert" className="glass flex items-start gap-2 border-[rgba(230,103,103,0.35)] p-3 text-[13px]">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-critical" aria-hidden />
            <span>
              {cubeError ? `The sales data could not be loaded: ${cubeError}` : `The models could not run on this data: ${runError}`}
            </span>
          </div>
        )}

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
          <main className="min-w-0 space-y-3">
            <Tabs />
            {result ? (
              // Enter-only animation: rapid tab switching can never leave a stale section on screen
              <motion.div
                key={section}
                id={`panel-${section}`}
                role="tabpanel"
                aria-labelledby={`tab-${section}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
              >
                <View result={result} />
              </motion.div>
            ) : (
              <div className="glass grid h-64 place-items-center text-[13px] text-ink-2" aria-busy="true">
                Loading sales data…
              </div>
            )}
          </main>
          <div className="xl:sticky xl:top-2">
            <AiAnalystPanel />
          </div>
        </div>

        {/* Small screens: the AI Analyst sits below the charts, so offer a shortcut to it */}
        <a
          href="#ai-analyst"
          className="fixed right-4 bottom-4 z-30 inline-flex items-center gap-1.5 rounded-full bg-[linear-gradient(135deg,#5eead4,#38bdf8)] px-3.5 py-2 text-[13px] font-semibold text-[#04212a] shadow-[0_10px_30px_-10px_rgba(94,234,212,0.7)] xl:hidden"
        >
          <Sparkles size={14} aria-hidden /> AI Analyst
        </a>

        <footer className="px-1 pt-2 pb-16 xl:pb-6 text-[11.5px] leading-relaxed text-muted">
          Data: Kaggle “Beverage Sales” (sebastianwillmann, MIT licence), synthetic order lines 2021–2023, aggregated to months; December 2023 has 30
          observed days. Models run in your browser (Python via Pyodide, the same code as the accompanying notebook). The AI interpretation is
          generated server-side by NVIDIA Nemotron 3.5 Bolt E4B from the computed results and verified key facts only. AI in Operations lab exercise.
        </footer>
      </div>
    </MotionConfig>
  );
}
