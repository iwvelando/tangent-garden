import { test, expect, type Page } from "@playwright/test";
import { deflateRawSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { choosePreset, open as openDetails } from "./helpers";
import { decodeVideo, frameDifference, probe } from "./video";
import {
  polygonDefaults,
  transportDefaults,
  transportNote,
} from "../web/spatial/geodesics";
import { chevronLines } from "../web/spatial/geodesic-path";
import type {
  GeodesicResult,
  TransportResult,
  Vec3,
} from "../web/spatial/types";
import { spatialPresets } from "../web/spatial/presets";
import { defaultLayers } from "../web/spatial/scene";
import { observeSpatial } from "./spatial-family-helpers";
import { restore } from "../web/lifted";

// A tangent arrow carried around an editable geodesic polygon on a sphere,
// and along threads on the routes admitted after the sphere and torus,
// through the real controls, worker and engine: the polygon's defaults,
// vertex editor, refusals by vertex, notes, legend and links, its
// unavailability off a sphere, the arrow on a cylinder, a paraboloid, a
// three-axis ellipsoid and the helicoid–catenoid family, and a thread's
// near-return.
const stage = (page: Page) => page.locator(".spatial-stage");
const canvas = (page: Page) => page.locator("#spatial-artwork");
const field = (page: Page, name: string) =>
  page.getByRole("textbox", { name, exact: true });
const check = (page: Page, name: string) =>
  page.getByRole("checkbox", { name, exact: true });
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
const carry = (page: Page) => check(page, "Carry a tangent arrow");
const note = (page: Page) => page.getByTestId("transport-note");
const unavailable = (page: Page) => page.getByTestId("transport-unavailable");
const path = (page: Page) => page.getByLabel("Arrow's path", { exact: true });
const settled = (page: Page) =>
  expect(stage(page)).toHaveAttribute("aria-busy", "false");
async function ready(page: Page) {
  await page.goto("/?study=3d");
  await expect(canvas(page)).toBeVisible();
  await settled(page);
}
async function config(page: Page) {
  return JSON.parse((await stage(page).getAttribute("data-config"))!);
}
const pixels = (page: Page) =>
  canvas(page).evaluate((c: HTMLCanvasElement) => c.toDataURL());
// The turn and the signed area a polygon's note reports, in degrees and
// in units of the radius squared.
async function turnAndArea(page: Page) {
  const text = (await note(page).textContent())!;
  const m =
    /comes home turned ([+−]?)([\d.]+)° .* the signed area it encloses, ([+−]?)([\d.]+),/.exec(
      text,
    )!;
  const sign = (s: string) => (s === "−" ? -1 : 1);
  return { turn: sign(m[1]) * +m[2], area: sign(m[3]) * +m[4] };
}
async function openStudy(page: Page, study: unknown) {
  await page.goto("about:blank");
  await page.goto(
    `/?study=3d#s=${deflateRawSync(
      Buffer.from(JSON.stringify({ v: 1, notebook: "3d", study })),
    ).toString("base64url")}`,
  );
  await expect(canvas(page)).toBeVisible();
  await settled(page);
}
const preset = (label: string) => spatialPresets.find((p) => p.name === label)!;
const triangle = { label: "The arrow that came home turned" };
const star = { label: "An arrow carried round a spherical star" };
const sweep = { label: "A star's turn growing with its area" };
const stair = { label: "An arrow that keeps its way as a stair opens" };
async function openAnimation(page: Page) {
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
}
async function paused(page: Page) {
  await openAnimation(page);
  await button(page, "Play animation").click();
  await button(page, "Pause").click();
}
// Seeks the timeline to time t, a share of the duration; back and forth
// reaches the far end at t = ½.
async function seek(page: Page, t: string) {
  await page.getByRole("slider", { name: "Animation progress" }).fill(t);
  await expect(stage(page)).toHaveAttribute("data-time", t);
  await settled(page);
}
// The linework's point counts by group, as an SVG export writes them.
async function lines(page: Page) {
  await button(page, "Export image").click();
  const event = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Lines (SVG) · every line", exact: true })
    .click();
  const svg = (await readFile((await (await event).path())!)).toString();
  const groups: Record<string, number> = {};
  for (const m of svg.matchAll(/<g id="([a-z0-9-]+)"[^>]*>(.*?)<\/g>/gs))
    groups[m[1]] = (groups[m[1]] ?? 0) + [...m[2].matchAll(/[ML]-?\d/g)].length;
  return groups;
}

test("a polygon starts as the octant, takes edits, adds and removes vertices, and refuses by vertex", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, triangle);
  await settled(page);
  const octant = await pixels(page);
  await path(page).selectOption("polygon");
  await settled(page);
  let surface = (await config(page)).surface;
  expect(surface.geodesics.transport.vertices).toEqual(polygonDefaults());
  expect(polygonDefaults()).toEqual([
    { u: 0, v: 0 },
    { u: Math.PI / 2, v: 0 },
    { u: 0, v: Math.PI / 2 },
  ]);
  await expect(field(page, "Vertex 2 u")).toHaveValue("pi/2");
  await expect(field(page, "Vertex 3 v")).toHaveValue("pi/2");
  await expect(note(page)).toContainText(
    "Around the polygon the arrow comes home turned +90° about the outward normal: the signed area it encloses, +1.5708, times the curvature 1/r².",
  );
  await expect(page.locator(".legend")).toContainText("Geodesic polygon");
  // The same path as the triangle, with its sides' direction marked.
  expect(await pixels(page)).not.toBe(octant);
  // Three is the fewest.
  for (const k of [1, 2, 3])
    await expect(button(page, `Remove vertex ${k}`)).toBeDisabled();
  // An added vertex halves the closing side, so the path and the turn stay.
  await button(page, "Add a vertex").click();
  await settled(page);
  const four = (await config(page)).surface.geodesics.transport.vertices;
  expect(four).toHaveLength(4);
  expect(four[3].u).toBe(0);
  // The middle of the closing side, π/4 up to rounding, shown as such.
  expect(four[3].v).toBe(Math.PI / 4);
  await expect(field(page, "Vertex 4 v")).toHaveValue("pi/4");
  await expect(note(page)).toContainText("comes home turned +90°");
  await expect(button(page, "Remove vertex 2")).toBeEnabled();
  // Moving a vertex changes the area and the turn together.
  await field(page, "Vertex 2 v").fill("pi/6");
  await settled(page);
  await expect(note(page)).not.toContainText("+90°");
  // On the unit sphere the turn is the area, in radians.
  const { turn, area } = await turnAndArea(page);
  expect(Math.abs(turn - (area * 180) / Math.PI)).toBeLessThan(0.05);
  // A side whose ends lie opposite is refused under its later vertex.
  const drawn = await pixels(page);
  await field(page, "Vertex 2 u").fill("pi");
  await field(page, "Vertex 2 v").fill("0");
  await expect(page.getByRole("alert")).toContainText(
    "vertices 1 and 2 lie opposite, so no single shortest arc joins them",
  );
  await field(page, "Vertex 2 u").fill("pi/2");
  await field(page, "Vertex 2 v").fill("pi/6");
  await settled(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(await pixels(page)).toBe(drawn);
  await field(page, "Vertex 1 v").fill("2");
  await expect(page.getByRole("alert")).toContainText(
    "vertex 1: v is a latitude, within ±π/2",
  );
  await field(page, "Vertex 1 v").fill("0");
  await settled(page);
  // Removing a vertex renumbers the rest.
  await button(page, "Remove vertex 4").click();
  await settled(page);
  surface = (await config(page)).surface;
  expect(surface.geodesics.transport.vertices).toHaveLength(3);
  await expect(field(page, "Vertex 4 u")).toHaveCount(0);
  // Twelve is the most.
  for (let k = 3; k < 12; k++) await button(page, "Add a vertex").click();
  await settled(page);
  await expect(button(page, "At most 12 vertices")).toBeDisabled();
  expect(
    (await config(page)).surface.geodesics.transport.vertices,
  ).toHaveLength(12);
  // Back to the triangle, the vertices are kept for the next polygon.
  await path(page).selectOption("triangle");
  await settled(page);
  expect(await pixels(page)).toBe(octant);
  expect(
    (await config(page)).surface.geodesics.transport.vertices,
  ).toHaveLength(12);
  await path(page).selectOption("polygon");
  await settled(page);
  await expect(field(page, "Vertex 12 u")).toBeVisible();
});

