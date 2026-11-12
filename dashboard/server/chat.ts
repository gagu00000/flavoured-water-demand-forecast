// Real-time chat with the AI Analyst (POST /api/chat).
//
// Every question is answered against the results snapshot the manager is looking
// at *right now* (sent fresh with each message), and the answer is streamed back
// token by token. The client checks every figure in the finished answer against
// the same snapshot and flags anything that is not in the data.

import { z } from "zod";
import { DEFAULT_BASE_URL, DEFAULT_MODELS, HttpError, modelChain } from "./interpret";
import { CHAT_PROMPT } from "./prompt.generated";
import { SnapshotSchema } from "./schema";

export const MAX_CHAT_BODY_BYTES = 64_000;
export const MAX_TURNS = 10; // user + assistant messages kept as context
export const MAX_QUESTION_CHARS = 600;
const MAX_ANSWER_CHARS = 2_500;
const REQUEST_TIMEOUT_MS = 55_000; // below Netlify's 60 s streaming limit
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

const MessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(MAX_ANSWER_CHARS),
});

export const ChatRequestSchema = z
  .object({ snapshot: SnapshotSchema, messages: z.array(MessageSchema).min(1).max(MAX_TURNS) })
  .refine((r) => r.messages.at(-1)!.role === "user", { message: "the last message must be the user's question" })
  .refine((r) => r.messages.at(-1)!.content.length <= MAX_QUESTION_CHARS, { message: "question too long" });

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

/** Opens a streaming completion; resolves once the provider has accepted the request. */
export type StreamFn = (model: string, messages: ChatMessage[]) => Promise<AsyncIterable<string>>;

/** System prompt, earlier turns, then the latest question together with the *current* snapshot. */
export function buildChatMessages(req: ChatRequest): ChatMessage[] {
  const earlier = req.messages.slice(0, -1);
  const question = req.messages.at(-1)!.content;
  return [
    { role: "system", content: CHAT_PROMPT },
    ...earlier,
    {
      role: "user",
      content:
        "RESULTS SNAPSHOT (JSON, what the manager is viewing now):\n```json\n" +
        JSON.stringify(req.snapshot, null, 1) +
        "\n```\n\nQuestion: " +
        question,
    },
  ];
}

/** Parse an OpenAI-style server-sent-event stream into text deltas. */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        try {
          const delta = (JSON.parse(data) as { choices?: { delta?: { content?: string | null } }[] }).choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          /* ignore keep-alive or malformed lines */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Real streaming call to NVIDIA's OpenAI-compatible endpoint. */
export function openAiCompatibleStream(apiKey: string, baseUrl = DEFAULT_BASE_URL): StreamFn {
  return async (model, messages) => {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        temperature: 0.3,
        top_p: 0.95,
        max_tokens: 700,
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok || !res.body) throw new HttpError(res.status); // the provider's message is never surfaced
    return parseSse(res.body);
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ChatDeps {
  env: (name: string) => string | undefined;
  /** Injected in tests; defaults to the real NVIDIA streaming endpoint. */
  stream?: StreamFn;
}

export async function handleChat(req: Request, deps: ChatDeps): Promise<Response> {
  if (req.method !== "POST") return json(405, { ok: false, reason: "Use POST." });
  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_CHAT_BODY_BYTES) return json(413, { ok: false, reason: "The conversation is too long." });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, { ok: false, reason: "The request is not valid JSON." });
  }
  const parsed = ChatRequestSchema.safeParse(body);
  if (!parsed.success) {
    const tooLong = parsed.error.issues.some((i) => i.message === "question too long");
    return json(400, { ok: false, reason: tooLong ? `Please keep questions under ${MAX_QUESTION_CHARS} characters.` : "The chat request is not in the expected format." });
  }

  let stream = deps.stream;
  if (!stream) {
    const apiKey = deps.env("NVIDIA_API_KEY");
    if (!apiKey) return json(503, { ok: false, reason: "The AI service is not configured on this site.", retryable: false });
    stream = openAiCompatibleStream(apiKey, deps.env("LLM_BASE_URL") || DEFAULT_BASE_URL);
  }

  const messages = buildChatMessages(parsed.data);
  const models = modelChain(deps.env("LLM_MODEL"));
  let iterator: AsyncIterator<string> | null = null;
  let usedModel = models[0] ?? DEFAULT_MODELS[0];
  let lastStatus: number | undefined;

  // Open the stream, trying the chain once more if the service is temporarily busy
  outer: for (let pass = 0; pass < 2; pass++) {
    for (const model of models) {
      try {
        iterator = (await stream(model, messages))[Symbol.asyncIterator]();
        usedModel = model;
        break outer;
      } catch (err) {
        lastStatus = (err as { status?: number }).status;
        if (lastStatus !== undefined && !RETRYABLE.has(lastStatus)) break outer;
      }
    }
    if (pass === 0) await sleep(lastStatus === 429 ? 4_000 : 1_500);
  }
  if (!iterator) {
    const busy = lastStatus === undefined || RETRYABLE.has(lastStatus);
    return json(busy ? 503 : 502, {
      ok: false,
      reason: busy ? "The AI service is busy right now. Please try again in a moment." : "The AI service could not answer.",
      retryable: busy,
    });
  }

  const encoder = new TextEncoder();
  const it = iterator;
  const out = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await it.next();
        if (done) controller.close();
        else controller.enqueue(encoder.encode(value));
      } catch {
        controller.enqueue(encoder.encode("\n\n[The answer was interrupted. Please ask again.]"));
        controller.close();
      }
    },
    async cancel() {
      await it.return?.();
    },
  });
  return new Response(out, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-llm-model": usedModel },
  });
}
