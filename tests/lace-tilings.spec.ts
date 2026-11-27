import { test, expect, type Page, type Locator } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { wireStudy } from "./study-link-wire";
import { decodeVideo, frameDifference, probe } from "./video";

// The lace's catalog of regular tilings: {7,3} heptagons, {5,4} pentagons
// and their duals, {4,5} squares and {3,7} triangles. Geometry is read from
// the drawn SVG and checked against {p,q} formulas written out here; the
// invariants are engine/lace_tilings_test.go's.
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
  d.getByRole("combobox", { name: "Tiling" });
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
  ["Pentagonal flowers, four at every corner", 5, 4, 5, 441, "90"],
  ["Square stars, five at every corner", 4, 5, 6, 597, "72"],
  ["Triangles, seven at every corner", 3, 7, 10, 742, "51.4286"],
] as const;
const words: Record<number, string> = {
  3: "triangle",
  4: "square",
  5: "pentagon",
};

test("the lace offers each tiling, and refuses an unknown one's link", async ({
  page,
}) => {
  const { planarStudy, presetStudy } = await import("../web/planar-link");
  const { LinkError } = await import("../web/study-link");
  const { presetLace, lacePresets } = await import("../web/lace/model");
  // The {7,3} studies keep their places; the catalog's follow them.
  expect(lacePresets.map((p) => p.study.tiling)).toEqual([
    "7,3",
    "7,3",
    "7,3",
    "5,4",
    "5,4",
    "4,5",
    "4,5",
    "5,4",
    "3,7",
    // The motifs' studies follow.
    "7,3",
    "5,4",
    "4,5",
    "5,4",
    // The loop's study follows them.
    "7,3",
    // Then the snowflake ornament, made to print.
    "7,3",
  ]);
  for (const p of lacePresets) expect(p.title).not.toContain("research");
  let error: unknown;
  try {
    planarStudy({
      ...presetStudy(0),
      lace: { ...presetLace(0), tiling: "8,3" as any },
    });
  } catch (e) {
    error = e;
  }
  expect(error instanceof LinkError && error.field).toBe("lace.tiling");
  await page.goto("/");
  await page.getByRole("button", { name: "Browse notebook examples" }).click();
  const gallery = page.getByRole("dialog", { name: "Notebook examples" });
  await expect(gallery.locator("[data-lace-example]")).toHaveCount(15);
  await page.keyboard.press("Escape");
  const d = await openExample(page, "Seven-pointed stars receding to the rim");
  await expect(tilingChoice(d)).toHaveValue("7,3");
  await expect(tilingChoice(d).locator("option")).toHaveText([
    "{7,3} heptagons",
    "{5,4} pentagons",
    "{4,5} squares",
    "{3,7} triangles",
  ]);
  await expect(d.locator(".eyebrow")).toHaveText(
    "Poincaré disk · regular tiling {7,3}",
  );
  await expect(d.locator(".garden-heading p").last()).toContainText(
    "Heptagons meeting three at a corner",
  );
});

