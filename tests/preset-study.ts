import { test, expect, type Page } from "@playwright/test";
import { wireStudy } from "./study-link-wire";
import { deflateRawSync } from "node:zlib";
import { choosePreset } from "./helpers";
import { presets } from "../web/presets";
import { spatialPresets } from "../web/spatial/presets";
import { tesseractPresets } from "../web/tesseract/presets";
import type { PlanarStudy } from "../web/planar-link";
import type { SpatialStudy } from "../web/spatial/link";
import type { TesseractStudy } from "../web/tesseract/link";

// Choosing an example replaces the whole study: its curve, layers, line
// weight, probe, camera and animation setup, every one the example's own or
// the notebook's default, and nothing kept from the study before it. A
// study's every field is what its link carries, so each example is compared
// by its link: chosen after a study edited in every field, and chosen on a
// page that only ever showed examples.

// Links are read here with Node's zlib, independently of the app.
const token = (notebook: string, study: unknown) =>
  deflateRawSync(
    Buffer.from(JSON.stringify({ v: 1, notebook, study })),
  ).toString("base64url");
const unpack = (href: string) => wireStudy(/#s=(.*)$/.exec(href)![1]);

export type Notebook<Study> = {
  name: "2d" | "3d" | "4d";
  url: string;
  stage: string;
  count: number;
  // The example the edited study starts from.
  start: string | { label: string };
  // Every field of the study, changed from what any example opens with.
  edit: (study: Study) => Study;
  // Checks example i's study against its own definition, which the
  // notebook's defaults fill in.
  own: (i: number, study: Study) => void;
};
export const app = (page: Page) => page.locator(".app:visible");

export const planar: Notebook<PlanarStudy> = {
  name: "2d",
  url: "/",
  stage: ".plot-wrap",
  count: presets.length,
  start: "0",
  edit: (s) => ({
    ...s,
    length: 1.7,
    stop: true,
    poleKind: "orthotomic",
    layers: { ...s.layers, lines: false, axes: true },
    camera: { x: 0.25, y: -0.5, zoom: 1.6 },
    weight: "bold",
    probe: { enabled: true, position: 0.3 },
    animation: {
      mode: "parameters",
      camera: "fit",
      duration: 23,
      tracks: [{ target: "a", from: "1", to: "2" }],
      repeat: "back-and-forth",
      pace: "ease",
      probeMotion: "length",
      path: {
        style: "smooth",
        keys: [
          { name: "Near", x: 0, y: 0, zoom: 2 },
          { name: "Far", x: 30, y: -20, zoom: 0.5 },
        ],
      },
    },
  }),
  own: (i, s) => {
    const p = presets[i];
    expect(s.config).toEqual(p.config);
    expect(s.probe).toEqual(p.probe ?? { enabled: false, position: 0.5 });
    expect(s.stop).toBe(!!p.stop);
    expect(s.animation).toMatchObject(
      p.animation ?? { mode: "reveal", repeat: "once", tracks: [] },
    );
  },
};
// The gyroid's shape parameter a is a target in every implicit example,
// so its track would be kept by one whose surface does not use a.
export const spatial: Notebook<SpatialStudy> = {
  name: "3d",
  url: "/?study=3d",
  stage: ".spatial-stage",
  count: spatialPresets.length,
  start: { label: "A gyroid, cut open" },
  edit: (s) => ({
    ...s,
    layers: { ...s.layers, surface: false, box: false },
    view: { yaw: 1.1, pitch: 0.2, zoom: 1.4, panX: 0.1, panY: -0.1 },
    animation: {
      ...s.animation,
      mode: "parameters",
      camera: "fit",
      duration: 23,
      tracks: [{ target: "implicitA", from: "1", to: "3" }],
      repeat: "back-and-forth",
      pace: "ease",
      path: {
        style: "smooth",
        keys: [
          {
            name: "Near",
            yaw: 0.3,
            pitch: 0.75,
            zoom: 2,
            panX: 0,
            panY: 0,
            turns: 0,
          },
          {
            name: "Far",
            yaw: 1.2,
            pitch: 0.2,
            zoom: 0.5,
            panX: 0,
            panY: 0,
            turns: 1,
          },
        ],
      },
      ride: { i: 3, j: 4, follow: 0.5, turn: 0.7 },
    },
    probe: { ...s.probe, enabled: true, position: 0.3, across: 0.7 },
    cut: {
      enabled: true,
      normal: { x: 1, y: 0, z: 0 },
      offset: 0.5,
      cuts: "all",
      edge: false,
    },
    sight: {
      sheets: "through",
      opacity: 0.6,
      hidden: "dashed",
      weight: "bold",
    },
    projection: "chosen",
    lensAngle: 35,
  }),
  // A flight's camera path is flown with the geometry fixed, or as the
  // camera while its tracks move it (presets.ts's Flight).
  own: (i, s) => {
    const p = spatialPresets[i],
      f = p.flight;
    expect(s.config).toEqual(p.config);
    expect(s.probe.enabled).toBe(!!p.probe?.enabled);
    expect(s.projection).toBe(p.projection ?? "orthographic");
    const a = s.animation;
    expect(a.repeat).toBe(f?.repeat ?? "once");
    expect(a.pace).toBe(f?.pace ?? "steady");
    if (!f) {
      expect(a).toMatchObject({ mode: "reveal", camera: "hold", tracks: [] });
      return;
    }
    expect(a.duration).toBe(f.duration);
    expect(a.path).toEqual(f.path);
    if (!f.animate) {
      expect(a.mode).toBe("path");
      return;
    }
    expect(a.mode).toBe(f.animate.mode);
    expect(a.camera).toBe(f.ride ? "ride" : (f.camera ?? "path"));
    if (f.ride) expect(a.ride).toEqual(f.ride);
    expect(a.tracks).toEqual(f.animate.tracks ?? []);
    expect(a.probeMotion).toBe(f.animate.probe ?? "stays");
  },
};
export const tesseract: Notebook<TesseractStudy> = {
  name: "4d",
  url: "/?study=4d",
  stage: ".tesseract-stage",
  count: tesseractPresets.length,
  start: "0",
  edit: (s) => ({
    ...s,
    layers: { ...s.layers, guides: false, faces: false, weight: "bold" },
    view: { yaw: 1.1, pitch: 0.2, zoom: 1.4, panX: 0.1, panY: -0.1 },
    diagramView: { yaw: -0.4, pitch: 0.6, zoom: 0.8, panX: 0, panY: 0.2 },
    duration: 23,
    repeat: "back-and-forth",
    pace: "ease",
  }),
  own: (i, s) => {
    const p = tesseractPresets[i];
    // An angle such as asin(1/√3) may differ by its last bit between Node's
    // math library and the browser's.
    const { angles, ...config } = s.config;
    expect(config).toEqual({ ...p.config, angles: undefined });
    angles.forEach((angle, k) =>
      expect(angle).toBeCloseTo(p.config.angles[k], 15),
    );
    expect(s.motion).toBe(p.motion);
    expect(s.repeat).toBe(p.repeat ?? "once");
    expect(s.pace).toBe(p.pace ?? "steady");
  },
};

// Some examples take several seconds to draw, more when tests run side by
// side.
export async function settled(page: Page, stage: string) {
  await expect(page.locator(stage)).toHaveAttribute("aria-busy", "false", {
    timeout: 30_000,
  });
}
// The study as its link carries it.
async function linked(page: Page) {
  const copied = app(page).getByText("Link copied", { exact: true });
  await expect(copied).toHaveCount(0);
  await app(page)
    .getByRole("button", { name: "Copy link", exact: true })
    .click();
  await expect(copied).toBeVisible();
  const study = unpack(
    await page.evaluate(() => navigator.clipboard.readText()),
  );
  // The notice is dismissed by a press elsewhere, so the next copy shows its
  // own.
  await page.mouse.click(1, 1);
  return study;
}
// Opens a link and waits until the whole study is applied, every edit
// surviving it. A heavy 3D example can take longer than the default wait
// to load and read its link when tests run side by side.
async function openLink<S>(page: Page, n: Notebook<S>, link: string, study: S) {
  await page.goto(`${n.url}#s=${link}`);
  await expect
    .poll(() => page.evaluate(() => location.hash), { timeout: 30_000 })
    .toBe("");
  await settled(page, n.stage);
  await expect.poll(() => linked(page), { timeout: 30_000 }).toEqual(study);
}

// Examples first to last, in tests of a few each, so each test stays
// within CI's limit.
export function walk<S>(n: Notebook<S>, first = 0, last = n.count - 1) {
  const chunk = 15;
  for (let from = first; from <= last; from += chunk) {
    const to = Math.min(from + chunk - 1, last);
    test(`${n.name}: examples ${from}–${to} replace the whole study`, async ({
      page,
      context,
    }) => {
      test.setTimeout(240_000);
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      // The edited study, made from an example's own link.
      await page.goto(n.url);
      await choosePreset(page, n.start);
      await settled(page, n.stage);
      const edited = n.edit(await linked(page));
      const link = token(n.name, edited);
      // A page that only ever shows examples.
      const plain = await context.newPage();
      await plain.goto(n.url);
      await settled(plain, n.stage);
      for (let i = from; i <= to; i++) {
        await choosePreset(plain, String(i));
        await settled(plain, n.stage);
        const expected = await linked(plain);
        n.own(i, expected);
        await openLink(page, n, link, edited);
        await choosePreset(page, String(i));
        await settled(page, n.stage);
        expect(await linked(page), `example ${i}`).toEqual(expected);
      }
    });
  }
}
