import { test, expect, type Page, type Locator } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { decodedFrame, decodeVideo, probe } from "./video";
import { wireStudy } from "./study-link-wire";
import { chooseColorScheme } from "./helpers";

// Three bodies (T2, #553): the study's model rules worked by hand, then its
// production path in the browser through the real worker: entry from the
// gallery over the retained study, seeks against the immutable history,
// edits, refusals and restoration, terminal states, links and exports. The
// integration's laws, limits and reference agreement are
// engine/threebody's tests.

const title = "Three bodies";
const eight = "Three bodies share a figure-eight";
const burrau = "Burrau's three-four-five problem";

test("samples are chosen by physical time, never past the history", async () => {
  const { sampleAt, pastSamples, refusedField, massesTotalOne } =
    await import("../web/threebody/model");
  const history = {
    times: [0, 0.5, 1, 1.5, 2],
    available: 3,
    final: { time: 1.2 },
  } as any;
  expect(sampleAt(history, 0)).toBe(0);
  expect(sampleAt(history, 0.49)).toBe(0);
  expect(sampleAt(history, 0.5)).toBe(1);
  expect(sampleAt(history, 1.1)).toBe(2);
  // Past the last available sample, never beyond it.
  expect(sampleAt(history, 1.9)).toBe(2);
  expect(sampleAt(history, -1)).toBe(0);
  expect(pastSamples(history)).toBe(true);
  expect(pastSamples({ ...history, final: { time: 1 } })).toBe(false);
  // A refusal names the control: a coordinate its own, a vector its x.
  expect(refusedField("bodies.1.position.y")).toBe("position-1-y");
  expect(refusedField("bodies.2.velocity")).toBe("velocity-2-x");
  expect(refusedField("bodies.0.mass")).toBe("mass-0-x");
  expect(refusedField("duration")).toBe("duration");
  expect(refusedField("samples")).toBeUndefined();
  const body = (mass: number) => ({
    mass,
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
  });
  expect(massesTotalOne([body(1 / 3), body(1 / 3), body(1 / 3)])).toBe(true);
  expect(massesTotalOne([body(0.5), body(0.25), body(0.26)])).toBe(false);
});

test("a configuration switch replaces the state and keeps the presentation", async () => {
  const { switchConfiguration, configurationStudy, threeBodyPresets } =
    await import("../web/threebody/model");
  const { threeBodyConfigurations, threeBodyNames } =
    await import("../web/threebody/configurations");
  const s = {
    ...configurationStudy("figure-eight"),
    bodies: structuredClone(
      [0, 1, 2].map(() => ({
        mass: 1 / 3,
        position: { x: 0.5, y: 0 },
        velocity: { x: 0, y: 0 },
      })),
    ) as any,
    duration: 7,
    trail: "whole" as const,
    window: 5,
    ghost: false,
    triangle: true,
    weight: "bold" as const,
    view: { x: 30, y: -20, zoom: 3 },
  };
  const next = switchConfiguration(s, "pythagorean");
  expect(next.bodies).toBeUndefined();
  expect(next.duration).toBeUndefined();
  expect(next).toMatchObject({
    configuration: "pythagorean",
    framing: "close",
    speed: threeBodyConfigurations.pythagorean.defaults.speed,
    view: { x: 0, y: 0, zoom: 1 },
    trail: "whole",
    window: 5,
    ghost: false,
    triangle: true,
    weight: "bold",
  });
  // Every configuration has its descriptor, and each gallery study opens
  // as its configuration's own.
  expect(Object.keys(threeBodyConfigurations).sort()).toEqual(
    [...threeBodyNames].sort(),
  );
  for (const p of threeBodyPresets)
    expect(p.study).toEqual(configurationStudy(p.study.configuration));
  expect(threeBodyPresets[0].title).toBe(eight);
});

const art = (d: Locator) => d.locator("#threebody-artwork");
const ready = (d: Locator) =>
  expect(art(d)).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
const status = (d: Locator) => d.locator(".threebody-status");
const slider = (d: Locator) =>
  d.getByRole("slider", { name: "Animation progress" });
const bodyField = (d: Locator, body: number, label: string) =>
  d
    .locator(`fieldset.threebody-body[data-body="${body}"]`)
    .getByLabel(label, { exact: true });