test("off a sphere the polygon is unavailable and keeps its vertices; on a sphere again it is drawn", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, triangle);
  await settled(page);
  await path(page).selectOption("polygon");
  await settled(page);
  await field(page, "Vertex 2 v").fill("0.3");
  await settled(page);
  const sphere = await pixels(page);
  await field(page, "Axis c").fill("0.7");
  await settled(page);
  await expect(unavailable(page)).toHaveText(
    "A geodesic polygon is drawn on a sphere; on this surface the arrow can follow the selected thread.",
  );
  await expect(note(page)).toHaveCount(0);
  await expect(field(page, "Vertex 2 v")).toHaveValue("0.3");
  await field(page, "Axis c").fill("1");
  await settled(page);
  await expect(unavailable(page)).toHaveCount(0);
  expect(await pixels(page)).toBe(sphere);
});

test("a link keeps the polygon, and a link from before polygons opens as before", async ({
  page,
}) => {
  const p = preset(triangle.label);
  const vertices = [
    { u: 0, v: 0.2 },
    { u: 1.5, v: -0.3 },
    { u: 1.5, v: 0.6 },
    { u: 0, v: -0.4 },
  ];
  const study = {
    config: {
      ...p.config,
      surface: {
        ...p.config.surface,
        geodesics: {
          ...p.config.surface.geodesics!,
          transport: {
            ...p.config.surface.geodesics!.transport!,
            path: "polygon",
            vertices,
          },
        },
      },
    },
    layers: { ...defaultLayers, ...p.layers },
    view: p.view,
  };
  await openStudy(page, study);
  expect((await config(page)).surface.geodesics.transport.vertices).toEqual(
    vertices,
  );
  // Its sides cross: the regions are counted with their turns, and the
  // two lobes run opposite ways.
  await expect(note(page)).toContainText("Around the polygon");
  await openStudy(page, {
    ...study,
    config: {
      ...study.config,
      surface: {
        ...study.config.surface,
        geodesics: {
          ...study.config.surface.geodesics,
          transport: p.config.surface.geodesics!.transport,
        },
      },
    },
  });
  expect("vertices" in (await config(page)).surface.geodesics.transport).toBe(
    false,
  );
  await expect(note(page)).toContainText("Around the octant triangle");
});

