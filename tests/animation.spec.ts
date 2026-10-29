import { test, expect, type Page } from "@playwright/test";
import {
  openAnimation,
  exportImage,
  choosePreset,
  stalePause,
} from "./helpers";
import { applyTracks, reveal } from "../web/animation";
import { presets } from "../web/presets";
import type { Result } from "../web/types";
import {
  presetStudy as planarPreset,
  type PlotCamera,
} from "../web/planar-link";
import { deflateRawSync } from "node:zlib";
import { watchEngines, engines } from "./engines";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Plot, fitFrame, pathData } from "../web/Plot";

async function ready(page: Page, preset = "1") {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await openAnimation(page);
  await choosePreset(page, preset);
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
}
async function progress(page: Page) {
  return Number(
    await page.locator("#artwork").getAttribute("data-animation-progress"),
  );
}
async function definition(page: Page) {
  return JSON.parse((await page.locator("#artwork desc").textContent())!);
}

test("tracks interpolate independently and reveal preserves gaps and sample identity", () => {
  const base = structuredClone(presets[2].config);
  const { config, length } = applyTracks(
    base,
    [
      { target: "sourceX", from: 1, to: 0.75 },
      { target: "sourceY", from: 0, to: 2 },
      { target: "a", from: 1, to: 3 },
      { target: "lines", from: 11, to: 14 },
      { target: "samples", from: 100, to: 201 },
      { target: "rayLength", from: 0.5, to: 1.5 },
    ],
    0.5,
    0.8,
  );
  expect(config.source.position).toEqual({ x: 0.875, y: 1 });
  expect(config.curve.a).toBe(2);
  expect(config.lines).toBe(13);
  expect(config.samples).toBe(151);
  expect(length).toBe(1);
  expect(base.source.position.x).toBe(1);
  const result: Result = {
    base: [{ x: 0, y: 0 }, null, { x: 2, y: 2 }],
    derived: [null, null, { x: 1, y: 1 }],
    virtual: [false, false, true],
    rays: [
      {
        sampleIndex: 2,
        origin: { x: 2, y: 2 },
        direction: { x: 1, y: 0 },
        incident: { x: 1, y: 0 },
        target: null,
        virtual: false,
        tir: false,
      },
    ],
    family: [],
    circles: [],
    rolling: [],
    warnings: [],
    invalid: 2,
  };
  expect(reveal(result, 0.5).base).toEqual([{ x: 0, y: 0 }, null]);
  expect(reveal(result, 0.5).rays).toHaveLength(0);
  expect(reveal(result, 1)).toEqual(result);
});

test("unwinding holds final framing, pauses, scrubs, exports, and restores the manual view", async ({
  page,
}) => {
  await ready(page);
  const original = await page
    .locator("#artwork path")
    .first()
    .getAttribute("d");
  await page.locator("#artwork").hover();
  await page.mouse.wheel(0, -300);
  await expect(page.locator("#artwork path").first()).not.toHaveAttribute(
    "d",
    original!,
  );
  const manual = await page.locator("#artwork path").first().getAttribute("d");
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill("3");
  await page.getByRole("button", { name: "Play animation" }).click();
  await expect.poll(() => progress(page)).toBeGreaterThan(0.1);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const p = await progress(page);
  expect(p).toBeLessThan(1);
  expect(
    (await page.locator("#artwork path").first().getAttribute("d"))!.length,
  ).toBeLessThan(original!.length);
  const scale = await page
    .locator("#artwork")
    .getAttribute("data-camera-scale");
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await exportImage(page, "SVG");
  expect((await download).suggestedFilename()).toBe(
    "tangent-garden-involute.svg",
  );
  await page
    .getByRole("slider", { name: "Animation progress", exact: true })
    .press("Home");
  await expect.poll(() => progress(page)).toBe(0);
  await page
    .getByRole("slider", { name: "Animation progress", exact: true })
    .press("End");
  await expect.poll(() => progress(page)).toBe(1);
  await expect(page.locator("#artwork")).toHaveAttribute(
    "data-camera-scale",
    scale!,
  );
  await expect(page.locator("#artwork path").first()).toHaveAttribute(
    "d",
    original!,
  );
  await page
    .getByRole("button", { name: /^(Stop|Back to study)$/, exact: true })
    .click();
  await expect(page.locator("#artwork path").first()).toHaveAttribute(
    "d",
    manual!,
  );
  await expect(page.locator("#artwork")).not.toHaveAttribute(
    "data-animation-progress",
  );
});

for (const camera of ["follow", "fit"])
  test(`${camera} camera handles the zero-length start and completes exactly`, async ({
    page,
  }) => {
    await ready(page);
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
    const fullScale = Number(
      await page.locator("#artwork").getAttribute("data-camera-scale"),
    );
    const fullCenter = await page
      .locator("#artwork")
      .getAttribute("data-camera-center");
    await page
      .getByRole("slider", { name: "Animation progress", exact: true })
      .press("Home");
    await expect.poll(() => progress(page)).toBe(0);
    const startScale = Number(
      await page.locator("#artwork").getAttribute("data-camera-scale"),
    );
    expect(Number.isFinite(startScale)).toBe(true);
    if (camera === "follow") expect(startScale).toBe(fullScale);
    else expect(startScale).toBeGreaterThan(fullScale);
    expect(
      await page.locator("#artwork").getAttribute("data-camera-center"),
    ).not.toBe(fullCenter);
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Replay", exact: true }),
    ).toBeVisible();
    expect(await progress(page)).toBe(1);
  });

test("multiple moving-light tracks reach exact endpoints and stop restores the study", async ({
  page,
}) => {
  await ready(page, "2");
  const original = await page.locator("#artwork path").nth(1).getAttribute("d");
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("parameters");
  await expect(
    page.getByRole("combobox", { name: "Parameter 1", exact: true }),
  ).toHaveValue("sourceX");
  await page.getByRole("textbox", { name: "Track 1 to" }).fill(".75");
  await page.getByRole("button", { name: "+ Add parameter" }).click();
  await page
    .getByRole("combobox", { name: "Parameter 2", exact: true })
    .selectOption("sourceY");
  await page.getByRole("textbox", { name: "Track 2 to" }).fill(".2");
  await page
    .getByRole("spinbutton", { name: "Duration (seconds)" })
    .fill(".25");
  await page.getByRole("button", { name: "Play animation" }).click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  const q = await definition(page);
  expect(q.source.position).toEqual({ x: 0.75, y: 0.2 });
  expect(q.animation.progress).toBe(1);
  expect(await page.locator("#artwork path").nth(1).getAttribute("d")).not.toBe(
    original,
  );
  await page
    .getByRole("button", { name: /^(Stop|Back to study)$/, exact: true })
    .click();
  await expect(page.locator("#artwork path").nth(1)).toHaveAttribute(
    "d",
    original!,
  );
  expect((await definition(page)).source.position).toEqual({ x: 1, y: 0 });
});

