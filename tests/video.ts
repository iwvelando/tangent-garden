import { test, type BrowserContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";

// ffprobe is an independent demuxer and decoder. CI installs it; local runs
// without it skip only the ffprobe assertions, and say so.
const available = (() => {
  try {
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

export type Probe = {
  codec: string;
  profile: string;
  // Frames that decode out of display order; the MP4 writer needs zero.
  bFrames: number;
  width: number;
  height: number;
  frames: number;
  // Presentation times and durations of each decoded frame, in milliseconds.
  times: number[];
  durations: number[];
  keyframes: number[];
};

export function probe(path: string): Probe | null {
  if (!available) {
    if (process.env.CI) throw new Error("ffprobe is required in CI.");
    test.info().annotations.push({
      type: "skipped check",
      description: "ffprobe is not installed; MP4 decoded only by Chromium.",
    });
    return null;
  }
  const json = JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-count_frames",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=codec_name,profile,width,height,nb_read_frames,has_b_frames:frame=pts_time,duration_time,key_frame",
        "-of",
        "json",
        path,
      ],
      { encoding: "utf8" },
    ),
  );
  const [stream] = json.streams;
  const ms = (s: string) => Math.round(Number(s) * 1000);
  return {
    codec: stream.codec_name,
    profile: stream.profile,
    bFrames: Number(stream.has_b_frames),
    width: stream.width,
    height: stream.height,
    frames: Number(stream.nb_read_frames),
    times: json.frames.map((f: any) => ms(f.pts_time)),
    durations: json.frames.map((f: any) => ms(f.duration_time)),
    keyframes: json.frames.flatMap((f: any, i: number) =>
      f.key_frame ? [i] : [],
    ),
  };
}

// Chromium's own demuxer and decoder, through an ordinary <video> element. The
// app never plays media, so its policy blocks blob: video; use a blank page.
export async function decodeVideo(app: Page, bytes: Buffer) {
  const page = await app.context().newPage();
  try {
    return await decode(page, bytes);
  } finally {
    await page.close();
  }
}
function decode(page: Page, bytes: Buffer) {
  return page.evaluate(async (input) => {
    const url = URL.createObjectURL(
      new Blob([new Uint8Array(input)], { type: "video/mp4" }),
    );
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    const event = (name: string) =>
      new Promise<void>((resolve, reject) => {
        video.addEventListener(name, () => resolve(), { once: true });
        video.addEventListener(
          "error",
          () => reject(new Error(`Video error ${video.error?.code}`)),
          { once: true },
        );
      });
    const loaded = event("loadeddata");
    video.src = url;
    await loaded;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const capture = () => {
      ctx.drawImage(video, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 0;
      for (let j = 0; j < pixels.length; j += 4)
        hash = (Math.imul(hash, 31) + (pixels[j] >> 3)) | 0;
      // The most common color is the background, wherever lines fall.
      const counts = new Map<number, number>();
      for (let j = 0; j < pixels.length; j += 4) {
        const key = (pixels[j] << 16) | (pixels[j + 1] << 8) | pixels[j + 2];
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const [common] = [...counts].reduce((a, b) => (b[1] > a[1] ? b : a));
      const background = [
        common >> 16,
        (common >> 8) & 255,
        common & 255,
        pixels[3],
      ];
      // Pixels clearly off the background: how much the frame draws, which
      // codec rounding moves only slightly, unlike its hash.
      let ink = 0;
      for (let j = 0; j < pixels.length; j += 4)
        if (
          Math.max(
            Math.abs(pixels[j] - background[0]),
            Math.abs(pixels[j + 1] - background[1]),
            Math.abs(pixels[j + 2] - background[2]),
          ) > 24
        )
          ink++;
      return { hash, background, ink };
    };
    // Neither "loadeddata" nor "seeked" means a frame can be drawn yet:
    // under load, Chromium on Linux drew nothing for the first frame (every
    // channel zero) and the previous frame after a seek. Seek, wait until
    // that frame is presented, then capture. Two orderings present nothing
    // after a seek (#334). A seek to the frame already shown presents no new
    // frame, and WebKit may show the first frame before "loadeddata" is
    // handled. And WebKit drops a seek made before it has presented the
    // first frame: it presents the first frame instead, once, and keeps
    // showing it. So first seek to the middle and accept whatever is
    // presented, then to the last frame and back to the first: each of those
    // changes the frame shown, and only a frame from the seek's half of the
    // file counts. That needs at least three frames (the shortest export
    // here has three). The seek to the end lands inside the last frame
    // rather than at the very end of the file.
    const at = async (time: number, shows: (t: number) => boolean) => {
      const presented = new Promise<void>((resolve) => {
        const next = () =>
          video.requestVideoFrameCallback((_, frame) =>
            shows(frame.mediaTime) ? resolve() : next(),
          );
        next();
      });
      const seeked = event("seeked");
      video.currentTime = time;
      await Promise.all([seeked, presented]);
    };
    const half = video.duration / 2;
    await at(half, () => true);
    await at(Math.max(0, video.duration - 0.005), (t) => t > half);
    const last = capture();
    await at(0, (t) => t < half);
    const first = capture();
    URL.revokeObjectURL(url);
    return {
      duration: video.duration,
      width: video.videoWidth,
      height: video.videoHeight,
      first,
      last,
    };
  }, Array.from(bytes));
}

// The ordering behind CI's decoder hangs (#334), made certain: every video
// a later page of this context loads has presented its first frame and
// settled at time 0 before its "loadeddata" listeners run. WebKit presents
// the first frame on its own, sometimes before that event is handled; in
// Chromium a seek shows it, after which a seek to the time already shown
// presents nothing. A test decodes once without this and once with it, and
// expects the same result.
export async function presentFirstFrameEarly(context: BrowserContext) {
  await context.addInitScript(() => {
    const add = HTMLMediaElement.prototype.addEventListener;
    HTMLMediaElement.prototype.addEventListener = function (
      this: HTMLVideoElement,
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (type !== "loadeddata") return add.call(this, type, listener, options);
      const video = this;
      add.call(
        video,
        type,
        async (event: Event) => {
          // The decoder's own order, so that no seek here waits on a frame
          // that is never presented: the first seek may present only the
          // first frame, and each later one changes the frame shown.
          const seek = (time: number, shows: (t: number) => boolean) => {
            const presented = new Promise<void>((resolve) => {
              const next = () =>
                video.requestVideoFrameCallback((_, frame) =>
                  shows(frame.mediaTime) ? resolve() : next(),
                );
              next();
            });
            const seeked = new Promise<void>((resolve) =>
              add.call(video, "seeked", () => resolve(), { once: true }),
            );
            video.currentTime = time;
            return Promise.all([presented, seeked]);
          };
          const half = video.duration / 2;
          await seek(half, () => true);
          await seek(video.duration - 0.005, (t) => t > half);
          await seek(0, (t) => t === 0);
          if (typeof listener === "function") listener.call(video, event);
          else listener.handleEvent(event);
        },
        options,
      );
    } as typeof HTMLMediaElement.prototype.addEventListener;
  });
}

// Decode every actual frame independently; allow codec color rounding rather
// than requiring lossy H.264 endpoint hashes to match an intra-coded frame.
export function frameCoverage(
  path: string,
  width: number,
  height: number,
): number[] | null {
  if (!available) return null;
  const bytes = execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 32 * 1024 * 1024 },
  );
  const size = width * height * 3;
  if (bytes.length % size !== 0)
    throw new Error(
      "Decoded frame dimensions differ from expected export dimensions",
    );
  const coverage: number[] = [];
  for (let from = 0; from < bytes.length; from += size) {
    const bg = [bytes[from], bytes[from + 1], bytes[from + 2]];
    let ink = 0;
    for (let i = from; i < from + size; i += 3)
      if (
        Math.abs(bytes[i] - bg[0]) +
          Math.abs(bytes[i + 1] - bg[1]) +
          Math.abs(bytes[i + 2] - bg[2]) >
        30
      )
        ink++;
    coverage.push(ink / (width * height));
  }
  return coverage;
}

export function frameDifference(
  path: string,
  width: number,
  height: number,
  index: number,
  reference: ArrayLike<number>,
): { meanDifference: number; unmatchedInk: number } | null {
  if (!available) return null;
  const pixels = execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      path,
      "-vf",
      `select=eq(n\\,${index})`,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-",
    ],
    { maxBuffer: width * height * 3 + 1024 },
  );
  if (pixels.length !== width * height * 3)
    throw new Error("Frame parity dimensions differ");
  return pixelDifference(pixels, 3, width, height, reference);
}

