// Writes Brotli and gzip copies of the engine beside it, which the host serves
// by Accept-Encoding: CloudFront compresses nothing over 10,000,000 bytes on
// its own, and the engine is larger (#604). A copy that still decodes to the
// current engine is kept, so a rebuild without a Go change skips the slow
// Brotli pass. scripts/check-dist.mjs checks the copies in dist/.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import zlib from "node:zlib";

const source = "public/engine.wasm";
const engine = readFileSync(source);
const { constants } = zlib;
const variants = [
  {
    file: `${source}.br`,
    compress: promisify(zlib.brotliCompress),
    decompress: zlib.brotliDecompressSync,
    options: {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
        // A 16 MiB window, the largest browsers decode.
        [constants.BROTLI_PARAM_LGWIN]: 24,
        [constants.BROTLI_PARAM_SIZE_HINT]: engine.length,
      },
    },
  },
  {
    file: `${source}.gz`,
    compress: promisify(zlib.gzip),
    decompress: zlib.gunzipSync,
    options: { level: 9 },
  },
];

await Promise.all(
  variants.map(async ({ file, compress, decompress, options }) => {
    if (existsSync(file)) {
      try {
        if (decompress(readFileSync(file)).equals(engine)) return;
      } catch {
        // A truncated or foreign file is written again below.
      }
    }
    const compressed = await compress(engine, options);
    writeFileSync(file, compressed);
    console.log(`${file}: ${compressed.length} bytes from ${engine.length}`);
  }),
);
