"""Unit tests for forecasting_core.  Run from the project root:  python -m pytest forecasting_core/tests -q"""

import json

import numpy as np
import pytest

from forecasting_core import MonthlySeries, PipelineConfig, grounding_check, make_model, run_pipeline
from forecasting_core.backtest import backtest_origins, chronological_split, rolling_origin
from forecasting_core.features import build_feature_frame, training_matrix
from forecasting_core.metrics import bias, mape, wape
from forecasting_core.series import days_in_month, next_months

# Volvic Touch, first year (launch year) - monthly units and observed days
LAUNCH_UNITS = [159013, 145774, 164952, 152966, 159563, 157079, 166034, 160660, 158666, 167105, 158642, 160396]
LAUNCH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
LAUNCH = [{"month": f"2021-{i + 1:02d}", "units": u, "days": d}
          for i, (u, d) in enumerate(zip(LAUNCH_UNITS, LAUNCH_DAYS))]


def launch_series(n=12):
    return MonthlySeries.from_records(LAUNCH[:n])


# ----------------------------------------------------------------- metrics
class TestMetrics:
    def test_hand_calculation_naive_launch_year(self):
        # Naive forecast for Oct-Dec 2021 = September value 158,666
        actual = [167105, 158642, 160396]
        forecast = [158666] * 3
        # |e| = 8439, 24, 1730 ; MAPE = mean(8439/167105, 24/158642, 1730/160396) ; WAPE = 10193 / 486143
        assert mape(actual, forecast)["value"] == pytest.approx(
            (8439 / 167105 + 24 / 158642 + 1730 / 160396) / 3 * 100, rel=1e-12)
        assert mape(actual, forecast)["value"] == pytest.approx(2.0479, abs=1e-4)
        assert wape(actual, forecast)["value"] == pytest.approx(10193 / 486143 * 100, rel=1e-12)
        assert wape(actual, forecast)["value"] == pytest.approx(2.0967, abs=1e-4)

    def test_zero_actual_is_excluded_from_mape_and_counted(self):
        out = mape([100, 0, 200], [110, 5, 180])
        assert out["n_excluded"] == 1 and out["n_used"] == 2
        assert out["value"] == pytest.approx((10 / 100 + 20 / 200) / 2 * 100)

    def test_near_zero_actual_is_excluded(self):
        assert mape([0.5, 100], [3, 90])["n_excluded"] == 1

    def test_all_zero_actuals_make_mape_undefined_not_zero(self):
        assert mape([0, 0], [1, 2])["value"] is None
        assert wape([0, 0], [1, 2])["value"] is None

    def test_wape_handles_individual_zero_months(self):
        assert wape([100, 0, 100], [90, 10, 100])["value"] == pytest.approx(20 / 200 * 100)

    def test_bias_sign(self):
        assert bias([100, 100], [110, 110])["value"] == pytest.approx(10.0)   # over-forecast
        assert bias([100, 100], [90, 90])["value"] == pytest.approx(-10.0)    # under-forecast

    def test_length_mismatch_raises(self):
        with pytest.raises(ValueError):
            wape([1, 2], [1])


# ----------------------------------------------------------- series & calendar
class TestSeries:
    def test_calendar(self):
        assert days_in_month("2024-02") == 29 and days_in_month("2023-02") == 28
        assert next_months("2021-11", 3) == ["2021-12", "2022-01", "2022-02"]

    def test_gaps_rejected(self):
        with pytest.raises(ValueError):
            MonthlySeries(["2021-01", "2021-03"], [1, 2], [31, 31])

    def test_negative_units_rejected(self):
        with pytest.raises(ValueError):
            MonthlySeries(["2021-01"], [-1], [31])


# ----------------------------------------------------------- features (no leakage)
class TestFeatures:
    def test_lags_look_only_backwards(self):
        f = build_feature_frame(launch_series())
        assert np.isnan(f.loc["2021-01", "lag_1"])
        assert f.loc["2021-04", "lag_1"] == LAUNCH_UNITS[2]
        assert f.loc["2021-04", "lag_3"] == LAUNCH_UNITS[0]
        assert f.loc["2021-04", "rolling_mean_3"] == pytest.approx(np.mean(LAUNCH_UNITS[:3]))

    def test_adding_future_data_does_not_change_past_features(self):
        short = build_feature_frame(launch_series(9), seasonal_lag=False)
        full = build_feature_frame(launch_series(12), seasonal_lag=False)
        cols = ["lag_1", "lag_2", "lag_3", "rolling_mean_3", "days_in_month", "month_sin", "month_cos"]
        np.testing.assert_allclose(short[cols].to_numpy(), full.loc[short.index, cols].to_numpy(), equal_nan=True)

    def test_training_rows_lost_to_lags(self):
        X, y = training_matrix(launch_series(9), seasonal_lag=False)
        assert len(y) == 6  # 9 months - 3 lag months

    def test_lag12_enabled_only_with_24_months(self):
        assert "lag_12" not in build_feature_frame(launch_series(12)).columns


