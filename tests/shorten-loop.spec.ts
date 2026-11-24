import { test, expect, type Page, type Locator } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { decodeVideo, frameDifference, probe } from "./video";
import { wireStudy } from "./study-link-wire";
import { leafFit } from "./fourier-fit-checks";

// Curves that smooth themselves with a user's own loop (#410): entry from
// Draw a loop over the retained study and back, the source evolved, links
// that keep only the fitted terms, refusals and recovery, pending sources,
// playback's start, and the movie. Admission and the solvers' laws are
// engine/shorten's tests (loop_test.go).

const title = "Curves that smooth themselves";
const asDrawn = "A leaf melting into a circle";
const fitted = "A fitted leaf smoothing away";
const study = (page: Page) => page.getByRole("dialog", { name: title });
const fit = (page: Page) =>
  page.getByRole("dialog", { name: /made of circles/ });
const art = (d: Locator) => d.locator("#shorten-artwork");
// A user loop's first nest solves its film on three workers at once.
const ready = (d: Locator) =>
  expect(art(d)).toHaveAttribute("aria-busy", "false", { timeout: 60_000 });
const loops = (d: Locator) => art(d).locator("path[data-role=family]");
const current = (d: Locator) => art(d).locator("path[data-role=current]");
const source = (d: Locator) => d.getByLabel("Your loop", { exact: true });
const note = (d: Locator) => d.getByTestId("shorten-loop-note");
const summary = (d: Locator) => d.locator(".shorten-summary");
const refusal = (d: Locator, text: RegExp) =>
  d.locator(".field-error", { hasText: text });
const nest = (d: Locator) =>
  loops(d).evaluateAll((ps) => ps.map((p) => p.getAttribute("d")));
const slider = (d: Locator) =>
  d.getByRole("slider", { name: "Animation progress" });
async function seek(d: Locator, p: number) {
  await slider(d).fill(String(p));
  await expect(art(d)).toHaveAttribute("data-progress", String(p));
  await ready(d);
  return current(d).getAttribute("d");
}
async function settled(page: Page) {
  await expect(page.locator(".app:visible .plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
}
async function openExample(page: Page, name: string) {
  await page.getByRole("button", { name: "Browse notebook examples" }).click();
  const gallery = page.getByRole("dialog", { name: "Notebook examples" });
  await gallery
    .locator(`[data-shorten-example][data-example-title="${name}"]`)
    .click();
  await gallery.waitFor({ state: "hidden" });
  const d = study(page);
  await ready(d);
  return d;
}
async function openLink(page: Page, change: object) {
  const { presetStudy } = await import("../web/planar-link");
  const { presetShorten } = await import("../web/shorten/model");
  const { studyHref, writeStudyLink } = await import("../web/study-link");
  const token = await writeStudyLink("2d", {
    ...presetStudy(0),
    shorten: { ...presetShorten(0), ...change },
  });
  await page.goto("/");
  await page.goto(
    studyHref("http://localhost/", "2d", token).replace("http://localhost", ""),
  );
}
const copyLinks = (page: Page) =>
  page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as any).copied = value;
        },
      },
    }),
  );
// The link a Copy link button gives, waiting for this copy's own text.
async function copied(scope: Locator | Page, page: Page) {
  await page.evaluate(() => ((window as any).copied = undefined));
  await scope.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => typeof (window as any).copied))
    .toBe("string");
  const link: string = await page.evaluate(() => (window as any).copied);
  return { link, study: wireStudy(new URL(link).hash.slice(3)) };
}
const smooth = (f: Locator) =>
  f.getByRole("button", { name: "Smooth into a circle", exact: true });
// r = 1 + b cos u: an inner loop for b > 1.
const limacon = (b: number) => [
  { frequency: 0, radius: b / 2, phase: 0 },
  { frequency: 1, radius: 1, phase: 0 },
  { frequency: 2, radius: b / 2, phase: 0 },
];

