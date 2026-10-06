import { test, expect, type Page } from "@playwright/test";
import { deflateRawSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { choosePreset, openAnimation, openExportSettings } from "./helpers";
import { decodeVideo } from "./video";
import { engines, watchEngines } from "./engines";
import { presets } from "../web/presets";

// The 2D probe between samples: Go describes the base curve and its
// construction at the probe's own t (engine/probe.go), drawn and read out
// beside the drawing. Expectations are closed forms evaluated here.

const art = (page: Page) => page.locator("#artwork");
const ready = (page: Page) =>
  expect(page.locator(".plot-wrap")).toHaveAttribute("aria-busy", "false");
const probeSwitch = (page: Page) =>
  page.getByRole("checkbox", {
    name: "Tangent, normal & curvature at a point",
  });
const betweenSwitch = (page: Page) =>
  page.getByRole("checkbox", {
    name: "At any t, between samples",
    exact: true,
  });
const point = (page: Page) =>
  page.getByRole("slider", { name: "Point", exact: true });
const value = (page: Page, term: string) =>
  page
    .locator(".probe-readout dt", { hasText: term })
    .locator("xpath=following-sibling::dd[1]");
const drawn = (page: Page, id: string) => art(page).getByTestId(id);
const short = (v: number) => String(Number(v.toPrecision(4)));
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
const probeT = async (page: Page) =>
  Number(await drawn(page, "probe").getAttribute("data-t"));

async function onPage(page: Page, p: { x: number; y: number }) {
  const scale = Number(await art(page).getAttribute("data-camera-scale"));
  const [cx, cy] = (await art(page).getAttribute("data-camera-center"))!
    .split(",")
    .map(Number);
  return { x: 500 + (p.x - cx) * scale, y: 380 - (p.y - cy) * scale, scale };
}
const attr = async (page: Page, id: string, name: string) =>
  Number(await drawn(page, id).getAttribute(name));

const linkTo = (study: unknown) =>
  `/#s=${deflateRawSync(
    Buffer.from(JSON.stringify({ v: 1, notebook: "2d", study })),
  ).toString("base64url")}`;
async function open(
  page: Page,
  config: object,
  position: number,
  extra: object = {},
) {
  await page.goto(
    linkTo({
      config: { ...presets[0].config, ...config },
      bounds: { min: "0", max: "2*pi" },
      probe: { enabled: true, position, between: true },
      ...extra,
    }),
  );
  await ready(page);
}

// The opening ellipse (2 cos t, 3 sin t), sampled 1000 times over a turn;
// position 0.123456 is t ≈ 0.7757, a third of the way from sample 123 to
// sample 124.
const a = 2,
  b = 3,
  n = presets[0].config.samples - 1,
  position = 0.123456;
const ellipse = (t: number) => {
  const s = Math.sin(t),
    c = Math.cos(t);
  return {
    point: { x: a * c, y: b * s },
    kappa: (a * b) / (a * a * s * s + b * b * c * c) ** 1.5,
    center: {
      x: ((a * a - b * b) / a) * c ** 3,
      y: ((b * b - a * a) / b) * s ** 3,
    },
    tangent: { x: -a * s, y: b * c },
  };
};
// The ellipse's arc length from 0 to t, by the midpoint rule.
const arc = (t: number) => {
  let s = 0;
  const m = 100000;
  for (let k = 0; k < m; k++) {
    const u = (t * (k + 0.5)) / m;
    s += Math.hypot(a * Math.sin(u), b * Math.cos(u)) * (t / m);
  }
  return s;
};

test("between samples, the probe reads and draws the ellipse at its own t", async ({
  page,
}) => {
  await open(page, {}, position);
  await expect(betweenSwitch(page)).toBeChecked();
  const t = 2 * Math.PI * position;
  expect((position * n) % 1).toBeCloseTo(1 / 3, 2);
  await expect(drawn(page, "probe")).toHaveAttribute("data-t", String(t));
  await expect(drawn(page, "probe")).not.toHaveAttribute("data-sample", /./);
  await expect(point(page)).toHaveAttribute(
    "aria-valuetext",
    `t = ${short(t)}`,
  );
  const e = ellipse(t);
  await expect(value(page, "Curvature κ")).toHaveText(
    `${short(e.kappa)} (turning left)`,
  );
  await expect(value(page, "Radius 1/|κ|")).toHaveText(short(1 / e.kappa));
  await expect(value(page, "Arc length s")).toHaveText(short(arc(t)));
  // On the curve itself, not on a sample: the nearest samples are farther
  // from the closed form than the drawing's resolution.
  const at = await onPage(page, e.point),
    center = await onPage(page, e.center);
  expect(await attr(page, "probe-point", "cx")).toBeCloseTo(at.x, 2);
  expect(await attr(page, "probe-point", "cy")).toBeCloseTo(at.y, 2);
  const nearest = await onPage(page, ellipse((2 * Math.PI * 123) / n).point);
  expect(Math.hypot(nearest.x - at.x, nearest.y - at.y)).toBeGreaterThan(0.1);
  expect(await attr(page, "probe-circle", "cx")).toBeCloseTo(center.x, 1);
  expect(await attr(page, "probe-circle", "cy")).toBeCloseTo(center.y, 1);
  expect(await attr(page, "probe-circle", "r")).toBeCloseTo(
    center.scale / e.kappa,
    1,
  );
  const len = Math.hypot(e.tangent.x, e.tangent.y);
  expect(((await attr(page, "probe-tangent", "x2")) - at.x) / 70).toBeCloseTo(
    e.tangent.x / len,
    3,
  );
  expect(((await attr(page, "probe-normal", "y2")) - at.y) / 70).toBeCloseTo(
    -e.tangent.x / len,
    3,
  );
  // The evolute's normal runs from the point to its own center.
  const line = drawn(page, "probe-construction");
  expect(Number(await line.getAttribute("x1"))).toBeCloseTo(at.x, 2);
  expect(Number(await line.getAttribute("x2"))).toBeCloseTo(center.x, 1);
  expect(Number(await line.getAttribute("y2"))).toBeCloseTo(center.y, 1);
  // The κ plot marks the probe between its samples.
  const mark = page.locator(".probe-plot line").last();
  expect(Number(await mark.getAttribute("x1"))).toBeCloseTo(
    (240 * t) / (2 * Math.PI),
    1,
  );
});

test("the probe snaps to samples, or stands between them, and its link keeps the choice", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await ready(page);
  await probeSwitch(page).check();
  await ready(page);
  await expect(betweenSwitch(page)).not.toBeChecked();
  await point(page).fill("247");
  await expect(drawn(page, "probe")).toHaveAttribute("data-sample", "247");
  // Standing between samples keeps the same t, then moves freely.
  await betweenSwitch(page).check();
  await expect(drawn(page, "probe")).toHaveAttribute(
    "data-t",
    String(2 * Math.PI * (247 / n)),
  );
  await expect(point(page)).toHaveAttribute("max", "1");
  await point(page).fill(String(position));
  await expect(drawn(page, "probe")).toHaveAttribute(
    "data-t",
    String(2 * Math.PI * position),
  );
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await button(page, "Copy link").click();
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  const href = await page.evaluate(() => navigator.clipboard.readText());
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const other = await context.newPage();
  await other.goto(href);
  await ready(other);
  await expect(betweenSwitch(other)).toBeChecked();
  await expect(drawn(other, "probe")).toHaveAttribute(
    "data-t",
    String(2 * Math.PI * position),
  );
  await context.close();
  // Snapping again takes the nearest sample.
  await betweenSwitch(page).uncheck();
  await expect(drawn(page, "probe")).toHaveAttribute(
    "data-sample",
    String(Math.round(position * n)),
  );
});

