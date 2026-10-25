import { decodePng } from "./png";
import { defaultCut } from "../web/spatial/cut";
import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import { deflateRawSync } from "node:zlib";
import { buildScene, defaultLayers } from "../web/spatial/scene";
import { receiverShade } from "../web/spatial/renderer";
import { presetStudy } from "../web/spatial/link";
import { spatialPresets } from "../web/spatial/presets";
import { palette } from "../web/spatial/palette";
import type { SpatialResult, Vec3 } from "../web/spatial/types";
import { receiverNote } from "../web/spatial/rays";
import { curveMesh } from "./curve-mesh";
import { choosePreset } from "./helpers";
import { helpText } from "../web/help";
import { spatialPlainZoom, viewZoom } from "../web/refinement";
import { receiverViewHelp } from "../web/spatial/receiver-view";

const stage = (page: Page) => page.locator(".spatial-stage");
async function settled(page: Page) {
  await expect(stage(page)).toHaveAttribute("aria-busy", "false");
}

// A result holding only a receiver: a tilted window whose corners are not
// axis aligned, with bins of distinct irradiance.
function receiving(irradiance: number[][]): SpatialResult {
  const corners: [Vec3, Vec3, Vec3, Vec3] = [
    { x: -1, y: -0.5, z: -2 },
    { x: 1, y: -0.5, z: -2 },
    { x: 1, y: 0.5, z: -1.2 },
    { x: -1, y: 0.5, z: -1.2 },
  ];
  const at = (x: number, z = 0): Vec3 => ({ x, y: 0, z });
  const sheet = () => ({
    points: [0, 1].map((i) => [at(i), at(i, 1)]),
    normals: [0, 1].map(() => [null, null]),
    alongU: [[true, true]],
    alongV: [[true], [true]],
    faces: [[true]],
  });
  return {
    base: [],
    minus: [],
    plus: [],
    mesh: curveMesh(),
    rulings: [],
    breaks: [],
    bounds: { center: at(0), radius: 3 },
    radius: 3,
    invalid: 0,
    omitted: 0,
    rays: {
      surface: sheet(),
      caustics: ([1, 2] as const).flatMap((branch) =>
        [false, true].map((virtual) => ({
          ...sheet(),
          branch,
          virtual,
          shape: "sheet" as const,
        })),
      ),
      lines: [],
      uCurves: [0, 1],
      vCurves: [0, 1],
      source: null,
      singular: 0,
      unlit: 0,
      atSource: 0,
      stigmatic: 0,
      total: 0,
      clipped: [0, 0],
      receiver: {
        plane: "z",
        corners,
        size: 2,
        irradiance,
        peak: Math.max(...irradiance.flat()),
        emitted: 1,
        received: 1,
        outside: 0,
        away: 0,
        total: 0,
        edge: 0,
      },
    },
  };
}

test("a receiver inset uses the window peak on the same quad", () => {
  const result = receiving([
    [1, 2],
    [0, 4],
  ]);
  const g = result.rays!.receiver!;
  Object.assign(g, {
    inset: {
      rect: [0.25, 0.125, 0.75, 0.875],
      irradiance: [
        [0, 0.004, 0.04],
        [0.4, 4, 40],
      ],
    },
  });
  const scene = buildScene(result);
  const fine = scene.receiverSheet.inset!;
  expect(scene.receiverSheet.data.length).toBe(6 * 7);
  expect(fine.rect).toEqual([0.25, 0.125, 0.75, 0.875]);
  expect([fine.width, fine.height]).toEqual([2, 3]);
  for (let i = 0; i < 2; i++)
    for (let j = 0; j < 3; j++) {
      const shade = receiverShade(g.inset!.irradiance[i][j], g.peak);
      const k = 4 * (j * 2 + i);
      expect(fine.data[k + 2]).toBe(shade < 0 ? 0 : 255);
      const value = (fine.data[k] * 256 + fine.data[k + 1]) / 65535;
      expect(Math.abs(value - Math.max(0, shade))).toBeLessThanOrEqual(
        0.5 / 65535,
      );
    }
  const light = spatialPresets.find(
    (p) => p.config.rays.receiver.plane !== "none",
  )!.config.rays;
  expect(receiverNote(g, light).join(" ")).toContain(
    "at or above the window's peak",
  );
});

