import { test, expect, type Page } from "@playwright/test";
import {
  choosePreset,
  examplesButton,
  chooseNotebook,
  exportImage,
  openExportSettings,
  openAnimation,
  open,
  scriptedKeyboard,
} from "./helpers";
import {
  gallery,
  journeyTitles,
  settled,
  copiedStudy,
} from "./gallery-helpers";

import { readFile } from "node:fs/promises";
import { presets } from "../web/presets";
import { decodePng } from "./png";
import { decodeVideo, probe as videoProbe } from "./video";
import { deflateRawSync } from "node:zlib";
import * as composition from "../web/tesseract/Composition";

test("paired pane captions preserve descriptor order, labels and layout positions", () => {
  for (const [object, labels] of [
    ["weave", ["Base sphere S²", "Fibers in space"]],
    ["bypass", ["XYZ shadow", "Coordinate diagram"]],
    ["root", ["Source z · value w", "The path in 4D"]],
  ] as const)
    for (const layout of ["columns", "rows"] as const) {
      const positions =
        layout === "rows" ? ["top", "bottom"] : ["left", "right"];
      expect(composition.paneCaptions(object, layout)).toEqual(
        labels.map(
          (label, index) => `${index + 1} / ${label} (${positions[index]})`,
        ),
      );
    }
});

const journey = (page: Page) =>
  page.getByRole("dialog", { name: "Light finding a cusp", exact: true });
async function startJourney(page: Page, title = "Light finding a cusp") {
  await examplesButton(page).click();
  await gallery(page).getByRole("button", { name: title, exact: true }).click();
}
async function journeyReady(page: Page) {
  await expect(journey(page)).toBeVisible();
  await expect(journey(page).locator(".journey-art")).toHaveAttribute(
    "aria-busy",
    "false",
  );
}

