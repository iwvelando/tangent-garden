// Issue #406's research measurements: each corpus scan stepped through the
// production WASM engine under Node, as the page's worker steps it, with
// the time per step (a step is one mesher call: the most a cancel waits for
// when it does not close the worker), the reply's size and the module's
// memory. Not a benchmark of a device: engine time on this machine only.
//
//   make wasm && node scripts/scan-research.mjs [--runs 3] [--case name]
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const k = args.indexOf(`--${name}`);
  return k >= 0 ? args[k + 1] : fallback;
};
const runs = Number(opt("runs", 3));
const only = opt("case", "");

runInThisContext(readFileSync("public/wasm_exec.js").toString());
const go = new globalThis.Go();
const { instance } = await WebAssembly.instantiate(
  readFileSync("public/engine.wasm"),
  go.importObject,
);
void go.run(instance);
const memory = () => instance.exports.mem.buffer.byteLength;

const cube = (x, y = x, z = x) => ({
  xMin: -x,
  xMax: x,
  yMin: -y,
  yMax: y,
  zMin: -z,
  zMax: z,
});
const none = { normal: { x: 0, y: 0, z: 1 }, from: 0, to: 0, count: 0 };
const implicit = (f, level, a, box, cells, refine = 0) => ({
  f,
  level,
  a,
  box,
  cells,
  refine,
  sections: none,
});
const tangle = "x^4 - 5*x^2 + y^4 - 5*y^2 + z^4 - 5*z^2";
const defaults = { samples: 17, depth: 5, recheck: true, critical: true };
const cases = [
  [
    "tanglecube story, 32 cells",
    implicit(tangle, -15, 1, cube(3), 32),
    "level",
    -20,
    4,
  ],
  [
    "tanglecube story, 64 cells",
    implicit(tangle, -15, 1, cube(3), 64),
    "level",
    -20,
    4,
  ],
  [
    "tanglecube story, 32 cells, refine 2",
    implicit(tangle, -15, 1, cube(3), 32, 2),
    "level",
    -20,
    4,
  ],
  [
    "two drops, 56 cells",
    implicit("((x-1)^2+y^2+z^2)*((x+1)^2+y^2+z^2)", 0.84, 1, cube(2), 56),
    "level",
    0.64,
    1.44,
  ],
  [
    "two handles, 64 cells",
    implicit(
      "((x^2 + y^2)^2 - x^2 + y^2)^2 + z^2",
      0.09,
      1,
      cube(1.3, 0.7, 0.4),
      64,
    ),
    "level",
    0.01,
    0.1,
  ],
  [
    "gyroid, 48 cells",
    implicit(
      "sin(x)*cos(y) + sin(y)*cos(z) + sin(z)*cos(x)",
      0,
      1,
      cube(Math.PI),
      48,
    ),
    "level",
    -1.5,
    1.5,
  ],
  [
    "drops parted by a, 40 cells",
    implicit(
      "((x-a)^2+y^2+z^2)*((x+a)^2+y^2+z^2)",
      1,
      0.8,
      cube(2, 1.2, 1.2),
      40,
    ),
    "a",
    0.6,
    1.4,
  ],
  [
    "sphere through its box, 32 cells",
    implicit("x^2+y^2+z^2", 1.5, 1, cube(1), 32),
    "level",
    0.5,
    3.5,
  ],
  [
    "pole, 25 cells",
    implicit("1/(x^2+y^2+z^2-1)", 1, 1, cube(1.5), 25),
    "level",
    0.5,
    1.5,
  ],
  [
    "tanglecube, 64 cells, 65 samples, 12 bisections",
    implicit(tangle, -15, 1, cube(3), 64),
    "level",
    -20,
    4,
    { samples: 65, depth: 12 },
  ],
];

const median = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];
const fmt = (v, d = 0) => v.toFixed(d);
for (const [name, q, axis, from, to, extra] of cases) {
  if (only && !name.includes(only)) continue;
  const request = { implicit: q, axis, from, to, ...defaults, ...extra };
  const totals = [];
  let steps = [],
    bytes = 0,
    last = null;
  const before = memory();
  for (let r = 0; r < runs; r++) {
    steps = [];
    bytes = 0;
    const start = performance.now();
    let reply = JSON.parse(
      globalThis.tangentGardenImplicitScan(JSON.stringify({ start: request })),
    );
    if (reply.error) throw new Error(`${name}: ${reply.error}`);
    while (reply.stop === "running") {
      const t = performance.now();
      const text = globalThis.tangentGardenImplicitScan('{"step":true}');
      steps.push(performance.now() - t);
      bytes = Math.max(bytes, text.length);
      reply = JSON.parse(text);
    }
    totals.push(performance.now() - start);
    last = reply;
  }
  const kinds = {};
  for (const c of last.candidates) kinds[c.kind] = (kinds[c.kind] ?? 0) + 1;
  const stable = last.candidates.filter((c) => c.stability === "stable").length;
  console.log(
    [
      name.padEnd(44),
      `total ${fmt(median(totals))} ms`,
      `calls ${last.calls}`,
      `cells ${(last.cells / 1e6).toFixed(1)}M`,
      `step median ${fmt(median(steps), 1)} max ${fmt(Math.max(...steps), 1)} ms`,
      `reply ≤ ${fmt(bytes / 1024, 1)} KiB`,
      `memory ${fmt(before / 2 ** 20)}→${fmt(memory() / 2 ** 20)} MiB`,
      `stop ${last.stop}`,
      `candidates ${JSON.stringify(kinds)} stable ${stable}`,
    ].join("  "),
  );
}
process.exit(0);
