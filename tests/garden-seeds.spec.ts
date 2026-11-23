import { test, expect, type Page, type Locator } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { wireStudy } from "./study-link-wire";

// The Apollonian garden's catalog of seeds (#386, from #385's research):
// the original −1, 2, 2, 3 and five more, chosen inside the garden. Geometry
// is asserted on the drawn circles, independently of the engine.

const garden = (page: Page) =>
  page.getByRole("dialog", { name: "The Apollonian garden" });
const ready = (d: Locator) =>
  expect(d.locator("#garden-artwork")).toHaveAttribute("aria-busy", "false");
async function openExample(page: Page, title: string) {
  await page.getByRole("button", { name: "Browse notebook examples" }).click();
  const gallery = page.getByRole("dialog", { name: "Notebook examples" });
  await gallery
    .locator(`[data-garden-example][data-example-title="${title}"]`)
    .click();
  await gallery.waitFor({ state: "hidden" });
  const d = garden(page);
  await ready(d);
  return d;
}
type Drawn = { i: number; cx: number; cy: number; r: number };
const drawn = (d: Locator): Promise<Drawn[]> =>
  d.locator("#garden-artwork").evaluate((svg) =>
    Array.from(svg.querySelectorAll("circle"), (c) => ({
      i: Number(c.getAttribute("data-circle")),
      cx: +c.getAttribute("cx")!,
      cy: +c.getAttribute("cy")!,
      r: +c.getAttribute("r")!,
    })),
  );
const seedChoice = (d: Locator) =>
  d.getByRole("combobox", { name: "Seed", exact: true });
const circleCount = async (d: Locator) =>
  Number(
    (await d.locator(".garden-summary").textContent())!
      .match(/^([\d,]+) circles/)![1]
      .replace(/,/g, ""),
  );
// Tangency in page units, internal to the enclosing circle (index 0).
function tangent(a: Drawn, b: Drawn) {
  const d = Math.hypot(a.cx - b.cx, a.cy - b.cy);
  const want = b.i === 0 ? b.r - a.r : a.r + b.r;
  return Math.abs(d - want) <= 1e-9 * (a.r + b.r + 1000);
}

const studies = [
  ["Six circles around a seventh", "-1,3,3,3,3,3,3,3", 8],
  ["A three-fold rose window", "3-2r3,1,1,1", 4],
  ["A window with one mirror", "-2,3,6,7", 4],
  ["A five and two eights", "-3,5,8,8", 4],
  ["A window with no symmetry", "-6,11,14,15", 4],
] as const;

// A link study's refusal, or undefined when it opens.
async function refusal(garden: Record<string, unknown>) {
  const { planarStudy, presetStudy } = await import("../web/planar-link");
  const { LinkError } = await import("../web/study-link");
  try {
    planarStudy({ ...presetStudy(0), garden: garden as any });
  } catch (e) {
    return e instanceof LinkError ? e.field : String(e);
  }
}

test("the garden offers every seed in its gallery and its seed choice, and keeps the original's studies first", async ({
  page,
}) => {
  const { presetGarden, gardenPresets } = await import("../web/garden/model");
  // The original's three studies keep their places; the catalog follows.
  expect(gardenPresets.map((p) => p.title)).toEqual([
    "A rose window made only of circles",
    "One circle and the three that made it",
    "Finer circles in one gap",
    ...studies.map(([title]) => title),
    "Finer circles in a three-fold gap",
    "Pearls in a crescent",
    "A rose window unrolled into a strip",
    "A window inside its left circle",
  ]);
  for (const p of gardenPresets) expect(p.title).not.toContain("research");
  // Every seed's link opens; one beyond the catalog does not.
  for (const [, seed, seeds] of studies)
    expect(
      await refusal({ ...presetGarden(0), seed, maxCircles: seeds }),
    ).toBeUndefined();
  expect(await refusal({ ...presetGarden(0), seed: "-2,3,6,8" })).toBe(
    "garden.seed",
  );
  // The circle limit cannot fall below the seed's own circles.
  expect(
    await refusal({
      ...presetGarden(0),
      seed: "-1,3,3,3,3,3,3,3",
      maxCircles: 7,
    }),
  ).toBe("garden.maxCircles");
  // An algebraic selection's √3 coefficients are three whole numbers.
  for (const root of [[1, 2], [1, 2, 0.5], [1, 2, "3"], 7])
    expect(
      await refusal({
        ...presetGarden(0),
        seed: "3-2r3,1,1,1",
        selected: { curvature: 3, x: 0, y: 0, root },
      }),
    ).toMatch(/^garden\.selected\.root/);
  await page.goto("/");
  await page.getByRole("button", { name: "Browse notebook examples" }).click();
  const gallery = page.getByRole("dialog", { name: "Notebook examples" });
  await expect(gallery.locator("[data-garden-example]")).toHaveCount(
    gardenPresets.length,
  );
  await page.keyboard.press("Escape");
  const d = await openExample(page, "A rose window made only of circles");
  await expect(seedChoice(d)).toHaveValue("-1,2,2,3");
  expect(
    await seedChoice(d)
      .locator("option")
      .evaluateAll((o) => o.map((e) => (e as HTMLOptionElement).value)),
  ).toEqual([
    "-1,2,2,3",
    "-1,3,3,3,3,3,3,3",
    "3-2r3,1,1,1",
    "-2,3,6,7",
    "-3,5,8,8",
    "-6,11,14,15",
    "split",
  ]);
  await expect(
    d.getByRole("heading", { name: "Seed and cutoffs", exact: true }),
  ).toBeVisible();
  await expect(d.locator(".eyebrow")).toHaveText(
    "Apollonian packing · curvatures −1, 2, 2, 3",
  );
  // Only six around one carries the note that it is not one Descartes
  // configuration.
  await expect(d.locator(".garden-seed-note")).toHaveCount(0);
});

