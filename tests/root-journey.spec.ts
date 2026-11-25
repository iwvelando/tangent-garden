import { readout as formatNumber } from "../web/number-format";
import { rootAtlasPoints } from "../web/tesseract/atlas-pairs";
import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  chooseColorScheme,
  chooseNotebook,
  choosePreset,
  exportImage,
  openShapeExport,
} from "./helpers";
import { decodeVideo, frameDifference, probe } from "./video";

// The square-root journey (engine4/root.go): the z and w planes in one
// flat pane beside the lifted 4D path, all driven by one parameter t.
const name = "The second time around";
const stage = (p: Page) => p.locator(".tesseract-stage");
const settle = (p: Page) =>
  expect(stage(p)).toHaveAttribute("aria-busy", "false");
const panel = (p: Page, mode: "diagram" | "orthographic") =>
  p.locator(`svg[data-representation="${mode}"]`);
const desc = async (p: Page, mode: "diagram" | "orthographic") =>
  JSON.parse(
    (await panel(p, mode).locator(":scope > desc").textContent()) ?? "{}",
  );
const meta = async (p: Page) =>
  JSON.parse((await p.locator("#tesseract-artwork > desc").textContent())!);
const open = async (p: Page, label = name) => {
  await p.goto("/?study=4d");
  await settle(p);
  await choosePreset(p, { label });
  await settle(p);
};
const missing = "A loop that misses zero";
const enclosing = "Around an off-center branch point";
const five = "Five roots trading places";
const petals = "Five petals, one visited";
// A marker's center in its pane's 1000 × 760 units.
const at = async (p: Page, id: string) => {
  const c = p.locator(`[data-marker="${id}"]`);
  return [
    Number(await c.getAttribute("cx")),
    Number(await c.getAttribute("cy")),
  ];
};
const distance = (a: number[], b: number[]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);
const readout = (p: Page, label: string) =>
  p
    .locator(".lift-readout span")
    .filter({
      hasText: new RegExp(`^${label.replace(/[|()[\]\\.*+?^$]/g, "\\$&")}:`),
    })
    .locator("b");
const slider = (p: Page) =>
  p.getByRole("slider", { name: "Animation progress" });
const scrub = async (p: Page, s: number) => {
  await slider(p).fill(String(s));
  await settle(p);
};
const playThenPause = async (p: Page) => {
  await p.getByRole("button", { name: "Play animation", exact: true }).click();
  await p.getByRole("button", { name: "Pause", exact: true }).click();
};
// The artwork without metadata, as the loop check compares it.
const drawing = (p: Page) =>
  p
    .locator("#tesseract-artwork")
    .evaluate((e) =>
      e.outerHTML
        .replace(/<(title|desc)\b[^>]*>[\s\S]*?<\/\1>/g, "")
        .replace(/\s(?:data|aria)-[\w-]+="[^"]*"/g, ""),
    );
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

test("slow playback keeps one frame in flight and Stop discards its late reply", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 });
    const work = { active: 0, peak: 0, completed: 0 };
    (window as any).rootWork = work;
    const OriginalWorker = Worker;
    window.Worker = class extends OriginalWorker {
      private pendingFrames = new Set<number>();
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        // Count the reply before EngineClient resolves it: promise
        // continuations can run between message listeners.
        this.addEventListener("message", ({ data }) => {
          if (!this.pendingFrames.delete(data.id)) return;
          work.active--;
          work.completed++;
        });
      }
      override postMessage(q: any, ...rest: any[]) {
        if (q.action !== "tesseract" || q.tesseract?.root?.trace === undefined)
          return super.postMessage(q, ...rest);
        work.active++;
        work.peak = Math.max(work.peak, work.active);
        this.pendingFrames.add(q.id);
        setTimeout(() => super.postMessage(q, ...rest), 120);
      }
    };
  });
  await open(page);
  await page.getByRole("spinbutton", { name: "Path intervals" }).fill("4096");
  await settle(page);
  const base = await meta(page);
  const original = await drawing(page);
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).rootWork.completed))
    .toBeGreaterThanOrEqual(6);
  expect(await page.evaluate(() => (window as any).rootWork.peak)).toBe(1);
  await expect
    .poll(() => page.evaluate(() => (window as any).rootWork.active))
    .toBe(1);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).rootWork.active))
    .toBe(0);
  await settle(page);
  expect((await meta(page)).config).toEqual(base.config);
  expect(await drawing(page)).toBe(original);
});

test("the preset opens still at t = 0 with three linked views and no text in the artwork", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await expect(
    page.getByRole("button", { name: "Play animation", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".paired-view-labels span")).toHaveText([
    "1 / Source z · value w (left)",
    "2 / The path in 4D (right)",
  ]);
  await expect(readout(page, "Parameter t")).toHaveText("0.0000");
  await expect(readout(page, "Circuit")).toHaveText("1 of 2");
  await expect(
    page.locator("#tesseract-artwork text, #tesseract-artwork foreignObject"),
  ).toHaveCount(0);
  // Each view draws both whole circuits and a trace of one circuit.
  for (const view of ["source", "value", "lifted"])
    for (const id of ["circuit/1", "circuit/2", "trace/0"])
      await expect(
        page.locator(`[data-source="root/${view}/${id}"]`),
      ).toHaveCount(1);
  // At t = 0 the moving point sits on its start ring in every view.
  for (const view of ["source", "value", "lifted"])
    expect(
      distance(
        await at(page, `root/${view}/current`),
        await at(page, `root/${view}/start`),
      ),
    ).toBeLessThan(0.01);
  const lifted = await desc(page, "orthographic");
  expect(lifted.root.normBound).toBeCloseTo(Math.sqrt(1.6 * 1.6 + 1.6), 12);
  expect(lifted.root.residual).toBeLessThan(1e-12);
});