test("Smooth into a circle evolves the fitted loop over the untouched study, which Return keeps", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await copyLinks(page);
  await page.goto("/");
  await settled(page);
  const before = (await copied(page, page)).study;
  const f = await leafFit(page, 12);
  await expect(smooth(f)).toBeEnabled();
  await smooth(f).click();
  await expect(fit(page)).toHaveCount(0);
  const d = study(page);
  await ready(d);
  await expect(d.getByLabel("Seed", { exact: true })).toHaveValue("loop");
  // The fitted terms are evolved; the outline they came from is offered.
  await expect(source(d)).toHaveValue("terms");
  await expect(source(d).locator("option")).toHaveText([
    "Fitted, 12 terms",
    "As drawn, 29 points",
  ]);
  await expect(note(d)).toHaveText(/^Your loop from Draw a loop\./);
  await expect(d.locator(".garden-heading")).toContainText("your loop");
  await expect(d.locator(".garden-heading")).not.toContainText("Petal");
  // The opening still: the nest, geometry only, and how it was solved.
  await expect(loops(d)).toHaveCount(24);
  await expect(art(d).locator("text")).toHaveCount(0);
  await expect(summary(d)).toContainText("24 loops");
  await expect(summary(d)).toContainText(
    "spectrally accurate in space and fourth order in time",
  );
  // The drawing frames the leaf: its points lie within the page.
  const box = await loops(d)
    .first()
    .evaluate((p) => {
      const b = (p as SVGPathElement).getBBox();
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    });
  expect(box.x).toBeGreaterThan(0);
  expect(box.y).toBeGreaterThan(0);
  expect(box.x + box.width).toBeLessThan(1000);
  expect(box.y + box.height).toBeLessThan(760);
  await d.getByRole("button", { name: "Return to study", exact: true }).click();
  await expect(d).toBeHidden();
  expect((await copied(page, page)).study).toEqual(before);
});

test("Draw a new loop goes back to Draw a loop; canceling restores the study as it stood, and smoothing keeps its settings", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/");
  let d = await openExample(page, fitted);
  await expect(note(d)).toHaveText(
    /^The example leaf, until you draw a loop\./,
  );
  await d.getByLabel("Loops", { exact: true }).fill("12");
  await d.getByLabel("View", { exact: true }).selectOption("normalized");
  await ready(d);
  const markup = await art(d).innerHTML();
  await d.getByRole("button", { name: "Draw a new loop…" }).click();
  let f = fit(page);
  await expect(f).toBeVisible();
  await expect(study(page)).toHaveCount(0);
  await expect(
    f.getByRole("button", { name: "Use current loop", exact: true }),
  ).toBeEnabled();
  await f.getByRole("button", { name: "Cancel drawing" }).click();
  d = study(page);
  await ready(d);
  await expect(d.getByLabel("Loops", { exact: true })).toHaveValue("12");
  await expect(d.getByLabel("View", { exact: true })).toHaveValue("normalized");
  await expect(note(d)).toHaveText(
    /^The example leaf, until you draw a loop\./,
  );
  expect(await art(d).innerHTML()).toBe(markup);
  // Import the study's loop, fit it with fewer terms and smooth it back.
  await d.getByRole("button", { name: "Draw a new loop…" }).click();
  f = fit(page);
  await f
    .getByRole("button", { name: "Use current loop", exact: true })
    .click();
  await f.getByLabel("Total terms", { exact: true }).selectOption("4");
  await expect(smooth(f)).toBeEnabled();
  await smooth(f).click();
  d = study(page);
  await ready(d);
  await expect(d.getByLabel("Loops", { exact: true })).toHaveValue("12");
  await expect(d.getByLabel("View", { exact: true })).toHaveValue("normalized");
  await expect(note(d)).toHaveText(/^Your loop from Draw a loop\./);
  await expect(source(d).locator("option").first()).toHaveText(
    "Fitted, 4 terms",
  );
  expect(await art(d).innerHTML()).not.toBe(markup);
});

test("the outline as drawn evolves as a polygon; links keep only the terms, except the example leaf's own outline", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await copyLinks(page);
  await page.goto("/");
  const f = await leafFit(page, 8);
  await expect(smooth(f)).toBeEnabled();
  await smooth(f).click();
  let d = study(page);
  await ready(d);
  const terms = await nest(d);
  await source(d).selectOption("outline");
  await ready(d);
  await expect(summary(d)).toContainText(
    "Solved as a polygon of 1,0", // about 1,040 nodes
  );
  await expect(summary(d)).toContainText("first order in time");
  expect(await nest(d)).not.toEqual(terms);
  // A link keeps the terms and never the outline, so it reopens the
  // smooth loop.
  const { link, study: saved } = await copied(d, page);
  expect(saved.shorten.family).toBe("loop");
  expect(saved.shorten.loopTerms).toHaveLength(8);
  expect(saved.shorten).not.toHaveProperty("loopPoints");
  expect(saved.shorten).not.toHaveProperty("loopSource");
  await page.goto("/");
  await page.goto(link);
  d = study(page);
  await ready(d);
  await expect(source(d)).toHaveValue("terms");
  await expect(source(d).locator("option").last()).toHaveText(
    "As drawn (not kept)",
  );
  await expect(source(d).locator("option").last()).toBeDisabled();
  expect(await nest(d)).toEqual(terms);
  // The example leaf's outline is built in, so its link keeps it.
  await page.goto("/");
  d = await openExample(page, asDrawn);
  await expect(source(d)).toHaveValue("outline");
  const leaf = await nest(d);
  const example = await copied(d, page);
  expect(example.study.shorten).toMatchObject({
    family: "loop",
    loopSource: "outline",
  });
  expect(example.study.shorten).not.toHaveProperty("loopTerms");
  await page.goto("/");
  await page.goto(example.link);
  d = study(page);
  await ready(d);
  await expect(source(d)).toHaveValue("outline");
  expect(await nest(d)).toEqual(leaf);
});