test("six around one says it is not a single Descartes seed, and the circle limit's help and minimum follow the seed", async ({
  page,
}) => {
  await page.goto("/");
  const d = await openExample(page, "Six circles around a seventh");
  const note = d.locator(".garden-seed-note");
  await expect(note).toContainText(/not a single Descartes/i);
  await expect(note).toContainText("virtual opposite");
  const limit = d.getByLabel("Circle limit", { exact: true });
  await expect(limit).toHaveAttribute("min", "8");
  await d.getByRole("button", { name: "About Circle limit" }).click();
  await expect(
    d.locator(".pair .hint").filter({ hasText: "8–5,000" }),
  ).toBeVisible();
  await seedChoice(d).selectOption("-2,3,6,7");
  await ready(d);
  await expect(note).toHaveCount(0);
  await expect(limit).toHaveAttribute("min", "4");
  await expect(
    d.locator(".pair .hint").filter({ hasText: "4–5,000" }),
  ).toBeVisible();
});

test("the reveal's recorded membership names the seed's own opening count", async () => {
  const { revealMembership, revealCount } = await import("../web/garden/model");
  // The original's record is unchanged.
  expect(revealMembership(4)).toBe(
    "the first n circles in breadth-first order; n = 4 for progress p ≤ 0.06, n = floor(4·(N/4)^s) with s = (p − 0.06)/0.8, n = N for p ≥ 0.86",
  );
  expect(revealMembership(8)).toBe(
    "the first n circles in breadth-first order; n = 8 for progress p ≤ 0.06, n = floor(8·(N/8)^s) with s = (p − 0.06)/0.8, n = N for p ≥ 0.86",
  );
  // As the rule computes it.
  expect(revealCount(1484, 0.06, 8)).toBe(8);
  expect(revealCount(1484, 0.46, 8)).toBe(Math.floor(8 * (1484 / 8) ** 0.5));
});

for (const [title, seed, seeds] of studies)
  test(`${title} draws a packing whose selections are tangent to their generators`, async ({
    page,
  }) => {
    await page.goto("/");
    const d = await openExample(page, title);
    await expect(seedChoice(d)).toHaveValue(seed);
    const all = await drawn(d);
    expect(all.length).toBe(await circleCount(d));
    expect(all.length).toBeGreaterThan(1000);
    const outer = all.find((c) => c.i === 0)!;
    for (const c of all)
      if (c.i)
        expect(
          Math.hypot(c.cx - outer.cx, c.cy - outer.cy) + c.r,
        ).toBeLessThanOrEqual(outer.r * (1 + 1e-12));
    // A seed circle explains itself as one of the seeds.
    const circle = d.getByLabel("Circle", { exact: true });
    await circle.fill("2");
    await expect(d.locator(".garden-about")).toContainText(
      `one of the ${seeds} tangent circles`,
    );
    // The first circle of generation 1, and a later one: tangent to the
    // three circles the explanation names, with exact curvatures.
    for (const n of [seeds + 1, seeds + 40]) {
      await circle.fill(String(n));
      const about = d.locator(".garden-about");
      await expect(about).toContainText("It fills the gap between");
      const parents = await d
        .getByRole("group", { name: "Generating circles" })
        .getByRole("button")
        .allTextContents();
      expect(parents).toHaveLength(3);
      const mine = all.find((c) => c.i === n - 1)!;
      for (const p of parents) {
        const k = Number(p.match(/Circle ([\d,]+)/)![1].replace(/,/g, "")) - 1;
        expect(
          tangent(
            mine,
            all.find((c) => c.i === k)!,
          ),
        ).toBe(true);
      }
      const text = (await about.textContent())!;
      if (seed.includes("r3") || seeds === 8) expect(text).toContain("√3");
      else expect(text).not.toContain("√3");
      // Six around one's first circles fill gaps from a virtual opposite.
      if (seeds === 8 && n === seeds + 1) {
        expect(text).toContain("virtual opposite");
        expect(text).toContain("not a single Descartes seed");
      } else expect(text).not.toContain("virtual opposite");
    }
  });

