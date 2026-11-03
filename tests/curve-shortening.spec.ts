import { test, expect, type Page, type Locator } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { decodeVideo, probe } from "./video";
import { wireStudy } from "./study-link-wire";

// Curves that smooth themselves (R14.2, #323): the study's presentation
// rules worked by hand, then its production path in the browser: entry
// from the gallery over the retained study, edits and refusals, seeks that
// depend only on time, playback, links, exports and narrow layouts. The
// solver's laws and limits are engine/shorten's tests.

const flower = "A flower remembering a circle";
const trefoil = "A trefoil folding into a circle";
const convex = "A gently rippled convex loop";
const title = "Curves that smooth themselves";

test("families and pacing place times within the film, ends exact", async () => {
  const { familyTimes, timeAt } = await import("../web/shorten/model");
  expect(familyTimes(0.49, 4, "time")).toEqual(
    [0, 0.1225, 0.245, 0.3675].map((t) => expect.closeTo(t, 15)),
  );
  // Equal radius: a circle ending at its extinction steps evenly in radius.
  expect(
    familyTimes(0.5, 4, "radius").map((t) => Math.sqrt(1 - 2 * t)),
  ).toEqual([1, 0.75, 0.5, 0.25].map((r) => expect.closeTo(r, 12)));
  // Early: t = end·f³, dense where petals change fastest.
  expect(familyTimes(8, 4, "early")).toEqual([0, 0.125, 1, 3.375]);
  for (const pacing of ["time", "radius", "early"] as const) {
    expect(timeAt(0, 0.49, pacing)).toBe(0);
    expect(timeAt(1, 0.49, pacing)).toBe(0.49);
    expect(timeAt(-0.1, 0.49, pacing)).toBe(0);
    expect(timeAt(1.1, 0.49, pacing)).toBe(0.49);
  }
  expect(timeAt(0.5, 8, "early")).toBe(1);
});

test("normalization rescales a measured loop about its centroid to the starting area", async () => {
  const { normalized } = await import("../web/shorten/model");
  const square = {
    x: [1, 3, 3, 1],
    y: [1, 1, 3, 3],
    area: 4,
    centerX: 2,
    centerY: 2,
  };
  const n = normalized(square, 16);
  expect(n.x).toEqual([-2, 2, 2, -2]);
  expect(n.y).toEqual([-2, -2, 2, 2]);
  expect(n.scale).toBe(2);
  expect(square.x).toEqual([1, 3, 3, 1]);
});

test("presets lead with the flower and keep the convex loop last", async () => {
  const { shortenPresets } = await import("../web/shorten/model");
  expect(shortenPresets[0].title).toBe(flower);
  expect(shortenPresets[0].study.family).toBe("flower");
  expect(shortenPresets.at(-1)!.title).toBe(convex);
  expect(shortenPresets.at(-1)!.study.family).toBe("convex");
  expect(
    shortenPresets.slice(0, -1).every((p) => p.study.family === "flower"),
  ).toBe(true);
});