test("one circuit returns z but not w or the 4D point; two return everything", async ({
  page,
}) => {
  await open(page);
  const study = await meta(page);
  const start = await drawing(page);
  const status = await page.locator(".tesseract-diagnostics").textContent();
  await playThenPause(page);
  await scrub(page, 0.5);
  // The live summary does not change with the frame.
  await expect(page.locator(".tesseract-diagnostics")).toHaveText(status!);
  await expect(readout(page, "Parameter t")).toHaveText("6.2832");
  await expect(readout(page, "Turns of z")).toHaveText("1.00000");
  await expect(readout(page, "Circuit")).toHaveText("2 of 2");
  // z = 1.6 and w = −√1.6 lie on the real axis: an imaginary part that is
  // zero reads zero, not its rounding residue, in the columns every frame
  // of the journey keeps.
  expect(
    await Promise.all(
      ["Re z", "Im z", "Re w", "Im w"].map((label) =>
        readout(page, label).textContent(),
      ),
    ),
  ).toEqual(["\u20071.60000", "\u20070.00000", "−1.26491", "\u20070.00000"]);
  // The residual is a rounding-sized bound, not a six-figure measurement.
  await expect(readout(page, "Largest |w² − z|")).toHaveText(
    /^(0|\d(\.\d)?e−1\d)$/,
  );
  // z is home; w is opposite its start through the w plane's origin; the
  // 4D point is visibly elsewhere.
  expect(
    distance(
      await at(page, "root/source/current"),
      await at(page, "root/source/start"),
    ),
  ).toBeLessThan(0.01);
  const [w, w0, origin] = [
    await at(page, "root/value/current"),
    await at(page, "root/value/start"),
    await at(page, "root/value/branch-point"),
  ];
  expect(w[0] - origin[0]).toBeCloseTo(origin[0] - w0[0], 2);
  expect(w[1] - origin[1]).toBeCloseTo(origin[1] - w0[1], 2);
  expect(
    distance(
      await at(page, "root/lifted/current"),
      await at(page, "root/lifted/start"),
    ),
  ).toBeGreaterThan(80);
  // The trace at 2π is exactly the first circuit.
  const half = await desc(page, "orthographic");
  expect(half.root.parameter).toBe(2 * Math.PI);
  await expect(
    page.locator('[data-role="trace"][data-source^="root/lifted/"]'),
  ).toHaveCount(1);
  // Scrubbing backward and forward lands on the same frames.
  await scrub(page, 0.137);
  await scrub(page, 0.5);
  expect((await desc(page, "orthographic")).root).toEqual(half.root);
  // 4π draws exactly what 0 draws, in every pane.
  await scrub(page, 1);
  await expect(readout(page, "Turns of z")).toHaveText("2.00000");
  expect(await drawing(page)).toBe(start);
  await page.getByRole("button", { name: /^(Stop|Back to study)$/ }).click();
  await settle(page);
  expect((await meta(page)).config).toEqual(study.config);
  // The whole journey loops; a single circuit cannot.
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^(Stop|Back to study)$/ }).click();
  await page.getByText("Journey endpoints", { exact: true }).click();
  await page
    .getByRole("textbox", { name: "Trace end", exact: true })
    .fill("2*pi");
  await settle(page);
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect(page.locator(".animation-error")).toContainText(
    "Repeat can loop only motion that ends where it starts",
  );
});

test("reversed traversal, the other sheet and edited radii keep the relation; invalid values are refused by field", async ({
  page,
}) => {
  await open(page);
  await page
    .getByRole("combobox", { name: "Initial sheet", exact: true })
    .selectOption("minus");
  await settle(page);
  // w(0) = −√r: left of the w plane's origin.
  const [w0, origin] = [
    await at(page, "root/value/start"),
    await at(page, "root/value/branch-point"),
  ];
  expect(w0[0]).toBeLessThan(origin[0] - 50);
  await page.getByText("Journey endpoints", { exact: true }).click();
  await page
    .getByRole("textbox", { name: "Trace start", exact: true })
    .fill("4*pi");
  await page.getByRole("textbox", { name: "Trace end", exact: true }).fill("0");
  await page
    .getByRole("textbox", { name: "Radius r", exact: true })
    .fill("0.25");
  await settle(page);
  await expect(readout(page, "Norm |(z, w)|")).toHaveText(
    formatNumber(Math.sqrt(0.25 * 0.25 + 0.25)),
  );
  await playThenPause(page);
  await scrub(page, 0.25);
  const d = (await desc(page, "orthographic")).root;
  expect(d.parameter).toBeCloseTo(3 * Math.PI, 12);
  // Independent: w² = z at the moving point, read from the readout source.
  const [a, b] = d.w;
  expect(Math.hypot(a * a - b * b - d.z[0], 2 * a * b - d.z[1])).toBeLessThan(
    1e-14,
  );
  await page.getByRole("button", { name: /^(Stop|Back to study)$/ }).click();
  for (const [label, value, message, valid] of [
    ["Radius r", "5", "Radius r must be between 0.25 and 4", "0.25"],
    ["Trace end", "13", "Trace end must be between 0 and 4π", "0"],
  ]) {
    const field = page.getByRole("textbox", { name: label, exact: true });
    await field.fill(value);
    await settle(page);
    await expect(page.locator(".stale-study")).toBeVisible();
    // The error is announced with the field that caused it.
    await expect(field).toHaveAccessibleDescription(new RegExp(message));
    await field.fill(valid);
    await settle(page);
    await expect(page.locator(".stale-study")).toHaveCount(0);
  }
});

