import { composes, type Frame } from "./types";
import { createRenderer, type View, type Layers } from "./renderer";
import { buildScene, projectionRecord, type Batch } from "./scene";
import { linework, linesSvg, sampleStep, workLimit } from "./linework";
import { animationCamera, type AnimationView } from "./animation";
import { probeDrawing } from "./probe";
import { cutRecord, type CutSpec } from "./cut";
import { defaultSight, sightRecord, strokeRecord, type Sight } from "./sight";
import { mp4Sink, webpSink } from "../export-sinks";
import {
  exportEncoding,
  exportTiming,
  type ExportSettings,
} from "../export-quality";
import type { ExportFormat } from "../export-formats";
import { matte } from "../matte";
import {
  browserLimit,
  defaultStill,
  drawable,
  stillRecord,
  stillSize,
  type Still,
} from "../export-image";

// The study's name, for a file's title.
function studyTitle(frame: Frame) {
  const format = frame.config.format;
  if (format === "implicit") return "spatial implicit surface and sections";
  if (format === "surface") return "spatial surface normals and focal sheets";
  if (format === "rays") return "spatial mirror rays and caustics";
  const title: Record<Frame["config"]["construction"], string> = {
    developable: "spatial tangent developable",
    involute: "spatial involutes",
    "tangent-foot": "spatial tangent-foot projection",
    orthotomic: "spatial tangent-line orthotomic",
    inversion: "spatial sphere inversion",
    framed: "spatial framed ribbon",
    ruled: "spatial ruled surface",
    canal: "spatial canal surface",
    none:
      format === "field"
        ? "spatial vector-field trajectories"
        : format === "pursuit"
          ? "spatial cyclic pursuit"
          : "spatial curve",
  };
  const on = {
    base: "",
    "tangent-foot": " on the tangent-foot curve",
    orthotomic: " on the tangent-line orthotomic",
    involute: " on the involute",
  }[composes(frame.config) ? frame.config.input : "base"];
  return title[frame.config.construction] + on;
}
// The line weight in metadata, only when lines are strokes, so files drawn
// with hairlines are unchanged.
const strokesOf = (record: ReturnType<typeof strokeRecord>) =>
  record ? { strokes: record } : {};
const xml = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

// PNG, the shaded drawing as an SVG-wrapped PNG, or the drawing's lines as
// vector paths: every line ("svg-lines") or the lines not hidden by a shown
// sheet, by sampling ("svg-visible").
export type ImageFormat = "png" | "svg" | "svg-lines" | "svg-visible";
const defaultArea = (() => {
  const page = stillSize(defaultStill);
  return page.width * page.height;
})();

