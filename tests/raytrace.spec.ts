import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  choosePreset,
  exportImage,
  openAnimation,
  openExportSettings,
} from "./helpers";
import { decodeVideo, probe } from "./video";
import { exportTiming } from "../web/export-quality";
import { reach, trace, traceTimeline, type Rect } from "../web/raytrace";
import { presets } from "../web/presets";
import type { Config, Ray, Result, Vec } from "../web/types";

const unit = (v: Vec) => {
  const n = Math.hypot(v.x, v.y);
  return { x: v.x / n, y: v.y / n };
};
const sub = (a: Vec, b: Vec) => ({ x: a.x - b.x, y: a.y - b.y });
const near = (a: Vec | null | undefined, b: Vec, digits = 9) => {
  expect(a).toBeTruthy();
  expect(a!.x).toBeCloseTo(b.x, digits);
  expect(a!.y).toBeCloseTo(b.y, digits);
};
function study(
  base: Vec[],
  derived: (Vec | null)[],
  rays: Ray[],
  virtual = derived.map(() => false),
): Result {
  return {
    base,
    derived,
    virtual,
    rays,
    family: [],
    circles: [],
    rolling: [],
    warnings: [],
    invalid: 0,
  };
}
function optics(
  kind: "catacaustic" | "diacaustic",
  source: Config["source"],
  n: [number, number] = [1, 1],
): Config {
  return {
    ...structuredClone(presets[0].config),
    kind,
    source,
    nIncident: n[0],
    nTransmitted: n[1],
  };
}
const rect: Rect = { x0: -3, x1: 3, y0: -1, y1: 3 };
const down = (angle = -90) =>
  ({
    kind: "parallel",
    position: { x: 0, y: 0 },
    angle,
  }) as Config["source"];
const point = (position: Vec) =>
  ({ kind: "point", position, angle: 0 }) as Config["source"];
// Rays leaving each representative sample toward its caustic point.
const toward = (base: Vec[], derived: (Vec | null)[], incident: Vec[]) =>
  base.map((p, j): Ray => ({
    sampleIndex: j,
    origin: p,
    direction: unit(sub(derived[j]!, p)),
    incident: incident[j],
    target: derived[j],
    virtual: false,
    tir: false,
  }));

test("parallel light reaches a parabola's focus along equal optical paths", () => {
  // y = x²/4 has its focus at (0, 1); light falls straight down.
  const base = Array.from({ length: 41 }, (_, j) => {
    const x = -2 + j / 10;
    return { x, y: (x * x) / 4 };
  });
  const derived = base.map(() => ({ x: 0, y: 1 }));
  const incident = base.map(() => ({ x: 0, y: -1 }));
  const result = study(base, derived, toward(base, derived, incident));
  const timeline = traceTimeline(
    result,
    optics("catacaustic", down()),
    rect,
    2,
  );
  // The wavefront starts at the top of the view, y = 3, and every path to
  // the focus is 3 − y down to the mirror and y + 1 on to the focus.
  for (const arrival of timeline.arrival) expect(arrival).toBeCloseTo(4, 12);
  const before = trace(result, timeline, (4 - 1e-6) / timeline.total);
  const after = trace(result, timeline, (4 + 1e-6) / timeline.total);
  expect(before.derived.every((p) => p === null)).toBe(true);
  expect(after.derived).toEqual(derived);
  // A plane wave arrives from beyond the view: its front starts at the top
  // edge, with the light streaming behind it from past the wider panel.
  const first = trace(result, timeline, 0);
  for (const ray of first.rays) {
    near(ray.traced!.to, { x: ray.origin.x, y: 3 });
    expect(ray.traced!.from.x).toBeCloseTo(ray.origin.x, 12);
    expect(ray.traced!.from.y).toBeGreaterThanOrEqual(3 + 2 * 6);
  }
  for (const ray of after.rays) near(ray.traced!.to, ray.origin);
});