test("camera buttons turn only the 4D pane; the planes stay flat", async ({
  page,
}) => {
  await open(page);
  const before = (await meta(page)).views;
  await page.getByRole("button", { name: "Top", exact: true }).click();
  await settle(page);
  const after = (await meta(page)).views;
  expect(after[0]).toEqual(before[0]);
  expect(after[1]).not.toEqual(before[1]);
  await expect(
    page.getByRole("button", { name: "Rotate view", exact: true }),
  ).toBeEnabled();
});

test("the still and a link carry both panes and cameras", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page);
  await page
    .getByRole("combobox", { name: "Initial sheet", exact: true })
    .selectOption("minus");
  await settle(page);
  await panel(page, "orthographic").focus();
  await page.keyboard.press("ArrowRight");
  await settle(page);
  const live = await meta(page);
  const download = page.waitForEvent("download");
  await exportImage(page, "SVG");
  const svg = await readFile((await (await download).path())!, "utf8");
  expect(svg.indexOf('data-representation="diagram"')).toBeLessThan(
    svg.indexOf('data-representation="orthographic"'),
  );
  expect(svg).not.toMatch(/<text|<foreignObject/);
  const exported = JSON.parse(
    svg.match(/<desc>([^<]*)<\/desc>/)![1].replace(/&quot;/g, '"'),
  );
  expect(exported.views).toEqual(live.views);
  expect(exported.config).toEqual(live.config);
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  await page.goto("about:blank");
  await page.goto(url.replace(/^https?:\/\/[^/]+/, ""));
  await settle(page);
  const reopened = await meta(page);
  expect(reopened.config).toEqual(live.config);
  expect(reopened.views).toEqual(live.views);
});