// The same parity for a frame already decoded, such as an animated WebP
// frame from Chromium's ImageDecoder (ffmpeg before 8 cannot decode those).
// `stride` is 3 for RGB, 4 for RGBA; the reference is the RGBA drawing.
export function pixelDifference(
  pixels: ArrayLike<number>,
  stride: number,
  width: number,
  height: number,
  reference: ArrayLike<number>,
): { meanDifference: number; unmatchedInk: number } {
  if (
    pixels.length !== width * height * stride ||
    reference.length !== width * height * 4
  )
    throw new Error("Frame parity dimensions differ");
  let difference = 0;
  for (let i = 0; i < width * height; i++)
    for (let channel = 0; channel < 3; channel++)
      difference += Math.abs(
        pixels[i * stride + channel] - reference[i * 4 + channel],
      );
  const mask = (data: ArrayLike<number>, stride: number, threshold: number) => {
    const out = new Uint8Array(width * height);
    for (let i = 0; i < out.length; i++) {
      let contrast = 0;
      for (let c = 0; c < 3; c++)
        contrast += Math.abs(data[i * stride + c] - data[c]);
      out[i] = Number(contrast > threshold);
    }
    return out;
  };
  const weakActual = mask(pixels, stride, 30),
    strongActual = mask(pixels, stride, 90),
    weakReference = mask(reference, 4, 30),
    strongReference = mask(reference, 4, 90);
  const unmatched = (strong: Uint8Array, weak: Uint8Array) => {
    let total = 0,
      missed = 0;
    for (let i = 0; i < strong.length; i++)
      if (strong[i]) {
        total++;
        const x = i % width,
          y = Math.floor(i / width);
        let found = false;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++)
            if (
              x + dx >= 0 &&
              x + dx < width &&
              y + dy >= 0 &&
              y + dy < height &&
              weak[(y + dy) * width + x + dx]
            )
              found = true;
        if (!found) missed++;
      }
    return total ? missed / total : 1;
  };
  return {
    meanDifference: difference / (width * height * 3),
    unmatchedInk: Math.max(
      unmatched(strongActual, weakReference),
      unmatched(strongReference, weakActual),
    ),
  };
}
