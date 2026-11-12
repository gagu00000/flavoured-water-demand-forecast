// Client side of the LLM interpretation.
//
// Whenever the forecasting results change (new data, new filters, new split),
// the compact results snapshot is sent to /api/interpret after a short pause.
// Answers are cached per snapshot so the same view is never sent twice. If the
// AI service fails, is rate-limited or is not configured, the panel shows the
// rule-based interpretation that the engine computed for the same snapshot.

import { useEffect } from "react";
import { create } from "zustand";
import type { Interpretation, PipelineResult } from "../engine/types";
import { hashJson } from "../lib/hash";
import { useDashboard } from "../state/store";

const DEBOUNCE_MS = 1500;
const CACHE_PREFIX = "interp:v1:";

export type InterpretationStatus = "idle" | "waiting" | "loading" | "llm" | "fallback";

export interface InterpretationState {
  status: InterpretationStatus;
  interpretation: Interpretation | null;
  /** Hash of the snapshot the displayed interpretation describes. */
  forHash: string | null;
  model: string | null;
  checkedNumbers: number;
  unverified: string[];
  reason: string | null;
  generatedAt: string | null;
  dataVersion: number | null;
  lastMonth: string | null;
  fromCache: boolean;
  /** Bumped to force a fresh LLM call for the current snapshot. */
  nonce: number;
  regenerate: () => void;
}

export const useInterpretation = create<InterpretationState>((set, get) => ({
  status: "idle",
  interpretation: null,
  forHash: null,
  model: null,
  checkedNumbers: 0,
  unverified: [],
  reason: null,
  generatedAt: null,
  dataVersion: null,
  lastMonth: null,
  fromCache: false,
  nonce: 0,
  regenerate: () => set({ nonce: get().nonce + 1 }),
}));

interface CachedAnswer {
  interpretation: Interpretation;
  model: string;
  checked: number;
  unverified: string[];
  generatedAt: string;
}

const memoryCache = new Map<string, CachedAnswer>();

function readCache(hash: string): CachedAnswer | null {
  const hit = memoryCache.get(hash);
  if (hit) return hit;
  try {
    const raw = sessionStorage.getItem(CACHE_PREFIX + hash);
    return raw ? (JSON.parse(raw) as CachedAnswer) : null;
  } catch {
    return null;
  }
}

function writeCache(hash: string, value: CachedAnswer) {
  memoryCache.set(hash, value);
  try {
    sessionStorage.setItem(CACHE_PREFIX + hash, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode, quota): the in-memory cache still works */
  }
}

/** Turn an HTTP status into a short, user-facing reason. */
export function reasonFor(status: number, serverReason?: string): string {
  if (status === 429) return "Too many AI requests from this browser. Try again in a minute.";
  if (status === 404) return "The AI service is not available in this environment.";
  if (serverReason) return serverReason;
  if (status >= 500) return "The AI service is temporarily unavailable.";
  return "The AI service could not answer.";
}

export async function requestInterpretation(snapshot: unknown, signal: AbortSignal) {
  const res = await fetch("/api/interpret", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ snapshot }),
    signal,
  });
  let body: Record<string, unknown> = {};
  try {
    body = await res.json();
  } catch {
    /* non-JSON error page */
  }
  if (res.ok && body.ok) {
    const grounding = body.grounding as { checked: number; unverified: string[] };
    return {
      ok: true as const,
      answer: {
        interpretation: body.interpretation as Interpretation,
        model: String(body.model),
        checked: grounding.checked,
        unverified: grounding.unverified,
        generatedAt: new Date().toISOString(),
      },
    };
  }
  return { ok: false as const, reason: reasonFor(res.status, typeof body.reason === "string" ? body.reason : undefined) };
}

function meta(result: PipelineResult) {
  const v = result.context?.data_version;
  return { dataVersion: typeof v === "number" ? v : null, lastMonth: result.meta.last_month };
}

/** Mount once: keeps the interpretation in step with the current results. */
export function useInterpretationSync() {
  const result = useDashboard((s) => s.result);
  const nonce = useInterpretation((s) => s.nonce);

  useEffect(() => {
    if (!result) return;
    const hash = hashJson(result.snapshot);
    const state = useInterpretation.getState();
    const forced = nonce > 0 && state.forHash === hash;

    const cached = forced ? null : readCache(hash);
    if (cached) {
      useInterpretation.setState({
        status: "llm",
        interpretation: cached.interpretation,
        forHash: hash,
        model: cached.model,
        checkedNumbers: cached.checked,
        unverified: cached.unverified,
        reason: null,
        generatedAt: cached.generatedAt,
        fromCache: true,
        ...meta(result),
      });
      return;
    }

    // Keep showing the previous answer (marked as updating) until the new one arrives
    useInterpretation.setState({ status: "waiting" });
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      useInterpretation.setState({ status: "loading" });
      try {
        const outcome = await requestInterpretation(result.snapshot, controller.signal);
        if (controller.signal.aborted) return;
        if (outcome.ok) {
          writeCache(hash, outcome.answer);
          useInterpretation.setState({
            status: "llm",
            interpretation: outcome.answer.interpretation,
            forHash: hash,
            model: outcome.answer.model,
            checkedNumbers: outcome.answer.checked,
            unverified: outcome.answer.unverified,
            reason: null,
            generatedAt: outcome.answer.generatedAt,
            fromCache: false,
            ...meta(result),
          });
          return;
        }
        showFallback(result, hash, outcome.reason);
      } catch (err) {
        if (controller.signal.aborted) return;
        showFallback(result, hash, err instanceof TypeError ? "The AI service could not be reached." : "The AI service could not answer.");
      }
    }, forced ? 0 : DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [result, nonce]);
}

function showFallback(result: PipelineResult, hash: string, reason: string) {
  useInterpretation.setState({
    status: "fallback",
    interpretation: result.fallback,
    forHash: hash,
    model: null,
    checkedNumbers: 0,
    unverified: [],
    reason,
    generatedAt: new Date().toISOString(),
    fromCache: false,
    ...meta(result),
  });
}
