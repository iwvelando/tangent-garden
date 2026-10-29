import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { applyTracks, availableTargets, reveal } from "../web/animation";
import { fitFrame } from "../web/Plot";
import { presets } from "../web/presets";
import type { Result, Vec } from "../web/types";
import {
  exportImage,
  openAnimation,
  openExportSettings,
  choosePreset,
} from "./helpers";
import { decodeVideo, probe as probeMovie } from "./video";
import { deflateRawSync } from "node:zlib";
import { presetStudy } from "../web/planar-link";

const title = "Flower & a rolling circle";

test("exported motion renders only the selected construction subsets in every frame", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const frames: Promise<string>[] = [];
    (window as any).constructionExportFrames = frames;
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      if (blob instanceof Blob && blob.type === "image/svg+xml")
        frames.push(blob.text());
      return create(blob);
    };
  });
  await ready(page);
  await field(page, "Definition").selectOption("fourier");
  await settled(page);
  await page
    .getByRole("checkbox", { name: "Fourier circles & vectors", exact: true })
    .uncheck();
  await page
    .getByRole("checkbox", { name: "Contact normals", exact: true })
    .uncheck();
  await openExportSettings(page);
  await field(page, "Duration (seconds)").fill(".4");
  await field(page, "Export frame rate").selectOption("15");
  await field(page, "Export resolution").fill("0.5");
  await field(page, "Export format").selectOption("mp4");
  const saving = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export MP4 video" }).click();
  const file = (await (await saving).path())!;
  const frames = await page.evaluate(async () => {
    const frames = await Promise.all(
      (window as any).constructionExportFrames as Promise<string>[],
    );
    return frames.map((s) => {
      const doc = new DOMParser().parseFromString(s, "image/svg+xml");
      return {
        progress: Number(
          doc.documentElement.getAttribute("data-animation-progress"),
        ),
        roller: doc.querySelectorAll('[data-testid="rolling-construction"]')
          .length,
        fourier: doc.querySelectorAll(
          '[data-testid="harmonic-geometry"], [data-testid="harmonic-point"]',
        ).length,
        normals: doc.querySelectorAll("svg > g:not([data-testid]) > line")
          .length,
        sample: Number(
          doc
            .querySelector('[data-testid="rolling-construction"]')
            ?.getAttribute("data-sample"),
        ),
      };
    });
  });
  expect(frames).toHaveLength(6);
  expect(frames[0].progress).toBe(0);
  expect(frames.at(-1)!.progress).toBe(1);
  expect(frames[0].sample).toBe(0);
  expect(frames.at(-1)!.sample).toBeGreaterThan(0);
  for (const frame of frames)
    expect(frame).toMatchObject({ roller: 1, fourier: 0, normals: 0 });
  const independent = probeMovie(file);
  if (independent) {
    expect(independent.frames).toBe(6);
    expect(independent.durations.reduce((a, b) => a + b, 0)).toBe(400);
  }
  const decoded = await decodeVideo(page, await readFile(file));
  expect(decoded.duration).toBeCloseTo(0.4, 3);
  expect(decoded.first.ink).toBeGreaterThan(0);
  expect(decoded.last.ink).toBeGreaterThan(0);
  expect(decoded.first.hash).not.toBe(decoded.last.hash);
});