const refusal = (d: Locator, text: RegExp | string) =>
  d.locator(".field-error", { hasText: text });
async function openStudy(page: Page, name = eight) {
  await page.getByRole("button", { name: "Browse notebook examples" }).click();
  const gallery = page.getByRole("dialog", { name: "Notebook examples" });
  await gallery
    .locator(`[data-threebody-example][data-example-title="${name}"]`)
    .click();
  await gallery.waitFor({ state: "hidden" });
  const d = page.getByRole("dialog", { name: title });
  await ready(d);
  return d;
}
async function settled(page: Page) {
  await expect(page.locator(".app:visible .plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
}
// The drawing's parts: each body's trail vertex count, its marker's page
// position and fill, and the ghosts, triangle and any text.
async function picture(d: Locator) {
  return art(d).evaluate((svg) => ({
    trails: [...svg.querySelectorAll("path[data-role=trail]")].map(
      (p) => (p.getAttribute("d") ?? "").split(/[ML]/).length - 1,
    ),
    trailPaths: [...svg.querySelectorAll("path[data-role=trail]")].map((p) =>
      p.getAttribute("d"),
    ),
    heads: [...svg.querySelectorAll("circle[data-role=body]")].map((c) => ({
      body: Number(c.getAttribute("data-body")),
      x: Number(c.getAttribute("cx")),
      y: Number(c.getAttribute("cy")),
      fill: c.getAttribute("fill"),
    })),
    ghosts: svg.querySelectorAll("path[data-role=ghost]").length,
    triangle: svg.querySelectorAll("[data-role=triangle]").length,
    text: svg.querySelectorAll("text").length,
  }));
}
// The still's SVG and its record.
async function still(page: Page, d: Locator) {
  const download = page.waitForEvent("download");
  await d.getByRole("button", { name: /Export image/ }).click();
  await page.getByRole("menuitem", { name: /SVG/ }).click();
  const file = await download;
  const svg = Buffer.concat(
    await (await file.createReadStream()).toArray(),
  ).toString("utf8");
  const record = JSON.parse(
    svg
      .match(/<desc>([^<]*)<\/desc>/)![1]
      .replaceAll("&quot;", '"')
      .replaceAll("&amp;", "&"),
  );
  return { svg, record };
}
// A model point on the page at zoom 1 without a pan, by the record's frame.
const onPage = (f: { cx: number; cy: number; k: number }, v: any) => ({
  x: 500 + (v.x - f.cx) * f.k,
  y: 380 - (v.y - f.cy) * f.k,
});
// Seeks by the slider and waits for the drawing to show that progress.
async function seek(d: Locator, p: number) {
  await slider(d).fill(String(p));
  await expect(slider(d)).toHaveValue(String(p));
  await ready(d);
}

test("the study opens from the gallery over an untouched study and returns to it", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  const x = page.getByLabel("x(t)", { exact: true });
  await x.fill("cos(t) + 0.25");
  await settled(page);
  const d = await openStudy(page);
  // The opening view: each body's faint whole path, its marker and a
  // one-vertex trail, geometry only.
  const p = await picture(d);
  expect(p.heads.map((h) => h.body)).toEqual([1, 2, 3]);
  expect(p.ghosts).toBe(3);
  expect(p.trails).toEqual([1, 1, 1]);
  expect(p.triangle).toBe(0);
  expect(p.text).toBe(0);
  await expect(status(d)).toHaveText(
    "The integration reached the end at t = 32.8704.",
  );
  await expect(d.getByText("Periodicity.", { exact: true })).toBeVisible();
  await expect(
    d.getByText("Numerical evidence.", { exact: true }),
  ).toBeVisible();
  await d.getByLabel("The whole path, faintly").uncheck();
  expect((await picture(d)).ghosts).toBe(0);
  await d.getByRole("button", { name: "Return to study", exact: true }).click();
  await expect(d).toBeHidden();
  await expect(x).toHaveValue("cos(t) + 0.25");
  await expect(
    page.getByRole("button", { name: "Browse notebook examples" }),
  ).toBeFocused();
});

test("first, intermediate and last moments are the history's, with each body keeping its identity", async ({
  page,
}) => {
  await page.goto("/");
  const d = await openStudy(page);
  const first = await still(page, d);
  const { frame, bodies, final, samples } = first.record;
  expect(first.svg).not.toMatch(/<text/);
  expect(first.record.kind).toBe("three-bodies");
  expect(first.record.configuration).toBe("figure-eight");
  expect(first.record.edited).toBe(false);
  expect(samples).toMatchObject({ count: 20000, available: 20000 });
  // The first moment is the initial state itself.
  expect(first.record.shown.sample).toBe(0);
  expect(first.record.shown.time).toBe(0);
  first.record.shown.positions.forEach((v: any, i: number) => {
    expect(v.x).toBeCloseTo(bodies[i].position.x, 12);
    expect(v.y).toBeCloseTo(bodies[i].position.y, 12);
  });
  // The markers stand where the record puts them.
  const heads = (await picture(d)).heads;
  heads.forEach((h, i) => {
    const at = onPage(frame, first.record.shown.positions[i]);
    expect(h.x).toBeCloseTo(at.x, 1);
    expect(h.y).toBeCloseTo(at.y, 1);
  });
  const inks = heads.map((h) => h.fill);
  expect(new Set(inks).size).toBe(3);
  // A third of a period on, the choreography has moved each body to
  // another's start; a whole period on, each to its own. The period is the
  // corpus's, independent of the drawing (end = 3 periods).
  const end = first.record.duration;
  const T = end / 3;
  const start = bodies.map((b: any) => b.position);
  for (const [p, cyclic] of [
    [0.111, true],
    [0.333, false],
  ] as const) {
    await seek(d, p);
    const { record } = await still(page, d);
    const k = Math.floor((p * end) / (end / 19999) + 1e-9);
    expect(record.shown.sample).toBe(k);
    expect(record.shown.time).toBeCloseTo((end * k) / 19999, 12);
    expect(Math.abs(record.shown.time - (cyclic ? T / 3 : T))).toBeLessThan(
      0.02,
    );
    const owner = record.shown.positions.map((v: any) =>
      start.findIndex((s: any) => Math.hypot(s.x - v.x, s.y - v.y) < 0.05),
    );
    if (cyclic) {
      expect(owner.toSorted()).toEqual([0, 1, 2]);
      expect(owner.every((o: number, i: number) => o !== i)).toBe(true);
    } else expect(owner).toEqual([0, 1, 2]);
    // The same body keeps its ink wherever it has moved.
    expect((await picture(d)).heads.map((h) => h.fill)).toEqual(inks);
  }
  // The last moment is the final state.
  await seek(d, 1);
  const last = await still(page, d);
  expect(last.record.shown.time).toBe(final.time);
  last.record.shown.positions.forEach((v: any, i: number) => {
    expect(v.x).toBeCloseTo(final.positions[i].x, 12);
    expect(v.y).toBeCloseTo(final.positions[i].y, 12);
  });
  // A window keeps only its last time units; the whole trail every sample
  // to the end, simplified on the page.
  const whole = (await picture(d)).trails;
  await d.getByLabel("Trail", { exact: true }).selectOption("whole");
  expect((await picture(d)).trails[0]).toBeGreaterThan(whole[0]);
  await d.getByLabel("Connecting triangle").check();
  expect((await picture(d)).triangle).toBe(1);
});

test("scrubbing never makes a button blink", async ({ page }) => {
  await page.goto("/");
  const d = await openStudy(page);
  await page.evaluate(() => {
    const log: string[] = [];
    (window as any).blinks = log;
    const dialog = document.querySelector("dialog.threebody")!;
    new MutationObserver((m) =>
      m.forEach((r) => log.push((r.target as Element).textContent ?? "")),
    ).observe(dialog, {
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled"],
    });
  });
  const box = (await slider(d).boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++)
    await page.mouse.move(box.x + (box.width * i) / 20, box.y + box.height / 2);
  await page.mouse.up();
  // Stop becomes available once the thumb leaves the start, and nothing
  // else changes.
  expect(await page.evaluate(() => (window as any).blinks)).toEqual([
    "Stop motion",
  ]);
  await expect(art(d)).toHaveAttribute("aria-busy", "false");
});

test("playback runs the physical clock once, pauses, resumes and stops", async ({
  page,
}) => {
  await page.goto("/");
  const d = await openStudy(page);
  await d.getByLabel("Speed", { exact: true }).fill("20");
  const before = (await picture(d)).heads;
  await d.getByRole("button", { name: "Play motion" }).click();
  await d.getByRole("button", { name: "Pause motion" }).click();
  const paused = (await picture(d)).heads;
  expect(paused).not.toEqual(before);
  await expect(d.locator(".threebody-clock")).toContainText("Paused");
  await page.waitForTimeout(300);
  expect((await picture(d)).heads).toEqual(paused);
  await d.getByRole("button", { name: "Resume motion" }).click();
  // 32.87 time units at 20 a second: under two seconds to the end, where
  // it stays.
  await expect(d.getByRole("button", { name: "Play motion" })).toBeVisible({
    timeout: 10_000,
  });
  await expect(slider(d)).toHaveValue("1");
  await expect(d.locator(".threebody-clock")).toContainText(
    /t = 32\.870\d* of 32\.8704/,
  );
  const ended = (await picture(d)).heads;
  await page.waitForTimeout(500);
  expect((await picture(d)).heads).toEqual(ended);
  await d.getByRole("button", { name: "Stop motion" }).click();
  await expect(slider(d)).toHaveValue("0");
  expect((await picture(d)).heads).toEqual(before);
});

test("an encounter stops the history, and its last interval stays inspectable", async ({
  page,
}) => {
  await page.goto("/");
  const d = await openStudy(page);
  await d.getByLabel("Configuration", { exact: true }).selectOption("head-on");
  await expect(status(d)).toHaveText(
    /^The integration stopped at a close encounter at t = 0\.41257\d*: bodies 1 and 2 came within 0\.0001, before the 2 asked for\.$/,
    { timeout: 20_000 },
  );
  await seek(d, 1);
  const { record } = await still(page, d);
  expect(record.terminal.reason).toBe("encounter");
  expect(record.shown.sample).toBe("final");
  expect(record.shown.time).toBe(record.final.time);
  expect(record.samples.available).toBeLessThan(record.samples.count);
  const gap = Math.hypot(
    record.shown.positions[1].x - record.shown.positions[0].x,
    record.shown.positions[1].y - record.shown.positions[0].y,
  );
  expect(gap).toBeCloseTo(1e-4, 9);
  // The last sample before it, then the terminal state, and nothing more.
  const p = await picture(d);
  expect(p.trails[0]).toBeLessThanOrEqual(record.samples.available + 1);
  // Played through, it ends there rather than looping or restarting.
  await d.getByLabel("Speed", { exact: true }).fill("2");
  await d.getByRole("button", { name: "Play motion" }).click();
  await expect(d.getByRole("button", { name: "Play motion" })).toBeVisible();
  await expect(slider(d)).toHaveValue("1");
  await page.waitForTimeout(400);
  await expect(slider(d)).toHaveValue("1");
});

test("edits change one value at a time, are refused by field, and Restore brings back the whole configuration", async ({
  page,
}) => {
  await page.goto("/");
  const d = await openStudy(page);
  const x1 = bodyField(d, 1, "Position x");
  const preset = await x1.inputValue();
  // A total other than 1 is refused under the mass just changed; nothing
  // else changes.
  await bodyField(d, 1, "Mass").fill("0.5");
  await expect(
    refusal(d, "The masses must total 1; these total 1.16667."),
  ).toBeVisible();
  await expect(
    d.locator(
      'fieldset.threebody-body[data-body="1"] .field:has(.field-error) .field-label',
    ),
  ).toHaveText(/^Mass/);
  await expect(x1).toHaveValue(preset);
  await expect(bodyField(d, 2, "Mass")).toHaveValue("0.3333333333333333");
  await expect(d.getByRole("button", { name: "Play motion" })).toBeDisabled();
  await bodyField(d, 2, "Mass").fill("1/4");
  // Now under the mass just changed.
  await expect(
    d.locator('fieldset.threebody-body[data-body="2"] .field-error'),
  ).toHaveText("The masses must total 1; these total 1.08333.");
  await bodyField(d, 3, "Mass").fill("1/4");
  await expect(d.locator(".field-error")).toHaveCount(0);
  await ready(d);
  await expect(d.locator(".threebody-legend li").first()).toHaveText(
    "Body 1 · mass 0.5",
  );
  await expect(d.locator(".threebody-edited")).toContainText(
    "Edited from Figure-eight.",
  );
  // Coincident, distant and nonfinite starts, each under its control.
  await bodyField(d, 2, "Position x").fill(preset);
  await bodyField(d, 2, "Position y").fill(
    await bodyField(d, 1, "Position y").inputValue(),
  );
  const under = d.locator(
    'fieldset.threebody-body[data-body="2"] .field:has(.field-error)',
  );
  await expect(under.locator(".field-label")).toHaveText(/^Position x/);
  await expect(under.locator(".field-error")).toHaveText(
    /bodies 1 and 2 must start at least 0\.01 apart/,
  );
  await bodyField(d, 2, "Position x").fill("0.5");
  await bodyField(d, 3, "Position y").fill("11");
  await expect(
    refusal(d, "body 3: the position must be finite and within ±10"),
  ).toBeVisible();
  await bodyField(d, 3, "Position y").fill("0");
  await bodyField(d, 1, "Velocity y").fill("25");
  await expect(
    refusal(d, /body 1: the speed must be at most 20; it is 25/),
  ).toBeVisible();
  await bodyField(d, 1, "Velocity y").fill("1/0");
  await expect(d.locator(".field-error")).toHaveCount(1);
  await bodyField(d, 1, "Velocity y").fill("0.1");
  await d.getByLabel("Duration", { exact: true }).fill("150");
  await expect(
    refusal(d, "the duration must be positive and at most 100"),
  ).toBeVisible();
  await d.getByLabel("Duration", { exact: true }).fill("pi");
  await ready(d);
  await expect(d.locator(".field-error")).toHaveCount(0);
  await expect(status(d)).toContainText("at t = 3.14159");
  // Restore: the whole configuration, every field and the duration.
  await d.getByRole("button", { name: "Restore Figure-eight" }).click();
  await ready(d);
  await expect(d.locator(".threebody-edited")).toHaveCount(0);
  await expect(bodyField(d, 1, "Mass")).toHaveValue("0.3333333333333333");
  await expect(bodyField(d, 1, "Position x")).toHaveValue(preset);
  await expect(d.getByLabel("Duration", { exact: true })).toHaveValue(
    /^32\.8704\d+$/,
  );
  await expect(status(d)).toContainText("at t = 32.8704");
});

test("a configuration chosen while a value is pending is not overwritten by it", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    (window as any).held = [];
    Worker.prototype.postMessage = function (data: any, ...rest: any[]) {
      if ((window as any).hold && data.action === "scalars") {
        (window as any).held.push(() =>
          (post as any).call(this, data, ...rest),
        );
        return;
      }
      return (post as any).call(this, data, ...rest);
    };
  });
  await page.goto("/");
  const d = await openStudy(page);
  await page.evaluate(() => ((window as any).hold = true));
  await bodyField(d, 1, "Mass").fill("0.5");
  await expect
    .poll(() => page.evaluate(() => (window as any).held.length))
    .toBe(1);
  await d
    .getByLabel("Configuration", { exact: true })
    .selectOption("hierarchical");
  await page.evaluate(() => {
    (window as any).hold = false;
    for (const send of (window as any).held) send();
  });
  await ready(d);
  await expect(bodyField(d, 1, "Mass")).toHaveValue("0.4");
  await expect(d.locator(".field-error")).toHaveCount(0);
  await expect(d.locator(".threebody-edited")).toHaveCount(0);
  await expect(d.getByRole("button", { name: "Play motion" })).toBeEnabled();
});