test("a receiver refines to the settled view and drops its inset during playback", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    (window as any).receiverMessages = [];
    Worker.prototype.postMessage = function (data: any, ...rest: any[]) {
      if (data.action === "spatial")
        (window as any).receiverMessages.push({
          view: data.spatialView,
          config: data.spatial,
        });
      return post.call(this, data, ...(rest as [any]));
    };
  });
  await page.goto("/?study=3d");
  await settled(page);
  await choosePreset(page, {
    label: "Conic sections cut from a cone of light",
  });
  await settled(page);
  const option = page.getByRole("checkbox", {
    name: "Refine the receiver to the view",
    exact: true,
  });
  await expect(option).not.toBeChecked();
  const original = await note(page).innerText();
  await option.check();
  await settled(page);
  expect((await config(page)).rays.receiver.refineView).toBe(true);
  await expect(note(page)).toContainText("at or above the window's peak");
  expect((await note(page).innerText()).startsWith(original)).toBe(true);
  const last = () =>
    page.evaluate(() => (window as any).receiverMessages.at(-1));
  expect((await last()).view.pixels.every((n: number) => n > 0)).toBe(true);
  const beforeZoom = (await last()).view.width;
  const canvas = page.locator("#spatial-artwork");
  await canvas.focus();
  await page.keyboard.press("+");
  await settled(page);
  expect((await last()).view.width).toBeLessThan(beforeZoom);
  await page.getByRole("button", { name: "Export image", exact: true }).click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "PNG image · 2000 × 1520", exact: true })
    .click();
  const bytes = await readFile((await (await download).path())!);
  const decoded = decodePng(bytes);
  expect([decoded.width, decoded.height]).toEqual([2000, 1520]);
  expect((await last()).view.pixels).toEqual([2000, 1520]);

  const animation = page.locator("#spatial-animation-section");
  if ((await animation.getAttribute("open")) === null)
    await animation.locator(":scope > summary").click();
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("slider", { name: "Animation progress" }).fill("0.5");
  await expect(stage(page)).toHaveAttribute("data-time", "0.5");
  await settled(page);
  expect((await last()).view).toBeUndefined();
  await expect(note(page)).not.toContainText("inset");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await settled(page);
  await expect(note(page)).toContainText("inset");
  await option.uncheck();
  await settled(page);
  expect((await config(page)).rays.receiver).not.toHaveProperty("refineView");
  await expect(note(page)).not.toContainText("inset");
});

// A receiver is drawn as one quad whose texture holds each bin's shade, so
// its cost does not grow with its bins. Every bin's center, carried through
// the quad's texture coordinates, lands on a texel holding that bin's shade:
// 16 bits of it in red (high) and green (low), with blue marking a bin that
// holds light.
test("a receiver is one quad shaded by a texture of its bins", () => {
  const n = 5;
  const irradiance = Array.from({ length: n }, (_, a) =>
    Array.from({ length: n }, (_, b) =>
      a === b ? 0 : 10 ** ((a - 2 * b) / 3),
    ),
  );
  const result = receiving(irradiance);
  const g = result.rays!.receiver!;
  const sheet = buildScene(result).receiverSheet;
  expect(sheet.mode).toBe("triangles");
  expect(sheet.data.length).toBe(6 * 7);
  const shades = sheet.shades!;
  expect(shades.size).toBe(n);
  expect(shades.data.length).toBe(4 * n * n);
  const [o, a, , b] = g.corners;
  const vertex = (k: number) => ({
    p: [0, 1, 2].map((c) => sheet.data[7 * k + c]),
    st: [sheet.data[7 * k + 3], sheet.data[7 * k + 4]],
  });
  // The texture coordinate at a point of the window, by barycentric
  // interpolation within whichever of the quad's triangles holds it.
  const coordinate = (p: number[]) => {
    for (let t = 0; t < 2; t++) {
      const [v0, v1, v2] = [0, 1, 2].map((k) => vertex(3 * t + k));
      const e1 = v1.p.map((x, c) => x - v0.p[c]),
        e2 = v2.p.map((x, c) => x - v0.p[c]),
        d = p.map((x, c) => x - v0.p[c]);
      const dot = (u: number[], v: number[]) =>
        u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
      const d11 = dot(e1, e1),
        d12 = dot(e1, e2),
        d22 = dot(e2, e2),
        det = d11 * d22 - d12 * d12;
      const s = (d22 * dot(d, e1) - d12 * dot(d, e2)) / det,
        r = (d11 * dot(d, e2) - d12 * dot(d, e1)) / det;
      if (s >= -1e-9 && r >= -1e-9 && s + r <= 1 + 1e-9)
        return [0, 1].map(
          (c) =>
            v0.st[c] + s * (v1.st[c] - v0.st[c]) + r * (v2.st[c] - v0.st[c]),
        );
    }
    throw new Error(`no triangle holds ${p}`);
  };
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const s = (i + 0.5) / n,
        t = (j + 0.5) / n;
      const center = (["x", "y", "z"] as const).map(
        (c) => o[c] + s * (a[c] - o[c]) + t * (b[c] - o[c]),
      );
      const [u, v] = coordinate(center);
      const texel = 4 * (Math.floor(v * n) * n + Math.floor(u * n));
      const [hi, lo, lit] = shades.data.subarray(texel, texel + 3);
      const shade = receiverShade(irradiance[i][j], g.peak);
      if (shade < 0) expect(lit).toBe(0);
      else {
        expect(lit).toBe(255);
        expect(Math.abs((hi * 256 + lo) / 65535 - shade)).toBeLessThanOrEqual(
          0.5 / 65535,
        );
      }
    }
});

