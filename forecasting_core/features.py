"""Feature engineering: lag features and seasonal (calendar) indicators.

Every feature for month t is built only from information available before t
(lags, rolling means) or known in advance (calendar facts), so nothing leaks
from the future into the past.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .series import MonthlySeries, month_number

BASE_LAGS = (1, 2, 3)
SEASONAL_LAG = 12
LAG12_MIN_HISTORY = 24  # lag-12 needs 12 months to look back plus 12 rows to learn from


def use_seasonal_lag(n_history: int) -> bool:
    """Lag-12 is only worth using with at least two full years of history."""
    return n_history >= LAG12_MIN_HISTORY


def max_lag_rows(n_history: int) -> int:
    """How many of the first months cannot be training rows for the tree models."""
    return min(n_history, SEASONAL_LAG if use_seasonal_lag(n_history) else max(BASE_LAGS))


def calendar_features(months: list[str], days: np.ndarray) -> pd.DataFrame:
    """Seasonal indicators that are known in advance for any month."""
    month_of_year = np.array([month_number(m) for m in months], dtype=float)
    return pd.DataFrame(
        {
            "days_in_month": np.asarray(days, dtype=float),
            "month_sin": np.sin(2 * np.pi * month_of_year / 12),
            "month_cos": np.cos(2 * np.pi * month_of_year / 12),
        },
        index=months,
    )


def feature_names(seasonal_lag: bool) -> list[str]:
    """Feature columns used by the tree models (Random Forest, XGBoost)."""
    names = [f"lag_{k}" for k in BASE_LAGS] + ["rolling_mean_3", "days_in_month", "month_sin", "month_cos"]
    if seasonal_lag:
        names.append(f"lag_{SEASONAL_LAG}")
    return names


def lag_row(history: np.ndarray, month: str, days: float, seasonal_lag: bool) -> dict:
    """Features for the month right after `history` (history[-1] is lag 1)."""
    row = {f"lag_{k}": float(history[-k]) for k in BASE_LAGS}
    row["rolling_mean_3"] = float(np.mean(history[-3:]))
    cal = calendar_features([month], np.array([days]))
    row.update({col: float(cal[col].iloc[0]) for col in cal.columns})
    if seasonal_lag:
        row[f"lag_{SEASONAL_LAG}"] = float(history[-SEASONAL_LAG])
    return row


def build_feature_frame(series: MonthlySeries, seasonal_lag: bool | None = None) -> pd.DataFrame:
    """Full feature table for a series (one row per month).

    Rows whose lags reach before the first month are NaN for those lags; the
    models drop them, and the dashboard highlights them as 'rows lost to lags'.
    """
    if seasonal_lag is None:
        seasonal_lag = use_seasonal_lag(len(series))
    s = pd.Series(series.units, index=series.months)
    frame = pd.DataFrame(index=series.months)
    frame["units"] = s
    frame["t"] = np.arange(1, len(series) + 1)  # trend index (months since launch)
    frame["daily_rate"] = series.daily_rate
    for k in BASE_LAGS:
        frame[f"lag_{k}"] = s.shift(k)
    frame["rolling_mean_3"] = s.shift(1).rolling(3).mean()
    frame = frame.join(calendar_features(series.months, series.days))
    if seasonal_lag:
        frame[f"lag_{SEASONAL_LAG}"] = s.shift(SEASONAL_LAG)
    return frame


def training_matrix(series: MonthlySeries, seasonal_lag: bool) -> tuple[pd.DataFrame, np.ndarray]:
    """X, y for the tree models: only rows where every lag is available."""
    frame = build_feature_frame(series, seasonal_lag)
    cols = feature_names(seasonal_lag)
    usable = frame[cols].notna().all(axis=1)
    return frame.loc[usable, cols], frame.loc[usable, "units"].to_numpy()


def feature_availability(n_months: int) -> list[dict]:
    """Which features can be used with n months of history, and why not."""
    max_lag = max(BASE_LAGS)
    return [
        {"feature": "days_in_month", "available": True, "note": "Known for every month; the only seasonal indicator with real signal in this data."},
        {"feature": "month_sin / month_cos", "available": True,
         "note": "Usable, but each calendar month appears only once in the first year, so month effects cannot be learned yet."
         if n_months < 24 else "At least two observations per calendar month."},
        {"feature": "lag_1..lag_3, rolling_mean_3", "available": n_months > max_lag,
         "note": f"Costs the first {max_lag} months as training rows ({max(n_months - max_lag, 0)} rows remain)."},
        {"feature": "lag_12", "available": use_seasonal_lag(n_months),
         "note": "Needs 24+ months (12 to look back, 12 to learn from)."
         if not use_seasonal_lag(n_months) else f"Costs the first 12 months ({n_months - 12} rows remain)."},
        {"feature": "t (trend index)", "available": True,
         "note": "Used for the trend test; not given to tree models because trees cannot extrapolate a trend."},
    ]
