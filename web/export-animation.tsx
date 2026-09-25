import { renderToStaticMarkup } from "react-dom/server";
import { Plot, type Layers } from "./Plot";
import type { AnimationView } from "./animation";
import { AnimatedWebP } from "./animated-webp";
import {
  exportEncoding,
  exportTiming,
  type ExportSettings,
} from "./export-quality";
import { videoConfig, type ExportFormat } from "./export-formats";
import { Mp4Writer, sameFrameTime } from "./mp4-video";
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

type Encoding = ReturnType<typeof exportEncoding>;
type Sink = {
  add(
    canvas: HTMLCanvasElement,
    milliseconds: number,
    index: number,
  ): Promise<void>;
  finish(): Promise<Blob>;
  close(): void;
};

// Canvas supplies each still WebP; animated-webp.ts adds the animation.
function webpSink(encoding: Encoding, loop: boolean): Sink {
  const writer = new AnimatedWebP(encoding.width, encoding.height, loop);
  return {
    async add(canvas, milliseconds) {
      const image = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) =>
            blob ? resolve(blob) : reject(new Error("WebP encoding failed.")),
          "image/webp",
          encoding.compression,
        );
      });
      await writer.add(image, milliseconds);
    },
    finish: async () => writer.finish(),
    close() {},
  };
}

const videoError = (error: unknown) =>
  new Error(
    `This browser couldn't save the MP4 video (${
      error instanceof Error ? error.message : String(error)
    }).`,
  );
const bytes = (source: AllowSharedBufferSource) =>
  ArrayBuffer.isView(source)
    ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
    : new Uint8Array(source);

// WebCodecs H.264; mp4-video.ts adds the container. Frames carry exact
// millisecond timestamps, so the saved duration never depends on render speed.
function mp4Sink(encoding: Encoding, fps: number): Sink {
  const writer = new Mp4Writer(encoding.width, encoding.height);
  // Baseline H.264 outputs frames in input order; a dropped or reordered frame
  // is refused. Durations come from this list, not from the encoder.
  const expected: { timestamp: number; milliseconds: number }[] = [];
  let description: Uint8Array | null = null;
  let failure: Error | null = null;
  let elapsed = 0;
  const encoder = new VideoEncoder({
    output(chunk, metadata) {
      if (failure) return;
      try {
        const config = metadata?.decoderConfig;
        if (config?.description) {
          const next = bytes(config.description);
          if (!description) writer.configure(next, config.colorSpace);
          else if (
            next.length !== description.length ||
            next.some((value, i) => value !== description![i])
          )
            throw new Error("the encoder changed its configuration");
          description = next.slice();
        }
        const frame = expected.shift();
        if (!frame || !sameFrameTime(frame.timestamp, chunk.timestamp))
          throw new Error("the encoder dropped or reordered frames");
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        writer.add(data, frame.milliseconds, chunk.type === "key");
      } catch (error) {
        failure =
          error instanceof Error && error.message.startsWith("Export reached")
            ? error
            : videoError(error);
      }
    },
    error(error) {
      failure ??= videoError(error);
    },
  });
  try {
    encoder.configure(videoConfig(encoding, fps));
  } catch (error) {
    encoder.close();
    throw videoError(error);
  }
  return {
    async add(canvas, milliseconds, index) {
      if (failure) throw failure;
      // Bound the encoder backlog; only compressed output may accumulate.
      while (encoder.encodeQueueSize > 2 && !failure)
        await new Promise((resolve) => setTimeout(resolve, 5));
      if (failure) throw failure;
      const timestamp = elapsed * 1000;
      const frame = new VideoFrame(canvas, {
        timestamp,
        duration: milliseconds * 1000,
      });
      try {
        expected.push({ timestamp, milliseconds });
        // Keyframes every two seconds keep seeking in video players quick.
        encoder.encode(frame, { keyFrame: index % (2 * fps) === 0 });
      } catch (error) {
        throw videoError(error);
      } finally {
        frame.close();
      }
      elapsed += milliseconds;
    },
    async finish() {
      if (failure) throw failure;
      try {
        await encoder.flush();
      } catch (error) {
        throw failure ?? videoError(error);
      }
      if (failure) throw failure;
      return writer.finish();
    },
    close() {
      if (encoder.state !== "closed") encoder.close();
    },
  };
}