test("a linked polygon short of three vertices is refused under its path, and adding vertices recovers it", async ({
  page,
}) => {
  const p = preset(triangle.label);
  // Refused as it opens, it has no drawing yet.
  await page.goto("about:blank");
  const study = {
    config: {
      ...p.config,
      surface: {
        ...p.config.surface,
        geodesics: {
          ...p.config.surface.geodesics!,
          transport: {
            ...p.config.surface.geodesics!.transport!,
            path: "polygon",
            vertices: [{ u: 0, v: 0 }],
          },
        },
      },
    },
    layers: { ...defaultLayers, ...p.layers },
    view: p.view,
  };
  await page.goto(
    `/?study=3d#s=${deflateRawSync(
      Buffer.from(JSON.stringify({ v: 1, notebook: "3d", study })),
    ).toString("base64url")}`,
  );
  await expect(page.getByRole("alert")).toContainText(
    "a polygon has 3–12 vertices",
  );
  await expect(button(page, "Remove vertex 1")).toBeDisabled();
  await button(page, "Add a vertex").click();
  await button(page, "Add a vertex").click();
  await settled(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect((await config(page)).surface.geodesics.transport.vertices).toEqual(
    polygonDefaults(),
  );
  await expect(note(page)).toContainText("comes home turned +90°");
});

test("an arrow is carried along threads on a cylinder, a paraboloid, an ellipsoid and the stair", async ({
  page,
}) => {
  await ready(page);
  for (const [label, kept] of [
    ["Helices rising round a cylinder", "stops with its thread"],
    ["A straight thread across a saddle", "stops with its thread"],
    ["One thread weaves a band round an ellipsoid", ""],
    ["A thread that keeps its way as a stair opens", "stops with its thread"],
  ] as const) {
    await choosePreset(page, { label });
    await settled(page);
    await expect(carry(page)).toBeVisible();
    await carry(page).check();
    await settled(page);
    const surface = (await config(page)).surface;
    expect(surface.geodesics.transport).toEqual(transportDefaults(surface));
    await expect(unavailable(page)).toHaveCount(0);
    await expect(note(page)).toContainText(
      "the arrow keeps its 90° angle to the thread, as along any geodesic.",
    );
    if (kept)
      await expect(note(page)).toContainText(
        "It stops with its thread where the path reaches the patch's edge.",
      );
    else await expect(note(page)).not.toContainText("edge");
    await expect(note(page)).toContainText(
      "Its length stays 1 and it stays tangent",
    );
    // The polygon is a sphere's.
    await path(page).selectOption("polygon");
    await settled(page);
    await expect(unavailable(page)).toHaveText(
      "A geodesic polygon is drawn on a sphere; on this surface the arrow can follow the selected thread.",
    );
    await path(page).selectOption("thread");
    await settled(page);
  }
  // Sizes follow each kind's own scale, not its curvature or angle fields:
  // the saddle z = (x² − y²)/2 over [−1.5, 1.5]² spans 3 in x and y and
  // 1.125 + 1.125 in z, so its scale is 1.5, and the family's is s.
  expect(
    transportDefaults({
      ...preset("A straight thread across a saddle").config.surface,
    }).size,
  ).toBe(0.45);
  expect(
    transportDefaults({
      ...preset("A thread that keeps its way as a stair opens").config.surface,
      a: 0.5,
      b: 1.4,
    }).size,
  ).toBe(0.15);
});

test("a thread that ends at its start is a near-return, not a closed path", async ({
  page,
}) => {
  const p = preset(triangle.label);
  await openStudy(page, {
    config: {
      ...p.config,
      surface: {
        ...p.config.surface,
        geodesics: {
          ...p.config.surface.geodesics!,
          transport: { path: "thread", angle: 40, size: 0.3, arrows: 4 },
        },
      },
    },
    layers: { ...defaultLayers, ...p.layers, threads: true, selected: true },
    view: p.view,
  });
  // The turn there is measured, and shown as small as it is.
  await expect(note(page)).toContainText(
    /^Thread 1 ends within 10⁻⁶ of its start, heading the same way, with the arrow turned [+−]?[\d.]+(e−\d+)?° there; along a geodesic it keeps its angle to the thread\./,
  );
  await expect(note(page)).not.toContainText("comes home");
});

test("the star preset carries its arrow round, marks each side's way and comes home turned by the area it winds", async ({
  page,
}) => {
  test.slow();
  await ready(page);
  await choosePreset(page, star);
  await settled(page);
  await expect(carry(page)).toBeChecked();
  await expect(path(page)).toHaveValue("polygon");
  await expect(field(page, "Vertex 2 u")).toHaveValue("4*pi/5");
  await expect(field(page, "Vertex 5 v")).toHaveValue("pi/4");
  // Gauss–Bonnet with the star's two turns: 4π less the turns at its
  // corners, each π less the tip angle, computed here from the vertices.
  const p = (k: number) => {
    const u = (4 * Math.PI * k) / 5,
      v = Math.PI / 4;
    return [Math.cos(v) * Math.cos(u), Math.cos(v) * Math.sin(u), Math.sin(v)];
  };
  const dot = (a: number[], b: number[]) =>
    a.reduce((s, x, i) => s + x * b[i], 0);
  const toward = (at: number[], to: number[]) => {
    const t = to.map((x, i) => x - dot(at, to) * at[i]);
    const n = Math.hypot(...t);
    return t.map((x) => x / n);
  };
  let area = 4 * Math.PI;
  for (let k = 0; k < 5; k++) {
    const tip = Math.acos(
      dot(toward(p(k), p((k + 4) % 5)), toward(p(k), p((k + 1) % 5))),
    );
    area -= Math.PI - tip;
  }
  const shown = await turnAndArea(page);
  expect(shown.area).toBeCloseTo(area, 4);
  expect(shown.turn).toBeCloseTo((area * 180) / Math.PI, 3);
  await expect(page.locator(".legend")).toContainText(
    "Surface Geodesic polygon Carried arrow Reference arrows",
  );
  const drawn = await pixels(page);
  for (const name of [
    "Geodesic polygon",
    "Carried arrow",
    "Reference arrows",
  ]) {
    await check(page, name).uncheck();
    expect(await pixels(page)).not.toBe(drawn);
    await check(page, name).check();
    expect(await pixels(page)).toBe(drawn);
  }
  // The linework has the route with its five marks, one arrow, fifteen
  // reference arrows, and no threads.
  const groups = await lines(page);
  expect(groups.route).toBeGreaterThan(1500);
  expect(groups.references).toBe(15 * groups.carried);
  expect(groups.threads ?? 0).toBe(0);
  // The reveal travels the star and holds where it came home; partway,
  // fewer sides are drawn and marked.
  await paused(page);
  await seek(page, "0.3");
  const partway = await lines(page);
  expect(partway.route).toBeLessThan(groups.route / 2);
  await seek(page, "0.9");
  expect(await lines(page)).toEqual(groups);
});

test("a polygon's marks stand mid-side along the path, in the tangent plane, once the reveal passes them", () => {
  // A square on the unit sphere's equator band, sampled as the engine
  // would: four sides of a quarter turn each, eight samples a side.
  const sides = 4,
    per = 8,
    q = Math.PI / 2;
  const points: Vec3[] = [],
    tangents: Vec3[] = [],
    normals: Vec3[] = [],
    arcs: number[] = [],
    corners: number[] = [];
  for (let i = 0; i < sides; i++)
    for (let k = i === 0 ? 0 : 1; k <= per; k++) {
      const s = i * q + (k * q) / per,
        a = s;
      points.push({ x: Math.cos(a), y: Math.sin(a), z: 0 });
      tangents.push({ x: -Math.sin(a), y: Math.cos(a), z: 0 });
      normals.push({ x: Math.cos(a), y: Math.sin(a), z: 0 });
      arcs.push(s);
      if (k === per && i < sides - 1) corners.push(arcs.length - 1);
    }
  const tr = {
    path: "polygon",
    length: sides * q,
    size: 0.4,
    samples: { arcs, points, tangents, normals, vectors: tangents },
    references: {
      arcs: [],
      points: [],
      tangents: [],
      normals: [],
      vectors: [],
    },
    corners,
    reason: "end",
    reached: sides * q,
    steps: 0,
    returns: true,
    holonomy: 0,
    area: 0,
    drift: { norm: 0, tangency: 0 },
  } as TransportResult;
  const marks = chevronLines(tr);
  expect(marks).toHaveLength(4 * sides);
  for (let i = 0; i < sides; i++) {
    const [back1, tip, tip2, back2] = marks.slice(4 * i, 4 * i + 4);
    expect(tip2).toEqual(tip);
    // Its point is the sample at the side's middle, ahead along the
    // tangent, the barbs behind and either side of it.
    const middle = (i + 0.5) * q;
    const at = { x: Math.cos(middle), y: Math.sin(middle) };
    const t = { x: -Math.sin(middle), y: Math.cos(middle) };
    const center = { x: (back1.x + back2.x) / 2, y: (back1.y + back2.y) / 2 };
    expect((tip.x - center.x) * t.x + (tip.y - center.y) * t.y).toBeCloseTo(
      0.2,
      12,
    );
    expect(center.x - at.x + 0.1 * t.x).toBeCloseTo(0, 12);
    expect(center.y - at.y + 0.1 * t.y).toBeCloseTo(0, 12);
    // The barbs lie in the tangent plane: they differ along ±N × T = ∓ẑ.
    expect(Math.abs(back1.z - back2.z)).toBeCloseTo(2 * 0.088, 12);
  }
  // A reveal through 1.2 sides marks only the first.
  expect(chevronLines({ ...tr, shown: 1.2 * q })).toHaveLength(4);
  expect(chevronLines({ ...tr, shown: 0.4 * q })).toHaveLength(0);
  // A thread or the triangle has none.
  expect(chevronLines({ ...tr, path: "triangle" })).toHaveLength(0);
});

test("the star's sweep plays its own vertex tracks: the turn grows past a half turn with the area", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, sweep);
  await settled(page);
  await openAnimation(page);
  for (let k = 1; k <= 5; k++)
    await expect(
      page.getByLabel(`Parameter ${k}`, { exact: true }),
    ).toHaveValue(`vertex${k}V`);
  await expect(
    page.getByLabel("Parameter 1", { exact: true }).locator("option:checked"),
  ).toHaveText("Vertex 1 v");
  // The note describes the study, at latitude π/3.
  const shown = await turnAndArea(page);
  expect(shown.turn).toBeCloseTo(25.6533, 3);
  expect(shown.area).toBeCloseTo(0.447735, 5);
  await paused(page);
  await seek(page, "0");
  const near = await pixels(page);
  const nearLines = await lines(page);
  // Back and forth reaches the far end, latitude π/9, halfway: the star
  // has spread and its arrow has turned, with every side still drawn.
  await seek(page, "0.5");
  expect(await pixels(page)).not.toBe(near);
  const far = await lines(page);
  expect(far.carried).toBe(nearLines.carried);
  expect(far.references).toBe(nearLines.references);
  await expect(page.locator(".animation-error")).toHaveCount(0);
  expect(await turnAndArea(page)).toEqual(shown);
  await button(page, "Stop").click();
  await settled(page);
  // The study itself is unchanged.
  expect((await config(page)).surface.geodesics.transport.vertices[0].v).toBe(
    Math.PI / 3,
  );
});