test("moving the probe between samples asks Go for the probe alone", async ({
  page,
}) => {
  await watchEngines(page, 2);
  await open(page, {}, position);
  await expect(drawn(page, "probe")).toHaveCount(1);
  const base = await art(page).locator("path").first().getAttribute("d");
  const before = (await engines(page))[0].sent.compute ?? 0;
  for (const p of [0.31, 0.62, 0.4]) {
    await point(page).fill(String(p));
    await expect(drawn(page, "probe")).toHaveAttribute(
      "data-t",
      String(2 * Math.PI * p),
    );
    await expect(page.locator(".plot-wrap")).toHaveAttribute(
      "aria-busy",
      "false",
    );
  }
  const log = (await engines(page))[0];
  expect(log.sent.compute - before).toBeGreaterThanOrEqual(3);
  expect(log.first.compute).toBeTruthy();
  // The study is the same drawing; only the probe moved.
  expect(await art(page).locator("path").first().getAttribute("d")).toBe(base);
});

test("the probe moves smoothly along the curve as an animation", async ({
  page,
}) => {
  await open(page, {}, position);
  await openAnimation(page);
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("probe");
  await page
    .getByRole("spinbutton", { name: "Duration (seconds)" })
    .fill("0.5");
  await button(page, "Play animation").click();
  await expect(button(page, "Replay")).toBeVisible({ timeout: 20000 });
  await expect(drawn(page, "probe")).toHaveAttribute(
    "data-t",
    String(2 * Math.PI),
  );
  await button(page, "Replay").click();
  await button(page, "Pause").click();
  const progress = page.getByRole("slider", { name: "Animation progress" });
  for (const p of [0.37, 0.371]) {
    await progress.fill(String(p));
    await expect(drawn(page, "probe")).toHaveAttribute(
      "data-t",
      String(2 * Math.PI * p),
    );
  }
  const t = await probeT(page);
  await expect(value(page, "Curvature κ")).toHaveText(
    `${short(ellipse(t).kappa)} (turning left)`,
  );
  await expect(point(page)).toBeDisabled();
  await button(page, "Stop").click();
  await expect(drawn(page, "probe")).toHaveAttribute(
    "data-t",
    String(2 * Math.PI * position),
  );
});

