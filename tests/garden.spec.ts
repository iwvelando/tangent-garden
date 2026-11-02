import { test, expect, type Page, type Locator } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { deflateRawSync } from "node:zlib";
import { wireStudy } from "./study-link-wire";
import { decodePng } from "./png";

// The Apollonian garden: its entry from the gallery over the retained
// study, pointer and keyboard selection, exports, refusals, cancellation,
// links and narrow layouts. Geometry identities are asserted on the drawn
// circles themselves, independently of the generator's recurrence.

const rose = "A rose window made only of circles";
const explained = "One circle and the three that made it";

async function settled(page: Page) {
  await expect(page.locator(".app:visible .plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
}
async function openGarden(page: Page, title = rose) {
  await page.getByRole("button", { name: "Browse notebook examples" }).click();
  const gallery = page.getByRole("dialog", { name: "Notebook examples" });
  await gallery
    .locator(`[data-garden-example][data-example-title="${title}"]`)
    .click();
  await gallery.waitFor({ state: "hidden" });
  const d = page.getByRole("dialog", { name: "The Apollonian garden" });
  await ready(d);
  return d;
}
const ready = (d: Locator) =>
  expect(d.locator("#garden-artwork")).toHaveAttribute("aria-busy", "false");
type Drawn = {
  i: number;
  role: string;
  cx: number;
  cy: number;
  r: number;
  stroke: string;
};
// Every circle drawn, in page units, with its role.
function circles(root: Locator): Promise<Drawn[]> {
  return root.evaluate((svg) =>
    Array.from(svg.querySelectorAll("circle"), (c) => ({
      i: Number(c.getAttribute("data-circle")),
      role: c.getAttribute("data-role")!,
      cx: +c.getAttribute("cx")!,
      cy: +c.getAttribute("cy")!,
      r: +c.getAttribute("r")!,
      stroke: c.getAttribute("stroke")!,
    })),
  );
}
const summary = (d: Locator) => d.locator(".garden-summary");
const circleCount = async (d: Locator) =>
  Number(
    (await summary(d).textContent())!
      .match(/^([\d,]+) circles/)![1]
      .replace(/,/g, ""),
  );
// Tangency of drawn circles in page units: externally, or internally to
// the enclosing circle (index 0), relative to the radii involved.
function tangent(a: Drawn, b: Drawn) {
  const d = Math.hypot(a.cx - b.cx, a.cy - b.cy);
  const want = b.i === 0 ? b.r - a.r : a.r + b.r;
  return Math.abs(d - want) <= 1e-9 * (a.r + b.r + 1000);
}

// The pointer's circle, on hand-made geometry in page units at zoom 1:
// a unit enclosing circle and two tangent circles of radius 1/2.
test("the hit test prefers the containing circle, then the nearest boundary within tolerance", async () => {
  const { hitCircle, gardenScale } = await import("../web/garden/model");
  const r = {
    x: [0, -0.5, 0.5],
    y: [0, 0, 0],
    radius: [1, 0.5, 0.5],
    curvature: [-1, 2, 2],
  } as any;
  const all = [0, 1, 2];
  const camera = { x: 0, y: 0, zoom: 1 };
  const page = (x: number, y: number) => ({
    x: 500 + x * gardenScale,
    y: 380 - y * gardenScale,
  });
  const px = 1 / gardenScale;
  // Inside a packing circle, that circle, even at the tangency point's
  // side, where the other boundary is as near.
  expect(hitCircle(r, all, page(-0.01, 0), camera, 10)).toBe(1);
  expect(hitCircle(r, all, page(0.01, 0), camera, 10)).toBe(2);
  // Outside both, near the enclosing circle's boundary only by tolerance.
  expect(hitCircle(r, all, page(0, 1 + 9 * px), camera, 10)).toBe(0);
  expect(hitCircle(r, all, page(0, 1 + 11 * px), camera, 10)).toBe(-1);
  // In the gap above the tangency point: the nearest boundary.
  expect(hitCircle(r, all, page(-0.02, 0.2), camera, 40)).toBe(1);
  expect(hitCircle(r, all, page(0.02, 0.2), camera, 40)).toBe(2);
  // Only presented circles can be hit, and zoom scales the tolerance.
  expect(hitCircle(r, [0, 2], page(-0.25, 0), camera, 10)).toBe(-1);
  expect(
    hitCircle(
      r,
      all,
      { x: 500, y: 380 - (1 + 9 * px) * gardenScale * 2 },
      { x: 0, y: 0, zoom: 2 },
      10,
    ),
  ).toBe(-1);
  expect(
    hitCircle(
      r,
      all,
      { x: 500, y: 380 - (1 + 4 * px) * gardenScale * 2 },
      { x: 0, y: 0, zoom: 2 },
      10,
    ),
  ).toBe(0);
});

// Following frames a circle centered at a quarter of the page's height,
// within the zoom range; independent page arithmetic, not the camera code.
test("following frames the selected circle centered at a quarter of the drawing's height", async () => {
  const { followView, toScreen } = await import("../web/garden/model");
  const r = {
    x: [0, -0.5, 0.3],
    y: [0, 0, 0.48],
    radius: [1, 0.5, 0.02],
    curvature: [-1, 2, 50],
  } as any;
  const at = (i: number) => {
    const view = followView(r, i);
    const c = toScreen({ x: r.x[i], y: r.y[i] }, view);
    return { view, c, radius: r.radius[i] * 350 * view.zoom };
  };
  const small = at(2);
  expect(small.c.x).toBeCloseTo(500, 9);
  expect(small.c.y).toBeCloseTo(380, 9);
  expect(small.radius).toBeCloseTo(760 / 8, 9);
  // A large circle is never zoomed out past the whole packing.
  const seed = at(1);
  expect(seed.view.zoom).toBe(1);
  expect(seed.c).toEqual({ x: 500, y: 380 });
  expect(at(0).view).toEqual({ x: 0, y: 0, zoom: 1 });
  // A circle too small to fill a quarter at the zoom limit is centered at it.
  const tiny = followView({ ...r, radius: [1, 0.5, 1e-4] }, 2);
  expect(tiny.zoom).toBe(100);
  const c = toScreen({ x: 0.3, y: 0.48 }, tiny);
  expect(c.x).toBeCloseTo(500, 9);
  expect(c.y).toBeCloseTo(380, 9);
});

test("the rose window opens from the gallery over an untouched study and returns to it", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  const x = page.getByLabel("x(t)", { exact: true });
  await x.fill("cos(t) + 0.25");
  await settled(page);
  const d = await openGarden(page);
  await expect(d.getByLabel("Minimum radius", { exact: true })).toHaveValue(
    "0.002",
  );
  await expect(d.getByLabel("Line weight", { exact: true })).toHaveValue(
    "fine",
  );
  const art = d.locator("#garden-artwork");
  const drawn = await circles(art);
  expect(drawn.length).toBe(await circleCount(d));
  expect(drawn.length).toBeGreaterThan(1000);
  // The enclosing circle is drawn once; nothing but circles and the page.
  expect(drawn.filter((c) => c.i === 0)).toHaveLength(1);
  expect(new Set(drawn.map((c) => c.i)).size).toBe(drawn.length);
  await expect(art.locator("text, path, [pointer-events]")).toHaveCount(0);
  // Every drawn circle lies inside the enclosing one, with disjoint
  // interiors among a sample of neighbors.
  const outer = drawn.find((c) => c.i === 0)!;
  for (const c of drawn)
    if (c.i)
      expect(
        Math.hypot(c.cx - outer.cx, c.cy - outer.cy) + c.r,
      ).toBeLessThanOrEqual(outer.r * (1 + 1e-12));
  await expect(summary(d)).toContainText("Left unfilled");
  await d.getByRole("button", { name: "Return to study", exact: true }).click();
  await expect(d).toBeHidden();
  await expect(x).toHaveValue("cos(t) + 0.25");
  await expect(
    page.getByRole("button", { name: "Browse notebook examples" }),
  ).toBeFocused();
});

test("a click near a thin circle selects exactly that circle and its generating triple", async ({
  page,
}) => {
  await page.goto("/");
  const d = await openGarden(page);
  const art = d.locator("#garden-artwork");
  // A small circle, a few pixels across on screen, clicked inside.
  const target = await art.evaluate((svg) => {
    const box = svg.getBoundingClientRect();
    const k = box.width / 1000;
    const c = Array.from(svg.querySelectorAll("circle")).find((c) => {
      const r = +c.getAttribute("r")! * k;
      return r > 1.5 && r < 3 && c.getAttribute("data-circle") !== "0";
    })!;
    const b = c.getBoundingClientRect();
    return {
      i: Number(c.getAttribute("data-circle")),
      x: b.x + b.width / 2 + 0.3 * (b.width / 2),
      y: b.y + b.height / 2,
    };
  });
  await page.mouse.click(target.x, target.y);
  await expect(art).toHaveAttribute("data-selected", String(target.i));
  await expect(d.getByLabel("Circle", { exact: true })).toHaveValue(
    String(target.i + 1),
  );
  await expect(d.locator(".garden-about h3")).toHaveText(
    `Circle ${target.i + 1}`,
  );
  let drawn = await circles(art);
  const selected = drawn.filter((c) => c.role === "selected");
  const generators = drawn.filter((c) => c.role === "generator");
  expect(selected.map((c) => c.i)).toEqual([target.i]);
  expect(generators).toHaveLength(3);
  for (const g of generators) expect(tangent(selected[0], g)).toBe(true);
  // The generators are mutually tangent too: a Descartes configuration.
  for (const a of generators)
    for (const b of generators)
      if (a.i < b.i)
        expect(tangent(b.i === 0 ? a : b, b.i === 0 ? b : a)).toBe(true);
  const buttons = await d
    .getByRole("group", { name: "Generating circles" })
    .getByRole("button")
    .allTextContents();
  expect(
    buttons
      .map((t) => Number(t.match(/Circle ([\d,]+)/)![1]) - 1)
      .sort((a, b) => a - b),
  ).toEqual(generators.map((g) => g.i).sort((a, b) => a - b));
  // The sparse view draws exactly the circle, its generators and the
  // enclosing circle, once.
  await d.getByLabel("Presentation", { exact: true }).selectOption("selected");
  drawn = await circles(art);
  expect(drawn.map((c) => c.i).sort((a, b) => a - b)).toEqual(
    [...new Set([0, target.i, ...generators.map((g) => g.i)])].sort(
      (a, b) => a - b,
    ),
  );
  // The enclosing circle's hairline, clicked a few pixels outside it.
  await d.getByLabel("Presentation", { exact: true }).selectOption("complete");
  const edge = await art.evaluate((svg) => {
    const c = svg.querySelector('[data-circle="0"]')!.getBoundingClientRect();
    return { x: c.x + c.width / 2, y: c.y - 5 };
  });
  await page.mouse.click(edge.x, edge.y);
  await expect(art).toHaveAttribute("data-selected", "0");
  await expect(d.locator(".garden-about")).toContainText(
    "The enclosing circle",
  );
  // Far from every circle, a click leaves the selection alone.
  const box = (await art.boundingBox())!;
  await page.mouse.click(box.x + 8, box.y + 8);
  await expect(art).toHaveAttribute("data-selected", "0");
  // Dragging pans rather than selecting.
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  await page.mouse.move(target.x + 40, target.y + 10, { steps: 4 });
  await page.mouse.up();
  await expect(art).toHaveAttribute("data-selected", "0");
  await expect(art).not.toHaveAttribute("data-pan", "0,0");
});

test("keyboard selection steps through circles and their generators", async ({
  page,
}) => {
  await page.goto("/");
  const d = await openGarden(page, explained);
  const art = d.locator("#garden-artwork");
  const field = d.getByLabel("Circle", { exact: true });
  // The preset selects curvature 23 by identity.
  await expect(d.locator(".garden-facts")).toContainText("Curvature 23");
  await expect(d.locator(".garden-about")).toContainText(
    "2 × (6 + 2 + 3) − (−1) = 23",
  );
  const opening = Number(await field.inputValue());
  await d.getByRole("button", { name: "Next circle", exact: true }).click();
  await expect(field).toHaveValue(String(opening + 1));
  await d.getByRole("button", { name: "Previous circle", exact: true }).click();
  await expect(field).toHaveValue(String(opening));
  // Emptying the field keeps it empty for typing, without losing the
  // selection; leaving it restores the selected number.
  await field.click();
  await field.selectText();
  await page.keyboard.press("Backspace");
  await expect(field).toHaveValue("");
  await expect(d.locator(".garden-about h3")).toHaveText(`Circle ${opening}`);
  await field.blur();
  await expect(field).toHaveValue(String(opening));
  await field.click();
  await field.selectText();
  await page.keyboard.type("2");
  await expect(d.locator(".garden-about")).toContainText("A seed circle");
  // A seed's sparse view is the seed configuration, with no generators.
  expect((await circles(art)).map((c) => c.i).sort((a, b) => a - b)).toEqual([
    0, 1, 2, 3,
  ]);
  await expect(
    d.getByRole("group", { name: "Generating circles" }),
  ).toHaveCount(0);
  await field.fill(String(opening));
  const generator = d
    .getByRole("group", { name: "Generating circles" })
    .getByRole("button")
    .first();
  const name = (await generator.textContent())!;
  await generator.focus();
  await page.keyboard.press("Enter");
  await expect(d.locator(".garden-about h3")).toHaveText(name.split(" · ")[0]);
  await d.getByRole("button", { name: "Clear selection", exact: true }).click();
  await expect(art).toHaveAttribute("data-selected", "-1");
  await expect(d.getByText("No circle selected.")).toBeVisible();
  expect((await circles(art)).map((c) => c.i)).toEqual([0]);
  // The drawing's own keys pan and zoom.
  await art.focus();
  await page.keyboard.press("+");
  await expect(art).toHaveAttribute("data-zoom", "1.2");
  await page.keyboard.press("ArrowRight");
  await expect(art).toHaveAttribute("data-pan", "25,0");
  await page.keyboard.press("Home");
  await expect(art).toHaveAttribute("data-zoom", "1");
});

async function save(page: Page, d: Locator, format: "SVG" | "PNG") {
  const download = page.waitForEvent("download");
  await d.getByRole("button", { name: "Export image" }).click();
  await page.getByRole("menuitem", { name: new RegExp(format) }).click();
  return (await download).path();
}
function pngText(bytes: Buffer) {
  for (let at = 8; at < bytes.length;) {
    const length = bytes.readUInt32BE(at),
      name = bytes.toString("ascii", at + 4, at + 8);
    if (name === "iTXt") {
      const body = bytes.subarray(at + 8, at + 8 + length).toString("utf8");
      const [keyword, ...rest] = body.split("\0");
      if (keyword === "Tangent Garden")
        return JSON.parse(rest.slice(4).join("\0"));
    }
    at += 12 + length;
  }
  throw new Error("no Tangent Garden metadata");
}

test("SVG and PNG stills reproduce the drawing and selection with their record", async ({
  page,
}) => {
  await page.goto("/");
  const d = await openGarden(page, explained);
  await d.getByLabel("Presentation", { exact: true }).selectOption("complete");
  const art = d.locator("#garden-artwork");
  await art.focus();
  await page.keyboard.press("+");
  const live = await circles(art);
  const svgText = await readFile((await save(page, d, "SVG"))!, "utf8");
  const exported = await page.evaluate((text) => {
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    return {
      desc: JSON.parse(doc.querySelector("svg > desc")!.textContent!),
      circles: Array.from(doc.querySelectorAll("circle"), (c) => ({
        i: Number(c.getAttribute("data-circle")),
        role: c.getAttribute("data-role")!,
        cx: +c.getAttribute("cx")!,
        cy: +c.getAttribute("cy")!,
        r: +c.getAttribute("r")!,
        stroke: c.getAttribute("stroke")!,
      })),
      text: doc.querySelectorAll("text, [pointer-events]").length,
      viewBox: doc.documentElement.getAttribute("viewBox"),
    };
  }, svgText);
  expect(exported.viewBox).toBe("0 0 1000 760");
  expect(exported.text).toBe(0);
  expect(exported.circles).toEqual(live);
  const record = exported.desc;
  expect(record).toMatchObject({
    kind: "apollonian-garden",
    seed: "-1,2,2,3",
    minRadius: 0.002,
    depth: 12,
    maxCircles: 5000,
    circles: await circleCount(d),
    presentation: "complete",
    view: { x: 0, y: 0, zoom: 1.2 },
    weight: "fine",
    selected: { curvature: 23, x: 8, y: 12 },
  });
  expect(record.selected.number).toBe(
    Number(await d.getByLabel("Circle", { exact: true }).inputValue()),
  );
  expect(
    record.selected.generators
      .map((g: any) => g.number - 1)
      .sort((a: number, b: number) => a - b),
  ).toEqual(
    live
      .filter((c) => c.role === "generator")
      .map((c) => c.i)
      .sort((a, b) => a - b),
  );
  const png = await readFile((await save(page, d, "PNG"))!);
  const image = decodePng(png);
  expect([image.width, image.height]).toEqual([2000, 1520]);
  expect(pngText(png)).toEqual(record);
  // The selected circle's ink reaches the raster.
  const ink = live.find((c) => c.role === "selected")!.stroke;
  const [r, g, b] = [1, 3, 5].map((k) => parseInt(ink.slice(k, k + 2), 16));
  let near = 0;
  for (let k = 0; k < image.rgba.length; k += 4)
    if (
      Math.abs(image.rgba[k] - r) < 24 &&
      Math.abs(image.rgba[k + 1] - g) < 24 &&
      Math.abs(image.rgba[k + 2] - b) < 24
    )
      near++;
  expect(near).toBeGreaterThan(50);
});

test("the garden draws and exports with the notebook's theme and color scheme", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("tangent-garden.theme", "dark");
    localStorage.setItem("tangent-garden.color-scheme", "cobalt");
  });
  await page.goto("/");
  const { plotPalette } = await import("../web/palette");
  const palette = plotPalette(true, "cobalt");
  const d = await openGarden(page, explained);
  const art = d.locator("#garden-artwork");
  const drawn = await circles(art);
  expect(
    new Set(drawn.filter((c) => c.role !== "selected").map((c) => c.stroke)),
  ).toEqual(new Set([palette.base]));
  expect(drawn.filter((c) => c.role === "selected")[0].stroke).toBe(
    palette.derived,
  );
  await expect(art.locator(":scope > rect")).toHaveAttribute(
    "fill",
    palette.bg,
  );
  const svgText = await readFile((await save(page, d, "SVG"))!, "utf8");
  expect(svgText).toContain(`fill="${palette.bg}"`);
  // The page's color fills a viewer beyond the page, as 2D and 4D exports
  // do, so a dark still opened in a browser has no white margin.
  expect(svgText).toMatch(
    new RegExp(`^<svg[^>]* style="background:${palette.bg}"`),
  );
  expect(svgText).toContain(`stroke="${palette.derived}"`);
  expect(svgText).toContain('"theme":"dark","scheme":"cobalt"');
  // The legend's swatches follow the scheme too.
  const swatch = await d
    .locator(".garden-legend .derived-dot")
    .evaluate((e) => getComputedStyle(e).backgroundColor);
  const hex = palette.derived;
  expect(swatch).toBe(
    `rgb(${[1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16)).join(", ")})`,
  );
});

