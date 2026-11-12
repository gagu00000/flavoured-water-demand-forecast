"""LLM interpretation for the notebook (NVIDIA API Catalog, Nemotron 3.5 Bolt E4B).

The dashboard's Netlify Function follows the same design in TypeScript:
same system prompt file, same snapshot (with its verified key facts), same
model settings, the same number-grounding check, and the same rule-based
fallback.

The NVIDIA endpoint is OpenAI-compatible (POST {base}/chat/completions). The
API key is read from the environment (NVIDIA_API_KEY, normally loaded from a
git-ignored .env file). It is never printed, logged or stored in the notebook.

Resilience: if a call fails with a temporary error (rate limit, overload,
timeout) the client pauses and tries again, within an overall time budget.
Only then does the rule-based interpretation appear.
"""

from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

from .fallback import rule_based_interpretation
from .grounding import grounding_check

DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1"
# Tried in order. Override with LLM_MODEL (one name, or a comma-separated chain).
DEFAULT_MODELS = ["nvidia/nemotron-3.5-bolt-e4b"]
ATTEMPT_TIMEOUT_S = 40
TOTAL_BUDGET_S = 90
PASSES = 2
RETRY_PAUSE_S = 3
RATE_LIMIT_PAUSE_S = 20
RETRYABLE = {408, 429, 500, 502, 503, 504}

# Model settings shared with the dashboard function (dashboard/server/interpret.ts)
GENERATION = {
    "temperature": 0.2,
    "top_p": 0.95,
    "max_tokens": 3000,
    "seed": 42,
    "response_format": {"type": "json_object"},
    # Nemotron's optional reasoning ("thinking") mode: off, because the answers
    # restate verified key facts and thinking multiplies the response time.
    "chat_template_kwargs": {"enable_thinking": False},
}

REQUIRED_KEYS = ("seasonality_trend", "best_model", "recommendations", "limitations", "confidence")


def load_system_prompt(path: str | Path) -> str:
    return Path(path).read_text(encoding="utf-8")


def build_user_message(snapshot: dict) -> str:
    """The user turn: the snapshot as JSON plus the task reminder."""
    return ("RESULTS SNAPSHOT (JSON):\n```json\n" + json.dumps(snapshot, ensure_ascii=False, indent=1) +
            "\n```\nAnswer the three questions using only this snapshot.")


def model_chain() -> list[str]:
    configured = (os.environ.get("LLM_MODEL") or "").strip()
    return [m.strip() for m in configured.split(",") if m.strip()] if configured else list(DEFAULT_MODELS)


def extract_json(text: str) -> dict:
    """Parse the JSON object in a model reply (tolerates code fences or a leading <think> block)."""
    text = re.sub(r"<think>.*?</think>", "", text or "", flags=re.DOTALL)
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("no JSON object in the reply")
    return json.loads(text[start:end + 1])


def _validate(obj: dict) -> dict:
    """Check the LLM returned every field with the right type."""
    if not isinstance(obj, dict):
        raise ValueError("response is not a JSON object")
    for key in ("seasonality_trend", "best_model"):
        if not isinstance(obj.get(key), str) or not obj[key].strip():
            raise ValueError(f"missing or empty '{key}'")
    for key in ("recommendations", "limitations"):
        if not isinstance(obj.get(key), list) or not all(isinstance(x, str) for x in obj[key]):
            raise ValueError(f"'{key}' must be a list of strings")
    if obj.get("confidence") not in ("low", "medium", "high"):
        raise ValueError("invalid 'confidence'")
    return {k: obj[k] for k in REQUIRED_KEYS}


class LlmHttpError(Exception):
    """An HTTP error from the LLM provider, keeping only the status code."""

    def __init__(self, status: int):
        super().__init__(f"HTTP {status}")
        self.status = status


def _call(base_url: str, api_key: str, model: str, system_prompt: str, snapshot: dict, generation: dict) -> dict:
    body = {
        "model": model,
        "messages": [{"role": "system", "content": system_prompt}, {"role": "user", "content": build_user_message(snapshot)}],
        "stream": False,
        **generation,
    }
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=ATTEMPT_TIMEOUT_S) as response:
            payload = json.load(response)
    except urllib.error.HTTPError as exc:
        raise LlmHttpError(exc.code) from None  # the provider's message is never surfaced
    content = payload["choices"][0]["message"].get("content") or ""
    return _validate(extract_json(content))


def _describe(exc: Exception) -> str:
    """Short, key-free description of a failure."""
    if isinstance(exc, LlmHttpError):
        return f"HTTP {exc.status}"
    if isinstance(exc, TimeoutError) or "timed out" in str(exc).lower():
        return "timed out"
    if isinstance(exc, ValueError):  # includes JSON decoding errors
        return "invalid answer format"
    return type(exc).__name__


def interpret(snapshot: dict, system_prompt: str, api_key: str | None = None, models: list[str] | None = None,
              max_unverified: int = 2, generation: dict | None = None) -> dict:
    """Ask the LLM for an interpretation; fall back to rule-based text if every attempt fails.

    Returns {"interpretation", "source", "model", "grounding", "error", "attempts", "latency_s"}.
    """
    api_key = api_key or os.environ.get("NVIDIA_API_KEY")
    base_url = os.environ.get("LLM_BASE_URL") or DEFAULT_BASE_URL
    chain = models or model_chain()
    gen = {**GENERATION, **(generation or {})}
    started = time.time()
    attempts: list[dict] = []

    def fallback(reason: str) -> dict:
        interp = rule_based_interpretation(snapshot)
        return {"interpretation": interp, "source": "rule-based", "model": None,
                "grounding": grounding_check(interp, snapshot, max_unverified), "error": reason,
                "attempts": attempts, "latency_s": round(time.time() - started, 2)}

    if not api_key:
        return fallback("NVIDIA_API_KEY is not set")

    for attempt_pass in range(PASSES):
        temporary_only, rate_limited = True, False
        for model in chain:
            if time.time() - started > TOTAL_BUDGET_S:
                attempts.append({"model": model, "outcome": "skipped (time budget used up)"})
                continue
            t0 = time.time()
            try:
                interp = _call(base_url, api_key, model, system_prompt, snapshot, gen)
            except Exception as exc:  # overloaded, rate limit, timeout, invalid answer
                status = getattr(exc, "status", None)
                outcome = _describe(exc)
                temporary_only &= status in RETRYABLE or outcome == "timed out"
                rate_limited |= status == 429
                attempts.append({"model": model, "outcome": outcome, "seconds": round(time.time() - t0, 1)})
                continue
            grounding = grounding_check(interp, snapshot, max_unverified)
            if not grounding["ok"]:
                temporary_only = False
                attempts.append({"model": model, "seconds": round(time.time() - t0, 1),
                                 "outcome": "rejected: figures not in data " + ", ".join(grounding["unverified"])})
                continue
            attempts.append({"model": model, "outcome": "ok", "seconds": round(time.time() - t0, 1)})
            interp["source"] = "llm"
            return {"interpretation": interp, "source": "llm", "model": model, "grounding": grounding,
                    "error": None, "attempts": attempts, "latency_s": round(time.time() - started, 2)}
        if not temporary_only or attempt_pass == PASSES - 1 or time.time() - started > TOTAL_BUDGET_S:
            break
        time.sleep(RATE_LIMIT_PAUSE_S if rate_limited else RETRY_PAUSE_S)

    summary = "; ".join(f"{a['model']}: {a['outcome']}" for a in attempts)
    return fallback(f"LLM unavailable ({summary})")
