// Chat with the AI Analyst about the results currently on screen.

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ArrowUp, BadgeCheck, RefreshCw, Square, Trash2 } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Button } from "../components/ui";
import { type ChatEntry, MAX_QUESTION_CHARS, useChat } from "../llm/chat";
import { useDashboard } from "../state/store";

const SUGGESTIONS = [
  "Why is the planning model different from the best model?",
  "How much should we produce next month, and what range should we prepare for?",
  "Which regions should get the most stock?",
  "Explain WAPE vs MAPE in simple terms.",
];

/** Plain text with light clean-up of the markdown the model sometimes adds (bold, headings, bullets, code). */
export function clean(text: string) {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/^\s*[*-]\s+/gm, "• ")
    .replace(/`([^`]+)`/g, "$1");
}

function Message({ entry, onRetry }: { entry: ChatEntry; onRetry: () => void }) {
  if (entry.role === "note") {
    return (
      <div className="flex items-center gap-2 py-1 text-[11px] text-muted">
        <span className="h-px flex-1 bg-white/10" />
        <span className="text-center">{entry.content}</span>
        <span className="h-px flex-1 bg-white/10" />
      </div>
    );
  }
  if (entry.role === "user") {
    return (
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end">
        <p className="max-w-[88%] rounded-2xl rounded-br-md bg-[linear-gradient(135deg,rgba(94,234,212,0.22),rgba(56,189,248,0.16))] px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap text-ink ring-1 ring-[rgba(94,234,212,0.25)]">
          {entry.content}
        </p>
      </motion.div>
    );
  }
  const streaming = entry.status === "streaming";
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-start gap-1">
      <div
        className={`max-w-[94%] rounded-2xl rounded-bl-md px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap ring-1 ${
          entry.status === "error"
            ? "bg-[rgba(230,103,103,0.08)] text-ink-2 ring-[rgba(230,103,103,0.3)]"
            : "bg-black/25 text-ink-2 ring-white/8"
        }`}
        aria-busy={streaming}
      >
        {entry.status === "error" && <AlertTriangle size={13} className="mr-1 inline text-critical" aria-hidden />}
        {clean(entry.content) || (streaming ? "" : "…")}
        {streaming && <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse rounded-sm bg-accent" aria-hidden />}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 pl-1 text-[10.5px] text-muted">
        {entry.status === "done" && entry.checked !== undefined && (
          <span className={`inline-flex items-center gap-1 ${entry.unverified?.length ? "text-warning" : "text-accent"}`}>
            {entry.unverified?.length ? <AlertTriangle size={11} aria-hidden /> : <BadgeCheck size={11} aria-hidden />}
            {entry.checked === 0
              ? "no figures quoted"
              : entry.unverified?.length
                ? `${entry.unverified.length} figure(s) not found in the data: ${entry.unverified.join(", ")}`
                : `${entry.checked}/${entry.checked} figures verified`}
          </span>
        )}
        {entry.dataVersion != null && <span>· data v{entry.dataVersion}</span>}
        {entry.status === "stopped" && <span>· stopped</span>}
        {(entry.status === "error" || entry.status === "stopped") && (
          <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 text-accent hover:underline">
            <RefreshCw size={10} aria-hidden /> ask again
          </button>
        )}
      </div>
    </motion.div>
  );
}

export function ChatView() {
  const { entries, streaming, send, stop, clear } = useChat();
  const hasResult = useDashboard((s) => s.result !== null);
  const [draft, setDraft] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // Keep the newest message in view while it streams, unless the reader scrolled up
  useEffect(() => {
    const el = list.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [entries]);

  const submit = (text: string) => {
    if (!text.trim() || streaming || !hasResult) return;
    stickToBottom.current = true;
    void send(text);
    setDraft("");
  };

  const lastQuestion = [...entries].reverse().find((e) => e.role === "user")?.content ?? "";

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit(draft);
    }
  };

  return (
    <div className="flex flex-col">
      <div
        ref={list}
        role="log"
        aria-label="Conversation with the AI Analyst"
        aria-live="polite"
        aria-relevant="additions"
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="scroll-thin max-h-[52vh] min-h-[220px] space-y-2.5 overflow-y-auto pr-1"
      >
        {entries.length === 0 ? (
          <div className="space-y-3 py-2">
            <p className="text-[12.5px] leading-relaxed text-ink-2">
              Ask anything about the forecast on screen. Every answer uses the latest results, including months that have just arrived or
              figures you entered, and every figure it quotes is checked against the data.
            </p>
            <div className="flex flex-col gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => submit(s)}
                  disabled={!hasResult}
                  className="rounded-xl bg-white/5 px-3 py-2 text-left text-[12.5px] text-ink ring-1 ring-inset ring-white/10 transition-colors hover:bg-white/10 disabled:opacity-40"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {entries.map((e) => (
              <Message key={e.id} entry={e} onRetry={() => submit(lastQuestion)} />
            ))}
          </AnimatePresence>
        )}
      </div>

      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          submit(draft);
        }}
        className="mt-3"
      >
        <div className="flex items-end gap-2 rounded-2xl bg-black/35 p-2 ring-1 ring-inset ring-[var(--border-strong)] focus-within:ring-accent">
          <label htmlFor="chat-input" className="sr-only">
            Ask the AI Analyst
          </label>
          <textarea
            id="chat-input"
            rows={2}
            value={draft}
            maxLength={MAX_QUESTION_CHARS}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={hasResult ? "Ask about the forecast… (Enter to send)" : "Loading results…"}
            disabled={!hasResult}
            className="max-h-32 min-h-[40px] flex-1 resize-none bg-transparent px-1 text-[13px] text-ink outline-none placeholder:text-muted"
          />
          {streaming ? (
            <Button onClick={stop} aria-label="Stop the answer" title="Stop">
              <Square size={13} aria-hidden />
            </Button>
          ) : (
            <Button type="submit" variant="primary" aria-label="Send question" disabled={!draft.trim() || !hasResult}>
              <ArrowUp size={15} aria-hidden />
            </Button>
          )}
        </div>
        <div className="mt-1 flex items-center justify-between px-1 text-[10.5px] text-muted">
          <span>
            Answers stream live from the current results · <span className="num">{draft.length}</span>/{MAX_QUESTION_CHARS}
          </span>
          {entries.length > 0 && (
            <button type="button" onClick={clear} className="inline-flex items-center gap-1 hover:text-ink">
              <Trash2 size={11} aria-hidden /> Clear chat
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
