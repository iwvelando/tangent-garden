import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  chooseColorScheme,
  choosePreset,
  exportImage,
  openShapeExport,
} from "./helpers";
import { decodeVideo, frameDifference, probe } from "./video";

// Base sphere and fibers (docs/tesseracts.md): one latitude of S² beside
// the Hopf fibers over its points, with a selection and a moving point.
const name = "A circle over every point";
const stage = (p: Page) => p.locator(".tesseract-stage");
const settle = (p: Page) =>
  expect(stage(p)).toHaveAttribute("aria-busy", "false");
const panel = (p: Page, mode: "base" | "stereo") =>
  p.locator(`svg[data-representation="${mode}"]`);
const desc = async (p: Page, mode: "base" | "stereo") =>
  JSON.parse(
    (await panel(p, mode).locator(":scope > desc").textContent()) ?? "{}",
  );
const meta = async (p: Page) =>
  JSON.parse((await p.locator("#tesseract-artwork > desc").textContent())!);
const selectedField = (p: Page) =>
  p.getByRole("spinbutton", { name: "Selected fiber", exact: true });
const open = async (p: Page) => {
  await p.goto("/?study=4d");
  await settle(p);
  await choosePreset(p, { label: name });
  await settle(p);
};
// What each pane draws as moving and selected, by sample.
const roles = (p: Page) =>
  p
    .locator("#tesseract-artwork [data-correspondence]")
    .evaluateAll((es) =>
      es.map((e) => [
        e
          .closest("svg[data-representation]")!
          .getAttribute("data-representation"),
        e.getAttribute("data-correspondence"),
        e.getAttribute("data-sample") ?? e.getAttribute("data-source"),
      ]),
    );
const correspondence = async (p: Page) => ({
  base: (await desc(p, "base")).weave.correspondence,
  stereo: (await desc(p, "stereo")).weave.correspondence,
});
// A screen point on a drawn element: a base marker's center, or a vertex
// of a fiber path, in page coordinates.
const pointOn = (p: Page, selector: string, vertex = 0) =>
  p.locator(selector).evaluate((e, vertex) => {
    const svg = e.ownerSVGElement!;
    const m = svg.getScreenCTM()!;
    let x: number, y: number;
    if (e.tagName === "g") {
      const c = e.querySelector("circle:last-child") as SVGCircleElement;
      x = c.cx.baseVal.value;
      y = c.cy.baseVal.value;
    } else {
      const d = e
        .getAttribute("d")!
        .match(/-?\d+(?:\.\d+)?/g)!
        .map(Number);
      const i = Math.min(vertex, d.length / 2 - 1);
      x = d[2 * i];
      y = d[2 * i + 1];
    }
    return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
  }, vertex);

