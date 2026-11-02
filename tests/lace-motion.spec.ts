import { test, expect, type Page, type Locator } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { decodeVideo, frameDifference, probe } from "./video";
import { wireStudy } from "./study-link-wire";

// Hyperbolic lace in motion: the disk isometry and its closed path, through
// the notebook's playback, seeking, editing, following, links and exports.
// Every expectation of where a tile is drawn comes from the isometry's
// definition, written out here, applied to the unmoved drawing; the
// engine's own checks are engine/lace_motion_test.go's.

const stars = "Seven-pointed stars receding to the rim";
const glide = "A tile glides to the center and back";

type C = { x: number; y: number };
const mul = (a: C, b: C) => ({
  x: a.x * b.x - a.y * b.y,
  y: a.x * b.y + a.y * b.x,
});
const div = (a: C, b: C) => {
  const n = b.x * b.x + b.y * b.y;
  return { x: (a.x * b.x + a.y * b.y) / n, y: (a.y * b.x - a.x * b.y) / n };
};
const polar = (r: number, t: number) => ({
  x: r * Math.cos(t),
  y: r * Math.sin(t),
});
type Iso = { offset: number; direction: number; rotation: number };
type Path = { offset: number; orbits: number; turns: number };
// T(z) = e^{iθ}(z − a)/(1 − āz), a = offset·e^{i·direction}.
const isometry = (iso: Iso) => (z: C) => {
  const a = polar(iso.offset, iso.direction);
  const top = { x: z.x - a.x, y: z.y - a.y };
  const bottom = mul({ x: a.x, y: -a.y }, z);
  return mul(
    polar(1, iso.rotation),
    div(top, { x: 1 - bottom.x, y: -bottom.y }),
  );
};
// The documented path: the offset eases from the start's to the farthest
// and back, the direction orbits, the rotation turns.
const along = (start: Iso, m: Path, p: number): Iso => {
  const s = (1 - Math.cos(2 * Math.PI * p)) / 2;
  return {
    offset: (1 - s) * start.offset + s * m.offset,
    direction: start.direction + 2 * Math.PI * m.orbits * p,
    rotation: start.rotation + 2 * Math.PI * m.turns * p,
  };
};

async function openLace(page: Page, title = stars) {
  await page.goto("/");
  await page.getByRole("button", { name: "Browse notebook examples" }).click();
  const gallery = page.getByRole("dialog", { name: "Notebook examples" });
  await gallery
    .locator(`[data-lace-example][data-example-title="${title}"]`)
    .click();
  await gallery.waitFor({ state: "hidden" });
  const d = page.getByRole("dialog", { name: "Hyperbolic lace" });
  await ready(d);
  return d;
}
const art = (d: Locator) => d.locator("#lace-artwork");
const ready = (d: Locator) =>
  expect(art(d)).toHaveAttribute("aria-busy", "false");
const slider = (d: Locator) =>
  d.getByRole("slider", { name: "Animation progress" });
const motionTime = (d: Locator) => d.locator(".garden-view");
async function seek(d: Locator, time: string) {
  await slider(d).fill(time);
  await expect(motionTime(d)).toHaveAttribute("data-motion-time", time);
  await ready(d);
}
// The drawing's markup without the attributes that name its state.
const markup = (d: Locator) =>
  art(d).evaluate((svg) =>
    svg.innerHTML.replace(/\s(?:data|aria)-[\w-]+="[^"]*"/g, ""),
  );
// The selected tile's drawn corners, in model units: the ends of its seven
// sides, at the camera's zoom (the pan is the group's translation).
async function corners(d: Locator): Promise<C[]> {
  const zoom = Number(await art(d).getAttribute("data-zoom"));
  const ds = await art(d).evaluate((svg) =>
    Array.from(svg.querySelectorAll('path[data-role="selectedEdge"]'), (p) =>
      p.getAttribute("d"),
    ),
  );
  const points = new Map<string, C>();
  for (const d of ds)
    for (const m of d!.matchAll(
      /M(-?[\d.]+) (-?[\d.]+)(?:A-?[\d.]+ -?[\d.]+ 0 0 [01] |L)(-?[\d.]+) (-?[\d.]+)/g,
    ))
      for (const [x, y] of [
        [m[1], m[2]],
        [m[3], m[4]],
      ])
        points.set(`${x},${y}`, {
          x: (+x - 500) / (350 * zoom),
          y: (380 - +y) / (350 * zoom),
        });
  expect(points.size).toBe(7);
  return [...points.values()];
}
// Each expected corner is drawn within the drawing's rounding, in page
// units at 1× (coordinates are written to three decimals).
function expectCorners(drawn: C[], want: C[], tolerance = 0.002 / 350) {
  expect(drawn).toHaveLength(want.length);
  for (const w of want) {
    const gap = Math.min(...drawn.map((p) => Math.hypot(p.x - w.x, p.y - w.y)));
    expect(gap, `corner (${w.x}, ${w.y})`).toBeLessThan(tolerance);
  }
}
// The error shown under a control, which names it by id.
const errorOf = async (d: Locator, field: Locator) =>
  d.locator(`[id="${await field.getAttribute("id")}-error"]`);
