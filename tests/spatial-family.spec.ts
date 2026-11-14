import { test, expect, type Page } from "@playwright/test";
import { deflateRawSync } from "node:zlib";
import { presetStudy, spatialStudy } from "../web/spatial/link";
import { settled, copiedStudy } from "./gallery-helpers";
import { open, choosePreset } from "./helpers";

const source = () => {
  const s = presetStudy(0);
  s.config.construction = "orthotomic";
  s.config.samples = 240;
  s.config.lines = 12;
  s.config.adaptive = false;
  return s;
};
const settings = () => ({
  enabled: true,
  target: "tube" as const,
  from: 0.3,
  to: 1.2,
  count: 5,
  selected: 2,
  presentation: "family" as const,
  motion: "reveal" as const,
  width: 3,
});
const link = (study: unknown) =>
  `/#s=${deflateRawSync(JSON.stringify({ v: 1, notebook: "3d", study })).toString("base64url")}`;
async function load(page: Page, study: unknown) {
  await page.goto(link(study));
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
  await settled(page);
}

test("spatial engraving links preserve the complete source and reject malformed settings", () => {
  const s = { ...source(), family: settings() };
  expect(spatialStudy(s)).toEqual(s);
  expect(spatialStudy(source())).not.toHaveProperty("family");
  for (const patch of [
    { count: 33 },
    { selected: 5 },
    { width: 0 },
    { target: "samples" },
    { from: Infinity },
  ])
    expect(() =>
      spatialStudy({ ...s, family: { ...s.family, ...patch } }),
    ).toThrow();
});

test("spatial engraving uses notebook controls, restores source drafts and saves its selected member", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await load(page, source());
  const panel = page.getByRole("region", {
    name: "Spatial finite engraving settings",
  });
  await expect(
    panel.getByLabel("Finite engraving", { exact: true }),
  ).toBeVisible();
  await panel.getByLabel("Finite engraving", { exact: true }).check();
  await panel.locator("details").evaluate((d: HTMLDetailsElement) => {
    d.open = true;
  });
  await expect(panel.getByText(/^16 of 16 members available/)).toBeVisible();
  await panel.getByLabel("Selected member", { exact: true }).selectOption("3");
  await panel
    .getByLabel("Family presentation", { exact: true })
    .selectOption("selected");
  const saved = await copiedStudy(page);
  expect(saved.study.family).toMatchObject({
    enabled: true,
    selected: 3,
    presentation: "selected",
  });
  await panel.getByLabel("Finite engraving", { exact: true }).uncheck();
  await settled(page);
  expect((await copiedStudy(page)).study.config).toEqual(source().config);
  await choosePreset(page, 0);
  await expect(
    panel.getByLabel("Finite engraving", { exact: true }),
  ).not.toBeChecked();
});

import * as family from "../web/spatial/family";
import { buildScene, scenePasses } from "../web/spatial/scene";
import { defaultLayers } from "../web/spatial/renderer";
import { EngineError } from "../web/engine-client";
const resultAt = (x: number) => ({
  base: [
    { x, y: 0, z: 0 },
    { x: x + 1, y: 1, z: 0 },
  ],
  minus: [],
  plus: [],
  breaks: [false, false],
  mesh: {
    vertices: new Float64Array(),
    triangles: new Int32Array(),
    sampleIndex: new Int32Array(),
  },
  rulings: [],
  bounds: { center: { x, y: 0, z: 0 }, radius: 2 },
  radius: 2,
  omitted: 0,
  invalid: 0,
  projection: {
    pole: { x: 0, y: 0, z: 0 },
    points: [
      { x, y: 0, z: 1 },
      { x: x + 1, y: 1, z: 1 },
    ],
    feet: [],
    constructions: [
      {
        sampleIndex: 0,
        contact: { x, y: 0, z: 0 },
        foot: { x, y: 0, z: 1 },
        image: { x, y: 0, z: 2 },
      },
    ],
    collapsed: false,
    invalid: 0,
  },
});

test("spatial family preparation is sequential, retains failed slots, and rejects stale replies", async () => {
  const pending: {
    config: any;
    resolve: (v: any) => void;
    reject: (e: Error) => void;
  }[] = [];
  const engine = {
    computeSpatial: (config: any) =>
      new Promise((resolve, reject) =>
        pending.push({ config, resolve, reject }),
      ),
  };
  const scheduler = new family.SpatialFamily(engine, () => {});
  const c = source().config,
    f = { ...settings(), count: 3, selected: 1, width: 2 };
  scheduler.generate(c, f);
  expect(pending).toHaveLength(1);
  expect(scheduler.state.queued).toBe(2);
  scheduler.generate(c, { ...f, from: 2, to: 4 });
  pending[0].resolve({ config: pending[0].config, result: resultAt(-100) });
  await expect.poll(() => pending.length).toBe(2);
  expect(scheduler.state.members.map((m: any) => m.frame)).toEqual([
    undefined,
    undefined,
    undefined,
  ]);
  pending[1].resolve({ config: pending[1].config, result: resultAt(2) });
  await expect.poll(() => pending.length).toBe(3);
  pending[2].reject(new EngineError("invalid tube", "tube"));
  await expect.poll(() => pending.length).toBe(4);
  pending[3].resolve({ config: pending[3].config, result: resultAt(4) });
  await expect.poll(() => scheduler.state.pending).toBe(false);
  expect(
    scheduler.state.members.map((m: any) => [
      m.id,
      m.value,
      !!m.frame,
      !!m.error,
    ]),
  ).toEqual([
    [0, 2, true, false],
    [1, 3, false, true],
    [2, 4, true, false],
  ]);
  expect(pending.slice(1).map((r) => r.config.tube)).toEqual([2, 3, 4]);
  expect(c).toEqual(source().config);
  scheduler.cancel();
  expect(scheduler.state.members).toEqual([]);
  expect(scheduler.state.retained).toBe(0);
});

