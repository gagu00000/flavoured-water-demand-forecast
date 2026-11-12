# Phase 2: Dataset Inspection & Implementation Plan

**Use case:** Forecasting Monthly Sales for a New Beverage Product (AI in Operations, Session II Lab, slide 64)
**Dataset:** Kaggle "Beverage Sales" (sebastianwillmann), `synthetic_beverage_sales_data.csv`
**Status:** Approved and implemented. See `TEST_REPORT.md` for the final audit and `DEPLOYMENT.md` for deployment. Changes made during development are logged in §8b.

---

## 0. Decisions needed from you (answer when you approve)

| # | Decision | My recommendation | Alternative |
|---|---|---|---|
| D1 | **Dataset.** The data has **no real seasonality or trend** in units (Section 1.3), even though the Kaggle description claims seasonal patterns. | **Keep it.** It matches the scenario closely: a real flavoured-water line (Volvic Touch), 16 regional markets, and clean data. We report "no seasonality beyond calendar days" as a tested finding and use it to show why simple models win. | Switch to the backup (FMCG Daily Sales 2022–2024). It isn't water, and its seasonality is unverified. |
| D2 | **LLM provider.** | **Google Gemini** through the official SDK. Your own free Google AI Studio key goes in a Netlify environment variable (`GEMINI_API_KEY`), and the notebook needs the same key locally. On Netlify's credit-based plans, the AI Gateway can inject a Gemini key automatically, so the same code works with no key on the site. | OpenAI or Anthropic, if you already have a paid key. The design is the same; only the SDK changes. |
| D3 | **Where the models run in the dashboard.** | **Python in the browser (Pyodide)**, running the *same* `forecasting_core` package the notebook uses. Numbers match exactly, and there is no server compute (Section 2). | Re-implement the models in TypeScript. This loads faster, but ARIMA, Random Forest and XGBoost will only match the notebook *approximately*. |

---

## 1. Dataset inspection (what I found)

### 1.1 Structure

| Item | Finding |
|---|---|
| File | `synthetic_beverage_sales_data.csv`, 789 MB, UTF-8 (umlauts in region names are correct) |
| Rows × columns | **8,999,910 × 11** |
| Columns | `Order_ID`, `Customer_ID`, `Customer_Type` (B2B/B2C), `Product`, `Category`, `Unit_Price`, `Quantity`, `Discount`, `Total_Price`, `Region`, `Order_Date` |
| Grain | One row per product line within an order (`Order_ID` + `Product` is unique) |
| Dates | **2021-01-01 to 2023-12-30**, with 1,094 consecutive days and no missing days except **31 Dec 2023** |
| Categories | Water 2,250,217 · Juices 2,249,937 · Soft Drinks 2,248,131 · Alcoholic Beverages 2,251,625 (exactly balanced, so clearly synthetic) |
| Water products (9) | Apollinaris, Evian, Gerolsteiner, San Pellegrino, Selters, Vio Wasser, Vittel, Volvic, **Volvic Touch**. All are sold from day 1, so none is actually "launched" during the data. |
| Regions | 16 German federal states, 533k–604k rows each |
| Customers | B2C 5.80M rows, B2B 3.20M rows. **B2B is about 77% of water units** because B2B orders are larger. |

### 1.2 Quality

| Check | Result |
|---|---|
| Nulls | 0 in every column |
| Duplicate rows / duplicate (`Order_ID`, `Product`) | 0 / 0 |
| Unparseable dates | 0 |
| Quantity ≤ 0, price ≤ 0 | 0 / 0 (Quantity 1–100, Unit_Price €0.32–€169.53) |
| `Total_Price = Unit_Price × Quantity × (1 − Discount)` | Holds for **every row** (tolerance €0.01) |
| Discounts | B2B only: 5%, 10% or 15%. B2C always 0. |
| Price drift | Volvic Touch average unit price rose from €1.31 to €1.39 over 2021–2023 |

**Cleaning needed:** very little. Parse dates, aggregate to month, and deal with one data issue: **Dec 2023 has only 30 of 31 days**. Plan: keep the observed value, flag it as partial, and use *days observed* as the calendar feature. This keeps the data truthful, and the calendar-aware models handle it naturally. The notebook includes a sensitivity check that scales December to 31 days.

### 1.3 Trend and seasonality tests (the key finding)

I tested whether the data has trend or seasonality, using the per-day sales rate so that month length doesn't distort the result.

