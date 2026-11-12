"""The six forecasting models compared in this exercise.

Every model follows the same small interface so they can be compared fairly
on exactly the same chronological split and horizon:

    model.check(n_train)  -> (available, reason)
    model.fit(series)     -> model
    model.predict(h)      -> {"months", "point", "lower80", "upper80", "lower95", "upper95"}

Uncertainty ranges, "where the model supports it":
    Naive family : analytic, from the spread of past changes (sigma * sqrt(h))
    ARIMA        : native statsmodels prediction intervals
    RF / XGBoost : no built-in intervals; empirical ranges from rolling-origin
                   backtest errors are attached later and labelled approximate
"""

from __future__ import annotations

import warnings
from typing import Optional

import numpy as np

from .features import feature_names, lag_row, training_matrix, use_seasonal_lag
from .series import MonthlySeries

Z80, Z95 = 1.2815515655446004, 1.959963984540054
SEED = 42


def _interval(point: np.ndarray, sigma: Optional[np.ndarray]) -> dict:
    """Symmetric normal interval around `point` (None if sigma is unknown)."""
    if sigma is None:
        return {"lower80": None, "upper80": None, "lower95": None, "upper95": None}
    return {
        "lower80": np.maximum(point - Z80 * sigma, 0.0),
        "upper80": point + Z80 * sigma,
        "lower95": np.maximum(point - Z95 * sigma, 0.0),
        "upper95": point + Z95 * sigma,
    }


class ForecastModel:
    key = "base"
    label = "Base"
    family = "baseline"
    min_train = 1
    interval_type = "none"  # analytic | native | empirical | none
    description = ""

    def __init__(self) -> None:
        self.series: Optional[MonthlySeries] = None
        self.params: dict = {}

    def check(self, n_train: int) -> tuple[bool, str]:
        if n_train < self.min_train:
            return False, f"Needs at least {self.min_train} training months (has {n_train})."
        return True, ""

    def fit(self, series: MonthlySeries) -> "ForecastModel":
        ok, reason = self.check(len(series))
        if not ok:
            raise ValueError(f"{self.label}: {reason}")
        self.series = series
        self._fit(series)
        return self

    def predict(self, horizon: int) -> dict:
        if self.series is None:
            raise RuntimeError("fit() must be called before predict()")
        months, days = self.series.future_calendar(horizon)
        point, sigma = self._predict(horizon, months, days)
        point = np.maximum(np.asarray(point, dtype=float), 0.0)  # sales cannot be negative
        out = {"months": months, "point": point}
        out.update(_interval(point, sigma))
        return out

    def importance(self) -> Optional[dict]:
        return None

    # Subclasses implement these two.
    def _fit(self, series: MonthlySeries) -> None:
        raise NotImplementedError

    def _predict(self, horizon: int, months: list[str], days: np.ndarray):
        raise NotImplementedError


def _sd(values: np.ndarray) -> Optional[float]:
    """Sample standard deviation, or None with fewer than 2 values."""
    values = np.asarray(values, dtype=float)
    return float(np.std(values, ddof=1)) if values.size >= 2 else None


class NaiveModel(ForecastModel):
    key = "naive"
    label = "Naive"
    min_train = 1
    interval_type = "analytic"
    description = "Next months = the last observed month. The benchmark every model must beat."

    def _fit(self, series):
        self.sigma = _sd(np.diff(series.units))

    def _predict(self, horizon, months, days):
        point = np.repeat(self.series.units[-1], horizon)
        h = np.arange(1, horizon + 1)
        return point, None if self.sigma is None else self.sigma * np.sqrt(h)