// A paraboloid's focus lands in one bin of a window centered off it, bin
// (1, 6) of 9: the drawing, seen face on from above with x to the right and
// y up, shows that bin at its own place in the window, at the peak's shade.
test("a receiver draws each bin where it lies on its window", async ({
  page,
}) => {
  const study = presetStudy(
    spatialPresets.findIndex((p) => p.name === "A cup's nephroid on its floor"),
  );
  study.config.surface = {
    ...study.config.surface,
    kind: "paraboloid",
    a: 0.5,
    b: 0.5,
    c: 0,
    uMin: -1,
    uMax: 1,
    vMin: -1,
    vMax: 1,
    uSamples: 24,
    vSamples: 24,
    reverse: false,
  };
  study.config.rays = {
    ...study.config.rays,
    interaction: "reflect",
    light: "parallel",
    azimuth: 0,
    elevation: -90,
    receiver: { plane: "z", at: 1, c1: 0.3, c2: -0.2, size: 1, bins: 9 },
  };
  study.layers = Object.fromEntries(
    Object.keys(defaultLayers).map((k) => [k, k === "receiver"]),
  ) as typeof defaultLayers;
  study.view = { yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0 };
  study.animation.mode = "parameters";
  study.animation.tracks = [];
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(
    `/?study=3d#s=${deflateRawSync(
      Buffer.from(JSON.stringify({ v: 1, notebook: "3d", study })),
    ).toString("base64url")}`,
  );
  await settled(page);
  const [empty, full] = [palette.empty[0], palette.full[0]].map((c) =>
    c.map((x) => Math.round(255 * x)),
  );
  const found = await page.locator("#spatial-artwork").evaluate(
    (canvas: HTMLCanvasElement, [empty, full]) => {
      const gl = canvas.getContext("webgl")!;
      const w = canvas.width,
        h = canvas.height,
        data = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
      const near = (k: number, c: number[]) =>
        Math.abs(data[k] - c[0]) <= 2 &&
        Math.abs(data[k + 1] - c[1]) <= 2 &&
        Math.abs(data[k + 2] - c[2]) <= 2;
      // readPixels counts rows from the bottom.
      let left = w,
        right = -1,
        bottom = h,
        top = -1,
        sx = 0,
        sy = 0,
        lit = 0;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const k = 4 * (y * w + x),
            peak = near(k, full);
          if (!peak && !near(k, empty)) continue;
          left = Math.min(left, x);
          right = Math.max(right, x);
          bottom = Math.min(bottom, y);
          top = Math.max(top, y);
          if (peak) {
            sx += x + 0.5;
            sy += y + 0.5;
            lit++;
          }
        }
      return { left, right: right + 1, bottom, top: top + 1, lit, sx, sy };
    },
    [empty, full],
  );
  const width = found.right - found.left,
    height = found.top - found.bottom;
  expect(width).toBeGreaterThan(100);
  expect(Math.abs(width - height)).toBeLessThanOrEqual(2);
  // About one bin's area at the peak's shade, centered on bin (1, 6).
  expect(found.lit).toBeGreaterThan(0.6 * (width / 9) ** 2);
  expect(found.lit).toBeLessThan(1.4 * (width / 9) ** 2);
  expect((found.sx / found.lit - found.left) / width).toBeCloseTo(1.5 / 9, 1);
  expect((found.sy / found.lit - found.bottom) / height).toBeCloseTo(
    6.5 / 9,
    1,
  );
});