| Series | Monthly CV | Variance explained by **days in month** | Trend in units | Month-of-year effect (ANOVA) | ACF lag 1 / 12 |
|---|---|---|---|---|---|
| Water category | 3.1% | R² = 0.91 | +0.17%/yr, p = 0.33 | p = 0.81 | −0.03 / −0.21 |
| **Volvic Touch** (all regions) | 3.3% | **R² = 0.72** (0.76 in year 1) | +0.21%/yr, **p = 0.54** | **p = 0.42**, peak–trough 3.8% | 0.01 / −0.00 |
| Volvic Touch, one region (e.g. Bayern) | 7–9% | R² ≈ 0.2–0.3 | n.s. in all 16 regions | p < 0.05 in 2 of 16 (chance expects about 0.8; none survive a multiple-testing correction) | ≈ 0 |
| Volvic Touch **revenue** per day | — | — | **+2.77%/yr, p < 0.001** (driven by price) | — | — |

Day-of-week effect: within ±1%, so there is none.

**What this means, stated honestly:**
1. **Unit demand is flat and stable.** Almost all month-to-month movement comes from how many days the month has (February is about 9% lower). What's left over is close to white noise.
2. **There is no true seasonality and no volume trend.** The only "seasonal indicator" that carries signal is **days in month**. **Revenue does trend upward, but because of price, not volume.**
3. Consequences for modelling:
   - Calendar-aware simple models should win.
   - ARIMA should pick a near-trivial order.
   - Random Forest and XGBoost have little signal to learn and may overfit.

   That answers slide questions 7a and 7b with evidence rather than assumption.
4. Hand check: Naïve on the launch year, test Oct–Dec 2021, using the September value of 158,666 → **MAPE 2.05%, WAPE 2.10%**. This number becomes a unit test (Section 6).

### 1.4 How it maps to the slide scenario

- **"New flavoured water product":** **Volvic Touch** is the only flavoured-style product in the Water category. The other 8 waters are the company's established portfolio and serve as comparable products.
- **"Regional markets":** the 16 German states, used for region filters and a regional allocation of the forecast (distribution planning).
- **"Monthly sales for the first year":** Jan–Dec 2021 is treated as the **launch year**. The dashboard starts there (12 months of data), matching the slide.
- **"Forecast the upcoming months":** forecast months 13–15 (Jan–Mar 2022). Unlike in real life, we *have* those actuals, so the "next 3 months" forecast can be scored after the fact.
- **"Real-time data":** the remaining 24 months (2022–2023) arrive month by month through a data-feed replay, and you can type in new months. Every arrival re-runs the pipeline and the LLM interpretation (Section 4.6).
- **Synthetic data:** the data is simulated. This is said in the notebook, the dashboard footer, and every LLM interpretation.

---

## 2. System architecture

### 2.1 Where each computation runs

| Computation | Runs where | Why |
|---|---|---|
| Load and clean the 789 MB CSV; aggregate to monthly (product × region × customer type × month), plus daily-rate and calendar columns | **Offline, in the notebook (Python)**, exported as `monthly_water.json` (about 150 KB) | The raw file is too big for a browser, a serverless function (6 MB payload), or GitHub (100 MB file limit). The aggregation is deterministic and never changes. **This is precomputed, and the plan says so.** |
| Preprocessing and feature engineering (lags, rolling mean, days-in-month, month sin/cos) | **Browser**, in a Web Worker running Pyodide (Python compiled to WebAssembly) with the shared `forecasting_core` package | Has to react to your controls and newly added data. The data is tiny (≤ 48 rows per series). |
| Training and forecasting for all 6 models | **Browser** (same worker) | Each fit takes milliseconds to sub-seconds. Running the same code as the notebook gives exact parity. No server compute, no cold starts, no function timeouts, and free-tier usage stays low. |
| Metrics (MAPE, WAPE, bias) and rolling-origin backtest | **Browser** (same worker) | Same reasons. |
| Default "first paint" results | **Precomputed** by the same `forecasting_core` in the notebook's export step (`snapshot_default.json`) | Pyodide takes about 10–25 s to load on a first visit. The dashboard shows real default results immediately while the live engine warms up in the background. These are identical to what the engine would compute. |
| LLM interpretation | **Netlify Function** `POST /api/interpret` (TypeScript, Functions v2) | The API key must stay on the server. The function also handles rate limiting and checks that the LLM's numbers are grounded in the data. |
| Fallback interpretation | **Browser**, with a deterministic rule-based summary generated from the same results snapshot | Works when the LLM fails, is rate-limited, or the site is offline. |

