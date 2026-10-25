import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { choosePreset, exportImage, open, openAnimation } from "./helpers";
import { probe, decodeVideo, frameDifference } from "./video";
import { distanceToStar, tip } from "./star";
import { presets } from "../web/presets";

// Flying the 2D camera through key views (planar-path.ts), through the real
// notebook: views taken from the drawing and shown again, the flight at and
// between its views, each frame refined to its own view, refusals, and the
// exported video's ends.

const star = "Inside a star's point";
const flight = presets.find((p) => p.title === star)!.animation!.path!;
const W = 1000,
  H = 760;

const art = (page: Page) => page.locator("#artwork");
const ready = (page: Page) =>
  expect(page.locator(".plot-wrap")).toHaveAttribute("aria-busy", "false", {
    timeout: 20_000,
  });
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
const innermost = (page: Page) =>
  art(page).locator('[data-testid="offset-family"] path').first();
async function camera(page: Page) {
  const svg = art(page);
  const scale = Number(await svg.getAttribute("data-camera-scale"));
  const [cx, cy] = (await svg.getAttribute("data-camera-center"))!
    .split(",")
    .map(Number);
  return { scale, cx, cy };
}
const vertices = (d: string) =>
  [...d.matchAll(/[ML]([-\d.]+),([-\d.]+)/g)].map((m) => [+m[1], +m[2]]);

// Shows a zoomed-in view and waits for the study refined to it: the drawing
// is ready only once the refinement says so.
async function showZoomed(page: Page, name: string) {
  await button(page, name).click();
  await expect(page.locator(".refinement-readout")).toContainText(
    "finer in view",
  );
  await ready(page);
}

// The innermost offset, 0.0003 inside the star, as drawn at the camera
// shown: the largest distance from 0.0003 of any drawn chord's midpoint on
// the page from the star, against the view's tolerance, 2 × 10⁻⁴ of its
// half diagonal; and how many chords were measured.
async function innermostError(page: Page) {
  const c = await camera(page);
  const tolerance = (2e-4 * Math.hypot(W, H)) / 2 / c.scale;
  const points = vertices((await innermost(page).getAttribute("d"))!);
  let measured = 0,
    worst = 0;
  for (let k = 1; k < points.length; k++) {
    const [ax, ay] = points[k - 1],
      [bx, by] = points[k];
    const mx = (ax + bx) / 2,
      my = (ay + by) / 2;
    if (mx < 0 || mx > W || my < 0 || my > H) continue;
    const at = {
      x: c.cx + (mx - W / 2) / c.scale,
      y: c.cy - (my - H / 2) / c.scale,
    };
    worst = Math.max(worst, Math.abs(distanceToStar(at) - 0.0003));
    measured++;
  }
  return { worst, tolerance, measured };
}

// The star, with its flight set to play once at a steady pace.
async function openStar(page: Page, duration = "2") {
  await page.goto("/");
  await choosePreset(page, { label: star });
  await ready(page);
  await openAnimation(page);
  await expect(
    page.getByRole("combobox", { name: "Animate", exact: true }),
  ).toHaveValue("path");
  await page.getByRole("combobox", { name: "Repeat" }).selectOption("once");
  await page.getByRole("combobox", { name: "Pace" }).selectOption("steady");
  await page
    .getByRole("spinbutton", { name: "Duration (seconds)" })
    .fill(duration);
  const fit = await camera(page);
  return fit;
}

test("the planar easing toggle changes the scrubbed camera and resets with a new preset", async ({
  page,
}) => {
  const fit = await openStar(page, "0.4");
  const toggle = page.getByRole("checkbox", {
    name: "Ease key-view transitions",
    exact: true,
  });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await button(page, "Play animation").click();
  await expect(button(page, "Replay")).toBeVisible({ timeout: 30_000 });
  await page
    .getByRole("slider", { name: "Animation progress", exact: true })
    .fill("0.25");
  await ready(page);
  // Quintic easing at a quarter leg is exactly 53/512.
  await expect
    .poll(async () => (await camera(page)).scale / fit.scale)
    .toBeCloseTo(800 ** (53 / 512), 8);
  await button(page, "Stop").click();
  await choosePreset(page, { label: star });
  await ready(page);
  await expect(toggle).not.toBeChecked();
});