// {3,7}'s rings grow so slowly that it has its own depth bound, 11; the
// others keep 8. A link past its tiling's bound is refused under
// lace.depth, and an address no longer than the bound is admitted.
test("each tiling's depth bound holds in links", async () => {
  const { planarStudy, presetStudy } = await import("../web/planar-link");
  const { LinkError } = await import("../web/study-link");
  const { presetLace } = await import("../web/lace/model");
  const field = (lace: object) => {
    try {
      planarStudy({ ...presetStudy(0), lace: { ...presetLace(0), ...lace } });
    } catch (e) {
      return e instanceof LinkError ? e.field : String(e);
    }
    return "";
  };
  expect(field({ tiling: "3,7", depth: 11 })).toBe("");
  expect(field({ tiling: "3,7", depth: 12 })).toBe("lace.depth");
  for (const tiling of ["7,3", "5,4", "4,5"]) {
    expect(field({ tiling, depth: 8 })).toBe("");
    expect(field({ tiling, depth: 9 })).toBe("lace.depth");
  }
  const long = (n: number) => Array.from({ length: n }, (_, k) => k % 3);
  expect(field({ tiling: "3,7", depth: 11, selected: long(11) })).toBe("");
  expect(field({ tiling: "3,7", depth: 11, selected: long(12) })).toBe(
    "lace.selected",
  );
  expect(field({ selected: long(8) })).toBe("");
  expect(field({ selected: long(9) })).toBe("lace.selected");
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
    await page.goto("/");
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
  await page.goto("/");
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
  // {3,7} opens at depth 10, and its own bound admits depth 11, where the
  // tile limit ends the patch.
  await tilingChoice(d).selectOption("3,7");
  await ready(d);
  await expect(d.getByLabel("Depth", { exact: true })).toHaveValue("10");
  expect(await tileCount(d)).toBe(742);
  await d.getByLabel("Depth", { exact: true }).fill("11");
  await ready(d);
  expect(await tileCount(d)).toBe(1000);
  await expect(d.locator(".garden-stopped")).toContainText("1,000-tile limit");
  await d.getByLabel("Depth", { exact: true }).fill("12");
  await expect(d.getByText("depth must be 0–11 reflections")).toBeVisible();
  await tilingChoice(d).selectOption("7,3");
  await ready(d);
  await expect(d.getByLabel("Depth", { exact: true })).toHaveValue("5");
  expect(await tileCount(d)).toBe(617);
  await expect(d.getByText("depth must be 0–11 reflections")).toHaveCount(0);
});

// The choice's help, and the depth and star point helps, name the chosen
// tiling's bound, rings and star; {7,3}'s stay as they were.
test("the help follows the chosen tiling", async () => {
  const { tilingHelp, laceHelp } = await import("../web/lace/model");
  const { tilingOf } = await import("../web/lace/tilings");
  const { helpText, isTiered } = await import("../web/help");
  expect(isTiered(laceHelp.tiling)).toBe(true);
  expect(helpText(laceHelp.tiling)).toContain("meeting q at each corner");
  expect(helpText(laceHelp.tiling)).not.toContain("esearch");
  const triangles = tilingHelp(tilingOf("3,7"));
  expect(helpText(triangles.depth)).toContain("0–11.");
  expect(helpText(triangles.depth)).toContain("Depth 10 holds 742 tiles");
  expect(helpText(triangles.starPoint)).toContain("three-pointed stars");
  expect(helpText(triangles.starPoint)).toContain("dual heptagons");
  const squares = tilingHelp(tilingOf("4,5"));
  expect(helpText(squares.depth)).toContain("0–8.");
  expect(helpText(squares.depth)).toContain("Depth 6 holds 597 tiles");
  expect(helpText(squares.starPoint)).toContain("four-pointed stars");
  expect(helpText(squares.starPoint)).toContain("dual pentagons");
  const heptagons = tilingHelp(tilingOf("7,3"));
  expect(helpText(heptagons.depth)).toBe(
    "Reflections from the center tile: 0–8. Each depth reflects the previous ring of tiles across their outer sides. Depth 5 holds 617 tiles; deeper rings exceed the tile limit, which then stops the last ring partway.",
  );
  expect(helpText(heptagons.starPoint)).toBe(
    "Where each strand turns, from tile center (0) to corner (1). Measured in the disk's hyperbolic distance. At 0 the strands meet at the center and draw the dual triangles; small values give seven-pointed stars, larger ones strapwork that hugs the tile's sides.",
  );
});

test("a link restores its tiling and selection", async ({ page }) => {
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
  const d = await openExample(page, "Pentagonal flowers, four at every corner");
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
  await expect(tilingChoice(reopened)).toHaveValue("5,4");
});

