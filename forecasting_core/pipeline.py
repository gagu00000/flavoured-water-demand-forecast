"""End-to-end pipeline for one monthly series.

run_pipeline() is the single entry point used by both the notebook and the
dashboard. It performs Tasks 1-5 of the lab for every model on the same split
and horizon, and returns a JSON-ready dictionary that also contains:

  * the compact, rounded results snapshot that is sent to the LLM, and
  * a rule-based interpretation used if the LLM is unavailable.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from . import __version__
from .analysis import analyse
from .backtest import chronological_split, empirical_intervals, fit_forecast, rolling_origin
from .fallback import rule_based_interpretation
from .features import build_feature_frame, feature_availability, max_lag_rows
from .metrics import evaluate
from .models import MODEL_ORDER, make_model
from .series import MonthlySeries, as_series

MIN_BACKTEST_ORIGINS = 3
TIE_MARGIN = 0.5   # WAPE points: models this close to the best are treated as tied
SIGNIFICANCE = 0.05
P_FLOOR = 0.001    # p-values below this are reported as "p < 0.001"


@dataclass
class PipelineConfig:
    test_size: int = 3          # months held out at the end (chronological)
    horizon: int = 3            # months to forecast beyond the data
    max_backtest_origins: int = 12
    model_keys: list[str] = field(default_factory=lambda: list(MODEL_ORDER))


def _clean(obj):
    """Convert numpy types to plain Python so the result serialises to JSON."""
    if isinstance(obj, dict):
        return {k: _clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean(v) for v in obj]
    if isinstance(obj, np.ndarray):
        return [_clean(v) for v in obj.tolist()]
    if isinstance(obj, (np.floating,)):
        return None if not np.isfinite(obj) else float(obj)
    if isinstance(obj, float):
        return None if not np.isfinite(obj) else obj
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, np.bool_):
        return bool(obj)
    return obj


def _forecast_dict(fc: dict) -> dict:
    return {k: (None if v is None else (list(v) if k == "months" else np.asarray(v, dtype=float)))
            for k, v in fc.items()}


def run_pipeline(series_in, config: Optional[PipelineConfig] = None, context: Optional[dict] = None,
                 regional: Optional[dict] = None) -> dict:
    """Run preprocessing, all models, metrics, backtest and forecasts.

    series_in : MonthlySeries or list of {'month', 'units', 'days'?, 'revenue'?}
    config    : split / horizon settings
    context   : description of what is being viewed (product, region, data version...)
    regional  : optional {region: [units per month aligned with the series]} for
                allocating the forecast across regions (distribution planning)
    """
    config = config or PipelineConfig()
    context = dict(context or {})
    revenue = None
    if not isinstance(series_in, MonthlySeries):
        records = sorted(series_in, key=lambda r: r["month"])
        if records and all(r.get("revenue") is not None for r in records):
            revenue = np.array([float(r["revenue"]) for r in records])
    series = as_series(series_in)
    n = len(series)
    test_size = int(config.test_size)
    horizon = int(config.horizon)
    if n < test_size + 2:
        raise ValueError(f"Need at least {test_size + 2} months for a {test_size}-month test; have {n}.")

    # Task 3: chronological split
    train, test = chronological_split(series, test_size)

    # Task 2: which models can run on this training window
    models_out: dict = {}
    available = []
    for key in config.model_keys:
        m = make_model(key)
        ok, reason = m.check(len(train))
        models_out[key] = {
            "key": key, "label": m.label, "family": m.family, "description": m.description,
            "interval_type": m.interval_type, "available": ok, "reason": reason,
        }
        if ok:
            available.append(key)

    # ARIMA: identify the order once, on the training window only (no test data)
    model_kwargs: dict = {}
    if "arima" in available:
        identified = make_model("arima").fit(train)
        model_kwargs["arima"] = {"order": tuple(identified.params["order"])}

    # Rolling-origin backtest on identical origins for all available models
    bt = rolling_origin(series, available, horizon, config.max_backtest_origins, model_kwargs) if available \
        else {"origins": [], "horizon": horizon, "models": {}}

    for key in available:
        entry = models_out[key]
        kwargs = model_kwargs.get(key, {})
        # Tasks 3 + 5: fit on train, predict the test window, score it
        _, test_fc = fit_forecast(key, train, test_size, **kwargs)
        entry["test"] = {
            "months": test.months,
            "actual": test.units,
            "forecast": test_fc["point"],
        }
        entry["metrics_test"] = evaluate(test.units, test_fc["point"])
        # Task 4: refit on all data, forecast the next `horizon` months
        model, fc = fit_forecast(key, series, horizon, **kwargs)
        if model.interval_type == "empirical":
            fc.update(empirical_intervals(fc["point"], bt["models"][key]["errors_by_h"]))
        entry["forecast"] = _forecast_dict(fc)
        entry["params"] = model.params
        entry["importance"] = model.importance()
        bt_model = bt["models"].get(key, {})
        entry["backtest"] = {"metrics": bt_model.get("metrics"), "folds": bt_model.get("folds", [])}

    # Ranking: pooled backtest WAPE when there are enough origins, else test WAPE
    use_bt = len(bt["origins"]) >= MIN_BACKTEST_ORIGINS
    basis = "backtest WAPE" if use_bt else "test WAPE"

    def score(key):
        m = models_out[key]
        val = (m["backtest"]["metrics"] or {}).get("wape") if use_bt else m["metrics_test"]["wape"]
        return np.inf if val is None else val

    ranking = sorted(available, key=lambda k: (score(k), config.model_keys.index(k)))
    best = ranking[0] if ranking else None
    # Parsimony rule: plan with the simplest model that is effectively tied with the best.
    # config.model_keys is ordered from simplest (Naive) to most complex (XGBoost).
    recommended = None
    if best:
        recommended = next(k for k in config.model_keys
                           if k in available and score(k) <= score(best) + TIE_MARGIN + 1e-12)

    # Task 1: feature table and what features are possible with this history
    frame = build_feature_frame(series)
    features = {
        "columns": list(frame.columns),
        "rows": [{"month": idx, **{c: (None if np.isnan(v) else float(v)) for c, v in row.items()}}
                 for idx, row in frame.iterrows()],
        "availability": feature_availability(n),
        "rows_lost_to_lags": max_lag_rows(n),
    }

    analysis = analyse(series, revenue)

    allocation = None
    if regional and recommended:
        allocation = regional_allocation(regional, models_out[recommended]["forecast"])

    result = {
        "meta": {
            "core_version": __version__,
            "n_months": n,
            "first_month": series.months[0],
            "last_month": series.months[-1],
            "test_size": test_size,
            "horizon": horizon,
            "train_months": [train.months[0], train.months[-1]],
            "test_months": [test.months[0], test.months[-1]],
            "n_train": len(train),
            "backtest_origins": bt["origins"],
            "ranking_basis": basis,
        },
        "context": context,
        "series": series.to_records(),
        "features": features,
        "analysis": analysis,
        "models": models_out,
        "ranking": ranking,
        "best_model": best,
        "recommended_model": recommended,
        "regional_allocation": allocation,
    }
    result = _clean(result)
    result["snapshot"] = build_snapshot(result)
    result["fallback"] = rule_based_interpretation(result["snapshot"])
    return result


def regional_allocation(regional: dict, forecast: dict, recent_months: int = 12) -> dict:
    """Split the forecast across regions by each region's share of recent sales."""
    totals = {r: float(np.sum(np.asarray(v, dtype=float)[-recent_months:])) for r, v in regional.items()}
    grand = sum(totals.values())
    if grand <= 0:
        return None
    shares = {r: t / grand for r, t in totals.items()}
    point = np.asarray(forecast["point"], dtype=float)
    regions = sorted(shares, key=lambda r: -shares[r])
    return {
        "basis_months": recent_months,
        "months": forecast["months"],
        "regions": [{"region": r, "share": shares[r], "units": (shares[r] * point).tolist()} for r in regions],
    }