test("planar easing factor edits affect playback, validate, survive toggling, and reset with the preset", async ({
  page,
}) => {
  const fit = await openStar(page, "0.4");
  const toggle = page.getByRole("checkbox", {
    name: "Ease key-view transitions",
    exact: true,
  });
  const factor = page.getByRole("spinbutton", {
    name: "Easing factor",
    exact: true,
  });
  await toggle.check();
  await expect(factor).toHaveValue("0.5");
  await factor.fill("1.1");
  await expect(factor).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator(".field-error")).toContainText(
    "Easing factor must be from 0 to 1.",
  );
  await button(page, "Play animation").click();
  await expect(button(page, "Pause")).toHaveCount(0);
  // One announcement: the playback refusal. The field's own message is tied
  // to it through aria-errormessage, not a second alert.
  await expect(page.getByRole("alert")).toHaveCount(1);
  await expect(page.getByRole("alert")).toContainText(
    "Animation stopped: Easing factor must be from 0 to 1.",
  );
  for (const [value, fraction] of [
    ["0", 0.25],
    ["0.25", (0.25 + 53 / 512) / 2],
    ["0.5", 53 / 512],
    ["1", 6413 / 131072],
  ] as const) {
    await factor.fill(value);
    await expect(factor).not.toHaveAttribute("aria-invalid", "true");
    await button(page, "Play animation").click();
    await expect(button(page, "Replay")).toBeVisible({ timeout: 30_000 });
    await page
      .getByRole("slider", { name: "Animation progress", exact: true })
      .fill("0.25");
    await ready(page);
    await expect
      .poll(async () => (await camera(page)).scale / fit.scale)
      .toBeCloseTo(800 ** fraction, 8);
    await button(page, "Stop").click();
  }
  await toggle.uncheck();
  await expect(factor).toBeDisabled();
  await toggle.check();
  await expect(factor).toHaveValue("1");
  // An invalid factor is not kept behind the disabled field: turning easing
  // off restores the default, so playback ignores the factor as its help says.
  await factor.fill("1.1");
  await toggle.uncheck();
  await expect(factor).toHaveValue("0.5");
  await expect(factor).not.toHaveAttribute("aria-invalid", "true");
  await button(page, "Play animation").click();
  await expect(
    page.getByRole("button", { name: /^(Pause|Replay)$/ }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await button(page, "Stop").click();
  await toggle.check();
  await choosePreset(page, { label: star });
  await ready(page);
  await toggle.check();
  await expect(factor).toHaveValue("0.5");
});

test("the flight stands at each view exactly as the manual camera shows it, refined as finely", async ({
  page,
}) => {
  const fit = await openStar(page);
  // Views are named, and say where they are reached.
  await expect(page.getByLabel("View 2 name")).toHaveValue("Inside its point");
  await expect(page.getByText("reached 100% of the way")).toBeVisible();
  await showZoomed(page, "Show view 2");
  const shown = await camera(page);
  expect(shown.scale / fit.scale).toBeCloseTo(800, 9);
  expect(shown.cx).toBeCloseTo(flight.keys[1].x, 12);
  expect(shown.cy).toBeCloseTo(flight.keys[1].y, 12);
  await button(page, "Show view 1").click();
  await ready(page);
  expect((await camera(page)).scale).toBeCloseTo(fit.scale, 9);

  await page.getByRole("button", { name: "Play animation" }).click();
  await expect(button(page, "Replay")).toBeVisible({ timeout: 30_000 });
  const end = await camera(page);
  expect(end.scale).toBeCloseTo(shown.scale, 6);
  expect(end.cx).toBeCloseTo(shown.cx, 12);
  expect(end.cy).toBeCloseTo(shown.cy, 12);
  // The last frame is refined at least as finely as its view needs, as the
  // manual camera's is.
  const last = await innermostError(page);
  expect(last.measured).toBeGreaterThan(20);
  expect(last.worst).toBeLessThanOrEqual(1.5 * last.tolerance);
  await expect(
    page.locator(".animation-live, [role=status]").first(),
  ).toBeAttached();
});

test("between views the camera zooms by equal factors, the point comes to the middle, and each frame is refined to its view", async ({
  page,
}) => {
  const fit = await openStar(page);
  const whole = await innermost(page).getAttribute("d");
  // Started while the study is refined to the second view, the flight
  // still draws the first from the study refined to no view.
  await showZoomed(page, "Show view 2");
  await page.getByRole("button", { name: "Play animation" }).click();
  await expect(button(page, "Replay")).toBeVisible({ timeout: 30_000 });
  const slider = page.getByRole("slider", {
    name: "Animation progress",
    exact: true,
  });
  await slider.fill("0");
  await expect
    .poll(async () =>
      Number(await art(page).getAttribute("data-animation-progress")),
    )
    .toBe(0);
  // The first view is (0, 0), within 0.002 page units of the fitted
  // framing's center.
  const first = vertices((await innermost(page).getAttribute("d"))!),
    fitted = vertices(whole!);
  expect(first.length).toBe(fitted.length);
  for (let i = 0; i < first.length; i++)
    expect(
      Math.hypot(first[i][0] - fitted[i][0], first[i][1] - fitted[i][1]),
    ).toBeLessThan(0.01);
  for (const p of [0.25, 0.5, 0.9]) {
    await slider.fill(String(p));
    await expect
      .poll(async () =>
        Number(await art(page).getAttribute("data-animation-progress")),
      )
      .toBeCloseTo(p, 6);
    await expect(art(page)).not.toHaveAttribute("aria-busy", "true");
    const c = await camera(page);
    // Steady: ln zoom linear in progress.
    expect(Math.log(c.scale / fit.scale)).toBeCloseTo(p * Math.log(800), 6);
    // The framed point moves linearly in 1/zoom from the first view's
    // center to the second's, along y = 0.
    const sigma = (1 - fit.scale / c.scale) / (1 - 1 / 800);
    expect(c.cx).toBeCloseTo(flight.keys[1].x * sigma, 9);
    expect(c.cy).toBeCloseTo(0, 12);
  }
  // At 0.9, zoomed 400×, the innermost offset is drawn at least as finely
  // as the frame's own view needs.
  const at = await innermostError(page);
  expect(at.measured).toBeGreaterThan(20);
  expect(at.worst).toBeLessThanOrEqual(1.5 * at.tolerance);
});

test("views are taken from the drawing, set again and removed, and a path refuses what it cannot fly", async ({
  page,
}) => {
  const fit = await openStar(page);
  // A third view, from the drawing zoomed into the tip.
  const svg = art(page);
  for (let k = 0; k < 6; k++) {
    const box = (await svg.boundingBox())!;
    const ratio = Math.max(W / box.width, H / box.height);
    const c = await camera(page);
    await page.mouse.move(
      box.x + box.width / 2 + ((tip.x - c.cx) * c.scale) / ratio,
      box.y + box.height / 2 + (-(tip.y - c.cy) * c.scale) / ratio,
    );
    await page.mouse.wheel(0, -500);
  }
  await ready(page);
  const drawn = await camera(page);
  await button(page, "+ Add the drawing's view").click();
  await expect(page.getByLabel("View 3 name")).toBeVisible();
  const zoom = Number((drawn.scale / fit.scale).toPrecision(4));
  await expect(page.getByText(`zoom ${zoom}×`)).toBeVisible();
  // Shown again, it is the drawing it was taken from.
  await button(page, "Show view 1").click();
  await ready(page);
  await button(page, "Show view 3").click();
  await ready(page);
  const again = await camera(page);
  expect(again.scale).toBeCloseTo(drawn.scale, 6);
  expect(again.cx).toBeCloseTo(drawn.cx, 9);
  expect(again.cy).toBeCloseTo(drawn.cy, 9);
  // Moved to the front, it loses its leg time; removed, the rest close up.
  await button(page, "Move view 3 up").click();
  await expect(page.getByLabel("View 2 name")).toHaveValue("");
  await button(page, "Remove view 2").click();
  await button(page, "Remove view 2").click();
  await page.getByRole("button", { name: "Play animation" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Key views need at least two views to fly between.",
  );
  // A study not refined to its view flies no deeper than 20×.
  await page.reload();
  await openStar(page);
  await page
    .getByRole("checkbox", { name: "Refine to the view as you zoom" })
    .uncheck();
  await ready(page);
  await page.getByRole("button", { name: "Play animation" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "View 2 zooms past 20×; refine the study to its view to zoom further.",
  );
});

for (const ease of [false, true]) {
  test(`a flight's export starts at its first view and ends at its last${ease ? " with eased transitions" : ""}`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openStar(page, "0.4");
    if (ease)
      await page
        .getByRole("checkbox", {
          name: "Ease key-view transitions",
          exact: true,
        })
        .check();
    if (ease)
      await page
        .getByRole("spinbutton", { name: "Easing factor", exact: true })
        .fill("1");
    const stills: Buffer[] = [];
    for (const k of [1, 2]) {
      if (k === 1) {
        await button(page, "Show view 1").click();
        await ready(page);
      } else await showZoomed(page, `Show view ${k}`);
      stills.push(await still(page));
    }
    await open(page, "#export-settings");
    await page.getByLabel("Export format", { exact: true }).selectOption("mp4");
    await page.getByLabel("Export frame rate").selectOption("15");
    await page
      .getByRole("slider", { name: "Export resolution", exact: true })
      .fill("2");
    let middle: Buffer | undefined;
    if (ease) {
      await button(page, "Play animation").click();
      await expect(button(page, "Replay")).toBeVisible({ timeout: 30_000 });
      await page
        .getByRole("slider", { name: "Animation progress", exact: true })
        .fill("0.4");
      // The drawing is idle before the scrubbed frame starts, so wait for
      // the frame itself.
      await expect(art(page)).toHaveAttribute("data-animation-progress", "0.4");
      await ready(page);
      middle = await still(page);
      await button(page, "Stop").click();
    }
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /Export MP4/ }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("tangent-garden-offset-path.mp4");
    const path = (await file.path())!;
    const data = probe(path);
    if (data) {
      expect(data.frames).toBe(6);
      expect([data.width, data.height]).toEqual([2000, 1520]);
      expect(data.durations.reduce((a, b) => a + b, 0)).toBe(400);
    }
    const video = await decodeVideo(page, await readFile(path));
    expect(video.duration).toBeCloseTo(0.4, 3);
    expect(video.first.hash).not.toBe(video.last.hash);
    const match = (index: number, reference: Buffer) =>
      frameDifference(path, 2000, 1520, index, reference);
    const ends = [match(0, stills[0]), match(5, stills[1])];
    if (middle) {
      const between = match(2, middle);
      if (between) {
        expect(between.meanDifference).toBeLessThan(3);
        expect(between.unmatchedInk).toBeLessThan(0.05);
      }
    }
    const crossed = [match(0, stills[1]), match(5, stills[0])];
    if (ends[0] && ends[1] && crossed[0] && crossed[1]) {
      for (const d of ends) {
        expect(d.meanDifference).toBeLessThan(3);
        expect(d.unmatchedInk).toBeLessThan(0.05);
      }
      for (const d of crossed) expect(d.unmatchedInk).toBeGreaterThan(0.3);
    }
  });
}

// The drawing as a PNG at the page's size, as RGBA bytes.
async function still(page: Page) {
  const event = page.waitForEvent("download");
  await exportImage(page, "PNG");
  const png = await readFile((await (await event).path())!);
  const rgba = await page.evaluate(async (input) => {
    const image = new Image();
    image.src = `data:image/png;base64,${input}`;
    await image.decode();
    const c = document.createElement("canvas");
    c.width = image.width;
    c.height = image.height;
    const g = c.getContext("2d")!;
    g.drawImage(image, 0, 0);
    const data = g.getImageData(0, 0, c.width, c.height).data;
    let text = "";
    for (let i = 0; i < data.length; i += 0x8000)
      text += String.fromCharCode(...data.subarray(i, i + 0x8000));
    return btoa(text);
  }, png.toString("base64"));
  return Buffer.from(rgba, "base64");
}
