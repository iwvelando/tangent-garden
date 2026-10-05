import { test, expect, type Page } from "@playwright/test";
import { choosePreset } from "./helpers";
import { deflateRawSync } from "node:zlib";
import { camera } from "../web/spatial/scene";
import { namedViews, turnTo, type NamedView } from "../web/named-views";
import { spatialPresets } from "../web/spatial/presets";
import { defaultLayers } from "../web/spatial/renderer";
import { defaultPath } from "../web/spatial/path";
import { defaultRide } from "../web/spatial/ride";

// Named views and the orientation indicator, shared by the 3D and 4D
// turntables (web/named-views.ts).
type V = [number, number, number];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// The rows of the 3D drawing's own rotation: right, up and toward the viewer.
function rows(view: { yaw: number; pitch: number }) {
  const r = camera(
    {
      ...view,
      zoom: 1,
      panX: 0,
      panY: 0,
      center: { x: 0, y: 0, z: 0 },
      radius: 1,
    } as Parameters<typeof camera>[0],
    { width: 1000, height: 760 },
  ).rotation;
  return {
    right: [r[0], r[3], r[6]] as V,
    up: [r[1], r[4], r[7]] as V,
    back: [r[2], r[5], r[8]] as V,
  };
}
const close = (a: V, b: V) =>
  a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 12));

test("each named view faces the drawing from its side, through the 3D camera", () => {
  const front = rows(namedViews.front);
  close(front.right, [1, 0, 0]);
  close(front.up, [0, 1, 0]);
  close(front.back, [0, 0, 1]);
  // From −x, so z increases to the right.
  const side = rows(namedViews.side);
  close(side.right, [0, 0, 1]);
  close(side.up, [0, 1, 0]);
  close(side.back, [-1, 0, 0]);
  // From above, x to the right and −z up the page, the turntable's 1.5 rad
  // (about 4.1°) short of overhead.
  const top = rows(namedViews.top);
  close(top.right, [1, 0, 0]);
  expect(Math.acos(dot(top.back, [0, 1, 0]))).toBeCloseTo(
    Math.PI / 2 - 1.5,
    12,
  );
  expect(dot(top.up, [0, 0, -1])).toBeGreaterThan(0.99);
  // Equal angles to the three axes from the (+, +, +) octant, x and z
  // descending to either side with y straight up the page.
  const iso = rows(namedViews.isometric);
  close(iso.back, [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)]);
  expect(iso.right[1]).toBeCloseTo(0, 12);
  expect(iso.right[0]).toBeGreaterThan(0);
  expect(iso.up[0]).toBeCloseTo(iso.up[2], 12);
  for (const axis of [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ] as V[])
    expect(Math.hypot(dot(axis, iso.right), dot(axis, iso.up))).toBeCloseTo(
      Math.sqrt(2 / 3),
      12,
    );
});

test("a named view turns the camera and keeps its zoom and pan", () => {
  const view = { yaw: 2.4, pitch: -0.7, zoom: 1.7, panX: 0.3, panY: -0.2 };
  for (const name of Object.keys(namedViews) as NamedView[])
    expect(turnTo(view, name)).toEqual({
      ...view,
      yaw: namedViews[name].yaw,
      pitch: namedViews[name].pitch,
    });
  // Within the turntable's pitch range, as links require.
  for (const v of Object.values(namedViews))
    expect(Math.abs(v.pitch)).toBeLessThanOrEqual(1.5);
});

// The 3D notebook.
const stage = (page: Page) => page.locator(".spatial-stage");
const settled = (page: Page) =>
  expect(stage(page)).toHaveAttribute("aria-busy", "false");
const shownView = async (page: Page) =>
  JSON.parse(
    (await page.locator("#spatial-artwork").getAttribute("data-view"))!,
  );
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
const views = (page: Page) =>
  page.getByRole("group", { name: "Named views", exact: true });
