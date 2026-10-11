// Hashes every preset's result in all three notebooks, so two engines can
// be shown to draw every preset bit for bit alike, and times each one. Each
// preset goes through the page's own engine worker (web/engine.worker.ts,
// as the dev server serves it) to a real WASM engine, as the page sends it:
// the study alone and, for 2D and 3D, with the base curve's diagnostics.
// A result is hashed as the page receives it, with any lifted arrays put
// back; every number counts by its bits, with one NaN for all NaNs, whose
// sign and payload WebAssembly leaves open.
//
//   node scripts/preset-hashes.mjs                     # public/ (make wasm)
//   node scripts/preset-hashes.mjs --engine dist/
//   node scripts/preset-hashes.mjs --compare https://tangent-garden.isaacvelando.com/
//   node scripts/preset-hashes.mjs --compare <directory> --runs 5 --only spring
//
// --compare runs the given engine first, then the local one, in a process
// each, lists any preset whose results differ and exits with an error if
// one does, and prints each preset's time beside the other engine's. The
// time is the median of --runs runs (default 1) after one warm-up, of the
// worker's whole reply: resolving fields, Go's work and encoding, and
// decoding. --only keeps the presets whose name contains its text.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Script, createContext, runInThisContext } from "node:vm";
import { createServer } from "vite";

const options = { runs: 1, engine: "public/", compare: "", only: "" };
const args = process.argv.slice(2);
for (let k = 0; k < args.length; k += 2) {
  const key = args[k].replace(/^--/, "");
  if (!(key in options) && key !== "child")
    throw new Error(`Unknown option ${args[k]}`);
  options[key] = key === "runs" ? Number(args[k + 1]) : args[k + 1];
}
if (!(options.runs >= 1)) throw new Error("--runs must be at least 1");

async function loadEngine(source) {
  const read = async (name) => {
    if (/^https?:/.test(source)) {
      const url = new URL(name, source.endsWith("/") ? source : `${source}/`);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url}: ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    }
    return readFileSync(join(resolve(source), name));
  };
  runInThisContext((await read("wasm_exec.js")).toString());
  const go = new globalThis.Go();
  const { instance } = await WebAssembly.instantiate(
    await read("engine.wasm"),
    go.importObject,
  );
  void go.run(instance);
}

// Every preset's requests, as the page sends them to its worker.
async function requests(server) {
  const { presets } = await server.ssrLoadModule("/web/presets.ts");
  const { spatialPresets } = await server.ssrLoadModule(
    "/web/spatial/presets.ts",
  );
  const { tesseractPresets } = await server.ssrLoadModule(
    "/web/tesseract/presets.ts",
  );
  const all = [];
  for (const p of presets) {
    all.push({ name: `2D ${p.title}`, action: "compute", config: p.config });
    all.push({
      name: `2D ${p.title} · diagnostics`,
      action: "compute",
      config: p.config,
      diagnostics: true,
    });
  }
  for (const p of spatialPresets) {
    all.push({ name: `3D ${p.name}`, action: "spatial", spatial: p.config });
    all.push({
      name: `3D ${p.name} · diagnostics`,
      action: "spatial",
      spatial: p.config,
      diagnostics: true,
    });
  }
  for (const p of tesseractPresets)
    all.push({
      name: `4D ${p.name}`,
      action: "tesseract",
      tesseract: p.config,
    });
  return all.filter(
    (r) =>
      !options.only ||
      r.name.toLowerCase().includes(options.only.toLowerCase()),
  );
}