test("parallel-light direction, scalar endpoints, and invalid track recovery", async ({
  page,
}) => {
  await ready(page, "7");
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("parameters");
  await expect(
    page.getByRole("combobox", { name: "Parameter 1", exact: true }),
  ).toHaveValue("angle");
  // The preset repeats back and forth; once, it reaches Replay.
  await page.getByRole("combobox", { name: "Repeat" }).selectOption("once");
  await page.getByRole("textbox", { name: "Track 1 to" }).fill("t");
  await page.getByRole("button", { name: "Play animation" }).click();
  await expect(page.getByRole("alert")).toContainText("not allowed");
  await page.getByRole("textbox", { name: "Track 1 to" }).fill("180/pi");
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill(".2");
  await page.getByRole("button", { name: "Play animation" }).click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  expect((await definition(page)).source.angle).toBeCloseTo(180 / Math.PI, 12);
  await page
    .getByRole("button", { name: /^(Stop|Back to study)$/, exact: true })
    .click();
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill("30");
  await page.getByRole("button", { name: "Play animation" }).click();
  await page
    .getByRole("button", { name: /^(Stop|Back to study)$/, exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Travel direction (degrees)" })
    .fill("45");
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  expect((await definition(page)).source.angle).toBe(45);
  await expect(page.locator("#artwork")).not.toHaveAttribute(
    "data-animation-progress",
  );
});

test("shape coefficient animation changes the numerical curve", async ({
  page,
}) => {
  await ready(page, "1");
  await page
    .getByRole("textbox", { name: "x(t)", exact: true })
    .fill("a*cos(t)");
  await page
    .getByRole("textbox", { name: "y(t)", exact: true })
    .fill("a*sin(t)");
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("parameters");
  await page.getByRole("textbox", { name: "Track 1 to" }).fill("phi");
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill(".2");
  await page.getByRole("button", { name: "Play animation" }).click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  expect((await definition(page)).curve.a).toBeCloseTo(
    (1 + Math.sqrt(5)) / 2,
    12,
  );
  await page.getByRole("textbox", { name: "x(t)", exact: true }).fill("cos(t)");
  await expect(page.locator("#artwork")).not.toHaveAttribute(
    "data-animation-progress",
  );
});

for (const mode of ["reveal", "parameters"] as const) {
  test(`dragging the paused timeline scrubs continuously in ${mode} mode`, async ({
    page,
  }) => {
    await ready(page, "0");
    await page
      .getByRole("combobox", { name: "Animate", exact: true })
      .selectOption(mode);
    await page
      .getByRole("spinbutton", { name: "Duration (seconds)" })
      .fill("20");
    await page.getByRole("button", { name: "Play animation" }).click();
    await expect.poll(() => progress(page)).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const slider = page.getByRole("slider", {
      name: "Animation progress",
      exact: true,
    });
    await slider.scrollIntoViewIfNeeded();
    const box = (await slider.boundingBox())!;
    const y = box.y + box.height / 2;
    const at = (f: number) => box.x + 8 + (box.width - 16) * f;
    const start = await progress(page);
    await page.mouse.move(at(start), y);
    await page.mouse.down();
    const seen = new Set<number>();
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(at(start + ((0.8 - start) * i) / 12), y, {
        steps: 2,
      });
      // The slider stays usable, and its value follows the pointer.
      await expect(slider).toBeEnabled();
      seen.add(await progress(page));
    }
    await page.mouse.up();
    await expect(slider).toHaveValue(/^0\.(79|8|80)\d*$/);
    await expect.poll(() => progress(page)).toBeCloseTo(0.8, 1);
    // Intermediate frames rendered during the drag, not only at release.
    expect(seen.size).toBeGreaterThan(2);
    await expect(
      page.getByRole("button", { name: "Resume", exact: true }),
    ).toBeVisible();
  });
}

test("a completed animation releases pan and zoom without Reset view", async ({
  page,
}) => {
  await ready(page);
  const artwork = page.locator("#artwork");
  await artwork.hover();
  await page.mouse.wheel(0, -300);
  const manual = await artwork.locator("path").first().getAttribute("d");
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill(".2");
  await page.getByRole("button", { name: "Play animation" }).click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  // Nothing moves at the moment the camera is released.
  const held = {
    scale: await artwork.getAttribute("data-camera-scale"),
    center: await artwork.getAttribute("data-camera-center"),
  };
  await expect(page.getByRole("button", { name: "↔ Fit view" })).toBeEnabled();
  await artwork.hover();
  await page.mouse.wheel(0, -300);
  await expect(artwork).not.toHaveAttribute("data-camera-scale", held.scale!);
  const box = (await artwork.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2);
  await page.mouse.up();
  await expect(artwork).not.toHaveAttribute("data-camera-center", held.center!);
  // The final frame is still shown, and Fit view returns to its framing.
  expect(await progress(page)).toBe(1);
  await page.getByRole("button", { name: "↔ Fit view" }).click();
  await expect(artwork).toHaveAttribute("data-camera-scale", held.scale!);
  await expect(artwork).toHaveAttribute("data-camera-center", held.center!);
  // Scrubbing holds the animation camera again.
  await page.mouse.wheel(0, -300);
  await page
    .getByRole("slider", { name: "Animation progress", exact: true })
    .press("Home");
  await expect.poll(() => progress(page)).toBe(0);
  await expect(artwork).toHaveAttribute("data-camera-scale", held.scale!);
  await artwork.hover();
  await page.mouse.wheel(0, -300);
  await expect(artwork).toHaveAttribute("data-camera-scale", held.scale!);
  // Reset view still restores the manual view from before the animation.
  await page
    .getByRole("slider", { name: "Animation progress", exact: true })
    .press("End");
  await expect.poll(() => progress(page)).toBe(1);
  await page
    .getByRole("button", { name: "Back to study", exact: true })
    .click();
  await expect(artwork.locator("path").first()).toHaveAttribute("d", manual!);
});

// A Pause click that reaches its handler as playback ends leaves the
// animation complete, not paused at its last frame.
test("pausing as the animation ends leaves it complete", async ({ page }) => {
  await ready(page);
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill("1");
  await page.getByRole("button", { name: "Play animation" }).click();
  const pause = await stalePause(page);
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  await pause();
  await expect(
    page.getByRole("button", { name: "Back to study", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  expect(await progress(page)).toBe(1);
});

// The drawing's viewBox is fixed and always shown whole, so these bounds,
// in its units, hold at every window width.
test("the star's winding string stays inside its animation view", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await ready(page);
  await choosePreset(page, {
    label: "A string wound back onto a four-pointed star",
  });
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  for (const time of ["0", "0.15", "0.3", "0.5", "0.7", "0.85", "1"]) {
    await page.getByRole("slider", { name: "Animation progress" }).fill(time);
    await expect(page.locator("#artwork")).toHaveAttribute(
      "data-animation-time",
      time,
    );
    const bounds = await page
      .getByTestId("derived-curve")
      .evaluate((path: SVGGraphicsElement) => {
        const b = path.getBBox();
        return {
          x: b.x,
          y: b.y,
          right: b.x + b.width,
          bottom: b.y + b.height,
        };
      });
    expect(bounds.x, time).toBeGreaterThan(40);
    expect(bounds.y, time).toBeGreaterThan(30);
    expect(bounds.right, time).toBeLessThan(960);
    expect(bounds.bottom, time).toBeLessThan(730);
  }
});

test("a new phrase honors the chosen construction subsets when revealing its guides", async () => {
  const { compilePhrase, defaultPhrase, phraseAt } =
    await import("../web/phrase");
  const { defaultLayers } = await import("../web/planar-link");
  const config = presets.find(
    (p) => p.config.curve.format === "fourier",
  )!.config;
  const layers = {
    ...defaultLayers,
    definitionGuides: false,
    rollingGuides: true,
  };
  const draft = defaultPhrase(config, 0.8, "term1Radius", layers);
  const keys = draft.phases.flatMap((p) =>
    p.key === undefined ? [] : [Number(p.key)],
  );
  const phrase = compilePhrase(config, layers, 0.8, draft, keys);
  expect(phraseAt(phrase, 0).layers).toMatchObject({
    definitionGuides: false,
    rollingGuides: false,
  });
  expect(phraseAt(phrase, 1).layers).toMatchObject({
    definitionGuides: false,
    rollingGuides: true,
  });
});

test("phrase layers preserve legacy combined construction events and allow independent subsets", async () => {
  const { compilePhrase, phraseAt } = await import("../web/phrase");
  const { defaultLayers } = await import("../web/planar-link");
  const config = presets.find(
    (p) => p.config.curve.format === "fourier",
  )!.config;
  const phrase = compilePhrase(
    config,
    defaultLayers,
    0.8,
    {
      target: "term1Radius",
      opening: { base: 1, construction: 1, derived: 1 },
      phases: [
        {
          name: "Old hide",
          duration: 1,
          pace: "steady",
          layers: { lines: false },
        },
        {
          name: "Old show",
          duration: 1,
          pace: "steady",
          layers: { lines: true },
        },
        {
          name: "Only rolling",
          duration: 1,
          pace: "steady",
          layers: {
            lines: false,
            definitionGuides: false,
            rollingGuides: true,
          },
        },
      ],
    },
    [],
  );
  expect(phraseAt(phrase, 0).layers).toMatchObject({
    lines: false,
    definitionGuides: false,
    rollingGuides: false,
  });
  expect(phraseAt(phrase, 1).layers).toMatchObject({
    lines: true,
    definitionGuides: true,
    rollingGuides: true,
  });
  expect(phraseAt(phrase, 2).layers).toMatchObject({
    lines: false,
    definitionGuides: false,
    rollingGuides: true,
  });
});

test("phrase boundaries carry explicit inputs and right-continuous layers independently of seek history", async () => {
  const { compilePhrase, phraseAt, phraseTargets, revealPhrase } =
    await import("../web/phrase");
  const config = structuredClone(presets[2].config);
  const layers = {
    base: true,
    derived: false,
    lines: false,
    incident: false,
    virtual: true,
    axes: false,
  };
  const draft = {
    target: "sourceX",
    opening: { base: 1, construction: 0, derived: 0 },
    phases: [
      { name: "Establish", duration: 1, pace: "steady" },
      {
        name: "Rays",
        duration: 2,
        pace: "steady",
        layers: { lines: true },
        reveal: { construction: 1 },
      },
      {
        name: "Caustic",
        duration: 1,
        pace: "steady",
        layers: { derived: true },
        reveal: { derived: 1 },
      },
      { name: "Move", duration: 4, pace: "steady", key: "0.5" },
      { name: "Hold", duration: 2, pace: "ease" },
      { name: "Return", duration: 2, pace: "ease", key: "1" },
    ],
  };
  const phrase = compilePhrase(config, layers, 0.8, draft, [0.5, 1]);
  expect(phrase.duration).toBe(12);
  const at = (seconds: number) => phraseAt(phrase, seconds);
  expect(at(1 - 1e-8).layers.lines).toBe(false);
  expect(at(1).layers.lines).toBe(true);
  expect(at(1).reveal.construction).toBe(0);
  expect(at(2).reveal).toEqual({ base: 1, construction: 0.5, derived: 0 });
  expect(at(3).layers.derived).toBe(true);
  expect(at(3.5).reveal.derived).toBe(0.5);
  expect(at(6).config.source.position.x).toBe(0.75);
  expect(at(8).config.source.position.x).toBe(0.5);
  expect(at(9.75).config.source.position.x).toBe(0.5);
  expect(at(10).config.source.position.x).toBe(0.5);
  expect(at(11).config.source.position.x).toBeCloseTo(0.75, 14);
  expect(at(12).config.source.position.x).toBe(1);
  expect(at(3).config.source.position.x).toBe(1);
  expect(config).toEqual(presets[2].config);
  expect(phraseTargets(config)).toContain("sourceX");
  expect(phraseTargets(config)).not.toContain("samples");
  expect(phraseTargets(config)).not.toContain("a"); // not consumed by this circle
  const result = {
    base: [{ x: 0, y: 0 }, null, { x: 2, y: 0 }],
    derived: [null, { x: 1, y: 1 }, null],
    virtual: [false, true, false],
    rays: [{ sampleIndex: 2 }],
    family: [],
    circles: [],
    rolling: [],
    warnings: [],
    invalid: 1,
  };
  const revealed = revealPhrase(result, {
    base: 1,
    construction: 0,
    derived: 0.5,
  });
  expect(revealed.base).toEqual(result.base);
  expect(revealed.rays).toEqual([]);
  expect(
    revealPhrase(result, { base: 1, construction: 0.5, derived: 1 }).rays,
  ).toEqual([]);
  expect(revealed.derived).toEqual([null, { x: 1, y: 1 }]);
  expect(revealed.virtual).toEqual([false, true]);
  expect(
    revealPhrase(result, { base: 0, construction: 0, derived: 0 }).base,
  ).toEqual([]);
  expect(
    revealPhrase(result, { base: 1, construction: 1, derived: 1 }),
  ).toEqual(result);
});

test("phrase compilation rejects invalid drafts and bounds phase storage", async () => {
  const { compilePhrase } = await import("../web/phrase");
  const config = structuredClone(presets[2].config);
  const layers = {
    base: true,
    derived: true,
    lines: true,
    incident: true,
    virtual: true,
    axes: false,
  };
  const draft = {
    target: "sourceX",
    opening: { base: 1, construction: 1, derived: 1 },
    phases: [{ name: "Hold", duration: 1, pace: "ease" }],
  };
  const compile = (patch: object, keys: number[] = []) =>
    compilePhrase(config, layers, 0.8, { ...draft, ...patch }, keys);
  for (const duration of [NaN, Infinity, 0, -1, 0.09, 3601])
    expect(() =>
      compile({ phases: [{ ...draft.phases[0], duration }] }),
    ).toThrow(/duration/i);
  expect(() => compile({ phases: [] })).toThrow(/phase/i);
  expect(() => compile({ phases: Array(13).fill(draft.phases[0]) })).toThrow(
    /12/,
  );
  expect(() => compile({ target: "lines" })).toThrow(/target|parameter/i);
  expect(() => compile({ target: "a" })).toThrow(/target|parameter/i);
  expect(() =>
    compile({ phases: [{ ...draft.phases[0], key: "NaN" }] }, [NaN]),
  ).toThrow(/key/i);
  expect(() =>
    compile({ phases: [{ ...draft.phases[0], reveal: { derived: 1.1 } }] }),
  ).toThrow(/reveal/i);
});

test("phrase editor uses Go keys, independent reveal layers and a fixed current camera; invalid edits block replay", async ({
  page,
}) => {
  await ready(page, "2");
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("phrase");
  await expect(
    page.getByRole("combobox", { name: "Phrase parameter", exact: true }),
  ).toHaveValue("sourceX");
  await page
    .getByRole("combobox", { name: "Animation camera" })
    .selectOption("current");
  await page.locator("#artwork").hover();
  await page.mouse.wheel(0, -250);
  const manual = await page
    .locator("#artwork")
    .getAttribute("data-camera-scale");
  const original = (await definition(page)).source.position.x;
  await page.getByRole("textbox", { name: "Phase 4 key" }).fill("pi/4");
  await page.getByRole("spinbutton", { name: "Phase 1 duration" }).fill("0");
  await expect(
    page.getByRole("button", { name: "Play animation", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText(/Phase 1 duration/);
  await page.getByRole("spinbutton", { name: "Phase 1 duration" }).fill("1");
  await expect(
    page.getByRole("button", { name: "Play animation", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", {
    name: "Animation progress",
    exact: true,
  });
  for (const time of ["0.5", "0.8", "0.5", "1", "0"]) {
    await slider.fill(time);
    await expect(page.locator("#artwork")).toHaveAttribute(
      "data-animation-time",
      time,
    );
    await expect(page.locator("#artwork")).toHaveAttribute(
      "data-camera-scale",
      manual!,
    );
  }
  const start = await definition(page);
  expect(start.source.position.x).toBe(original);
  expect(start.animation.phrase.layers.lines).toBe(false);
  expect(start.animation.phrase.reveal.construction).toBe(0);
  // Editing a paused phrase restores the immutable study immediately.
  await page.getByRole("textbox", { name: "Phase 4 key" }).fill("t");
  await expect(page.locator("#artwork")).not.toHaveAttribute(
    "data-animation-progress",
  );
  await expect(
    page.getByRole("button", { name: "Play animation", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: /^Export (animated WebP|MP4 video)/ }),
  ).toBeDisabled();
  await expect(page.getByRole("textbox", { name: "Phase 4 key" })).toHaveValue(
    "t",
  );
  await expect(page.getByRole("alert")).toContainText(/Phase 4 key/);
  await page.getByRole("textbox", { name: "Phase 4 key" }).fill("pi/4");
  await expect(
    page.getByRole("button", { name: "Play animation", exact: true }),
  ).toBeEnabled();
});

test("phrase holds preserve nonbinary keys exactly and the shared sampler reuses fixed geometry", async () => {
  const { compilePhrase, phraseAt, createPhraseSampler } =
    await import("../web/phrase");
  const config = structuredClone(presets[2].config);
  const layers = {
    base: true,
    derived: true,
    lines: true,
    incident: true,
    virtual: true,
    axes: false,
  };
  const phrase = compilePhrase(
    config,
    layers,
    0.8,
    {
      target: "sourceX",
      opening: { base: 1, construction: 1, derived: 1 },
      phases: [
        { name: "Move", duration: 1, pace: "steady", key: "0.3" },
        { name: "Hold", duration: 10, pace: "steady" },
      ],
    },
    [0.3],
  );
  for (let i = 0; i <= 100; i++)
    expect(phraseAt(phrase, 1 + i / 10).value).toBe(0.3);
  let calls = 0;
  const original = {
    config,
    result: {
      base: [{ x: 0, y: 0 }, null, { x: 1, y: 0 }],
      derived: [null, { x: 0.3, y: 0 }, null],
      virtual: [false, false, false],
      rays: [],
      family: [],
      circles: [],
      rolling: [],
      warnings: [],
      invalid: 1,
    },
  };
  const engine = {
    compute: async (c: any) => {
      calls++;
      return { ...original, config: c };
    },
  };
  const sample = createPhraseSampler({
    phrase,
    original,
    view: { cx: 0, cy: 0, scale: 100, span: 2 },
    stop: true,
  });
  const held = await sample(1, engine);
  expect(held.frame.config.source.position.x).toBe(0.3);
  for (const t of [1.1, 3, 8, 11, 2]) {
    expect((await sample(t, engine)).frame.result).toEqual(held.frame.result);
  }
  expect(calls).toBe(1);
  await sample(0.5, engine);
  expect(calls).toBe(2);
  expect((await sample(0, engine)).frame.config.source.position.x).toBe(1);
  expect(calls).toBe(2); // original entry geometry
  expect((await sample(11, engine)).phrase.layers).toEqual(layers);
  expect(calls).toBe(3); // bounded last-value cache, no history-sized frame collection
});

test("phrase camera keys share phase boundaries with inputs and reveal, about one reference fit", async () => {
  const { compilePhrase, phraseAt, phraseError, phraseViewError } =
    await import("../web/phrase");
  const config = structuredClone(presets[2].config);
  const layers = {
    base: true,
    derived: true,
    lines: true,
    incident: true,
    virtual: true,
    axes: false,
  };
  const fit = { cx: 0.25, cy: -0.5, scale: 90, span: 9 };
  // A manually panned and zoomed entry view, as Hold current view captures it.
  const entry = { cx: -0.4, cy: 0.3, scale: 135, span: 6 };
  const draft = {
    target: "sourceX" as const,
    opening: { base: 1, construction: 1, derived: 1 },
    phases: [
      { name: "Establish", duration: 1, pace: "steady" as const },
      {
        name: "Approach",
        duration: 2,
        pace: "steady" as const,
        key: "0.5",
        view: { x: 0.5, y: 0.1, zoom: 6 },
      },
      { name: "Hold", duration: 1.5, pace: "ease" as const },
      {
        name: "Return",
        duration: 2.5,
        pace: "ease" as const,
        key: "1",
        view: "entry" as const,
      },
    ],
  };
  const phrase = compilePhrase(config, layers, 0.8, draft, [0.5, 1], {
    fit,
    entry,
  });
  const at = (s: number) => phraseAt(phrase, s);
  // The opening, a hold and the exact end are their stored views, unrefitted.
  for (const s of [0, 0.5, 1 - 1e-9, 1]) expect(at(s).view).toEqual(entry);
  expect(at(7).view).toEqual(entry);
  const detail = { cx: 0.5, cy: 0.1, scale: 90 * 6, span: 9 / 6 };
  for (const s of [3, 3.4, 4.5 - 1e-9]) expect(at(s).view).toEqual(detail);
  // Halfway through the steady approach: log zoom halfway between 1.5 and
  // 6 (3), and the framed point at σ = (1/z − 1/z₀)/(1/z₁ − 1/z₀) = 2/3, at
  // the moment the source is halfway to 0.5.
  const mid = at(2);
  expect(mid.value).toBe(0.75);
  expect(mid.view!.scale).toBeCloseTo(270, 9);
  expect(mid.view!.cx).toBeCloseTo(-0.4 + 0.9 * (2 / 3), 12);
  expect(mid.view!.cy).toBeCloseTo(0.3 - 0.2 * (2 / 3), 12);
  expect(mid.view!.span * mid.view!.scale).toBeCloseTo(9 * 90, 9);
  // The eased return at u = 1/2 has h = 1/2: zoom 3 again, σ = 1/3 of the
  // way back toward the entry view.
  const back = at(4.5 + 1.25);
  expect(back.value).toBeCloseTo(0.75, 14);
  expect(back.view!.scale).toBeCloseTo(270, 9);
  expect(back.view!.cx).toBeCloseTo(0.5 - 0.9 / 3, 12);
  // Seek history never contributes: a fresh compilation agrees bit for bit.
  const again = compilePhrase(config, layers, 0.8, draft, [0.5, 1], {
    fit,
    entry,
  });
  for (const s of [7, 5.1, 0, 2, 4.5, 1, 3.99])
    expect(phraseAt(again, s)).toEqual(at(s));
  // The return is the entry view itself, not one recomputed from a key:
  // 90 × (100.7/90) is not 100.7 in binary.
  const manual = { cx: -0.4, cy: 0.3, scale: 100.7, span: 810 / 100.7 };
  const returned = compilePhrase(config, layers, 0.8, draft, [0.5, 1], {
    fit,
    entry: manual,
  });
  for (const s of [0, 7]) expect(phraseAt(returned, s).view).toEqual(manual);
  // A phrase without views keeps its fixed camera and records none.
  const fixed = compilePhrase(
    config,
    layers,
    0.8,
    {
      ...draft,
      phases: draft.phases.map(({ view: _, ...p }: any) => p),
    },
    [0.5, 1],
    { fit, entry },
  );
  expect(phraseAt(fixed, 2).view).toBeUndefined();
  // Malformed views are refused by name; zoom limits follow the drawing.
  const bad = (view: unknown) =>
    phraseError(config, {
      ...draft,
      phases: [draft.phases[0], { ...draft.phases[1], view } as any],
    });
  for (const view of [
    { x: NaN, y: 0, zoom: 1 },
    { x: 0, y: 0, zoom: 0.05 },
    { x: 0, y: 0, zoom: 1001 },
    "exit",
  ])
    expect(bad(view)).toMatch(/^Phase 2 view/);
  expect(bad({ x: 0, y: 0, zoom: 30 })).toBeNull();
  const deep = {
    ...draft,
    phases: [
      draft.phases[0],
      { ...draft.phases[1], view: { x: 0, y: 0, zoom: 30 } },
    ],
  };
  expect(phraseViewError(deep, 20)).toMatch(/^Phase 2 view zooms past 20×/);
  expect(phraseViewError(deep, 1000)).toBeNull();
});

test("a flown phrase refines each zoomed frame to its own view, keyed by value and view", async () => {
  const { compilePhrase, phraseAt, createPhraseSampler } =
    await import("../web/phrase");
  const config = structuredClone(presets[2].config);
  const layers = {
    base: true,
    derived: true,
    lines: true,
    incident: true,
    virtual: true,
    axes: false,
  };
  const fit = { cx: 0, cy: 0, scale: 100, span: 4 };
  const phrase = compilePhrase(
    config,
    layers,
    0.8,
    {
      target: "sourceX",
      opening: { base: 1, construction: 1, derived: 1 },
      phases: [
        // Simultaneous: the source moves while the camera zooms in.
        {
          name: "Approach",
          duration: 2,
          pace: "steady",
          key: "0.5",
          view: { x: 0.4, y: 0.2, zoom: 8 },
        },
        // Camera only: the source holds while the camera zooms further.
        {
          name: "Closer",
          duration: 2,
          pace: "steady",
          view: { x: 0.4, y: 0.2, zoom: 64 },
        },
        { name: "Hold", duration: 2, pace: "steady" },
        {
          name: "Return",
          duration: 2,
          pace: "steady",
          key: "1",
          view: "entry",
        },
      ],
    },
    [0.5, 1],
    { fit, entry: fit },
  );
  const requests: { x: number; view?: any }[] = [];
  const original = {
    config,
    result: {
      base: [{ x: 0, y: 0 }],
      derived: [{ x: 0, y: 0 }],
      virtual: [false],
      rays: [],
      family: [],
      circles: [],
      rolling: [],
      warnings: [],
      invalid: 0,
    },
  };
  const plain = { ...original, result: { ...original.result, invalid: 0 } };
  const engine = {
    compute: async (c: any, _?: unknown, options?: any) => {
      requests.push({ x: c.source.position.x, view: options?.view });
      return { ...original, config: c, view: options?.view };
    },
  };
  const rect = (v: { cx: number; cy: number; scale: number }) => ({
    x0: v.cx - 5 / v.scale,
    y0: v.cy - 4 / v.scale,
    x1: v.cx + 5 / v.scale,
    y1: v.cy + 4 / v.scale,
  });
  const sample = createPhraseSampler({
    phrase,
    original,
    view: fit,
    stop: true,
    refine: true,
    plain,
    rect,
  });
  // At the fitted zoom the entry value draws the study refined to no view.
  const first = await sample(0, engine);
  expect(first.frame.result).toBe(plain.result);
  expect(first.heldView).toEqual(fit);
  expect(requests).toHaveLength(0);
  // A simultaneous frame is computed at its value, refined to its own view.
  const one = await sample(1, engine);
  const view = phraseAt(phrase, 1).view!;
  expect(one.heldView).toEqual(view);
  expect(requests.at(-1)!.x).toBe(0.75);
  expect(requests.at(-1)!.view).toEqual(rect(view));
  await sample(1, engine);
  expect(requests).toHaveLength(1);
  await sample(1.5, engine);
  expect(requests).toHaveLength(2);
  // Camera-only frames share a planar flight piece: each frame's own view
  // lies inside the refined area, and frames within one piece reuse it.
  const before = requests.length;
  for (const s of [2.5, 2.5001, 2.5002]) {
    const frame = await sample(s, engine);
    const r = requests.at(-1)!.view;
    expect(requests.at(-1)!.x).toBe(0.5);
    const own = rect(frame.heldView!);
    expect(r.x0).toBeLessThanOrEqual(own.x0);
    expect(r.x1).toBeGreaterThanOrEqual(own.x1);
    expect(r.radius).toBeLessThanOrEqual(
      Math.hypot(own.x1 - own.x0, own.y1 - own.y0) / 2 + 1e-12,
    );
  }
  expect(requests.length - before).toBe(1);
  // The same value at a view eight times closer is not drawn from that
  // refinement.
  await sample(3.9, engine);
  expect(requests.length - before).toBe(2);
  // A held frame performs no further work.
  await sample(4.5, engine);
  const held = requests.length;
  for (const s of [4.6, 5, 5.9]) await sample(s, engine);
  expect(requests).toHaveLength(held);
  // The exact end is the entry view and value: the unrefined study again.
  const end = await sample(8, engine);
  expect(end.heldView).toEqual(fit);
  expect(end.frame.result).toBe(plain.result);
});

for (const width of [1440, 390])
  for (const theme of ["light", "dark"] as const)
    test(`authored phrase opens statically, reveals reflected cusps and holds at ${width} in ${theme}`, async ({
      page,
    }, info) => {
      const preset = presets.find(
        (p) => p.title === "A circle's caustic, opened",
      );
      expect(preset).toBeDefined();
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: theme });
      await ready(page, String(presets.indexOf(preset!)));
      await expect(
        page.getByRole("combobox", { name: "Animate", exact: true }),
      ).toHaveValue("phrase");
      const original = await definition(page);
      const paths = await page
        .locator("#artwork path")
        .evaluateAll((paths) => paths.map((p) => p.getAttribute("d")));
      expect(original.source.position.x).toBe(1);
      expect(original.animation).toBeUndefined();
      await page
        .getByRole("button", { name: "Play animation", exact: true })
        .click();
      await page.getByRole("button", { name: "Pause", exact: true }).click();
      const slider = page.getByRole("slider", {
        name: "Animation progress",
        exact: true,
      });
      for (const time of [
        "0",
        "0.15",
        "0.25",
        "0.5",
        "0.72",
        "0.79",
        "1",
        "0.75",
      ]) {
        await slider.fill(time);
        await expect(page.locator("#artwork")).toHaveAttribute(
          "data-animation-time",
          time,
        );
        const metadata = await definition(page);
        if (time === "0") {
          expect(
            await page
              .locator("#artwork path")
              .evaluateAll((paths) => paths.map((p) => p.getAttribute("d"))),
          ).toEqual(paths);
          expect(metadata.animation.phrase.layers.derived).toBe(false);
        }
        if (time === "0.5") expect(metadata.source.position.x).toBe(0.85);
        if (time === "0.72" || time === "0.79" || time === "0.75") {
          expect(metadata.source.position.x).toBe(0.65);
          expect(metadata.animation.phrase.phase).toBe("Hold the cusps");
          expect(metadata.animation.phrase.reveal).toEqual({
            base: 1,
            construction: 1,
            derived: 1,
          });
        }
      }
      await page.locator("#artwork").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: info.outputPath(`phrase-hold-${width}-${theme}.png`),
      });
      await expect(page.locator("#artwork text")).toHaveCount(0);
      expect(
        await page
          .locator("body")
          .evaluate((e) => e.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.getByRole("button", { name: "Stop", exact: true }).click();
      expect(await definition(page)).toEqual(original);
    });

test("changing a phrase target resets offered keys to the edited study and duration readouts use the phase total", async ({
  page,
}) => {
  await ready(page, "2");
  await page
    .getByRole("textbox", { name: "Source y", exact: true })
    .fill("-.3");
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("phrase");
  await page
    .getByRole("combobox", { name: "Phrase parameter", exact: true })
    .selectOption("sourceY");
  for (const phase of [4, 5, 7])
    await expect(
      page.getByRole("textbox", { name: `Phase ${phase} key`, exact: true }),
    ).toHaveValue("-0.3");
  await page
    .getByRole("spinbutton", { name: "Phase 1 duration", exact: true })
    .fill("2");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect(page.locator("#playback")).toContainText("/ 17 s");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
});

// These durations accumulate to 17.299999999999997 in binary.
test("the phrase playback readout states its phase total without an arithmetic tail", async ({
  page,
}) => {
  await ready(page, "2");
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("phrase");
  for (const [i, seconds] of [
    "0.1",
    "6.1",
    "0.1",
    "3",
    "3",
    "2",
    "3",
  ].entries())
    await page
      .getByRole("spinbutton", { name: `Phase ${i + 1} duration`, exact: true })
      .fill(seconds);
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect(page.locator("#playback")).toContainText(/ \/ 17\.3 s/);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
});

// As tracing falls back without light, a phrase falls back when an edit
// leaves the study nothing a phrase can vary.
test("a phrase falls back to drawing when the edited study offers no phrase target", async ({
  page,
}) => {
  await ready(page, "2");
  const mode = page.getByRole("combobox", { name: "Animate", exact: true });
  await mode.selectOption("phrase");
  await page
    .getByRole("combobox", { name: "Definition", exact: true })
    .selectOption("attractor");
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(mode.locator("option[value=phrase]")).toHaveCount(0);
  await expect(mode).toHaveValue("reveal");
  await expect(
    page.getByRole("combobox", { name: "Phrase parameter", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Play animation", exact: true }),
  ).toBeEnabled();
});

test("same-study phrase link replacement cancels preparation and discards stale keys and frames", async ({
  page,
}) => {
  await watchEngines(page, 2, { compute: 180, scalars: 100 });
  await ready(page, "2");
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("phrase");
  await page
    .getByRole("textbox", { name: "Phase 4 key", exact: true })
    .fill("0.6");
  await page
    .getByRole("textbox", { name: "Phase 4 key", exact: true })
    .fill("t");
  await expect(
    page.getByRole("button", { name: "Play animation", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("Phase 4 key");
  await page
    .getByRole("textbox", { name: "Phase 4 key", exact: true })
    .fill("0.6");
  await expect(
    page.getByRole("button", { name: "Play animation", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Preparing…", exact: true }),
  ).toBeVisible();
  const { defaultPhrase } = await import("../web/phrase");
  const study = planarPreset(2);
  study.animation = {
    ...study.animation,
    mode: "phrase",
    phrase: defaultPhrase(study.config, study.length),
  };
  study.animation.phrase.phases[3].key = "0.9";
  const token = deflateRawSync(
    Buffer.from(JSON.stringify({ v: 1, notebook: "2d", study })),
  ).toString("base64url");
  await page.goto(`/#s=${token}`);
  await expect(page).not.toHaveURL(/#s=/);
  await expect(
    page.getByRole("textbox", { name: "Phase 4 key", exact: true }),
  ).toHaveValue("0.9");
  await expect(
    page.getByRole("button", { name: "Play animation", exact: true }),
  ).toBeEnabled();
  await expect(page.locator("#artwork")).not.toHaveAttribute(
    "data-animation-progress",
  );
  expect((await definition(page)).source.position.x).toBe(1);
  // Let every delayed obsolete request return before judging cancellation.
  await page.waitForTimeout(600);
  await expect(page.locator("#artwork")).not.toHaveAttribute(
    "data-animation-progress",
  );
  expect((await definition(page)).source.position.x).toBe(1);
});

test("editing a study layer during a paused phrase restores the study and invalidates its frozen presentation", async ({
  page,
}) => {
  await ready(page, "2");
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("phrase");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page
    .getByRole("slider", { name: "Animation progress", exact: true })
    .fill("0.7");
  await expect(page.locator("#artwork")).toHaveAttribute(
    "data-animation-time",
    "0.7",
  );
  await page
    .getByRole("checkbox", { name: "Base curve", exact: true })
    .uncheck();
  await expect(page.locator("#artwork")).not.toHaveAttribute(
    "data-animation-progress",
  );
  expect((await definition(page)).source.position.x).toBe(1);
});

test("phrase draft errors belong under their duration or scalar key control", async ({
  page,
}) => {
  await ready(page, "2");
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("phrase");
  const duration = page.getByRole("spinbutton", {
    name: "Phase 2 duration",
    exact: true,
  });
  await duration.fill("0");
  await expect(duration).toHaveAttribute("aria-invalid", "true");
  await expect(duration.locator("..").getByRole("alert")).toContainText(
    "Phase 2 duration",
  );
  await duration.fill("2");
  const key = page.getByRole("textbox", { name: "Phase 4 key", exact: true });
  await key.fill("x");
  await expect(key).toHaveAttribute("aria-invalid", "true");
  await expect(key.locator("..").getByRole("alert")).toContainText(
    "Phase 4 key",
  );
});

test("fresh absolute samples and backward UI seeks agree around every unequal phase boundary through Go and Plot", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  const index = presets.findIndex(
    (p) => p.title === "A circle's caustic, opened",
  );
  await ready(page, String(index));
  const study = planarPreset(index);
  const durations = [1, 3, 2, 4, 4, 2, 4];
  for (const [i, duration] of durations.entries())
    await page
      .getByRole("spinbutton", { name: `Phase ${i + 1} duration`, exact: true })
      .fill(String(duration));
  await page
    .getByRole("combobox", { name: "Pace", exact: true })
    .selectOption("steady");
  const worker = page.workers().find((w) => w.url().includes("engine.worker"))!;
  const engine = {
    compute: async (config: any) => {
      const result = await worker.evaluate(
        (config) =>
          JSON.parse(
            (globalThis as any).tangentGardenCompute(JSON.stringify(config)),
          ),
        config,
      );
      expect(result.error).toBeUndefined();
      return { config, result };
    },
  };
  const original = await engine.compute(study.config);
  expect(original.result.derived.filter(Boolean).length).toBeGreaterThan(1500);
  const { compilePhrase, createPhraseSampler } = await import("../web/phrase");
  const draft = structuredClone(study.animation.phrase!);
  draft.phases.forEach((phase, i) => {
    phase.duration = durations[i];
    phase.pace = "steady";
  });
  const compiled = compilePhrase(
    study.config,
    study.layers,
    study.length,
    draft,
    [0.95, 0.85, 0.65, 0.95],
    // The reference fit and entry view the panel takes for Hold entry view.
    {
      fit: fitFrame(original.result, original.config),
      entry: fitFrame(original.result, original.config),
    },
  );
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const boundaries = [0, 0.05, 0.2, 0.3, 0.5, 0.7, 0.8, 1];
  const times = [
    ...new Set(
      boundaries
        .flatMap((t) => [Math.max(0, t - 0.001), t, Math.min(1, t + 0.001)])
        .map((t) => Number(t.toFixed(3))),
    ),
  ].reverse();
  for (const time of times) {
    const seconds = time * 20;
    await page
      .getByRole("slider", { name: "Animation progress", exact: true })
      .fill(String(time));
    await expect(page.locator("#artwork")).toHaveAttribute(
      "data-animation-time",
      String(time),
    );
    const definition = await definitionAt();
    // Independent input and layer/reveal expectations, rather than comparing
    // two calls to the same sampler to establish correctness.
    const value =
      seconds < 1
        ? 1
        : seconds < 4
          ? 1 - ((seconds - 1) * 0.05) / 3
          : seconds < 6
            ? 0.95
            : seconds < 10
              ? 0.95 - ((seconds - 6) * 0.1) / 4
              : seconds < 14
                ? 0.85 - ((seconds - 10) * 0.2) / 4
                : seconds < 16
                  ? 0.65
                  : 0.65 + ((seconds - 16) * 0.3) / 4;
    expect(definition.source.position.x).toBeCloseTo(value, 13);
    expect(definition.animation.phrase.layers.lines).toBe(seconds >= 1);
    expect(definition.animation.phrase.layers.derived).toBe(seconds >= 4);
    expect(definition.animation.phrase.reveal.construction).toBeCloseTo(
      Math.max(0, Math.min(1, (seconds - 1) / 3)),
      13,
    );
    expect(definition.animation.phrase.reveal.derived).toBeCloseTo(
      Math.max(0, Math.min(1, (seconds - 4) / 2)),
      13,
    );
    const fresh = createPhraseSampler({
      phrase: compiled,
      original,
      view: fitFrame(original.result, original.config),
      stop: true,
    });
    const view = await fresh(seconds, engine);
    const svg = renderToStaticMarkup(
      createElement(Plot, {
        result: view.frame.result,
        config: view.frame.config,
        layers: study.layers,
        dark: false,
        length: view.length,
        stop: true,
        animation: view,
        reset: 0,
      }),
    );
    const comparison = await page.evaluate((svg) => {
      const direct = new DOMParser().parseFromString(svg, "image/svg+xml");
      const geometry = (root: ParentNode) =>
        Array.from(root.querySelectorAll("path,line,circle"), (e) => [
          e.tagName,
          ...[
            "d",
            "x1",
            "y1",
            "x2",
            "y2",
            "cx",
            "cy",
            "r",
            "stroke",
            "fill",
            "stroke-dasharray",
          ].map((a) => e.getAttribute(a)),
        ]);
      return {
        direct: geometry(direct),
        live: geometry(document.querySelector("#artwork")!),
      };
    }, svg);
    // The flown camera interpolates with exp, log and expm1, which Node and
    // Chromium may round an ulp apart: numbers agree within 1e-9 page
    // units, while elements, commands and every other attribute stay exact.
    const number = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;
    const shape = (rows: (string | null)[][]) =>
      rows.map((row) => row.map((v) => v?.replace(number, "#") ?? null));
    const numbers = (rows: (string | null)[][]) =>
      rows.flatMap((row) => row.flatMap((v) => v?.match(number) ?? []));
    expect(shape(comparison.live), `geometry at ${seconds} s`).toEqual(
      shape(comparison.direct),
    );
    const live = numbers(comparison.live),
      direct = numbers(comparison.direct);
    expect(live.length).toBe(direct.length);
    const gap = Math.max(
      0,
      ...live.map((v, i) => Math.abs(Number(v) - Number(direct[i]))),
    );
    expect(gap, `geometry at ${seconds} s`).toBeLessThan(1e-9);
  }
  function definitionAt() {
    return page
      .locator("#artwork desc")
      .textContent()
      .then((text) => JSON.parse(text!));
  }
});

for (const expensive of [false, true])
  test(`phrase ${expensive ? "dense refined cup" : "signature circle"} measures moving/held worker cost and cancellation without a frame backlog`, async ({
    page,
  }, info) => {
    test.setTimeout(120000);
    await page.addInitScript(() => {
      const records: any[] = [];
      (window as any).phraseCosts = records;
      (window as any).phraseRequests = 0;
      (window as any).phraseMaximumPending = 0;
      const Base = window.Worker;
      window.Worker = class extends Base {
        pending = new Map<number, { start: number; samples: number }>();
        constructor(...args: ConstructorParameters<typeof Worker>) {
          super(...args);
          this.addEventListener("message", (e) => {
            const sent = this.pending.get(e.data.id);
            if (sent) {
              this.pending.delete(e.data.id);
              records.push({
                milliseconds: performance.now() - sent.start,
                samples: sent.samples,
              });
            }
          });
        }
        postMessage(message: any, ...rest: any[]) {
          if (message.action === "compute") {
            (window as any).phraseRequests++;
            this.pending.set(message.id, {
              start: performance.now(),
              samples: message.config.samples,
            });
            (window as any).phraseMaximumPending = Math.max(
              (window as any).phraseMaximumPending,
              this.pending.size,
            );
          }
          (super.postMessage as any)(message, ...rest);
        }
      };
    });
    await page.goto("/");
    await choosePreset(page, {
      label: expensive
        ? "Sunlight in a hammered cup"
        : "A circle's caustic, opened",
    });
    await expect(page.locator(".plot-wrap")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await openAnimation(page);
    if (expensive) {
      await page
        .getByRole("spinbutton", { name: "Numerical samples", exact: true })
        .fill("32768");
      await page
        .getByRole("spinbutton", { name: "Construction lines", exact: true })
        .fill("2048");
      await expect(page.locator(".plot-wrap")).toHaveAttribute(
        "aria-busy",
        "false",
      );
      await page
        .getByRole("combobox", { name: "Animate", exact: true })
        .selectOption("phrase");
      for (const [i, key] of [
        [4, "90"],
        [5, "180"],
        [7, "0"],
      ] as const)
        await page
          .getByRole("textbox", { name: `Phase ${i} key`, exact: true })
          .fill(key);
    }
    // Stop is pressed as soon as the hold appears, so a long dense hold costs
    // nothing; it must outlast that detection, up to two dense calculations
    // on a slow runner, or playback completes first.
    const durations = expensive
      ? [0.2, 0.3, 0.3, 1, 1, 12, 0.5]
      : [0.1, 0.2, 0.2, 0.5, 0.5, 0.7, 0.5];
    for (const [i, duration] of durations.entries())
      await page
        .getByRole("spinbutton", {
          name: `Phase ${i + 1} duration`,
          exact: true,
        })
        .fill(String(duration));
    const began = Date.now();
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await expect(page.locator("#artwork")).toHaveAttribute(
      "data-animation-time",
    );
    const firstFrameMilliseconds = Date.now() - began;
    const costs = () =>
      page.evaluate(() => structuredClone((window as any).phraseCosts));
    const requests = () =>
      page.evaluate(() => (window as any).phraseRequests as number);
    const afterPreparation = await requests();
    const expectedHold = expensive ? "Hold the detail" : "Hold the cusps";
    await expect
      .poll(async () => (await definition(page)).animation?.phrase?.phase, {
        intervals: [50],
      })
      .toBe(expectedHold);
    const fixed = await requests();
    const holdGeometry = await page
      .locator("#artwork")
      .evaluate((svg) =>
        Array.from(svg.querySelectorAll("path"), (p) => p.getAttribute("d")),
      );
    await page.waitForTimeout(180); // stay inside this authored stationary hold
    expect(await requests()).toBe(fixed);
    expect(
      await page
        .locator("#artwork")
        .evaluate((svg) =>
          Array.from(svg.querySelectorAll("path"), (p) => p.getAttribute("d")),
        ),
    ).toEqual(holdGeometry);
    expect(fixed).toBeGreaterThan(afterPreparation); // observed actual moving calculations
    const canceled = Date.now();
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(page.locator("#artwork")).not.toHaveAttribute(
      "data-animation-progress",
    );
    const cancellationMilliseconds = Date.now() - canceled;
    const records = await costs();
    expect(
      await page.evaluate(() => (window as any).phraseMaximumPending),
    ).toBeLessThanOrEqual(1);
    await info.attach("phrase-worker-observations", {
      body: JSON.stringify(
        {
          study: expensive
            ? "Sunlight in a hammered cup"
            : "A circle's caustic, opened",
          samples: expensive ? 32768 : 1600,
          lines: expensive ? 2048 : 32,
          adaptive: expensive,
          firstFrameMilliseconds,
          cancellationMilliseconds,
          preparationComputations: afterPreparation,
          throughHoldComputations: fixed,
          holdAdditionalComputations: 0,
          workerMilliseconds: records.map((r: any) => r.milliseconds),
          browser: await page.evaluate(() => navigator.userAgent),
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
  });

test("a deep view-refined phrase refines camera-only frames by piece and simultaneous frames to their own views, without a backlog", async ({
  page,
}, info) => {
  test.setTimeout(180000);
  await page.addInitScript(() => {
    const log: any[] = [];
    (window as any).refinedRequests = log;
    (window as any).refinedMaximumPending = 0;
    const Base = window.Worker;
    window.Worker = class extends Base {
      pending = new Map<number, any>();
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        this.addEventListener("message", (e) => {
          const sent = this.pending.get(e.data.id);
          if (!sent) return;
          this.pending.delete(e.data.id);
          sent.milliseconds = performance.now() - sent.start;
        });
      }
      postMessage(message: any, ...rest: any[]) {
        if (message.action === "compute" && !message.probeOnly) {
          const entry = {
            start: performance.now(),
            to: message.config.stack.to,
            view: message.view,
          };
          log.push(entry);
          this.pending.set(message.id, entry);
          (window as any).refinedMaximumPending = Math.max(
            (window as any).refinedMaximumPending,
            this.pending.size,
          );
        }
        (super.postMessage as any)(message, ...rest);
      }
    };
  });
  const index = presets.findIndex((p) => p.title === "Inside a star's point");
  const study = planarPreset(index);
  study.animation = {
    ...study.animation,
    mode: "phrase",
    repeat: "once",
    phrase: {
      target: "stackTo",
      opening: { base: 1, construction: 1, derived: 1 },
      phases: [
        {
          name: "Fly into the point",
          duration: 2,
          pace: "ease",
          view: { x: 3.9585, y: 0, zoom: 800 },
        },
        {
          name: "Spread the offsets",
          duration: 2,
          pace: "ease",
          key: "0.0052",
        },
        { name: "Hold", duration: 8, pace: "ease" },
        {
          name: "Return",
          duration: 1,
          pace: "ease",
          key: "0.0039",
          view: "entry",
        },
      ],
    },
  };
  await page.goto(
    `/#s=${deflateRawSync(
      Buffer.from(JSON.stringify({ v: 1, notebook: "2d", study })),
    ).toString("base64url")}`,
  );
  await expect(page).not.toHaveURL(/#s=/);
  await openAnimation(page);
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  const log = () =>
    page.evaluate(() =>
      structuredClone((window as any).refinedRequests as any[]),
    );
  const before = (await log()).length;
  const began = Date.now();
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect(page.locator("#artwork")).toHaveAttribute("data-animation-time");
  const firstFrameMilliseconds = Date.now() - began;
  await expect
    .poll(async () => (await definition(page)).animation?.phrase?.phase, {
      intervals: [50],
      timeout: 60000,
    })
    .toBe("Hold");
  const throughHold = (await log()).length;
  await page.waitForTimeout(300);
  expect((await log()).length).toBe(throughHold);
  // The held frame is refined to a rectangle covering its own view.
  const held = (await definition(page)).animation.heldView;
  const requests = (await log()).slice(before);
  const last = requests.at(-1)!;
  expect(last.to).toBe(0.0052);
  const halfWidth = 500 / held.scale;
  expect(last.view.x0).toBeLessThanOrEqual(held.cx - halfWidth + 1e-12);
  expect(last.view.x1).toBeGreaterThanOrEqual(held.cx + halfWidth - 1e-12);
  // Flying in at a fixed input is refined by flight piece (a radius), each
  // once: zoom 800 needs about ten doublings, not one per frame.
  const pieces = requests.filter((r) => r.to === 0.0039 && r.view?.radius);
  expect(pieces.length).toBeGreaterThan(3);
  expect(pieces.length).toBeLessThan(60);
  // While the offsets spread, frames are refined to their own views.
  const own = requests.filter(
    (r) => r.to !== 0.0039 && r.view && r.view.radius === undefined,
  );
  expect(own.length).toBeGreaterThan(0);
  expect(
    await page.evaluate(() => (window as any).refinedMaximumPending),
  ).toBeLessThanOrEqual(1);
  const canceled = Date.now();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.locator("#artwork")).not.toHaveAttribute(
    "data-animation-progress",
  );
  const cancellationMilliseconds = Date.now() - canceled;
  await info.attach("refined-phrase-observations", {
    body: JSON.stringify(
      {
        study: "Inside a star's point, refined to its view, flown to 800×",
        firstFrameMilliseconds,
        cancellationMilliseconds,
        pieceRefinements: pieces.length,
        ownViewRefinements: own.length,
        workerMilliseconds: requests.map((r) => r.milliseconds),
        browser: await page.evaluate(() => navigator.userAgent),
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
});

test("a flown phrase opens and ends at a manually panned current view while its keys stay on the plane", async ({
  page,
}) => {
  const index = presets.findIndex(
    (p) => p.title === "A circle's caustic, opened",
  );
  const study = planarPreset(index);
  study.camera = { x: 60, y: -25, zoom: 1.3 };
  study.animation.camera = "current";
  const token = deflateRawSync(
    Buffer.from(JSON.stringify({ v: 1, notebook: "2d", study })),
  ).toString("base64url");
  await page.goto(`/#s=${token}`);
  await expect(page).not.toHaveURL(/#s=/);
  await openAnimation(page);
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(
    page.getByRole("combobox", { name: "Animation camera", exact: true }),
  ).toHaveValue("current");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", { name: "Animation progress" });
  const viewAt = async (time: string) => {
    await slider.fill(time);
    await expect(page.locator("#artwork")).toHaveAttribute(
      "data-animation-time",
      time,
    );
    return (await definition(page)).animation.heldView;
  };
  const end = await viewAt("1");
  const hold = await viewAt("0.75");
  const start = await viewAt("0");
  // The opening view is the effective manual view: the fitted scale times
  // 1.3, shifted 60 page units left and 25 down from the fitted center.
  expect(end).toEqual(start);
  const fitted = start.scale / 1.3;
  expect(hold.cx).toBe(-0.19);
  expect(hold.cy).toBe(0);
  expect(hold.scale / fitted).toBeCloseTo(1.7, 12);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  // Stop returns the manual camera with the study.
  await page
    .getByRole("combobox", { name: "Animation camera" })
    .selectOption("hold");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const fit = await viewAt("0");
  expect(fit.scale).toBeCloseTo(fitted, 9);
  expect(fit.cx - start.cx).toBeCloseTo(60 / start.scale, 12);
  expect(fit.cy - start.cy).toBeCloseTo(25 / start.scale, 12);
});

// Opening at the entry view while the study is refined to a manual view
// deeper than the fit, the fitted frames at the opening value draw the study
// refined to no view, as a camera path's do, not the manual view's refinement.
test("a flown phrase opening at the entry view draws the study refined to no view while the manual view is zoomed", async ({
  page,
}) => {
  test.setTimeout(120000);
  // The views the study is refined to, to show the manual view's refinement
  // is in effect before Play.
  await page.addInitScript(() => {
    const log: unknown[] = [];
    (window as any).refinedViews = log;
    const Base = window.Worker;
    window.Worker = class extends Base {
      postMessage(message: any, ...rest: any[]) {
        if (message.action === "compute" && message.view)
          log.push(message.view);
        (super.postMessage as any)(message, ...rest);
      }
    };
  });
  const index = presets.findIndex((p) => p.title === "Inside a star's point");
  const phrased = (camera: PlotCamera) => {
    const study = planarPreset(index);
    study.camera = camera;
    study.animation = {
      ...study.animation,
      mode: "phrase",
      camera: "hold",
      repeat: "once",
      phrase: {
        target: "stackTo",
        opening: { base: 1, construction: 1, derived: 1 },
        phases: [
          { name: "Hold", duration: 1, pace: "ease" },
          {
            name: "Fly into the point",
            duration: 1,
            pace: "ease",
            view: { x: 3.9585, y: 0, zoom: 50 },
          },
        ],
      },
    };
    return deflateRawSync(
      Buffer.from(JSON.stringify({ v: 1, notebook: "2d", study })),
    ).toString("base64url");
  };
  const refinedViews = () =>
    page.evaluate(() => (window as any).refinedViews.length as number);
  const opening = async (camera: PlotCamera, refines: boolean) => {
    await page.goto(`/#s=${phrased(camera)}`);
    await expect(page).not.toHaveURL(/#s=/);
    await openAnimation(page);
    if (refines) await expect.poll(refinedViews).toBeGreaterThan(0);
    await expect(page.locator(".plot-wrap")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    const refined = (await refinedViews()) > 0;
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const slider = page.getByRole("slider", { name: "Animation progress" });
    await slider.fill("0.25");
    await expect(page.locator("#artwork")).toHaveAttribute(
      "data-animation-time",
      "0.25",
    );
    const paths = await page
      .locator("#artwork path")
      .evaluateAll((e) => e.map((p) => p.getAttribute("d")));
    return { refined, paths };
  };
  const fitted = await opening({ x: 0, y: 0, zoom: 1 }, false);
  expect(fitted.refined).toBe(false);
  expect(fitted.paths.length).toBeGreaterThan(0);
  // 20× about the star's point: the study is refined to that view.
  const zoomed = await opening({ x: -5926, y: 0, zoom: 20 }, true);
  expect(zoomed.refined).toBe(true);
  expect(zoomed.paths).toEqual(fitted.paths);
});

test("phase camera keys are taken from the drawing, shown, returned, refused past the zoom limit and saved in links", async ({
  page,
}) => {
  await ready(page, "2");
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("phrase");
  const camera = (i: number) =>
    page.getByRole("combobox", { name: `Phase ${i} camera`, exact: true });
  await expect(camera(4)).toHaveValue("hold");
  await expect(
    page.getByRole("combobox", { name: "Animation camera", exact: true }),
  ).toContainText("Hold entry view");
  await camera(4).selectOption("view");
  await expect(page.locator(".phrase-phases li").nth(3)).toContainText(
    "zoom 1×, centered at",
  );
  await expect(
    page.getByRole("combobox", { name: "Animation camera", exact: true }),
  ).toContainText("Open at the entry view");
  await camera(7).selectOption("entry");
  // Zoom the drawing in, set phase 4 to it, zoom further, then show it.
  const artwork = page.locator("#artwork");
  await artwork.hover();
  await page.mouse.wheel(0, -300);
  const framed = await artwork.locator("path").first().getAttribute("d");
  await page
    .getByRole("button", {
      name: "Set phase 4 view to the drawing's view",
      exact: true,
    })
    .click();
  const hint = page.locator(".phrase-phases li").nth(3).locator(".hint");
  await expect(hint).not.toContainText("zoom 1×");
  const zoom = Number(/zoom ([\d.]+)×/.exec((await hint.textContent())!)![1]);
  expect(zoom).toBeGreaterThan(1.2);
  await artwork.hover();
  await page.mouse.wheel(0, -300);
  await expect(artwork.locator("path").first()).not.toHaveAttribute(
    "d",
    framed!,
  );
  await page
    .getByRole("button", { name: "Show phase 4 view", exact: true })
    .click();
  await expect(artwork.locator("path").first()).toHaveAttribute("d", framed!);
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", { name: "Animation progress" });
  const viewAt = async (time: string) => {
    await slider.fill(time);
    await expect(artwork).toHaveAttribute("data-animation-time", time);
    return (await definition(page)).animation.heldView;
  };
  // Phase 4 ends at 8 of 16 s and phase 5 holds its view; phase 7 returns.
  const held = await viewAt("0.6");
  const opening = await viewAt("0");
  expect(held.scale / opening.scale).toBeCloseTo(zoom, 3);
  expect(await viewAt("1")).toEqual(opening);
  // Editing a key view returns to the study.
  await camera(4).selectOption("hold");
  await expect(artwork).not.toHaveAttribute("data-animation-time");
  // A link's key deeper than an unrefined drawing allows is refused before
  // Play, under its phase's camera.
  const study = planarPreset(2);
  const { defaultPhrase } = await import("../web/phrase");
  const phrase = defaultPhrase(study.config, study.length);
  phrase.phases[4].view = { x: 0, y: 0, zoom: 30 };
  study.animation = { ...study.animation, mode: "phrase", phrase };
  await page.goto(
    `/#s=${deflateRawSync(
      Buffer.from(JSON.stringify({ v: 1, notebook: "2d", study })),
    ).toString("base64url")}`,
  );
  await expect(page).not.toHaveURL(/#s=/);
  await expect(page.getByText("Phase 5 view zooms past 20×")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Play animation", exact: true }),
  ).toBeDisabled();
});

test("phrase starter keys respect edited domains and ignore dormant construction coefficients", async () => {
  const { defaultPhrase, phraseTargets } = await import("../web/phrase");
  const config = structuredClone(presets[2].config);
  for (const [min, max, target] of [
    [1, 1.1, "max"],
    [-1.1, -1, "min"],
  ] as const) {
    config.curve.min = min;
    config.curve.max = max;
    const phrase = defaultPhrase(config, 0.8, target);
    for (const p of phrase.phases.filter((p) => p.key !== undefined)) {
      const key = Number(p.key);
      expect(key).toBeGreaterThan(target === "max" ? min : min - 1);
      expect(key).toBeLessThan(target === "min" ? max : max + 1);
    }
  }
  const implicit = structuredClone(
    presets.find((p) => p.config.curve.format === "implicit")!.config,
  );
  implicit.kind = "envelope";
  implicit.curve.implicit.f = "x^2+y^2-1";
  implicit.envelope.angle = "a*t";
  expect(phraseTargets(implicit)).not.toContain("a");
});

test("a fully revealed phrase reuses its fixed geometry rather than copying every path each frame", async () => {
  const { revealPhrase } = await import("../web/phrase");
  const result = {
    base: [{ x: 0, y: 0 }],
    derived: [null],
    virtual: [false],
    rays: [],
    family: [],
    circles: [],
    rolling: [],
    warnings: [],
    invalid: 0,
  };
  expect(revealPhrase(result, { base: 1, construction: 1, derived: 1 })).toBe(
    result,
  );
});

test("stopping a preparing phrase prevents its delayed keys from launching playback", async ({
  page,
}) => {
  await watchEngines(page, 2, { compute: 180 });
  await ready(page, "2");
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("phrase");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Preparing…", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.waitForTimeout(800); // every deliberately delayed preparation request can finish
  await expect(
    page.getByRole("button", { name: "Play animation", exact: true }),
  ).toBeEnabled();
  await expect(page.locator("#artwork")).not.toHaveAttribute(
    "data-animation-progress",
  );
  expect((await definition(page)).source.position.x).toBe(1);
});

test("phrase back and forth uses phase-local easing and returns to its opening presentation", async ({
  page,
}) => {
  const index = presets.findIndex(
    (p) => p.title === "A circle's caustic, opened",
  );
  await ready(page, String(index));
  // A loop is offered, but the authored reveal does not return to its
  // opening presentation, so it is refused by what differs.
  await page
    .getByRole("combobox", { name: "Repeat", exact: true })
    .selectOption("loop");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect(page.locator(".animation-error")).toContainText(
    "End the last phase at the opening value, layers, reveal and view",
  );
  await page
    .getByRole("combobox", { name: "Repeat", exact: true })
    .selectOption("back-and-forth");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", {
    name: "Animation progress",
    exact: true,
  });
  const read = () =>
    page.locator("#artwork").evaluate((svg) => ({
      paths: [...svg.querySelectorAll("path")].map((p) => p.getAttribute("d")),
      metadata: JSON.parse(svg.querySelector("desc")!.textContent!),
    }));
  await slider.fill("0.2");
  await expect(page.locator("#artwork")).toHaveAttribute(
    "data-animation-time",
    "0.2",
  );
  const outward = await read();
  // Outward phrase time is 6.4 s: 1.4/3 of its visible input transition.
  const eased = (1 - Math.cos((Math.PI * 1.4) / 3)) / 2;
  expect(outward.metadata.source.position.x).toBeCloseTo(
    0.95 - 0.1 * eased,
    13,
  );
  await slider.fill("0.8");
  await expect(page.locator("#artwork")).toHaveAttribute(
    "data-animation-time",
    "0.8",
  );
  const returning = await read();
  expect(returning.metadata.source.position.x).toBeCloseTo(
    outward.metadata.source.position.x,
    13,
  );
  expect(returning.paths).toEqual(outward.paths);
  await slider.fill("1");
  await expect(page.locator("#artwork")).toHaveAttribute(
    "data-animation-time",
    "1",
  );
  const end = await read();
  expect(end.metadata.source.position.x).toBe(1);
  expect(end.metadata.animation.phrase.reveal).toEqual({
    base: 1,
    construction: 0,
    derived: 0,
  });
  expect(end.metadata.animation.phrase.layers.lines).toBe(false);
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
});

test("a Go-refused phrase endpoint stays editable and disables retry until corrected", async ({
  page,
}) => {
  await ready(page, "3");
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("phrase");
  await page
    .getByRole("combobox", { name: "Phrase parameter", exact: true })
    .selectOption("nIncident");
  const key = page.getByRole("textbox", { name: "Phase 4 key", exact: true });
  await key.fill("0");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect(key.locator("..").getByRole("alert")).toContainText(
    "Phase 4 key",
  );
  await expect(
    page.getByRole("button", { name: "Play animation", exact: true }),
  ).toBeDisabled();
  await expect(key).toHaveValue("0");
  await expect(page.locator("#artwork")).not.toHaveAttribute(
    "data-animation-progress",
  );
  await page
    .getByRole("checkbox", { name: "Base curve", exact: true })
    .uncheck();
  await page
    .getByRole("spinbutton", { name: "Phase 1 duration", exact: true })
    .fill("2");
  await page.waitForTimeout(150); // let scalar revalidation finish after unrelated edits
  await expect(
    page.getByRole("button", { name: "Play animation", exact: true }),
  ).toBeDisabled();
  await expect(key.locator("..").getByRole("alert")).toContainText(
    "Phase 4 key",
  );
  await key.fill("1.5");
  await expect(
    page.getByRole("button", { name: "Play animation", exact: true }),
  ).toBeEnabled();
});

test("phrase ray length keys keep the ordinary animation range", async () => {
  const { compilePhrase, defaultPhrase } = await import("../web/phrase");
  const study = planarPreset(2);
  const draft = defaultPhrase(study.config, study.length, "rayLength");
  for (const value of [0, 0.009, 101, 1e300])
    expect(() =>
      compilePhrase(study.config, study.layers, study.length, draft, [
        value,
        1,
        0.8,
      ]),
    ).toThrow(/Phase 4 key.*[Rr]ay length/);
  expect(() =>
    compilePhrase(
      study.config,
      study.layers,
      study.length,
      draft,
      [0.01, 100, 0.8],
    ),
  ).not.toThrow();
});

test("a phrase varying only ray length prepares and samples without recomputing geometry", async ({
  page,
}) => {
  await watchEngines(page, 2);
  await ready(page, "2");
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("phrase");
  await page
    .getByRole("combobox", { name: "Phrase parameter", exact: true })
    .selectOption("rayLength");
  await page
    .getByRole("textbox", { name: "Phase 4 key", exact: true })
    .fill("1.5");
  await page
    .getByRole("textbox", { name: "Phase 5 key", exact: true })
    .fill("2.5");
  const computations = async () =>
    (await engines(page)).reduce((n, e) => n + (e.sent.compute ?? 0), 0);
  const before = await computations();
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page
    .getByRole("slider", { name: "Animation progress", exact: true })
    .fill("0.7");
  await expect(page.locator("#artwork")).toHaveAttribute(
    "data-animation-time",
    "0.7",
  );
  expect(await computations()).toBe(before);
});

for (const [width, theme] of [
  [1440, "light"],
  [1440, "dark"],
  [390, "light"],
  [320, "light"],
] as const)
  test(`phrase caption stays beside the viewport and moves into the drawing without losing a paused frame at ${width} in ${theme}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: width === 320 ? 667 : 1000 });
    await page.emulateMedia({ colorScheme: theme });
    await ready(
      page,
      String(
        presets.findIndex((p) => p.title === "A circle's caustic, opened"),
      ),
    );
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page
      .getByRole("slider", { name: "Animation progress", exact: true })
      .fill("0.75");
    await expect(page.locator("#artwork")).toHaveAttribute(
      "data-animation-time",
      "0.75",
    );
    const caption = page.getByRole("group", {
      name: "Animation stage",
      exact: true,
    });
    expect(await caption.count()).toBe(1);
    await expect(caption).toContainText("Hold the cusps");
    await expect(caption).toContainText("Source x = 0.650000");
    // Per-frame counters remain ordinary text, including implicit ARIA roles.
    await expect(caption.getByRole("status")).toHaveCount(0);
    await expect(page.locator("#playback .animation-values")).toHaveCount(0);
    await expect(page.locator("#artwork text")).toHaveCount(0);
    const label = page.getByRole("checkbox", {
      name: "Stage label in drawing",
      exact: true,
    });
    await expect(label).not.toBeChecked();
    const paths = await page
      .locator("#artwork path")
      .evaluateAll((p) => p.map((e) => e.getAttribute("d")));
    const camera = await page
      .locator("#artwork")
      .getAttribute("data-camera-scale");
    await page.locator(".plot-wrap").scrollIntoViewIfNeeded();
    await expect(caption).toBeInViewport({ ratio: 1 });
    const geometry = await caption.boundingBox();
    const art = await page.locator("#artwork").boundingBox();
    expect(geometry!.y).toBeGreaterThanOrEqual(art!.y + art!.height - 1);
    if (width < 700) {
      const dock = await page.locator("#playback").boundingBox();
      expect(geometry!.y + geometry!.height).toBeLessThanOrEqual(dock!.y);
    }
    await label.check();
    await expect(page.locator("#artwork")).toHaveAttribute(
      "data-animation-time",
      "0.75",
    );
    await expect(
      page.getByRole("button", { name: "Resume", exact: true }),
    ).toBeVisible();
    await expect(page.locator("#artwork [data-phrase-caption]")).toContainText(
      "Hold the cusps",
    );
    await expect(page.locator("#artwork [data-phrase-caption]")).toContainText(
      "Source x = 0.650000",
    );
    // Match the quiet 22-unit regular type used by exported face-on view
    // captions, rather than letting the caption dominate the construction.
    const captionText = page.locator("#artwork [data-phrase-caption] text");
    for (const line of await captionText.all()) {
      await expect(line).toHaveCSS("font-size", "22px");
      await expect(line).toHaveCSS("font-weight", "400");
      await expect(line).toHaveCSS(
        "fill",
        theme === "dark" ? "rgb(145, 164, 169)" : "rgb(95, 109, 105)",
      );
    }
    expect(
      await page
        .locator("#artwork [data-phrase-caption]")
        .evaluate((e) => (e as SVGGraphicsElement).getBBox().height),
    ).toBeLessThanOrEqual(64);
    expect(
      await page
        .locator("#artwork path")
        .evaluateAll((p) => p.map((e) => e.getAttribute("d"))),
    ).toEqual(paths);
    await expect(page.locator("#artwork")).toHaveAttribute(
      "data-camera-scale",
      camera!,
    );
    await page.locator(".plot-wrap").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath(`phrase-caption-inside-${width}-${theme}.png`),
    });
    await label.uncheck();
    await expect(page.locator("#artwork text")).toHaveCount(0);
    await expect(caption).toBeVisible();
    await page.locator(".plot-wrap").scrollIntoViewIfNeeded();
    const returnedCaption = await caption.boundingBox();
    if (width < 700) {
      const dock = await page.locator("#playback").boundingBox();
      expect(returnedCaption!.y + returnedCaption!.height).toBeLessThanOrEqual(
        dock!.y,
      );
    }
    await page.screenshot({
      path: info.outputPath(`phrase-caption-${width}-${theme}.png`),
    });
  });

test("phrase caption placement can change during playback without resetting its clock or calculating geometry", async ({
  page,
}) => {
  await watchEngines(page, 2);
  await ready(
    page,
    String(presets.findIndex((p) => p.title === "A circle's caustic, opened")),
  );
  const toggle = page.getByRole("checkbox", {
    name: "Stage label in drawing",
    exact: true,
  });
  expect(await toggle.count()).toBe(1);
  await page
    .getByRole("spinbutton", { name: "Phase 1 duration", exact: true })
    .fill("10");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect.poll(() => progress(page)).toBeGreaterThan(0);
  const before = await progress(page);
  const computations = async () =>
    (await engines(page)).reduce((sum, e) => sum + (e.sent.compute ?? 0), 0);
  const requests = await computations();
  await toggle.check();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#artwork [data-phrase-caption]")).toContainText(
    "Establish the mirror",
  );
  expect(await progress(page)).toBeGreaterThanOrEqual(before);
  expect(await computations()).toBe(requests);
});

for (const theme of ["light", "dark"] as const)
  test(`long phrase captions wrap without clipping or dock overlap in ${theme}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 320, height: 667 });
    await page.emulateMedia({ colorScheme: theme });
    const study = planarPreset(
      presets.findIndex((p) => p.title === "A circle's caustic, opened"),
    );
    study.config.source = {
      ...study.config.source,
      coordinates: "polar",
      radius: 1,
      theta: 0,
    };
    study.animation.phrase!.target = "sourceTheta";
    study.animation.phrase!.phases[5].name = "M".repeat(60);
    const token = deflateRawSync(
      Buffer.from(JSON.stringify({ v: 1, notebook: "2d", study })),
    ).toString("base64url");
    await page.goto(`/#s=${token}`);
    await expect(page).not.toHaveURL(/#s=/);
    await expect(page.locator(".plot-wrap")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await openAnimation(page);
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page
      .getByRole("slider", { name: "Animation progress", exact: true })
      .fill("0.75");
    await expect(page.locator("#artwork")).toHaveAttribute(
      "data-animation-time",
      "0.75",
    );
    const caption = page.getByRole("group", {
      name: "Animation stage",
      exact: true,
    });
    await page.locator(".plot-wrap").scrollIntoViewIfNeeded();
    const box = (await caption.boundingBox())!;
    const dock = (await page.locator("#playback").boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(dock.y);
    await expect(caption).toContainText("M".repeat(60));
    await expect(caption).toContainText("Source theta θ (radians) = 0.650000");
    await page
      .getByRole("checkbox", { name: "Stage label in drawing", exact: true })
      .check();
    const texts = await page
      .locator("#artwork [data-phrase-caption] text")
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const b = (node as SVGGraphicsElement).getBBox();
          return {
            x: b.x,
            y: b.y,
            right: b.x + b.width,
            bottom: b.y + b.height,
          };
        }),
      );
    expect(texts.length).toBeGreaterThan(2);
    for (const b of texts) {
      expect(b.x).toBeGreaterThanOrEqual(12);
      expect(b.right).toBeLessThanOrEqual(976);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.bottom).toBeLessThanOrEqual(744);
    }
    await page.locator(".plot-wrap").scrollIntoViewIfNeeded();
    expect(
      await page.locator("body").evaluate((e) => e.scrollWidth <= innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`phrase-caption-long-${theme}.png`),
    });
  });

for (const [width, height] of [
  [956, 440],
  [667, 375],
])
  test(`phrase landscape viewport keeps the ordinary animation height at ${width}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height });
    await ready(
      page,
      String(presets.findIndex((p) => p.title === "Light inside a circle")),
    );
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const ordinary = (await page.locator("#artwork").boundingBox())!;
    expect(ordinary.height).toBeGreaterThanOrEqual(width > 700 ? 420 : 340);
    await choosePreset(page, { label: "A circle's caustic, opened" });
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page
      .getByRole("slider", { name: "Animation progress", exact: true })
      .fill("0.56");
    await expect(page.locator("#artwork")).toHaveAttribute(
      "data-animation-time",
      "0.56",
    );
    for (const inside of [false, true]) {
      await page
        .getByRole("checkbox", { name: "Stage label in drawing", exact: true })
        .setChecked(inside);
      const phrase = (await page.locator("#artwork").boundingBox())!;
      expect(phrase.height).toBe(ordinary.height);
      expect(phrase.width).toBe(ordinary.width);
    }
    await page.locator(".plot-wrap").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath(`phrase-landscape-${width}.png`),
    });
  });

test("authored phrase resolves the visible caustic branches through its first inward movement", async ({
  page,
}, info) => {
  const index = presets.findIndex(
    (p) => p.title === "A circle's caustic, opened",
  );
  await ready(page, String(index));
  const study = planarPreset(index);
  const worker = page.workers().find((w) => w.url().includes("engine.worker"))!;
  const compute = async (config: any) =>
    worker.evaluate(
      (config) =>
        JSON.parse(
          (globalThis as any).tangentGardenCompute(JSON.stringify(config)),
        ),
      config,
    );
  const original = await compute(study.config);
  const view = fitFrame(original, study.config);
  const { compilePhrase, phraseAt } = await import("../web/phrase");
  const compiled = compilePhrase(
    study.config,
    study.layers,
    study.length,
    study.animation.phrase!,
    [0.95, 0.85, 0.65, 0.95],
  );
  const observations = [];
  for (const time of [
    0.32, 0.322, 0.324, 0.326, 0.328, 0.33, 0.332, 0.334, 0.336, 0.338, 0.34,
  ]) {
    const state = phraseAt(compiled, time * compiled.duration);
    const result = await compute(state.config);
    expect(result.error).toBeUndefined();
    const refined = result.adaptive?.derived;
    const points = refined?.points ?? result.derived;
    const virtual = refined?.virtual ?? result.virtual;
    const at = refined?.at ?? points.map((_: unknown, i: number) => i);
    const a = state.value;
    let error = 0,
      checked = 0;
    for (let i = 1; i < points.length; i++) {
      const p = points[i - 1],
        q = points[i];
      if (!p || !q || virtual[i - 1] || virtual[i]) continue;
      // Independent closed form: reflected direction before normalization is
      // (a cos 2t - cos t, a sin 2t - sin t). Its line envelope has this factor.
      const t = ((at[i - 1] + at[i]) * Math.PI) / (state.config.samples - 1);
      const c = Math.cos(t),
        s = Math.sin(t);
      const factor = (1 - a * c) / (2 * a * a + 1 - 3 * a * c);
      if (!(factor >= 0)) continue;
      const exact = {
        x: c + factor * (a * Math.cos(2 * t) - c),
        y: s + factor * (a * Math.sin(2 * t) - s),
      };
      if (Math.abs(exact.x) > 1.6 || Math.abs(exact.y) > 1.2) continue;
      const dx = q.x - p.x,
        dy = q.y - p.y;
      const u = Math.max(
        0,
        Math.min(
          1,
          ((exact.x - p.x) * dx + (exact.y - p.y) * dy) / (dx * dx + dy * dy),
        ),
      );
      error = Math.max(
        error,
        Math.hypot(exact.x - p.x - u * dx, exact.y - p.y - u * dy) * view.scale,
      );
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
    // A small error on existing chords does not detect a branch that ends
    // too soon. Probe both emerging tails at fixed visible heights, using
    // the actual renderer's segments (including its breaks and gap guard).
    const exactAt = (t: number) => {
      const c = Math.cos(t),
        s = Math.sin(t);
      const f = (1 - a * c) / (2 * a * a + 1 - 3 * a * c);
      return {
        x: c + f * (a * Math.cos(2 * t) - c),
        y: s + f * (a * Math.sin(2 * t) - s),
      };
    };
    const xy = (p: { x: number; y: number }) => ({
      x: 500 + (p.x - view.cx) * view.scale,
      y: 380 - (p.y - view.cy) * view.scale,
    });
    const d = pathData(points, xy, (i) => !virtual[i]);
    const segments: { x: number; y: number }[][] = [];
    let previous: { x: number; y: number } | undefined;
    for (const match of d.matchAll(/([ML])(-?[\d.]+),(-?[\d.]+)/g)) {
      const p = { x: Number(match[2]), y: Number(match[3]) };
      if (match[1] === "L" && previous) segments.push([previous, p]);
      previous = p;
    }
    expect(segments.length).toBeGreaterThan(100);
    let coverage = 0;
    for (const height of [0.9, 1.1]) {
      const pole = Math.acos((2 * a * a + 1) / (3 * a));
      let lo = pole + 1e-10,
        hi = pole + 0.1;
      expect(exactAt(lo).y).toBeGreaterThan(height);
      expect(exactAt(hi).y).toBeLessThan(height);
      for (let i = 0; i < 55; i++) {
        const mid = (lo + hi) / 2;
        if (exactAt(mid).y > height) lo = mid;
        else hi = mid;
      }
      const exact = exactAt((lo + hi) / 2);
      for (const sign of [-1, 1]) {
        const target = xy({ x: exact.x, y: sign * exact.y });
        const distance = Math.min(
          ...segments.map(([p, q]) => {
            const dx = q.x - p.x,
              dy = q.y - p.y;
            if (dx === 0 && dy === 0)
              return Math.hypot(target.x - p.x, target.y - p.y);
            const u = Math.max(
              0,
              Math.min(
                1,
                ((target.x - p.x) * dx + (target.y - p.y) * dy) /
                  (dx * dx + dy * dy),
              ),
            );
            return Math.hypot(target.x - p.x - u * dx, target.y - p.y - u * dy);
          }),
        );
        coverage = Math.max(coverage, distance);
      }
    }
    observations.push({
      time,
      sourceX: a,
      error,
      coverage,
      points: points.length,
    });
  }
  await info.attach("emerging-branches", {
    body: JSON.stringify(observations, null, 2),
    contentType: "application/json",
  });
  expect(
    Math.max(...observations.map((o) => o.error)),
    JSON.stringify(observations),
  ).toBeLessThan(0.5);
  expect(
    Math.max(...observations.map((o) => o.coverage)),
    JSON.stringify(observations),
  ).toBeLessThan(0.5);
});

test("authored phrase moves off the rim before revealing the caustic and returns to that near-rim view", async ({
  page,
}, info) => {
  await ready(
    page,
    String(presets.findIndex((p) => p.title === "A circle's caustic, opened")),
  );
  expect((await definition(page)).source.position.x).toBe(1);
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", {
    name: "Animation progress",
    exact: true,
  });
  await slider.fill("0.18");
  await expect(page.locator("#artwork")).toHaveAttribute(
    "data-animation-time",
    "0.18",
  );
  const hidden = await definition(page);
  expect(hidden.source.position.x).toBeLessThan(0.96);
  expect(hidden.animation.phrase.layers.derived).toBe(false);
  for (const time of ["0.2", "0.3", "1"]) {
    await slider.fill(time);
    await expect(page.locator("#artwork")).toHaveAttribute(
      "data-animation-time",
      time,
    );
    expect((await definition(page)).source.position.x).toBe(0.95);
  }
  await slider.fill("0.33");
  await expect(page.locator("#artwork")).toHaveAttribute(
    "data-animation-time",
    "0.33",
  );
  await page.screenshot({
    path: info.outputPath("phrase-first-visible-movement.png"),
  });
});
