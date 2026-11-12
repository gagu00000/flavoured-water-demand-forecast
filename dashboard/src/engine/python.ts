// Shared Pyodide bootstrap, used by the browser Web Worker and by the Node
// parity tests, so both exercise exactly the same code path.

import type { PyodideInterface } from "pyodide";
import type { EngineRequest, EngineResponse, PipelineResult } from "./types";

export const PYODIDE_VERSION = "0.29.5";
export const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
export const PY_PACKAGES = ["numpy", "pandas", "scipy", "scikit-learn", "statsmodels", "xgboost"];
const CORE_DIR = "/app/forecasting_core";

/** Write the forecasting_core sources into Pyodide's virtual file system and import them. */
export async function installCore(py: PyodideInterface, files: { name: string; content: string }[]) {
  py.FS.mkdirTree(CORE_DIR);
  for (const file of files) py.FS.writeFile(`${CORE_DIR}/${file.name}`, file.content);
  await py.runPythonAsync(`
import sys, warnings
warnings.filterwarnings("ignore")
if "/app" not in sys.path:
    sys.path.insert(0, "/app")
import forecasting_core
from forecasting_core import run_pipeline, PipelineConfig
`);
}

// Runs the pipeline on a JSON request and always returns JSON (errors included),
// so Python exceptions surface as friendly messages instead of crashing the worker.
const RUN_CODE = `
import json
def _engine_run(request_json):
    try:
        req = json.loads(request_json)
        cfg = PipelineConfig(test_size=int(req["test_size"]), horizon=int(req["horizon"]))
        result = run_pipeline(req["records"], cfg, req.get("context"), req.get("regional"))
        return json.dumps({"ok": True, "result": result})
    except ValueError as exc:
        return json.dumps({"ok": False, "error": str(exc)})
    except Exception as exc:
        return json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"})
_engine_run(_request_json)
`;

export async function runRequest(py: PyodideInterface, request: EngineRequest): Promise<EngineResponse> {
  py.globals.set("_request_json", JSON.stringify(request));
  const started = performance.now();
  const text = (await py.runPythonAsync(RUN_CODE)) as string;
  const parsed = JSON.parse(text) as { ok: true; result: PipelineResult } | { ok: false; error: string };
  return { ...parsed, ms: Math.round(performance.now() - started) };
}
