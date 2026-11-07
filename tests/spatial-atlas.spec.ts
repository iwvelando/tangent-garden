import { test, expect } from "@playwright/test";
import { spatialPresets } from "../web/spatial/presets";
import type { SpatialConfig } from "../web/spatial/types";

// The 3D notebook's parameter atlas: torus-knot windings and ellipsoid
// semi-axes (docs/architecture.md, Reversible parameter atlas).

const presetIndex = (name: string) => {
  const index = spatialPresets.findIndex((p) => p.name === name);
  expect(index, name).toBeGreaterThanOrEqual(0);
  return index;
};
const trefoil = "Trefoil · (2, 3)";
const focal = "The focal sheets of an ellipsoid";
const hiding = "An ellipsoid hiding its centers";
const config = (name: string): SpatialConfig =>
  structuredClone(spatialPresets[presetIndex(name)].config);

test("spatial atlas catalog admits torus-knot windings and ellipsoid semi-axes only", async () => {
  const { spatialAtlasPairs, spatialAtlasPair } =
    await import("../web/spatial/atlas");
  const ids = (c: SpatialConfig) => spatialAtlasPairs(c).map((p) => p.id);
  const knot = config(trefoil);
  expect(ids(knot)).toEqual(["windings"]);
  // Any construction, derived input or shadow keeps the generator's pair.
  for (const construction of [
    "involute",
    "canal",
    "framed",
    "inversion",
    "none",
  ] as const)
    expect(ids({ ...knot, construction })).toEqual(["windings"]);
  expect(
    ids({ ...knot, input: "tangent-foot", shadow: { plane: "z", at: -2 } }),
  ).toEqual(["windings"]);
  // Non-whole windings have no whole axis containing them.
  expect(ids({ ...knot, p: 2.5 })).toEqual([]);
  // Dormant windings never establish support for another generator.
  expect(ids({ ...knot, format: "parametric" })).toEqual([]);
  expect(ids({ ...knot, format: "harmonic" })).toEqual([]);

  const ellipsoid = config(focal);
  expect(ids(ellipsoid)).toEqual(["ellipsoid"]);
  expect(ids(config(hiding))).toEqual(["ellipsoid"]);
  // Other kinds and a mirror's patch are not admitted.
  for (const kind of [
    "torus",
    "cylinder",
    "paraboloid",
    "monkey",
    "helicoid-catenoid",
  ] as const)
    expect(
      ids({ ...ellipsoid, surface: { ...ellipsoid.surface, kind } }),
      kind,
    ).toEqual([]);
  expect(ids({ ...ellipsoid, format: "rays" })).toEqual([]);
  expect(ids({ ...ellipsoid, format: "implicit" })).toEqual([]);
  // A dormant ellipsoid patch never admits a knot study's pair, nor the
  // reverse.
  expect(ids({ ...knot, surface: ellipsoid.surface })).toEqual(["windings"]);

  expect(
    spatialAtlasPair("windings").axes.map((a) => [a.path, !!a.integer]),
  ).toEqual([
    [["p"], true],
    [["q"], true],
  ]);
  expect(
    spatialAtlasPair("ellipsoid").axes.map((a) => [a.path, !!a.integer]),
  ).toEqual([
    [["surface", "a"], false],
    [["surface", "b"], false],
  ]);
});

test("spatial atlas defaults stay within the windings' range and scale semi-axes", async () => {
  const { spatialAtlasDefaults } = await import("../web/spatial/atlas");
  const knot = config(trefoil);
  const windings = (p: number, q: number) =>
    spatialAtlasDefaults({ ...knot, p, q }, "windings");
  // Four whole steps around each, moved the least to stay in p 1–8, q 1–9.
  expect(windings(2, 3)).toEqual({ p: [1, 5], q: [1, 5] });
  expect(windings(3, 4)).toEqual({ p: [1, 5], q: [2, 6] });
  expect(windings(5, 7)).toEqual({ p: [3, 7], q: [5, 9] });
  expect(windings(8, 9)).toEqual({ p: [4, 8], q: [5, 9] });
  expect(windings(1, 1)).toEqual({ p: [1, 5], q: [1, 5] });

  const ellipsoid = config(focal);
  expect(spatialAtlasDefaults(ellipsoid, "ellipsoid")).toEqual({
    a: [0.75, 2.25],
    b: [0.5, 1.5],
  });
  // Generated endpoints shed arithmetic tails (1.2 × 1.5 = 1.7999…98).
  expect(
    spatialAtlasDefaults(
      { ...ellipsoid, surface: { ...ellipsoid.surface, a: 1.2, b: 0.9 } },
      "ellipsoid",
    ),
  ).toEqual({ a: [0.6, 1.8], b: [0.45, 1.35] });
});

test("spatial atlas previews cap only their declared quality fields", async () => {
  const { spatialPreviewConfig } = await import("../web/spatial/atlas");
  const knot = {
    ...config(trefoil),
    adaptive: true,
    adaptiveSurface: true,
    adaptiveView: true,
    adaptiveFrame: true,
  };
  const small = spatialPreviewConfig(knot, 3);
  expect([small.samples, small.lines]).toEqual([480, 48]);
  expect([
    small.adaptive,
    small.adaptiveSurface,
    small.adaptiveView,
    small.adaptiveFrame,
  ]).toEqual([false, false, false, false]);
  const smaller = spatialPreviewConfig(knot, 5);
  expect([smaller.samples, smaller.lines]).toEqual([240, 24]);
  // Everything else is the source's, and the source is untouched.
  const {
    samples,
    lines,
    adaptive,
    adaptiveSurface,
    adaptiveView,
    adaptiveFrame,
    ...rest
  } = small;
  const {
    samples: s,
    lines: l,
    adaptive: a1,
    adaptiveSurface: a2,
    adaptiveView: a3,
    adaptiveFrame: a4,
    ...source
  } = knot;
  expect(rest).toEqual(source);
  expect(knot.samples).toBe(960);
  // Smaller requests stay smaller; absent flags stay absent.
  const plain = { ...config(trefoil), samples: 300, lines: 20 };
  expect(spatialPreviewConfig(plain, 3)).toEqual(plain);

  const ellipsoid = config(focal);
  const grid = spatialPreviewConfig(ellipsoid, 3).surface;
  expect([grid.uSamples, grid.vSamples]).toEqual([72, 72]);
  const finer = spatialPreviewConfig(ellipsoid, 5);
  expect([finer.surface.uSamples, finer.surface.vSamples]).toEqual([48, 48]);
  expect({ ...finer.surface, uSamples: 150, vSamples: 96 }).toEqual(
    ellipsoid.surface,
  );
  expect(finer.samples).toBe(ellipsoid.samples);
  const coarse = {
    ...ellipsoid,
    surface: { ...ellipsoid.surface, uSamples: 30, vSamples: 20 },
  };
  expect(spatialPreviewConfig(coarse, 5)).toEqual(coarse);
});