test("a newer configuration replaces one still integrating", async ({
  page,
}) => {
  await page.goto("/");
  const d = await openStudy(page);
  const pick = d.getByLabel("Configuration", { exact: true });
  await pick.selectOption("pythagorean");
  await pick.selectOption("lagrange-equal");
  await pick.selectOption("figure-eight");
  await ready(d);
  await expect(status(d)).toContainText("reached the end at t = 32.8704");
  await page.waitForTimeout(1500);
  await expect(status(d)).toContainText("t = 32.8704");
  await expect(art(d)).toHaveAttribute("aria-busy", "false");
});

test("links save the study over the study it came from, older links open without it, and malformed fields are refused", async ({
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
  const d = await openStudy(page, burrau);
  await bodyField(d, 3, "Velocity x").fill("0.01");
  await d.getByLabel("Trail", { exact: true }).selectOption("window");
  await d.getByLabel("Trail length", { exact: true }).fill("2");
  await d.getByLabel("Connecting triangle").check();
  await d.getByLabel("Speed", { exact: true }).fill("3");
  await d.getByLabel("Line weight", { exact: true }).selectOption("fine");
  await ready(d);
  await seek(d, 0.5);
  const drawn = await picture(d);
  await d.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(d.getByText("Link copied", { exact: true })).toBeVisible();
  const link: string = await page.evaluate(() => (window as any).copied);
  const saved = wireStudy(new URL(link).hash.slice(3));
  expect(saved.garden).toBeUndefined();
  expect(saved.shorten).toBeUndefined();
  expect(saved.threeBody).toMatchObject({
    configuration: "pythagorean",
    trail: "window",
    window: 2,
    triangle: true,
    speed: 3,
    framing: "close",
    weight: "fine",
  });
  expect(saved.threeBody.bodies[2].velocity).toEqual({ x: 0.01, y: 0 });
  // Playback progress is never saved: the link opens at the start.
  expect(JSON.stringify(saved.threeBody)).not.toMatch(/progress/);
  await page.goto(link);
  const reopened = page.getByRole("dialog", { name: title });
  await ready(reopened);
  await expect(bodyField(reopened, 3, "Velocity x")).toHaveValue("0.01");
  await seek(reopened, 0.5);
  expect((await picture(reopened)).trailPaths).toEqual(drawn.trailPaths);
  const { planarStudy, presetStudy } = await import("../web/planar-link");
  // An older link has no threeBody field and opens without the study.
  expect(planarStudy(presetStudy(0)).threeBody).toBeUndefined();
  for (const [field, value, path] of [
    ["configuration", "four-body", "threeBody.configuration"],
    ["bodies", saved.threeBody.bodies.slice(0, 2), "threeBody.bodies"],
    ["duration", 0, "threeBody.duration"],
    ["duration", 101, "threeBody.duration"],
    ["speed", 0, "threeBody.speed"],
    ["trail", "comet", "threeBody.trail"],
    ["framing", "follow", "threeBody.framing"],
  ] as const)
    expect(() =>
      planarStudy({
        ...presetStudy(0),
        threeBody: { ...saved.threeBody, [field]: value },
      }),
    ).toThrow(path);
  const tooLight = structuredClone(saved.threeBody);
  tooLight.bodies[0].mass = 0;
  expect(() => planarStudy({ ...presetStudy(0), threeBody: tooLight })).toThrow(
    "threeBody.bodies[0].mass",
  );
});

test("the inks follow the color scheme in the drawing, legend and editor", async ({
  page,
}) => {
  await page.goto("/");
  await chooseColorScheme(page, "plum");
  const d = await openStudy(page);
  const fills = (await picture(d)).heads.map((h) => h.fill);
  const { schemeInks } = await import("../web/color-schemes");
  const inks = schemeInks("plum", false);
  expect(fills).toEqual([inks[0], inks[1], inks[3]]);
  const swatch = (scope: Locator) =>
    scope
      .locator(".threebody-swatch")
      .evaluateAll((s) => s.map((e) => getComputedStyle(e).backgroundColor));
  const legend = await swatch(d.locator(".threebody-legend"));
  const editor = await swatch(d.locator("aside"));
  expect(legend).toEqual(editor);
  expect(new Set(legend).size).toBe(3);
});

// The movie shows the frozen history on the physical clock: an independent
// decoder reads its frame count and duration, and its first and last
// frames show the initial and terminal states.
test("the movie export has the motion's frames, duration, endpoints and record", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/");
  const d = await openStudy(page);
  await d.getByLabel("Configuration", { exact: true }).selectOption("head-on");
  await ready(d);
  await d.getByLabel("Speed", { exact: true }).fill("0.2");
  const { record } = await still(page, d);
  const seconds = record.final.time / 0.2;
  const settings = d.locator("#threebody-export-settings");
  if (!(await settings.evaluate((e) => (e as HTMLDetailsElement).open)))
    await settings.locator("summary").click();
  await d.getByLabel("Export format", { exact: true }).selectOption("mp4");
  await d.getByRole("slider", { name: "Export resolution" }).fill("0.5");
  await d.getByLabel("Export frame rate", { exact: true }).selectOption("15");
  const download = page.waitForEvent("download");
  await d.getByRole("button", { name: /^Export MP4 video/ }).click();
  const path = (await (await download).path())!;
  const bytes = await readFile(path);
  expect(bytes.includes(Buffer.from('"kind":"three-bodies"'))).toBe(true);
  expect(bytes.includes(Buffer.from('"repeat":"once"'))).toBe(true);
  const frames = Math.ceil(seconds * 15);
  const timing = probe(path);
  if (timing) expect(timing.frames).toBe(frames);
  expect((await decodeVideo(page, bytes)).duration).toBeCloseTo(seconds, 2);
  // Body 1's marker, just above its center so no trail crosses it: at its
  // start in the first frame, gone from there in the last, which shows it
  // at the encounter.
  const ink = (rgb: Buffer, at: { x: number; y: number }) => {
    const i = (Math.round(at.y / 2) * 500 + Math.round(at.x / 2)) * 3;
    return [rgb[i], rgb[i + 1], rgb[i + 2]];
  };
  const first = decodedFrame(path, 500, 380, 0);
  const last = decodedFrame(path, 500, 380, frames - 1);
  if (first && last) {
    const start = onPage(record.frame, record.bodies[0].position);
    const met = onPage(record.frame, record.final.positions[0]);
    const above = (v: { x: number; y: number }) => ({ x: v.x, y: v.y - 6 });
    const near = (a: number[], b: number[]) =>
      a.every((c, i) => Math.abs(c - b[i]) < 40);
    const background = ink(first, { x: 20, y: 20 });
    expect(near(ink(first, above(start)), background)).toBe(false);
    expect(near(ink(last, above(start)), background)).toBe(true);
    expect(near(ink(last, above(met)), background)).toBe(false);
    expect(near(ink(first, above(met)), background)).toBe(true);
  }
  await expect(d.getByRole("button", { name: "Play motion" })).toBeEnabled();
});

