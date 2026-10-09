import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { deflateRawSync } from "node:zlib";
import { probe } from "./video";
import { open as openDetails } from "./helpers";
import { spatialPresets } from "../web/spatial/presets";
import { defaultLayers } from "../web/spatial/renderer";
import type { CameraPath } from "../web/spatial/path";
import { drawingGap, sameCamera } from "../web/spatial/loop";
import type { Batch, View } from "../web/spatial/scene";

// Seamless loops, back and forth, and easing in the 3D notebook, through
// the real notebook, worker, engine and exporter. A loop plays only when
// its last frame is its first, which is judged on the engine's own
// geometry, the probe and the camera at both ends.
const stage = (page: Page) => page.locator(".spatial-stage");
const canvas = (page: Page) => page.locator("#spatial-artwork");
const settled = (page: Page) =>
  expect(stage(page)).toHaveAttribute("aria-busy", "false");
const mode = (page: Page) => page.getByLabel("Animate", { exact: true });
const repeat = (page: Page) => page.getByLabel("Repeat", { exact: true });
const pace = (page: Page) => page.getByLabel("Pace", { exact: true });
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
const error = (page: Page) => page.locator(".animation-error");
const shownView = async (page: Page) =>
  JSON.parse((await canvas(page).getAttribute("data-view"))!);
async function openPanel(page: Page) {
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
}
async function ready(page: Page) {
  await page.goto("/?study=3d");
  await expect(canvas(page)).toBeVisible();
  await settled(page);
  await openPanel(page);
}
async function open(page: Page, study: unknown) {
  await page.goto(
    `/?study=3d#s=${deflateRawSync(
      Buffer.from(JSON.stringify({ v: 1, notebook: "3d", study })),
    ).toString("base64url")}`,
  );
  await expect(canvas(page)).toBeVisible();
  await settled(page);
  await openPanel(page);
}
async function seek(page: Page, time: string) {
  await page.getByRole("slider", { name: "Animation progress" }).fill(time);
  await expect(stage(page)).toHaveAttribute("data-time", time);
}
const progress = async (page: Page) =>
  Number(await stage(page).getAttribute("data-progress"));

const manual = { yaw: -0.4, pitch: 0.2, zoom: 1.3, panX: 0.2, panY: 0.1 };
// A trefoil whose third harmonic is phase-shifted by a: every a draws a
// different knot, and a + 2π draws the same one, sample for sample.
const phased = {
  ...spatialPresets[0].config,
  format: "parametric" as const,
  samples: 300,
  lines: 40,
  curve: {
    x: "(2+cos(3*t+a))*cos(2*t)",
    y: "(2+cos(3*t+a))*sin(2*t)",
    z: "sin(3*t+a)",
    a: 0,
    min: 0,
    max: 2 * Math.PI,
  },
};
// An open arc of a helix, for a probe that cannot return to its start.
const arc = {
  ...phased,
  curve: { x: "2*cos(t)", y: "2*sin(t)", z: "t/3", a: 1, min: 0, max: 5 },
};
type Track = { target: string; from: string; to: string };
const study = (
  animation: Record<string, unknown>,
  config: object = phased,
  extra: object = {},
) => ({
  config,
  layers: defaultLayers,
  view: manual,
  animation: {
    mode: "reveal",
    camera: "hold",
    duration: 1,
    tracks: [] as Track[],
    ...animation,
  },
  ...extra,
});
const ring: CameraPath = {
  style: "smooth",
  keys: [
    { name: "Here", yaw: 0.3, pitch: 0.2, zoom: 1, panX: 0, panY: 0, turns: 0 },
    {
      name: "Across",
      yaw: 2.4,
      pitch: 0.7,
      zoom: 1.8,
      panX: 0.3,
      panY: 0,
      turns: 0,
    },
    {
      name: "Below",
      yaw: -2.1,
      pitch: -0.4,
      zoom: 1.2,
      panX: 0,
      panY: 0,
      turns: 0,
    },
  ],
};