// An indicator axis's direction on the page, y up, of unit length when it
// lies in the page.
async function axis(page: Page, name: "x" | "y" | "z") {
  const g = page.locator(`.orientation [data-axis="${name}"]`);
  const line = g.locator("line");
  const [x2, y2, radius] = await Promise.all([
    line.getAttribute("x2"),
    line.getAttribute("y2"),
    g.getAttribute("data-radius"),
  ]);
  return {
    x: +x2! / +radius!,
    y: -+y2! / +radius!,
    facing: await g.getAttribute("data-facing"),
  };
}
const manual = { yaw: -0.4, pitch: 0.5, zoom: 1.3, panX: 0.2, panY: 0.1 };
async function openSpatial(page: Page) {
  const study = {
    config: spatialPresets[0].config,
    layers: defaultLayers,
    view: manual,
    animation: {
      mode: "orbit",
      camera: "hold",
      duration: 6,
      tracks: [],
      path: defaultPath,
      ride: defaultRide,
    },
  };
  await page.goto(
    `/?study=3d#s=${deflateRawSync(
      Buffer.from(JSON.stringify({ v: 1, notebook: "3d", study })),
    ).toString("base64url")}`,
  );
  await settled(page);
}

test("3D: named views turn the drawing's camera, and the indicator follows it", async ({
  page,
}) => {
  await openSpatial(page);
  const group = views(page);
  await group.getByRole("button", { name: "Front", exact: true }).click();
  await expect
    .poll(() => shownView(page))
    .toMatchObject({
      ...manual,
      yaw: 0,
      pitch: 0,
    });
  await expect.poll(async () => (await axis(page, "x")).x).toBeCloseTo(1, 9);
  expect((await axis(page, "x")).y).toBeCloseTo(0, 9);
  expect((await axis(page, "y")).x).toBeCloseTo(0, 9);
  expect((await axis(page, "y")).y).toBeCloseTo(1, 9);
  await expect.poll(async () => (await axis(page, "z")).facing).toBe("toward");
  await expect.poll(async () => (await axis(page, "x")).facing).toBe("across");

  await group.getByRole("button", { name: "Side", exact: true }).click();
  await expect
    .poll(() => shownView(page))
    .toMatchObject({ yaw: Math.PI / 2, pitch: 0 });
  await expect.poll(async () => (await axis(page, "z")).x).toBeCloseTo(1, 9);
  await expect.poll(async () => (await axis(page, "x")).facing).toBe("away");

  await group.getByRole("button", { name: "Top", exact: true }).click();
  await expect
    .poll(() => shownView(page))
    .toMatchObject({ yaw: 0, pitch: 1.5 });
  await expect.poll(async () => (await axis(page, "y")).facing).toBe("toward");
  await expect.poll(async () => (await axis(page, "z")).y).toBeLessThan(-0.99);

  await group.getByRole("button", { name: "Isometric", exact: true }).click();
  await expect
    .poll(async () => (await shownView(page)).yaw)
    .toBeCloseTo(-Math.PI / 4, 12);
  const iso = await shownView(page);
  expect(iso.yaw).toBeCloseTo(-Math.PI / 4, 12);
  expect(iso.pitch).toBeCloseTo(Math.asin(1 / Math.sqrt(3)), 12);
  // The three axes are drawn equally long.
  await expect
    .poll(async () => (await axis(page, "y")).y)
    .toBeCloseTo(Math.sqrt(2 / 3), 9);
  const axes = await Promise.all(
    (["x", "y", "z"] as const).map((n) => axis(page, n)),
  );
  for (const a of axes) expect(Math.hypot(a.x, a.y)).toBeCloseTo(0.8165, 3);
  // Zoom and pan are kept throughout.
  expect(iso).toMatchObject({ zoom: 1.3, panX: 0.2, panY: 0.1 });

  // The keys orbit on from there, and the indicator turns with them.
  const before = await axis(page, "x");
  await page.locator("#spatial-artwork").focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(async () => (await shownView(page)).yaw)
    .toBeCloseTo(-Math.PI / 4 + 0.1, 12);
  await expect
    .poll(async () => (await axis(page, "x")).x)
    .not.toBeCloseTo(before.x, 3);

  // A turn stops the rotation, so the chosen view holds.
  await button(page, "Rotate view").click();
  await group.getByRole("button", { name: "Front", exact: true }).click();
  await expect(button(page, "Rotate view")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect.poll(() => shownView(page)).toMatchObject({ yaw: 0, pitch: 0 });
  const held = await shownView(page);
  await page.waitForTimeout(200);
  expect(await shownView(page)).toEqual(held);
  expect(held).toMatchObject({ yaw: 0, pitch: 0 });

  // A link carries the resulting camera.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await button(page, "Copy link").click();
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  const href = await page.evaluate(() => navigator.clipboard.readText());
  const other = await page.context().newPage();
  await other.goto(href);
  await settled(other);
  expect(await shownView(other)).toMatchObject({ ...manual, yaw: 0, pitch: 0 });
});

test("3D: a preset opens at its own view after a turn", async ({ page }) => {
  await openSpatial(page);
  await views(page).getByRole("button", { name: "Front", exact: true }).click();
  await expect.poll(() => shownView(page)).toMatchObject({ yaw: 0, pitch: 0 });
  await choosePreset(page, {
    label: "A Lissajous knot, seen from three sides",
  });
  await settled(page);
  await expect
    .poll(async () => (await shownView(page)).yaw)
    .toBeCloseTo(-Math.PI / 4, 12);
  expect((await shownView(page)).pitch).toBeCloseTo(
    Math.asin(1 / Math.sqrt(3)),
    12,
  );
  expect((await shownView(page)).zoom).toBe(1.1);
});

// The indicator's labels stay inside its own box from every named view and
// upside down, so nothing spills onto the page around it.
test("the indicator's labels stay within its box", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSpatial(page);
  const inside = () =>
    page.locator(".orientation-axes").evaluate((svg) => {
      const box = svg.getBoundingClientRect();
      return Array.from(svg.querySelectorAll("text, circle"), (t) => {
        const r = t.getBoundingClientRect();
        return (
          r.left >= box.left - 0.5 &&
          r.right <= box.right + 0.5 &&
          r.top >= box.top - 0.5 &&
          r.bottom <= box.bottom + 0.5
        );
      }).every(Boolean);
    });
  for (const name of ["Front", "Side", "Top", "Isometric"]) {
    await views(page).getByRole("button", { name, exact: true }).click();
    await expect.poll(inside, name).toBe(true);
  }
  // Upside down: z down the page, y toward the viewer.
  await page.locator("#spatial-artwork").focus();
  for (const key of ["ArrowLeft", "ArrowDown", "ArrowDown"])
    await page.keyboard.press(key);
  await expect.poll(inside).toBe(true);
});

