"""Trend, seasonality and calendar-effect statistics.

Everything is measured on the daily sales rate (units / days) so that the
length of the month does not masquerade as seasonality.
"""

from __future__ import annotations

from typing import Optional

import numpy as np
from scipy import stats

from .series import MonthlySeries, month_number

ALPHA = 0.05
MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def trend_test(values: np.ndarray) -> dict:
    """Linear trend: slope per month, % change per year, p-value and R^2."""
    values = np.asarray(values, dtype=float)
    if values.size < 3:
        return {"slope_per_month": None, "pct_per_year": None, "p_value": None, "r2": None,
                "significant": None, "fitted": None}
    t = np.arange(values.size)
    lr = stats.linregress(t, values)
    mean = values.mean()
    return {
        "slope_per_month": float(lr.slope),
        "pct_per_year": float(lr.slope * 12 / mean * 100) if mean else None,
        "p_value": float(lr.pvalue),
        "r2": float(lr.rvalue ** 2),
        "significant": bool(lr.pvalue < ALPHA),
        "fitted": (lr.intercept + lr.slope * t).tolist(),
    }


def seasonality_test(series: MonthlySeries) -> dict:
    """Month-of-year effect on the daily rate (one-way ANOVA).

    Needs at least two observations of a calendar month to separate a seasonal
    pattern from noise, i.e. 24+ months. With less, the index is still shown
    but the test is reported as not possible.
    """
    rate = series.daily_rate
    moy = np.array([month_number(m) for m in series.months])
    overall = rate.mean()
    index = []
    for m in range(1, 13):
        vals = rate[moy == m]
        index.append({
            "month": MONTH_NAMES[m - 1],
            "index": float(vals.mean() / overall) if vals.size else None,
            "n": int(vals.size),
            "sd": float(np.std(vals / overall, ddof=1)) if vals.size >= 2 else None,
        })
    groups = [rate[moy == m] for m in range(1, 13) if (moy == m).sum() >= 2]
    result = {"index": index, "f_stat": None, "p_value": None, "significant": None,
              "peak_trough_pct": None, "reason": ""}
    present = [r["index"] for r in index if r["index"] is not None]
    if present:
        result["peak_trough_pct"] = float((max(present) - min(present)) * 100)
    if len(groups) < 2:
        result["reason"] = ("Each calendar month has been observed only once, so a seasonal pattern cannot be "
                            "separated from random noise (needs 24+ months).")
        return result
    f, p = stats.f_oneway(*groups)
    result.update({"f_stat": float(f), "p_value": float(p), "significant": bool(p < ALPHA)})
    return result


def calendar_effect(series: MonthlySeries) -> dict:
    """How much of the month-to-month movement is explained by the number of days."""
    if len(series) < 3 or np.std(series.days) == 0:
        return {"r2": None, "corr": None, "units_per_day": float(series.daily_rate.mean())}
    r = float(np.corrcoef(series.units, series.days)[0, 1])
    return {"r2": r * r, "corr": r, "units_per_day": float(series.daily_rate.mean())}


def autocorrelation(values: np.ndarray, max_lag: int = 12) -> dict:
    """Sample ACF with the usual +/-1.96/sqrt(n) significance bound."""
    from statsmodels.tsa.stattools import acf

    values = np.asarray(values, dtype=float)
    n = values.size
    lags = int(min(max_lag, n - 2))
    if lags < 1:
        return {"lags": [], "acf": [], "bound": None}
    vals = acf(values, nlags=lags, fft=False)
    return {"lags": list(range(1, lags + 1)), "acf": [float(v) for v in vals[1:]],
            "bound": float(1.96 / np.sqrt(n))}


def volatility(series: MonthlySeries) -> dict:
    u, r = series.units, series.daily_rate
    return {
        "cv_units_pct": float(np.std(u, ddof=1) / u.mean() * 100) if len(u) > 1 and u.mean() else None,
        "cv_daily_rate_pct": float(np.std(r, ddof=1) / r.mean() * 100) if len(r) > 1 and r.mean() else None,
        "mean_units": float(u.mean()),
        "min_units": float(u.min()),
        "max_units": float(u.max()),
    }


def analyse(series: MonthlySeries, revenue: Optional[np.ndarray] = None) -> dict:
    """All descriptive statistics used by the notebook, dashboard and LLM."""
    out = {
        "trend_units_per_day": trend_test(series.daily_rate),
        "seasonality": seasonality_test(series),
        "calendar": calendar_effect(series),
        "acf": autocorrelation(series.daily_rate),
        "volatility": volatility(series),
        "revenue_trend": None,
    }
    if revenue is not None and len(revenue) == len(series):
        out["revenue_trend"] = trend_test(np.asarray(revenue, dtype=float) / series.days)
    return out