test("the stair arrow keeps its right angle while the stair bends into a throat", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, stair);
  await settled(page);
  await expect(carry(page)).toBeChecked();
  await expect(note(page)).toContainText(
    "Along thread 1 the arrow keeps its 90° angle to the thread, as along any geodesic.",
  );
  await expect(note(page)).not.toContainText("edge");
  const helicoid = await pixels(page);
  await paused(page);
  await seek(page, "0.5");
  await expect(note(page)).toContainText("keeps its 90° angle");
  await expect(unavailable(page)).toHaveCount(0);
  expect(await pixels(page)).not.toBe(helicoid);
  const groups = await lines(page);
  expect(groups.references).toBe(12 * groups.carried);
  expect(groups.selected).toBeGreaterThan(1000);
});

test("a vertex track is offered with a polygon, opens from a link, and is refused for a vertex the polygon lacks", async ({
  page,
}) => {
  const p = preset(sweep.label);
  const study = (target: string) => ({
    config: p.config,
    layers: { ...defaultLayers, ...p.layers },
    view: p.view,
    animation: {
      mode: "parameters",
      camera: "current",
      duration: 2,
      repeat: "once",
      tracks: [{ target, from: "0.2", to: "0.9" }],
    },
  });
  await openStudy(page, study("vertex3U"));
  await openAnimation(page);
  await expect(page.getByLabel("Parameter 1", { exact: true })).toHaveValue(
    "vertex3U",
  );
  // A sixth vertex is not there to move: the link opens with an error.
  await page.goto("about:blank");
  await page.goto(
    `/?study=3d#s=${deflateRawSync(
      Buffer.from(
        JSON.stringify({ v: 1, notebook: "3d", study: study("vertex6U") }),
      ),
    ).toString("base64url")}`,
  );
  await expect(page.getByRole("alert")).toContainText(
    "animation.tracks[0].target is not available in this study.",
  );
});

