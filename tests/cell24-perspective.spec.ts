import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { chooseColorScheme, exportImage, openShapeExport } from "./helpers";
import { decodeVideo, frameDifference, probe } from "./video";
import { writeStudyLink } from "../web/study-link";
import { presetStudy, type TesseractStudy } from "../web/tesseract/link";
import { sample } from "../web/tesseract/types";
import { tesseractPresets } from "../web/tesseract/presets";
import { colorSchemes } from "../web/color-schemes";
import {
  artwork,
  counts,
  crystal,
  markerAt,
  meta,
  open,
  pathPoints,
  raster,
  screenOf,
  selected,
  selectedField,
  settle,
  signature,
  stage,
} from "./cell24-helpers";

// The 24-cell's perspective shadow (docs/tesseracts.md): after the shared
// rotation, P(x, y, z, w) = d(x, y, z)/(d − w), with 2.05 ≤ d ≤ 20 and the
// fixed framing radius √2·d/√(d² − 2).
const perspective = "Into the crystal";
const framing = (d: number) => (Math.SQRT2 * d) / Math.sqrt(d * d - 2);
const eye = (p: Page) =>
  p.getByRole("textbox", { name: "4D eye distance", exact: true });
const eyeField = (p: Page) =>
  p.locator(".field").filter({
    has: p.locator(".field-label > label").getByText("4D eye distance", {
      exact: true,
    }),
  });
const viewMenu = (p: Page) =>
  p.getByRole("combobox", { name: "View of the 24-cell" });
const object = (p: Page) => p.getByRole("combobox", { name: "4D object" });
const readout = (p: Page, label: string) =>
  p
    .locator(".lift-readout > span")
    .filter({ hasText: `${label}:` })
    .locator("b");
const drawnPaths = (p: Page) =>
  artwork(p)
    .locator("path[data-source]")
    .evaluateAll((es) =>
      es.map((e) => `${e.getAttribute("data-source")} ${e.getAttribute("d")}`),
    );
const openLink = async (p: Page, study: TesseractStudy) => {
  const token = await writeStudyLink("4d", study);
  await p.goto("about:blank");
  await p.goto(`/?study=4d#s=${token}`);
  await expect(p).not.toHaveURL(/#s=/);
  await settle(p);
};

test("the perspective shadow draws the same roles, frames by distance alone, and its diagonals meet off their midpoints", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page);
  const orthogonal = await readout(page, "Longest shadow edge").textContent();
  await expect(viewMenu(page).locator("option")).toHaveText([
    "Orthogonal shadow",
    "Perspective shadow",
    "Parallel cross-sections",
  ]);
  await viewMenu(page).selectOption("perspective");
  await settle(page);
  await expect(eye(page)).toHaveValue("4");
  const m = await meta(page);
  expect(m.operation).toBe("perspective");
  expect(m.framingRadius).toBeCloseTo(framing(4), 14);
  expect(m.polytope.projection).toContain("d(x, y, z) / (d − w)");
  expect(m.limitations).not.toContain("no perspective");
  expect(await counts(page)).toEqual({
    cell: 12,
    diagonal: 3,
    spoke: 8,
    vertex: 8,
    center: 1,
  });
  await expect(artwork(page).locator("text, foreignObject")).toHaveCount(0);
  // Lines stay lines: every projected diagonal passes through the drawn
  // center, which is no longer its midpoint.
  const [cx, cy] = await markerAt(page, "cell24/dual/vertex/0");
  let offMidpoint = 0;
  for (const [ax, ay, bx, by] of await pathPoints(
    page,
    'path[data-role="diagonal"]',
  )) {
    const l = Math.hypot(bx - ax, by - ay);
    const s = ((cx - ax) * (bx - ax) + (cy - ay) * (by - ay)) / (l * l);
    expect(
      Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / l,
    ).toBeLessThan(0.01);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
    offMidpoint = Math.max(
      offMidpoint,
      Math.hypot((ax + bx) / 2 - cx, (ay + by) / 2 - cy),
    );
  }
  expect(offMidpoint).toBeGreaterThan(1);
  // Each dual edge still starts at the center.
  for (const d of await pathPoints(page, 'path[data-role="spoke"]')) {
    expect(Math.abs(d[0] - cx)).toBeLessThan(0.002);
    expect(Math.abs(d[1] - cy)).toBeLessThan(0.002);
  }
  // Projected lengths change; the source length does not.
  await expect(readout(page, "Longest shadow edge")).not.toHaveText(
    orthogonal!,
  );
  await expect(readout(page, "Cell edges in 4D")).toHaveText("√2 ≈ 1.414");
  await expect(page.locator(".tesseract-explanation h2")).toHaveText(
    "Looking into the crystal",
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
  // The help names the 24-cell's own sphere; the tesseract keeps its own.
  await expect(eyeField(page).locator(".hint").first()).toContainText("√2");
  await object(page).selectOption("tesseract");
  await settle(page);
  await expect(eyeField(page).locator(".hint").first()).toHaveText(
    "From 2.05 to 20, so the eye stays outside the tesseract.",
  );
});