**Netlify free-tier usage:** static files plus one function. Pyodide and its packages load from the jsDelivr CDN, so they don't use Netlify bandwidth, and the browser caches them after the first visit. LLM calls are rate-limited and cached by snapshot hash. Production deploys use credits on Netlify's credit-based Free plan, so we turn off Deploy Previews and deploy deliberately. I'll confirm your account's plan type in Phase 5.

**Fallback if Pyodide is a problem:** Part 1 of Phase 4 starts with a short technical check. It confirms that the pinned Pyodide release loads numpy, scipy, scikit-learn, statsmodels and xgboost together, and that fits complete in under 2 s. If it fails, we switch to option D3-alt (a TypeScript engine). In that case I would tell you which numbers match the notebook exactly and which only approximately.

### 2.2 Architecture diagram

```
                    ┌──────────── Offline (your laptop) ─────────────┐
 Raw CSV (789 MB) ─▶│ Notebook: clean → aggregate → forecasting_core │─▶ monthly_water.json
                    │ (same package the dashboard uses)              │─▶ snapshot_default.json
                    └────────────────────────────────────────────────┘─▶ parity_fixtures.json
                                         │ committed (small files only)
                                         ▼
 GitHub repo ──push──▶ Netlify build (Vite) ──▶ static site + function
                                                      │
 Browser ─────────────────────────────────────────────┼───────────────────────────
  React UI (Zustand state) ◀──results── Web Worker: Pyodide + forecasting_core
     │  controls / new data ──────────▶ (features → 6 models → metrics → backtest)
     │
     └─ results snapshot (JSON) ──POST /api/interpret──▶ Netlify Function
                                                         ├ validate + size-limit input
                                                         ├ grounded prompt
                                                         ├ Gemini SDK (key from env var)
                                                         └ number-grounding check
     ◀── structured interpretation ─────────────────────┘
     (on failure → rule-based interpretation in the browser, clearly labelled)
```

### 2.3 Version pinning (makes parity possible)

The notebook's `requirements.txt` pins numpy, pandas, scikit-learn, statsmodels and xgboost to **the exact versions bundled in the chosen Pyodide release**. I'll confirm these in the Phase 4 technical check, and they may differ from your current global versions (sklearn 1.8, xgboost 3.2). The notebook runs in a project virtual environment (`.venv`) so your global Python is untouched. All randomness uses fixed seeds.

---

## 3. Forecasting design

### 3.1 Target series and views

- **Target:** monthly **units** of Volvic Touch. Units drive production and distribution. Revenue is shown only as context, since its price-driven trend is a talking point.
- **Filters:** product (Volvic Touch by default, or any of the 8 comparable waters), region (all Germany or one state), customer type (all / B2B / B2C).
- **Data window ("data through"):** starts at **Dec 2021 = end of launch year (12 months)** and advances to Dec 2023 (36 months).

### 3.2 Preprocessing and feature engineering (Task 1)

| Feature | Definition | Available when | Note |
|---|---|---|---|
| `days_in_month` | Calendar days observed in the month (Dec 2023 = 30) | Always | **The one seasonal indicator that carries real signal** (R² 0.72) |
| `daily_rate` | units ÷ days | Always | Used by the calendar-adjusted model and the decomposition views |
| `lag_1`, `lag_2`, `lag_3` | Units 1–3 months earlier | Needs 3 prior months, which **costs 3 of the 12 launch-year rows** | |
| `rolling_mean_3` | Mean of lags 1–3 | Same as above | |
| `month_sin`, `month_cos` | Cyclical month-of-year encoding | Always, but meaningless with fewer than 24 months | With 12 months, each month appears once, so the model can't learn month effects |
| `lag_12` | Same month last year | Needs **≥ 24 months** (12 for the lag plus 12 to train) | Off in the launch-year view and switched on automatically later |
| `t` (trend index) | Months since launch | Always | Linear trend check; tree models can't extrapolate it (stated) |

**The limits, stated explicitly in the notebook and the dashboard:**
- With 12 months, 3 lags and a 3-month test set, the ML models have **6 training rows**. That's statistically meaningless, so the dashboard shows a warning.
- Seasonal features and seasonal ARIMA need at least 2 full years, which a launch year by definition doesn't have.
- This is why companies forecast new products from **comparable products**. The 8 established waters let us test whether any portfolio-wide seasonality exists to borrow. The finding is that none does beyond calendar days, which is itself a recommendation.

