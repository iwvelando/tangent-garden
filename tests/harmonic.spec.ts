import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  applyTracks,
  availableTargets,
  reveal,
  targetLabel,
} from "../web/animation";
import { boundText } from "../web/engine-client";
import { closureNote, nextTerm, periodText } from "../web/harmonic";
import { fitFrame } from "../web/Plot";
import { presets } from "../web/presets";
import type { Result, Vec } from "../web/types";
import { exportImage, openAnimation, choosePreset } from "./helpers";
import { FourierFitSession, fittedStudy } from "../web/fourier-fit";
import type { Frame } from "../web/types";
import {
  checkFitMouseAndReturn,
  checkFitPlaybackLayout,
  checkFitAdoptionVisibility,
  fitDialog,
  leafFit,
  openFit,
} from "./fourier-fit-checks";
import { readStudyLink, writeStudyLink } from "../web/study-link";
import { decodePng } from "./png";
import { decodeVideo, probe as probeMovie } from "./video";
import { openExportSettings } from "./helpers";

test("drawing playback stays beside its scrubber immediately below the visible art in both phone orientations", async ({
  page,
}) => {
  await checkFitPlaybackLayout(page);
});

test("drawing adoption stays visible as a primary action from capture through preview", async ({
  page,
}) => {
  await checkFitAdoptionVisibility(page);
});

test("drawing entry explains arbitrary shapes before Fourier details and labels the leaf as an example", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  const entry = page.getByRole("button", { name: "Draw a loop", exact: true });
  const toggle = page.getByRole("button", {
    name: "About Draw a loop",
    exact: true,
  });
  await expect(toggle).toBeVisible();
  const before = (await entry.boundingBox())!;
  const icon = (await toggle.boundingBox())!;
  expect(icon.x).toBeGreaterThan(before.x + before.width);
  expect(
    Math.abs(icon.y + icon.height / 2 - before.y - before.height / 2),
  ).toBeLessThan(2);
  await toggle.click();
  const help = page.locator(`#${await toggle.getAttribute("aria-controls")}`);
  await expect(help.locator(".hint-brief")).toContainText("Draw any shape");
  await expect(help.locator(".hint-brief")).toContainText("editable study");
  await expect(help.locator(".hint-more")).toBeHidden();
  await expect(entry).toHaveAttribute(
    "aria-describedby",
    (await help.getAttribute("id"))!,
  );
  await expect(fitDialog(page)).toBeHidden();
  await help.getByRole("button", { name: "Show more", exact: true }).click();
  await expect(help.locator(".hint-more")).toContainText("Fourier");
  await expect(help.locator(".hint-more")).toContainText("rotating circles");
  await expect(help.locator(".hint-more")).toContainText("4,096");
  expect((await entry.boundingBox())!.y).toBe(before.y);
  await toggle.click();
  await toggle.click();
  await expect(help.locator(".hint-more")).toBeHidden();
  await entry.click();
  const dialog = fitDialog(page);
  await expect(
    dialog.getByRole("heading", {
      name: "1. Draw or try an example",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Use example leaf", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: /^Sample leaf$/, exact: true }),
  ).toHaveCount(0);
});

test("drawing presents an example leaf without mathematical-sounding capture labels", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  const dialog = await openFit(page);
  await expect(
    dialog.getByRole("button", { name: "Use example leaf", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("heading", {
      name: "1. Draw or try an example",
      exact: true,
    }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Use example leaf", exact: true })
    .click();
  await expect(dialog.getByTestId("stroke-reference")).toHaveAttribute(
    "data-point-count",
    "29",
  );
  await expect(dialog.getByTestId("stroke-reference")).toHaveAttribute(
    "data-closed",
    "false",
  );
});

test("adopted drawing links, stills and decoded reveal match an equivalent ordinary Fourier study", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await settled(page);
  await page.getByLabel("Line weight", { exact: true }).selectOption("bold");
  await page.getByLabel("Duration (seconds)", { exact: true }).fill("7");
  const dialog = await leafFit(page);
  await expect(
    dialog.getByText(/A short offset is ready to show/),
  ).toBeVisible();
  await dialog
    .getByLabel("Show original outline in preview", { exact: true })
    .check();
  const terms = JSON.parse(
    (await dialog.locator("#fit-artwork desc").textContent())!,
  ).curve.terms;
  await dialog.getByRole("button", { name: "Adopt fitted study" }).click();
  await expect
    .poll(async () => (await definition(page)).curve.format)
    .toBe("fourier");
  await settled(page);
  await expect(page.getByLabel("Line weight", { exact: true })).toHaveValue(
    "regular",
  );
  await expect(
    page.getByLabel("Duration (seconds)", { exact: true }),
  ).toHaveValue("10");
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  const linked = await readStudyLink(url.split("#s=")[1]);
  const expected = fittedStudy(terms);
  expect(linked).toEqual({ notebook: "2d", study: expected });
  expect(JSON.stringify(linked)).not.toMatch(/stroke|residual|rawPoints/);
  await page.mouse.click(1, 1);
  // Existing controls now operate on the fit's ordinary evaluator.
  await page.getByRole("button", { name: "inversion", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "Derived curve", exact: true })
    .check();
  await settled(page);
  const config = await definition(page);
  expect(config.kind).toBe("inversion");
  expect(config.curve.terms).toEqual(terms);
  const ordinary = {
    ...expected,
    config,
    layers: { ...expected.layers, derived: true },
  };
  const ordinaryURL = `/#s=${await writeStudyLink("2d", ordinary)}`;
  const still = async (kind: "SVG" | "PNG") => {
    const save = page.waitForEvent("download");
    await exportImage(page, kind);
    return readFile((await (await save).path())!);
  };
  const movie = async () => {
    await openExportSettings(page);
    await page.getByLabel("Duration (seconds)", { exact: true }).fill(".4");
    await page
      .getByLabel("Export frame rate", { exact: true })
      .selectOption("15");
    await page.getByLabel("Export resolution", { exact: true }).fill("0.5");
    await page.getByLabel("Export format", { exact: true }).selectOption("mp4");
    const save = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export MP4 video" }).click();
    const path = (await (await save).path())!;
    const independent = probeMovie(path);
    if (independent) {
      expect(independent.frames).toBe(6);
      expect(independent.durations.reduce((a, b) => a + b, 0)).toBe(400);
    }
    return decodeVideo(page, await readFile(path));
  };
  const svg = await still("SVG"),
    png = decodePng(await still("PNG")),
    video = await movie();
  expect(svg.toString()).not.toContain("<text");
  expect(svg.toString()).not.toContain("stroke-reference");
  expect(video.duration).toBeCloseTo(0.4, 3);
  expect(video.first.hash).not.toBe(video.last.hash);
  await page.goto(ordinaryURL);
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
  await settled(page);
  expect(
    (await still("SVG")).toString().replace(/<desc>.*?<\/desc>/s, ""),
  ).toBe(svg.toString().replace(/<desc>.*?<\/desc>/s, ""));
  const normalPNG = decodePng(await still("PNG"));
  expect([normalPNG.width, normalPNG.height]).toEqual([png.width, png.height]);
  expect(Buffer.from(normalPNG.rgba)).toEqual(Buffer.from(png.rgba));
  const normalVideo = await movie();
  expect(normalVideo).toEqual(video);
  await choosePreset(page, 0);
  await settled(page);
  expect((await definition(page)).curve.format).toBe("parametric");
});

test("delayed drawing work is disposed on reset, cancel and a replacement link", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Original = Worker;
    (window as any).fitWorkers = [];
    (window as any).releaseFits = [];
    window.Worker = class extends Original {
      tracked: any;
      postMessage(data: any, ...rest: any[]) {
        if (data.action === "fourier-fit") {
          this.tracked ??= { terminated: false };
          (window as any).fitWorkers.push(this.tracked);
          (window as any).releaseFits.push(() =>
            super.postMessage(data, ...rest),
          );
        } else super.postMessage(data, ...rest);
      }
      terminate() {
        if (this.tracked) this.tracked.terminated = true;
        super.terminate();
      }
    };
  });
  await page.goto("/");
  await settled(page);
  const dialog = await openFit(page);
  const begin = async () => {
    await dialog
      .getByRole("button", { name: "Use example leaf", exact: true })
      .click();
    await dialog.getByRole("button", { name: "Close outline" }).click();
    await expect(dialog.locator(".fit-result")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  };
  await begin();
  await dialog.getByRole("button", { name: "Reset outline" }).click();
  expect(
    await page.evaluate(() => (window as any).fitWorkers.at(-1).terminated),
  ).toBe(true);
  await begin();
  await dialog.getByRole("button", { name: "Cancel drawing" }).click();
  expect(
    await page.evaluate(() => (window as any).fitWorkers.at(-1).terminated),
  ).toBe(true);
  await openFit(page);
  await begin();
  const replacement = fittedStudy([
    { frequency: 0, radius: 0, phase: 0 },
    { frequency: 1, radius: 2, phase: 0 },
  ]);
  await page.goto(`/#s=${await writeStudyLink("2d", replacement)}`);
  await expect(dialog).toBeHidden();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
  expect(
    await page.evaluate(() => (window as any).fitWorkers.at(-1).terminated),
  ).toBe(true);
  await expect
    .poll(async () => (await definition(page)).curve.terms)
    .toEqual(replacement.config.curve.terms);
  await page.evaluate(() => {
    for (const release of (window as any).releaseFits) release();
  });
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("Definition", { exact: true })).toHaveValue(
    "fourier",
  );
});

