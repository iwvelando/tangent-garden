// vite preview serves the engine as production does: the Brotli copy, else
// the gzip copy, else the plain file, by Accept-Encoding, so the browser tests
// and a preview on a phone load what visitors load. In production the hosting's
// viewer-request function makes the same choice (iwvelando/cloud-accounts,
// modules/static-site); keep the two in step.
import { createReadStream, statSync } from "node:fs";
import { join, resolve } from "node:path";

const precompressed = ["/engine.wasm"];

// The encoding to send for an Accept-Encoding value: "br", "gzip" or
// undefined for the plain file. A coding with q=0 is refused.
export function chooseEncoding(accept) {
  const q = {};
  for (const part of (accept ?? "").split(",")) {
    const [name, ...params] = part.trim().toLowerCase().split(";");
    if (!name) continue;
    const weight = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    q[name] = weight === undefined ? 1 : Number(weight.slice(2)) || 0;
  }
  const accepts = (coding) => (q[coding] ?? q["*"] ?? 0) > 0;
  if (accepts("br")) return "br";
  if (accepts("gzip")) return "gzip";
  return undefined;
}

export function precompressedPreview() {
  return {
    name: "precompressed-preview",
    configurePreviewServer(server) {
      const root = resolve(server.config.root, server.config.build.outDir);
      const headers = server.config.preview.headers ?? {};
      server.middlewares.use((req, res, next) => {
        const path = new URL(req.url ?? "/", "http://preview").pathname;
        if (!precompressed.includes(path)) return next();
        if (req.method !== "GET" && req.method !== "HEAD") return next();
        res.setHeader("Vary", "Accept-Encoding");
        const encoding = chooseEncoding(req.headers["accept-encoding"]);
        if (!encoding) return next();
        const file = join(root, `${path}.${encoding === "br" ? "br" : "gz"}`);
        let size;
        try {
          size = statSync(file).size;
        } catch {
          return next();
        }
        for (const [name, value] of Object.entries(headers))
          res.setHeader(name, value);
        res.writeHead(200, {
          "Content-Type": "application/wasm",
          "Content-Encoding": encoding,
          "Content-Length": size,
          "Cache-Control": "no-cache",
        });
        if (req.method === "HEAD") return res.end();
        createReadStream(file).pipe(res);
      });
    },
  };
}
