import { EngineError, type EngineClient } from "../engine-client";
import type { LoomRequest } from "./model";
// One numerical request and one replaceable intent. A canceled owner cannot
// publish or restart. The disposable worker retains no geometry cache.
export class LoomSession {
  private client: EngineClient;
  private revision = 0;
  private busy = false;
  private closed = false;
  private rejectPoint: ((e: Error) => void) | undefined;
  private next: (() => Promise<void>) | undefined;
  constructor(private create: () => EngineClient) {
    this.client = create();
  }
  update(
    q: LoomRequest,
    pointOnly: boolean,
    show: (v: any) => void,
    fail: (e: Error) => void,
  ) {
    if (this.closed) return;
    const id = ++this.revision;
    const frozen = structuredClone(q);
    this.next = async () => {
      try {
        const r = await this.client.loom(frozen, pointOnly);
        if (!this.closed && id === this.revision) show(r);
      } catch (e) {
        // A timeout does not stop the old WASM call. Terminate it before
        // any replacement request, rather than queuing behind orphaned work.
        if (!this.closed && !(e instanceof EngineError)) {
          this.client.dispose();
          this.client = this.create();
        }
        if (!this.closed && id === this.revision) fail(e as Error);
      }
    };
    void this.drain();
  }
  private async drain() {
    if (this.busy || this.closed) return;
    this.busy = true;
    while (this.next && !this.closed) {
      const job = this.next;
      this.next = undefined;
      await job();
    }
    this.busy = false;
  }
  point(q: LoomRequest): Promise<import("./model").LoomMarker> {
    if (this.closed) return Promise.reject(new Error("Loom canceled."));
    return new Promise((resolve, reject) => {
      this.rejectPoint = reject;
      this.update(
        q,
        true,
        (r) => {
          this.rejectPoint = undefined;
          resolve(r.marker);
        },
        (e) => {
          this.rejectPoint = undefined;
          reject(e);
        },
      );
    });
  }
  cancel() {
    this.rejectPoint?.(new Error("Loom canceled."));
    this.rejectPoint = undefined;
    this.closed = true;
    this.revision++;
    this.next = undefined;
    this.client.dispose();
  }
}