// The live drawing rasterized as export rasterizes it.
const raster = (page: Page, width: number, height: number) =>
  page.evaluate(
    async ({ width, height }) => {
      const svg = document
        .getElementById("tesseract-artwork")!
        .cloneNode(true) as SVGSVGElement;
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
        const ctx = c.getContext("2d")!;
        ctx.drawImage(image, 0, 0);
        return Array.from(ctx.getImageData(0, 0, width, height).data);
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    { width, height },
  );

test("the preset opens the base sphere first, with linked identities and no text in the artwork", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page);
  // Source first: the base sphere is on the left.
  const [base, fibers] = await Promise.all([
    panel(page, "base").boundingBox(),
    panel(page, "stereo").boundingBox(),
  ]);
  expect(base!.x).toBeLessThan(fibers!.x);
  await expect(page.locator(".paired-view-labels span")).toHaveText([
    "1 / Base sphere S² (left)",
    "2 / Fibers in space (right)",
  ]);
  await expect(
    page.locator("#tesseract-artwork text, #tesseract-artwork foreignObject"),
  ).toHaveCount(0);
  const m = await meta(page);
  expect(m.views.map((v: { operation: string }) => v.operation)).toEqual([
    "base",
    "stereo",
  ]);
  // Twelve samples, each a base point and a fiber with the same index; the
  // first is selected and is the moving point, drawn once in each pane.
  await expect(panel(page, "base").locator("g[data-sample]")).toHaveCount(12);
  await expect(
    panel(page, "stereo").locator('path[data-role="fiber"]'),
  ).toHaveCount(12);
  await expect(page.locator('[data-source="weave/moving"]')).toHaveCount(0);
  const drawn = await roles(page);
  expect(drawn.filter(([, r]) => r === "moving")).toEqual([
    ["base", "moving", "0"],
    ["stereo", "moving", "0"],
  ]);
  const c = await correspondence(page);
  expect(c.base).toEqual(c.stereo);
  expect(c.stereo).toMatchObject({
    fibers: 12,
    selected: 0,
    movingSample: 0,
    parameter: 0,
  });
  // Every control the study uses is reachable, including the window.
  for (const label of [
    "Central latitude α",
    "Projection window radius",
    "xw angle",
  ])
    await expect(
      page.getByRole("textbox", { name: label, exact: true }),
    ).toBeVisible();
  await expect(
    page.getByRole("spinbutton", { name: "Fibers on the latitude" }),
  ).toHaveValue("12");
  await expect(selectedField(page)).toHaveValue("1");
  await expect(
    page.getByRole("combobox", { name: "Weave family", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Latitude spread", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".tesseract-diagnostics")).toHaveText(
    "12 fibers over one latitude of S², and the moving point's fiber. Open ends mark the projection window, not broken curves.",
  );
  await expect(
    page.locator(".lift-readout span").filter({ hasText: "Selected fiber:" }),
  ).toContainText("1 of 12");
});

test("tapping a point or fiber in either pane, the field, or [ and ] select the same identity", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page);
  // A base point.
  const p4 = await pointOn(
    page,
    'svg[data-representation="base"] g[data-sample="4"]',
  );
  await page.mouse.click(p4.x, p4.y);
  await settle(page);
  await expect(selectedField(page)).toHaveValue("5");
  expect((await roles(page)).filter(([, r]) => r === "moving")).toEqual([
    ["base", "moving", "4"],
    ["stereo", "moving", "4"],
  ]);
  // A fiber, picked on one of its own vertices where other fibers pass
  // near: the nearest line wins, not the topmost.
  const p9 = await pointOn(
    page,
    'svg[data-representation="stereo"] path[data-sample="9"]',
    40,
  );
  await page.mouse.click(p9.x + 1, p9.y);
  await settle(page);
  await expect(selectedField(page)).toHaveValue("10");
  expect((await correspondence(page)).base.selected).toBe(9);
  // A drag orbits and keeps the selection.
  const before = (await meta(page)).view;
  const box = (await panel(page, "stereo").boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + 70, { steps: 5 });
  await page.mouse.up();
  await settle(page);
  expect((await meta(page)).view.yaw).not.toBe(before.yaw);
  await expect(selectedField(page)).toHaveValue("10");
  // Empty space selects nothing.
  await page.mouse.click(box.x + 6, box.y + box.height - 6);
  await settle(page);
  await expect(selectedField(page)).toHaveValue("10");
  // Keys step around the latitude, wrapping.
  await panel(page, "base").focus();
  await page.keyboard.press("]");
  await page.keyboard.press("]");
  await page.keyboard.press("]");
  await settle(page);
  await expect(selectedField(page)).toHaveValue("1");
  await page.keyboard.press("[");
  await settle(page);
  await expect(selectedField(page)).toHaveValue("12");
  // The field.
  await selectedField(page).fill("3");
  await settle(page);
  expect((await correspondence(page)).stereo.selected).toBe(2);
  // Fewer fibers than the selection selects the last fiber.
  await page
    .getByRole("spinbutton", { name: "Fibers on the latitude" })
    .fill("2");
  await settle(page);
  await expect(selectedField(page)).toHaveValue("2");
  expect((await correspondence(page)).stereo).toMatchObject({
    fibers: 2,
    selected: 1,
  });
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a tap selects on a phone while touch scrolls the page", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await open(page);
  // Stacked: the base sphere above the fibers.
  const [base, fibers] = await Promise.all([
    panel(page, "base").boundingBox(),
    panel(page, "stereo").boundingBox(),
  ]);
  expect(base!.y + base!.height).toBeLessThanOrEqual(fibers!.y + 1);
  await expect(page.locator(".paired-view-labels span")).toHaveText([
    "1 / Base sphere S² (top)",
    "2 / Fibers in space (bottom)",
  ]);
  await panel(page, "base").evaluate((e) =>
    e.scrollIntoView({ block: "center", behavior: "instant" }),
  );
  const at = await pointOn(
    page,
    'svg[data-representation="base"] g[data-sample="6"]',
  );
  await page.touchscreen.tap(at.x, at.y);
  await settle(page);
  await expect(selectedField(page)).toHaveValue("7");
  // Nothing widens the page, at rest, playing or paused, so the playback
  // bar never swipes sideways, and every readout fits its column.
  const fits = () =>
    page.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      screen: document.documentElement.clientWidth,
      readouts: [...document.querySelectorAll(".lift-readout b")]
        .filter((b) => b.scrollWidth > b.clientWidth + 0.5)
        .map((b) => b.textContent),
    }));
  const check = async () => {
    const f = await fits();
    expect(f.page).toBeLessThanOrEqual(f.screen);
    expect(f.readouts).toEqual([]);
  };
  await check();
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect(page.locator('[data-source="weave/moving"]')).toHaveCount(1);
  await check();
  await page
    .getByRole("button", { name: "Pause", exact: true })
    .first()
    .click();
  await check();
  await context.close();
});