test("spatial atlas reservations bound knot points, sheet cells and geodesic points", async () => {
  const { spatialAtlasBudget } = await import("../web/spatial/atlas");
  const knot = config(trefoil);
  // Base and developable: 2 paths. 25 × 2 × 240 + 2 × 960.
  expect(spatialAtlasBudget(knot, 5)).toMatchObject({ points: 13920 });
  expect(spatialAtlasBudget(knot, 5).error).toBeUndefined();
  // An upper bound on every knot: 28 paths (24 involutes on a derived input
  // with a shadow) at 2,400 samples, refined in the inspection, still fits.
  // The engine itself refuses so many involute points.
  const worst: SpatialConfig = {
    ...knot,
    construction: "involute",
    input: "tangent-foot",
    involute: {
      ...knot.involute,
      family: { enabled: true, from: -2, to: 2, count: 24 },
    },
    shadow: { plane: "z", at: -3 },
    samples: 2400,
    adaptive: true,
  };
  expect(spatialAtlasBudget(worst, 5)).toMatchObject({ points: 693952 });
  expect(spatialAtlasBudget(worst, 5).error).toBeUndefined();
  expect(spatialAtlasBudget(worst, 3)).toMatchObject({
    points: 9 * 28 * 480 + 28 * (2400 + 16384),
  });

  const ellipsoid = config(focal);
  // Patch and two focal sheets: 3 sheets.
  expect(spatialAtlasBudget(ellipsoid, 3)).toMatchObject({
    cells: (9 * 72 * 72 + 150 * 96) * 3,
    geodesic: 0,
  });
  const offset = {
    ...ellipsoid,
    surface: { ...ellipsoid.surface, offset: 0.2 },
  };
  expect(spatialAtlasBudget(offset, 5)).toMatchObject({
    cells: (25 * 48 * 48 + 150 * 96) * 4,
  });
  // A geodesic fan reserves count × (samples + 1) points per request.
  const fan = (count: number, samples: number): SpatialConfig => ({
    ...ellipsoid,
    surface: {
      ...ellipsoid.surface,
      a: 1,
      b: 1,
      c: 1,
      geodesics: {
        u: 0,
        v: 0,
        direction: 0,
        spread: 90,
        count,
        length: 3,
        samples,
        selected: 1,
      },
    },
  });
  expect(spatialAtlasBudget(fan(16, 2000), 5)).toMatchObject({
    geodesic: 26 * 16 * 2001,
  });
  expect(spatialAtlasBudget(fan(16, 2000), 5).error).toBeUndefined();
  const wide = fan(32, 5000);
  expect(spatialAtlasBudget(wide, 3).error).toBeUndefined();
  expect(spatialAtlasBudget(wide, 5).error).toMatch(/5 × 5.*3 × 3/);
  expect(spatialAtlasBudget(fan(32, 20000), 3).error).toMatch(
    /exceeds the atlas work limit/,
  );
  // A study with no pair is refused, keeping the study.
  expect(
    spatialAtlasBudget({ ...knot, format: "parametric" }, 3).error,
  ).toMatch(/no curated parameter pair/);
});

test("spatial atlas scheduler requests every variant at preview quality and adopts only the pair", async () => {
  const { SpatialAtlas, spatialAtlasDefaults, spatialPreviewConfig } =
    await import("../web/spatial/atlas");
  const { presetStudy } = await import("../web/spatial/link");
  const { EngineError } = await import("../web/engine-client");
  const study = presetStudy(presetIndex(trefoil));
  study.cut = { ...study.cut, enabled: true };
  const requests: SpatialConfig[] = [];
  const replies: Array<() => void> = [];
  let state: any;
  const atlas = new SpatialAtlas(
    {
      computeSpatial: (c: SpatialConfig) => {
        requests.push(structuredClone(c));
        return new Promise((resolve, reject) =>
          replies.push(() =>
            // The engine's refusal of a non-coprime pair.
            c.p % 2 === 0 && c.q % 2 === 0
              ? reject(new EngineError("windings must be coprime", "p"))
              : resolve({
                  config: c,
                  result: {
                    bounds: { center: { x: 0, y: 0, z: 0 }, radius: c.p },
                  },
                } as any),
          ),
        );
      },
    },
    (s) => (state = s),
  );
  atlas.generate(study, spatialAtlasDefaults(study.config, "windings"), {
    pair: "windings",
    size: 5,
  });
  // One request in flight at a time.
  expect(requests).toHaveLength(1);
  while (replies.length) {
    replies.shift()!();
    await new Promise((r) => setTimeout(r));
  }
  expect(requests).toHaveLength(25);
  requests.forEach((c, i) => {
    const p = 1 + (i % 5),
      q = 1 + Math.floor(i / 5);
    expect(c).toEqual(spatialPreviewConfig({ ...study.config, p, q }, 5));
  });
  expect(state.cells.map((c: any) => (c.error ? "x" : "·")).join("")).toBe(
    "·····" + "·x·x·" + "·····" + "·x·x·" + "·····",
  );
  atlas.inspect(7);
  replies.shift()!();
  await new Promise((r) => setTimeout(r));
  // The inspection is the original-quality request.
  expect(requests.at(-1)).toEqual({ ...study.config, p: 3, q: 2 });
  const adopted = atlas.candidate()!;
  expect(adopted.config).toEqual({ ...study.config, p: 3, q: 2 });
  expect({ ...adopted, config: study.config }).toEqual(study);

  // A newer generation drops a delayed reply.
  atlas.generate(
    study,
    { p: [1, 5], q: [1, 5] },
    { pair: "windings", size: 3 },
  );
  const stale = replies.shift()!;
  atlas.cancel();
  stale();
  await new Promise((r) => setTimeout(r));
  expect(state.cells).toEqual([]);
});

// ---- Through the real worker and renderer ----

import { deflateRawSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { restore } from "../web/lifted";
import { copiedStudy, settled } from "./gallery-helpers";
import { choosePreset } from "./helpers";

// Records every worker's spatial requests and replies in window.atlasWorkers,
// typed arrays kept as they arrive; replies from workers after the first arrive
// delay ms late.
async function observeWorkers(page: Page, delay = 0) {
  await page.addInitScript(
    ({ delay }) => {
      const Native = window.Worker;
      const logs: any[] = [];
      Object.assign(window, { atlasWorkers: logs, atlasDelay: delay });
      window.Worker = class extends Native {
        log: any;
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          this.log = {
            url: String(url),
            requests: [],
            replies: [],
            terminated: false,
          };
          logs.push(this.log);
        }
        postMessage(data: any, options?: any) {
          if (data.action === "spatial" && !data.probeOnly)
            this.log.requests.push(structuredClone(data));
          super.postMessage(data, options);
        }
        set onmessage(handler: any) {
          super.onmessage = (event: MessageEvent) => {
            const deliver = () => {
              if (this.log.requests.some((r: any) => r.id === event.data.id))
                this.log.replies.push(structuredClone(event.data));
              handler?.call(this, event);
            };
            if (logs.indexOf(this.log) > 0)
              setTimeout(deliver, (window as any).atlasDelay);
            else deliver();
          };
        }
        terminate() {
          this.log.terminated = true;
          super.terminate();
        }
      };
    },
    { delay },
  );
}
const link = (study: object) =>
  `/?study=3d#s=${deflateRawSync(JSON.stringify({ v: 1, notebook: "3d", study })).toString("base64url")}`;
