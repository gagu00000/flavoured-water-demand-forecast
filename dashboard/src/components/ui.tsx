// Small shared UI building blocks: glass panels, badges, buttons, sliders, segmented controls.

import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { Info } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className = "",
  task,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Lab task this panel delivers (shown as a small tag). */
  task?: string;
}) {
  return (
    <motion.section
      layout="position"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className={`glass p-4 sm:p-5 ${className}`}
      aria-label={title}
    >
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
            {task && <Badge tone="accent">{task}</Badge>}
          </div>
          {subtitle && <p className="mt-0.5 text-[12.5px] leading-snug text-ink-2">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {children}
    </motion.section>
  );
}

type Tone = "neutral" | "accent" | "citrus" | "warning" | "critical" | "good";

const TONES: Record<Tone, string> = {
  neutral: "bg-white/5 text-ink-2 ring-white/10",
  accent: "bg-[rgba(94,234,212,0.10)] text-accent ring-[rgba(94,234,212,0.25)]",
  citrus: "bg-[rgba(196,243,107,0.10)] text-citrus ring-[rgba(196,243,107,0.25)]",
  warning: "bg-[rgba(250,178,25,0.10)] text-warning ring-[rgba(250,178,25,0.3)]",
  critical: "bg-[rgba(230,103,103,0.12)] text-critical ring-[rgba(230,103,103,0.3)]",
  good: "bg-[rgba(12,163,12,0.12)] text-[#5fd35f] ring-[rgba(12,163,12,0.3)]",
};

export function Badge({ children, tone = "neutral", className = "" }: { children: ReactNode; tone?: Tone; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${TONES[tone]} ${className}`}>
      {children}
    </span>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  variant = "ghost",
  title,
  className = "",
  type = "button",
  ...rest
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost";
  title?: string;
  className?: string;
  type?: "button" | "submit";
  "aria-label"?: string;
  "aria-pressed"?: boolean;
}) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-1.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40";
  const styles =
    variant === "primary"
      ? "bg-[linear-gradient(135deg,#5eead4,#38bdf8)] text-[#04212a] shadow-[0_6px_20px_-8px_rgba(94,234,212,0.6)] hover:brightness-110"
      : "bg-white/5 text-ink ring-1 ring-inset ring-white/10 hover:bg-white/10";
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title} className={`${base} ${styles} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-describedby={open ? id : undefined}
        aria-label="More information"
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setOpen(false)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="rounded-full p-0.5 text-muted hover:text-ink"
      >
        <Info size={14} />
      </button>
      {open && (
        <span
          role="tooltip"
          id={id}
          className="glass glass-strong absolute top-6 left-1/2 z-30 w-64 -translate-x-1/2 p-2.5 text-[12px] leading-snug text-ink-2"
        >
          {text}
        </span>
      )}
    </span>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[11.5px] font-medium tracking-wide text-ink-2 uppercase">
          {label}
        </label>
        <span className="num text-[13px] font-semibold text-ink">{format ? format(value) : value}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
        aria-valuetext={format ? format(value) : String(value)}
      />
      {hint && <p className="mt-0.5 text-[11px] text-muted">{hint}</p>}
    </div>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl bg-black/30 p-0.5 ring-1 ring-inset ring-white/10">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`relative rounded-[10px] px-2.5 py-1 text-[12.5px] font-medium transition-colors ${active ? "text-[#04212a]" : "text-ink-2 hover:text-ink"}`}
          >
            {active && (
              <motion.span
                layoutId={`seg-${label}`}
                className="absolute inset-0 rounded-[10px] bg-[linear-gradient(135deg,#5eead4,#38bdf8)]"
                transition={{ type: "spring", stiffness: 500, damping: 40 }}
              />
            )}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Counts smoothly to a new value when it changes (instant when reduced motion is requested). */
export function AnimatedNumber({ value, format }: { value: number; format: (v: number) => string }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => format(v));
  useEffect(() => {
    if (reduce) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration: 0.8, ease: "easeOut" });
    return () => controls.stop();
  }, [value, mv, reduce]);
  return <motion.span className="num">{text}</motion.span>;
}

export function Swatch({ color, dashed = false }: { color: string; dashed?: boolean }) {
  return (
    <span
      aria-hidden
      className="inline-block h-[3px] w-4 shrink-0 rounded"
      style={dashed ? { backgroundImage: `linear-gradient(90deg, ${color} 60%, transparent 60%)`, backgroundSize: "6px 3px" } : { background: color }}
    />
  );
}
