import type { EngineClient } from "../engine-client";
import type { Config, Result } from "./types";
// At most one active computation and one replacement. Rapid edits/scrubs
// supersede the waiting request instead of filling the worker's queue.
export class Sampler {
  private pending: {
    config: Config;
    resolve: (r: Result | null) => void;
    reject: (e: Error) => void;
  } | null = null;
  private active = false;
  constructor(private client: EngineClient) {}
  request(config: Config): Promise<Result | null> {
    this.pending?.resolve(null);
    return new Promise((resolve, reject) => {
      this.pending = { config, resolve, reject };
      void this.pump();
    });
  }
  private async pump() {
    if (this.active) return;
    this.active = true;
    try {
      while (this.pending) {
        const job = this.pending;
        this.pending = null;
        try {
          job.resolve(await this.client.tesseract(job.config));
        } catch (e) {
          job.reject(e as Error);
        }
      }
    } finally {
      this.active = false;
    }
  }
  cancel() {
    this.pending?.resolve(null);
    this.pending = null;
  }
}