test("drawing captures a real mouse stroke, preserves geometry on resize and returns raw drafts and camera", async ({
  page,
}) => {
  await checkFitMouseAndReturn(page);
});

test("drawing entry settles pending scalars and defers invalid original work", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    (window as any).releaseFitScalar = () => {};
    Worker.prototype.postMessage = function (data: any, ...rest: any[]) {
      if (data.action === "scalars")
        (window as any).releaseFitScalar = () => post.call(this, data, ...rest);
      else post.call(this, data, ...rest);
    };
  });
  await page.goto("/");
  await settled(page);
  const scalar = page.getByLabel("Shape parameter a", { exact: true });
  await scalar.fill("2*pi");
  await page.getByRole("button", { name: "Draw a loop", exact: true }).click();
  await expect(fitDialog(page)).toBeHidden();
  await page.evaluate(() => (window as any).releaseFitScalar());
  await expect(fitDialog(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(scalar).toHaveValue("2*pi");
  await scalar.fill("sqrt(-1)");
  await page.getByRole("button", { name: "Draw a loop", exact: true }).click();
  await page.evaluate(() => (window as any).releaseFitScalar());
  await expect(
    page.getByText("Correct the highlighted input before drawing a loop.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(fitDialog(page)).toBeHidden();
  await expect(scalar).toHaveValue("sqrt(-1)");
  await expect(scalar).toHaveAttribute("aria-invalid", "true");
});

test("drawing captures real pen and touch in equal-scale coordinates and replaces drafts", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await settled(page);
  const dialog = await openFit(page),
    surface = dialog.getByTestId("stroke-reference");
  await surface.scrollIntoViewIfNeeded();
  const cdp = await context.newCDPSession(page);
  const box = (await surface.boundingBox())!;
  const positions = [
    [0.2, 0.3],
    [0.8, 0.3],
    [0.5, 0.8],
  ];
  const event = (p: number[]) => ({
    x: box.x + p[0] * box.width,
    y: box.y + p[1] * box.height,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    ...event(positions[0]),
    button: "left",
    buttons: 1,
    clickCount: 1,
    pointerType: "pen",
  });
  for (const p of positions.slice(1))
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      ...event(p),
      button: "left",
      buttons: 1,
      pointerType: "pen",
    });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    ...event(positions[2]),
    button: "left",
    buttons: 0,
    clickCount: 1,
    pointerType: "pen",
  });
  const pen = await surface.locator("polyline").getAttribute("points");
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...event(positions[0]), id: 7 }],
  });
  for (const p of positions.slice(1))
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ ...event(p), id: 7 }],
    });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  const touch = await surface.locator("polyline").getAttribute("points");
  const parse = (s: string) =>
    s.split(" ").map((p) => p.split(",").map(Number));
  expect(parse(touch!)).toEqual(parse(pen!));
  expect(parse(touch!)[0][0]).toBeCloseTo(-1.8, 1);
  expect(parse(touch!)[0][1]).toBeCloseTo(-0.912, 1); // SVG y-down; model y is +.912.
  await expect(surface).toHaveAttribute("data-closed", "false");
  await dialog.getByRole("button", { name: "Close outline" }).click();
  await expect(
    dialog.getByRole("button", { name: "Adopt fitted study" }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Reset outline" }).click();
  await expect(surface).toHaveAttribute("data-point-count", "0");
  await expect(
    dialog.getByRole("button", { name: "Adopt fitted study" }),
  ).toBeDisabled();
});