test("tracing the latitude moves one complete fiber, meets the frozen bouquet and returns", async ({
  page,
}) => {
  await open(page);
  await selectedField(page).fill("3");
  await settle(page);
  const study = await meta(page);
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", { name: "Animation progress" });
  const fiberAt = async (s: number) => {
    await slider.fill(String(s));
    await settle(page);
    const c = await correspondence(page);
    expect(c.base).toEqual(c.stereo);
    return c.stereo;
  };
  // Scrub forward and back: the point sits at δ₂ + 2πs, one result for
  // both panes at every position.
  for (const s of [0.5, 0.125, 0.9, 0.25]) {
    const c = await fiberAt(s);
    expect(c.selected).toBe(2);
    expect(c.parameter).toBeCloseTo(
      (2 * Math.PI * (2 / 12 + s)) % (2 * Math.PI),
      12,
    );
    expect(c.movingSample).toBe(-1);
    await expect(page.locator('[data-source="weave/moving"]')).toHaveCount(1);
    await expect(page.locator('[data-marker="weave/moving/base"]')).toHaveCount(
      1,
    );
    // The moving fiber is one whole circle in this safe view.
    const d = await page
      .locator('[data-source="weave/moving"]')
      .getAttribute("d");
    const xy = d!.match(/-?\d+(?:\.\d+)?/g)!;
    expect(xy.slice(0, 2)).toEqual(xy.slice(-2));
  }
  // A quarter turn from sample 2 is sample 5's fiber, drawn as moving.
  const quarter = await fiberAt(0.25);
  expect(quarter.parameter).toBeCloseTo((2 * Math.PI * 5) / 12, 12);
  // Both ends draw the selected sample's fiber, so the loop is seamless.
  for (const s of [0, 1]) {
    const c = await fiberAt(s);
    expect(c.movingSample).toBe(2);
    await expect(page.locator('[data-source="weave/moving"]')).toHaveCount(0);
  }
  await page.getByRole("button", { name: /^(Stop|Back to study)$/ }).click();
  await settle(page);
  expect((await meta(page)).config).toEqual(study.config);
  expect((await meta(page)).views).toEqual(study.views);
  // Looping playback passes the drawing check and plays.
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  // Editing during playback stops it and returns to the edited study,
  // never a new fiber with an old point.
  await page
    .getByRole("textbox", { name: "Central latitude α", exact: true })
    .fill("0.7");
  await settle(page);
  await expect(
    page.getByRole("button", { name: "Play animation", exact: true }),
  ).toBeVisible();
  const c = await correspondence(page);
  expect(c.base).toEqual(c.stereo);
  expect(c.stereo.movingSample).toBe(2);
  expect((await meta(page)).config.weave.alpha).toBe(0.7);
});

