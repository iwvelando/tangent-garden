import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { choosePreset } from "./helpers";
import { decodeVideo, probe } from "./video";
import { exportTiming } from "../web/export-quality";
import { trace, traceTimeline } from "../web/spatial/raytrace";
import { spatialPresets } from "../web/spatial/presets";
import type {
  Bounds3,
  CausticSheet,
  RaysConfig,
  RaysResult,
  SpatialConfig,
  SpatialResult,
  SurfaceSheet,
  Vec3,
} from "../web/spatial/types";

const add = (a: Vec3, b: Vec3, s = 1) => ({
  x: a.x + b.x * s,
  y: a.y + b.y * s,
  z: a.z + b.z * s,
});
const sub = (a: Vec3, b: Vec3) => add(a, b, -1);
const size = (v: Vec3) => Math.hypot(v.x, v.y, v.z);
const unit = (v: Vec3) => add({ x: 0, y: 0, z: 0 }, v, 1 / size(v));
const near = (a: Vec3 | null | undefined, b: Vec3, digits = 9) => {
  expect(a).toBeTruthy();
  for (const k of ["x", "y", "z"] as const)
    expect(a![k]).toBeCloseTo(b[k], digits);
};
// A sheet sampled on an n × n grid, joined everywhere it has points.
function sheet(n: number, at: (i: number, j: number) => Vec3 | null) {
  const grid = <T>(
    rows: number,
    cols: number,
    f: (i: number, j: number) => T,
  ) =>
    Array.from({ length: rows }, (_, i) =>
      Array.from({ length: cols }, (_, j) => f(i, j)),
    );
  const points = grid(n, n, at);
  const has = (i: number, j: number) => !!points[i][j];
  return {
    points,
    normals: grid(n, n, (i, j) => (has(i, j) ? { x: 0, y: 0, z: 1 } : null)),
    alongU: grid(n - 1, n, (i, j) => has(i, j) && has(i + 1, j)),
    alongV: grid(n, n - 1, (i, j) => has(i, j) && has(i, j + 1)),
    faces: grid(
      n - 1,
      n - 1,
      (i, j) =>
        has(i, j) && has(i + 1, j) && has(i, j + 1) && has(i + 1, j + 1),
    ),
  } satisfies SurfaceSheet;
}
const part = (
  s: SurfaceSheet,
  branch: 1 | 2,
  virtual: boolean,
): CausticSheet => ({ ...s, branch, virtual, shape: "surface" });
function mirror(
  surface: SurfaceSheet,
  caustics: CausticSheet[],
  lines: RaysResult["lines"],
  bounds: Bounds3,
  receiver: RaysResult["receiver"] = null,
): SpatialResult {
  return {
    base: [],
    minus: [],
    plus: [],
    mesh: [],
    rulings: [],
    breaks: [],
    bounds,
    radius: bounds.radius,
    invalid: 0,
    omitted: 0,
    rays: {
      surface,
      caustics,
      lines,
      uCurves: [],
      vCurves: [],
      source: null,
      singular: 0,
      unlit: 0,
      atSource: 0,
      stigmatic: 0,
      total: 0,
      clipped: [0, 0],
      receiver,
    },
  };
}
function lit(rays: Partial<RaysConfig>): SpatialConfig {
  const config = structuredClone(spatialPresets[0].config);
  return {
    ...config,
    format: "rays",
    rays: {
      ...config.rays,
      interaction: "reflect",
      light: "parallel",
      azimuth: 0,
      elevation: -90,
      n1: 1,
      n2: 1,
      ...rays,
    },
  };
}
const n = 9;
const grid = (i: number) => -2 + (4 * i) / (n - 1);
// z = (x² + y²)/4, whose focus is (0, 0, 1).
const dish = sheet(n, (i, j) => ({
  x: grid(i),
  y: grid(j),
  z: (grid(i) ** 2 + grid(j) ** 2) / 4,
}));
const focus = { x: 0, y: 0, z: 1 };
const none = sheet(n, () => null);
// Representative rays toward a point, each drawn `reach` along.
const rays = (surface: SurfaceSheet, to: Vec3, reach: number) =>
  [0, 4, 8].flatMap((i) =>
    [0, 4, 8].map((j) => {
      const point = surface.points[i][j]!;
      return {
        i,
        j,
        start: add(point, { x: 0, y: 0, z: 1 }, 5),
        point,
        end: add(point, unit(sub(to, point)), reach),
        back: add(point, unit(sub(to, point)), -reach),
        virtual: false,
        total: false,
      };
    }),
  );