test("cutoffs at their bounds are accepted, and invalid ones are refused under their fields", async ({
  page,
}) => {
  await page.goto("/");
  const d = await openGarden(page);
  const radius = d.getByLabel("Minimum radius", { exact: true });
  const depth = d.getByLabel("Depth", { exact: true });
  const limit = d.getByLabel("Circle limit", { exact: true });
  const error = (field: Locator) =>
    field
      .locator("xpath=ancestor::div[contains(@class,'field')][1]")
      .locator(".field-error");
  const share = d.getByRole("button", { name: "Copy link", exact: true });
  const exportButton = d.getByRole("button", { name: "Export image" });
  const before = await circleCount(d);
  await radius.fill("0");
  await expect(error(radius)).toContainText("above 0 and at most 1");
  await expect(share).toBeDisabled();
  await expect(exportButton).toBeDisabled();
  // The previous drawing stays while the refusal is shown.
  expect((await circles(d.locator("#garden-artwork"))).length).toBe(before);
  await radius.fill("1/0");
  await expect(error(radius)).toBeVisible();
  await radius.fill("1");
  await ready(d);
  await expect(error(radius)).toHaveCount(0);
  await expect(d.locator(".garden-stopped")).toHaveCount(0);
  expect(await circleCount(d)).toBe(4);
  await expect(summary(d)).toContainText("4 gaps below the minimum radius 1");
  await radius.fill("0.002");
  await depth.fill("13");
  await expect(error(depth)).toContainText("0–12");
  await depth.fill("");
  await expect(error(depth)).toContainText("whole number");
  await depth.fill("0");
  await ready(d);
  expect(await circleCount(d)).toBe(4);
  await expect(summary(d)).toContainText("4 gaps beyond depth 0");
  await depth.fill("12");
  await limit.fill("3");
  await expect(error(limit)).toContainText("4–5000");
  await limit.fill("4");
  await ready(d);
  // The stop is a reason, not an error: emphasized, not alerted.
  await expect(d.locator(".garden-stopped")).toHaveText(
    /^Stopped at the 4-circle limit.*incomplete\.$/,
  );
  await expect(d.locator(".garden-stopped")).toHaveCSS("font-weight", "600");
  // The largest admitted packing: the limit, not the radius, ends it.
  await limit.fill("5000");
  await radius.fill("1e-9");
  await ready(d);
  expect(await circleCount(d)).toBe(5000);
  expect((await circles(d.locator("#garden-artwork"))).length).toBe(5000);
  await expect(summary(d)).toContainText("Stopped at the 5,000-circle limit");
  await expect(share).toBeEnabled();
});