async function excursion(page: Page, title: string, step = 0) {
  await examplesButton(page).click();
  await gallery(page).getByRole("button", { name: title, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: title, exact: true });
  for (let i = 0; i < step; i++)
    await dialog
      .getByRole("button", { name: "Next step", exact: true })
      .click();
  await expect(dialog.locator(".journey-art")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  return dialog;
}

for (const width of [1280, 390])
  test(`notebook and journey render identical paired captions at width ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/?study=4d");
    await choosePreset(page, { label: "The second time around" });
    await settled(page);
    const notebook = page.locator(".tesseract-stage .paired-view-labels");
    const captions = await notebook.locator("span").allTextContents();
    expect(captions).toHaveLength(2);
    expect(captions.every((caption) => caption.length > 0)).toBe(true);
    const layout = width <= 700 ? "rows" : "columns";
    await expect(notebook).toHaveAttribute("data-layout", layout);
    const dialog = await excursion(page, journeyTitles[4]);
    const preview = dialog.locator(".paired-view-labels");
    // A single-pane step still reserves the two hidden, empty caption slots.
    await expect(preview).toHaveAttribute("aria-hidden", "true");
    await expect(preview.locator("span")).toHaveText(["", ""]);
    for (let step = 0; step < 2; step++)
      await dialog
        .getByRole("button", { name: "Next step", exact: true })
        .click();
    await expect(dialog.locator(".journey-art")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(preview).toHaveAttribute("data-layout", layout);
    await expect(preview).not.toHaveAttribute("aria-hidden", "true");
    await expect(preview.locator("span")).toHaveText(captions);
    await expect(
      dialog.locator(".journey-art text, .journey-art foreignObject"),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(notebook.locator("span")).toHaveText(captions);
  });

for (const [title, names, controls] of [
  [
    journeyTitles[1],
    [
      "Trefoil · (2, 3)",
      "A knot shedding filaments",
      "A tube around the trefoil",
    ],
    ["Tangent reach L", "c from", "Tube radius R"],
  ],
  [
    journeyTitles[3],
    [
      "A cube beyond a cube",
      "An octahedron within",
      "Hopf circles, flowing forever",
    ],
    ["4D eye distance", "Slice offset h", "Central latitude α"],
  ],
  [
    journeyTitles[4],
    [
      "The heart of a cell",
      "A crystal meeting its own dual",
      "The second time around",
    ],
    ["xw angle", "Slice offset h", "Radius r"],
  ],
  [
    journeyTitles[5],
    [
      "A torus woven from one point",
      "An arrow carried along a torus thread",
      "A staircase becoming a throat",
    ],
    ["Thread length L", "Arrow angle α (°)", "Associate angle θ"],
  ],
] as const)
  test(`journey ${title} presents every authored step, one experiment and opt-in motion`, async ({
    page,
  }, info) => {
    await page.goto("/");
    const dialog = await excursion(page, title);
    for (const [i, name] of names.entries()) {
      await expect(dialog.locator(".journey-art")).toHaveAttribute(
        "aria-busy",
        "false",
      );
      await expect(
        dialog.getByRole("heading", { name, exact: true }),
      ).toBeVisible();
      if (title === journeyTitles[4])
        await expect(
          dialog.locator('.journey-copy[data-current="true"] p'),
        ).toHaveText(
          [
            /rotate.*fourth coordinate.*3D shadow/i,
            /3D plane.*rotated 4D crystals/i,
            /Pane 1.*input plane z.*value plane w.*Pane 2.*four coordinates.*fourth coordinate/i,
          ][i],
        );
      await expect(dialog.getByRole("textbox")).toHaveCount(1);
      await expect(
        dialog.getByLabel(controls[i], { exact: true }),
      ).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: "Play animation", exact: true }),
      ).toBeEnabled();
      const duplicateIds = await page.evaluate(() => {
        const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
        return ids.filter((id, n) => ids.indexOf(id) !== n);
      });
      expect(duplicateIds).toEqual([]);
      if (i < 2)
        await dialog
          .getByRole("button", { name: "Next step", exact: true })
          .click();
    }
    await dialog.screenshot({ path: info.outputPath("still.png") });
    await dialog
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Pause", exact: true }),
    ).toBeVisible();
    const progress = dialog.getByLabel("Animation progress", { exact: true });
    await expect
      .poll(async () => Number(await progress.inputValue()))
      .toBeGreaterThan(0.03);
    await dialog.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(
      dialog.getByRole("button", { name: "Resume", exact: true }),
    ).toBeVisible();
    await progress.fill("0.6");
    await expect(progress).toHaveValue("0.6");
    await dialog.screenshot({ path: info.outputPath("motion.png") });
    await dialog.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(progress).toHaveValue("0");
    await dialog
      .getByRole("button", { name: "Previous step", exact: true })
      .click();
    await expect(dialog.locator(".journey-art")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(
      dialog.getByRole("button", { name: "Pause", exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
  });

for (const title of [journeyTitles[4], journeyTitles[5]])
  for (const colorScheme of ["light", "dark"] as const)
    for (const viewport of [
      { width: 1280, height: 600 },
      { width: 390, height: 844 },
      { width: 844, height: 390 },
    ])
      test(`expanded ${title} walkthrough in ${colorScheme} at ${viewport.width}x${viewport.height}`, async ({
        page,
      }, info) => {
        await page.setViewportSize(viewport);
        await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
        await page.goto("/");
        await settled(page);
        await page
          .getByLabel("Shape parameter a", { exact: true })
          .fill("2*pi");
        const dialog = await excursion(page, title);
        for (let step = 0; step < 3; step++) {
          await expect(dialog.locator(".journey-art")).toHaveAttribute(
            "aria-busy",
            "false",
          );
          await expect(
            dialog.getByRole("button", { name: "Pause", exact: true }),
          ).toHaveCount(0);
          await expect(dialog.getByRole("textbox")).toHaveCount(1);
          await dialog
            .getByRole("textbox")
            .fill(
              title === journeyTitles[4]
                ? step === 0
                  ? "pi/4"
                  : "1/2"
                : ["15", "0", "pi/4"][step],
            );
          await expect(
            dialog.getByRole("button", { name: "Open study", exact: true }),
          ).toBeEnabled();
          await dialog
            .getByRole("button", { name: "Play animation", exact: true })
            .click();
          const progress = dialog.getByLabel("Animation progress", {
            exact: true,
          });
          await expect
            .poll(async () => Number(await progress.inputValue()))
            .toBeGreaterThan(0.01);
          await dialog
            .getByRole("button", { name: "Pause", exact: true })
            .click();
          await progress.fill("0.5");
          await expect(progress).toHaveValue("0.5");
          await dialog
            .getByRole("button", { name: "Stop", exact: true })
            .click();
          await expect(progress).toHaveValue("0");
          expect(
            await dialog.evaluate((el) => el.scrollWidth - el.clientWidth),
          ).toBeLessThanOrEqual(1);
          if (step < 2)
            await dialog
              .getByRole("button", { name: "Next step", exact: true })
              .click();
        }
        if (title === journeyTitles[4]) {
          const panels = dialog.locator("svg[data-representation]");
          await expect(panels).toHaveCount(2);
          await expect(dialog.locator(".paired-view-labels span")).toHaveText([
            `1 / Source z · value w (${viewport.width <= 700 ? "top" : "left"})`,
            `2 / The path in 4D (${viewport.width <= 700 ? "bottom" : "right"})`,
          ]);
          await expect(dialog.locator(".journey-art text")).toHaveCount(0);
          const boxes = await panels.evaluateAll((els) =>
            els.map((el) => {
              const r = el.getBoundingClientRect();
              return { x: r.x, y: r.y, width: r.width, height: r.height };
            }),
          );
          if (viewport.width <= 700)
            expect(boxes[0].y + boxes[0].height).toBeCloseTo(boxes[1].y, 0);
          else expect(boxes[0].x + boxes[0].width).toBeCloseTo(boxes[1].x, 0);
          await panels.last().focus();
          await page.keyboard.press("+");
          await expect
            .poll(
              async () =>
                JSON.parse(
                  (await panels.last().locator(":scope > desc").textContent())!,
                ).view.zoom,
            )
            .toBeGreaterThan(1);
          expect(
            JSON.parse(
              (await panels.first().locator(":scope > desc").textContent())!,
            ).view.zoom,
          ).toBe(1);
        } else await expect(dialog.locator("canvas")).toBeVisible();
        await dialog.screenshot({ path: info.outputPath("exploration.png") });
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        await expect(
          page.getByLabel("Shape parameter a", { exact: true }),
        ).toHaveValue("2*pi");
      });

test("shadow journey keeps the edited root's complete paired composition through motion and navigation", async ({
  page,
}) => {
  // Keep a paired notebook mounted behind the preview as well: panel IDs
  // must belong to their own drawing, and neither pane may be dropped.
  await page.goto("/?study=4d");
  await choosePreset(page, { label: "The second time around" });
  await settled(page);
  const dialog = await excursion(page, journeyTitles[4], 2);
  const art = dialog.locator(".journey-art");
  const panels = art.locator("svg[data-representation]");
  await expect(panels).toHaveCount(2);
  for (const panel of await panels.all())
    await expect(panel).toHaveAttribute("viewBox", "0 0 1000 760");
  // Each pane must occupy its own half. CSS sizing the outer drawing must
  // not override the nested SVG viewport widths and clip the second view.
  const panelBoxes = await panels.evaluateAll((items) =>
    items.map((el) => {
      const box = el.getBoundingClientRect();
      return { x: box.x, width: box.width };
    }),
  );
  expect(panelBoxes[0].x + panelBoxes[0].width).toBeCloseTo(panelBoxes[1].x, 0);
  expect(panelBoxes[0].width).toBeCloseTo(panelBoxes[1].width, 0);
  expect(
    await panels.evaluateAll((items) =>
      items.map((el) => el.getAttribute("data-representation")),
    ),
  ).toEqual(["diagram", "orthographic"]);
  await expect(art.locator("svg text")).toHaveCount(0);
  const input = dialog.getByLabel("Radius r", { exact: true });
  await input.fill("pi/2");
  await expect
    .poll(
      async () =>
        JSON.parse((await art.locator("svg > desc").first().textContent())!)
          .config.root.radius,
    )
    .toBe(Math.PI / 2);
  const still = await panels.last().innerHTML();
  await dialog
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  const progress = dialog.getByLabel("Animation progress", { exact: true });
  await expect
    .poll(async () => Number(await progress.inputValue()))
    .toBeGreaterThan(0.03);
  await dialog.getByRole("button", { name: "Pause", exact: true }).click();
  await progress.fill("0.5");
  await expect.poll(async () => panels.last().innerHTML()).not.toBe(still);
  await expect(panels).toHaveCount(2);
  await dialog.getByRole("button", { name: "Stop", exact: true }).click();
  await expect.poll(async () => panels.last().innerHTML()).toBe(still);
  await dialog
    .getByRole("button", { name: "Previous step", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", {
      name: "A crystal meeting its own dual",
      exact: true,
    }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Next step", exact: true }).click();
  await expect(input).toHaveValue("pi/2");
  await expect(art).toHaveAttribute("aria-busy", "false");
  expect(
    await page.evaluate(() => {
      const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
      return ids.filter((id, n) => ids.indexOf(id) !== n);
    }),
  ).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(
    page.locator("#tesseract-artwork svg[data-representation]"),
  ).toHaveCount(2);
});

for (const item of [
  {
    notebook: "2d",
    source: "4d",
    journey: journeyTitles[2],
    step: 0,
    preset: "Clifford attractor",
    control: "Coefficient a",
    value: "-1.3",
  },
  {
    notebook: "3d",
    source: "2d",
    journey: journeyTitles[1],
    step: 1,
    preset: "A knot shedding filaments",
    control: "c from",
    value: "pi/4",
  },
  {
    notebook: "4d",
    source: "2d",
    journey: journeyTitles[3],
    step: 2,
    preset: "Hopf circles, flowing forever",
    control: "Central latitude α",
    value: "pi/4",
  },
  {
    notebook: "4d",
    source: "2d",
    journey: journeyTitles[4],
    step: 2,
    preset: "The second time around",
    control: "Radius r",
    value: "pi/2",
  },
  {
    notebook: "3d",
    source: "4d",
    journey: journeyTitles[5],
    step: 2,
    preset: "A staircase becoming a throat",
    control: "Associate angle θ",
    value: "pi/4",
  },
] as const)
  test(`journey adoption of ${item.preset} in ${item.notebook} equals a normal edited preset, preserves the source, and exports`, async ({
    page,
    context,
  }, info) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(item.notebook === "2d" ? "/" : `/?study=${item.notebook}`);
    await choosePreset(page, { label: item.preset });
    await settled(page);
    await page.getByLabel(item.control, { exact: true }).fill(item.value);
    await settled(page);
    const expected = await copiedStudy(page);
    const plainDownload = page.waitForEvent("download");
    await exportImage(page, "PNG");
    const plainPNG = decodePng(
      await readFile((await (await plainDownload).path())!),
    );
    await chooseNotebook(page, item.source);
    await settled(page);
    const source = await copiedStudy(page);
    const historyLength = await page.evaluate(() => history.length);
    const dialog = await excursion(page, item.journey, item.step);
    await dialog.getByLabel(item.control, { exact: true }).fill(item.value);
    await expect(dialog.locator(".journey-art")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await dialog
      .getByRole("button", { name: "Open study", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    await settled(page);
    expect(new URL(page.url()).searchParams.get("study")).toBe(
      item.notebook === "2d" ? null : item.notebook,
    );
    expect(await page.evaluate(() => history.length)).toBe(historyLength + 1);
    await expect(page.locator(".app:visible .example-current")).toHaveText(
      "Custom study",
    );
    expect((await copiedStudy(page)).study).toEqual(expected.study);
    const download = page.waitForEvent("download");
    await exportImage(page, "PNG");
    const png = decodePng(await readFile((await (await download).path())!));
    expect(png.width).toBeGreaterThan(100);
    expect(png.height).toBeGreaterThan(100);
    expect(png.width).toBe(plainPNG.width);
    expect(png.height).toBe(plainPNG.height);
    expect(Buffer.from(png.rgba).equals(Buffer.from(plainPNG.rgba))).toBe(true);
    await page.screenshot({ path: info.outputPath("adopted.png") });
    // Exercise the preset's original motion through the normal target player.
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Pause", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await page
      .locator(".app:visible")
      .getByLabel("Duration (seconds)", { exact: true })
      .fill("0.4");
    await open(
      page,
      item.notebook === "2d"
        ? "#animation-section"
        : item.notebook === "3d"
          ? "#spatial-animation-section"
          : "#shape-animation-section",
    );
    await open(
      page,
      item.notebook === "2d"
        ? "#export-settings"
        : item.notebook === "3d"
          ? "#spatial-export-settings"
          : "#shape-export-settings",
    );
    await page
      .locator(".app:visible")
      .getByLabel("Export resolution", { exact: true })
      .fill("1");
    await page
      .locator(".app:visible")
      .getByLabel("Export frame rate", { exact: true })
      .selectOption("15");
    await page
      .locator(".app:visible")
      .getByLabel("Export format", { exact: true })
      .selectOption("mp4");
    const motionDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: /^Export MP4 video/ }).click();
    const motionFile = await motionDownload;
    await motionFile.saveAs(info.outputPath("motion.mp4"));
    const motionPath = (await motionFile.path())!;
    const decoded = await decodeVideo(page, await readFile(motionPath));
    expect(decoded.duration).toBeCloseTo(0.4, 3);
    expect(decoded.height).toBe(760);
    expect(decoded.width / decoded.height).toBeCloseTo(
      plainPNG.width / plainPNG.height,
      5,
    );
    expect(decoded.last.ink).toBeGreaterThan(100);
    const demuxed = videoProbe(motionPath);
    if (demuxed) {
      expect(demuxed.frames).toBe(6);
      expect(demuxed.durations.reduce((a, b) => a + b, 0)).toBe(400);
    }
    const exported = await copiedStudy(page);
    await page.goBack();
    await settled(page);
    expect((await copiedStudy(page)).study).toEqual(source.study);
    await page.goForward();
    await settled(page);
    expect((await copiedStudy(page)).study).toEqual(exported.study);
  });

test("expanded geodesic journey matches the ordinary maximum-length study and retains its work cap", async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    const OriginalWorker = Worker;
    (window as any).geodesicObservations = [];
    window.Worker = class extends OriginalWorker {
      private requests = new Map<number, { length: number; start: number }>();
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", (event) => {
          const request = this.requests.get(event.data.id);
          if (!request) return;
          this.requests.delete(event.data.id);
          const elapsed = performance.now() - request.start;
          // EngineClient restores the typed geometry synchronously in its
          // onmessage handler, before this microtask reads the returned fan.
          queueMicrotask(async () => {
            const g = event.data.result?.surface?.geodesics;
            if (!g) return;
            const hash = await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(JSON.stringify(g)),
            );
            (window as any).geodesicObservations.push({
              length: request.length,
              elapsed,
              prepare: event.data.timings?.prepare,
              bytes: event.data.timings?.bytes,
              hash: [...new Uint8Array(hash)]
                .map((n) => n.toString(16).padStart(2, "0"))
                .join(""),
              threads: g.threads.length,
              points: g.threads.reduce(
                (n: number, t: any) => n + t.points.length,
                0,
              ),
              steps: g.steps,
              exhausted: g.threads.filter((t: any) => t.reason === "exhausted")
                .length,
            });
          });
        });
      }
      postMessage(q: any, transfer?: any) {
        if (q.action === "spatial" && q.spatial?.surface?.geodesics)
          this.requests.set(q.id, {
            length: q.spatial.surface.geodesics.length,
            start: performance.now(),
          });
        super.postMessage(q, transfer);
      }
    };
  });
  const maximum = () =>
    page.evaluate(() =>
      (window as any).geodesicObservations.filter(
        (x: any) => x.length === 100000,
      ),
    );
  await page.goto("/?study=3d");
  await choosePreset(page, { label: "A torus woven from one point" });
  await page.getByLabel("Thread length L", { exact: true }).fill("100000");
  await expect.poll(async () => (await maximum()).length).toBe(1);
  await settled(page);
  const dialog = await excursion(page, journeyTitles[5]);
  await dialog.getByLabel("Thread length L", { exact: true }).fill("100000");
  await expect.poll(async () => (await maximum()).length).toBe(2);
  await expect(dialog.locator(".journey-art")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  const [ordinary, preview] = await maximum();
  expect(preview.hash).toBe(ordinary.hash);
  expect(preview.threads).toBe(32);
  expect(preview.points).toBeGreaterThan(32);
  expect(preview.points).toBeLessThanOrEqual(32 * 1501);
  expect(preview.steps).toBeLessThanOrEqual(200000);
  expect(preview.exhausted).toBeGreaterThan(0);
  const canceledAt = Date.now();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  const observations = {
    ordinary,
    preview,
    returnMs: Date.now() - canceledAt,
    browser: await page.evaluate(() => navigator.userAgent),
  };
  await info.attach("maximum-length-observations", {
    body: JSON.stringify(observations, null, 2),
    contentType: "application/json",
  });
  console.log(
    "Maximum-length geodesic observations:",
    JSON.stringify(observations),
  );
});

for (const title of [journeyTitles[2], journeyTitles[4], journeyTitles[5]])
  test(`${title} retains edited studies, raw drafts, layers, animations, probes and manual cameras in all notebooks`, async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");
    await choosePreset(page, { label: "Sunlight gathering in an oval mirror" });
    await page
      .locator(".app:visible")
      .getByLabel("Shape parameter a", { exact: true })
      .fill("2*pi");
    await page
      .locator(".app:visible")
      .getByLabel("Duration (seconds)", { exact: true })
      .fill("23");
    await page
      .locator(".app:visible")
      .getByLabel("Line weight", { exact: true })
      .selectOption("bold");
    await settled(page);
    await page.locator("#artwork").focus();
    await page.keyboard.press("+");
    await page.keyboard.press("ArrowRight");
    const planar = await copiedStudy(page);
    await chooseNotebook(page, "3d");
    await choosePreset(page, {
      label: "A trefoil breathing under a moving probe",
    });
    await settled(page);
    await page
      .locator(".app:visible")
      .getByLabel("Major radius R", { exact: true })
      .fill("1+1/4");
    await page
      .locator(".app:visible")
      .getByLabel("Duration (seconds)", { exact: true })
      .fill("23");
    await settled(page);
    await page.locator("#spatial-artwork").focus();
    await page.keyboard.press("+");
    await page.keyboard.press("ArrowRight");
    const spatial = await copiedStudy(page);
    await chooseNotebook(page, "4d");
    await choosePreset(page, { label: "An octahedron within" });
    await page
      .locator(".app:visible")
      .getByLabel("Slice offset h", { exact: true })
      .fill("pi/12");
    await page
      .locator(".app:visible")
      .getByLabel("Duration (seconds)", { exact: true })
      .fill("23");
    await page
      .locator(".app:visible")
      .getByLabel("Line weight", { exact: true })
      .selectOption("bold");
    await settled(page);
    await page.locator("#tesseract-artwork").focus();
    await page.keyboard.press("+");
    await page.keyboard.press("ArrowRight");
    const shape = await copiedStudy(page);
    // An invalid raw draft in a dormant target is never captured or replaced.
    await page
      .locator(".app:visible")
      .getByLabel("Slice offset h", { exact: true })
      .fill("sqrt(-1)");
    await expect(
      page
        .locator(".app:visible")
        .getByLabel("Slice offset h", { exact: true }),
    ).toHaveAttribute("aria-invalid", "true");
    await chooseNotebook(page, "2d");
    const dialog = await excursion(page, title);
    for (let n = 0; n < 2; n++)
      await dialog
        .getByRole("button", { name: "Next step", exact: true })
        .click();
    await expect(dialog.locator(".journey-art")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await page.keyboard.press("Escape");
    await settled(page);
    await expect(
      page
        .locator(".app:visible")
        .getByLabel("Shape parameter a", { exact: true }),
    ).toHaveValue("2*pi");
    expect((await copiedStudy(page)).study).toEqual(planar.study);
    await chooseNotebook(page, "3d");
    await settled(page);
    await expect(
      page
        .locator(".app:visible")
        .getByLabel("Major radius R", { exact: true }),
    ).toHaveValue("1+1/4");
    expect((await copiedStudy(page)).study).toEqual(spatial.study);
    await chooseNotebook(page, "4d");
    await expect(
      page
        .locator(".app:visible")
        .getByLabel("Slice offset h", { exact: true }),
    ).toHaveValue("sqrt(-1)");
    await expect(
      page
        .locator(".app:visible")
        .getByLabel("Slice offset h", { exact: true }),
    ).toHaveAttribute("aria-invalid", "true");
    await page
      .locator(".app:visible")
      .getByLabel("Slice offset h", { exact: true })
      .fill("pi/12");
    await settled(page);
    expect((await copiedStudy(page)).study).toEqual(shape.study);
  });

test("journey previews all three presets statically and restores the edited study and camera", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await settled(page);
  await choosePreset(page, { label: "Light inside a circle" });
  await settled(page);
  await page.getByLabel("Shape parameter a", { exact: true }).fill("2*pi");
  await page
    .getByRole("checkbox", { name: "Construction lines", exact: true })
    .uncheck();
  await page.getByLabel("Line weight", { exact: true }).selectOption("bold");
  await page.getByLabel("Duration (seconds)", { exact: true }).fill("23");
  await page
    .getByLabel("Tangent, normal & curvature at a point", { exact: true })
    .check();
  await settled(page);
  await page.locator("#artwork").focus();
  await page.keyboard.press("+");
  await page.keyboard.press("ArrowRight");
  const before = await copiedStudy(page);
  expect((before.study as any).camera.zoom).toBeGreaterThan(1);
  expect((before.study as any).camera.x).not.toBe(0);
  expect((before.study as any).config.curve.a).toBe(2 * Math.PI);
  const svg = await page.locator("#artwork").innerHTML();
  await startJourney(page);
  const titles = [
    "Light inside a circle",
    "Parallel light & a circle",
    "Sunlight gathering in an oval mirror",
  ];
  for (const [i, title] of titles.entries()) {
    await journeyReady(page);
    await expect(
      journey(page).getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await expect(
      journey(page).getByRole("button", {
        name: "Play animation",
        exact: true,
      }),
    ).toBeEnabled();
    await expect(
      journey(page).getByRole("button", { name: "Pause", exact: true }),
    ).toHaveCount(0);
    await expect(journey(page).locator("svg text")).toHaveCount(0);
    const observed = JSON.parse(
      (await journey(page).locator("svg desc").textContent())!,
    );
    const declared = presets.find((p) => p.title === title)!.config;
    expect(observed.curve).toEqual(declared.curve);
    expect(observed.source).toEqual(declared.source);
    expect(observed.kind).toBe("catacaustic");
    if (i < 2)
      await journey(page)
        .getByRole("button", { name: "Next step", exact: true })
        .click();
  }
  await journey(page)
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect(
    journey(page).getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        JSON.parse((await journey(page).locator("svg desc").textContent())!)
          .animation?.mode,
    )
    .toBe("trace");
  await journey(page)
    .getByRole("button", { name: "Previous step", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(journey(page)).toBeHidden();
  await expect(examplesButton(page)).toBeFocused();
  await settled(page);
  await expect(
    page.getByLabel("Shape parameter a", { exact: true }),
  ).toHaveValue("2*pi");
  expect((await copiedStudy(page)).study).toEqual(before.study);
  expect(await page.locator("#artwork").innerHTML()).toBe(svg);
});

for (const title of [
  "Light finding a cusp",
  journeyTitles[4],
  journeyTitles[5],
])
  for (const [source, label] of [
    ["2d", "Shape parameter a"],
    ["3d", "Major radius R"],
    ["4d", "4D eye distance"],
  ])
    test(`${title} entry from ${source} waits for delayed scalar resolution and keeps invalid drafts editable`, async ({
      page,
    }) => {
      await page.addInitScript(() => {
        const send = Worker.prototype.postMessage;
        (window as any).releaseScalar = () => {};
        Worker.prototype.postMessage = function (message: any, ...rest: any[]) {
          if (message.action === "scalars") {
            (window as any).releaseScalar = () =>
              send.call(this, message, ...rest);
          } else send.call(this, message, ...rest);
        };
      });
      await page.goto(source === "2d" ? "/" : `/?study=${source}`);
      await settled(page);
      const input = page.getByLabel(label, { exact: true });
      await input.fill("2*pi");
      await startJourney(page, title);
      const dialog = page.getByRole("dialog", { name: title, exact: true });
      await expect(dialog).toBeHidden();
      await page.evaluate(() => (window as any).releaseScalar());
      await expect(dialog.locator(".journey-art")).toHaveAttribute(
        "aria-busy",
        "false",
      );
      await dialog
        .getByRole("button", { name: "Return to my study", exact: true })
        .click();
      await expect(input).toHaveValue("2*pi");
      await input.fill("sqrt(-1)");
      await startJourney(page, title);
      await page.evaluate(() => (window as any).releaseScalar());
      await expect(
        page.getByText(
          "Correct the highlighted input before starting the journey.",
          { exact: true },
        ),
      ).toBeVisible();
      await expect(dialog).toBeHidden();
      await expect(input).toBeVisible();
      await expect(input).toHaveValue("sqrt(-1)");
      await expect(input).toHaveAttribute("aria-invalid", "true");
    });

test("journey Open study adopts the whole preset, its animation, link and image", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await choosePreset(page, { label: "Sunlight gathering in an oval mirror" });
  await settled(page);
  const expected = await copiedStudy(page);
  await choosePreset(page, 0);
  await settled(page);
  await page.getByLabel("Shape parameter a", { exact: true }).fill("2*pi");
  await startJourney(page);
  await journeyReady(page);
  await journey(page)
    .getByRole("button", { name: "Next step", exact: true })
    .click();
  await journey(page)
    .getByRole("button", { name: "Next step", exact: true })
    .click();
  await journeyReady(page);
  await journey(page)
    .getByRole("button", { name: "Open study", exact: true })
    .click();
  await expect(journey(page)).toBeHidden();
  await settled(page);
  expect((await copiedStudy(page)).study).toEqual(expected.study);
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  const download = page.waitForEvent("download");
  await exportImage(page, "SVG");
  const file = await (await download).path();
  const image = await readFile(file!, "utf8");
  expect(image).toContain("<svg");
  expect(image).toContain("catacaustic");
  expect(image).not.toContain("<text");
  await page.goto(expected.url);
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
  await settled(page);
  expect((await copiedStudy(page)).study).toEqual(expected.study);
});

test("journey dismissal and notebook switching reject delayed preview replies", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const send = Worker.prototype.postMessage;
    (window as any).holdPreview = false;
    (window as any).previewJobs = [];
    Worker.prototype.postMessage = function (message: any, ...rest: any[]) {
      if ((window as any).holdPreview && message.action === "compute")
        (window as any).previewJobs.push(() =>
          send.call(this, message, ...rest),
        );
      else send.call(this, message, ...rest);
    };
  });
  await page.goto("/");
  await settled(page);
  const original = await page.locator("#artwork").innerHTML();
  await page.evaluate(() => ((window as any).holdPreview = true));
  await startJourney(page);
  await expect(journey(page)).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as any).previewJobs.length))
    .toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    (window as any).holdPreview = false;
    (window as any).previewJobs.splice(0).forEach((run: () => void) => run());
  });
  await expect(journey(page)).toBeHidden();
  expect(await page.locator("#artwork").innerHTML()).toBe(original);
  await chooseNotebook(page, "3d");
  await chooseNotebook(page, "2d");
  await startJourney(page);
  await journeyReady(page);
  await page.goBack();
  await expect(journey(page)).toBeHidden();
  await chooseNotebook(page, "2d");
  await settled(page);
  expect(await page.locator("#artwork").innerHTML()).toBe(original);
  await examplesButton(page).click();
  await expect(gallery(page)).toBeVisible();
});

for (const colorScheme of ["light", "dark"] as const)
  test(`journey is static, readable and bounded at phone width in ${colorScheme}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.goto("/");
    await startJourney(page);
    await journeyReady(page);
    const dialog = journey(page);
    expect(await dialog.evaluate((d) => d.scrollWidth - d.clientWidth)).toBe(0);
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    // Existing notebook controls are inaccessible until the excursion ends.
    await expect(
      page.getByRole("button", { name: "Copy link", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Export image", exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: "Pause", exact: true }),
    ).toHaveCount(0);
    const duplicateIds = await page.evaluate(() => {
      const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
      return ids.filter((id, i) => ids.indexOf(id) !== i);
    });
    expect(duplicateIds).toEqual([]);
    await dialog
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Pause", exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole("button", { name: "Next step", exact: true })
      .click();
    await journeyReady(page);
    await expect(
      dialog.getByRole("button", { name: "Pause", exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: "Play animation", exact: true }),
    ).toBeEnabled();
    await dialog.getByRole("button", { name: "Return to my study" }).click();
    await expect(
      page.getByRole("button", { name: "Play animation", exact: true }),
    ).toBeVisible();
  });

test("journey cancels original playback and supersedes waiting entry on gallery reopen or replacement", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await startJourney(page);
  await journeyReady(page);
  await journey(page)
    .getByRole("button", { name: "Return to my study" })
    .click();
  await expect(
    page.getByRole("button", { name: "Play animation", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() => {
    const send = Worker.prototype.postMessage;
    (window as any).releaseScalar = () => {};
    Worker.prototype.postMessage = function (message: any, ...rest: any[]) {
      if (message.action === "scalars")
        (window as any).releaseScalar = () => send.call(this, message, ...rest);
      else send.call(this, message, ...rest);
    };
  });
  await page.getByLabel("Shape parameter a", { exact: true }).fill("2*pi");
  await startJourney(page);
  await expect(journey(page)).toBeHidden();
  await examplesButton(page).click();
  await page.evaluate(() => (window as any).releaseScalar());
  await page.keyboard.press("Escape");
  await settled(page);
  await expect(journey(page)).toBeHidden();
  await expect(
    page.getByLabel("Shape parameter a", { exact: true }),
  ).toHaveValue("2*pi");
  await startJourney(page);
  await journeyReady(page);
  // A real shared-study replacement dismisses the modal and adopts normally.
  await page.evaluate(() => {
    location.hash = "s=not-a-study";
  });
  // Invalid links must also release the preview so the refusal is visible.
  await expect(journey(page)).toBeHidden();
  await expect(page.getByText(/This link/).first()).toBeVisible();
});

test("journey keeps playback visible in a short desktop window", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await startJourney(page);
  await journeyReady(page);
  const play = (await journey(page)
    .getByRole("button", { name: "Play animation", exact: true })
    .boundingBox())!;
  expect(play.y + play.height).toBeLessThanOrEqual(720);
});

// Holds worker compute replies while `holdReplies` is set, for release one
// at a time from `replies`, and counts those delivered.
function interceptComputeReplies(page: Page, lifted = false) {
  return page.addInitScript((lifted) => {
    const w = window as any;
    const property = Object.getOwnPropertyDescriptor(
      Worker.prototype,
      "onmessage",
    )!;
    w.holdReplies = false;
    w.replies = [];
    w.delivered = 0;
    Object.defineProperty(Worker.prototype, "onmessage", {
      ...property,
      set(listener: (event: MessageEvent) => void) {
        property.set!.call(this, (event: MessageEvent) => {
          const computation =
            event.data.config || (lifted && event.data.result);
          const deliver = () => {
            if (computation) w.delivered++;
            listener.call(this, event);
          };
          if (w.holdReplies && computation) w.replies.push(deliver);
          else deliver();
        });
      },
    });
  }, lifted);
}

for (const title of [journeyTitles[4], journeyTitles[5]]) {
  test(`${title} keeps artwork and prose together through superseded slow steps and cancellation`, async ({
    page,
  }) => {
    await interceptComputeReplies(page, true);
    await page.goto("/");
    await settled(page);
    await page.evaluate(() => ((window as any).holdReplies = true));
    await startJourney(page, title);
    const dialog = page.getByRole("dialog", { name: title, exact: true });
    await expect
      .poll(() => page.evaluate(() => (window as any).replies.length))
      .toBe(1);
    await dialog
      .getByRole("button", { name: "Next step", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Next step", exact: true })
      .click();
    expect(await page.evaluate(() => (window as any).replies.length)).toBe(1);
    await page.evaluate(() => (window as any).replies.shift()());
    await expect
      .poll(() => page.evaluate(() => (window as any).replies.length))
      .toBe(1);
    await expect(
      dialog.locator(".journey-art svg, .journey-art canvas"),
    ).toHaveCount(0);
    await page.evaluate(() => (window as any).replies.shift()());
    const last =
      title === journeyTitles[4]
        ? "The second time around"
        : "A staircase becoming a throat";
    await expect(
      dialog.getByRole("heading", { name: last, exact: true }),
    ).toBeVisible();
    await expect(dialog.locator(".journey-art")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect
      .poll(() => page.evaluate(() => (window as any).replies.length))
      .toBe(1);
    await dialog
      .getByRole("button", { name: "Previous step", exact: true })
      .click();
    await expect(dialog.locator(".journey-feedback")).toHaveText(
      "Preparing step 2…",
    );
    await expect(
      dialog.getByRole("heading", { name: last, exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Open study", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      (window as any).holdReplies = false;
      (window as any).replies.splice(0).forEach((run: () => void) => run());
    });
    await expect(dialog).toBeHidden();
    await expect(page.locator(".app:visible .example-current")).toHaveText(
      "Ellipse & its evolute",
    );
  });

  test(`${title} refuses invalid experiments without losing return, and incoming links dismiss it`, async ({
    page,
  }) => {
    await page.goto("/");
    const dialog = await excursion(page, title, 2);
    await dialog
      .getByRole("textbox")
      .fill(title === journeyTitles[4] ? "0" : "-1");
    await expect(dialog.getByRole("alert").first()).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Open study", exact: true }),
    ).toBeDisabled();
    await dialog
      .getByRole("button", { name: "Return to my study", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    await startJourney(page, title);
    await expect(dialog).toBeVisible();
    await page.evaluate(() => {
      location.hash = "s=not-a-study";
    });
    await expect(dialog).toBeHidden();
    await expect(page.getByText(/This link/).first()).toBeVisible();
  });
}

test("journey navigation bounds work and presents only the requested step", async ({
  page,
}) => {
  await interceptComputeReplies(page);
  await page.goto("/");
  await settled(page);
  await page.evaluate(() => ((window as any).holdReplies = true));
  await startJourney(page);
  await expect
    .poll(() => page.evaluate(() => (window as any).replies.length))
    .toBe(1);
  await journey(page)
    .getByRole("button", { name: "Next step", exact: true })
    .click();
  await journey(page)
    .getByRole("button", { name: "Next step", exact: true })
    .click();
  expect(await page.evaluate(() => (window as any).replies.length)).toBe(1);
  await page.evaluate(() => (window as any).replies.shift()());
  await expect
    .poll(() => page.evaluate(() => (window as any).replies.length))
    .toBe(1);
  await expect(journey(page).locator("svg")).toHaveCount(0);
  await page.evaluate(() => (window as any).replies.shift()());
  await journeyReady(page);
  const drawn = JSON.parse(
    (await journey(page).locator("svg desc").textContent())!,
  );
  expect(drawn.curve.x).toBe("1.6*cos(t)");
  await journey(page)
    .getByRole("button", { name: "Previous step", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).replies.length))
    .toBe(1);
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    (window as any).holdReplies = false;
    (window as any).replies.shift()();
  });
  await expect(journey(page)).toBeHidden();
  await settled(page);
  expect(
    JSON.parse((await page.locator("#artwork desc").textContent())!).kind,
  ).toBe("evolute");
});

test("journey entry cancels an active export without resuming it on return", async ({
  page,
}) => {
  const downloads: unknown[] = [];
  page.on("download", (file) => downloads.push(file));
  await page.goto("/");
  await settled(page);
  await openExportSettings(page);
  await page.getByLabel("Duration (seconds)", { exact: true }).fill("120");
  await page.getByRole("button", { name: "Export MP4 video" }).click();
  await expect(
    page.getByRole("button", { name: "Cancel export", exact: true }),
  ).toBeVisible();
  await startJourney(page);
  await journeyReady(page);
  await journey(page)
    .getByRole("button", { name: "Return to my study" })
    .click();
  await expect(
    page.getByRole("button", { name: "Play animation", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cancel export", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("Duration (seconds)", { exact: true }),
  ).toHaveValue("120");
  expect(downloads).toHaveLength(0);
});

test("journey entry discards a PNG encoding that finishes after return", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).pngEncodings = [];
    (window as any).pngDownloads = [];
    const encode = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, ...options) {
      (window as any).pngEncodings.push(
        () =>
          new Promise<void>((done) => {
            encode.call(
              this,
              (blob) => {
                callback(blob);
                done();
              },
              ...options,
            );
          }),
      );
    };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download && this.href.startsWith("blob:"))
        (window as any).pngDownloads.push(this.download);
      click.call(this);
    };
  });
  await page.goto("/");
  await settled(page);
  await exportImage(page, "PNG");
  await expect
    .poll(() => page.evaluate(() => (window as any).pngEncodings.length))
    .toBe(1);
  await startJourney(page);
  await journeyReady(page);
  await journey(page)
    .getByRole("button", { name: "Return to my study" })
    .click();
  await page.evaluate(async () => {
    await (window as any).pngEncodings.shift()();
    // Let the encoder's promise chain settle before observing saveFile.
    await new Promise(requestAnimationFrame);
  });
  expect(await page.evaluate(() => (window as any).pngDownloads)).toEqual([]);
});

