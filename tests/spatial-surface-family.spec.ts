import { test, expect, type Page } from "@playwright/test";
import { deflateRawSync } from "node:zlib";
import { presetStudy, spatialStudy } from "../web/spatial/link";
import { spatialPresets } from "../web/spatial/presets";
import * as family from "../web/spatial/family";
import { surfaceShape } from "../web/spatial/surface";
import { buildScene, scenePasses, defaultLayers } from "../web/spatial/scene";
import { restoredSurface } from "./spatial-surface-family-support";
import { observeSpatial } from "./spatial-family-helpers";
import { settled } from "./gallery-helpers";

import {
  surfaceSource as source,
  surfaceSettings as settings,
} from "./spatial-surface-family-support";
async function load(page: Page, s: unknown) {
  await page.goto(
    `/#s=${deflateRawSync(JSON.stringify({ v: 1, notebook: "3d", study: s })).toString("base64url")}`,
  );
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
  await settled(page);
}

test("surface engraving admission follows consumed shape descriptors and preserves curve defaults", () => {
  const c = source().config;
  for (const [kind, shapes] of Object.entries(surfaceShape)) {
    const targets = family.spatialFamilyTargets({
      ...c,
      surface: { ...c.surface, kind: kind as any },
    });
    expect(targets.map((t) => t.target)).toEqual(
      shapes.map((s) => `surface${s.key.toUpperCase()}`),
    );
  }
  expect(
    family.spatialFamilyTargets({
      ...c,
      surface: { ...c.surface, geodesics: {} as any },
    }),
  ).toEqual([]);
  expect(
    family.spatialFamilyTargets({
      ...c,
      surface: { ...c.surface, ridges: true },
    }),
  ).toEqual([]);
  const defaults = family.spatialFamilyDefaults(c, "surfaceB");
  expect(defaults).toMatchObject({ from: 0, to: Math.PI / 2, count: 16 });
  expect(spatialStudy({ ...source(), family: settings() }).family).toEqual(
    settings(),
  );
  expect(spatialStudy(source())).not.toHaveProperty("family");
  const knot = presetStudy(0).config;
  expect(family.spatialFamilyTargets(knot)).toEqual([]); // developable remains excluded
  knot.construction = "none";
  expect(
    family.spatialFamilyBudget(knot, { ...settings(), target: "tube" }),
  ).toMatchObject({
    points: 3 * (knot.samples + 1 + (knot.adaptive ? 16384 : 0)),
    error: undefined,
  });
});

test("surface reservations include hidden sheets, triangle work and actual grid size", () => {
  const c = source().config,
    f = settings();
  expect(family.spatialFamilyBudget(c, f)).toMatchObject({
    nodes: 3 * 25 * 13,
    triangles: 3 * 4 * 2 * 24 * 12,
    error: undefined,
  });
  const triangleBound = family.spatialFamilyBudget(
    { ...c, surface: { ...c.surface, uSamples: 120, vSamples: 120 } },
    { ...f, count: 6 },
  );
  expect(triangleBound.nodes).toBeLessThan(100000);
  expect(triangleBound.numbers).toBeLessThan(4000000);
  expect(triangleBound.error).toMatch(/limit/);
  for (const grid of [
    [240, 60],
    [120, 120],
  ]) {
    const q = {
      ...c,
      surface: { ...c.surface, uSamples: grid[0], vSamples: grid[1] },
    };
    expect(family.spatialFamilyBudget(q, { ...f, count: 32 }).error).toMatch(
      /limit/,
    );
  }
  // Hidden numerical work, not curve samples, is what determines admission.
  expect(
    family.spatialFamilyBudget({ ...c, samples: 32768, adaptive: true }, f),
  ).toEqual(family.spatialFamilyBudget(c, f));
});