# ---------------------------------------------------------------------------
# Snapshot for the LLM: compact, rounded, and containing only computed facts
# ---------------------------------------------------------------------------

CALENDAR_USE = {
    "naive": "no",
    "seasonal_naive": "indirectly (repeats the same month last year)",
    "calendar_naive": "yes (scales by days in month)",
    "arima": "yes (days-in-month regressor)",
    "random_forest": "yes (days_in_month feature)",
    "xgboost": "yes (days_in_month feature)",
}


def _bias_direction(b):
    if b is None:
        return None
    if abs(b) < 0.5:
        return "almost unbiased"
    return "over-forecast (risk of excess stock)" if b > 0 else "under-forecast (risk of stock-outs)"


def _r(x, nd=2):
    return None if x is None else round(float(x), nd)


def _i(x):
    return None if x is None else int(round(float(x)))


def build_snapshot(result: dict) -> dict:
    meta, analysis, models = result["meta"], result["analysis"], result["models"]
    ctx = result.get("context", {})
    series = result["series"]
    trend = analysis["trend_units_per_day"]
    seas = analysis["seasonality"]
    rev = analysis.get("revenue_trend")

    model_rows = []
    for key, m in models.items():
        if not m["available"]:
            model_rows.append({"model": m["label"], "available": False, "reason": m["reason"]})
            continue
        fc = m["forecast"]
        bt = m["backtest"]["metrics"] or {}
        row = {
            "model": m["label"],
            "available": True,
            "test_mape_pct": _r(m["metrics_test"]["mape"]),
            "test_wape_pct": _r(m["metrics_test"]["wape"]),
            "test_bias_pct": _r(m["metrics_test"]["bias"]),
            "test_bias_direction": _bias_direction(m["metrics_test"]["bias"]),
            "uses_calendar_effect": CALENDAR_USE.get(key, "no"),
            "backtest_wape_pct": _r(bt.get("wape")),
            "backtest_mape_pct": _r(bt.get("mape")),
            "forecast": [
                {"month": mo, "units": _i(p),
                 "low95": _i(fc["lower95"][i]) if fc.get("lower95") else None,
                 "high95": _i(fc["upper95"][i]) if fc.get("upper95") else None}
                for i, (mo, p) in enumerate(zip(fc["months"], fc["point"]))
            ],
            "forecast_total_units": _i(sum(fc["point"])),
            "interval_type": m["interval_type"],
        }
        if m.get("params", {}).get("order"):
            row["arima_order"] = m["params"]["order"]
        if m.get("params", {}).get("training_rows") is not None:
            row["training_rows"] = m["params"]["training_rows"]
        if m.get("importance"):
            top = sorted(m["importance"].items(), key=lambda kv: -kv[1])[:3]
            row["top_features"] = [{"feature": f, "importance_pct": _r(v * 100, 1)} for f, v in top]
        model_rows.append(row)

    best_key = result["best_model"]
    best = models[best_key] if best_key else None
    naive = models.get("naive")

    limitations = ["The dataset is synthetic (simulated sales), so patterns reflect the simulator, not real consumers."]
    if meta["n_months"] < 24:
        limitations.append(f"Only {meta['n_months']} months of history: seasonality cannot be tested and machine-learning "
                           "models have very few training rows.")
    if meta["test_size"] <= 3:
        limitations.append(f"The test window is {meta['test_size']} months, so one unusual month can move MAPE noticeably.")
    if len(meta["backtest_origins"]) < MIN_BACKTEST_ORIGINS:
        limitations.append("Fewer than 3 backtest origins were possible, so the ranking relies on a single test window.")
    for note in ctx.get("notes", []):
        limitations.append(note)

    snap = {
        "context": {k: ctx.get(k) for k in ("product", "region", "customer_type", "view", "data_version",
                                             "last_change", "unit") if ctx.get(k) is not None},
        "data": {
            "first_month": meta["first_month"],
            "last_month": meta["last_month"],
            "n_months": meta["n_months"],
            "recent_months": [{"month": r["month"], "units": _i(r["units"]), "days": r["days"]} for r in series[-6:]],
            "mean_monthly_units": _i(analysis["volatility"]["mean_units"]),
            "cv_units_pct": _r(analysis["volatility"]["cv_units_pct"]),
            "cv_daily_rate_pct": _r(analysis["volatility"]["cv_daily_rate_pct"]),
        },
        "split": {
            "train": f"{meta['train_months'][0]} to {meta['train_months'][1]}",
            "n_train": meta["n_train"],
            "test": f"{meta['test_months'][0]} to {meta['test_months'][1]}",
            "test_size": meta["test_size"],
            "horizon": meta["horizon"],
            "backtest_origins": len(meta["backtest_origins"]),
            "ranking_basis": meta["ranking_basis"],
        },
        "analysis": {
            "trend_pct_per_year": _r(trend["pct_per_year"]),
            "trend_p_value": _r(trend["p_value"], 3),
            "trend_significant": trend["significant"],
            "seasonality_p_value": _r(seas["p_value"], 3),
            "seasonality_significant": seas["significant"],
            "seasonality_note": seas["reason"] or None,
            "seasonal_peak_trough_pct": _r(seas["peak_trough_pct"]),
            "days_in_month_r2": _r(analysis["calendar"]["r2"]),
            "acf_lag1": _r(analysis["acf"]["acf"][0]) if analysis["acf"]["acf"] else None,
            "acf_bound": _r(analysis["acf"]["bound"]),
            "revenue_trend_pct_per_year": _r(rev["pct_per_year"]) if rev else None,
            "revenue_trend_p_value": _r(rev["p_value"], 3) if rev else None,
        },
        "models": model_rows,
        "best_model": None if not best else {
            "model": best["label"],
            "basis": meta["ranking_basis"],
            "wape_pct": _r((best["backtest"]["metrics"] or {}).get("wape") if meta["ranking_basis"].startswith("backtest")
                           else best["metrics_test"]["wape"]),
            "beats_naive_by_pct_points": None,
        },
        "limitations": limitations,
        "reporting": {"significance_level": SIGNIFICANCE, "p_value_display_floor": P_FLOOR,
                      "tie_margin_pct_points": TIE_MARGIN},
    }
    rec_key = result.get("recommended_model")
    if rec_key:
        rec = models[rec_key]
        snap["recommended_model"] = {
            "model": rec["label"],
            "rule": f"simplest model whose {meta['ranking_basis']} is within {TIE_MARGIN} points of the best",
            "wape_pct": _r((rec["backtest"]["metrics"] or {}).get("wape")
                           if meta["ranking_basis"].startswith("backtest") else rec["metrics_test"]["wape"]),
            "same_as_best": rec_key == best_key,
        }
    use_bt = meta["ranking_basis"].startswith("backtest")

    def rank_wape(m):
        return (m["backtest"]["metrics"] or {}).get("wape") if use_bt else m["metrics_test"]["wape"]

    if best and naive and naive.get("available") and best_key != "naive":
        b, nv = rank_wape(best), rank_wape(naive)
        if b is not None and nv is not None:
            snap["best_model"]["beats_naive_by_pct_points"] = _r(nv - b)
            snap["best_model"]["naive_wape_pct"] = _r(nv)
    if best and len(result["ranking"]) > 1:
        second = models[result["ranking"][1]]
        b, s2 = rank_wape(best), rank_wape(second)
        if b is not None and s2 is not None:
            snap["best_model"]["runner_up"] = second["label"]
            snap["best_model"]["runner_up_wape_pct"] = _r(s2)
            snap["best_model"]["margin_pct_points"] = _r(s2 - b)
    snap["ranking"] = [
        {"rank": i + 1, "model": models[k]["label"], "wape_pct": _r(rank_wape(models[k]))}
        for i, k in enumerate(result["ranking"])
    ]
    alloc = result.get("regional_allocation")
    if alloc:
        snap["regional_top5"] = [
            {"region": r["region"], "share_pct": _r(r["share"] * 100, 1), "units_next_horizon": _i(sum(r["units"]))}
            for r in alloc["regions"][:5]
        ]
    snap["key_facts"] = key_facts(snap)
    return snap