async function openStudy(page: Page, study: object) {
  await page.goto(link(study));
  await expect(page).not.toHaveURL(/#s=/);
  await settled(page);
}
const atlasDialog = (page: Page) =>
  page.getByRole("dialog", { name: "A field of possible forms", exact: true });
async function openAtlas(page: Page) {
  await page
    .getByRole("button", { name: "Explore parameter atlas", exact: true })
    .click();
  const atlas = atlasDialog(page);
  await expect(atlas).toBeVisible();
  atlasWorker = await page.evaluate(
    () => ((window as any).atlasWorkers?.length ?? 0) - 1,
  );
  return atlas;
}
const study = async (name: string) => {
  const { presetStudy } = await import("../web/spatial/link");
  return presetStudy(presetIndex(name));
};
// The atlas's worker: the last one started when the atlas opened, which a
// notebook mounted later does not displace.
let atlasWorker = -1;
// Its log, without the replies' geometry: each reply's bounds, by id.
const atlasLog = (page: Page) =>
  page.evaluate((i) => {
    const log = (window as any).atlasWorkers[i];
    return {
      url: log.url,
      terminated: log.terminated,
      requests: log.requests,
      replies: log.replies.map((r: any) => ({
        id: r.id,
        error: r.error,
        bounds: r.result?.bounds,
      })),
    };
  }, atlasWorker);
async function setRange(atlas: any, label: string, [from, to]: number[]) {
  // Widen before narrowing so intermediate ranges stay increasing.
  await atlas.getByLabel(`${label} to`, { exact: true }).fill("1000");
  await atlas.getByLabel(`${label} from`, { exact: true }).fill(String(from));
  await atlas.getByLabel(`${label} to`, { exact: true }).fill(String(to));
}
async function generate(atlas: any) {
  const button = atlas.getByRole("button", {
    name: "Generate atlas",
    exact: true,
  });
  await expect(button).toBeEnabled();
  await button.click();
  // Editing may have terminated the previous generation's worker so Go
  // can resolve range expressions immediately. Observe the current one.
  atlasWorker = await atlas
    .page()
    .evaluate(() => ((window as any).atlasWorkers?.length ?? 0) - 1);
}
const outcomes = (atlas: any, size: number) =>
  expect(
    atlas.locator(
      '.atlas-cell[data-state="valid"], .atlas-cell[data-state="invalid"]',
    ),
  ).toHaveCount(size * size, { timeout: 30_000 });

// Each cell's request is the source with only the pair changed and the
// declared preview quality, assembled here by hand; its reply equals a
// fresh worker's reply to that request, and its geometry satisfies the
// definition at the displayed values.
for (const [pair, name, labels, size, entered] of [
  [
    "windings",
    trefoil,
    ["Windings around p", "Windings through q"],
    5,
    [
      [1, 5],
      [2, 6],
    ],
  ],
  [
    "windings",
    trefoil,
    ["Windings around p", "Windings through q"],
    3,
    [
      [2, 4],
      [3, 7],
    ],
  ],
  [
    "ellipsoid",
    focal,
    ["Axis a", "Axis b"],
    3,
    [
      [0.5, 2.5],
      [0.25, 1.25],
    ],
  ],
  [
    "ellipsoid",
    focal,
    ["Axis a", "Axis b"],
    5,
    [
      [0.5, 2.5],
      [0.25, 1.25],
    ],
  ],
] as const)
  test(`spatial atlas ${pair} ${size} × ${size} previews and inspection equal direct requests and their definition`, async ({
    page,
  }) => {
    const source = await study(name);
    await observeWorkers(page);
    await openStudy(page, source);
    const atlas = await openAtlas(page);
    await atlas
      .getByLabel("Grid size", { exact: true })
      .selectOption(String(size));
    for (let i = 0; i < 2; i++)
      await setRange(atlas, labels[i], entered[i] as any);
    await generate(atlas);
    await outcomes(atlas, size);
    await expect(atlas.locator(".atlas-quality")).toContainText(
      pair === "windings"
        ? `${size === 3 ? 480 : 240} samples, ${size === 3 ? 48 : 24} rulings, refinement off`
        : `${size === 3 ? 72 : 48} × ${size === 3 ? 72 : 48} grid cells`,
    );
    const value = (axis: 0 | 1, index: number) => {
      const [from, to] = entered[axis];
      const k = axis === 0 ? index % size : Math.floor(index / size);
      return from + ((to - from) * k) / (size - 1);
    };
    const expected = (index: number, full: boolean) => {
      const c = structuredClone(source.config);
      if (pair === "windings") {
        c.p = value(0, index);
        c.q = value(1, index);
        if (!full) {
          c.samples = size === 3 ? 480 : 240;
          c.lines = size === 3 ? 48 : 24;
          c.adaptive = false;
        }
      } else {
        c.surface.a = value(0, index);
        c.surface.b = value(1, index);
        if (!full)
          c.surface.uSamples = c.surface.vSamples = size === 3 ? 72 : 48;
      }
      return c;
    };
    const compare = async (full: boolean) => {
      const log = await atlasLog(page);
      const requests = full
        ? [log.requests.at(-1)]
        : log.requests.slice(-size * size);
      const configs = requests.map((r: any) => r.spatial);
      const indexes = full
        ? [size * size - 1]
        : configs.map((_: any, i: number) => i);
      expect(configs).toEqual(indexes.map((i: number) => expected(i, full)));
      return page.evaluate(
        async ({ requests, url, index }) => {
          const logs = (window as any).atlasWorkers;
          const log = logs[index];
          const ordinary = new Worker(url);
          // The comparison's own worker is not the atlas's.
          logs.pop();
          // Deep equality, typed arrays element by element; ids differ.
          const differ = (x: any, y: any, path: string): string => {
            if (ArrayBuffer.isView(x) || ArrayBuffer.isView(y)) {
              const a = x as any,
                b = y as any;
              if (
                !ArrayBuffer.isView(x) ||
                !ArrayBuffer.isView(y) ||
                a.length !== b.length
              )
                return `${path}: typed array lengths`;
              for (let k = 0; k < a.length; k++)
                if (!Object.is(a[k], b[k]))
                  return `${path}[${k}]: ${a[k]} vs ${b[k]}`;
              return "";
            }
            if (x && y && typeof x === "object" && typeof y === "object") {
              const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
              keys.delete("id");
              for (const k of keys) {
                const d = differ(x[k], y[k], `${path}.${k}`);
                if (d) return d;
              }
              return "";
            }
            return Object.is(x, y) ? "" : `${path}: ${x} vs ${y}`;
          };
          const actual = [];
          for (const request of requests) {
            const direct: any = await new Promise((resolve) => {
              ordinary.onmessage = (e) => resolve(e.data);
              ordinary.postMessage({
                id: 1e6 + request.id,
                action: "spatial",
                spatial: request.spatial,
                base: location.origin + "/",
              });
            });
            const reply = log.replies.find((r: any) => r.id === request.id);
            const d = differ(reply, direct, "");
            if (d)
              throw new Error(
                `request ${request.id} differs from a direct request at ${d}`,
              );
            // The definition checks read the lifted arrays, not the mesh.
            actual.push(
              reply.error
                ? { error: reply.error }
                : {
                    result: { ...reply.result, mesh: undefined },
                    lifted: {
                      places: reply.lifted.places,
                      floats: Array.from(reply.lifted.floats),
                    },
                  },
            );
          }
          ordinary.terminate();
          return actual;
        },
        { requests, url: log.url, index: atlasWorker },
      );
    };
    const replies = await compare(false);
    // The definition at the displayed values, from the returned geometry.
    let valid = 0;
    replies.forEach((reply: any, index: number) => {
      const x = value(0, index),
        y = value(1, index);
      if (reply.error) {
        expect(pair === "windings" && gcd(x, y) !== 1, `${x}, ${y}`).toBe(true);
        return;
      }
      valid++;
      const result = restore(reply.result, reply.lifted) as any;
      if (pair === "windings") {
        const { radius: R, tube: r } = source.config;
        const n = result.base.length - 1;
        let residual = 0;
        result.base.forEach((p: any, k: number) => {
          const t = (2 * Math.PI * k) / n;
          const rho = R + r * Math.cos(y * t);
          residual = Math.max(
            residual,
            Math.hypot(
              p.x - rho * Math.cos(x * t),
              p.y - rho * Math.sin(x * t),
              p.z - r * Math.sin(y * t),
            ),
          );
        });
        expect(n).toBeGreaterThan(200);
        expect(residual, `${x}, ${y}`).toBeLessThan(1e-9);
      } else {
        const c = source.config.surface.c;
        let points = 0,
          residual = 0;
        for (const row of result.surface.surface.points)
          for (const p of row) {
            if (!p) continue;
            points++;
            residual = Math.max(
              residual,
              Math.abs((p.x / x) ** 2 + (p.y / y) ** 2 + (p.z / c) ** 2 - 1),
            );
          }
        expect(points).toBeGreaterThan(100);
        expect(residual, `${x}, ${y}`).toBeLessThan(1e-12);
      }
    });
    expect(valid).toBe(
      pair === "windings"
        ? replies.filter(
            (_: any, i: number) => gcd(value(0, i), value(1, i)) === 1,
          ).length
        : size * size,
    );
    // Unavailable cells keep the engine's reason beside them.
    if (pair === "windings" && size === 5)
      await expect(
        atlas.locator('.atlas-cell[data-state="invalid"] .field-error').first(),
      ).toContainText("coprime");
    // Inspection is the original-quality request.
    await atlas
      .getByRole("button", {
        name: `Inspect row ${size}, column ${size}`,
        exact: true,
      })
      .click();
    await expect(atlas.locator(".atlas-inspected-art img")).toBeVisible();
    await compare(true);
  });
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : Math.abs(a));

