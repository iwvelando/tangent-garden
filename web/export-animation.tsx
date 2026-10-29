import type { ColorScheme } from "./color-schemes";
import { renderToStaticMarkup } from "react-dom/server";
import type { LineWeight } from "./line-weight";
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
  // A repeating animation leaves out its end, which is its start again.
  cyclic?: boolean;
  settings: ExportSettings;
  dark: boolean;
  scheme?: ColorScheme;
  layers: Layers;
  weight: LineWeight;
  signal: AbortSignal;
  // Frames calculated ahead of drawing, in order; at least 1.
  lookahead: number;
  // The frame at a time on the timeline (see timing.ts).
  sample: (time: number) => Promise<AnimationView>;
  onProgress: (completed: number, total: number) => void;
};

// Rendering is independent of the live DOM, manual camera, and wall clock.
// Only compressed frames accumulate; cancellation discards them without a file.
export async function exportSvgAnimation<T>(
  options: Omit<Options, "sample" | "dark" | "scheme" | "layers" | "weight"> & {
    sample: (time: number) => Promise<T>;
    draw: (view: T, scale: number) => string;
  },
): Promise<Blob> {
  const { signal, sample, onProgress } = options;
  const timing = exportTiming(options.duration, options.fps, options.cyclic);
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
      const svg = options.draw(view, encoding.scale);
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
    canvas.width = canvas.height = 0;
  }
}

// The ordinary planar renderer keeps its previous numerical/export semantics.
export function exportAnimation(options: Options): Promise<Blob> {
  const { dark, layers, weight } = options;
  return exportSvgAnimation({
    ...options,
    draw: (view, scale) => {
      return renderToStaticMarkup(
        <Plot
          family={view.family}
          result={view.frame.result}
          config={view.frame.config}
          layers={layers}
          weight={weight}
          dark={dark}
          scheme={options.scheme}
          length={view.length}
          stop={view.stop}
          animation={view}
          reset={0}
          pixelRatio={scale}
        />,
      );
    },
  });
}