async function config(page: Page) {
  const text = await stage(page).getAttribute("data-config");
  return text ? JSON.parse(text) : undefined;
}
const pixels = (page: Page) =>
  page
    .locator("#spatial-artwork")
    .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
const note = (page: Page) => page.getByTestId("rays-note");

// Refinement is off until chosen, leaving older studies' drawings as they
// were; levels split cells and say how many, and returning to 0 restores
// the drawing and leaves the field out of the study again.
test("a receiver refines its cells where its light lands coarsely", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await settled(page);
  await choosePreset(page, {
    label: "Conic sections cut from a cone of light",
  });
  await settled(page);
  const levels = page.getByLabel("Refinement levels", { exact: true });
  await expect(levels).toHaveValue("0");
  expect((await config(page)).rays.receiver).not.toHaveProperty("refine");
  await expect(note(page)).not.toContainText("split");
  const plain = await pixels(page);
  await levels.fill("2");
  await settled(page);
  expect((await config(page)).rays.receiver.refine).toBe(2);
  await expect(note(page)).toContainText(
    /[\d,]+ cells were split where their light lands coarsely on the window\./,
  );
  expect(await pixels(page)).not.toBe(plain);
  await levels.fill("4");
  await expect(page.getByRole("alert")).toContainText("0–3 refinement levels");
  await levels.fill("0");
  await settled(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect((await config(page)).rays.receiver).not.toHaveProperty("refine");
  expect(await pixels(page)).toBe(plain);
  // Bins reach 960 each way.
  const bins = page.getByLabel("Bins", { exact: true });
  await bins.fill("961");
  await expect(page.getByRole("alert")).toContainText("8–960 bins");
  await bins.fill("960");
  await settled(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect((await config(page)).rays.receiver.bins).toBe(960);
});

// A budget that runs out is said so, beside how many cells were split.
test("a receiver's note says when refinement ran out of cells", () => {
  const g = receiving([
    [1, 2],
    [0, 4],
  ]).rays!.receiver!;
  const light = spatialPresets.find(
    (p) => p.name === "Conic sections cut from a cone of light",
  )!.config.rays;
  expect(receiverNote(g, light).join(" ")).not.toContain("split");
  expect(receiverNote({ ...g, split: 1 }, light).join(" ")).toContain(
    "1 cell was split where its light lands coarsely on the window.",
  );
  expect(
    receiverNote({ ...g, split: 170000, exhausted: true }, light).join(" "),
  ).toContain(
    "170,000 cells were split where their light lands coarsely on the window, until the budget of 524,288 cells ran out.",
  );
});

// A refined receiver plays the cone's turn of the screen with its levels
// kept in every frame, comes home to the drawing it started from, and
// stopping restores the study; choosing another example starts unrefined.
test("a refined receiver plays its animation and gives way to a preset", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await settled(page);
  await choosePreset(page, {
    label: "Conic sections cut from a cone of light",
  });
  await settled(page);
  await page.getByLabel("Refinement levels", { exact: true }).fill("1");
  await settled(page);
  const base = await config(page);
  expect(base.rays.receiver.refine).toBe(1);
  const opening = await pixels(page);
  const section = page.locator("#spatial-animation-section");
  if ((await section.getAttribute("open")) === null)
    await section.locator(":scope > summary").click();
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", { name: "Animation progress" });
  await slider.fill("0.5");
  await expect(stage(page)).toHaveAttribute("data-time", "0.5");
  await settled(page);
  expect((await config(page)).rays.receiver).toMatchObject({
    tilt: 75,
    refine: 1,
  });
  await expect(note(page)).toContainText("cells were split");
  expect(await pixels(page)).not.toBe(opening);
  await slider.fill("0");
  await expect(stage(page)).toHaveAttribute("data-time", "0");
  await settled(page);
  expect(await pixels(page)).toBe(opening);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await settled(page);
  expect(await config(page)).toEqual(base);
  await choosePreset(page, { label: "A glass dome's ring of light" });
  await settled(page);
  expect((await config(page)).rays.receiver).not.toHaveProperty("refine");
  await expect(
    page.getByLabel("Refinement levels", { exact: true }),
  ).toHaveValue("0");
});

