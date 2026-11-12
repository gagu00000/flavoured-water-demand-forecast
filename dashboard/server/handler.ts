// HTTP handler for POST /api/interpret, shared by the Netlify Function and the
// local dev server, and unit-tested with a fake model.
//
// The API key is read from the server environment only. Responses never contain
// the key or raw provider error messages.

import { DEFAULT_BASE_URL, type GenerateFn, interpret, modelChain, openAiCompatibleGenerator } from "./interpret";
import { SYSTEM_PROMPT } from "./prompt.generated";
import { MAX_BODY_BYTES, RequestSchema } from "./schema";

export interface HandlerDeps {
  env: (name: string) => string | undefined;
  /** Injected in tests; defaults to the real NVIDIA (OpenAI-compatible) endpoint. */
  generate?: GenerateFn;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export async function handleInterpret(req: Request, deps: HandlerDeps): Promise<Response> {
  if (req.method !== "POST") return json(405, { ok: false, reason: "Use POST." });

  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return json(413, { ok: false, reason: "The results snapshot is too large." });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, { ok: false, reason: "The request is not valid JSON." });
  }
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) return json(400, { ok: false, reason: "The results snapshot is not in the expected format." });

  let generate = deps.generate;
  if (!generate) {
    const apiKey = deps.env("NVIDIA_API_KEY");
    if (!apiKey) return json(503, { ok: false, reason: "The AI service is not configured on this site.", retryable: false });
    generate = openAiCompatibleGenerator(apiKey, deps.env("LLM_BASE_URL") || DEFAULT_BASE_URL);
  }

  const outcome = await interpret(parsed.data.snapshot, SYSTEM_PROMPT, generate, modelChain(deps.env("LLM_MODEL")));
  if (!outcome.ok) {
    return json(outcome.retryable ? 503 : 502, {
      ok: false,
      reason: outcome.reason,
      retryable: outcome.retryable,
      attempts: outcome.attempts,
      ms: outcome.ms,
    });
  }
  return json(200, {
    ok: true,
    interpretation: { ...outcome.interpretation, source: "llm" },
    model: outcome.model,
    grounding: { checked: outcome.grounding.checked, unverified: outcome.grounding.unverified },
    attempts: outcome.attempts,
    ms: outcome.ms,
  });
}
