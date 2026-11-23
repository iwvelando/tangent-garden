import { test, expect, type Page, type Locator } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { deflateRawSync } from "node:zlib";
import { wireStudy } from "./study-link-wire";
import { decodeVideo, frameDifference, probe } from "./video";

// The garden's inversive view and glide (#388). Drawn geometry is checked
// against the inversion computed here, pointwise from known source circles,
// independently of the engine's coordinates.

const strip = "A rose window unrolled into a strip";
const rose = "A rose window made only of circles";
const garden = (page: Page) =>
  page.getByRole("dialog", { name: "The Apollonian garden" });
const ready = (d: Locator) =>
  expect(d.locator("#garden-artwork")).toHaveAttribute("aria-busy", "false");
async function openExample(page: Page, title: string) {
  await page.goto("/");
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
const art = (d: Locator) => d.locator("#garden-artwork");
const fieldError = (field: Locator) =>
  field
    .locator("xpath=ancestor::div[contains(@class,'field')][1]")
    .locator(".field-error");
const invert = (d: Locator) =>
  d.getByRole("checkbox", { name: "Invert in a circle" });
const pole = (d: Locator, k: "x" | "y") =>
  d.getByLabel(`Pole ${k}`, { exact: true });
const radiusField = (d: Locator) =>
  d.getByLabel("Inversion radius", { exact: true });
const motion = (d: Locator) =>
  d.getByRole("combobox", { name: "Motion", exact: true });
const slider = (d: Locator) =>
  d.getByRole("slider", { name: "Animation progress" });

// Drawn circles in model units, from the page's 1000 × 760 frame at the
// camera's zoom (pan is the group's translation), and drawn lines and
// large circles as their Bézier's three points.
type Circle = { i: number; x: number; y: number; r: number };
type Stretch = { i: number; shape: string; points: number[][] };
async function shapes(d: Locator) {
  const zoom = Number(await art(d).getAttribute("data-zoom"));
  const k = 350 * zoom;
  return art(d).evaluate((svg, k) => {
    const circles = Array.from(svg.querySelectorAll("circle"), (c) => ({
      i: Number(c.getAttribute("data-circle")),
      x: (+c.getAttribute("cx")! - 500) / k,
      y: (380 - +c.getAttribute("cy")!) / k,
      r: +c.getAttribute("r")! / k,
    }));
    const stretches = Array.from(
      svg.querySelectorAll("path[data-circle]"),
      (p) => {
        const v = p.getAttribute("d")!.match(/-?[\d.]+(e[-+]?\d+)?/g)!;
        const n = v.map(Number);
        return {
          i: Number(p.getAttribute("data-circle")),
          shape: p.getAttribute("data-shape")!,
          points: [0, 2, 4].map((j) => [
            (n[j] - 500) / k,
            (380 - n[j + 1]) / k,
          ]),
        };
      },
    );
    // In circle order: a selection is drawn after the rest.
    circles.sort((a, b) => a.i - b.i);
    stretches.sort((a, b) => a.i - b.i);
    return { circles, stretches };
  }, k) as Promise<{ circles: Circle[]; stretches: Stretch[] }>;
}
// The inversion itself, and a circle's image through three of its points.
const invertPoint = (
  px: number,
  py: number,
  rho: number,
  x: number,
  y: number,
) => {
  const dx = x - px,
    dy = y - py;
  const k = (rho * rho) / (dx * dx + dy * dy);
  return [px + k * dx, py + k * dy];
};
function circumcircle([a, b, c]: number[][]) {
  const d =
    2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  const a2 = a[0] ** 2 + a[1] ** 2,
    b2 = b[0] ** 2 + b[1] ** 2,
    c2 = c[0] ** 2 + c[1] ** 2;
  const x = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d;
  const y = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
  return { x, y, r: Math.hypot(a[0] - x, a[1] - y) };
}
function imageOf(
  c: { x: number; y: number; r: number },
  p: { x: number; y: number; radius: number },
) {
  return circumcircle(
    [0.3, 2.4, 4.1].map((t) =>
      invertPoint(
        p.x,
        p.y,
        p.radius,
        c.x + c.r * Math.cos(t),
        c.y + c.r * Math.sin(t),
      ),
    ),
  );
}
// The original seed's first circles, by breadth-first index: the
// enclosing circle, the half-radius pair, the top circle, and curvature 15
// at (0, 4/15).
const source: Record<number, { x: number; y: number; r: number }> = {
  0: { x: 0, y: 0, r: 1 },
  1: { x: -0.5, y: 0, r: 0.5 },
  2: { x: 0.5, y: 0, r: 0.5 },
  3: { x: 0, y: 2 / 3, r: 1 / 3 },
  4: { x: 0, y: 4 / 15, r: 1 / 15 },
};

test("the strip: the enclosing and top circles become the lines y = ±1/2, and every circle is the source inverted", async ({
  page,
}) => {
  const d = await openExample(page, strip);
  await expect(invert(d)).toBeChecked();
  await expect(pole(d, "x")).toHaveValue("0");
  await expect(pole(d, "y")).toHaveValue("1");
  await expect(radiusField(d)).toHaveValue("1");
  const { circles, stretches } = await shapes(d);
  // Both lines exactly horizontal, at their heights.
  const lines = stretches.filter((s) => s.shape === "line");
  expect(lines.map((l) => l.i).sort()).toEqual([0, 3]);
  for (const l of lines) {
    const y = l.i === 0 ? 0.5 : -0.5;
    for (const [, py] of l.points) expect(py).toBeCloseTo(y, 9);
  }
  // The half-radius circles, orthogonal to the inversion circle, stay.
  const at = (i: number) => circles.find((c) => c.i === i)!;
  for (const i of [1, 2]) {
    expect(at(i).x).toBeCloseTo(source[i].x, 9);
    expect(at(i).y).toBeCloseTo(0, 9);
    expect(at(i).r).toBeCloseTo(0.5, 9);
  }
  // Curvature 15 at (0, 4/15), inverted about (0, 1) with radius 1.
  const want = imageOf(source[4], { x: 0, y: 1, radius: 1 });
  expect(at(4).x).toBeCloseTo(want.x, 9);
  expect(at(4).y).toBeCloseTo(want.y, 9);
  expect(at(4).r).toBeCloseTo(want.r, 9);
  // Every circle lies in the strip, tangent to the lines or inside.
  for (const c of circles) {
    expect(c.y + c.r).toBeLessThanOrEqual(0.5 + 1e-9);
    expect(c.y - c.r).toBeGreaterThanOrEqual(-0.5 - 1e-9);
  }
  // The selected line's explanation says so; the summary counts both.
  await d.getByLabel("Circle", { exact: true }).fill("1");
  await expect(d.locator(".garden-facts").nth(1)).toHaveText(
    "In this view: a line, through the pole.",
  );
  await expect(d.locator(".garden-summary")).toContainText(
    "2 circles through the pole are lines",
  );
  // A click inside a line's half-plane, above the strip, chooses it.
  await d.getByRole("button", { name: "Clear selection" }).click();
  await expect(art(d)).toHaveAttribute("data-selected", "-1");
  const box = (await art(d).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.1);
  await expect(art(d)).toHaveAttribute("data-selected", "0");
});

test("turning the view on and off keeps the selection, and turning it on again restores the last pole", async ({
  page,
}) => {
  const d = await openExample(page, rose);
  const before = await shapes(d);
  // Curvature 15, by number.
  await d.getByLabel("Circle", { exact: true }).fill("5");
  const facts = await d.locator(".garden-facts").first().textContent();
  await invert(d).check();
  await ready(d);
  await expect(pole(d, "y")).toHaveValue("1");
  await expect(d.locator(".garden-facts").first()).toHaveText(facts!);
  await expect(d.locator(".garden-facts").nth(1)).toContainText(
    "In this view: radius",
  );
  // Another pole: inside the top circle, which then encloses the rest.
  await pole(d, "y").fill("0.6");
  await ready(d);
  const { circles } = await shapes(d);
  const top = circles.find((c) => c.i === 3)!;
  const want = imageOf(source[3], { x: 0, y: 0.6, radius: 1 });
  expect(top.x).toBeCloseTo(want.x, 9);
  expect(top.y).toBeCloseTo(want.y, 9);
  expect(top.r).toBeCloseTo(want.r, 9);
  for (const c of circles)
    if (c.i !== 3)
      expect(Math.hypot(c.x - top.x, c.y - top.y) + c.r).toBeLessThanOrEqual(
        top.r * (1 + 1e-9),
      );
  await invert(d).uncheck();
  await ready(d);
  expect(await shapes(d)).toEqual(before);
  await expect(d.locator(".garden-facts").first()).toHaveText(facts!);
  await invert(d).check();
  await ready(d);
  await expect(pole(d, "y")).toHaveValue("0.6");
});

test("inverting in the selected circle keeps that circle and turns the rest inside it", async ({
  page,
}) => {
  const d = await openExample(page, rose);
  await d.getByLabel("Circle", { exact: true }).fill("2");
  await invert(d).check();
  await ready(d);
  await d
    .getByRole("button", { name: "Invert in the selected circle" })
    .click();
  await ready(d);
  await expect(pole(d, "x")).toHaveValue("-0.5");
  await expect(pole(d, "y")).toHaveValue("0");
  await expect(radiusField(d)).toHaveValue("0.5");
  const { circles, stretches } = await shapes(d);
  expect(stretches).toEqual([]);
  const left = circles.find((c) => c.i === 1)!;
  expect([left.x, left.y, left.r]).toEqual([-0.5, 0, 0.5]);
  for (const c of circles)
    if (c.i !== 1)
      expect(Math.hypot(c.x - left.x, c.y - left.y) + c.r).toBeLessThanOrEqual(
        0.5 * (1 + 1e-9),
      );
  // The enclosing circle, inverted in the left one.
  const outer = circles.find((c) => c.i === 0)!;
  const want = imageOf(source[0], { x: -0.5, y: 0, radius: 0.5 });
  expect(outer.x).toBeCloseTo(want.x, 9);
  expect(outer.r).toBeCloseTo(want.r, 9);
  // A circle too small for the radius range can't be inverted in.
  await d.getByLabel("Circle", { exact: true }).fill("300");
  await expect(
    d.getByRole("button", { name: "Invert in the selected circle" }),
  ).toBeDisabled();
});

test("refusals name the pole, radius and far pole fields, and keep the drawing", async ({
  page,
}) => {
  const d = await openExample(page, strip);
  const before = await shapes(d);
  for (const [field, text, message] of [
    [pole(d, "x"), "2.5", "within ±2"],
    [pole(d, "y"), "-3", "within ±2"],
    [radiusField(d), "0.01", "0.05–2"],
    [radiusField(d), "", "finite number"],
    [d.getByLabel("Far pole x", { exact: true }), "5", "within ±2"],
    [d.getByLabel("Far pole y", { exact: true }), "", "finite number"],
  ] as const) {
    const was = await field.inputValue();
    await field.fill(text);
    await expect(fieldError(field), text).toContainText(message);
    await expect(
      d.getByRole("button", { name: "Copy link", exact: true }),
    ).toBeDisabled();
    expect(await shapes(d)).toEqual(before);
    await field.fill(was);
    await ready(d);
  }
});

test("a link carries the view and glide, older links open without one, and out-of-range values are refused", async ({
  page,
}) => {
  const { presetGarden, gardenPresets } = await import("../web/garden/model");
  const { planarStudy, presetStudy } = await import("../web/planar-link");
  const { LinkError } = await import("../web/study-link");
  const open = (garden: Record<string, unknown>) =>
    planarStudy({ ...presetStudy(0), garden: garden as any }).garden!;
  const refusal = (garden: Record<string, unknown>) => {
    try {
      open(garden);
    } catch (e) {
      return e instanceof LinkError ? e.field : String(e);
    }
  };
  const index = gardenPresets.findIndex((p) => p.title === strip);
  const s = presetGarden(index);
  expect(open(s)).toEqual(s);
  // An older link: no view, no motion.
  const older = open(presetGarden(0));
  expect("inversion" in older || "motion" in older || "glide" in older).toBe(
    false,
  );
  // A glide without a view opens with the reveal.
  expect(open({ ...presetGarden(0), motion: "glide" }).motion).toBeUndefined();
  for (const [garden, field] of [
    [{ ...s, inversion: { x: 2.5, y: 0, radius: 1 } }, "garden.inversion.x"],
    [
      { ...s, inversion: { x: 0, y: 1, radius: 0.01 } },
      "garden.inversion.radius",
    ],
    [{ ...s, glide: { x: 0, y: -2.01 } }, "garden.glide.y"],
    [{ ...s, motion: "spin" }, "garden.motion"],
  ] as const)
    expect(refusal(garden), field).toBe(field);
  // Through the page: the link reopens the same view.
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (value: string) => {
          (window as any).copied = value;
        },
      },
    }),
  );
  const d = await openExample(page, strip);
  await pole(d, "y").fill("0.9");
  await ready(d);
  const drawn = await shapes(d);
  await d.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(d.getByText("Link copied", { exact: true })).toBeVisible();
  const link: string = await page.evaluate(() => (window as any).copied);
  const saved = wireStudy(new URL(link).hash.slice(3));
  expect(saved.garden.inversion).toEqual({ x: 0, y: 0.9, radius: 1 });
  expect(saved.garden.glide).toEqual({ x: 0, y: 1.4 });
  expect(saved.garden.motion).toBe("glide");
  await page.goto("/");
  await page.goto(link);
  const reopened = garden(page);
  await ready(reopened);
  expect(await shapes(reopened)).toEqual(drawn);
  await expect(motion(reopened)).toHaveValue("glide");
});