// Each movie is 2 s at 15 fps: 30 frames, the repeated last left out. The
// square roots are checked at 0, 2π and 4π (frames 0, 15 and 0 again); the
// fifth root at 0, its first and third circuit boundaries, 2π and 6π
// (frames 6 and 18), and 10π.
for (const [study, seeks] of [
  [name, [0, 0.5, 1]],
  [missing, [0, 0.5, 1]],
  [five, [0, 0.2, 0.6, 1]],
] as const)
  test(`${study}: a decoded looping movie matches direct seeks at its start, circuit boundaries and end`, async ({
    page,
  }) => {
    test.slow();
    await open(page, study);
    await page
      .getByRole("spinbutton", { name: "Duration (seconds)" })
      .fill("2");
    await playThenPause(page);
    const references: number[][] = [];
    for (const s of seeks) {
      await scrub(page, s);
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
    const started = Date.now();
    await page.getByRole("button", { name: /^Export MP4 video/ }).click();
    const path = (await (await download).path())!;
    console.log(
      `${study}: 2 s / 15 fps / 1000×380 MP4 saved in ${Date.now() - started} ms`,
    );
    const p = probe(path);
    // A loop leaves out its last frame, which is its first: 30 frames, with
    // frame 15 at t = 2π and frame 0 standing for both 0 and 4π.
    if (p) {
      expect([p.width, p.height, p.frames]).toEqual([1000, 380, 30]);
      expect(p.durations.reduce((a, b) => a + b, 0)).toBe(2000);
    }
    expect(
      (await decodeVideo(page, await readFile(path))).duration,
    ).toBeCloseTo(2, 3);
    for (const [index, reference] of seeks.map(
      (s, i) => [Math.round(s * 30) % 30, references[i]] as const,
    )) {
      const d = frameDifference(path, 1000, 380, index, reference);
      if (d) {
        expect(d.meanDifference).toBeLessThan(6);
        expect(d.unmatchedInk).toBeLessThan(0.02);
      }
    }
  });

// Slow replies to the study's own requests (not playback frames). While
// `holdRoot` is set, requests wait in `heldRoot` until `releaseRoot()`, so a
// test can act while a request is certainly outstanding.
const slowStudy = (page: Page, delay: number) =>
  page.addInitScript((delay) => {
    const send = Worker.prototype.postMessage;
    const w = window as any;
    w.slowRoot = 0;
    w.holdRoot = false;
    w.heldRoot = [];
    w.releaseRoot = () => {
      w.holdRoot = false;
      for (const held of w.heldRoot.splice(0)) held.send();
    };
    Worker.prototype.postMessage = function (q: any, ...rest: any[]) {
      if (q.action === "tesseract" && q.tesseract?.object === "root") {
        w.slowRoot++;
        const go = () => send.call(this, q, ...rest);
        if (w.holdRoot)
          w.heldRoot.push({ radius: q.tesseract.root?.radius, send: go });
        else setTimeout(go, delay);
      } else return send.call(this, q, ...rest);
    };
  }, delay);
// The radius the drawn 4D pane was computed for, from its norm bound.
const drawnRadius = async (p: Page) => {
  const n = (await desc(p, "orthographic")).root.normBound;
  return (-1 + Math.sqrt(1 + 4 * n * n)) / 2;
};

test("slow replies never show an older edit, an example chosen meanwhile wins, and switching back restores the edited study", async ({
  page,
}) => {
  await slowStudy(page, 250);
  await open(page);
  const radius = page.getByRole("textbox", { name: "Radius r", exact: true });
  // Two edits while the first is still computing: only the second is drawn.
  await radius.fill("2");
  await expect
    .poll(() => page.evaluate(() => (window as any).slowRoot))
    .toBeGreaterThan(1);
  await radius.fill("3");
  await settle(page);
  expect((await meta(page)).config.root.radius).toBe(3);
  expect(await drawnRadius(page)).toBeCloseTo(3, 12);
  await page
    .getByRole("combobox", { name: "Initial sheet", exact: true })
    .selectOption("minus");
  await settle(page);
  const edited = await meta(page);
  // An example chosen while an edit computes replaces the whole study, and
  // the late reply is discarded. The edit's request is held until the
  // example is chosen, so its reply is certainly late.
  await page.evaluate(() => ((window as any).holdRoot = true));
  await radius.fill("1.2");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).heldRoot.map((h: { radius: number }) => h.radius),
      ),
    )
    .toContain(1.2);
  await choosePreset(page, { label: "A cube beyond a cube" });
  await page.evaluate(() => (window as any).releaseRoot());
  await settle(page);
  await page.waitForTimeout(500);
  await settle(page);
  expect((await meta(page)).config.object).toBe("tesseract");
  await expect(panel(page, "orthographic")).toHaveCount(0);
  // Choosing the object again restores the last study it drew.
  await page
    .getByRole("combobox", { name: "4D object", exact: true })
    .selectOption("root");
  await settle(page);
  expect((await meta(page)).config).toEqual(edited.config);
  expect(await drawnRadius(page)).toBeCloseTo(3, 12);
  await expect(
    page.getByRole("combobox", { name: "Initial sheet", exact: true }),
  ).toHaveValue("minus");
  // Entered from another object with no saved study, it opens its defaults.
  await page.goto("/?study=4d");
  await settle(page);
  await page
    .getByRole("combobox", { name: "4D object", exact: true })
    .selectOption("root");
  await settle(page);
  expect((await meta(page)).config.root).toEqual({
    radius: 1.6,
    sheet: "plus",
    from: 0,
    to: 4 * Math.PI,
  });
  await expect(page.locator(".stale-study")).toHaveCount(0);
});

test("cancel, an edit or leaving the notebook discards a movie export and keeps the study", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("spinbutton", { name: "Path intervals" }).fill("4096");
  await settle(page);
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill("8");
  const entered = await meta(page);
  let downloads = 0;
  page.on("download", () => downloads++);
  await openShapeExport(page);
  for (const action of ["cancel", "edit", "switch"]) {
    await page
      .getByRole("button", { name: /^Export (MP4 video|animated WebP)/ })
      .click();
    await expect(
      page.getByRole("button", { name: "Cancel export", exact: true }),
    ).toBeVisible();
    if (action === "cancel")
      await page
        .getByRole("button", { name: "Cancel export", exact: true })
        .click();
    else if (action === "edit")
      await page
        .getByRole("textbox", { name: "Radius r", exact: true })
        .fill("2");
    else {
      await chooseNotebook(page, "2d");
      await chooseNotebook(page, "4d");
    }
    await expect(
      page.getByRole("button", { name: "Cancel export", exact: true }),
    ).toHaveCount(0);
    await settle(page);
  }
  expect(downloads).toBe(0);
  expect((await meta(page)).config).toEqual({
    ...entered.config,
    root: { ...entered.config.root, radius: 2 },
  });
  expect(await drawnRadius(page)).toBeCloseTo(2, 12);
});

test("keys pan the planes in pane 1 and orbit the 4D path in pane 2, each alone", async ({
  page,
}) => {
  await open(page);
  const views = async () => (await meta(page)).views;
  const [plane, lifted] = await views();
  await panel(page, "diagram").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("+");
  await settle(page);
  let [p, l] = await views();
  expect(p.view.panX).not.toBe(plane.view.panX);
  expect(p.view.zoom).toBeGreaterThan(plane.view.zoom);
  expect(p.view.yaw).toBe(plane.view.yaw);
  expect(l.view).toEqual(lifted.view);
  await panel(page, "orthographic").focus();
  await page.keyboard.press("ArrowRight");
  await settle(page);
  [p, l] = await views();
  expect(l.view.yaw).not.toBe(lifted.view.yaw);
  expect(l.view.panX).toBe(lifted.view.panX);
  await page.keyboard.press("Home");
  await settle(page);
  expect((await views())[1].view).toEqual(lifted.view);
  expect((await views())[0].view).toEqual(p.view);
});

