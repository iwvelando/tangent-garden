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
const eightTwin = "A figure-eight and its twin";
const burrauTwin = "Burrau's problem and a twin";

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
  // A twin example is its configuration's study with that
  // configuration's twin.
  for (const p of threeBodyPresets) {
    const { twin, ...study } = p.study;
    expect(study).toEqual(configurationStudy(p.study.configuration));
    if (twin)
      expect(twin).toEqual(threeBodyConfigurations[study.configuration].twin);
  }
  expect(threeBodyPresets[0].title).toBe(eight);
  expect(
    threeBodyPresets.filter((p) => p.study.twin).map((p) => p.title),
  ).toEqual([eightTwin, burrauTwin]);
  // A comparison follows a configuration switch with the new one's twin.
  const compared = { ...s, twin: threeBodyConfigurations["figure-eight"].twin };
  expect(switchConfiguration(compared, "pythagorean").twin).toEqual(
    threeBodyConfigurations.pythagorean.twin,
  );
  expect(switchConfiguration(s, "pythagorean").twin).toBeUndefined();
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
      stroke: c.getAttribute("stroke"),
    })),
    twinTrailPaths: [...svg.querySelectorAll("path[data-role=twin-trail]")].map(
      (p) => p.getAttribute("d"),
    ),
    twinHeads: [...svg.querySelectorAll("circle[data-role=twin-body]")].map(
      (c) => ({
        body: Number(c.getAttribute("data-body")),
        x: Number(c.getAttribute("cx")),
        y: Number(c.getAttribute("cy")),
        stroke: c.getAttribute("stroke"),
        fill: c.getAttribute("fill"),
      }),
    ),
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
      twinToggle(d),
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
    const d = await openStudy(page, eightTwin);
    const pairs: [string, string, Locator, Locator][] = [
      [
        "Body",
        "Component",
        d.getByLabel("Body", { exact: true }),
        d.getByLabel("Component", { exact: true }),
      ],
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

// A presentation value being retyped, emptied or out of range is refused
// under its field: the drawing keeps the last trail length it could draw,
// and nothing that would record the refused value is offered.
test("a refused speed or trail length keeps the drawing and holds back the link and exports", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  const d = await openStudy(page);
  await seek(d, 0.5);
  const drawn = await picture(d);
  const link = d.getByRole("button", { name: "Copy link", exact: true });
  const image = d.getByRole("button", { name: /Export image/ });
  const movie = d.getByRole("button", {
    name: /^Export (MP4 video|animated WebP)/,
  });
  await expect(link).toBeEnabled();
  await expect(image).toBeEnabled();
  await expect(movie).toBeEnabled();
  const length = d.getByLabel("Trail length", { exact: true });
  for (const value of ["", "0", "500"]) {
    await length.fill(value);
    await expect(
      refusal(d, "Trail length must be 0.01–100 time units."),
    ).toBeVisible();
    expect((await picture(d)).trailPaths).toEqual(drawn.trailPaths);
    await expect(link).toBeDisabled();
    await expect(image).toBeDisabled();
    await expect(movie).toBeDisabled();
  }
  // Whole trails put back the last length admitted, so the refused one
  // cannot return with the moving window.
  const trail = d.getByLabel("Trail", { exact: true });
  await trail.selectOption("whole");
  await expect(link).toBeEnabled();
  await trail.selectOption("window");
  await expect(length).toHaveValue("3");
  expect((await picture(d)).trailPaths).toEqual(drawn.trailPaths);
  await length.fill("1");
  await expect(d.locator(".field-error")).toHaveCount(0);
  await expect(link).toBeEnabled();
  expect((await picture(d)).trails[0]).toBeLessThan(drawn.trails[0]);
  const speed = d.getByLabel("Speed", { exact: true });
  for (const value of ["", "200"]) {
    await speed.fill(value);
    await expect(
      refusal(d, "Speed must be 0.01–100 time units per second."),
    ).toBeVisible();
    await expect(link).toBeDisabled();
  }
  await speed.fill("2");
  await expect(link).toBeEnabled();
  expect(errors).toEqual([]);
});

