"""Rule-based interpretation: the fallback when the LLM cannot be used.

It answers the slide's three questions with templated sentences driven only by
numbers in the results snapshot, so it can never invent a figure. It is shown
with a clear "rule-based" label whenever the LLM call fails, is rate-limited,
times out, or produces numbers that are not in the data.
"""

from __future__ import annotations

WHY_BEST = {
    "Naive": "the series sits around a stable level with random month-to-month noise, so the last observed value is "
             "very hard to beat and there is nothing to over-fit.",
    "Seasonal Naive": "repeating the same month from last year captures recurring calendar effects without estimating "
                      "any parameters.",
    "Calendar-adjusted Naive": "it captures the days-in-month effect, the one systematic pattern in this data, while "
                               "having no parameters that could over-fit the short history.",
    "ARIMA": "it combines a stable level with the days-in-month regressor and estimates the noise structure, with "
             "its order chosen by AICc to avoid over-fitting.",
    "Random Forest": "its lag and calendar features captured patterns the simpler models missed.",
    "XGBoost": "its lag and calendar features captured patterns the simpler models missed.",
}


def _fmt_units(x) -> str:
    return "n/a" if x is None else f"{int(x):,}"


def _fmt_pct(x) -> str:
    return "n/a" if x is None else f"{x:.2f}%"


def _fmt_p(p) -> str:
    return "p < 0.001" if p is not None and p < 0.001 else f"p = {p}"