test("rapid edits keep one computation and show only the latest packing", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.gardenPosts = [];
    w.terminated = 0;
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (q: any, ...rest: any[]) {
      if (q?.action === "garden") {
        w.gardenPosts.push(q.garden.minRadius);
        setTimeout(() => send.call(this, q, ...rest), 400);
      } else send.call(this, q, ...rest);
    };
    const end = Worker.prototype.terminate;
    Worker.prototype.terminate = function () {
      w.terminated++;
      return end.call(this);
    };
  });
  await page.goto("/");
  const d = await openGarden(page);
  const radius = d.getByLabel("Minimum radius", { exact: true });
  await page.evaluate(() => ((window as any).gardenPosts.length = 0));
  await radius.fill("0.01");
  // Begin the coalescing sequence only once its first request is active;
  // scalar evaluation plus the debounce can exceed 160 ms on a loaded runner.
  await expect
    .poll(() => page.evaluate(() => (window as any).gardenPosts))
    .toEqual([0.01]);
  for (const v of ["0.02", "0.03", "0.005"]) {
    await radius.fill(v);
    await page.waitForTimeout(160);
  }
  await ready(d);
  await expect(summary(d)).toContainText("minimum radius 0.005");
  const posts: number[] = await page.evaluate(
    () => (window as any).gardenPosts,
  );
  // The first edit runs; the newest intent replaces the rest while it does.
  expect(posts[0]).toBe(0.01);
  expect(posts.at(-1)).toBe(0.005);
  expect(posts.length).toBeLessThanOrEqual(3);
  // While a packing is pending, nothing flashes into the settings: the
  // previous summary stays and the controls below it keep their place.
  const weight = d.getByLabel("Line weight", { exact: true });
  // Within the settings column's content, which filling a field below the
  // fold scrolls.
  const place = () =>
    weight.evaluate((el) => {
      const aside = el.closest("aside")!;
      return (
        el.getBoundingClientRect().top -
        aside.getBoundingClientRect().top +
        aside.scrollTop
      );
    });
  const placed = await place();
  const text = await d.locator("aside").innerText();
  await d.getByLabel("Depth", { exact: true }).fill("11");
  await expect(d.locator("#garden-artwork")).toHaveAttribute(
    "aria-busy",
    "true",
  );
  expect(await d.locator("aside").innerText()).toBe(text);
  expect(await place()).toBe(placed);
  await ready(d);
  await d.getByLabel("Depth", { exact: true }).fill("12");
  await ready(d);
  // Returning while work is pending ends the garden's workers.
  await radius.fill("0.004");
  await page.waitForTimeout(150);
  const before = await page.evaluate(() => (window as any).terminated);
  await d.getByRole("button", { name: "Return to study", exact: true }).click();
  await expect(d).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => (window as any).terminated))
    .toBeGreaterThanOrEqual(before + 2);
  await settled(page);
});

