// Times large implicit surfaces through a real WASM engine, the way the
// browser worker calls it: the bridge call (Go meshing, sections and
// encoding), decoding into the result the page receives, and the copy that
// posting it to the page would make. It reads either bridge reply, JSON
// alone or JSON with typed mesh arrays, so it can time a deployed site's
// engine beside a local build:
//
//   node scripts/bench-implicit.mjs                 # public/ (make wasm)
//   node scripts/bench-implicit.mjs --engine dist/
//   node scripts/bench-implicit.mjs --compare https://tangent-garden.isaacvelando.com/
//   node scripts/bench-implicit.mjs --runs 9 --study tanglecube
//
// --compare times the given engine first, then the local one, and prints
// each study's speedup. Each engine runs in its own process: both define
// the same globals. The first run of each study warms up and is not timed.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";

const box = (x, y = x, z = x) => ({
  xMin: -x,
  xMax: x,
  yMin: -y,
  yMax: y,
  zMin: -z,
  zMax: z,
});
const gyroid = "sin(x)*cos(y) + sin(y)*cos(z) + sin(z)*cos(x)";
const tanglecube = "x^4 - 5*x^2 + y^4 - 5*y^2 + z^4 - 5*z^2";
const none = { normal: { x: 0, y: 0, z: 1 }, from: 0, to: 0, count: 0 };
const study = (name, note, implicit) => ({
  name,
  note,
  request: {
    format: "implicit",
    samples: 0,
    lines: 0,
    implicit: { a: 1, level: 0, sections: none, ...implicit },
  },
});
// The largest studies the limits allow, and the double torus preset.
const studies = [
  study("tanglecube", "64³ cells, 24 sections", {
    f: tanglecube,
    level: -11.8,
    box: box(2.6),
    cells: 64,
    sections: { normal: { x: 1, y: 1, z: 1 }, from: -2, to: 2, count: 24 },
  }),
  study("drops", "the preset, without sections", {
    f: "((x - a)^2 + y^2 + z^2) * ((x + a)^2 + y^2 + z^2)",
    level: 0.9,
    box: box(1.6, 0.8, 0.8),
    cells: 64,
  }),
  study("double-torus", "the preset, without its section", {
    f: "((x^2 + y^2)^2 - x^2 + y^2)^2 + z^2",
    level: 0.02,
    box: box(1.3, 0.7, 0.3),
    cells: 96,
  }),
  study("gyroid", "one period, 64³ cells", {
    f: gyroid,
    box: box(Math.PI),
    cells: 64,
  }),
  study("gyroid-slab", "128 × 128 × 9 cells, 24 sections", {
    f: gyroid,
    box: box(2 * Math.PI, 2 * Math.PI, 0.44),
    cells: 128,
    sections: { normal: { x: 0, y: 0, z: 1 }, from: -0.4, to: 0.4, count: 24 },
  }),
  // Refinement: its samples across a large study, and a refined preset.
  study("tangle-refined", "64³ cells, 3 refinement levels", {
    f: tanglecube,
    level: -11.8,
    box: box(2.6),
    cells: 64,
    refine: 3,
  }),
  study("thread", "the preset, 3 refinement levels", {
    f: "((x - a)^2 + y^2 + z^2) * ((x + a)^2 + y^2 + z^2)",
    level: 1.01,
    box: {
      xMin: -1.75,
      xMax: 1.85,
      yMin: -1.18,
      yMax: 1.22,
      zMin: -1.19,
      zMax: 1.21,
    },
    cells: 20,
    refine: 3,
    sections: { normal: { x: 1, y: 0, z: 0 }, from: -0.6, to: 0.6, count: 3 },
  }),
];

const options = { runs: 5, engine: "public/", compare: "", study: "" };
const args = process.argv.slice(2);
for (let k = 0; k < args.length; k += 2) {
  const key = args[k].replace(/^--/, "");
  if (!(key in options) && key !== "child")
    throw new Error(`Unknown option ${args[k]}`);
  options[key] = key === "runs" ? Number(args[k + 1]) : args[k + 1];
}
if (!(options.runs >= 1)) throw new Error("--runs must be at least 1");

