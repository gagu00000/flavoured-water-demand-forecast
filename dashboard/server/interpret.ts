// Grounded LLM interpretation: the TypeScript twin of forecasting_core/llm_client.py.
//
// Calls NVIDIA's OpenAI-compatible endpoint (Nemotron 3.5 Bolt E4B by default),
// validates the JSON answer, and rejects any answer that quotes figures not in
// the results snapshot or whose significance wording contradicts its p-value.
// Temporary failures (rate limit, overload, timeout) get one more try, all inside
// a time budget well below Netlify's 60-second function limit.

import { groundingCheck, type GroundingResult } from "./grounding";
import { InterpretationSchema, type LlmInterpretation, type Snapshot } from "./schema";

export const DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";
export const DEFAULT_MODELS = ["nvidia/nemotron-3.5-bolt-e4b"];
const ATTEMPT_TIMEOUT_MS = 25_000;
const TOTAL_BUDGET_MS = 50_000;
const PASSES = 2;
const RETRY_PAUSE_MS = 2_000;
const RATE_LIMIT_PAUSE_MS = 8_000; // per-minute quotas reset quickly; wait longer after HTTP 429
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
const MAX_UNVERIFIED = 2;

/** Model settings shared with the notebook (forecasting_core/llm_client.py GENERATION). */
export const GENERATION = {
  temperature: 0.2,
  top_p: 0.95,
  max_tokens: 3000,
  seed: 42,
  response_format: { type: "json_object" },
  // Nemotron's optional reasoning mode is off: answers restate verified key facts,
  // and thinking multiplies the response time.
  chat_template_kwargs: { enable_thinking: false },
};

/** Sends one prompt to one model and returns the raw reply text. */
export type GenerateFn = (model: string, system: string, user: string) => Promise<string>;

export interface Attempt {
  model: string;
  outcome: string;
  ms?: number;
}

export type InterpretOutcome =
  | { ok: true; interpretation: LlmInterpretation; model: string; grounding: GroundingResult; attempts: Attempt[]; ms: number }
  | { ok: false; reason: string; retryable: boolean; attempts: Attempt[]; ms: number };

export class HttpError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
}

export function buildUserMessage(snapshot: Snapshot): string {
  return (
    "RESULTS SNAPSHOT (JSON):\n```json\n" +
    JSON.stringify(snapshot, null, 1) +
    "\n```\nAnswer the three questions using only this snapshot."
  );
}

export function modelChain(configured: string | undefined): string[] {
  const list = (configured ?? "").split(",").map((m) => m.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_MODELS;
}

/** Parse the JSON object in a model reply (tolerates code fences or a leading <think> block). */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new SyntaxError("no JSON object in the reply");
  return JSON.parse(cleaned.slice(start, end + 1));
}

/** Real call to the OpenAI-compatible chat-completions endpoint. */
export function openAiCompatibleGenerator(apiKey: string, baseUrl = DEFAULT_BASE_URL): GenerateFn {
  return async (model, system, user) => {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        stream: false,
        ...GENERATION,
      }),
      signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
    });
    if (!res.ok) throw new HttpError(res.status); // the provider's message is never surfaced
    const body = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
    return body.choices?.[0]?.message?.content ?? "";
  };
}

function statusOf(err: unknown): number | undefined {
  const s = (err as { status?: unknown })?.status;
  return typeof s === "number" ? s : undefined;
}

/** Key-free, provider-message-free description of a failure. */
function describe(err: unknown): string {
  const status = statusOf(err);
  if (status) return `HTTP ${status}`;
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) return "timed out";
  if (err instanceof SyntaxError) return "invalid JSON";
  if (err instanceof Error && err.name === "ZodError") return "answer did not match the required format";
  return "request failed";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function interpret(
  snapshot: Snapshot,
  system: string,
  generate: GenerateFn,
  models: string[] = DEFAULT_MODELS,
  now: () => number = Date.now,
): Promise<InterpretOutcome> {
  const started = now();
  const attempts: Attempt[] = [];
  const user = buildUserMessage(snapshot);
  let allTemporary = true;

  for (let pass = 0; pass < PASSES; pass++) {
    allTemporary = true;
    let rateLimited = false;
    for (const model of models) {
      if (now() - started > TOTAL_BUDGET_MS) {
        attempts.push({ model, outcome: "skipped (time budget used up)" });
        continue;
      }
      const t0 = now();
      let parsed: LlmInterpretation;
      try {
        parsed = InterpretationSchema.parse(extractJson(await generate(model, system, user)));
      } catch (err) {
        const status = statusOf(err);
        const outcome = describe(err);
        if (!(status && RETRYABLE.has(status)) && outcome !== "timed out") allTemporary = false;
        if (status === 429) rateLimited = true;
        attempts.push({ model, outcome, ms: now() - t0 });
        continue;
      }
      const grounding = groundingCheck(parsed, snapshot, MAX_UNVERIFIED);
      if (!grounding.ok) {
        allTemporary = false;
        attempts.push({ model, outcome: `rejected: not supported by the data (${grounding.unverified.join(", ")})`, ms: now() - t0 });
        continue;
      }
      attempts.push({ model, outcome: "ok", ms: now() - t0 });
      return { ok: true, interpretation: parsed, model, grounding, attempts, ms: now() - started };
    }
    if (!allTemporary || pass === PASSES - 1 || now() - started > TOTAL_BUDGET_MS) break;
    await sleep(rateLimited ? RATE_LIMIT_PAUSE_MS : RETRY_PAUSE_MS);
  }

  return {
    ok: false,
    reason: allTemporary ? "The AI service is busy right now." : "The AI service could not produce a verified answer.",
    retryable: allTemporary,
    attempts,
    ms: now() - started,
  };
}