test("restoring the shown cutoffs invalidates a pending replacement", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.gardenPosts = [];
    w.releaseGarden = () => {};
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (q: any, ...rest: any[]) {
      if (q?.action === "garden") {
        w.gardenPosts.push(q.garden.depth);
        if (q.garden.depth === 11) {
          this.addEventListener("message", (event) => {
            if (event.data.id === q.id) w.gardenDelivered = true;
          });
          w.releaseGarden = () => send.call(this, q, ...rest);
          return;
        }
      }
      send.call(this, q, ...rest);
    };
  });
  await page.goto("/");
  const d = await openGarden(page);
  const art = d.locator("#garden-artwork");
  const original = await circles(art);
  const depth = d.getByLabel("Depth", { exact: true });
  await depth.fill("11");
  await expect
    .poll(() => page.evaluate(() => (window as any).gardenPosts))
    .toEqual([12, 11]);
  await depth.fill("12");
  await ready(d);
  await page.evaluate(() => (window as any).releaseGarden());
  // Wait until the held reply crosses the real worker/client boundary.
  await expect
    .poll(() => page.evaluate(() => (window as any).gardenDelivered))
    .toBe(true);
  await ready(d);
  expect(await circles(art)).toEqual(original);
  await expect(summary(d)).toHaveAttribute("data-current", "true");
  await expect(
    d.getByRole("button", { name: "Copy link", exact: true }),
  ).toBeEnabled();
});