const views = (atlas: any) =>
  atlas
    .locator(".atlas-cell img")
    .evaluateAll((images: HTMLImageElement[]) =>
      images.map((i) => JSON.parse(i.dataset.view!)),
    );

test("spatial atlas framing: each variant about its own bounds, or one sphere holding every variant after all settle", async ({
  page,
}) => {
  const source = await study(focal);
  // A cut and see-through sheets travel with every cell's drawing.
  source.cut = { ...source.cut, enabled: true };
  source.projection = "narrow";
  await observeWorkers(page, 120);
  await openStudy(page, source);
  const atlas = await openAtlas(page);
  await outcomes(atlas, 3);
  await expect(atlas.locator(".atlas-cell img")).toHaveCount(9);
  const log = await atlasLog(page);
  const bounds = log.replies
    .slice(-9)
    .sort((a: any, b: any) => a.id - b.id)
    .map((r: any) => r.bounds);
  const independent = await views(atlas);
  independent.forEach((view: any, i: number) => {
    expect({ center: view.center, radius: view.radius }).toEqual(bounds[i]);
    // The source's manual camera and projection.
    expect(view).toMatchObject({ ...source.view, projection: "narrow" });
  });
  // Shared: nothing is drawn until every cell settles, then every cell has
  // one sphere containing every member's, touching the farthest.
  await atlas.getByLabel("Framing", { exact: true }).selectOption("shared");
  await generate(atlas);
  await expect(atlas.locator(".atlas-placeholder").first()).toBeVisible();
  const seen = new Set<number>();
  while ((await atlas.locator('.atlas-cell[data-state="pending"]').count()) > 0)
    seen.add(await atlas.locator(".atlas-cell img").count());
  expect([...seen]).toEqual([0]);
  await expect(atlas.locator(".atlas-cell img")).toHaveCount(9);
  const shared = await views(atlas);
  const common = { center: shared[0].center, radius: shared[0].radius };
  for (const view of shared)
    expect({ center: view.center, radius: view.radius }).toEqual(common);
  const reach = bounds.map(
    (b: any) =>
      Math.hypot(
        b.center.x - common.center.x,
        b.center.y - common.center.y,
        b.center.z - common.center.z,
      ) + b.radius,
  );
  for (const r of reach)
    expect(r).toBeLessThanOrEqual(common.radius * (1 + 1e-12));
  expect(Math.max(...reach)).toBeCloseTo(common.radius, 12);
  // Switching back redraws the same results without asking again.
  const requests = (await atlasLog(page)).requests.length;
  await atlas
    .getByLabel("Framing", { exact: true })
    .selectOption("independent");
  await expect
    .poll(async () => (await views(atlas)).map((v: any) => v.radius))
    .toEqual(bounds.map((b: any) => b.radius));
  expect((await atlasLog(page)).requests.length).toBe(requests);
});

test("spatial atlas adoption changes only the pair, keeps the study's state and Reset view, and links and exports the variant", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/?study=3d");
  await settled(page);
  await choosePreset(page, { label: focal });
  await settled(page);
  const canvas = page.locator(".spatial-stage canvas").first();
  const home = JSON.parse((await canvas.getAttribute("data-view"))!);
  // Edit the study: raw text, the cut, a turned camera.
  const c = page.getByLabel("Axis c", { exact: true });
  await c.fill("7/10");
  await settled(page);
  await canvas.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await settled(page);
  const before = await copiedStudy(page);
  const atlas = await openAtlas(page);
  await outcomes(atlas, 3);
  await atlas
    .getByRole("button", { name: "Inspect row 1, column 3", exact: true })
    .click();
  const adopt = atlas.getByRole("button", {
    name: "Adopt variant",
    exact: true,
  });
  await expect(adopt).toBeEnabled();
  await adopt.click();
  await expect(atlas).toBeHidden();
  await settled(page);
  // Raw text stays.
  await expect(c).toHaveValue("7/10");
  const after = await copiedStudy(page);
  expect(after.study.config.surface).toEqual({
    ...before.study.config.surface,
    a: 2.25,
    b: 0.5,
  });
  expect({ ...after.study, config: null }).toEqual({
    ...before.study,
    config: null,
  });
  // A real export carries the adopted semi-axes.
  await page.getByRole("button", { name: "Export image", exact: true }).click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "SVG · embedded 3D image", exact: true })
    .click();
  const svg = (await readFile((await (await download).path())!)).toString();
  const desc = JSON.parse(
    svg
      .match(/<desc>(.*?)<\/desc>/s)![1]
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&"),
  );
  expect([desc.config.surface.a, desc.config.surface.b]).toEqual([2.25, 0.5]);
  // Reset view still returns to the example's opening view.
  await page.getByRole("button", { name: "Reset view", exact: true }).click();
  await expect
    .poll(async () => {
      const v = JSON.parse((await canvas.getAttribute("data-view"))!);
      return [v.yaw, v.pitch, v.zoom, v.panX, v.panY];
    })
    .toEqual([home.yaw, home.pitch, home.zoom, home.panX, home.panY]);
  // The link reopens the adopted study.
  await page.goto(after.url);
  await settled(page);
  expect((await copiedStudy(page)).study).toEqual(after.study);
});