test("axial light reaches a paraboloid's focus along equal optical paths", () => {
  const caustics = [
    part(
      sheet(n, () => focus),
      1,
      false,
    ),
    part(none, 1, true),
    part(
      sheet(n, () => focus),
      2,
      false,
    ),
    part(none, 2, true),
  ];
  const bounds = { center: focus, radius: 3 };
  const result = mirror(dish, caustics, rays(dish, focus, 2), bounds);
  const timeline = traceTimeline(result, lit({}), bounds);
  // The wavefront starts tangent to the framing sphere, at z = 4: each path
  // is 4 − z down to the mirror and z + 1 on to the focus.
  for (const sheetArrival of [timeline.arrival[0], timeline.arrival[2]])
    for (const row of sheetArrival)
      for (const t of row) expect(t).toBeCloseTo(5, 12);
  const before = trace(result, timeline, (5 - 1e-6) / timeline.total).rays!;
  const after = trace(result, timeline, (5 + 1e-6) / timeline.total).rays!;
  expect(before.caustics[0].points.flat().every((p) => p === null)).toBe(true);
  expect(before.caustics[0].faces.flat().some((f) => f)).toBe(false);
  expect(after.caustics[0]).toEqual(caustics[0]);
  expect(after.caustics[2]).toEqual(caustics[2]);
  // Light streams in from past the framing sphere.
  const first = trace(result, timeline, 0).rays!;
  for (const line of first.lines) {
    near(line.point, { ...line.point, z: 4 });
    expect(line.start.z).toBeGreaterThanOrEqual(4 + 2 * 3);
    near(line.end, line.point);
  }
});

test("a point source at a sphere's centre returns there at twice the radius", () => {
  const sphere = sheet(n, (i, j) => {
    const u = (Math.PI * (i + 1)) / (n + 1),
      v = (2 * Math.PI * j) / n;
    return {
      x: 2 * Math.sin(u) * Math.cos(v),
      y: 2 * Math.sin(u) * Math.sin(v),
      z: 2 * Math.cos(u),
    };
  });
  const centre = { x: 0, y: 0, z: 0 };
  const caustics = [
    part(
      sheet(n, () => centre),
      1,
      false,
    ),
    part(none, 1, true),
    part(none, 2, false),
    part(none, 2, true),
  ];
  const bounds = { center: centre, radius: 2 };
  const result = mirror(sphere, caustics, rays(sphere, centre, 3), bounds);
  result.rays!.source = centre;
  const timeline = traceTimeline(
    result,
    lit({ light: "point", source: centre }),
    bounds,
  );
  for (const row of timeline.hit)
    for (const t of row) expect(t).toBeCloseTo(2, 12);
  for (const row of timeline.arrival[0])
    for (const t of row) expect(t).toBeCloseTo(4, 12);
  const halfway = trace(result, timeline, 1 / timeline.total).rays!;
  for (const line of halfway.lines) {
    near(line.start, centre);
    const hit = result.rays!.lines.find(
      (l) => l.i === line.i && l.j === line.j,
    )!;
    near(line.point, add(centre, hit.point, 0.5));
  }
});

