// Headline numbers for production planning.

import { motion } from "framer-motion";
import { CalendarClock, Factory, Target, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";
import type { PipelineResult } from "../engine/types";
import { fmtPct, fmtUnits, monthLabel, monthRange } from "../lib/format";
import { seasonalityView, trendView } from "../viewmodels/analysis";
import { kpis, MODEL_COLORS } from "../viewmodels/models";
import { AnimatedNumber } from "./ui";

function Tile({ icon, label, children, foot, accent }: { icon: ReactNode; label: string; children: ReactNode; foot?: ReactNode; accent?: string }) {
  return (
    <motion.div
      variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
      className="glass relative overflow-hidden p-4"
    >
      {accent && <span aria-hidden className="absolute inset-x-0 top-0 h-[3px]" style={{ background: accent }} />}
      <div className="mb-1 flex items-center gap-2 text-[11.5px] font-medium tracking-wide text-ink-2 uppercase">
        {icon}
        {label}
      </div>
      <div className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">{children}</div>
      {foot && <div className="mt-1 text-[12px] leading-snug text-ink-2">{foot}</div>}
    </motion.div>
  );
}

export function KpiTiles({ result }: { result: PipelineResult }) {
  const k = kpis(result);
  const t = trendView(result);
  const s = seasonalityView(result);
  const color = k.recommendedKey ? MODEL_COLORS[k.recommendedKey] : undefined;
  const months = k.forecastMonths;

  return (
    <motion.div
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
      initial="hidden"
      animate="show"
      variants={{ show: { transition: { staggerChildren: 0.06 } } }}
    >
      <Tile
        icon={<Factory size={14} aria-hidden />}
        label={`Production plan · next ${months.length} months`}
        accent={color}
        foot={
          <>
            {months.length ? monthRange(months[0], months[months.length - 1]) : "–"} ·{" "}
            {k.forecastPoints.map((p, i) => (
              <span key={months[i]} className="num">
                {i ? " / " : ""}
                {fmtUnits(p)}
              </span>
            ))}
          </>
        }
      >
        <AnimatedNumber value={k.forecastTotal ?? 0} format={(v) => `${fmtUnits(v)} units`} />
      </Tile>
      <Tile
        icon={<Target size={14} aria-hidden />}
        label="Planning model"
        accent={color}
        foot={
          k.sameAsBest
            ? `Best on ${k.basis}`
            : `Simplest model within 0.5 points of the best (${k.bestLabel})`
        }
      >
        <span className="text-xl sm:text-2xl">{k.recommendedLabel}</span>
      </Tile>
      <Tile
        icon={<TrendingUp size={14} aria-hidden />}
        label={`Accuracy · ${k.basis}`}
        foot={k.naiveScore != null ? <>Naive benchmark: <span className="num">{fmtPct(k.naiveScore)}</span> · lower is better</> : undefined}
      >
        <AnimatedNumber value={k.score ?? 0} format={(v) => fmtPct(v)} />
      </Tile>
      <Tile
        icon={<CalendarClock size={14} aria-hidden />}
        label="Data through"
        foot={
          <>
            {k.nMonths} months · {t.significant ? "trend detected" : "no volume trend"} ·{" "}
            {s.testable ? (s.pValue! < 0.05 ? "seasonal" : "no seasonality") : "seasonality not yet testable"}
          </>
        }
      >
        {monthLabel(k.dataThrough)}
      </Tile>
    </motion.div>
  );
}
