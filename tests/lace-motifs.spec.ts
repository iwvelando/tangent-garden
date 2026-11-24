import { test, expect, type Page, type Locator } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { wireStudy } from "./study-link-wire";
import { decodeVideo, frameDifference, probe } from "./video";

// The lace's motifs: the star, petals, leaves and rings. Geometry is read
// from the drawn SVG and checked against the motifs' definitions written
// out here; the invariants are engine/lace_motifs_test.go's.
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
const shape = (d: Locator) => d.getByRole("combobox", { name: "Shape" });
const tilingChoice = (d: Locator) =>
  d.getByRole("combobox", { name: "Tiling" });

type C = { x: number; y: number };
// Every drawn stroke of a role, by default every motif role (a selected
// tile's path draws in its own): its ends in model units at the camera's
// zoom, and its arc's radius, or 0 for a line.
async function strokes(d: Locator, role = "motif|pathMotif|selectedMotif") {
  const zoom = Number(await art(d).getAttribute("data-zoom"));
  const ds = await art(d).evaluate(
    (svg, role) =>
      Array.from(
        svg.querySelectorAll(
          role
            .split("|")
            .map((r) => `path[data-role="${r}"]`)
            .join(","),
        ),
        (p) => p.getAttribute("d"),
      ),
    role,
  );
  const k = 350 * zoom;
  const at = (x: string, y: string) => ({
    x: (+x - 500) / k,
    y: (380 - +y) / k,
  });
  const out: { a: C; b: C; radius: number }[] = [];
  for (const d of ds)
    for (const m of d!.matchAll(
      /M(-?[\d.]+) (-?[\d.]+)(?:A(-?[\d.]+) -?[\d.]+ 0 0 [01] |L)(-?[\d.]+) (-?[\d.]+)/g,
    ))
      out.push({
        a: at(m[1], m[2]),
        b: at(m[4], m[5]),
        radius: m[3] ? +m[3] / k : 0,
      });
  return out;
}
const near = (a: C, b: C, tol = 0.003 / 350) =>
  Math.hypot(a.x - b.x, a.y - b.y) < tol;
const between = (z: C, w: C) =>
  2 *
  Math.asinh(
    Math.hypot(z.x - w.x, z.y - w.y) /
      Math.sqrt((1 - z.x ** 2 - z.y ** 2) * (1 - w.x ** 2 - w.y ** 2)),
  );
// The {p,q} seed from its right triangle: circumradius R with
// cosh R = cot(π/p)·cot(π/q), apothem h with cosh h = cos(π/q)/sin(π/p).
const seed = (p: number, q: number) => {
  const R = Math.acosh(1 / (Math.tan(Math.PI / p) * Math.tan(Math.PI / q)));
  const h = Math.acosh(Math.cos(Math.PI / q) / Math.sin(Math.PI / p));
  return { R, h, corner: Math.tanh(R / 2), mid: Math.tanh(h / 2) };
};
const origin = { x: 0, y: 0 };

test("the Shape choice offers four motifs, each drawn as defined, with the tiles and selection kept", async ({
  page,
}) => {
  await page.goto("/");
  const d = await openExample(page, "Seven-pointed stars receding to the rim");
  await expect(shape(d)).toHaveValue("star");
  await expect(shape(d).locator("option")).toHaveText([
    "Star",
    "Petals",
    "Leaves",
    "Rings",
    "Your loop",
  ]);
  await d.getByLabel("Tile", { exact: true }).fill("9");
  await expect(art(d)).toHaveAttribute("data-selected", "8");
  const summary = await d.locator(".lace-summary").textContent();
  const { R, h, corner, mid } = seed(7, 3);
  // Petals: every stroke runs from a tile's center to a corner, so the
  // center tile's 14 meet at the disk's center, and none is straight at
  // full size.
  await shape(d).selectOption("petals");
  await ready(d);
  await expect(d.getByLabel("Fullness", { exact: true })).toHaveValue("1");
  await expect(d.getByLabel("Star point", { exact: true })).toHaveCount(0);
  await expect(art(d)).toHaveAttribute("data-selected", "8");
  await expect(d.locator(".lace-summary")).toHaveText(summary!);
  let all = await strokes(d);
  expect(
    all.filter((s) => near(s.a, origin) || near(s.b, origin)),
  ).toHaveLength(14);
  const top = { x: 0, y: corner };
  // Three heptagons meet at the top corner, each with two petal halves.
  expect(all.filter((s) => near(s.a, top) || near(s.b, top))).toHaveLength(6);
  // Leaves: from each center to its sides' midpoints, four ends at each.
  await shape(d).selectOption("leaves");
  await ready(d);
  all = await strokes(d);
  const side0 = {
    x: mid * Math.cos(Math.PI / 2 + Math.PI / 7),
    y: mid * Math.sin(Math.PI / 2 + Math.PI / 7),
  };
  expect(all.filter((s) => near(s.a, side0) || near(s.b, side0))).toHaveLength(
    4,
  );
  // Rings: every end of the center tile's ring lies u·h from the center;
  // at full size, the inscribed circle touches each side's midpoint.
  await shape(d).selectOption("rings");
  await ready(d);
  await expect(d.getByLabel("Ring radius", { exact: true })).toHaveValue("1");
  all = await strokes(d);
  const center = all.filter(
    (s) => Math.abs(between(s.a, origin) - h) < 1e-4 && s.radius > 0,
  );
  expect(center.length).toBeGreaterThanOrEqual(14);
  expect(all.filter((s) => near(s.a, side0) || near(s.b, side0))).toHaveLength(
    4,
  );
  await d.getByLabel("Ring radius", { exact: true }).fill("0.5");
  await ready(d);
  all = await strokes(d);
  expect(
    all.filter((s) => Math.abs(between(s.a, origin) - h / 2) < 1e-4),
  ).toHaveLength(14);
  expect(all.filter((s) => near(s.a, side0) || near(s.b, side0))).toHaveLength(
    0,
  );
  // Back to the star: its turning points at u·R on the rays to corners.
  await shape(d).selectOption("star");
  await ready(d);
  all = await strokes(d);
  expect(
    all.filter((s) => Math.abs(between(s.b, origin) - 0.3 * R) < 1e-4),
  ).toHaveLength(7);
  await expect(art(d)).toHaveAttribute("data-selected", "8");
});