test("surface members equal direct WASM requests and retain grid provenance, selected sheets and boundary gaps", async ({
  page,
}) => {
  await observeSpatial(page);
  const s = { ...source(), family: settings() };
  await load(page, s);
  await expect(
    page.getByText("3 of 3 members available.", { exact: true }),
  ).toBeVisible();
  const checks = await page.evaluate(async (s) => {
    const logs = (window as any).spatialWorkers;
    const log = logs.find((l: any) => l.requests.length === 3);
    if (!log) throw Error("Missing family worker");
    const direct = new Worker(log.url),
      out = [];
    for (let i = 0; i < 3; i++) {
      const config = structuredClone(s.config);
      config.surface.b = JSON.parse(
        document.querySelector<HTMLElement>(".spatial-stage")!.dataset
          .engraving!,
      ).members[i].value;
      const reply: any = await new Promise((resolve) => {
        direct.onmessage = (e) => resolve(e.data);
        direct.postMessage({
          id: 100 + i,
          action: "spatial",
          spatial: config,
          base: location.origin + "/",
        });
      });
      const actual = log.replies.find((r: any) => r.id === log.requests[i].id);
      out.push({
        direct: {
          result: reply.result,
          lifted: {
            places: reply.lifted.places,
            floats: Array.from(reply.lifted.floats),
          },
        },
        result: actual.result,
        lifted: {
          places: actual.lifted.places,
          floats: Array.from(actual.lifted.floats),
        },
      });
    }
    direct.terminate();
    return { out, maximum: log.maximum };
  }, s);
  expect(checks.maximum).toBe(1);
  const members = checks.out.map((r, i) => {
    expect(restoredSurface(structuredClone(r))).toEqual(
      restoredSurface(r.direct),
    );
    return {
      id: i,
      value: [0, Math.PI / 4, Math.PI / 2][i],
      frame: {
        config: {
          ...s.config,
          surface: { ...s.config.surface, b: [0, Math.PI / 4, Math.PI / 2][i] },
        },
        result: restoredSurface(r),
      },
    };
  });
  for (const [k, m] of members.entries()) {
    const sheet = m.frame.result.surface!.surface;
    expect(sheet.points).toHaveLength(25);
    for (let i = 0; i <= 24; i++)
      for (let j = 0; j <= 12; j++) {
        const p = sheet.points[i][j]!;
        expect(p).toBeTruthy();
        // Associate surfaces: |X_u|²=|X_v|²=cosh²(v), confirmed via actual nearby geometry below.
        if (k === 0)
          expect(Math.hypot(p.x, p.y)).toBeCloseTo(
            Math.abs(Math.sinh(-1.2 + (2.4 * j) / 12)),
            12,
          );
        if (k === 2)
          expect(Math.hypot(p.x, p.y)).toBeCloseTo(Math.cosh(p.z), 12);
      }
    expect(sheet.alongU.flat().some(Boolean)).toBe(true);
  }
  const compose = (f = settings(), p?: number) =>
    family.composeSpatialFamily(s.config, f, members, p);
  const scene = buildScene(compose().result);
  expect(
    scene
      .engraving!.filter((m) => !m.selected)
      .every(
        (m) =>
          m.scene.sheet.data.length === 0 &&
          m.scene.offsetSheet.data.length === 0 &&
          m.scene.focalSheets.every((s) => s.data.length === 0),
      ),
  ).toBe(true);
  const passes = scenePasses(scene, {
    ...defaultLayers,
    surface: true,
    curves: true,
    normals: true,
  });
  expect(
    passes.filter((p) => p.layer === "curves" && p.batch.data.length),
  ).toHaveLength(3);
  expect(
    passes
      .filter((p) => p.sheet && p.batch.data.length)
      .every((p) => p.member === 1),
  ).toBe(true);
  expect(
    passes.filter((p) => p.sheet && p.batch.data.length).length,
  ).toBeGreaterThan(0);
  expect(
    scenePasses(
      buildScene(compose(settings(), 0).result),
      defaultLayers,
    ).filter((p) => p.sheet && p.batch.data.length),
  ).toHaveLength(0);
  // A known disconnected grid edge may never become a segment in the family.
  const r = structuredClone(members[0].frame.result);
  r.surface!.surface.alongU.forEach((row) => row.fill(false));
  r.surface!.surface.alongV.forEach((row) => row.fill(false));
  const gap = family.composeSpatialFamily(s.config, settings(), [
    { ...members[0], frame: { config: s.config, result: r } },
    ...members.slice(1),
  ]);
  expect(
    scenePasses(buildScene(gap.result), defaultLayers)
      .filter((p) => p.member === 0 && p.layer === "curves")
      .every((p) => p.batch.data.length === 0),
  ).toBe(true);
  expect(compose(settings(), 0).result.bounds).toEqual(
    compose(settings(), 1).result.bounds,
  );
});