test("changing the seed clears the selection, keeps the cutoffs and raises the circle limit to the seed count", async ({
  page,
}) => {
  await page.goto("/");
  const d = await openExample(page, "A rose window made only of circles");
  await d.getByLabel("Depth", { exact: true }).fill("6");
  await d.getByLabel("Circle limit", { exact: true }).fill("4");
  await ready(d);
  await d.getByLabel("Circle", { exact: true }).fill("3");
  await seedChoice(d).selectOption("-1,3,3,3,3,3,3,3");
  await ready(d);
  await expect(d.getByLabel("Circle limit", { exact: true })).toHaveValue("8");
  await expect(d.getByLabel("Depth", { exact: true })).toHaveValue("6");
  await expect(d.getByText("No circle selected.")).toBeVisible();
  await expect(d.locator(".eyebrow")).toContainText("seven circles of 3");
  expect(await drawn(d)).toHaveLength(8);
});

test("a link restores its seed and an algebraic selection", async ({
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
  const d = await openExample(page, "A three-fold rose window");
  await d.getByLabel("Circle", { exact: true }).fill("30");
  const facts = (await d.locator(".garden-facts").textContent())!;
  expect(facts).toContain("√3");
  await d.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(d.getByText("Link copied", { exact: true })).toBeVisible();
  const link: string = await page.evaluate(() => (window as any).copied);
  const saved = wireStudy(new URL(link).hash.slice(3));
  expect(saved.garden.seed).toBe("3-2r3,1,1,1");
  expect(saved.garden.selected.root).toHaveLength(3);
  for (const v of [
    saved.garden.selected.curvature,
    saved.garden.selected.x,
    saved.garden.selected.y,
    ...saved.garden.selected.root,
  ])
    expect(Number.isSafeInteger(v)).toBe(true);
  await page.goto("/");
  await page.goto(link);
  const reopened = garden(page);
  await ready(reopened);
  await expect(reopened.locator("#garden-artwork")).toHaveAttribute(
    "data-selected",
    "29",
  );
  await expect(reopened.locator(".garden-facts")).toHaveText(facts);
  await expect(seedChoice(reopened)).toHaveValue("3-2r3,1,1,1");
});

test("an algebraic selection outside a zoomed view is kept by its exact identity, and the original's request is unchanged", async () => {
  const { gardenRequest, presetGarden } = await import("../web/garden/model");
  // The original: the kept disk is x/b, y/b, 1/b as before. Curvature
  // 23 at (8/23, 12/23) lies outside a view zoomed on (−0.5, −0.5).
  const zoomed = {
    ...presetGarden(2),
    view: { x: 4200, y: -4200, zoom: 24 },
    selected: { curvature: 23, x: 8, y: 12 },
  };
  const q = gardenRequest(zoomed);
  expect(q.window).toBeDefined();
  expect(q.keep).toEqual({ curvature: 23, x: 8, y: 12 });
  // And none on it.
  expect(
    gardenRequest({ ...presetGarden(2), selected: zoomed.selected }).keep,
  ).toBeUndefined();
  // The three-fold seed's central circle, curvature 3 + 2√3 at the origin
  // (generation 1), well away from a view at the far left.
  const threeFold = {
    ...presetGarden(0),
    seed: "3-2r3,1,1,1" as const,
    detail: true,
    view: { x: 8000, y: 0, zoom: 24 },
    selected: {
      curvature: 3,
      x: 0,
      y: 0,
      root: [2, 0, 0] as [number, number, number],
    },
  };
  const k = gardenRequest(threeFold);
  expect(k.keep).toEqual(threeFold.selected);
  // Its radius is (2√3 − 3)/(3 + 2√3) ≈ 0.0718 in enclosing radii, not
  // 1/b ≈ 0.1547: a window three detail cells (≈ 0.0948) to the right of
  // the origin misses it, so it is kept.
  const edge = gardenRequest({
    ...threeFold,
    view: { x: -1680, y: 0, zoom: 24 },
  });
  expect(edge.window!.xMin).toBeCloseTo(0.0948, 3);
  expect(edge.keep).toEqual(threeFold.selected);
  // The same circle with the view on it is not sent.
  const near = { ...threeFold, view: { x: 0, y: 0, zoom: 24 } };
  expect(gardenRequest(near).keep).toBeUndefined();
});

// The live drawing rasterized from its vector markup at the page's size.
const raster = (d: Locator) =>
  d.locator("#garden-artwork").evaluate(async (live) => {
    const svg = live.cloneNode(true) as SVGSVGElement;
    svg.setAttribute("width", "1000");
    svg.setAttribute("height", "760");
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
      c.width = 1000;
      c.height = 760;
      c.getContext("2d")!.drawImage(image, 0, 0);
      // The pixels stay in the page, named by a key: millions of numbers
      // through the protocol cost seconds on a runner.
      const w = window as any;
      w.gardenRasters ??= [];
      w.gardenRasters.push(
        c.getContext("2d")!.getImageData(0, 0, 1000, 760).data,
      );
      return w.gardenRasters.length - 1;
    } finally {
      URL.revokeObjectURL(url);
    }
  });