# ----------------------------------------------------------- split & backtest
class TestSplit:
    def test_chronological_split(self):
        train, test = chronological_split(launch_series(), 3)
        assert train.months[-1] == "2021-09" and test.months == ["2021-10", "2021-11", "2021-12"]
        assert max(train.months) < min(test.months)

    def test_last_backtest_origin_is_main_split(self):
        assert backtest_origins(n=12, horizon=3, min_train=7, max_origins=12) == [7, 8, 9]
        assert backtest_origins(n=36, horizon=3, min_train=12, max_origins=12)[-1] == 33

    def test_all_models_scored_on_identical_months(self):
        bt = rolling_origin(launch_series(), ["naive", "calendar_naive", "random_forest"], horizon=3)
        months = {k: [f["months"] for f in v["folds"]] for k, v in bt["models"].items()}
        assert months["naive"] == months["calendar_naive"] == months["random_forest"]


# ----------------------------------------------------------- models
class TestModels:
    def test_naive_repeats_last_value(self):
        fc = make_model("naive").fit(launch_series(9)).predict(3)
        assert list(fc["point"]) == [LAUNCH_UNITS[8]] * 3

    def test_calendar_naive_scales_by_days(self):
        fc = make_model("calendar_naive").fit(launch_series(12)).predict(2)  # Jan 2022 (31), Feb 2022 (28)
        rate = LAUNCH_UNITS[11] / 31
        assert fc["point"][0] == pytest.approx(rate * 31) and fc["point"][1] == pytest.approx(rate * 28)

    def test_seasonal_naive_needs_a_year(self):
        assert make_model("seasonal_naive").check(9)[0] is False
        assert make_model("seasonal_naive").check(12)[0] is True

    def test_tree_models_need_enough_rows(self):
        assert make_model("random_forest").check(6)[0] is False
        assert make_model("xgboost").check(7)[0] is True

    @pytest.mark.parametrize("key", ["naive", "calendar_naive", "arima"])
    def test_intervals_bracket_the_forecast(self, key):
        fc = make_model(key).fit(launch_series()).predict(3)
        assert np.all(fc["lower95"] <= fc["lower80"]) and np.all(fc["lower80"] <= fc["point"])
        assert np.all(fc["point"] <= fc["upper80"]) and np.all(fc["upper80"] <= fc["upper95"])

    def test_arima_respects_fixed_order(self):
        m = make_model("arima", order=(1, 0, 0)).fit(launch_series())
        assert m.params["order"] == [1, 0, 0]

    def test_tree_forecast_is_deterministic(self):
        a = make_model("xgboost").fit(launch_series()).predict(3)["point"]
        b = make_model("xgboost").fit(launch_series()).predict(3)["point"]
        np.testing.assert_array_equal(a, b)


# ----------------------------------------------------------- pipeline
class TestPipeline:
    @pytest.fixture(scope="class")
    def result(self):
        return run_pipeline(LAUNCH, PipelineConfig(test_size=3, horizon=3))

    def test_naive_metrics_match_hand_calculation(self, result):
        m = result["models"]["naive"]["metrics_test"]
        assert m["mape"] == pytest.approx(2.0479, abs=1e-4) and m["wape"] == pytest.approx(2.0967, abs=1e-4)

    def test_seasonal_naive_disabled_with_reason(self, result):
        sn = result["models"]["seasonal_naive"]
        assert sn["available"] is False and "12 months" in sn["reason"]

    def test_forecast_horizon_and_months(self, result):
        fc = result["models"]["naive"]["forecast"]
        assert fc["months"] == ["2022-01", "2022-02", "2022-03"] and len(fc["point"]) == 3

    def test_result_is_json_serialisable(self, result):
        json.dumps(result)

    def test_ranking_only_contains_available_models(self, result):
        assert "seasonal_naive" not in result["ranking"] and result["best_model"] == result["ranking"][0]

    def test_recommended_model_is_simplest_within_tie_margin(self, result):
        models = result["models"]
        rec, best = result["recommended_model"], result["best_model"]
        wape = lambda k: models[k]["backtest"]["metrics"]["wape"]
        assert wape(rec) <= wape(best) + 0.5
        simpler = [k for k in result["ranking"] if list(models).index(k) < list(models).index(rec)]
        assert all(wape(k) > wape(best) + 0.5 for k in simpler)

    def test_fallback_numbers_are_grounded(self, result):
        assert grounding_check(result["fallback"], result["snapshot"])["unverified"] == []

    def test_pipeline_is_deterministic(self, result):
        again = run_pipeline(LAUNCH, PipelineConfig(test_size=3, horizon=3))
        assert json.dumps(again, sort_keys=True) == json.dumps(result, sort_keys=True)

    def test_too_little_data_raises(self):
        with pytest.raises(ValueError):
            run_pipeline(LAUNCH[:4], PipelineConfig(test_size=3))