def _p_text(p) -> str:
    return "p < 0.001" if p is not None and p < P_FLOOR else f"p = {p}"


def key_facts(snap: dict) -> list[str]:
    """Pre-written, verified statements the LLM should rely on.

    Small language models restate facts well but can misread raw statistics
    (for example, which way a bias points or whether a p-value is significant).
    These sentences carry the verdicts explicitly, built only from the snapshot's
    own (rounded) numbers, so the LLM explains rather than infers.
    """
    a, data, split = snap["analysis"], snap["data"], snap["split"]
    rows = [m for m in snap["models"] if m.get("available")]
    facts = [f"Data: {data['n_months']} months from {data['first_month']} to {data['last_month']}; "
             f"train {split['train']}, test {split['test']}; forecast horizon {split['horizon']} months."]

    if a.get("trend_pct_per_year") is not None:
        verdict = "statistically significant" if a.get("trend_significant") else "NOT statistically significant"
        facts.append(f"Volume trend: {a['trend_pct_per_year']:+.2f}% per year, {verdict} ({_p_text(a['trend_p_value'])}).")
    if a.get("seasonality_p_value") is None:
        facts.append("Seasonality: cannot be tested yet because each calendar month has been observed only once "
                     "(at least 24 months are needed). Do not claim a seasonal pattern.")
    else:
        verdict = "statistically significant" if a.get("seasonality_significant") else "NOT statistically significant"
        facts.append(f"Seasonality (month-of-year effect): {verdict} ({_p_text(a['seasonality_p_value'])}); "
                     f"peak-to-trough spread {a['seasonal_peak_trough_pct']}%.")
    calendar_models = [m["model"] for m in rows if str(m.get("uses_calendar_effect", "")).startswith("yes")]
    if a.get("days_in_month_r2") is not None:
        facts.append(f"Calendar effect: the number of days in a month explains R² = {a['days_in_month_r2']} of the "
                     f"month-to-month variation. Models that use it: {', '.join(calendar_models) or 'none'}.")
    if a.get("acf_lag1") is not None and a.get("acf_bound") is not None and abs(a["acf_lag1"]) <= a["acf_bound"]:
        facts.append(f"Month-to-month changes behave like random noise around a stable level (lag-1 autocorrelation "
                     f"{a['acf_lag1']}, inside the noise band of ±{a['acf_bound']}), which favours simple or averaging models.")
    if a.get("revenue_trend_pct_per_year") is not None:
        rp = a.get("revenue_trend_p_value")
        verdict = "statistically significant" if rp is not None and rp < SIGNIFICANCE else "NOT statistically significant"
        facts.append(f"Revenue per day trend: {a['revenue_trend_pct_per_year']:+.2f}% per year, {verdict} "
                     f"({_p_text(a['revenue_trend_p_value'])}).")

    best, rec = snap.get("best_model"), snap.get("recommended_model")
    if best:
        line = f"Best model on {best['basis']}: {best['model']} at {best['wape_pct']}% WAPE"
        if best.get("naive_wape_pct") is not None:
            line += f"; Naive benchmark {best['naive_wape_pct']}%"
        if best.get("runner_up"):
            line += f"; runner-up {best['runner_up']} at {best['runner_up_wape_pct']}% (margin {best['margin_pct_points']} points)"
        facts.append(line + ".")
        if best.get("margin_pct_points") is not None and best["margin_pct_points"] < TIE_MARGIN:
            facts.append(f"The margin is below {TIE_MARGIN} points, so the top models are effectively tied.")
    if rec:
        if rec.get("same_as_best"):
            facts.append(f"Planning model: {rec['model']} (it is also the best model).")
        else:
            facts.append(f"Planning model: {rec['model']} ({rec['wape_pct']}% WAPE), because it is the {rec['rule']}; "
                         "simpler models are easier to explain and less likely to over-fit.")
        row = next((m for m in rows if m["model"] == rec["model"]), None)
        if row:
            parts = [f"{f['month']}: {f['units']:,} units" + (f" (95% range {f['low95']:,} to {f['high95']:,})" if f.get("low95") is not None else "")
                     for f in row["forecast"]]
            facts.append(f"Planning-model forecast: {'; '.join(parts)}; total {row['forecast_total_units']:,} units.")
            if row.get("test_bias_pct") is not None:
                facts.append(f"Planning-model test bias: {row['test_bias_pct']:+.2f}%, meaning {row['test_bias_direction']}.")
    tree_rows = [m["training_rows"] for m in rows if m.get("training_rows") is not None]
    if tree_rows and min(tree_rows) < 12:
        facts.append(f"Random Forest and XGBoost trained on only {min(tree_rows)} rows, too few to learn reliable patterns.")
    if snap.get("regional_top5"):
        top = snap["regional_top5"][:3]
        facts.append("Largest regions by recent share: " + ", ".join(f"{r['region']} {r['share_pct']}%" for r in top) + ".")
    return facts
