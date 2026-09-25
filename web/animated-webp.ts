// Full-frame muxer for opaque, browser-encoded WebP images. No image codec is
// bundled: canvas supplies each bitstream, and this module adds the animation.
// https://developers.google.com/speed/webp/docs/riff_container
const tag = (bytes: Uint8Array, offset: number) =>
  String.fromCharCode(...bytes.subarray(offset, offset + 4));
const u24 = (bytes: Uint8Array, offset: number, value: number) => {
  bytes[offset] = value;
  bytes[offset + 1] = value >>> 8;
  bytes[offset + 2] = value >>> 16;
};
function chunk(name: string, body: Blob): Blob {
  const header = new Uint8Array(8);
  header.set(new TextEncoder().encode(name));
  new DataView(header.buffer).setUint32(4, body.size, true);
  return new Blob([header, body, new Uint8Array(body.size % 2)]);
}

export function exportTiming(seconds: number, fps: number) {
  if (!Number.isFinite(seconds) || seconds < 0.1 || seconds > 3600)
    throw new Error("Duration must be between 0.1 and 3600 seconds.");
  if (fps !== 15 && fps !== 30)
    throw new Error("Choose 15 or 30 frames per second.");
  const count = Math.max(2, Math.ceil(seconds * fps));
  if (count > 7200)
    throw new Error(
      "Export is limited to 7,200 frames. Shorten the duration or choose 15 fps.",
    );
  const milliseconds = Math.round(seconds * 1000);
  return Array.from({ length: count }, (_, i) => ({
    progress: i / (count - 1),
    duration:
      Math.round(((i + 1) * milliseconds) / count) -
      Math.round((i * milliseconds) / count),
  }));
}

export class AnimatedWebP {
  private frames: Blob[] = [];
  private size = 44;
  private profile: Uint8Array<ArrayBuffer> | null = null;
  constructor(
    private width: number,
    private height: number,
    private loop: boolean,
  ) {
    if (
      ![width, height].every((n) => Number.isInteger(n) && n > 0 && n <= 16383)
    )
      throw new Error("Invalid WebP dimensions.");
  }
  async add(image: Blob, milliseconds: number) {
    if (image.type !== "image/webp")
      throw new Error(
        "This browser cannot encode WebP. Try a browser with canvas WebP export support.",
      );
    if (
      !Number.isInteger(milliseconds) ||
      milliseconds < 11 ||
      milliseconds > 0xffffff
    )
      throw new Error("Invalid WebP frame duration.");
    const bytes = new Uint8Array(await image.arrayBuffer());
    const view = new DataView(bytes.buffer);
    if (
      bytes.length < 20 ||
      tag(bytes, 0) !== "RIFF" ||
      tag(bytes, 8) !== "WEBP" ||
      view.getUint32(4, true) + 8 !== bytes.length
    )
      throw new Error("The browser returned an invalid WebP image.");
    const payload: Blob[] = [];
    let profile: Uint8Array<ArrayBuffer> | null = null;
    let bitstreams = 0;
    for (let offset = 12; offset < bytes.length;) {
      if (offset + 8 > bytes.length) throw new Error("Truncated WebP chunk.");
      const name = tag(bytes, offset);
      const size = view.getUint32(offset + 4, true);
      const end = offset + 8 + size + (size % 2);
      if (end > bytes.length) throw new Error("Truncated WebP image.");
      if (name === "VP8 " || name === "VP8L") {
        payload.push(image.slice(offset, end));
        bitstreams++;
      }
      if (name === "ICCP") profile = bytes.slice(offset, end);
      // Frames come from an opaque canvas. Preserve the browser's color profile
      // once at the container level, rather than changing its interpretation.
      if (
        name === "ALPH" ||
        name === "ANIM" ||
        (name === "VP8X" && (size < 10 || bytes[offset + 8] & 0x12))
      )
        throw new Error("Expected an opaque sRGB still WebP frame.");
      offset = end;
    }
    if (bitstreams !== 1) throw new Error("Expected one WebP image bitstream.");
    if (this.frames.length === 0) {
      this.profile = profile;
      this.size += profile?.length ?? 0;
    } else if (
      profile?.length !== this.profile?.length ||
      (profile && !profile.every((value, i) => value === this.profile![i]))
    ) {
      throw new Error("WebP frames have inconsistent color profiles.");
    }
    const header = new Uint8Array(16);
    u24(header, 6, this.width - 1);
    u24(header, 9, this.height - 1);
    u24(header, 12, milliseconds);
    header[15] = 2; // Full frame, overwrite without blending or disposal.
    const frame = chunk("ANMF", new Blob([header, ...payload]));
    this.size += frame.size;
    if (this.size > 256 * 1024 * 1024)
      throw new Error(
        "Export reached the 256 MiB limit. Reduce duration, frame rate, or construction lines.",
      );
    this.frames.push(frame);
  }
  finish(): Blob {
    if (this.frames.length < 2)
      throw new Error("An animation needs at least two frames.");
    const extended = new Uint8Array(10);
    extended[0] = 2 | (this.profile ? 0x20 : 0);
    u24(extended, 4, this.width - 1);
    u24(extended, 7, this.height - 1);
    const animation = new Uint8Array(6);
    animation[3] = 255;
    animation[4] = this.loop ? 0 : 1;
    const body = new Blob([
      "WEBP",
      chunk("VP8X", new Blob([extended])),
      ...(this.profile ? [this.profile] : []),
      chunk("ANIM", new Blob([animation])),
      ...this.frames,
    ]);
    const header = new Uint8Array(8);
    header.set(new TextEncoder().encode("RIFF"));
    new DataView(header.buffer).setUint32(4, body.size, true);
    return new Blob([header, body], { type: "image/webp" });
  }
}
