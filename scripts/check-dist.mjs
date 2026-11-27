import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { brotliDecompressSync, gunzipSync } from "node:zlib";

for (const file of [
  "index.html",
  "404.html",
  "engine.wasm",
  "engine.wasm.br",
  "engine.wasm.gz",
  "wasm_exec.js",
  "tangent-garden.svg",
  "og-image.png",
  "apple-touch-icon.png",
  "LICENSE.txt",
  "GO-LICENSE.txt",
  "THIRD-PARTY-NOTICES.txt",
])
  assert.ok(
    readFileSync(`dist/${file}`).length > 0,
    `Missing or empty distribution file: ${file}`,
  );
assert.equal(
  readFileSync("dist/LICENSE.txt", "utf8"),
  readFileSync("LICENSE", "utf8"),
);
// The host serves these copies in place of the engine (#604), so each must be
// the engine itself.
const engine = readFileSync("dist/engine.wasm");
for (const [file, decode] of [
  ["engine.wasm.br", brotliDecompressSync],
  ["engine.wasm.gz", gunzipSync],
])
  assert.ok(
    decode(readFileSync(`dist/${file}`)).equals(engine),
    `dist/${file} does not decode to dist/engine.wasm`,
  );
const notices = readFileSync("dist/THIRD-PARTY-NOTICES.txt", "utf8");
for (const name of ["react", "react-dom", "scheduler", "vite"])
  assert.ok(notices.includes(`--- ${name} `), `Missing notice for ${name}`);
console.log("Distribution: required assets and license notices present.");