test("family construction selection applies to definition and rolling guides too", async ({
  page,
}) => {
  const study = presetStudy(
    presets.findIndex((p) => p.config.curve.format === "fourier"),
  );
  study.config.kind = "rolling";
  study.config.input = "pedal";
  study.config.curve.terms = [{ frequency: 1, radius: 2, phase: 0 }];
  study.family = {
    enabled: true,
    target: "poleX",
    from: 0.1,
    to: 0.3,
    count: 3,
    selected: 1,
    presentation: "family",
  };
  study.layers.lines = false;
  const token = deflateRawSync(
    Buffer.from(JSON.stringify({ v: 1, notebook: "2d", study })),
  ).toString("base64url");
  await page.goto(`/#s=${token}`);
  await expect(page.locator("#artwork [data-family-member]")).toHaveCount(3);
  for (const i of [0, 1, 2]) {
    const member = page.locator(`#artwork [data-family-member="${i}"]`);
    await expect(member.getByTestId("harmonic-geometry")).toHaveCount(
      i === 1 ? 1 : 0,
    );
    await expect(member.getByTestId("rolling-construction")).toHaveCount(
      i === 1 ? 1 : 0,
    );
  }
  await page
    .getByRole("checkbox", {
      name: "Construction lines for all members",
      exact: true,
    })
    .check();
  await expect(page.getByTestId("harmonic-geometry")).toHaveCount(3);
  await expect(page.getByTestId("rolling-construction")).toHaveCount(3);
  await page
    .getByRole("checkbox", { name: "Fourier circles & vectors", exact: true })
    .uncheck();
  await expect(page.getByTestId("harmonic-geometry")).toHaveCount(0);
  await expect(page.getByTestId("rolling-construction")).toHaveCount(3);
});

test("Fourier guides, rolling mechanism and contact normals are independent in playback, links and SVG", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const study = presetStudy(
    presets.findIndex((p) => p.config.curve.format === "fourier"),
  );
  study.config.kind = "rolling";
  study.config.curve.terms = Array.from({ length: 16 }, (_, i) => ({
    frequency: i + 1,
    radius: 1 / (i + 1) ** 2,
    phase: 0,
  }));
  const token = deflateRawSync(
    Buffer.from(JSON.stringify({ v: 1, notebook: "2d", study })),
  ).toString("base64url");
  await page.goto(`/#s=${token}`);
  await settled(page);
  await expect(page.getByTestId("epicycle")).toHaveCount(16);
  const original = await definition(page);
  const camera = await page
    .locator("#artwork")
    .getAttribute("data-camera-center");
  const s = await scale(page);
  const basePath = await page.getByTestId("base-curve").getAttribute("d");
  const layers = page.getByRole("group", {
    name: "Visible layers",
    exact: true,
  });
  await expect(
    layers.getByRole("group", { name: "Curve layers", exact: true }),
  ).toBeVisible();
  await expect(
    layers.getByRole("group", { name: "Construction layers", exact: true }),
  ).toBeVisible();
  await expect(
    layers.getByRole("group", { name: "Reference layers", exact: true }),
  ).toBeVisible();
  const fourier = layers.getByRole("checkbox", {
    name: "Fourier circles & vectors",
    exact: true,
  });
  const roller = layers.getByRole("checkbox", {
    name: "Rolling circle & arm",
    exact: true,
  });
  const normals = layers.getByRole("checkbox", {
    name: "Contact normals",
    exact: true,
  });
  await fourier.uncheck();
  await normals.uncheck();
  await expect(page.getByTestId("harmonic-geometry")).toHaveCount(0);
  await expect(page.getByTestId("harmonic-point")).toHaveCount(0);
  await expect(
    page.locator("#artwork > g:not([data-testid]) > line"),
  ).toHaveCount(0);
  await expect(construction(page)).toBeVisible();
  await expect(page.getByTestId("rolling-construction-point")).toBeVisible();
  expect(await definition(page)).toEqual(original);
  expect(await page.getByTestId("base-curve").getAttribute("d")).toBe(basePath);
  expect(await scale(page)).toBe(s);
  expect(
    await page.locator("#artwork").getAttribute("data-camera-center"),
  ).toBe(camera);
  await roller.uncheck();
  await expect(construction(page)).toHaveCount(0);
  await expect(page.getByTestId("rolling-construction-point")).toHaveCount(0);
  await normals.check();
  expect(
    await page.locator("#artwork > g:not([data-testid]) > line").count(),
  ).toBeGreaterThan(0);
  await normals.uncheck();
  await roller.check();
  await openAnimation(page);
  await page
    .getByRole("combobox", { name: "Animation camera", exact: true })
    .selectOption("current");
  await page
    .getByRole("spinbutton", { name: "Duration (seconds)", exact: true })
    .fill("30");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const seek = page.getByRole("slider", {
    name: "Animation progress",
    exact: true,
  });
  await seek.fill("0.5");
  await expect.poll(() => progress(page)).toBe(0.5);
  const before = await construction(page).getAttribute("data-sample");
  await fourier.check();
  await expect(page.getByTestId("epicycle")).toHaveCount(16);
  await fourier.uncheck();
  expect(await progress(page)).toBe(0.5);
  expect(await construction(page).getAttribute("data-sample")).toBe(before);
  expect(await scale(page)).toBe(s);
  const download = page.waitForEvent("download");
  await exportImage(page, "SVG");
  const svg = await readFile((await (await download).path())!, "utf8");
  expect(svg).toContain('data-testid="rolling-construction"');
  expect(svg).not.toContain('data-testid="harmonic-geometry"');
  expect(svg).not.toContain('data-testid="harmonic-point"');
  await seek.fill("1");
  await expect.poll(() => progress(page)).toBe(1);
  await page.getByRole("button", { name: /^(Stop|Back to study)$/ }).click();
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  const href = await page.evaluate(() => navigator.clipboard.readText());
  await page.goto(href);
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
  await settled(page);
  await expect(fourier).not.toBeChecked();
  await expect(normals).not.toBeChecked();
  await expect(roller).toBeChecked();
  await expect(construction(page)).toBeVisible();
  await expect(page.getByTestId("harmonic-geometry")).toHaveCount(0);
  await choosePreset(page, { label: title });
  await settled(page);
  await expect(roller).toBeChecked();
  await expect(normals).toBeChecked();
  expect(
    await page.locator("#artwork > g:not([data-testid]) > line").count(),
  ).toBe(60);
});

