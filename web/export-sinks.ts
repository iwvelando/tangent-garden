import { AnimatedWebP } from "./animated-webp";
import { exportEncoding } from "./export-quality";
import { videoConfig } from "./export-formats";
import { Mp4Writer, sameFrameTime } from "./mp4-video";
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
export function webpSink(encoding: Encoding, loop: boolean): Sink {
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
export function mp4Sink(encoding: Encoding, fps: number): Sink {
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