export async function imageFile(
  frame: Frame,
  view: View,
  layers: Layers,
  dark: boolean,
  format: ImageFormat,
  signal: AbortSignal,
  // The parameter probe as drawn live, recorded in the metadata as where
  // it stands (see probeRecord).
  probe?: { batches: Batch[]; record: object },
  // The cutaway plane as drawn, recorded in the metadata only when there is
  // one, so files without a cut are unchanged.
  cut?: CutSpec | null,
  // Seeing through, recorded only when it changes the drawing.
  sight: Sight = defaultSight,
  // The page's size and background, which every format here draws at,
  // recorded only when they are not the defaults.
  still: Still = defaultStill,
): Promise<Blob> {
  const lensed = projectionRecord(view);
  const page = stillSize(still);
  const probed = {
    ...(probe ? { probe: probe.record } : {}),
    ...(cut ? { cut: cutRecord(cut) } : {}),
    ...(lensed ? { projection: lensed } : {}),
    ...stillRecord(still),
  };
  if (format === "svg-lines" || format === "svg-visible") {
    const occlusion = format === "svg-lines" ? "none" : "sampled";
    const groups = linework(
      buildScene(frame.result),
      view,
      layers,
      dark,
      {
        ...page,
        occlusion,
        hidden: sight.hidden,
        weight: sight.weight,
        // The work a page's visibility testing needs grows with its area,
        // so the limit does too: a view that exports at one size exports
        // at every size.
        limit: (workLimit * (page.width * page.height)) / defaultArea,
        signal,
      },
      probe?.batches,
      cut,
    );
    // Lines are all a line drawing has: its sight is how hidden ones are
    // drawn, when they are tested at all.
    const lined =
      occlusion === "sampled" &&
      sightRecord({ ...defaultSight, hidden: sight.hidden }, false);
    signal.throwIfAborted();
    const svg = linesSvg(groups, {
      ...page,
      dark,
      transparent: still.transparent,
      title: `Tangent Garden — ${studyTitle(frame)} (lines)`,
      metadata: {
        config: frame.config,
        view,
        layers,
        dark,
        ...probed,
        ...(lined ? { sight: lined } : {}),
        ...strokesOf(strokeRecord(sight)),
        rendering: "vector linework",
        occlusion: {
          mode: occlusion,
          statement:
            occlusion === "none"
              ? "Every shown line is drawn, including lines behind surfaces. Shaded surfaces are not drawn."
              : `Lines behind a shown surface are ${lined ? `drawn ${sight.hidden}, in groups named hidden- and their layer,` : "left out"} where sampled every ${sampleStep} px against a ${page.width} × ${page.height} depth raster of the surfaces, with the drawing's polygon offset. This approximates hidden lines; it is not exact hidden-line removal. Lines do not hide lines, and shaded surfaces are not drawn.`,
        },
      },
    });
    return new Blob([svg], { type: "image/svg+xml" });
  }
  const drawing = document.createElement("canvas"),
    renderer = createRenderer(drawing);
  try {
    renderer.upload(frame.result);
    renderer.setProbe(probe?.batches ?? []);
    renderer.setCut(cut ?? null);
    renderer.setSight(sight);
    const seen = sightRecord(
      sight,
      sight.sheets === "through" && renderer.seeThrough(),
    );
    // Strokes, when this device can draw them; otherwise hairlines.
    const stroked = renderer.strokes() ? strokeRecord(sight) : undefined;
    let canvas = drawing;
    if (still.transparent) {
      // The page over black and over white gives its alpha (see matte).
      renderer.draw(view, layers, dark, page, [0, 0, 0]);
      const black = renderer.pixels();
      renderer.draw(view, layers, dark, page, [1, 1, 1]);
      const white = renderer.pixels();
      canvas = document.createElement("canvas");
      canvas.width = page.width;
      canvas.height = page.height;
      const context = canvas.getContext("2d");
      if (!context || !drawable(context, page.width, page.height))
        throw browserLimit(page.width, page.height);
      context.putImageData(
        new ImageData(matte(black, white), page.width, page.height),
        0,
        0,
      );
    } else renderer.draw(view, layers, dark, page);
    signal.throwIfAborted();
    const png = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("PNG encoding failed."))),
        "image/png",
      ),
    );
    signal.throwIfAborted();
    if (format === "png") return png;
    // A 3D shaded/depth-tested view is raster content. Label it honestly; do not
    // claim a painter-sorted mesh is an exact vector hidden-surface solution.
    return new Blob(
      [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${page.width}" height="${page.height}" viewBox="0 0 ${page.width} ${page.height}"><title>Tangent Garden — ${studyTitle(frame)}</title><desc>${xml(JSON.stringify({ config: frame.config, view, layers, dark, ...probed, ...(seen ? { sight: seen } : {}), ...strokesOf(stroked), rendering: "embedded PNG" }))}</desc><image width="${page.width}" height="${page.height}" href="${canvas.toDataURL("image/png")}"/></svg>`,
      ],
      { type: "image/svg+xml" },
    );
  } finally {
    renderer.dispose();
    drawing
      .getContext("webgl")
      ?.getExtension("WEBGL_lose_context")
      ?.loseContext();
  }
}
export async function exportAnimation(options: {
  format: ExportFormat;
  duration: number;
  fps: number;
  loop: boolean;
  // A repeating animation's frames span one period without its end, which
  // is its start again (see exportTiming).
  cyclic: boolean;
  settings: ExportSettings;
  dark: boolean;
  layers: Layers;
  // The entered cut when playback began; a frame that moves it carries its
  // own.
  cut: CutSpec | null;
  sight: Sight;
  signal: AbortSignal;
  // The frame at a time on the timeline.
  sample: (time: number) => Promise<AnimationView>;
  onProgress: (completed: number, total: number) => void;
}): Promise<Blob> {
  const timing = exportTiming(options.duration, options.fps, options.cyclic),
    encoding = exportEncoding(options.settings);
  const canvas = document.createElement("canvas"),
    renderer = createRenderer(canvas);
  let sink: ReturnType<typeof mp4Sink> | undefined;
  try {
    sink =
      options.format === "mp4"
        ? mp4Sink(encoding, options.fps)
        : webpSink(encoding, options.loop);
    for (let i = 0; i < timing.length; i++) {
      options.signal.throwIfAborted();
      const view = await options.sample(timing[i].progress);
      options.signal.throwIfAborted();
      renderer.upload(view.frame.result);
      // The probe as playback draws it, when the animation moves it.
      renderer.setProbe(
        view.probe === undefined
          ? []
          : probeDrawing(
              view.frame.result,
              view.frame.config,
              view.probeSetup!,
              view.probe,
            ),
      );
      renderer.setCut(view.cut ?? options.cut);
      renderer.setSight(options.sight);
      renderer.draw(
        animationCamera(view),
        options.layers,
        options.dark,
        encoding,
      );
      await sink.add(canvas, timing[i].duration, i);
      options.signal.throwIfAborted();
      options.onProgress(i + 1, timing.length);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const blob = await sink.finish();
    options.signal.throwIfAborted();
    return blob;
  } finally {
    sink?.close();
    renderer.dispose();
    canvas
      .getContext("webgl")
      ?.getExtension("WEBGL_lose_context")
      ?.loseContext();
  }
}
