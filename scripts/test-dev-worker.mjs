import assert from "node:assert/strict";
import { Script } from "node:vm";
import { createServer } from "vite";

// The engine worker is classic so it can importScripts Go's wasm_exec.js. The
// production build bundles it, but the dev server serves it unbundled, so any
// import or export (even the `export {}` left by type-only imports) makes it a
// module and the worker fails to start ("Numerical engine is closed."). Parse
// exactly what the dev server sends.
const server = await createServer({
  logLevel: "silent",
  server: { ws: false },
});
try {
  const worker = await server.transformRequest(
    "/web/engine.worker.ts?worker_file&type=classic",
  );
  assert.ok(worker, "Dev server did not serve the engine worker");
  assert.doesNotThrow(
    () => new Script(worker.code, { filename: "engine.worker.ts" }),
    "The engine worker must parse as a classic script in dev: reference types inline, with no import or export",
  );
} finally {
  await server.close();
}
console.log("Dev worker: engine worker parses as a classic script.");
