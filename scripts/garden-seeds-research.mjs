// The garden seeds' measurements, first gathered for issue #385: each
// seed's packings through the production WASM engine under Node, as the
// page's worker calls it, with
// the median engine time, the reply's JSON and lifted-buffer sizes, and the
// module's memory. Engine time on this machine only, not a device frame
// rate. With --compare <site or directory>, also checks that the original
// seed's replies (its presets' requests and a grid of zoom-detail windows)
// are byte for byte those of that engine.
//
//   make wasm && node scripts/garden-seeds-research.mjs [--runs 7]
//   node scripts/garden-seeds-research.mjs --compare https://tangent-garden.isaacvelando.com/
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
function call(q) {
  const raw = globalThis.tangentGardenGarden(JSON.stringify(q));
  if (typeof raw === "string") return { json: raw, floats: new Uint8Array() };
  return {
    json: raw.json,
    floats: new Uint8Array(raw.lifted.floats.buffer ?? raw.lifted.floats),
  };
}

// The original's requests: its presets as they open, and the detail
// policy's windows over the packing at three zoom levels.
function originalRequests() {
  const base = {
    seed: "-1,2,2,3",
    depth: 12,
    minRadius: 0.002,
    maxCircles: 5000,
  };
  const out = [base, { ...base, depth: 10 }, { ...base, depth: 1 }];
  for (const level of [1, 5, 9, 13]) {
    const f = 2 ** (level / 2);
    const cell = 1000 / (350 * f) / 4;
    for (let i = -6; i <= 6; i++)
      for (let j = -6; j <= 6; j++) {
        const x = (i / 6) * 0.95,
          y = (j / 6) * 0.95;
        const snap = (v) => Math.floor(v / cell) * cell;
        out.push({
          ...base,
          minRadius: 0.002 / f,
          window: {
            xMin: snap(x) - cell,
            xMax: snap(x) + 3 * cell,
            yMin: snap(y) - cell,
            yMax: snap(y) + 3 * cell,
          },
          ...(i === j && { keep: { curvature: 23, x: 8, y: 12 } }),
        });
      }
  }
  return out;
}

if (args[0] === "--child") {
  await load(args[1]);
  const hashes = originalRequests().map((q) => {
    const r = call(q);
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
    `${ours.length} original-seed replies, ${differ} different from ${opt("compare", "")}`,
  );
  process.exit(differ ? 1 : 0);
} else {
  const runs = Number(opt("runs", 7));
  const instance = await load("public");
  const memory = () => instance.exports.mem.buffer.byteLength;
  const seeds = [
    "-1,2,2,3",
    "-2,3,6,7",
    "-3,5,8,8",
    "-6,11,14,15",
    "3-2r3,1,1,1",
    "-1,3,3,3,3,3,3,3",
  ];
  console.log(
    "| Seed | Request | Circles | Gaps examined | Median ms | JSON KB | Lifted KB |",
  );
  console.log("|---|---|---|---|---|---|---|");
  for (const seed of seeds) {
    const cases = [
      [
        "default (12, 0.002, 5,000)",
        { seed, depth: 12, minRadius: 0.002, maxCircles: 5000 },
      ],
      [
        "largest (12, 5e-324, 5,000)",
        { seed, depth: 12, minRadius: 5e-324, maxCircles: 5000 },
      ],
      [
        "100× detail at the center",
        {
          seed,
          depth: 12,
          minRadius: 0.002 / 2 ** 6.5,
          maxCircles: 5000,
          window: { xMin: -0.04, xMax: 0.04, yMin: -0.03, yMax: 0.03 },
        },
      ],
    ];
    for (const [name, q] of cases) {
      const times = [];
      let r;
      for (let k = 0; k <= runs; k++) {
        const t0 = performance.now();
        r = call(q);
        if (k) times.push(performance.now() - t0);
      }
      times.sort((a, b) => a - b);
      const parsed = JSON.parse(r.json);
      if (parsed.error) throw new Error(`${seed} ${name}: ${parsed.error}`);
      const lifted = r.floats.byteLength / 8;
      console.log(
        `| \`${seed}\` | ${name} | ${parsed.processed !== undefined ? "" : ""}${countOf(parsed, lifted)} | ${parsed.processed} | ${times[times.length >> 1].toFixed(2)} | ${(r.json.length / 1024).toFixed(1)} | ${(r.floats.byteLength / 1024).toFixed(1)} |`,
      );
    }
  }
  console.log(
    `\nModule memory after the run: ${(memory() / 2 ** 20).toFixed(1)} MiB`,
  );
}

// The circle count: the lifted floats hold, per circle, x, y, radius,
// curvature, weightedX, weightedY, generation, opposite (8), three parents,
// and six exact values for a research seed. Small replies are not lifted.
function countOf(parsed, lifted) {
  if (Array.isArray(parsed.curvature)) return parsed.curvature.length;
  return Math.round(lifted / (parsed.seeds ? 17 : 11));
}