// The configurations come from the engine; if they cannot be read, the
// study says so and offers to try again rather than waiting forever.
test("configurations that cannot be read are reported, and Try again reads them", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  await page.route(/\.wasm/, (r) => r.abort());
  await page.getByRole("button", { name: "Browse notebook examples" }).click();
  const gallery = page.getByRole("dialog", { name: "Notebook examples" });
  await gallery
    .locator(`[data-threebody-example][data-example-title="${eight}"]`)
    .click();
  const d = page.getByRole("dialog", { name: title });
  const again = d.getByRole("button", { name: "Try again", exact: true });
  await expect(again).toBeVisible();
  await page.unroute(/\.wasm/);
  await again.click();
  await ready(d);
  await expect(status(d)).toContainText("t = 32.8704");
  await expect(again).toHaveCount(0);
});

// Twins (T3, #554): a second history from one declared component moved,
// prepared with the first in one worker call, drawn on its clock and in its
// frame, and compared only while both last.
test("a twin's perturbation, shift and clock are the declared ones", async () => {
  const { twinShift, pairEnd, refusedField, configurationTwin } =
    await import("../web/threebody/model");
  const body = (mass: number) => ({
    mass,
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
  });
  const bodies = [body(0.25), body(1 / 3), body(5 / 12)];
  const twin = { body: 0, kind: "position", axis: "x", size: 3e-4 } as const;
  // The other two move together by −mᵢ·size/(mⱼ + mₖ), only when kept.
  expect(twinShift(bodies, { ...twin, conserve: false })).toBe(0);
  expect(twinShift(bodies, { ...twin, conserve: true })).toBeCloseTo(
    (-0.25 * 3e-4) / 0.75,
    18,
  );
  expect(refusedField("twin.size")).toBe("twin-size");
  const h = (end: number) => ({ final: { time: end } }) as any;
  expect(pairEnd(h(3), h(5))).toBe(5);
  expect(pairEnd(h(5), h(3))).toBe(5);
  expect(pairEnd(h(3))).toBe(3);
  // A copy, so an edit never reaches the descriptor.
  const a = configurationTwin("pythagorean");
  a.size = 7;
  expect(configurationTwin("pythagorean").size).toBe(1e-4);
});

const twinToggle = (d: Locator) =>
  d.getByRole("checkbox", { name: "Compare with a twin" });
const twinSize = (d: Locator) => d.getByLabel("Size", { exact: true });
const fact = (d: Locator, name: string) =>
  d.locator(".threebody-comparison dt", { hasText: name }).locator("+ dd");

