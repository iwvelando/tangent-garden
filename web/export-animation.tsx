import { renderToStaticMarkup } from "react-dom/server";
import { Plot, type Layers } from "./Plot";
import type { AnimationView } from "./animation";
import { AnimatedWebP, exportTiming } from "./animated-webp";
import { exportEncoding, type ExportSettings } from "./export-quality";

type Options = {
  duration: number;
  fps: number;
  loop: boolean;
  settings: ExportSettings;
  dark: boolean;
  layers: Layers;
  signal: AbortSignal;
  sample: (progress: number) => Promise<AnimationView>;
  onProgress: (completed: number, total: number) => void;
};

// Rendering is independent of the live DOM, manual camera, and wall clock.
// Only compressed frames accumulate; cancellation discards them without a file.
export async function exportAnimation(options: Options): Promise<Blob> {
  const { signal, sample, onProgress, dark, layers } = options;
  const timing = exportTiming(options.duration, options.fps);
  const canvas = document.createElement("canvas");
  const encoding = exportEncoding(options.settings);
  canvas.width = encoding.width;
  canvas.height = encoding.height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context)
    throw new Error("Canvas drawing is unavailable in this browser.");
  const writer = new AnimatedWebP(canvas.width, canvas.height, options.loop);
  for (const [i, frame] of timing.entries()) {
    signal.throwIfAborted();
    const view = await sample(frame.progress);
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
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      signal.throwIfAborted();
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    } finally {
      URL.revokeObjectURL(url);
    }
    const image = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("WebP encoding failed.")),
        "image/webp",
        encoding.compression,
      );
    });
    signal.throwIfAborted();
    await writer.add(image, frame.duration);
    signal.throwIfAborted();
    onProgress(i + 1, timing.length);
    // Yield even when computations hit cached endpoints, so Cancel stays usable.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  signal.throwIfAborted();
  return writer.finish();
}