test("loops that cannot be evolved are refused under Your loop, and the study recovers", async ({
  page,
}) => {
  test.setTimeout(90_000);
  // A fractional frequency is refused by name before the study opens.
  const { planarStudy, presetStudy } = await import("../web/planar-link");
  const { presetShorten } = await import("../web/shorten/model");
  expect(() =>
    planarStudy({
      ...presetStudy(0),
      shorten: {
        ...presetShorten(0),
        family: "loop",
        loopTerms: [{ frequency: 1.5, radius: 1, phase: 0 }],
      },
    }),
  ).toThrow(/shorten\.loopTerms\[0\]\.frequency/);
  // An outline in a link is not a field a link has.
  expect(() =>
    planarStudy({
      ...presetStudy(0),
      shorten: { ...presetShorten(0), loopPoints: [{ x: 0, y: 0 }] },
    }),
  ).toThrow(/shorten\.loopPoints/);
  // A limaçon with an inner loop crosses itself.
  await openLink(page, { family: "loop", loopTerms: limacon(2) });
  let d = study(page);
  await expect(refusal(d, /crosses itself/)).toBeVisible({ timeout: 30_000 });
  await expect(source(d)).toHaveAccessibleDescription(/crosses itself/);
  await expect(d.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await expect(d.getByRole("button", { name: "Play motion" })).toBeDisabled();
  // Another seed recovers.
  await d.getByLabel("Seed", { exact: true }).selectOption("flower");
  await ready(d);
  await expect(refusal(d, /crosses itself/)).toHaveCount(0);
  await expect(loops(d)).toHaveCount(24);
  // Almost a cusp: admitted, but finer than 4,096 nodes can follow.
  await openLink(page, {
    family: "loop",
    loopTerms: [
      { frequency: 1, radius: 1, phase: 0 },
      { frequency: -2, radius: 0.49, phase: 0 },
    ],
  });
  d = study(page);
  await expect(refusal(d, /too fine to follow with 4,096 points/)).toBeVisible({
    timeout: 30_000,
  });
  // Draw a new loop is still offered.
  await expect(
    d.getByRole("button", { name: "Draw a new loop…" }),
  ).toBeVisible();
});

test("a later source replaces one still being solved", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  const d = await openExample(page, fitted);
  const terms = await nest(d);
  await source(d).selectOption("outline");
  await ready(d);
  const outline = await nest(d);
  expect(outline).not.toEqual(terms);
  // Back to the terms and at once to the outline: the terms' film, still
  // being solved, is superseded and never drawn.
  await source(d).selectOption("terms");
  await source(d).selectOption("outline");
  await ready(d);
  expect(await nest(d)).toEqual(outline);
  await expect(summary(d)).toContainText("Solved as a polygon");
});

test("a user loop's motion starts at its first frame, without a stall or a jump, and seeks depend only on time", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/");
  const d = await openExample(page, fitted);
  // Every frame the drawing shows: its timeline progress and its loop's
  // time.
  await art(d).evaluate((svg) => {
    const seen: [number, string | null][] = [];
    (window as any).seen = seen;
    new MutationObserver(() =>
      seen.push([
        Number(svg.getAttribute("data-progress")),
        svg.getAttribute("data-time"),
      ]),
    ).observe(svg, {
      attributes: true,
      attributeFilter: ["data-progress", "data-time"],
    });
  });
  await d.getByRole("button", { name: "Play motion" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).seen.length), {
      timeout: 30_000,
    })
    .toBeGreaterThan(20);
  await d.getByRole("button", { name: "Pause motion" }).click();
  const seen: [number, string | null][] = await page.evaluate(
    () => (window as any).seen,
  );
  const shown = seen.filter(([, t]) => t !== null);
  // The first loop drawn is the start's, before the clock moves.
  expect(shown[0]).toEqual([0, "0"]);
  // Thereafter the timeline never leaps: an 8 s motion advances at most a
  // tenth (0.8 s) between drawn frames, where a clock started before the
  // film was solved jumped seconds at once.
  for (let i = 1; i < shown.length; i++)
    expect(shown[i][0] - shown[i - 1][0]).toBeLessThan(0.1);
  // Seeks show the same loop for the same time, in any order.
  const a = await seek(d, 0.6);
  await seek(d, 0.1);
  expect(await seek(d, 0.6)).toBe(a);
});