const glideStart: Iso = { offset: 0, direction: -Math.PI / 14, rotation: 0 };
const glidePath: Path = { offset: 0.71814307181038606, orbits: 0, turns: 0 };

test("a loop's ends are compared as the whole drawing, and a mismatch is refused", async () => {
  const { laceLoopRefusal } = await import("../web/lace/export");
  const { movedResult } = await import("../web/lace/model");
  // One straight-sided tile and its motif: enough drawing to compare.
  const ring = (r: number, turn = 0) =>
    Array.from({ length: 7 }, (_, k) =>
      polar(r, Math.PI / 2 + (2 * Math.PI * k) / 7 + turn),
    );
  const tile = (turn: number) => {
    const v = ring(0.3, turn),
      m = ring(0.25, turn + Math.PI / 7);
    return {
      tiling: "7,3",
      center: [{ x: 0, y: 0 }],
      depth: [0],
      parent: [-1],
      via: [-1],
      reversed: [false],
      transform: [[1, 0, 0, 0] as [number, number, number, number]],
      corners: [0, 1, 2, 3, 4, 5, 6],
      sides: [0, 1, 2, 3, 4, 5, 6],
      vertex: v,
      vertexTiles: v.map(() => 1),
      edgeA: [0, 1, 2, 3, 4, 5, 6],
      edgeB: [1, 2, 3, 4, 5, 6, 0],
      edgeTiles: v.map(() => 1),
      edgeCenter: v.map(() => ({ x: 0, y: 0 })),
      edgeRadius: v.map(() => 0),
      edgeStraight: v.map(() => true),
      arcStart: m.flatMap((p) => [p, p]),
      arcEnd: m.flatMap((_, k) => [{ x: 0, y: 0 }, m[(k + 1) % 7]]),
      arcCenter: m.flatMap(() => [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ]),
      arcRadius: m.flatMap(() => [0, 0]),
      arcStraight: m.flatMap(() => [true, true]),
      omitted: { depth: 0, precision: 0 },
      stopped: "" as const,
      pending: 0,
      processed: 0,
      duplicates: 0,
      vertexRadius: 0.3,
      circumradius: 0.62,
      apothem: 0.55,
      sideLength: 0.57,
      isometry: { offset: 0, direction: 0, rotation: 0 },
      coverage: { radius: 0.25, distance: 0.5 },
    };
  };
  const props = {
    result: tile(0),
    edges: true,
    motif: true,
    presentation: "complete" as const,
    selected: 0,
    camera: { x: 0, y: 0, zoom: 1 },
    dark: false,
    scheme: "default" as const,
    weight: "regular" as const,
  };
  expect(laceLoopRefusal(props, { ...props, result: tile(0) })).toBeNull();
  // A frame's geometry over its frozen patch, which ends where it began.
  const { vertex, center, transform, edgeCenter, edgeRadius, edgeStraight } =
    tile(0);
  const back = movedResult(tile(0), {
    ...tile(0),
    vertex,
    center,
    transform,
    edgeCenter,
    edgeRadius,
    edgeStraight,
    progress: 1,
  });
  expect("progress" in back).toBe(false);
  expect(laceLoopRefusal(props, { ...props, result: back })).toBeNull();
  // A turn of a hundredth of a radian moves corners by about a pixel.
  expect(laceLoopRefusal(props, { ...props, result: tile(0.01) })).toMatch(
    /^Repeat can loop only motion that ends where it starts, but the drawing at the end lies up to [\d.]+ pixels from the drawing at the start\. Back and forth returns smoothly\.$/,
  );
  // Layers or the camera differing at the end are refused too.
  expect(laceLoopRefusal(props, { ...props, motif: false })).toMatch(
    /different pieces/,
  );
  expect(
    laceLoopRefusal(props, { ...props, camera: { x: 3, y: 0, zoom: 1 } }),
  ).toMatch(/pixels/);
});