test("the signature surface engraving opens in Minimal surfaces with its own frozen motion", async ({
  page,
}) => {
  const i = spatialPresets.findIndex(
    (p) => p.name === "A surface remembers its bending",
  );
  expect(i).toBeGreaterThanOrEqual(0);
  const s = presetStudy(i);
  expect(s.family).toMatchObject({
    enabled: true,
    target: "surfaceB",
    count: 32,
  });
  expect(s.animation.camera).toBe("current");
  expect(family.spatialFamilyBudget(s.config, s.family!)).not.toHaveProperty(
    "error",
    expect.any(String),
  );
  await page.goto("/?study=3d");
  await page.getByRole("button", { name: "Browse notebook examples" }).click();
  await expect(
    page
      .getByRole("region", { name: "Minimal surfaces", exact: true })
      .getByRole("button", {
        name: "A surface remembers its bending",
        exact: true,
      }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "A surface remembers its bending",
      exact: true,
    })
    .click();
  await settled(page);
  await expect(
    page.getByText("32 of 32 members available.", { exact: true }),
  ).toBeVisible();
  const canvas = page.locator("#spatial-artwork");
  const image = () => canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL());
  await canvas.focus();
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("+");
  const enteredView = await image();
  await page.getByRole("button", { name: "Animation", exact: true }).click();
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        JSON.parse(
          (await page
            .locator(".spatial-stage")
            .getAttribute("data-engraving"))!,
        ).visible.length,
    )
    .toBeGreaterThan(1);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page
    .getByRole("slider", { name: "Animation progress", exact: true })
    .fill("0.5");
  await expect(page.locator(".spatial-stage")).toHaveAttribute(
    "data-progress",
    "1",
  );
  await expect.poll(image).toBe(enteredView);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect.poll(image).toBe(enteredView);
});

test("surface defaults keep edited full-quality grids within aggregate admission", () => {
  const c = source().config;
  for (const [uSamples, vSamples] of [
    [96, 48],
    [120, 120],
    [240, 60],
  ]) {
    const q = { ...c, surface: { ...c.surface, uSamples, vSamples } };
    const f = family.spatialFamilyDefaults(q, "surfaceB");
    expect(f.count).toBeGreaterThanOrEqual(2);
    expect(f.width).toBeLessThanOrEqual(f.count);
    expect(family.spatialFamilyBudget(q, f).error).toBeUndefined();
    expect(q.surface.uSamples).toBe(uSamples);
  }
});

test("every surface shape target reaches its ordinary evaluator without changing source data", async ({
  page,
}) => {
  const { surfaceDefaults } = await import("../web/spatial/surface");
  await observeSpatial(page);
  for (const [kind, shapes] of Object.entries(surfaceShape))
    for (const shape of shapes) {
      const s = source();
      s.animation.mode = "reveal";
      s.animation.tracks = [];
      Object.assign(
        s.config.surface,
        surfaceDefaults[kind as keyof typeof surfaceDefaults],
        { kind, uSamples: 12, vSamples: 12, curves: 3 },
      );
      const target = `surface${shape.key.toUpperCase()}` as any;
      const raw = s.config.surface[shape.key];
      const value = raw === 0 ? 0.2 : raw * 0.8;
      const f = {
        ...settings(),
        target,
        from: value,
        to: value,
        count: 2,
        width: 1,
      };
      await load(page, { ...s, family: f });
      await expect(
        page.getByText("2 of 2 members available.", { exact: true }),
      ).toBeVisible();
      const record = await page.evaluate(() => {
        const logs = (window as any).spatialWorkers;
        const l = logs.findLast(
          (l: any) =>
            l.requests.length === 1 &&
            l.requests[0].spatial.format === "surface" &&
            l !== logs[0],
        );
        if (!l) throw Error("Missing deduplicated surface worker");
        const r = l.replies[0];
        return {
          config: l.requests[0].spatial,
          result: r.result,
          lifted: {
            places: r.lifted.places,
            floats: Array.from(r.lifted.floats),
          },
        };
      });
      expect(record.config).toEqual({
        ...s.config,
        surface: { ...s.config.surface, [shape.key]: value },
      });
      const r = restoredSurface(record),
        grid = r.surface!.surface;
      expect(grid.points.flat().filter(Boolean)).toHaveLength(169);
      if (kind === "helicoid-catenoid") {
        const q = { ...s.config.surface, [shape.key]: value };
        expect(grid.points[6][6]!.x).toBeCloseTo(q.a * Math.sin(q.b), 12);
        expect(grid.points[6][6]!.y).toBeCloseTo(0, 12);
        expect(grid.points[6][6]!.z).toBeCloseTo(0, 12);
      }
      for (const row of grid.points)
        for (const p of row) {
          expect(p).toBeTruthy();
          const { x, y, z } = p!;
          const q = { ...s.config.surface, [shape.key]: value };
          if (kind === "ellipsoid")
            expect(
              (x / q.a) ** 2 + (y / q.b) ** 2 + (z / q.c) ** 2,
            ).toBeCloseTo(1, 12);
          if (kind === "torus")
            expect((Math.hypot(x, y) - q.a) ** 2 + z * z).toBeCloseTo(
              q.b * q.b,
              12,
            );
          if (kind === "cylinder")
            expect((x / q.a) ** 2 + (y / q.b) ** 2).toBeCloseTo(1, 12);
          if (kind === "paraboloid")
            expect(z).toBeCloseTo((q.a * x * x + q.b * y * y) / 2, 12);
          if (kind === "monkey")
            expect(z).toBeCloseTo(q.a * (x * x * x - 3 * x * y * y), 12);
        }
    }
});

