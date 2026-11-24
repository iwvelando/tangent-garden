import { test, expect, type Page, type Locator } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { wireStudy } from "./study-link-wire";
import { leafFit } from "./fourier-fit-checks";

// The loop motif: a closed curve from Draw a loop, mirrored into every
// fundamental triangle of every tile. Its geometry is read from the drawn
// SVG; engine/lace_loop_test.go checks the placement itself.
const lace = (page: Page) =>
  page.getByRole("dialog", { name: "Hyperbolic lace" });
const fit = (page: Page) =>
  page.getByRole("dialog", { name: /made of circles/ });
const art = (d: Locator) => d.locator("#lace-artwork");
const ready = (d: Locator) =>
  expect(art(d)).toHaveAttribute("aria-busy", "false");
const shape = (d: Locator) => d.getByRole("combobox", { name: "Shape" });
const size = (d: Locator) => d.getByLabel("Loop size", { exact: true });
const note = (d: Locator) => d.getByTestId("lace-loop-note");

type C = { x: number; y: number };
// Every drawn stroke of the roles given: its ends in model units at the
// camera's zoom.
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
  // A loop's copy is one subpath: a move, then arcs each starting where
  // the last ends.
  const out: { a: C; b: C }[] = [];
  for (const d of ds)
    for (const run of d!.match(/M[^M]*/g) ?? []) {
      const ends = [
        ...run.matchAll(
          /(?:^M|A-?[\d.]+ -?[\d.]+ 0 0 [01] |L)(-?[\d.]+) (-?[\d.]+)/g,
        ),
      ].map((m) => at(m[1], m[2]));
      for (let i = 1; i < ends.length; i++)
        out.push({ a: ends[i - 1], b: ends[i] });
    }
  return out;
}
const near = (a: C, b: C, tol = 2e-5) => Math.hypot(a.x - b.x, a.y - b.y) < tol;