// While the domain end runs from 2π to 4π: held at its t, the probe stays
// exactly there; keeping its share of the length, it reads twice its arc
// length at the end, the ellipse traced twice; moving along, it ends at 4π.
for (const [motion, label] of [
  ["stays", "stays exactly at its t"],
  ["length", "keeps exactly its share of the length"],
  ["along", "moves along the curve to its end"],
] as const)
  test(`between samples, while the parameters vary, the probe ${label}`, async ({
    page,
  }) => {
    await open(page, {}, position);
    const t0 = 2 * Math.PI * position;
    await openAnimation(page);
    await page
      .getByRole("combobox", { name: "Animate", exact: true })
      .selectOption("parameters");
    await page
      .getByRole("combobox", { name: "Parameter 1", exact: true })
      .selectOption("max");
    await page.getByRole("textbox", { name: "Track 1 to" }).fill("4*pi");
    await page
      .getByRole("combobox", { name: "Probe", exact: true })
      .selectOption(motion);
    await page
      .getByRole("spinbutton", { name: "Duration (seconds)" })
      .fill("0.5");
    await button(page, "Play animation").click();
    await expect(button(page, "Replay")).toBeVisible({ timeout: 20000 });
    if (motion === "stays")
      await expect(drawn(page, "probe")).toHaveAttribute("data-t", String(t0));
    if (motion === "along")
      await expect(drawn(page, "probe")).toHaveAttribute(
        "data-t",
        String(4 * Math.PI),
      );
    if (motion === "length") {
      // The ellipse traced twice is twice as long, so the same share is
      // twice the arc length.
      await expect(value(page, "Arc length s")).toHaveText(short(2 * arc(t0)));
      expect(arc(await probeT(page))).toBeCloseTo(2 * arc(t0), 6);
    }
    // Scrubbed to the middle, a probe that stays is still exactly at t₀.
    await page.getByRole("slider", { name: "Animation progress" }).fill("0.5");
    await expect(page.locator(".animation-values")).toContainText(
      "Domain end = 9.42478",
    );
    await expect(drawn(page, "probe")).toHaveCount(1);
    if (motion === "stays")
      await expect(drawn(page, "probe")).toHaveAttribute("data-t", String(t0));
  });

test("a probe between samples held outside a frame's domain says so", async ({
  page,
}) => {
  await open(page, {}, 0.9);
  await openAnimation(page);
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("parameters");
  await page
    .getByRole("combobox", { name: "Parameter 1", exact: true })
    .selectOption("max");
  await page.getByRole("textbox", { name: "Track 1 to" }).fill("pi");
  await page
    .getByRole("spinbutton", { name: "Duration (seconds)" })
    .fill("0.5");
  await button(page, "Play animation").click();
  await button(page, "Pause").click();
  // At 0.9 the domain ends at 1.1π, short of t = 1.8π.
  await page.getByRole("slider", { name: "Animation progress" }).fill("0.9");
  await expect(drawn(page, "probe")).toHaveCount(0);
  await expect(page.locator(".planar-probe")).toContainText(
    `t = ${Number((1.8 * Math.PI).toPrecision(6))} lies outside this frame's domain, [0, ${Number((1.1 * Math.PI).toPrecision(6))}].`,
  );
});