import { copiedStudy } from "./gallery-helpers";
import { choosePreset, chooseColorScheme } from "./helpers";
import { pngStill, pngMetadata } from "./spatial-family-helpers";

test("surface controls preserve scalar drafts, reverse exact slot order and restore the source probe", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const s = source();
  s.probe.enabled = true;
  await load(page, s);
  const scale = page.getByRole("textbox", { name: "Scale s", exact: true });
  await scale.fill("sqrt(4)");
  await settled(page);
  const saved = await copiedStudy(page);
  await page
    .getByRole("checkbox", { name: "Finite engraving", exact: true })
    .check();
  await page
    .getByLabel("Family parameter", { exact: true })
    .selectOption("surfaceB");
  await page.getByLabel("Family members", { exact: true }).fill("3");
  await page
    .getByRole("textbox", { name: "Family from", exact: true })
    .fill("pi/2");
  await page.getByRole("textbox", { name: "Family to", exact: true }).fill("0");
  await settled(page);
  const record = () =>
    page
      .locator(".spatial-stage")
      .getAttribute("data-engraving")
      .then((v) => JSON.parse(v!));
  expect((await record()).members.map((m: any) => m.value)).toEqual([
    Math.PI / 2,
    0.785398163397448, // Generated within the endpoint-scaled rounding budget.
    0,
  ]);
  const probe = page.getByRole("checkbox", {
    name: "Principal curvatures & centers at a point",
    exact: true,
  });
  await expect(probe).toBeDisabled();
  await expect(probe).toBeChecked();
  expect((await copiedStudy(page)).study.family).toMatchObject({
    target: "surfaceB",
    from: Math.PI / 2,
    to: 0,
    count: 3,
  });
  await page
    .getByRole("checkbox", { name: "Finite engraving", exact: true })
    .uncheck();
  await settled(page);
  await expect(scale).toHaveValue("sqrt(4)");
  await expect(probe).toBeEnabled();
  await expect(probe).toBeChecked();
  expect((await copiedStudy(page)).study.config).toEqual(saved.study.config);
});

test("invalid surface slots keep reasons and blank windows without losing valid export provenance", async ({
  page,
}) => {
  const s = {
    ...source(),
    family: {
      ...settings(),
      target: "surfaceA" as const,
      from: -1,
      to: 1,
      selected: 2,
    },
  };
  await load(page, s);
  await expect(
    page.getByText("1 of 3 members available.", { exact: true }),
  ).toBeVisible();
  const meta = pngMetadata(await pngStill(page));
  expect(meta.family.partial).toBe(true);
  expect(
    meta.family.members.map((m: any) => [m.id, m.value, !!m.error]),
  ).toEqual([
    [0, -1, true],
    [1, 0, true],
    [2, 1, false],
  ]);
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
  await page
    .getByRole("textbox", { name: "Family from", exact: true })
    .fill("1");
  await settled(page);
  await expect(
    page.getByText("3 of 3 members available.", { exact: true }),
  ).toBeVisible();
});

