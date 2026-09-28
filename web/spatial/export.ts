import type { Frame } from "./types";
import { createRenderer, type View, type Layers } from "./renderer";
import { animationCamera, type AnimationView } from "./animation";
import { mp4Sink, webpSink } from "../export-sinks";
import {
  exportEncoding,
  exportTiming,
  type ExportSettings,
} from "../export-quality";
import type { ExportFormat } from "../export-formats";

export async function imageFile(
  frame: Frame,
  view: View,
  layers: Layers,
  dark: boolean,
  format: "png" | "svg",
  signal: AbortSignal,
): Promise<Blob> {
  const canvas = document.createElement("canvas"),
    renderer = createRenderer(canvas);
  try {
    renderer.upload(frame.result);
    renderer.draw(view, layers, dark, { width: 2000, height: 1520 });
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
    const xml = (s: string) =>
      s
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
    return new Blob(
      [
        `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1520" viewBox="0 0 2000 1520"><title>Tangent Garden — spatial tangent developable</title><desc>${xml(JSON.stringify({ config: frame.config, view, layers, dark, rendering: "embedded PNG" }))}</desc><image width="2000" height="1520" href="${canvas.toDataURL("image/png")}"/></svg>`,
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
