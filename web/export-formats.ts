import { exportEncoding, type ExportSettings } from "./export-quality";
import { avcCodec, videoBitrate } from "./mp4-video";

export type ExportFormat = "webp" | "mp4";
// "size": the browser encodes this format, but not at the chosen settings.
export type Availability = "yes" | "size" | "no";
export type Formats = Record<ExportFormat, Availability>;

// MP4 at 60 is hard to tell from 95 at a fraction of the size; lossy WebP
// needs more to look clean.
export const defaultQuality: Record<ExportFormat, number> = {
  mp4: 60,
  webp: 85,
};

export const formatText: Record<
  ExportFormat,
  { name: string; short: string; option: string; extension: string }
> = {
  webp: {
    name: "animated WebP",
    short: "WebP",
    option: "Animated WebP · can loop",
    extension: "webp",
  },
  mp4: {
    name: "MP4 video",
    short: "MP4",
    option: "MP4 video · small files, plays anywhere",
    extension: "mp4",
  },
};

export function videoConfig(
  encoding: ReturnType<typeof exportEncoding>,
  fps: number,
): VideoEncoderConfig {
  const bitrate = videoBitrate(encoding, fps);
  const { width, height } = encoding;
  return {
    codec: avcCodec(width, height, fps, bitrate),
    width,
    height,
    bitrate,
    framerate: fps,
    bitrateMode: "variable",
    latencyMode: "quality",
    avc: { format: "avc" },
  };
}

let webp: boolean | undefined;
// Safari returns PNG for unsupported canvas types instead of failing.
function canvasWebP() {
  if (webp === undefined) {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      webp = canvas.toDataURL("image/webp").startsWith("data:image/webp");
    } catch {
      webp = false;
    }
  }
  return webp;
}

async function encodes(settings: ExportSettings, fps: number) {
  try {
    const config = videoConfig(exportEncoding(settings), fps);
    return (await VideoEncoder.isConfigSupported(config)).supported === true;
  } catch {
    return false;
  }
}

export async function detectFormats(
  settings: ExportSettings,
  fps: number,
): Promise<Formats> {
  let mp4: Availability = "no";
  if (typeof VideoEncoder !== "undefined") {
    if (await encodes(settings, fps)) mp4 = "yes";
    else if (await encodes({ scale: 0.5, quality: 1 }, 15)) mp4 = "size";
  }
  return { webp: canvasWebP() ? "yes" : "no", mp4 };
}