// Drawing along the curve reaches the probe at its own t.
test("drawing along the curve reaches a probe between samples at its t", async ({
  page,
}) => {
  await open(page, {}, position);
  await openAnimation(page);
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("reveal");
  await button(page, "Play animation").click();
  await button(page, "Pause").click();
  const progress = page.getByRole("slider", { name: "Animation progress" });
  // At 0.124 the drawing has reached sample 123, just short of it.
  await progress.fill("0.124");
  await expect(page.locator(".animation-values")).toHaveText(
    `t = ${(2 * Math.PI * 0.124).toPrecision(6)}`,
  );
  await expect(drawn(page, "probe")).toHaveCount(0);
  await expect(page.locator(".planar-probe")).toContainText(
    "The drawing has not reached the probe yet.",
  );
  // The drawing reaches sample 124 past the probe at 0.125.
  await progress.fill("0.125");
  await expect(drawn(page, "probe")).toHaveAttribute(
    "data-t",
    String(2 * Math.PI * position),
  );
});

// Traced light reaches the probe's reflected ray when it reaches the
// samples on either side.
test("traced light reaches a probe's ray between samples", async ({ page }) => {
  await page.goto("/");
  await ready(page);
  await choosePreset(page, { label: "Light inside a circle" });
  await ready(page);
  await probeSwitch(page).check();
  await betweenSwitch(page).check();
  await point(page).fill("0.0503");
  await expect(drawn(page, "probe-construction")).toHaveCount(1);
  await openAnimation(page);
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("trace");
  await button(page, "Play animation").click();
  await button(page, "Pause").click();
  const progress = page.getByRole("slider", { name: "Animation progress" });
  await progress.fill("0.01");
  await expect(page.locator(".animation-values")).toContainText(
    "Optical path τ",
  );
  await expect(drawn(page, "probe-circle")).toHaveCount(1);
  await expect(drawn(page, "probe-construction")).toHaveCount(0);
  await progress.fill("1");
  await expect(drawn(page, "probe-construction")).toHaveCount(1);
});

// A gap between samples leaves nothing to describe; a chase or trajectory,
// which Go integrates step by step, offers no between.
test("a probe between samples in a gap is undefined, and integrated curves snap", async ({
  page,
}) => {
  await open(
    page,
    { curve: { ...presets[0].config.curve, x: "t", y: "sqrt(t^2 - 1)" } },
    0.5,
    { bounds: { min: "-2", max: "2" } },
  );
  await expect(value(page, "Curvature κ")).toHaveText(
    "undefined: no point here",
  );
  await expect(drawn(page, "probe")).toHaveCount(0);
  await choosePreset(page, { label: "Four chasers at unequal speeds" });
  await ready(page);
  await probeSwitch(page).check();
  await expect(betweenSwitch(page)).toHaveCount(0);
  await expect(drawn(page, "probe")).toHaveAttribute("data-sample", /\d/);
});

// Exported frames draw the probe where Go places it: at the start of the
// domain the probe between samples is the first sample's, exactly as
// snapped; moving between samples, it changes the last frame.
test("exported animations draw a probe between samples", async ({ page }) => {
  test.slow();
  await open(page, {}, position);
  await openExportSettings(page);
  await page
    .getByRole("spinbutton", { name: "Duration (seconds)" })
    .fill("0.5");
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("probe");
  const ends = async () => {
    const saved = page.waitForEvent("download", { timeout: 60000 });
    await page
      .getByRole("button", { name: /^Export (MP4 video|animated WebP)/ })
      .click();
    const bytes = await readFile((await (await saved).path())!);
    const v = await decodeVideo(page, bytes);
    return [v.first.hash, v.last.hash];
  };
  const [first, last] = await ends();
  expect(first).not.toBe(last);
  await betweenSwitch(page).uncheck();
  await ready(page);
  const [snappedFirst] = await ends();
  expect(snappedFirst).toBe(first);
});

// A drag faster than Go answers never queues work: one request is in
// flight at a time, and its reply asks for the latest place, where the
// probe ends.
test("dragging the probe between samples asks only for the latest place", async ({
  page,
}) => {
  await watchEngines(page, 2, { compute: 300 });
  await open(page, {}, position);
  await expect(drawn(page, "probe")).toHaveCount(1);
  const before = (await engines(page))[0].sent.compute ?? 0;
  const places = Array.from({ length: 20 }, (_, k) => (30 + k) / 100);
  for (const p of places) await point(page).fill(String(p));
  await expect(drawn(page, "probe")).toHaveAttribute(
    "data-t",
    String(2 * Math.PI * places.at(-1)!),
  );
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  expect((await engines(page))[0].sent.compute - before).toBeLessThanOrEqual(4);
});
