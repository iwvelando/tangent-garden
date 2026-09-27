import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { applyTracks, availableTargets, reveal } from "../web/animation";
import { fitFrame } from "../web/Plot";
import { presets } from "../web/presets";
import type { Result, Vec } from "../web/types";
import { exportImage, openAnimation } from "./helpers";

const stackTitle = "Flower & its offset stack";
const envelopeTitle = "Circles & their envelope";
async function ready(page: Page, preset = stackTitle) {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await page
    .getByRole("combobox", { name: "Start with a notebook example" })
    .selectOption({ label: preset });
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
const members = (page: Page) =>
  page.getByTestId("offset-family").locator("path");
const circles = (page: Page) =>
  page.getByTestId("generating-circles").locator("circle");
// Definition parameters are constant-expression text fields; counts are numeric.
const field = (page: Page, name: string) =>
  page.getByLabel(name, { exact: true });
const numbers = (d: string) =>
  (d.match(/-?\d+(\.\d+)?(e-?\d+)?/g) ?? []).map(Number);

test("the stack preset animates its range and count, with exact endpoints", () => {
  const preset = presets.find((p) => p.title === stackTitle)!.config;
  expect(preset.kind).toBe("offset");
  expect(preset.stack).toEqual({
    enabled: true,
    from: -0.945,
    to: 0.84,
    count: 18,
  });
  expect(availableTargets(preset).slice(0, 3)).toEqual([
    "stackFrom",
    "stackTo",
    "stackCount",
  ]);
  expect(availableTargets(preset)).not.toContain("distance");
  const single = { ...preset, stack: { ...preset.stack, enabled: false } };
  expect(availableTargets(single)[0]).toBe("distance");
  expect(availableTargets(single)).not.toContain("stackCount");
  const tracks = [
    { target: "stackFrom" as const, from: -1 / 1.618, to: -Math.PI / 4 },
    { target: "stackTo" as const, from: 0.1, to: Math.PI / 5 },
    { target: "stackCount" as const, from: 2, to: 18 },
  ];
  const start = applyTracks(preset, tracks, 0, 1).config.stack;
  const end = applyTracks(preset, tracks, 1, 1).config.stack;
  expect(start).toEqual({ enabled: true, from: -1 / 1.618, to: 0.1, count: 2 });
  expect(end).toEqual({
    enabled: true,
    from: -Math.PI / 4,
    to: Math.PI / 5,
    count: 18,
  });
  expect(applyTracks(preset, tracks, 0.51, 1).config.stack.count).toBe(10);
  // The base study is never mutated.
  expect(preset.stack.from).toBe(-0.945);
});

test("reveal keeps family sample identity and circles follow their samples", () => {
  const point = (x: number): Vec => ({ x, y: 0 });
  const result: Result = {
    base: [point(0), null, point(2), point(3)],
    derived: [],
    virtual: [],
    rays: [0, 3].map((i) => ({
      sampleIndex: i,
      origin: point(i),
      direction: point(0),
      incident: point(0),
      target: point(i + 1),
      virtual: false,
      tir: false,
    })),
    family: [
      { distance: -1, points: [point(0), null, point(2), point(3)] },
      { distance: 1, points: [point(1), null, point(3), point(4)] },
    ],
    circles: [0, 3].map((i) => ({
      sampleIndex: i,
      center: point(i),
      radius: 1,
    })),
    rolling: [],
    warnings: [],
    invalid: 1,
  };
  const half = reveal(result, 0.5);
  expect(half.family.map((p) => p.distance)).toEqual([-1, 1]);
  expect(half.family[1].points).toEqual([point(1), null]);
  expect(half.circles.map((c) => c.sampleIndex)).toEqual([0]);
  expect(reveal(result, 1)).toEqual(result);
});

test("framing fits each family member and circle extents independently", () => {
  const arc = Array.from({ length: 40 }, (_, i) => ({ x: i / 400, y: 0 }));
  const shifted = (dy: number) => arc.map((p) => ({ ...p, y: p.y + dy }));
  const result: Result = {
    base: arc,
    derived: [],
    virtual: [],
    rays: [],
    family: [
      { distance: -30, points: shifted(30) },
      { distance: 0.01, points: shifted(-0.01) },
    ],
    circles: [],
    rolling: [],
    warnings: [],
    invalid: 0,
  };
  const config = presets.find((p) => p.title === stackTitle)!.config;
  // A distant member is framed although the base arc is short.
  expect(fitFrame(result, config).span).toBeGreaterThan(30);
  const circled = {
    ...result,
    family: [{ distance: 0.01, points: shifted(-0.01) }],
    circles: [{ sampleIndex: 0, center: { x: 0, y: 0 }, radius: 5 }],
  };
  // A circle's full extent is framed, not only its center.
  const frame = fitFrame(circled, config);
  expect(frame.span).toBeGreaterThanOrEqual(10);
  expect(Math.abs(frame.cx)).toBeLessThan(0.1);
  expect(Math.abs(frame.cy)).toBeLessThan(0.1);
});

test("the stack preset draws every member with segments across the stack", async ({
  page,
}) => {
  await ready(page);
  const preset = presets.find((p) => p.title === stackTitle)!.config;
  await expect(members(page)).toHaveCount(18);
  const distances = await members(page).evaluateAll((paths) =>
    paths.map((p) => Number(p.getAttribute("data-distance"))),
  );
  distances.forEach((d, k) => expect(d).toBeCloseTo(0.105 * (k - 9), 12));
  await expect(circles(page)).toHaveCount(0);
  await expect(page.getByTestId("focus-point")).toHaveCount(0);
  await expect(page.getByText(/omitted samples/)).toHaveCount(0);
  // Each normal segment spans 0.945 + 0.84 in drawing units.
  const scale = Number(
    await page.locator("#artwork").getAttribute("data-camera-scale"),
  );
  const lengths = await page
    .locator("#artwork > g line")
    .evaluateAll((ls) =>
      ls.map((l) =>
        Math.hypot(
          Number(l.getAttribute("x2")) - Number(l.getAttribute("x1")),
          Number(l.getAttribute("y2")) - Number(l.getAttribute("y1")),
        ),
      ),
    );
  expect(lengths).toHaveLength(preset.lines);
  for (const length of lengths) expect(length / scale).toBeCloseTo(1.785, 6);
  await expect(page.locator(".explanation")).toContainText("stack");
});

test("the offset tab switches between one offset and a stack with circles", async ({
  page,
}) => {
  await ready(page, "Ellipse & its evolute");
  await page
    .getByRole("group", { name: "Construction" })
    .getByRole("button", { name: "offset", exact: true })
    .click();
  const offsets = page.getByRole("combobox", { name: "Offsets", exact: true });
  await expect(offsets).toHaveValue("single");
  await field(page, "Offset distance d").fill("0.3");
  await offsets.selectOption("stack");
  await settled(page);
  await expect(field(page, "Offset distance d")).toHaveCount(0);
  await expect(page.locator("#artwork > path")).toHaveCount(1);
  const initial = (await definition(page)).stack;
  expect(initial.enabled).toBe(true);
  await expect(members(page)).toHaveCount(initial.count);
  await field(page, "Number of offsets").fill("65");
  await expect(page.getByRole("alert")).toContainText("2–64");
  await field(page, "Number of offsets").fill("2.5");
  await expect(page.getByRole("alert")).toContainText("whole number");
  await field(page, "Number of offsets").fill("3");
  await field(page, "First offset distance").fill("-0.25");
  await field(page, "Last offset distance").fill("");
  await expect(page.getByRole("alert")).toContainText("finite number");
  await field(page, "Last offset distance").fill("0.5");
  await settled(page);
  await expect(members(page)).toHaveCount(3);
  expect((await definition(page)).stack).toEqual({
    enabled: true,
    from: -0.25,
    to: 0.5,
    count: 3,
  });
  const circlesBox = page.getByRole("checkbox", { name: "Generating circles" });
  await circlesBox.check();
  await settled(page);
  await expect(circles(page)).toHaveCount(48);
  // Circles have the stack's largest distance as their radius.
  const scale = Number(
    await page.locator("#artwork").getAttribute("data-camera-scale"),
  );
  expect(Number(await circles(page).first().getAttribute("r"))).toBeCloseTo(
    0.5 * scale,
    6,
  );
  // They are construction geometry, hidden with the construction lines.
  await page.getByRole("checkbox", { name: "Construction lines" }).uncheck();
  await expect(circles(page)).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Construction lines" }).check();
  await offsets.selectOption("single");
  await settled(page);
  await expect(members(page)).toHaveCount(0);
  await expect(page.locator("#artwork > path")).toHaveCount(2);
  // A single offset's circles have radius |d| and touch it.
  expect(Number(await circles(page).first().getAttribute("r"))).toBeCloseTo(
    0.3 *
      Number(await page.locator("#artwork").getAttribute("data-camera-scale")),
    6,
  );
  const saved = await definition(page);
  expect(saved.distance).toBe(0.3);
  expect(saved.stack).toEqual({
    enabled: false,
    from: -0.25,
    to: 0.5,
    count: 3,
  });
  await page
    .getByRole("group", { name: "Construction" })
    .getByRole("button", { name: "evolute", exact: true })
    .click();
  await settled(page);
  await expect(circles(page)).toHaveCount(0);
  await expect(offsets).toHaveCount(0);
});

test("generating circles stay framed and exported with their envelope", async ({
  page,
}) => {
  await ready(page, envelopeTitle);
  await expect(members(page)).toHaveCount(2);
  const preset = presets.find((p) => p.title === envelopeTitle)!.config;
  await expect(circles(page)).toHaveCount(preset.lines);
  const inView = async () => {
    const boxes = await circles(page).evaluateAll((cs) =>
      cs.map((c) => ({
        x: Number(c.getAttribute("cx")),
        y: Number(c.getAttribute("cy")),
        r: Number(c.getAttribute("r")),
      })),
    );
    // One assertion per family: thousands of separate expect calls make
    // this test slow enough to time out on a loaded machine.
    expect(
      boxes.filter(
        (c) =>
          c.x - c.r < 0 || c.x + c.r > 1000 || c.y - c.r < 0 || c.y + c.r > 760,
      ),
    ).toEqual([]);
    for (const d of await members(page).evaluateAll((ps) =>
      ps.map((p) => p.getAttribute("d")!),
    )) {
      const values = numbers(d);
      expect(values.length).toBeGreaterThan(20);
      expect(
        values.filter((v, i) => v < 0 || v > (i % 2 ? 760 : 1000)),
      ).toEqual([]);
    }
  };
  await inView();
  // A short arc with large circles keeps the circles, not just the arc, in view.
  await page.getByRole("textbox", { name: "to", exact: true }).fill("0.4");
  await field(page, "First offset distance").fill("-25");
  await field(page, "Last offset distance").fill("25");
  await settled(page);
  await inView();
  const download = page.waitForEvent("download");
  await exportImage(page, "SVG");
  const file = await download;
  expect(file.suggestedFilename()).toBe("tangent-garden-offset.svg");
  const svg = await readFile((await file.path())!, "utf8");
  const exported = await page.evaluate((s) => {
    const doc = new DOMParser().parseFromString(s, "image/svg+xml");
    return {
      config: JSON.parse(doc.querySelector("desc")!.textContent!),
      members: doc.querySelectorAll('[data-testid="offset-family"] path')
        .length,
      circles: doc.querySelectorAll('[data-testid="generating-circles"] circle')
        .length,
    };
  }, svg);
  expect(exported.config.stack).toEqual({
    enabled: true,
    from: -25,
    to: 25,
    count: 2,
  });
  expect(exported.config.circles).toBe(true);
  expect(exported.members).toBe(2);
  expect(exported.circles).toBe(preset.lines);
});

for (const camera of ["hold", "current", "follow", "fit"]) {
  test(`offset stack animation reaches endpoints with ${camera} camera`, async ({
    page,
  }) => {
    await ready(page);
    const original = (await definition(page)).stack;
    await openAnimation(page);
    await page
      .getByRole("combobox", { name: "Animate", exact: true })
      .selectOption("parameters");
    await expect(
      page.getByRole("combobox", { name: "Parameter 1", exact: true }),
    ).toHaveValue("stackFrom");
    await page.getByRole("textbox", { name: "Track 1 from" }).fill("-1/phi");
    await page.getByRole("textbox", { name: "Track 1 to" }).fill("-pi/4");
    await page.getByRole("button", { name: "Add parameter" }).click();
    await page
      .getByRole("combobox", { name: "Parameter 2", exact: true })
      .selectOption("stackCount");
    await page.getByRole("textbox", { name: "Track 2 from" }).fill("2");
    await page.getByRole("textbox", { name: "Track 2 to" }).fill("12");
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
    const stack = (await definition(page)).stack;
    expect(stack.from).toBe(-Math.PI / 4);
    expect(stack.count).toBe(12);
    await expect(members(page)).toHaveCount(12);
    await page.getByRole("button", { name: /^(Stop|Reset view)$/ }).click();
    expect((await definition(page)).stack).toEqual(original);
    await expect(members(page)).toHaveCount(18);
  });
}

// A frame's timestamp marks the start of the frame and can precede the
// moment playback began. Playback must clamp to its start rather than
// extrapolate before it, where a count of 2 would round down to 1.
test("playback never extrapolates before its start when frame times lag", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const request = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) =>
      request(() => callback(performance.now() - 50));
  });
  await ready(page);
  const seen: number[] = [];
  await page.exposeFunction("recordProgress", (p: number) => seen.push(p));
  await page.evaluate(() => {
    const artwork = () => document.querySelector("#artwork");
    new MutationObserver(() => {
      const p = artwork()?.getAttribute("data-animation-progress");
      if (p !== null && p !== undefined) (window as any).recordProgress(+p);
    }).observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-animation-progress"],
    });
  });
  await openAnimation(page);
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("parameters");
  await page
    .getByRole("combobox", { name: "Parameter 1", exact: true })
    .selectOption("stackCount");
  await page.getByRole("textbox", { name: "Track 1 from" }).fill("2");
  await page.getByRole("textbox", { name: "Track 1 to" }).fill("12");
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill(".2");
  await page.getByRole("button", { name: "Play animation" }).click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect((await definition(page)).stack.count).toBe(12);
  expect(seen.length).toBeGreaterThan(0);
  expect(Math.min(...seen)).toBeGreaterThanOrEqual(0);
});