async function ready(page: Page, preset = title) {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await choosePreset(page, { label: preset });
  await settled(page);
}
async function settled(page: Page) {
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.locator("#artwork")).toBeVisible();
}
async function definition(page: Page) {
  return JSON.parse((await page.locator("#artwork desc").textContent())!);
}
async function progress(page: Page) {
  return Number(
    await page.locator("#artwork").getAttribute("data-animation-progress"),
  );
}
// Definition parameters are constant-expression text fields; counts are numeric.
const field = (page: Page, name: string) =>
  page.getByLabel(name, { exact: true });
const construction = (page: Page) => page.getByTestId("rolling-construction");
const tab = (page: Page, name: string) =>
  page
    .getByRole("group", { name: "Construction" })
    .getByRole("button", { name, exact: true });
const scale = async (page: Page) =>
  Number(await page.locator("#artwork").getAttribute("data-camera-scale"));
async function toScreen(page: Page, p: Vec) {
  const [cx, cy] = (await page
    .locator("#artwork")
    .getAttribute("data-camera-center"))!
    .split(",")
    .map(Number);
  const s = await scale(page);
  return { x: 500 + (p.x - cx) * s, y: 380 - (p.y - cy) * s };
}
async function circleAttributes(page: Page, selector: string) {
  return page
    .locator(selector)
    .evaluate((c) => ["cx", "cy", "r"].map((k) => Number(c.getAttribute(k))));
}
// Arc length of the flower r = 1 + 0.18 cos 5t over one lap, by midpoints.
function flowerLength() {
  const n = 200000;
  let length = 0;
  for (let i = 0; i < n; i++) {
    const t = ((i + 0.5) * 2 * Math.PI) / n;
    length += Math.hypot(1 + 0.18 * Math.cos(5 * t), -0.9 * Math.sin(5 * t));
  }
  return (length * 2 * Math.PI) / n;
}