test("a twin shares the history's clock and frame, and a zero twin is the history exactly", async ({
  page,
}) => {
  await page.goto("/");
  const d = await openStudy(page);
  const singleFrame = (await still(page, d)).record.frame;
  await seek(d, 0.5);
  const single = await picture(d);
  expect(single.twinHeads).toEqual([]);
  await twinToggle(d).check();
  await ready(d);
  await expect(d.locator(".threebody-key")).toBeVisible();
  // The descriptor's twin: body 1 sped up 0.01 in x, keeping momentum.
  await expect(d.getByLabel("Body", { exact: true })).toHaveValue("0");
  await expect(d.getByLabel("Component", { exact: true })).toHaveValue(
    "velocity-x",
  );
  await expect(twinSize(d)).toHaveValue("0.01");
  await expect(
    d.getByRole("checkbox", { name: "Keep the center of mass and momentum" }),
  ).toBeChecked();
  await expect(d.locator(".threebody-twin-statement")).toHaveText(
    "The twin's body 1 starts with velocity x larger by 0.01 velocity units. Body 2 and Body 3 each start smaller by 0.005, so the momentum is unchanged; nothing else differs.",
  );
  // The comparison changes what is integrated, so the motion starts over;
  // a velocity twin starts where the history does and has moved apart by
  // the middle.
  await expect(slider(d)).toHaveValue("0");
  await seek(d, 0.5);
  const half = await picture(d);
  expect(half.twinHeads.map((h) => h.body)).toEqual([1, 2, 3]);
  expect(half.twinHeads).not.toEqual(
    half.heads.map((h) => expect.objectContaining({ x: h.x, y: h.y })),
  );
  await seek(d, 0);
  const start = await picture(d);
  expect(start.twinHeads.map(({ x, y }) => ({ x, y }))).toEqual(
    start.heads.map(({ x, y }) => ({ x, y })),
  );
  // Hollow markers in the bodies' own inks: filled with the background
  // the reference's markers are ringed with.
  expect(start.twinHeads.map((h) => h.stroke)).toEqual(
    start.heads.map((h) => h.fill),
  );
  expect(start.twinHeads.map((h) => h.fill)).toEqual(
    start.heads.map((h) => h.stroke),
  );
  // A zero twin: the same samples, so the same drawing, and no separation.
  await twinSize(d).fill("0");
  await ready(d);
  await seek(d, 0.5);
  const zero = await picture(d);
  expect(zero.twinTrailPaths).toEqual(zero.trailPaths);
  expect(zero.twinHeads.map(({ x, y }) => ({ x, y }))).toEqual(
    zero.heads.map(({ x, y }) => ({ x, y })),
  );
  // Both share the single history's frame.
  expect(zero.trailPaths).toEqual(single.trailPaths);
  await expect(d.locator(".threebody-separation")).toHaveText(
    "Farthest any body is from its twin: 0",
  );
  await expect(fact(d, "Largest separation")).toHaveText(/^0 at t = 0$/);
  await expect(fact(d, "Past 0.001")).toHaveText("not within the comparison");
  await expect(d.locator(".threebody-twin-statement")).toContainText(
    "The twin is the history itself.",
  );
  // A twin that reaches past the history widens the shared frame: body 1
  // moved out 0.1 without compensation shifts the twin's whole dance.
  await d.getByLabel("Component", { exact: true }).selectOption("position-x");
  await d
    .getByRole("checkbox", { name: "Keep the center of mass and momentum" })
    .uncheck();
  await twinSize(d).fill("-0.1");
  await ready(d);
  const wide = (await still(page, d)).record;
  expect(wide.frame.k).toBeLessThan(singleFrame.k * 0.99);
  expect(wide.frame.cx).toBeLessThan(singleFrame.cx);
  // Without the comparison the study is the single history again.
  await twinToggle(d).uncheck();
  await ready(d);
  await seek(d, 0.5);
  const again = await picture(d);
  expect(again.twinHeads).toEqual([]);
  expect(again.trailPaths).toEqual(single.trailPaths);
  await expect(d.locator(".threebody-key")).toHaveCount(0);
});