test("drawing caps visible samples and handles lost pointer capture and touch cancellation", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await settled(page);
  const dialog = await openFit(page),
    surface = dialog.getByTestId("stroke-reference");
  const box = (await surface.boundingBox())!;
  await surface.evaluate((s) =>
    s.addEventListener(
      "pointerdown",
      (e) => {
        (s as SVGSVGElement).dataset.pointer = String(
          (e as PointerEvent).pointerId,
        );
      },
      { once: true },
    ),
  );
  await page.mouse.move(box.x + 50, box.y + 50);
  await page.mouse.down();
  await surface.evaluate((s, box) => {
    const id = Number((s as SVGSVGElement).dataset.pointer);
    for (let j = 0; j < 4100; j++)
      s.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerId: id,
          isPrimary: true,
          clientX: box.x + 50 + (j % 100),
          clientY: box.y + 50 + Math.floor(j / 100),
        }),
      );
  }, box);
  await expect(surface).toHaveAttribute("data-point-count", "4096");
  await expect(dialog.getByRole("status")).toContainText(
    "4,096 points reached",
  );
  await surface.evaluate((s) =>
    s.releasePointerCapture(Number((s as SVGSVGElement).dataset.pointer)),
  );
  await page.mouse.up();
  await expect(dialog.getByRole("status")).toContainText("Stroke interrupted");
  await expect(surface).toHaveAttribute("data-closed", "false");
  await dialog.getByRole("button", { name: "Close outline" }).click();
  await expect(
    dialog.getByRole("button", { name: "Adopt fitted study" }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Reset outline" }).click();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: box.x + 100, y: box.y + 100, id: 1 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchCancel",
    touchPoints: [],
  });
  await expect(dialog.getByRole("status")).toContainText("Stroke interrupted");
  await expect(
    dialog.getByRole("button", { name: "Use example leaf", exact: true }),
  ).toBeEnabled();
});

for (const dark of [false, true])
  test(`drawing geometry and keyboard controls at phone width with ${dark ? "dark" : "light"} alternate colors`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: dark ? "dark" : "light" });
    await page.addInitScript(() =>
      localStorage.setItem("tangent-garden.color-scheme", "forest"),
    );
    await page.goto("/");
    await settled(page);
    await page
      .getByRole("button", { name: "Draw a loop", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    const dialog = fitDialog(page);
    const title = (await dialog
      .getByRole("heading", { name: "Your leaf, made of circles" })
      .boundingBox())!;
    const cancel = (await dialog
      .getByRole("button", { name: "Cancel drawing" })
      .boundingBox())!;
    expect(cancel.x).toBeGreaterThan(title.x + 100);
    expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
      true,
    );
    await dialog
      .getByRole("button", { name: "Use example leaf", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await dialog.getByRole("button", { name: "Close outline" }).focus();
    await page.keyboard.press("Enter");
    await expect(
      dialog.getByRole("button", { name: "Adopt fitted study" }),
    ).toBeEnabled();
    await expect(dialog.locator("svg text")).toHaveCount(0);
    const inks = await dialog
      .getByTestId("stroke-reference")
      .locator("polygon")
      .evaluate((p) => ({
        stroke: getComputedStyle(p).stroke,
        ink: getComputedStyle(p).getPropertyValue("--base-ink").trim(),
      }));
    const rgb = inks.ink.match(/[a-f\d]{2}/gi)!.map((n) => parseInt(n, 16));
    expect(inks.stroke).toBe(`rgb(${rgb.join(", ")})`);
    await dialog
      .getByLabel("Show original outline in preview", { exact: true })
      .check();
    await expect(dialog.getByTestId("fit-reference")).toBeVisible();
    await dialog.getByLabel("Preview position", { exact: true }).fill("0.5");
    await dialog.screenshot({
      path: info.outputPath(`fit-phone-${dark ? "dark" : "light"}.png`),
    });
    await page.keyboard.press("Escape");
  });

test("drawn Fourier term edits retain geometry and residual layout while fitting", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (q: any, ...rest: any[]) {
      if (q.action === "fourier-fit")
        setTimeout(() => send.call(this, q, ...rest), 250);
      else send.call(this, q, ...rest);
    };
  });
  await page.goto("/");
  const d = await leafFit(page);
  const residual = d.getByTestId("fit-residuals"),
    checkbox = d.getByLabel("Show original outline in preview", {
      exact: true,
    });
  const text = await residual.textContent(),
    oldBox = (await checkbox.boundingBox())!;
  const oldPath = await d.locator("#fit-artwork").innerHTML();
  await d.getByLabel("Total terms", { exact: true }).selectOption("12");
  await expect(d.locator(".fit-result")).toHaveAttribute("aria-busy", "true");
  expect(await residual.count()).toBe(1);
  expect(await residual.textContent()).toBe(text);
  expect(await d.locator("#fit-artwork").innerHTML()).toBe(oldPath);
  expect((await checkbox.boundingBox())!.y).toBe(oldBox.y);
  await expect(
    d.getByRole("button", { name: "Adopt fitted study", exact: true }),
  ).toBeEnabled();
  expect(await residual.textContent()).not.toBe(text);
});

test("drawn Fourier fitting coalesces selection, owns replies and refuses stale adoption", async () => {
  const jobs: {
    kind: string;
    count?: number;
    resolve: (v: any) => void;
    reject: (e: Error) => void;
  }[] = [];
  let disposed = 0;
  const factory = () => ({
    fitFourier: (count: number) =>
      new Promise<any>((resolve, reject) =>
        jobs.push({ kind: "fit", count, resolve, reject }),
      ),
    compute: () =>
      new Promise<Frame>((resolve, reject) =>
        jobs.push({ kind: "compute", resolve, reject }),
      ),
    dispose: () => {
      disposed++;
    },
  });
  const states: any[] = [];
  const session = new FourierFitSession(factory, (s) => states.push(s));
  const points = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ];
  const fit = (n: number) => ({
    terms: Array.from({ length: n }, (_, j) => ({
      frequency: j,
      radius: 1,
      phase: 0,
    })),
    rms: 1,
    maxResidual: 2,
    sampleCount: 1024,
    length: 4,
  });
  const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  session.close(points);
  expect(jobs).toHaveLength(1);
  session.select(16);
  session.select(3);
  session.select(12);
  expect(session.candidate()).toBeNull();
  expect(jobs).toHaveLength(1);
  jobs.shift()!.resolve(fit(8));
  await flush();
  expect(jobs.map((j) => [j.kind, j.count])).toEqual([["fit", 12]]);
  jobs.shift()!.resolve(fit(12));
  await flush();
  expect(jobs[0].kind).toBe("compute");
  session.select(16);
  jobs
    .shift()!
    .resolve({ config: fittedStudy(fit(12).terms).config, result: {} });
  await flush();
  expect(session.candidate()).toBeNull();
  expect(jobs[0].count).toBe(16);
  session.cancel();
  expect(disposed).toBe(1);
  const count = states.length;
  jobs.shift()!.reject(new Error("late failure"));
  await flush();
  expect(states).toHaveLength(count);
  session.close(points);
  jobs.shift()!.resolve(fit(16));
  await flush();
  jobs
    .shift()!
    .resolve({ config: fittedStudy(fit(16).terms).config, result: {} });
  await flush();
  expect(session.candidate()?.config.curve.terms).toEqual(fit(16).terms);
  const adopted = session.candidate()!;
  adopted.config.curve.terms[0].radius = 99;
  expect(session.candidate()!.config.curve.terms[0].radius).toBe(1);
  session.cancel();
});

