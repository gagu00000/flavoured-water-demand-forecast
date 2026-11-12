// Number-grounding check for LLM output: the TypeScript twin of
// forecasting_core/grounding.py (same rules, cross-checked in the tests).
//
// Every number the LLM writes must match a number in the results snapshot it
// was given, at the precision written (e.g. 2.0967 as "2.1%"), or, for large
// unit counts, be within 0.5% of one. A fraction such as R² = 0.76 may also be
// written as 76%. P-values are checked strictly: "p = 0.21" must match a computed
// p-value and "p < 0.001" needs one that small; wording that contradicts its own p-value
// ("not significant (p < 0.001)") is flagged. Years, month labels, small counts ("3 months"), ARIMA orders
// and the 80/95 interval levels are structural and not checked.

const MONTH_LABEL = /\b\d{4}-\d{2}\b/g;
const ARIMA_ORDER = /\(\s*\d\s*,\s*\d\s*,\s*\d\s*\)/g;
const NUMBER = /(?<![\w.])[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?/g;
// A p-value statement such as "p = 0.212", "p-value of 0.21" or "p < 0.001"
const P_VALUE = /(?<![\w])p(?:\s*-?\s*values?)?\s*(?:=|of|is|:)?\s*(<)?\s*(\d*\.\d+)/gi;
const STRUCTURAL_MAX_INT = 36;
const LEVELS = new Set([80, 95]);
const SKIP_KEYS = new Set(["p_value_display_floor"]); // a reporting constant, not a result
const ALPHA = 0.05;
// A verdict word, with an optional negation up to three words before it ("NOT statistically significant")
const VERDICT = /\b(?:(not|no|non)[\s-]+(?:\w+\s+){0,2})?(in)?significan\w*/gi;

// Numbers spelled out in words ("two point seven seven percent") would slip past the digit check
const SPELLED_NUMBER = /\b(zero|one|two|three|four|five|six|seven|eight|nine)\s+point\s+(zero|one|two|three|four|five|six|seven|eight|nine)\b/gi;

/** Verdicts whose "significant / not significant" wording contradicts the nearest p-value in the clause. */
function significanceConflicts(text: string): string[] {
  const bad: string[] = [];
  for (const clause of text.split(/(?<!\d)\.(?!\d)|;/)) {
    const ps = [...clause.matchAll(P_VALUE)];
    if (!ps.length) continue;
    for (const v of clause.matchAll(VERDICT)) {
      const centre = v.index! + v[0].length / 2;
      const m = ps.reduce((a, b) =>
        Math.abs(b.index! + b[0].length / 2 - centre) < Math.abs(a.index! + a[0].length / 2 - centre) ? b : a,
      );
      const value = Number(m[2]);
      const pSmall = m[1] ? value <= ALPHA : value < ALPHA;
      const negated = Boolean(v[1] || v[2]);
      if (negated === pSmall) bad.push(`significance wording contradicts ${m[0].trim()}`);
    }
  }
  return bad;
}

export interface GroundingResult {
  checked: number;
  verified: string[];
  unverified: string[];
  ok: boolean;
}

function parseToken(token: string): number {
  return Number(token.replace(/%$/, "").replace(/,/g, ""));
}

export function snapshotNumbers(value: unknown, out: number[] = []): number[] {
  if (value === null || value === undefined || typeof value === "boolean") return out;
  if (typeof value === "number") {
    out.push(value);
    if (value !== 0 && Math.abs(value) <= 1) out.push(value * 100);
  } else if (typeof value === "string") {
    for (const token of value.replace(MONTH_LABEL, " ").match(NUMBER) ?? []) {
      const n = parseToken(token);
      if (Number.isFinite(n)) out.push(n);
    }
  } else if (Array.isArray(value)) {
    for (const v of value) snapshotNumbers(v, out);
  } else if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (!SKIP_KEYS.has(k)) snapshotNumbers(v, out);
  }
  return out;
}

/** Every computed p-value in the snapshot (keys ending in "p_value"). */
function pValues(value: unknown, out: number[] = []): number[] {
  if (Array.isArray(value)) value.forEach((v) => pValues(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k.endsWith("p_value") && typeof v === "number") out.push(v);
      else pValues(v, out);
    }
  }
  return out;
}

/** "p = 0.21" must match a computed p-value; "p < 0.001" needs a computed p-value that small. */
function checkPValues(text: string, ps: number[]): { rest: string; ok: string[]; bad: string[] } {
  const ok: string[] = [];
  const bad: string[] = [];
  for (const m of text.matchAll(P_VALUE)) {
    const value = Number(m[2]);
    const decimals = m[2].split(".")[1].length;
    const good = m[1] ? ps.some((p) => p < value) : ps.some((p) => Math.abs(p - value) <= 0.5 * 10 ** -decimals + 1e-9);
    (good ? ok : bad).push(m[0].trim());
  }
  return { rest: text.replace(P_VALUE, " "), ok, bad };
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textOf).join(" ");
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([k]) => k !== "source" && k !== "confidence")
      .map(([, v]) => textOf(v))
      .join(" ");
  }
  return "";
}

function matches(token: string, value: number, candidates: number[]): boolean {
  const body = token.replace(/%$/, "");
  const decimals = body.includes(".") ? body.split(".")[1].length : 0;
  const tolerance = 0.5 * 10 ** -decimals + 1e-9;
  for (const v of candidates) {
    for (const cand of [v, Math.abs(v)]) {
      if (Math.abs(cand - value) <= tolerance) return true;
      if (Math.abs(value) >= 100 && cand !== 0 && Math.abs(value - cand) <= 0.005 * Math.abs(cand)) return true;
    }
  }
  return false;
}

export function groundingCheck(output: unknown, snapshot: unknown, maxUnverified = 2): GroundingResult {
  const candidates = snapshotNumbers(snapshot);
  const fullText = textOf(output);
  const p = checkPValues(fullText.replace(MONTH_LABEL, " ").replace(ARIMA_ORDER, " "), pValues(snapshot));
  const text = p.rest;
  const verified: string[] = [...p.ok];
  // Wrong p-values and contradicted verdicts are never tolerated
  const serious = [
    ...p.bad,
    ...significanceConflicts(fullText),
    ...[...fullText.matchAll(SPELLED_NUMBER)].map((m) => `number written in words: ${m[0]}`),
  ];
  const unverified: string[] = [...serious];
  for (const token of text.match(NUMBER) ?? []) {
    const isPct = token.endsWith("%");
    const value = parseToken(token);
    const isInt = !token.includes(".");
    if (isInt && !isPct && (Math.abs(value) <= STRUCTURAL_MAX_INT || (value >= 1900 && value <= 2100))) continue;
    if (isPct && LEVELS.has(value)) continue;
    (matches(token.replace(/^\+/, ""), value, candidates) ? verified : unverified).push(token);
  }
  return {
    checked: verified.length + unverified.length,
    verified,
    unverified,
    ok: serious.length === 0 && unverified.length <= maxUnverified,
  };
}