async function settled(page: Page) {
  await expect(page.locator(".app:visible .plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
}
const art = (d: Locator) => d.locator("#shorten-artwork");
const ready = (d: Locator) =>
  expect(art(d)).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
async function openStudy(page: Page, name = flower) {
  await page.getByRole("button", { name: "Browse notebook examples" }).click();
  const gallery = page.getByRole("dialog", { name: "Notebook examples" });
  await gallery
    .locator(`[data-shorten-example][data-example-title="${name}"]`)
    .click();
  await gallery.waitFor({ state: "hidden" });
  const d = page.getByRole("dialog", { name: title });
  await ready(d);
  return d;
}
const loops = (d: Locator) => art(d).locator("path[data-role=family]");
const current = (d: Locator) => art(d).locator("path[data-role=current]");
// The refusal shown under a control.
const refusal = (d: Locator, text: RegExp) =>
  d.locator(".field-error", { hasText: text });
const slider = (d: Locator) =>
  d.getByRole("slider", { name: "Animation progress" });
async function seek(d: Locator, p: number) {
  await slider(d).fill(String(p));
  await expect(art(d)).toHaveAttribute("data-progress", String(p));
  await ready(d);
  return current(d).getAttribute("d");
}

test("the study opens from the gallery over an untouched study and returns to it", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  const x = page.getByLabel("x(t)", { exact: true });
  await x.fill("cos(t) + 0.25");
  await settled(page);
  const d = await openStudy(page);
  // The opening still: a nest of 24 loops, geometry only, no loop
  // highlighted until the motion starts.
  await expect(loops(d)).toHaveCount(24);
  await expect(current(d)).toHaveCount(0);
  await expect(art(d).locator("text")).toHaveCount(0);
  await expect(d.locator(".shorten-summary")).toContainText("24 loops");
  await d.getByRole("button", { name: "Return to study", exact: true }).click();
  await expect(d).toBeHidden();
  await expect(x).toHaveValue("cos(t) + 0.25");
});

test("seeks depend only on time, and the readout states the area law", async ({
  page,
}) => {
  await page.goto("/");
  const d = await openStudy(page);
  const first = await seek(d, 0.5);
  await seek(d, 0.9);
  await seek(d, 0.1);
  expect(await seek(d, 0.5)).toBe(first);
  const readout = d.locator(".shorten-readout");
  await expect(readout).toContainText("t =");
  await expect(readout).toContainText("A₀ − 2πt");
  await expect(readout).toContainText("κ from");
  // Stop returns to the whole nest.
  await d.getByRole("button", { name: "Stop motion" }).click();
  await expect(current(d)).toHaveCount(0);
});

test("playback pauses, resumes and stops, and a seed edit ends it", async ({
  page,
}) => {
  await page.goto("/");
  const d = await openStudy(page);
  await d.getByRole("button", { name: "Play motion" }).click();
  const pause = d.getByRole("button", { name: "Pause motion" });
  await expect(pause).toBeVisible();
  await expect(current(d)).toHaveCount(1);
  await page.waitForTimeout(400);
  await pause.click();
  const held = Number(await art(d).getAttribute("data-progress"));
  expect(held).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  expect(Number(await art(d).getAttribute("data-progress"))).toBe(held);
  await d.getByRole("button", { name: "Resume motion" }).click();
  await expect(d.getByRole("button", { name: "Pause motion" })).toBeVisible();
  await d.getByLabel("Petals", { exact: true }).fill("6");
  await expect(d.getByRole("button", { name: "Play motion" })).toBeVisible();
  await expect(current(d)).toHaveCount(0);
  await ready(d);
  await expect(art(d)).toHaveAttribute("data-progress", "0");
});

test("seed edits are validated by field, accept constants, and switching families keeps a valid study", async ({
  page,
}) => {
  await page.goto("/");
  const d = await openStudy(page);
  const depth = d.getByLabel("Petal depth", { exact: true });
  await depth.fill("0.95");
  await expect(refusal(d, /at most 0\.9/)).toBeVisible();
  // Petals this deep and many curve too sharply to resolve: refused on depth.
  await depth.fill("0.45");
  await d.getByLabel("Petals", { exact: true }).fill("6");
  await expect(refusal(d, /too sharply to resolve/)).toBeVisible();
  await depth.fill("pi/10");
  await ready(d);
  await d.getByLabel("Petals", { exact: true }).fill("1");
  await expect(refusal(d, /Petals must be 0/)).toBeVisible();
  await d.getByLabel("Petals", { exact: true }).fill("5");
  await ready(d);
  await d.getByLabel("Seed", { exact: true }).selectOption("convex");
  await ready(d);
  await expect(loops(d)).toHaveCount(24);
  await d.getByLabel("Ripple", { exact: true }).fill("0.1");
  await expect(refusal(d, /\|ε\|/)).toBeVisible();
  await d.getByLabel("Ripple", { exact: true }).fill("1/80");
  await ready(d);
  await d.getByLabel("Seed", { exact: true }).selectOption("flower");
  await ready(d);
});

test("contour, nest and framing settings redraw the nest without a new solve", async ({
  page,
}) => {
  await page.goto("/");
  const d = await openStudy(page);
  await d.getByLabel("Loops", { exact: true }).fill("12");
  await ready(d);
  await expect(loops(d)).toHaveCount(12);
  await d.getByLabel("Spacing", { exact: true }).selectOption("radius");
  await ready(d);
  await d.getByLabel("View", { exact: true }).selectOption("normalized");
  await expect(d.locator(".garden-legend")).toContainText(
    "Normalized to the starting area",
  );
  await d.getByLabel("Nest", { exact: true }).selectOption("grows");
  await seek(d, 0.3);
  const shown = await loops(d).count();
  expect(shown).toBeGreaterThan(0);
  expect(shown).toBeLessThan(12);
  await d.getByLabel("Loops", { exact: true }).fill("49");
  await expect(refusal(d, /1–48/)).toBeVisible();
});

test("links save the study over the study it came from, older links open without it, and malformed fields are refused", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as any).copied = value;
        },
      },
    }),
  );
  await page.goto("/");
  await settled(page);
  const d = await openStudy(page, trefoil);
  await d.getByLabel("Loops", { exact: true }).fill("16");
  await d.getByLabel("Nest", { exact: true }).selectOption("ghost");
  await d.getByLabel("Line weight", { exact: true }).selectOption("fine");
  await ready(d);
  await expect(d.getByRole("button", { name: "Copy link" })).toBeEnabled();
  await d.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(d.getByText("Link copied", { exact: true })).toBeVisible();
  const link: string = await page.evaluate(() => (window as any).copied);
  const saved = wireStudy(new URL(link).hash.slice(3));
  expect(saved.garden).toBeUndefined();
  expect(saved.lace).toBeUndefined();
  expect(saved.shorten).toMatchObject({
    family: "flower",
    petals: 3,
    depth: 0.5,
    contours: 16,
    nest: "ghost",
    weight: "fine",
  });
  const drawn = await loops(d).evaluateAll((ps) =>
    ps.map((p) => p.getAttribute("d")),
  );
  await page.goto(link);
  const reopened = page.getByRole("dialog", { name: title });
  await ready(reopened);
  expect(
    await loops(reopened).evaluateAll((ps) =>
      ps.map((p) => p.getAttribute("d")),
    ),
  ).toEqual(drawn);
  const { planarStudy, presetStudy } = await import("../web/planar-link");
  // An older link has no shorten field and opens without the study.
  expect(planarStudy(presetStudy(0)).shorten).toBeUndefined();
  for (const [field, value] of [
    ["family", "spiral"],
    ["petals", 2.5],
    ["contours", 0],
    ["spacing", "log"],
    ["nest", "all"],
  ] as const)
    expect(() =>
      planarStudy({
        ...presetStudy(0),
        shorten: { ...saved.shorten, [field]: value },
      }),
    ).toThrow(new RegExp(`shorten\\.${field}`));
});

