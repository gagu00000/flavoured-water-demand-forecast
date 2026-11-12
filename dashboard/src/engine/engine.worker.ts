// Web Worker hosting Pyodide (Python compiled to WebAssembly). Keeping it off
// the main thread means the UI stays smooth while models train.

import * as Comlink from "comlink";
import { loadPyodide, type PyodideInterface } from "pyodide";
import { installCore, PY_PACKAGES, PYODIDE_INDEX_URL, runRequest } from "./python";
import type { EngineProgress, EngineRequest, EngineResponse } from "./types";

let pyodide: PyodideInterface | null = null;
let booting: Promise<void> | null = null;

async function boot(baseUrl: string, onProgress: (p: EngineProgress) => void) {
  onProgress({ status: "loading", step: "Starting Python runtime", pct: 5 });
  const py = await loadPyodide({ indexURL: PYODIDE_INDEX_URL });

  // Download all scientific packages in parallel (much faster than one by one)
  onProgress({ status: "loading", step: "Downloading numpy, pandas, scipy, scikit-learn, statsmodels, xgboost", pct: 20 });
  await py.loadPackage(PY_PACKAGES, { messageCallback: () => {}, errorCallback: () => {} });

  onProgress({ status: "loading", step: "Loading forecasting engine", pct: 85 });
  const manifest = (await (await fetch(`${baseUrl}py/manifest.json`)).json()) as { files: string[]; hash: string };
  const files = await Promise.all(
    manifest.files.map(async (name) => ({
      name,
      content: await (await fetch(`${baseUrl}py/forecasting_core/${name}?v=${manifest.hash}`)).text(),
    })),
  );
  await installCore(py, files);

  // Import the model libraries now, so the user's first interaction runs at full speed
  onProgress({ status: "loading", step: "Preparing models", pct: 93 });
  await py.runPythonAsync("import statsmodels.tsa.statespace.sarimax, sklearn.ensemble, xgboost");
  // One throw-away run warms up every code path (the first run is otherwise about 3x slower)
  const months = Array.from({ length: 12 }, (_, i) => `2021-${String(i + 1).padStart(2, "0")}`);
  await runRequest(py, {
    records: months.map((month, i) => ({ month, units: 1000 + 37 * ((i * 7) % 5) })),
    test_size: 3,
    horizon: 3,
    context: { product: "warm-up", region: "", customer_type: "", view: "", unit: "units", data_version: 0, notes: [] },
  });
  pyodide = py;
  onProgress({ status: "ready", step: "Engine ready", pct: 100 });
}

const api = {
  async init(baseUrl: string, onProgress: (p: EngineProgress) => void): Promise<void> {
    if (!booting) {
      booting = boot(baseUrl, onProgress).catch((err: unknown) => {
        booting = null;
        const message = err instanceof Error ? err.message : String(err);
        onProgress({ status: "error", step: "Engine failed to load", pct: 0, error: message });
        throw err;
      });
    }
    return booting;
  },

  async run(request: EngineRequest): Promise<EngineResponse> {
    if (!pyodide) throw new Error("Engine is not ready");
    return runRequest(pyodide, request);
  },
};

export type EngineApi = typeof api;
Comlink.expose(api);
