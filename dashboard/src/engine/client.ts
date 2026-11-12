// Main-thread client for the engine worker.
//
// Only the latest request matters: while a run is in progress, newer requests
// replace each other in a single pending slot, so dragging a slider never
// builds up a queue of stale runs.

import * as Comlink from "comlink";
import type { EngineApi } from "./engine.worker";
import type { EngineProgress, EngineRequest, EngineResponse } from "./types";

type Listener = (p: EngineProgress) => void;

export class EngineClient {
  private api: Comlink.Remote<EngineApi>;
  private ready: Promise<void> | null = null;
  private inFlight: Promise<void> | null = null;
  private pending: { request: EngineRequest; resolve: (r: EngineResponse | null) => void } | null = null;

  constructor() {
    const worker = new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" });
    this.api = Comlink.wrap<EngineApi>(worker);
  }

  init(onProgress: Listener): Promise<void> {
    if (!this.ready) {
      this.ready = this.api.init(import.meta.env.BASE_URL, Comlink.proxy(onProgress));
      this.ready.catch(() => {
        this.ready = null; // allow a retry
      });
    }
    return this.ready;
  }

  /** Run the pipeline. Resolves to null if a newer request superseded this one. */
  run(request: EngineRequest): Promise<EngineResponse | null> {
    return new Promise((resolve) => {
      if (this.pending) this.pending.resolve(null); // superseded
      this.pending = { request, resolve };
      if (!this.inFlight) this.inFlight = this.drain();
    });
  }

  private async drain() {
    try {
      try {
        if (this.ready) await this.ready;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.pending?.resolve({ ok: false, error: `Engine failed to load: ${message}`, ms: 0 });
        this.pending = null;
        return;
      }
      while (this.pending) {
        const { request, resolve } = this.pending;
        this.pending = null;
        try {
          resolve(await this.api.run(request));
        } catch (err) {
          resolve({ ok: false, error: err instanceof Error ? err.message : String(err), ms: 0 });
        }
      }
    } finally {
      this.inFlight = null;
    }
  }
}

let shared: EngineClient | null = null;

export function getEngine(): EngineClient {
  shared ??= new EngineClient();
  return shared;
}