test("circuit, accent and guide inks follow the color scheme in drawing, legend and export", async ({
  page,
}) => {
  await open(page);
  const stroke = (source: string) =>
    page.locator(`[data-source="${source}"]`).getAttribute("stroke");
  const css = (c: string) =>
    page.evaluate((c) => {
      const d = document.createElement("i");
      d.style.color = c;
      document.body.append(d);
      const v = getComputedStyle(d).color;
      d.remove();
      return v;
    }, c);
  const swatch = (text: string) =>
    page
      .locator(".tesseract-legend span, .tesseract-legend li")
      .filter({ hasText: text })
      .locator("i")
      .evaluate((i) => getComputedStyle(i).backgroundColor);
  const seen = new Set<string>();
  for (const scheme of ["default", "cobalt", "plum", "forest"]) {
    if (scheme !== "default") {
      await chooseColorScheme(page, scheme);
      await settle(page);
    }
    const inks = {
      first: (await stroke("root/lifted/circuit/1"))!,
      second: (await stroke("root/lifted/circuit/2"))!,
      guide: (await stroke("root/source/axis/re"))!,
      current: (await page
        .locator('[data-marker="root/lifted/current"]')
        .getAttribute("fill"))!,
    };
    // Four distinct roles in every scheme, and the same ink in each view.
    expect(new Set(Object.values(inks)).size, scheme).toBe(4);
    expect(await stroke("root/source/circuit/1")).toBe(inks.first);
    expect(await stroke("root/value/circuit/2")).toBe(inks.second);
    expect(await swatch("First circuit")).toBe(await css(inks.first));
    expect(await swatch("Second circuit")).toBe(await css(inks.second));
    expect(await swatch("Axes, branch point")).toBe(await css(inks.guide));
    expect(await swatch("Moving point")).toBe(await css(inks.current));
    seen.add(inks.first);
    if (scheme === "plum") {
      const download = page.waitForEvent("download");
      await exportImage(page, "SVG");
      const svg = await readFile((await (await download).path())!, "utf8");
      for (const ink of Object.values(inks)) expect(svg).toContain(ink);
    }
  }
  expect(seen.size).toBe(4);
});

// Translated source circles: z = r e^{iφ}(k + e^{it}) about c = k r e^{iφ}.
test("a circle that misses zero returns after one circuit and draws the other root's loop; enclosing it again exchanges the sheets", async ({
  page,
}) => {
  await open(page, missing);
  await expect(
    page.locator("#tesseract-artwork text, #tesseract-artwork foreignObject"),
  ).toHaveCount(0);
  await expect(readout(page, "Winding about 0")).toHaveText(
    "0: w returns each circuit",
  );
  await expect(readout(page, "Closest |z|")).toHaveText(
    formatNumber(1.2 * 0.1),
  );
  // The unvisited sheet's loop is a guide in the w plane and the 4D view;
  // the z plane has one circle for both sheets.
  for (const view of ["value", "lifted"])
    await expect(
      page.locator(`[data-source="root/${view}/other-sheet"]`),
    ).toHaveCount(1);
  await expect(
    page.locator('[data-source="root/source/other-sheet"]'),
  ).toHaveCount(0);
  const d0 = (await desc(page, "orthographic")).root;
  expect([d0.winding, d0.offset]).toEqual([0, 1.1]);
  expect(d0.refined).toBeGreaterThan(d0.intervals);
  await expect(page.locator(".tesseract-diagnostics")).toContainText(
    "after refinement near the branch point",
  );
  const start = await drawing(page);
  await playThenPause(page);
  await scrub(page, 0.5);
  // One circuit: z, w and the 4D point are all home.
  await expect(readout(page, "Circuit")).toHaveText("2 of 2");
  for (const view of ["source", "value", "lifted"])
    expect(
      distance(
        await at(page, `root/${view}/current`),
        await at(page, `root/${view}/start`),
      ),
    ).toBeLessThan(0.01);
  // The moving point's |(z, w)| moves within the framing bound.
  const half = (await desc(page, "orthographic")).root;
  expect(half.norm).toBeLessThanOrEqual(half.normBound);
  await scrub(page, 1);
  expect(await drawing(page)).toBe(start);
  await page.getByRole("button", { name: /^(Stop|Back to study)$/ }).click();
  await settle(page);
  // A single circuit returns every point but not the trace's circuit, so
  // it cannot loop either.
  await page.getByText("Journey endpoints", { exact: true }).click();
  await page
    .getByRole("textbox", { name: "Trace end", exact: true })
    .fill("2*pi");
  await settle(page);
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect(page.locator(".animation-error")).toContainText(
    "Repeat can loop only motion that ends where it starts",
  );
  await page
    .getByRole("textbox", { name: "Trace end", exact: true })
    .fill("4*pi");
  // Below 1 the circle encloses zero: the guide goes, and one circuit
  // leaves w opposite its start.
  await page
    .getByRole("textbox", { name: "Center offset", exact: true })
    .fill("0.8");
  await settle(page);
  await expect(readout(page, "Winding about 0")).toHaveText(
    "1: w changes sheet each circuit",
  );
  await expect(page.locator('[data-role="other-sheet"]')).toHaveCount(0);
  await playThenPause(page);
  await scrub(page, 0.5);
  const [w, w0, origin] = [
    await at(page, "root/value/current"),
    await at(page, "root/value/start"),
    await at(page, "root/value/branch-point"),
  ];
  expect(w[0] - origin[0]).toBeCloseTo(origin[0] - w0[0], 2);
  expect(w[1] - origin[1]).toBeCloseTo(origin[1] - w0[1], 2);
  const d = (await desc(page, "orthographic")).root;
  const [a, b] = d.w;
  expect(Math.hypot(a * a - b * b - d.z[0], 2 * a * b - d.z[1])).toBeLessThan(
    1e-14,
  );
});