test("seeking draws the frozen patch moved by the path's isometry, and playback, pause and stop agree", async ({
  page,
}) => {
  const d = await openLace(page, glide);
  const tiles = await art(d).getAttribute("data-tiles");
  const still = await markup(d);
  const unmoved = await corners(d);
  await expect(d.locator(".lace-motion-status")).toHaveText(
    "0.0 / 10 s · offset 0.000, direction -0.224, rotation 0.000",
  );
  // Forward, the turning point, the end and backward again: every tile
  // drawn where T(p) carries it, and the same tiles throughout.
  for (const t of [0.25, 0.5, 0.8, 1, 0.3, 0]) {
    await seek(d, String(t));
    const T = isometry(along(glideStart, glidePath, t));
    expectCorners(await corners(d), unmoved.map(T));
    await expect(art(d)).toHaveAttribute("data-tiles", tiles!);
  }
  // Halfway the selected tile is at the disk's center, drawn full size.
  await seek(d, "0.5");
  const middle = await corners(d);
  for (const p of middle) expect(Math.hypot(p.x, p.y)).toBeCloseTo(0.3007, 3);
  await expect(d.locator(".lace-motion-status")).toHaveText(
    "5.0 / 10 s · offset 0.718, direction -0.224, rotation 0.000 · Paused",
  );
  await expect(d.locator(".garden-about")).toContainText(
    "drawn at (0.0000, 0.0000) · hyperbolic distance 1.808 from the center tile and 0.000 from the disk's center · drawn 100% of a tile's size at the disk's center",
  );
  // The finite patch's edge nears the center on the far side: said so.
  await expect(d.locator(".lace-summary")).toContainText(
    "Moved off center, it is complete only to radius 0.901 about the disk's center (hyperbolic distance 2.95); beyond, the tiling goes on but this finite patch stops.",
  );
  // The loop's end is its start: the very same drawing.
  await seek(d, "1");
  expect(await markup(d)).toBe(still);
  // Play from 0.2 and pause: time moves forward, then holds still, and the
  // paused frame is the path's frame at its time.
  await seek(d, "0.2");
  await d.getByRole("button", { name: "Resume motion" }).click();
  await expect
    .poll(async () =>
      Number(await motionTime(d).getAttribute("data-motion-time")),
    )
    .toBeGreaterThan(0.25);
  const image = d.getByRole("button", { name: "Export image" });
  await expect(image).toBeDisabled();
  await d.getByRole("button", { name: "Pause motion" }).click();
  await expect(image).toBeEnabled();
  await ready(d);
  const paused = Number(await motionTime(d).getAttribute("data-motion-time"));
  expect(paused).toBeGreaterThan(0.25);
  await page.waitForTimeout(300);
  expect(Number(await motionTime(d).getAttribute("data-motion-time"))).toBe(
    paused,
  );
  expectCorners(
    await corners(d),
    unmoved.map(isometry(along(glideStart, glidePath, paused))),
  );
  // Resume continues from there; Stop restores the unmoved drawing.
  await d.getByRole("button", { name: "Resume motion" }).click();
  await expect
    .poll(async () =>
      Number(await motionTime(d).getAttribute("data-motion-time")),
    )
    .toBeGreaterThan(paused);
  await d.getByRole("button", { name: "Stop motion" }).click();
  await expect(motionTime(d)).not.toHaveAttribute("data-motion-time", /.*/);
  await ready(d);
  expect(await markup(d)).toBe(still);
  await expect(slider(d)).toHaveValue("0");
  // A short motion played once ends at the unmoved drawing, its slider at
  // the end; a loop keeps going until paused.
  await d.getByLabel("Repeat", { exact: true }).selectOption("once");
  await d.getByLabel("Duration", { exact: true }).fill("0.4");
  await d.getByRole("button", { name: "Play motion" }).click();
  await expect(d.getByRole("button", { name: "Play motion" })).toBeVisible();
  await expect(slider(d)).toHaveValue("1");
  expect(await markup(d)).toBe(still);
});

