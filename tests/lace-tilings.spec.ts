import { test, expect, type Page, type Locator } from "@playwright/test";
import { wireStudy } from "./study-link-wire";

// Issue #389's research preview of further hyperbolic tilings, gated
// behind ?research=389. Without the parameter the lace behaves as on main.
// Geometry is read from the drawn SVG and checked against {p,q} formulas
// written out here; the invariants are engine/lace_tilings_test.go's.

const research = "/?research=389";
const lace = (page: Page) =>
  page.getByRole("dialog", { name: "Hyperbolic lace" });
const art = (d: Locator) => d.locator("#lace-artwork");
const ready = (d: Locator) =>
  expect(art(d)).toHaveAttribute("aria-busy", "false");
async function openExample(page: Page, title: string) {
  await page.getByRole("button", { name: "Browse notebook examples" }).click();
  const gallery = page.getByRole("dialog", { name: "Notebook examples" });
  await gallery
    .locator(`[data-lace-example][data-example-title="${title}"]`)
    .click();
  await gallery.waitFor({ state: "hidden" });
  const d = lace(page);
  await ready(d);
  return d;
}
const tilingChoice = (d: Locator) =>
  d.getByRole("combobox", { name: "Tiling (research)" });
const tileCount = async (d: Locator) =>
  Number(
    (await d.locator(".lace-summary").textContent())!
      .match(/^([\d,]+) tiles?/)![1]
      .replace(/,/g, ""),
  );

type C = { x: number; y: number };
// The ends of every drawn segment of a role, in model units at the
// camera's zoom (the pan is the group's translation).
async function ends(d: Locator, role: string): Promise<[C, C][]> {
  const zoom = Number(await art(d).getAttribute("data-zoom"));
  const ds = await art(d).evaluate(
    (svg, role) =>
      Array.from(svg.querySelectorAll(`path[data-role="${role}"]`), (p) =>
        p.getAttribute("d"),
      ),
    role,
  );
  const out: [C, C][] = [];
  const at = (x: string, y: string) => ({
    x: (+x - 500) / (350 * zoom),
    y: (380 - +y) / (350 * zoom),
  });
  for (const d of ds)
    for (const m of d!.matchAll(
      /M(-?[\d.]+) (-?[\d.]+)(?:A-?[\d.]+ -?[\d.]+ 0 0 [01] |L)(-?[\d.]+) (-?[\d.]+)/g,
    ))
      out.push([at(m[1], m[2]), at(m[3], m[4])]);
  return out;
}
const near = (a: C, b: C, tol = 0.003 / 350) =>
  Math.hypot(a.x - b.x, a.y - b.y) < tol;
// Hyperbolic distance in the disk, 2 asinh(|z − w| / √((1 − |z|²)(1 − |w|²))).
const between = (z: C, w: C) =>
  2 *
  Math.asinh(
    Math.hypot(z.x - w.x, z.y - w.y) /
      Math.sqrt((1 - z.x ** 2 - z.y ** 2) * (1 - w.x ** 2 - w.y ** 2)),
  );
// The {p,q} seed from its right triangle: corner radius tanh(R/2) with
// cosh R = cot(π/p)·cot(π/q), and side s with cosh(s/2) = cos(π/p)/sin(π/q).
const seed = (p: number, q: number) => ({
  corner: Math.tanh(
    Math.acosh(1 / (Math.tan(Math.PI / p) * Math.tan(Math.PI / q))) / 2,
  ),
  side: 2 * Math.acosh(Math.cos(Math.PI / p) / Math.sin(Math.PI / q)),
});

const studies = [
  ["Pentagonal flowers, four at every corner (research)", 5, 4, 5, 441, "90"],
  ["Square stars, five at every corner (research)", 4, 5, 6, 597, "72"],
  ["Triangles, seven at every corner (research)", 3, 7, 8, 298, "51.4286"],
] as const;
const words: Record<number, string> = {
  3: "triangle",
  4: "square",
  5: "pentagon",
};