# ----------------------------------------------------------- grounding
class TestGrounding:
    SNAP = {"models": [{"test_wape_pct": 2.0967, "forecast_total_units": 480674}], "analysis": {"trend_p_value": 0.212}}

    def test_rounded_numbers_verify(self):
        out = grounding_check("WAPE was 2.1% and p = 0.21; total about 480,674 units", self.SNAP)
        assert out["unverified"] == [] and out["checked"] == 3

    def test_invented_number_is_flagged(self):
        out = grounding_check("MAPE was 7.4% and demand will reach 250,000 units", self.SNAP)
        assert set(out["unverified"]) == {"7.4%", "250,000"}

    def test_structural_numbers_ignored(self):
        out = grounding_check("Forecast for 2022-01 over 3 months in 2022 with 95% intervals, ARIMA (0,1,0)", self.SNAP)
        assert out["checked"] == 0

    def test_p_values_must_match_the_real_ones(self):
        snap = {"analysis": {"trend_p_value": 0.212, "revenue_trend_p_value": 0.0}, "reporting": {"p_value_display_floor": 0.001}}
        assert grounding_check("trend not significant (p = 0.212); revenue p < 0.001", snap)["unverified"] == []
        bad = grounding_check("the trend is significant (p < 0.001)", {"analysis": {"trend_p_value": 0.212}, "reporting": {"p_value_display_floor": 0.001}})
        assert bad["unverified"] == ["p < 0.001"]
        assert grounding_check("p-value of 0.5", {"analysis": {"trend_p_value": 0.212}, "x": 0.5})["unverified"] == ["p-value of 0.5"]

    def test_significance_wording_must_match_the_p_value(self):
        snap = {"analysis": {"trend_p_value": 0.212, "revenue_trend_p_value": 0.0}}
        good = "Volume trend is NOT statistically significant (p = 0.212). Revenue trend is significant (p < 0.001)."
        assert grounding_check(good, snap)["unverified"] == []
        bad = grounding_check("Revenue per day trend is +2.77% per year, NOT statistically significant (p < 0.001).", snap)
        assert any("contradicts" in u for u in bad["unverified"])
        bad2 = grounding_check("The volume trend is significant (p = 0.212).", snap)
        assert any("contradicts" in u for u in bad2["unverified"])
        assert bad2["ok"] is False  # a single contradiction is enough to reject

    def test_verdicts_pair_with_their_own_p_value(self):
        snap = {"analysis": {"trend_p_value": 0.538, "revenue_trend_p_value": 0.0}}
        text = ("The revenue trend is statistically significant (p < 0.001), unlike the volume trend, "
                "which is NOT statistically significant (p = 0.538).")
        assert grounding_check(text, snap)["unverified"] == []
        assert grounding_check("Revenue is not significant (p < 0.001) while volume is significant (p = 0.538).", snap)["ok"] is False

    def test_key_fact_verdict_for_a_p_value_that_rounds_to_zero(self):
        from forecasting_core.pipeline import key_facts
        snap = run_pipeline(LAUNCH, PipelineConfig())["snapshot"]
        snap["analysis"].update({"revenue_trend_pct_per_year": 2.77, "revenue_trend_p_value": 0.0})
        line = next(f for f in key_facts(snap) if f.startswith("Revenue"))
        assert "statistically significant (p < 0.001)" in line and "NOT" not in line

    def test_numbers_spelled_out_in_words_are_rejected(self):
        g = grounding_check("Revenue grows plus two point seven seven percent per year.", {"x": 2.77})
        assert g["ok"] is False and "words" in g["unverified"][0]

    def test_key_facts_are_grounded_and_state_verdicts(self):
        snap = run_pipeline(LAUNCH, PipelineConfig())["snapshot"]
        facts = " ".join(snap["key_facts"])
        assert "NOT statistically significant (p = 0.212)" in facts
        assert "cannot be tested yet" in facts and "almost unbiased" in facts
        assert grounding_check(snap["key_facts"], snap)["unverified"] == []

    def test_threshold(self):
        assert grounding_check("1.11% 2.22% 3.33%", self.SNAP)["ok"] is False