test("a point source at a circle's center returns there at twice the radius", () => {
  const base = Array.from({ length: 24 }, (_, j) => {
    const t = (2 * Math.PI * j) / 24;
    return { x: 2 * Math.cos(t), y: 2 * Math.sin(t) };
  });
  const derived = base.map(() => ({ x: 0, y: 0 }));
  const incident = base.map((p) => unit(p));
  const result = study(base, derived, toward(base, derived, incident));
  const timeline = traceTimeline(
    result,
    optics("catacaustic", point({ x: 0, y: 0 })),
    rect,
    3,
  );
  for (const j of base.keys()) {
    expect(timeline.hit[j]).toBeCloseTo(2, 12);
    expect(timeline.arrival[j]).toBeCloseTo(4, 12);
  }
  // Halfway to the mirror, each incident ray reaches half the radius.
  const view = trace(result, timeline, 1 / timeline.total);
  for (const ray of view.rays) {
    near(ray.traced!.from, { x: 0, y: 0 });
    near(ray.traced!.to, { x: ray.origin.x / 2, y: ray.origin.y / 2 });
    expect(ray.traced!.out).toBeNull();
  }
});

test("refracted light slows by n₁/n₂, and totally reflected light does not", () => {
  const origin = { x: 0, y: 0 };
  const rays: Ray[] = [
    {
      sampleIndex: 0,
      origin,
      direction: { x: 0, y: -1 },
      incident: { x: 0, y: -1 },
      target: null,
      virtual: false,
      tir: false,
    },
  ];
  const result = study([origin], [null], rays);
  const timeline = traceTimeline(
    result,
    optics("diacaustic", down(), [1, 1.5]),
    rect,
    10,
  );
  // The wavefront starts 3 above the interface, in the first medium.
  expect(timeline.hit[0]).toBeCloseTo(3, 12);
  const moved = trace(result, timeline, (3 + 0.75) / timeline.total);
  near(moved.rays[0].traced!.out, { x: 0, y: -0.5 });
  // Beyond the critical angle the reflected ray stays in the first medium.
  const reflected: Ray = {
    ...rays[0],
    direction: unit({ x: 1, y: 0.2 }),
    incident: unit({ x: 1, y: -0.2 }),
    tir: true,
  };
  const inside = study([origin], [null], [reflected]);
  const glass = traceTimeline(
    inside,
    optics("diacaustic", down(Math.atan2(-0.2, 1) * (180 / Math.PI)), [1.5, 1]),
    rect,
    10,
  );
  const later = trace(inside, glass, (glass.hit[0] + 0.75) / glass.total);
  near(later.rays[0].traced!.out, {
    x: reflected.direction.x * 0.5,
    y: reflected.direction.y * 0.5,
  });
  expect(glass.arrival[0]).toBe(Infinity);
});

test("stopping at the caustic ends each ray at its caustic point", () => {
  const ray = (target: Vec | null, extra: Partial<Ray> = {}): Ray => ({
    sampleIndex: 0,
    origin: { x: 1, y: 0 },
    direction: { x: 0, y: 1 },
    incident: { x: 0, y: -1 },
    target,
    virtual: !!target && target.y < 0,
    tir: false,
    ...extra,
  });
  // Without stopping, every ray runs the ray length both ways.
  expect(reach(ray({ x: 1, y: 2 }), 3, false)).toEqual({
    ahead: 3,
    behind: 3,
  });
  // A real caustic point ends the ray, and there is no extension.
  expect(reach(ray({ x: 1, y: 2 }), 3, true)).toEqual({ ahead: 2, behind: 0 });
  // ...unless the ray length comes first.
  expect(reach(ray({ x: 1, y: 5 }), 3, true)).toEqual({ ahead: 3, behind: 0 });
  // A virtual point ends the extension, and the ray runs as far ahead.
  expect(reach(ray({ x: 1, y: -0.5 }), 3, true)).toEqual({
    ahead: 0.5,
    behind: 0.5,
  });
  expect(reach(ray({ x: 1, y: -4 }), 3, true)).toEqual({
    ahead: 3,
    behind: 3,
  });
  // With no caustic point, as under total internal reflection, the ray
  // runs its full length with nothing behind it.
  expect(reach(ray(null), 3, true)).toEqual({ ahead: 3, behind: 0 });
  expect(reach(ray(null, { tir: true }), 3, true)).toEqual({
    ahead: 3,
    behind: 0,
  });
});