test("drawn Fourier fitting keeps a refused stroke's reason when the term count changes", async () => {
  // Go keeps no fit after refusing a stroke, so a count-only request could
  // only report a missing outline while Close is already spent.
  const sent: (Vec[] | undefined)[] = [];
  const states: any[] = [];
  const client = {
    fitFourier: async (_count: number, points?: Vec[]) => {
      sent.push(points);
      throw new Error(
        points
          ? "an outline needs at least three distinct points"
          : "close a valid outline before selecting terms",
      );
    },
    compute: async () => ({}) as Frame,
    dispose: () => {},
  };
  const session = new FourierFitSession(
    () => client,
    (s) => states.push(s),
  );
  const flush = async () => {
    for (let j = 0; j < 10; j++) await Promise.resolve();
  };
  const tap = [
    { x: 1, y: 1 },
    { x: 1, y: 1 },
  ];
  session.close(tap);
  await flush();
  expect(states.at(-1).error).toMatch(/three distinct/);
  session.select(12);
  await flush();
  expect(sent).toEqual([tap, tap]);
  expect(states.at(-1)).toMatchObject({ count: 12, pending: false });
  expect(states.at(-1).error).toMatch(/three distinct/);
  session.cancel();
});

test("drawn Fourier fitting rejects an obsolete computation error and continues the latest selection", async () => {
  const jobs: { resolve: (v: any) => void; reject: (e: Error) => void }[] = [];
  const fit = {
    terms: [
      { frequency: 0, radius: 0, phase: 0 },
      { frequency: 1, radius: 1, phase: 0 },
    ],
    rms: 0,
    maxResidual: 0,
    sampleCount: 1024,
    length: 6,
  };
  const states: any[] = [];
  const client = {
    fitFourier: () =>
      new Promise<any>((resolve, reject) => jobs.push({ resolve, reject })),
    compute: () =>
      new Promise<any>((resolve, reject) => jobs.push({ resolve, reject })),
    dispose: () => {},
  };
  const session = new FourierFitSession(
    () => client,
    (s) => states.push(s),
  );
  const flush = async () => {
    for (let j = 0; j < 10; j++) await Promise.resolve();
  };
  session.close([
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ]);
  jobs.shift()!.resolve(fit);
  await flush();
  session.select(16);
  jobs.shift()!.reject(new Error("obsolete preview failed"));
  await flush();
  expect(states.at(-1).error).toBeUndefined();
  expect(jobs).toHaveLength(1);
  jobs.shift()!.resolve(fit);
  await flush();
  jobs.shift()!.resolve({ config: fittedStudy(fit.terms).config, result: {} });
  await flush();
  expect(session.candidate()).not.toBeNull();
  session.cancel();
});

test("a fitted study opens with short offset normals and a clean opt-in reveal", () => {
  const study = fittedStudy([
    { frequency: 0, radius: 0, phase: 0 },
    { frequency: 1, radius: 1, phase: 0 },
  ]);
  expect(study.config.kind).toBe("offset");
  expect(study.config.distance).toBe(0.15);
  expect(study.config.input).toBe("curve");
  expect(study.config.stack.enabled).toBe(false);
  expect(study.config.circles).toBe(false);
  expect(study.layers).toEqual({
    base: true,
    derived: false,
    lines: true,
    definitionGuides: true,
    rollingGuides: true,
    incident: true,
    virtual: true,
    axes: false,
  });
  expect(study.animation.mode).toBe("reveal");
  expect(study.animation.tracks).toEqual([]);
  expect(study.animation.phrase).toBeUndefined();
  expect(study.family).toBeUndefined();
  expect(study.probe.enabled).toBe(false);
});