test("spatial family composition has fixed bounds, sparse guides, stable slots and no cross-member lines", () => {
  const f = { ...settings(), count: 3, selected: 1, width: 2 };
  const members = [0, 1, 2].map((id) => ({
    id,
    value: id,
    frame: { config: source().config, result: resultAt(id * 4) },
  }));
  const draw = (progress?: number) =>
    family.composeSpatialFamily(source().config, f, members, progress);
  const full = draw(),
    beginning = draw(0),
    end = draw(1);
  expect(beginning.result.bounds).toEqual(full.result.bounds);
  expect(end.result.bounds).toEqual(full.result.bounds);
  expect(beginning.result.engraving.visible).toEqual([0]);
  expect(end.result.engraving.visible).toEqual([0, 1, 2]);
  const passes = scenePasses(buildScene(full.result), defaultLayers);
  expect(
    passes.filter((p) => p.layer === "connectors" && p.batch.data.length),
  ).toHaveLength(2);
  expect(
    passes.filter((p) => p.layer === "base" && p.batch.data.length),
  ).toHaveLength(3);
  expect(
    passes.filter((p) => p.layer === "projection" && p.batch.data.length),
  ).toHaveLength(3);
  const firstPasses = scenePasses(buildScene(beginning.result), defaultLayers);
  expect(
    firstPasses.filter((p) => p.layer === "connectors" && p.batch.data.length),
  ).toHaveLength(0);
  for (const p of passes.filter(
    (p) => p.layer === "base" && p.batch.data.length,
  ))
    expect(p.batch.data.length).toBe(14);
  const invalid = members.map((m, i) =>
    i === 1 ? { id: m.id, value: m.value, error: "no finite curve" } : m,
  );
  const window = family.composeSpatialFamily(
    source().config,
    { ...f, motion: "window", width: 1 },
    invalid,
    0.5,
  );
  expect(window.result.engraving.visible).toEqual([1]);
  expect(window.result.unavailable).toMatch(/visible/);
  expect(
    family.composeSpatialFamily(source().config, f, members, 0).result,
  ).toEqual(beginning.result);
  expect(members[1].frame.result.bounds.radius).toBe(2);
});

test("spatial family reservations count refinement, hidden geometry and unsupported cases", () => {
  const c = source().config,
    f = settings();
  expect(family.spatialFamilyBudget(c, f)).toMatchObject({
    points: 5 * 2 * 241,
    error: undefined,
  });
  expect(
    family.spatialFamilyBudget(
      { ...c, samples: 32768, adaptive: true },
      { ...f, count: 32 },
    ).error,
  ).toMatch(/limit/);
  for (const format of [
    "harmonic",
    "field",
    "pursuit",
    "surface",
    "rays",
    "implicit",
  ] as const)
    expect(family.spatialFamilyTargets({ ...c, format })).toEqual([]);
  for (const construction of [
    "developable",
    "involute",
    "framed",
    "ruled",
    "canal",
  ] as const)
    expect(family.spatialFamilyTargets({ ...c, construction })).toEqual([]);
  expect(
    family.spatialFamilyTargets({
      ...c,
      format: "parametric",
      curve: { ...c.curve, x: "t", y: "0", z: "0" },
    }),
  ).toEqual([]);
});

import { imageFile } from "../web/spatial/export";
import { initialView } from "../web/spatial/renderer";
import { familyProgressAt } from "../web/family-motion";
test("spatial engraving seeks and vector files use the same frozen slots and disclose partial output", async () => {
  const f = {
    ...settings(),
    count: 3,
    selected: 1,
    width: 1,
    motion: "window" as const,
  };
  const members = [0, 1, 2].map((id) => ({
    id,
    value: id,
    frame: { config: source().config, result: resultAt(id * 4) },
  }));
  const setup = {
    duration: 4,
    repeat: "back-and-forth" as const,
    pace: "steady" as const,
  };
  const v = {
    ...initialView,
    center: { x: 9, y: 8, z: 7 },
    radius: 20,
    panX: 0.3,
    panY: -0.2,
    zoom: 2,
    projection: "normal" as const,
  };
  for (const time of [0, 0.5, 1, 0.75, 0.25, 0]) {
    const sample = family.sampleSpatialFamily(
      source().config,
      f,
      members,
      setup,
      v,
      time,
      source().config.length,
      "current",
    );
    expect(sample.progress).toBe(familyProgressAt(time, setup));
    expect(sample.heldView).toEqual(v);
    expect(sample.frame.result.bounds).toEqual(
      family.composeSpatialFamily(source().config, f, members).result.bounds,
    );
    const blob = await imageFile(
      sample.frame,
      v,
      defaultLayers,
      false,
      "svg-lines",
      new AbortController().signal,
    );
    const svg = await blob.text();
    const desc = svg
      .match(/<desc>(.*?)<\/desc>/s)![1]
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&amp;", "&");
    expect(JSON.parse(desc).family.visible).toEqual(
      sample.frame.result.engraving.visible,
    );
  }
  const invalid = [{ id: 0, value: 0, error: "invalid" }];
  const empty = family.composeSpatialFamily(
    source().config,
    { ...f, count: 2, selected: 0 },
    invalid,
  );
  await expect(
    imageFile(
      empty,
      v,
      defaultLayers,
      false,
      "svg-lines",
      new AbortController().signal,
    ),
  ).rejects.toThrow(/available/);
});

