import { test, expect } from "@playwright/test";
import { Mp4Writer, avcCodec, videoBitrate } from "../web/mp4-video";
import { exportEncoding } from "../web/export-quality";

type Box = { type: string; body: Buffer; start: number };
// Nested boxes that hold only other boxes; stsd and sample entries are handled
// explicitly because they carry fields before their children.
const containers = new Set(["moov", "trak", "mdia", "minf", "dinf", "stbl"]);
function boxes(bytes: Buffer, base = 0): Box[] {
  const out: Box[] = [];
  for (let offset = 0; offset < bytes.length;) {
    const size = bytes.readUInt32BE(offset);
    expect(size).toBeGreaterThanOrEqual(8);
    expect(offset + size).toBeLessThanOrEqual(bytes.length);
    out.push({
      type: bytes.toString("ascii", offset + 4, offset + 8),
      body: bytes.subarray(offset + 8, offset + size),
      start: base + offset,
    });
    offset += size;
  }
  return out;
}
function find(bytes: Buffer, path: string[]): Box {
  let list = boxes(bytes);
  let found: Box | undefined;
  for (const [i, type] of path.entries()) {
    found = list.find((b) => b.type === type);
    if (!found) throw new Error(`Missing ${path.slice(0, i + 1).join("/")}`);
    if (containers.has(type)) list = boxes(found.body, found.start + 8);
    else if (type === "stsd") list = boxes(found.body.subarray(8));
    else if (type === "avc1") list = boxes(found.body.subarray(78));
  }
  return found!;
}
const table = (box: Box, entrySize: number) => {
  const count = box.body.readUInt32BE(4);
  expect(box.body.length).toBe(8 + count * entrySize);
  return Array.from({ length: count }, (_, i) =>
    box.body.subarray(8 + i * entrySize),
  );
};
const description = new Uint8Array([1, 0x42, 0xe0, 0x1f, 0xff, 0xe1, 0, 0]);

test("H.264 level is the smallest that fits frame size, macroblock rate, and bitrate", () => {
  expect(avcCodec(500, 380, 30, 2e6)).toBe("avc1.42E01F");
  expect(avcCodec(1000, 760, 30, 8e6)).toBe("avc1.42E01F");
  // 94 × 72 macroblocks exceed level 3.1 and 3.2 frame sizes.
  expect(avcCodec(1500, 1140, 15, 8e6)).toBe("avc1.42E028");
  expect(avcCodec(1500, 1140, 30, 30e6)).toBe("avc1.42E029");
  expect(avcCodec(2000, 1520, 30, 30e6)).toBe("avc1.42E032");
  // 60 fps doubles the macroblock rate.
  expect(avcCodec(1000, 760, 60, 8e6)).toBe("avc1.42E020");
  expect(avcCodec(2000, 1520, 60, 73e6)).toBe("avc1.42E033");
  // Bitrate alone can raise the level.
  expect(avcCodec(1000, 760, 30, 15e6)).toBe("avc1.42E020");
  expect(() => avcCodec(1001, 760, 30, 8e6)).toThrow("even");
  expect(() => avcCodec(0, 760, 30, 8e6)).toThrow();
  expect(() => avcCodec(8192, 8192, 30, 8e6)).toThrow("too large");
  expect(() => avcCodec(1000, 760, 30, 300e6)).toThrow("too large");
});

test("video bitrate follows quality, pixels, and frame rate within level limits", () => {
  const at = (scale: number, quality: number, fps = 30) =>
    videoBitrate(exportEncoding({ scale, quality }), fps);
  let previous = 0;
  for (let quality = 1; quality <= 100; quality++) {
    const bitrate = at(1, quality);
    expect(Number.isInteger(bitrate)).toBe(true);
    expect(bitrate).toBeGreaterThan(previous);
    previous = bitrate;
  }
  expect(at(1, 95, 15)).toBeCloseTo(at(1, 95, 30) / 2, -1);
  expect(at(1, 95, 60)).toBeCloseTo(at(1, 95, 30) * 2, -1);
  expect(at(2, 95)).toBeCloseTo(at(1, 95) * 4, -2);
  for (const scale of [0.5, 1, 1.5, 2])
    for (const fps of [15, 30, 60]) {
      const encoding = exportEncoding({ scale, quality: 100 });
      expect(() =>
        avcCodec(encoding.width, encoding.height, fps, at(scale, 100, fps)),
      ).not.toThrow();
    }
  expect(() =>
    videoBitrate(exportEncoding({ scale: 1, quality: 95 }), 90),
  ).toThrow("15, 30, or 60");
});

test("MP4 writer validates its input", async () => {
  expect(() => new Mp4Writer(1001, 760)).toThrow("dimensions");
  expect(() => new Mp4Writer(0, 760)).toThrow("dimensions");
  const writer = new Mp4Writer(1000, 760);
  expect(() => writer.add(new Uint8Array(4), 33, true)).toThrow("configured");
  expect(() => writer.configure(new Uint8Array([0]))).toThrow("configuration");
  writer.configure(description);
  expect(() => writer.add(new Uint8Array(4), 33, false)).toThrow("keyframe");
  for (const duration of [0, -1, 1.5, NaN, 2 ** 32])
    expect(() => writer.add(new Uint8Array(4), duration, true)).toThrow(
      "duration",
    );
  expect(() => writer.add(new Uint8Array(0), 33, true)).toThrow("empty");
  writer.add(new Uint8Array(4), 33, true);
  expect(() => writer.finish()).toThrow("at least two");
  const big = new Mp4Writer(1000, 760);
  big.configure(description);
  const sample = new Uint8Array(64 * 1024 * 1024);
  big.add(sample, 33, true);
  big.add(sample, 33, false);
  big.add(sample, 33, false);
  big.add(sample, 33, false); // Exactly 256 MiB of samples is allowed.
  expect(() => big.add(new Uint8Array(1), 33, false)).toThrow("256 MiB");
});

