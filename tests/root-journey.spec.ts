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
const open = async (p: Page) => {
  await p.goto("/?study=4d");
  await settle(p);
  await choosePreset(p, { label: name });
  await settle(p);
};
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
  await expect(readout(page, "Turns of z")).toHaveText("1.000");
  await expect(readout(page, "Circuit")).toHaveText("2 of 2");
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
  await expect(readout(page, "Turns of z")).toHaveText("2.000");
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
    Math.sqrt(0.25 * 0.25 + 0.25).toPrecision(5),
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

test("a decoded looping movie matches direct seeks at 0, 2π and 4π", async ({
  page,
}) => {
  test.slow();
  await open(page);
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill("2");
  await playThenPause(page);
  const references: number[][] = [];
  for (const s of [0, 0.5, 1]) {
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
    `${name}: 2 s / 15 fps / 1000×380 MP4 saved in ${Date.now() - started} ms`,
  );
  const p = probe(path);
  // A loop leaves out its last frame, which is its first: 30 frames, with
  // frame 15 at t = 2π and frame 0 standing for both 0 and 4π.
  if (p) {
    expect([p.width, p.height, p.frames]).toEqual([1000, 380, 30]);
    expect(p.durations.reduce((a, b) => a + b, 0)).toBe(2000);
  }
  expect((await decodeVideo(page, await readFile(path))).duration).toBeCloseTo(
    2,
    3,
  );
  for (const [index, reference] of [
    [0, references[0]],
    [15, references[1]],
    [0, references[2]],
  ] as const) {
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