test("spatial atlas adopts any coprime windings and the winding control shows them", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const source = await study(trefoil);
  await openStudy(page, source);
  const atlas = await openAtlas(page);
  await outcomes(atlas, 3);
  // p 1, 3, 5 and q 1, 3, 5: row 2, column 3 is (5, 3), not a curated pair.
  await atlas
    .getByRole("button", { name: "Inspect row 2, column 3", exact: true })
    .click();
  await atlas
    .getByRole("button", { name: "Adopt variant", exact: true })
    .click();
  await settled(page);
  const winding = page.getByLabel("Knot winding", { exact: true });
  await expect(winding).toHaveValue("5,3");
  await expect(winding.locator("option:checked")).toHaveText(
    "5 around · 3 through",
  );
  const { study: adopted } = await copiedStudy(page);
  expect({ ...adopted.config, p: 2, q: 3 }).toEqual(source.config);
  expect([adopted.config.p, adopted.config.q]).toEqual([5, 3]);
  // A curated choice from there is an ordinary edit.
  await winding.selectOption("3,4");
  await settled(page);
  await expect(winding.locator("option")).toHaveCount(6);
});

test("spatial atlas cancel writes nothing back and keeps raw text", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await openStudy(page, await study(trefoil));
  const radius = page.getByLabel("Major radius R", { exact: true });
  await radius.fill("12/5");
  await settled(page);
  const before = await copiedStudy(page);
  const atlas = await openAtlas(page);
  await outcomes(atlas, 3);
  await atlas
    .getByRole("button", { name: "Inspect row 1, column 1", exact: true })
    .click();
  await expect(
    atlas.getByRole("button", { name: "Adopt variant", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(atlas).toBeHidden();
  // Focus returns to the entry, enabled again on the unchanged study.
  await expect(
    page.getByRole("button", { name: "Explore parameter atlas", exact: true }),
  ).toBeFocused();
  await expect(radius).toHaveValue("12/5");
  expect((await copiedStudy(page)).study).toEqual(before.study);
});

test("spatial atlas navigation during mesh work dismisses it, stops its worker and keeps the study", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await observeWorkers(page, 400);
  const source = await study(trefoil);
  await openStudy(page, source);
  const before = await copiedStudy(page);
  // Switching notebooks while previews compute.
  let atlas = await openAtlas(page);
  await expect(atlas.locator(".atlas-placeholder").first()).toBeVisible();
  // The modal's own notebook switch.
  await atlas.getByRole("radio", { name: "2D studies" }).click();
  await expect(atlas).toBeHidden();
  expect((await atlasLog(page)).terminated).toBe(true);
  // History back while previews compute.
  await page.goBack();
  await settled(page);
  atlas = await openAtlas(page);
  await expect(atlas.locator(".atlas-placeholder").first()).toBeVisible();
  await page.evaluate(() => history.pushState(null, "", location.href));
  await page.goBack();
  await expect(atlas).toBeHidden();
  expect((await atlasLog(page)).terminated).toBe(true);
  // A link opened while previews compute replaces the study.
  atlas = await openAtlas(page);
  await expect(atlas.locator(".atlas-placeholder").first()).toBeVisible();
  const other = await study("Cinquefoil · (2, 5)");
  await page.evaluate(
    (hash) => (location.hash = hash),
    link(other).split("#")[1],
  );
  await expect(atlas).toBeHidden();
  expect((await atlasLog(page)).terminated).toBe(true);
  await settled(page);
  await page.waitForTimeout(800);
  expect((await copiedStudy(page)).study.config).toEqual(other.config);
  expect(before.study.config).toEqual(source.config);
});

test("spatial atlas ranges: whole-number errors name the endpoint, and invalid variants stay unavailable beside valid ones", async ({
  page,
}) => {
  await openStudy(page, await study(trefoil));
  let atlas = await openAtlas(page);
  await outcomes(atlas, 3);
  await setRange(atlas, "Windings around p", [1, 4]);
  await expect(
    atlas
      .getByText(
        "Windings around p to must exceed windings around p from by a multiple of 2, so every grid value is a whole number.",
      )
      .first(),
  ).toBeVisible();
  await expect(
    atlas.getByRole("button", { name: "Generate atlas", exact: true }),
  ).toBeDisabled();
  // Values outside the engine's range are cells, never clamped.
  await setRange(atlas, "Windings around p", [0, 10]);
  await generate(atlas);
  await outcomes(atlas, 3);
  await expect(atlas.locator(".atlas-values").first()).toContainText("p = 0");
  await expect(
    atlas.locator('.atlas-cell[data-state="invalid"]').first(),
  ).toContainText("coprime");
  await expect(atlas.locator(".atlas-cell img")).toHaveCount(
    await atlas.locator('.atlas-cell[data-state="valid"]').count(),
  );
  await page.keyboard.press("Escape");
  await openStudyFromGallery(page, focal);
  atlas = await openAtlas(page);
  await setRange(atlas, "Axis a", [-1, 1]);
  await generate(atlas);
  await outcomes(atlas, 3);
  // a = −1 and a = 0 are not semi-axes.
  await expect(atlas.locator('.atlas-cell[data-state="invalid"]')).toHaveCount(
    6,
  );
  await expect(
    atlas.locator('.atlas-cell[data-state="invalid"]').first(),
  ).toContainText("semi-axes a, b and c must be finite, positive");
  await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(3);
});
async function openStudyFromGallery(page: Page, name: string) {
  await choosePreset(page, { label: name });
  await settled(page);
}

test("spatial atlas shows a lost drawing apart from an unavailable variant and still adopts it", async ({
  page,
}) => {
  await openStudy(page, await study(trefoil));
  // Drawings made off the page fail from here on; the notebook's own canvas
  // keeps its context.
  await page.evaluate(() => {
    const native = HTMLCanvasElement.prototype.getContext;
    (HTMLCanvasElement.prototype as any).getContext = function (
      this: HTMLCanvasElement,
      kind: string,
      ...rest: any[]
    ) {
      if (kind === "webgl" && !this.isConnected) return null;
      return (native as any).call(this, kind, ...rest);
    };
  });
  const atlas = await openAtlas(page);
  await outcomes(atlas, 3);
  await expect(atlas.getByText("Could not be drawn").first()).toBeVisible();
  await expect(atlas.locator(".atlas-cell .field-error").first()).toContainText(
    "needs WebGL",
  );
  await expect(atlas.locator(".atlas-cell img")).toHaveCount(0);
  await atlas
    .getByRole("button", { name: "Inspect row 2, column 1", exact: true })
    .click();
  await expect(
    atlas.getByText(
      /This variant could not be drawn: .*It can still be adopted\./,
    ),
  ).toBeVisible();
  await atlas
    .getByRole("button", { name: "Adopt variant", exact: true })
    .click();
  await expect(atlas).toBeHidden();
  await expect(page.getByLabel("Knot winding", { exact: true })).toHaveValue(
    "1,3",
  );
});

test("spatial atlas entry follows the study's pair and admission", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await settled(page);
  const entry = page.getByRole("button", {
    name: "Explore parameter atlas",
    exact: true,
  });
  await expect(entry).toBeEnabled();
  await page
    .getByLabel("Spatial definition", { exact: true })
    .selectOption("parametric");
  await settled(page);
  await expect(entry).toBeDisabled();
  await page.getByRole("button", { name: "About parameter atlas" }).click();
  await expect(
    page.getByText(
      "Compare nearby knots, ellipsoids or implicit level surfaces, then adopt one.",
    ),
  ).toBeVisible();
});