test("six around one's reveal holds its eight seed circles, in the drawing, the still's record and the decoded movie", async ({
  page,
}) => {
  await page.goto("/");
  const d = await openExample(page, "Six circles around a seventh");
  const n = await circleCount(d);
  const indices = async () =>
    (await drawn(d)).map((c) => c.i).sort((a, b) => a - b);
  const range = (k: number) => Array.from({ length: k }, (_, i) => i);
  await d.getByLabel("Reveal duration", { exact: true }).fill("1.4");
  const slider = d.getByRole("slider", { name: "Animation progress" });
  const seek = async (t: string) => {
    await slider.fill(t);
    await expect(d.locator(".garden-view")).toHaveAttribute(
      "data-reveal-time",
      t,
    );
  };
  // The opening hold shows the eight seed circles, then the rule grows
  // from eight: floor(8·(N/8)^s), s = (p − 0.06)/0.8.
  await seek("0.5");
  expect(await indices()).toEqual(
    range(Math.floor(8 * (n / 8) ** ((0.5 - 0.06) / 0.8))),
  );
  const middle = await raster(d);
  await seek("0");
  expect(await indices()).toEqual(range(8));
  const opening = await raster(d);
  await seek("0.5");
  // The paused frame's still records the seed's curvatures and rule.
  const download = page.waitForEvent("download");
  await d.getByRole("button", { name: "Export image" }).click();
  await page.getByRole("menuitem", { name: /SVG/ }).click();
  const text = await readFile((await (await download).path())!, "utf8");
  const record = await page.evaluate(
    (text) =>
      JSON.parse(
        new DOMParser()
          .parseFromString(text, "image/svg+xml")
          .querySelector("svg > desc")!.textContent!,
      ),
    text,
  );
  expect(record.seed).toBe("-1,3,3,3,3,3,3,3");
  expect(record.curvatures).toEqual([-1, 3, 3, 3, 3, 3, 3, 3]);
  expect(record.reveal.membership).toContain("n = 8 for progress p ≤ 0.06");
  await d.getByRole("button", { name: "Stop reveal" }).click();
  // An animated WebP at the page's size: its first frame is the opening
  // hold, and frame 10 (time 0.5) the middle.
  const settings = d.locator("#garden-export-settings");
  if (!(await settings.evaluate((e) => (e as HTMLDetailsElement).open)))
    await settings.locator("summary").click();
  await d.getByLabel("Export format", { exact: true }).selectOption("webp");
  await d.getByRole("slider", { name: "Export resolution" }).fill("1");
  await d.getByLabel("Export frame rate", { exact: true }).selectOption("15");
  const movie = page.waitForEvent("download");
  await d.getByRole("button", { name: /^Export animated WebP/ }).click();
  const bytes = await readFile((await (await movie).path())!);
  const differences = await page.evaluate(
    async ({ input, references: keys }) => {
      const references: Uint8ClampedArray[] = keys.map(
        (k) => (window as any).gardenRasters[k],
      );
      const decoder = new (window as any).ImageDecoder({
        data: Uint8Array.from(atob(input), (c) => c.charCodeAt(0)),
        type: "image/webp",
      });
      await decoder.tracks.ready;
      const out: number[][] = [];
      for (const i of [0, 10]) {
        const { image } = await decoder.decode({ frameIndex: i });
        const c = document.createElement("canvas");
        c.width = 1000;
        c.height = 760;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(image, 0, 0);
        image.close();
        const px = ctx.getImageData(0, 0, 1000, 760).data;
        // Ink is any pixel well away from the page's color at a corner;
        // the share of inked pixels that only one image has.
        const ink = (d: ArrayLike<number>, k: number) =>
          Math.abs(d[k] - d[0]) +
            Math.abs(d[k + 1] - d[1]) +
            Math.abs(d[k + 2] - d[2]) >
          90;
        out.push(
          references.map((r) => {
            let either = 0,
              one = 0;
            for (let k = 0; k < px.length; k += 4) {
              const a = ink(px, k),
                b = ink(r, k);
              if (a || b) either++;
              if (a !== b) one++;
            }
            return one / either;
          }),
        );
      }
      decoder.close();
      return out;
    },
    { input: bytes.toString("base64"), references: [opening, middle] },
  );
  // Each frame matches its own time's circles, and not the other's.
  console.log("Unmatched ink, frames 0 and 10:", differences);
  expect(differences[0][0]).toBeLessThan(0.1);
  expect(differences[1][1]).toBeLessThan(0.1);
  expect(differences[0][1]).toBeGreaterThan(differences[0][0] + 0.2);
  expect(differences[1][0]).toBeGreaterThan(differences[1][1] + 0.2);
});