class SeasonalNaiveModel(ForecastModel):
    key = "seasonal_naive"
    label = "Seasonal Naive"
    min_train = 12
    interval_type = "analytic"
    description = "Next months = the same months one year earlier. Needs a full year of history."

    def check(self, n_train):
        if n_train < 12:
            return False, f"Needs a full year (12 months) of training history to look back on; has {n_train}."
        return True, ""

    def _fit(self, series):
        y = series.units
        self.sigma = _sd(y[12:] - y[:-12]) if len(y) >= 14 else None

    def _predict(self, horizon, months, days):
        y = self.series.units
        n = len(y)
        point = np.array([y[n - 12 + (step % 12)] for step in range(horizon)])
        k = np.arange(horizon) // 12
        return point, None if self.sigma is None else self.sigma * np.sqrt(k + 1)


class CalendarNaiveModel(ForecastModel):
    key = "calendar_naive"
    label = "Calendar-adjusted Naive"
    min_train = 1
    interval_type = "analytic"
    description = ("Last month's sales per day x the number of days in each future month. "
                   "Uses the days-in-month seasonal indicator.")

    def _fit(self, series):
        self.rate = series.units[-1] / series.days[-1]
        self.sigma_rate = _sd(np.diff(series.daily_rate))

    def _predict(self, horizon, months, days):
        point = self.rate * days
        h = np.arange(1, horizon + 1)
        sigma = None if self.sigma_rate is None else self.sigma_rate * np.sqrt(h) * days
        return point, sigma


class ArimaModel(ForecastModel):
    """ARIMA(p,d,q) with days-in-month as an external regressor (statsmodels SARIMAX).

    The order is identified by AICc (AIC corrected for small samples) from a
    small grid: d in {0, 1} and p + q <= 2, restricted to p + q <= 1 with fewer
    than 18 training months so the model cannot have more parameters than the
    data can support. The pipeline identifies the order once, on the training
    window only, then re-estimates the parameters with that order at every
    backtest origin and for the final forecast (the usual identify-then-estimate
    workflow, and fast enough to run in the browser).
    """

    key = "arima"
    label = "ARIMA"
    family = "statistical"
    min_train = 6
    interval_type = "native"
    description = "ARIMA(p,d,q) with a days-in-month regressor; order chosen by AICc."
    DAYS_CENTER = 30.4375  # average month length; centring keeps the constant interpretable

    def __init__(self, order: Optional[tuple[int, int, int]] = None) -> None:
        super().__init__()
        self.fixed_order = tuple(order) if order is not None else None

    @staticmethod
    def grid(n: int) -> list[tuple[int, int, int]]:
        max_pq = 2 if n >= 18 else 1
        return [(p, d, q) for d in (0, 1) for p in (0, 1, 2) for q in (0, 1, 2) if p + q <= max_pq]

    def _fit_order(self, y, exog, order):
        from statsmodels.tsa.statespace.sarimax import SARIMAX

        trend = "c" if order[1] == 0 else "n"
        model = SARIMAX(y, exog=exog, order=order, trend=trend,
                        enforce_stationarity=True, enforce_invertibility=True)
        return model.fit(disp=False, maxiter=200)

    def _fit(self, series):
        y = series.units
        exog = (series.days - self.DAYS_CENTER).reshape(-1, 1)
        best = None
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            candidates = [self.fixed_order] if self.fixed_order else self.grid(len(y))
            for order in candidates:
                try:
                    res = self._fit_order(y, exog, order)
                except Exception:  # an order that cannot be estimated is skipped
                    continue
                score = res.aicc
                if np.isfinite(score) and (best is None or score < best[0] - 1e-9):
                    best = (score, order, res)
        if best is None:
            raise ValueError("ARIMA: no order could be estimated on this data")
        self.result = best[2]
        self.params = {"order": list(best[1]), "aicc": float(best[0]),
                       "order_selection": "fixed" if self.fixed_order else "AICc grid search"}

    def _predict(self, horizon, months, days):
        exog = (days - self.DAYS_CENTER).reshape(-1, 1)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            fc = self.result.get_forecast(steps=horizon, exog=exog)
        self._native = {
            "mean": np.asarray(fc.predicted_mean, dtype=float),
            "ci80": np.asarray(fc.conf_int(alpha=0.20), dtype=float),
            "ci95": np.asarray(fc.conf_int(alpha=0.05), dtype=float),
        }
        return self._native["mean"], None

    def predict(self, horizon):
        out = super().predict(horizon)
        ci80, ci95 = self._native["ci80"], self._native["ci95"]
        out.update({
            "lower80": np.maximum(ci80[:, 0], 0.0), "upper80": ci80[:, 1],
            "lower95": np.maximum(ci95[:, 0], 0.0), "upper95": ci95[:, 1],
        })
        return out


