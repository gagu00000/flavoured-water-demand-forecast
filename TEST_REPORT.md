# Test & Audit Report

Final end-to-end audit of the notebook, the shared forecasting engine, the dashboard and the deployment, checked against the lab slides and the project brief. Every row below was verified, not assumed.

## 1. Automated test results (final run)

| Suite | Command | Result |
|---|---|---|
| Python engine (metrics, features/leakage, split, models, pipeline, grounding, key facts) | `python -m pytest forecasting_core/tests -q` | **45 passed** |
| Dashboard unit tests (data layer, store, view models, TypeScript metric cross-check, LLM handler, grounding twin, chat endpoint) | `npm test` (unit part) | **64 passed** |
| Parity: the browser engine (Pyodide) must reproduce the notebook on 5 configurations, plus an error case | `npm run test:parity` | **6 passed** |
| End-to-end, production build in Chrome (LLM mocked) | `npm run test:e2e` | **20 passed**, 0 console errors |
| Notebook, run top to bottom | `jupyter nbconvert --execute` | 72 cells (32 code), **0 errors**, 9 charts; every code cell has a markdown cell before it |
| Dependency audit | `npm audit` | **0 vulnerabilities** |

## 2. Requirements traceability (slides)

| Requirement | Notebook | Dashboard | Verified by |
|---|---|---|---|
| Scenario: new flavoured water, regional markets, first-year monthly sales | §0, §3 (Volvic Touch, launch year Jan–Dec 2021, 16 states) | Opens at the launch year; product, region and customer filters | e2e "launch-year results", unit "default request" |
| T1 Lag features / seasonal indicators | §5 (lags 1–3, rolling mean, days-in-month, month sin/cos, lag-12 from 24 months; limits table) | Feature Engineering tab | pytest leakage tests; e2e "Task 1" |
| T2 Choose a model (Naive, ARIMA, ML) | §6: six models incl. Random Forest and XGBoost | Model chips, ranking table, disabled-model reasons | e2e "Task 2", "Task 5" |
| T3 Appropriate train-test split | §7: chronological, 3-month test equal to the horizon, rolling-origin backtest | Test-window slider (3 to max with ≥ 6 training months) | pytest split tests; e2e "Task 3" |
| T4 Forecast the next 3 months | §9: forecasts with 80/95% ranges; out-of-sample check on real Jan–Mar 2022 | Overview fan chart and forecast table; horizon 1–6 | e2e "Task 4" |
| T5 MAPE and WAPE | §8: formulas, zero handling, hand calculation (2.048% / 2.097%) asserted | WAPE and MAPE bars, ranking table, formula tooltip | pytest hand calculation; TypeScript recomputation of every engine metric matches (≤ 1e-9) |
| T6 Plot actual vs predicted | §10: small multiples with backtest forecasts | Overview chart, all-models test overlay, per-model small multiples | e2e "Task 6 & 7a" |
| T7a Seasonality / trend captured? | §4 tests (trend, ANOVA, calendar R², ACF, portfolio), §11 | Trend & Seasonality tab; AI Q1 | e2e; key facts state each verdict |
| T7b Best model and why | §8.2, §11, §12 (parsimony rule) | Ranking, planning model, AI Q2 | unit "recommended model" |
| T7c Recommendations | §11, §12 | AI Q3; regional allocation table | e2e "Regions" |
| **LLM interpretation based on real-time data** | §11.1–11.3 (live call; a new month arrives, then re-interpretation) | AI Analyst re-runs on every data or control change (data version, last change) | e2e "a new month arrives … LLM re-interprets"; live checks below |
| Refer to Day 10 of RDMU | Not in the project folder (reported in Phase 1) | Standard server-side design used instead | – |

## 3. Brief requirements (dashboard and architecture)

| Requirement | Status / evidence |
|---|---|
| React + TypeScript, Framer Motion, interactive charts | React 19, TS strict, Framer Motion, ECharts (tooltips, legends, chart labels for screen readers, table views) |
| WebGL only where it adds value | Not used. With 48 data points it adds nothing (stated in plan and README) |
| Dark, topic-themed, glassmorphism, purposeful motion | Navy "bottling plant at night" theme, glass panels, bubbles, count-ups, tab pill. Reduced motion respected |
| Required visuals | Actual vs predicted (all models), forecast with ranges, MAPE/WAPE comparison, trend & seasonality, feature engineering, regions |
| Controls | Model, product/region/customer, test window, horizon, live feed (next / auto-play / back / reset), add and correct data |
| Responsive, fast, no console errors | No horizontal scroll at 375 px (e2e); precomputed results in ~80 ms; engine ready ~8–13 s; re-runs 0.5–2 s; 0 console errors (e2e and live) |
| Where each computation runs (Netlify constraints) | Aggregation: notebook (precomputed, stated). Features, models, metrics: browser, Pyodide. LLM: Netlify Function |
| Key never exposed; server-side LLM; fallback | Key only in Netlify env and `.env` (git-ignored). Live JS scanned: no key or key name. Rule-based fallback on any failure (e2e) |
| Grounded interpretation | Verified key facts in the snapshot. Every number must exist in the data; wrong p-values, contradicted verdicts and spelled-out numbers are rejected |
| Notebook and dashboard numbers match | Parity tests: exact for all models except ARIMA (≤ 0.003 WAPE points from floating-point differences in the optimiser) |
| Chronological split justified; zero handling; fair comparison; limited history addressed | Notebook §7–§8, §5; key facts; limitations in every interpretation |