// The glide's pole at progress p, restated from its definition.
const glidePole = (p: number, from: number[], to: number[]) => {
  const s = (1 - Math.cos(2 * Math.PI * p)) / 2;
  return [0, 1].map((k) => (1 - s) * from[k] + s * to[k]);
};

test("the glide draws the frozen packing inverted about each time's pole, seeking forward and back, paused and stopped", async ({
  page,
}) => {
  const d = await openExample(page, strip);
  await expect(motion(d)).toHaveValue("glide");
  const still = await shapes(d);
  // Circles the first pole's view leaves out are there for the glide's
  // other poles, and the summary says so.
  await expect(d.locator(".garden-summary")).toContainText(
    "kept as ancestors of drawn circles or for other poles of the glide",
  );
  const count = (await d.locator(".garden-summary").textContent())!.match(
    /^[\d,]+/,
  )![0];
  // 12 s, looping: time t is progress t / 12.
  for (const t of ["3", "6", "1.5", "9"]) {
    await slider(d).fill(String(Number(t) / 12));
    await expect(d.locator(".garden-view")).toHaveAttribute(
      "data-reveal-time",
      String(Number(t) / 12),
    );
    const [px, py] = glidePole(Number(t) / 12, [0, 1], [0, 1.4]);
    // Frames arrive from the worker; the drawing settles on them.
    await expect
      .poll(async () => {
        const c = (await shapes(d)).circles.find((c) => c.i === 4);
        return c && imageOf(source[4], { x: px, y: py, radius: 1 }).x - c.x;
      })
      .toBeCloseTo(0, 9);
    const { circles } = await shapes(d);
    // The frozen packing: the same circles as the static drawing.
    await expect(d.locator(".garden-summary")).toContainText(
      `${count} circles`,
    );
    for (const i of [1, 2, 3, 4]) {
      const c = circles.find((c) => c.i === i);
      if (!c) continue;
      const want = imageOf(source[i], { x: px, y: py, radius: 1 });
      expect(c.x, `circle ${i} at ${t}`).toBeCloseTo(want.x, 8);
      expect(c.y, `circle ${i} at ${t}`).toBeCloseTo(want.y, 8);
      expect(c.r, `circle ${i} at ${t}`).toBeCloseTo(want.r, 8);
    }
  }
  // Near the start, the enclosing circle's image is a circle far larger
  // than the page, drawn as its stretch: the Bézier's ends and middle lie
  // on the circle inverted here.
  const early = 0.01;
  await slider(d).fill(String(early));
  const [ex, ey] = glidePole(early, [0, 1], [0, 1.4]);
  const big = imageOf(source[0], { x: ex, y: ey, radius: 1 });
  await expect
    .poll(async () => (await shapes(d)).stretches.find((s) => s.i === 0)?.shape)
    .toBe("arc");
  const arc = (await shapes(d)).stretches.find((s) => s.i === 0)!;
  const [a, c, b] = arc.points;
  const middle = [0, 1].map((k) => (a[k] + 2 * c[k] + b[k]) / 4);
  for (const p of [a, b, middle])
    expect(Math.hypot(p[0] - big.x, p[1] - big.y) - big.r).toBeCloseTo(0, 6);
  // The record of a paused frame names the glide and its time.
  await d.getByRole("button", { name: "Stop glide" }).click();
  await ready(d);
  expect(await shapes(d)).toEqual(still);
  // Playing runs and pauses; the loop is seamless, so it is offered.
  await d.getByRole("button", { name: "Play glide" }).click();
  await expect(d.locator(".garden-view")).toHaveAttribute(
    "data-playing",
    "true",
  );
  await page.waitForTimeout(500);
  await d.getByRole("button", { name: "Pause glide" }).click();
  await expect(d.locator(".study-error")).toHaveCount(0);
  const paused = await d
    .locator(".garden-view")
    .getAttribute("data-reveal-time");
  expect(Number(paused)).toBeGreaterThan(0);
  // An edit to the pole ends the glide and restores a static drawing.
  await pole(d, "x").fill("0.1");
  await expect(d.locator(".garden-view")).not.toHaveAttribute(
    "data-reveal-time",
    /./,
  );
  await ready(d);
});