test("stack reveal pauses, resumes, and an edit cancels playback", async ({
  page,
}) => {
  await ready(page, envelopeTitle);
  await openAnimation(page);
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill("2");
  await page.getByRole("button", { name: "Play animation" }).click();
  await expect.poll(() => progress(page)).toBeGreaterThan(0.1);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  expect(await progress(page)).toBeLessThan(1);
  const partial = await circles(page).count();
  expect(partial).toBeGreaterThan(0);
  expect(partial).toBeLessThan(48);
  await expect(members(page)).toHaveCount(2);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  await expect(circles(page)).toHaveCount(48);
  await page.getByRole("button", { name: "Replay", exact: true }).click();
  await expect.poll(() => progress(page)).toBeGreaterThan(0);
  await field(page, "Number of offsets").fill("4");
  await settled(page);
  await expect(page.locator("#artwork")).not.toHaveAttribute(
    "data-animation-progress",
  );
  await expect(members(page)).toHaveCount(4);
});

for (const theme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    test(`offset stack layout in ${theme} at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: theme });
      await ready(page, envelopeTitle);
      await expect(field(page, "Number of offsets")).toBeVisible();
      await expect(
        page.getByRole("checkbox", { name: "Generating circles" }),
      ).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: testInfo.outputPath(`offset-stack-${theme}-${width}.png`),
        fullPage: true,
      });
    });
  }
}