test("spatial atlas shared bounds hold every member, touch the farthest and ignore order", async () => {
  const { sharedBounds, paintView } =
    await import("../web/spatial/atlas-paint");
  expect(sharedBounds([])).toBeUndefined();
  const one = { center: { x: 1, y: -2, z: 3 }, radius: 0.5 };
  expect(sharedBounds([one])).toEqual(one);
  const members = [
    one,
    { center: { x: -4, y: 0, z: 0 }, radius: 2 },
    { center: { x: 0, y: 5, z: -1 }, radius: 1 },
  ];
  const shared = sharedBounds(members)!;
  // The box holding every sphere: x −6…1.5, y −2.5…6, z −2…3.5.
  expect(shared.center).toEqual({ x: -2.25, y: 1.75, z: 0.75 });
  const reach = members.map(
    (m) =>
      Math.hypot(
        m.center.x - shared.center.x,
        m.center.y - shared.center.y,
        m.center.z - shared.center.z,
      ) + m.radius,
  );
  for (const r of reach) expect(r).toBeLessThanOrEqual(shared.radius);
  expect(Math.max(...reach)).toBe(shared.radius);
  expect(sharedBounds([...members].reverse())).toEqual(shared);
  // The view keeps the camera and names only a non-orthographic projection,
  // and a lens angle only for the chosen lens.
  const style = {
    camera: { yaw: 1, pitch: 0.5, zoom: 2, panX: 0.1, panY: -0.1 },
    lensAngle: 70,
  } as any;
  expect(paintView(one, { ...style, projection: "orthographic" })).toEqual({
    ...style.camera,
    ...one,
  });
  expect(paintView(one, { ...style, projection: "narrow" })).toEqual({
    ...style.camera,
    ...one,
    projection: "narrow",
  });
  expect(paintView(one, { ...style, projection: "chosen" })).toEqual({
    ...style.camera,
    ...one,
    projection: "chosen",
    lensAngle: 70,
  });
});

test("spatial atlas counts a mesh's typed arrays toward its retained-geometry limit", async () => {
  const { SpatialAtlas } = await import("../web/spatial/atlas");
  const { presetStudy } = await import("../web/spatial/link");
  const study = presetStudy(presetIndex(trefoil));
  let state: any;
  // Each reply holds a mesh of 1.5 million numbers in typed arrays.
  const atlas = new SpatialAtlas(
    {
      computeSpatial: async (c: SpatialConfig) =>
        ({
          config: c,
          result: {
            bounds: { center: { x: 0, y: 0, z: 0 }, radius: 1 },
            mesh: {
              vertices: new Float64Array(1_000_000),
              triangles: new Int32Array(500_000),
            },
          },
        }) as any,
    },
    (s) => (state = s),
  );
  atlas.generate(
    study,
    { p: [1, 5], q: [1, 5] },
    { pair: "windings", size: 3 },
  );
  await expect
    .poll(
      () =>
        state.queued +
        state.cells.filter((c: any) => !c.frame && !c.error).length,
    )
    .toBe(0);
  // Two meshes fit in four million numbers; the third does not.
  expect(state.cells.map((c: any) => (c.frame ? "·" : "x")).join("")).toBe(
    "··xxxxxxx",
  );
  expect(state.cells[2].error).toMatch(/geometry limit/);
});

// ---- Implicit level / shape, admitted after the measured research ----
const dropsTitle = "Two drops meeting";
test("implicit spatial atlas: parsed facts match the current F, and only active a admits the pair", async () => {
  const { spatialAtlasEntryHelp } = await import("../web/spatial/atlas");
  const { helpText } = await import("../web/help");
  expect(helpText(spatialAtlasEntryHelp)).toContain("F reads a");
  expect(helpText(spatialAtlasEntryHelp)).toContain("400,000 base cells");
  expect(helpText(spatialAtlasEntryHelp)).toContain("2,000,000 section cells");
  const { spatialAtlasFacts, spatialAtlasPairs, spatialAtlasPair } =
    await import("../web/spatial/atlas");
  const c = config(dropsTitle);
  const frame = { config: c, result: { implicit: { usesA: true } } } as any;
  expect(spatialAtlasFacts(frame, c)).toEqual({ usesA: true });
  expect(spatialAtlasFacts(null, c)).toEqual({ usesA: false });
  expect(
    spatialAtlasFacts(frame, { ...c, implicit: { ...c.implicit, f: "x+y+z" } }),
  ).toEqual({ usesA: false });
  expect(
    spatialAtlasFacts({ ...frame, config: { ...c, format: "torus" } }, c),
  ).toEqual({ usesA: false });
  expect(spatialAtlasPairs(c)).toEqual([]);
  expect(spatialAtlasPairs(c, { usesA: false })).toEqual([]);
  expect(spatialAtlasPairs(c, { usesA: true }).map((p) => p.id)).toEqual([
    "level",
  ]);
  expect(
    spatialAtlasPairs(config(trefoil), { usesA: true }).map((p) => p.id),
  ).toEqual(["windings"]);
  expect(spatialAtlasPair("level").axes.map((a) => a.path)).toEqual([
    ["implicit", "level"],
    ["implicit", "a"],
  ]);
});

test("implicit spatial atlas: defaults and cloned quality preserve the source's non-axis settings", async () => {
  const { spatialAtlasDefaults, spatialPreviewConfig } =
    await import("../web/spatial/atlas");
  const c = config(dropsTitle);
  c.implicit.refine = 3;
  const original = structuredClone(c);
  expect(spatialAtlasDefaults(c, "level")).toEqual({
    level: [0.65, 1.15],
    a: [0.75, 1.25],
  });
  for (const size of [3, 5] as const) {
    const expected = structuredClone(c);
    expected.implicit.cells = size === 3 ? 24 : 16;
    expected.implicit.refine = 0;
    expect(spatialPreviewConfig(c, size)).toEqual(expected);
  }
  expect(c).toEqual(original);
  c.implicit.cells = 8;
  expect(spatialPreviewConfig(c, 5).implicit.cells).toBe(8);
  c.implicit.level = 1.15;
  expect(spatialAtlasDefaults(c, "level").level).toEqual([0.8625, 1.4375]);
});

test("implicit spatial atlas: anisotropic and section reservations include the original inspection", async () => {
  const { spatialAtlasBudget } = await import("../web/spatial/atlas");
  const c = config(dropsTitle);
  c.implicit.box = {
    xMin: -2,
    xMax: 2,
    yMin: -1,
    yMax: 1,
    zMin: -0.5,
    zMax: 0.5,
  };
  c.implicit.cells = 64;
  c.implicit.sections.count = 7;
  expect(spatialAtlasBudget(c, 3, { usesA: true })).toMatchObject({
    grid: 9 * 24 * 12 * 6 + 64 * 32 * 16,
    sections: 9 * 7 * 96 ** 2 + 7 * 256 ** 2,
    points: 0,
    cells: 0,
    geodesic: 0,
  });
  expect(spatialAtlasBudget(c, 3, { usesA: true }).error).toBeUndefined();
  expect(spatialAtlasBudget(c, 3).error).toContain("no curated");
  c.implicit.sections.count = 24;
  expect(spatialAtlasBudget(c, 3, { usesA: true }).error).toContain("section");
  expect(spatialAtlasBudget(c, 5, { usesA: true }).sections).toBe(
    25 * 24 * 64 ** 2 + 24 * 256 ** 2,
  );
  // Twelve sections fit 3 × 3 (148,480 each) but not 5 × 5 (167,936 each),
  // so the 5 × 5 refusal offers the smaller grid, as knots and ellipsoids do.
  c.implicit.sections.count = 12;
  expect(spatialAtlasBudget(c, 3, { usesA: true }).error).toBeUndefined();
  expect(spatialAtlasBudget(c, 5, { usesA: true }).error).toBe(
    "The 5 × 5 atlas reserves more than 2,000,000 section cells. Choose 3 × 3, or reduce the section count or source grid.",
  );
  c.implicit.sections.count = 24;
  expect(spatialAtlasBudget(c, 5, { usesA: true }).error).toBe(
    "The atlas reserves more than 2,000,000 section cells. Reduce the section count or source grid.",
  );
});