test("the still exports the drawing alone with its record", async ({
  page,
}) => {
  await page.goto("/");
  const d = await openStudy(page);
  await seek(d, 0.25);
  const download = page.waitForEvent("download");
  await d.getByRole("button", { name: /Export image/ }).click();
  await page.getByRole("menuitem", { name: /SVG/ }).click();
  const file = await download;
  const svg = Buffer.concat(
    await (await file.createReadStream()).toArray(),
  ).toString("utf8");
  expect(svg).not.toMatch(/<text/);
  const record = JSON.parse(
    svg
      .match(/<desc>([^<]*)<\/desc>/)![1]
      .replaceAll("&quot;", '"')
      .replaceAll("&amp;", "&"),
  );
  expect(record.kind).toBe("curve-shortening");
  expect(record.seed.family).toBe("flower");
  expect(record.family).toHaveLength(24);
  expect(record.time).toBeGreaterThan(0);
  expect((svg.match(/data-role="family"/g) ?? []).length).toBe(24);
});

test("Play and the progress slider keep the garden's spacing on a desktop", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const d = await openStudy(page);
  const play = (await d
    .getByRole("button", { name: "Play motion" })
    .boundingBox())!;
  const label = (await d
    .locator(".timeline label", { hasText: "Animation progress" })
    .boundingBox())!;
  expect(label.y - (play.y + play.height)).toBeGreaterThanOrEqual(8);
});

for (const [name, viewport] of [
  ["phone portrait", { width: 390, height: 844 }],
  ["phone landscape", { width: 844, height: 390 }],
] as const)
  test(`the study fits a ${name} layout with every control reachable, and Play shows the drawing`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport,
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    await page.goto("/");
    const d = await openStudy(page);
    const box = (await art(d).boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.height).toBeLessThanOrEqual(viewport.height);
    expect(await d.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(
      true,
    );
    for (const control of [
      d.getByLabel("Seed", { exact: true }),
      d.getByLabel("Petals", { exact: true }),
      d.getByLabel("Petal depth", { exact: true }),
      d.getByLabel("Loops", { exact: true }),
      d.getByLabel("Spacing", { exact: true }),
      d.getByLabel("Nest", { exact: true }),
      d.getByLabel("View", { exact: true }),
      d.getByLabel("Duration", { exact: true }),
      d.getByLabel("Pacing", { exact: true }),
      d.getByRole("button", { name: /^Export (MP4 video|animated WebP)/ }),
      d.getByLabel("Line weight", { exact: true }),
      d.getByRole("button", { name: "Return to study", exact: true }),
    ]) {
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeInViewport();
    }
    // Play from the controls, scrolled past the drawing: the drawing comes
    // into view (portrait), or stays beside them (landscape).
    const play = d.getByRole("button", { name: "Play motion" });
    await play.scrollIntoViewIfNeeded();
    await play.click();
    await expect(d.getByRole("button", { name: "Pause motion" })).toBeVisible();
    await expect(art(d)).toBeInViewport({ ratio: 0.9 });
    await context.close();
  });