test("scrubbing a glide never disables a button", async ({ page }) => {
  const d = await openExample(page, strip);
  const actions = [
    d.getByRole("button", { name: "Play glide", exact: true }),
    d.getByRole("button", { name: "Copy link", exact: true }),
    d.getByRole("button", { name: "Export image", exact: false }),
  ];
  for (const action of actions) await expect(action).toBeEnabled();
  await d.evaluate((dialog) => {
    const blinked: string[] = ((window as any).blinked = []);
    new MutationObserver((records) => {
      for (const r of records) {
        const button = r.target as HTMLButtonElement;
        if (button.disabled) blinked.push(button.textContent ?? "");
      }
    }).observe(dialog, {
      attributes: true,
      attributeFilter: ["disabled"],
      subtree: true,
    });
  });
  const box = (await slider(d).boundingBox())!;
  await page.mouse.move(box.x + 5, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 0; i <= 30; i++) {
    await page.mouse.move(
      box.x + 5 + ((box.width - 10) * i) / 30,
      box.y + box.height / 2,
    );
    await page.waitForTimeout(25);
  }
  await page.mouse.up();
  await ready(d);
  expect(await page.evaluate(() => (window as any).blinked)).toEqual([]);
  for (const action of actions) await expect(action).toBeEnabled();
});

