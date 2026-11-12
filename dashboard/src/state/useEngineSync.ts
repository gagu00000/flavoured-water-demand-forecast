// Keeps the forecasting results in sync with the dashboard state.
//
// 1. Loads the data cube and the precomputed default results (instant first paint).
// 2. Boots the in-browser Python engine in the background.
// 3. Whenever the scenario changes, builds the engine request and re-runs the
//    pipeline (debounced; only the latest request is ever run).

import { useEffect } from "react";
import { loadCube } from "../data/cube";
import { buildRequest, initialScenario } from "../data/scenario";
import { getEngine } from "../engine/client";
import type { PipelineResult } from "../engine/types";
import { hashJson } from "../lib/hash";
import { useDashboard } from "./store";

const DEBOUNCE_MS = 250;
const BASE = import.meta.env.BASE_URL;

export function useEngineSync() {
  const cube = useDashboard((s) => s.cube);
  const scenario = useDashboard((s) => s.scenario);

  // Load data, show the precomputed default results, and boot the engine
  useEffect(() => {
    let cancelled = false;
    const store = useDashboard.getState();
    (async () => {
      try {
        const [loadedCube, defaultResult] = await Promise.all([
          loadCube(BASE),
          fetch(`${BASE}data/snapshot_default.json`).then((r) => (r.ok ? (r.json() as Promise<PipelineResult>) : null)),
        ]);
        if (cancelled) return;
        store.setCube(loadedCube);
        // The default results were produced by the same engine (in the notebook) for the default scenario
        if (defaultResult) store.setResult(defaultResult, hashJson(buildRequest(loadedCube, initialScenario())), null);
      } catch (err) {
        if (!cancelled) store.setCubeError(err instanceof Error ? err.message : String(err));
      }
    })();
    getEngine()
      .init((p) => useDashboard.getState().setEngine(p))
      .catch(() => {
        /* status already reported through the progress callback */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-run the pipeline whenever the scenario changes
  useEffect(() => {
    if (!cube) return;
    const request = buildRequest(cube, scenario);
    const hash = hashJson(request);
    if (hash === useDashboard.getState().resultHash) return;

    const timer = window.setTimeout(async () => {
      const store = useDashboard.getState();
      store.setRunning(true);
      const response = await getEngine().run(request);
      if (response === null) return; // superseded by a newer request, which will finish the run
      store.setRunning(false);
      if (response.ok) store.setResult(response.result, hash, response.ms);
      else store.setRunError(response.error);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [cube, scenario]);
}