for (const [name, viewport] of [
  ["phone portrait", { width: 390, height: 844 }],
  ["phone landscape", { width: 844, height: 390 }],
] as const)
  test(`the study fits a ${name} layout with every control reachable`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport,
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    await page.goto("/");
    const d = await openStudy(page);
    const box = (await art(d).boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.height).toBeLessThanOrEqual(viewport.height);
    expect(await d.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(
      true,
    );
    for (const control of [
      d.getByLabel("Configuration", { exact: true }),
      d.getByRole("button", { name: "Play motion" }),
      d.getByLabel("Speed", { exact: true }),
      d.getByRole("button", { name: /^Export (MP4 video|animated WebP)/ }),
      d.getByLabel("Trail", { exact: true }),
      d.getByLabel("Frame", { exact: true }),
      bodyField(d, 3, "Velocity y"),
      d.getByLabel("Duration", { exact: true }),
      d.getByLabel("Line weight", { exact: true }),
      d.getByRole("button", { name: "Return to study", exact: true }),
    ]) {
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeInViewport();
    }
    const play = d.getByRole("button", { name: "Play motion" });
    await play.scrollIntoViewIfNeeded();
    await play.click();
    await expect(d.getByRole("button", { name: "Pause motion" })).toBeVisible();
    await expect(art(d)).toBeInViewport({ ratio: 0.9 });
    await context.close();
  });