// The movie samples the same evolution by absolute time: an independent
// decoder reads its frame count and duration, and its record.
test("the movie export has the motion's frames and duration and its record", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/");
  const d = await openStudy(page);
  await d.getByLabel("Duration", { exact: true }).fill("1.4");
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
  expect(bytes.includes(Buffer.from('"kind":"curve-shortening"'))).toBe(true);
  // 1.4 s at 15 fps, played once: 21 frames.
  const timing = probe(path);
  if (timing) expect(timing.frames).toBe(21);
  expect((await decodeVideo(page, bytes)).duration).toBeCloseTo(1.4, 3);
  // Exporting leaves the study ready, with no loop highlighted.
  await expect(d.getByRole("button", { name: "Play motion" })).toBeEnabled();
});

for (const [name, viewport] of [
  ["desktop", { width: 1280, height: 800 }],
  ["phone", { width: 390, height: 844 }],
] as const)
  test(`opening a paired help leaves its neighbor in place (${name})`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const d = await openStudy(page);
    for (const [left, right] of [
      ["Petals", "Petal depth"],
      ["Ruffles", "Ruffle depth"],
      ["Loops", "Spacing"],
      ["Nest", "View"],
      ["Duration", "Repeat"],
    ]) {
      for (const [open, other] of [
        [left, right],
        [right, left],
      ]) {
        const control = d.getByLabel(other, { exact: true });
        await control.scrollIntoViewIfNeeded();
        const place = () =>
          control.evaluate((e) => {
            const pair = e.closest(".pair")!.getBoundingClientRect(),
              own = e.getBoundingClientRect();
            return { x: own.x - pair.x, y: own.y - pair.y };
          });
        const before = await place();
        const toggle = d.getByRole("button", { name: `About ${open}` });
        await toggle.click();
        const more = d
          .locator(`#${await toggle.getAttribute("aria-controls")}`)
          .getByRole("button", { name: "Show more" });
        if (await more.count()) await more.click();
        expect(await place(), `${open} beside ${other}`).toEqual(before);
        await toggle.click();
      }
    }
  });

// Presets that turn a nest mode on play their own motion with it.
test("the growing and faint nests play as their presets open them", async ({
  page,
}) => {
  await page.goto("/");
  const grows = await openStudy(page, "Six petals, a nest that grows");
  await expect(art(grows)).toHaveAttribute("data-nest", "grows");
  // At rest the whole nest is drawn, as its thumbnail shows.
  await expect(loops(grows)).toHaveCount(24);
  await grows.getByRole("button", { name: "Play motion" }).click();
  await expect
    .poll(async () => Number(await art(grows).getAttribute("data-progress")))
    .toBeGreaterThan(0.3);
  await grows.getByRole("button", { name: "Pause motion" }).click();
  await ready(grows);
  const time = Number(await art(grows).getAttribute("data-time"));
  const drawn = await loops(grows).count();
  // The loops drawn are exactly those at or before the shown time: with
  // t_j = end·(j/24)³, j ≤ 24·(t/end)^⅓.
  const end = Number(
    (await grows.locator(".shorten-summary").getAttribute("data-end"))!,
  );
  expect(drawn).toBe(Math.floor(24 * Math.cbrt(time / end) + 1e-9) + 1);
  expect(drawn).toBeLessThan(24);
  await grows
    .getByRole("button", { name: "Return to study", exact: true })
    .click();
  const faint = await openStudy(page, "Eight petals and their faint future");
  await expect(art(faint)).toHaveAttribute("data-nest", "ghost");
  await faint.getByRole("button", { name: "Play motion" }).click();
  await expect
    .poll(async () => Number(await art(faint).getAttribute("data-progress")))
    .toBeGreaterThan(0.3);
  await faint.getByRole("button", { name: "Pause motion" }).click();
  await ready(faint);
  const opacities = await loops(faint).evaluateAll((ps) =>
    ps.map((p) => p.getAttribute("opacity")),
  );
  expect(opacities).toHaveLength(24);
  expect(opacities.filter((o) => o === "0.18").length).toBeGreaterThan(0);
  expect(opacities[0]).toBe("0.85");
});

// Switching the lobes keeps a valid study: a ripple beyond the new bound is
// brought to it, keeping its sign; one within it is kept.
test("changing the lobes keeps the ripple within the new bound", async ({
  page,
}) => {
  await page.goto("/");
  const d = await openStudy(page, convex);
  const ripple = d.getByLabel("Ripple", { exact: true });
  await expect(ripple).toHaveValue("0.0625");
  await d.getByLabel("Lobes", { exact: true }).selectOption("6");
  await ready(d);
  await expect(d.locator(".field-error")).toHaveCount(0);
  await expect(ripple).toHaveValue(String(1 / 70));
  await ripple.fill("-0.01");
  await ready(d);
  await d.getByLabel("Lobes", { exact: true }).selectOption("3");
  await ready(d);
  await expect(ripple).toHaveValue("-0.01");
});