test("each motif keeps its own size, and a size outside its range is refused under its field", async ({
  page,
}) => {
  await page.goto("/");
  const d = await openExample(page, "Seven-pointed stars receding to the rim");
  await d.getByLabel("Star point", { exact: true }).fill("0.6");
  await shape(d).selectOption("petals");
  await d.getByLabel("Fullness", { exact: true }).fill("1/2");
  await ready(d);
  await shape(d).selectOption("leaves");
  await expect(d.getByLabel("Fullness", { exact: true })).toHaveValue("1");
  await d.getByLabel("Fullness", { exact: true }).fill("0.25");
  await shape(d).selectOption("rings");
  await d.getByLabel("Ring radius", { exact: true }).fill("0.05");
  await expect(d.getByText("ring radius must be 0.1–1")).toBeVisible();
  // Under the field itself.
  await expect(
    d.getByLabel("Ring radius", { exact: true }),
  ).toHaveAccessibleDescription(/ring radius must be 0\.1–1/);
  await d.getByLabel("Ring radius", { exact: true }).fill("0.7");
  await ready(d);
  await expect(d.getByText("ring radius must be 0.1–1")).toHaveCount(0);
  await shape(d).selectOption("star");
  await expect(d.getByLabel("Star point", { exact: true })).toHaveValue("0.6");
  await shape(d).selectOption("petals");
  await expect(d.getByLabel("Fullness", { exact: true })).toHaveValue("0.5");
  await shape(d).selectOption("leaves");
  await expect(d.getByLabel("Fullness", { exact: true })).toHaveValue("0.25");
  await d.getByLabel("Fullness", { exact: true }).fill("2");
  await expect(d.getByText("fullness must be 0–1")).toBeVisible();
  await shape(d).selectOption("rings");
  await expect(d.getByLabel("Ring radius", { exact: true })).toHaveValue("0.7");
  await expect(d.getByText("fullness must be 0–1")).toHaveCount(0);
  await ready(d);
});

