// A scan's previews (ScanPanel.tsx): the study either side of each of its
// first candidates, drawn small by the ordinary renderer, as the event
// strip's previews are (event-previews.ts). One calculation is in flight at
// a time, and only the latest intent is kept: a newer one replaces it at
// once, clearing its images, and a reply for an earlier one is dropped.
// Calculations wait while the queue is held, as while the study itself
// computes. At most two images are held for each of `scanPreviewed`
// candidates; each mesh is released once its image is drawn. Nothing here
// enters a link.
import type { PreviewFocus, PreviewLook } from "./event-previews";
import type { ImplicitConfig, SpatialConfig, SpatialResult } from "./types";

export const scanPreviewed = 6;
// A close-up's zoom: about eight of the study's cells either side of the
// point, so the mesh's change there is resolved, within 2–12 times the
// box's own framing. The turntable draws 1.16 radii either side at zoom 1
// (scene.ts), and a study's bounds are its box's.
export function closeUpZoom(q: ImplicitConfig): number {
  const { box } = q;
  const sides = [box.xMax - box.xMin, box.yMax - box.yMin, box.zMax - box.zMin];
  const radius = Math.hypot(...sides) / 2;
  const cell = Math.max(...sides) / q.cells;
  return Math.min(12, Math.max(2, (1.16 * radius) / (8 * cell)));
}

export type ScanSide = "before" | "after";
export type ScanPreviewIntent = {
  key: string;
  look: PreviewLook;
  // The study at each candidate's two ends, and the point a close-up turns
  // about, when it has one.
  candidates: {
    before: SpatialConfig;
    after: SpatialConfig;
    focus?: PreviewFocus;
  }[];
};
export type ScanPreviewSlot =
  | { status: "pending" }
  | { status: "ready"; url: string }
  | { status: "failed"; message: string };
export type ScanPreviewSlots = Record<ScanSide, ScanPreviewSlot>[];

export class ScanPreviews {
  private generation = 0;
  private intent: ScanPreviewIntent | null = null;
  private busy = false;
  private held = true;
  private slots: ScanPreviewSlots = [];
  private closed = false;
  // The calculations made, for tests and measurement.
  calculations = 0;
  constructor(
    private run: (config: SpatialConfig) => Promise<SpatialResult>,
    private draw: (
      result: SpatialResult,
      look: PreviewLook,
      focus?: PreviewFocus,
    ) => Promise<Blob>,
    private onChange: (slots: ScanPreviewSlots) => void,
  ) {}
  // The latest intent, or none. The same intent again is no change; any
  // other starts over, discarding the images and any reply in flight.
  request(intent: ScanPreviewIntent | null) {
    if (this.closed) return;
    if (intent && this.intent && intent.key === this.intent.key) return;
    if (!intent && !this.intent) return;
    this.generation++;
    this.intent = intent;
    this.reset();
    void this.pump();
  }
  hold(held: boolean) {
    this.held = held;
    if (!held) void this.pump();
  }
  dispose() {
    this.closed = true;
    this.generation++;
    this.intent = null;
    this.reset(false);
  }
  private reset(notify = true) {
    for (const pair of this.slots)
      for (const slot of Object.values(pair))
        if (slot.status === "ready") URL.revokeObjectURL(slot.url);
    this.slots = (this.intent?.candidates ?? [])
      .slice(0, scanPreviewed)
      .map(() => ({
        before: { status: "pending" },
        after: { status: "pending" },
      }));
    if (notify) this.onChange(this.slots);
  }
  private async pump() {
    const intent = this.intent;
    if (this.busy || this.held || !intent) return;
    let k = -1,
      side: ScanSide = "before";
    for (const [i, pair] of this.slots.entries()) {
      const s = (["before", "after"] as const).find(
        (s) => pair[s].status === "pending",
      );
      if (s) {
        [k, side] = [i, s];
        break;
      }
    }
    if (k < 0) return;
    const generation = this.generation;
    const current = () => generation === this.generation;
    this.busy = true;
    let slot: ScanPreviewSlot | null;
    try {
      this.calculations++;
      const c = intent.candidates[k];
      let result: SpatialResult | null = await this.run(c[side]);
      if (!current()) slot = null;
      else {
        const blob = await this.draw(result, intent.look, c.focus);
        result = null;
        slot = current()
          ? { status: "ready", url: URL.createObjectURL(blob) }
          : null;
      }
    } catch (e) {
      slot = current()
        ? { status: "failed", message: (e as Error).message }
        : null;
    }
    this.busy = false;
    if (current() && slot) {
      this.slots = this.slots.map((pair, i) =>
        i === k ? { ...pair, [side]: slot } : pair,
      );
      this.onChange(this.slots);
    }
    void this.pump();
  }
}