test("back and forth, a long duration and timing edits keep the frame; path and generation edits end it", async ({
  page,
}) => {
  const d = await openLace(page, glide);
  const still = await markup(d);
  const unmoved = await corners(d);
  await d.getByLabel("Duration", { exact: true }).fill("37.5");
  await d.getByLabel("Repeat", { exact: true }).selectOption("back-and-forth");
  // At time ¾ the motion is halfway back: progress ½.
  await seek(d, "0.75");
  expectCorners(
    await corners(d),
    unmoved.map(isometry(along(glideStart, glidePath, 0.5))),
  );
  await expect(d.locator(".lace-motion-status")).toContainText("28.1 / 37.5 s");
  await seek(d, "1");
  expect(await markup(d)).toBe(still);
  // Timing edits pause and keep the frame; so do selection, presentation,
  // layers and the camera.
  await seek(d, "0.6");
  const frame = await markup(d);
  await d.getByLabel("Duration", { exact: true }).fill("20");
  await expect(motionTime(d)).toHaveAttribute("data-motion-time", "0.6");
  await d.getByLabel("Repeat", { exact: true }).selectOption("loop");
  await expect(motionTime(d)).toHaveAttribute("data-motion-time", "0.6");
  await d.getByRole("button", { name: "Next tile" }).click();
  await d.getByLabel("Presentation", { exact: true }).selectOption("selected");
  await art(d).focus();
  await page.keyboard.press("+");
  await expect(motionTime(d)).toHaveAttribute("data-motion-time", "0.6");
  await expect(art(d)).not.toHaveAttribute("data-zoom", "1");
  await page.keyboard.press("Home");
  await d.getByLabel("Presentation", { exact: true }).selectOption("complete");
  await d.getByRole("button", { name: "Previous tile" }).click();
  await ready(d);
  expect(await markup(d)).toBe(frame);
  // The path's settings end the motion and restore the unmoved drawing.
  for (const [label, value] of [
    ["Orbits", "1"],
    ["Turns", "-1"],
  ] as const) {
    await seek(d, "0.6");
    await d.getByLabel(label, { exact: true }).fill(value);
    await expect(motionTime(d)).not.toHaveAttribute("data-motion-time", /.*/);
    await ready(d);
    expect(await markup(d)).toBe(still);
  }
  // A turn and an orbit: the path's frame, rotated and carried round.
  await seek(d, "0.3");
  expectCorners(
    await corners(d),
    unmoved.map(
      isometry(along(glideStart, { ...glidePath, orbits: 1, turns: -1 }, 0.3)),
    ),
  );
  await d.getByLabel("Farthest offset", { exact: true }).fill("0.2");
  await expect(motionTime(d)).not.toHaveAttribute("data-motion-time", /.*/);
  await seek(d, "0.5");
  expectCorners(
    await corners(d),
    unmoved.map(
      isometry(along(glideStart, { offset: 0.2, orbits: 1, turns: -1 }, 0.5)),
    ),
  );
  // Generation settings end it too, and the new patch moves the same way.
  await d.getByLabel("Depth", { exact: true }).fill("3");
  await expect(motionTime(d)).not.toHaveAttribute("data-motion-time", /.*/);
  await ready(d);
  await expect(d.locator(".lace-summary")).toContainText("85 tiles");
  await seek(d, "0.5");
  await expect(art(d)).toHaveAttribute("data-tiles", "85");
  expectCorners(
    await corners(d),
    unmoved.map(
      isometry(along(glideStart, { offset: 0.2, orbits: 1, turns: -1 }, 0.5)),
    ),
  );
});

test("the static isometry moves the drawing, refusals name their fields, and centering restores it", async ({
  page,
}) => {
  const d = await openLace(page, glide);
  const still = await markup(d);
  const unmoved = await corners(d);
  const offset = d.getByLabel("Offset", { exact: true });
  const direction = d.getByLabel("Direction", { exact: true });
  const rotation = d.getByLabel("Rotation", { exact: true });
  await offset.fill("0.5");
  await direction.fill("pi/2");
  await rotation.fill("0.3");
  await expect(
    d.getByRole("button", { name: "Center the lace" }),
  ).toBeEnabled();
  await ready(d);
  const start = { offset: 0.5, direction: Math.PI / 2, rotation: 0.3 };
  expectCorners(await corners(d), unmoved.map(isometry(start)));
  await expect(d.locator(".lace-summary")).toContainText("Moved off center");
  await expect(d.locator(".lace-motion-status")).toHaveText(
    "0.0 / 10 s · offset 0.500, direction 1.571, rotation 0.300",
  );
  // The motion starts from the static isometry.
  await seek(d, "0.25");
  expectCorners(
    await corners(d),
    unmoved.map(isometry(along(start, glidePath, 0.25))),
  );
  await d.getByRole("button", { name: "Stop motion" }).click();
  await ready(d);
  // Out of range, each refusal sits under its own field, and the previous
  // drawing remains until corrected.
  const moved = await markup(d);
  for (const [field, value, label, message] of [
    [offset, "0.81", "Offset", "offset must be 0–0.8"],
    [direction, "101", "Direction", "direction must be −100–100 radians"],
    [rotation, "-100.5", "Rotation", "rotation must be −100–100 radians"],
  ] as const) {
    const before = await field.inputValue();
    await field.fill(value);
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(await errorOf(d, field)).toContainText(message);
    await expect(d.getByRole("button", { name: "Play motion" })).toBeDisabled();
    expect(await markup(d)).toBe(moved);
    await field.fill(before);
    await expect(field).not.toHaveAttribute("aria-invalid", "true");
    await ready(d);
  }
  for (const [label, value, message] of [
    ["Farthest offset", "0.9", "farthest offset must be 0–0.8"],
    ["Orbits", "4", "orbits must be −3–3"],
    ["Turns", "1.5", "Enter a whole number."],
  ] as const) {
    const field = d.getByLabel(label, { exact: true });
    const before = await field.inputValue();
    await field.fill(value);
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(await errorOf(d, field)).toContainText(message);
    await expect(d.getByRole("button", { name: "Play motion" })).toBeDisabled();
    await expect(slider(d)).toBeDisabled();
    await field.fill(before);
    await expect(field).not.toHaveAttribute("aria-invalid", "true");
  }
  await d.getByLabel("Duration", { exact: true }).fill("0");
  await expect(
    await errorOf(d, d.getByLabel("Duration", { exact: true })),
  ).toContainText("Duration must be 0.1–3,600 seconds.");
  await d.getByLabel("Duration", { exact: true }).fill("10");
  // A constant still being worked out is waited for: Play uses its value.
  const farthest = d.getByLabel("Farthest offset", { exact: true });
  await farthest.fill("0.25 + 0.05");
  await expect(d.getByRole("button", { name: "Play motion" })).toBeEnabled();
  await seek(d, "0.5");
  await expect(d.locator(".lace-motion-status")).toContainText("offset 0.300");
  // Centering restores the unmoved drawing exactly.
  await d.getByRole("button", { name: "Center the lace" }).click();
  await ready(d);
  expect(await markup(d)).toBe(still);
  await expect(
    d.getByRole("button", { name: "Center the lace" }),
  ).toBeDisabled();
  await expect(d.locator(".lace-summary")).not.toContainText("Moved");
});