test("the off-center example encloses zero, and the center fields refuse a pass too near the branch point by field", async ({
  page,
}) => {
  await open(page, enclosing);
  await expect(readout(page, "Winding about 0")).toHaveText(
    "1: w changes sheet each circuit",
  );
  const d = (await desc(page, "orthographic")).root;
  expect(d.closest).toBeCloseTo(1.4 * 0.15, 14);
  expect(d.normBound).toBeCloseTo(Math.sqrt(1.4 * 1.85 * (1.4 * 1.85 + 1)), 12);
  expect(d.residual).toBeLessThan(1e-12);
  await expect(page.locator('[data-role="other-sheet"]')).toHaveCount(0);
  for (const [label, value, message, valid] of [
    [
      "Center offset",
      "1.02",
      "Center offset must stay at least 0.05 from 1",
      "0.95",
    ],
    ["Center offset", "3.5", "Center offset must be between 0 and 3", "3"],
    [
      "Center direction",
      "7",
      "Center direction must be between −2π and 2π",
      "-2*pi",
    ],
  ]) {
    const field = page.getByRole("textbox", { name: label, exact: true });
    await field.fill(value);
    await settle(page);
    await expect(page.locator(".stale-study")).toBeVisible();
    await expect(field).toHaveAccessibleDescription(new RegExp(message));
    await field.fill(valid);
    await settle(page);
    await expect(page.locator(".stale-study")).toHaveCount(0);
  }
  // The band's edge is admitted and refined.
  const edge = (await desc(page, "orthographic")).root;
  expect([edge.offset, edge.winding]).toEqual([3, 0]);
});

test("the other root's loop takes the guide ink in drawing, legend and export", async ({
  page,
}) => {
  await open(page, missing);
  await chooseColorScheme(page, "cobalt");
  await settle(page);
  const guide = await page
    .locator('[data-source="root/source/axis/re"]')
    .getAttribute("stroke");
  for (const view of ["value", "lifted"])
    expect(
      await page
        .locator(`[data-source="root/${view}/other-sheet"]`)
        .getAttribute("stroke"),
    ).toBe(guide);
  const swatch = await page
    .locator(".tesseract-legend span, .tesseract-legend li")
    .filter({ hasText: "the other root's loop" })
    .locator("i")
    .evaluate((i) => getComputedStyle(i).backgroundColor);
  const css = await page.evaluate((c) => {
    const d = document.createElement("i");
    d.style.color = c;
    document.body.append(d);
    const v = getComputedStyle(d).color;
    d.remove();
    return v;
  }, guide!);
  expect(swatch).toBe(css);
  const download = page.waitForEvent("download");
  await exportImage(page, "SVG");
  const svg = await readFile((await (await download).path())!, "utf8");
  expect(svg).toContain('data-source="root/lifted/other-sheet"');
  expect(svg).not.toMatch(/<text|<foreignObject/);
});

// The atlas reserves each cell's points before asking the engine, so the
// reservation must cover the refined grid near the branch point.
test("the atlas reservation covers every refined journey's returned points", async ({
  page,
}) => {
  test.slow();
  await open(page, enclosing);
  for (const degree of ["2", "3", "6"])
    for (const [offset, samples] of [
      ["0.95", "4096"],
      ["1.05", "4096"],
      ["0.6", "64"],
      ["3", "1000"],
      ["0", "4096"],
    ]) {
      await page
        .getByRole("combobox", { name: "Degree n", exact: true })
        .selectOption(degree);
      await page
        .getByRole("textbox", { name: "Center offset", exact: true })
        .fill(offset);
      await page
        .getByRole("spinbutton", { name: "Path intervals" })
        .fill(samples);
      await settle(page);
      const m = await meta(page);
      expect(m.config.root.degree ?? 2).toBe(Number(degree));
      expect(m.config.root.offset).toBe(Number(offset));
      expect(m.config.samples).toBe(Number(samples));
      expect(m.emittedPoints).toBeGreaterThan(0);
      expect(
        m.emittedPoints,
        `degree ${degree}, ${offset} at ${samples}`,
      ).toBeLessThanOrEqual(rootAtlasPoints(m.config));
    }
});