test("a twin is refused by its own field, ends a motion, and follows a configuration", async ({
  page,
}) => {
  await page.goto("/");
  const d = await openStudy(page, eightTwin);
  await d.getByRole("button", { name: "Play motion" }).click();
  await expect(d.getByRole("button", { name: "Pause motion" })).toBeVisible();
  await twinSize(d).fill("0.02");
  // An edit to the twin changes the second history, so the motion ends.
  await expect(d.getByRole("button", { name: "Play motion" })).toBeVisible();
  await expect(slider(d)).toHaveValue("0");
  await ready(d);
  await twinSize(d).fill("0.2");
  await expect(refusal(d, "within ±0.1")).toBeVisible();
  await expect(d.locator(".study-error")).toHaveCount(0);
  // A twin whose starting state the engine refuses is refused on its size.
  await bodyField(d, 1, "Position x").fill("9.95");
  await d.getByLabel("Component", { exact: true }).selectOption("position-x");
  await d
    .getByRole("checkbox", { name: "Keep the center of mass and momentum" })
    .uncheck();
  await twinSize(d).fill("0.1");
  await expect(refusal(d, "twin's starting state is refused")).toBeVisible();
  await expect(d.getByRole("button", { name: "Copy link" })).toBeDisabled();
  await twinSize(d).fill("-0.1");
  await ready(d);
  await expect(refusal(d, /./)).toHaveCount(0);
  // Turned off and on again, the comparison keeps its twin.
  await twinToggle(d).uncheck();
  await ready(d);
  await twinToggle(d).check();
  await expect(twinSize(d)).toHaveValue("-0.1");
  await expect(d.getByLabel("Component", { exact: true })).toHaveValue(
    "position-x",
  );
  await ready(d);
  // Another configuration brings its own twin.
  await d
    .getByLabel("Configuration", { exact: true })
    .selectOption("pythagorean");
  await ready(d);
  await expect(twinSize(d)).toHaveValue("0.0001");
  await expect(
    d.getByRole("checkbox", { name: "Keep the center of mass and momentum" }),
  ).not.toBeChecked();
  await twinToggle(d).uncheck();
  await twinToggle(d).check();
  await expect(twinSize(d)).toHaveValue("0.0001");
});

test("Burrau's twins part while both are accurate, and throw body 1 out opposite ways", async ({
  page,
}) => {
  await page.goto("/");
  const d = await openStudy(page, burrauTwin);
  // The WASM build's crossings (docs/mathematics.md, three bodies).
  await expect(fact(d, "Past 0.001")).toHaveText(/^t = 17\.\d$/);
  await expect(fact(d, "Past 0.1")).toHaveText(/^t = 2[45]\.\d+$/);
  await expect(fact(d, "Compared")).toHaveText(
    "t = 0 to 43.121, 20,000 shared samples",
  );
  await expect(d.locator(".threebody-twin-evidence")).toContainText(
    "pass 10⁻³ apart at t = 17.1",
  );
  // The readout is the shown sample's separation: the farthest any body
  // is from its own twin.
  await seek(d, 0.5);
  const middle = (await still(page, d)).record;
  const apart = Math.max(
    ...middle.shown.positions.map((v: any, i: number) =>
      Math.hypot(
        middle.twinShown.positions[i].x - v.x,
        middle.twinShown.positions[i].y - v.y,
      ),
    ),
  );
  expect(apart).toBeGreaterThan(1e-3);
  expect(
    Number(
      await d.locator(".threebody-separation").getAttribute("data-separation"),
    ),
  ).toBeCloseTo(apart, 12);
  await seek(d, 1);
  const { record } = await still(page, d);
  expect(record.twin.perturbation).toMatchObject({
    body: 0,
    kind: "position",
    axis: "x",
    size: 1e-4,
    conserve: false,
    units: "length units",
    others: 0,
  });
  expect(record.twin.bodies[0].position.x).toBe(
    record.bodies[0].position.x + 1e-4,
  );
  expect(record.twin.comparison.common).toBe(20000);
  // Body 1 leaves the history upward and the twin downward.
  expect(record.final.positions[0].y).toBeGreaterThan(3);
  expect(record.twin.final.positions[0].y).toBeLessThan(-3);
  expect(record.twinShown.time).toBe(record.shown.time);
});

