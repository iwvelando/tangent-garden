import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

for (const file of [
  "index.html",
  "404.html",
  "engine.wasm",
  "wasm_exec.js",
  "tangent-garden.svg",
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
const notices = readFileSync("dist/THIRD-PARTY-NOTICES.txt", "utf8");
for (const name of ["react", "react-dom", "scheduler", "vite"])
  assert.ok(notices.includes(`--- ${name} `), `Missing notice for ${name}`);
console.log("Distribution: required assets and license notices present.");
