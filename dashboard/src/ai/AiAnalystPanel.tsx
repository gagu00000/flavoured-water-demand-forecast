// The AI Analyst: answers the brief's three interpretation questions from the
// live results currently on screen (LLM, grounded), with a clearly labelled
// rule-based fallback.

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, BadgeCheck, Bot, RefreshCw, Sparkles } from "lucide-react";
import { Badge, Button } from "../components/ui";
import { monthLabel } from "../lib/format";
import { hashJson } from "../lib/hash";
import { useInterpretation } from "../llm/interpretation";
import { useDashboard } from "../state/store";

const QUESTIONS = [
  { key: "seasonality_trend", q: "How well did the model capture seasonality or trends?" },
  { key: "best_model", q: "Which model performed best and why?" },
  { key: "recommendations", q: "What recommendations would you give the company?" },
] as const;

export function AiAnalystPanel() {
  const result = useDashboard((s) => s.result);
  const st = useInterpretation();
  const currentHash = result ? hashJson(result.snapshot) : null;
  const stale = st.forHash !== null && st.forHash !== currentHash;
  const busy = st.status === "waiting" || st.status === "loading";
  const it = st.interpretation;

  return (
    <aside id="ai-analyst" className="glass flex scroll-mt-4 flex-col p-4 sm:p-5" aria-label="AI Analyst interpretation">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-[linear-gradient(135deg,rgba(94,234,212,0.3),rgba(196,243,107,0.18))] ring-1 ring-white/15">
            <Sparkles size={18} className="text-accent" aria-hidden />
          </div>
          <div>
            <h2 className="font-display text-[16px] font-semibold">AI Analyst</h2>
            <p className="text-[11.5px] text-ink-2">Interprets the live results on screen</p>
          </div>
        </div>
        <Button onClick={st.regenerate} disabled={busy || !result} title="Ask the AI again for the current results" aria-label="Regenerate interpretation">
          <RefreshCw size={13} className={busy ? "animate-spin" : ""} aria-hidden />
        </Button>
      </header>

      <div className="mb-3 flex flex-wrap items-center gap-1.5" aria-live="polite">
        {busy && <Badge tone="citrus">{st.status === "waiting" ? "New data, updating soon…" : "Analysing the latest results…"}</Badge>}
        {!busy && st.status === "llm" && (
          <Badge tone="good">
            <Bot size={11} aria-hidden /> {st.model}
            {st.fromCache ? " · cached" : ""}
          </Badge>
        )}
        {!busy && st.status === "fallback" && (
          <Badge tone="warning">
            <AlertTriangle size={11} aria-hidden /> Rule-based summary
          </Badge>
        )}
        {st.status === "llm" && (
          <Badge tone={st.unverified.length ? "warning" : "accent"}>
            <BadgeCheck size={11} aria-hidden /> {st.checkedNumbers - st.unverified.length}/{st.checkedNumbers} figures verified
          </Badge>
        )}
        {st.dataVersion != null && <Badge>data v{st.dataVersion}</Badge>}
        {st.lastMonth && <Badge>through {monthLabel(st.lastMonth)}</Badge>}
      </div>

      {st.status === "fallback" && st.reason && (
        <p className="mb-3 rounded-xl bg-[rgba(250,178,25,0.08)] px-3 py-2 text-[12px] leading-snug text-ink-2 ring-1 ring-[rgba(250,178,25,0.25)]">
          {st.reason} Showing a rule-based interpretation of the same numbers instead.
        </p>
      )}

      {!it ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-white/5" />
          ))}
        </div>
      ) : (
        <motion.div
          key={st.forHash}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: stale || busy ? 0.55 : 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="space-y-3"
        >
          {QUESTIONS.map(({ key, q }, i) => (
            <section key={key} className="rounded-xl bg-black/25 p-3 ring-1 ring-white/6">
              <h3 className="mb-1.5 flex gap-2 text-[12.5px] font-semibold text-accent">
                <span className="num">Q{i + 1}</span>
                <span className="text-ink">{q}</span>
              </h3>
              {key === "recommendations" ? (
                <ol className="list-decimal space-y-1 pl-5 text-[13px] leading-relaxed text-ink-2 marker:text-muted">
                  {it.recommendations.map((r, j) => (
                    <li key={j}>{r}</li>
                  ))}
                </ol>
              ) : (
                <p className="text-[13px] leading-relaxed text-ink-2">{it[key]}</p>
              )}
            </section>
          ))}
          <AnimatePresence>
            {it.limitations.length > 0 && (
              <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl p-3 ring-1 ring-white/6">
                <h3 className="mb-1 text-[12px] font-semibold text-ink-2">Limitations</h3>
                <ul className="list-disc space-y-0.5 pl-5 text-[12px] leading-snug text-muted">
                  {it.limitations.map((l, j) => (
                    <li key={j}>{l}</li>
                  ))}
                </ul>
              </motion.section>
            )}
          </AnimatePresence>
          <p className="text-[11px] text-muted">
            Confidence: <b className="text-ink-2">{it.confidence}</b>
            {st.generatedAt && <> · generated {new Date(st.generatedAt).toLocaleTimeString("en-GB")}</>}
            {st.status === "llm" && " · every figure is checked against the computed results"}
            {st.unverified.length > 0 && ` · unverified: ${st.unverified.join(", ")}`}
          </p>
        </motion.div>
      )}
    </aside>
  );
}