// A lamp of unit intensity 1 above a flat mirror lights a receiver 2 above
// it from the lamp's image S′ = (0, 0, −1), E = 3/|Y − S′|³, so each bin's
// mean irradiance, and from it its shade, is known: each bin's middle is
// drawn in that shade's color, between the faintest and the peak's.
for (const inset of [false, true])
  test(`a receiver shades ${inset ? "its view inset" : "each bin"} by its own irradiance`, async ({
    page,
  }) => {
    const study = presetStudy(
      spatialPresets.findIndex(
        (p) => p.name === "A cup's nephroid on its floor",
      ),
    );
    study.config.surface = {
      ...study.config.surface,
      kind: "paraboloid",
      a: 0,
      b: 0,
      c: 0,
      uMin: -1,
      uMax: 1,
      vMin: -1,
      vMax: 1,
      uSamples: 120,
      vSamples: 120,
      reverse: false,
    };
    // The mirror's light covers [−3, 3]² of the plane, the whole window.
    const n = 8,
      size = 5.6,
      c1 = 0,
      c2 = 0;
    study.config.rays = {
      ...study.config.rays,
      interaction: "reflect",
      light: "point",
      source: { x: 0, y: 0, z: 1 },
      receiver: {
        plane: "z",
        at: 2,
        c1,
        c2,
        size,
        bins: n,
        ...(inset && { refineView: true }),
      },
    };
    study.layers = Object.fromEntries(
      Object.keys(defaultLayers).map((k) => [k, k === "receiver"]),
    ) as typeof defaultLayers;
    study.view = { yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0 };
    study.animation.mode = "parameters";
    study.animation.tracks = [];
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(
      `/?study=3d#s=${deflateRawSync(
        Buffer.from(JSON.stringify({ v: 1, notebook: "3d", study })),
      ).toString("base64url")}`,
    );
    await settled(page);
    // Each bin's mean of E by 8-point Gauss–Legendre.
    const nodes = [
      -0.9602898564975363, -0.796666477413627, -0.525532409916329,
      -0.1834346424956498, 0.1834346424956498, 0.525532409916329,
      0.796666477413627, 0.9602898564975363,
    ];
    const weights = [
      0.1012285362903763, 0.2223810344533745, 0.3137066458778873,
      0.362683783378362, 0.362683783378362, 0.3137066458778873,
      0.2223810344533745, 0.1012285362903763,
    ];
    const bin = size / n;
    const mean = (a: number, b: number) => {
      let s = 0;
      nodes.forEach((x, k) =>
        nodes.forEach((y, l) => {
          const px = c1 - size / 2 + (a + 0.5 + x / 2) * bin,
            py = c2 - size / 2 + (b + 0.5 + y / 2) * bin;
          s += (weights[k] * weights[l] * 3) / Math.hypot(px, py, 3) ** 3;
        }),
      );
      return s / 4;
    };
    const means = Array.from({ length: n }, (_, a) =>
      Array.from({ length: n }, (_, b) => mean(a, b)),
    );
    const peak = Math.max(...means.flat());
    const [faint, full] = [palette.faint[0], palette.full[0]];
    const background = palette.background[0].map((x) => Math.round(255 * x));
    const drawn = await page.locator("#spatial-artwork").evaluate(
      (canvas: HTMLCanvasElement, [background, n]) => {
        const gl = canvas.getContext("webgl")!;
        const w = canvas.width,
          h = canvas.height,
          data = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
        let left = w,
          right = -1,
          bottom = h,
          top = -1;
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const k = 4 * (y * w + x);
            if (
              [0, 1, 2].every((c) => Math.abs(data[k + c] - background[c]) <= 2)
            )
              continue;
            left = Math.min(left, x);
            right = Math.max(right, x + 1);
            bottom = Math.min(bottom, y);
            top = Math.max(top, y + 1);
          }
        const out: number[][][] = [];
        for (let a = 0; a < n; a++) {
          out.push([]);
          for (let b = 0; b < n; b++) {
            const x = Math.floor(left + ((a + 0.5) / n) * (right - left)),
              y = Math.floor(bottom + ((b + 0.5) / n) * (top - bottom)),
              k = 4 * (y * w + x);
            out[a].push([data[k], data[k + 1], data[k + 2]]);
          }
        }
        const colors = new Set<string>();
        const y = Math.floor((bottom + top) / 2);
        for (let x = left + 4; x < right - 4; x++) {
          const k = 4 * (y * w + x);
          colors.add([data[k], data[k + 1], data[k + 2]].join(","));
        }
        return { out, width: right - left, colors: colors.size };
      },
      [background, n] as const,
    );
    expect(drawn.width).toBeGreaterThan(100);
    if (inset) expect(drawn.colors).toBeGreaterThan(20);
    let spread = 0;
    for (let a = 0; a < n; a++)
      for (let b = 0; b < n; b++) {
        const px = c1 - size / 2 + (a + 0.5) * bin,
          py = c2 - size / 2 + (b + 0.5) * bin;
        const shade = receiverShade(
          inset ? 3 / Math.hypot(px, py, 3) ** 3 : means[a][b],
          peak,
        );
        spread = Math.max(spread, 1 - shade);
        const want = faint.map((f, c) => 255 * (f + (full[c] - f) * shade));
        drawn.out[a][b].forEach((v, c) =>
          expect(Math.abs(v - want[c]), `bin (${a}, ${b})`).toBeLessThanOrEqual(
            3,
          ),
        );
      }
    // The bins span a good part of the ramp, not just its ends.
    expect(spread).toBeGreaterThan(0.1);
  });

