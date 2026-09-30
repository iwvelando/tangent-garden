import type { Frame } from "./types";
import { createRenderer, type View, type Layers } from "./renderer";
import { buildScene, type Batch } from "./scene";
import { linework, linesSvg, sampleStep } from "./linework";
import { animationCamera, type AnimationView } from "./animation";
import { probeBatches } from "./probe";
import { mp4Sink, webpSink } from "../export-sinks";
import {
  exportEncoding,
  exportTiming,
  type ExportSettings,
} from "../export-quality";
import type { ExportFormat } from "../export-formats";

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
  return title[frame.config.construction];
}
const xml = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

// PNG, the shaded drawing as an SVG-wrapped PNG, or the drawing's lines as
// vector paths: every line ("svg-lines") or the lines not hidden by a shown
// sheet, by sampling ("svg-visible").
export type ImageFormat = "png" | "svg" | "svg-lines" | "svg-visible";
const page = { width: 2000, height: 1520 };

export async function imageFile(
  frame: Frame,
  view: View,
  layers: Layers,
  dark: boolean,
  format: ImageFormat,
  signal: AbortSignal,
  // The parameter probe as drawn live, recorded in the metadata as its
  // sample index and parameter.
  probe?: { batches: Batch[]; index: number; t: number },
): Promise<Blob> {
  const probed = probe ? { probe: { index: probe.index, t: probe.t } } : {};
  if (format === "svg-lines" || format === "svg-visible") {
    const occlusion = format === "svg-lines" ? "none" : "sampled";
    const groups = linework(
      buildScene(frame.result),
      view,
      layers,
      dark,
      { ...page, occlusion, signal },
      probe?.batches,
    );
    signal.throwIfAborted();
    const svg = linesSvg(groups, {
      ...page,
      dark,
      title: `Tangent Garden — ${studyTitle(frame)} (lines)`,
      metadata: {
        config: frame.config,
        view,
        layers,
        dark,
        ...probed,
        rendering: "vector linework",
        occlusion: {
          mode: occlusion,
          statement:
            occlusion === "none"
              ? "Every shown line is drawn, including lines behind surfaces. Shaded surfaces are not drawn."
              : `Lines behind a shown surface are left out where sampled every ${sampleStep} px against a ${page.width} × ${page.height} depth raster of the surfaces, with the drawing's polygon offset. This approximates hidden lines; it is not exact hidden-line removal. Lines do not hide lines, and shaded surfaces are not drawn.`,
        },
      },
    });
    return new Blob([svg], { type: "image/svg+xml" });
  }
  const canvas = document.createElement("canvas"),
    renderer = createRenderer(canvas);
  try {
    renderer.upload(frame.result);
    renderer.setProbe(probe?.batches ?? []);
    renderer.draw(view, layers, dark, page);
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
        `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1520" viewBox="0 0 2000 1520"><title>Tangent Garden — ${studyTitle(frame)}</title><desc>${xml(JSON.stringify({ config: frame.config, view, layers, dark, ...probed, rendering: "embedded PNG" }))}</desc><image width="2000" height="1520" href="${canvas.toDataURL("image/png")}"/></svg>`,
      ],
      { type: "image/svg+xml" },
    );
  } finally {
    renderer.dispose();
    canvas
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
  settings: ExportSettings;
  dark: boolean;
  layers: Layers;
  signal: AbortSignal;
  sample: (progress: number) => Promise<AnimationView>;
  onProgress: (completed: number, total: number) => void;
}): Promise<Blob> {
  if (options.format === "webp" && options.fps === 60)
    throw new Error("Animated WebP supports 15 or 30 fps.");
  const timing = exportTiming(options.duration, options.fps),
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
          : probeBatches(view.frame.result, view.frame.config, view.probe),
      );
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