for (const [width, height] of [
  [1024, 600],
  [390, 844],
  [844, 390],
])
  test(`surface engraving walkthrough reaches edit, sheets, motion and output at ${width}x${height}`, async ({
    page,
    context,
  }, info) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.setViewportSize({ width, height });
    await observeSpatial(page);
    await page.goto("/?study=3d");
    await choosePreset(page, { label: "A surface remembers its bending" });
    await settled(page);
    const canvas = page.locator("#spatial-artwork"),
      image = () => canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL());
    const first = await image();
    await canvas.focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(image).not.toBe(first);
    await page.getByRole("button", { name: "Reset view", exact: true }).click();
    await expect.poll(image).toBe(first);
    await page
      .getByLabel("Family presentation", { exact: true })
      .selectOption("selected");
    await page
      .getByLabel("Selected member", { exact: true })
      .selectOption("15");
    await page.getByLabel("Surface patch", { exact: true }).check();
    await settled(page);
    expect(await image()).not.toBe(first);
    await chooseColorScheme(page, "cobalt");
    await page.emulateMedia({ colorScheme: "dark" });
    await page
      .getByLabel("Family presentation", { exact: true })
      .selectOption("family");
    await page.getByLabel("Surface patch", { exact: true }).uncheck();
    expect((await copiedStudy(page)).study.family.selected).toBe(15);
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
    await page.evaluate(() => {
      Object.assign(window, { surfaceButtonChanges: [] });
      new MutationObserver((ms) => {
        for (const m of ms)
          if ((m.target as HTMLElement).tagName === "BUTTON")
            (window as any).surfaceButtonChanges.push(
              (m.target as HTMLElement).outerHTML,
            );
      }).observe(document.getElementById("spatial-animation-section")!, {
        subtree: true,
        attributes: true,
        attributeFilter: ["disabled"],
      });
    });
    const box = (await slider.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, {
      steps: 12,
    });
    await page.mouse.up();
    expect(
      await page.evaluate(() => (window as any).surfaceButtonChanges),
    ).toEqual([]);
    const prepared = await page.evaluate(() =>
      (window as any).spatialWorkers.reduce(
        (n: number, l: any) => n + l.requests.length,
        0,
      ),
    );
    for (const t of [1, 0, 0.5]) {
      await slider.fill(String(t));
      await expect(page.locator(".spatial-stage")).toHaveAttribute(
        "data-time",
        String(t),
      );
    }
    expect(
      await page.evaluate(() =>
        (window as any).spatialWorkers.reduce(
          (n: number, l: any) => n + l.requests.length,
          0,
        ),
      ),
    ).toBe(prepared);
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    const bytes = await pngStill(page);
    expect(pngMetadata(bytes).family.settings.target).toBe("surfaceB");
    await page
      .getByRole("button", { name: "Export image", exact: true })
      .click();
    const download = page.waitForEvent("download");
    await page
      .getByRole("menuitem", { name: "Lines (SVG) · every line", exact: true })
      .click();
    const svg = await (
      await import("node:fs/promises")
    ).readFile((await (await download).path())!, "utf8");
    expect(
      [...svg.matchAll(/data-family-member="(\d+)"/g)].map((m) => Number(m[1])),
    ).toContain(15);
    expect(svg.includes("<text")).toBe(false);
    await page
      .getByRole("checkbox", { name: "Finite engraving", exact: true })
      .uncheck();
    await settled(page);
    await expect(
      page.getByRole("textbox", { name: "Associate angle θ", exact: true }),
    ).toHaveValue("0");
    await info.attach("walkthrough", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  });