for (const width of [1280, 390]) {
  test(`journey step navigation keeps its panel, viewport and controls steady at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto("/");
    await startJourney(page);
    await journeyReady(page);
    await page.evaluate(() => {
      const dialog =
        document.querySelector<HTMLDialogElement>("dialog.journey")!;
      const art = dialog.querySelector(".journey-art")!;
      const navigation = dialog.querySelector(".journey-navigation")!;
      (window as any).journeyFrames = [];
      (window as any).watchJourney = true;
      const observe = () => {
        const rectangle = (node: Element) => {
          const r = node.getBoundingClientRect();
          return [r.x, r.y, r.width, r.height];
        };
        (window as any).journeyFrames.push({
          connected:
            dialog.isConnected &&
            dialog.open &&
            art.isConnected &&
            navigation.isConnected,
          dialog: rectangle(dialog),
          art: rectangle(art),
          navigation: rectangle(navigation),
        });
        if ((window as any).watchJourney) requestAnimationFrame(observe);
      };
      observe();
    });
    for (const name of [
      "Next step",
      "Next step",
      "Previous step",
      "Previous step",
    ]) {
      await journey(page).getByRole("button", { name, exact: true }).click();
      await journeyReady(page);
    }
    const frames = await page.evaluate(() => {
      (window as any).watchJourney = false;
      return (window as any).journeyFrames as {
        connected: boolean;
        dialog: number[];
        art: number[];
        navigation: number[];
      }[];
    });
    expect(frames.length).toBeGreaterThan(4);
    for (const frame of frames) {
      expect(
        frame.connected,
        "the same panel and viewport remain mounted between steps",
      ).toBe(true);
      for (const name of ["dialog", "art", "navigation"] as const)
        frame[name].forEach((n, i) =>
          expect(
            Math.abs(n - frames[0][name][i]),
            `${name} coordinate ${i}`,
          ).toBeLessThanOrEqual(1),
        );
    }
  });

  test(`journey playback keeps the artwork and step buttons steady at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto("/");
    await startJourney(page);
    await journeyReady(page);
    const measure = () =>
      journey(page).evaluate((dialog) =>
        [".journey-art", ".journey-navigation"].map((selector) => {
          const r = dialog.querySelector(selector)!.getBoundingClientRect();
          return [
            r.x + dialog.scrollLeft,
            r.y + dialog.scrollTop,
            r.width,
            r.height,
          ];
        }),
      );
    const initial = await measure();
    await journey(page)
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await expect(
      journey(page).getByRole("button", { name: "Pause", exact: true }),
    ).toBeVisible();
    expect(await measure()).toEqual(initial);
    await journey(page)
      .getByRole("button", { name: "Pause", exact: true })
      .click();
    expect(await measure()).toEqual(initial);
    await journey(page)
      .getByRole("button", { name: "Resume", exact: true })
      .click();
    expect(await measure()).toEqual(initial);
    await journey(page)
      .getByRole("button", { name: "Stop", exact: true })
      .click();
    expect(await measure()).toEqual(initial);
  });
}

