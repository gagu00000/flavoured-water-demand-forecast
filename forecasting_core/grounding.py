"""Number-grounding check for LLM output.

Every number the LLM writes is extracted and compared with the numbers in the
results snapshot it was given. A number counts as verified if it equals a
snapshot value at the precision the LLM wrote it (e.g. 2.0967 written as
"2.1%"), or, for large unit counts, is within 0.5% of one (e.g. "about
160,000"). Fractions such as R² = 0.76 may also be written as 76%. P-value
statements are checked more strictly: "p = 0.21" must match a computed
p-value, and "p < 0.001" is only accepted if a computed p-value is that small.
A clause whose wording contradicts its own p-value (e.g. "not significant
(p < 0.001)") is also flagged.
Years,
month labels, small counts (e.g. "3 months") and the 80/95 interval levels are
structural and are not checked.

The dashboard's Netlify Function implements the same rules in TypeScript.
"""

from __future__ import annotations

import re

MONTH_LABEL = re.compile(r"\b\d{4}-\d{2}\b")
ARIMA_ORDER = re.compile(r"\(\s*\d\s*,\s*\d\s*,\s*\d\s*\)")
NUMBER = re.compile(r"(?<![\w.])[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?")
# A p-value statement such as "p = 0.212", "p-value of 0.21" or "p < 0.001"
P_VALUE = re.compile(r"(?<![\w])p(?:\s*-?\s*values?)?\s*(?:=|of|is|:)?\s*(<)?\s*(\d*\.\d+)", re.IGNORECASE)
STRUCTURAL_MAX_INT = 36
LEVELS = {80.0, 95.0}
SKIP_KEYS = {"p_value_display_floor"}  # a reporting constant, not a result
ALPHA = 0.05
CLAUSE_BREAK = re.compile(r"(?<!\d)\.(?!\d)|;")  # sentence ends, but not decimal points
# A verdict word, with an optional negation up to three words before it ("NOT statistically significant")
VERDICT = re.compile(r"\b(?:(?P<neg>not|no|non)[\s-]+(?:\w+\s+){0,2})?(?P<in>in)?significan\w*", re.IGNORECASE)


def _snapshot_numbers(obj, out: list[float]) -> list[float]:
    if isinstance(obj, bool) or obj is None:
        return out
    if isinstance(obj, (int, float)):
        out.append(float(obj))
        if obj != 0 and abs(obj) <= 1:
            out.append(float(obj) * 100)  # a fraction such as R^2 = 0.76 may be written as 76%
    elif isinstance(obj, dict):
        for k, v in obj.items():
            if k not in SKIP_KEYS:
                _snapshot_numbers(v, out)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            _snapshot_numbers(v, out)
    elif isinstance(obj, str):
        for token in NUMBER.findall(MONTH_LABEL.sub(" ", obj)):
            try:
                out.append(float(token.rstrip("%").replace(",", "")))
            except ValueError:
                pass
    return out


def _p_values(obj, out: list[float]) -> list[float]:
    """Every computed p-value in the snapshot (keys ending in 'p_value')."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k.endswith("p_value") and isinstance(v, (int, float)) and not isinstance(v, bool):
                out.append(float(v))
            else:
                _p_values(v, out)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            _p_values(v, out)
    return out


def _check_p_values(text: str, p_values: list[float]) -> tuple[str, list[str], list[str]]:
    """Verify p-value statements against the real p-values, then blank them out of the text.

    "p < 0.001" is accepted only if some computed p-value really is below 0.001;
    "p = 0.21" must equal a computed p-value at the precision written.
    """
    ok, bad = [], []
    for m in P_VALUE.finditer(text):
        less, raw = m.group(1), m.group(2)
        value = float(raw)
        decimals = len(raw.split(".")[1])
        if less:
            good = any(p < value for p in p_values)
        else:
            good = any(abs(p - value) <= 0.5 * 10 ** -decimals + 1e-9 for p in p_values)
        (ok if good else bad).append(m.group(0).strip())
    return P_VALUE.sub(" ", text), ok, bad


# Numbers spelled out in words ("two point seven seven percent") would slip past the digit check
SPELLED_NUMBER = re.compile(r"\b(zero|one|two|three|four|five|six|seven|eight|nine)\s+point\s+(zero|one|two|three|four|five|six|seven|eight|nine)\b", re.IGNORECASE)


def _significance_conflicts(text: str) -> list[str]:
    """Verdicts whose "significant / not significant" wording contradicts their p-value.

    Within each sentence or clause, every verdict word is paired with the nearest
    p-value. "Not significant" next to p < 0.05, or "significant" next to
    p >= 0.05, is flagged.
    """
    bad = []
    for clause in CLAUSE_BREAK.split(text):
        ps = list(P_VALUE.finditer(clause))
        if not ps:
            continue
        for v in VERDICT.finditer(clause):
            centre = (v.start() + v.end()) / 2
            m = min(ps, key=lambda p: abs((p.start() + p.end()) / 2 - centre))
            less, value = m.group(1), float(m.group(2))
            p_small = value <= ALPHA if less else value < ALPHA
            negated = bool(v.group("neg") or v.group("in"))
            if negated == p_small:
                bad.append(f"significance wording contradicts {m.group(0).strip()}")
    return bad


def _text_of(obj) -> str:
    if isinstance(obj, str):
        return obj
    if isinstance(obj, dict):
        return " ".join(_text_of(v) for k, v in obj.items() if k not in ("source", "confidence"))
    if isinstance(obj, (list, tuple)):
        return " ".join(_text_of(v) for v in obj)
    return ""


def _matches(token: str, value: float, candidates: list[float]) -> bool:
    decimals = len(token.split(".")[1].rstrip("%")) if "." in token else 0
    tolerance = 0.5 * 10 ** -decimals + 1e-9  # "equal at the precision written", rounding-mode independent
    for v in candidates:
        for cand in (v, abs(v)):
            if abs(cand - value) <= tolerance:
                return True
            if abs(value) >= 100 and cand and abs(value - cand) <= 0.005 * abs(cand):
                return True
    return False


def grounding_check(llm_output, snapshot: dict, max_unverified: int = 2) -> dict:
    """Return verified / unverified numbers and whether the output passes."""
    candidates = _snapshot_numbers(snapshot, [])
    full_text = _text_of(llm_output)
    conflicts = _significance_conflicts(full_text)
    text = ARIMA_ORDER.sub(" ", MONTH_LABEL.sub(" ", full_text))
    text, verified, bad_p = _check_p_values(text, _p_values(snapshot, []))
    # Wrong p-values and contradicted verdicts are never tolerated
    serious = bad_p + conflicts + [f"number written in words: {m.group(0)}" for m in SPELLED_NUMBER.finditer(full_text)]
    unverified = list(serious)
    for token in NUMBER.findall(text):
        is_pct = token.endswith("%")
        value = float(token.rstrip("%").replace(",", ""))
        is_int = "." not in token
        if is_int and not is_pct and (abs(value) <= STRUCTURAL_MAX_INT or 1900 <= value <= 2100):
            continue  # counts, years
        if is_pct and value in LEVELS:
            continue  # interval levels
        (verified if _matches(token.lstrip("+"), value, candidates) else unverified).append(token)
    return {
        "checked": len(verified) + len(unverified),
        "verified": verified,
        "unverified": unverified,
        "ok": not serious and len(unverified) <= max_unverified,
    }