test("the reveal plays under a view, and choosing it over the glide keeps the far pole", async ({
  page,
}) => {
  const d = await openExample(page, strip);
  await motion(d).selectOption("reveal");
  await ready(d);
  await expect(d.getByLabel("Far pole x", { exact: true })).toHaveCount(0);
  // The reveal's packing is the view's own, not the glide's.
  await expect(d.locator(".garden-summary")).not.toContainText("glide");
  await slider(d).fill("0.03");
  // The four seed circles: two of them lines.
  await expect
    .poll(async () => {
      const s = await shapes(d);
      return [...s.circles, ...s.stretches].map((c) => c.i).sort();
    })
    .toEqual([0, 1, 2, 3]);
  await d.getByRole("button", { name: "Stop reveal" }).click();
  await motion(d).selectOption("glide");
  await expect(d.getByLabel("Far pole y", { exact: true })).toHaveValue("1.4");
  // Turning the view off leaves only the reveal.
  await invert(d).uncheck();
  await expect(motion(d)).toHaveValue("reveal");
  await expect(motion(d).locator("option[value=glide]")).toBeDisabled();
});

test("the SVG still records the view, and decoded glide frames match the drawing at their times", async ({
  page,
}) => {
  const d = await openExample(page, strip);
  // 1.4 s at 15 fps is 21 frames at times i/20.
  await d.getByLabel("Glide duration", { exact: true }).fill("1.4");
  await d.getByLabel("Repeat", { exact: true }).selectOption("once");
  await slider(d).fill("0.25");
  const download = page.waitForEvent("download");
  await expect
    .poll(async () => (await shapes(d)).circles.find((c) => c.i === 4)?.y)
    .toBeCloseTo(
      imageOf(source[4], {
        x: 0,
        y: glidePole(0.25, [0, 1], [0, 1.4])[1],
        radius: 1,
      }).y,
      9,
    );
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
  expect(record.inversion).toMatchObject({ x: 0, y: 1, radius: 1 });
  expect(record.glide).toMatchObject({
    from: { x: 0, y: 1 },
    to: { x: 0, y: 1.4 },
    duration: 1.4,
    repeat: "once",
    time: 0.25,
  });
  const raster = () =>
    art(d).evaluate(async (live) => {
      const svg = live.cloneNode(true) as SVGSVGElement;
      svg.setAttribute("width", "500");
      svg.setAttribute("height", "380");
      const url = URL.createObjectURL(
        new Blob([new XMLSerializer().serializeToString(svg)], {
          type: "image/svg+xml",
        }),
      );
      const image = new Image();
      image.src = url;
      await image.decode();
      URL.revokeObjectURL(url);
      const c = document.createElement("canvas");
      c.width = 500;
      c.height = 380;
      c.getContext("2d")!.drawImage(image, 0, 0);
      return Array.from(c.getContext("2d")!.getImageData(0, 0, 500, 380).data);
    });
  const references = new Map<number, number[]>();
  for (const t of [0, 0.25, 0.3, 0.5]) {
    await slider(d).fill(String(t));
    const [, py] = glidePole(t, [0, 1], [0, 1.4]);
    await expect
      .poll(async () => (await shapes(d)).circles.find((c) => c.i === 4)?.y)
      .toBeCloseTo(imageOf(source[4], { x: 0, y: py, radius: 1 }).y, 9);
    references.set(t, await raster());
  }
  await d.getByRole("button", { name: "Stop glide" }).click();
  const settings = d.locator("#garden-export-settings");
  if (!(await settings.evaluate((e) => (e as HTMLDetailsElement).open)))
    await settings.locator("summary").click();
  await d.getByLabel("Export format", { exact: true }).selectOption("mp4");
  await d.getByRole("slider", { name: "Export resolution" }).fill("0.5");
  await d.getByLabel("Export frame rate", { exact: true }).selectOption("15");
  const movie = page.waitForEvent("download");
  await d.getByRole("button", { name: /^Export MP4 video/ }).click();
  const path = (await (await movie).path())!;
  const bytes = await readFile(path);
  expect(bytes.includes(Buffer.from('"glide"'))).toBe(true);
  const timing = probe(path);
  if (timing)
    expect([timing.width, timing.height, timing.frames]).toEqual([
      500, 380, 21,
    ]);
  expect((await decodeVideo(page, bytes)).duration).toBeCloseTo(1.4, 3);
  // Frames 0, 5 and 10 are times 0, 0.25 and 0.5; frame 5 matches its own
  // time better than 0.3's.
  for (const [frame, t] of [
    [0, 0],
    [5, 0.25],
    [10, 0.5],
  ] as const) {
    const same = frameDifference(path, 500, 380, frame, references.get(t)!);
    if (!same) continue;
    // The encoder's noise: a frame at its own time differs by 1.1–1.7
    // locally and 2.0 on CI, one at another time by 4.4–5.0.
    expect(same.meanDifference).toBeLessThan(3);
    expect(same.unmatchedInk).toBeLessThan(0.02);
  }
  const own = frameDifference(path, 500, 380, 5, references.get(0.25)!);
  if (own)
    expect(
      frameDifference(path, 500, 380, 5, references.get(0.3)!)!.unmatchedInk,
    ).toBeGreaterThan(own.unmatchedInk + 0.02);
});