// Roots of degree n: w⁵ = z over five circuits, 0 ≤ t ≤ 10π.
// A drawn marker's position about its plane's origin, as an angle and a
// length in the pane's units (y down).
const polar = async (p: Page, plane: "source" | "value") => {
  const [x, y] = await at(p, `root/${plane}/current`);
  const [ox, oy] = await at(p, `root/${plane}/branch-point`);
  return [Math.atan2(-(y - oy), x - ox), Math.hypot(x - ox, y - oy)];
};
const turn = (a: number, b: number) => {
  const d = (((b - a) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI);
  return d - Math.PI;
};

test("five roots trade places: each circuit moves w to the next root and only the fifth brings it home", async ({
  page,
}) => {
  await open(page, five);
  await playThenPause(page);
  await scrub(page, 0);
  const first = await drawing(page);
  const [z0, zr] = await polar(page, "source");
  const [w0, wr] = await polar(page, "value");
  await expect(readout(page, "Winding about 0")).toHaveText(
    "1: w moves to the next root",
  );
  await expect(readout(page, "w as a root of z")).toHaveText("⁵√z (principal)");
  for (let k = 1; k <= 5; k++) {
    await scrub(page, k / 5);
    // z is home after every circuit; w has turned by k fifths of a turn
    // about 0, at the same distance, and is home only after the fifth.
    const [z, r] = await polar(page, "source");
    const [w, s] = await polar(page, "value");
    expect(Math.abs(turn(z0, z)), `z after ${k}`).toBeLessThan(0.02);
    expect(Math.abs(r - zr)).toBeLessThan(0.5);
    expect(Math.abs(s - wr)).toBeLessThan(0.5);
    const want = turn(0, (2 * Math.PI * k) / 5);
    expect(Math.abs(turn(want, turn(w0, w))), `w after ${k}`).toBeLessThan(
      0.02,
    );
    await expect(readout(page, "Circuit")).toHaveText(
      `${k === 5 ? 1 : k + 1} of 5`,
    );
  }
  // The whole 10π journey ends on the drawing it starts with.
  expect(await drawing(page)).toBe(first);
  // Each circuit has one path in each view, and five distinct inks.
  const inks = new Set<string>();
  for (let k = 1; k <= 5; k++) {
    const stroke = await page
      .locator(`[data-source="root/lifted/circuit/${k}"]`)
      .getAttribute("stroke");
    expect(
      await page
        .locator(`[data-source="root/value/circuit/${k}"]`)
        .getAttribute("stroke"),
    ).toBe(stroke);
    inks.add(stroke!);
  }
  expect(inks.size).toBe(5);
  await expect(
    page.locator('[data-source="root/lifted/circuit/6"]'),
  ).toHaveCount(0);
  await expect(page.locator(".tesseract-legend")).toContainText("Circuit 5");
});

test("a fifth root past zero keeps to one petal, home after every circuit, beside the other four", async ({
  page,
}) => {
  await open(page, petals);
  await playThenPause(page);
  await scrub(page, 0);
  const [w0] = await polar(page, "value");
  for (const k of [1, 3]) {
    await scrub(page, k / 5);
    const [w] = await polar(page, "value");
    expect(Math.abs(turn(w0, w)), `w after ${k}`).toBeLessThan(0.02);
  }
  await expect(readout(page, "Winding about 0")).toHaveText(
    "0: w returns each circuit",
  );
  for (let m = 1; m < 5; m++)
    await expect(
      page.locator(`[data-source="root/value/other-sheet/${m}"]`),
    ).toHaveAttribute("stroke-dasharray", /\d/);
  await expect(
    page.locator('[data-source="root/value/other-sheet/5"]'),
  ).toHaveCount(0);
});

test("the degree scales the journey's endpoints and keeps the sheet while it is a root; a link carries both", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page);
  const degree = page.getByRole("combobox", { name: "Degree n", exact: true });
  const sheet = page.getByRole("combobox", {
    name: "Initial sheet",
    exact: true,
  });
  const root = async () => (await meta(page)).config.root;
  await sheet.selectOption("minus");
  await degree.selectOption("5");
  await settle(page);
  // −√z(0) was the square root's second sheet, ω: the fifth root keeps it.
  await expect(sheet).toHaveValue("1");
  await expect(sheet.locator("option:checked")).toHaveText("w(0) = ω ⁵√z(0)");
  await expect(sheet.locator("option")).toHaveCount(5);
  expect(await root()).toMatchObject({
    degree: 5,
    sheet: "plus",
    branch: 1,
    from: 0,
    to: 10 * Math.PI,
  });
  await degree.selectOption("3");
  await settle(page);
  // The drawn start turns a third of a turn about 0 from sheet ω to ω².
  const [before] = await polar(page, "value");
  await sheet.selectOption("2");
  await settle(page);
  expect(await root()).toMatchObject({ degree: 3, branch: 2, to: 6 * Math.PI });
  const [after] = await polar(page, "value");
  expect(Math.abs(turn(turn(before, after), (2 * Math.PI) / 3))).toBeLessThan(
    0.02,
  );
  await expect(readout(page, "Circuit")).toHaveText("1 of 3");
  // Back to the square root: ω² is not one of its sheets, so w starts on
  // the principal root, and the study is written as square roots were.
  await degree.selectOption("2");
  await settle(page);
  const square = await root();
  expect(square).toMatchObject({ sheet: "plus", from: 0, to: 4 * Math.PI });
  expect("degree" in square || "branch" in square).toBe(false);
  await expect(sheet).toHaveValue("plus");
  // A partial journey keeps its share of the whole.
  await page.getByText("Journey endpoints", { exact: true }).click();
  await page
    .getByRole("textbox", { name: "Trace start", exact: true })
    .fill("1");
  await page
    .getByRole("textbox", { name: "Trace end", exact: true })
    .fill("2*pi");
  await settle(page);
  await degree.selectOption("4");
  await settle(page);
  expect(await root()).toMatchObject({ degree: 4, from: 2, to: 4 * Math.PI });
  await sheet.selectOption("3");
  await settle(page);
  const live = await meta(page);
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  await page.goto("about:blank");
  await page.goto(url.replace(/^https?:\/\/[^/]+/, ""));
  await settle(page);
  expect((await meta(page)).config).toEqual(live.config);
  await expect(sheet).toHaveValue("3");
  await expect(degree).toHaveValue("4");
});

