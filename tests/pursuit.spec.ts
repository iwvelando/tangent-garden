import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  applyTracks,
  availableTargets,
  reveal,
  targetLabel,
  targetValue,
} from "../web/animation";
import { captureNote, nextPursuer, regularPolygon } from "../web/pursuit";
import { fitFrame } from "../web/Plot";
import { presets } from "../web/presets";
import type { PursuitResult, Result, Vec } from "../web/types";
import { exportImage, openAnimation, choosePreset } from "./helpers";

const heptagonTitle = "Seven pursuers & an evolute";
const unequalTitle = "Four chasers at unequal speeds";
const preset = (title: string) =>
  presets.find((p) => p.title === title)!.config;
async function ready(page: Page, title: string) {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await choosePreset(page, { label: title });
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
const field = (page: Page, name: string) =>
  page.getByLabel(name, { exact: true });
const note = (page: Page) => page.getByTestId("capture-note");
const polygons = (page: Page) => page.getByTestId("pursuit-polygon");
const to = (page: Page) =>
  page.getByRole("textbox", { name: "to", exact: true });
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
// Each connecting polygon's sample and vertices, in drawing units.
const polygonVertices = (page: Page) =>
  polygons(page).evaluateAll((all) =>
    all.map((p) => ({
      sample: Number(p.getAttribute("data-sample")),
      points: p
        .getAttribute("d")!
        .replace(/^M|Z$/g, "")
        .split("L")
        .map((xy) => xy.split(",").map(Number)),
    })),
  );
const lastSample = async (page: Page) =>
  Number(await polygons(page).last().getAttribute("data-sample"));

test("the pursuit presets start from a regular heptagon and a square", () => {
  const heptagon = preset(heptagonTitle);
  expect(heptagon.curve.format).toBe("pursuit");
  expect(heptagon.kind).toBe("evolute");
  const pursuers = heptagon.curve.pursuit.pursuers;
  expect(pursuers).toHaveLength(7);
  pursuers.forEach((p, j) => {
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(1, 15);
    expect(Math.atan2(p.y, p.x)).toBeCloseTo(
      Math.atan2(
        Math.sin((2 * Math.PI * j) / 7),
        Math.cos((2 * Math.PI * j) / 7),
      ),
      15,
    );
    expect(p.speed).toBe(1);
  });
  // The domain ends just past the capture at t ≈ 2.3021.
  expect(heptagon.curve.max).toBeGreaterThan(
    (1 - 0.001 / (2 * Math.sin(Math.PI / 7))) / Math.sin(Math.PI / 7),
  );
  const unequal = preset(unequalTitle);
  expect(unequal.kind).toBe("pedal");
  expect(unequal.curve.pursuit.pursuers.map((p) => p.speed)).toEqual([
    1, 1.25, 1, 0.8,
  ]);
});

test("each pursuer's start and speed, and the capture distance, are animatable", () => {
  const config = preset(unequalTitle);
  const targets = availableTargets(config);
  expect(targets).not.toContain("a");
  expect(targets.slice(0, 13)).toEqual([
    ...[1, 2, 3, 4].flatMap((k) => [
      `pursuer${k}Speed`,
      `pursuer${k}X`,
      `pursuer${k}Y`,
    ]),
    "pursuitCapture",
  ]);
  expect(targetLabel("pursuer2Speed")).toBe("Speed v₂");
  expect(targetLabel("pursuer12X")).toBe("Start x₁₂");
  expect(targetLabel("pursuer3Y")).toBe("Start y₃");
  expect(targetLabel("pursuitCapture")).toBe("Capture distance ε");
  expect(targetValue(config, "pursuer2Speed", 1)).toBe(1.25);
  expect(targetValue(config, "pursuer4Y", 1)).toBe(-1);
  expect(targetValue(config, "pursuer9X", 1)).toBeNaN();
  expect(targetValue(config, "pursuitCapture", 1)).toBe(0.01);
  const tracks = [
    { target: "pursuer2Speed" as const, from: 1.25, to: 2 },
    { target: "pursuer1X" as const, from: 1, to: 1 / 3 },
    { target: "pursuitCapture" as const, from: 0.01, to: 0.2 },
    // A pursuer that no longer exists is left alone.
    { target: "pursuer9Y" as const, from: 0, to: 1 },
  ];
  const end = applyTracks(config, tracks, 1, 1).config;
  expect(end.curve.pursuit.pursuers[1].speed).toBe(2);
  expect(end.curve.pursuit.pursuers[0].x).toBe(1 / 3);
  expect(end.curve.pursuit.capture).toBe(0.2);
  expect(end.curve.pursuit.pursuers).toHaveLength(4);
  expect(applyTracks(config, tracks, 0, 1).config).toEqual(config);
  // The study itself is untouched.
  expect(config.curve.pursuit.pursuers[1].speed).toBe(1.25);
});

test("the capture note, added pursuers, and even spacing", () => {
  const chase = (patch: Partial<PursuitResult>): PursuitResult => ({
    paths: [],
    polygons: [],
    capture: null,
    exhausted: false,
    end: 3,
    ...patch,
  });
  expect(
    captureNote(
      chase({ capture: { time: 2.302112345, pursuer: 1, target: 2 } }),
      0,
    ),
  ).toBe(
    "Pursuer 2 comes within the capture distance of pursuer 3 at t = 2.30211, and the chase stops there for everyone: later samples are left empty.",
  );
  expect(
    captureNote(chase({ capture: { time: -1, pursuer: 6, target: 0 } }), -1),
  ).toBe(
    "Pursuer 7 starts within the capture distance of pursuer 1, so the chase ends at once.",
  );
  expect(captureNote(chase({ exhausted: true, end: 1.25 }), 0)).toMatch(
    /^The chase ran out of integration steps at t = 1\.25: later samples are left empty\./,
  );
  expect(captureNote(chase({}), 0)).toBe(
    "No pursuer comes within the capture distance of its target by the end of the domain.",
  );
  const square = preset(unequalTitle).curve.pursuit.pursuers;
  // Halfway back from the last to the first, at the last one's speed.
  expect(nextPursuer(square)).toEqual({ x: 1, y: 0, speed: 0.8 });
  const even = regularPolygon([...square, nextPursuer(square)]);
  expect(even.map((p) => p.speed)).toEqual([1, 1.25, 1, 0.8, 0.8]);
  const cx = even.reduce((s, p) => s + p.x, 0) / 5;
  const cy = even.reduce((s, p) => s + p.y, 0) / 5;
  const centroid = { x: 0.2, y: 0 };
  expect(cx).toBeCloseTo(centroid.x, 12);
  expect(cy).toBeCloseTo(centroid.y, 12);
  // Through the farthest pursuer, starting from the first.
  const radius = Math.hypot(-1 - 0.2, 1);
  even.forEach((p, j) => {
    expect(Math.hypot(p.x - 0.2, p.y)).toBeCloseTo(radius, 12);
    const next = even[(j + 1) % 5];
    expect(Math.hypot(next.x - p.x, next.y - p.y)).toBeCloseTo(
      2 * radius * Math.sin(Math.PI / 5),
      12,
    );
  });
  expect(Math.atan2(even[0].y, even[0].x - 0.2)).toBeCloseTo(
    Math.atan2(1, 0.8),
    12,
  );
  expect(Math.atan2(even[1].y, even[1].x - 0.2)).toBeCloseTo(
    Math.atan2(1, 0.8) + (2 * Math.PI) / 5,
    12,
  );
  // Pursuers all in one place are spread on the unit circle.
  const stacked = regularPolygon([
    { x: 3, y: 3, speed: 1 },
    { x: 3, y: 3, speed: 2 },
  ]);
  expect(stacked[0]).toEqual({ x: 1, y: 0, speed: 1 });
  expect(stacked[1].x).toBeCloseTo(-1, 15);
});

test("reveal follows the chase; framing holds every pursuer's path", () => {
  const point = (x: number, y = 0): Vec => ({ x, y });
  const result: Result = {
    base: [point(0), point(1), point(2), point(3)],
    derived: [null, null, null, null],
    virtual: [false, false, false, false],
    rays: [],
    family: [],
    circles: [],
    rolling: [],
    pursuit: {
      paths: [
        [point(0), point(1), point(2), point(3)],
        [point(0, 40), point(0, 38), point(0, 36), null],
      ],
      polygons: [0, 2].map((i) => ({
        sampleIndex: i,
        points: [point(i), point(0, 40 - 2 * i)],
      })),
      capture: { time: 2.5, pursuer: 1, target: 0 },
      exhausted: false,
      end: 2.5,
    },
    warnings: [],
    invalid: 0,
  };
  const half = reveal(result, 0.5);
  expect(half.pursuit!.paths.map((p) => p.length)).toEqual([2, 2]);
  expect(half.pursuit!.polygons.map((p) => p.sampleIndex)).toEqual([0]);
  expect(half.pursuit!.capture).toEqual(result.pursuit!.capture);
  expect(reveal(result, 1)).toEqual(result);
  expect(reveal({ ...result, pursuit: undefined }, 0.5).pursuit).toBe(
    undefined,
  );
  // The second pursuer, far above the base, is framed as its own family.
  const frame = fitFrame(result, preset(heptagonTitle));
  expect(frame.cy).toBeGreaterThan(15);
  expect(frame.span).toBeGreaterThanOrEqual(40);
});

test("the heptagon preset draws seven spirals and shrinking regular polygons", async ({
  page,
}) => {
  await ready(page, heptagonTitle);
  await expect(page.getByTestId("pursuit-path")).toHaveCount(7);
  await expect(page.getByTestId("pursuer")).toHaveCount(7);
  await expect(note(page)).toHaveText(
    "Pursuer 2 comes within the capture distance of pursuer 3 at t = 2.30211, and the chase stops there for everyone: later samples are left empty.",
  );
  // 40 representative samples; the last is after the capture.
  const drawn = await polygonVertices(page);
  expect(drawn).toHaveLength(39);
  expect(drawn.at(-1)!.sample).toBe(3896);
  const s = await scale(page);
  const center = await toScreen(page, { x: 0, y: 0 });
  for (const { sample, points } of drawn) {
    const t = (2.31 * sample) / 3999;
    const r = 1 - t * Math.sin(Math.PI / 7);
    expect(points).toHaveLength(7);
    for (const [x, y] of points)
      expect(
        Math.abs(Math.hypot(x - center.x, y - center.y) - r * s),
      ).toBeLessThan(0.01);
  }
  // At t = 0 the polygon is the starting heptagon, in chase order.
  for (const [j, [x, y]] of drawn[0].points.entries()) {
    const want = await toScreen(page, {
      x: Math.cos((2 * Math.PI * j) / 7),
      y: Math.sin((2 * Math.PI * j) / 7),
    });
    expect(Math.hypot(x - want.x, y - want.y)).toBeLessThan(0.01);
  }
  // Ending the domain at the capture leaves no empty tail.
  await page
    .getByRole("button", { name: "End the domain at the capture" })
    .click();
  await settled(page);
  expect(Number(await to(page).inputValue())).toBeCloseTo(2.30211, 5);
  expect((await definition(page)).curve.max).toBeLessThan(2.3022);
});

test("pursuers are added, edited, spaced evenly, and removed", async ({
  page,
}) => {
  await ready(page, unequalTitle);
  await expect(note(page)).toContainText(
    "Pursuer 3 comes within the capture distance of pursuer 4 at t = 1.96046",
  );
  await expect(page.getByTestId("pursuit-path")).toHaveCount(4);
  await expect(page.getByText("Pursuer 4, chasing 1")).toBeVisible();
  await page.getByRole("button", { name: "Add a pursuer" }).click();
  await settled(page);
  await expect(page.getByText("Pursuer 5, chasing 1")).toBeVisible();
  expect((await definition(page)).curve.pursuit.pursuers[4]).toEqual({
    x: 1,
    y: 0,
    speed: 0.8,
  });
  await expect(page.getByTestId("pursuit-path")).toHaveCount(5);
  await expect(page.getByTestId("pursuer")).toHaveCount(5);
  await page.getByRole("button", { name: "Space evenly on a circle" }).click();
  await settled(page);
  const even = (await definition(page)).curve.pursuit.pursuers;
  for (const p of even)
    expect(Math.hypot(p.x - 0.2, p.y)).toBeCloseTo(Math.hypot(1.2, 1), 12);
  await field(page, "Speed v₂").fill("pi/2");
  await settled(page);
  expect((await definition(page)).curve.pursuit.pursuers[1].speed).toBe(
    Math.PI / 2,
  );
  await page.getByRole("button", { name: "Remove pursuer 1" }).click();
  await settled(page);
  const left = (await definition(page)).curve.pursuit.pursuers;
  expect(left).toHaveLength(4);
  expect(left[0].speed).toBe(Math.PI / 2);
  // Two pursuers is the least.
  await page.getByRole("button", { name: "Remove pursuer 1" }).click();
  await page.getByRole("button", { name: "Remove pursuer 1" }).click();
  await settled(page);
  await expect(
    page.getByRole("button", { name: "Remove pursuer 1" }),
  ).toBeDisabled();
  // Two pursuers chase each other along the line between them.
  await field(page, "Start x₁").fill("-1");
  await field(page, "Start y₁").fill("0");
  await field(page, "Start x₂").fill("2");
  await field(page, "Start y₂").fill("0");
  await field(page, "Speed v₁").fill("1");
  await field(page, "Speed v₂").fill("2");
  await field(page, "Capture distance ε").fill("1/2");
  await settled(page);
  await expect(note(page)).toContainText("at t = 0.833333");
  // Sixteen at most.
  for (let n = 2; n < 16; n++)
    await page.getByRole("button", { name: "Add a pursuer" }).click();
  await expect(
    page.getByRole("button", { name: "At most 16 pursuers" }),
  ).toBeDisabled();
  await settled(page);
  expect((await definition(page)).curve.pursuit.pursuers).toHaveLength(16);
  // A capture distance of zero would divide by zero at the capture.
  await field(page, "Capture distance ε").fill("0");
  await expect(page.getByRole("alert")).toContainText(
    "the capture distance must be finite, positive, and at most 100000",
  );
});

test("an exported pursuit keeps every pursuer and polygon", async ({
  page,
}) => {
  await ready(page, unequalTitle);
  await field(page, "Start y₄").fill("-3/2");
  await settled(page);
  const download = page.waitForEvent("download");
  await exportImage(page, "SVG");
  const svg = await readFile((await (await download).path())!, "utf8");
  const exported = await page.evaluate((s) => {
    const doc = new DOMParser().parseFromString(s, "image/svg+xml");
    return {
      config: JSON.parse(doc.querySelector("desc")!.textContent!),
      paths: doc.querySelectorAll('[data-testid="pursuit-path"]').length,
      polygons: doc.querySelectorAll('[data-testid="pursuit-polygon"]').length,
    };
  }, svg);
  expect(exported.config.curve.format).toBe("pursuit");
  expect(exported.config.curve.pursuit.pursuers[3]).toEqual({
    x: 1,
    y: -1.5,
    speed: 0.8,
  });
  expect(exported.paths).toBe(4);
  expect(exported.polygons).toBe(await polygons(page).count());
  expect(exported.polygons).toBeGreaterThan(10);
});

for (const camera of ["hold", "current", "follow", "fit"]) {
  test(`pursuer animation reaches endpoints with ${camera} camera`, async ({
    page,
  }) => {
    await ready(page, heptagonTitle);
    const original = (await definition(page)).curve.pursuit;
    await openAnimation(page);
    await page
      .getByRole("combobox", { name: "Animate", exact: true })
      .selectOption("parameters");
    const parameter = page.getByRole("combobox", {
      name: "Parameter 1",
      exact: true,
    });
    await expect(parameter).toHaveValue("pursuer1Speed");
    await expect(page.getByRole("textbox", { name: "Track 1 to" })).toHaveValue(
      "2",
    );
    await parameter.selectOption({ label: "Speed v₂" });
    await page.getByRole("textbox", { name: "Track 1 to" }).fill("1/phi");
    await page.getByRole("button", { name: "Add parameter" }).click();
    const second = page.getByRole("combobox", {
      name: "Parameter 2",
      exact: true,
    });
    await second.selectOption({ label: "Capture distance ε" });
    await expect(page.getByRole("textbox", { name: "Track 2 to" })).toHaveValue(
      "0.02",
    );
    await page.getByRole("textbox", { name: "Track 2 to" }).fill("pi/100");
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
    const pursuit = (await definition(page)).curve.pursuit;
    expect(pursuit.pursuers[1].speed).toBeCloseTo(2 / (1 + Math.sqrt(5)), 14);
    expect(pursuit.capture).toBe(Math.PI / 100);
    // The first pursuer closes on the slower second long before the
    // heptagon would collapse, so fewer polygons are drawn. The note keeps
    // describing the study itself.
    await expect.poll(() => polygons(page).count()).toBeLessThan(39);
    expect(await polygons(page).count()).toBeGreaterThan(5);
    await page.getByRole("button", { name: /^(Stop|Back to study)$/ }).click();
    expect((await definition(page)).curve.pursuit).toEqual(original);
  });
}

test("reveal runs the chase along, pauses, resumes, and an edit cancels", async ({
  page,
}) => {
  await ready(page, heptagonTitle);
  await openAnimation(page);
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill("2");
  await page.getByRole("button", { name: "Play animation" }).click();
  await expect.poll(() => progress(page)).toBeGreaterThan(0.1);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const paused = await progress(page);
  expect(paused).toBeLessThan(1);
  const sample = await lastSample(page);
  expect(sample).toBeLessThanOrEqual(paused * 3999);
  expect(sample).toBeGreaterThan(paused * 3999 - 3999 / 39 - 1);
  await expect(page.getByTestId("pursuer")).toHaveCount(7);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  expect(await lastSample(page)).toBe(3896);
  await page.getByRole("button", { name: "Replay", exact: true }).click();
  await expect.poll(() => progress(page)).toBeGreaterThan(0);
  await field(page, "Speed v₃").fill("2");
  await settled(page);
  await expect(page.locator("#artwork")).not.toHaveAttribute(
    "data-animation-progress",
  );
  expect((await definition(page)).curve.pursuit.pursuers[2].speed).toBe(2);
});

for (const theme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    test(`pursuit layout in ${theme} at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: theme });
      await ready(page, heptagonTitle);
      await expect(field(page, "Speed v₇")).toBeVisible();
      await expect(note(page)).toBeVisible();
      // A pursuer's three fields share one row, even on a phone.
      const tops = await Promise.all(
        ["Start x₁", "Start y₁", "Speed v₁"].map(
          async (name) => (await field(page, name).boundingBox())!.y,
        ),
      );
      expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(1);
      const buttons = await Promise.all(
        ["Add a pursuer", "Space evenly on a circle"].map(
          async (name) =>
            (await page.getByRole("button", { name }).boundingBox())!,
        ),
      );
      expect(Math.abs(buttons[0].y - buttons[1].y)).toBeLessThan(1);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: testInfo.outputPath(`pursuit-${theme}-${width}.png`),
        fullPage: true,
      });
    });
  }
}
