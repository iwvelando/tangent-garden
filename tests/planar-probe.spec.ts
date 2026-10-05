import { test, expect, type Page } from "@playwright/test";
import { deflateRawSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { choosePreset, openAnimation, openExportSettings } from "./helpers";
import { decodeVideo } from "./video";
import { engines, watchEngines } from "./engines";
import { presets } from "../web/presets";

// The 2D notebook's parameter probe: Go's diagnostics of the base curve
// (engine/diagnostics.go), drawn at one sample and read out beside the
// drawing. Expectations are closed forms evaluated here.

const art = (page: Page) => page.locator("#artwork");
const ready = (page: Page) =>
  expect(page.locator(".plot-wrap")).toHaveAttribute("aria-busy", "false");
const probeSwitch = (page: Page) =>
  page.getByRole("checkbox", {
    name: "Tangent, normal & curvature at a point",
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

// A world point's place on the page, from the drawing's own camera.
async function onPage(page: Page, p: { x: number; y: number }) {
  const scale = Number(await art(page).getAttribute("data-camera-scale"));
  const [cx, cy] = (await art(page).getAttribute("data-camera-center"))!
    .split(",")
    .map(Number);
  return { x: 500 + (p.x - cx) * scale, y: 380 - (p.y - cy) * scale, scale };
}
const attr = async (page: Page, id: string, name: string) =>
  Number(await drawn(page, id).getAttribute(name));

// A link encoded independently, as a sender's browser would.
const linkTo = (study: unknown) =>
  `/#s=${deflateRawSync(
    Buffer.from(JSON.stringify({ v: 1, notebook: "2d", study })),
  ).toString("base64url")}`;
async function open(page: Page, config: object, extra: object = {}) {
  await page.goto(
    linkTo({
      config: { ...presets[0].config, ...config },
      bounds: { min: "0", max: "2*pi" },
      probe: { enabled: true, position: 0.5 },
      ...extra,
    }),
  );
  await ready(page);
}

// The opening ellipse (2 cos t, 3 sin t), sampled 2000 times over a turn.
const a = 2,
  b = 3,
  n = presets[0].config.samples - 1;
const ellipse = (j: number) => {
  const t = (2 * Math.PI * j) / n,
    s = Math.sin(t),
    c = Math.cos(t);
  return {
    t,
    point: { x: a * c, y: b * s },
    kappa: (a * b) / (a * a * s * s + b * b * c * c) ** 1.5,
    center: {
      x: ((a * a - b * b) / a) * c ** 3,
      y: ((b * b - a * a) / b) * s ** 3,
    },
    tangent: { x: -a * s, y: b * c },
  };
};

test("the probe reads and draws an ellipse's curvature, circle and frame at a sample", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  await expect(point(page)).toHaveCount(0);
  await probeSwitch(page).check();
  await ready(page);
  await expect(point(page)).toHaveAttribute("max", String(n));
  for (const j of [Math.round(n / 2), 300, 0]) {
    await point(page).fill(String(j));
    const e = ellipse(j);
    await expect(point(page)).toHaveAttribute(
      "aria-valuetext",
      `t = ${short(e.t)}, sample ${j} of ${n}`,
    );
    await expect(value(page, "Curvature κ")).toHaveText(
      `${short(e.kappa)} (turning left)`,
    );
    await expect(value(page, "Radius 1/|κ|")).toHaveText(short(1 / e.kappa));
    await expect(drawn(page, "probe")).toHaveAttribute(
      "data-sample",
      String(j),
    );
    // The osculating circle about the center of curvature, through the point.
    const center = await onPage(page, e.center),
      at = await onPage(page, e.point);
    expect(await attr(page, "probe-circle", "cx")).toBeCloseTo(center.x, 1);
    expect(await attr(page, "probe-circle", "cy")).toBeCloseTo(center.y, 1);
    expect(await attr(page, "probe-circle", "r")).toBeCloseTo(
      center.scale / e.kappa,
      1,
    );
    expect(await attr(page, "probe-point", "cx")).toBeCloseTo(at.x, 1);
    // T along r′; N a quarter turn to its left, toward the center.
    const len = Math.hypot(e.tangent.x, e.tangent.y);
    const dx = (await attr(page, "probe-tangent", "x2")) - at.x,
      dy = (await attr(page, "probe-tangent", "y2")) - at.y;
    expect(dx / 70).toBeCloseTo(e.tangent.x / len, 3);
    expect(dy / 70).toBeCloseTo(-e.tangent.y / len, 3);
    const nx = (await attr(page, "probe-normal", "x2")) - at.x,
      ny = (await attr(page, "probe-normal", "y2")) - at.y;
    expect(nx / 70).toBeCloseTo(-e.tangent.y / len, 3);
    expect(ny / 70).toBeCloseTo(-e.tangent.x / len, 3);
    // The evolute's construction line runs from the point to its center.
    const line = drawn(page, "probe-construction");
    expect(Number(await line.getAttribute("x2"))).toBeCloseTo(center.x, 1);
    expect(Number(await line.getAttribute("y2"))).toBeCloseTo(center.y, 1);
  }
  // Arc length: from the first sample, a quarter of the way round at
  // sample n/4, against an independent sum of the speed.
  await point(page).fill(String(n / 4 + 0.25));
  const j = Number(await point(page).inputValue());
  let s = 0;
  const m = 100000,
    tj = (2 * Math.PI * j) / n;
  for (let k = 0; k < m; k++) {
    const t = (tj * (k + 0.5)) / m;
    s += Math.hypot(a * Math.sin(t), b * Math.cos(t)) * (tj / m);
  }
  await expect(value(page, "Arc length s")).toHaveText(short(s));
  // The κ plot spans the ellipse's least and greatest curvature.
  await expect(page.locator(".probe-plot figcaption")).toHaveText(
    `κ from ${short(a / (b * b))} to ${short(b / (a * a))}`,
  );
  await probeSwitch(page).uncheck();
  await expect(drawn(page, "probe")).toHaveCount(0);
});

test("moving the probe never recomputes the study", async ({ page }) => {
  await watchEngines(page, 2);
  await page.goto("/");
  await ready(page);
  await probeSwitch(page).check();
  await ready(page);
  const sent = (await engines(page))
    .map((e) => e.sent.compute ?? 0)
    .reduce((x, y) => x + y);
  for (const j of ["10", "900", "750"]) await point(page).fill(j);
  await expect(drawn(page, "probe")).toHaveAttribute("data-sample", "750");
  expect(
    (await engines(page))
      .map((e) => e.sent.compute ?? 0)
      .reduce((x, y) => x + y),
  ).toBe(sent);
});

test("curvature is negative turning right, zero on a line, and absent without a parameter", async ({
  page,
}) => {
  await open(page, {
    kind: "evolute",
    curve: { ...presets[0].config.curve, x: "3*cos(t)", y: "-3*sin(t)" },
  });
  await expect(value(page, "Curvature κ")).toHaveText(
    `${short(-1 / 3)} (turning right)`,
  );
  await expect(value(page, "Radius 1/|κ|")).toHaveText("3");
  await open(page, {
    kind: "pedal",
    curve: { ...presets[0].config.curve, x: "t", y: "2*t - 1" },
  });
  await expect(page.getByTestId("probe-straight")).toBeVisible();
  await expect(value(page, "Curvature κ")).toHaveText("0 (flat: no circle)");
  await expect(drawn(page, "probe-circle")).toHaveCount(0);
  await expect(drawn(page, "probe-tangent")).toHaveCount(1);
  for (const format of ["implicit", "attractor"]) {
    const i = presets.findIndex((p) => p.config.curve.format === format);
    await choosePreset(page, String(i));
    await ready(page);
    await expect(probeSwitch(page)).toHaveCount(0);
    await expect(drawn(page, "probe")).toHaveCount(0);
  }
});

test("the probe moves along the curve as an animation, and its link reopens it", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await ready(page);
  await probeSwitch(page).check();
  await ready(page);
  await openAnimation(page);
  const animate = page.getByRole("combobox", { name: "Animate", exact: true });
  await animate.selectOption("probe");
  // Its start is not its end, so it offers no loop.
  await expect(
    page
      .getByRole("combobox", { name: "Repeat" })
      .locator("option[value=loop]"),
  ).toHaveCount(0);
  await page
    .getByRole("spinbutton", { name: "Duration (seconds)" })
    .fill("0.5");
  await button(page, "Play animation").click();
  await expect(button(page, "Replay")).toBeVisible({ timeout: 20000 });
  await expect(drawn(page, "probe")).toHaveAttribute("data-sample", String(n));
  await expect(page.locator(".animation-values")).toHaveText(
    `Probe at t = ${Number((2 * Math.PI).toPrecision(6))}`,
  );
  // Scrubbing to the middle stands it there; the slider waits.
  await button(page, "Replay").click();
  await button(page, "Pause").click();
  await page.getByRole("slider", { name: "Animation progress" }).fill("0.5");
  await expect(drawn(page, "probe")).toHaveAttribute(
    "data-sample",
    String(Math.round(n / 2)),
  );
  await expect(point(page)).toBeDisabled();
  // Turning the probe off ends the animation and its drawing.
  await probeSwitch(page).uncheck();
  await expect(drawn(page, "probe")).toHaveCount(0);
  await expect(animate.locator("option[value=probe]")).toHaveCount(0);
  await expect(animate).toHaveValue("reveal");

  await probeSwitch(page).check();
  await ready(page);
  await point(page).fill("250");
  await animate.selectOption("probe");
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
  await expect(probeSwitch(other)).toBeChecked();
  await expect(drawn(other, "probe")).toHaveAttribute("data-sample", "250");
  await openAnimation(other);
  await expect(
    other.getByRole("combobox", { name: "Animate", exact: true }),
  ).toHaveValue("probe");
  await context.close();
});

// The probe opens at sample 500 of 999, at t₀ = 1000π/999. While the
// domain end runs from 2π to 4π, a probe held at its t stays at t₀, a probe
// keeping its share of the length stays halfway along, at twice t₀, and a
// probe moving along the curve reaches its end.
const t0 = (2 * Math.PI * 500) / n;
for (const [motion, label, sample, t] of [
  [
    "stays",
    "Stays at its t",
    (m: number) => Math.round((m * t0) / (4 * Math.PI)),
    t0,
  ],
  ["length", "Keeps its share of the length", () => 500, 2 * t0],
  ["along", "Moves along the curve", (m: number) => m, 4 * Math.PI],
] as const)
  test(`while the parameters vary, the probe ${label.toLowerCase()}`, async ({
    page,
  }) => {
    await open(page, {});
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
    await expect(drawn(page, "probe")).toHaveAttribute(
      "data-sample",
      String(sample(n)),
    );
    // Every frame between is described too: scrubbed to the middle, the
    // probe stands on that frame's own samples.
    await page.getByRole("slider", { name: "Animation progress" }).fill("0.5");
    await expect(page.locator(".animation-values")).toContainText(
      "Domain end = 9.42478",
    );
    await expect(drawn(page, "probe")).toHaveCount(1);
    await page.getByRole("slider", { name: "Animation progress" }).fill("1");
    // The readout describes the frame shown: the same ellipse, at its t.
    await expect(point(page)).toHaveAttribute(
      "aria-valuetext",
      new RegExp(`^t = ${short(t).replace(".", "\\.")}`),
    );
  });

// Export draws each frame through the same plot: with the geometry fixed,
// only the probe moves, so a probe animation's first and last frames
// differ, and a drawing along the curve with the probe on draws it once
// the drawing reaches it.
test("exported animations draw the probe where the animation moves it", async ({
  page,
}) => {
  test.slow();
  await page.goto("/");
  await ready(page);
  await probeSwitch(page).check();
  await ready(page);
  await openExportSettings(page);
  await page
    .getByRole("spinbutton", { name: "Duration (seconds)" })
    .fill("0.5");
  const ends = async () => {
    const saved = page.waitForEvent("download", { timeout: 60000 });
    await page
      .getByRole("button", { name: /^Export (MP4 video|animated WebP)/ })
      .click();
    const bytes = await readFile((await (await saved).path())!);
    const v = await decodeVideo(page, bytes);
    return [v.first.hash, v.last.hash];
  };
  const animate = page.getByRole("combobox", { name: "Animate", exact: true });
  await animate.selectOption("probe");
  const [first, last] = await ends();
  expect(first).not.toBe(last);
  // Turning the probe off and drawing the full curve gives the probe-less
  // last frame, which the probe's last frame was not.
  await probeSwitch(page).uncheck();
  await ready(page);
  await animate.selectOption("reveal");
  const [empty, bare] = await ends();
  expect(bare).not.toBe(last);
  // Drawn along the curve with the probe on, the first frame has not
  // reached the probe and is the bare one; the last frame draws it.
  await probeSwitch(page).check();
  await ready(page);
  await animate.selectOption("reveal");
  const [start, end] = await ends();
  expect(start).toBe(empty);
  expect(end).not.toBe(bare);
});

// Animations that keep the study fixed draw the probe at the user's point.
// Drawing along the curve draws it once the pen reaches its sample, and
// says so in the panel until then.
test("drawing along the curve draws the probe once it reaches it", async ({
  page,
}) => {
  await open(page, {});
  const j = Math.round(n / 2);
  await expect(drawn(page, "probe")).toHaveAttribute("data-sample", String(j));
  await openAnimation(page);
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("reveal");
  await button(page, "Play animation").click();
  await button(page, "Pause").click();
  const progress = page.getByRole("slider", { name: "Animation progress" });
  await progress.fill("0.4");
  await expect(page.locator(".animation-values")).toHaveText(
    `t = ${(2 * Math.PI * 0.4).toPrecision(6)}`,
  );
  await expect(drawn(page, "probe")).toHaveCount(0);
  await expect(page.locator(".planar-probe")).toContainText(
    "The drawing has not reached the probe yet.",
  );
  await progress.fill("0.6");
  await expect(drawn(page, "probe")).toHaveAttribute("data-sample", String(j));
  await expect(point(page)).toBeDisabled();
  await expect(point(page)).toHaveAttribute(
    "aria-valuetext",
    `t = ${short(ellipse(j).t)}, sample ${j} of ${n}`,
  );
  await expect(value(page, "Curvature κ")).toHaveText(
    `${short(ellipse(j).kappa)} (turning left)`,
  );
  await button(page, "Stop").click();
  await expect(point(page)).toBeEnabled();
  await expect(drawn(page, "probe")).toHaveAttribute("data-sample", String(j));
});

// While light is traced the mirror is drawn throughout, and so is its
// probe; the probe's reflected ray arrives with the light.
test("tracing light keeps the probe, whose reflected ray arrives with the light", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  await choosePreset(page, { label: "Light inside a circle" });
  await ready(page);
  await probeSwitch(page).check();
  await ready(page);
  await point(page).fill("100");
  const j = Number(await point(page).inputValue());
  await expect(drawn(page, "probe-construction")).toHaveCount(1);
  await openAnimation(page);
  await page
    .getByRole("combobox", { name: "Animate", exact: true })
    .selectOption("trace");
  await button(page, "Play animation").click();
  await button(page, "Pause").click();
  const progress = page.getByRole("slider", { name: "Animation progress" });
  await progress.fill("0.01");
  await expect(drawn(page, "probe")).toHaveAttribute("data-sample", String(j));
  await expect(drawn(page, "probe-circle")).toHaveCount(1);
  await expect(drawn(page, "probe-construction")).toHaveCount(0);
  await progress.fill("1");
  await expect(drawn(page, "probe-construction")).toHaveCount(1);
  await expect(drawn(page, "probe")).toHaveAttribute("data-sample", String(j));
});