test("the rolling preset rolls a rim point inside the flower and animates its circle", () => {
  const preset = presets.find((p) => p.title === title)!.config;
  expect(preset.kind).toBe("rolling");
  expect(preset.curve.format).toBe("polar");
  expect(preset.curve.r).toBe("1+0.18*cos(5*t)");
  expect(preset.rolling).toMatchObject({
    side: "left",
    radius: 0.118,
    arm: 0.118,
    phase: 0,
  });
  // Ten circumferences nearly equal one lap, so the ten cusps meet.
  expect(flowerLength() / (2 * Math.PI * 0.118)).toBeCloseTo(10, 2);
  const targets = availableTargets(preset);
  expect(targets.slice(0, 3)).toEqual([
    "rollingArm",
    "rollingPhase",
    "rollingRadius",
  ]);
  // The base curve is still an expression with its shape coefficient.
  expect(targets).toContain("a");
  expect(availableTargets(presets[0].config)).not.toContain("rollingArm");
  const tracks = [
    { target: "rollingArm" as const, from: 1 / 1.618, to: Math.PI / 2 },
    { target: "rollingPhase" as const, from: 0, to: 2 * Math.PI },
    { target: "rollingRadius" as const, from: 0.118, to: Math.SQRT1_2 },
  ];
  expect(applyTracks(preset, tracks, 0, 1).config.rolling).toMatchObject({
    side: "left",
    radius: 0.118,
    arm: 1 / 1.618,
    phase: 0,
  });
  expect(applyTracks(preset, tracks, 1, 1).config.rolling).toMatchObject({
    side: "left",
    radius: Math.SQRT1_2,
    arm: Math.PI / 2,
    phase: 2 * Math.PI,
  });
  expect(preset.rolling.arm).toBe(0.118);
});

test("reveal moves the rolling circle along; framing includes every position", () => {
  const point = (x: number): Vec => ({ x, y: 0 });
  const position = (i: number) => ({
    sampleIndex: i,
    center: point(i),
    radius: 20,
    contact: point(i + 1),
    point: point(i),
  });
  const result: Result = {
    base: [point(0), null, point(2), point(3)],
    derived: [point(0), null, point(2), point(3)],
    virtual: [false, false, false, false],
    rays: [],
    family: [],
    circles: [],
    rolling: [0, 1, 3].map(position),
    warnings: [],
    invalid: 1,
  };
  expect(reveal(result, 0.5).rolling.map((s) => s.sampleIndex)).toEqual([0, 1]);
  expect(reveal(result, 1)).toEqual(result);
  const config = presets.find((p) => p.title === title)!.config;
  // Large rolling circles are framed in full, as their own family.
  expect(fitFrame(result, config).span).toBeGreaterThanOrEqual(40);
  expect(fitFrame({ ...result, rolling: [] }, config).span).toBeLessThan(4);
});

test("the preset draws the rolling circle at the end of the trace", async ({
  page,
}) => {
  await ready(page);
  await expect(tab(page, "rolling")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("03 / THE ROLLING CIRCLE")).toBeVisible();
  await expect(page.getByText(/omitted samples/)).toHaveCount(0);
  // Construction lines join each contact to its tracing point.
  await expect(
    page.locator("#artwork > g:not([data-testid]) > line"),
  ).toHaveCount(60);
  const s = await scale(page);
  // At t = 2π the contact is the petal tip (1.18, 0), where the tangent points
  // up, so the circle inside it is centered at (1.062, 0).
  await expect(construction(page)).toHaveAttribute("data-sample", "1999");
  const [cx, cy, cr] = await circleAttributes(
    page,
    '[data-testid="rolling-construction"] > circle:first-child',
  );
  const center = await toScreen(page, { x: 1.062, y: 0 });
  expect(cx).toBeCloseTo(center.x, 3);
  expect(cy).toBeCloseTo(center.y, 3);
  expect(cr / s).toBeCloseTo(0.118, 9);
  const [kx, ky] = await circleAttributes(
    page,
    '[data-testid="rolling-construction"] [data-testid="contact-point"]',
  );
  const contact = await toScreen(page, { x: 1.18, y: 0 });
  expect(kx).toBeCloseTo(contact.x, 3);
  expect(ky).toBeCloseTo(contact.y, 3);
  // The arm has turned by −L/ρ from the contact direction (1, 0).
  const turn = -flowerLength() / 0.118;
  const [px, py] = await circleAttributes(
    page,
    '[data-testid="rolling-construction-point"]',
  );
  const tracing = await toScreen(page, {
    x: 1.062 + 0.118 * Math.cos(turn),
    y: 0.118 * Math.sin(turn),
  });
  expect(px).toBeCloseTo(tracing.x, 3);
  expect(py).toBeCloseTo(tracing.y, 3);
  // The circle has its own visibility layer, and
  // hiding it never reframes the drawing.
  await page
    .getByRole("checkbox", { name: "Rolling circle & arm", exact: true })
    .uncheck();
  await expect(construction(page)).toHaveCount(0);
  await expect(page.getByTestId("rolling-construction-point")).toHaveCount(0);
  expect(await scale(page)).toBe(s);
  await page
    .getByRole("checkbox", { name: "Rolling circle & arm", exact: true })
    .check();
  await expect(construction(page)).toBeVisible();
});