test("the eye distance is validated only in perspective, and each object keeps its own", async ({
  page,
}) => {
  await open(page);
  await viewMenu(page).selectOption("perspective");
  await settle(page);
  await eye(page).fill("2");
  await expect(eyeField(page).getByRole("alert")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(1);
  await expect(stage(page).locator(".stale-study")).toBeVisible();
  // An unfinished distance does not block the orthogonal shadow.
  await viewMenu(page).selectOption("orthographic");
  await settle(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect((await meta(page)).framingRadius).toBe(Math.SQRT2);
  // Entering perspective again reconciles only that newly active value.
  await viewMenu(page).selectOption("perspective");
  await settle(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(eye(page)).toHaveValue("2.05");
  expect((await meta(page)).config.distance).toBe(2.05);
  // Constant expressions, as in every scalar field; variables are refused.
  await eye(page).fill("1+phi");
  await expect
    .poll(async () => (await meta(page)).config.distance)
    .toBeCloseTo((3 + Math.sqrt(5)) / 2, 15);
  await eye(page).fill("t");
  await expect(eyeField(page).getByRole("alert")).toBeVisible();
  await eye(page).fill("3");
  await selectedField(page).fill("9");
  await expect
    .poll(async () => (await meta(page)).config)
    .toMatchObject({ distance: 3, cell24: { selected: 8 } });
  // The tesseract's own distance is separate.
  await object(page).selectOption("tesseract");
  await settle(page);
  await expect(eye(page)).toHaveValue("4");
  await eye(page).fill("5");
  await expect.poll(async () => (await meta(page)).config.distance).toBe(5);
  await object(page).selectOption("cell24");
  await settle(page);
  const back = (await meta(page)).config;
  expect(back).toMatchObject({
    mode: "perspective",
    distance: 3,
    cell24: { selected: 8 },
  });
  await object(page).selectOption("tesseract");
  await settle(page);
  expect((await meta(page)).config.distance).toBe(5);
  // A link with an out-of-range inactive distance still opens its
  // orthogonal shadow, and perspective then starts from a valid one.
  const legacy = presetStudy(
    tesseractPresets.findIndex((p) => p.name === signature),
  );
  legacy.config.distance = 1;
  await openLink(page, legacy);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect((await meta(page)).operation).toBe("orthographic");
  await viewMenu(page).selectOption("perspective");
  await settle(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect((await meta(page)).config.distance).toBe(2.05);
});

test("in perspective, taps select the drawn centers, coincident centers take turns, and [ ] step", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page, crystal);
  await viewMenu(page).selectOption("perspective");
  for (const axis of ["xy", "xz", "yz", "xw", "yw", "zw"])
    await page
      .getByRole("textbox", { name: `${axis} angle`, exact: true })
      .fill("0");
  await settle(page);
  expect((await meta(page)).config.angles).toEqual([0, 0, 0, 0, 0, 0]);
  // Unrotated, ±e_w (dual vertices 11 and 12) both project to the origin;
  // (½, ½, ½, ±½) (dual vertices 1 and 2), whose orthogonal shadows
  // coincide, are separated.
  expect(await markerAt(page, "cell24/dual/vertex/11")).toEqual(
    await markerAt(page, "cell24/dual/vertex/12"),
  );
  const [a, b] = [
    await markerAt(page, "cell24/dual/vertex/1"),
    await markerAt(page, "cell24/dual/vertex/2"),
  ];
  expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThan(20);
  for (const k of [2, 1]) {
    const at = await screenOf(page, `cell24/dual/vertex/${k}`);
    await page.mouse.click(at.x, at.y);
    await settle(page);
    expect(await selected(page)).toBe(k);
  }
  const origin = await screenOf(page, "cell24/dual/vertex/11");
  for (const expected of [11, 12, 11]) {
    await page.mouse.click(origin.x, origin.y);
    await settle(page);
    expect(await selected(page)).toBe(expected);
  }
  await artwork(page).focus();
  await page.keyboard.press("]");
  await settle(page);
  expect(await selected(page)).toBe(12);
  await page.keyboard.press("[");
  await page.keyboard.press("[");
  await settle(page);
  expect(await selected(page)).toBe(10);
  await expect(selectedField(page)).toHaveValue("11");
  // The help says that distinct cells can coincide in a view.
  const toggle = page.getByRole("button", {
    name: "About Selected cell",
    exact: true,
  });
  await toggle.click();
  const help = page.locator(`#${await toggle.getAttribute("aria-controls")}`);
  await help.getByRole("button", { name: "Show more" }).click();
  await expect(help.locator(".hint-more")).toContainText(
    "Distinct cells can coincide in a particular view",
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
});

// Everything drawn lies within the 1000 × 760 frame at the opening zoom.
const inFrame = async (p: Page) => {
  const points = (await pathPoints(p, "path[data-source]")).flat();
  for (let i = 0; i < points.length; i += 2) {
    expect(points[i]).toBeGreaterThan(0);
    expect(points[i]).toBeLessThan(1000);
    expect(points[i + 1]).toBeGreaterThan(0);
    expect(points[i + 1]).toBeLessThan(760);
  }
};

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
])
  test(`the highest admitted magnification stays framed, with reachable controls, at ${viewport.width}×${viewport.height}`, async ({
    browser,
  }) => {
    const phone = viewport.width < 600;
    const context = await browser.newContext({
      viewport,
      hasTouch: phone,
      isMobile: phone,
    });
    const page = await context.newPage();
    await open(page, perspective);
    await eye(page).fill("2.05");
    await expect
      .poll(async () => (await meta(page)).config.distance)
      .toBe(2.05);
    await settle(page);
    expect((await meta(page)).framingRadius).toBeCloseTo(framing(2.05), 14);
    for (const xw of ["0", "pi/2", "pi", "-pi/3"]) {
      await page
        .getByRole("textbox", { name: "xw angle", exact: true })
        .fill(xw);
      await settle(page);
      await inFrame(page);
    }
    await eye(page).scrollIntoViewIfNeeded();
    await expect(eye(page)).toBeInViewport();
    const fits = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      screen: document.documentElement.clientWidth,
      readouts: [...document.querySelectorAll(".lift-readout b")]
        .filter((b) => b.scrollWidth > b.clientWidth + 0.5)
        .map((b) => b.textContent),
    }));
    expect(fits.page).toBeLessThanOrEqual(fits.screen);
    expect(fits.readouts).toEqual([]);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await context.close();
  });