test("a user loop's readout keeps its width and height through the motion on a phone", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  for (const name of [asDrawn, fitted]) {
    const d = await openExample(page, name);
    const sizes = new Set<string>();
    for (const p of [0.001, 0.02, 0.1, 0.3, 0.5, 0.75, 0.9, 0.99, 1]) {
      await seek(d, p);
      sizes.add(
        JSON.stringify(
          await d
            .locator(".shorten-readout")
            .evaluate((e) => [
              Array.from(
                e.querySelectorAll("dd"),
                (v) => v.textContent!.length,
              ),
              e.getBoundingClientRect().height,
            ]),
        ),
      );
    }
    expect([...sizes], name).toHaveLength(1);
    await d
      .getByRole("button", { name: "Return to study", exact: true })
      .click();
    await expect(d).toBeHidden();
  }
});

// The live drawing rasterized from its vector markup at a target size,
// over its background.
const raster = (d: Locator, width: number, height: number) =>
  art(d).evaluate(
    async (live, [width, height]) => {
      const svg = live.cloneNode(true) as SVGSVGElement;
      svg.setAttribute("width", String(width));
      svg.setAttribute("height", String(height));
      const url = URL.createObjectURL(
        new Blob([new XMLSerializer().serializeToString(svg)], {
          type: "image/svg+xml",
        }),
      );
      try {
        const image = new Image();
        image.src = url;
        await image.decode();
        const c = document.createElement("canvas");
        c.width = width;
        c.height = height;
        const g = c.getContext("2d")!;
        g.fillStyle = getComputedStyle(live).backgroundColor;
        g.fillRect(0, 0, width, height);
        g.drawImage(image, 0, 0);
        return Array.from(g.getImageData(0, 0, width, height).data);
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    [width, height],
  );

test("the movie of a user loop has its frames and duration, and its first, middle and last frames are the loop at those times", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto("/");
  const d = await openExample(page, asDrawn);
  // The seed alone under the shown loop, paced in physical time, so frames
  // a twentieth of the motion apart differ by more than a pixel.
  await d.getByLabel("Loops", { exact: true }).fill("1");
  await d.getByLabel("Pacing", { exact: true }).selectOption("time");
  await ready(d);
  // 1.4 s at 15 fps, played once: 21 frames at times i/20.
  await d.getByLabel("Duration", { exact: true }).fill("1.4");
  const references = new Map<number, number[]>();
  for (const t of [1, 0.95, 0.55, 0.5, 0.45, 0.05]) {
    await seek(d, t);
    references.set(t, await raster(d, 500, 380));
  }
  // A slider already at 0 cannot be moved to 0: seek there last, from 0.05.
  await seek(d, 0);
  references.set(0, await raster(d, 500, 380));
  await d.getByRole("button", { name: "Stop motion" }).click();
  await ready(d);
  const settings = d.locator("#shorten-export-settings");
  if (!(await settings.evaluate((e) => (e as HTMLDetailsElement).open)))
    await settings.locator("summary").click();
  await d.getByLabel("Export format", { exact: true }).selectOption("mp4");
  await d.getByRole("slider", { name: "Export resolution" }).fill("0.5");
  await d.getByLabel("Export frame rate", { exact: true }).selectOption("15");
  const download = page.waitForEvent("download");
  await d.getByRole("button", { name: /^Export MP4 video/ }).click();
  const path = (await (await download).path())!;
  const bytes = await readFile(path);
  // The record names the loop by its terms and its source, never the
  // outline's points.
  const text = bytes.toString("latin1");
  expect(text).toContain('"kind":"curve-shortening"');
  expect(text).toContain('"family":"loop"');
  expect(text).toContain('"source":"outline"');
  expect(text).toContain("Barrett");
  expect(text).not.toContain('"x":-1.9');
  const timing = probe(path);
  if (timing) {
    expect([timing.width, timing.height, timing.frames]).toEqual([
      500, 380, 21,
    ]);
    expect(timing.durations.reduce((a, b) => a + b, 0)).toBe(1400);
  }
  expect((await decodeVideo(page, bytes)).duration).toBeCloseTo(1.4, 3);
  const compare = (frame: number, t: number) =>
    frameDifference(path, 500, 380, frame, references.get(t)!);
  // Each frame is its own time's loop over the seed: a frame a twentieth of
  // the motion away leaves clearly more ink unmatched.
  for (const [frame, t, others] of [
    [0, 0, [0.05]],
    [10, 0.5, [0.45, 0.55]],
    [20, 1, [0.95]],
  ] as const) {
    const own = compare(frame, t);
    if (!own) continue;
    expect(own.meanDifference).toBeLessThan(6);
    for (const other of others)
      expect(compare(frame, other)!.unmatchedInk).toBeGreaterThan(
        own.unmatchedInk + 0.05,
      );
  }
  await expect(d.getByRole("button", { name: "Play motion" })).toBeEnabled();
});