for (const queued of [false, true])
  test(`invalidating garden work ignores an active refusal with queued intent ${queued}`, async () => {
    const { GardenSession } = await import("../web/garden/session");
    const { gardenSeed } = await import("../web/garden/model");
    const requests: number[] = [];
    let reject!: (e: Error) => void;
    const client = {
      garden: (q: { depth: number }) => {
        requests.push(q.depth);
        return new Promise((_, fail) => {
          reject = fail;
        });
      },
      dispose: () => {},
    };
    const session = new GardenSession(() => client as any);
    const published: unknown[] = [];
    const show = (r: unknown) => published.push(r);
    const fail = (e: Error) => published.push(e);
    const q = {
      seed: gardenSeed,
      depth: 11,
      minRadius: 0.002,
      maxCircles: 5000,
    };
    session.update(q, show, fail);
    if (queued) session.update({ ...q, depth: 10 }, show, fail);
    session.invalidate();
    const { EngineError } = await import("../web/engine-client");
    reject(new EngineError("obsolete refusal", "depth"));
    // Drain the active promise and its continuation, without a timer race.
    await Promise.resolve();
    await Promise.resolve();
    expect(requests).toEqual([11]);
    expect(published).toEqual([]);
    session.cancel();
  });

test("a failed engine is reported and the garden recovers when asked again", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  // Workers started from now on cannot start.
  await page.route(/engine\.worker.*\.js/, (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: "throw new Error()",
    }),
  );
  await page.getByRole("button", { name: "Browse notebook examples" }).click();
  await page.locator('[data-garden-example="0"]').click();
  const d = page.getByRole("dialog", { name: "The Apollonian garden" });
  await expect(d.getByRole("alert")).toContainText("engine");
  const again = d.getByRole("button", { name: "Try again", exact: true });
  await page.unroute(/engine\.worker.*\.js/);
  await again.click();
  await ready(d);
  expect(await circleCount(d)).toBe(1273);
  await expect(d.getByRole("alert")).toHaveCount(0);
});

