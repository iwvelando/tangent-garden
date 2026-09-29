import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { choosePreset, openAnimation, openExportSettings } from "./helpers";
import { decodeVideo, probe } from "./video";
import { exportTiming } from "../web/export-quality";
import { trace, traceTimeline, type Rect } from "../web/raytrace";
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

test("a point source at a circle's centre returns there at twice the radius", () => {
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