// A digest of a value that depends on every number's bits, and on nothing
// a transport might reorder: an object's keys are taken sorted, and an
// array and a typed array of the same numbers hash alike.
function digest(value) {
  const hash = createHash("sha256");
  const bits = new DataView(new ArrayBuffer(8));
  const put = (v) => {
    if (typeof v === "number") {
      bits.setFloat64(0, Number.isNaN(v) ? NaN : v);
      hash.update("n");
      hash.update(new Uint8Array(bits.buffer));
    } else if (typeof v === "string") hash.update(`s${v.length}:${v}`);
    else if (typeof v === "boolean") hash.update(v ? "T" : "F");
    else if (v === null || v === undefined) hash.update("z");
    else if (Array.isArray(v) || ArrayBuffer.isView(v)) {
      hash.update(`a${v.length}[`);
      for (const item of v) put(item);
      hash.update("]");
    } else {
      const keys = Object.keys(v)
        .filter((k) => v[k] !== undefined)
        .sort();
      hash.update(`o${keys.length}{`);
      for (const k of keys) {
        hash.update(`k${k.length}:${k}`);
        put(v[k]);
      }
      hash.update("}");
    }
  };
  put(value);
  return hash.digest("hex").slice(0, 16);
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

// One engine, in this process: every preset's digest and time, as JSON.
async function measure(source) {
  await loadEngine(source);
  const server = await createServer({
    logLevel: "silent",
    server: { ws: false },
  });
  let chosen, worker, restore;
  try {
    chosen = await requests(server);
    ({ restore } = await server.ssrLoadModule("/web/lifted.ts"));
    worker = await server.transformRequest(
      "/web/engine.worker.ts?worker_file&type=classic",
    );
  } finally {
    await server.close();
  }
  let answer;
  const self = { postMessage: (reply) => answer(reply) };
  const context = createContext({
    importScripts: () => {},
    self,
    tangentGardenCompute: globalThis.tangentGardenCompute,
    tangentGardenProbe: globalThis.tangentGardenProbe,
    tangentGardenScalars: globalThis.tangentGardenScalars,
    tangentGardenSpatial: globalThis.tangentGardenSpatial,
    tangentGardenSpatialProbe: globalThis.tangentGardenSpatialProbe,
    tangentGardenTesseract: globalThis.tangentGardenTesseract,
    structuredClone,
  });
  new Script(`${worker.code}\nready = Promise.resolve();`).runInContext(
    context,
  );
  const ask = (request) =>
    new Promise((done) => {
      answer = done;
      void self.onmessage({ data: { id: 1, base: "", ...request } });
    });
  const results = [];
  for (const { name, ...request } of chosen) {
    const times = [];
    let hash, last;
    for (let run = 0; run <= options.runs; run++) {
      const t0 = performance.now();
      const reply = (last = await ask(request));
      const t1 = performance.now();
      if (run > 0) times.push(t1 - t0);
      const { id: _, lifted, ...rest } = reply;
      if (rest.result) restore(rest.result, lifted);
      const h = digest(rest);
      if (hash && h !== hash)
        throw new Error(`${name}: one engine gave two different results`);
      hash = h;
    }
    results.push({ name, hash, time: median(times), error: last.error });
  }
  process.stdout.write(JSON.stringify(results));
  process.exit(0);
}

function child(source) {
  const out = execFileSync(
    process.execPath,
    [
      fileURLToPath(import.meta.url),
      "--child",
      source,
      "--runs",
      String(options.runs),
      "--only",
      options.only,
    ],
    {
      encoding: "utf8",
      maxBuffer: 1 << 24,
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  return JSON.parse(out);
}

const ms = (v) => `${v.toFixed(1).padStart(8)} ms`;
if (options.child) await measure(options.child);
else {
  const local = child(options.engine);
  if (!options.compare) {
    console.log(`Engine: ${options.engine}`);
    for (const r of local)
      console.log(
        `${r.hash}  ${ms(r.time)}  ${r.name}${r.error ? `  (refused: ${r.error})` : ""}`,
      );
  } else {
    const other = child(options.compare);
    console.log(`Time per preset: ${options.compare} → ${options.engine}`);
    const differ = [];
    let before = 0,
      after = 0;
    for (const r of local) {
      const o = other.find((x) => x.name === r.name);
      if (!o) {
        console.log(`${" ".repeat(34)}  new: ${r.name}`);
        continue;
      }
      if (o.hash !== r.hash) differ.push(r.name);
      before += o.time;
      after += r.time;
      console.log(
        `${ms(o.time)} → ${ms(r.time)}  ${(o.time / r.time).toFixed(2).padStart(5)}×  ${o.hash === r.hash ? "same" : "DIFFERENT"}  ${r.name}`,
      );
    }
    console.log(
      `\n${local.length} results, ${differ.length} different; all presets ${ms(before)} → ${ms(after)}`,
    );
    if (differ.length) {
      console.log(`Different:\n  ${differ.join("\n  ")}`);
      process.exit(1);
    }
  }
}