test("rolling controls choose a side, validate, roll back out of cusps, and roll on roulettes", async ({
  page,
}) => {
  await ready(page, "Ellipse & its evolute");
  await tab(page, "rolling").click();
  await settled(page);
  await expect(construction(page)).toBeVisible();
  const side = page.getByRole("combobox", { name: "Side of the curve" });
  await expect(side).toHaveValue("right");
  const outside = await circleAttributes(
    page,
    '[data-testid="rolling-construction"] > circle:first-child',
  );
  // The ellipse runs counterclockwise, so its left is the inside.
  await side.selectOption("left");
  await settled(page);
  expect((await definition(page)).rolling.side).toBe("left");
  const inside = await circleAttributes(
    page,
    '[data-testid="rolling-construction"] > circle:first-child',
  );
  const origin = await toScreen(page, { x: 0, y: 0 });
  expect(Math.hypot(inside[0] - origin.x, inside[1] - origin.y)).toBeLessThan(
    Math.hypot(outside[0] - origin.x, outside[1] - origin.y),
  );
  await field(page, "Circle radius ρ").fill("0.3");
  await field(page, "Tracing distance ℓ").fill("0.6");
  await field(page, "Phase ψ (radians)").fill("1.5");
  await settled(page);
  expect((await definition(page)).rolling).toMatchObject({
    side: "left",
    radius: 0.3,
    arm: 0.6,
    phase: 1.5,
  });
  // Invalid inputs explain themselves.
  await field(page, "Circle radius ρ").fill("0");
  await expect(page.getByRole("alert")).toContainText("radius ρ");
  await field(page, "Circle radius ρ").fill("0.3");
  await field(page, "Tracing distance ℓ").fill("");
  await expect(page.getByRole("alert")).toContainText("finite number");
  await field(page, "Tracing distance ℓ").fill("-1");
  await expect(page.getByRole("alert")).toContainText("tracing distance ℓ");
  await field(page, "Tracing distance ℓ").fill("0.6");
  await settled(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  // At a cusp the circle rolls back out on the same side, and says so.
  await choosePreset(page, { label: "Three-cusped curve" });
  await settled(page);
  await tab(page, "rolling").click();
  await settled(page);
  await page.getByText(/omitted samples/).click();
  await expect(page.getByText(/rolls back out of \d+ cusps?/)).toBeVisible();
  await expect(page.getByText(/stopped/)).toHaveCount(0);
  // A roulette keeps its own rolling geometry beside the construction's.
  await page
    .getByRole("combobox", { name: "Definition", exact: true })
    .selectOption("roulette");
  await settled(page);
  await expect(page.getByTestId("rolling-circle")).toHaveCount(1);
  await expect(construction(page)).toHaveCount(1);
  // Other constructions draw no rolling construction.
  await tab(page, "offset").click();
  await settled(page);
  await expect(construction(page)).toHaveCount(0);
  await expect(page.getByText("03 / THE ROLLING CIRCLE")).toHaveCount(0);
});

test("an exported rolling construction keeps its circle and definition", async ({
  page,
}) => {
  await ready(page);
  await field(page, "Phase ψ (radians)").fill("0.5");
  await settled(page);
  const download = page.waitForEvent("download");
  await exportImage(page, "SVG");
  const file = await download;
  expect(file.suggestedFilename()).toBe("tangent-garden-rolling.svg");
  const svg = await readFile((await file.path())!, "utf8");
  const exported = await page.evaluate((s) => {
    const doc = new DOMParser().parseFromString(s, "image/svg+xml");
    return {
      config: JSON.parse(doc.querySelector("desc")!.textContent!),
      circles: doc.querySelectorAll('[data-testid="rolling-construction"]')
        .length,
    };
  }, svg);
  expect(exported.config.kind).toBe("rolling");
  expect(exported.config.rolling.phase).toBe(0.5);
  expect(exported.circles).toBe(1);
});

for (const camera of ["hold", "current", "follow", "fit"]) {
  test(`rolling phase animation reaches endpoints with ${camera} camera`, async ({
    page,
  }) => {
    await ready(page);
    const original = (await definition(page)).rolling;
    await openAnimation(page);
    await page
      .getByRole("combobox", { name: "Animate", exact: true })
      .selectOption("parameters");
    const parameter = page.getByRole("combobox", {
      name: "Parameter 1",
      exact: true,
    });
    await expect(parameter).toHaveValue("rollingArm");
    await parameter.selectOption("rollingPhase");
    await page.getByRole("textbox", { name: "Track 1 from" }).fill("0");
    await page.getByRole("textbox", { name: "Track 1 to" }).fill("pi/5");
    await page.getByRole("button", { name: "Add parameter" }).click();
    await page
      .getByRole("combobox", { name: "Parameter 2", exact: true })
      .selectOption("rollingArm");
    await page.getByRole("textbox", { name: "Track 2 from" }).fill("0.118");
    await page.getByRole("textbox", { name: "Track 2 to" }).fill("phi/10");
    await page
      .getByRole("combobox", { name: "Animation camera" })
      .selectOption(camera);
    await page
      .getByRole("spinbutton", { name: "Duration (seconds)" })
      .fill(".2");
    await page.getByRole("button", { name: "Play animation" }).click();
    await expect(
      page.getByRole("button", { name: "Replay", exact: true }),
    ).toBeVisible();
    const rolling = (await definition(page)).rolling;
    expect(rolling.phase).toBe(Math.PI / 5);
    expect(rolling.arm).toBeCloseTo((1 + Math.sqrt(5)) / 20, 14);
    await expect(construction(page)).toHaveAttribute("data-sample", "1999");
    await page.getByRole("button", { name: /^(Stop|Back to study)$/ }).click();
    expect((await definition(page)).rolling).toEqual(original);
  });
}

test("reveal rolls the circle along, pauses, resumes, and an edit cancels", async ({
  page,
}) => {
  await ready(page);
  await openAnimation(page);
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill("2");
  await page.getByRole("button", { name: "Play animation" }).click();
  await expect.poll(() => progress(page)).toBeGreaterThan(0.1);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const paused = await progress(page);
  expect(paused).toBeLessThan(1);
  const sample = Number(await construction(page).getAttribute("data-sample"));
  expect(sample).toBeLessThanOrEqual(paused * 1999);
  expect(sample).toBeGreaterThan(paused * 1999 - 1999 / 59 - 1);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  await expect(construction(page)).toHaveAttribute("data-sample", "1999");
  await page.getByRole("button", { name: "Replay", exact: true }).click();
  await expect.poll(() => progress(page)).toBeGreaterThan(0);
  await field(page, "Tracing distance ℓ").fill("0.2");
  await settled(page);
  await expect(page.locator("#artwork")).not.toHaveAttribute(
    "data-animation-progress",
  );
  expect((await definition(page)).rolling.arm).toBe(0.2);
  await expect(construction(page)).toHaveAttribute("data-sample", "1999");
});

for (const theme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    test(`rolling layout in ${theme} at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: theme });
      await ready(page);
      await expect(field(page, "Phase ψ (radians)")).toBeVisible();
      // Every construction tab stays inside the sidebar.
      const group = page.getByRole("group", {
        name: "Construction",
        exact: true,
      });
      const bounds = (await group.boundingBox())!;
      for (const button of await group.getByRole("button").all()) {
        const box = (await button.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(bounds.x - 0.5);
        expect(box.x + box.width).toBeLessThanOrEqual(
          bounds.x + bounds.width + 0.5,
        );
        expect(
          await button.evaluate((b) => b.scrollWidth <= b.clientWidth),
        ).toBe(true);
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: testInfo.outputPath(`rolling-${theme}-${width}.png`),
        fullPage: true,
      });
    });
  }
}

test("a circle rolling on the flower's pedal rolls back out of all ten cusps, with every position drawn in a reveal", async ({
  page,
}) => {
  await ready(page);
  await page
    .getByRole("combobox", { name: "Construct on", exact: true })
    .selectOption("pedal");
  await settled(page);
  const trace = page.getByTestId("derived-curve");
  // One unbroken trace, from the start to the end of the domain.
  expect((await trace.getAttribute("d"))!.match(/M/g)).toHaveLength(1);
  await page.getByText(/omitted samples|Numerical notes/).click();
  await expect(page.getByText(/rolls back out of 10 cusps/)).toBeVisible();
  // Halfway through a reveal the circle is still rolling, well past the
  // first cusp, which comes 7% of the way along.
  const config = await definition(page);
  await openAnimation(page);
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill("2");
  await page.getByRole("button", { name: "Play animation" }).click();
  await expect.poll(() => progress(page)).toBeGreaterThan(0.5);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const paused = await progress(page);
  const last = Math.floor(paused * (config.samples - 1));
  const circle = construction(page);
  await expect(circle).toHaveCount(1);
  expect(Number(await circle.getAttribute("data-sample"))).toBeGreaterThan(
    last - (config.samples - 1) / (config.lines - 1) - 1,
  );
});

// Editing through the actual scalar controls must preserve the drawing,
// its representative circle, and the exported SVG at a subnanounit scale.
test("tiny rolling studies retain their drawing and exported circle", async ({
  page,
}) => {
  await ready(page);
  const selector = '[data-testid="rolling-construction"] > circle:first-child';
  const original = await circleAttributes(page, selector);
  await field(page, "r(t)").fill("2^-32*(1+0.18*cos(5*t))");
  await field(page, "Circle radius ρ").fill("0.118*2^-32");
  await field(page, "Tracing distance ℓ").fill("0.118*2^-32");
  await expect
    .poll(async () => (await definition(page)).rolling.radius)
    .toBe(0.118 * 2 ** -32);
  await settled(page);
  await expect(construction(page)).toHaveAttribute("data-sample", "1999");
  await expect(page.getByText(/omitted samples/)).toHaveCount(0);
  const tiny = await circleAttributes(page, selector);
  tiny.forEach((value, i) => expect(value).toBeCloseTo(original[i], 3));
  const trace = page.getByTestId("derived-curve");
  expect((await trace.getAttribute("d"))!.match(/M/g)).toHaveLength(1);
  const download = page.waitForEvent("download");
  await exportImage(page, "SVG");
  const svg = await readFile((await (await download).path())!, "utf8");
  const exported = await page.evaluate(
    ({ svg, selector }) => {
      const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
      return {
        config: JSON.parse(doc.querySelector("desc")!.textContent!),
        circle: Array.from(doc.querySelectorAll(selector)).map((c) =>
          ["cx", "cy", "r"].map((k) => Number(c.getAttribute(k))),
        ),
        trace: doc
          .querySelector('[data-testid="derived-curve"]')
          ?.getAttribute("d"),
      };
    },
    { svg, selector },
  );
  expect(exported.config.rolling.radius).toBe(0.118 * 2 ** -32);
  expect(exported.circle).toEqual([tiny]);
  expect(exported.trace).toBe(await trace.getAttribute("d"));
});
