// Validation for what goes into and comes out of the LLM.

import { z } from "zod";

export const MAX_BODY_BYTES = 32_000;
const MAX_STRING = 800;
const MAX_ARRAY = 60;
const MAX_DEPTH = 6;

/** Reject oversized or deeply nested values anywhere in the snapshot. */
function withinLimits(value: unknown, depth = 0): boolean {
  if (depth > MAX_DEPTH) return false;
  if (typeof value === "string") return value.length <= MAX_STRING;
  if (typeof value === "number") return Number.isFinite(value);
  if (value === null || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.length <= MAX_ARRAY && value.every((v) => withinLimits(v, depth + 1));
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.length <= 40 && entries.every(([k, v]) => k.length <= 60 && withinLimits(v, depth + 1));
  }
  return false;
}

/** The results snapshot produced by forecasting_core.pipeline.build_snapshot. */
export const SnapshotSchema = z
  .object({
    context: z.record(z.string(), z.unknown()),
    data: z.object({ first_month: z.string(), last_month: z.string(), n_months: z.number().int().positive() }).passthrough(),
    split: z.object({ ranking_basis: z.string(), horizon: z.number().int().positive() }).passthrough(),
    analysis: z.record(z.string(), z.unknown()),
    models: z.array(z.object({ model: z.string(), available: z.boolean() }).passthrough()).min(1).max(10),
    best_model: z.record(z.string(), z.unknown()).nullable(),
    limitations: z.array(z.string()),
  })
  .passthrough()
  .refine(withinLimits, { message: "snapshot contains oversized or deeply nested values" });

export type Snapshot = z.infer<typeof SnapshotSchema>;

export const RequestSchema = z.object({ snapshot: SnapshotSchema });

/** The structured answer the LLM must return (the slide's three questions). */
export const InterpretationSchema = z.object({
  seasonality_trend: z.string().min(1).max(2000),
  best_model: z.string().min(1).max(2000),
  recommendations: z.array(z.string().min(1).max(600)).min(1).max(8),
  limitations: z.array(z.string().min(1).max(600)).max(8),
  confidence: z.enum(["low", "medium", "high"]),
});

export type LlmInterpretation = z.infer<typeof InterpretationSchema>;