## 4. Audit findings and fixes

| # | Finding | Severity | Fix |
|---|---|---|---|
| 1 | A key fact read "NOT statistically significant (p < 0.001)" for a p-value that rounds to 0 (`0.0 or 1` treated it as missing) | High (wrong verdict) | Explicit `is not None` check; regression test. The new contradiction check had already caught it |
| 2 | The small LLM could spell numbers out in words ("two point seven seven percent"), which slips past digit checks | Medium | Prompt rule plus a check that rejects spelled-out numbers |
| 3 | The significance check split sentences on decimal points and paired verdicts with the wrong p-value | Medium | Split only on sentence ends; pair each verdict with its nearest p-value; tests for mixed sentences |
| 4 | "p < 0.001" passed the number check because 0.001 is a reporting constant | Medium | Reporting constant excluded; p-value statements must match a real p-value |
| 5 | Corrections to months not yet released were counted as "user-entered data" | Low | Only corrections inside the current window are counted; test added |
| 6 | Mistral Large 4 took over 80 s per call, beyond Netlify's 60 s limit | High (feature unusable) | Switched to Nemotron 3.5 Bolt E4B (~7 s) with verified key facts |
| 7 | Free-tier Gemini hit its daily quota and was often overloaded | High | Replaced by NVIDIA; temporary errors retried once, then fallback |
| 8 | README test count out of date | Low | Updated |

## 5. Robustness, security and performance checks

- **Robustness sweep (Python engine):** 27 configurations covering all 9 products, 4 single regions, B2B and B2C, 12 to 36 months, test windows of 3, 6 and 12, and horizons of 1, 3 and 6. Every one completed, with fallback text and key facts fully grounded. Mean run 1.1 s, slowest 3.7 s; largest LLM request 9 KB (limit 32 KB).
- **Edge cases:** a zero month (excluded from MAPE and counted), constant data, a 10× spike, all zeros, the minimum length (5 months) all run without errors. Too little data returns a friendly message.
- **Rate limit (live):** the 13th rapid request returned **HTTP 429**. Invalid JSON returns 400 without calling the LLM. GET is not routed.
- **Cross-site use:** the function sends no CORS headers, so other websites cannot call it from a browser. Direct calls are limited by the rate limit, input-size and schema checks, and a fixed answer format.
- **Exposure:** `netlify.toml` and server source return 404 on the live site, and no secrets are in Git or the deployed assets.
- **Live performance:** the page loads in under 1 s; the engine is ready in about 13 s on first load; a "next month" re-run takes about 1 s; an AI answer takes about 7–11 s, with all 23–28 quoted figures verified.

## 6. AI Analyst chat (added after the audit)

| Check | Result |
|---|---|
| Real time | Answers stream as they are generated. Locally: first words after ~1 s, full answer in ~3 s |
| Uses the live results | Each question carries the snapshot on screen now. After "Next month arrives", the thread shows "Results updated: data version 2 …" and the answer reflects January 2022 |
| Grounding | Every figure in a finished answer is checked against the snapshot ("N/N figures verified", or a warning listing figures not in the data) |
| Conversation memory | The last 9 turns are sent as context; follow-ups work (e2e) |
| Limits and abuse | Questions ≤ 600 characters, ≤ 10 turns, body ≤ 64 KB, 15 messages per minute per visitor, key never returned (unit tests) |
| Failures | Busy service → retried once → friendly message with "ask again"; a broken stream ends with a note (unit + e2e) |
| Scope | The chat prompt keeps answers to this forecast, forbids invented numbers or causes, and declines unrelated requests |

## 7. Known limitations (by design)

- The dataset is synthetic and shows no real seasonality. This is tested and reported, not hidden.
- The in-browser engine needs about 8–13 s to start. Precomputed results are shown meanwhile.
- AI answers depend on NVIDIA's free endpoint. When it is busy, the labelled rule-based interpretation is shown instead.
- The checks verify numbers and significance wording, not every qualitative sentence. The rest of the wording is constrained by the verified key facts and the prompt.