class TreeModel(ForecastModel):
    """Shared logic for Random Forest and XGBoost.

    Features: lag_1..3, rolling_mean_3, days_in_month, month_sin, month_cos,
    plus lag_12 once 24+ months exist. Multi-step forecasts are recursive: each
    prediction is fed back in as the lag for the next month, so no future
    actuals are ever used.
    """

    family = "machine learning"
    MIN_ROWS = 4
    min_train = 3 + MIN_ROWS  # 3 months lost to lags + at least 4 rows to learn from
    interval_type = "empirical"

    def check(self, n_train):
        if n_train < self.min_train:
            return False, (f"Needs {self.min_train}+ training months: the first 3 are used up by lag features "
                           f"and at least {self.MIN_ROWS} rows are needed to learn (has {n_train}).")
        return True, ""

    def _make_estimator(self):
        raise NotImplementedError

    def _fit(self, series):
        self.seasonal_lag = use_seasonal_lag(len(series))
        self.columns = feature_names(self.seasonal_lag)
        X, y = training_matrix(series, self.seasonal_lag)
        self.n_rows = len(y)
        self.estimator = self._make_estimator()
        self.estimator.fit(X.to_numpy(), y)
        self.params = {"training_rows": int(self.n_rows), "features": list(self.columns)}

    def _predict(self, horizon, months, days):
        history = list(self.series.units)
        preds = []
        for month, d in zip(months, days):
            row = lag_row(np.array(history), month, d, self.seasonal_lag)
            x = np.array([[row[c] for c in self.columns]])
            value = float(self.estimator.predict(x)[0])
            preds.append(value)
            history.append(value)  # recursive: the forecast becomes the next lag
        return np.array(preds), None

    def importance(self):
        imp = np.asarray(self.estimator.feature_importances_, dtype=float)
        total = imp.sum()
        if total > 0:
            imp = imp / total
        return {c: float(v) for c, v in zip(self.columns, imp)}


class RandomForestModel(TreeModel):
    key = "random_forest"
    label = "Random Forest"
    description = "100 shallow decision trees averaged, trained on lag and calendar features."

    def _make_estimator(self):
        from sklearn.ensemble import RandomForestRegressor

        return RandomForestRegressor(n_estimators=100, max_depth=3, min_samples_leaf=2,
                                     random_state=SEED, n_jobs=1)


class XGBoostModel(TreeModel):
    key = "xgboost"
    label = "XGBoost"
    description = "Gradient-boosted shallow trees with strong regularisation, on lag and calendar features."

    def _make_estimator(self):
        from xgboost import XGBRegressor

        return XGBRegressor(n_estimators=200, max_depth=2, learning_rate=0.05, subsample=1.0,
                            colsample_bytree=1.0, reg_lambda=1.0, min_child_weight=1,
                            tree_method="exact", random_state=SEED, n_jobs=1)


MODEL_REGISTRY = {
    cls.key: cls
    for cls in (NaiveModel, SeasonalNaiveModel, CalendarNaiveModel, ArimaModel, RandomForestModel, XGBoostModel)
}
MODEL_ORDER = list(MODEL_REGISTRY)


def make_model(key: str, **kwargs) -> ForecastModel:
    """Create a model by key; kwargs are passed to its constructor (e.g. ARIMA order)."""
    if key not in MODEL_REGISTRY:
        raise KeyError(f"unknown model '{key}'")
    return MODEL_REGISTRY[key](**kwargs)
