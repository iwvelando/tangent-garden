import { renderToStaticMarkup } from "react-dom/server";
import { Composition } from "./Composition";
import { EngineClient } from "../engine-client";
import { mp4Sink, webpSink } from "../export-sinks";
import {
  exportBaseSize,
  exportEncoding,
  exportTiming,
} from "../export-quality";
import type { MotionExport } from "./AnimationPanel";
import { cycles, progressAt, type Pace, type Repeat } from "../timing";
import {
  sample,
  type Config,
  type Motion,
  type View,
  type Layers,
} from "./types";
export async function exportMotion(
  o: MotionExport & {
    config: Config;
    motion: Motion;
    view: View;
    diagramView?: View;
    layers: Layers;
    dark: boolean;
    duration: number;
    repeat: Repeat;
    pace: Pace;
    signal: AbortSignal;
    onProgress: (n: number, total: number) => void;
  },
) {
  // A repeating animation leaves out its end, which is its start again,
  // and its WebP loops forever (../timing.ts).
  const timing = exportTiming(o.duration, o.fps, cycles(o.repeat)),
    encoding = exportEncoding(o.settings),
    size = exportBaseSize(o.settings.layout);
  const client = new EngineClient(),
    canvas = document.createElement("canvas");
  canvas.width = encoding.width;
  canvas.height = encoding.height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) {
    client.dispose();
    throw new Error("Canvas drawing is unavailable.");
  }
  let sink: ReturnType<typeof mp4Sink> | undefined;
  try {
    sink =
      o.format === "mp4"
        ? mp4Sink(encoding, o.fps)
        : webpSink(encoding, o.loop || cycles(o.repeat));
    for (let i = 0; i < timing.length; i++) {
      o.signal.throwIfAborted();
      const config = sample(
          o.config,
          o.motion,
          progressAt(timing[i].progress, o.repeat, o.pace),
        ),
        result = await client.tesseract(config);
      o.signal.throwIfAborted();
      const markup = renderToStaticMarkup(
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width={encoding.width}
          height={encoding.height}
          viewBox={`0 0 ${size.width} ${size.height}`}
        >
          <Composition
            {...o}
            layout={o.settings.layout}
            config={config}
            result={result}
          />
        </svg>,
      );
      const url = URL.createObjectURL(
        new Blob([markup], { type: "image/svg+xml" }),
      );
      try {
        const image = new Image();
        image.src = url;
        await image.decode();
        o.signal.throwIfAborted();
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      } finally {
        URL.revokeObjectURL(url);
      }
      await sink.add(canvas, timing[i].duration, i);
      o.signal.throwIfAborted();
      o.onProgress(i + 1, timing.length);
      await new Promise((r) => setTimeout(r, 0));
    }
    const blob = await sink.finish();
    o.signal.throwIfAborted();
    return blob;
  } finally {
    sink?.close();
    client.dispose();
  }
}
