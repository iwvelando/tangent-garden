// The planar event strip's previews (planar-story.ts): the study at each of
// the shown event's three levels, traced by the notebook's own engine and
// kept as path data for a small drawing of the curve alone. They follow
// EventPreviews (spatial/event-previews.ts): one calculation is in flight
// at a time, and only the latest intent is kept; a newer one replaces it
// at once, clearing its previews, and a reply for any earlier one, even an
// identical intent asked for again, is dropped. Calculations wait while
// the queue is held. At most three level sets' path data are held, drawn
// in the current palette when shown, so a change of theme or scheme asks
// for nothing. Nothing here enters a link.
import { eventStates, type EventState } from "./event-story";
import { pathData } from "./Plot";
import { planarStateReading, type PlanarStory } from "./planar-story";
import type { StripSlot } from "./EventStrip";
import type { Config, ContourResult, Frame } from "./types";

// What the strip asks for: the study at each of the shown event's states.
// key identifies everything they depend on, the event included, so a
// change of level alone asks for nothing.
export type PlanarPreviewIntent = {
  key: string;
  story: PlanarStory;
  event: number;
  configs: Record<EventState, Config>;
};
export type PlanarPreview = {
  // One path per contour, in the preview's page (previewPage).
  paths: string[];
  reading: ReturnType<typeof planarStateReading>;
  // The trace's own code (engine.LevelTopology), "" when unclassified.
  class: string;
};
export type PlanarPreviewSlots = Record<EventState, StripSlot<PlanarPreview>>;
const pending = (): PlanarPreviewSlots => ({
  before: { status: "pending" },
  critical: { status: "pending" },
  after: { status: "pending" },
});
// The preview's page, in its own units: twice its CSS size on the strip.
export const previewPage = { width: 360, height: 240 };
// Room about the story's largest curve, as a fraction of it.
const previewMargin = 1.12;

// A story's previews share one frame: the rectangle that holds its curve
// at every covered level, centered, at equal scale.
export function previewFrame(story: PlanarStory) {
  const e = story.extent(story.range[1]);
  const scale = Math.min(
    previewPage.width / (2 * e.x * previewMargin),
    previewPage.height / (2 * e.y * previewMargin),
  );
  return (p: { x: number; y: number }) => ({
    x: previewPage.width / 2 + p.x * scale,
    y: previewPage.height / 2 - p.y * scale,
  });
}
// A trace's contours as preview paths.
export function previewPaths(story: PlanarStory, r: ContourResult) {
  const xy = previewFrame(story);
  return r.curve.contours.map(
    (c) => pathData(c.points, xy) + (c.closed ? "Z" : ""),
  );
}

export type PlanarPreviewRun = (config: Config) => Promise<Frame>;

export class PlanarEventPreviews {
  private generation = 0;
  private intent: PlanarPreviewIntent | null = null;
  private busy = false;
  // Calculations wait while held, as while the study itself computes.
  private held = true;
  private slots = pending();
  private closed = false;
  // The calculations made, for tests and measurement.
  calculations = 0;
  constructor(
    private run: PlanarPreviewRun,
    private onChange: (
      slots: PlanarPreviewSlots,
      intent: PlanarPreviewIntent | null,
    ) => void,
  ) {}
  // The latest intent, or none. The same intent again is no change; any
  // other starts over, discarding the previews and any reply in flight.
  request(intent: PlanarPreviewIntent | null) {
    if (this.closed) return;
    if (intent && this.intent && intent.key === this.intent.key) return;
    if (!intent && !this.intent) return;
    this.generation++;
    this.intent = intent;
    this.slots = pending();
    this.onChange(this.slots, this.intent);
    void this.pump();
  }
  // Held, no calculation starts (one in flight finishes); released, the
  // latest intent's start.
  hold(held: boolean) {
    this.held = held;
    if (!held) void this.pump();
  }
  dispose() {
    this.closed = true;
    this.generation++;
    this.intent = null;
    this.slots = pending();
  }
  private async pump() {
    const intent = this.intent;
    if (this.busy || this.held || this.closed || !intent) return;
    const state = eventStates.find((s) => this.slots[s].status === "pending");
    if (!state) return;
    const generation = this.generation;
    this.busy = true;
    let slot: StripSlot<PlanarPreview>;
    try {
      this.calculations++;
      const { result } = await this.run(intent.configs[state]);
      const r = result.contours!;
      slot = {
        status: "ready",
        paths: previewPaths(intent.story, r),
        reading: planarStateReading(intent.story, intent.event, state, r),
        class: r.topology?.class ?? "",
      };
    } catch (e) {
      slot = { status: "failed", message: (e as Error).message };
    }
    this.busy = false;
    // A reply for an earlier intent is dropped, and the latest one starts.
    if (generation === this.generation) {
      this.slots = { ...this.slots, [state]: slot };
      this.onChange(this.slots, this.intent);
    }
    void this.pump();
  }
}
