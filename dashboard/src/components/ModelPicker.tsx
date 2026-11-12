// Chips to choose which model the forecast charts focus on.

import type { ModelKey, PipelineResult } from "../engine/types";
import { MODEL_KEYS } from "../engine/types";
import { useUi } from "../state/ui";
import { MODEL_COLORS } from "../viewmodels/models";

export function useFocusModel(result: PipelineResult): ModelKey {
  const focus = useUi((s) => s.focusModel);
  if (focus && result.models[focus]?.available) return focus;
  return result.recommended_model ?? result.best_model ?? "naive";
}

export function ModelPicker({ result }: { result: PipelineResult }) {
  const focus = useUi((s) => s.focusModel);
  const setFocus = useUi((s) => s.setFocusModel);
  const current = useFocusModel(result);
  return (
    <div role="radiogroup" aria-label="Model shown in the chart" className="flex flex-wrap gap-1.5">
      {MODEL_KEYS.map((k) => {
        const m = result.models[k];
        const active = k === current;
        const tags = [k === result.recommended_model && "recommended", k === result.best_model && "best"].filter(Boolean).join(", ");
        return (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={!m.available}
            title={m.available ? m.description : m.reason}
            onClick={() => setFocus(k === result.recommended_model && focus !== null ? null : k)}
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium ring-1 ring-inset transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
              active ? "bg-white/12 text-ink ring-white/30" : "text-ink-2 ring-white/10 hover:bg-white/5"
            }`}
          >
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: MODEL_COLORS[k] }} />
            {m.label}
            {tags && <span className="text-[10px] text-accent">· {tags}</span>}
          </button>
        );
      })}
    </div>
  );
}