test("a polygon's note gives the turn as the area over r², less or plus a whole turn past a half turn", () => {
  // A unit sphere's polygon result, with only what the note reads.
  const result = (holonomy: number, area: number) =>
    ({
      surface: "sphere",
      selected: 1,
      threads: [],
      length: 1,
      step: 1,
      steps: 0,
      transport: {
        path: "polygon",
        length: 4,
        size: 0.3,
        samples: {
          arcs: [0],
          points: [{ x: 1, y: 0, z: 0 }],
          vectors: [],
          normals: [],
          tangents: [],
        },
        references: {
          arcs: [],
          points: [],
          vectors: [],
          normals: [],
          tangents: [],
        },
        corners: [],
        reason: "end",
        reached: 4,
        steps: 0,
        returns: true,
        holonomy,
        area,
        drift: { norm: 0, tangency: 0 },
      },
    }) as GeodesicResult;
  const config = { path: "polygon", angle: 0, size: 0.3, arrows: 0 } as const;
  const text = (h: number, a: number) =>
    transportNote(result(h, a), config, "default")[0];
  expect(text(1, 1)).toBe(
    "Around the polygon the arrow comes home turned +57.2958° about the outward normal: the signed area it encloses, +1, times the curvature 1/r².",
  );
  expect(text(4 - 2 * Math.PI, 4)).toContain(
    "the signed area it encloses, +4, times the curvature 1/r², less a whole turn.",
  );
  expect(text(2 * Math.PI - 4, -4)).toContain(
    "the signed area it encloses, −4, times the curvature 1/r², plus a whole turn.",
  );
  expect(text(-1, -1)).toContain("turned −57.2958°");
});