import { spatialPresets } from "../web/spatial/presets";
import { restore } from "../web/lifted";
const hero = "A knot remembers";
test("the signature engraving is a complete preset with its own valid animation", () => {
  const index = spatialPresets.findIndex((p) => p.name === hero);
  expect(index).toBeGreaterThanOrEqual(0);
  const study = presetStudy(index);
  expect(study.family).toMatchObject({
    enabled: true,
    target: "tube",
    presentation: "family",
  });
  expect(
    family.spatialFamilyBudget(study.config, study.family!).error,
  ).toBeUndefined();
  expect(spatialStudy(study)).toEqual(study);
  expect(study.animation).toMatchObject({
    duration: 3,
    repeat: "back-and-forth",
    pace: "steady",
  });
});
async function observeSpatial(page: Page, delay = 0) {
  await page.addInitScript(
    ({ delay }) => {
      const Native = window.Worker;
      const logs: any[] = [];
      Object.assign(window, { spatialWorkers: logs });
      window.Worker = class extends Native {
        log: any;
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          this.log = {
            url: String(url),
            requests: [],
            replies: [],
            active: 0,
            maximum: 0,
            terminated: false,
          };
          logs.push(this.log);
        }
        postMessage(data: any, options?: any) {
          if (data.action === "spatial" && !data.probeOnly) {
            this.log.active++;
            this.log.maximum = Math.max(this.log.maximum, this.log.active);
            this.log.requests.push({
              ...structuredClone(data),
              observedAt: performance.now(),
            });
          }
          super.postMessage(data, options);
        }
        set onmessage(handler: any) {
          super.onmessage = (event: MessageEvent) => {
            const deliver = () => {
              if (this.log.requests.some((r: any) => r.id === event.data.id)) {
                this.log.active--;
                const q = this.log.requests.find(
                  (r: any) => r.id === event.data.id,
                );
                const mesh = event.data.result?.mesh;
                this.log.replies.push({
                  ...structuredClone(event.data),
                  observedElapsed: performance.now() - q.observedAt,
                  observedBytes:
                    (event.data.lifted?.floats?.byteLength ?? 0) +
                    Object.values(mesh ?? {}).reduce<number>(
                      (n: number, v: any) => n + (v?.byteLength ?? 0),
                      0,
                    ) +
                    new TextEncoder().encode(JSON.stringify(event.data.result))
                      .length,
                });
              }
              handler?.call(this, event);
            };
            if (logs.indexOf(this.log) > 0 && delay) setTimeout(deliver, delay);
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
for (const [format, target, construction, refinedView] of [
  ["torus", "tube", "orthotomic"],
  ["torus", "radius", "tangent-foot"],
  ["parametric", "a", "inversion"],
  ["parametric", "a", "none"],
  ["torus", "tube", "orthotomic", true],
] as const)
  test(`spatial engraving ${target}/${construction}${refinedView ? " at a refined view" : ""} equals independently assigned WASM requests and preserves gaps`, async ({
    page,
  }) => {
    const s = source();
    if (target === "radius") s.config.tube = 0.1;
    s.config.format = format;
    if (refinedView) {
      s.config.adaptive = true;
      s.config.adaptiveView = true;
      s.view.zoom = 40;
    }
    s.config.construction = construction;
    s.config.curve = {
      ...s.config.curve,
      x: "(2+a*cos(3*t))*cos(2*t)",
      y: "(2+a*cos(3*t))*sin(2*t)",
      z: "a*sin(3*t)",
    };
    const f = {
      ...settings(),
      target,
      count: 3,
      selected: 1,
      width: 2,
      from: 0.3,
      to: 0.9,
    };
    await observeSpatial(page);
    await load(page, { ...s, family: f });
    await expect(
      page.getByText("3 of 3 members available.", { exact: true }),
    ).toBeVisible();
    const checks = await page.evaluate(
      async ({ s, target }) => {
        const log = (window as any).spatialWorkers.find(
          (l: any) =>
            l.requests.length >= 3 &&
            l.requests.some(
              (r: any) =>
                (target === "a" ? r.spatial.curve.a : r.spatial[target]) ===
                0.3,
            ),
        );
        if (!log) throw new Error("Family worker not found");
        const requests = log.requests.slice(-3);
        const direct = new Worker(log.url),
          out = [];
        for (let i = 0; i < 3; i++) {
          const c = structuredClone(s.config),
            value = [0.3, 0.6, 0.9][i];
          if (target === "a") c.curve.a = value;
          else (c as any)[target] = value;
          const reply: any = await new Promise((resolve) => {
            direct.onmessage = (e) => resolve(e.data);
            direct.postMessage({
              id: 100 + i,
              action: "spatial",
              spatial: c,
              ...(requests[i].spatialView && {
                spatialView: requests[i].spatialView,
              }),
              base: location.origin + "/",
            });
          });
          const actual = log.replies.find((r: any) => r.id === requests[i].id);
          const canonical = (v: any): any =>
            ArrayBuffer.isView(v)
              ? Array.from(v as any)
              : Array.isArray(v)
                ? v.map(canonical)
                : v && typeof v === "object"
                  ? Object.fromEntries(
                      Object.keys(v)
                        .sort()
                        .map((k) => [k, canonical(v[k])]),
                    )
                  : v;
          out.push({
            same:
              JSON.stringify(
                canonical({ result: actual.result, lifted: actual.lifted }),
              ) ===
              JSON.stringify(
                canonical({ result: reply.result, lifted: reply.lifted }),
              ),
            result: actual.result,
            lifted: {
              places: actual.lifted.places,
              floats: Array.from(actual.lifted.floats),
            },
          });
        }
        direct.terminate();
        return { out, maximum: log.maximum };
      },
      { s, target },
    );
    expect(checks.maximum).toBe(1);
    for (let i = 0; i < 3; i++) {
      expect(checks.out[i].same).toBe(true);
      const r = restore(checks.out[i].result, {
        ...checks.out[i].lifted,
        floats: new Float64Array(checks.out[i].lifted.floats),
      }) as any;
      expect(r.base.filter(Boolean).length).toBeGreaterThan(200);
      const tube = target === "radius" ? s.config.tube : [0.3, 0.6, 0.9][i];
      const radius =
        target === "radius"
          ? [0.3, 0.6, 0.9][i]
          : format === "torus"
            ? s.config.radius
            : 2;
      for (const p of r.base.filter(Boolean))
        expect(
          Math.abs((Math.hypot(p.x, p.y) - radius) ** 2 + p.z ** 2 - tube ** 2),
        ).toBeLessThan(2e-13);
    }
    const before = await page.evaluate(() =>
      (window as any).spatialWorkers.reduce(
        (n: number, l: any) => n + l.requests.length,
        0,
      ),
    );
    await page.getByLabel("Selected member", { exact: true }).selectOption("0");
    await page
      .getByLabel("Family presentation", { exact: true })
      .selectOption("selected");
    await settled(page);
    expect(
      await page.evaluate(() =>
        (window as any).spatialWorkers.reduce(
          (n: number, l: any) => n + l.requests.length,
          0,
        ),
      ),
    ).toBe(before);
  });

const engravingRecord = async (page: Page) =>
  JSON.parse(
    (await page.locator(".spatial-stage").getAttribute("data-engraving"))!,
  );
test("spatial family reveal and band seek frozen slots, preserve camera, and stop on edits", async ({
  page,
}) => {
  await observeSpatial(page);
  const s = { ...source(), family: settings() };
  s.animation.duration = 0.2;
  s.animation.camera = "current";
  await load(page, s);
  await open(page, "#spatial-animation-section");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  const slider = page.getByRole("slider", {
    name: "Animation progress",
    exact: true,
  });
  const before = await page.evaluate(() =>
    (window as any).spatialWorkers.reduce(
      (n: number, l: any) => n + l.requests.length,
      0,
    ),
  );
  for (const [t, visible] of [
    [0, [0]],
    [1, [0, 1, 2, 3, 4]],
    [0.5, [0, 1, 2]],
    [0, [0]],
  ] as const) {
    await slider.fill(String(t));
    await expect
      .poll(async () => (await engravingRecord(page)).visible)
      .toEqual(visible);
  }
  expect(
    await page.evaluate(() =>
      (window as any).spatialWorkers.reduce(
        (n: number, l: any) => n + l.requests.length,
        0,
      ),
    ),
  ).toBe(before);
  await page
    .getByRole("button", { name: /^(Stop|Back to study)$/, exact: true })
    .click();
  await page
    .getByLabel("Family motion", { exact: true })
    .selectOption("window");
  await page.getByLabel("Band width", { exact: true }).fill("2");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  for (const [t, visible] of [
    [0, [0, 1]],
    [1, [3, 4]],
    [0.5, [2, 3]],
    [0, [0, 1]],
  ] as const) {
    await slider.fill(String(t));
    await expect
      .poll(async () => (await engravingRecord(page)).visible)
      .toEqual(visible);
  }
  await page.getByLabel("Family to", { exact: true }).fill("1.4");
  await expect(slider).toHaveCount(0);
  await expect
    .poll(async () => (await engravingRecord(page))?.settings.to)
    .toBe(1.4);
});

test("disabled spatial families still reject invalid indices and budgets", () => {
  const s = source();
  s.config.construction = "developable";
  for (const patch of [
    { count: 33 },
    { count: 1 },
    { count: 2.5 },
    { selected: -1 },
    { selected: 5 },
    { width: 0 },
    { width: 6 },
  ])
    expect(() =>
      spatialStudy({
        ...s,
        family: { ...settings(), enabled: false, ...patch },
      }),
    ).toThrow();
});
test("equal settings share geometry while retaining slots, and returned numeric storage stays bounded", async () => {
  let calls = 0;
  const scheduler = new family.SpatialFamily(
    {
      computeSpatial: async (config) => {
        calls++;
        return { config, result: resultAt(2) };
      },
    },
    () => {},
  );
  scheduler.generate(source().config, {
    ...settings(),
    from: 1,
    to: 1,
    count: 5,
  });
  await expect.poll(() => scheduler.state.pending).toBe(false);
  expect(calls).toBe(1);
  expect(scheduler.state.members.map((m) => m.id)).toEqual([0, 1, 2, 3, 4]);
  expect(new Set(scheduler.state.members.map((m) => m.frame))).toHaveProperty(
    "size",
    1,
  );
  expect(scheduler.state.retained).toBe(
    family.spatialFamilyNumbers(scheduler.state.members[0].frame!.result),
  );
  const huge = new family.SpatialFamily(
    {
      computeSpatial: async (config) => ({
        config,
        result: {
          ...resultAt(0),
          mesh: {
            vertices: new Float64Array(4000001),
            triangles: new Int32Array(),
            sampleIndex: new Int32Array(),
          },
        },
      }),
    },
    () => {},
  );
  huge.generate(source().config, {
    ...settings(),
    count: 2,
    selected: 0,
    width: 1,
  });
  await expect.poll(() => huge.state.pending).toBe(false);
  expect(
    huge.state.members.every((m) => m.error?.includes("retained geometry")),
  ).toBe(true);
  expect(huge.state.retained).toBe(0);
});

test("spatial families do not silently drop a saved shadow's paired views", () => {
  const c = {
    ...source().config,
    shadow: { plane: "z" as const, at: 0, views: true },
  };
  expect(family.spatialFamilyTargets(c)).toEqual([]);
  expect(family.spatialFamilyBudget(c, settings()).field).toBe(
    "Family parameter",
  );
});

import { readFile } from "node:fs/promises";
import { decodePng } from "./png";
async function pngStill(page: Page) {
  await page.getByRole("button", { name: "Export image", exact: true }).click();
  await page
    .getByRole("menuitemradio", { name: "1000 × 760", exact: true })
    .click();
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /^PNG/ }).click();
  return readFile((await (await download).path())!);
}
function pngMetadata(bytes: Buffer) {
  for (let i = 8; i < bytes.length;) {
    const n = bytes.readUInt32BE(i);
    if (bytes.toString("ascii", i + 4, i + 8) === "iTXt") {
      const body = bytes.subarray(i + 8, i + 8 + n);
      return JSON.parse(body.toString("utf8").split("\0").at(-1)!);
    }
    i += n + 12;
  }
  return null;
}
test("spatial engraving PNGs carry slot provenance and invalid members remain inspectable", async ({
  page,
}) => {
  const f = {
    ...settings(),
    target: "radius" as const,
    from: -1,
    to: 3,
    count: 3,
    selected: 2,
    width: 2,
  };
  await load(page, { ...source(), family: f });
  await expect(
    page.getByText("2 of 3 members available.", { exact: true }),
  ).toBeVisible();
  const bytes = await pngStill(page),
    meta = pngMetadata(bytes);
  expect(meta?.family).toMatchObject({ partial: true, visible: [0, 1, 2] });
  expect(
    meta.family.members.map((m: any) => [m.id, m.value, !!m.error]),
  ).toEqual([
    [0, -1, true],
    [1, 1, false],
    [2, 3, false],
  ]);
  expect(decodePng(bytes)).toMatchObject({ width: 1000, height: 760 });
  await page
    .getByLabel("Family presentation", { exact: true })
    .selectOption("selected");
  await page.getByLabel("Selected member", { exact: true }).selectOption("0");
  await expect(
    page.getByRole("button", { name: "Export image", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Selected member", { exact: true }).selectOption("2");
  await expect(
    page.getByRole("button", { name: "Export image", exact: true }),
  ).toBeEnabled();
});
test("a spatial engraving suspends the source probe while preserving its setting", async ({
  page,
}) => {
  const s = { ...source(), family: settings() };
  s.probe.enabled = true;
  await load(page, s);
  const probe = page.getByRole("checkbox", {
    name: "Frame, curvature & torsion at a point",
    exact: true,
  });
  await expect(probe).toBeDisabled();
  await expect(probe).toBeChecked();
  await page
    .getByRole("checkbox", { name: "Finite engraving", exact: true })
    .uncheck();
  await expect(probe).toBeEnabled();
  await expect(probe).toBeChecked();
});

import { frameDifference, pixelDifference, probe as probeVideo } from "./video";
import { chooseColorScheme } from "./helpers";
for (const format of ["mp4", "webp"] as const)
  test(`spatial engraving ${format} decodes to direct seeks with exact duration and provenance`, async ({
    page,
  }, info) => {
    test.slow();
    const s = {
      ...source(),
      family: { ...settings(), motion: "window" as const, width: 2 },
    };
    s.animation.duration = 1;
    s.animation.camera = "current";
    s.view = {
      ...s.view,
      yaw: 0.6,
      pitch: -0.2,
      panX: 0.1,
      panY: -0.05,
      zoom: 1.3,
    };
    s.projection = "normal";
    await load(page, s);
    await chooseColorScheme(page, "cobalt");
    await open(page, "#spatial-animation-section");
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Replay", exact: true }),
    ).toBeVisible();
    const refs: Uint8Array[] = [];
    for (const t of [0, 0.5, 1]) {
      await page
        .getByRole("slider", { name: "Animation progress", exact: true })
        .fill(String(t));
      await expect(page.locator(".spatial-stage")).toHaveAttribute(
        "data-time",
        String(t),
      );
      refs.push(decodePng(await pngStill(page)).rgba);
    }
    await page
      .getByRole("button", { name: /^(Stop|Back to study)$/, exact: true })
      .click();
    await open(page, "#spatial-export-settings");
    await page
      .locator("#spatial-animation-section")
      .getByLabel("Export format", { exact: true })
      .selectOption(format);
    await page
      .getByRole("slider", { name: "Export resolution", exact: true })
      .fill("1");
    await page
      .locator("#spatial-animation-section")
      .getByLabel("Export frame rate", { exact: true })
      .selectOption("15");
    await page
      .getByRole("slider", { name: "Export quality", exact: true })
      .fill("100");
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", {
        name: format === "mp4" ? /^Export MP4 video/ : /^Export .*WebP/,
      })
      .click();
    const path = (await (await download).path())!,
      bytes = await readFile(path);
    await info.attach(`engraving.${format}`, {
      path,
      contentType: format === "mp4" ? "video/mp4" : "image/webp",
    });
    let metadata: any;
    if (format === "mp4") {
      let uuid: Buffer | undefined;
      for (let i = 0; i < bytes.length;) {
        const n = bytes.readUInt32BE(i);
        expect(n).toBeGreaterThanOrEqual(8);
        if (bytes.toString("ascii", i + 4, i + 8) === "uuid")
          uuid = bytes.subarray(i + 24, i + n);
        i += n;
      }
      expect(uuid, "movie contains study provenance").toBeDefined();
      metadata = JSON.parse(uuid!.toString());
      const p = probeVideo(path);
      expect(p).toMatchObject({ width: 1000, height: 760, frames: 15 });
      expect(p!.durations.reduce((a, b) => a + b, 0)).toBe(1000);
      for (const [k, index] of [0, 7, 14].entries()) {
        const d = frameDifference(path, 1000, 760, index, refs[k])!;
        expect(d.meanDifference).toBeLessThan(3);
        expect(d.unmatchedInk).toBeLessThan(0.03);
      }
    } else {
      const parts: { name: string; body: Buffer }[] = [];
      for (let i = 12; i < bytes.length;) {
        const n = bytes.readUInt32LE(i + 4);
        parts.push({
          name: bytes.toString("ascii", i, i + 4),
          body: bytes.subarray(i + 8, i + 8 + n),
        });
        i += 8 + n + (n % 2);
      }
      const frames = parts.filter((c) => c.name === "ANMF");
      expect(frames).toHaveLength(15);
      expect(frames.reduce((n, c) => n + c.body.readUIntLE(12, 3), 0)).toBe(
        1000,
      );
      const xmp = parts.find((c) => c.name === "XMP ")?.body.toString();
      expect(xmp).toBeDefined();
      metadata = JSON.parse(
        xmp!
          .match(/<tg:study>(.*?)<\/tg:study>/s)![1]
          .replaceAll("&lt;", "<")
          .replaceAll("&gt;", ">")
          .replaceAll("&amp;", "&"),
      );
      for (const [k, index] of [0, 7, 14].entries()) {
        const pixels = await page.evaluate(
          async ({ input, index }) => {
            const decoder = new (window as any).ImageDecoder({
              data: new Uint8Array(input),
              type: "image/webp",
            });
            await decoder.tracks.ready;
            const { image } = await decoder.decode({ frameIndex: index });
            const canvas = new OffscreenCanvas(1000, 760),
              ctx = canvas.getContext("2d")!;
            ctx.drawImage(image, 0, 0);
            image.close();
            decoder.close();
            return Array.from(ctx.getImageData(0, 0, 1000, 760).data);
          },
          { input: Array.from(bytes), index },
        );
        const d = pixelDifference(pixels, 4, 1000, 760, refs[k]);
        expect(d.meanDifference).toBeLessThan(3);
        expect(d.unmatchedInk).toBeLessThan(0.03);
      }
    }
    expect(metadata.family.settings).toMatchObject(s.family);
    expect(metadata.family.members.map((m: any) => m.id)).toEqual([
      0, 1, 2, 3, 4,
    ]);
    expect(metadata.view).toMatchObject(s.view);
    expect(metadata.scheme).toBe("cobalt");
  });

for (const [width, height] of [
  [1024, 600],
  [390, 844],
  [844, 390],
])
  test(`spatial engraving walkthrough reaches controls and owns gestures at ${width}x${height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height });
    await page.goto("/?study=3d");
    await choosePreset(page, { label: hero });
    await settled(page);
    const canvas = page.locator("#spatial-artwork");
    const image = () =>
      canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL());
    const initial = await image();
    await canvas.focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(image).not.toBe(initial);
    await page.getByRole("button", { name: "Reset view", exact: true }).click();
    await expect.poll(image).toBe(initial);
    await page
      .getByLabel("Family presentation", { exact: true })
      .selectOption("selected");
    await page.getByLabel("Selected member", { exact: true }).selectOption("5");
    await expect
      .poll(async () => (await engravingRecord(page)).visible)
      .toEqual([5]);
    await page
      .getByLabel("Family presentation", { exact: true })
      .selectOption("family");
    await page.getByRole("button", { name: "Animation", exact: true }).click();
    await page
      .getByRole("spinbutton", { name: "Duration (seconds)", exact: true })
      .fill("0.2");
    await page
      .getByRole("combobox", { name: "Repeat", exact: true })
      .selectOption("once");
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Replay", exact: true }),
    ).toBeVisible();
    const slider = page.getByRole("slider", {
      name: "Animation progress",
      exact: true,
    });
    await slider.fill("0.2");
    await expect(
      page.getByRole("button", { name: "Resume", exact: true }),
    ).toBeVisible();
    const box = (await slider.boundingBox())!;
    await page.evaluate(() => {
      const changes: string[] = [];
      Object.assign(window, { familyButtonChanges: changes });
      new MutationObserver((ms) => {
        for (const m of ms)
          if (m.type === "attributes" && m.attributeName === "disabled")
            changes.push((m.target as HTMLElement).outerHTML);
      }).observe(document.getElementById("spatial-animation-section")!, {
        subtree: true,
        attributes: true,
        attributeFilter: ["disabled"],
      });
    });
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, {
      steps: 12,
    });
    await page.mouse.up();
    expect(
      await page.evaluate(() => (window as any).familyButtonChanges),
    ).toEqual([]);
    const stop = page.getByRole("button", { name: "Stop", exact: true });
    await expect(stop).toBeInViewport();
    await stop.click();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width + 1);
    await canvas.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath("walkthrough.png") });
    if (width === 1024) {
      for (const theme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: theme });
        await page.screenshot({ path: `/tmp/tangent-garden-373-${theme}.png` });
      }
    }
  });

test("the spatial engraving appears with its torus-knot subject in the gallery", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await page
    .getByRole("button", { name: "Browse notebook examples", exact: true })
    .click();
  const gallery = page.getByRole("dialog", { name: "Notebook examples" });
  await expect(
    gallery
      .getByRole("region", { name: "Torus knots", exact: true })
      .getByRole("button", { name: hero, exact: true }),
  ).toBeVisible();
  await expect(
    gallery.getByRole("region", { name: "Finite engravings", exact: true }),
  ).toHaveCount(0);
});

import { linework, linesSvg } from "../web/spatial/linework";
test("clipped spatial vector output keeps each member ID and duplicate-slot provenance", () => {
  const f = { ...settings(), count: 3, selected: 1, width: 2 };
  const members = [0, 1, 2].map((id) => ({
    id,
    value: id,
    frame: { config: source().config, result: resultAt(id * 4) },
  }));
  const frame = family.composeSpatialFamily(source().config, f, members),
    view = { ...initialView, ...frame.result.bounds };
  const groups = linework(
    buildScene(frame.result),
    view,
    defaultLayers,
    false,
    { width: 1000, height: 760, occlusion: "none" },
    [],
    {
      plane: { normal: { x: 1, y: 0, z: 0 }, offset: 5 },
      scope: "all",
      edge: false,
    },
  );
  expect([...new Set(groups.map((g) => g.member))].sort()).toEqual([0, 1]);
  const svg = linesSvg(groups, {
    width: 1000,
    height: 760,
    dark: false,
    title: "family",
    metadata: {},
  });
  expect(svg).toContain('data-family-member="0"');
  expect(svg).toContain('data-family-member="1"');
  expect(svg).not.toContain('data-family-member="2"');
  const duplicate = [
    members[0],
    { ...members[1], frame: members[0].frame },
    members[2],
  ];
  const same = family.composeSpatialFamily(source().config, f, duplicate);
  const passes = scenePasses(buildScene(same.result), defaultLayers).filter(
    (p) => p.layer === "base" && p.batch.data.length,
  );
  expect(passes).toHaveLength(2);
  expect(passes[0].slots).toEqual([0, 1]);
  const guides = scenePasses(buildScene(same.result), defaultLayers).filter(
    (p) => p.layer === "connectors" && p.batch.data.length,
  );
  expect(guides).toHaveLength(2);
  expect(guides[0].slots).toEqual([0, 1]);
});

test("the signature's own back-and-forth playback prepares once and seeks the full family", async ({
  page,
}) => {
  await observeSpatial(page);
  await page.goto("/?study=3d");
  await choosePreset(page, { label: hero });
  await settled(page);
  await open(page, "#spatial-animation-section");
  await expect(
    page.getByRole("spinbutton", { name: "Duration (seconds)", exact: true }),
  ).toHaveValue("3");
  await expect(
    page.getByRole("combobox", { name: "Repeat", exact: true }),
  ).toHaveValue("back-and-forth");
  const prepared = await page.evaluate(() =>
    (window as any).spatialWorkers.reduce(
      (n: number, l: any) => n + l.requests.length,
      0,
    ),
  );
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect
    .poll(async () =>
      Number(
        await page.locator(".spatial-stage").getAttribute("data-progress"),
      ),
    )
    .toBe(1);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("slider", { name: "Animation progress", exact: true })
    .fill("0.5");
  await expect
    .poll(async () => (await engravingRecord(page)).visible.length)
    .toBe(16);
  expect(
    await page.evaluate(() =>
      (window as any).spatialWorkers.reduce(
        (n: number, l: any) => n + l.requests.length,
        0,
      ),
    ),
  ).toBe(prepared);
  const observations = await page.evaluate(() => {
    const l = (window as any).spatialWorkers.find(
      (l: any) => l.requests.length === 16,
    );
    return l.replies.map((r: any) => ({
      milliseconds: r.observedElapsed,
      bytes: r.observedBytes,
    }));
  });
  console.log(
    JSON.stringify({
      study: hero,
      members: 16,
      samples: 720,
      workerRoundTripMilliseconds: observations.reduce(
        (n: number, r: any) => n + r.milliseconds,
        0,
      ),
      replyBytes: observations.reduce((n: number, r: any) => n + r.bytes, 0),
    }),
  );
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
});
test("a delayed family generation cannot replace a newly chosen ordinary study", async ({
  page,
}) => {
  await observeSpatial(page, 100);
  await load(page, { ...source(), family: settings() });
  await page.getByLabel("Family members", { exact: true }).fill("32");
  await expect(
    page.getByText("Calculating family…", { exact: true }),
  ).toBeVisible();
  await choosePreset(page, 0);
  await expect(
    page.getByRole("checkbox", { name: "Finite engraving", exact: true }),
  ).not.toBeChecked();
  await settled(page);
  await expect(page.locator(".spatial-stage")).not.toHaveAttribute(
    "data-engraving",
  );
  expect(
    JSON.parse(
      (await page.locator(".spatial-stage").getAttribute("data-config"))!,
    ),
  ).toEqual(presetStudy(0).config);
  expect(
    await page.evaluate(
      () =>
        (window as any).spatialWorkers.filter(
          (l: any) => l.terminated && l.requests.length > 0,
        ).length,
    ),
  ).toBeGreaterThan(0);
});

test("spatial slot boundaries, reversal and aggregate containment have independent expectations", () => {
  const f = { ...settings(), motion: "window" as const, width: 2 };
  for (const [p, ids] of [
    [0, [0, 1]],
    [0.25, [1, 2]],
    [0.5, [2, 3]],
    [0.75, [3, 4]],
    [1, [3, 4]],
  ] as const)
    expect(family.spatialFamilyVisible(f, 5, p)).toEqual(ids);
  for (const [p, ids] of [
    [0, [0]],
    [0.25, [0, 1]],
    [0.5, [0, 1, 2]],
    [0.75, [0, 1, 2, 3]],
    [1, [0, 1, 2, 3, 4]],
  ] as const)
    expect(
      family.spatialFamilyVisible({ ...f, motion: "reveal" }, 5, p),
    ).toEqual(ids);
  const members = [0, 1, 2, 3, 4].map((id) => ({
    id,
    value: id,
    frame: { config: source().config, result: resultAt(id * 4) },
  }));
  const whole = family.composeSpatialFamily(source().config, f, members);
  for (const m of members) {
    const b = m.frame.result.bounds,
      c = whole.result.bounds;
    expect(
      Math.hypot(
        b.center.x - c.center.x,
        b.center.y - c.center.y,
        b.center.z - c.center.z,
      ) + b.radius,
    ).toBeLessThanOrEqual(c.radius + 1e-12);
  }
  const selected = family.composeSpatialFamily(
    source().config,
    { ...f, presentation: "selected" },
    members,
  );
  expect(selected.result.bounds).toEqual(whole.result.bounds);
  const setup = {
    duration: 4,
    repeat: "back-and-forth" as const,
    pace: "steady" as const,
  };
  for (const [time, p] of [
    [0, 0],
    [0.25, 2 / 3],
    [0.375, 1],
    [0.5, 1],
    [0.625, 1],
    [0.75, 2 / 3],
    [1, 0],
  ])
    expect(
      family.sampleSpatialFamily(
        source().config,
        f,
        members,
        setup,
        { ...initialView, ...whole.result.bounds },
        time,
        1,
        "hold",
      ).progress,
    ).toBeCloseTo(p, 15);
});

test("a spatial engraving retains real parametric singular gaps as separate source paths", async ({
  page,
}) => {
  const s = source();
  s.config.format = "parametric";
  s.config.construction = "none";
  s.config.curve = { x: "t", y: "a/(t-0.5)", z: "0", min: 0, max: 1, a: 1 };
  await observeSpatial(page);
  await load(page, {
    ...s,
    family: {
      ...settings(),
      target: "a",
      from: 1,
      to: 2,
      count: 3,
      selected: 1,
      width: 2,
    },
  });
  await expect(
    page.getByText("3 of 3 members available.", { exact: true }),
  ).toBeVisible();
  const replies = await page.evaluate(() => {
    const l = (window as any).spatialWorkers.find(
      (l: any) => l.requests.length === 3,
    );
    return l.replies.map((r: any) => ({
      result: r.result,
      lifted: { places: r.lifted.places, floats: Array.from(r.lifted.floats) },
    }));
  });
  for (const reply of replies) {
    const r = restore(reply.result, {
      ...reply.lifted,
      floats: new Float64Array(reply.lifted.floats),
    }) as any;
    expect(r.base[120]).toBeNull();
    expect(r.base.filter(Boolean).length).toBeGreaterThan(200);
    const passes = scenePasses(buildScene(r), defaultLayers).filter(
      (p) => p.layer === "base",
    );
    for (const { batch: b } of passes)
      for (let i = 0; i + 13 < b.data.length; i += 14) {
        const x = b.data[i] + (b.origin?.x ?? 0),
          y = b.data[i + 7] + (b.origin?.x ?? 0);
        expect((x < 0.5 && y > 0.5) || (y < 0.5 && x > 0.5)).toBe(false);
      }
  }
});

test("an invalid spatial band width stays editable and names its own field", async ({
  page,
}) => {
  await load(page, {
    ...source(),
    family: { ...settings(), motion: "window" },
  });
  await open(page, "#spatial-animation-section");
  const width = page.getByRole("spinbutton", {
    name: "Band width",
    exact: true,
  });
  await width.fill("0");
  await expect(width).toBeEnabled();
  await expect(width.locator("..").getByRole("alert")).toContainText(
    "Band width",
  );
  await expect(
    page.getByRole("button", { name: "Play animation", exact: true }),
  ).toBeDisabled();
  await width.fill("2");
  await expect(
    page.getByRole("button", { name: "Play animation", exact: true }),
  ).toBeEnabled();
});

import { decodedFrame } from "./video";
test("a partial spatial movie keeps an unavailable first slot blank without losing duration", async ({
  page,
}) => {
  const s = {
    ...source(),
    family: {
      ...settings(),
      target: "radius" as const,
      from: -1,
      to: 3,
      count: 3,
      selected: 2,
      width: 1,
    },
  };
  s.animation.duration = 0.2;
  await load(page, s);
  await expect(
    page.getByText("2 of 3 members available.", { exact: true }),
  ).toBeVisible();
  await open(page, "#spatial-animation-section");
  await open(page, "#spatial-export-settings");
  await page
    .getByRole("slider", { name: "Export resolution", exact: true })
    .fill("1");
  await page
    .locator("#spatial-animation-section")
    .getByLabel("Export frame rate", { exact: true })
    .selectOption("15");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Export MP4 video/ }).click();
  const path = (await (await download).path())!,
    p = probeVideo(path)!;
  expect(p.frames).toBe(3);
  expect(p.durations.reduce((a, b) => a + b, 0)).toBe(200);
  const ink = (pixels: Buffer) => {
    let n = 0;
    for (let i = 0; i < pixels.length; i += 3)
      if (
        Math.abs(pixels[i] - pixels[0]) +
          Math.abs(pixels[i + 1] - pixels[1]) +
          Math.abs(pixels[i + 2] - pixels[2]) >
        50
      )
        n++;
    return n;
  };
  expect(ink(decodedFrame(path, 1000, 760, 0)!)).toBe(0);
  expect(ink(decodedFrame(path, 1000, 760, 2)!)).toBeGreaterThan(500);
});
test("an edited refined spatial family stays within retained bounds through real worker preparation", async ({
  page,
}) => {
  test.slow();
  const s = source();
  s.config.format = "parametric";
  s.config.samples = 2400;
  s.config.lines = 240;
  s.config.adaptive = true;
  s.config.curve = {
    x: "(2+0.3*cos(11*t))*cos(t)",
    y: "(2+0.3*cos(11*t))*sin(t)",
    z: "a*sin(7*t)",
    min: 0,
    max: 2 * Math.PI,
    a: 1,
  };
  await observeSpatial(page);
  await load(page, {
    ...s,
    family: {
      ...settings(),
      target: "a",
      from: 0.5,
      to: 1.5,
      count: 8,
      selected: 4,
      width: 3,
    },
  });
  await expect(
    page.getByText("8 of 8 members available.", { exact: true }),
  ).toBeVisible();
  const logs = await page.evaluate(() => {
    const l = (window as any).spatialWorkers.find(
      (l: any) => l.requests.length === 8,
    );
    return {
      maximum: l.maximum,
      replies: l.replies.map((r: any) => ({
        result: r.result,
        lifted: {
          places: r.lifted.places,
          floats: Array.from(r.lifted.floats),
        },
        milliseconds: r.observedElapsed,
        bytes: r.observedBytes,
      })),
    };
  });
  expect(logs.maximum).toBe(1);
  const retained = logs.replies.reduce(
    (n: number, r: any) =>
      n +
      family.spatialFamilyNumbers(
        restore(r.result, {
          ...r.lifted,
          floats: new Float64Array(r.lifted.floats),
        }),
      ),
    0,
  );
  expect(retained).toBeLessThanOrEqual(4000000);
  console.log(
    JSON.stringify({
      study: "edited refined spatial family",
      members: 8,
      samples: 2400,
      lines: 240,
      retainedNumericEntries: retained,
      workerRoundTripMilliseconds: logs.replies.reduce(
        (n: number, r: any) => n + r.milliseconds,
        0,
      ),
      replyBytes: logs.replies.reduce((n: number, r: any) => n + r.bytes, 0),
    }),
  );
  await page
    .getByRole("checkbox", { name: "Finite engraving", exact: true })
    .uncheck();
  await settled(page);
  expect(
    await page.evaluate(() =>
      (window as any).spatialWorkers.some(
        (l: any) => l.requests.length === 8 && l.terminated,
      ),
    ),
  ).toBe(true);
});

test("switching spatial family targets generates valid ranges beside edited torus radii", () => {
  for (const [radius, tube] of [
    [0.1, 0.099],
    [20, 19.999999999],
    [1, 0.01],
    [2.4, 0.85],
  ])
    for (const target of ["radius", "tube"] as const) {
      const c = { ...source().config, radius, tube };
      const f = family.spatialFamilyDefaults(c, target);
      for (const value of [f.from, f.to]) {
        const R = target === "radius" ? value : radius,
          r = target === "tube" ? value : tube;
        expect(R).toBeGreaterThanOrEqual(0.1);
        expect(R).toBeLessThanOrEqual(20);
        expect(r).toBeGreaterThanOrEqual(0.01);
        expect(r).toBeLessThan(R);
      }
    }
});

test("spatial families retain deep manual zoom and refine each member to the same current view", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const s = {
    ...source(),
    family: { ...settings(), count: 3, selected: 1, width: 2 },
  };
  s.config.adaptive = true;
  s.config.adaptiveView = true;
  s.view = { ...s.view, zoom: 40, panX: 0.02 };
  await observeSpatial(page);
  await load(page, s);
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (window as any).spatialWorkers.filter(
            (l: any) =>
              l.requests.some((r: any) => r.spatialView) &&
              l.requests.length >= 3,
          ).length,
      ),
    )
    .toBeGreaterThan(0);
  const requests = await page.evaluate(() =>
    (window as any).spatialWorkers.flatMap((l: any) =>
      l.requests.filter((r: any) => r.spatialView),
    ),
  );
  expect(requests.some((r: any) => r.spatialView)).toBe(true);
  const canvas = page.locator("#spatial-artwork");
  await canvas.focus();
  await page.keyboard.press("+");
  await settled(page);
  const latest = await page.evaluate(() =>
    (window as any).spatialWorkers
      .flatMap((l: any) => l.requests.filter((r: any) => r.spatialView))
      .at(-1),
  );
  expect((await copiedStudy(page)).study.view.zoom).toBeGreaterThan(40);
  expect(latest.spatialView).toBeDefined();
  await page
    .getByRole("checkbox", { name: "Finite engraving", exact: true })
    .uncheck();
  await settled(page);
  await page
    .getByRole("checkbox", { name: "Finite engraving", exact: true })
    .check();
  await settled(page);
});

test("family preparation freezes the refinement view and every member's configuration", async () => {
  const views: any[] = [],
    configs: any[] = [];
  const engine = {
    computeSpatial: async (config: any, options: any) => {
      views.push(options.view);
      configs.push(config);
      return { config, result: resultAt(config.tube) };
    },
  };
  const scheduler = new family.SpatialFamily(engine, () => {}),
    c = source().config;
  const view = {
    center: { x: 0, y: 0, z: 0 },
    right: { x: 1, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
    width: 0.1,
    height: 0.076,
  };
  scheduler.generate(
    c,
    { ...settings(), count: 3, selected: 1, width: 2 },
    view,
  );
  view.center.x = 999;
  await expect.poll(() => scheduler.state.pending).toBe(false);
  expect(views).toHaveLength(3);
  expect(views.every((v) => v?.center.x === 0 && v.width === 0.1)).toBe(true);
  expect(configs.map((c) => c.tube)).toEqual([0.3, 0.75, 1.2]);
  expect(c.tube).toBe(source().config.tube);
});
test("a fatal family worker failure stops the queue until a new worker is created", async () => {
  let calls = 0,
    disposed = 0;
  const scheduler = new family.SpatialFamily(
    {
      computeSpatial: async () => {
        calls++;
        throw new Error("worker failed");
      },
      dispose: () => {
        disposed++;
      },
    },
    () => {},
  );
  scheduler.generate(source().config, settings());
  await expect.poll(() => scheduler.state.pending).toBe(false);
  expect(scheduler.state.error).toContain("Disable and re-enable");
  expect(scheduler.state.queued).toBe(0);
  expect(disposed).toBe(1);
  scheduler.generate(source().config, settings());
  expect(calls).toBe(1);
  expect(scheduler.state.error).toContain("worker failed");
});

test("disabled spatial families retain settings when the source exceeds family admission", () => {
  const s = source();
  s.config.adaptive = true;
  s.config.samples = 2400;
  const f = { ...settings(), enabled: false, count: 32 };
  expect(family.spatialFamilyBudget(s.config, f).error).toMatch(/limit/);
  expect(spatialStudy({ ...s, family: f }).family).toEqual(f);
  expect(() => spatialStudy({ ...s, family: { ...f, enabled: true } })).toThrow(
    /limit/,
  );
});

test("family links keep the source animation valid after its cut is disabled", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const s = {
    ...source(),
    family: { ...settings(), count: 3, selected: 1, width: 2 },
  };
  s.cut.enabled = true;
  s.animation.mode = "cut";
  await load(page, s);
  await page
    .getByRole("checkbox", { name: "Cut with a plane", exact: true })
    .uncheck();
  const saved = (await copiedStudy(page)).study;
  expect(() => spatialStudy(saved)).not.toThrow();
  expect(saved.animation.mode).toBe("reveal");
});

test("family links clear a source ray ride when its definition becomes a curve", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const s = source();
  s.config.format = "rays";
  s.animation.mode = "trace";
  s.animation.camera = "ride";
  await load(page, s);
  await page
    .getByRole("checkbox", { name: "Finite engraving", exact: true })
    .check();
  await page
    .getByRole("combobox", { name: "Spatial definition", exact: true })
    .selectOption("torus");
  await expect(
    page.getByText("16 of 16 members available.", { exact: true }),
  ).toBeVisible();
  const saved = (await copiedStudy(page)).study;
  expect(() => spatialStudy(saved)).not.toThrow();
  expect(saved.animation).toMatchObject({ mode: "reveal", camera: "hold" });
});