import { EngineError } from "../web/engine-client";
test("surface request assignment and canceled replies retain no stale slots or source mutations", async () => {
  const calls: {
    config: any;
    resolve: (v: any) => void;
    reject: (e: Error) => void;
  }[] = [];
  const job = new family.SpatialFamily(
    {
      computeSpatial: (config) =>
        new Promise((resolve, reject) =>
          calls.push({ config, resolve, reject }),
        ),
    },
    () => {},
  );
  const c = source().config,
    f = { ...settings(), count: 2, width: 1 };
  const original = structuredClone(c);
  job.generate(c, f);
  expect(calls).toHaveLength(1);
  job.generate(c, { ...f, from: 0.4, to: 0.6 });
  calls[0].reject(new EngineError("old invalid member", "surface.b"));
  await expect.poll(() => calls.length).toBe(2);
  expect(job.state.members.every((m) => !m.error && !m.frame)).toBe(true);
  expect(calls[1].config.surface.b).toBe(0.4);
  calls[1].reject(new EngineError("unavailable fixture", "surface.b"));
  await expect.poll(() => calls.length).toBe(3);
  expect(calls[2].config.surface.b).toBe(0.6);
  calls[2].reject(new EngineError("unavailable fixture", "surface.b"));
  await expect.poll(() => job.state.pending).toBe(false);
  expect(job.state.members.map((m) => [m.id, m.value, m.error])).toEqual([
    [0, 0.4, "unavailable fixture"],
    [1, 0.6, "unavailable fixture"],
  ]);
  expect(c).toEqual(original);
  expect(job.state.retained).toBe(0);
  job.cancel();
  expect(job.state.members).toEqual([]);
});

for (const expensive of [false, true])
  test(`surface ${expensive ? "edited dense grid" : "signature"} preparation records bounded real worker and renderer observations`, async ({
    page,
  }) => {
    await observeSpatial(page);
    const s = presetStudy(
      spatialPresets.findIndex(
        (p) => p.name === "A surface remembers its bending",
      ),
    );
    if (expensive) {
      const { surfaceDefaults } = await import("../web/spatial/surface");
      Object.assign(s.config.surface, surfaceDefaults.torus, {
        kind: "torus",
        uSamples: 120,
        vSamples: 120,
        curves: 48,
        offset: 0.1,
        reach: 0.3,
      });
      s.family = {
        ...s.family!,
        target: "surfaceA",
        from: 1.6,
        to: 2.4,
        count: 4,
        selected: 1,
        width: 2,
      };
    }
    const start = Date.now();
    await load(page, s);
    const ready = Date.now() - start;
    const observations = await page.evaluate(() => {
      const l = (window as any).spatialWorkers.findLast(
        (l: any) => l.requests.length > 1,
      );
      l.observedFamily = true;
      return l.replies.map((r: any) => ({
        milliseconds: r.observedElapsed,
        bytes: r.observedBytes,
        result: r.result,
        lifted: {
          places: r.lifted.places,
          floats: Array.from(r.lifted.floats),
        },
      }));
    });
    const retained = observations.reduce(
      (n: number, r: any) =>
        n + family.spatialFamilyNumbers(restoredSurface(r)),
      0,
    );
    expect(observations).toHaveLength(s.family!.count);
    expect(retained).toBeGreaterThan(0);
    expect(retained).toBeLessThanOrEqual(4000000);
    console.log(
      JSON.stringify({
        study: expensive
          ? "edited torus grid"
          : "A surface remembers its bending",
        members: s.family!.count,
        grid: [s.config.surface.uSamples, s.config.surface.vSamples],
        curves: s.config.surface.curves,
        loadThroughRenderedReadyMilliseconds: ready,
        workerRoundTripMilliseconds: observations.reduce(
          (n: number, r: any) => n + r.milliseconds,
          0,
        ),
        replyBytes: observations.reduce((n: number, r: any) => n + r.bytes, 0),
        retainedNumericEntries: retained,
        browser: await page.context().browser()!.version(),
      }),
    );
    // Invalidate while a newer surface set owns the queue; an ordinary preset
    // must win, and the worker must release retained work on leaving engraving.
    await page
      .getByRole("spinbutton", { name: "Family members", exact: true })
      .fill(expensive ? "3" : "17");
    await choosePreset(page, 0);
    await settled(page);
    await expect(page.locator(".spatial-stage")).not.toHaveAttribute(
      "data-engraving",
    );
    expect(
      await page.evaluate(() =>
        (window as any).spatialWorkers
          .filter((l: any) => l.observedFamily)
          .every((l: any) => l.terminated),
      ),
    ).toBe(true);
  });