// A still PNG's pixels, as RGBA.
async function still(page: Page) {
  await button(page, "Export image").click();
  const event = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /^PNG image/ }).click();
  const png = await readFile((await (await event).path())!);
  const rgba = await page.evaluate(async (input) => {
    const image = new Image();
    image.src = `data:image/png;base64,${input}`;
    await image.decode();
    const c = document.createElement("canvas");
    c.width = image.width;
    c.height = image.height;
    const g = c.getContext("2d")!;
    g.drawImage(image, 0, 0);
    const data = g.getImageData(0, 0, c.width, c.height).data;
    let text = "";
    for (let i = 0; i < data.length; i += 0x8000)
      text += String.fromCharCode(...data.subarray(i, i + 0x8000));
    return btoa(text);
  }, png.toString("base64"));
  return Buffer.from(rgba, "base64");
}

// The movie of the star's reveal decodes with its duration; its frames
// partway round, at the arrival and in the hold are the stills a direct
// seek draws there.
test("the star's movie agrees with stills at direct seeks", async ({
  page,
}) => {
  test.slow();
  await ready(page);
  await choosePreset(page, star);
  await settled(page);
  await paused(page);
  const stills: Record<string, Buffer> = {};
  for (const p of ["1", "0", "0.2", "0.6"]) {
    await seek(page, p);
    stills[p] = await still(page);
  }
  await button(page, "Stop").click();
  await settled(page);
  await page.getByLabel("Duration (seconds)").fill("0.4");
  await openDetails(page, "#spatial-export-settings");
  await page.getByLabel("Export format", { exact: true }).selectOption("mp4");
  await page.getByLabel("Export frame rate").selectOption("15");
  await page
    .getByRole("slider", { name: "Export resolution", exact: true })
    .fill("2");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export MP4/ }).click();
  const path = (await (await download).path())!;
  const data = probe(path);
  if (data) {
    expect(data.frames).toBe(6);
    expect([data.width, data.height]).toEqual([2000, 1520]);
  }
  const video = await decodeVideo(page, await readFile(path));
  expect(video.duration).toBeCloseTo(0.4, 3);
  expect(video.first.hash).not.toBe(video.last.hash);
  const match = (index: number, reference: Buffer) =>
    frameDifference(path, 2000, 1520, index, reference);
  // Frames at progress 0, 0.2, 0.6, 0.8 (the arrival) and 1 (the hold),
  // each nearer its own still than any other, as for the triangle.
  const frames: [number, string][] = [
    [0, "0"],
    [1, "0.2"],
    [3, "0.6"],
    [4, "1"],
    [5, "1"],
  ];
  const keys = Object.keys(stills);
  const table = frames.map(([index, own]) => ({
    own,
    to: Object.fromEntries(keys.map((k) => [k, match(index, stills[k])])),
  }));
  if (table.every((row) => keys.every((k) => row.to[k]))) {
    console.log("Polygon reveal frames", JSON.stringify(table));
    for (const { own, to } of table) {
      expect(to[own]!.meanDifference).toBeLessThan(4);
      expect(to[own]!.unmatchedInk).toBeLessThan(0.02);
      for (const k of keys)
        if (k !== own)
          expect(to[own]!.meanDifference, `${own} against ${k}`).toBeLessThan(
            to[k]!.meanDifference,
          );
    }
  }
});

