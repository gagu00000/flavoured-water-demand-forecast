import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clean } from "../../src/ai/ChatView";
import type { PipelineResult } from "../../src/engine/types";
import { chatErrorReason } from "../../src/llm/chat";
import { buildChatMessages, handleChat, parseSse, type StreamFn } from "../../server/chat";
import { CHAT_PROMPT } from "../../server/prompt.generated";

const result = JSON.parse(
  readFileSync(join(__dirname, "..", "..", "public", "data", "snapshot_default.json"), "utf8"),
) as PipelineResult;
const snapshot = result.snapshot;
const question = (content: string) => ({ snapshot, messages: [{ role: "user", content }] });
const post = (body: unknown) =>
  new Request("http://x/api/chat", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
const env = (vars: Record<string, string> = {}) => (k: string) => vars[k];
async function* chunks(...parts: string[]) {
  for (const p of parts) yield p;
}

describe("/api/chat", () => {
  it("validates the request", async () => {
    expect((await handleChat(new Request("http://x", { method: "GET" }), { env: env() })).status).toBe(405);
    expect((await handleChat(post("{bad"), { env: env() })).status).toBe(400);
    const tooLong = await handleChat(post(question("x".repeat(601))), { env: env(), stream: async () => chunks("hi") });
    expect(tooLong.status).toBe(400);
    expect((await tooLong.json()).reason).toMatch(/under 600 characters/);
    const lastNotUser = { snapshot, messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }] };
    expect((await handleChat(post(lastNotUser), { env: env(), stream: async () => chunks("hi") })).status).toBe(400);
    const tooMany = { snapshot, messages: Array.from({ length: 11 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "q" })) };
    expect((await handleChat(post(tooMany), { env: env(), stream: async () => chunks("hi") })).status).toBe(400);
  });

  it("reports a missing key without calling the model", async () => {
    const res = await handleChat(post(question("hello")), { env: env() });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, retryable: false });
  });

  it("streams the answer and names the model", async () => {
    let seen: { model: string; last: string } | null = null;
    const stream: StreamFn = async (model, messages) => {
      seen = { model, last: messages.at(-1)!.content };
      return chunks("Next month: ", "160,396 units.");
    };
    const res = await handleChat(post(question("How much next month?")), { env: env(), stream });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/plain/);
    expect(res.headers.get("x-llm-model")).toBe("nvidia/nemotron-3.5-bolt-e4b");
    expect(await res.text()).toBe("Next month: 160,396 units.");
    expect(seen!.last).toMatch(/RESULTS SNAPSHOT/);
    expect(seen!.last).toMatch(/Question: How much next month\?$/);
  });

  it("retries a busy service once, then reports it", async () => {
    let calls = 0;
    const stream: StreamFn = async () => {
      calls++;
      throw Object.assign(new Error("busy"), { status: 503 });
    };
    const res = await handleChat(post(question("hi")), { env: env(), stream });
    expect(res.status).toBe(503);
    expect((await res.json()).retryable).toBe(true);
    expect(calls).toBe(2);
  });

  it("ends cleanly if the stream breaks midway", async () => {
    async function* broken() {
      yield "Partial answer";
      throw new Error("connection lost");
    }
    const res = await handleChat(post(question("hi")), { env: env(), stream: async () => broken() });
    expect(await res.text()).toMatch(/^Partial answer[\s\S]*interrupted/);
  });

  it("never leaks the key", async () => {
    const stream: StreamFn = async () => {
      throw new Error("bad key SECRET-KEY-9");
    };
    const res = await handleChat(post(question("hi")), { env: env({ NVIDIA_API_KEY: "SECRET-KEY-9" }), stream });
    expect(await res.text()).not.toContain("SECRET");
  });
});

describe("chat helpers", () => {
  it("puts the current snapshot only in the latest question", () => {
    const msgs = buildChatMessages({
      snapshot: snapshot as never,
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "answer" },
        { role: "user", content: "second" },
      ],
    });
    expect(msgs[0]).toEqual({ role: "system", content: CHAT_PROMPT });
    expect(msgs[1]).toEqual({ role: "user", content: "first" });
    expect(msgs.at(-1)!.content).toMatch(/RESULTS SNAPSHOT[\s\S]*Question: second$/);
    expect(msgs.filter((m) => m.role === "user" && m.content.includes("RESULTS SNAPSHOT"))).toHaveLength(1);
  });

  it("parses OpenAI-style server-sent events", async () => {
    const sse = 'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n: keep-alive\ndata: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n\n';
    const body = new Response(sse).body!;
    let text = "";
    for await (const t of parseSse(body)) text += t;
    expect(text).toBe("Hello");
  });

  it("cleans markdown the model may add", () => {
    expect(clean("**Bold** and `code`\n*   item\n- other\n## Heading")).toBe("Bold and code\n• item\n• other\nHeading");
  });

  it("maps errors to friendly messages", () => {
    expect(chatErrorReason(429)).toMatch(/wait a minute/);
    expect(chatErrorReason(503, "The AI service is busy right now.")).toBe("The AI service is busy right now.");
  });

  it("the chat prompt carries the grounding and scope rules", () => {
    expect(CHAT_PROMPT).toMatch(/Use only numbers that appear in the snapshot/);
    expect(CHAT_PROMPT).toMatch(/Politely decline anything unrelated/);
  });
});