test("refracted light slows by n₁/n₂, and totally reflected light does not", () => {
  const flat = sheet(2, (i, j) => ({ x: i, y: j, z: 0 }));
  const bounds = { center: { x: 0, y: 0, z: 0 }, radius: 3 };
  const through = mirror(
    flat,
    [
      part(none, 1, false),
      part(none, 1, true),
      part(none, 2, false),
      part(none, 2, true),
    ].map((c) => ({ ...c, ...sheet(2, () => null) })),
    [
      {
        i: 0,
        j: 0,
        start: { x: 0, y: 0, z: 5 },
        point: { x: 0, y: 0, z: 0 },
        end: { x: 0, y: 0, z: -2 },
        back: { x: 0, y: 0, z: 0 },
        virtual: false,
        total: false,
      },
    ],
    bounds,
  );
  const glass = lit({ interaction: "refract", n1: 1, n2: 1.5 });
  const timeline = traceTimeline(through, glass, bounds);
  expect(timeline.hit[0][0]).toBeCloseTo(3, 12);
  const moved = trace(through, timeline, (3 + 0.75) / timeline.total).rays!;
  near(moved.lines[0].end, { x: 0, y: 0, z: -0.5 });
  // Beyond the critical angle the reflected ray stays in the first medium.
  through.rays!.lines[0] = {
    ...through.rays!.lines[0],
    end: { x: 2, y: 0, z: 0 },
    total: true,
  };
  const inside = traceTimeline(
    through,
    lit({ interaction: "refract", n1: 1.5, n2: 1 }),
    bounds,
  );
  const later = trace(
    through,
    inside,
    (inside.hit[0][0] + 0.75) / inside.total,
  ).rays!;
  near(later.lines[0].end, { x: 0.5, y: 0, z: 0 });
});

test("tracing starts bare, masks unreached caustic cells, and ends at the study", () => {
  // Each caustic point one unit above its mirror point: reached later for
  // lower mirror points, so the caustic grows from the rim inward.
  const lifted = sheet(n, (i, j) =>
    add(dish.points[i][j]!, { x: 0, y: 0, z: 1 }),
  );
  const behind = sheet(n, (i, j) =>
    add(dish.points[i][j]!, { x: 0, y: 0, z: -2 }),
  );
  const caustics = [
    part(lifted, 1, false),
    part(behind, 1, true),
    part(none, 2, false),
    part(none, 2, true),
  ];
  const bounds = { center: focus, radius: 3 };
  const receiver = {
    plane: "z",
  } as unknown as NonNullable<RaysResult["receiver"]>;
  const result = mirror(dish, caustics, rays(dish, focus, 2), bounds, receiver);
  const timeline = traceTimeline(result, lit({}), bounds);
  const start = trace(result, timeline, 0).rays!;
  expect(start.surface).toEqual(dish);
  expect(start.receiver).toBeNull();
  for (const c of start.caustics)
    expect(c.points.flat().every((p) => p === null)).toBe(true);
  for (const line of start.lines) near(line.back, line.point);
  let reached = 0;
  let partial = false;
  for (let k = 1; k < 100; k++) {
    const view = trace(result, timeline, k / 100).rays!;
    expect(view.receiver).toBeNull();
    for (const c of view.caustics) {
      // No edge or face is drawn to a point that is not yet reached.
      c.faces.forEach((row, i) =>
        row.forEach((f, j) => {
          if (f)
            for (const [a, b] of [
              [i, j],
              [i + 1, j],
              [i, j + 1],
              [i + 1, j + 1],
            ])
              expect(c.points[a][b]).not.toBeNull();
        }),
      );
      c.alongU.forEach((row, i) =>
        row.forEach((e, j) => {
          if (e) {
            expect(c.points[i][j]).not.toBeNull();
            expect(c.points[i + 1][j]).not.toBeNull();
          }
        }),
      );
      c.alongV.forEach((row, i) =>
        row.forEach((e, j) => {
          if (e) {
            expect(c.points[i][j]).not.toBeNull();
            expect(c.points[i][j + 1]).not.toBeNull();
          }
        }),
      );
    }
    const now = view.caustics[0].points.flat().filter((p) => p).length;
    expect(now).toBeGreaterThanOrEqual(reached);
    if (now > 0 && now < n * n) partial = true;
    reached = now;
  }
  expect(partial).toBe(true);
  // A virtual point is reached along the extension behind the mirror.
  expect(timeline.arrival[1][4][4]).toBeCloseTo(timeline.hit[4][4] + 2, 12);
  const end = trace(result, timeline, 1).rays!;
  expect(end.caustics).toEqual(caustics);
  expect(end.receiver).toBe(receiver);
  end.lines.forEach((line, k) => {
    near(line.end, result.rays!.lines[k].end);
    near(line.back, result.rays!.lines[k].back);
    near(line.point, result.rays!.lines[k].point);
  });
});

