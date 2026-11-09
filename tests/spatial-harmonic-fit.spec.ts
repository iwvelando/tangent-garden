import { test, expect, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { deflateRawSync } from "node:zlib";
import { changedPixels, choosePreset, exportImage } from "./helpers";
import { decodePng } from "./png";
import { wireStudy } from "./study-link-wire";
import { decodeVideo, frameDifference, probe } from "./video";
import {
  harmonicFitOpeningView,
  harmonicFitStudy,
} from "../web/spatial/harmonic-fit";
import { presetStudy, spatialStudy } from "../web/spatial/link";
import { pathError } from "../web/spatial/path";
import { fitSourceEdges, initialView, viewBasis } from "../web/spatial/scene";
import type { Vec3 } from "../web/spatial/types";

const stage = (page: Page) => page.locator(".spatial-stage");
const entry = (page: Page) =>
  page.getByRole("button", { name: "Fit into harmonic terms" });
const dialog = (page: Page) => page.locator(".harmonic-fit");
const notebook = "/?study=3d";

async function ready(page: Page, url = notebook) {
  await page.goto(url);
  await expect(page.locator("#spatial-artwork")).toBeVisible();
  await expect(stage(page)).toHaveAttribute("aria-busy", "false");
}
async function open(page: Page) {
  await entry(page).click();
  await expect(dialog(page)).toBeVisible();
}
// The fit the engine returned for what the dialog shows.
async function fit(page: Page) {
  await expect(dialog(page)).toHaveAttribute("data-pending", "false");
  return JSON.parse((await dialog(page).getAttribute("data-fit"))!);
}
async function setTerms(page: Page, count: number) {
  await page.getByLabel("Terms", { exact: true }).selectOption(String(count));
  await expect(dialog(page)).toHaveAttribute("data-count", String(count));
}

test("the notebook offers the fit with its own picture, except during playback", async ({
  page,
}) => {
  await ready(page);
  await expect(entry(page)).toBeEnabled();
  await expect(entry(page).locator("svg.icon")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
  await page.getByLabel("Duration (seconds)").fill("30");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect(entry(page)).toBeDisabled();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(entry(page)).toBeEnabled();
  // Nothing of the research gate remains: a parameter means nothing to it.
  await ready(page, "/?study=3d&research=spatial-fit");
  await expect(entry(page)).toBeEnabled();
  await open(page);
  await expect(dialog(page)).not.toContainText("RESEARCH");
});

test("a torus knot is recovered exactly, term by term, by its own parameter", async ({
  page,
}) => {
  await ready(page);
  await open(page);
  const whole = await fit(page);
  expect(whole.parameter).toBe("source");
  // A torus knot expands to frequencies p, q, p+q and |p−q| by hand.
  expect(whole.available).toBe(4);
  expect(whole.rms).toBeLessThan(1e-12);
  await expect(dialog(page).getByTestId("fit-error")).toContainText("rounding");
  // Fewer terms give a real, displayed, monotonic error.
  const rms = [];
  for (const count of [1, 2, 3, 4]) {
    await setTerms(page, count);
    const f = await fit(page);
    expect(f.curve.terms).toHaveLength(count);
    rms.push(f.rms);
  }
  expect(rms[0]).toBeGreaterThan(rms[1]);
  expect(rms[1]).toBeGreaterThan(rms[2]);
  expect(rms[2]).toBeGreaterThan(0.01);
  expect(rms[3]).toBeLessThan(1e-12);
  // The chain never reorders as terms are added.
  await setTerms(page, 2);
  const two = (await fit(page)).curve.terms;
  await setTerms(page, 4);
  expect((await fit(page)).curve.terms.slice(0, 2)).toEqual(two);
});

test("even pace trades exact recovery for independence from the source's speed", async ({
  page,
}) => {
  await ready(page);
  await open(page);
  await page.getByRole("radio", { name: /Even pace/ }).check();
  const arc = await fit(page);
  expect(arc.parameter).toBe("arc-length");
  expect(arc.rms).toBeGreaterThan(1e-4);
  expect(arc.available).toBe(8);
  // Choosing the parameter again recovers the exact fit, after pending work.
  await page.getByRole("radio", { name: /Source parameter/ }).check();
  expect((await fit(page)).rms).toBeLessThan(1e-12);
});

test("each term is described as the ellipse it traces, not a circle", async ({
  page,
}) => {
  await ready(page);
  await open(page);
  const rows = dialog(page).getByTestId("fit-term");
  await expect(rows).toHaveCount(4);
  // The knot's vertical wave is a segment along the axis.
  await expect(rows.filter({ hasText: "segment" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "circle" })).toHaveCount(3);
});

test("the error's explanation matches where the error comes from", async ({
  page,
}) => {
  await ready(page);
  await open(page);
  await fit(page);
  const note = dialog(page).getByTestId("fit-remainder");
  await expect(note).toContainText("all of this source's terms");
  await setTerms(page, 2);
  await expect(note).toContainText("2 more");
  await expect(note).not.toContainText("finer");
});

// A custom expression study, settled.
async function expressions(page: Page, x: string, y: string, z: string) {
  await page
    .getByRole("combobox", { name: "Spatial definition" })
    .selectOption("parametric");
  await expect(stage(page)).toHaveAttribute("aria-busy", "false");
  await page.getByRole("textbox", { name: "x(t)", exact: true }).fill(x);
  await page.getByRole("textbox", { name: "y(t)", exact: true }).fill(y);
  await page.getByRole("textbox", { name: "z(t)", exact: true }).fill(z);
  await expect(stage(page)).toHaveAttribute("aria-busy", "false");
}
const gap = "sqrt(sin(t+0.3))";

test("a source no fit can honestly use is refused with its reason", async ({
  page,
}) => {
  await ready(page);
  await expressions(page, "cos(t)", "sin(t)", gap);
  await open(page);
  await expect(dialog(page)).toHaveAttribute("data-pending", "false");
  await expect(dialog(page).getByRole("alert")).toContainText("gap");
  await expect(page.getByTestId("fit-closure")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Adopt fitted study" }),
  ).toBeDisabled();
});

// An open helix, z rising by π/2 over the default domain 0..2π, so its ends
// lie straight above one another.
async function openHelix(page: Page) {
  await ready(page);
  await expressions(page, "cos(t)", "sin(t)", "t/4");
  await open(page);
  await expect(dialog(page)).toHaveAttribute("data-pending", "false");
  await expect(dialog(page)).toHaveAttribute("data-open", "true");
}
const closeOutline = (page: Page) =>
  dialog(page).getByRole("button", { name: "Close outline", exact: true });

test("an open curve appears as it is, and is fitted only once closed", async ({
  page,
}) => {
  await openHelix(page);
  const d = dialog(page);
  await expect(d).not.toHaveAttribute("data-fit", /./);
  await expect(d.getByRole("alert")).toHaveCount(0);
  await expect(page.getByTestId("fit-closure")).toContainText(
    "This curve is open.",
  );
  await expect(page.getByLabel("Terms", { exact: true })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Adopt fitted study" }),
  ).toBeDisabled();
  await expect(
    d.getByRole("button", { name: "Play animation", exact: true }),
  ).toBeDisabled();
  // The status beside Play says why it cannot play, not that it is ready.
  const status = d.locator(".timeline [role=status]");
  await expect(status).toHaveText("Close the outline to play.");
  // The source itself is drawn, across a fair share of the drawing.
  const art = d.locator("#journey-artwork");
  const ink = await inkBox(art);
  expect(Math.max(ink.width, ink.height)).toBeGreaterThan(0.3);
  const open = await pixels(art);

  await closeOutline(page).click();
  const f = await fit(page);
  expect(f.joined).toBeCloseTo(Math.PI / 2, 12);
  expect(f.curve.terms).toHaveLength(8);
  // Its corners need every frequency: never exact, and never said to be.
  expect(f.maxResidual).toBeGreaterThan(1e-3 * f.extent);
  await expect(page.getByTestId("fit-error")).not.toContainText("rounding");
  await expect(page.getByTestId("fit-closure")).toContainText(
    "straight segment of length 1.57",
  );
  await expect(closeOutline(page)).toHaveAttribute("aria-disabled", "true");
  await expect(d).toHaveAttribute("data-open", "true");
  await expect(
    page.getByRole("button", { name: "Adopt fitted study" }),
  ).toBeEnabled();
  await expect(
    d.getByRole("button", { name: "Play animation", exact: true }),
  ).toBeEnabled();
  await expect(status).toHaveText("Ready to play");
  expect(await pixels(art)).not.toBe(open);
});

test("a sampling choice waits for the close, and the close outlasts it", async ({
  page,
}) => {
  await openHelix(page);
  await page.getByRole("radio", { name: /Even pace/ }).check();
  await expect(dialog(page)).toHaveAttribute("data-pending", "false");
  await expect(dialog(page)).not.toHaveAttribute("data-fit", /./);
  await expect(dialog(page).getByRole("alert")).toHaveCount(0);
  await closeOutline(page).click();
  const even = await fit(page);
  expect(even.parameter).toBe("arc-length");
  expect(even.continuousBound).toBeGreaterThan(even.maxResidual);
  await expect(page.getByTestId("fit-error")).toContainText(
    "closed-up polygon",
  );
  await page.getByRole("radio", { name: /Source parameter/ }).check();
  await expect.poll(async () => (await fit(page)).parameter).toBe("source");
  const own = await fit(page);
  expect(own.joined).toBe(even.joined);
  await expect(closeOutline(page)).toHaveAttribute("aria-disabled", "true");
  // A unit-speed helix with its segment at the mean pace: the two agree.
  expect(Math.abs(own.rms - even.rms)).toBeLessThan(1e-3 * own.extent);
});

test("closing belongs to the excursion: Back forgets it, adoption keeps only terms", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await openHelix(page);
  const before = await stage(page).getAttribute("data-config");
  await closeOutline(page).click();
  await fit(page);
  await page.getByRole("button", { name: "Back to your study" }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(await stage(page).getAttribute("data-config")).toBe(before);
  await expect(
    page.getByRole("textbox", { name: "z(t)", exact: true }),
  ).toHaveValue("t/4");
  await expect(entry(page)).toBeFocused();
  // A new excursion starts open again.
  await open(page);
  await expect(dialog(page)).toHaveAttribute("data-pending", "false");
  await expect(dialog(page)).toHaveAttribute("data-open", "true");
  await expect(dialog(page)).not.toHaveAttribute("data-fit", /./);
  await closeOutline(page).click();
  const chosen = await fit(page);
  await page.getByRole("button", { name: "Adopt fitted study" }).click();
  await adopted(page);
  const config = (await stage(page).getAttribute("data-config"))!;
  expect(JSON.parse(config).harmonic.terms).toEqual(chosen.curve.terms);
  for (const transient of ["closing", "joined", "outline", "fitSource"])
    expect(config).not.toContain(transient);
  const link = JSON.stringify(await copied(page));
  for (const transient of ["closing", "joined", "outline", "fitSource"])
    expect(link).not.toContain(transient);
  await expect(page.getByTestId("closure-note")).toContainText("closed");
});

test("keyboard use keeps focus on Close outline after it closes", async ({
  page,
}) => {
  await openHelix(page);
  await closeOutline(page).focus();
  await page.keyboard.press("Enter");
  await fit(page);
  await expect(closeOutline(page)).toBeFocused();
  await expect(closeOutline(page)).toHaveAttribute("aria-disabled", "true");
  // Activating it again does nothing.
  const before = await dialog(page).getAttribute("data-fit");
  await page.keyboard.press("Enter");
  await expect(dialog(page)).toHaveAttribute("data-pending", "false");
  expect(await dialog(page).getAttribute("data-fit")).toBe(before);
});

test("closing keeps the drawing and the view the reader orbited to", async ({
  page,
}) => {
  await openHelix(page);
  const d = dialog(page),
    art = d.locator("#journey-artwork");
  await expect(art).toBeVisible();
  const opening = await across(d);
  const box = (await art.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  const orbited = await across(d);
  expect(Math.abs(orbited - opening)).toBeGreaterThan(0.1);
  // The canvas the reader orbited is the one the fit is drawn in.
  await art.evaluate((c) => c.setAttribute("data-orbited", ""));
  await closeOutline(page).click();
  await fit(page);
  await expect(d.locator("#journey-artwork[data-orbited]")).toHaveCount(1);
  expect(await across(d)).toBeCloseTo(orbited, 6);
});

test("returning keeps the raw study; adoption replaces it with an ordinary one", async ({
  page,
}) => {
  await ready(page);
  const radius = page.getByRole("textbox", {
    name: "Major radius R",
    exact: true,
  });
  await radius.fill("3*phi/2");
  await expect(stage(page)).toHaveAttribute("aria-busy", "false");
  const before = await stage(page).getAttribute("data-config");
  await open(page);
  await fit(page);
  await page.getByRole("button", { name: "Back to your study" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(radius).toHaveValue("3*phi/2");
  expect(await stage(page).getAttribute("data-config")).toBe(before);
  await expect(entry(page)).toBeFocused();
  // Escape returns too.
  await open(page);
  await fit(page);
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(radius).toHaveValue("3*phi/2");

  await open(page);
  const chosen = await fit(page);
  await page.getByRole("button", { name: "Adopt fitted study" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect
    .poll(async () => {
      const text = await stage(page).getAttribute("data-config");
      return JSON.parse(text!).format;
    })
    .toBe("harmonic");
  await expect(stage(page)).toHaveAttribute("aria-busy", "false");
  const study = JSON.parse((await stage(page).getAttribute("data-config"))!);
  expect(study.harmonic.terms).toEqual(chosen.curve.terms);
  await expect(page.getByTestId("closure-note")).toContainText("closed");
});

test("the preview plays through the ordinary reveal and keeps its framing", async ({
  page,
}) => {
  await ready(page);
  await open(page);
  await fit(page);
  const art = dialog(page).locator("#journey-artwork");
  await expect(art).toBeVisible();
  const before = await art.evaluate((c: HTMLCanvasElement) => c.toDataURL());
  await setTerms(page, 1);
  await expect
    .poll(() => art.evaluate((c: HTMLCanvasElement) => c.toDataURL()))
    .not.toBe(before);
  await dialog(page)
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect(
    dialog(page).getByRole("button", { name: "Stop", exact: true }),
  ).toBeVisible();
});

test("an expression study with a whole number of terms fits through the same path", async ({
  page,
}) => {
  await ready(page);
  await choosePreset(page, "12");
  await expect(stage(page)).toHaveAttribute("aria-busy", "false");
  await open(page);
  const f = await fit(page);
  // A harmonic source's terms come back as themselves.
  expect(f.available).toBeLessThanOrEqual(8);
  expect(f.rms).toBeLessThan(1e-12);
});

test("the source's current settled values are what is fitted", async ({
  page,
}) => {
  await ready(page);
  const radius = page.getByRole("textbox", {
    name: "Major radius R",
    exact: true,
  });
  await radius.fill("3");
  // Entered at once: the entry waits for the value to settle.
  await open(page);
  const terms = (await fit(page)).curve.terms;
  expect(terms[0].frequency).toBe(2);
  expect(terms[0].cosine).toEqual({ x: 3, y: 0, z: 0 });
});

test("a derived or integrated study cannot be entered, and says so", async ({
  page,
}) => {
  await ready(page);
  await expect(entry(page)).toBeEnabled();
  await page
    .getByRole("combobox", { name: "Spatial definition" })
    .selectOption("field");
  await expect(stage(page)).toHaveAttribute("aria-busy", "false");
  await expect(entry(page)).toBeDisabled();
  await page.getByRole("button", { name: /harmonic fitting/ }).click();
  await expect(
    page.getByText("Fit a torus knot, expression or harmonic curve"),
  ).toBeVisible();
});

test("changing terms stops playback, and leaving discards unfinished work", async ({
  page,
}) => {
  await ready(page);
  await open(page);
  await fit(page);
  await dialog(page).getByRole("button", { name: "Play animation" }).click();
  const stop = dialog(page).getByRole("button", { name: "Stop", exact: true });
  await expect(stop).toBeEnabled();
  await setTerms(page, 2);
  await expect(stop).toBeDisabled();
  await expect(
    dialog(page).getByRole("button", { name: "Play animation" }),
  ).toBeEnabled();
  // A parameter change and an immediate return leave no state behind.
  await page.getByRole("radio", { name: /Even pace/ }).check();
  await page.getByRole("button", { name: "Back to your study" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(stage(page)).toHaveAttribute("aria-busy", "false");
  expect(
    JSON.parse((await stage(page).getAttribute("data-config"))!).format,
  ).toBe("torus");
});

test("the source and framing never reach an adopted study, its link or its movie", async ({
  page,
}) => {
  await ready(page);
  await open(page);
  const chosen = await fit(page);
  await page.getByRole("button", { name: "Adopt fitted study" }).click();
  await expect
    .poll(
      async () =>
        JSON.parse((await stage(page).getAttribute("data-config"))!).format,
    )
    .toBe("harmonic");
  await expect(stage(page)).toHaveAttribute("aria-busy", "false");
  const config = await stage(page).getAttribute("data-config");
  expect(config).not.toContain("fitSource");
  expect(config).not.toContain("outline");
  // An ordinary study: its terms edit like any other's.
  await expect(
    page.getByRole("textbox", { name: "Frequency ω₁", exact: true }),
  ).toHaveValue(String(chosen.curve.terms[0].frequency));
  // Its movie decodes, at its duration, through the ordinary export.
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
  await page.getByLabel("Duration (seconds)").fill("0.4");
  await page.locator("#spatial-export-settings > summary").click();
  await page.getByLabel("Export format", { exact: true }).selectOption("mp4");
  await page.getByLabel("Export frame rate").selectOption("15");
  await page
    .getByRole("slider", { name: "Export resolution", exact: true })
    .fill("1");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export MP4/ }).click();
  const file = await download,
    path = (await file.path())!;
  const data = probe(path);
  if (data) {
    expect(data.frames).toBe(6);
    expect(data.durations.reduce((a, b) => a + b, 0)).toBe(400);
  }
  const video = await decodeVideo(page, await readFile(path));
  expect(video.duration).toBeCloseTo(0.4, 3);
  expect(video.first.hash).not.toBe(video.last.hash);
});

// How open a set of points looks from a view: the spreads along the principal
// axes of its projection through the production camera's rows.
function spreads(
  points: Vec3[],
  view: ReturnType<typeof harmonicFitOpeningView>,
) {
  const { right, up } = viewBasis({
    ...view,
    center: { x: 0, y: 0, z: 0 },
    radius: 1,
  });
  const dot = (a: number[], p: Vec3) => a[0] * p.x + a[1] * p.y + a[2] * p.z;
  const xs = points.map((p) => dot(right, p)),
    ys = points.map((p) => dot(up, p));
  const mean = (v: number[]) => v.reduce((a, b) => a + b) / v.length;
  const mx = mean(xs),
    my = mean(ys);
  const a = mean(xs.map((x) => (x - mx) ** 2)),
    b = mean(ys.map((y) => (y - my) ** 2)),
    c = mean(xs.map((x, i) => (x - mx) * (ys[i] - my)));
  const root = Math.hypot((a - b) / 2, c);
  return {
    major: Math.sqrt((a + b) / 2 + root),
    minor: Math.sqrt(Math.max(0, (a + b) / 2 - root)),
  };
}
const circleIn = (u: number[], v: number[]): Vec3[] =>
  Array.from({ length: 400 }, (_, i) => {
    const t = (2 * Math.PI * i) / 400,
      c = 2 * Math.cos(t),
      s = 2 * Math.sin(t);
    return {
      x: u[0] * c + v[0] * s,
      y: u[1] * c + v[1] * s,
      z: u[2] * c + v[2] * s,
    };
  });

test("a curve in any plane opens facing the reader, on the default view when it can", () => {
  const home = { ...initialView, center: { x: 0, y: 0, z: 0 }, radius: 1 };
  const { back } = viewBasis(home);
  // Edge-on to the default view: the plane contains the direction it looks.
  const across = [back[1], -back[0], 0];
  const norm = Math.hypot(...across);
  const edgeOn: [number[], number[]] = [back, across.map((x) => x / norm)];
  const planes: [string, number[], number[], boolean][] = [
    ["xy", [1, 0, 0], [0, 1, 0], true],
    ["xz", [1, 0, 0], [0, 0, 1], true],
    ["yz", [0, 1, 0], [0, 0, 1], false],
    ["tilted", ...edgeOn, false],
  ];
  for (const [name, u, v, keepsDefault] of planes) {
    const points = circleIn(u, v);
    const view = harmonicFitOpeningView(points);
    const { major, minor } = spreads(points, view);
    expect(minor / major, name).toBeGreaterThan(0.3);
    expect(view.zoom, name).toBe(1);
    expect(view.panX, name).toBe(0);
    expect(view.panY, name).toBe(0);
    if (keepsDefault) expect(view, name).toEqual(initialView);
    else
      expect(
        view.yaw === initialView.yaw && view.pitch === initialView.pitch,
        name,
      ).toBe(false);
  }
});

test("a doubled segment takes the view that shows it longest of those it would be thin in", () => {
  const { back } = viewBasis({
    ...initialView,
    center: { x: 0, y: 0, z: 0 },
    radius: 1,
  });
  const along = (d: number[]): Vec3[] =>
    Array.from({ length: 400 }, (_, i) => {
      const s = 2 * Math.sin((2 * Math.PI * i) / 400);
      return { x: d[0] * s, y: d[1] * s, z: d[2] * s };
    });
  // Straight toward the default view it would be a dot.
  const toward = along(back);
  const view = harmonicFitOpeningView(toward);
  expect(spreads(toward, view).major).toBeGreaterThan(0.5);
  // Any other segment keeps the default view.
  expect(harmonicFitOpeningView(along([1, 0, 0]))).toEqual(initialView);
  // In any direction: a straight line's width is rounding, which decides nothing.
  for (const d of [
    [1, 2, 3],
    [-0.3, 0.7, 0.2],
    [0.6, -0.1, 0.9],
  ]) {
    const norm = Math.hypot(...d);
    expect(harmonicFitOpeningView(along(d.map((x) => x / norm)))).toEqual(
      initialView,
    );
  }
});

// The source is drawn whole and the segment that closes it dashed, so what
// closure added reads as added; a closed source has no dashes at all.
test("the closing segment is dashed beneath the fit, the source drawn whole", () => {
  const half: Vec3[] = Array.from({ length: 65 }, (_, i) => ({
    x: Math.cos((Math.PI * i) / 64),
    y: Math.sin((Math.PI * i) / 64),
    z: 0,
  }));
  const edges = fitSourceEdges({ points: [...half, half[0]], closing: 64 });
  const pairs: [Vec3, Vec3][] = [];
  for (let i = 0; i < edges.length; i += 2)
    pairs.push([edges[i], edges[i + 1]]);
  for (let i = 0; i < 64; i++) expect(pairs[i]).toEqual([half[i], half[i + 1]]);
  const dashes = pairs.slice(64);
  expect(dashes.length).toBeGreaterThanOrEqual(3);
  let drawn = 0,
    x = -1;
  for (const [a, b] of dashes) {
    // On the diameter, in order from the source's end back to its start,
    // with a gap before each dash after the first.
    for (const p of [a, b])
      expect(Math.max(Math.abs(p.y), Math.abs(p.z))).toBeLessThan(1e-15);
    expect(a.x).toBeGreaterThanOrEqual(x);
    expect(b.x).toBeGreaterThan(a.x);
    if (x > -1) expect(a.x).toBeGreaterThan(x);
    x = b.x;
    drawn += b.x - a.x;
  }
  expect(dashes[0][0].x).toBe(-1);
  expect(dashes.at(-1)![1].x).toBe(1);
  expect(drawn / 2).toBeGreaterThan(0.4);
  expect(drawn / 2).toBeLessThan(0.65);

  const loop = [...half, ...half.slice(1).map((p) => ({ ...p, y: -p.y }))];
  const whole = fitSourceEdges({ points: loop });
  expect(whole).toHaveLength(2 * (loop.length - 1));
  for (let i = 1; i < loop.length; i++)
    expect([whole[2 * i - 2], whole[2 * i - 1]]).toEqual([
      loop[i - 1],
      loop[i],
    ]);
});

// The pixels of the drawing the reader can see: what differs from its paper.
const inkBox = (art: Locator) =>
  art.evaluate((c: HTMLCanvasElement) => {
    const copy = document.createElement("canvas");
    copy.width = c.width;
    copy.height = c.height;
    const g = copy.getContext("2d")!;
    g.drawImage(c, 0, 0);
    const { data } = g.getImageData(0, 0, c.width, c.height);
    let left = c.width,
      right = 0,
      top = c.height,
      bottom = 0;
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++) {
        const i = 4 * (y * c.width + x);
        const near =
          Math.abs(data[i] - data[0]) +
            Math.abs(data[i + 1] - data[1]) +
            Math.abs(data[i + 2] - data[2]) <
          24;
        if (near) continue;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    return {
      width: (right - left) / c.width,
      height: (bottom - top) / c.height,
    };
  });

for (const name of ["A knot shedding filaments", "Down a torus's tunnel"]) {
  test(`${name} opens visibly, with nothing of its camera`, async ({
    page,
  }) => {
    await ready(page);
    await choosePreset(page, { label: name });
    await expect(stage(page)).toHaveAttribute("aria-busy", "false");
    await open(page);
    await fit(page);
    const art = dialog(page).locator("#journey-artwork");
    await expect
      .poll(async () => (await inkBox(art)).width)
      .toBeGreaterThan(0.2);
    expect((await inkBox(art)).height).toBeGreaterThan(0.2);
    // Adoption opens on the same fresh camera, and a link carries it.
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByRole("button", { name: "Adopt fitted study" }).click();
    await expect
      .poll(
        async () =>
          JSON.parse((await stage(page).getAttribute("data-config"))!).format,
      )
      .toBe("harmonic");
    await expect(stage(page)).toHaveAttribute("aria-busy", "false");
    await page.getByRole("button", { name: "Copy link", exact: true }).click();
    await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    const study = wireStudy(/#s=(.*)$/.exec(link)![1]);
    expect(study.view.zoom).toBe(1);
    expect(study.view.panX).toBe(0);
    expect(study.view.panY).toBe(0);
    expect(study.projection).toBe("orthographic");
    expect(
      (await inkBox(page.locator("#spatial-artwork"))).width,
    ).toBeGreaterThan(0.2);
  });
}

const layouts = {
  desktop: { width: 1280, height: 800 },
  "short desktop": { width: 1280, height: 560 },
  "phone portrait": { width: 390, height: 844 },
  "phone landscape": { width: 844, height: 390 },
};
const pixels = (art: Locator) =>
  art.evaluate((c: HTMLCanvasElement) => c.toDataURL());
for (const [name, size] of Object.entries(layouts)) {
  test(`terms and sampling move nothing at ${name} size`, async ({ page }) => {
    await page.setViewportSize(size);
    await ready(page);
    await open(page);
    await fit(page);
    const d = dialog(page);
    const anchors = [
      page.getByLabel("Terms", { exact: true }),
      page.getByRole("radio", { name: /Source parameter/ }),
      page.getByRole("radio", { name: /Even pace/ }),
      d.locator("#journey-artwork"),
      d.getByRole("button", { name: "Play animation" }),
      d.getByRole("button", { name: "Reset view" }),
      page.getByRole("checkbox", { name: /Show the source/ }),
      page.getByRole("checkbox", { name: "Vector sums" }),
      page.getByRole("button", { name: "Adopt fitted study" }),
    ];
    // Choosing a term scrolls the dialog to the control; only layout counts.
    const where = async () => {
      await d.evaluate((e) => {
        e.scrollTop = 0;
      });
      return Promise.all(
        anchors.map(async (a) => {
          const box = (await a.boundingBox())!;
          return [box.x, box.y, box.width, box.height].map(Math.round);
        }),
      );
    };
    const before = await where();
    await setTerms(page, 1);
    expect(await where()).toEqual(before);
    await page.getByRole("radio", { name: /Even pace/ }).check();
    await fit(page);
    expect(await where()).toEqual(before);
    await setTerms(page, 8);
    expect(await where()).toEqual(before);
    await setTerms(page, 2);
    expect(await where()).toEqual(before);
    await page.getByRole("radio", { name: /Source parameter/ }).check();
    await fit(page);
    expect(await where()).toEqual(before);
  });

  test(`closing an open curve moves nothing at ${name} size`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await openHelix(page);
    const d = dialog(page);
    const anchors = [
      page.getByLabel("Terms", { exact: true }),
      page.getByRole("radio", { name: /Source parameter/ }),
      page.getByRole("radio", { name: /Even pace/ }),
      closeOutline(page),
      d.locator("#journey-artwork"),
      d.getByRole("button", { name: "Play animation" }),
      d.getByRole("button", { name: "Reset view" }),
      page.getByRole("checkbox", { name: /Show the source/ }),
      page.getByRole("checkbox", { name: "Vector sums" }),
      page.getByRole("button", { name: "Adopt fitted study" }),
    ];
    const where = async () => {
      await d.evaluate((e) => {
        e.scrollTop = 0;
      });
      return Promise.all(
        anchors.map(async (a) => {
          const box = (await a.boundingBox())!;
          return [box.x, box.y, box.width, box.height].map(Math.round);
        }),
      );
    };
    const before = await where();
    await closeOutline(page).click();
    await fit(page);
    expect(await where()).toEqual(before);
    await page.getByRole("radio", { name: /Even pace/ }).check();
    await fit(page);
    expect(await where()).toEqual(before);
  });

  test(`the view controls are reachable and leave the study alone at ${name} size`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await ready(page);
    await open(page);
    const chosen = await fit(page);
    const d = dialog(page),
      art = d.locator("#journey-artwork");
    await expect(art).toBeVisible();
    const opening = await pixels(art);
    const reset = d.getByRole("button", { name: "Reset view" }),
      front = d.getByRole("button", { name: "Front", exact: true });
    await reset.scrollIntoViewIfNeeded();
    await expect(reset).toBeInViewport();
    await expect(d.getByText(/Drag to orbit/)).toBeVisible();
    await front.click();
    await expect.poll(() => pixels(art)).not.toBe(opening);
    // Home is where the study opens; nothing asked for a new fit.
    await reset.click();
    await expect.poll(() => pixels(art)).toBe(opening);
    await d.getByRole("button", { name: "Top", exact: true }).click();
    await expect.poll(() => pixels(art)).not.toBe(opening);
    expect(await fit(page)).toEqual(chosen);
    // The study adopted is the fit, on its opening view.
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByRole("button", { name: "Adopt fitted study" }).click();
    await expect
      .poll(
        async () =>
          JSON.parse((await stage(page).getAttribute("data-config"))!).format,
      )
      .toBe("harmonic");
    await expect(stage(page)).toHaveAttribute("aria-busy", "false");
    const config = JSON.parse((await stage(page).getAttribute("data-config"))!);
    expect(config.harmonic.terms).toEqual(chosen.curve.terms);
  });
}

const curve = {
  center: { x: 0, y: 0, z: 0 },
  min: 0,
  max: 2 * Math.PI,
  terms: [
    { frequency: 2, cosine: { x: 2, y: 0, z: 0 }, sine: { x: 0, y: 2, z: 0 } },
    { frequency: 3, cosine: { x: 0, y: 0, z: 1 }, sine: { x: 0, y: 0, z: 0 } },
  ],
};
test("the prepared turn is an ordinary path, one whole turn from the opening view", () => {
  const view = { ...initialView, yaw: 1.1, pitch: 0.4 };
  const { animation } = harmonicFitStudy(curve, view);
  expect(animation.mode).toBe("reveal");
  expect(animation.camera).toBe("path");
  expect(animation.repeat).toBe("once");
  expect(pathError(animation.path)).toBeNull();
  const [from, to] = animation.path.keys;
  expect(animation.path.keys).toHaveLength(2);
  for (const k of [from, to]) {
    expect(k.yaw).toBe(view.yaw);
    expect(k.pitch).toBe(view.pitch);
    expect(k.zoom).toBe(1);
    expect(k.panX).toBe(0);
    expect(k.panY).toBe(0);
  }
  expect(from.turns).toBe(0);
  expect(to.turns).toBe(1);
  // A link reads it back as it was, with no new field.
  const study = harmonicFitStudy(curve, view);
  const back = spatialStudy(JSON.parse(JSON.stringify(study)));
  expect(back.animation.path).toEqual(animation.path);
  expect(back.animation.camera).toBe("path");
  expect(back.view).toEqual(view);
});

// The x axis across the indicator: the drawn camera's own right vector.
const across = (scope: Locator) =>
  scope
    .locator('[data-axis="x"] line')
    .evaluate((l) => +l.getAttribute("x2")! / 15);
test("the preview's reveal turns once around and ends where it opened", async ({
  page,
}) => {
  await ready(page);
  await open(page);
  await fit(page);
  const d = dialog(page),
    art = d.locator("#journey-artwork");
  await expect(art).toBeVisible();
  const opening = await across(d);
  expect(opening).toBeCloseTo(Math.cos(initialView.yaw), 6);
  const still = await pixels(art);
  await d.getByRole("button", { name: "Play animation" }).click();
  await d.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = d.getByRole("slider", { name: "Animation progress" });
  const at = async (p: number) => {
    await slider.fill(String(p));
    await expect
      .poll(() => across(d))
      .toBeCloseTo(Math.cos(initialView.yaw + 2 * Math.PI * p), 3);
  };
  await at(0);
  await at(0.25);
  await at(0.5);
  await at(1);
  // Whole again, on the view it opened with.
  await expect
    .poll(async () => changedPixels(page, still, await pixels(art)))
    .toBeLessThan(5);
});

test("an adopted study keeps the turn, through a link, and can hold instead", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await ready(page);
  await open(page);
  await fit(page);
  await page.getByRole("button", { name: "Adopt fitted study" }).click();
  await expect
    .poll(
      async () =>
        JSON.parse((await stage(page).getAttribute("data-config"))!).format,
    )
    .toBe("harmonic");
  await expect(stage(page)).toHaveAttribute("aria-busy", "false");
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
  const camera = page.getByLabel("Animation camera", { exact: true });
  await expect(camera).toHaveValue("path");
  const scope = page.locator(".camera-controls");
  await page.getByLabel("Duration (seconds)").fill("5");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", { name: "Animation progress" });
  await slider.fill("0.25");
  await expect
    .poll(() => across(scope))
    .toBeCloseTo(Math.cos(initialView.yaw + Math.PI / 2), 3);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  // A link carries it to a fresh page.
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  const study = wireStudy(/#s=(.*)$/.exec(link)![1]);
  expect(study.animation.camera).toBe("path");
  expect(study.animation.path.keys.map((k: any) => k.turns)).toEqual([0, 1]);
  const other = await page.context().newPage();
  await other.goto(link);
  await expect(other.locator(".spatial-stage")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  const otherPanel = other.locator("#spatial-animation-section");
  if ((await otherPanel.getAttribute("open")) === null)
    await otherPanel.locator(":scope > summary").click();
  await expect(
    other.getByLabel("Animation camera", { exact: true }),
  ).toHaveValue("path");
  await other.close();
  // One choice away from a camera that holds.
  await camera.selectOption("hold");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await slider.fill("0.25");
  await expect(stage(page)).toHaveAttribute("data-progress", "0.25");
  expect(await across(scope)).toBeCloseTo(Math.cos(initialView.yaw), 3);
});

const adopted = async (page: Page) => {
  await expect
    .poll(
      async () =>
        JSON.parse((await stage(page).getAttribute("data-config"))!).format,
    )
    .toBe("harmonic");
  await expect(stage(page)).toHaveAttribute("aria-busy", "false");
};
const copied = async (page: Page) => {
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  await expect(page.getByText("Link copied", { exact: true })).toBeHidden({
    timeout: 10000,
  });
  return wireStudy(
    /#s=(.*)$/.exec(
      await page.evaluate(() => navigator.clipboard.readText()),
    )![1],
  );
};
const linkTo = (study: unknown) =>
  `/?study=3d#s=${deflateRawSync(
    Buffer.from(JSON.stringify({ v: 1, notebook: "3d", study })),
  ).toString("base64url")}`;

test("Back and Escape restore the study whole: drafts, camera, layers, probe, cut, animation", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const start = presetStudy(0);
  const edited = {
    ...start,
    layers: { ...start.layers, rulings: !start.layers.rulings },
    view: { yaw: 1.1, pitch: 0.2, zoom: 1.4, panX: 0.1, panY: -0.1 },
    animation: {
      ...start.animation,
      duration: 23,
      pace: "ease",
      repeat: "back-and-forth",
    },
    probe: { ...start.probe, enabled: true, position: 0.3 },
    cut: { ...start.cut, enabled: true, offset: 0.2, edge: false },
    projection: "chosen",
    lensAngle: 70,
  };
  await ready(page, linkTo(edited));
  const radius = page.getByRole("textbox", {
    name: "Major radius R",
    exact: true,
  });
  await radius.fill("3*phi/2");
  await expect(stage(page)).toHaveAttribute("aria-busy", "false");
  const study = await copied(page);
  const drawing = page.locator("#spatial-artwork");
  const before = await pixels(drawing);
  for (const leave of [
    () => page.getByRole("button", { name: "Back to your study" }).click(),
    () => page.keyboard.press("Escape"),
  ]) {
    await open(page);
    await fit(page);
    // Whatever happens inside stays there.
    await setTerms(page, 1);
    await dialog(page)
      .getByRole("button", { name: "Front", exact: true })
      .click();
    await leave();
    await expect(dialog(page)).toHaveCount(0);
    await expect(radius).toHaveValue("3*phi/2");
    await expect(stage(page)).toHaveAttribute("aria-busy", "false");
    expect(await copied(page)).toEqual(study);
    await expect.poll(() => pixels(drawing)).toBe(before);
  }
});

test("rapid changes of terms and sampling end on what was asked last", async ({
  page,
}) => {
  await ready(page);
  await open(page);
  await fit(page);
  const d = dialog(page),
    art = d.locator("#journey-artwork");
  await setTerms(page, 2);
  await expect(d).toHaveAttribute("data-pending", "false");
  await expect.poll(() => pixels(art)).not.toBe("");
  const settledTwo = await pixels(art);
  // Every request, one after another with no pause for any reply.
  await page
    .getByLabel("Terms", { exact: true })
    .evaluate((s: HTMLSelectElement) => {
      for (const count of ["4", "1", "3", "2"]) {
        s.value = count;
        s.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
  await expect(d).toHaveAttribute("data-count", "2");
  await expect(d).toHaveAttribute("data-pending", "false");
  expect((await fit(page)).curve.terms).toHaveLength(2);
  await expect
    .poll(async () => changedPixels(page, settledTwo, await pixels(art)))
    .toBe(0);
  // Sampling back and forth, with a term change in flight.
  await page.getByRole("radio", { name: /Even pace/ }).check();
  await page.getByRole("radio", { name: /Source parameter/ }).check();
  await page.getByRole("radio", { name: /Even pace/ }).check();
  await page.getByLabel("Terms", { exact: true }).selectOption("3");
  await page.getByRole("radio", { name: /Source parameter/ }).check();
  const last = await fit(page);
  expect(last.parameter).toBe("source");
  expect(last.curve.terms).toHaveLength(3);
  await expect(d).toHaveAttribute("data-count", "3");
});

test("adoption waits for the current fit, and adopts what it shows", async ({
  page,
}) => {
  await ready(page);
  await open(page);
  await fit(page);
  const adopt = page.getByRole("button", { name: "Adopt fitted study" });
  await expect(adopt).toBeEnabled();
  // At the very moment of the change, before any reply can arrive.
  const blocked = await page
    .getByLabel("Terms", { exact: true })
    .evaluate((s: HTMLSelectElement) => {
      s.value = "2";
      s.dispatchEvent(new Event("change", { bubbles: true }));
      const button = [
        ...document.querySelectorAll(".harmonic-fit button"),
      ].find(
        (b) => b.textContent === "Adopt fitted study",
      ) as HTMLButtonElement;
      return button.disabled;
    });
  expect(blocked).toBe(true);
  await expect(adopt).toBeEnabled();
  const shown = await fit(page);
  expect(shown.curve.terms).toHaveLength(2);
  await adopt.click();
  await adopted(page);
  expect(
    JSON.parse((await stage(page).getAttribute("data-config"))!).harmonic.terms,
  ).toEqual(shown.curve.terms);
});

test("a refused source can be mended, and nothing of the refusal stays", async ({
  page,
}) => {
  await ready(page);
  await page
    .getByRole("combobox", { name: "Spatial definition" })
    .selectOption("parametric");
  await expect(stage(page)).toHaveAttribute("aria-busy", "false");
  await page.getByRole("textbox", { name: "x(t)", exact: true }).fill("cos(t)");
  await page.getByRole("textbox", { name: "y(t)", exact: true }).fill("sin(t)");
  const z = page.getByRole("textbox", { name: "z(t)", exact: true });
  await z.fill(gap);
  await expect(stage(page)).toHaveAttribute("aria-busy", "false");
  await open(page);
  await expect(dialog(page)).toHaveAttribute("data-pending", "false");
  await expect(dialog(page).getByRole("alert")).toContainText("gap");
  await page.getByRole("button", { name: "Back to your study" }).click();
  await expect(dialog(page)).toHaveCount(0);
  // A broken expression holds the entry shut, and says so if it was asked.
  await z.fill("1/");
  await expect(entry(page)).toBeDisabled();
  await z.fill("sin(2*t)");
  await expect(stage(page)).toHaveAttribute("aria-busy", "false");
  await expect(entry(page)).toBeEnabled();
  await open(page);
  const f = await fit(page);
  expect(f.rms).toBeLessThan(1e-9);
  expect(f.available).toBe(2);
  await expect(dialog(page).getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Adopt fitted study" }),
  ).toBeEnabled();
});

test("history and an incoming link end the excursion, leaving no fit behind", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await ready(page);
  await page.evaluate(() => history.pushState(null, "", location.href));
  await open(page);
  await page.goBack();
  await expect(dialog(page)).toHaveCount(0);
  await expect(stage(page)).toHaveAttribute("aria-busy", "false");
  expect(
    JSON.parse((await stage(page).getAttribute("data-config"))!).format,
  ).toBe("torus");
  await open(page);
  await fit(page);
  const other = presetStudy(12);
  await page.evaluate(
    (hash) => (location.hash = hash),
    linkTo(other).split("#")[1],
  );
  await expect(dialog(page)).toHaveCount(0);
  await expect
    .poll(
      async () =>
        JSON.parse((await stage(page).getAttribute("data-config"))!).format,
    )
    .toBe("harmonic");
  await expect(stage(page)).toHaveAttribute("aria-busy", "false");
  expect((await copied(page)).config.harmonic).toEqual(other.config.harmonic);
});

test("an adopted study's still and movie match, at the movie's duration, with no source", async ({
  page,
}) => {
  await ready(page);
  await open(page);
  await fit(page);
  // Two terms, so that the source would show beside the fit if it remained.
  await setTerms(page, 2);
  const preview = dialog(page).locator("#journey-artwork");
  await expect(preview).toBeVisible();
  await page.getByRole("button", { name: "Adopt fitted study" }).click();
  await adopted(page);
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
  await page.getByLabel("Duration (seconds)").fill("1");
  await page.locator("#spatial-export-settings > summary").click();
  await page.getByLabel("Export format", { exact: true }).selectOption("mp4");
  await page.getByLabel("Export frame rate").selectOption("15");
  await page
    .getByRole("slider", { name: "Export resolution", exact: true })
    .fill("2");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export MP4/ }).click();
  const path = (await (await download).path())!;
  const data = probe(path);
  const video = await decodeVideo(page, await readFile(path));
  expect(video.duration).toBeCloseTo(1, 3);
  // The whole turn: it starts and ends on one view, of what differs.
  expect(video.first.ink).toBeLessThan(video.last.ink);
  const stillFile = page.waitForEvent("download");
  await exportImage(page, "PNG");
  const still = decodePng(await readFile((await (await stillFile).path())!));
  if (data) {
    expect(data.frames).toBe(15);
    expect(data.durations.reduce((a, b) => a + b, 0)).toBe(1000);
    // The still, at the movie's size, against the movie's last frame.
    expect([data.width, data.height]).toEqual([still.width, still.height]);
    const d = frameDifference(path, data.width, data.height, 14, still.rgba);
    if (d) {
      expect(d.meanDifference).toBeLessThan(6);
      expect(d.unmatchedInk).toBeLessThan(0.05);
    }
  }
});

for (const width of [320, 390, 430, 700])
  test(`opening the sampling help moves neither choice at ${width} wide`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await ready(page);
    await open(page);
    await fit(page);
    const choices = [
      page.getByRole("radio", { name: /Source parameter/ }),
      page.getByRole("radio", { name: /Even pace/ }),
    ];
    const where = () =>
      Promise.all(
        choices.map(async (c) => {
          const box = (await c.boundingBox())!;
          return [box.x, box.y].map(Math.round);
        }),
      );
    const before = await where();
    await page
      .getByRole("button", { name: /how the source is sampled/ })
      .click();
    await expect(
      dialog(page).getByText(/can recover a finite sum/),
    ).toBeVisible();
    expect(await where()).toEqual(before);
    // Nor does its second tier.
    await dialog(page)
      .locator(".harmonic-fit-parameter")
      .getByRole("button", { name: "Show more" })
      .click();
    expect(await where()).toEqual(before);
  });
