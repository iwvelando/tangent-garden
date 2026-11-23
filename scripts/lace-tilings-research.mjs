// The lace tiling catalog's measurements (#389, #390): each tiling's patches and motion
// frames through the production WASM engine under Node, as the page's
// worker calls it, with the median engine time, the reply's JSON and
// lifted-buffer sizes, and the module's memory. Engine time on this machine
// only, not a device frame rate. With --compare <site or directory>, also
// checks that {7,3}'s replies (its presets' requests, a grid of cutoffs,
// star points and isometries, and frames along their motions) are byte for
// byte those of that engine.
//
//   make wasm && node scripts/lace-tilings-research.mjs [--runs 7]
//   node scripts/lace-tilings-research.mjs --compare https://tangent-garden.isaacvelando.com/
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const k = args.indexOf(`--${name}`);
  return k >= 0 ? args[k + 1] : fallback;
};

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
  return instance;
}

// One reply's bytes: the JSON text and the lifted floats.
function call(fn, q) {
  const raw = globalThis[fn](JSON.stringify(q));
  if (typeof raw === "string") return { json: raw, floats: new Uint8Array() };
  return {
    json: raw.json,
    floats: new Uint8Array(raw.lifted.floats.buffer ?? raw.lifted.floats),
  };
}

// {7,3}'s requests: the presets as they open, a grid of cutoffs and star
// points, isometries, and frames along the presets' and other motions.
function original() {
  const lace = (depth, maxTiles, starPoint, isometry) => ({
    tiling: "7,3",
    depth,
    maxTiles,
    starPoint,
    ...(isometry && { isometry }),
  });
  const out = [];
  for (const depth of [0, 1, 2, 3, 4, 5, 6, 7, 8])
    for (const maxTiles of [1, 29, 300, 617, 1000])
      for (const u of [0, 0.3, 0.55, 1])
        out.push(["tangentGardenLace", lace(depth, maxTiles, u)]);
  const isos = [
    { offset: 0, direction: -Math.PI / 14, rotation: 0 },
    { offset: 0.3, direction: 1, rotation: 0.5 },
    { offset: 0.71814307181038606, direction: -Math.PI / 14, rotation: 0 },
    { offset: 0.8, direction: -2, rotation: 3 },
  ];
  for (const iso of isos)
    out.push(["tangentGardenLace", lace(5, 1000, 0.3, iso)]);
  const motions = [
    { offset: 0.71814307181038606, orbits: 0, turns: 0 },
    { offset: 0.6, orbits: 1, turns: -2 },
    { offset: 0.8, orbits: -3, turns: 3 },
  ];
  for (const iso of isos)
    for (const motion of motions)
      for (let k = 0; k <= 20; k++)
        out.push([
          "tangentGardenLaceFrame",
          { lace: lace(5, 1000, 0.3, iso), motion, progress: k / 20 },
        ]);
  return out;
}

if (args[0] === "--child") {
  await load(args[1]);
  const hashes = original().map(([fn, q]) => {
    const r = call(fn, q);
    return createHash("sha256").update(r.json).update(r.floats).digest("hex");
  });
  process.stdout.write(JSON.stringify(hashes), () => process.exit(0));
} else if (opt("compare", "")) {
  const run = (source) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [fileURLToPath(import.meta.url), "--child", source],
        { encoding: "utf8", maxBuffer: 1 << 24 },
      ),
    );
  const theirs = run(opt("compare", "")),
    ours = run("public");
  const differ = ours.filter((h, k) => h !== theirs[k]).length;
  console.log(
    `${ours.length} {7,3} replies, ${differ} different from ${opt("compare", "")}`,
  );
  process.exit(differ ? 1 : 0);
} else {
  const runs = Number(opt("runs", 7));
  const instance = await load("public");
  const memory = () => instance.exports.mem.buffer.byteLength;
  const time = (fn, q) => {
    const times = [];
    let r;
    for (let k = 0; k <= runs; k++) {
      const t0 = performance.now();
      r = call(fn, q);
      if (k) times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const parsed = JSON.parse(r.json);
    if (parsed.error) throw new Error(`${JSON.stringify(q)}: ${parsed.error}`);
    return { ms: times[times.length >> 1], r, parsed };
  };
  const opening = { "7,3": 5, "5,4": 5, "4,5": 6, "3,7": 10 };
  const deepest = { "7,3": 8, "5,4": 8, "4,5": 8, "3,7": 11 };
  console.log(
    "| Tiling | Request | Candidates examined | Generation median ms | Frame median ms | JSON KB | Lifted KB |",
  );
  console.log("|---|---|---|---|---|---|---|");
  for (const tiling of ["7,3", "5,4", "4,5", "3,7"]) {
    for (const [name, depth] of [
      [`opening (depth ${opening[tiling]})`, opening[tiling]],
      [`largest (depth ${deepest[tiling]}, 1,000 tiles)`, deepest[tiling]],
    ]) {
      const q = { tiling, depth, maxTiles: 1000, starPoint: 0.3 };
      const g = time("tangentGardenLace", q);
      // A frame moves the patch frozen by the first call.
      call("tangentGardenLaceFrame", {
        lace: q,
        motion: { offset: 0.6, orbits: 1, turns: 1 },
        progress: 0,
      });
      const f = time("tangentGardenLaceFrame", {
        lace: q,
        motion: { offset: 0.6, orbits: 1, turns: 1 },
        progress: 0.37,
      });
      console.log(
        `| {${tiling}} | ${name} | ${g.parsed.processed} | ${g.ms.toFixed(2)} | ${f.ms.toFixed(2)} | ${(g.r.json.length / 1024).toFixed(1)} | ${(g.r.floats.byteLength / 1024).toFixed(1)} |`,
      );
    }
  }
  console.log(
    `\nModule memory after the run: ${(memory() / 2 ** 20).toFixed(1)} MiB`,
  );
}