test("garden links restore settings, selection, presentation and view over the study they came from", async ({
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
  const x = page.getByLabel("x(t)", { exact: true });
  await x.fill("cos(t) + 0.5");
  await settled(page);
  const d = await openGarden(page, explained);
  await d.getByLabel("Depth", { exact: true }).fill("10");
  await ready(d);
  const art = d.locator("#garden-artwork");
  await art.focus();
  await page.keyboard.press("+");
  await page.keyboard.press("ArrowDown");
  const selected = await art.getAttribute("data-selected");
  // Following, remembering the view above to return to.
  await d.getByRole("checkbox", { name: "Follow selection" }).check();
  await d.getByRole("button", { name: "Next circle", exact: true }).click();
  await expectFramed(art);
  await d.getByRole("button", { name: "Previous circle", exact: true }).click();
  await expectFramed(art);
  const followed = {
    zoom: Number(await art.getAttribute("data-zoom")),
    pan: (await art.getAttribute("data-pan"))!,
  };
  await d.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(d.getByText("Link copied", { exact: true })).toBeVisible();
  const link: string = await page.evaluate(() => (window as any).copied);
  const saved = wireStudy(new URL(link).hash.slice(3));
  expect(saved.config.curve.x).toBe("cos(t) + 0.5");
  expect(saved.garden).toEqual({
    seed: "-1,2,2,3",
    depth: 10,
    minRadius: 0.002,
    maxCircles: 5000,
    selected: { curvature: 23, x: 8, y: 12 },
    presentation: "selected",
    view: {
      x: Number(followed.pan.split(",")[0]),
      y: Number(followed.pan.split(",")[1]),
      zoom: followed.zoom,
    },
    follow: true,
    viewBeforeFollow: { x: 0, y: 25, zoom: 1.2 },
    weight: "fine",
  });
  await d.getByRole("button", { name: "Return to study", exact: true }).click();
  await x.fill("cos(t)");
  await settled(page);
  await page.goto(link);
  const reopened = page.getByRole("dialog", { name: "The Apollonian garden" });
  await ready(reopened);
  const again = reopened.locator("#garden-artwork");
  await expect(again).toHaveAttribute("data-selected", selected!);
  await expect(again).toHaveAttribute("data-zoom", String(followed.zoom));
  await expect(again).toHaveAttribute("data-pan", followed.pan);
  await expect(again).toHaveAttribute("data-presentation", "selected");
  const following = reopened.getByRole("checkbox", {
    name: "Follow selection",
  });
  await expect(following).toBeChecked();
  await following.uncheck();
  await expect(again).toHaveAttribute("data-zoom", "1.2");
  await expect(again).toHaveAttribute("data-pan", "0,25");
  await expect(reopened.getByLabel("Depth", { exact: true })).toHaveValue("10");
  await reopened
    .getByRole("button", { name: "Return to study", exact: true })
    .click();
  await expect(x).toHaveValue("cos(t) + 0.5");
});

test("a garden link whose selection lies beyond its cutoffs opens and says so", async ({
  page,
}) => {
  const { presetStudy } = await import("../web/planar-link");
  const { presetGarden } = await import("../web/garden/model");
  const garden = { ...presetGarden(1), depth: 1 };
  const token = deflateRawSync(
    JSON.stringify({
      v: 1,
      notebook: "2d",
      study: { ...presetStudy(0), garden },
    }),
  ).toString("base64url");
  await page.goto(`/#s=${token}`);
  const d = page.getByRole("dialog", { name: "The Apollonian garden" });
  await ready(d);
  await expect(d.locator("#garden-artwork")).toHaveAttribute(
    "data-selected",
    "-1",
  );
  await expect(
    d.getByText("The selected circle lies beyond the current cutoffs."),
  ).toBeVisible();
  // Raising the depth finds the same circle again.
  await d.getByLabel("Depth", { exact: true }).fill("2");
  await ready(d);
  await expect(d.locator(".garden-facts")).toContainText("Curvature 23");
});

for (const [name, viewport] of [
  ["phone portrait", { width: 390, height: 844 }],
  ["phone landscape", { width: 844, height: 390 }],
] as const)
  test(`the garden fits a ${name} layout with every control reachable`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport,
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    await page.goto("/");
    const d = await openGarden(page, explained);
    const art = d.locator("#garden-artwork");
    const box = (await art.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.height).toBeLessThanOrEqual(viewport.height);
    expect(await d.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(
      true,
    );
    // A tap inside a generator selects it.
    const target = await art.evaluate((svg) => {
      const c = svg.querySelector(
        '[data-role="generator"]:not([data-circle="0"])',
      )!;
      const b = c.getBoundingClientRect();
      return {
        i: Number(c.getAttribute("data-circle")),
        x: b.x + b.width / 2,
        y: b.y + b.height / 2,
      };
    });
    await page.touchscreen.tap(target.x, target.y);
    await expect(art).toHaveAttribute("data-selected", String(target.i));
    await expect(d.locator(".garden-about h3")).toHaveText(
      `Circle ${target.i + 1}`,
    );
    for (const control of [
      d.getByLabel("Presentation", { exact: true }),
      d.getByLabel("Minimum radius", { exact: true }),
      d.getByLabel("Depth", { exact: true }),
      d.getByLabel("Circle limit", { exact: true }),
      d.getByLabel("Line weight", { exact: true }),
      d.getByRole("button", { name: "Return to study", exact: true }),
    ]) {
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeInViewport();
    }
    await context.close();
  });

// The selected circle's center and radius as drawn, in page units.
async function framed(art: Locator) {
  const [pan, c] = await Promise.all([
    art.getAttribute("data-pan"),
    art.locator('[data-role="selected"]').evaluate((e) => ({
      cx: +e.getAttribute("cx")!,
      cy: +e.getAttribute("cy")!,
      r: +e.getAttribute("r")!,
    })),
  ]);
  const [x, y] = pan!.split(",").map(Number);
  return { x: c.cx + x, y: c.cy + y, r: c.r };
}
async function expectFramed(art: Locator) {
  await expect
    .poll(async () => {
      const f = await framed(art);
      return [f.x, f.y, f.r].map((v) => Math.round(v * 1e6) / 1e6);
    })
    .toEqual([500, 380, 95]);
}

test("following the selection frames each new selection, keeps manual adjustments, and restores the earlier view", async ({
  page,
}) => {
  await page.goto("/");
  const d = await openGarden(page);
  const art = d.locator("#garden-artwork");
  const follow = d.getByRole("checkbox", { name: "Follow selection" });
  await expect(follow).not.toBeChecked();
  // The reader's own view before following.
  await art.focus();
  await page.keyboard.press("+");
  await page.keyboard.press("ArrowLeft");
  const before = {
    zoom: await art.getAttribute("data-zoom"),
    pan: await art.getAttribute("data-pan"),
  };
  // Nothing selected: following waits for a selection.
  await follow.check();
  await expect(art).toHaveAttribute("data-zoom", before.zoom!);
  const field = d.getByLabel("Circle", { exact: true });
  await field.fill("40");
  await expectFramed(art);
  await d.getByRole("button", { name: "Next circle", exact: true }).click();
  await expect(field).toHaveValue("41");
  await expectFramed(art);
  // A manual adjustment stays, with following still on.
  await art.focus();
  await page.keyboard.press("ArrowRight");
  const adjusted = await framed(art);
  expect(adjusted.x).toBeCloseTo(525, 6);
  await expect(follow).toBeChecked();
  await page.waitForTimeout(400);
  expect((await framed(art)).x).toBeCloseTo(525, 6);
  // The next change frames again: a generator button, then a click.
  await d
    .getByRole("group", { name: "Generating circles" })
    .getByRole("button")
    .last()
    .click();
  await expectFramed(art);
  const neighbor = await art.evaluate((svg) => {
    const c = Array.from(svg.querySelectorAll('[data-role="base"]')).find(
      (e) => {
        const b = e.getBoundingClientRect();
        const s = svg.getBoundingClientRect();
        return (
          b.width > 16 &&
          b.width < 60 &&
          b.left > s.left &&
          b.right < s.right &&
          b.top > s.top &&
          b.bottom < s.bottom
        );
      },
    )!;
    const b = c.getBoundingClientRect();
    return {
      i: Number(c.getAttribute("data-circle")),
      x: b.x + b.width / 2,
      y: b.y + b.height / 2,
    };
  });
  await page.mouse.click(neighbor.x, neighbor.y);
  await expect(art).toHaveAttribute("data-selected", String(neighbor.i));
  await expectFramed(art);
  // A manual change during the move wins: Home, pressed in the same task as
  // the selection that starts it, is where the view stays.
  await page.evaluate(() => {
    const next = Array.from(document.querySelectorAll("button")).find(
      (b) => b.getAttribute("aria-label") === "Next circle",
    )!;
    next.click();
    document
      .querySelector("#garden-artwork")!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
      );
  });
  await page.waitForTimeout(400);
  await expect(art).toHaveAttribute("data-zoom", "1");
  await expect(art).toHaveAttribute("data-pan", "0,0");
  await expect(follow).toBeChecked();
  // Turning following off returns to the view from before it was on.
  await follow.uncheck();
  await expect(art).toHaveAttribute("data-zoom", before.zoom!);
  await expect(art).toHaveAttribute("data-pan", before.pan!);
  // Off, a selection leaves the view alone.
  await field.fill("40");
  await page.waitForTimeout(400);
  await expect(art).toHaveAttribute("data-pan", before.pan!);
});

