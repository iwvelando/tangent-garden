import { test, type Page } from "@playwright/test";
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
        "stream=codec_name,profile,width,height,nb_read_frames:frame=pts_time,duration_time,key_frame",
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
      // The most common colour is the background, wherever lines fall.
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
      return { hash, background };
    };
    const first = capture();
    const seeked = event("seeked");
    video.currentTime = video.duration;
    await seeked;
    const last = capture();
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