test("a pole latitude draws one circle and one point and keeps the selection", async ({
  page,
}) => {
  await open(page);
  await selectedField(page).fill("8");
  await settle(page);
  for (const alpha of ["0", "pi/2"]) {
    await page
      .getByRole("textbox", { name: "Central latitude α", exact: true })
      .fill(alpha);
    await settle(page);
    await expect(
      panel(page, "stereo").locator("path[data-sample]"),
    ).toHaveCount(1);
    await expect(
      panel(page, "stereo").locator('[data-source="weave/latitude/0/core"]'),
    ).toHaveAttribute("data-correspondence", "moving");
    await expect(panel(page, "base").locator("g[data-sample]")).toHaveCount(1);
    expect((await correspondence(page)).stereo).toMatchObject({
      selected: 7,
      coincident: true,
    });
    await expect(selectedField(page)).toHaveValue("8");
  }
});

test("switching views keeps each view's settings and motion", async ({
  page,
}) => {
  await open(page);
  const view = page.getByRole("combobox", {
    name: "View operation",
    exact: true,
  });
  const animate = page.getByRole("combobox", { name: "Animate", exact: true });
  await expect(animate).toHaveValue("trace");
  await view.selectOption("stereo");
  await settle(page);
  // Trace belongs to the paired view; the loom offers its own motions.
  await expect(animate).toHaveValue("double");
  await expect(panel(page, "base")).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Weave family", exact: true })
    .selectOption("tori");
  await settle(page);
  await view.selectOption("paired");
  await settle(page);
  // The correspondence draws fibers whatever the loom's family.
  expect((await correspondence(page)).stereo.fibers).toBe(12);
  await view.selectOption("stereo");
  await settle(page);
  await expect(
    page.getByRole("combobox", { name: "Weave family", exact: true }),
  ).toHaveValue("tori");
});

test("the still and a link carry both panes, both cameras and the selection", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page);
  await selectedField(page).fill("6");
  await settle(page);
  await panel(page, "stereo").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("+");
  await panel(page, "base").focus();
  await page.keyboard.press("ArrowUp");
  await settle(page);
  const live = await meta(page);
  const download = page.waitForEvent("download");
  await exportImage(page, "SVG");
  const svg = await readFile((await (await download).path())!, "utf8");
  // Base pane first, then the fibers, with the live metadata.
  expect(svg.indexOf('data-representation="base"')).toBeLessThan(
    svg.indexOf('data-representation="stereo"'),
  );
  expect(svg).toContain('viewBox="0 0 2000 760"');
  expect(svg).not.toMatch(/<text|<foreignObject/);
  const exported = JSON.parse(
    svg.match(/<desc>([^<]*)<\/desc>/)![1].replace(/&quot;/g, '"'),
  );
  expect(exported.views).toEqual(live.views);
  expect(exported.config).toEqual(live.config);
  // The link reopens the same study and cameras.
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  await page.goto("about:blank");
  await page.goto(url.replace(/^https?:\/\/[^/]+/, ""));
  await settle(page);
  await expect(selectedField(page)).toHaveValue("6");
  const reopened = await meta(page);
  expect(reopened.views).toEqual(live.views);
  expect(reopened.config).toEqual(live.config);
});

