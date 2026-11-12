// Page header: product context, live-engine status and data version.

import { AnimatePresence, motion } from "framer-motion";
import { Cpu, Droplets } from "lucide-react";
import { fmtUnits } from "../lib/format";
import { useDashboard } from "../state/store";
import { Badge } from "./ui";

const BUBBLES = [
  { left: "8%", size: 6, delay: "0s", dur: "7s" },
  { left: "22%", size: 4, delay: "2s", dur: "9s" },
  { left: "41%", size: 8, delay: "1s", dur: "8s" },
  { left: "63%", size: 5, delay: "3.5s", dur: "10s" },
  { left: "79%", size: 7, delay: "0.5s", dur: "7.5s" },
  { left: "92%", size: 4, delay: "2.5s", dur: "9.5s" },
];

export function EngineStatus() {
  const engine = useDashboard((s) => s.engine);
  const running = useDashboard((s) => s.running);
  const ms = useDashboard((s) => s.lastRunMs);
  const label =
    engine.status === "ready"
      ? running
        ? "Recomputing all models…"
        : `Live engine ready${ms != null ? ` · last run ${fmtUnits(ms)} ms` : ""}`
      : engine.status === "error"
        ? "Live engine unavailable"
        : `Starting live engine · ${engine.pct}%`;
  const tone = engine.status === "error" ? "critical" : engine.status === "ready" ? (running ? "citrus" : "good") : "warning";

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end" aria-live="polite">
      <Badge tone={tone}>
        <Cpu size={12} aria-hidden />
        <span data-testid="engine-status">{label}</span>
      </Badge>
      <AnimatePresence>
        {engine.status === "loading" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="h-1 w-48 overflow-hidden rounded-full bg-white/10"
            role="progressbar"
            aria-label="Live engine loading"
            aria-valuenow={engine.pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <motion.div className="h-full bg-[linear-gradient(90deg,#5eead4,#38bdf8)]" animate={{ width: `${engine.pct}%` }} />
          </motion.div>
        )}
      </AnimatePresence>
      {engine.status === "loading" && (
        <span className="text-[11px] text-muted">Showing precomputed results meanwhile. {engine.step}.</span>
      )}
      {engine.status === "error" && (
        <span className="max-w-xs text-[11px] text-ink-2">Precomputed results remain visible. Reload the page to retry.</span>
      )}
    </div>
  );
}

export function Header() {
  const scenario = useDashboard((s) => s.scenario);
  return (
    <header className="glass relative overflow-hidden px-4 py-4 sm:px-6 sm:py-5">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {BUBBLES.map((b, i) => (
          <span key={i} className="bubble" style={{ left: b.left, width: b.size, height: b.size, animationDelay: b.delay, animationDuration: b.dur }} />
        ))}
      </div>
      <div className="relative flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[linear-gradient(135deg,rgba(94,234,212,0.25),rgba(56,189,248,0.15))] ring-1 ring-white/15">
            <Droplets className="text-accent" size={22} aria-hidden />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold tracking-tight sm:text-2xl">Flavoured Water Demand Forecast</h1>
            <p className="text-[13px] text-ink-2">
              {scenario.filters.product} · new product launch in 16 German regional markets · production &amp; distribution planning
            </p>
          </div>
        </div>
        <EngineStatus />
      </div>
    </header>
  );
}