test("traced light stops at the caustic when the study does", () => {
  // A parabola's rays converge on its focus at (0, 1) under light falling
  // straight down, 1 + y along each from the mirror.
  const base = Array.from({ length: 21 }, (_, j) => {
    const x = -2 + j / 5;
    return { x, y: (x * x) / 4 };
  });
  const derived = base.map(() => ({ x: 0, y: 1 }));
  const incident = base.map(() => ({ x: 0, y: -1 }));
  const result = study(base, derived, toward(base, derived, incident));
  const config = optics("catacaustic", down());
  const full = traceTimeline(result, config, rect, 4);
  const stopped = traceTimeline(result, config, rect, 4, true);
  // The light arrives at the focus at τ = 4 either way, and the stopped
  // drawing is complete then, before the full rays are.
  expect(stopped.total).toBeCloseTo(4, 12);
  expect(full.total).toBeGreaterThan(stopped.total + 1);
  const end = trace(result, stopped, 1);
  const late = trace(result, stopped, 0.999);
  for (const [j, ray] of end.rays.entries()) {
    near(ray.traced!.out, { x: 0, y: 1 });
    expect(ray.traced!.back).toBeNull();
    // Just before, the light is τ = 0.004 short of the focus.
    const o = late.rays[j].traced!.out!;
    expect(Math.hypot(o.x, o.y - 1)).toBeCloseTo(0.004, 9);
  }
  // Without stopping, each ray runs on past the focus.
  for (const ray of trace(result, full, 1).rays)
    expect(Math.hypot(ray.traced!.out!.x, ray.traced!.out!.y - 1)).toBeCloseTo(
      4 - (1 + ray.origin.y),
      9,
    );
});

test("tracing starts bare, grows monotonically, and ends at the study", () => {
  const base = Array.from({ length: 41 }, (_, j) => {
    const x = -2 + j / 10;
    return { x, y: (x * x) / 4 };
  });
  // A caustic that sweeps, with a virtual stretch, a gap, and an outlier far
  // outside the view that must not stretch the timeline.
  const derived: (Vec | null)[] = base.map((p, j) =>
    j === 20 ? null : j === 40 ? { x: 1000, y: 1000 } : { x: p.x / 2, y: 1 },
  );
  const virtual = base.map((_, j) => j < 5);
  const incident = base.map(() => ({ x: 0, y: -1 }));
  const rays = base.map((p, j): Ray => ({
    sampleIndex: j,
    origin: p,
    direction: derived[j]
      ? unit(virtual[j] ? sub(p, derived[j]!) : sub(derived[j]!, p))
      : { x: 0, y: 1 },
    incident: incident[j],
    target: derived[j],
    virtual: virtual[j],
    tir: false,
  }));
  const result = study(base, derived, rays, virtual);
  const timeline = traceTimeline(
    result,
    optics("catacaustic", down()),
    rect,
    2,
  );
  expect(timeline.arrival[40]).toBeGreaterThan(1000);
  expect(timeline.total).toBeLessThan(20);
  const start = trace(result, timeline, 0);
  expect(start.base).toEqual(base);
  expect(start.derived.every((p) => p === null)).toBe(true);
  for (const ray of start.rays) {
    expect(ray.traced!.out).toBeNull();
    expect(ray.traced!.back).toBeNull();
  }
  let shown = 0;
  for (let k = 0; k <= 100; k++) {
    const view = trace(result, timeline, k / 100);
    const now = view.derived.filter((p) => p !== null).length;
    expect(now).toBeGreaterThanOrEqual(shown);
    shown = now;
    // A sample is shown only where the study has one; gaps stay gaps.
    expect(view.derived[20]).toBeNull();
    view.derived.forEach((p, j) => p && expect(p).toEqual(derived[j]));
  }
  const end = trace(result, timeline, 1);
  expect(end.derived).toEqual(derived);
  expect(end.virtual).toEqual(virtual);
  // Every ray is drawn to its full length at the end.
  for (const ray of end.rays)
    near(ray.traced!.out, {
      x: ray.origin.x + 2 * ray.direction.x,
      y: ray.origin.y + 2 * ray.direction.y,
    });
  // A virtual caustic point appears when the dashed extension behind the
  // mirror reaches it, not before.
  const j = 2;
  const reach = Math.hypot(
    derived[j]!.x - base[j].x,
    derived[j]!.y - base[j].y,
  );
  expect(timeline.arrival[j]).toBeCloseTo(timeline.hit[j] + reach, 12);
  const halfway = trace(
    result,
    timeline,
    (timeline.hit[j] + reach / 2) / timeline.total,
  );
  expect(halfway.derived[j]).toBeNull();
  near(halfway.rays[j].traced!.back, {
    x: base[j].x - (rays[j].direction.x * reach) / 2,
    y: base[j].y - (rays[j].direction.y * reach) / 2,
  });
});