test("implicit spatial atlas browser: quality readouts count sections and refinement levels", async ({
  page,
}) => {
  const source = await study("Villarceau circles");
  source.config.implicit.refine = 1;
  expect(source.config.implicit.sections.count).toBe(1);
  await openStudy(page, source);
  const atlas = await openAtlas(page);
  await expect(atlas.locator(".atlas-quality")).toContainText(
    "Preview quality: 24 cells along the longest box side, 0 refinement levels, 1 section.",
  );
  await expect(atlas.getByText(/^Original quality:/)).toHaveText(
    "Original quality: 64 cells along the longest box side, 1 refinement level, 1 section.",
  );
});

test("implicit spatial atlas: the production queue inspects at source quality and changes only the pair", async () => {
  const { SpatialAtlas } = await import("../web/spatial/atlas");
  const source = await study(dropsTitle);
  const before = structuredClone(source);
  const calls: any[] = [];
  const atlas = new SpatialAtlas(
    {
      computeSpatial: async (config) => {
        calls.push(config);
        return { config, result: {} } as any;
      },
    },
    () => {},
  );
  atlas.generate(
    source,
    { level: [0.6, 1.4], a: [0.8, 1.2] },
    { pair: "level", size: 3, facts: { usesA: true } },
  );
  await expect
    .poll(() => atlas.state.cells.filter((c) => c.frame).length)
    .toBe(9);
  expect(calls[0]).toEqual({
    ...before.config,
    implicit: {
      ...before.config.implicit,
      cells: 24,
      refine: 0,
      level: 0.6,
      a: 0.8,
    },
  });
  atlas.inspect(0);
  await expect.poll(() => !!atlas.candidate()).toBe(true);
  expect(atlas.candidate()).toEqual({
    ...before,
    config: {
      ...before.config,
      implicit: { ...before.config.implicit, level: 0.6, a: 0.8 },
    },
  });
  expect(calls.at(-1)).toEqual({
    ...before.config,
    implicit: { ...before.config.implicit, level: 0.6, a: 0.8 },
  });
  expect(source).toEqual(before);
});

for (const size of [3, 5] as const)
  test(
    "implicit spatial atlas browser: ordinary entry, every sphere request and full inspection " +
      size,
    async ({ page }) => {
      const source = await study(dropsTitle);
      Object.assign(source.config.implicit, {
        f: "x^2+y^2+z^2-a",
        cells: 40,
        refine: 1,
        box: { xMin: -2, xMax: 2, yMin: -2, yMax: 2, zMin: -2, zMax: 2 },
      });
      await observeWorkers(page);
      await openStudy(page, source);
      const atlas = await openAtlas(page);
      await atlas
        .getByLabel("Grid size", { exact: true })
        .selectOption(String(size));
      await setRange(atlas, "Level c", [-0.5, 1.5]);
      await setRange(atlas, "Shape parameter a", [-0.5, 1.5]);
      await generate(atlas);
      await outcomes(atlas, size);
      await expect(atlas.locator(".atlas-quality")).toContainText(
        (size === 3 ? "24" : "16") + " cells",
      );
      await expect(atlas.locator(".atlas-quality")).toContainText("topology");
      const log = await atlasLog(page);
      const requests = log.requests.slice(-(size ** 2));
      requests.forEach((q: any, i: number) => {
        const expected = structuredClone(source.config);
        expected.implicit.cells = size === 3 ? 24 : 16;
        expected.implicit.refine = 0;
        expected.implicit.level = -0.5 + (2 * (i % size)) / (size - 1);
        expected.implicit.a = -0.5 + (2 * Math.floor(i / size)) / (size - 1);
        expect(q.spatial).toEqual(expected);
      });
      const observations = await page.evaluate(
        async ({ index, url }) => {
          const log = (window as any).atlasWorkers[index];
          const ordinary = new Worker(url);
          (window as any).atlasWorkers.pop();
          const differ = (a: any, b: any): boolean => {
            if (Object.is(a, b)) return false;
            if (!a || !b || typeof a !== "object" || typeof b !== "object")
              return true;
            const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
            keys.delete("id");
            return [...keys].some((k) => differ(a[k], b[k]));
          };
          let vertices = 0,
            empty = 0,
            residual = 0;
          for (const request of log.requests.slice(
            -(
              Number(
                document
                  .querySelector(".atlas-grid")!
                  .getAttribute("data-size"),
              ) ** 2
            ),
          )) {
            const direct: any = await new Promise((resolve) => {
              ordinary.onmessage = (e) => resolve(e.data);
              ordinary.postMessage({ ...request, id: 1e6 + request.id });
            });
            const reply = log.replies.find((r: any) => r.id === request.id);
            if (differ(reply, direct))
              throw new Error("Direct worker mismatch");
            // Mesh positions are already typed in the real worker reply.
            const p = reply.result.implicit.positions;
            if (!p.length) empty++;
            for (let k = 0; k < p.length; k += 3) {
              vertices++;
              residual = Math.max(
                residual,
                Math.abs(
                  p[k] ** 2 +
                    p[k + 1] ** 2 +
                    p[k + 2] ** 2 -
                    request.spatial.implicit.a -
                    request.spatial.implicit.level,
                ),
              );
            }
          }
          ordinary.terminate();
          return { vertices, empty, residual };
        },
        { index: atlasWorker, url: log.url },
      );
      expect(observations.vertices).toBeGreaterThan(100);
      expect(observations.empty).toBeGreaterThan(0);
      expect(observations.residual).toBeLessThan(1e-8);
      await atlas
        .getByRole("button", {
          name: "Inspect row " + size + ", column " + size,
          exact: true,
        })
        .click();
      await expect(
        atlas.getByRole("button", { name: "Adopt variant", exact: true }),
      ).toBeEnabled();
      const inspected = (await atlasLog(page)).requests.at(-1).spatial;
      expect(inspected.implicit.cells).toBe(40);
      expect(inspected.implicit.refine).toBe(1);
      expect(inspected).toEqual({
        ...source.config,
        implicit: { ...source.config.implicit, level: 1.5, a: 1.5 },
      });
      expect(
        await page.evaluate(async (index) => {
          const log = (window as any).atlasWorkers[index],
            q = log.requests.at(-1);
          const worker = new Worker(log.url);
          (window as any).atlasWorkers.pop();
          const direct: any = await new Promise((resolve) => {
            worker.onmessage = (e) => resolve(e.data);
            worker.postMessage({ ...q, id: 99999 });
          });
          worker.terminate();
          const actual = log.replies.find((r: any) => r.id === q.id);
          const equal = (a: any, b: any): boolean =>
            Object.is(a, b) ||
            (!!a &&
              !!b &&
              typeof a === "object" &&
              typeof b === "object" &&
              [...new Set([...Object.keys(a), ...Object.keys(b)])]
                .filter((k) => k !== "id")
                .every((k) => equal(a[k], b[k])));
          return (
            equal(actual, direct) && actual.result.implicit.positions.length > 0
          );
        }, atlasWorker),
      ).toBe(true);
    },
  );