test("3D: named views wait while an animation drives the camera", async ({
  page,
}) => {
  await openSpatial(page);
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
  await button(page, "Play animation").click();
  await button(page, "Pause").click();
  for (const name of ["Front", "Side", "Top", "Isometric"])
    await expect(
      views(page).getByRole("button", { name, exact: true }),
    ).toBeDisabled();
  // The indicator shows the animation's camera.
  await page.getByRole("slider", { name: "Animation progress" }).fill("0.25");
  await expect(stage(page)).toHaveAttribute("data-progress", "0.25");
  const turning = await shownView(page);
  const x = await axis(page, "x");
  expect(x.x).toBeCloseTo(Math.cos(turning.yaw), 9);
  await button(page, "Stop").click();
  await expect(
    views(page).getByRole("button", { name: "Front", exact: true }),
  ).toBeEnabled();
});

// The 4D notebook, observed in the drawing: the tesseract's edges, family
// k along axis k, are axis-aligned in the 3D image when no 4D rotation is set.
async function edges(page: Page) {
  return page
    .locator('#tesseract-artwork path[data-guide="false"]')
    .evaluateAll((paths) =>
      paths.map((p) => {
        const n = (p.getAttribute("d") ?? "")
          .split(/[ML ]/)
          .filter(Boolean)
          .map((s) => s.split(",").map(Number));
        const [a, b] = [n[0], n[n.length - 1]];
        return {
          family: +p.getAttribute("data-family")!,
          dx: b[0] - a[0],
          dy: b[1] - a[1],
        };
      }),
    );
}
const tesseractView = async (page: Page) =>
  JSON.parse((await page.locator("#tesseract-artwork desc").textContent())!)
    .view;