### 3.3 Models (Task 2): 6 models, all compared on the same split and horizon

| # | Model | Why it's included | Constraint |
|---|---|---|---|
| 1 | **Naïve** (last value) | Required baseline from the slide | — |
| 2 | **Seasonal Naïve** (same month last year) | Standard seasonal baseline | Disabled while history is under 12 months before the test window (UI explains why) |
| 3 | **Calendar-adjusted Naïve** (last daily rate × days in target month) | Uses the only real signal in the data, and is very explainable | — |
| 4 | **ARIMA(p,d,q) with a days-in-month regressor** (statsmodels SARIMAX) | The slide's classical model. Order chosen by AIC from p, q ∈ {0,1,2}, d ∈ {0,1}. | Order grid shrinks to p+q ≤ 1 when n < 18 to avoid overfitting. Gives native prediction intervals. |
| 5 | **Random Forest** (scikit-learn) | The slide's ML example | Features from 3.2. Recursive multi-step forecasting. Small trees (max_depth 3), 200 trees, fixed seed. |
| 6 | **XGBoost** | The slide's ML example | Same features. Shallow (depth 2), strong regularisation, fixed seed. |

**Hypothesis to test, not assume:** model 3 or 4 wins, and RF/XGBoost do no better than Naïve. If the results say otherwise, the interpretation follows the results.

### 3.4 Train-test strategy (Task 3)

- **Always chronological** (never random): training months strictly before test months, with no leakage. Lags are built only from the past, and recursive forecasts feed predictions back into the lags, not actuals.
- **Default test window = the last 3 months = the forecast horizon** (the slide asks for 3 months).
  - **Launch-year view:** train Jan–Sep 2021 (9), test Oct–Dec 2021 (3), then **refit on all 12 → forecast Jan–Mar 2022**.
  - **Full view:** train to Sep 2023, test Oct–Dec 2023, refit → forecast Jan–Mar 2024. Note that Feb 2024 has 29 days, which the calendar features handle.
- **Rolling-origin backtest** (expanding window, horizon 3): a fairer ranking than one 3-month test. It uses up to 12 origins in the full view and 4 in the launch year, and is reported next to the single split.
- **Why 3 test months with this little data:** it matches the decision horizon, and using more test months in year 1 would leave too few to train on. The backtest makes up for the small single test set.
- **Dashboard controls:** test size 3–12 months (capped so training keeps at least 6 rows), horizon 1–6 months (default 3).

### 3.5 Metrics (Task 5)

With $A_t$ = actual and $F_t$ = forecast:

- **MAPE** = (100 / n′) · Σ |A_t − F_t| / |A_t|, summed over the n′ periods where |A_t| > ε (ε = 1 unit).
  - Periods with zero or near-zero actuals are **excluded and counted**, and the count is shown ("MAPE excludes 1 of 3 months").
  - If every period is excluded, MAPE is reported as *undefined*, never as 0 or ∞.
- **WAPE** = 100 · Σ |A_t − F_t| / Σ |A_t|.
  - It is robust to individual zero months and weights errors by volume.
  - **WAPE is the primary ranking metric**, and the notebook explains why.
  - It's undefined only if Σ|A_t| = 0.
- **Bias** = Σ(F_t − A_t) / Σ A_t (secondary). It shows over- vs under-production risk, which feeds the recommendations.
- **Cross-checks:**
  - a hand-worked 3-row example in a markdown cell, verified by an `assert` cell;
  - the Naïve launch-year values (MAPE 2.05%, WAPE 2.10%) as a fixed regression test;
  - edge-case tests (all zeros, one zero, negative bias).

### 3.6 Forecast uncertainty (Task 4)

- **ARIMA:** native 80% / 95% prediction intervals.
- **Naïve family:** residual-based intervals (σ̂·√h).
- **RF / XGBoost:** empirical intervals from the rolling-origin backtest errors at each horizon, **labelled approximate**. With 4 backtest origins in the launch year, the intervals are rough, and the UI says so.

---

## 4. LLM integration design

### 4.1 RDMU Day 10

No RDMU material is in the project folder (checked in Phase 1). If you add it, I'll align with it. Until then, this design follows standard server-side LLM practice.

### 4.2 The flow