test("the accent and latitude inks follow the color scheme in drawing and legend", async ({
  page,
}) => {
  await open(page);
  for (const scheme of ["default", "cobalt"]) {
    if (scheme !== "default") {
      await chooseColorScheme(page, scheme);
      await settle(page);
    }
    const moving = await panel(page, "stereo")
      .locator('[data-correspondence="moving"]')
      .getAttribute("stroke");
    const sample = await panel(page, "stereo")
      .locator('[data-correspondence="sample"]')
      .first()
      .getAttribute("stroke");
    expect(moving).not.toBe(sample);
    const swatch = await page
      .locator(".tesseract-legend span, .tesseract-legend li")
      .filter({ hasText: "Moving point and its fiber" })
      .locator("i")
      .evaluate((i) => getComputedStyle(i).backgroundColor);
    const probe = await page.evaluate((c) => {
      const d = document.createElement("i");
      d.style.color = c!;
      document.body.append(d);
      const v = getComputedStyle(d).color;
      d.remove();
      return v;
    }, moving);
    expect(swatch, scheme).toBe(probe);
  }
});

test("the traced motion exports both panes with its duration and endpoints", async ({
  page,
}) => {
  test.slow();
  await open(page);
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill("1");
  // Live references at the progress of frames 0 and 6: a loop's frames sit
  // at i/15, leaving out the end, which is its start again.
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const references: number[][] = [];
  for (const s of [0, 0.4]) {
    await page
      .getByRole("slider", { name: "Animation progress" })
      .fill(String(s));
    await settle(page);
    references.push(await raster(page, 1000, 380));
  }
  await openShapeExport(page);
  await page
    .getByRole("combobox", { name: "Export format" })
    .selectOption("mp4");
  await page
    .getByRole("slider", { name: "Export resolution", exact: true })
    .fill("0.5");
  await page
    .getByRole("combobox", { name: "Export frame rate" })
    .selectOption("15");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Export MP4 video/ }).click();
  const path = (await (await download).path())!;
  const p = probe(path);
  // A loop leaves out its last frame, which is its first.
  if (p) {
    expect([p.width, p.height, p.frames]).toEqual([1000, 380, 15]);
    expect(p.durations.reduce((a, b) => a + b, 0)).toBe(1000);
  }
  expect((await decodeVideo(page, await readFile(path))).duration).toBeCloseTo(
    1,
    3,
  );
  for (const [k, index] of [0, 6].entries()) {
    const d = frameDifference(path, 1000, 380, index, references[k]);
    if (d) {
      expect(d.meanDifference).toBeLessThan(6);
      expect(d.unmatchedInk).toBeLessThan(0.02);
    }
  }
});