test("when the twin stops first the comparison ends there and nothing is extrapolated", async ({
  page,
}) => {
  await page.goto("/");
  const d = await openStudy(page, burrauTwin);
  await twinSize(d).fill("0.01");
  await ready(d);
  // The evidence is about the example's own twin, not this one.
  await expect(d.locator(".threebody-twin-evidence")).toHaveCount(0);
  await expect(status(d)).toContainText(
    /The twin stopped at a close encounter at t = 9\.7\d*: bodies 2 and 3/,
  );
  await expect(fact(d, "Compared")).toHaveText(
    /^t = 0 to 9\.7\d*, [\d,]+ shared samples; the twin stopped first$/,
  );
  // The clock runs on to the history's end, with the twin held at its
  // terminal state and no separation claimed past the comparison.
  await seek(d, 1);
  await expect(d.locator(".threebody-clock")).toContainText(
    "t = 43.1210 of 43.121",
  );
  await expect(d.locator(".threebody-separation")).toHaveText(
    /^Compared until t = 9\.7\d*, where the twin stopped$/,
  );
  const { record } = await still(page, d);
  expect(record.twinShown.sample).toBe("final");
  expect(record.twinShown.positions).toEqual(record.twin.final.positions);
  const drawn = await picture(d);
  for (const [i, h] of drawn.twinHeads.entries()) {
    const at = onPage(record.frame, record.twin.final.positions[i]);
    expect(h.x).toBeCloseTo(at.x, 1);
    expect(h.y).toBeCloseTo(at.y, 1);
  }
});

test("a twin changed while preparing is replaced, and turning it off drops it", async ({
  page,
}) => {
  await page.goto("/");
  const d = await openStudy(page, burrauTwin);
  // Each change supersedes the pair before it; only the last arrives.
  for (const size of ["0.0002", "0.0003", "0.0004"])
    await twinSize(d).fill(size);
  await ready(d);
  const { record } = await still(page, d);
  expect(record.twin.perturbation.size).toBe(4e-4);
  // Turned off before its pair arrives, the single history shows.
  await twinSize(d).fill("0.0005");
  await twinToggle(d).uncheck();
  await ready(d);
  await page.waitForTimeout(500);
  expect((await picture(d)).twinHeads).toEqual([]);
  const single = await still(page, d);
  expect(single.record.twin).toBeUndefined();
});