const stage = (page: Page) => page.locator(".spatial-stage");
const pixels = (page: Page) =>
  page
    .locator("#spatial-artwork")
    .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
const animate = (page: Page) =>
  page.getByRole("combobox", { name: "Animate", exact: true });
async function ready(page: Page, label: string) {
  await page.goto("/?study=3d");
  await expect(page.locator("#spatial-artwork")).toBeVisible();
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
  await choosePreset(page, { label });
  await expect(stage(page)).toHaveAttribute("aria-busy", "false");
}

test("3D tracing is offered only for mirrors and interfaces, with fixed cameras", async ({
  page,
}) => {
  await ready(page, spatialPresets[0].name);
  await expect(animate(page).locator("option[value=trace]")).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Animation camera" })
    .selectOption("follow");
  await choosePreset(page, { label: "A paraboloid gathering light" });
  await expect(stage(page)).toHaveAttribute("aria-busy", "false");
  await animate(page).selectOption("trace");
  const camera = page.getByRole("combobox", { name: "Animation camera" });
  await expect(camera).toHaveValue("hold");
  await expect(camera.locator("option")).toHaveText([
    "Hold final view",
    "Hold current view",
  ]);
  await choosePreset(page, { label: spatialPresets[0].name });
  await expect(animate(page)).toHaveValue("reveal");
});

for (const [label, camera] of [
  ["A paraboloid gathering light", "hold"],
  ["A glass ellipsoid focusing a beam", "current"],
  ["A lamp in water over air", "hold"],
] as const)
  test(`${label} traces from its light to the caustics (${camera} view)`, async ({
    page,
  }) => {
    await ready(page, label);
    const study = await stage(page).getAttribute("data-config");
    const original = await pixels(page);
    await animate(page).selectOption("trace");
    await page
      .getByRole("combobox", { name: "Animation camera" })
      .selectOption(camera);
    await page.getByLabel("Duration (seconds)").fill("3");
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await expect(stage(page)).toHaveAttribute("data-mode", "trace");
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const seek = async (p: string) => {
      await page.getByRole("slider", { name: "Animation progress" }).fill(p);
      await expect(stage(page)).toHaveAttribute("data-progress", p);
    };
    const reached = async () =>
      Number(
        (await page.locator(".animation-values").textContent())!
          .match(/([\d,]+) caustic points reached/)![1]
          .replace(/,/g, ""),
      );
    await seek("0");
    expect(await reached()).toBe(0);
    const bare = await pixels(page);
    let count = 0;
    for (const p of ["0.4", "0.8", "1"]) {
      await seek(p);
      const now = await reached();
      expect(now).toBeGreaterThanOrEqual(count);
      count = now;
    }
    expect(count).toBeGreaterThan(0);
    expect(await pixels(page)).not.toBe(bare);
    // The traced study itself is never changed.
    expect(await stage(page).getAttribute("data-config")).toBe(study);
    await page
      .getByRole("button", { name: "Back to study", exact: true })
      .click();
    await expect(stage(page)).not.toHaveAttribute("data-progress");
    await expect.poll(() => pixels(page)).toBe(original);
  });

test("a traced 3D MP4 decodes with exact timing and changing endpoints", async ({
  page,
}) => {
  await ready(page, "A paraboloid gathering light");
  await animate(page).selectOption("trace");
  await page.locator("#spatial-export-settings > summary").click();
  await page.getByLabel("Duration (seconds)").fill(".4");
  await page
    .getByRole("combobox", { name: "Export frame rate" })
    .selectOption("15");
  const exportMP4 = page.getByRole("button", { name: "Export MP4 video" });
  await expect(exportMP4).toBeEnabled();
  const download = page.waitForEvent("download");
  await exportMP4.click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe("tangent-garden-spatial-trace.mp4");
  const path = (await saved.path())!;
  const probed = probe(path);
  if (probed) {
    expect(probed.frames).toBe(6);
    expect(probed.durations).toEqual(
      exportTiming(0.4, 15).map((f) => f.duration),
    );
  }
  const decoded = await decodeVideo(page, await readFile(path));
  expect(decoded.duration).toBeCloseTo(0.4, 3);
  expect(decoded.first.hash).not.toBe(decoded.last.hash);
});