test("a glass dome's close-up preset opens refined and plays its own receiver motion", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await settled(page);
  await choosePreset(page, { label: "A glass dome's luminous ring, close up" });
  await settled(page);
  await expect(
    page.getByRole("checkbox", {
      name: "Refine the receiver to the view",
      exact: true,
    }),
  ).toBeChecked();
  await expect(note(page)).toContainText("inset");
  const original = await config(page);
  expect(
    JSON.parse(
      (await page.locator("#spatial-artwork").getAttribute("data-view"))!,
    ).zoom,
  ).toBe(12);
  const section = page.locator("#spatial-animation-section");
  if ((await section.getAttribute("open")) === null)
    await section.locator(":scope > summary").click();
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const progress = page.getByRole("slider", { name: "Animation progress" });
  await progress.fill("0.25");
  await expect(stage(page)).toHaveAttribute("data-time", "0.25");
  await settled(page);
  expect((await config(page)).rays.receiver).toMatchObject({
    refineView: true,
    refine: 2,
  });
  expect((await config(page)).rays.receiver.at).toBeCloseTo(-1.975, 12);
  await progress.fill("0.5");
  await expect(stage(page)).toHaveAttribute("data-time", "0.5");
  await settled(page);
  expect((await config(page)).rays.receiver.at).toBe(-2.05);
  await progress.fill("1");
  await expect(stage(page)).toHaveAttribute("data-time", "1");
  await settled(page);
  expect((await config(page)).rays.receiver.at).toBe(-1.9);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await settled(page);
  expect(await config(page)).toEqual(original);
  await expect(note(page)).toContainText("inset");
  // The option lifts the zoom limit, as refining curves to the view does:
  // without it, the preset's opening zoom of 12 stops at the plain limit.
  await page
    .getByRole("checkbox", {
      name: "Refine the receiver to the view",
      exact: true,
    })
    .uncheck();
  await settled(page);
  await expect
    .poll(
      async () =>
        JSON.parse(
          (await page.locator("#spatial-artwork").getAttribute("data-view"))!,
        ).zoom,
    )
    .toBe(spatialPlainZoom);
  await expect(note(page)).not.toContainText("inset");
});