// The 2D palette names the probe's inks as roles, for theme-following
// thumbnails; they are the shared inks the 3D shader draws with.
test("the 2D palette's probe inks are the shared probe inks", async () => {
  const { plotPalette } = await import("../web/palette");
  const { probeColor } = await import("../web/probe");
  for (const dark of [false, true]) {
    const p = plotPalette(dark);
    expect([p.probe, p.probeTangent, p.probeNormal]).toEqual([
      probeColor("mark", dark),
      probeColor("tangent", dark),
      probeColor("normal", dark),
    ]);
  }
});

// The clover r = 1 + 0.6 cos 3t: κ = (r² + 2r′² − r r″)/(r² + r′²)^{3/2},
// negative between its leaves, where the curve bends the other way.
test("the clover example opens probed, bends both ways, and other examples leave the probe off", async ({
  page,
}) => {
  await page.goto("/");
  await choosePreset(page, { label: "A clover's curvature, probed" });
  await ready(page);
  await expect(probeSwitch(page)).toBeChecked();
  const m = 1199,
    j = Math.round(0.03 * m),
    t = (2 * Math.PI * j) / m;
  const r = 1 + 0.6 * Math.cos(3 * t),
    r1 = -1.8 * Math.sin(3 * t),
    r2 = -5.4 * Math.cos(3 * t);
  const kappa = (r * r + 2 * r1 * r1 - r * r2) / (r * r + r1 * r1) ** 1.5;
  await expect(drawn(page, "probe")).toHaveAttribute("data-sample", String(j));
  await expect(value(page, "Curvature κ")).toHaveText(
    `${short(kappa)} (turning ${kappa > 0 ? "left" : "right"})`,
  );
  // Greatest κ at a tip (t = 0); the sharp bends between the leaves
  // (κ = −31.25 at t = π/3) lie beyond the plot's fences, pinned to its
  // negative edge.
  const tip = 1.6 * 1.6 + 1.6 * 5.4;
  await expect(page.locator(".probe-plot figcaption")).toHaveText(
    new RegExp(
      `^κ from -[\\d.]+ to ${short(tip / 1.6 ** 3).replace(".", "\\.")}; \\d+ samples beyond, pinned to the edge$`,
    ),
  );
  await expect(drawn(page, "probe-construction")).toHaveCount(2);
  await openAnimation(page);
  await expect(
    page.getByRole("combobox", { name: "Animate", exact: true }),
  ).toHaveValue("probe");
  await choosePreset(page, "0");
  await ready(page);
  await expect(probeSwitch(page)).not.toBeChecked();
  await expect(drawn(page, "probe")).toHaveCount(0);
});