test("implicit spatial atlas browser: a dormant or superseded F cannot enter", async ({
  page,
}) => {
  const source = await study(dropsTitle);
  source.config.implicit.f = "atan(x)+y+z";
  await openStudy(page, source);
  await expect(
    page.getByRole("button", { name: "Explore parameter atlas", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("F(x, y, z)", { exact: true }).fill("x^2+y^2+z^2-a");
  await expect(
    page.getByRole("button", { name: "Explore parameter atlas", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("F(x, y, z)", { exact: true }).fill("x^2+y^2+z^2-1");
  await settled(page);
  await expect(
    page.getByRole("button", { name: "Explore parameter atlas", exact: true }),
  ).toBeDisabled();
});

test("spatial atlas range edits interrupt in-flight work before scalar parsing", async ({
  page,
}) => {
  await observeWorkers(page, 1500);
  await openStudy(page, await study(trefoil));
  const atlas = await openAtlas(page);
  const old = atlasWorker;
  await atlas.getByLabel("Windings around p from", { exact: true }).fill("1+0");
  await expect
    .poll(() =>
      page.evaluate((i) => (window as any).atlasWorkers[i].terminated, old),
    )
    .toBe(true);
  // Delay only the old generation whose cancellation is under test.
  await page.evaluate(() => {
    (window as any).atlasDelay = 0;
  });
  await expect(
    atlas.getByRole("button", { name: "Generate atlas", exact: true }),
  ).toBeEnabled();
  await atlas
    .getByRole("button", { name: "Generate atlas", exact: true })
    .click();
  await outcomes(atlas, 3);
  await expect(
    atlas.getByLabel("Windings around p from", { exact: true }),
  ).toHaveValue("1+0");
  await expect(atlas.getByRole("alert")).toHaveCount(0);
});

test("implicit spatial atlas browser: cancel and edit adoption preserve raw drafts, camera home and full study", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const source = await study(dropsTitle);
  source.view = { ...source.view, zoom: 1.3, panX: 0.1, panY: -0.2 };
  source.animation = {
    ...source.animation,
    mode: "parameters",
    camera: "current",
    duration: 2,
    tracks: [{ target: "level", from: "0.6", to: "1.4" }],
  };
  await openStudy(page, source);
  await page.getByLabel("Normal x", { exact: true }).fill("7/10");
  await page.getByLabel("x from", { exact: true }).fill("-8/5");
  await settled(page);
  const before = (await copiedStudy(page)).study;
  let atlas = await openAtlas(page);
  await atlas
    .getByRole("button", { name: "Cancel atlas", exact: true })
    .click();
  await expect(page.getByLabel("Normal x", { exact: true })).toHaveValue(
    "7/10",
  );
  await expect(page.getByLabel("x from", { exact: true })).toHaveValue("-8/5");
  expect((await copiedStudy(page)).study).toEqual(before);
  atlas = await openAtlas(page);
  await outcomes(atlas, 3);
  await atlas
    .getByRole("button", { name: "Inspect row 3, column 3", exact: true })
    .click();
  await expect(
    atlas.getByRole("button", { name: "Adopt variant", exact: true }),
  ).toBeEnabled();
  await atlas
    .getByRole("button", { name: "Adopt variant", exact: true })
    .click();
  await settled(page);
  await expect(page.getByLabel("Normal x", { exact: true })).toHaveValue(
    "7/10",
  );
  await expect(page.getByLabel("x from", { exact: true })).toHaveValue("-8/5");
  const after = (await copiedStudy(page)).study;
  expect(after).toEqual({
    ...before,
    config: {
      ...before.config,
      implicit: { ...before.config.implicit, level: 1.15, a: 1.25 },
    },
  });
  await page.getByRole("button", { name: "Reset view", exact: true }).click();
  await expect
    .poll(async () => {
      const v = JSON.parse(
        (await page.locator("#spatial-artwork").getAttribute("data-view"))!,
      );
      return [v.zoom, v.panX, v.panY];
    })
    // A link's Home is the default; its held manual view above is separate.
    .toEqual([1, 0, 0]);
  await page.getByRole("button", { name: "Export image", exact: true }).click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "SVG · embedded 3D image", exact: true })
    .click();
  const svg = await readFile((await (await download).path())!, "utf8");
  const desc = JSON.parse(
    svg
      .match(/<desc>(.*?)<\/desc>/s)![1]
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&"),
  );
  expect(desc.config.implicit).toEqual(after.config.implicit);
  const png = svg.match(/data:image\/png;base64,[^"]+/)![0];
  const decoded = await page.evaluate(async (src) => {
    const image = new Image();
    image.src = src;
    await image.decode();
    return [image.naturalWidth, image.naturalHeight];
  }, png);
  expect(decoded[0]).toBeGreaterThanOrEqual(1000);
  expect(decoded[1]).toBeGreaterThanOrEqual(760);
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Back to study", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Level c = 1.40000", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Back to study", exact: true })
    .click();
  await settled(page);
  await expect(page.getByLabel("Level c", { exact: true })).toHaveValue("1.15");
});

test("implicit spatial atlas browser: entry explains a valid source's section reservation refusal", async ({
  page,
}) => {
  const source = await study(dropsTitle);
  source.config.implicit.cells = 32;
  source.config.implicit.sections.count = 24;
  await openStudy(page, source);
  await expect(
    page.getByRole("button", { name: "Explore parameter atlas", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".atlas-entry .note[role=status]")).toContainText(
    "Reduce the section count or source grid",
  );
});

for (const [f, expected] of [
  ["sqrt(x-a)+y^2+z^2", "not finite"],
  ["1/(x-a)+y^2+z^2", "pole or a jump"],
  ["x^2+y^2+z^2-a", "No surface"],
] as const)
  test(
    "implicit spatial atlas browser: mesh diagnostics remain inspectable for " +
      f,
    async ({ page }) => {
      const source = await study(dropsTitle);
      source.config.implicit.f = f;
      source.config.implicit.cells = 24;
      source.config.implicit.sections.count = 0;
      if (expected === "No surface") {
        source.config.implicit.a = -10;
        source.config.implicit.level = -10;
      }
      await openStudy(page, source);
      const atlas = await openAtlas(page);
      await outcomes(atlas, 3);
      const first = atlas.locator(".atlas-cell").first();
      await first.getByText("Preview mesh details", { exact: true }).click();
      await expect(first.locator(".atlas-mesh-details")).toContainText(
        expected,
      );
      await first
        .getByRole("button", { name: "Inspect row 1, column 1", exact: true })
        .click();
      await expect(
        atlas.getByRole("button", { name: "Adopt variant", exact: true }),
      ).toBeEnabled();
      await atlas.getByText("Mesh details", { exact: true }).click();
      await expect(
        atlas.locator(".atlas-inspection .atlas-mesh-details"),
      ).toContainText(expected);
    },
  );