// The monkey saddle's preset opens face on to a 960-bin screen refined
// twice, and plays its own sinking screen with every frame refined: the
// deltoid closes in, and the screen comes back to its opening drawing.
test("a monkey saddle's deltoid plays on a fine refined screen", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await settled(page);
  await choosePreset(page, {
    label: "A deltoid of light beneath a monkey saddle",
  });
  await settled(page);
  const base = await config(page);
  expect(base.rays.receiver).toMatchObject({ bins: 960, refine: 2, at: -1.6 });
  expect(base.rays.receiver).not.toHaveProperty("refineView");
  expect(
    JSON.parse(
      (await page.locator("#spatial-artwork").getAttribute("data-view"))!,
    ),
  ).toMatchObject({ yaw: 0, pitch: 0, zoom: 5.5 });
  await expect(note(page)).toContainText(
    /[\d,]+ cells were split where their light lands coarsely on the window\./,
  );
  await expect(note(page)).not.toContainText("budget");
  const opening = await pixels(page);
  const section = page.locator("#spatial-animation-section");
  if ((await section.getAttribute("open")) === null)
    await section.locator(":scope > summary").click();
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const progress = page.getByRole("slider", { name: "Animation progress" });
  await progress.fill("0.25");
  await expect(stage(page)).toHaveAttribute("data-time", "0.25");
  await settled(page);
  expect((await config(page)).rays.receiver.at).toBeCloseTo(-2.3, 12);
  await progress.fill("0.5");
  await expect(stage(page)).toHaveAttribute("data-time", "0.5");
  await settled(page);
  expect((await config(page)).rays.receiver).toMatchObject({
    at: -3,
    bins: 960,
    refine: 2,
  });
  await expect(note(page)).toContainText("cells were split");
  expect(await pixels(page)).not.toBe(opening);
  await progress.fill("1");
  await expect(stage(page)).toHaveAttribute("data-time", "1");
  await settled(page);
  expect((await config(page)).rays.receiver.at).toBe(-1.6);
  expect(await pixels(page)).toBe(opening);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await settled(page);
  expect(await config(page)).toEqual(base);
});

test("the receiver view's help states the zoom it allows", () => {
  const help = helpText(receiverViewHelp);
  expect(help).toContain(`${viewZoom.toLocaleString("en-US")}×`);
  expect(help).toContain(`zoom stops at ${spatialPlainZoom}×`);
});

test("the receiver inset follows layers, cuts and see-through sheets", async ({
  page,
}) => {
  const study = presetStudy(
    spatialPresets.findIndex(
      (p) => p.name === "A glass dome's luminous ring, close up",
    ),
  );
  study.cut = {
    ...defaultCut,
    enabled: true,
    normal: { x: 1, y: 0, z: 0 },
    cuts: "all",
    edge: false,
  };
  study.sight = { ...study.sight, sheets: "through", opacity: 0.6 };
  await page.goto(
    `/?study=3d#s=${deflateRawSync(Buffer.from(JSON.stringify({ v: 1, notebook: "3d", study }))).toString("base64url")}`,
  );
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
  await settled(page);
  await expect(note(page)).toContainText("inset");
  const coverage = () =>
    page.locator("#spatial-artwork").evaluate((c: HTMLCanvasElement) => {
      const gl = c.getContext("webgl")!,
        w = c.width,
        h = c.height,
        data = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
      const bg = Array.from(
        data.subarray(
          4 * (Math.floor(h / 2) * w + w - 1),
          4 * (Math.floor(h / 2) * w + w - 1) + 3,
        ),
      );
      const count = [0, 0];
      for (let y = Math.floor(h * 0.3); y < h * 0.7; y++)
        for (let x = Math.floor(w * 0.1); x < w * 0.9; x++) {
          const k = 4 * (y * w + x);
          if (bg.some((b, j) => Math.abs(b - data[k + j]) > 4))
            count[x < w / 2 ? 0 : 1]++;
        }
      return count;
    });
  const cut = await coverage();
  expect(cut[0]).toBeGreaterThan(1000);
  expect(cut[1]).toBeLessThan(20);
  const box = page.getByRole("group", { name: "Cut away" });
  await box.getByRole("checkbox", { name: "Cut with a plane" }).uncheck();
  await expect.poll(async () => (await coverage())[1]).toBeGreaterThan(1000);
  const layer = page.getByRole("checkbox", {
    name: "Receiver irradiance",
    exact: true,
  });
  await layer.uncheck();
  await expect
    .poll(async () => (await coverage()).reduce((a, b) => a + b, 0))
    .toBe(0);
  await layer.check();
  await expect.poll(async () => (await coverage())[1]).toBeGreaterThan(1000);
});