test("a perspective link and still carry the distance, selection and camera; older links keep their drawings", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page, perspective);
  await eye(page).fill("3.5");
  await selectedField(page).fill("17");
  await artwork(page).focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("+");
  await expect
    .poll(async () => (await meta(page)).config)
    .toMatchObject({ distance: 3.5, cell24: { selected: 16 } });
  await settle(page);
  const live = await meta(page),
    paths = await drawnPaths(page);
  const download = page.waitForEvent("download");
  await exportImage(page, "SVG");
  const svg = await readFile((await (await download).path())!, "utf8");
  expect(svg).not.toMatch(/<text|<foreignObject/);
  const exported = JSON.parse(
    svg.match(/<desc>([^<]*)<\/desc>/)![1].replace(/&quot;/g, '"'),
  );
  expect(exported.config).toEqual(live.config);
  expect(exported.view).toEqual(live.view);
  expect(exported.polytope).toEqual(live.polytope);
  expect(exported.framingRadius).toBe(live.framingRadius);
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  await page.goto("about:blank");
  await page.goto(url.replace(/^https?:\/\/[^/]+/, ""));
  await settle(page);
  const reopened = await meta(page);
  expect(reopened.config).toEqual(live.config);
  expect(reopened.view).toEqual(live.view);
  expect(await drawnPaths(page)).toEqual(paths);
  // Older 24-cell links open their orthogonal and section drawings as the
  // examples do, with their cameras.
  for (const name of [signature, crystal, "A crystal meeting its own dual"]) {
    const index = tesseractPresets.findIndex((p) => p.name === name);
    await open(page, name);
    const example = await meta(page),
      drawn = await drawnPaths(page);
    const study = presetStudy(index);
    await openLink(page, study);
    const linked = await meta(page);
    expect(linked.operation, name).toBe(example.operation);
    expect(linked.operation, name).not.toBe("perspective");
    expect(linked.framingRadius, name).toBe(Math.SQRT2);
    expect(linked.view, name).toEqual(example.view);
    expect(await drawnPaths(page), name).toEqual(drawn);
  }
});