async function openStudy(page: Page, change: object) {
  const { presetStudy } = await import("../web/planar-link");
  const { presetLace } = await import("../web/lace/model");
  const { studyHref, writeStudyLink } = await import("../web/study-link");
  const token = await writeStudyLink("2d", {
    ...presetStudy(0),
    lace: { ...presetLace(0), ...change },
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

test("Weave into lace opens the lace with the fitted loop in every triangle, and leaves the study", async ({
  page,
}) => {
  await copyLinks(page);
  await page.goto("/");
  const before = (await copied(page, page)).study;
  const f = await leafFit(page, 12);
  await f.getByRole("button", { name: "Weave into lace", exact: true }).click();
  await expect(fit(page)).toHaveCount(0);
  const d = lace(page);
  await ready(d);
  await expect(shape(d)).toHaveValue("loop");
  await expect(size(d)).toHaveValue("1");
  await expect(note(d)).toHaveText(/^Your loop, 12 terms\./);
  // The center tile holds 14 closed copies, one in each triangle about the
  // center: its strokes are the kaleidoscope's, carried by a seventh of a
  // turn and mirrored in the vertical line through the top corner onto
  // strokes of the drawing. Away from the center, smaller tiles hold
  // fewer arcs per copy, so only the inner strokes are compared.
  const all = await strokes(d);
  const ends = all.map((s) => s.a);
  const inner = ends.filter((z) => Math.hypot(z.x, z.y) < 0.3);
  expect(inner.length).toBeGreaterThan(14 * 16);
  const turn = (z: C) => {
    const a = (2 * Math.PI) / 7;
    return {
      x: z.x * Math.cos(a) - z.y * Math.sin(a),
      y: z.x * Math.sin(a) + z.y * Math.cos(a),
    };
  };
  for (const z of inner) {
    expect(ends.some((w) => near(w, turn(z)))).toBe(true);
    expect(ends.some((w) => near(w, { x: -z.x, y: z.y }))).toBe(true);
  }
  // No copy reaches the center or the corners: each lies inside its
  // triangle's inscribed circle.
  expect(ends.some((z) => Math.hypot(z.x, z.y) < 0.05)).toBe(false);
  // Returning leaves the notebook's own study as it was.
  await d.getByRole("button", { name: "Return to study" }).click();
  await expect(lace(page)).toHaveCount(0);
  const after = (await copied(page, page)).study;
  expect(after).toEqual(before);
});

test("Draw a new loop goes back to Draw a loop, and canceling or weaving returns to the lace as it was", async ({
  page,
}) => {
  await page.goto("/");
  let f = await leafFit(page, 8);
  await f.getByRole("button", { name: "Weave into lace", exact: true }).click();
  let d = lace(page);
  await ready(d);
  await d.getByRole("combobox", { name: "Tiling" }).selectOption("5,4");
  await size(d).fill("0.6");
  await ready(d);
  const markup = await art(d).innerHTML();
  await d.getByRole("button", { name: "Draw a new loop…" }).click();
  f = fit(page);
  await expect(f).toBeVisible();
  await expect(lace(page)).toHaveCount(0);
  await expect(
    f.getByRole("button", { name: "Use current loop", exact: true }),
  ).toBeEnabled();
  await f.getByRole("button", { name: "Cancel drawing" }).click();
  d = lace(page);
  await ready(d);
  await expect(d.getByRole("combobox", { name: "Tiling" })).toHaveValue("5,4");
  await expect(size(d)).toHaveValue("0.6");
  await expect(note(d)).toHaveText(/^Your loop, 8 terms\./);
  expect(await art(d).innerHTML()).toBe(markup);
  // Import the lace's loop, fit it with more terms and weave it back.
  await d.getByRole("button", { name: "Draw a new loop…" }).click();
  f = fit(page);
  await f
    .getByRole("button", { name: "Use current loop", exact: true })
    .click();
  await f.getByLabel("Total terms", { exact: true }).selectOption("4");
  const weave = f.getByRole("button", { name: "Weave into lace", exact: true });
  await expect(weave).toBeEnabled();
  await weave.click();
  d = lace(page);
  await ready(d);
  await expect(d.getByRole("combobox", { name: "Tiling" })).toHaveValue("5,4");
  await expect(size(d)).toHaveValue("0.6");
  await expect(note(d)).toHaveText(/^Your loop, 4 terms\./);
  expect(await art(d).innerHTML()).not.toBe(markup);
});

test("Your loop shows the example leaf until one is woven, keeps its size, and refuses one out of range", async ({
  page,
}) => {
  await openStudy(page, {});
  const d = lace(page);
  await ready(d);
  await shape(d).selectOption("loop");
  await ready(d);
  await expect(note(d)).toHaveText(
    /^The example leaf, 8 terms, until you draw a loop\./,
  );
  await expect(size(d)).toHaveValue("1");
  await size(d).fill("0.05");
  await expect(d.getByText("loop size must be 0.1–1")).toBeVisible();
  await expect(size(d)).toHaveAccessibleDescription(/loop size must be 0\.1–1/);
  await size(d).fill("1/2");
  await ready(d);
  const half = await strokes(d);
  await shape(d).selectOption("rings");
  await ready(d);
  await shape(d).selectOption("loop");
  await expect(size(d)).toHaveValue("0.5");
  await ready(d);
  expect(await strokes(d)).toEqual(half);
});

test("a link carries the loop's terms and size, and refuses a fractional frequency", async ({
  page,
}) => {
  await copyLinks(page);
  await page.goto("/");
  const f = await leafFit(page, 6);
  await f.getByRole("button", { name: "Weave into lace", exact: true }).click();
  const d = lace(page);
  await ready(d);
  await size(d).fill("0.7");
  await ready(d);
  const markup = await art(d).innerHTML();
  const { link, study } = await copied(d, page);
  expect(study.lace).toMatchObject({ motifKind: "loop", loopSize: 0.7 });
  expect(study.lace.loopTerms).toHaveLength(6);
  expect(Object.keys(study.lace.loopTerms[0]).sort()).toEqual([
    "frequency",
    "phase",
    "radius",
  ]);
  await page.goto("/");
  await page.goto(link);
  const reopened = lace(page);
  await ready(reopened);
  await expect(shape(reopened)).toHaveValue("loop");
  await expect(note(reopened)).toHaveText(/^Your loop, 6 terms\./);
  expect(await art(reopened).innerHTML()).toBe(markup);
  // A link's terms are untrusted: a fractional frequency is refused by name.
  const terms = structuredClone(study.lace.loopTerms);
  terms[2].frequency = 1.5;
  await openStudy(page, { motifKind: "loop", loopTerms: terms });
  await expect(
    page.getByText("lace.loopTerms[2].frequency", { exact: false }),
  ).toBeVisible();
  await expect(lace(page)).toHaveCount(0);
});

test("the still records the loop, and a moved selection draws its own copies", async ({
  page,
}) => {
  await openStudy(page, {
    motifKind: "loop",
    loopSize: 0.8,
    selected: [4, 6],
    isometry: { offset: 0, direction: -Math.PI / 14, rotation: 0 },
    motion: {
      offset: 0.71814307181038606,
      orbits: 0,
      turns: 0,
      duration: 10,
      repeat: "loop",
    },
  });
  const d = lace(page);
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
  const { exampleLoop } = await import("../web/lace/motifs");
  expect(record).toMatchObject({
    motifKind: "loop",
    loopSize: 0.8,
    loopTerms: exampleLoop,
  });
  expect(text).not.toMatch(/<text/);
  // The selected tile's strokes, read through its own range of the
  // result, lie in its circumscribed circle, at rest and halfway through
  // the glide, where it sits at the disk's center and has more arcs.
  // A hyperbolic circle of radius R about c is the Euclidean circle with
  // center c(1 − τ²)/(1 − |c|²τ²) and radius (1 − |c|²)τ/(1 − |c|²τ²),
  // τ = tanh(R/2); {7,3}'s circumradius R is 0.6207.
  const inTile = async (c: C) => {
    const tau = Math.tanh(0.62066 / 2),
      c2 = c.x ** 2 + c.y ** 2,
      den = 1 - c2 * tau * tau;
    const center = {
        x: (c.x * (1 - tau * tau)) / den,
        y: (c.y * (1 - tau * tau)) / den,
      },
      reach = ((1 - c2) * tau) / den;
    const own = await strokes(d, "selectedMotif");
    expect(own.length % 14).toBe(0);
    expect(own.length).toBeGreaterThan(0);
    // Each of the tile's 14 copies is one closed subpath.
    const moves = await art(d).evaluate((svg) =>
      Array.from(
        svg.querySelectorAll('path[data-role="selectedMotif"]'),
        (p) => p.getAttribute("d")!.split("M").length - 1,
      ).reduce((a, b) => a + b, 0),
    );
    expect(moves).toBe(14);
    for (const s of own)
      for (const z of [s.a, s.b])
        expect(Math.hypot(z.x - center.x, z.y - center.y)).toBeLessThan(reach);
    return own.length;
  };
  const a = 0.71814307181038606;
  const rest = await inTile({
    x: a * Math.cos(-Math.PI / 14),
    y: a * Math.sin(-Math.PI / 14),
  });
  await d.getByRole("slider", { name: "Animation progress" }).fill("0.5");
  await expect(d.locator(".garden-view")).toHaveAttribute(
    "data-motion-time",
    "0.5",
  );
  await ready(d);
  const middle = await inTile({ x: 0, y: 0 });
  expect(middle).toBeGreaterThan(rest);
});

test("the loop's help states its range and follows the tiling", async () => {
  const { motifOf, exampleLoop, loopMaxFrequency } =
    await import("../web/lace/motifs");
  const { tilingOf } = await import("../web/lace/tilings");
  const { laceRequest, defaultLace } = await import("../web/lace/model");
  const { helpText } = await import("../web/help");
  const help = (id: string) => helpText(motifOf("loop").help(tilingOf(id)));
  expect(help("7,3")).toContain("0.1–1");
  expect(help("7,3")).toContain("14 triangles");
  expect(help("7,3")).toContain("6 copies around every corner");
  expect(help("3,7")).toContain("6 triangles");
  expect(help("3,7")).toContain("14 copies around every corner");
  expect(help("7,3")).toContain("up to 16 terms");
  // The longest loop a link admits still fits the worker's 4,096-character
  // request.
  const longest = Array.from({ length: 16 }, () => ({
    frequency: -loopMaxFrequency,
    radius: 99999.99999999999,
    phase: -999999.9999999999,
  }));
  const request = laceRequest({
    ...defaultLace,
    motifKind: "loop",
    loopTerms: longest,
    isometry: {
      offset: 0.7999999999999999,
      direction: -99.99999999999999,
      rotation: -99.99999999999999,
    },
  });
  expect(JSON.stringify(request).length).toBeLessThan(4096);
  expect(
    JSON.stringify({
      lace: request,
      motion: { offset: 0.8, orbits: -3, turns: -3 },
      progress: 0.123456789,
    }).length,
  ).toBeLessThan(4096);
  expect(exampleLoop).toHaveLength(8);
});
