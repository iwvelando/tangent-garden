import { EngineError, type EngineClient } from "../engine-client";
import type { GardenRequest, GardenResult } from "./model";

// One numerical request at a time and at most one unsent intent, which a
// newer request replaces. Only the newest revision may publish; a closed
// session publishes nothing. The worker keeps no geometry, and the page
// keeps only the result it shows.
export class GardenSession {
  private client: EngineClient;
  private revision = 0;
  private busy = false;
  private closed = false;
  // The worker failed or timed out; the next request starts a fresh one.
  private broken = false;
  private next: (() => Promise<void>) | undefined;
  constructor(private create: () => EngineClient) {
    this.client = create();
  }
  update(
    q: GardenRequest,
    show: (r: GardenResult) => void,
    fail: (e: Error) => void,
  ) {
    if (this.closed) return;
    const id = ++this.revision;
    const frozen = structuredClone(q);
    this.next = async () => {
      if (this.broken) {
        this.client = this.create();
        this.broken = false;
      }
      try {
        const r = await this.client.garden(frozen);
        if (!this.closed && id === this.revision) show(r);
      } catch (e) {
        // A timeout or a failed worker may still be running or be unusable:
        // end it now, and start another for the next request rather than
        // queue behind it. A refusal leaves the worker ready for corrected
        // input.
        if (!this.closed && !(e instanceof EngineError)) {
          this.client.dispose();
          this.broken = true;
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
  cancel() {
    this.closed = true;
    this.revision++;
    this.next = undefined;
    this.client.dispose();
  }
}