for (const [name, viewport] of [
  ["desktop", { width: 1280, height: 800 }],
  ["phone", { width: 390, height: 844 }],
] as const)
  test(`opening a paired help leaves its neighbor in place (${name})`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const d = await openStudy(page);
    const pairs: [string, string, Locator, Locator][] = [
      [
        "Trail",
        "Trail length",
        d.getByLabel("Trail", { exact: true }),
        d.getByLabel("Trail length", { exact: true }),
      ],
      ...[1, 2, 3].flatMap((i) =>
        (["position", "velocity"] as const).map(
          (kind): [string, string, Locator, Locator] => {
            const label = kind === "position" ? "Position" : "Velocity";
            return [
              `Body ${i} ${kind} x`,
              `Body ${i} ${kind} y`,
              bodyField(d, i, `${label} x`),
              bodyField(d, i, `${label} y`),
            ];
          },
        ),
      ),
    ];
    for (const [left, right, leftControl, rightControl] of pairs)
      for (const [open, control] of [
        [left, rightControl],
        [right, leftControl],
      ] as const) {
        await control.scrollIntoViewIfNeeded();
        const place = () =>
          control.evaluate((e) => {
            const pair = e.closest(".pair")!.getBoundingClientRect(),
              own = e.getBoundingClientRect();
            return { x: own.x - pair.x, y: own.y - pair.y };
          });
        const before = await place();
        const toggle = d.getByRole("button", {
          name: `About ${open}`,
          exact: true,
        });
        await toggle.click();
        const more = d
          .locator(`#${await toggle.getAttribute("aria-controls")}`)
          .getByRole("button", { name: "Show more" });
        if (await more.count()) await more.click();
        expect(await place(), `${open} beside its neighbor`).toEqual(before);
        await toggle.click();
      }
  });