// The comparison itself, on drawing batches and cameras as the scene
// builds them: each vertex a position, a normal and a phase.
const vertex = (x: number, y: number, z: number, phase = 0) => [
  x,
  y,
  z,
  0,
  0,
  1,
  phase,
];
const batch = (
  points: number[][],
  ink = 1,
  mode: Batch["mode"] = "lines",
): Batch => ({
  mode,
  ink,
  data: new Float32Array(points.flat()),
});
const segment = [vertex(1, 0, 0), vertex(0, 2, 0)];

test("two drawings agree within a millionth of the radius, and a gap is measured as a fraction of it", () => {
  const radius = 4;
  expect(drawingGap([batch(segment)], [batch(segment)], radius)).toBe(0);
  // A thousandth of the radius apart, then a tenth of a millionth.
  const moved = (d: number) => [vertex(1 + d * radius, 0, 0), vertex(0, 2, 0)];
  expect(
    drawingGap([batch(segment)], [batch(moved(1e-3))], radius),
  ).toBeCloseTo(1e-3, 6);
  expect(
    drawingGap([batch(segment)], [batch(moved(1e-5))], radius),
  ).toBeCloseTo(1e-5, 6);
  expect(drawingGap([batch(segment)], [batch(moved(1e-7))], radius)).toBe(0);
  // A different number of batches, kind, ink, length or connection is a
  // different set of pieces, whichever drawing has more.
  for (const [a, b] of [
    [[batch(segment)], [batch(segment), batch(segment)]],
    [[batch(segment), batch(segment)], [batch(segment)]],
    [[batch(segment)], [batch(segment, 2)]],
    [[batch(segment)], [batch(segment, 1, "triangles")]],
    [[batch(segment)], [batch([...segment, ...segment])]],
    [
      [
        {
          ...batch(segment, 1, "triangles"),
          indices: new Uint32Array([0, 1, 1]),
        },
      ],
      [
        {
          ...batch(segment, 1, "triangles"),
          indices: new Uint32Array([0, 1, 0]),
        },
      ],
    ],
  ] as Batch[][][])
    expect(drawingGap(a, b, radius)).toBe("pieces");
  // A normal or phase alone shades it differently.
  const shaded = [vertex(1, 0, 0, 0.5), vertex(0, 2, 0)];
  expect(drawingGap([batch(segment)], [batch(shaded)], radius)).toBe("shading");
});

test("two cameras are the same a whole number of turns apart, and differ in any other field", () => {
  const view: View = {
    center: { x: 1, y: -2, z: 0.5 },
    radius: 3,
    yaw: 0.4,
    pitch: 0.3,
    zoom: 1.5,
    panX: 0.2,
    panY: -0.1,
  };
  expect(sameCamera(view, { ...view })).toBe(true);
  for (const turns of [1, -2, 5])
    expect(
      sameCamera(view, { ...view, yaw: view.yaw + 2 * Math.PI * turns }),
    ).toBe(true);
  for (const change of [
    { yaw: view.yaw + Math.PI },
    { yaw: view.yaw + 1e-4 },
    { pitch: 0.31 },
    { zoom: 1.51 },
    { panX: 0.21 },
    { panY: -0.09 },
    { radius: 3.01 },
    { center: { ...view.center, x: 1.01 } },
    { center: { ...view.center, y: -2.01 } },
    { center: { ...view.center, z: 0.51 } },
  ] as Partial<View>[])
    expect(
      sameCamera(view, { ...view, ...change }),
      JSON.stringify(change),
    ).toBe(false);
});

test("the repeat and pace default to once and steady; loop is offered only for motion that can return to its start", async ({
  page,
}) => {
  await ready(page);
  await expect(repeat(page)).toHaveValue("once");
  await expect(pace(page)).toHaveValue("steady");
  const options = () =>
    repeat(page)
      .locator("option")
      .evaluateAll((o) => o.map((e) => (e as HTMLOptionElement).value));
  // Drawing along the curve starts empty and ends complete.
  expect(await options()).toEqual(["once", "back-and-forth"]);
  for (const m of ["orbit", "parameters", "path"]) {
    await mode(page).selectOption(m);
    expect(await options()).toEqual(["once", "loop", "back-and-forth"]);
  }
  await mode(page).selectOption("orbit");
  await repeat(page).selectOption("loop");
  // Leaving for a motion that cannot loop keeps it repeating, back and forth.
  await mode(page).selectOption("reveal");
  await expect(repeat(page)).toHaveValue("back-and-forth");
  // The help states what a loop needs.
  await mode(page).selectOption("orbit");
  await repeat(page).selectOption("loop");
  await page.getByRole("button", { name: "About repeat" }).click();
  await expect(page.locator("#spatial-animation-section")).toContainText(
    "the last frame must match the first",
  );
});