test("moving the camera hides an inset while the new view is still computing", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    (window as any).receiverQueued = 0;
    Worker.prototype.postMessage = function (data: any, ...rest: any[]) {
      if (
        (window as any).delayReceiver &&
        data.action === "spatial" &&
        data.spatialView
      ) {
        (window as any).receiverQueued++;
        setTimeout(() => post.call(this, data, ...(rest as [any])), 1000);
        return;
      }
      return post.call(this, data, ...(rest as [any]));
    };
  });
  await page.goto("/?study=3d");
  await settled(page);
  await choosePreset(page, { label: "A glass dome's luminous ring, close up" });
  await settled(page);
  await expect(note(page)).toContainText("inset");
  await page.evaluate(() => {
    (window as any).delayReceiver = true;
  });
  await page.locator("#spatial-artwork").focus();
  await page.keyboard.press("+");
  await expect
    .poll(() => page.evaluate(() => (window as any).receiverQueued))
    .toBeGreaterThan(0);
  // The settle timer has fired and the request is waiting for the worker.
  // The prior view's inset must remain hidden throughout that wait.
  expect(await note(page).innerText()).not.toContain("inset");
  await settled(page);
  await expect(note(page)).toContainText("inset");
});

// The bridge consumes lifted output arrays. Exercise several frames in
// one real browser worker, comparing each reply with a cold computation
// after releasing the cache, including every bin and the fitted bounds.
test("receiver frame reuse survives lifted WASM replies", async ({ page }) => {
  await page.goto("/?study=3d");
  await settled(page);
  const preset = spatialPresets.find(
    (p) => p.name === "Conic sections cut from a cone of light",
  )!;
  const base = structuredClone(preset.config);
  base.surface.uSamples = 24;
  base.surface.vSamples = 12;
  base.rays.receiver = { ...base.rays.receiver, bins: 48, refine: 2 };
  const worker = page
    .workers()
    .find((worker) => worker.url().includes("engine.worker"))!;
  expect(worker).toBeTruthy();
  const reply = (request: typeof base) =>
    worker.evaluate((request) => {
      const bridge = (
        globalThis as unknown as {
          tangentGardenSpatial: (json: string) =>
            | string
            | {
                json: string;
                lifted: { places: string; floats: Float64Array };
              };
        }
      ).tangentGardenSpatial;
      const result = bridge(JSON.stringify(request));
      if (typeof result === "string") throw new Error(result);
      return {
        json: result.json,
        places: result.lifted.places,
        values: Array.from(result.lifted.floats),
      };
    }, request);
  const cold = async (request: typeof base) => {
    await reply({
      ...request,
      rays: {
        ...request.rays,
        receiver: { ...request.rays.receiver, plane: "none" },
      },
    });
    return reply(request);
  };
  const opening = await cold(base);
  for (const target of ["none", "light", "mirror", "light", "none"]) {
    for (const tilt of [75, 45, 20]) {
      const request = {
        ...base,
        lightDiagnostics: target === "light",
        surfaceDiagnostics: target === "mirror",
        rays: { ...base.rays, receiver: { ...base.rays.receiver, tilt } },
      };
      const warm = await reply(request);
      expect(await reply(request)).toEqual(warm);
      expect(warm).toEqual(await cold(request));
    }
  }
  expect(await reply(base)).toEqual(opening);
  const changed = { ...base, rays: { ...base.rays, n2: 1.3 } };
  const edited = await reply(changed);
  expect(edited).not.toEqual(opening);
  expect(edited).toEqual(await cold(changed));
});
