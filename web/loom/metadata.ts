// Export-only annotations. Geometry remains vector in SVG; these chunks do
// not change encoded pixels, frame tables, byte offsets or playback timing.
const utf8 = (s: string) => new TextEncoder().encode(s);
function header(name: string, length: number, little = false) {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setUint32(little ? 4 : 0, length, little);
  b.set(utf8(name), little ? 0 : 4);
  return b;
}
function pngChunk(name: string, body: Uint8Array<ArrayBuffer>) {
  const data = new Uint8Array(4 + body.length);
  data.set(utf8(name));
  data.set(body, 4);
  let crc = 0xffffffff;
  for (const x of data) {
    crc ^= x;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const end = new Uint8Array(4);
  new DataView(end.buffer).setUint32(0, (crc ^ 0xffffffff) >>> 0);
  const start = new Uint8Array(4);
  new DataView(start.buffer).setUint32(0, body.length);
  return new Blob([start, data, end]);
}
// Fixed application UUID, published with the export interface in architecture.
const uuid = new Uint8Array([
  0xd2, 0x1c, 0x26, 0x36, 0xcc, 0x68, 0x4e, 0x62, 0x92, 0xc9, 0x3e, 0x27, 0xd5,
  0xd8, 0x01, 0xbc,
]);
export async function loomMetadata(
  blob: Blob,
  format: "png" | "mp4" | "webp",
  value: unknown,
): Promise<Blob> {
  const json = JSON.stringify(value),
    bytes = utf8(json);
  if (bytes.length > 65536) throw new Error("Export metadata is too large.");
  if (format === "png") {
    // iTXt: keyword, uncompressed flag/method, empty language/translation.
    const body = utf8(`Tangent Garden\0\0\0\0\0${json}`);
    return new Blob(
      [
        blob.slice(0, blob.size - 12),
        pngChunk("iTXt", body),
        blob.slice(blob.size - 12),
      ],
      { type: blob.type },
    );
  }
  if (format === "mp4") {
    // An optional top-level UUID box leaves existing mdat offsets unchanged.
    return new Blob([blob, header("uuid", 24 + bytes.length), uuid, bytes], {
      type: blob.type,
    });
  }
  const text = json
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  const xmp = utf8(
    `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:tg="https://tangent-garden.isaacvelando.com/export/"><tg:study>${text}</tg:study></rdf:Description></rdf:RDF></x:xmpmeta>`,
  );
  const chunk = new Blob([
    header("XMP ", xmp.length, true),
    xmp,
    new Uint8Array(xmp.length % 2),
  ]);
  const first = new Uint8Array(await blob.slice(0, 30).arrayBuffer());
  new DataView(first.buffer).setUint32(4, blob.size + chunk.size - 8, true);
  first[20] |= 4; // VP8X: XMP present.
  const result = new Blob([first, blob.slice(30), chunk], { type: blob.type });
  if (result.size > 256 * 1024 * 1024)
    throw new Error("Export reached the 256 MiB limit.");
  return result;
}