def rule_based_interpretation(snapshot: dict) -> dict:
    a = snapshot["analysis"]
    data = snapshot["data"]
    models = [m for m in snapshot["models"] if m.get("available")]
    best = snapshot.get("best_model")
    best_row = next((m for m in models if best and m["model"] == best["model"]), None)
    rec = snapshot.get("recommended_model")
    rec_row = next((m for m in models if rec and m["model"] == rec["model"]), best_row)

    # Q1: seasonality and trend
    q1 = []
    if a.get("trend_pct_per_year") is not None:
        if a.get("trend_significant"):
            direction = "rising" if a["trend_pct_per_year"] > 0 else "falling"
            q1.append(f"Daily sales are {direction} by {_fmt_pct(a['trend_pct_per_year'])} per year "
                      f"({_fmt_p(a['trend_p_value'])}), a statistically significant trend.")
        else:
            q1.append(f"There is no meaningful volume trend: {_fmt_pct(a['trend_pct_per_year'])} per year "
                      f"with {_fmt_p(a['trend_p_value'])}, which is not statistically significant.")
    if a.get("seasonality_p_value") is None:
        q1.append(a.get("seasonality_note") or "Seasonality could not be tested.")
    elif a.get("seasonality_significant"):
        q1.append(f"Month-of-year differences are statistically significant ({_fmt_p(a['seasonality_p_value'])}), "
                  f"with a peak-to-trough spread of {_fmt_pct(a['seasonal_peak_trough_pct'])}.")
    else:
        q1.append(f"There is no significant seasonality ({_fmt_p(a['seasonality_p_value'])}); the month-of-year "
                  f"spread of {_fmt_pct(a['seasonal_peak_trough_pct'])} is consistent with noise.")
    if a.get("days_in_month_r2") is not None:
        q1.append(f"The number of days in a month explains R² = {a['days_in_month_r2']} of the month-to-month "
                  "variation, so calendar-aware models capture the main systematic pattern.")
    if a.get("revenue_trend_pct_per_year") is not None and a.get("revenue_trend_p_value") is not None \
            and a["revenue_trend_p_value"] < 0.05:
        q1.append(f"Revenue per day grows {_fmt_pct(a['revenue_trend_pct_per_year'])} per year "
                  f"({_fmt_p(a['revenue_trend_p_value'])}), which comes from price rather than volume.")

    # Q2: best model and why
    if best and best_row:
        q2 = (f"{best['model']} performed best on {best['basis']} at {_fmt_pct(best['wape_pct'])}"
              f" (single test window: MAPE {_fmt_pct(best_row['test_mape_pct'])}, WAPE "
              f"{_fmt_pct(best_row['test_wape_pct'])}). ")
        if best.get("beats_naive_by_pct_points") is not None:
            q2 += (f"It beats the Naive benchmark ({_fmt_pct(best.get('naive_wape_pct'))}) by "
                   f"{best['beats_naive_by_pct_points']} percentage points. ")
        margin = best.get("margin_pct_points")
        tie = snapshot.get("reporting", {}).get("tie_margin_pct_points", 0.5)
        if margin is not None and margin < tie:
            q2 += (f"However, its margin over the runner-up, {best['runner_up']} "
                   f"({_fmt_pct(best['runner_up_wape_pct'])}), is only {margin} percentage points, which is within "
                   "the noise of this small sample, so the top models should be treated as equally good.")
            if rec and not rec.get("same_as_best"):
                q2 += (f" For planning we therefore recommend {rec['model']} ({_fmt_pct(rec['wape_pct'])}), the "
                       f"simplest model within {tie} points of the best: it is easier to explain and less likely "
                       "to over-fit.")
        elif best["model"] == "ARIMA" and best_row.get("arima_order") == [0, 0, 0]:
            q2 += ("It wins because the selected order (0,0,0) means a long-run average level adjusted for the days "
                   "in each month: when month-to-month changes are random, averaging the whole history is more "
                   "accurate than carrying forward the last month.")
        else:
            q2 += "It wins because " + WHY_BEST.get(best["model"], "it had the lowest error.")
        tree_rows = [m for m in models if m.get("training_rows") is not None]
        if tree_rows and min(m["training_rows"] for m in tree_rows) < 12:
            q2 += (f" The machine-learning models trained on only {min(m['training_rows'] for m in tree_rows)} rows, "
                   "too few to learn reliable patterns.")
    else:
        q2 = "No model could be evaluated on this data window."

    # Q3: recommendations
    recs = []
    if rec_row:
        fc = rec_row["forecast"]
        first, last = fc[0], fc[-1]
        rng = ""
        if first.get("low95") is not None:
            rng = f" (95% range for {first['month']}: {_fmt_units(first['low95'])} to {_fmt_units(first['high95'])})"
        recs.append(f"Plan production from {first['month']} to {last['month']} at about "
                    f"{_fmt_units(rec_row['forecast_total_units'])} units in total using {rec_row['model']}{rng}.")
        b = rec_row.get("test_bias_pct")
        if b is not None:
            if b > 2:
                recs.append(f"The model over-forecast the test window by {_fmt_pct(b)}; keep safety stock lean to "
                            "avoid excess inventory.")
            elif b < -2:
                recs.append(f"The model under-forecast the test window by {_fmt_pct(abs(b))}; hold extra safety "
                            "stock to protect service levels.")
            else:
                recs.append(f"Forecast bias on the test window is small ({_fmt_pct(b)}), so production can follow "
                            "the forecast without a systematic correction.")
    recs.append("Use the days in each month when setting monthly production targets: shorter months such as "
                "February need proportionally less volume.")
    top = snapshot.get("regional_top5")
    if top:
        lead = top[0]
        recs.append(f"Allocate distribution by regional share: {lead['region']} is the largest market at "
                    f"{lead['share_pct']}% of recent volume (about {_fmt_units(lead['units_next_horizon'])} units "
                    "over the forecast horizon).")
    if data["n_months"] < 24:
        recs.append("Stay with simple, calendar-aware models until two full years of sales exist, then re-test "
                    "for seasonality before adding complexity.")
    recs.append("Re-run the forecast as each new month of actual sales arrives and switch models only if a more "
                "complex one consistently beats the simple benchmark in the backtest.")

    # Confidence
    conf = "low"
    if best and best.get("wape_pct") is not None:
        if best["wape_pct"] < 5 and snapshot["split"]["backtest_origins"] >= 3:
            conf = "high"
        elif best["wape_pct"] < 10:
            conf = "medium"
    if data["n_months"] < 24 and conf == "high":
        conf = "medium"

    return {
        "seasonality_trend": " ".join(q1),
        "best_model": q2.strip(),
        "recommendations": recs,
        "limitations": list(snapshot.get("limitations", [])),
        "confidence": conf,
        "source": "rule-based",
    }