test("an orbit loops without end, wrapping its time, until paused or stopped", async ({
  page,
}) => {
  await open(page, study({ mode: "orbit", repeat: "loop", duration: 1 }));
  await expect(repeat(page)).toHaveValue("loop");
  await button(page, "Play animation").click();
  // Times seen over 2.5 durations fall back to the start at least twice.
  const times: number[] = [];
  const start = Date.now();
  while (Date.now() - start < 2500) {
    const t = await stage(page).getAttribute("data-time");
    if (t !== null) times.push(Number(t));
    await page.waitForTimeout(40);
  }
  const wraps = times.filter((t, i) => i && t < times[i - 1] - 0.5).length;
  expect(wraps).toBeGreaterThanOrEqual(2);
  expect(Math.max(...times)).toBeLessThan(1);
  // Still playing, never complete.
  await expect(button(page, "Pause")).toBeVisible();
  await expect(error(page)).toHaveCount(0);
  await button(page, "Pause").click();
  await expect(page.locator(".timeline [role=status]")).toHaveText("Paused");
  await button(page, "Resume").click();
  await expect(button(page, "Pause")).toBeVisible();
  await button(page, "Stop").click();
  await expect(stage(page)).not.toHaveAttribute("data-time");
  const view = await shownView(page);
  for (const k of ["yaw", "pitch", "zoom", "panX", "panY"] as const)
    expect(view[k]).toBeCloseTo(manual[k], 12);
});

test("a loop scrubbed to its end is paused at its start again, not complete", async ({
  page,
}) => {
  await open(page, study({ mode: "orbit", repeat: "loop", duration: 3 }));
  await button(page, "Play animation").click();
  await button(page, "Pause").click();
  await seek(page, "1");
  await expect(page.locator(".timeline [role=status]")).toHaveText("Paused");
  const end = await shownView(page);
  await seek(page, "0");
  const start = await shownView(page);
  // The same camera, one turn apart.
  expect(end.yaw - start.yaw).toBeCloseTo(2 * Math.PI, 9);
  expect(end.pitch).toBeCloseTo(start.pitch, 12);
});

test("a parameter loop plays when each track ends one period after it starts, and names the gap when it does not", async ({
  page,
}) => {
  await open(
    page,
    study({
      mode: "parameters",
      repeat: "loop",
      tracks: [{ target: "a", from: "0", to: "2*pi" }],
    }),
  );
  await button(page, "Play animation").click();
  await expect(button(page, "Pause")).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(error(page)).toHaveCount(0);
  await expect(button(page, "Pause")).toBeVisible();
  await button(page, "Stop").click();
  // Half a period does not return.
  await page.getByLabel("Track 1 to", { exact: true }).fill("pi");
  await button(page, "Play animation").click();
  await expect(error(page)).toContainText(
    "Repeat can loop only motion that ends where it starts",
  );
  await expect(error(page)).toContainText("of the study's radius");
  await expect(error(page)).toContainText("Back and forth");
  await expect(stage(page)).not.toHaveAttribute("data-time");
  // A count that changes the drawing's pieces is named as such.
  await page.getByLabel("Track 1 to", { exact: true }).fill("2*pi");
  await page.getByRole("button", { name: "+ Add parameter" }).click();
  await page.getByLabel("Parameter 2", { exact: true }).selectOption("lines");
  await button(page, "Play animation").click();
  await expect(error(page)).toContainText("different pieces");
});