test("the perspective rotation loops, scrubs backward and stops with fixed framing, matching the direct view and its exports", async ({
  page,
}) => {
  test.slow();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page, perspective);
  const entered = await meta(page),
    enteredPaths = await drawnPaths(page),
    preset = tesseractPresets.find((p) => p.name === perspective)!;
  expect(entered.config).toEqual(preset.config);
  expect(preset.motion).toBe("double");
  expect(preset.repeat).toBe("loop");
  const radius = framing(entered.config.distance);
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill("1");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.locator(".animation-error, [role=alert]")).toHaveCount(0);
  const slider = page.getByRole("slider", { name: "Animation progress" });
  // Forward, then backward: each frame is the direct view of the sampled
  // rotation, with the same framing radius.
  const frames: Record<string, string[]> = {};
  for (const t of ["0.6", "0.3", "0.45"]) {
    await slider.fill(t);
    await expect(stage(page)).toHaveAttribute("data-time", t);
    await settle(page);
    const m = await meta(page);
    expect(m.framingRadius, t).toBeCloseTo(radius, 14);
    frames[t] = await drawnPaths(page);
  }
  const references: number[][] = [];
  for (const t of ["0", "0.4"]) {
    await slider.fill(t);
    await settle(page);
    references.push(await raster(page, 1000, 760));
  }
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await settle(page);
  expect((await meta(page)).config).toEqual(entered.config);
  expect(await drawnPaths(page)).toEqual(enteredPaths);
  // The exported movie: duration, frame count and frames.
  await openShapeExport(page);
  await page
    .getByRole("combobox", { name: "Export format" })
    .selectOption("mp4");
  await page
    .getByRole("slider", { name: "Export resolution", exact: true })
    .fill("1");
  await page
    .getByRole("combobox", { name: "Export frame rate" })
    .selectOption("15");
  await page
    .getByRole("slider", { name: "Export quality", exact: true })
    .fill("100");
  const download = page.waitForEvent("download");
  const started = Date.now();
  await page.getByRole("button", { name: /^Export MP4 video/ }).click();
  const path = (await (await download).path())!;
  console.log(
    `${perspective}: 1s / 15fps / 1000×760 MP4 saved in ${Date.now() - started} ms`,
  );
  const p = probe(path);
  if (p) {
    expect([p.width, p.height, p.frames]).toEqual([1000, 760, 15]);
    expect(p.durations.reduce((a, b) => a + b, 0)).toBe(1000);
  }
  expect((await decodeVideo(page, await readFile(path))).duration).toBeCloseTo(
    1,
    3,
  );
  for (const [k, index] of [0, 6].entries()) {
    const d = frameDifference(path, 1000, 760, index, references[k]);
    if (d) {
      expect(d.meanDifference).toBeLessThan(6);
      expect(d.unmatchedInk).toBeLessThan(0.02);
    }
  }
  // A link to each sampled rotation draws the scrubbed frame exactly.
  const base = presetStudy(
    tesseractPresets.findIndex((p) => p.name === perspective),
  );
  for (const t of ["0.6", "0.3"]) {
    await openLink(page, {
      ...base,
      config: sample(base.config, "double", Number(t)),
    });
    expect(await drawnPaths(page), t).toEqual(frames[t]);
  }
});