// The largest admitted correspondence, 32 fibers at 256 arc samples, every
// circle complete, through the worker, transport and both panes; a trace
// over it, stopped, keeps nothing of the motion. Times and heap are
// observations; the bounds are generous ceilings.
test("maximum correspondence sampling has bounded cost, matching counts and cancels", async ({
  page,
}) => {
  test.slow();
  await open(page);
  for (const name of [
    "xz angle",
    "yz angle",
    "xw angle",
    "yw angle",
    "zw angle",
  ])
    await page.getByRole("textbox", { name, exact: true }).fill("0");
  await page
    .getByRole("textbox", { name: "Projection window radius", exact: true })
    .fill("12");
  await settle(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.collectGarbage");
  const before = await cdp.send("Runtime.getHeapUsage");
  const start = Date.now();
  await page
    .getByRole("spinbutton", { name: "Arc samples", exact: true })
    .fill("256");
  await page
    .getByRole("spinbutton", { name: "Fibers on the latitude", exact: true })
    .fill("32");
  await settle(page);
  const elapsed = Date.now() - start;
  const m = await meta(page);
  const points = 32 * 257 + 3 * 257 + 257 + 3 * 257 + 32;
  expect(m.emittedPoints).toBe(points);
  expect(m.evaluations).toBe(points);
  expect((await desc(page, "stereo")).weave.completeCircles).toBe(32);
  await expect(panel(page, "stereo").locator("path[data-sample]")).toHaveCount(
    32,
  );
  await expect(panel(page, "base").locator("g[data-sample]")).toHaveCount(32);
  expect(elapsed).toBeLessThan(10_000);
  // Trace, then stop: the entered study returns, with no moving fiber.
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect(page.locator('[data-source="weave/moving"]')).toHaveCount(1);
  const stopAt = Date.now();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await settle(page);
  const stopped = Date.now() - stopAt;
  await expect(page.locator('[data-source="weave/moving"]')).toHaveCount(0);
  expect((await meta(page)).config).toEqual(m.config);
  expect(stopped).toBeLessThan(10_000);
  await cdp.send("HeapProfiler.collectGarbage");
  const after = await cdp.send("Runtime.getHeapUsage");
  console.log(
    `Correspondence maximum: ${elapsed} ms control-to-drawing; stop to entered study ${stopped} ms; ${((after.usedSize - before.usedSize) / 1024).toFixed(0)} KB retained main-page heap`,
  );
  expect(after.usedSize - before.usedSize).toBeLessThan(32 * 1024 * 1024);
});

// A quick scrub, faster than the engine, keeps redrawing as playback does,
// both panes from one result, and ends on the scrubbed position.
test("a quick scrub keeps redrawing and settles where it stops", async ({
  page,
}) => {
  await open(page);
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await settle(page);
  const { shown, last, flickered, found } = await page.evaluate(async () => {
    const slider = document.querySelector(
      'input[aria-label="Animation progress"]',
    ) as HTMLInputElement;
    const stage = document.querySelector(".tesseract-stage")!;
    const seen = new Set<string | null>();
    // What a scrub must leave alone, as in the 3D notebook: the header's
    // link and image buttons, and the drawing's Computing label.
    const buttons = ["Copy link", "Export image"].map(
      (name) =>
        [...document.querySelectorAll("header button")].find((b) =>
          b.textContent?.includes(name),
        ) as HTMLButtonElement,
    );
    let flickered = 0;
    const look = () => {
      seen.add(stage.getAttribute("data-config"));
      if (buttons.some((b) => b.disabled) || stage.querySelector(".computing"))
        flickered++;
    };
    const watch = new MutationObserver(look);
    watch.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ["data-config", "disabled"],
    });
    const set = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    let last = "0";
    for (let i = 0; i < 120; i++) {
      last = (0.5 + 0.45 * Math.sin(i / 8)).toFixed(3);
      set.call(slider, last);
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 16));
    }
    watch.disconnect();
    return { shown: seen.size, last, flickered, found: buttons.every(Boolean) };
  });
  // Before the scrub stops, the drawing has moved many times.
  expect(shown).toBeGreaterThan(10);
  expect(found).toBe(true);
  expect(flickered).toBe(0);
  await settle(page);
  const c = await correspondence(page);
  expect(c.base).toEqual(c.stereo);
  expect((await meta(page)).config.weave.trace).toBeCloseTo(Number(last), 12);
});

// The SVG's own background fills whatever page it is shown on, as the
// other notebooks' do, not only its viewBox.
for (const preset of ["A cube beyond a cube", name])
  test(`a dark SVG of ${preset} carries its background beyond the viewBox`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/?study=4d");
    await settle(page);
    await choosePreset(page, { label: preset });
    await settle(page);
    const download = page.waitForEvent("download");
    await exportImage(page, "SVG");
    const svg = await readFile((await (await download).path())!, "utf8");
    const root = svg.match(/^<svg[^>]*>/)![0];
    // Its page is the still's size, as a 3D export's is, so a viewer shows
    // the panels and nothing beyond them.
    expect(root).toContain(
      preset === name
        ? 'width="4000" height="1520"'
        : 'width="2000" height="1520"',
    );
    expect(root).toMatch(
      /style="[^"]*background(?:-color)?: ?(#0b1517|rgb\(11, 21, 23\))/,
    );
  });