test("a caustic refined between samples appears as light reaches it", () => {
  // Light falls straight down onto y = x²/4; each sample's caustic point
  // lies one unit below it, so it is reached at 3 − y + 1 = 4 − x²/4 from
  // the top of the view, and the outer samples are reached first.
  const base = Array.from({ length: 5 }, (_, j) => {
    const x = -2 + j;
    return { x, y: (x * x) / 4 };
  });
  const derived = base.map((p) => ({ x: p.x, y: p.y - 1 }));
  const incident = base.map(() => ({ x: 0, y: -1 }));
  const result: Result = {
    ...study(base, derived, toward(base, derived, incident)),
    adaptive: {
      derived: {
        // Points between samples 0 and 1 and between 2 and 3, a break
        // between 3 and 4, and a virtual stretch.
        points: [
          derived[0],
          { x: -1.5, y: -0.4 },
          derived[1],
          derived[2],
          { x: 0.25, y: -0.98 },
          { x: 0.5, y: -0.94 },
          derived[3],
          null,
          derived[4],
        ],
        at: [0, 0.5, 1, 2, 2.25, 2.5, 3, 3.5, 4],
        virtual: [false, false, false, true, true, true, false, false, false],
        tolerance: 1e-3,
        inserted: 4,
        breaks: 1,
        unresolved: 0,
        exhausted: false,
      },
    },
  };
  const timeline = traceTimeline(
    result,
    optics("catacaustic", down()),
    rect,
    2,
  );
  const refined = result.adaptive!.derived!;
  const shown = (p: number) => trace(result, timeline, p).adaptive!.derived!;
  // Nothing is shown before the first light arrives, at τ = 3 for x = ±2.
  const start = shown(0);
  expect(start.at).toEqual(refined.at);
  expect(start.virtual).toEqual(refined.virtual);
  expect(start.points.every((p) => p === null)).toBe(true);
  // At τ = 3.6 only the samples at x = ±2 (τ = 3) are reached, not those at
  // x = ±1 (τ = 3.75); the point between samples 0 and 1 arrives at the
  // interpolated τ = 3.375.
  const early = shown(3.6 / timeline.total);
  expect(early.points).toEqual([
    derived[0],
    { x: -1.5, y: -0.4 },
    null,
    null,
    null,
    null,
    null,
    null,
    derived[4],
  ]);
  // At τ = 3.9 the middle sample (τ = 4) is not yet reached, but between it
  // and its neighbor (τ = 3.75) the point at 2.5 (τ = 3.875) is, while the
  // one at 2.25 (τ = 3.9375) is not.
  expect(shown(3.9 / timeline.total).points).toEqual([
    derived[0],
    { x: -1.5, y: -0.4 },
    derived[1],
    null,
    null,
    { x: 0.5, y: -0.94 },
    derived[3],
    null,
    derived[4],
  ]);
  // Every point arrives once both its neighboring samples have, in order.
  let count = 0;
  for (let k = 0; k <= 100; k++) {
    const view = shown(k / 100);
    const now = view.points.filter((p) => p !== null).length;
    expect(now).toBeGreaterThanOrEqual(count);
    count = now;
    view.points.forEach((p, i) => p && expect(p).toEqual(refined.points[i]));
  }
  // The break stays a break, and the end is the study's refined curve.
  expect(shown(1)).toEqual(refined);
  expect(shown(1).points[7]).toBeNull();
});

test("a derived input is the curve that is lit", () => {
  const base = [{ x: 5, y: 5 }];
  const input = [{ x: 0, y: 0 }];
  const derived = [{ x: 0, y: 1 }];
  const result = {
    ...study(base, derived, toward(input, derived, [{ x: 0, y: -1 }])),
    input,
  };
  const timeline = traceTimeline(
    result,
    optics("catacaustic", down()),
    rect,
    2,
  );
  expect(timeline.hit[0]).toBeCloseTo(3, 12);
  expect(timeline.arrival[0]).toBeCloseTo(4, 12);
});

async function ready(page: Page, label: string) {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await openAnimation(page);
  await choosePreset(page, { label });
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
}
const progress = async (page: Page) =>
  Number(
    await page.locator("#artwork").getAttribute("data-animation-progress"),
  );
// The caustic's real and virtual parts, together.
const derived = async (page: Page) =>
  (
    await page
      .locator(
        "[data-testid=derived-curve], [data-testid=virtual-derived-curve]",
      )
      .evaluateAll((paths) => paths.map((p) => p.getAttribute("d")))
  ).join("");