test("scrubbing a comparison never makes a button blink", async ({ page }) => {
  await page.goto("/");
  const d = await openStudy(page, burrauTwin);
  await slider(d).scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const log: string[] = [];
    (window as any).blinks = log;
    new MutationObserver((m) =>
      m.forEach((r) => log.push((r.target as Element).textContent ?? "")),
    ).observe(document.querySelector("dialog.threebody")!, {
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
  expect(await page.evaluate(() => (window as any).blinks)).toEqual([
    "Stop motion",
  ]);
});

test("a comparison's link saves its twin, and older links open without one", async ({
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
  const d = await openStudy(page, eightTwin);
  await d.getByLabel("Body", { exact: true }).selectOption("2");
  await d.getByLabel("Component", { exact: true }).selectOption("position-y");
  await twinSize(d).fill("-0.05");
  await ready(d);
  await seek(d, 0.5);
  const drawn = await picture(d);
  await d.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(d.getByText("Link copied", { exact: true })).toBeVisible();
  const link: string = await page.evaluate(() => (window as any).copied);
  const saved = wireStudy(new URL(link).hash.slice(3));
  expect(saved.threeBody.twin).toEqual({
    body: 2,
    kind: "position",
    axis: "y",
    size: -0.05,
    conserve: true,
  });
  await page.goto(link);
  const reopened = page.getByRole("dialog", { name: title });
  await ready(reopened);
  await expect(twinToggle(reopened)).toBeChecked();
  await seek(reopened, 0.5);
  const again = await picture(reopened);
  expect(again.twinTrailPaths).toEqual(drawn.twinTrailPaths);
  expect(again.trailPaths).toEqual(drawn.trailPaths);
  const { planarStudy, presetStudy } = await import("../web/planar-link");
  const { twin: _, ...older } = saved.threeBody;
  expect(
    planarStudy({ ...presetStudy(0), threeBody: older }).threeBody!.twin,
  ).toBeUndefined();
  for (const [field, value, path] of [
    ["body", 3, "threeBody.twin.body"],
    ["body", 0.5, "threeBody.twin.body"],
    ["kind", "spin", "threeBody.twin.kind"],
    ["axis", "z", "threeBody.twin.axis"],
    ["size", 0.2, "threeBody.twin.size"],
    ["conserve", "yes", "threeBody.twin.conserve"],
  ] as const)
    expect(() =>
      planarStudy({
        ...presetStudy(0),
        threeBody: {
          ...saved.threeBody,
          twin: { ...saved.threeBody.twin, [field]: value },
        },
      }),
    ).toThrow(path);
});

// The paired movie: one clock to the later end, both histories in one
// frame. The history stops at the head-on encounter while its twin, body 1
// raised 0.1, passes and goes on.
test("the paired movie holds both histories on one clock, with their endpoints and record", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/");
  const d = await openStudy(page);
  await d.getByLabel("Configuration", { exact: true }).selectOption("head-on");
  await ready(d);
  await twinToggle(d).check();
  await d.getByLabel("Body", { exact: true }).selectOption("0");
  await d.getByLabel("Component", { exact: true }).selectOption("position-y");
  await twinSize(d).fill("0.1");
  await d.getByLabel("Trail", { exact: true }).selectOption("window");
  await d.getByLabel("Trail length", { exact: true }).fill("0.02");
  await d.getByLabel("The whole path, faintly").uncheck();
  await d.getByLabel("Speed", { exact: true }).fill("1");
  await ready(d);
  const { record } = await still(page, d);
  expect(record.terminal.reason).toBe("encounter");
  const end = Math.max(record.final.time, record.twin.final.time);
  expect(end).toBeGreaterThan(record.final.time);
  // The frame fits the twin's history too, though it outlives the history.
  for (const v of [...record.twin.final.positions, ...record.final.positions]) {
    const at = onPage(record.frame, v);
    expect(at.x).toBeGreaterThanOrEqual(0);
    expect(at.x).toBeLessThanOrEqual(1000);
    expect(at.y).toBeGreaterThanOrEqual(0);
    expect(at.y).toBeLessThanOrEqual(760);
  }
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
  expect(bytes.includes(Buffer.from('"perturbation":{"body":0'))).toBe(true);
  const frames = Math.ceil(end * 15);
  const timing = probe(path);
  if (timing) expect(timing.frames).toBe(frames);
  expect((await decodeVideo(page, bytes)).duration).toBeCloseTo(end, 2);
  const ink = (rgb: Buffer, at: { x: number; y: number }) => {
    const i = (Math.round(at.y / 2) * 500 + Math.round(at.x / 2)) * 3;
    return [rgb[i], rgb[i + 1], rgb[i + 2]];
  };
  const first = decodedFrame(path, 500, 380, 0);
  const last = decodedFrame(path, 500, 380, frames - 1);
  if (first && last) {
    const background = ink(first, { x: 20, y: 20 });
    const near = (a: number[], b: number[]) =>
      a.every((c, i) => Math.abs(c - b[i]) < 40);
    // A hollow marker: some ink on its ring.
    const ring = (rgb: Buffer, v: any, r: number) =>
      [...Array(12).keys()].some(
        (j) =>
          !near(
            ink(rgb, {
              x: v.x + r * Math.cos((j * Math.PI) / 6),
              y: v.y + r * Math.sin((j * Math.PI) / 6),
            }),
            background,
          ),
      );
    const r = 4 + 10 * Math.sqrt(record.bodies[0].mass);
    const start = onPage(record.frame, record.twin.bodies[0].position);
    const gone = onPage(record.frame, record.twin.final.positions[0]);
    expect(ring(first, start, r)).toBe(true);
    expect(ring(last, start, r)).toBe(false);
    expect(ring(last, gone, r)).toBe(true);
    expect(ring(first, gone, r)).toBe(false);
    // The history stays at its encounter, held to the twin's end.
    const met = onPage(record.frame, record.final.positions[0]);
    expect(near(ink(last, { x: met.x, y: met.y - 6 }), background)).toBe(false);
  }
});