1. **The browser builds a results snapshot.** This is a compact JSON object (under 16 KB) describing exactly what is on screen:
   - scenario: product, region, customer type, data window, months available, and launch-year vs. extended view;
   - **data version**: a counter, the time of the last change, and **what changed since the last interpretation** (e.g., "Feb 2022 actual added: 150,224");
   - the metrics table: test MAPE, WAPE and bias, plus backtest averages, for every model;
   - next-h forecasts for every model, with intervals;
   - the trend and seasonality statistics (slope %/yr and its p-value, ANOVA p-value, days-in-month R², ACF);
   - feature importances (RF, XGBoost);
   - regional share of demand;
   - data caveats: synthetic data, n rows, the partial month, and the lag rows lost.
2. **The Netlify Function `/api/interpret`:**
   - validates the snapshot against a schema (zod) and rejects anything oversized or malformed;
   - builds the prompt from a **shared prompt file** (`prompts/interpretation_system.md`), the same one the notebook uses;
   - calls Gemini with a **JSON response schema**:
     `{ seasonality_trend, best_model, recommendations[], limitations[], confidence }`
   - applies a 25 s timeout and returns a structured response.
3. **Prompt rules (grounding):**
   - Use only numbers present in the snapshot, and quote them as given.
   - Never invent figures, dates or causes.
   - If something can't be answered from the data, say so.
   - Always state the synthetic-data and small-sample limitations.
   - Answer the slide's three questions in order.
   - Write in plain business language for an operations manager.
4. **Grounding check after the response (on the server):** every number in the LLM's text is extracted and matched against the snapshot's numbers (allowing for rounding).
   - Numbers that don't match are flagged in the UI ("unverified figure").
   - If more than 2 don't match, the response is rejected and the fallback is used.

### 4.3 Key safety

- The key exists only as a Netlify environment variable (scope: Functions) and in a local `.env` for the notebook.
- `.env` is in `.gitignore`. `.env.example` lists only the variable names.
- No key is ever in client code or the build output. A Phase 5 check searches the built `dist/` folder for key patterns.
- The function returns generic error messages and never echoes the key or provider errors.

### 4.4 Abuse and cost controls

- Function-level rate limit (`config.rateLimit`, about 10 requests per minute per IP).
- The client caches results by **snapshot hash**: the same view is never sent twice.
- After a data change, the client waits 1.5 s (debounce) before calling, plus there is a manual "Regenerate" button.

### 4.5 Fallback

If the LLM can't be used (network error, HTTP 429/5xx, timeout, invalid JSON, or failed grounding check), the panel shows a **deterministic rule-based interpretation** built from the same snapshot. It answers the same three questions with templated sentences driven by the numbers. It's clearly badged: "Rule-based summary — LLM unavailable (reason)". The notebook has the same fallback in Python.

### 4.6 What "real-time data" means here, concretely

The data the LLM interprets is **the live state of the dashboard**, not static text. Three things change it:
1. **Data-feed replay:** "Next month" and "Auto-play" buttons release the next actual month from the dataset (Jan 2022 → Dec 2023), as if sales were arriving in real time. The forecast made *before* a month arrives is kept and scored against the arriving actual, building a forecast-vs-actual log.
2. **Manual data entry:** add or edit any month's units (a form, or pasted CSV), including months after Dec 2023. Invalid input is rejected with a message.
3. **Control changes:** model, region, customer type, test size and horizon.

Every change triggers recomputation in the worker, which produces a new snapshot hash. The LLM panel then marks itself **stale**, calls the LLM again (after the debounce), and shows the **data version, the last data month, and the generation time**. Its text refers to the change explicitly (e.g., "With March 2022 added…").

---

## 5. Deliverable designs

### 5.1 Notebook: `notebook/Beverage_Demand_Forecasting.ipynb`

Every code cell has a markdown cell before it (what and why) and a short plain-language interpretation after each major result.