test("journey groups the experiment with Open study and uses an explicit return instead of notebook escape buttons", async ({
  page,
}) => {
  await page.goto("/");
  await startJourney(page);
  await journeyReady(page);
  await expect(
    journey(page).getByRole("radiogroup", { name: "Study dimension" }),
  ).toHaveCount(0);
  const adopt = journey(page).getByRole("group", {
    name: "Explore this study",
  });
  await expect(
    adopt.getByRole("button", { name: "Open study", exact: true }),
  ).toBeVisible();
  await expect(adopt.getByText(/Try moving Source x/)).toBeVisible();
  await expect(adopt.locator("p:visible")).toHaveText(/copy.*link.*export/);
  const bounds = await adopt.boundingBox();
  const nav = await journey(page).locator(".journey-navigation").boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(nav!.y + nav!.height);
});

test("journey keeps the completed drawing and matching explanation while a slow step computes", async ({
  page,
}) => {
  await interceptComputeReplies(page);
  await page.goto("/");
  await settled(page);
  await page.evaluate(() => ((window as any).holdReplies = true));
  await startJourney(page);
  await expect
    .poll(() => page.evaluate(() => (window as any).replies.length))
    .toBe(1);
  // The first step's wait is announced too, and the next wait starts its
  // own grace period afresh.
  await expect(journey(page).locator(".journey-feedback")).toHaveText(
    "Preparing step 1…",
  );
  await page.evaluate(() => (window as any).replies.shift()());
  await journeyReady(page);
  await expect(journey(page).locator(".journey-feedback")).toHaveText("");
  const before = await journey(page).locator("svg").innerHTML();
  // The following step's calculation is now held.
  await expect
    .poll(() => page.evaluate(() => (window as any).replies.length))
    .toBe(1);
  await journey(page).evaluate((dialog) => {
    const w = window as any;
    const feedback = dialog.querySelector(".journey-feedback")!;
    const open = [...dialog.querySelectorAll("button")].find(
      (b) => b.textContent === "Open study",
    )!;
    w.busyAt = null;
    dialog.addEventListener(
      "click",
      () => {
        w.clickedAt = performance.now();
        const watch = () => {
          if (feedback.textContent || (open as HTMLButtonElement).disabled)
            w.busyAt = performance.now();
          else requestAnimationFrame(watch);
        };
        watch();
      },
      { capture: true, once: true },
    );
  });
  await journey(page)
    .getByRole("button", { name: "Next step", exact: true })
    .click();
  await expect(journey(page).locator(".journey-art")).toHaveAttribute(
    "aria-busy",
    "true",
  );
  await expect(journey(page).locator(".journey-feedback")).toHaveText(
    "Preparing step 2…",
  );
  await expect(journey(page).locator("svg")).toHaveCount(1);
  expect(await journey(page).locator("svg").innerHTML()).toBe(before);
  await expect(
    journey(page).getByRole("heading", {
      name: "Light inside a circle",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    journey(page).getByRole("button", { name: "Open study", exact: true }),
  ).toBeDisabled();
  // A wait is announced only once it outlasts a brief grace period, so a
  // quick step never flashes the busy state. Timers never fire early, so
  // this bound holds on a slow machine too.
  expect(
    await page.evaluate(() => {
      const w = window as any;
      return w.busyAt - w.clickedAt;
    }),
  ).toBeGreaterThanOrEqual(250);
  await page.evaluate(() => (window as any).replies.shift()());
  await journeyReady(page);
  await expect(
    journey(page).getByRole("heading", {
      name: "Parallel light & a circle",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    JSON.parse((await journey(page).locator("svg desc").textContent())!).source
      .kind,
  ).toBe("parallel");
});

for (const width of [1280, 390])
  test(`journey steps already prepared switch without flashing busy controls at ${width}px`, async ({
    page,
  }) => {
    await interceptComputeReplies(page);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto("/");
    await settled(page);
    const before = await page.evaluate(() => (window as any).delivered);
    await startJourney(page);
    await journeyReady(page);
    // One engine prepares every step in turn, after the first.
    await expect
      .poll(() => page.evaluate((n) => (window as any).delivered - n, before))
      .toBeGreaterThanOrEqual(3);
    await journey(page).evaluate((dialog) => {
      const w = window as any;
      const button = (name: string) =>
        [...dialog.querySelectorAll("button")].find(
          (b) => b.textContent === name,
        ) as HTMLButtonElement | undefined;
      w.journeyFrames = [];
      w.watchJourney = true;
      const observe = () => {
        w.journeyFrames.push({
          play: button("Play animation")?.disabled ?? "missing",
          open: button("Open study")?.disabled ?? "missing",
          feedback: dialog.querySelector(".journey-feedback")!.textContent,
          busy: dialog.querySelector(".journey-art")!.getAttribute("aria-busy"),
        });
        if (w.watchJourney) requestAnimationFrame(observe);
      };
      observe();
    });
    for (const [name, title] of [
      ["Next step", "Parallel light & a circle"],
      ["Next step", "Sunlight gathering in an oval mirror"],
      ["Previous step", "Parallel light & a circle"],
      ["Previous step", "Light inside a circle"],
      ["Next step", "Parallel light & a circle"],
    ]) {
      await journey(page).getByRole("button", { name, exact: true }).click();
      await expect(
        journey(page).getByRole("heading", { name: title, exact: true }),
      ).toBeVisible();
    }
    const frames = await page.evaluate(() => {
      (window as any).watchJourney = false;
      return (window as any).journeyFrames;
    });
    expect(frames.length).toBeGreaterThan(5);
    for (const frame of frames)
      expect(frame).toEqual({
        play: false,
        open: false,
        feedback: "",
        busy: "false",
      });
  });

test("journey keeps keyboard focus on a step button at either end of the path", async ({
  page,
}) => {
  await page.goto("/");
  await startJourney(page);
  await journeyReady(page);
  const next = journey(page).getByRole("button", {
    name: "Next step",
    exact: true,
  });
  const previous = journey(page).getByRole("button", {
    name: "Previous step",
    exact: true,
  });
  await next.focus();
  await page.keyboard.press("Enter");
  await expect(next).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    journey(page).getByRole("heading", {
      name: "Sunlight gathering in an oval mirror",
      exact: true,
    }),
  ).toBeVisible();
  await expect(next).toBeDisabled();
  await expect(previous).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(
    journey(page).getByRole("heading", {
      name: "Light inside a circle",
      exact: true,
    }),
  ).toBeVisible();
  await expect(previous).toBeDisabled();
  await expect(next).toBeFocused();
});

// Each step's one experiment control, as the journey declares it.
const experiment = (page: Page) =>
  journey(page).getByRole("group", { name: "Explore this study" });
const drawnStudy = async (page: Page) =>
  JSON.parse((await journey(page).locator("svg desc").textContent())!);

test("journey offers each step's one experiment control at the example's value", async ({
  page,
}) => {
  await page.goto("/");
  await startJourney(page);
  await journeyReady(page);
  const next = journey(page).getByRole("button", {
    name: "Next step",
    exact: true,
  });
  await expect(experiment(page).locator("input:visible")).toHaveCount(1);
  await expect(
    experiment(page).getByRole("textbox", { name: "Source x", exact: true }),
  ).toHaveValue("1");
  await next.click();
  await journeyReady(page);
  await expect(experiment(page).locator("input:visible")).toHaveCount(1);
  await expect(
    experiment(page).getByRole("textbox", {
      name: "Travel direction (degrees)",
      exact: true,
    }),
  ).toHaveValue("0");
  await next.click();
  await journeyReady(page);
  await expect(experiment(page).locator("input:visible")).toHaveCount(1);
  const point = experiment(page).getByRole("slider", {
    name: "Point",
    exact: true,
  });
  await expect(point).toBeVisible();
  // The oval opens with its probe at sample position 0.064 of the domain.
  const n = Number(await point.getAttribute("max"));
  expect(Number(await point.inputValue())).toBe(Math.round(0.064 * n));
});

test("journey control edits redraw the preview, and Open study carries them like a notebook edit", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await choosePreset(page, { label: "Parallel light & a circle" });
  await settled(page);
  await page
    .getByRole("textbox", { name: "Travel direction (degrees)", exact: true })
    .fill("90/2");
  await settled(page);
  await expect(page.locator(".example-current")).toHaveText("Custom study");
  const expected = await copiedStudy(page);
  expect((expected.study as any).config.source.angle).toBe(45);
  await choosePreset(page, 0);
  await settled(page);
  await startJourney(page);
  await journeyReady(page);
  await journey(page)
    .getByRole("button", { name: "Next step", exact: true })
    .click();
  await journeyReady(page);
  const before = await journey(page).locator("svg").innerHTML();
  await experiment(page)
    .getByRole("textbox", { name: "Travel direction (degrees)", exact: true })
    .fill("90/2");
  await expect.poll(async () => (await drawnStudy(page)).source.angle).toBe(45);
  expect(await journey(page).locator("svg").innerHTML()).not.toBe(before);
  await journeyReady(page);
  await journey(page)
    .getByRole("button", { name: "Open study", exact: true })
    .click();
  await expect(journey(page)).toBeHidden();
  await settled(page);
  expect((await copiedStudy(page)).study).toEqual(expected.study);
  // An edited field makes it the reader's own study, as in the notebook.
  await expect(page.locator(".example-current")).toHaveText("Custom study");
  // It plays the example's own animation, with the edited light.
  await expect(
    page.getByRole("combobox", { name: "Animate", exact: true }),
  ).toHaveValue("trace");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
});

test("journey probe edits carry into Open study like a notebook edit", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await choosePreset(page, { label: "Sunlight gathering in an oval mirror" });
  await settled(page);
  await page.getByRole("slider", { name: "Point", exact: true }).press("End");
  await settled(page);
  await expect(page.locator(".example-current")).toHaveText(
    "Sunlight gathering in an oval mirror",
  );
  const expected = await copiedStudy(page);
  expect((expected.study as any).probe.position).toBe(1);
  await choosePreset(page, 0);
  await settled(page);
  await startJourney(page);
  for (let i = 0; i < 2; i++) {
    await journeyReady(page);
    await journey(page)
      .getByRole("button", { name: "Next step", exact: true })
      .click();
  }
  await journeyReady(page);
  const before = await journey(page).locator("svg").innerHTML();
  await experiment(page)
    .getByRole("slider", { name: "Point", exact: true })
    .press("End");
  await expect
    .poll(() => journey(page).locator("svg").innerHTML())
    .not.toBe(before);
  await journey(page)
    .getByRole("button", { name: "Open study", exact: true })
    .click();
  await expect(journey(page)).toBeHidden();
  await settled(page);
  expect((await copiedStudy(page)).study).toEqual(expected.study);
  // Moving the probe keeps the example, as it does in the notebook.
  await expect(page.locator(".example-current")).toHaveText(
    "Sunlight gathering in an oval mirror",
  );
});

test("journey edits stay with their step while navigating and are dropped on return", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  const original = await page.locator("#artwork").innerHTML();
  await startJourney(page);
  await journeyReady(page);
  const sourceX = experiment(page).getByRole("textbox", {
    name: "Source x",
    exact: true,
  });
  await sourceX.fill("1/2");
  await expect
    .poll(async () => (await drawnStudy(page)).source.position.x)
    .toBe(0.5);
  await journey(page)
    .getByRole("button", { name: "Next step", exact: true })
    .click();
  await journeyReady(page);
  expect((await drawnStudy(page)).source.kind).toBe("parallel");
  await journey(page)
    .getByRole("button", { name: "Previous step", exact: true })
    .click();
  await journeyReady(page);
  await expect(sourceX).toHaveValue("1/2");
  expect((await drawnStudy(page)).source.position.x).toBe(0.5);
  await journey(page)
    .getByRole("button", { name: "Return to my study", exact: true })
    .click();
  await expect(journey(page)).toBeHidden();
  await settled(page);
  expect(await page.locator("#artwork").innerHTML()).toBe(original);
  await startJourney(page);
  await journeyReady(page);
  await expect(sourceX).toHaveValue("1");
  expect((await drawnStudy(page)).source.position.x).toBe(1);
});