test("without the research parameter the lace offers only {7,3}, and refuses another tiling's link", async ({
  page,
}) => {
  const { planarStudy, presetStudy } = await import("../web/planar-link");
  const { LinkError } = await import("../web/study-link");
  const { presetLace, lacePresets } = await import("../web/lace/model");
  expect(lacePresets).toHaveLength(3);
  let error: unknown;
  try {
    planarStudy({
      ...presetStudy(0),
      lace: { ...presetLace(0), tiling: "5,4" as any },
    });
  } catch (e) {
    error = e;
  }
  expect(error instanceof LinkError && error.field).toBe("lace.tiling");
  await page.goto("/");
  await page.getByRole("button", { name: "Browse notebook examples" }).click();
  const gallery = page.getByRole("dialog", { name: "Notebook examples" });
  await expect(gallery.locator("[data-lace-example]")).toHaveCount(3);
  await page.keyboard.press("Escape");
  const d = await openExample(page, "Seven-pointed stars receding to the rim");
  await expect(tilingChoice(d)).toHaveCount(0);
  await expect(d.locator(".eyebrow")).toHaveText(
    "Poincaré disk · regular tiling {7,3}",
  );
  await expect(d.locator(".garden-heading p").last()).toContainText(
    "Heptagons meeting three at a corner",
  );
});

test("an address side the tiling's tiles lack is refused in a link", async () => {
  const { planarStudy, presetStudy } = await import("../web/planar-link");
  const { LinkError } = await import("../web/study-link");
  const { presetLace } = await import("../web/lace/model");
  // {7,3}: sides 0–6, all admitted as before.
  const ok = planarStudy({
    ...presetStudy(0),
    lace: { ...presetLace(0), selected: [6, 0, 6] },
  });
  expect(ok.lace?.selected).toEqual([6, 0, 6]);
  let error: unknown;
  try {
    planarStudy({
      ...presetStudy(0),
      lace: { ...presetLace(0), selected: [7] },
    });
  } catch (e) {
    error = e;
  }
  expect(error instanceof LinkError && error.field).toBe("lace.selected[0]");
});

for (const [title, p, q, depth, tiles, angle] of studies)
  test(`${title} draws regular {${p},${q}} tiles, ${q} at an interior corner`, async ({
    page,
  }) => {
    await page.goto(research);
    const d = await openExample(page, title);
    await expect(tilingChoice(d)).toHaveValue(`${p},${q}`);
    await expect(d.getByLabel("Depth", { exact: true })).toHaveValue(
      String(depth),
    );
    expect(await tileCount(d)).toBe(tiles);
    await expect(d.locator(".eyebrow")).toHaveText(
      `Poincaré disk · regular tiling {${p},${q}}`,
    );
    const { corner, side } = seed(p, q);
    // The center tile's top corner, at (0, tanh(R/2)), is interior: q
    // drawn sides end there.
    const top = { x: 0, y: corner };
    const edges = await ends(d, "edge");
    const meeting = edges.filter(([a, b]) => near(a, top) || near(b, top));
    expect(meeting).toHaveLength(q);
    // A selected tile one reflection out: p corners, each two sides of
    // length s from its neighbors, and an explanation naming its shape.
    await d.getByLabel("Tile", { exact: true }).fill("2");
    await ready(d);
    const sides = await ends(d, "selectedEdge");
    expect(sides).toHaveLength(p);
    for (const [a, b] of sides)
      expect(Math.abs(between(a, b) - side)).toBeLessThan(1e-4);
    const about = d.locator(".garden-about");
    await expect(about).toContainText(`its angles ${angle}°`);
    await expect(about).toContainText(`mirror symmetries`);
    await d.getByLabel("Tile", { exact: true }).fill("1");
    await expect(about).toContainText(`regular ${words[p]}`);
  });

