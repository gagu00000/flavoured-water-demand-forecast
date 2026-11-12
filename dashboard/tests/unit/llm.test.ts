import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PipelineResult } from "../../src/engine/types";
import { reasonFor } from "../../src/llm/interpretation";
import { groundingCheck } from "../../server/grounding";
import { handleInterpret } from "../../server/handler";
import type { GenerateFn } from "../../server/interpret";
import { SYSTEM_PROMPT } from "../../server/prompt.generated";

const result = JSON.parse(
  readFileSync(join(__dirname, "..", "..", "public", "data", "snapshot_default.json"), "utf8"),
) as PipelineResult;
const snapshot = result.snapshot;

// A well-formed, fully grounded answer (the engine's own rule-based text)
const { source: _source, ...grounded } = result.fallback;
const GOOD = JSON.stringify(grounded);
const INVENTED = JSON.stringify({ ...grounded, best_model: "XGBoost wins with 0.42% WAPE, 7.7% better, 9.9% bias." });

const post = (body: unknown) =>
  new Request("http://x/api/interpret", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
const env = (vars: Record<string, string> = {}) => (k: string) => vars[k];
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

describe("grounding check (TypeScript twin of grounding.py)", () => {
  const SNAP = { models: [{ test_wape_pct: 2.0967, forecast_total_units: 480674 }], analysis: { trend_p_value: 0.212, r2: 0.76 } };

  it("accepts numbers rounded from the snapshot", () => {
    const g = groundingCheck("WAPE was 2.1% and p = 0.21; total about 480,674 units; R² explains 76%", SNAP);
    expect(g.unverified).toEqual([]);
    expect(g.checked).toBe(4);
  });

  it("flags invented numbers", () => {
    expect(groundingCheck("MAPE was 7.4% and demand will reach 250,000 units", SNAP).unverified).toEqual(["7.4%", "250,000"]);
  });

  it("ignores structural numbers", () => {
    expect(groundingCheck("For 2022-01 over 3 months in 2022 with 95% ranges, ARIMA (0,1,0)", SNAP).checked).toBe(0);
  });

  it("p-values must match the computed ones", () => {
    const snap = { analysis: { trend_p_value: 0.212, revenue_trend_p_value: 0 }, reporting: { p_value_display_floor: 0.001 } };
    expect(groundingCheck("trend not significant (p = 0.212); revenue p < 0.001", snap).unverified).toEqual([]);
    expect(groundingCheck("the trend is significant (p < 0.001)", { analysis: { trend_p_value: 0.212 }, reporting: { p_value_display_floor: 0.001 } }).unverified).toEqual(["p < 0.001"]);
  });

  it("significance wording must agree with the p-value", () => {
    const snap = { analysis: { trend_p_value: 0.212, revenue_trend_p_value: 0 } };
    expect(groundingCheck("Volume trend is NOT statistically significant (p = 0.212). Revenue trend is significant (p < 0.001).", snap).unverified).toEqual([]);
    expect(groundingCheck("Revenue trend is NOT statistically significant (p < 0.001).", snap).unverified.join()).toMatch(/contradicts/);
    expect(groundingCheck("The volume trend is significant (p = 0.212).", snap).unverified.join()).toMatch(/contradicts/);
  });

  it("verdicts pair with their own p-value inside one sentence", () => {
    const snap = { analysis: { trend_p_value: 0.538, revenue_trend_p_value: 0 } };
    const text = "The revenue trend is statistically significant (p < 0.001), unlike the volume trend, which is NOT statistically significant (p = 0.538).";
    expect(groundingCheck(text, snap).unverified).toEqual([]);
    expect(groundingCheck("Revenue is not significant (p < 0.001) while volume is significant (p = 0.538).", snap).ok).toBe(false);
  });

  it("numbers spelled out in words are rejected", () => {
    const g = groundingCheck("Revenue grows plus two point seven seven percent per year.", { x: 2.77 });
    expect(g.ok).toBe(false);
    expect(g.unverified[0]).toMatch(/words/);
  });

  it("the engine's rule-based text is fully grounded in its snapshot", () => {
    const g = groundingCheck(result.fallback, snapshot);
    expect(g.unverified).toEqual([]);
    expect(g.checked).toBeGreaterThan(10);
  });
});

describe("/api/interpret handler", () => {
  it("rejects wrong methods, invalid JSON, malformed and oversized snapshots", async () => {
    expect((await handleInterpret(new Request("http://x", { method: "GET" }), { env: env() })).status).toBe(405);
    expect((await handleInterpret(post("{nope"), { env: env() })).status).toBe(400);
    expect((await handleInterpret(post({ snapshot: { foo: 1 } }), { env: env() })).status).toBe(400);
    const huge = { snapshot: { ...snapshot, limitations: ["x".repeat(40_000)] } };
    expect((await handleInterpret(post(huge), { env: env() })).status).toBe(413);
    const longString = { snapshot: { ...snapshot, limitations: ["x".repeat(1_000)] } }; // > 800 characters
    expect((await handleInterpret(post(longString), { env: env() })).status).toBe(400);
  });

  it("reports a missing key without calling any model", async () => {
    const res = await handleInterpret(post({ snapshot }), { env: env() });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, retryable: false });
  });

  it("returns a grounded interpretation", async () => {
    const calls: string[] = [];
    const generate: GenerateFn = async (model, system, user) => {
      calls.push(model);
      expect(system).toBe(SYSTEM_PROMPT);
      expect(user).toContain('"last_month": "2021-12"');
      return GOOD;
    };
    const res = await handleInterpret(post({ snapshot }), { env: env(), generate });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, model: "nvidia/nemotron-3.5-bolt-e4b", interpretation: { source: "llm" } });
    expect(body.grounding.unverified).toEqual([]);
    expect(calls).toEqual(["nvidia/nemotron-3.5-bolt-e4b"]);
  });

  it("moves to the next model in a configured chain when one is overloaded", async () => {
    const generate: GenerateFn = async (model) => {
      if (model === "first") throw httpError(503);
      return GOOD;
    };
    const body = await (await handleInterpret(post({ snapshot }), { env: env({ LLM_MODEL: "first, second" }), generate })).json();
    expect(body.ok).toBe(true);
    expect(body.model).toBe("second");
    expect(body.attempts[0]).toMatchObject({ model: "first", outcome: "HTTP 503" });
  });

  it("accepts replies wrapped in code fences or a <think> block", async () => {
    const generate: GenerateFn = async () => `<think>checking facts</think>\n\`\`\`json\n${GOOD}\n\`\`\``;
    const body = await (await handleInterpret(post({ snapshot }), { env: env(), generate })).json();
    expect(body.ok).toBe(true);
  });

  it("rejects an answer whose significance wording contradicts the p-value", async () => {
    const bad = JSON.stringify({ ...grounded, seasonality_trend: "The volume trend is statistically significant (p = 0.212)." });
    const generate: GenerateFn = async () => bad;
    const body = await (await handleInterpret(post({ snapshot }), { env: env({ LLM_MODEL: "only" }), generate })).json();
    expect(body.ok).toBe(false);
    expect(body.attempts[0].outcome).toMatch(/contradicts/);
  });

  it("rejects answers with invented figures (no retry pass) and says why", async () => {
    let calls = 0;
    const generate: GenerateFn = async () => {
      calls++;
      return INVENTED;
    };
    const res = await handleInterpret(post({ snapshot }), { env: env(), generate });
    const body = await res.json();
    expect(res.status).toBe(502);
    expect(body).toMatchObject({ ok: false, retryable: false });
    expect(body.attempts[0].outcome).toMatch(/not supported by the data/);
    expect(calls).toBe(1); // single default model, no retry for a rejected answer
  });

  it("retries the chain once when every model is temporarily busy", async () => {
    let calls = 0;
    const generate: GenerateFn = async () => {
      calls++;
      throw httpError(503);
    };
    const res = await handleInterpret(post({ snapshot }), { env: env({ LLM_MODEL: "a,b" }), generate });
    expect(res.status).toBe(503);
    expect((await res.json()).retryable).toBe(true);
    expect(calls).toBe(4); // 2 models x 2 passes
  });

  it("rejects malformed model output", async () => {
    const generate: GenerateFn = async () => JSON.stringify({ seasonality_trend: "x" });
    const body = await (await handleInterpret(post({ snapshot }), { env: env({ LLM_MODEL: "only" }), generate })).json();
    expect(body.ok).toBe(false);
    expect(body.attempts[0].outcome).toMatch(/required format/);
  });

  it("never leaks the key", async () => {
    const generate: GenerateFn = async () => {
      throw new Error("bad key SECRET-KEY-123");
    };
    const res = await handleInterpret(post({ snapshot }), { env: env({ NVIDIA_API_KEY: "SECRET-KEY-123", LLM_MODEL: "m" }), generate });
    expect(await res.text()).not.toContain("SECRET");
  });
});

describe("client helpers", () => {
  it("maps statuses to user-facing reasons", () => {
    expect(reasonFor(429)).toMatch(/Too many/);
    expect(reasonFor(404)).toMatch(/not available/);
    expect(reasonFor(503, "The AI service is busy right now.")).toBe("The AI service is busy right now.");
  });

  it("the bundled prompt carries the grounding rules", () => {
    expect(SYSTEM_PROMPT).toMatch(/Treat key_facts as the source of truth/);
    expect(SYSTEM_PROMPT).toMatch(/Copy every p-value exactly/);
    expect(SYSTEM_PROMPT).toMatch(/Never calculate or invent a figure/);
  });
});
