import { renderToStaticMarkup } from "react-dom/server";
import { Plot, type Layers } from "./Plot";
import type { AnimationView } from "./animation";
import { mp4Sink, webpSink } from "./export-sinks";
import {
  exportEncoding,
  exportTiming,
  type ExportSettings,
} from "./export-quality";
import { type ExportFormat } from "./export-formats";
import { inOrder } from "./lookahead";

type Options = {
  format: ExportFormat;
  duration: number;
  fps: number;
  loop: boolean;
  settings: ExportSettings;
  dark: boolean;
  layers: Layers;
  signal: AbortSignal;
  // Frames calculated ahead of drawing, in order; at least 1.
  lookahead: number;
  sample: (progress: number) => Promise<AnimationView>;
  onProgress: (completed: number, total: number) => void;
};

// Rendering is independent of the live DOM, manual camera, and wall clock.
// Only compressed frames accumulate; cancellation discards them without a file.
export async function exportAnimation(options: Options): Promise<Blob> {
  if (options.format === "webp" && options.fps === 60)
    throw new Error("Animated WebP supports 15 or 30 fps.");
  const { signal, sample, onProgress, dark, layers } = options;
  const timing = exportTiming(options.duration, options.fps);
  const canvas = document.createElement("canvas");
  const encoding = exportEncoding(options.settings);
  canvas.width = encoding.width;
  canvas.height = encoding.height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context)
    throw new Error("Canvas drawing is unavailable in this browser.");
  const sink =
    options.format === "mp4"
      ? mp4Sink(encoding, options.fps)
      : webpSink(encoding, options.loop);
  try {
    // Calculations for later frames overlap drawing and encoding this one.
    const views = inOrder(
      timing.length,
      options.lookahead,
      (i) => sample(timing[i].progress),
      signal,
    );
    let i = 0;
    for await (const view of views) {
      const frame = timing[i];
      signal.throwIfAborted();
      const svg = renderToStaticMarkup(
        <Plot
          result={view.frame.result}
          config={view.frame.config}
          layers={layers}
          dark={dark}
          length={view.length}
          animation={view}
          reset={0}
          pixelRatio={encoding.scale}
        />,
      );
      const url = URL.createObjectURL(
        new Blob([svg], { type: "image/svg+xml" }),
      );
      try {
        const image = new Image();
        image.src = url;
        await image.decode();
        signal.throwIfAborted();
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
      } finally {
        URL.revokeObjectURL(url);
      }
      await sink.add(canvas, frame.duration, i);
      signal.throwIfAborted();
      onProgress(++i, timing.length);
      // Yield even when computations hit cached endpoints, so Cancel stays usable.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const blob = await sink.finish();
    signal.throwIfAborted();
    return blob;
  } finally {
    sink.close();
  }
}