// Parallel light reflected at P, where the radius of curvature is ρ and the
// incidence θ, gathers at Q, ρ·cos θ/2 along the reflected ray; the ray's
// chord of the osculating circle about C is 2ρ·cos θ = 2(Q − P)·(C − P)/|Q − P|
// long. So 2|Q − P|² = (Q − P)·(C − P), whatever the mirror. The example's
// trace draws the probe throughout, and its ray once the light arrives.
test("the oval mirror example's caustic lies a quarter along the probe's chord", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  await choosePreset(page, { label: "Sunlight gathering in an oval mirror" });
  await ready(page);
  await expect(probeSwitch(page)).toBeChecked();
  await openAnimation(page);
  await expect(
    page.getByRole("combobox", { name: "Animate", exact: true }),
  ).toHaveValue("trace");
  await button(page, "Play animation").click();
  await button(page, "Pause").click();
  const progress = page.getByRole("slider", { name: "Animation progress" });
  // Back and forth: the light has not reached the mirror at the start, and
  // the trace is whole halfway through.
  await progress.fill("0");
  await expect(drawn(page, "probe-circle")).toHaveCount(1);
  await expect(drawn(page, "probe-construction")).toHaveCount(0);
  await progress.fill("0.5");
  await expect(drawn(page, "probe-construction")).toHaveCount(1);
  const P = {
      x: await attr(page, "probe-construction", "x1"),
      y: await attr(page, "probe-construction", "y1"),
    },
    Q = {
      x: await attr(page, "probe-construction", "x2"),
      y: await attr(page, "probe-construction", "y2"),
    },
    C = {
      x: await attr(page, "probe-circle", "cx"),
      y: await attr(page, "probe-circle", "cy"),
    };
  expect(await attr(page, "probe-point", "cx")).toBeCloseTo(P.x, 6);
  const pq = { x: Q.x - P.x, y: Q.y - P.y },
    pc = { x: C.x - P.x, y: C.y - P.y };
  const reach = Math.hypot(pq.x, pq.y),
    chord = (2 * (pq.x * pc.x + pq.y * pc.y)) / reach;
  // Tens of pixels long, so not degenerate; a quarter to 1 part in 1000.
  expect(reach).toBeGreaterThan(30);
  expect(Math.abs(reach / chord - 0.25)).toBeLessThan(2.5e-4);
});