async function load(source) {
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

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

// One engine, in this process: time every study and print JSON.
async function measure(source) {
  await load(source);
  const results = [];
  for (const s of studies) {
    if (options.study && s.name !== options.study) continue;
    const rows = [];
    for (let run = 0; run <= options.runs; run++) {
      const t0 = performance.now();
      const reply = globalThis.tangentGardenSpatial(JSON.stringify(s.request));
      const t1 = performance.now();
      let result, bytes, transfer;
      if (typeof reply === "string") {
        result = JSON.parse(reply);
        bytes = reply.length;
        transfer = [];
      } else {
        const { json, ...mesh } = reply;
        result = JSON.parse(json);
        Object.assign(result.implicit, mesh);
        bytes = json.length + mesh.positions.buffer.byteLength;
        transfer = [mesh.positions.buffer];
      }
      const t2 = performance.now();
      if (result.error) throw new Error(`${s.name}: ${result.error}`);
      if (run === 0)
        results.push({
          name: s.name,
          note: s.note,
          triangles: result.implicit.triangles.length / 3,
          vertices: result.implicit.positions.length / 3,
        });
      // What postMessage does to reach the page; it detaches the buffer.
      structuredClone({ result }, { transfer });
      const t3 = performance.now();
      if (run > 0)
        rows.push({ call: t1 - t0, decode: t2 - t1, post: t3 - t2, bytes });
    }
    const r = results.at(-1);
    for (const key of ["call", "decode", "post", "bytes"])
      r[key] = median(rows.map((row) => row[key]));
    r.total = r.call + r.decode + r.post;
  }
  process.stdout.write(JSON.stringify(results));
  process.exit(0);
}

function child(source) {
  const script = fileURLToPath(import.meta.url);
  const out = execFileSync(
    process.execPath,
    [script, "--child", source, "--runs", String(options.runs)].concat(
      options.study ? ["--study", options.study] : [],
    ),
    {
      encoding: "utf8",
      maxBuffer: 1 << 24,
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  return JSON.parse(out);
}

const ms = (v) => `${v.toFixed(0).padStart(5)} ms`;
const mb = (v) => `${(v / 1e6).toFixed(1).padStart(5)} MB`;
function table(label, results) {
  console.log(`\n${label}`);
  console.log(
    "study          triangles   call     decode   post     total    transfer",
  );
  for (const r of results)
    console.log(
      `${r.name.padEnd(14)}${String(r.triangles).padStart(9)}  ${ms(r.call)}  ${ms(r.decode)}  ${ms(r.post)}  ${ms(r.total)}  ${mb(r.bytes)}`,
    );
}

if (options.child) await measure(options.child);
else {
  console.log(
    `Median of ${options.runs} runs after one warm-up. call: the bridge (Go work and encoding); decode: JSON and typed arrays; post: the copy postMessage makes; transfer: bytes crossing to the page.`,
  );
  const local = child(options.engine);
  if (!options.compare) table(`Engine: ${options.engine}`, local);
  else {
    const other = child(options.compare);
    table(`Engine: ${options.compare}`, other);
    table(`Engine: ${options.engine}`, local);
    console.log("\nSpeedup per frame (total), and transfer size");
    for (const r of local) {
      const o = other.find((x) => x.name === r.name);
      // An engine without refinement ignores it and meshes the grid alone.
      if (studies.find((s) => s.name === r.name).request.implicit.refine) {
        console.log(`${r.name.padEnd(14)}   not compared: refined`);
        continue;
      }
      if (o.triangles !== r.triangles || o.vertices !== r.vertices)
        throw new Error(`${r.name}: the engines drew different meshes`);
      console.log(
        `${r.name.padEnd(14)}${(o.total / r.total).toFixed(2).padStart(6)}×   ${ms(o.total)} → ${ms(r.total)}   ${mb(o.bytes)} → ${mb(r.bytes)}   (${r.note})`,
      );
    }
  }
}
