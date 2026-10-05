import { inflateSync } from "node:zlib";

// A decoder for the PNGs browsers write (8-bit grey, RGB or RGBA, not
// interlaced, not paletted), independent of the browser that wrote them.
// Pixels come back as straight (not premultiplied) RGBA.
export function decodePng(bytes: Buffer) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((b, i) => bytes[i] === b)) throw new Error("not a PNG");
  let width = 0,
    height = 0,
    type = -1;
  const data: Buffer[] = [];
  for (let at = 8; at < bytes.length;) {
    const length = bytes.readUInt32BE(at),
      name = bytes.toString("ascii", at + 4, at + 8),
      body = bytes.subarray(at + 8, at + 8 + length);
    if (name === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      type = body[9];
      if (body[8] !== 8) throw new Error(`bit depth ${body[8]}`);
      if (body[12] !== 0) throw new Error("interlaced");
    } else if (name === "IDAT") data.push(body);
    else if (name === "IEND") break;
    at += 12 + length;
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[type];
  if (!channels) throw new Error(`color type ${type}`);
  const raw = inflateSync(Buffer.concat(data)),
    stride = width * channels,
    rows = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)],
      line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)),
      out = rows.subarray(y * stride, (y + 1) * stride),
      up = y ? rows.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[x - channels] : 0,
        b = up ? up[x] : 0,
        c = up && x >= channels ? up[x - channels] : 0;
      let p = line[x];
      if (filter === 1) p += a;
      else if (filter === 2) p += b;
      else if (filter === 3) p += (a + b) >> 1;
      else if (filter === 4) {
        const e = a + b - c,
          pa = Math.abs(e - a),
          pb = Math.abs(e - b),
          pc = Math.abs(e - c);
        p += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`filter ${filter}`);
      out[x] = p & 255;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = rows.subarray(i * channels, (i + 1) * channels);
    const [r, g, b, alpha] =
      channels === 1
        ? [s[0], s[0], s[0], 255]
        : channels === 2
          ? [s[0], s[0], s[0], s[1]]
          : channels === 3
            ? [s[0], s[1], s[2], 255]
            : [s[0], s[1], s[2], s[3]];
    rgba.set([r, g, b, alpha], i * 4);
  }
  return { width, height, alpha: channels === 2 || channels === 4, rgba };
}
