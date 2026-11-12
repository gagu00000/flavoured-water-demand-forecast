// Real-time chat with the AI Analyst.
//
// Each question is sent together with the results snapshot currently on screen,
// so answers always reflect the latest data and settings. Answers stream in token
// by token; when an answer is complete, every figure in it is checked against the
// same snapshot (the same grounding rules the server applies to interpretations).

import { create } from "zustand";
import { groundingCheck } from "../../server/grounding";
import { useDashboard } from "../state/store";

export const MAX_QUESTION_CHARS = 600;
const MAX_CONTEXT_MESSAGES = 9; // earlier turns sent as context (plus the new question)
const MAX_ANSWER_CONTEXT_CHARS = 2_500;

export interface ChatEntry {
  id: number;
  role: "user" | "assistant" | "note";
  content: string;
  status?: "streaming" | "done" | "error" | "stopped";
  model?: string;
  checked?: number;
  unverified?: string[];
  dataVersion?: number | null;
  lastMonth?: string;
}

interface ChatState {
  entries: ChatEntry[];
  streaming: boolean;
  send: (question: string) => Promise<void>;
  stop: () => void;
  clear: () => void;
}

let nextId = 1;
let controller: AbortController | null = null;

export function chatErrorReason(status: number, serverReason?: string): string {
  if (status === 429) return "You're sending messages quickly. Please wait a minute and try again.";
  if (status === 404) return "Chat is not available in this environment.";
  if (serverReason) return serverReason;
  return status >= 500 ? "The AI service is temporarily unavailable." : "The AI could not answer that.";
}

export const useChat = create<ChatState>((set, get) => {
  const patch = (id: number, changes: Partial<ChatEntry>) =>
    set({ entries: get().entries.map((e) => (e.id === id ? { ...e, ...changes } : e)) });

  return {
    entries: [],
    streaming: false,

    async send(question) {
      const text = question.trim().slice(0, MAX_QUESTION_CHARS);
      const result = useDashboard.getState().result;
      if (!text || get().streaming || !result) return;
      const version = typeof result.context?.data_version === "number" ? result.context.data_version : null;
      const lastChange = result.context?.last_change;

      // Mark when the data changed since the previous answer, so the thread reads correctly
      const entries = [...get().entries];
      const lastAnswer = [...entries].reverse().find((e) => e.role === "assistant" && e.status === "done");
      if (lastAnswer && (lastAnswer.dataVersion !== version || lastAnswer.lastMonth !== result.meta.last_month)) {
        entries.push({
          id: nextId++,
          role: "note",
          content: `Results updated: data version ${version ?? "?"}, through ${result.meta.last_month}${lastChange ? ` (${lastChange})` : ""}.`,
        });
      }

      const history = entries
        .filter((e) => (e.role === "user" || e.role === "assistant") && e.status !== "error" && e.content.trim())
        .slice(-MAX_CONTEXT_MESSAGES)
        .map((e) => ({ role: e.role as "user" | "assistant", content: e.content.slice(0, MAX_ANSWER_CONTEXT_CHARS) }));
      // The API expects the conversation to start with a user turn
      while (history.length && history[0].role !== "user") history.shift();

      const userEntry: ChatEntry = { id: nextId++, role: "user", content: text };
      const answer: ChatEntry = {
        id: nextId++,
        role: "assistant",
        content: "",
        status: "streaming",
        dataVersion: version,
        lastMonth: result.meta.last_month,
      };
      set({ entries: [...entries, userEntry, answer], streaming: true });

      controller = new AbortController();
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ snapshot: result.snapshot, messages: [...history, { role: "user", content: text }] }),
          signal: controller.signal,
        });
        const type = res.headers.get("content-type") ?? "";
        if (!res.ok || type.includes("application/json") || !res.body) {
          let reason: string | undefined;
          try {
            reason = ((await res.json()) as { reason?: string }).reason;
          } catch {
            /* not JSON */
          }
          patch(answer.id, { status: "error", content: chatErrorReason(res.status, reason) });
          return;
        }
        const model = res.headers.get("x-llm-model") ?? undefined;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let content = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          content += decoder.decode(value, { stream: true });
          patch(answer.id, { content, model });
        }
        content = content.trim();
        const g = groundingCheck(content, result.snapshot);
        patch(answer.id, {
          content: content || "The AI returned an empty answer. Please ask again.",
          status: content ? "done" : "error",
          model,
          checked: g.checked,
          unverified: g.unverified,
        });
      } catch (err) {
        const current = get().entries.find((e) => e.id === answer.id);
        if (err instanceof DOMException && err.name === "AbortError") {
          patch(answer.id, { status: "stopped", content: current?.content || "Stopped." });
        } else {
          patch(answer.id, { status: "error", content: "The AI service could not be reached. Please try again." });
        }
      } finally {
        controller = null;
        set({ streaming: false });
      }
    },

    stop() {
      controller?.abort();
    },

    clear() {
      controller?.abort();
      set({ entries: [], streaming: false });
    },
  };
});