test("a selection around the pole stays selected when the view zooms inside its image", async ({
  page,
}) => {
  const { gardenRequest, presetGarden } = await import("../web/garden/model");
  const { presetStudy } = await import("../web/planar-link");
  // The lower curvature-3 circle, at (0, −2/3), inverted in itself. The
  // half-plane below the diameter, which holds it, becomes the outside of
  // a disk of diameter 1/6 touching the pole, and a view zoomed 50× into
  // that disk, with detail, shows the upper half inverted, away from the
  // circle.
  const lower = { curvature: 3, x: 0, y: -2 };
  const study = {
    ...presetGarden(0),
    inversion: { x: 0, y: -2 / 3, radius: 1 / 3 },
    selected: lower,
    detail: true,
    view: { x: 0, y: (-2 / 3 + 1 / 12) * 350 * 50, zoom: 50 },
  };
  expect(gardenRequest(study).keep).toEqual(lower);
  // A circle away from the pole whose image the window meets is not sent:
  // curvature 15 at (0, 4/15), with the whole packing in view.
  const away = { ...study, view: { x: 0, y: 0, zoom: 1 } };
  expect(
    gardenRequest({ ...away, selected: { curvature: 15, x: 0, y: 4 } }).keep,
  ).toBeUndefined();
  // Around the pole, it is kept whatever the view.
  expect(gardenRequest(away).keep).toEqual(lower);
  const token = deflateRawSync(
    JSON.stringify({
      v: 1,
      notebook: "2d",
      study: { ...presetStudy(0), garden: study },
    }),
  ).toString("base64url");
  await page.goto(`/#s=${token}`);
  const d = garden(page);
  await ready(d);
  await expect(art(d)).not.toHaveAttribute("data-selected", "-1");
  await expect(d.locator(".garden-about .garden-facts").first()).toContainText(
    "Curvature 3 ·",
  );
});

test("pausing a glide while its loop is being checked keeps it paused", async ({
  page,
}) => {
  const d = await openExample(page, strip);
  const view = d.locator(".garden-view");
  const play = d.getByRole("button", { name: "Play glide", exact: true });
  // Pause at once, while the worker freezes the packing and draws the
  // loop's last frame, before the clock starts.
  await play.evaluate(async (b) => {
    (b as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    (b as HTMLButtonElement).click();
  });
  await expect(view).not.toHaveAttribute("data-playing", "true");
  await expect(
    d.getByRole("button", { name: "Resume glide", exact: true }),
  ).toBeVisible();
  const paused = await view.getAttribute("data-reveal-time");
  await page.waitForTimeout(800);
  await expect(view).not.toHaveAttribute("data-playing", "true");
  expect(await view.getAttribute("data-reveal-time")).toBe(paused);
});
