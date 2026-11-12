# Forecasting Monthly Sales for a New Beverage Product

AI in Operations, Session II lab. This project forecasts monthly demand for a new flavoured water (Volvic Touch) from the Kaggle *Beverage Sales* dataset. It compares six models with MAPE and WAPE, and uses an LLM (NVIDIA Nemotron 3.5 Bolt E4B) to interpret the results from the live numbers.

| Deliverable | Location |
|---|---|
| Jupyter notebook covering all 7 lab tasks and the LLM interpretation | `notebook/Beverage_Demand_Forecasting.ipynb` |
| Shared forecasting engine (used by both the notebook and the dashboard) | `forecasting_core/` |
| LLM system prompt (shared by the notebook and the dashboard) | `prompts/interpretation_system.md` |
| Interactive dashboard (React + TypeScript, deployed on Netlify) | `dashboard/` |
| Implementation plan and traceability table | `PHASE2_PLAN.md` |
| Final audit, traceability and test results | `TEST_REPORT.md` |
| Netlify configuration and step-by-step deployment | `DEPLOYMENT.md` |
| Live dashboard | https://flavoured-water-forecast.netlify.app |

## Running the notebook

1. **Data:** download `synthetic_beverage_sales_data.csv` from [Kaggle: Beverage Sales](https://www.kaggle.com/datasets/sebastianwillmann/beverage-sales) into this folder. The file is about 789 MB and is git-ignored.
2. **Python 3.13 environment:** the modelling libraries are pinned to the versions bundled in Pyodide 0.29.5, so the dashboard's in-browser engine gives identical numbers.

   ```bash
   uv venv --python 3.13 ~/.venvs/aio-forecast
   ```
   ```bash
   VIRTUAL_ENV=~/.venvs/aio-forecast uv pip install -r requirements.txt
   ```
   ```bash
   ~/.venvs/aio-forecast/Scripts/python -m ipykernel install --user --name aio-forecast --display-name "Python 3.13 (aio-forecast)"
   ```

   The environment lives outside OneDrive so the sync isn't churned by thousands of package files.
3. **LLM key (optional):** copy `.env.example` to `.env` and set `NVIDIA_API_KEY`. A free key is available from the [NVIDIA API Catalog](https://build.nvidia.com). Without a key, the notebook still runs end to end and shows the clearly labelled rule-based interpretation instead.
4. **Run:** open the notebook with the `Python 3.13 (aio-forecast)` kernel and run all cells (about 35 seconds), or run it from the command line:

   ```bash
   ~/.venvs/aio-forecast/Scripts/python -m jupyter nbconvert --to notebook --execute --inplace --ExecutePreprocessor.kernel_name=aio-forecast notebook/Beverage_Demand_Forecasting.ipynb
   ```

## The dashboard

**Where each part runs:**
- **Monthly aggregates:** the notebook turns the 789 MB CSV into `dashboard/public/data/*.json`. This step is precomputed because the raw file is far too large for a browser, a serverless function or GitHub.
- **Features, all six models, metrics and the backtest:** these run **in the browser**, in a Web Worker. It uses Pyodide (Python compiled to WebAssembly) with the same `forecasting_core` code as the notebook.
- **The LLM call:** this runs in the **Netlify Function** `dashboard/netlify/functions/interpret.mts`. The key never reaches the browser.

```bash
cd dashboard && npm install
```
```bash
npm run dev
```

`npm run dev` serves the site at http://localhost:5173. It also serves `/api/interpret` locally, using `NVIDIA_API_KEY` from the project's `.env`.

Dashboard tests:
- `npm test` runs the unit and parity tests (the browser engine must reproduce the notebook).
- `npm run test:e2e` runs the Playwright browser tests against the production build, using the locally installed Chrome.

**Deployment:** Netlify builds from the repository root using `netlify.toml` (base directory `dashboard`). Set `NVIDIA_API_KEY` in Site configuration → Environment variables, with the scope set to Functions.

## Tests

```bash
~/.venvs/aio-forecast/Scripts/python -m pytest forecasting_core/tests -q
```

There are 45 Python tests, plus 59 dashboard unit/parity tests and 17 browser tests. The Python tests cover:
- MAPE/WAPE hand calculations and zero handling;
- no feature leakage, the chronological split, and identical backtest folds across models;
- the model rules, determinism, and JSON output;
- the parsimony rule;
- the LLM number-grounding check.

## Security

- `.env` is git-ignored, and the key is never printed or stored in the notebook.
- The dashboard calls the LLM only through a server-side Netlify Function, with the key set as a Netlify environment variable.