test("journey control keeps an invalid or pending entry visible and out of Open study", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const send = Worker.prototype.postMessage;
    (window as any).holdScalars = false;
    (window as any).releaseScalar = () => {};
    Worker.prototype.postMessage = function (message: any, ...rest: any[]) {
      if ((window as any).holdScalars && message.action === "scalars")
        (window as any).releaseScalar = () => send.call(this, message, ...rest);
      else send.call(this, message, ...rest);
    };
  });
  await page.goto("/");
  await startJourney(page);
  await journeyReady(page);
  const before = await journey(page).locator("svg").innerHTML();
  const open = journey(page).getByRole("button", {
    name: "Open study",
    exact: true,
  });
  const sourceX = experiment(page).getByRole("textbox", {
    name: "Source x",
    exact: true,
  });
  await sourceX.fill("sqrt(-1)");
  await expect(sourceX).toHaveAttribute("aria-invalid", "true");
  await expect(experiment(page).locator(".field-error")).toBeVisible();
  await expect(open).toBeDisabled();
  await expect(sourceX).toHaveValue("sqrt(-1)");
  expect(await journey(page).locator("svg").innerHTML()).toBe(before);
  // A pending entry cannot be adopted either.
  await page.evaluate(() => ((window as any).holdScalars = true));
  await sourceX.fill("1/2");
  await expect(open).toBeDisabled();
  await expect(experiment(page).locator(".field-error")).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).holdScalars = false;
    (window as any).releaseScalar();
  });
  await expect
    .poll(async () => (await drawnStudy(page)).source.position.x)
    .toBe(0.5);
  await expect(open).toBeEnabled();
});