const animate = (page: Page) =>
  page.getByRole("combobox", { name: "Animate", exact: true });

test("slowly turning reflected rays keep their finite caustic in the drawing and SVG", async ({
  page,
}) => {
  await ready(page, "Parallel light & a circle");
  const original = await derived(page);
  for (const [label, value] of [
    ["x(t)", "t"],
    ["y(t)", "2^-33*t^2"],
    ["t from", "-1"],
    ["to", "1"],
    ["Travel direction (degrees)", "0"],
    ["Numerical samples", "65"],
  ])
    await page.getByLabel(label, { exact: true }).fill(value);
  await expect
    .poll(
      async () =>
        JSON.parse((await page.locator("#artwork desc").textContent())!).curve
          .max,
    )
    .toBe(1);
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  const real = page.getByTestId("derived-curve");
  const virtual = page.getByTestId("virtual-derived-curve");
  for (const refined of [false, true]) {
    await page
      .getByRole("checkbox", { name: "Refine between samples", exact: true })
      .setChecked(refined);
    await expect(page.locator(".plot-wrap")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(real).not.toHaveAttribute("d", "");
    await expect(virtual).not.toHaveAttribute("d", "");
    const art = page.locator("#artwork");
    const scale = Number(await art.getAttribute("data-camera-scale"));
    const cx = Number(
      (await art.getAttribute("data-camera-center"))!.split(",")[0],
    );
    const xs = (await derived(page)).match(/[ML][^ML]*/g)!.flatMap((run) => {
      const n = run.slice(1).trim().split(/[ ,]+/).map(Number);
      return n.filter((_, i) => i % 2 === 0).map((x) => cx + (x - 500) / scale);
    });
    expect(Math.min(...xs)).toBeCloseTo(-1.5, 4);
    expect(Math.max(...xs)).toBeCloseTo(1.5, 4);
  }
  const drawing = await derived(page);
  const download = page.waitForEvent("download");
  await exportImage(page, "SVG");
  const svg = await readFile((await (await download).path())!, "utf8");
  const saved = await page.evaluate((s) => {
    const doc = new DOMParser().parseFromString(s, "image/svg+xml");
    return {
      paths: [
        ...doc.querySelectorAll(
          '[data-testid="derived-curve"], [data-testid="virtual-derived-curve"]',
        ),
      ]
        .map((p) => p.getAttribute("d"))
        .join(""),
      metadata: doc.querySelector("desc")!.textContent!,
    };
  }, svg);
  expect(saved.paths).toBe(drawing);
  expect(saved.metadata).toContain("2^-33*t^2");
  await page.getByLabel("y(t)", { exact: true }).fill("0");
  await expect(real).toHaveAttribute("d", "");
  await expect(virtual).toHaveAttribute("d", "");
  await choosePreset(page, { label: "Parallel light & a circle" });
  await expect.poll(() => derived(page)).toBe(original);
});

test("tracing is offered only for optical studies, with fixed cameras", async ({
  page,
}) => {
  await ready(page, "Cycloid & its evolute");
  await expect(animate(page).locator("option[value=trace]")).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Animation camera" })
    .selectOption("fit");
  await choosePreset(page, { label: "Parallel light & a circle" });
  await animate(page).selectOption("trace");
  const camera = page.getByRole("combobox", { name: "Animation camera" });
  await expect(camera).toHaveValue("hold");
  await expect(camera.locator("option")).toHaveText([
    "Hold final view",
    "Hold current view",
  ]);
  // Another construction falls back to drawing along the curve.
  await choosePreset(page, { label: "Cycloid & its evolute" });
  await expect(animate(page)).toHaveValue("reveal");
});

for (const [label, camera] of [
  ["Parallel light & a circle", "hold"],
  ["Through a parabola", "current"],
  ["Light inside a circle", "hold"],
  // Refined between its samples, so the refined caustic must be traced too.
  ["Sunlight in a hammered cup", "hold"],
] as const)
  test(`${label} traces from its light to the caustic (${camera} view)`, async ({
    page,
  }) => {
    await ready(page, label);
    const original = await derived(page);
    const study = await page.locator("#artwork desc").textContent();
    await animate(page).selectOption("trace");
    await page
      .getByRole("combobox", { name: "Animation camera" })
      .selectOption(camera);
    await page
      .getByRole("spinbutton", { name: "Duration (seconds)" })
      .fill("3");
    await page.getByRole("button", { name: "Play animation" }).click();
    await expect.poll(() => progress(page)).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const slider = page.getByRole("slider", {
      name: "Animation progress",
      exact: true,
    });
    // The first frame is the curve and its light alone.
    await slider.press("Home");
    await expect.poll(() => progress(page)).toBe(0);
    expect(await derived(page)).toBe("");
    await expect(page.locator(".animation-values")).toContainText(
      "0 caustic points reached",
    );
    // The caustic grows as the light reaches it.
    let shown = 0;
    for (const p of ["0.3", "0.6", "0.9"]) {
      await slider.fill(p);
      await expect.poll(() => progress(page)).toBe(Number(p));
      const d = (await derived(page)) ?? "";
      expect(d.length).toBeGreaterThanOrEqual(shown);
      shown = d.length;
    }
    expect(shown).toBeGreaterThan(0);
    await slider.press("End");
    await expect.poll(() => progress(page)).toBe(1);
    expect(await derived(page)).toBe(original);
    await page
      .getByRole("button", { name: "Back to study", exact: true })
      .click();
    expect(await page.locator("#artwork desc").textContent()).toBe(study);
    expect(await derived(page)).toBe(original);
  });

test("a traced MP4 decodes with exact timing and changing endpoints", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await openExportSettings(page);
  await choosePreset(page, { label: "Parallel light & a circle" });
  await animate(page).selectOption("trace");
  const exportMP4 = page.getByRole("button", { name: "Export MP4 video" });
  await expect(exportMP4).toBeEnabled();
  const original = await page.locator("#artwork").innerHTML();
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill(".4");
  await page
    .getByRole("combobox", { name: "Export frame rate" })
    .selectOption("15");
  const download = page.waitForEvent("download");
  await exportMP4.click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe(
    "tangent-garden-catacaustic-trace.mp4",
  );
  const path = (await saved.path())!;
  const bytes = await readFile(path);
  const probed = probe(path);
  if (probed) {
    expect(probed.frames).toBe(6);
    expect(probed.durations).toEqual(
      exportTiming(0.4, 15).map((f) => f.duration),
    );
  }
  const decoded = await decodeVideo(page, bytes);
  expect(decoded.duration).toBeCloseTo(0.4, 3);
  expect(decoded.first.hash).not.toBe(decoded.last.hash);
  expect(await page.locator("#artwork").innerHTML()).toBe(original);
});