test("Follow selection moves the camera only on selection, never with the disk", async ({
  page,
}) => {
  const d = await openLace(page, glide);
  await d.getByRole("checkbox", { name: "Follow selection" }).check();
  // The eased move settles at the selected tile's frame.
  const view = async () => [
    await art(d).getAttribute("data-zoom"),
    await art(d).getAttribute("data-pan"),
  ];
  await expect.poll(view).not.toEqual(["1", "0,0"]);
  await page.waitForTimeout(400);
  const framed = await view();
  // While the disk moves, the camera holds: the selected tile leaves its
  // frame rather than being chased.
  await d.getByRole("button", { name: "Play motion" }).click();
  const seen: string[][] = [];
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(150);
    seen.push((await view()) as string[]);
  }
  await d.getByRole("button", { name: "Pause motion" }).click();
  await ready(d);
  for (const v of seen) expect(v).toEqual(framed);
  const time = Number(await motionTime(d).getAttribute("data-motion-time"));
  expect(time).toBeGreaterThan(0.05);
  // A selection made on a moved frame frames the tile where it is drawn.
  await d.getByRole("button", { name: "Next tile" }).click();
  await page.waitForTimeout(400);
  const next = await corners(d);
  const zoom = Number(await art(d).getAttribute("data-zoom"));
  const [px, py] = (await art(d).getAttribute("data-pan"))!
    .split(",")
    .map(Number);
  const xs = next.map((p) => p.x),
    ys = next.map((p) => p.y);
  // Its corners' box is centered in the page.
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2,
    cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  expect(cx * 350 * zoom + px).toBeCloseTo(0, 1);
  expect(-cy * 350 * zoom + py).toBeCloseTo(0, 1);
  expect(await view()).not.toEqual(framed);
  // The frame is unchanged by the camera move.
  expect(Number(await motionTime(d).getAttribute("data-motion-time"))).toBe(
    time,
  );
});

test("links save the isometry and motion, and older links open centered and still", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as any).copied = value;
        },
      },
    }),
  );
  const d = await openLace(page, glide);
  const opening = await markup(d);
  await d.getByLabel("Offset", { exact: true }).fill("0.3");
  await d.getByLabel("Rotation", { exact: true }).fill("pi/7");
  await d.getByLabel("Farthest offset", { exact: true }).fill("0.6");
  await d.getByLabel("Orbits", { exact: true }).fill("-1");
  await d.getByLabel("Duration", { exact: true }).fill("6");
  await d.getByLabel("Repeat", { exact: true }).selectOption("back-and-forth");
  await ready(d);
  // A paused frame is not saved: links hold settings, never playback.
  await seek(d, "0.4");
  await d.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(d.getByText("Link copied", { exact: true })).toBeVisible();
  const link: string = await page.evaluate(() => (window as any).copied);
  const saved = wireStudy(new URL(link).hash.slice(3));
  expect(saved.lace.isometry).toEqual({
    offset: 0.3,
    direction: -Math.PI / 14,
    rotation: Math.PI / 7,
  });
  expect(saved.lace.motion).toEqual({
    offset: 0.6,
    orbits: -1,
    turns: 0,
    duration: 6,
    repeat: "back-and-forth",
  });
  await d.getByRole("button", { name: "Stop motion" }).click();
  await ready(d);
  const moved = await markup(d);
  await page.goto(link);
  const again = page.getByRole("dialog", { name: "Hyperbolic lace" });
  await ready(again);
  expect(await markup(again)).toBe(moved);
  await expect(motionTime(again)).not.toHaveAttribute("data-motion-time", /.*/);
  await expect(again.getByLabel("Orbits", { exact: true })).toHaveValue("-1");
  await expect(again.getByLabel("Repeat", { exact: true })).toHaveValue(
    "back-and-forth",
  );
  // R08.1's links carry neither field: they open centered and still, with
  // the default motion offered.
  const { isometry: _i, motion: _m, ...older } = saved.lace;
  const { deflateRawSync } = await import("node:zlib");
  const token = deflateRawSync(
    JSON.stringify({ v: 1, notebook: "2d", study: { ...saved, lace: older } }),
  ).toString("base64url");
  await page.goto(`/?study=2d#s=${token}`);
  const plain = page.getByRole("dialog", { name: "Hyperbolic lace" });
  await ready(plain);
  expect(await markup(plain)).toBe(opening);
  await expect(plain.getByLabel("Offset", { exact: true })).toHaveValue("0");
  await expect(
    plain.getByLabel("Farthest offset", { exact: true }),
  ).toHaveValue("0.6");
  await expect(plain.getByLabel("Repeat", { exact: true })).toHaveValue("loop");
  await expect(plain.locator(".lace-summary")).not.toContainText("Moved");
});

