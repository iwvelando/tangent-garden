import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { choosePreset, exportImage, openShapeExport } from "./helpers";
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