| § | Section | Slide mapping |
|---|---|---|
| 0 | Title, scenario, slide-requirement checklist | Scenario |
| 1 | Setup: imports, pinned versions, seeds, colour palette, `.env` loading | — |
| 2 | Load raw CSV and run validation checks (Section 1.2 as asserts) | — |
| 3 | Framing: Volvic Touch, launch year, monthly aggregation, partial-month flag | Scenario |
| 4 | Exploratory analysis: trend, seasonality tests, calendar effect, ACF, regions, B2B/B2C | Task 7a evidence |
| 5 | **Task 1:** feature engineering, plus a table of feature availability and limits | T1 |
| 6 | **Task 2:** model choice and rationale | T2 |
| 7 | **Task 3:** chronological split (launch year and full view), rolling-origin backtest | T3 |
| 8 | **Task 5:** metric formulas, zero handling, hand-calculation `assert` cell, results table | T5 |
| 9 | **Task 4:** next-3-month forecasts with intervals, plus scoring against the actual Jan–Mar 2022 | T4 |
| 10 | **Task 6:** actual vs predicted plots per model, forecast fan chart, metric comparison bars | T6 |
| 11 | **Task 7:** LLM interpretation (snapshot → shared prompt → Gemini → grounding check → fallback), answering all 3 questions | T7 + LLM |
| 12 | Business recommendations and limitations | T7c |
| 13 | Export for the dashboard: `monthly_water.json`, `snapshot_default.json`, `parity_fixtures.json` | — |

The modelling logic lives in a small package, `forecasting_core/` (`features.py`, `models.py`, `metrics.py`, `backtest.py`, `snapshot.py`, `fallback.py`). The notebook imports it and calls it visibly, step by step, so it stays readable while the dashboard reuses exactly the same code.

### 5.2 Dashboard pages and visuals

Layout: a single-page app with a **top control bar**, **6 tabbed sections**, and a docked **"AI Analyst" panel** on the right (a bottom sheet on mobile).

| Section | Interactive visuals |
|---|---|
| **Overview** | KPI tiles: next-3-month forecast, best model, its WAPE, data-through month, data version. Main chart: actuals + selected model's fitted/test predictions + forecast with 80/95% band. Forecast-vs-actual log from the replay. |
| **Models & Metrics** | Small multiples of actual vs predicted for all 6 models. MAPE and WAPE grouped bars (single split vs backtest). Sortable metrics table with bias. Disabled models greyed out with the reason. |
| **Trend & Seasonality** | Daily-rate trend line with a confidence band and slope/p-value. Month-of-year index with error bars. Units-vs-days-in-month scatter (the R² story). ACF bars with significance bounds. Units vs revenue trend comparison. |
| **Feature Engineering** | Live feature table (lags, rolling mean, days, sin/cos) with rows dropped by lags highlighted. Lag-1 scatter. RF/XGBoost feature importance. "Training rows available" gauge with a small-sample warning. |
| **Regions & Distribution** | Region × month heatmap. Regional share bars. Regional allocation of the 3-month forecast (units per state) for distribution planning. |
| **Data Feed** | Replay controls (next month / auto-play / reset to launch year). Add/edit month form and CSV paste. Change history. Download of the current series as CSV. |

**Global controls:** product, region, customer type, data-through, model focus, test size (3–12), horizon (1–6).

**Chart library:** Apache ECharts (canvas rendering, built-in heatmap, bands, data zoom and accessible tooltips) through a thin React wrapper.

**WebGL:** not used. With 48 data points it adds nothing to the charts, and a decorative shader would only cost performance.

### 5.3 Visual design language

- **Theme:** "bottling plant at night": deep-water navy background, frosted-glass panels (backdrop blur, 1 px light borders, soft inner glow), aqua as the primary accent, and citrus accents (lime, grapefruit) as nods to the flavoured product.
- **Colours:**
  - one fixed colour per model, used across every chart, checked for colour-blind safety and contrast with a validator;
  - intervals as translucent bands;
  - warnings in amber, never red unless something is actually an error.
- **Typography:** a geometric sans for headings, Inter for body text, tabular numerals for every figure.
- **Motion (Framer Motion), purposeful only:**
  - panels enter in a stagger;
  - numbers count up when they change;
  - a ripple pulse on the Data Feed when a new month "arrives";
  - chart transitions when switching models;
  - the "stale" to "fresh" transition on the AI panel.

  Everything respects `prefers-reduced-motion`.
- **Responsive:** desktop at 1440 px, tablet, and mobile at 375 px. On mobile the controls collapse into a sheet and charts stack.

### 5.4 Technology stack

| Concern | Choice |
|---|---|
| Build | Vite + React 19 + TypeScript (strict) |
| Styling | Tailwind CSS v4 with CSS design tokens |
| State | Zustand |
| Worker messaging | Comlink (a typed wrapper around the Web Worker) |
| Python in browser | Pyodide (pinned version, loaded from the jsDelivr CDN) |
| Charts | ECharts |
| Motion | Framer Motion |
| Validation | zod, shared by client and function |
| Function | Netlify Functions v2 (`.mts`) + `@google/genai` |
| Tests | Vitest, Playwright |