const lissajousTitle = "Lissajous 3 : 2 & its pedal";
test("drawn leaf closes explicitly, previews ordinary epicycles and adopts a complete custom study", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  const original = await definition(page);
  await page.getByRole("button", { name: "Draw a loop", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Your leaf, made of circles",
  });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: "Use example leaf", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Adopt fitted study" }),
  ).toBeDisabled();
  await expect(
    dialog.locator("[data-testid=stroke-reference]"),
  ).toHaveAttribute("data-closed", "false");
  await dialog.getByRole("button", { name: "Close outline" }).click();
  await expect(
    dialog.locator("[data-testid=stroke-reference]"),
  ).toHaveAttribute("data-closed", "true");
  await expect(
    dialog.getByRole("button", { name: "Adopt fitted study" }),
  ).toBeEnabled();
  await expect(dialog.getByTestId("epicycles")).toBeVisible();
  const eight = JSON.parse(
    (await dialog.locator("#fit-artwork desc").textContent())!,
  );
  expect(eight.curve.terms).toHaveLength(8);
  await dialog.getByLabel("Total terms", { exact: true }).selectOption("16");
  await expect(
    dialog.getByRole("button", { name: "Adopt fitted study" }),
  ).toBeEnabled();
  const sixteen = JSON.parse(
    (await dialog.locator("#fit-artwork desc").textContent())!,
  );
  expect(sixteen.curve.terms).toHaveLength(16);
  expect(sixteen.curve.terms.slice(0, 8)).toEqual(eight.curve.terms);
  await dialog.getByRole("button", { name: "Cancel drawing" }).click();
  await expect(dialog).toBeHidden();
  expect(await definition(page)).toEqual(original);
  await expect(
    page.getByRole("button", { name: "Draw a loop", exact: true }),
  ).toBeFocused();
  await page
    .getByRole("button", { name: "Draw a loop", exact: true })
    .press("Enter");
  await dialog
    .getByRole("button", { name: "Use example leaf", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Close outline" }).click();
  await expect(
    dialog.getByRole("button", { name: "Adopt fitted study" }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Adopt fitted study" }).click();
  await settled(page);
  await expect
    .poll(async () => (await definition(page)).curve.format)
    .toBe("fourier");
  const adopted = await definition(page);
  expect(adopted.curve.format).toBe("fourier");
  expect(adopted.curve.terms).toHaveLength(8);
  expect(adopted.input).toBe("curve");
  expect([adopted.curve.min, adopted.curve.max]).toEqual([0, 2 * Math.PI]);
  expect(adopted.kind).toBe("offset");
  await expect(page.getByTestId("epicycles")).toBeVisible();
  await expect(page.locator("[data-testid=stroke-reference]")).toHaveCount(0);
});
const fourierTitle = "Epicycles, turned inside out";
const irrationalTitle = "Lissajous √2 : 1, never closing";
const preset = (title: string) =>
  presets.find((p) => p.title === title)!.config;
async function ready(page: Page, title: string) {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await choosePreset(page, { label: title });
  await settled(page);
}
async function settled(page: Page) {
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.locator("#artwork")).toBeVisible();
}
async function definition(page: Page) {
  return JSON.parse((await page.locator("#artwork desc").textContent())!);
}
async function progress(page: Page) {
  return Number(
    await page.locator("#artwork").getAttribute("data-animation-progress"),
  );
}
const field = (page: Page, name: string) =>
  page.getByLabel(name, { exact: true });
const note = (page: Page) => page.getByTestId("closure-note");
const epicycles = (page: Page) => page.getByTestId("epicycles");
const traceButton = (page: Page) =>
  page.getByRole("button", { name: "Trace one full period" });
const to = (page: Page) =>
  page.getByRole("textbox", { name: "to", exact: true });
const scale = async (page: Page) =>
  Number(await page.locator("#artwork").getAttribute("data-camera-scale"));
async function toScreen(page: Page, p: Vec) {
  const [cx, cy] = (await page
    .locator("#artwork")
    .getAttribute("data-camera-center"))!
    .split(",")
    .map(Number);
  const s = await scale(page);
  return { x: 500 + (p.x - cx) * s, y: 380 - (p.y - cy) * s };
}
const circles = (page: Page, testId: string) =>
  page
    .getByTestId(testId)
    .evaluateAll((all) =>
      all.map((c) => ["cx", "cy", "r"].map((k) => Number(c.getAttribute(k)))),
    );
const segments = (page: Page, testId: string) =>
  page
    .getByTestId(testId)
    .locator("line")
    .evaluateAll((all) =>
      all.map((l) =>
        ["x1", "y1", "x2", "y2"].map((k) => Number(l.getAttribute(k))),
      ),
    );

test("the harmonic presets define a Lissajous figure, epicycles, and an incommensurate ratio", () => {
  const figure = preset(lissajousTitle);
  expect(figure.kind).toBe("pedal");
  expect(figure.curve.format).toBe("lissajous");
  expect(figure.curve.lissajous).toEqual({
    amplitudeX: 1,
    amplitudeY: 1,
    frequencyX: 3,
    frequencyY: 2,
    phase: Math.PI / 2,
  });
  expect([figure.curve.min, figure.curve.max]).toEqual([0, 2 * Math.PI]);
  const star = preset(fourierTitle);
  expect(star.kind).toBe("inversion");
  expect(star.curve.format).toBe("fourier");
  expect(star.curve.terms).toEqual([
    { frequency: 1, radius: 1, phase: 0 },
    { frequency: -4, radius: 0.45, phase: 0 },
    { frequency: 6, radius: 0.2, phase: 0 },
  ]);
  const open = preset(irrationalTitle);
  expect(open.kind).toBe("pedal");
  expect(open.curve.lissajous.frequencyX).toBe(Math.SQRT2);
  expect(open.curve.max).toBe(12 * Math.PI);
});

test("harmonic parameters are animatable, exactly at both endpoints", () => {
  const figure = preset(lissajousTitle);
  const targets = availableTargets(figure);
  expect(targets.slice(0, 5)).toEqual([
    "lissajousPhase",
    "lissajousM",
    "lissajousN",
    "lissajousA",
    "lissajousB",
  ]);
  // The shape comes from the generator, not the expression coefficient.
  expect(targets).not.toContain("a");
  expect(targetLabel("lissajousPhase")).toBe("Phase φ (radians)");
  const lissajousTracks = [
    { target: "lissajousPhase" as const, from: 0, to: Math.PI / 3 },
    { target: "lissajousM" as const, from: 3, to: Math.SQRT2 },
    { target: "lissajousA" as const, from: 1, to: Math.E },
  ];
  expect(
    applyTracks(figure, lissajousTracks, 1, 1).config.curve.lissajous,
  ).toEqual({
    amplitudeX: Math.E,
    amplitudeY: 1,
    frequencyX: Math.SQRT2,
    frequencyY: 2,
    phase: Math.PI / 3,
  });
  const star = preset(fourierTitle);
  const terms = availableTargets(star);
  // Every term's phase, radius, and frequency, numbered from 1.
  expect(terms.slice(0, 9)).toEqual([
    "term1Phase",
    "term1Radius",
    "term1Frequency",
    "term2Phase",
    "term2Radius",
    "term2Frequency",
    "term3Phase",
    "term3Radius",
    "term3Frequency",
  ]);
  expect(terms).not.toContain("term4Phase");
  expect(terms).not.toContain("a");
  expect(terms).not.toContain("lissajousPhase");
  expect(availableTargets(presets[0].config)).not.toContain("term1Phase");
  expect(targetLabel("term12Radius")).toBe("Radius r₁₂");
  expect(targetLabel("term2Frequency")).toBe("Frequency k₂");
  expect(targetLabel("term3Phase")).toBe("Phase φ₃");
  const tracks = [
    { target: "term2Phase" as const, from: 0, to: Math.PI / 5 },
    { target: "term3Radius" as const, from: 0.2, to: 1 / Math.E },
    { target: "term1Frequency" as const, from: 1, to: Math.SQRT2 },
  ];
  expect(applyTracks(star, tracks, 0, 1).config.curve.terms).toEqual([
    { frequency: 1, radius: 1, phase: 0 },
    { frequency: -4, radius: 0.45, phase: 0 },
    { frequency: 6, radius: 0.2, phase: 0 },
  ]);
  expect(applyTracks(star, tracks, 1, 1).config.curve.terms).toEqual([
    { frequency: Math.SQRT2, radius: 1, phase: 0 },
    { frequency: -4, radius: 0.45, phase: Math.PI / 5 },
    { frequency: 6, radius: 1 / Math.E, phase: 0 },
  ]);
  // A track for a term that no longer exists changes nothing.
  expect(
    applyTracks(star, [{ target: "term9Phase", from: 0, to: 1 }], 1, 1).config,
  ).toEqual(star);
  // The base study is never mutated.
  expect(star.curve.terms[1].phase).toBe(0);
  expect(figure.curve.lissajous.phase).toBe(Math.PI / 2);
});

test("closure reads as whole, rational, open, or still; added terms turn the other way", () => {
  expect(periodText(2 * Math.PI)).toEqual({ text: "2π", expression: "2*pi" });
  expect(periodText(Math.PI)).toEqual({ text: "π", expression: "pi" });
  // Fields show simple fractions of pi as such, only when exact.
  expect(boundText(Math.PI / 2)).toBe("pi/2");
  expect(boundText(-Math.PI / 2)).toBe("-pi/2");
  expect(boundText((3 * Math.PI) / 4)).toBe("3*pi/4");
  expect(boundText((-5 * Math.PI) / 12)).toBe("-5*pi/12");
  expect(boundText(Math.PI / 13)).toBe(String(Math.PI / 13));
  expect(boundText(Math.PI / 2 + 1e-15)).toBe(String(Math.PI / 2 + 1e-15));
  expect(boundText(0.25)).toBe("0.25");
  expect(periodText((2 * Math.PI) / 3)).toEqual({
    text: "2π/3",
    expression: "2*pi/3",
  });
  expect(periodText(70 * Math.PI).expression).toBe("70*pi");
  expect(periodText(2 * Math.PI * Math.SQRT2)).toEqual({
    text: "8.88577",
    expression: String(2 * Math.PI * Math.SQRT2),
  });
  const result = {
    period: 2 * Math.PI,
    whole: true,
    constant: false,
    guides: [],
    radii: [],
    positions: [],
  };
  expect(closureNote(result)).toBe(
    "Every frequency is a whole number, so the curve is closed: it repeats after t spans 2π.",
  );
  expect(closureNote({ ...result, whole: false, period: 4 * Math.PI })).toBe(
    "The frequencies are in a whole-number ratio, so the curve closes after t spans 4π.",
  );
  expect(closureNote({ ...result, whole: false, period: 0 })).toContain(
    "never closes exactly. It is not forced closed.",
  );
  expect(
    closureNote({ ...result, whole: false, period: 0, constant: true }),
  ).toContain("single point");
  expect(
    nextTerm([
      { frequency: 1, radius: 1, phase: 0 },
      { frequency: 6, radius: 0.2, phase: 1 },
    ]),
  ).toEqual({ frequency: -7, radius: 0.1, phase: 0 });
  expect(nextTerm([{ frequency: -2.5, radius: 0, phase: 0 }])).toEqual({
    frequency: 3,
    radius: 0.5,
    phase: 0,
  });
});

test("reveal turns the vectors with the trace; framing holds every circle", () => {
  const point = (x: number): Vec => ({ x, y: 0 });
  const result: Result = {
    base: [point(0), point(1), point(2), point(3)],
    derived: [null, null, null, null],
    virtual: [false, false, false, false],
    rays: [],
    family: [],
    circles: [],
    rolling: [],
    harmonic: {
      period: 2 * Math.PI,
      whole: true,
      constant: false,
      guides: [],
      radii: [20, 1],
      positions: [0, 1, 3].map((i) => ({
        sampleIndex: i,
        joints: [point(0), point(20)],
        point: point(21),
      })),
    },
    warnings: [],
    invalid: 0,
  };
  const half = reveal(result, 0.5);
  expect(half.harmonic!.positions.map((s) => s.sampleIndex)).toEqual([0, 1]);
  expect(half.harmonic!.radii).toEqual([20, 1]);
  expect(reveal(result, 1)).toEqual(result);
  expect(reveal({ ...result, harmonic: undefined }, 0.5).harmonic).toBe(
    undefined,
  );
  // The largest circle, from −20 to 21 with its neighbor, is framed in full
  // although the trace is short.
  const config = preset(fourierTitle);
  expect(fitFrame(result, config).span).toBeGreaterThanOrEqual(41);
  // A Lissajous figure's guides are framed as their own family.
  const guided = fitFrame(
    {
      ...result,
      harmonic: {
        ...result.harmonic!,
        radii: [],
        guides: [{ sampleIndex: 0, center: { x: 0, y: 30 }, radius: 5 }],
      },
    },
    config,
  );
  expect(guided.cy).toBeGreaterThan(10);
  expect(guided.span).toBeGreaterThanOrEqual(35);
});

test("the Lissajous preset projects its figure from two turning guides", async ({
  page,
}) => {
  await ready(page, lissajousTitle);
  await expect(
    page.getByRole("combobox", { name: "Definition", exact: true }),
  ).toHaveValue("lissajous");
  await expect(page.getByRole("textbox", { name: "x(t)" })).toHaveCount(0);
  await expect(field(page, "Shape parameter a")).toHaveCount(0);
  await expect(field(page, "Phase φ (radians)")).toHaveValue("pi/2");
  await expect(note(page)).toHaveText(
    "Every frequency is a whole number, so the curve is closed: it repeats after t spans 2π.",
  );
  await expect(page.getByText(/omitted samples/)).toHaveCount(0);
  const s = await scale(page);
  // The x guide sits above the figure and the y guide to its right, a
  // quarter of the amplitude clear of it.
  const guides = await circles(page, "lissajous-guide");
  expect(guides).toHaveLength(2);
  for (const [[cx, cy, r], center] of [
    [guides[0], { x: 0, y: 2.25 }],
    [guides[1], { x: 2.25, y: 0 }],
  ] as const) {
    const want = await toScreen(page, center);
    expect(cx).toBeCloseTo(want.x, 5);
    expect(cy).toBeCloseTo(want.y, 5);
    expect(r / s).toBeCloseTo(1, 9);
  }
  // At t = 2π the traced point is (sin(6π + π/2), sin 4π) = (1, 0), with
  // the x guide's point at its right and the y guide's at its far right.
  await expect(epicycles(page)).toHaveAttribute("data-sample", "1999");
  const [[px, py]] = await circles(page, "harmonic-point");
  const traced = await toScreen(page, { x: 1, y: 0 });
  expect(px).toBeCloseTo(traced.x, 5);
  expect(py).toBeCloseTo(traced.y, 5);
  const [down, across] = await segments(page, "lissajous-projection");
  const top = await toScreen(page, { x: 1, y: 2.25 });
  const side = await toScreen(page, { x: 3.25, y: 0 });
  expect(down[0]).toBeCloseTo(top.x, 5);
  expect(down[1]).toBeCloseTo(top.y, 5);
  expect(down[2]).toBeCloseTo(traced.x, 5);
  expect(across[0]).toBeCloseTo(side.x, 5);
  expect(across[1]).toBeCloseTo(side.y, 5);
  expect(across[3]).toBeCloseTo(traced.y, 5);
  // Both guides stay in view.
  for (const [cx, cy, r] of guides) {
    expect(cx - r).toBeGreaterThan(0);
    expect(cx + r).toBeLessThan(1000);
    expect(cy - r).toBeGreaterThan(0);
    expect(cy + r).toBeLessThan(760);
  }
  // Definition guides have their own layer; hiding them never reframes the drawing.
  await page
    .getByRole("checkbox", { name: "Guide circles & projections", exact: true })
    .uncheck();
  await expect(page.getByTestId("harmonic-geometry")).toHaveCount(0);
  await expect(page.getByTestId("harmonic-point")).toHaveCount(0);
  expect(await scale(page)).toBe(s);
  await page
    .getByRole("checkbox", { name: "Guide circles & projections", exact: true })
    .check();
  await expect(epicycles(page)).toBeVisible();
});

test("the Fourier preset chains its circles from the origin", async ({
  page,
}) => {
  await ready(page, fourierTitle);
  await expect(
    page.getByRole("combobox", { name: "Definition", exact: true }),
  ).toHaveValue("fourier");
  await expect(note(page)).toContainText("repeats after t spans 2π");
  const s = await scale(page);
  // At t = 2π every vector points along +x: the circles are centered at 0,
  // 1, and 1.45, and the traced point is at 1.65.
  const drawn = await circles(page, "epicycle");
  expect(drawn).toHaveLength(3);
  for (const [[cx, cy, r], [x, radius]] of drawn.map(
    (c, k) =>
      [
        c,
        [
          [0, 1],
          [1, 0.45],
          [1.45, 0.2],
        ][k],
      ] as const,
  )) {
    const want = await toScreen(page, { x, y: 0 });
    expect(cx).toBeCloseTo(want.x, 5);
    expect(cy).toBeCloseTo(want.y, 5);
    expect(r / s).toBeCloseTo(radius, 9);
  }
  await expect(page.getByTestId("epicycle-arm")).toHaveCount(3);
  const [[px, py]] = await circles(page, "harmonic-point");
  const tip = await toScreen(page, { x: 1.65, y: 0 });
  expect(px).toBeCloseTo(tip.x, 5);
  expect(py).toBeCloseTo(tip.y, 5);
  // The term fields hold the coefficients; there are no expressions.
  await expect(field(page, "Frequency k₂")).toHaveValue("-4");
  await expect(field(page, "Radius r₃")).toHaveValue("0.2");
  await expect(field(page, "Phase φ₁")).toHaveValue("0");
  await expect(page.getByRole("textbox", { name: "y(t)" })).toHaveCount(0);
});

test("Fourier terms are added, edited, and removed, with closure following", async ({
  page,
}) => {
  await ready(page, fourierTitle);
  const add = page.getByRole("button", { name: "Add a term" });
  await add.click();
  await settled(page);
  expect((await definition(page)).curve.terms[3]).toEqual({
    frequency: -7,
    radius: 0.1,
    phase: 0,
  });
  await expect(page.getByTestId("epicycle")).toHaveCount(4);
  await expect(note(page)).toContainText("repeats after t spans 2π");
  // A term entered while its row is renumbered keeps its own value: the
  // removal waits for the entry to resolve.
  await field(page, "Phase φ₃").fill("pi/2");
  await page.getByRole("button", { name: "Remove term 2" }).click();
  await settled(page);
  expect((await definition(page)).curve.terms).toEqual([
    { frequency: 1, radius: 1, phase: 0 },
    { frequency: 6, radius: 0.2, phase: Math.PI / 2 },
    { frequency: -7, radius: 0.1, phase: 0 },
  ]);
  await expect(field(page, "Frequency k₂")).toHaveValue("6");
  await expect(field(page, "Frequency k₄")).toHaveCount(0);
  // A real frequency with a whole-number ratio closes on its common period.
  await field(page, "Frequency k₂").fill("3/2");
  await field(page, "Frequency k₃").fill("-1/2");
  await settled(page);
  await expect(note(page)).toHaveText(
    "The frequencies are in a whole-number ratio, so the curve closes after t spans 4π.",
  );
  await traceButton(page).click();
  await settled(page);
  await expect(to(page)).toHaveValue("4*pi");
  expect((await definition(page)).curve.max).toBe(4 * Math.PI);
  // Other ratios are explored, never forced closed.
  await field(page, "Frequency k₃").fill("sqrt(2)");
  await settled(page);
  await expect(note(page)).toContainText("never closes exactly");
  await expect(traceButton(page)).toHaveCount(0);
  // A zero radius removes a term's frequency from closure.
  await field(page, "Radius r₃").fill("0");
  await settled(page);
  await expect(note(page)).toContainText("closes after t spans 4π");
  await expect(page.getByTestId("epicycle")).toHaveCount(2);
  // Invalid entries explain themselves.
  await field(page, "Radius r₂").fill("-1");
  await expect(page.getByRole("alert")).toContainText("term 2: the radius");
  await field(page, "Radius r₂").fill("");
  await expect(page.getByRole("alert")).toContainText("finite number");
  await field(page, "Radius r₂").fill("0.2");
  await settled(page);
  // Terms are bounded above, and one always remains.
  for (let n = 3; n < 16; n++) await add.click();
  await settled(page);
  expect((await definition(page)).curve.terms).toHaveLength(16);
  await expect(
    page.getByRole("button", { name: "At most 16 terms" }),
  ).toBeDisabled();
  for (let n = 16; n > 1; n--)
    await page.getByRole("button", { name: `Remove term ${n}` }).click();
  await settled(page);
  expect((await definition(page)).curve.terms).toEqual([
    { frequency: 1, radius: 1, phase: 0 },
  ]);
  await expect(
    page.getByRole("button", { name: "Remove term 1" }),
  ).toBeDisabled();
  await expect(page.getByTestId("epicycle")).toHaveCount(1);
});

test("Lissajous controls validate, report closure, and trace a full period", async ({
  page,
}) => {
  await ready(page, "Ellipse & its evolute");
  const format = page.getByRole("combobox", {
    name: "Definition",
    exact: true,
  });
  await format.selectOption("lissajous");
  await settled(page);
  await expect(page.getByTestId("lissajous-guide")).toHaveCount(2);
  await field(page, "Frequency m").fill("3/2");
  await field(page, "Frequency n").fill("1");
  await page.getByRole("textbox", { name: "to", exact: true }).fill("1");
  await settled(page);
  await expect(note(page)).toContainText("closes after t spans 4π");
  await traceButton(page).click();
  await settled(page);
  await expect(to(page)).toHaveValue("4*pi");
  // A start other than zero keeps its offset.
  await page.getByRole("textbox", { name: "t from" }).fill("pi/3");
  await traceButton(page).click();
  await settled(page);
  expect((await definition(page)).curve.max).toBeCloseTo(
    Math.PI / 3 + 4 * Math.PI,
    12,
  );
  await field(page, "Frequency m").fill("sqrt(2)");
  await settled(page);
  await expect(note(page)).toContainText("never closes exactly");
  await field(page, "Frequency m").fill("0");
  await field(page, "Frequency n").fill("0");
  await settled(page);
  await expect(note(page)).toContainText("single point");
  await field(page, "Amplitude A").fill("-1");
  await expect(page.getByRole("alert")).toContainText("amplitudes");
  await field(page, "Amplitude A").fill("1");
  await field(page, "Frequency n").fill("1001");
  await expect(page.getByRole("alert")).toContainText("frequencies");
  await field(page, "Frequency n").fill("2");
  await settled(page);
  // Every construction applies, and switching back restores the expressions.
  await page
    .getByRole("group", { name: "Construction" })
    .getByRole("button", { name: "offset", exact: true })
    .click();
  await settled(page);
  await format.selectOption("parametric");
  await settled(page);
  await expect(page.getByRole("textbox", { name: "x(t)" })).toHaveValue(
    "2*cos(t)",
  );
  await expect(page.getByTestId("harmonic-geometry")).toHaveCount(0);
  await expect(note(page)).toHaveCount(0);
  expect((await definition(page)).curve.lissajous.amplitudeX).toBe(1);
});

test("the incommensurate preset never closes and is not forced closed", async ({
  page,
}) => {
  await ready(page, irrationalTitle);
  await expect(note(page)).toHaveText(
    "The frequencies are not in a whole-number ratio with denominators up to 1,000, so the curve never closes exactly. It is not forced closed.",
  );
  await expect(traceButton(page)).toHaveCount(0);
  await expect(to(page)).toHaveValue("12*pi");
  await expect(page.getByTestId("derived-curve")).toHaveCount(1);
});

test("closure text stays put while amplitudes and phases recompute", async ({
  page,
}) => {
  await ready(page, fourierTitle);
  await page.evaluate(() => {
    const seen = new Set<string>();
    (window as any).closureSeen = seen;
    const record = () =>
      seen.add(
        document.querySelector('[data-testid="closure-note"]')?.textContent ??
          "",
      );
    record();
    new MutationObserver(record).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
  await field(page, "Radius r₂").fill("0.5");
  await field(page, "Phase φ₃").fill("1");
  await page
    .getByRole("spinbutton", { name: "Construction lines", exact: true })
    .fill("50");
  await settled(page);
  expect(await page.evaluate(() => [...(window as any).closureSeen])).toEqual([
    "Every frequency is a whole number, so the curve is closed: it repeats after t spans 2π.",
  ]);
  // Frequencies 4, −4, and 6 repeat twice as often.
  await field(page, "Frequency k₁").fill("4");
  await settled(page);
  await expect(note(page)).toContainText("repeats after t spans π.");
});

test("an exported harmonic curve keeps every coefficient and its circles", async ({
  page,
}) => {
  await ready(page, fourierTitle);
  await field(page, "Phase φ₂").fill("pi/7");
  await settled(page);
  const download = page.waitForEvent("download");
  await exportImage(page, "SVG");
  const svg = await readFile((await (await download).path())!, "utf8");
  const exported = await page.evaluate((s) => {
    const doc = new DOMParser().parseFromString(s, "image/svg+xml");
    return {
      config: JSON.parse(doc.querySelector("desc")!.textContent!),
      circles: doc.querySelectorAll('[data-testid="epicycle"]').length,
    };
  }, svg);
  expect(exported.config.curve.format).toBe("fourier");
  expect(exported.config.curve.terms).toEqual([
    { frequency: 1, radius: 1, phase: 0 },
    { frequency: -4, radius: 0.45, phase: Math.PI / 7 },
    { frequency: 6, radius: 0.2, phase: 0 },
  ]);
  expect(exported.circles).toBe(3);
});

for (const camera of ["hold", "current", "follow", "fit"]) {
  test(`term animation reaches endpoints with ${camera} camera`, async ({
    page,
  }) => {
    await ready(page, fourierTitle);
    const original = (await definition(page)).curve.terms;
    await openAnimation(page);
    await page
      .getByRole("combobox", { name: "Animate", exact: true })
      .selectOption("parameters");
    const parameter = page.getByRole("combobox", {
      name: "Parameter 1",
      exact: true,
    });
    await expect(parameter).toHaveValue("term1Phase");
    await parameter.selectOption("term2Phase");
    await expect(page.getByRole("textbox", { name: "Track 1 to" })).toHaveValue(
      String(2 * Math.PI),
    );
    await page.getByRole("textbox", { name: "Track 1 to" }).fill("pi/5");
    await page.getByRole("button", { name: "Add parameter" }).click();
    await page
      .getByRole("combobox", { name: "Parameter 2", exact: true })
      .selectOption({ label: "Radius r₃" });
    await page.getByRole("textbox", { name: "Track 2 to" }).fill("1/phi");
    await page
      .getByRole("combobox", { name: "Animation camera" })
      .selectOption(camera);
    await page
      .getByRole("spinbutton", { name: "Duration (seconds)" })
      .fill(".2");
    await page.getByRole("button", { name: "Play animation" }).click();
    await expect(
      page.getByRole("button", { name: "Replay", exact: true }),
    ).toBeVisible();
    const terms = (await definition(page)).curve.terms;
    expect(terms[1].phase).toBe(Math.PI / 5);
    expect(terms[2].radius).toBeCloseTo(2 / (1 + Math.sqrt(5)), 14);
    await expect(epicycles(page)).toHaveAttribute("data-sample", "1999");
    await page.getByRole("button", { name: /^(Stop|Back to study)$/ }).click();
    expect((await definition(page)).curve.terms).toEqual(original);
  });
}

test("reveal turns the vectors along, pauses, resumes, and an edit cancels", async ({
  page,
}) => {
  await ready(page, lissajousTitle);
  await openAnimation(page);
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill("2");
  await page.getByRole("button", { name: "Play animation" }).click();
  await expect.poll(() => progress(page)).toBeGreaterThan(0.1);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const paused = await progress(page);
  expect(paused).toBeLessThan(1);
  const sample = Number(await epicycles(page).getAttribute("data-sample"));
  expect(sample).toBeLessThanOrEqual(paused * 1999);
  expect(sample).toBeGreaterThan(paused * 1999 - 1999 / 47 - 1);
  // The guides stay whole while the vectors turn.
  await expect(page.getByTestId("lissajous-guide")).toHaveCount(2);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  await expect(epicycles(page)).toHaveAttribute("data-sample", "1999");
  await page.getByRole("button", { name: "Replay", exact: true }).click();
  await expect.poll(() => progress(page)).toBeGreaterThan(0);
  await field(page, "Amplitude B").fill("2");
  await settled(page);
  await expect(page.locator("#artwork")).not.toHaveAttribute(
    "data-animation-progress",
  );
  expect((await definition(page)).curve.lissajous.amplitudeY).toBe(2);
});

for (const theme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    test(`harmonic layout in ${theme} at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: theme });
      await ready(page, fourierTitle);
      await expect(field(page, "Phase φ₃")).toBeVisible();
      await expect(note(page)).toBeVisible();
      // The three fields of a term share one row, even on a phone.
      const tops = await Promise.all(
        ["Frequency k₁", "Radius r₁", "Phase φ₁"].map(
          async (name) => (await field(page, name).boundingBox())!.y,
        ),
      );
      expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(1);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: testInfo.outputPath(`harmonic-${theme}-${width}.png`),
        fullPage: true,
      });
    });
  }
}