test("a link whose address crosses a side its tiles lack is refused", async ({
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
      studyHref("http://localhost/", "2d", token).replace(
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
  ["A pentagon glides to the center and back", 5, 4],
  ["A square glides to the center and back", 4, 5],
] as const)
  test(`${title}: halfway, the selected tile is the center tile's size and centered`, async ({
    page,
  }) => {
    await page.goto("/");
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

// The live drawing's markup without the attributes that name its state,
// and its raster at a target size.
const markup = (d: Locator) =>
  art(d).evaluate((svg) =>
    svg.innerHTML.replace(/\s(?:data|aria)-[\w-]+="[^"]*"/g, ""),
  );
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
        c.getContext("2d")!.drawImage(image, 0, 0);
        return Array.from(
          c.getContext("2d")!.getImageData(0, 0, width, height).data,
        );
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    [width, height],
  );
async function seek(d: Locator, time: string) {
  await d.getByRole("slider", { name: "Animation progress" }).fill(time);
  await expect(d.locator(".garden-view")).toHaveAttribute(
    "data-motion-time",
    time,
  );
  await ready(d);
}

// A square glide's still records its tiling and the moved patch, and its
// looping movie decodes, outside the app, to the drawing at each frame's
// time: 30 frames over 2 s at 15 fps, the last left out because the whole
// patch at the end is the one at the start.
test("the square glide's still and looping movie show the moved {4,5} patch at each time", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/");
  const d = await openExample(page, "A square glides to the center and back");
  await d.getByLabel("Duration", { exact: true }).fill("2");
  await expect(d.getByLabel("Repeat", { exact: true })).toHaveValue("loop");
  // The whole patch closes the loop: its drawing at the end is its start.
  await seek(d, "0.5");
  await seek(d, "0");
  const start = await markup(d);
  await seek(d, "1");
  expect(await markup(d)).toBe(start);
  await seek(d, "0.5");
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
  expect(record).toMatchObject({
    kind: "hyperbolic-lace",
    tiling: "{4,5}",
    depth: 6,
    tiles: 597,
    selected: { number: 7, address: [0, 2], depth: 2, reversed: false },
  });
  expect(record.motion).toMatchObject({
    duration: 2,
    repeat: "loop",
    time: 0.5,
    isometry: { offset: 0.7861513777574235 },
    membership: "the same 597 tiles at every time; the camera holds",
  });
  // References at frames 0, 15 and 27 (times 0, 0.5 and 0.9), and nearby
  // times for contrast.
  const references = new Map<number, number[]>();
  for (const t of [0.9, 0.85, 0.55, 0.5, 0.45, 0.05, 0]) {
    await seek(d, String(t));
    references.set(t, await raster(d, 500, 380));
  }
  await d.getByRole("button", { name: "Stop motion" }).click();
  await ready(d);
  const settings = d.locator("#lace-export-settings");
  if (!(await settings.evaluate((e) => (e as HTMLDetailsElement).open)))
    await settings.locator("summary").click();
  await d.getByLabel("Export format", { exact: true }).selectOption("mp4");
  await d.getByRole("slider", { name: "Export resolution" }).fill("0.5");
  await d.getByLabel("Export frame rate", { exact: true }).selectOption("15");
  const movie = page.waitForEvent("download");
  await d.getByRole("button", { name: /^Export MP4 video/ }).click();
  const path = (await (await movie).path())!;
  const bytes = await readFile(path);
  expect(bytes.includes(Buffer.from('"tiling":"{4,5}"'))).toBe(true);
  const timing = probe(path);
  if (timing) {
    expect([timing.width, timing.height, timing.frames]).toEqual([
      500, 380, 30,
    ]);
    expect(timing.durations.reduce((a, b) => a + b, 0)).toBe(2000);
  }
  expect((await decodeVideo(page, bytes)).duration).toBeCloseTo(2, 3);
  for (const [frame, t, others] of [
    [0, 0, [0.05]],
    [15, 0.5, [0.45, 0.55]],
    [27, 0.9, [0.85]],
  ] as const) {
    const own = frameDifference(path, 500, 380, frame, references.get(t)!);
    if (!own) continue;
    expect(own.meanDifference).toBeLessThan(6);
    expect(own.unmatchedInk).toBeLessThan(0.25);
    for (const other of others)
      expect(
        frameDifference(path, 500, 380, frame, references.get(other)!)!
          .unmatchedInk,
      ).toBeGreaterThan(own.unmatchedInk + 0.1);
  }
});