test("MP4 writer puts the index first and records exact sample timing", async () => {
  const writer = new Mp4Writer(1000, 760);
  writer.configure(description, {
    primaries: "bt709",
    transfer: "bt709",
    matrix: "bt709",
    fullRange: false,
  });
  const samples = [
    [new Uint8Array([1, 2, 3, 4, 5]), 67, true],
    [new Uint8Array([6, 7]), 67, false],
    [new Uint8Array([8, 9, 10]), 66, false],
    [new Uint8Array([11]), 67, true],
    [new Uint8Array([12, 13, 14, 15]), 67, false],
    [new Uint8Array([16, 17]), 66, false],
  ] as const;
  for (const [data, duration, key] of samples) writer.add(data, duration, key);
  const blob = writer.finish();
  expect(blob.type).toBe("video/mp4");
  const bytes = Buffer.from(await blob.arrayBuffer());
  const top = boxes(bytes);
  expect(top.map((b) => b.type)).toEqual(["ftyp", "moov", "mdat"]);
  expect(top[0].body.toString("ascii", 0, 4)).toBe("isom");

  const mvhd = find(bytes, ["moov", "mvhd"]).body;
  expect(mvhd.readUInt32BE(12)).toBe(1000);
  expect(mvhd.readUInt32BE(16)).toBe(400);
  const tkhd = find(bytes, ["moov", "trak", "tkhd"]).body;
  expect(tkhd.readUInt32BE(20)).toBe(400);
  expect(tkhd.readUInt32BE(76)).toBe(1000 * 65536);
  expect(tkhd.readUInt32BE(80)).toBe(760 * 65536);
  const mdhd = find(bytes, ["moov", "trak", "mdia", "mdhd"]).body;
  expect(mdhd.readUInt32BE(12)).toBe(1000);
  expect(mdhd.readUInt32BE(16)).toBe(400);
  expect(
    find(bytes, ["moov", "trak", "mdia", "hdlr"]).body.toString("ascii", 8, 12),
  ).toBe("vide");

  const stbl = ["moov", "trak", "mdia", "minf", "stbl"];
  const avc1 = find(bytes, [...stbl, "stsd", "avc1"]).body;
  expect(avc1.readUInt16BE(24)).toBe(1000);
  expect(avc1.readUInt16BE(26)).toBe(760);
  expect([...find(bytes, [...stbl, "stsd", "avc1", "avcC"]).body]).toEqual([
    ...description,
  ]);
  const colr = find(bytes, [...stbl, "stsd", "avc1", "colr"]).body;
  expect(colr.toString("ascii", 0, 4)).toBe("nclx");
  expect([
    colr.readUInt16BE(4),
    colr.readUInt16BE(6),
    colr.readUInt16BE(8),
  ]).toEqual([1, 1, 1]);
  expect(colr[10]).toBe(0);

  const durations = table(find(bytes, [...stbl, "stts"]), 8).flatMap((entry) =>
    Array(entry.readUInt32BE(0)).fill(entry.readUInt32BE(4)),
  );
  expect(durations).toEqual(samples.map((s) => s[1]));
  expect(
    table(find(bytes, [...stbl, "stss"]), 4).map((e) => e.readUInt32BE(0)),
  ).toEqual([1, 4]);
  expect(
    table(find(bytes, [...stbl, "stsc"]), 12).map((e) => [
      e.readUInt32BE(0),
      e.readUInt32BE(4),
      e.readUInt32BE(8),
    ]),
  ).toEqual([[1, 6, 1]]);
  const stsz = find(bytes, [...stbl, "stsz"]).body;
  expect(stsz.readUInt32BE(4)).toBe(0);
  expect(stsz.readUInt32BE(8)).toBe(6);
  expect(
    Array.from({ length: 6 }, (_, i) => stsz.readUInt32BE(12 + i * 4)),
  ).toEqual(samples.map((s) => s[0].length));
  const [offset] = table(find(bytes, [...stbl, "stco"]), 4).map((e) =>
    e.readUInt32BE(0),
  );
  expect(offset).toBe(top[2].start + 8);
  expect([...bytes.subarray(offset)]).toEqual(
    samples.flatMap((s) => [...s[0]]),
  );
});

test("MP4 writer omits colour information it cannot describe exactly", async () => {
  const writer = new Mp4Writer(500, 380);
  writer.configure(description, { primaries: "bt709", matrix: "bt709" });
  writer.add(new Uint8Array([1]), 50, true);
  writer.add(new Uint8Array([2]), 50, false);
  const bytes = Buffer.from(await writer.finish().arrayBuffer());
  const entry = find(bytes, [
    "moov",
    "trak",
    "mdia",
    "minf",
    "stbl",
    "stsd",
    "avc1",
  ]);
  expect(boxes(entry.body.subarray(78)).map((b) => b.type)).toEqual(["avcC"]);
});