// The live drawing rasterized from its vector markup at a target size.
const raster = (d: Locator, width: number, height: number) =>
  art(d).evaluate(
    async (live, [width, height]) => {
      const svg = live.cloneNode(true) as SVGSVGElement;
      svg.setAttribute("width", String(width));
      svg.setAttribute("height", String(height));
      const url = URL.createObjectURL(
        new Blob([new XMLSerializer().serializeToString(svg)], {
          type: "image/svg+xml",
        }),
      );
      try {
        const image = new Image();
        image.src = url;
        await image.decode();
        const c = document.createElement("canvas");
        c.width = width;
        c.height = height;
        c.getContext("2d")!.drawImage(image, 0, 0);
        return Array.from(
          c.getContext("2d")!.getImageData(0, 0, width, height).data,
        );
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    [width, height],
  );
async function exportMovie(page: Page, d: Locator, scale: string) {
  const settings = d.locator("#lace-export-settings");
  if (!(await settings.evaluate((e) => (e as HTMLDetailsElement).open)))
    await settings.locator("summary").click();
  await d.getByLabel("Export format", { exact: true }).selectOption("mp4");
  await d.getByRole("slider", { name: "Export resolution" }).fill(scale);
  await d.getByLabel("Export frame rate", { exact: true }).selectOption("15");
  const download = page.waitForEvent("download");
  await d.getByRole("button", { name: /^Export MP4 video/ }).click();
  const path = (await (await download).path())!;
  return { path, bytes: await readFile(path) };
}

test("a paused frame's still and the decoded movie's frames show the moved lace at each time", async ({
  page,
}) => {
  const d = await openLace(page, glide);
  // 1.4 s at 15 fps, played once: 21 frames at times i/20.
  await d.getByLabel("Duration", { exact: true }).fill("1.4");
  await d.getByLabel("Repeat", { exact: true }).selectOption("once");
  await seek(d, "0.5");
  const download = page.waitForEvent("download");
  await d.getByRole("button", { name: "Export image" }).click();
  await page.getByRole("menuitem", { name: /SVG/ }).click();
  const text = await readFile((await (await download).path())!, "utf8");
  const still = await page.evaluate((text) => {
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    return {
      record: JSON.parse(doc.querySelector("svg > desc")!.textContent!),
      selected: Array.from(
        doc.querySelectorAll('path[data-role="selectedEdge"]'),
        (p) => p.getAttribute("d"),
      ),
    };
  }, text);
  expect(still.selected).toEqual(
    await art(d).evaluate((svg) =>
      Array.from(svg.querySelectorAll('path[data-role="selectedEdge"]'), (p) =>
        p.getAttribute("d"),
      ),
    ),
  );
  expect(still.record.motion).toMatchObject({
    start: glideStart,
    farthestOffset: glidePath.offset,
    orbits: 0,
    turns: 0,
    duration: 1.4,
    repeat: "once",
    time: 0.5,
    isometry: { offset: glidePath.offset, direction: -Math.PI / 14 },
    membership: "the same 617 tiles at every time; the camera holds",
  });
  expect(still.record.motion.coverage.radius).toBeCloseTo(0.901, 3);
  // References at frames 0, 5, 10, 15 and 20, and the frames either side
  // for contrast (the glide is symmetric in time, so the frame at 1 − t is
  // no contrast). Seeking backward, since a slider already at 0 cannot be
  // moved to 0.
  const references = new Map<number, number[]>();
  for (const t of [
    1, 0.95, 0.8, 0.75, 0.7, 0.55, 0.5, 0.45, 0.3, 0.25, 0.2, 0.05, 0,
  ]) {
    await seek(d, String(t));
    references.set(t, await raster(d, 500, 380));
  }
  await d.getByRole("button", { name: "Stop motion" }).click();
  await ready(d);
  const mp4 = await exportMovie(page, d, "0.5");
  expect(mp4.bytes.includes(Buffer.from('"kind":"hyperbolic-lace"'))).toBe(
    true,
  );
  const timing = probe(mp4.path);
  if (timing) {
    expect([timing.width, timing.height, timing.frames]).toEqual([
      500, 380, 21,
    ]);
    expect(timing.durations.reduce((a, b) => a + b, 0)).toBe(1400);
  }
  expect((await decodeVideo(page, mp4.bytes)).duration).toBeCloseTo(1.4, 3);
  const compare = (frame: number, t: number) =>
    frameDifference(mp4.path, 500, 380, frame, references.get(t)!);
  // Each frame is its own time's lace: H.264 softens the hairlines toward
  // the rim, most in predicted frames (measured residue 0–0.2 of the ink;
  // a keyframe's is 0), while a frame a twentieth of the motion away
  // differs by 0.36–0.47 of it.
  for (const [frame, t, others] of [
    [0, 0, [0.05]],
    [5, 0.25, [0.2, 0.3]],
    [10, 0.5, [0.45, 0.55]],
    [15, 0.75, [0.7, 0.8]],
    [20, 1, [0.95]],
  ] as const) {
    const own = compare(frame, t);
    if (!own) continue;
    expect(own.meanDifference).toBeLessThan(6);
    expect(own.unmatchedInk).toBeLessThan(0.25);
    for (const other of others)
      expect(compare(frame, other)!.unmatchedInk).toBeGreaterThan(
        own.unmatchedInk + 0.1,
      );
  }
});

test("canceling a motion export discards it and leaves the lace ready", async ({
  page,
}) => {
  const d = await openLace(page, glide);
  await d.getByLabel("Duration", { exact: true }).fill("60");
  let downloads = 0;
  page.on("download", () => downloads++);
  const settings = d.locator("#lace-export-settings");
  await settings.locator("summary").click();
  await d.getByLabel("Export frame rate", { exact: true }).selectOption("15");
  await d
    .getByRole("button", { name: /^Export (MP4 video|animated WebP)/ })
    .click();
  await expect(
    d.getByRole("status").filter({ hasText: "Exporting" }),
  ).toBeVisible();
  await expect
    .poll(async () =>
      Number(
        (
          await d
            .getByRole("status")
            .filter({ hasText: "Exporting" })
            .textContent()
        )?.match(/(\d+)%/)?.[1] ?? 0,
      ),
    )
    .toBeGreaterThan(0);
  await d.getByRole("button", { name: "Cancel export" }).click();
  await expect(
    d.getByRole("status").filter({ hasText: "Exporting" }),
  ).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(downloads).toBe(0);
  // Seeking and playing still work on the frame worker.
  await seek(d, "0.5");
  await expect(d.locator(".lace-motion-status")).toContainText("offset 0.718");
});

for (const [name, viewport] of [
  ["desktop", { width: 1280, height: 800 }],
  ["phone", { width: 390, height: 844 }],
] as const)
  test(`opening a paired help leaves its neighbor in place (${name})`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const d = await openLace(page, glide);
    for (const [left, right] of [
      ["Orbits", "Turns"],
      ["Duration", "Repeat"],
      ["Offset", "Direction"],
    ]) {
      for (const [open, other] of [
        [left, right],
        [right, left],
      ]) {
        const control = d.getByLabel(other, { exact: true });
        await control.scrollIntoViewIfNeeded();
        // Relative to the pair, so that scrolling to a toggle is no move.
        const place = () =>
          control.evaluate((e) => {
            const pair = e.closest(".pair")!.getBoundingClientRect(),
              own = e.getBoundingClientRect();
            return { x: own.x - pair.x, y: own.y - pair.y };
          });
        const before = await place();
        const toggle = d.getByRole("button", { name: `About ${open}` });
        await toggle.click();
        const more = d
          .locator(`#${await toggle.getAttribute("aria-controls")}`)
          .getByRole("button", { name: "Show more" });
        if (await more.count()) await more.click();
        const after = await place();
        expect([after.x, after.y], `${open} beside ${other}`).toEqual([
          before.x,
          before.y,
        ]);
        await toggle.click();
      }
    }
  });

test("motion production measurements: one frame at a time, bounded replies, and cancel ends the export's worker", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    const Native = Worker;
    const w = window as any;
    w.frames = [];
    w.framePeak = 0;
    w.workers = { made: 0, ended: [] as number[] };
    let running = 0;
    window.Worker = class extends Native {
      sent = new Map<number, number>();
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        w.workers.made++;
        this.addEventListener("message", (e) => {
          const sent = this.sent.get(e.data.id);
          if (sent === undefined) return;
          this.sent.delete(e.data.id);
          running--;
          if (!e.data.timings) return;
          const roundTrip = performance.now() - sent;
          // The client restores the lifted arrays in place after this
          // listener runs.
          setTimeout(() =>
            w.frames.push({
              tiles: e.data.result.center.length,
              prepare: e.data.timings.prepare,
              bytes: e.data.timings.bytes,
              roundTrip,
            }),
          );
        });
      }
      postMessage(message: any, ...rest: any[]) {
        if (message.action === "laceFrame") {
          this.sent.set(message.id, performance.now());
          running++;
          w.framePeak = Math.max(w.framePeak, running);
        }
        return super.postMessage(message, ...rest);
      }
      terminate() {
        running -= this.sent.size;
        w.workers.ended.push(performance.now());
        return super.terminate();
      }
    } as typeof Worker;
  });
  const take = () =>
    page.evaluate(() => {
      const w = window as any;
      const out = { frames: w.frames, peak: w.framePeak };
      w.frames = [];
      w.framePeak = 0;
      return out;
    });
  const median = (v: number[]) => [...v].sort((a, b) => a - b)[v.length >> 1];
  const summarize = (rows: any[]) => ({
    frames: rows.length,
    tiles: rows[0]?.tiles,
    bytes: Math.max(...rows.map((r) => r.bytes)),
    prepare: +median(rows.map((r) => r.prepare)).toFixed(1),
    roundTrip: +median(rows.map((r) => r.roundTrip)).toFixed(1),
  });
  // The signature motion, 617 tiles, played for two seconds.
  const d = await openLace(page, glide);
  await take();
  await d.getByRole("button", { name: "Play motion" }).click();
  await page.waitForTimeout(2000);
  await d.getByRole("button", { name: "Pause motion" }).click();
  const signature = await take();
  expect(signature.peak).toBe(1);
  expect(signature.frames.length).toBeGreaterThan(5);
  for (const r of signature.frames) expect(r.tiles).toBe(617);
  // The largest admitted patch, 1,000 tiles: seeks across the motion.
  await d.getByRole("button", { name: "Stop motion" }).click();
  await d.getByLabel("Depth", { exact: true }).fill("8");
  await expect(d.locator(".lace-summary")).toContainText("1,000-tile limit");
  await ready(d);
  await take();
  for (const t of ["0.1", "0.3", "0.5", "0.7", "0.9"]) await seek(d, t);
  const largest = await take();
  expect(largest.peak).toBe(1);
  for (const r of largest.frames) {
    expect(r.tiles).toBe(1000);
    // The frame carries geometry alone, under the full patch's 1.3 MB.
    expect(r.bytes).toBeLessThan(1_100_000);
  }
  await d.getByRole("button", { name: "Resume motion" }).click();
  await page.waitForTimeout(2000);
  await d.getByRole("button", { name: "Pause motion" }).click();
  const largestPlay = await take();
  expect(largestPlay.peak).toBe(1);
  // Export at the largest patch, canceled once frames are being drawn: its
  // worker ends with it, and no file is saved.
  await d.getByLabel("Duration", { exact: true }).fill("60");
  const before = await page.evaluate(() => (window as any).workers);
  await d
    .getByRole("button", { name: /^Export (MP4 video|animated WebP)/ })
    .click();
  const status = d.getByRole("status").filter({ hasText: "Exporting" });
  await expect
    .poll(
      async () =>
        Number((await status.textContent())?.match(/(\d+)%/)?.[1] ?? 0),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
  const exporting = await take();
  const canceled = await page.evaluate(() => performance.now());
  await d.getByRole("button", { name: "Cancel export" }).click();
  await expect(status).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        (since) =>
          (window as any).workers.ended.filter((t: number) => t >= since)
            .length,
        canceled,
      ),
    )
    .toBe(1);
  const after = await page.evaluate(() => (window as any).workers);
  const cancelMs = Math.max(...after.ended) - canceled;
  // One worker for the export, made and ended.
  expect(after.made - before.made).toBe(1);
  console.log(
    "Lace motion production measurements (milliseconds, bytes; Chromium on local Mac):",
    JSON.stringify({
      signature: summarize(signature.frames),
      largestSeek: summarize(largest.frames),
      largestPlay: summarize(largestPlay.frames),
      exportFrames: summarize(exporting.frames),
      cancelToWorkerEnd: +cancelMs.toFixed(1),
    }),
  );
});