### 5.5 File and folder structure (repo root = this project folder)

```
problem and ex 2/
├─ synthetic_beverage_sales_data.csv      # raw data, git-IGNORED (789 MB)
├─ PHASE2_PLAN.md
├─ README.md                              # how to run the notebook and dashboard, deploy steps
├─ requirements.txt                       # pinned to Pyodide's versions
├─ .env.example  /  .env (ignored)        # GEMINI_API_KEY, LLM_MODEL
├─ .gitignore
├─ netlify.toml                           # base = dashboard, build cmd, functions dir
├─ forecasting_core/                      # shared Python package (notebook + Pyodide)
│  ├─ features.py  models.py  metrics.py  backtest.py  snapshot.py  fallback.py
│  └─ tests/                              # pytest: metrics hand-calcs, leakage, edge cases
├─ prompts/interpretation_system.md       # shared LLM prompt (notebook + function)
├─ notebook/Beverage_Demand_Forecasting.ipynb
└─ dashboard/
   ├─ netlify/functions/interpret.mts
   ├─ public/data/{monthly_water.json, snapshot_default.json}
   ├─ scripts/sync-python.mjs             # copies forecasting_core + prompt into the build
   ├─ src/
   │  ├─ app/  components/  charts/  sections/  ai-panel/
   │  ├─ engine/ (worker.ts, pyodide bridge, types)
   │  ├─ lib/ (snapshot hash, fallback interpreter, number-grounding check, schema)
   │  └─ styles/ (tokens, theme)
   └─ tests/ (unit/, parity/, e2e/)
```

---

## 6. Testing approach

| Layer | What's tested |
|---|---|
| Python unit tests (pytest) | MAPE/WAPE against hand calculations (including 2.05% / 2.10%); zero and near-zero handling; no leakage (features at time t use only data before t); recursive forecasting; split boundaries; disabled-model rules |
| Notebook | Runs top to bottom (`nbconvert --execute`) with no errors, in a clean `.venv` |
| Parity | The dashboard engine on default settings must reproduce `parity_fixtures.json` from the notebook **exactly** (tolerance 1e-9 relative). Also run after adding a test month. |
| Function | Schema rejection, size limit, prompt assembly, grounding check (an injected fake number gets flagged), timeout and 429 paths that trigger the fallback, and no key in responses |
| Front-end unit tests (Vitest) | Snapshot hashing, fallback interpreter text, data-entry validation, store transitions |
| End-to-end (Playwright, production build) | Load; switch models; change split and horizon; replay a month; add a month manually; LLM success (mocked); LLM 500 → fallback; **zero console errors**; mobile layout |
| Quality | Lighthouse (performance, accessibility ≥ 90); keyboard navigation; reduced-motion; a `dist/` search for secrets |
| Traceability | Phase 5 walks Section 8 row by row and records pass/fail with evidence |

---

## 7. GitHub and Netlify deployment (summary; full steps in Phase 5)

1. You create an empty GitHub repo and send me the link. I add the remote and push **only small files**: the raw CSV, `.env` and `.venv` are git-ignored.
2. In Netlify: **Add new project → Import from GitHub → select the repo**. Base directory `dashboard`, build command `npm run build`, publish directory `dashboard/dist`, functions directory `dashboard/netlify/functions`. All of these are also set in `netlify.toml`.
3. **Environment variables:** in Site configuration → Environment variables, add `NVIDIA_API_KEY` (scope: Functions, marked secret) and optionally `LLM_MODEL`. Then redeploy. *(Updated: the provider changed from Gemini to NVIDIA during development; see §8b.)*
4. Turn off Deploy Previews to save credits. Check the live site against the traceability table.
5. Local test of the full stack with `netlify dev`.

---

## 8. Traceability: every slide requirement → where it's delivered