// Removing a vertex renumbers the fields after it, so an entry still being
// evaluated lands on the vertex it was typed into first.
test("a vertex removed while an entry is pending keeps that entry on its own vertex", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const send = Worker.prototype.postMessage;
    (window as any).pendingScalars = 0;
    Worker.prototype.postMessage = function (q: any, ...rest: any[]) {
      if (q.action !== "scalars") return send.call(this, q, ...rest);
      (window as any).pendingScalars++;
      const finished = ({ data }: MessageEvent) => {
        if (data.id !== q.id) return;
        (window as any).pendingScalars--;
        this.removeEventListener("message", finished);
      };
      this.addEventListener("message", finished);
      setTimeout(() => send.call(this, q, ...rest), 250);
    };
  });
  await ready(page);
  await choosePreset(page, star);
  await settled(page);
  const before = (await config(page)).surface.geodesics.transport.vertices;
  await field(page, "Vertex 4 u").fill("pi/7");
  await expect
    .poll(() => page.evaluate(() => (window as any).pendingScalars))
    .toBeGreaterThan(0);
  await button(page, "Remove vertex 2").click();
  await expect
    .poll(() => page.evaluate(() => (window as any).pendingScalars))
    .toBe(0);
  await settled(page);
  expect((await config(page)).surface.geodesics.transport.vertices).toEqual([
    before[0],
    before[2],
    { ...before[3], u: Math.PI / 7 },
    before[4],
  ]);
  await expect(field(page, "Vertex 3 u")).toHaveValue("pi/7");
});

// A side's middle that falls between samples puts its mark there, on the
// chord between them, so a mark glides as a changing polygon's sides
// lengthen rather than jumping from sample to sample.
test("a polygon's mark stands at its side's middle between samples", () => {
  const sides = 3,
    per = 7,
    q = Math.PI / 2;
  const points: Vec3[] = [],
    tangents: Vec3[] = [],
    normals: Vec3[] = [],
    arcs: number[] = [],
    corners: number[] = [];
  for (let i = 0; i < sides; i++)
    for (let k = i === 0 ? 0 : 1; k <= per; k++) {
      const a = i * q + (k * q) / per;
      points.push({ x: Math.cos(a), y: Math.sin(a), z: 0 });
      tangents.push({ x: -Math.sin(a), y: Math.cos(a), z: 0 });
      normals.push({ x: Math.cos(a), y: Math.sin(a), z: 0 });
      arcs.push(a);
      if (k === per && i < sides - 1) corners.push(arcs.length - 1);
    }
  const tr = {
    path: "polygon",
    length: sides * q,
    size: 0.4,
    samples: { arcs, points, tangents, normals, vectors: tangents },
    references: {
      arcs: [],
      points: [],
      tangents: [],
      normals: [],
      vectors: [],
    },
    corners,
    reason: "end",
    reached: sides * q,
    steps: 0,
    returns: true,
    holonomy: 0,
    area: 0,
    drift: { norm: 0, tangency: 0 },
  } as TransportResult;
  const marks = chevronLines(tr);
  expect(marks).toHaveLength(4 * sides);
  for (let i = 0; i < sides; i++) {
    const [back1, tip, , back2] = marks.slice(4 * i, 4 * i + 4);
    // The middle lies halfway between samples 3 and 4 of the side: on
    // their chord, heading along their mean tangent.
    const a = i * q + (3 * q) / per,
      b = i * q + (4 * q) / per,
      m = (a + b) / 2;
    const at = {
      x: (Math.cos(a) + Math.cos(b)) / 2,
      y: (Math.sin(a) + Math.sin(b)) / 2,
    };
    const t = { x: -Math.sin(m), y: Math.cos(m) };
    const center = { x: (back1.x + back2.x) / 2, y: (back1.y + back2.y) / 2 };
    expect(center.x - at.x + 0.1 * t.x).toBeCloseTo(0, 12);
    expect(center.y - at.y + 0.1 * t.y).toBeCloseTo(0, 12);
    expect((tip.x - center.x) * t.x + (tip.y - center.y) * t.y).toBeCloseTo(
      0.2,
      12,
    );
  }
});

