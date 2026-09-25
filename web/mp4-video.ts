// Video-only MP4 muxer for browser-encoded H.264. No video codec is bundled:
// WebCodecs supplies each access unit, and this module adds the container.
// ISO/IEC 14496-12 (ISO base media file format) and 14496-15 (AVC storage).
import { frameRates } from "./export-quality";

// Constrained Baseline cannot contain B-frames, so decode order is display
// order and no composition offsets (ctts) are needed from any encoder.
const profile = "42E0";
// [level_idc, max frame size in macroblocks, max macroblocks/s, max kbit/s]
// from ITU-T H.264 Table A-1. Level 3.1 is the floor; lower levels gain nothing.
const levels = [
  [31, 3600, 108000, 14000],
  [32, 5120, 216000, 20000],
  [40, 8192, 245760, 20000],
  [41, 8192, 245760, 50000],
  [42, 8704, 522240, 50000],
  [50, 22080, 589824, 135000],
  [51, 36864, 983040, 240000],
] as const;

export function avcCodec(
  width: number,
  height: number,
  fps: number,
  bitrate: number,
): string {
  if (![width, height].every((n) => Number.isInteger(n) && n > 0))
    throw new Error("Invalid video dimensions.");
  if (width % 2 || height % 2)
    throw new Error("Video dimensions must be even.");
  const frame = Math.ceil(width / 16) * Math.ceil(height / 16);
  const level = levels.find(
    ([, size, rate, kbps]) =>
      frame <= size &&
      // Neither dimension may exceed sqrt(8 × max frame size) macroblocks.
      Math.max(width, height) / 16 <= Math.sqrt(8 * size) &&
      frame * fps <= rate &&
      bitrate <= kbps * 1000,
  );
  if (!level)
    throw new Error("This video is too large for H.264. Lower the resolution.");
  return `avc1.${profile}${level[0].toString(16).toUpperCase().padStart(2, "0")}`;
}

// Quality maps exponentially onto bits per pixel, from 0.02 to 0.4. Line art on
// a flat background compresses well, so variable-rate output is usually smaller.
export function videoBitrate(
  encoding: { width: number; height: number; compression: number },
  fps: number,
): number {
  if (!frameRates.includes(fps))
    throw new Error("Choose 15, 30, or 60 frames per second.");
  const quality = encoding.compression * 100;
  const bitsPerPixel = 0.02 * 20 ** ((quality - 1) / 99);
  return Math.round(encoding.width * encoding.height * fps * bitsPerPixel);
}

const ascii = (text: string) => new TextEncoder().encode(text);
function box(type: string, ...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const size = 8 + parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, size);
  out.set(ascii(type), 4);
  let offset = 8;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
// Big-endian fields: [value, byte width].
function fields(...values: [number, 1 | 2 | 4][]): Uint8Array {
  const out = new Uint8Array(values.reduce((sum, [, w]) => sum + w, 0));
  const view = new DataView(out.buffer);
  let offset = 0;
  for (const [value, width] of values) {
    if (width === 1) view.setUint8(offset, value);
    else if (width === 2) view.setUint16(offset, value);
    else view.setUint32(offset, value);
    offset += width;
  }
  return out;
}
const full = (type: string, flags: number, ...parts: Uint8Array[]) =>
  box(type, fields([flags, 4]), ...parts);
const unity = fields(
  [0x10000, 4],
  [0, 4],
  [0, 4],
  [0, 4],
  [0x10000, 4],
  [0, 4],
  [0, 4],
  [0, 4],
  [0x40000000, 4],
);

// ISO/IEC 23091-2 code points for the colour spaces WebCodecs reports.
const primaries: Record<string, number> = {
  bt709: 1,
  bt470bg: 5,
  smpte170m: 6,
  bt2020: 9,
  smpte432: 12,
};
const transfers: Record<string, number> = {
  bt709: 1,
  smpte170m: 6,
  linear: 8,
  "iec61966-2-1": 13,
  pq: 16,
  hlg: 18,
};
const matrices: Record<string, number> = {
  rgb: 0,
  bt709: 1,
  bt470bg: 5,
  smpte170m: 6,
  "bt2020-ncl": 9,
};
export type ColorSpace = {
  primaries?: string | null;
  transfer?: string | null;
  matrix?: string | null;
  fullRange?: boolean | null;
};

