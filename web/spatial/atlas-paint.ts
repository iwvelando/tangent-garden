// Drawing the 3D atlas (atlas.ts): each variant's retained result is drawn
// by one offscreen renderer at a time, as the notebook draws, to a PNG kept
// as an object URL. A slot holds its latest intent only; an image for an
// older intent is dropped, and an image replaced or cleared is revoked.
// The renderer is released once nothing is waiting, so the atlas holds a
// WebGL context only while it draws.
import type { ColorScheme } from "../color-schemes";
import { cutSpec, type Cut } from "./cut";
import type { SpatialCamera } from "./link";
import { createRenderer, type Layers } from "./renderer";
import type { Projection, View } from "./scene";
import { sightSpec, unprobed, type Sight } from "./sight";
import type { Bounds3, SpatialResult } from "./types";

// Everything a drawing takes from the source study and the page.
export type PaintStyle = {
  camera: SpatialCamera;
  projection: Projection;
  lensAngle: number;
  layers: Layers;
  cut: Cut;
  sight: Sight;
  dark: boolean;
  scheme: ColorScheme;
};
export type Page = { width: number; height: number };
// Previews keep the grid's 1000 : 760 cells at twice their CSS size.
export const previewPages: Record<3 | 5, Page> = {
  3: { width: 600, height: 456 },
  5: { width: 360, height: 274 },
};
export const inspectionPage: Page = { width: 1600, height: 1216 };
export type Painted =
  | { status: "ready"; url: string; view: View }
  | { status: "failed"; message: string };
export type Slot = number | "inspection";

// The view the notebook draws: the manual camera about the given bounds,
// with its projection, and the chosen lens's angle when chosen.
export function paintView(bounds: Bounds3, style: PaintStyle): View {
  const { projection, lensAngle, camera } = style;
  return {
    ...camera,
    ...bounds,
    ...(projection !== "orthographic" && { projection }),
    ...(projection === "chosen" && { lensAngle }),
  };
}

// One sphere containing every member's bounding sphere, independent of
// their order: centered on the box that holds them all, just large enough
// to reach the farthest member's far side. Undefined without members.
export function sharedBounds(members: Bounds3[]): Bounds3 | undefined {
  if (!members.length) return undefined;
  const axes = ["x", "y", "z"] as const;
  const center = Object.fromEntries(
    axes.map((k) => {
      const lo = Math.min(...members.map((m) => m.center[k] - m.radius));
      const hi = Math.max(...members.map((m) => m.center[k] + m.radius));
      return [k, (lo + hi) / 2];
    }),
  ) as Bounds3["center"];
  const radius = Math.max(
    ...members.map(
      (m) =>
        Math.hypot(
          m.center.x - center.x,
          m.center.y - center.y,
          m.center.z - center.z,
        ) + m.radius,
    ),
  );
  return { center, radius };
}

// A result's identity in a drawing's key: a new result is drawn even
// where its view matches the last one's.
const ids = new WeakMap<object, number>();
let lastId = 0;
const resultId = (result: object) => {
  let id = ids.get(result);
  if (id === undefined) ids.set(result, (id = ++lastId));
  return id;
};

type Intent = {
  key: string;
  result: SpatialResult;
  view: View;
  style: PaintStyle;
  page: Page;
};

export class AtlasPainter {
  private wanted = new Map<Slot, Intent>();
  private shown = new Map<Slot, { key: string; url?: string }>();
  private canvas: HTMLCanvasElement | null = null;
  private renderer: ReturnType<typeof createRenderer> | null = null;
  private scheme: ColorScheme | null = null;
  private busy = false;
  private closed = false;
  // Drawings made, for tests and measurement.
  drawings = 0;
  constructor(
    private onChange: (slot: Slot, painted: Painted | null) => void,
  ) {}
  // Draw a slot's result unless that intent is already drawn or waiting.
  request(
    slot: Slot,
    result: SpatialResult,
    bounds: Bounds3,
    style: PaintStyle,
    page: Page,
  ) {
    if (this.closed) return;
    const view = paintView(bounds, style);
    const key = JSON.stringify([resultId(result), view, style, page]);
    if (
      this.shown.get(slot)?.key === key &&
      this.wanted.get(slot) === undefined
    )
      return;
    if (this.wanted.get(slot)?.key === key) return;
    this.wanted.set(slot, { key, result, view, style, page });
    void this.pump();
  }
  // Forget a slot: its waiting intent is dropped and its image revoked.
  clear(slot: Slot) {
    this.wanted.delete(slot);
    if (this.inFlight?.slot === slot) this.inFlight.dropped = true;
    const shown = this.shown.get(slot);
    if (shown?.url) URL.revokeObjectURL(shown.url);
    this.shown.delete(slot);
  }
  clearAll() {
    for (const slot of [...this.shown.keys(), ...this.wanted.keys()])
      this.clear(slot);
  }
  dispose() {
    this.closed = true;
    this.clearAll();
    this.release();
  }
  private release() {
    this.renderer?.dispose();
    this.canvas
      ?.getContext("webgl")
      ?.getExtension("WEBGL_lose_context")
      ?.loseContext();
    this.renderer = null;
    this.canvas = null;
    this.scheme = null;
  }
  // The drawing in progress; a clear of its slot drops its image.
  private inFlight: { slot: Slot; dropped: boolean } | null = null;
  private async pump() {
    if (this.busy || this.closed) return;
    const next = this.wanted.entries().next();
    if (next.done) {
      this.release();
      return;
    }
    const [slot, intent] = next.value;
    this.wanted.delete(slot);
    this.busy = true;
    const flight = (this.inFlight = { slot, dropped: false });
    let painted: Painted;
    try {
      const blob = await this.draw(intent);
      painted = {
        status: "ready",
        url: URL.createObjectURL(blob),
        view: intent.view,
      };
    } catch (e) {
      // A failed drawing starts the next from a fresh renderer.
      this.release();
      painted = { status: "failed", message: (e as Error).message };
    }
    this.busy = false;
    this.inFlight = null;
    // A newer intent for the slot, or a clear, supersedes this drawing.
    if (this.closed || flight.dropped || this.wanted.has(slot)) {
      if (painted.status === "ready") URL.revokeObjectURL(painted.url);
    } else {
      const old = this.shown.get(slot);
      if (old?.url) URL.revokeObjectURL(old.url);
      this.shown.set(slot, {
        key: intent.key,
        ...(painted.status === "ready" && { url: painted.url }),
      });
      this.onChange(slot, painted);
    }
    void this.pump();
  }
  private async draw({ style, page, result, view }: Intent): Promise<Blob> {
    if (!this.renderer || this.scheme !== style.scheme) {
      this.release();
      this.canvas = document.createElement("canvas");
      this.renderer = createRenderer(this.canvas, style.scheme);
      this.scheme = style.scheme;
    }
    const renderer = this.renderer,
      canvas = this.canvas!;
    this.drawings++;
    renderer.upload(result);
    renderer.setProbe([]);
    renderer.setCut(cutSpec(style.cut).spec);
    renderer.setSight(sightSpec(unprobed(style.sight)).spec);
    renderer.draw(view, style.layers, style.dark, page);
    if (canvas.getContext("webgl")?.isContextLost())
      throw new Error("The graphics context was lost while drawing.");
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) =>
          b
            ? resolve(b)
            : reject(new Error("The drawing could not be encoded.")),
        "image/png",
      ),
    );
  }
}
