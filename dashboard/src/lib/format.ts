// Number and label formatting shared by every view (British English, tabular figures).

const units0 = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 });

export const DASH = "–";

export function fmtUnits(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? DASH : units0.format(Math.round(n));
}

export function fmtCompact(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? DASH : compact.format(n);
}

export function fmtPct(n: number | null | undefined, digits = 2): string {
  return n == null || !Number.isFinite(n) ? DASH : `${n.toFixed(digits)}%`;
}

export function fmtSignedPct(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

export function fmtP(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return DASH;
  return p < 0.001 ? "p < 0.001" : `p = ${p.toFixed(3)}`;
}

export function fmtNum(n: number | null | undefined, digits = 2): string {
  return n == null || !Number.isFinite(n) ? DASH : n.toFixed(digits);
}

/** "2022-01" -> "Jan 2022" (or "Jan 22" when short). */
export function monthLabel(month: string, short = false): string {
  const [y, m] = month.split("-").map(Number);
  const name = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
  return short ? `${name} ${String(y).slice(2)}` : `${name} ${y}`;
}

export function monthRange(first: string, last: string): string {
  return first === last ? monthLabel(first) : `${monthLabel(first)} – ${monthLabel(last)}`;
}