test("a camera path loops only when its last view is its first, and Return to view 1 closes it", async ({
  page,
}) => {
  await open(
    page,
    study({ mode: "path", repeat: "loop", duration: 3, path: ring }),
  );
  await button(page, "Play animation").click();
  await expect(error(page)).toContainText(
    "the camera at the end is not the camera at the start",
  );
  await button(page, "+ Return to view 1").click();
  await expect(page.getByLabel("View 4 name", { exact: true })).toHaveValue(
    "Here",
  );
  await button(page, "Play animation").click();
  await expect(button(page, "Pause")).toBeVisible();
  await expect(error(page)).toHaveCount(0);
  await button(page, "Pause").click();
  await seek(page, "0");
  const start = await shownView(page);
  await seek(page, "1");
  const end = await shownView(page);
  for (const k of ["pitch", "zoom", "panX", "panY"])
    expect(end[k]).toBeCloseTo(start[k], 9);
  const turn = (end.yaw - start.yaw) / (2 * Math.PI);
  expect(Math.abs(turn - Math.round(turn))).toBeLessThan(1e-9);
  // Smooth, it passes through the joining view without stopping: the pitch
  // changes at the same rate either side of the seam.
  await seek(page, "0.001");
  const after = await shownView(page);
  await seek(page, "0.999");
  const before = await shownView(page);
  const rates = [
    (after.pitch - start.pitch) / 0.001,
    (end.pitch - before.pitch) / 0.001,
  ];
  console.log("Pitch rates either side of the seam", rates);
  expect(Math.abs(rates[0])).toBeGreaterThan(0.1);
  expect(Math.abs(rates[0] - rates[1])).toBeLessThan(0.05 * Math.abs(rates[0]));
});

test("the probe loops around a closed curve, not along an open arc", async ({
  page,
}) => {
  const probed = { probe: { enabled: true, position: 0.3 } };
  await open(page, study({ mode: "probe", repeat: "loop" }, phased, probed));
  await expect(mode(page)).toHaveValue("probe");
  await button(page, "Play animation").click();
  await expect(button(page, "Pause")).toBeVisible();
  await expect(error(page)).toHaveCount(0);
  await button(page, "Stop").click();
  await open(page, study({ mode: "probe", repeat: "loop" }, arc, probed));
  await button(page, "Play animation").click();
  await expect(error(page)).toContainText(
    "the probe at the end is not where it starts",
  );
});

test("back and forth turns at the end halfway, and easing follows a half cosine", async ({
  page,
}) => {
  await open(
    page,
    study({ mode: "reveal", repeat: "back-and-forth", duration: 4 }),
  );
  await button(page, "Play animation").click();
  await button(page, "Pause").click();
  for (const [time, p] of [
    ["0.25", 0.5],
    ["0.5", 1],
    ["0.75", 0.5],
    ["1", 0],
  ] as const) {
    await seek(page, time);
    expect(await progress(page)).toBeCloseTo(p, 12);
    // At the turn the motion is at its end, but the animation goes on and
    // keeps its camera.
    await expect(page.locator(".spatial-stage")).toContainText(
      "Animation camera · Stop restores manual framing",
    );
  }
  // Paused, not complete, at the end of a repeating animation.
  await expect(page.locator(".timeline [role=status]")).toHaveText("Paused");
  await button(page, "Stop").click();
  await repeat(page).selectOption("once");
  await pace(page).selectOption("ease");
  await button(page, "Play animation").click();
  await button(page, "Pause").click();
  for (const t of [0.1, 0.25, 0.5, 0.9]) {
    await seek(page, String(t));
    expect(await progress(page)).toBeCloseTo(
      (1 - Math.cos(Math.PI * t)) / 2,
      12,
    );
  }
  await seek(page, "1");
  expect(await progress(page)).toBe(1);
  await expect(page.locator(".timeline [role=status]")).toHaveText("Complete");
  // A finished single pass hands its camera over.
  await expect(page.locator(".spatial-stage")).toContainText("Drag to orbit");
});

// Every frame of an exported video, decoded by ffmpeg at a small size, as
// grey levels.
function frames(path: string, width = 160, height = 122) {
  const bytes = execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      path,
      "-vf",
      `scale=${width}:${height}`,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "gray",
      "-",
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  const size = width * height,
    out: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size)
    out.push(bytes.subarray(i, i + size));
  return out;
}
const difference = (a: Uint8Array, b: Uint8Array) => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
};
async function exportMp4(page: Page) {
  await openDetails(page, "#spatial-export-settings");
  await page.getByLabel("Export format", { exact: true }).selectOption("mp4");
  await page.getByLabel("Export frame rate").selectOption("15");
  await page
    .getByRole("slider", { name: "Export resolution", exact: true })
    .fill("0.5");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export MP4/ }).click();
  return (await (await download).path())!;
}