for (const [title, seed] of studies)
  test(`${title}: pointer, keyboard and number selection, Follow, zoom detail and cutoffs work as for the original`, async ({
    page,
  }) => {
    await page.goto("/");
    const d = await openExample(page, title);
    const art = d.locator("#garden-artwork");
    const field = d.getByLabel("Circle", { exact: true });
    const n = await circleCount(d);
    // A pointer inside circle 20 selects it.
    const all = await drawn(d);
    const target = all.find((c) => c.i === 19)!;
    const box = (await art.boundingBox())!;
    await page.mouse.click(
      box.x + (target.cx * box.width) / 1000,
      box.y + (target.cy * box.height) / 760,
    );
    await expect(field).toHaveValue("20");
    // The keyboard steps through circles.
    await d.getByRole("button", { name: "Next circle", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(field).toHaveValue("21");
    await d
      .getByRole("button", { name: "Previous circle", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(field).toHaveValue("20");
    // Following frames a selection made by number, and returns.
    const follow = d.getByRole("checkbox", { name: "Follow selection" });
    await follow.check();
    await field.fill("40");
    await expect
      .poll(async () => Number(await art.getAttribute("data-zoom")))
      .toBeGreaterThan(1);
    // Centered, its radius an eighth of the page's 760 units.
    await expect
      .poll(async () => {
        const [x, y] = (await art.getAttribute("data-pan"))!
          .split(",")
          .map(Number);
        const c = await art
          .locator('[data-role="selected"]')
          .evaluate((e) => [
            +e.getAttribute("cx")!,
            +e.getAttribute("cy")!,
            +e.getAttribute("r")!,
          ]);
        return [c[0] + x, c[1] + y, c[2]].map((v) => Math.round(v * 1e6) / 1e6);
      })
      .toEqual([500, 380, 95]);
    const selected = await art.getAttribute("data-selected");
    const facts = (await d.locator(".garden-facts").textContent())!;
    await follow.uncheck();
    await expect(art).toHaveAttribute("data-zoom", "1");
    // Zoom detail grows finer circles for the view, keeps the selection,
    // and zooming back out restores the packing.
    await d.getByLabel("Finer circles when zoomed in").check();
    await ready(d);
    await art.focus();
    for (let i = 0; i < 8; i++) await page.keyboard.press("+");
    await ready(d);
    await expect(d.locator(".garden-summary")).toContainText(
      "Finer circles for this view reach",
    );
    // Numbers change with the view's packing; the circle is the same.
    await expect(d.locator(".garden-facts")).toHaveText(facts);
    await page.keyboard.press("Home");
    await ready(d);
    expect(await circleCount(d)).toBe(n);
    await expect(art).toHaveAttribute("data-selected", selected!);
    // A cutoff edit regrows the packing, the selection following its
    // circle; switching seeds from edited values keeps them.
    await d.getByLabel("Depth", { exact: true }).fill("3");
    await ready(d);
    await expect(d.locator(".garden-summary")).toContainText(
      "in generations 0–3",
    );
    expect(await circleCount(d)).toBeLessThan(n);
    await seedChoice(d).selectOption("-1,2,2,3");
    await ready(d);
    await expect(d.getByLabel("Depth", { exact: true })).toHaveValue("3");
    await expect(d.getByText("No circle selected.")).toBeVisible();
    await seedChoice(d).selectOption(seed);
    await ready(d);
    await expect(d.locator(".garden-summary")).toContainText(
      "in generations 0–3",
    );
  });

// The split diameter (#387): the one seed with a parameter. Seed circles
// of radii r and 1 − r fill the enclosing circle's horizontal diameter,
// and the split r is rounded to the nearest fraction m/n with n ≤ 100,
// which makes every curvature an integer: −m(n − m), n(n − m), nm and
// n² − m(n − m). Expected fractions below are worked by hand from
// continued fractions.
const splitField = (d: Locator) => d.getByLabel("Split", { exact: true });
const fieldError = (field: Locator) =>
  field
    .locator("xpath=ancestor::div[contains(@class,'field')][1]")
    .locator(".field-error");
const splitNote = (d: Locator) => d.locator(".garden-seed-note");

test("the split is rounded to the nearest fraction with a denominator of at most 100", async () => {
  const { nearestFraction } = await import("../web/garden/seeds");
  for (const [v, want] of [
    [0.25, [1, 4]],
    [0.3, [3, 10]],
    [0.5, [1, 2]],
    [0.05, [1, 20]],
    [0.95, [19, 20]],
    [1 / 3, [1, 3]],
    [2 / 3, [2, 3]],
    // π/10: convergents 1/3, 5/16, 11/35, 71/226.
    [Math.PI / 10, [11, 35]],
    // 1/φ² = 0.381966…: Fibonacci ratios 21/55, 34/89, 55/144.
    [(3 - Math.sqrt(5)) / 2, [34, 89]],
    // Within half of 1/100 of an end, nothing is closer than 0 or 1. The
    // double nearest 0.005 lies just above it, so exactly, 1/100 is nearer.
    [0.0049, [0, 1]],
    [0.005, [1, 100]],
    [0.993, [99, 100]],
    [0.997, [1, 1]],
    [-1, [0, 1]],
    [2, [1, 1]],
    [0.0499, [1, 20]],
  ] as const)
    expect(nearestFraction(v, 100), String(v)).toEqual(want);
});

test("a link carries the split as entered, needs it for the split diameter and drops it for other seeds", async () => {
  const { presetGarden } = await import("../web/garden/model");
  const { planarStudy, presetStudy } = await import("../web/planar-link");
  const open = (garden: Record<string, unknown>) =>
    planarStudy({ ...presetStudy(0), garden: garden as any }).garden!;
  const base = { ...presetGarden(0), seed: "split" };
  expect(open({ ...base, split: 0.3 }).split).toBe(0.3);
  // 0.0499 rounds to 1/20, the end of the range, and opens.
  expect(open({ ...base, split: 0.0499 }).split).toBe(0.0499);
  for (const split of [undefined, 0, 1, 0.01, 0.04, 0.96, -0.5, "1/4"])
    expect(await refusal({ ...base, split }), String(split)).toBe(
      "garden.split",
    );
  // Another seed has no split: one in its link is dropped.
  const original = open({ ...presetGarden(0), split: 0.3 });
  expect(original.seed).toBe("-1,2,2,3");
  expect("split" in original).toBe(false);
});

test("choosing the split diameter shows its split, exact curvatures and seed circles, and refuses splits outside 0.05–0.95 under the field", async ({
  page,
}) => {
  await page.goto("/");
  const d = await openExample(page, "A rose window made only of circles");
  // From edited cutoffs: they are kept.
  await d.getByLabel("Depth", { exact: true }).fill("7");
  await ready(d);
  await seedChoice(d).selectOption("split");
  await ready(d);
  await expect(d.getByLabel("Depth", { exact: true })).toHaveValue("7");
  await expect(splitField(d)).toHaveValue("0.25");
  await expect(splitNote(d)).toHaveText(
    "Exactly 1/4 · curvatures −3, 12, 4, 13",
  );
  await expect(d.locator(".eyebrow")).toHaveText(
    "Apollonian packing · curvatures −3, 12, 4, 13",
  );
  // The seed circles, from the drawing: radii 1/4 and 3/4 of the
  // enclosing circle's, on its horizontal diameter, and the top circle of
  // radius r(1 − r)/(1 − r + r²) = 3/13, all mutually tangent.
  const seeds = async () => {
    const c = (await drawn(d)).filter((c) => c.i < 4);
    c.sort((a, b) => a.i - b.i);
    return c;
  };
  const check = async (r: number) => {
    const [outer, left, right, top] = await seeds();
    const R = outer.r;
    expect(left.r / R).toBeCloseTo(r, 9);
    expect(right.r / R).toBeCloseTo(1 - r, 9);
    expect(top.r / R).toBeCloseTo((r * (1 - r)) / (1 - r + r * r), 9);
    expect((left.cx - outer.cx) / R).toBeCloseTo(r - 1, 9);
    expect((right.cx - outer.cx) / R).toBeCloseTo(r, 9);
    expect(left.cy).toBeCloseTo(outer.cy, 6);
    expect(top.cy).toBeLessThan(outer.cy);
    const all = [outer, left, right, top];
    for (const a of all.slice(1))
      for (const b of all) if (a !== b) expect(tangent(a, b)).toBe(true);
  };
  await check(0.25);
  // An expression, rounded to its fraction.
  await splitField(d).fill("1/5");
  await ready(d);
  await expect(splitNote(d)).toHaveText(
    "Exactly 1/5 · curvatures −4, 20, 5, 21",
  );
  await check(0.2);
  await splitField(d).fill("pi/10");
  await ready(d);
  await expect(splitNote(d)).toHaveText(
    "Exactly 11/35 · curvatures −264, 840, 385, 961",
  );
  await check(11 / 35);
  // Refusals, under the field, with the drawing kept and no note.
  const before = await circleCount(d);
  for (const [text, message] of [
    ["0", "0.05–0.95"],
    ["1", "0.05–0.95"],
    ["0.04", "0.05–0.95"],
    ["0.96", "0.05–0.95"],
    ["-2", "0.05–0.95"],
    ["", "finite number"],
  ]) {
    await splitField(d).fill(text);
    await expect(fieldError(splitField(d)), text).toContainText(message);
    await expect(splitNote(d)).toHaveCount(0);
    await expect(
      d.getByRole("button", { name: "Copy link", exact: true }),
    ).toBeDisabled();
    expect(await circleCount(d)).toBe(before);
  }
  await splitField(d).fill("x");
  await expect(fieldError(splitField(d))).toBeVisible();
  // Just inside the range's end, by rounding.
  await splitField(d).fill("0.0499");
  await ready(d);
  await expect(fieldError(splitField(d))).toHaveCount(0);
  await expect(splitNote(d)).toHaveText(
    "Exactly 1/20 · curvatures −19, 380, 20, 381",
  );
  await check(0.05);
  // Another seed and back: the split last entered returns.
  await splitField(d).fill("0.3");
  await ready(d);
  await seedChoice(d).selectOption("-1,2,2,3");
  await ready(d);
  await expect(splitField(d)).toHaveCount(0);
  await expect(d.locator(".eyebrow")).toHaveText(
    "Apollonian packing · curvatures −1, 2, 2, 3",
  );
  await seedChoice(d).selectOption("split");
  await ready(d);
  await expect(splitField(d)).toHaveValue("0.3");
  await expect(splitNote(d)).toHaveText(
    "Exactly 3/10 · curvatures −21, 70, 30, 79",
  );
});

test("a new split clears the selection and ends a reveal; the same fraction keeps both the selection and the packing", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.gardenPosts = [];
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (q: any, ...rest: any[]) {
      if (q?.action === "garden") w.gardenPosts.push(q.garden.split);
      send.call(this, q, ...rest);
    };
  });
  await page.goto("/");
  const d = await openExample(page, "A rose window made only of circles");
  await seedChoice(d).selectOption("split");
  await ready(d);
  await d.getByLabel("Circle", { exact: true }).fill("30");
  const artwork = d.locator("#garden-artwork");
  await expect(artwork).toHaveAttribute("data-selected", "29");
  const posts = () => page.evaluate(() => (window as any).gardenPosts.length);
  const sent = await posts();
  // 0.2500001 is still 1/4: nothing is asked again and the selection stays.
  await splitField(d).fill("0.2500001");
  await expect(splitField(d)).toHaveValue("0.2500001");
  await page.waitForTimeout(400);
  expect(await posts()).toBe(sent);
  await expect(artwork).toHaveAttribute("data-selected", "29");
  // A paused reveal ends when the split changes, and the new packing is
  // drawn without the selection.
  await d.getByLabel("Reveal duration", { exact: true }).fill("2");
  const slider = d.getByRole("slider", { name: "Animation progress" });
  await slider.fill("0.5");
  await expect(d.locator(".garden-view")).toHaveAttribute(
    "data-reveal-time",
    "0.5",
  );
  await splitField(d).fill("1/3");
  // A paused reveal never marks the drawing busy, so readiness means
  // nothing until the split has resolved and ended it.
  await expect(d.locator(".garden-view")).not.toHaveAttribute(
    "data-reveal-time",
  );
  await ready(d);
  await expect(d.getByText("No circle selected.")).toBeVisible();
  const last = await page.evaluate(() => (window as any).gardenPosts.at(-1));
  expect(last).toEqual([1, 3]);
});

test("a pending split sends nothing, and one that resolves after the seed changed is dropped", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.gardenPosts = [];
    w.delay = 0;
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (q: any, ...rest: any[]) {
      if (q?.action === "garden") w.gardenPosts.push(q.garden);
      if (q?.action === "scalars" && w.delay)
        setTimeout(() => send.call(this, q, ...rest), w.delay);
      else send.call(this, q, ...rest);
    };
  });
  await page.goto("/");
  const d = await openExample(page, "A rose window made only of circles");
  await seedChoice(d).selectOption("split");
  await ready(d);
  await page.evaluate(() => ((window as any).delay = 800));
  const sent = await page.evaluate(() => (window as any).gardenPosts.length);
  await splitField(d).fill("1/5");
  await expect(d.locator("#garden-artwork")).toHaveAttribute(
    "aria-busy",
    "true",
  );
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => (window as any).gardenPosts.length)).toBe(
    sent,
  );
  await ready(d);
  expect(
    await page.evaluate(() => (window as any).gardenPosts.at(-1).split),
  ).toEqual([1, 5]);
  // Typed, then the seed changed before the value resolved.
  await splitField(d).fill("1/3");
  await seedChoice(d).selectOption("-1,2,2,3");
  await page.waitForTimeout(1200);
  await ready(d);
  await expect(d.locator(".eyebrow")).toHaveText(
    "Apollonian packing · curvatures −1, 2, 2, 3",
  );
  const last = await page.evaluate(() => (window as any).gardenPosts.at(-1));
  expect(last.seed).toBe("-1,2,2,3");
  expect(last.split).toBeUndefined();
  // Back to the split diameter: the last split that resolved.
  await page.evaluate(() => ((window as any).delay = 0));
  await seedChoice(d).selectOption("split");
  await ready(d);
  await expect(splitNote(d)).toHaveText(
    "Exactly 1/5 · curvatures −4, 20, 5, 21",
  );
});