export class Mp4Writer {
  private samples: Uint8Array[] = [];
  private durations: number[] = [];
  private keys: number[] = [];
  private size = 0;
  private config: Uint8Array | null = null;
  private colr: Uint8Array | null = null;
  constructor(
    private width: number,
    private height: number,
  ) {
    if (
      ![width, height].every(
        (n) => Number.isInteger(n) && n > 0 && n <= 0xffff && n % 2 === 0,
      )
    )
      throw new Error("Invalid MP4 dimensions.");
  }
  // `description` is the AVCDecoderConfigurationRecord from the encoder.
  configure(description: Uint8Array, color?: ColorSpace) {
    if (description.length < 7 || description[0] !== 1)
      throw new Error("The browser returned an invalid H.264 configuration.");
    this.config = description.slice();
    const p = primaries[color?.primaries ?? ""];
    const t = transfers[color?.transfer ?? ""];
    const m = matrices[color?.matrix ?? ""];
    // Unspecified is better than a guess; players then use their defaults.
    this.colr =
      p !== undefined && t !== undefined && m !== undefined
        ? box(
            "colr",
            ascii("nclx"),
            fields([p, 2], [t, 2], [m, 2], [color?.fullRange ? 0x80 : 0, 1]),
          )
        : null;
  }
  add(data: Uint8Array, milliseconds: number, key: boolean) {
    if (!this.config) throw new Error("The video encoder was not configured.");
    if (this.samples.length === 0 && !key)
      throw new Error("A video must start with a keyframe.");
    if (
      !Number.isInteger(milliseconds) ||
      milliseconds < 1 ||
      milliseconds > 0xffffffff
    )
      throw new Error("Invalid video frame duration.");
    if (data.length === 0)
      throw new Error("The browser returned an empty video frame.");
    if (this.size + data.length > 256 * 1024 * 1024)
      throw new Error(
        "Export reached the 256 MiB limit. Reduce duration, frame rate, or quality.",
      );
    this.size += data.length;
    this.samples.push(data);
    this.durations.push(milliseconds);
    if (key) this.keys.push(this.samples.length);
  }
  finish(): Blob {
    if (this.samples.length < 2)
      throw new Error("An animation needs at least two frames.");
    const total = this.durations.reduce((sum, d) => sum + d, 0);
    const ftyp = box(
      "ftyp",
      ascii("isom"),
      fields([0x200, 4]),
      ascii("isomiso2avc1mp41"),
    );
    // Offsets are fixed-width, so the index size is known before placing mdat.
    const moov = (offset: number) => this.moov(total, offset);
    const offset = ftyp.length + moov(0).length + 8;
    const mdat = new Uint8Array(8);
    new DataView(mdat.buffer).setUint32(0, 8 + this.size);
    mdat.set(ascii("mdat"), 4);
    return new Blob(
      [ftyp, moov(offset), mdat, ...(this.samples as BlobPart[])],
      {
        type: "video/mp4",
      },
    );
  }
  private moov(total: number, offset: number) {
    const { width, height } = this;
    const count = this.samples.length;
    const runs: [number, number][] = [];
    for (const d of this.durations) {
      const last = runs.at(-1);
      if (last && last[1] === d) last[0]++;
      else runs.push([1, d]);
    }
    const entry = box(
      "avc1",
      fields([0, 4], [0, 2], [1, 2]), // reserved, data_reference_index
      new Uint8Array(16), // pre_defined and reserved
      fields(
        [width, 2],
        [height, 2],
        [0x480000, 4],
        [0x480000, 4],
        [0, 4],
        [1, 2],
      ),
      new Uint8Array(32), // compressorname
      fields([0x18, 2], [0xffff, 2]),
      box("avcC", this.config!),
      ...(this.colr ? [this.colr] : []),
    );
    const stbl = box(
      "stbl",
      full("stsd", 0, fields([1, 4]), entry),
      full(
        "stts",
        0,
        fields(
          [runs.length, 4],
          ...runs.flatMap(
            ([n, d]) =>
              [
                [n, 4],
                [d, 4],
              ] as [number, 4][],
          ),
        ),
      ),
      full(
        "stss",
        0,
        fields(
          [this.keys.length, 4],
          ...this.keys.map((k) => [k, 4] as [number, 4]),
        ),
      ),
      full("stsc", 0, fields([1, 4], [1, 4], [count, 4], [1, 4])),
      full(
        "stsz",
        0,
        fields(
          [0, 4],
          [count, 4],
          ...this.samples.map((s) => [s.length, 4] as [number, 4]),
        ),
      ),
      full("stco", 0, fields([1, 4], [offset, 4])),
    );
    const minf = box(
      "minf",
      full("vmhd", 1, new Uint8Array(8)),
      box("dinf", full("dref", 0, fields([1, 4]), full("url ", 1))),
      stbl,
    );
    const mdia = box(
      "mdia",
      full(
        "mdhd",
        0,
        fields([0, 4], [0, 4], [1000, 4], [total, 4], [0x55c4, 2], [0, 2]),
      ),
      full(
        "hdlr",
        0,
        fields([0, 4]),
        ascii("vide"),
        new Uint8Array(12),
        ascii("VideoHandler\0"),
      ),
      minf,
    );
    const trak = box(
      "trak",
      full(
        "tkhd",
        3, // enabled, in movie
        fields([0, 4], [0, 4], [1, 4], [0, 4], [total, 4], [0, 4], [0, 4]),
        fields([0, 2], [0, 2], [0, 2], [0, 2]),
        unity,
        fields([width * 0x10000, 4], [height * 0x10000, 4]),
      ),
      mdia,
    );
    return box(
      "moov",
      full(
        "mvhd",
        0,
        fields([0, 4], [0, 4], [1000, 4], [total, 4], [0x10000, 4], [0x100, 2]),
        new Uint8Array(10),
        unity,
        new Uint8Array(24),
        fields([2, 4]),
      ),
      trak,
    );
  }
}