test("a link restores the motif and every size, and an older link opens the star", async ({
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
  const d = await openExample(page, "Pentagonal flowers, four at every corner");
  await shape(d).selectOption("petals");
  await d.getByLabel("Fullness", { exact: true }).fill("0.4");
  await shape(d).selectOption("leaves");
  await d.getByLabel("Fullness", { exact: true }).fill("0.7");
  await ready(d);
  const markup = await art(d).innerHTML();
  await d.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(d.getByText("Link copied", { exact: true })).toBeVisible();
  const link: string = await page.evaluate(() => (window as any).copied);
  const saved = wireStudy(new URL(link).hash.slice(3)).lace;
  expect(saved).toMatchObject({
    motifKind: "leaves",
    petalFullness: 0.4,
    leafFullness: 0.7,
    starPoint: 0.3,
  });
  expect("ringRadius" in saved).toBe(false);
  await page.goto("/");
  await page.goto(link);
  const reopened = lace(page);
  await ready(reopened);
  await expect(shape(reopened)).toHaveValue("leaves");
  await expect(reopened.getByLabel("Fullness", { exact: true })).toHaveValue(
    "0.7",
  );
  expect(await art(reopened).innerHTML()).toBe(markup);
  await shape(reopened).selectOption("petals");
  await expect(reopened.getByLabel("Fullness", { exact: true })).toHaveValue(
    "0.4",
  );
});

// Every motif's still records it and draws only geometry, and its frames
// under the motion are the motif carried by the disk isometry: the drawn
// stroke ends at the glide's midpoint lie where the moved patch puts them.
for (const [motif, field, size] of [
  ["star", "starPoint", 0.3],
  ["petals", "petalFullness", 1],
  ["leaves", "leafFullness", 1],
  ["rings", "ringRadius", 1],
] as const)
  test(`the ${motif} motif exports its still and moves with the patch`, async ({
    page,
  }) => {
    await page.goto("/");
    const d = await openExample(
      page,
      "A pentagon glides to the center and back",
    );
    await shape(d).selectOption(motif);
    await ready(d);
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
    expect(record).toMatchObject({ tiling: "{5,4}", [field]: size });
    if (motif === "star") expect("motifKind" in record).toBe(false);
    else expect(record.motifKind).toBe(motif);
    expect(text).not.toMatch(/<text/);
    // At rest, the strokes of the selected tile (address 0, 4) and, at
    // the glide's middle, the same strokes carried to the disk's center:
    // T(z) = (z − a)/(1 − āz), a its center at rest.
    const rest = await strokes(d, "selectedMotif");
    expect(rest).toHaveLength(10);
    await d.getByRole("slider", { name: "Animation progress" }).fill("0.5");
    await expect(d.locator(".garden-view")).toHaveAttribute(
      "data-motion-time",
      "0.5",
    );
    await ready(d);
    const a = { x: 0, y: 0.68712149944502521 };
    const T = (z: C) => {
      const nx = z.x - a.x,
        ny = z.y - a.y;
      const dx = 1 - (a.x * z.x + a.y * z.y),
        dy = -(a.x * z.y - a.y * z.x);
      const m = dx * dx + dy * dy;
      return { x: (nx * dx + ny * dy) / m, y: (ny * dx - nx * dy) / m };
    };
    const moved = await strokes(d, "selectedMotif");
    expect(moved).toHaveLength(10);
    for (const s of rest)
      expect(
        moved.some((m) => near(m.a, T(s.a), 2e-5) && near(m.b, T(s.b), 2e-5)),
      ).toBe(true);
  });

// The rings' glide loops: its movie decodes, outside the app, to the
// drawing at each frame's time.
test("the rings glide's looping movie shows the moved rings at each time", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/");
  const d = await openExample(page, "Rings glide to the center and back");
  await expect(shape(d)).toHaveValue("rings");
  await d.getByLabel("Duration", { exact: true }).fill("2");
  const raster = (width: number, height: number) =>
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
  const seek = async (time: string) => {
    await d.getByRole("slider", { name: "Animation progress" }).fill(time);
    await expect(d.locator(".garden-view")).toHaveAttribute(
      "data-motion-time",
      time,
    );
    await ready(d);
  };
  const references = new Map<number, number[]>();
  for (const t of [0.55, 0.5, 0.45, 0.05, 0]) {
    await seek(String(t));
    references.set(t, await raster(500, 380));
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
  expect(bytes.includes(Buffer.from('"motifKind":"rings"'))).toBe(true);
  const timing = probe(path);
  if (timing)
    expect([timing.width, timing.height, timing.frames]).toEqual([
      500, 380, 30,
    ]);
  expect((await decodeVideo(page, bytes)).duration).toBeCloseTo(2, 3);
  for (const [frame, t, others] of [
    [0, 0, [0.05]],
    [15, 0.5, [0.45, 0.55]],
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
  // A motif change ends the motion, as any generation setting does.
  await seek("0.5");
  await shape(d).selectOption("petals");
  await ready(d);
  await expect(
    d.getByRole("slider", { name: "Animation progress" }),
  ).toHaveValue("0");
  await expect(tilingChoice(d)).toHaveValue("5,4");
});

// Help names each motif's limits, as the engine enforces them, and the
// tiling's own numbers.
test("the motif helps state their ranges and follow the tiling", async () => {
  const { laceMotifs, motifOf } = await import("../web/lace/motifs");
  const { tilingOf } = await import("../web/lace/tilings");
  const { laceHelp } = await import("../web/lace/model");
  const { helpText } = await import("../web/help");
  expect(helpText(laceHelp.motifKind)).toContain(
    "a star, petals, leaves, rings or your own loop",
  );
  for (const m of laceMotifs)
    expect(helpText(m.help(tilingOf("7,3")))).toContain(
      m.range[0] === 0 ? "(0)" : `${m.range[0]}–1`,
    );
  const petals = (id: string) => helpText(motifOf("petals").help(tilingOf(id)));
  expect(petals("7,3")).toContain(
    "7 petals at the centers and 3 at the corners",
  );
  expect(petals("3,7")).toContain("each 7-petal flower touch");
  expect(petals("5,4")).toContain("each 5-petal flower touch");
  expect(helpText(motifOf("leaves").help(tilingOf("5,4")))).toContain(
    "dual squares' sides",
  );
  expect(helpText(motifOf("rings").help(tilingOf("4,5")))).toContain(
    "five around every corner",
  );
});