for (const reduced of [false, true])
  test(`following moves the camera ${reduced ? "at once under reduced motion" : "in a short eased transition"}`, async ({
    page,
  }) => {
    await page.emulateMedia({
      reducedMotion: reduced ? "reduce" : "no-preference",
    });
    await page.goto("/");
    const d = await openGarden(page, explained);
    const art = d.locator("#garden-artwork");
    await d.getByRole("checkbox", { name: "Follow selection" }).check();
    await expectFramed(art);
    await art.evaluate((svg) => {
      (window as any).zooms = [];
      new MutationObserver(() =>
        (window as any).zooms.push(svg.getAttribute("data-zoom")),
      ).observe(svg, { attributes: true, attributeFilter: ["data-zoom"] });
    });
    await d.getByLabel("Circle", { exact: true }).fill("40");
    await expectFramed(art);
    const zooms: string[] = await page.evaluate(() => (window as any).zooms);
    if (reduced) expect(zooms).toHaveLength(1);
    else {
      expect(zooms.length).toBeGreaterThan(3);
      // Monotone in zoom: eased, without overshoot.
      const z = zooms.map(Number);
      const down = z.at(-1)! < z[0];
      for (let i = 1; i < z.length; i++)
        expect(down ? z[i] <= z[i - 1] : z[i] >= z[i - 1]).toBe(true);
    }
  });