test("changing the tiling clears the selection and opens it at its deepest complete ring", async ({
  page,
}) => {
  await page.goto(research);
  const d = await openExample(page, "Seven-pointed stars receding to the rim");
  await expect(tilingChoice(d)).toHaveValue("7,3");
  await d.getByLabel("Star point", { exact: true }).fill("0.6");
  // Tile 33, address 0, 3, 0, which in {5,4} names tile 28: the selection
  // is cleared rather than carried over to another tile.
  await d.getByLabel("Tile", { exact: true }).fill("33");
  await expect(art(d)).toHaveAttribute("data-selected", "32");
  await tilingChoice(d).selectOption("5,4");
  await ready(d);
  await expect(d.getByLabel("Depth", { exact: true })).toHaveValue("5");
  await expect(d.getByLabel("Star point", { exact: true })).toHaveValue("0.6");
  await expect(art(d)).toHaveAttribute("data-selected", "-1");
  expect(await tileCount(d)).toBe(441);
  await tilingChoice(d).selectOption("4,5");
  await ready(d);
  await expect(d.getByLabel("Depth", { exact: true })).toHaveValue("6");
  expect(await tileCount(d)).toBe(597);
  await tilingChoice(d).selectOption("7,3");
  await ready(d);
  await expect(d.getByLabel("Depth", { exact: true })).toHaveValue("5");
  expect(await tileCount(d)).toBe(617);
});

test("a research link restores its tiling and selection, and opens only in the research preview", async ({
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
  const d = await openExample(
    page,
    "Pentagonal flowers, four at every corner (research)",
  );
  await d.getByLabel("Tile", { exact: true }).fill("30");
  await ready(d);
  const facts = (await d.locator(".garden-about").textContent())!;
  await d.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(d.getByText("Link copied", { exact: true })).toBeVisible();
  const link: string = await page.evaluate(() => (window as any).copied);
  const saved = wireStudy(new URL(link).hash.slice(3));
  expect(saved.lace.tiling).toBe("5,4");
  for (const side of saved.lace.selected) expect(side).toBeLessThan(5);
  await page.goto("/");
  await page.goto(link);
  const reopened = lace(page);
  await ready(reopened);
  await expect(art(reopened)).toHaveAttribute("data-selected", "29");
  await expect(reopened.locator(".garden-about")).toHaveText(facts);
  // The same link without the parameter is refused.
  const url = new URL(link);
  url.search = "";
  await page.goto("/");
  await page.goto(url.toString());
  await expect(page.getByText("lace.tiling", { exact: false })).toBeVisible();
  await expect(lace(page)).toHaveCount(0);
});

test("a research link whose address crosses a side its tiles lack is refused", async ({
  page,
}) => {
  const { presetStudy } = await import("../web/planar-link");
  const { presetLace } = await import("../web/lace/model");
  const { studyHref, writeStudyLink } = await import("../web/study-link");
  const open = async (selected: number[]) => {
    const token = await writeStudyLink("2d", {
      ...presetStudy(0),
      lace: { ...presetLace(0), tiling: "5,4", depth: 5, selected },
    });
    await page.goto("/");
    await page.goto(
      studyHref("http://localhost/?research=389", "2d", token).replace(
        "http://localhost",
        "",
      ),
    );
  };
  // A pentagon has sides 0–4.
  await open([0, 4]);
  await ready(lace(page));
  await expect(art(lace(page))).toHaveAttribute("data-selected", "9");
  await open([0, 5]);
  await expect(
    page.getByText("lace.selected[1]", { exact: false }),
  ).toBeVisible();
  await expect(lace(page)).toHaveCount(0);
});

for (const [title, p, q] of [
  ["A pentagon glides to the center and back (research)", 5, 4],
  ["A square glides to the center and back (research)", 4, 5],
] as const)
  test(`${title}: halfway, the selected tile is the center tile's size and centered`, async ({
    page,
  }) => {
    await page.goto(research);
    const d = await openExample(page, title);
    const slider = d.getByRole("slider", { name: "Animation progress" });
    for (const t of ["0.5", "0.25", "0.5"]) {
      await slider.fill(t);
      await expect(d.locator(".garden-view")).toHaveAttribute(
        "data-motion-time",
        t,
      );
      await ready(d);
      const corners = new Map<string, C>();
      for (const [a, b] of await ends(d, "selectedEdge"))
        for (const c of [a, b])
          corners.set(`${c.x.toFixed(4)},${c.y.toFixed(4)}`, c);
      expect(corners.size).toBe(p);
      const radii = [...corners.values()].map((c) => Math.hypot(c.x, c.y));
      const { corner } = seed(p, q);
      for (const r of radii)
        if (t === "0.5") expect(Math.abs(r - corner)).toBeLessThan(2e-5);
      if (t === "0.25")
        expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(0.05);
    }
  });