| Slide requirement | Notebook | Dashboard |
|---|---|---|
| Scenario: new flavoured water, regional markets, first-year monthly sales | §0, §3 | Starts at the launch year (12 months); product, region and customer filters |
| Forecast upcoming months to optimise **production** and **distribution** | §9, §12 | Overview forecast tiles; regional allocation of the forecast |
| Apply a chosen model (Naïve, ARIMA, RF, XGBoost) | §6 | Model selector (6 models) |
| Evaluate with **MAPE and WAPE** | §8 | Models & Metrics: bars and table |
| **T1** Preprocess: lag features / seasonal indicators | §5 | Feature Engineering section |
| **T2** Choose a model: Naïve, ARIMA or ML | §6 | Model selector with explanations |
| **T3** Train/test with an appropriate split | §7 | Test-size slider, chronological split marker on charts, backtest |
| **T4** Predict the next 3 months | §9 | Horizon control (default 3), forecast with intervals |
| **T5** Calculate MAPE and WAPE | §8 | Live metrics for every model |
| **T6** Plot actual vs predicted | §10 | Main chart plus per-model small multiples |
| **T7a** How well was seasonality/trend captured? | §4, §11 | Trend & Seasonality section; AI panel Q1 |
| **T7b** Which model was best and why? | §8, §11 | Ranked metrics; AI panel Q2 |
| **T7c** Recommendations to the company | §11, §12 | AI panel Q3; regional allocation |
| **Must add LLM to create an interpretation based on real-time data** | §11 (live call on computed results) | AI Analyst panel, regenerated on every data or control change (Section 4.6) |
| Refer to Day 10 of RDMU for LLM integration | §11 note | Not available; standard server-side design (Section 4.1) |
| Learning outcome: model selection and feature engineering | §5–§6 | Feature Engineering and model explanations |
| Learning outcome: hands-on forecasting metrics | §8 | Metric definitions tooltip, live metrics |
| Learning outcome: interpret and communicate results with an LLM | §11 | AI Analyst panel |
| Learning outcome: business impact of accurate forecasting | §12 | Bias (over/under-production) and regional allocation |

---

## 8b. Changes made during Phase 3 (development log)

| Change | Why |
|---|---|
| ARIMA order is identified once by AICc on the **training window only**, then re-estimated with that order at every backtest origin and for the final forecast. The grid is d ∈ {0,1}, p+q ≤ 2 (p+q ≤ 1 below 18 months). | Searching the order at every backtest origin took about 10 s per run, too slow for the browser. This identify-then-estimate approach is standard and never uses test data. |
| Random Forest uses 100 trees (the plan said 200). | Halves the browser runtime. The results are effectively unchanged for 6–33 training rows. |
| **Parsimony rule:** production is planned with the *simplest* model whose backtest WAPE is within 0.5 points of the best (`recommended_model`). | In the launch year the top models are separated by 0.1–0.2 points, which is noise. The rule picked Calendar-adjusted Naive, which turned out to be the most accurate on the unseen Jan–Mar 2022 months. |
| The rule-based fallback is implemented once, in Python (`forecasting_core/fallback.py`). It ships inside each engine result and inside the precomputed default snapshot, instead of being rewritten in TypeScript. | One implementation, so the fallback text and numbers always match the engine. |
| **LLM provider changed from Google Gemini to NVIDIA Nemotron 3.5 Bolt E4B** (NVIDIA API Catalog, OpenAI-compatible endpoint, key `NVIDIA_API_KEY`). Gemini's free tier hit its daily quota and was often overloaded; NVIDIA's Mistral Large 4 took over 80 s per call (Netlify's limit is 60 s); Bolt E4B answers in about 7 s. | Your decision, after latency tests. |
| Because Bolt E4B is a small model, the snapshot now carries **`key_facts`**: verified sentences with explicit verdicts (e.g. "NOT statistically significant (p = 0.212)"). The grounding check also rejects outright any wrong p-value or any sentence whose "significant / not significant" wording contradicts its p-value. Thinking mode is off (7 s vs 24–29 s, and it produced a contradiction in testing). | Keeps a small, fast model accurate. |
| Every p-value below 0.001 is written as "p < 0.001", and the reporting constants (0.05, 0.001, 0.5) are included in the snapshot. | Prevents a misleading "p = 0.0" and lets the grounding check verify these constants. |

## 9. Limitations that will appear in the interpretation

1. **The data is synthetic.** Patterns, or the lack of them, come from a simulator, not real consumers.
2. **The launch year has 12 points.** No seasonal model can be estimated, the ML models have about 6 training rows, and a 3-month test set means one unusual month can swing MAPE by about 2 points.
3. **No seasonality or volume trend was detected** (p > 0.4). The models are correct to forecast a flat, calendar-adjusted level. Real flavoured-water demand is usually summer-peaked, and this data can't show that.
4. **Revenue grows about 2.8% a year from price increases, not volume.** We forecast units.
5. **Dec 2023 is a partial month** (30 days), flagged and handled through the calendar feature.
6. **Regional series are noisy** (CV 7–9%). Regional forecasts are allocations of the national forecast, not separate models.