// Burrau's ejected body flies far out: the whole history's frame shrinks
// the dance, and the close dance's keeps it large, each fixed for the
// history whatever the moment shown.
test("the close dance frames the encounters without the fleeing body", async ({
  page,
}) => {
  await page.goto("/");
  const d = await openStudy(page, burrau);
  await expect(d.getByLabel("Frame", { exact: true })).toHaveValue("close");
  const close = (await still(page, d)).record;
  await seek(d, 1);
  expect((await still(page, d)).record.frame).toEqual(close.frame);
  await d.getByLabel("Frame", { exact: true }).selectOption("whole");
  const whole = (await still(page, d)).record;
  expect(whole.frame.k).toBeLessThan(close.frame.k / 2);
  // The whole history's frame holds every body to the end; the close
  // dance's lets the ejected one leave it.
  const inside = (f: any, v: any) => {
    const p = onPage(f, v);
    return p.x >= 0 && p.x <= 1000 && p.y >= 0 && p.y <= 760;
  };
  expect(whole.final.positions.every((v: any) => inside(whole.frame, v))).toBe(
    true,
  );
  expect(close.final.positions.some((v: any) => !inside(close.frame, v))).toBe(
    true,
  );
});

// Returning to the history already shown, while another is still being
// prepared, drops that one: its reply never replaces the drawing.
test("a configuration abandoned before its history arrives never shows", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    (window as any).held = [];
    Worker.prototype.postMessage = function (data: any, ...rest: any[]) {
      if ((window as any).hold && data.action === "threeBody") {
        (window as any).held.push(() =>
          (post as any).call(this, data, ...rest),
        );
        return;
      }
      return (post as any).call(this, data, ...rest);
    };
  });
  await page.goto("/");
  const d = await openStudy(page);
  await page.evaluate(() => {
    (window as any).hold = true;
    (window as any).seen = [];
    const status = document.querySelector(".threebody-status")!;
    new MutationObserver(() =>
      (window as any).seen.push(status.textContent),
    ).observe(status, { subtree: true, characterData: true, childList: true });
  });
  const pick = d.getByLabel("Configuration", { exact: true });
  await pick.selectOption("pythagorean");
  await expect
    .poll(() => page.evaluate(() => (window as any).held.length))
    .toBe(1);
  await pick.selectOption("figure-eight");
  await page.evaluate(() => {
    (window as any).hold = false;
    for (const send of (window as any).held) send();
  });
  await page.waitForTimeout(1000);
  await ready(d);
  await expect(status(d)).toContainText("t = 32.8704");
  expect(
    await page.evaluate(() => (window as any).seen.join(" ")),
  ).not.toContain("43.121");
});