test("roles keep distinct inks matching the legend in both themes and an alternate palette", async ({
  page,
}) => {
  const roles = ["primal", "cell", "dual", "spoke"];
  const labels = [
    "24-cell",
    "Selected octahedral cell",
    "Dual vertices and edges",
    "The cell's center, a dual vertex",
  ];
  const alternate = colorSchemes.find((s) => s.id !== "default")!.id;
  for (const [theme, scheme] of [
    ["light", "default"],
    ["dark", "default"],
    ["dark", alternate],
  ] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await open(page, perspective);
    if (scheme !== "default") {
      await chooseColorScheme(page, scheme);
      await settle(page);
    }
    const inks = await Promise.all(
      roles.map((r) =>
        artwork(page)
          .locator(`path[data-role="${r}"]`)
          .first()
          .getAttribute("stroke"),
      ),
    );
    expect(new Set(inks).size, `${theme} ${scheme}`).toBe(4);
    const normalize = (c: string) =>
      page.evaluate((c) => {
        const d = document.createElement("i");
        d.style.color = c;
        document.body.append(d);
        const v = getComputedStyle(d).color;
        d.remove();
        return v;
      }, c);
    for (const [i, label] of labels.entries()) {
      const swatch = await page
        .locator(".tesseract-legend span, .tesseract-legend li")
        .filter({ hasText: label })
        .first()
        .locator("i")
        .evaluate((i) => getComputedStyle(i).backgroundColor);
      expect(swatch, `${theme} ${scheme}: ${label}`).toBe(
        await normalize(inks[i]!),
      );
    }
  }
});

// Control-to-drawing time for the densest perspective study against the
// orthogonal crystal, and Stop during playback. Generous bounds; these are
// observations, not benchmarks.
test("edits and Stop in the perspective crystal respond like the orthogonal crystal", async ({
  page,
}) => {
  // Waits frame by frame for the settled drawing's metadata to reach a
  // value: the selected cell, the framing radius or the xw angle.
  const drawn = (key: "cell" | "radius" | "xw", value: number) =>
    page.waitForFunction(
      ([key, value]) => {
        const desc = document.querySelector("#tesseract-artwork > desc");
        if (
          !desc ||
          document
            .querySelector(".tesseract-stage")!
            .getAttribute("aria-busy") !== "false"
        )
          return false;
        const m = JSON.parse(desc.textContent!);
        return (
          (key === "cell"
            ? m.polytope.selectedCell
            : key === "radius"
              ? m.framingRadius
              : m.config.angles[3]) === value
        );
      },
      [key, value] as const,
      { polling: "raf" },
    );
  const time = async (
    edit: () => Promise<unknown>,
    done: () => Promise<unknown>,
  ) => {
    const start = Date.now();
    await edit();
    await done();
    return Date.now() - start;
  };
  const measure = async (name: string) => {
    const selection: number[] = [];
    for (const n of [9, 10, 11, 12, 13])
      selection.push(
        await time(
          () => selectedField(page).fill(String(n)),
          () => drawn("cell", n - 1),
        ),
      );
    const distance: number[] = [];
    if (name === perspective)
      for (const d of [2.05, 3, 2.05, 20, 2.05])
        distance.push(
          await time(
            () => eye(page).fill(String(d)),
            () => drawn("radius", framing(d)),
          ),
        );
    await page
      .getByRole("spinbutton", { name: "Duration (seconds)" })
      .fill("4");
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await expect(stage(page)).not.toHaveAttribute("data-progress", "0");
    const entered = tesseractPresets.find((p) => p.name === name)!.config
      .angles[3];
    const stop = await time(
      () => page.getByRole("button", { name: "Stop", exact: true }).click(),
      () => drawn("xw", entered),
    );
    console.log(
      `${name}: selection control-to-drawing ${selection.join(", ")} ms;${distance.length ? ` eye distance ${distance.join(", ")} ms;` : ""} Stop to entered drawing ${stop} ms`,
    );
    expect(Math.max(...selection, ...distance, stop)).toBeLessThan(10000);
  };
  await open(page, crystal);
  await measure(crystal);
  await open(page, perspective);
  await measure(perspective);
});