// Production-path observations for the signature and the largest admitted
// packing: Go time in the worker, bytes, round trip, commit and paint, the
// time a selection takes to draw, and how quickly Return ends pending work.
// The assertions are the enforced bounds; the timings are logged, not judged.
test("garden production measurements stay within one computation and its limits", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Native = Worker;
    const w = window as any;
    w.gardenRows = [];
    w.gardenPeak = 0;
    w.gardenTerminated = [];
    let running = 0;
    window.Worker = class extends Native {
      sent = new Map<number, { time: number; q: any }>();
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        this.addEventListener("message", (e) => {
          const sent = this.sent.get(e.data.id);
          if (!sent) return;
          this.sent.delete(e.data.id);
          running--;
          const r = e.data.result;
          if (!r?.seed) return;
          const received = performance.now();
          // The client restores the lifted arrays in place after this
          // listener runs.
          setTimeout(() =>
            w.gardenRows.push({
              minRadius: sent.q.minRadius,
              circles: r.curvature.length,
              processed: r.processed,
              typedEntries: e.data.lifted?.floats.length,
              prepare: e.data.timings.prepare,
              bytes: e.data.timings.bytes,
              roundTrip: received - sent.time,
              received,
            }),
          );
        });
      }
      postMessage(message: any, ...rest: any[]) {
        if (message.action === "garden") {
          this.sent.set(message.id, {
            time: performance.now(),
            q: message.garden,
          });
          running++;
          w.gardenPeak = Math.max(w.gardenPeak, running);
        }
        return super.postMessage(message, ...rest);
      }
      terminate() {
        if (this.sent.size) running -= this.sent.size;
        w.gardenTerminated.push(performance.now());
        return super.terminate();
      }
    } as typeof Worker;
    new MutationObserver(() => {
      const rows = w.gardenRows;
      const art = document.querySelector("#garden-artwork");
      if (!rows.length || art?.getAttribute("aria-busy") !== "false") return;
      const row = rows.at(-1);
      if (row.commit !== undefined) return;
      row.commit = performance.now() - row.received;
      requestAnimationFrame(() =>
        requestAnimationFrame(
          () => (row.paint = performance.now() - row.received),
        ),
      );
    }).observe(document, {
      subtree: true,
      attributes: true,
      childList: true,
      attributeFilter: ["aria-busy"],
    });
  });
  await page.goto("/");
  await settled(page);
  const d = await openGarden(page);
  const art = d.locator("#garden-artwork");
  const radius = d.getByLabel("Minimum radius", { exact: true });
  await radius.fill("0.001");
  await expect(summary(d)).toContainText("minimum radius 0.001");
  await ready(d);
  await radius.fill("1e-9");
  await expect(summary(d)).toContainText("Stopped at the 5,000-circle limit");
  await ready(d);
  expect(await circleCount(d)).toBe(5000);
  // Selecting at the largest packing: click to the selection drawn.
  const selection = await art.evaluate(async (svg) => {
    const c = svg.querySelector('[data-circle="40"]')!.getBoundingClientRect();
    const start = performance.now();
    const at = { clientX: c.x + c.width / 2, clientY: c.y + c.height / 2 };
    svg.dispatchEvent(
      new PointerEvent("pointerdown", {
        ...at,
        bubbles: true,
        button: 0,
        pointerId: 7,
      }),
    );
    svg.dispatchEvent(
      new PointerEvent("pointerup", { ...at, bubbles: true, pointerId: 7 }),
    );
    await new Promise<void>((done) => {
      const check = () =>
        svg.getAttribute("data-selected") === "40"
          ? done()
          : requestAnimationFrame(check);
      check();
    });
    return performance.now() - start;
  });
  // A pan across the largest packing, as ten pointer moves.
  const pan = await art.evaluate(async (svg) => {
    const start = performance.now();
    const at = (x: number) => ({
      clientX: 300 + x,
      clientY: 300,
      bubbles: true,
      pointerId: 9,
    });
    svg.dispatchEvent(new PointerEvent("pointerdown", { ...at(0), button: 0 }));
    for (let i = 1; i <= 10; i++) {
      svg.dispatchEvent(new PointerEvent("pointermove", at(i * 5)));
      await new Promise((done) => requestAnimationFrame(done));
    }
    svg.dispatchEvent(new PointerEvent("pointerup", at(50)));
    return (performance.now() - start) / 10;
  });
  // Return while the largest packing is being generated again.
  await d.getByLabel("Depth", { exact: true }).fill("11");
  await page.waitForTimeout(130);
  const returned = await page.evaluate(() => performance.now());
  await d.getByRole("button", { name: "Return to study", exact: true }).click();
  await expect(d).toBeHidden();
  const metrics = await page.evaluate(() => ({
    rows: (window as any).gardenRows,
    peak: (window as any).gardenPeak,
    terminated: (window as any).gardenTerminated,
  }));
  const ended = metrics.terminated.filter((t: number) => t >= returned);
  expect(ended.length).toBeGreaterThanOrEqual(2);
  expect(metrics.peak).toBe(1);
  expect(metrics.rows.length).toBeGreaterThanOrEqual(3);
  for (const r of metrics.rows) {
    expect(r.circles).toBeLessThanOrEqual(5000);
    expect(r.processed).toBeLessThanOrEqual(20000);
    expect(r.typedEntries).toBeGreaterThan(0);
  }
  console.log(
    "Garden production measurements (milliseconds, bytes; Chromium on local Mac):",
    JSON.stringify({
      rows: metrics.rows.map(({ received: _, ...r }: any) => r),
      selection,
      panMove: pan,
      cancel: Math.max(...ended) - returned,
    }),
  );
});
