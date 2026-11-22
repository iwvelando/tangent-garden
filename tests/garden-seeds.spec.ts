import { test, expect, type Page, type Locator } from "@playwright/test";
import { wireStudy } from "./study-link-wire";

// Issue #385's research preview of alternate Apollonian seeds, gated behind
// ?research=385. Without the parameter the garden behaves as on main.
// Geometry is asserted on the drawn circles, independently of the engine.

const research = "/?research=385";
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
  d.getByRole("combobox", { name: "Seed (research)" });
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
  ["A three-fold rose window (research)", "3-2r3,1,1,1", 4],
  ["Six circles around a seventh (research)", "-1,3,3,3,3,3,3,3", 8],
  ["A window with one mirror (research)", "-2,3,6,7", 4],
  ["A window with no symmetry (research)", "-6,11,14,15", 4],
  ["A five and two eights (research)", "-3,5,8,8", 4],
] as const;

test("without the research parameter the garden offers only its own seed, and refuses another seed's link", async ({
  page,
}) => {
  const { planarStudy, presetStudy } = await import("../web/planar-link");
  const { LinkError } = await import("../web/study-link");
  const { presetGarden, gardenPresets } = await import("../web/garden/model");
  expect(gardenPresets).toHaveLength(3);
  let error: unknown;
  try {
    planarStudy({
      ...presetStudy(0),
      garden: { ...presetGarden(0), seed: "-2,3,6,7" as any },
    });
  } catch (e) {
    error = e;
  }
  expect(error instanceof LinkError && error.field).toBe("garden.seed");
  await page.goto("/");
  await page.getByRole("button", { name: "Browse notebook examples" }).click();
  const gallery = page.getByRole("dialog", { name: "Notebook examples" });
  await expect(gallery.locator("[data-garden-example]")).toHaveCount(3);
  await page.keyboard.press("Escape");
  const d = await openExample(page, "A rose window made only of circles");
  await expect(seedChoice(d)).toHaveCount(0);
  await expect(d.locator(".eyebrow")).toHaveText(
    "Apollonian packing · curvatures −1, 2, 2, 3",
  );
});

for (const [title, seed, seeds] of studies)
  test(`${title} draws a packing whose selections are tangent to their generators`, async ({
    page,
  }) => {
    await page.goto(research);
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
      if (seeds === 8 && n === seeds + 1)
        expect(text).toContain("not part of the packing");
    }
  });

test("changing the seed clears the selection, keeps the cutoffs and raises the circle limit to the seed count", async ({
  page,
}) => {
  await page.goto(research);
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

test("a research link restores its seed and an algebraic selection, and opens only in the research preview", async ({
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
  await page.goto(research);
  const d = await openExample(page, "A three-fold rose window (research)");
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
  // The same link without the parameter is refused.
  const url = new URL(link);
  url.search = "";
  await page.goto("/");
  await page.goto(url.toString());
  await expect(page.getByText("garden.seed", { exact: false })).toBeVisible();
  await expect(garden(page)).toHaveCount(0);
});

test("a research selection outside a zoomed view is kept by its exact identity, and the original's request is unchanged", async () => {
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