test("journey presents only the latest control edit, never a superseded reply", async ({
  page,
}) => {
  await interceptComputeReplies(page);
  await page.goto("/");
  await settled(page);
  const baseline = await page.evaluate(() => (window as any).delivered);
  await startJourney(page);
  await journeyReady(page);
  await expect
    .poll(() => page.evaluate((n) => (window as any).delivered - n, baseline))
    .toBeGreaterThanOrEqual(3);
  await page.evaluate(() => ((window as any).holdReplies = true));
  const sourceX = experiment(page).getByRole("textbox", {
    name: "Source x",
    exact: true,
  });
  await sourceX.fill("1/2");
  await expect
    .poll(() => page.evaluate(() => (window as any).replies.length))
    .toBe(1);
  await sourceX.fill("1/4");
  // The first edit's reply arrives after the second edit was made.
  await page.evaluate(() => (window as any).replies.shift()());
  await expect
    .poll(() => page.evaluate(() => (window as any).replies.length))
    .toBe(1);
  expect((await drawnStudy(page)).source.position.x).toBe(1);
  await page.evaluate(() => {
    (window as any).holdReplies = false;
    (window as any).replies.shift()();
  });
  await expect
    .poll(async () => (await drawnStudy(page)).source.position.x)
    .toBe(0.25);
  await journeyReady(page);
});