test("a link restores the split as entered and its selection; the still records the drawn split and curvatures", async ({
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
  const d = await openExample(page, "A rose window made only of circles");
  await seedChoice(d).selectOption("split");
  await splitField(d).fill("0.3");
  await ready(d);
  await expect(splitNote(d)).toContainText("Exactly 3/10");
  await d.getByLabel("Circle", { exact: true }).fill("40");
  const facts = (await d.locator(".garden-facts").textContent())!;
  await d.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(d.getByText("Link copied", { exact: true })).toBeVisible();
  const link: string = await page.evaluate(() => (window as any).copied);
  const saved = wireStudy(new URL(link).hash.slice(3));
  expect(saved.garden.seed).toBe("split");
  expect(saved.garden.split).toBe(0.3);
  expect(saved.garden.selected.root).toBeUndefined();
  // The still records the drawn packing's seed, split and curvatures.
  const download = page.waitForEvent("download");
  await d.getByRole("button", { name: "Export image" }).click();
  await page.getByRole("menuitem", { name: /SVG/ }).click();
  const text = await readFile((await (await download).path())!, "utf8");
  const record = await page.evaluate(
    (text) =>
      JSON.parse(
        new DOMParser()
          .parseFromString(text, "image/svg+xml")
          .querySelector("svg > desc")!.textContent!,
      ),
    text,
  );
  expect(record.seed).toBe("split");
  expect(record.split).toBe("3/10");
  expect(record.curvatures).toEqual([-21, 70, 30, 79]);
  expect(record.selected.number).toBe(40);
  await page.goto("/");
  await page.goto(link);
  const reopened = garden(page);
  await ready(reopened);
  await expect(splitField(reopened)).toHaveValue("0.3");
  await expect(reopened.locator("#garden-artwork")).toHaveAttribute(
    "data-selected",
    "39",
  );
  await expect(reopened.locator(".garden-facts")).toHaveText(facts);
});

test("a split selection outside a zoomed view is kept by its disk in the split's own units", async () => {
  const { gardenRequest, presetGarden } = await import("../web/garden/model");
  // At 1/4 (b₀ = −3, D = 3) the top seed circle is curvature 13 with
  // numerators (1 − 9, 2·3) = (−8, 6): center (−8/13, 6/13), radius 3/13.
  // Read with the original's normalization its radius would be 1/13.
  const top = { curvature: 13, x: -8, y: 6 };
  const center = { x: -8 / 13, y: 6 / 13 },
    radius = 3 / 13;
  const at = (dx: number) => {
    const zoom = 24,
      k = 350 * zoom;
    return {
      ...presetGarden(0),
      seed: "split" as const,
      split: 0.25,
      detail: true,
      selected: top,
      view: { x: -(center.x + dx) * k, y: center.y * k, zoom },
    };
  };
  const meets = (w: {
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
  }) =>
    Math.hypot(
      center.x - Math.max(w.xMin, Math.min(w.xMax, center.x)),
      center.y - Math.max(w.yMin, Math.min(w.yMax, center.y)),
    ) <= radius;
  // A view whose window starts between 1/13 and 3/13 right of the center
  // reaches the circle, so nothing is kept.
  const near = gardenRequest(at(0.22));
  expect(near.split).toEqual([1, 4]);
  expect(near.window!.xMin - center.x).toBeGreaterThan(1 / 13);
  expect(near.window!.xMin - center.x).toBeLessThan(radius);
  expect(meets(near.window!)).toBe(true);
  expect(near.keep).toBeUndefined();
  // Farther, it misses and is kept.
  const far = gardenRequest(at(0.45));
  expect(meets(far.window!)).toBe(false);
  expect(far.keep).toEqual(top);
});

test("a movie exported while the split changes keeps the packing it froze, in its frames and record", async ({
  page,
}) => {
  await page.goto("/");
  const d = await openExample(page, "Pearls in a crescent");
  const n = await circleCount(d);
  // The whole packing at 1/4, as the reveal's end holds it.
  const whole = await raster(d);
  await d.getByLabel("Reveal duration", { exact: true }).fill("4");
  const settings = d.locator("#garden-export-settings");
  if (!(await settings.evaluate((e) => (e as HTMLDetailsElement).open)))
    await settings.locator("summary").click();
  await d.getByLabel("Export format", { exact: true }).selectOption("webp");
  await d.getByRole("slider", { name: "Export resolution" }).fill("1");
  await d.getByLabel("Export frame rate", { exact: true }).selectOption("15");
  let done = false;
  const movie = page.waitForEvent("download").then((m) => {
    done = true;
    return m;
  });
  await d.getByRole("button", { name: /^Export animated WebP/ }).click();
  // Mid-export, a new split: the export keeps its frozen packing.
  await splitField(d).fill("1/3");
  await expect(splitNote(d)).toContainText("Exactly 1/3");
  expect(done, "the export ended before the split changed").toBe(false);
  const bytes = await readFile((await (await movie).path())!);
  const text = bytes.toString("latin1");
  expect(text).toContain('"seed":"split","split":"1/4"');
  expect(text).toContain('"curvatures":[-3,12,4,13]');
  expect(text).toContain(`"circles":${n}`);
  await ready(d);
  const edited = await raster(d);
  const differences = await page.evaluate(
    async ({ input, references: keys }) => {
      const references: Uint8ClampedArray[] = keys.map(
        (k) => (window as any).gardenRasters[k],
      );
      const decoder = new (window as any).ImageDecoder({
        data: Uint8Array.from(atob(input), (c) => c.charCodeAt(0)),
        type: "image/webp",
      });
      await decoder.tracks.ready;
      const last = decoder.tracks.selectedTrack.frameCount - 1;
      const { image } = await decoder.decode({ frameIndex: last });
      const c = document.createElement("canvas");
      c.width = 1000;
      c.height = 760;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      image.close();
      decoder.close();
      const px = ctx.getImageData(0, 0, 1000, 760).data;
      const ink = (d: ArrayLike<number>, k: number) =>
        Math.abs(d[k] - d[0]) +
          Math.abs(d[k + 1] - d[1]) +
          Math.abs(d[k + 2] - d[2]) >
        90;
      return references.map((r) => {
        let either = 0,
          one = 0;
        for (let k = 0; k < px.length; k += 4) {
          const a = ink(px, k),
            b = ink(r, k);
          if (a || b) either++;
          if (a !== b) one++;
        }
        return one / either;
      });
    },
    { input: bytes.toString("base64"), references: [whole, edited] },
  );
  // The last frame is the frozen 1/4 packing, not the edited 1/3 one.
  console.log("Unmatched ink, last frame against 1/4 and 1/3:", differences);
  expect(differences[0]).toBeLessThan(0.1);
  expect(differences[1]).toBeGreaterThan(differences[0] + 0.2);
});