// The degree scales the endpoints from the study, so an endpoint the parser
// is still resolving lands first and is scaled with the other.
test("a new degree scales an endpoint whose evaluation is still pending", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Native = window.Worker;
    window.Worker = class extends Native {
      postMessage(data: any) {
        if ((window as any).holdScalar && data.action === "scalars") {
          (window as any).pendingScalar = true;
          setTimeout(() => super.postMessage(data), 500);
        } else super.postMessage(data);
      }
    } as any;
  });
  await open(page);
  const degree = page.getByRole("combobox", { name: "Degree n", exact: true });
  await degree.selectOption("3");
  await settle(page);
  await page.getByText("Journey endpoints", { exact: true }).click();
  await page.evaluate(() => ((window as any).holdScalar = true));
  // Half of the cube root's 6π journey, still resolving when the degree
  // changes: the sixth root's half is 6π.
  await page
    .getByRole("textbox", { name: "Trace end", exact: true })
    .fill("3*pi");
  await expect
    .poll(() => page.evaluate(() => (window as any).pendingScalar))
    .toBe(true);
  await degree.selectOption("6");
  await page.waitForTimeout(700);
  await settle(page);
  expect((await meta(page)).config.root).toMatchObject({
    degree: 6,
    from: 0,
    to: 6 * Math.PI,
  });
  // An example chosen while the degree waits replaces the study whole.
  await page.evaluate(() => ((window as any).pendingScalar = false));
  await page
    .getByRole("textbox", { name: "Trace end", exact: true })
    .fill("4*pi");
  await expect
    .poll(() => page.evaluate(() => (window as any).pendingScalar))
    .toBe(true);
  await degree.selectOption("4");
  await choosePreset(page, { label: five });
  await settle(page);
  const opened = (await meta(page)).config;
  await page.waitForTimeout(700);
  await settle(page);
  expect((await meta(page)).config).toEqual(opened);
  expect(opened.root).toMatchObject({ degree: 5, to: 10 * Math.PI });
});

test("a higher root's circuit inks follow the color scheme in drawing, legend and export", async ({
  page,
}) => {
  await open(page, five);
  const stroke = (source: string) =>
    page.locator(`[data-source="${source}"]`).getAttribute("stroke");
  const css = (c: string) =>
    page.evaluate((c) => {
      const d = document.createElement("i");
      d.style.color = c;
      document.body.append(d);
      const v = getComputedStyle(d).color;
      d.remove();
      return v;
    }, c);
  const swatch = (text: string) =>
    page
      .locator(".tesseract-legend span, .tesseract-legend li")
      .filter({ hasText: text })
      .locator("i")
      .evaluate((i) => getComputedStyle(i).backgroundColor);
  const firsts = new Set<string>();
  for (const scheme of ["default", "cobalt", "plum", "forest"]) {
    if (scheme !== "default") {
      await chooseColorScheme(page, scheme);
      await settle(page);
    }
    const circuits: string[] = [];
    for (let k = 1; k <= 5; k++) {
      const ink = (await stroke(`root/lifted/circuit/${k}`))!;
      expect(await stroke(`root/source/circuit/${k}`)).toBe(ink);
      expect(await swatch(`Circuit ${k}`)).toBe(await css(ink));
      circuits.push(ink);
    }
    const guide = (await stroke("root/source/axis/re"))!;
    const current = (await page
      .locator('[data-marker="root/lifted/current"]')
      .getAttribute("fill"))!;
    // Seven distinct roles in every scheme: five circuits, the guides and
    // the moving point.
    expect(new Set([...circuits, guide, current]).size, scheme).toBe(7);
    // The trace takes its circuit's ink: at t = 0 it is the fifth circuit.
    expect(await stroke("root/lifted/trace/0")).toBe(circuits[4]);
    firsts.add(circuits[0]);
    if (scheme === "plum") {
      const download = page.waitForEvent("download");
      await exportImage(page, "SVG");
      const svg = await readFile((await (await download).path())!, "utf8");
      for (const ink of [...circuits, guide, current])
        expect(svg).toContain(ink);
    }
  }
  expect(firsts.size).toBe(4);
});
