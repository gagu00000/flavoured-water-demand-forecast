"""Forecast accuracy metrics with explicit, documented zero handling.

With A_t = actual and F_t = forecast:

    MAPE = 100 / n' * sum_t |A_t - F_t| / |A_t|      over the n' periods where |A_t| > eps
    WAPE = 100 * sum_t |A_t - F_t| / sum_t |A_t|
    Bias = 100 * sum_t (F_t - A_t) / sum_t A_t        (+ = over-forecast, - = under-forecast)

Zero and near-zero actuals
--------------------------
MAPE divides by each actual, so a month with zero (or almost zero) sales would
explode it. Such months are excluded from MAPE and the number excluded is
returned so it can be shown next to the value. If every month is excluded,
MAPE is undefined (None), never 0 or infinity.

WAPE divides by total volume instead, so individual zero months are fine; it is
undefined only if the total actual volume is zero. That robustness, and the
fact that it weights errors by volume (what matters for production planning),
is why WAPE is the primary ranking metric in this project.
"""

from __future__ import annotations

from typing import Optional, Sequence

import numpy as np

EPS = 1.0  # actuals with |A_t| <= 1 unit count as "near zero" for MAPE


def _arrays(actual: Sequence[float], forecast: Sequence[float]) -> tuple[np.ndarray, np.ndarray]:
    a = np.asarray(actual, dtype=float)
    f = np.asarray(forecast, dtype=float)
    if a.shape != f.shape:
        raise ValueError(f"actual and forecast lengths differ: {a.shape} vs {f.shape}")
    if a.size == 0:
        raise ValueError("cannot score an empty forecast")
    return a, f


def mape(actual: Sequence[float], forecast: Sequence[float], eps: float = EPS) -> dict:
    """Mean Absolute Percentage Error (%), skipping near-zero actuals."""
    a, f = _arrays(actual, forecast)
    usable = np.abs(a) > eps
    n_excluded = int((~usable).sum())
    value: Optional[float] = None
    if usable.any():
        value = float(np.mean(np.abs(a[usable] - f[usable]) / np.abs(a[usable])) * 100)
    return {"value": value, "n_used": int(usable.sum()), "n_excluded": n_excluded}


def wape(actual: Sequence[float], forecast: Sequence[float]) -> dict:
    """Weighted Absolute Percentage Error (%)."""
    a, f = _arrays(actual, forecast)
    denom = float(np.abs(a).sum())
    value = None if denom == 0 else float(np.abs(a - f).sum() / denom * 100)
    return {"value": value, "n_used": int(a.size), "n_excluded": 0}


def bias(actual: Sequence[float], forecast: Sequence[float]) -> dict:
    """Signed volume bias (%): positive means the model over-forecast."""
    a, f = _arrays(actual, forecast)
    denom = float(a.sum())
    value = None if denom == 0 else float((f - a).sum() / denom * 100)
    return {"value": value, "n_used": int(a.size), "n_excluded": 0}


def evaluate(actual: Sequence[float], forecast: Sequence[float]) -> dict:
    """All three metrics at once, as plain floats (None when undefined)."""
    m, w, b = mape(actual, forecast), wape(actual, forecast), bias(actual, forecast)
    return {
        "mape": m["value"],
        "wape": w["value"],
        "bias": b["value"],
        "mape_excluded": m["n_excluded"],
        "n": int(np.asarray(actual).size),
    }