for (const width of [1280, 390])
  test(`journey control errors while typing never move Open study at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto("/");
    await startJourney(page);
    await journeyReady(page);
    const open = journey(page).getByRole("button", {
      name: "Open study",
      exact: true,
    });
    const at = async () => {
      const box = (await open.boundingBox())!;
      const scroll = await journey(page).evaluate((d) => d.scrollTop);
      return [box.x, box.y + scroll, box.width, box.height];
    };
    const before = await at();
    const sourceX = experiment(page).getByRole("textbox", {
      name: "Source x",
      exact: true,
    });
    // Part-typed values are errors for a moment, then resolve.
    for (const text of [".", "-", "-.", "-.5"]) {
      await sourceX.fill(text);
      if (text !== "-.5")
        await expect(experiment(page).locator(".field-error")).toBeVisible();
      else
        await expect(experiment(page).locator(".field-error")).toHaveCount(0);
      expect(await at()).toEqual(before);
    }
  });

test("journey fits a visual viewport the iOS keyboard shortened, with its field in view", async ({
  page,
}) => {
  const keyboard = await scriptedKeyboard(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await startJourney(page);
  await journeyReady(page);
  const sourceX = experiment(page).getByRole("textbox", {
    name: "Source x",
    exact: true,
  });
  await sourceX.focus();
  // Keyboard open: the screen is 420px tall, 260px down the layout viewport.
  await keyboard(260, 420);
  await expect
    .poll(async () => {
      const box = (await journey(page).boundingBox())!;
      return [box.y, box.height];
    })
    .toEqual([260, 420]);
  // The field and its label are brought into view on that screen.
  await expect
    .poll(async () => {
      const box = (await experiment(page)
        .locator(".field")
        .first()
        .boundingBox())!;
      return box.y >= 260 && box.y + box.height <= 680;
    })
    .toBe(true);
  await expect(sourceX).toBeFocused();
  // A reader who then scrolls away is left there when the keyboard pans
  // again, after the moments that follow focus.
  await page.waitForTimeout(1100);
  await journey(page).evaluate((d) => d.scrollTo(0, 0));
  await keyboard(250, 420);
  await page.waitForTimeout(300);
  expect(await journey(page).evaluate((d) => d.scrollTop)).toBe(0);
  // Closed again: the journey fills the screen as before.
  await sourceX.blur();
  await keyboard(0, 844);
  await expect
    .poll(async () => {
      const box = (await journey(page).boundingBox())!;
      return [box.y, box.height];
    })
    .toEqual([0, 844]);
});

test("journey on a phone keeps swipes off the study behind it and restores its scroll", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await settled(page);
  await page.evaluate(() => scrollTo(0, 600));
  const before = await page.evaluate(() => scrollY);
  expect(before).toBe(600);
  await startJourney(page);
  await journeyReady(page);
  // Scroll the journey to its end, then keep going: the page behind stays.
  const box = (await journey(page).boundingBox())!;
  // Over the heading, not the drawing, which zooms under the wheel.
  await page.mouse.move(box.x + box.width / 2, box.y + 40);
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(50);
  }
  await expect
    .poll(() =>
      journey(page).evaluate(
        (d) => d.scrollTop + d.clientHeight - d.scrollHeight,
      ),
    )
    .toBeGreaterThanOrEqual(-1);
  expect(await page.evaluate(() => scrollY)).toBe(before);
  // A scroll the keyboard left behind is undone on return.
  await page.evaluate(() => scrollTo(0, 900));
  await journey(page)
    .getByRole("button", { name: "Return to my study", exact: true })
    .click();
  await expect(journey(page)).toBeHidden();
  expect(await page.evaluate(() => scrollY)).toBe(before);
});

test("journey adoption waits for a lazy target and a newer link supersedes it", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  let requested = false;
  await page.route(/\/assets\/App-[^/]+\.js$/, async (route) => {
    requested = true;
    await gate;
    await route.continue();
  });
  await page.goto("/");
  await settled(page);
  const original = await page.locator("#artwork").innerHTML();
  const dialog = await excursion(page, journeyTitles[3]);
  await dialog.getByRole("button", { name: "Open study", exact: true }).click();
  await expect.poll(() => requested).toBe(true);
  await expect(
    page.getByText("Opening the fourth dimension…", { exact: true }),
  ).toBeVisible();
  const token = deflateRawSync(
    Buffer.from(
      JSON.stringify({
        v: 1,
        notebook: "4d",
        study: { config: { distance: 7 }, motion: "xw" },
      }),
    ),
  ).toString("base64url");
  await page.evaluate((token) => {
    location.hash = `s=${token}`;
  }, token);
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
  release();
  await settled(page);
  await expect(page.getByLabel("4D eye distance", { exact: true })).toHaveValue(
    "7",
  );
  await expect(
    page.locator(".app:visible").getByLabel("Animate", { exact: true }),
  ).toHaveValue("xw");
  await page.goBack();
  await settled(page);
  expect(await page.locator("#artwork").innerHTML()).toBe(original);
});

for (const notebook of ["3d", "4d"] as const)
  test(`journey entry from ${notebook} settles pending scalars and preserves invalid drafts`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const send = Worker.prototype.postMessage;
      const w = window as any;
      w.releaseScalar = () => {};
      Worker.prototype.postMessage = function (message: any, ...rest: any[]) {
        if (message.action === "scalars")
          w.releaseScalar = () => send.call(this, message, ...rest);
        else send.call(this, message, ...rest);
      };
    });
    await page.goto(`/?study=${notebook}`);
    await settled(page);
    const label = notebook === "3d" ? "Major radius R" : "4D eye distance";
    const input = page.getByLabel(label, { exact: true });
    await input.fill("2*pi");
    const trigger = examplesButton(page);
    const before = await trigger.boundingBox();
    const mode = await page
      .getByRole("radiogroup", { name: "Study dimension" })
      .boundingBox();
    await trigger.click();
    await gallery(page)
      .getByRole("button", { name: journeyTitles[3], exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: journeyTitles[3],
      exact: true,
    });
    await expect(dialog).toBeHidden();
    // The waiting notice appears below the gallery, never moving the
    // notebook switch or the gallery's trigger above it.
    await expect(
      page.getByText("Waiting for your study’s inputs…", { exact: true }),
    ).toBeVisible();
    expect(await trigger.boundingBox()).toEqual(before);
    expect(
      await page
        .getByRole("radiogroup", { name: "Study dimension" })
        .boundingBox(),
    ).toEqual(mode);
    await page.evaluate(() => (window as any).releaseScalar());
    await expect(dialog.locator(".journey-art")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await page.keyboard.press("Escape");
    await expect(input).toHaveValue("2*pi");
    await input.fill("sqrt(-1)");
    await examplesButton(page).click();
    await gallery(page)
      .getByRole("button", { name: journeyTitles[3], exact: true })
      .click();
    await page.evaluate(() => (window as any).releaseScalar());
    await expect(
      page.getByText(
        "Correct the highlighted input before starting the journey.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(input).toHaveValue("sqrt(-1)");
    await expect(input).toHaveAttribute("aria-invalid", "true");
  });

test("journey WebGL failure is explicit and reversible while planar steps still work", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      kind: any,
      ...args: any[]
    ) {
      if (String(kind).startsWith("webgl")) return null;
      return (get as any).call(this, kind, ...args);
    } as any;
  });
  await page.goto("/");
  const original = await page.locator("#artwork").innerHTML();
  const dialog = await excursion(page, journeyTitles[2], 2);
  await expect(dialog.getByRole("alert")).toContainText(/WebGL|3D/);
  await expect(
    dialog.getByRole("button", { name: "Open study", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByRole("button", { name: "Previous step", exact: true })
    .click();
  await expect(dialog.locator(".journey-art")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(
    dialog.getByRole("heading", { name: "De Jong attractor", exact: true }),
  ).toBeVisible();
  await expect(dialog.locator(".journey-art svg")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Open study", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  expect(await page.locator("#artwork").innerHTML()).toBe(original);
});

for (const colorScheme of ["light", "dark"] as const)
  test(`all journeys stay bounded and static on a narrow screen in ${colorScheme} with an alternate palette`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.addInitScript(() =>
      localStorage.setItem("tangent-garden.color-scheme", "cobalt"),
    );
    await page.goto("/");
    for (const title of journeyTitles) {
      const dialog = await excursion(page, title, 2);
      expect(await dialog.evaluate((d) => d.scrollWidth - d.clientWidth)).toBe(
        0,
      );
      await expect(
        dialog.getByRole("button", { name: "Pause", exact: true }),
      ).toHaveCount(0);
      await expect(dialog.locator("svg text")).toHaveCount(0);
      const play = dialog.getByRole("button", {
        name: "Play animation",
        exact: true,
      });
      await play.scrollIntoViewIfNeeded();
      const box = (await play.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
      await dialog.screenshot({ path: info.outputPath(`${title}.png`) });
      await page.keyboard.press("Escape");
    }
  });

test("journey scalar range errors belong to the experiment field", async ({
  page,
}) => {
  await page.goto("/");
  const dialog = await excursion(page, journeyTitles[1], 2);
  const radius = dialog.getByLabel("Tube radius R", { exact: true });
  await radius.fill("-1");
  await expect(dialog.locator(".journey-art")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(radius).toHaveAttribute("aria-invalid", "true");
  await expect(radius.locator("..").getByRole("alert")).toContainText(
    /radius/i,
  );
  await expect(
    dialog.getByRole("button", { name: "Open study", exact: true }),
  ).toBeDisabled();
  await radius.fill("1/4");
  await expect(
    dialog.getByRole("button", { name: "Open study", exact: true }),
  ).toBeEnabled();
  await expect(radius).toHaveValue("1/4");
});

test("completed notebook changes still prune unsupported animation tracks and light tracing", async ({
  page,
}) => {
  const controls = page.locator(".app:visible");
  await page.goto("/?study=3d");
  await choosePreset(page, { label: "A staircase becoming a throat" });
  await settled(page);
  await open(page, "#spatial-animation-section");
  await expect(controls.getByLabel("Parameter 1", { exact: true })).toHaveValue(
    "surfaceB",
  );
  await page
    .getByLabel("Spatial definition", { exact: true })
    .selectOption("torus");
  await expect(controls.getByLabel("Parameter 1", { exact: true })).toHaveValue(
    "length",
  );
  await page
    .getByLabel("Spatial definition", { exact: true })
    .selectOption("rays");
  await settled(page);
  await controls.getByLabel("Animate", { exact: true }).selectOption("trace");
  await expect(controls.getByLabel("Animate", { exact: true })).toHaveValue(
    "trace",
  );
  await page
    .getByLabel("Spatial definition", { exact: true })
    .selectOption("torus");
  await expect(controls.getByLabel("Animate", { exact: true })).toHaveValue(
    "reveal",
  );
  await chooseNotebook(page, "2d");
  await choosePreset(page, { label: "Parallel light & a circle" });
  await settled(page);
  await openAnimation(page);
  await expect(controls.getByLabel("Animate", { exact: true })).toHaveValue(
    "trace",
  );
  await controls.getByRole("button", { name: "evolute", exact: true }).click();
  await expect(controls.getByLabel("Animate", { exact: true })).toHaveValue(
    "reveal",
  );
});

test("staircase journey keeps its authored parameter track after typing through invalid pi", async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    const send = Worker.prototype.postMessage;
    const property = Object.getOwnPropertyDescriptor(
      Worker.prototype,
      "onmessage",
    )!;
    const requests = new WeakMap<Worker, Set<number>>();
    (window as any).staircaseCornerZs = [];
    Worker.prototype.postMessage = function (q: any, ...rest: any[]) {
      if (
        q.action === "spatial" &&
        q.spatial.surface.kind === "helicoid-catenoid"
      ) {
        if (!requests.has(this)) requests.set(this, new Set());
        requests.get(this)!.add(q.id);
      }
      send.call(this, q, ...rest);
    };
    Object.defineProperty(Worker.prototype, "onmessage", {
      ...property,
      set(listener: (event: MessageEvent) => void) {
        property.set!.call(this, (event: MessageEvent) => {
          listener.call(this, event);
          // EngineClient has now restored Go's actual typed points.
          if (!requests.get(this)?.delete(event.data.id)) return;
          const point = event.data.result?.surface?.surface.points[0][0];
          if (point) (window as any).staircaseCornerZs.push(point.z);
        });
      },
    });
  });
  await page.goto("/");
  const dialog = await excursion(page, journeyTitles[5], 2);
  const theta = dialog.getByLabel("Associate angle θ", { exact: true });
  await theta.fill("");
  await theta.pressSequentially("p");
  await expect(theta).toHaveAttribute("aria-invalid", "true");
  // pi parses successfully but lies beyond the associate angle's pi/2
  // limit. Wait for that actual engine refusal before finishing the text.
  await theta.pressSequentially("i");
  await expect(dialog.locator(".journey-feedback")).toContainText(
    /associate angle/i,
  );
  await theta.pressSequentially("/");
  await expect(theta).toHaveAttribute("aria-invalid", "true");
  await theta.pressSequentially("4");
  await expect(theta).toHaveValue("pi/4");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.locator(".journey-art")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await dialog
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  const progress = dialog.getByLabel("Animation progress", { exact: true });
  await expect
    .poll(async () => Number(await progress.inputValue()))
    .toBeGreaterThan(0.01);
  await dialog.getByRole("button", { name: "Pause", exact: true }).click();
  await progress.fill("0.5");
  await expect(progress).toHaveValue("0.5");
  // Halfway through the back-and-forth film is the catenoid, theta=pi/2:
  // its first grid point has z=vMin=-1.2, independent of the edited still.
  // Endpoints are prepared at Play and reused by a seek; retain those
  // returned points rather than requiring another request for the same end.
  for (const z of [-0.85 * Math.PI, -1.2])
    await expect
      .poll(() =>
        page.evaluate(
          (z) =>
            (window as any).staircaseCornerZs.some(
              (value: number) => Math.abs(value - z) < 1e-10,
            ),
          z,
        ),
      )
      .toBe(true);
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Stop", exact: true }).click();
  await theta.fill("0");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Stop", exact: true }).click();
  await dialog.screenshot({ path: info.outputPath("recovered-staircase.png") });
});

test("planar journey preserves its authored light trace across a temporary worker failure", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: any, ...rest: any[]) {
      if (message.action === "compute" && message.config.source.angle === 1) {
        queueMicrotask(() =>
          this.dispatchEvent(
            new MessageEvent("message", {
              data: { id: message.id, error: "Temporary calculation failure." },
            }),
          ),
        );
      } else send.call(this, message, ...rest);
    };
  });
  await page.goto("/");
  const dialog = await excursion(page, journeyTitles[0], 1);
  const direction = dialog.getByLabel("Travel direction (degrees)", {
    exact: true,
  });
  await direction.fill("1");
  await expect(dialog.locator(".journey-feedback")).toContainText(
    "Temporary calculation failure.",
  );
  await direction.fill("0");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        JSON.parse((await dialog.locator("svg desc").textContent())!).animation
          ?.mode,
    )
    .toBe("trace");
  await dialog.getByRole("button", { name: "Stop", exact: true }).click();
});

for (const [title, control] of [
  [journeyTitles[0], "Source x"],
  [journeyTitles[1], "Tangent reach L"],
  [journeyTitles[3], "4D eye distance"],
])
  test(`journey ${title} stops motion immediately on an invalid experiment`, async ({
    page,
  }) => {
    await page.goto("/");
    const dialog = await excursion(page, title);
    await dialog
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Pause", exact: true }),
    ).toBeVisible();
    await dialog.getByLabel(control, { exact: true }).fill("sqrt(-1)");
    await expect(dialog.getByLabel(control, { exact: true })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(
      dialog.getByRole("button", { name: "Pause", exact: true }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: "Play animation", exact: true }),
    ).toBeDisabled();
  });

test("journey 4D loop preparation is bounded and Stop rejects its delayed completion", async ({
  page,
}) => {
  await page.goto("/");
  const dialog = await excursion(page, journeyTitles[3], 2);
  await page.evaluate(() => {
    const w = window as any;
    w.shapeJobs = [];
    w.loopRequests = 0;
    w.loopReplies = 0;
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: any, ...rest: any[]) {
      if (message.action === "tesseract") {
        const replied = (event: MessageEvent) => {
          if (event.data.id !== message.id) return;
          w.loopReplies++;
          this.removeEventListener("message", replied);
        };
        this.addEventListener("message", replied);
        // Hold the endpoint, after the first frame has actually completed:
        // releasing this reply finishes the loop check rather than merely
        // allowing it to start another still-held calculation.
        if (++w.loopRequests === 2) {
          w.shapeJobs.push(() => send.call(this, message, ...rest));
          return;
        }
      }
      send.call(this, message, ...rest);
    };
  });
  await dialog
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).shapeJobs.length))
    .toBe(1);
  await expect(
    dialog.getByRole("button", { name: "Preparing…", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Stop", exact: true }).click();
  await page.evaluate(() =>
    (window as any).shapeJobs.splice(0).forEach((run: () => void) => run()),
  );
  await expect
    .poll(() => page.evaluate(() => (window as any).loopReplies))
    .toBe(2);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(
    dialog.getByRole("button", { name: "Play animation", exact: true }),
  ).toBeEnabled();
  await expect(
    dialog.getByRole("button", { name: "Pause", exact: true }),
  ).toHaveCount(0);
});

for (const notebook of ["3d", "4d"] as const)
  test(`journey ${notebook} worker is bounded and disposed before delayed completion`, async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.addInitScript(() => {
      const w = window as any;
      w.workers = 0;
      w.disposedWorkers = 0;
      w.holdJourney = false;
      w.journeyJobs = [];
      const Native = Worker;
      window.Worker = class extends Native {
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          w.workers++;
        }
        terminate() {
          w.disposedWorkers++;
          super.terminate();
        }
        postMessage(message: any, ...rest: any[]) {
          const send = () =>
            (Native.prototype.postMessage as any).call(this, message, ...rest);
          if (
            w.holdJourney &&
            ["spatial", "tesseract"].includes(message.action)
          )
            w.journeyJobs.push(send);
          else send();
        }
      };
    });
    await page.goto(`/?study=${notebook}`);
    await settled(page);
    const retained = await copiedStudy(page);
    await chooseNotebook(page, "2d");
    await settled(page);
    const planar = await copiedStudy(page);
    const before = await page.evaluate(() => ({
      workers: (window as any).workers,
      disposed: (window as any).disposedWorkers,
    }));
    await page.evaluate(() => {
      (window as any).holdJourney = true;
    });
    await examplesButton(page).click();
    const title = notebook === "3d" ? journeyTitles[1] : journeyTitles[3];
    await gallery(page)
      .getByRole("button", { name: title, exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: title, exact: true });
    await expect
      .poll(() => page.evaluate(() => (window as any).journeyJobs.length))
      .toBe(1);
    await dialog
      .getByRole("button", { name: "Next step", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Next step", exact: true })
      .click();
    expect(await page.evaluate(() => (window as any).journeyJobs.length)).toBe(
      1,
    );
    expect(await page.evaluate(() => (window as any).workers)).toBe(
      before.workers + 1,
    );
    await page.keyboard.press("Escape");
    await expect
      .poll(() => page.evaluate(() => (window as any).disposedWorkers))
      .toBe(before.disposed + 1);
    await page.evaluate(() => {
      (window as any).holdJourney = false;
      (window as any).journeyJobs.splice(0).forEach((run: () => void) => run());
    });
    expect((await copiedStudy(page)).study).toEqual(planar.study);
    await chooseNotebook(page, notebook);
    await settled(page);
    expect((await copiedStudy(page)).study).toEqual(retained.study);
  });

for (const notebook of ["3d", "4d"] as const)
  test(`journey entry cancels retained ${notebook} motion and never resumes it`, async ({
    page,
  }) => {
    await page.goto(`/?study=${notebook}`);
    await settled(page);
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Pause", exact: true }),
    ).toBeVisible();
    const dialog = await excursion(page, journeyTitles[0]);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Play animation", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Resume", exact: true }),
    ).toHaveCount(0);
  });

test("journey 4D playback uses the shared grace period while an experiment computes", async ({
  page,
}) => {
  await page.goto("/");
  const dialog = await excursion(page, journeyTitles[3]);
  await page.evaluate(() => {
    const w = window as any;
    w.grace = [];
    w.heldShapes = [];
    const timeout = window.setTimeout;
    window.setTimeout = ((
      callback: () => void,
      delay?: number,
      ...args: any[]
    ) => {
      if (delay === 300) {
        w.grace.push(callback);
        return 900000 + w.grace.length;
      }
      return timeout(callback, delay, ...args);
    }) as typeof window.setTimeout;
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: any, ...rest: any[]) {
      if (message.action === "tesseract")
        w.heldShapes.push(() => send.call(this, message, ...rest));
      else send.call(this, message, ...rest);
    };
  });
  await dialog.getByLabel("4D eye distance", { exact: true }).fill("6");
  await expect
    .poll(() => page.evaluate(() => (window as any).heldShapes.length))
    .toBe(1);
  const play = dialog.getByRole("button", {
    name: "Play animation",
    exact: true,
    includeHidden: true,
  });
  // The player cannot be activated, but looks unchanged until the common
  // grace timer fires. Hold that timer to make this independent of CPU load.
  await expect(play).toBeEnabled();
  await expect(dialog.locator(".playback")).toHaveAttribute("inert", "");
  await page.evaluate(() =>
    (window as any).grace.splice(0).forEach((run: () => void) => run()),
  );
  await expect(play).toBeDisabled();
  await page.evaluate(() =>
    (window as any).heldShapes.splice(0).forEach((run: () => void) => run()),
  );
  await expect(dialog.locator(".journey-art")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(play).toBeEnabled();
  await expect(dialog.locator(".playback")).not.toHaveAttribute("inert", "");
});

for (const dimension of ["3d", "4d"] as const)
  for (const fails of [false, true])
    test(`journey entry discards a late ${dimension} PNG ${fails ? "error" : "download"}`, async ({
      page,
    }) => {
      await page.addInitScript(() => {
        const w = window as any;
        w.pngEncodings = [];
        w.pngDownloads = [];
        const encode = HTMLCanvasElement.prototype.toBlob;
        HTMLCanvasElement.prototype.toBlob = function (callback, ...options) {
          w.pngEncodings.push(
            (fails: boolean) =>
              new Promise<void>((done) => {
                if (fails) {
                  callback(null);
                  done();
                  return;
                }
                encode.call(
                  this,
                  (blob) => {
                    callback(blob);
                    done();
                  },
                  ...options,
                );
              }),
          );
        };
        const click = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () {
          if (this.download && this.href.startsWith("blob:"))
            w.pngDownloads.push(this.download);
          click.call(this);
        };
      });
      await page.goto(`/?study=${dimension}`);
      await settled(page);
      await exportImage(page, "PNG");
      await expect
        .poll(() => page.evaluate(() => (window as any).pngEncodings.length))
        .toBe(1);
      const dialog = await excursion(page, journeyTitles[0]);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await page.evaluate(async (fails) => {
        await (window as any).pngEncodings.shift()(fails);
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
      }, fails);
      expect(await page.evaluate(() => (window as any).pngDownloads)).toEqual(
        [],
      );
      await expect(page.getByRole("alert")).toHaveCount(0);
    });
