// The event strip's previews (story.ts): the study at each of its story's
// three levels, drawn small by the ordinary renderer. One calculation is in
// flight at a time, and only the latest intent is kept: a newer one
// replaces it at once, clearing its images, and a reply for any earlier
// one, even an identical intent asked for again, is dropped. Calculations
// wait while the queue is held. At most three images are held; each mesh is
// released once its image is drawn and its pieces read. Nothing here
// enters a link.
import { createRenderer, type Layers } from "./renderer";
import type { ColorScheme } from "../color-schemes";
import type { CutSpec } from "./cut";
import type { Sight } from "./sight";
import type { View } from "./scene";
import type { SpatialCamera } from "./link";
import type { SpatialConfig, SpatialResult } from "./types";
import {
  eventStates,
  stateReading,
  type EventState,
  type Story,
} from "./story";

// What the strip asks for: the study at each state's level, and how to draw
// it. key identifies everything else, so a change of level alone, which
// the previews do not depend on, asks for nothing.
export type PreviewIntent = {
  key: string;
  story: Story;
  configs: Record<EventState, SpatialConfig>;
  camera: SpatialCamera;
  layers: Layers;
  dark: boolean;
  scheme: ColorScheme;
  cut: CutSpec | null;
  sight: Sight;
};
export type PreviewSlot =
  | { status: "pending" }
  | {
      status: "ready";
      url: string;
      reading: ReturnType<typeof stateReading>;
      pieces: number[];
    }
  | { status: "failed"; message: string };
export type PreviewSlots = Record<EventState, PreviewSlot>;
const pending = (): PreviewSlots => ({
  before: { status: "pending" },
  critical: { status: "pending" },
  after: { status: "pending" },
});
// The preview's page, in pixels: twice its CSS size on the strip.
export const previewPage = { width: 360, height: 240 };
const previewZoom = 1.5;

export type PreviewRun = (config: SpatialConfig) => Promise<SpatialResult>;
export type PreviewDraw = (
  result: SpatialResult,
  intent: PreviewIntent,
) => Promise<Blob>;

export class EventPreviews {
  private generation = 0;
  private intent: PreviewIntent | null = null;
  private busy = false;
  // Calculations wait while held, as while the study itself computes.
  private held = true;
  private slots = pending();
  private closed = false;
  // The calculations made, for tests and measurement.
  calculations = 0;
  constructor(
    private run: PreviewRun,
    private draw: PreviewDraw,
    private onChange: (
      slots: PreviewSlots,
      intent: PreviewIntent | null,
    ) => void,
  ) {}
  // The latest intent, or none. The same intent again is no change; any
  // other starts over, discarding the images and any reply in flight.
  request(intent: PreviewIntent | null) {
    if (this.closed) return;
    if (intent && this.intent && intent.key === this.intent.key) return;
    if (!intent && !this.intent) return;
    this.generation++;
    this.intent = intent;
    this.reset();
    this.pump();
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
    this.reset(false);
  }
  private reset(notify = true) {
    for (const state of eventStates) {
      const slot = this.slots[state];
      if (slot.status === "ready") URL.revokeObjectURL(slot.url);
    }
    this.slots = pending();
    if (notify) this.onChange(this.slots, this.intent);
  }
  private async pump() {
    const intent = this.intent;
    if (this.busy || this.held || !intent) return;
    const state = eventStates.find((s) => this.slots[s].status === "pending");
    if (!state) return;
    const generation = this.generation;
    this.busy = true;
    const slot = await this.preview(
      intent,
      state,
      () => generation === this.generation,
    );
    this.busy = false;
    // A reply for an earlier intent is dropped, and the latest one starts.
    if (generation === this.generation && slot) {
      this.slots = { ...this.slots, [state]: slot };
      this.onChange(this.slots, this.intent);
    }
    void this.pump();
  }
  private async preview(
    intent: PreviewIntent,
    state: EventState,
    current: () => boolean,
  ): Promise<PreviewSlot | null> {
    try {
      this.calculations++;
      let result: SpatialResult | null = await this.run(intent.configs[state]);
      if (!current()) return null;
      const level = result.implicit!;
      const reading = stateReading(intent.story, state, level),
        pieces = level.components.map((c) => c.euler).sort((a, b) => a - b);
      const blob = await this.draw(result, intent);
      // The mesh is released; only its image and reading are kept.
      result = null;
      if (!current()) return null;
      return {
        status: "ready",
        url: URL.createObjectURL(blob),
        reading,
        pieces,
      };
    } catch (e) {
      return current()
        ? { status: "failed", message: (e as Error).message }
        : null;
    }
  }
}

// One preview drawn as the drawing draws, at the story's opening camera
// about the result's own bounds (the box's, the same at every level).
export async function drawPreview(
  result: SpatialResult,
  intent: PreviewIntent,
): Promise<Blob> {
  const canvas = document.createElement("canvas"),
    renderer = createRenderer(canvas, intent.scheme);
  try {
    renderer.upload(result);
    renderer.setCut(intent.cut);
    renderer.setSight(intent.sight);
    // Closer than the story's view, which frames the whole box: a preview
    // is small, and the surface is what it compares.
    const view: View = {
      ...result.bounds,
      ...intent.camera,
      zoom: intent.camera.zoom * previewZoom,
    };
    renderer.draw(view, intent.layers, intent.dark, previewPage);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) =>
          b ? resolve(b) : reject(new Error("The preview could not be drawn.")),
        "image/png",
      ),
    );
  } finally {
    renderer.dispose();
    canvas
      .getContext("webgl")
      ?.getExtension("WEBGL_lose_context")
      ?.loseContext();
  }
}