test("4D: named views turn the shadow's camera, seen in the edges", async ({
  page,
}) => {
  await page.goto("/?study=4d");
  const settle = () =>
    expect(page.locator(".tesseract-stage")).toHaveAttribute(
      "aria-busy",
      "false",
    );
  await settle();
  const group = views(page);
  await group.getByRole("button", { name: "Front", exact: true }).click();
  await expect
    .poll(() => tesseractView(page))
    .toMatchObject({
      yaw: 0,
      pitch: 0,
    });
  for (const e of await edges(page)) {
    if (e.family === 0) {
      expect(Math.abs(e.dy)).toBeLessThan(1e-3);
      expect(Math.abs(e.dx)).toBeGreaterThan(1);
    }
    if (e.family === 1) expect(Math.abs(e.dx)).toBeLessThan(1e-3);
    // Seen end on.
    if (e.family === 2) expect(Math.hypot(e.dx, e.dy)).toBeLessThan(1e-3);
  }
  expect((await axis(page, "z")).facing).toBe("toward");

  await group.getByRole("button", { name: "Side", exact: true }).click();
  for (const e of await edges(page)) {
    if (e.family === 2) {
      expect(Math.abs(e.dy)).toBeLessThan(1e-3);
      expect(e.dx).not.toBe(0);
    }
    if (e.family === 0) expect(Math.hypot(e.dx, e.dy)).toBeLessThan(1e-3);
  }

  await group.getByRole("button", { name: "Isometric", exact: true }).click();
  // The outer cube's edges, the longest of each family, are drawn equally
  // long.
  const all = await edges(page);
  const lengths = [0, 1, 2].map((k) =>
    Math.max(
      ...all.filter((e) => e.family === k).map((e) => Math.hypot(e.dx, e.dy)),
    ),
  );
  expect(lengths[1] / lengths[0]).toBeCloseTo(1, 4);
  expect(lengths[2] / lengths[0]).toBeCloseTo(1, 4);
  // Zoom and pan are kept.
  expect(await tesseractView(page)).toMatchObject({
    zoom: 1,
    panX: 0,
    panY: 0,
  });
});

test("4D: a flat coordinate diagram has no named views; side by side they turn the shadow", async ({
  page,
}) => {
  await page.goto("/?study=4d");
  const settle = () =>
    expect(page.locator(".tesseract-stage")).toHaveAttribute(
      "aria-busy",
      "false",
    );
  await settle();
  await expect(views(page)).toBeVisible();
  await choosePreset(page, { label: "Beside the wall" });
  await settle();
  const operation = page.getByRole("combobox", {
    name: "View operation",
    exact: true,
  });
  await operation.selectOption("diagram");
  await settle();
  await expect(views(page)).toHaveCount(0);
  await expect(page.locator(".orientation")).toHaveCount(0);
  await operation.selectOption("paired");
  await settle();
  await views(page).getByRole("button", { name: "Top", exact: true }).click();
  const meta = JSON.parse(
    (await page.locator("#tesseract-artwork > desc").textContent())!,
  );
  expect(meta.views[0].view).toMatchObject({ yaw: 0, pitch: 1.5 });
  // The diagram's own camera is untouched.
  expect(meta.views[1].view).toMatchObject({ yaw: 0.32, pitch: 0.35 });
});