test("a looping export leaves out the seam's duplicate frame; once keeps both ends", async ({
  page,
}) => {
  const seams: Record<string, { seam: number; step: number; count: number }> =
    {};
  for (const r of ["once", "loop"]) {
    await open(page, study({ mode: "orbit", repeat: r, duration: 1 }));
    const path = await exportMp4(page);
    const data = probe(path);
    if (data) {
      expect(data.frames).toBe(15);
      expect(data.durations.reduce((a, b) => a + b, 0)).toBe(1000);
    }
    const f = frames(path);
    expect(f).toHaveLength(15);
    const steps = f.slice(1).map((x, i) => difference(f[i], x));
    seams[r] = {
      seam: difference(f[14], f[0]),
      step: steps.reduce((a, b) => a + b) / steps.length,
      count: f.length,
    };
  }
  console.log("Orbit seams", seams);
  // Once, the full turn's last frame is its first again: played as a loop,
  // the seam would hold one frame twice.
  expect(seams.once.seam).toBeLessThan(0.2 * seams.once.step);
  // Looping, the seam is one more step of the turn.
  expect(seams.loop.seam).toBeGreaterThan(0.6 * seams.loop.step);
  expect(seams.loop.seam).toBeLessThan(1.6 * seams.loop.step);
});

test("a back-and-forth export retraces its outward frames in reverse", async ({
  page,
}) => {
  await open(
    page,
    study({ mode: "reveal", repeat: "back-and-forth", duration: 1 }),
  );
  const path = await exportMp4(page);
  const f = frames(path);
  expect(f).toHaveLength(15);
  // Frame i and frame 15 − i are drawn at the same progress; frame 0 is
  // empty and others are not.
  const same = [1, 2, 3, 4, 5, 6, 7].map((i) => difference(f[i], f[15 - i]));
  const apart = difference(f[0], f[7]);
  console.log("Back and forth", { same, apart });
  for (const d of same) expect(d).toBeLessThan(0.1 * apart);
});

test("a repeating WebP loops forever whatever the loop box said, with every frame once", async ({
  page,
}) => {
  await open(page, study({ mode: "orbit", repeat: "loop", duration: 0.4 }));
  await openDetails(page, "#spatial-export-settings");
  const format = page.getByLabel("Export format", { exact: true });
  if (
    !(await format.count()) ||
    !(await format.locator("option[value=webp]").count())
  )
    test.skip(true, "this browser cannot encode WebP");
  await format.selectOption("webp");
  await page.getByLabel("Export frame rate").selectOption("15");
  await expect(
    page.getByRole("checkbox", { name: "Loop exported animation" }),
  ).toHaveCount(0);
  await expect(page.locator("#spatial-export-settings")).toContainText(
    "loops forever",
  );
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export animated WebP" }).click();
  const bytes = await readFile((await (await download).path())!);
  const chunks: { name: string; body: Buffer }[] = [];
  for (let offset = 12; offset < bytes.length;) {
    const length = bytes.readUInt32LE(offset + 4);
    chunks.push({
      name: bytes.toString("ascii", offset, offset + 4),
      body: bytes.subarray(offset + 8, offset + 8 + length),
    });
    offset += 8 + length + (length % 2);
  }
  expect(chunks.find((c) => c.name === "ANIM")!.body.readUInt16LE(4)).toBe(0);
  const anmf = chunks.filter((c) => c.name === "ANMF");
  expect(anmf).toHaveLength(6);
  expect(anmf.reduce((s, c) => s + c.body.readUIntLE(12, 3), 0)).toBe(400);
  // Chromium's own decoder: the last frame is not the first.
  const distinct = await page.evaluate(async (input) => {
    const decoder = new (window as any).ImageDecoder({
      data: new Uint8Array(input),
      type: "image/webp",
    });
    await decoder.tracks.ready;
    const n = decoder.tracks.selectedTrack.frameCount;
    const grab = async (i: number) => {
      const { image } = await decoder.decode({ frameIndex: i });
      const c = new OffscreenCanvas(200, 152);
      c.getContext("2d")!.drawImage(image, 0, 0, 200, 152);
      image.close();
      return c.getContext("2d")!.getImageData(0, 0, 200, 152).data;
    };
    const [a, b] = [await grab(0), await grab(n - 1)];
    let d = 0;
    for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
    return { n, d: d / a.length };
  }, Array.from(bytes));
  expect(distinct.n).toBe(6);
  expect(distinct.d).toBeGreaterThan(0.05);
});

