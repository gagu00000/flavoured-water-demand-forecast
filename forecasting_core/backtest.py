"""Chronological train-test split and rolling-origin backtesting.

Time series must be split by time, never randomly: a random split would let a
model learn from months that come after the ones it is tested on, which is
impossible in real forecasting and makes errors look smaller than they are.

Rolling-origin backtest
-----------------------
A single 3-month test window is a small sample: one unusual month can swing
the result. The backtest repeats the same exercise at several successive
cut-off points ("origins"). At each origin a model is trained only on the
months up to that point and forecasts the next `horizon` months. The last
origin is the main train-test split. All models use the same origins, so the
comparison is fair.
"""

from __future__ import annotations

import numpy as np

from .metrics import evaluate
from .models import make_model
from .series import MonthlySeries


def chronological_split(series: MonthlySeries, test_size: int) -> tuple[MonthlySeries, MonthlySeries]:
    """Train = everything before the last `test_size` months; test = the last `test_size`."""
    if not 1 <= test_size < len(series):
        raise ValueError(f"test_size must be between 1 and {len(series) - 1}")
    cut = len(series) - test_size
    return series.head(cut), series.slice(cut, len(series))


def fit_forecast(model_key: str, train: MonthlySeries, horizon: int, **model_kwargs):
    """Fit one model on `train` and forecast `horizon` months ahead."""
    model = make_model(model_key, **model_kwargs).fit(train)
    return model, model.predict(horizon)


def backtest_origins(n: int, horizon: int, min_train: int, max_origins: int) -> list[int]:
    """Training lengths (origins) for the backtest; the last one leaves exactly `horizon` months."""
    last = n - horizon
    first = max(min_train, last - max_origins + 1)
    return list(range(first, last + 1)) if last >= first else []


def rolling_origin(series: MonthlySeries, model_keys: list[str], horizon: int,
                   max_origins: int = 12, model_kwargs: dict | None = None) -> dict:
    """Run the same rolling-origin backtest for every model in `model_keys`.

    Origins start where every listed model can be trained, so each model is
    scored on exactly the same months. `model_kwargs` maps a model key to
    constructor arguments (used to pass the ARIMA order identified on the
    training window).
    """
    model_kwargs = model_kwargs or {}
    min_train = max(make_model(k).min_train for k in model_keys) if model_keys else 1
    origins = backtest_origins(len(series), horizon, min_train, max_origins)
    out = {"origins": [series.months[o - 1] for o in origins], "horizon": horizon, "models": {}}
    for key in model_keys:
        folds, actual_all, fc_all = [], [], []
        errors_by_h = [[] for _ in range(horizon)]
        for o in origins:
            train = series.head(o)
            test = series.slice(o, o + horizon)
            _, fc = fit_forecast(key, train, horizon, **model_kwargs.get(key, {}))
            point = fc["point"]
            folds.append({
                "origin": series.months[o - 1],
                "months": test.months,
                "actual": test.units.tolist(),
                "forecast": point.tolist(),
            })
            actual_all.extend(test.units.tolist())
            fc_all.extend(point.tolist())
            for h in range(horizon):
                errors_by_h[h].append(float(test.units[h] - point[h]))
        metrics = evaluate(actual_all, fc_all) if origins else None
        out["models"][key] = {"folds": folds, "metrics": metrics, "errors_by_h": errors_by_h}
    return out


def empirical_intervals(point: np.ndarray, errors_by_h: list[list[float]], min_errors: int = 3) -> dict:
    """Approximate forecast ranges from backtest errors at each horizon step.

    For step h the 80% / 95% range is point +/- the 80th / 95th percentile of
    the absolute backtest errors at step h. Returned as None when there are
    fewer than `min_errors` errors at a step (too few to say anything useful).
    """
    h = len(point)
    if len(errors_by_h) < h or any(len(e) < min_errors for e in errors_by_h[:h]):
        return {"lower80": None, "upper80": None, "lower95": None, "upper95": None}
    q80 = np.array([np.quantile(np.abs(errors_by_h[i]), 0.80) for i in range(h)])
    q95 = np.array([np.quantile(np.abs(errors_by_h[i]), 0.95) for i in range(h)])
    return {
        "lower80": np.maximum(point - q80, 0.0), "upper80": point + q80,
        "lower95": np.maximum(point - q95, 0.0), "upper95": point + q95,
    }