test("rays stop at the caustic in the drawing, a preset and its export", async ({
  page,
}) => {
  await page.goto("/");
  const stop = page.getByRole("checkbox", { name: "Stop rays at the caustic" });
  // The outgoing rays (drawn at opacity 0.5) and their dashed extensions.
  const drawn = () =>
    page
      .locator('#artwork line[opacity="0.5"], #artwork line[stroke-dasharray]')
      .evaluateAll((lines) =>
        lines.map((l) => ({
          dashed: l.hasAttribute("stroke-dasharray"),
          length: Math.hypot(
            +l.getAttribute("x2")! - +l.getAttribute("x1")!,
            +l.getAttribute("y2")! - +l.getAttribute("y1")!,
          ),
        })),
      );
  const total = (lines: { dashed: boolean; length: number }[]) =>
    lines.reduce((sum, l) => sum + l.length, 0);
  // The glass opens with its rays stopped: they converge, so none has a
  // dashed extension.
  await choosePreset(page, { label: "Sunlight bending into glass" });
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(stop).toBeChecked();
  await expect(page.locator(".plot-wrap")).toHaveAttribute("data-stop", "true");
  const stopped = await drawn();
  expect(stopped.filter((l) => l.dashed)).toHaveLength(0);
  await stop.uncheck();
  await expect(page.locator(".plot-wrap")).not.toHaveAttribute("data-stop");
  const full = await drawn();
  const rays = full.filter((l) => l.dashed).length;
  expect(rays).toBeGreaterThan(30);
  expect(total(full.filter((l) => !l.dashed))).toBeGreaterThan(
    total(stopped) * 1.2,
  );
  // A preset without stopped rays draws them full length.
  await stop.check();
  await choosePreset(page, { label: "Parallel light & a circle" });
  await expect(stop).not.toBeChecked();
  // A traced animation keeps the rays stopped as the light travels, and at
  // its final frame.
  await choosePreset(page, { label: "Sunlight bending into glass" });
  await openExportSettings(page);
  await expect(animate(page)).toHaveValue("trace");
  await page.getByRole("combobox", { name: "Repeat" }).selectOption("once");
  await page.getByRole("button", { name: "Play animation" }).click();
  await expect.poll(() => progress(page)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", {
    name: "Animation progress",
    exact: true,
  });
  await slider.fill("0.7");
  // The preset eases its pace, so this is partway, not at 0.7.
  await expect.poll(() => progress(page)).toBeGreaterThan(0.5);
  expect(await progress(page)).toBeLessThan(1);
  expect((await drawn()).filter((l) => l.dashed)).toHaveLength(0);
  await slider.press("End");
  await expect.poll(() => progress(page)).toBe(1);
  const final = await drawn();
  expect(final.filter((l) => l.dashed)).toHaveLength(0);
  expect(total(final)).toBeCloseTo(total(stopped), 3);
  await page
    .getByRole("button", { name: "Back to study", exact: true })
    .click();
  // Every animation's export draws the rays as the study does; a revealed
  // one ends on the whole study.
  await animate(page).selectOption("reveal");
  const last = async () => {
    await page
      .getByRole("spinbutton", { name: "Duration (seconds)" })
      .fill(".4");
    await page
      .getByRole("combobox", { name: "Export frame rate" })
      .selectOption("15");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export MP4 video" }).click();
    const bytes = await readFile((await (await download).path())!);
    return (await decodeVideo(page, bytes)).last.ink;
  };
  const exportedStopped = await last();
  await stop.uncheck();
  const exportedFull = await last();
  // Lossy encodes are compared by how much they draw, never by hash: the
  // full rays ink about a fifth more of the frame than the stopped ones.
  expect(exportedFull).toBeGreaterThan(exportedStopped * 1.1);
});