test("a short polygon side's mark follows its own direction after a sharp corner", async ({
  page,
}) => {
  await observeSpatial(page);
  const p = preset(star.label);
  for (const samples of [8, 1200]) {
    await openStudy(page, {
      config: {
        ...p.config,
        surface: {
          ...p.config.surface,
          geodesics: {
            ...p.config.surface.geodesics!,
            samples,
            transport: {
              ...p.config.surface.geodesics!.transport!,
              vertices: [
                { u: 0, v: 0 },
                { u: 1, v: 0 },
                { u: 0.9999, v: 0.00001 },
                { u: -0.6, v: 0.5 },
              ],
            },
          },
        },
      },
      layers: { ...defaultLayers, ...p.layers },
      view: p.view,
    });
    const reply = await page.evaluate(() => {
      const r = (window as any).spatialWorkers
        .flatMap((w: any) => w.replies)
        .at(-1);
      return {
        result: r.result,
        lifted: {
          places: r.lifted.places,
          floats: Array.from(r.lifted.floats),
        },
      };
    });
    const result = restore(reply.result, {
      ...reply.lifted,
      floats: new Float64Array(reply.lifted.floats),
    }) as any;
    const tr = result.surface.geodesics.transport as TransportResult;
    const [start, end] = tr.corners;
    // No uniform sample lies on this side: both midpoint neighbors are
    // corners, and the first corner's stored tangent belongs to side 1.
    expect(end).toBe(start + 1);
    const a = tr.samples.points[start],
      b = tr.samples.points[end];
    const size = Math.hypot(a.x + b.x, a.y + b.y, a.z + b.z);
    const n = {
      x: (a.x + b.x) / size,
      y: (a.y + b.y) / size,
      z: (a.z + b.z) / size,
    };
    const w = {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x,
    };
    const axisSize = Math.hypot(w.x, w.y, w.z);
    const tangent = {
      x: (w.y * n.z - w.z * n.y) / axisSize,
      y: (w.z * n.x - w.x * n.z) / axisSize,
      z: (w.x * n.y - w.y * n.x) / axisSize,
    };
    const [back1, tip, , back2] = chevronLines(tr).slice(4, 8);
    const heading = {
      x: tip.x - (back1.x + back2.x) / 2,
      y: tip.y - (back1.y + back2.y) / 2,
      z: tip.z - (back1.z + back2.z) / 2,
    };
    const length = Math.hypot(heading.x, heading.y, heading.z);
    expect(
      (heading.x * tangent.x + heading.y * tangent.y + heading.z * tangent.z) /
        length,
    ).toBeCloseTo(1, 10);
    expect(
      (heading.x * n.x + heading.y * n.y + heading.z * n.z) / length,
    ).toBeCloseTo(0, 10);
  }
});

test("a tall edited paraboloid starts with an admitted arrow length", async ({
  page,
}) => {
  const p = preset("A straight thread across a saddle");
  await openStudy(page, {
    config: {
      ...p.config,
      surface: {
        ...p.config.surface,
        a: 100000,
        b: -100000,
        uMin: -5,
        uMax: 5,
        vMin: -5,
        vMax: 5,
        uSamples: 12,
        vSamples: 12,
        geodesics: { ...p.config.surface.geodesics!, length: 1, samples: 8 },
      },
    },
    layers: { ...defaultLayers, ...p.layers },
    view: p.view,
  });
  await expect(page.getByRole("alert")).toHaveCount(0);
  await carry(page).check();
  await settled(page);
  await expect(field(page, "Arrow length")).toBeVisible();
  const size = Number(await field(page, "Arrow length").inputValue());
  expect(size).toBeGreaterThan(0);
  expect(size).toBeLessThanOrEqual(100000);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(note(page)).toContainText("the arrow keeps its 90° angle");
});
