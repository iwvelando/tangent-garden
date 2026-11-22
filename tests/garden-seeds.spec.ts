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
      return Array.from(c.getContext("2d")!.getImageData(0, 0, 1000, 760).data);
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
    async ({ input, references }) => {
      const decoder = new (window as any).ImageDecoder({
        data: new Uint8Array(input),
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
    { input: Array.from(bytes), references: [opening, middle] },
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