// Scale the actual expressions through the controls, then compare the
// fitted page geometry and saved SVG with the existing study's drawing.
for (const label of [
  "Parallel light & a circle",
  "Sunlight bending into glass",
])
  test(`${label} keeps its rays and caustic with tiny length units`, async ({
    page,
  }) => {
    await ready(page, label);
    const geometry = () =>
      page
        .locator("#artwork path, #artwork line")
        .evaluateAll((nodes) =>
          nodes.map((n) => [
            n.tagName,
            ...["d", "x1", "y1", "x2", "y2", "stroke-dasharray", "opacity"].map(
              (a) => n.getAttribute(a),
            ),
          ]),
        );
    const original = await geometry();
    const caustic = await derived(page);
    expect(caustic.length).toBeGreaterThan(100);
    expect(original.filter((n) => n[0] === "line").length).toBeGreaterThan(20);
    for (const [axis, expression] of [
      ["x", "2^-35*cos(t)"],
      ["y", "2^-35*sin(t)"],
    ]) {
      await page
        .getByRole("textbox", { name: `${axis}(t)`, exact: true })
        .fill(expression);
      await expect
        .poll(
          async () =>
            JSON.parse((await page.locator("#artwork desc").textContent())!)
              .curve[axis],
        )
        .toBe(expression);
      await expect(page.locator(".plot-wrap")).toHaveAttribute(
        "aria-busy",
        "false",
      );
    }
    await expect.poll(() => derived(page)).toBe(caustic);
    expect(await geometry()).toEqual(original);
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export image" }).click();
    await page.getByRole("menuitem", { name: /SVG/ }).click();
    const saved = await downloading;
    const svg = await readFile((await saved.path())!, "utf8");
    const exported = await page.evaluate((svg) => {
      const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
      return Array.from(doc.querySelectorAll("path, line"), (n) => [
        n.tagName,
        ...["d", "x1", "y1", "x2", "y2", "stroke-dasharray", "opacity"].map(
          (a) => n.getAttribute(a),
        ),
      ]);
    }, svg);
    expect(exported).toEqual(original);
    // Restoring the preset replaces the edited expressions and keeps the
    // original picture, rather than carrying the tiny scale into it.
    await choosePreset(page, { label });
    await expect(
      page.getByRole("textbox", { name: "x(t)", exact: true }),
    ).toHaveValue("cos(t)");
    await expect(
      page.getByRole("textbox", { name: "y(t)", exact: true }),
    ).toHaveValue("sin(t)");
    await expect.poll(() => derived(page)).toBe(caustic);
    expect(await geometry()).toEqual(original);
  });