test("repeat and pace travel in a copied link", async ({ page }) => {
  await ready(page);
  await mode(page).selectOption("orbit");
  await repeat(page).selectOption("loop");
  await pace(page).selectOption("ease");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await button(page, "Copy link").click();
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  const href = await page.evaluate(() => navigator.clipboard.readText());
  const other = await page.context().newPage();
  await other.goto(href);
  await expect(canvas(other)).toBeVisible();
  await settled(other);
  await openPanel(other);
  await expect(mode(other)).toHaveValue("orbit");
  await expect(repeat(other)).toHaveValue("loop");
  await expect(pace(other)).toHaveValue("ease");
});

test("the loop presets bring their repeat, pace and camera, and pass the closure check", async ({
  page,
}) => {
  await ready(page);
  const choose = async (label: string) => {
    await page
      .getByRole("button", { name: "Browse notebook examples" })
      .click();
    const gallery = page.getByRole("dialog", { name: "Notebook examples" });
    await gallery.locator(`[data-example-title="${label}"]`).click();
    await gallery.waitFor({ state: "hidden" });
    await settled(page);
  };
  for (const [label, expected] of [
    [
      "Beads running around a trefoil",
      ["parameters", "loop", "steady", "path"],
    ],
    ["A Schwarz surface breathing", ["parameters", "loop", "steady", "hold"]],
    ["A gyroid peeled and regrown", ["cut", "back-and-forth", "ease", "hold"]],
  ] as const) {
    await choose(label);
    await expect(mode(page)).toHaveValue(expected[0]);
    await expect(repeat(page)).toHaveValue(expected[1]);
    await expect(pace(page)).toHaveValue(expected[2]);
    await expect(
      page.getByLabel("Animation camera", { exact: true }),
    ).toHaveValue(expected[3]);
    await button(page, "Play animation").click();
    await expect(button(page, "Pause")).toBeVisible({ timeout: 20000 });
    await expect(error(page)).toHaveCount(0);
    await button(page, "Pause").click();
    // Its time and progress at the turn of the timeline.
    await seek(page, "0.5");
    expect(await progress(page)).toBe(expected[1] === "loop" ? 0.5 : 1);
    await button(page, "Stop").click();
  }
  // An ordinary example plays once, steadily.
  await choose("Trefoil · (2, 3)");
  await expect(repeat(page)).toHaveValue("once");
  await expect(pace(page)).toHaveValue("steady");
  // The beads return only after a whole turn of a.
  await choose("Beads running around a trefoil");
  await page.getByLabel("Track 1 to", { exact: true }).fill("2*pi - 0.3");
  await button(page, "Play animation").click();
  await expect(error(page)).toContainText("of the study's radius");
});

test("a loop must return every sample to its own place, not to another's", async ({
  page,
}) => {
  // The trefoil run on by a, c(t + a), with its tangent developable: a
  // ninth of a turn is 80 of 720 sample steps, so the end draws the start's
  // shape with every sample relabeled. A sheet's color follows its samples,
  // so that is not the same drawing; a whole turn is.
  const knot = {
    ...phased,
    samples: 720,
    lines: 90,
    curve: {
      x: "(2+cos(3*(t+a)))*cos(2*(t+a))",
      y: "(2+cos(3*(t+a)))*sin(2*(t+a))",
      z: "sin(3*(t+a))",
      a: 0,
      min: 0,
      max: 2 * Math.PI,
    },
  };
  const run = (to: string) => ({
    mode: "parameters",
    repeat: "loop",
    tracks: [{ target: "a", from: "0", to }],
  });
  await open(page, study(run("2*pi/9"), knot));
  await button(page, "Play animation").click();
  await expect(error(page)).toContainText("of the study's radius");
  await open(page, study(run("2*pi"), knot));
  await button(page, "Play animation").click();
  await expect(button(page, "Pause")).toBeVisible();
  await expect(error(page)).toHaveCount(0);
});
