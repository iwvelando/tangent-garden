import { test, expect, type Page, type Locator } from "@playwright/test";
import { examplesButton, chooseNotebook, scriptedKeyboard } from "./helpers";
import { gallery, copiedStudy, settled } from "./gallery-helpers";
import * as journeys from "../web/journeys";
import { presetStudy } from "../web/planar-link";
import { presetLoom } from "../web/loom/model";
import { presetGarden } from "../web/garden/model";
import { presetLace } from "../web/lace/model";
import { presetShorten } from "../web/shorten/model";
import { readFile } from "node:fs/promises";
import { deflateRawSync } from "node:zlib";
import {
  OverlayScenes,
  overlayCacheLimit,
  type PreparedOverlay,
} from "../web/overlay-preparation";
import { restore } from "../web/lifted";
import {
  overlayViewport,
  expectWholeOverlayPage,
  expectZoomUsesWholeViewport,
} from "./overlay-viewport";

const title = "Rules that grow a garden";
const kinds = ["loom", "garden", "lace", "shorten"] as const;
const art = (d: Locator) =>
  d.locator(".loom-panes[aria-busy], svg[aria-busy]").first();
async function ready(d: Locator) {
  await expect(art(d)).toHaveAttribute("aria-busy", "false");
  await expect(
    d.getByRole("button", { name: "Open study", exact: true }),
  ).toBeEnabled();
}
async function start(page: Page) {
  await examplesButton(page).click();
  await gallery(page).getByRole("button", { name: title, exact: true }).click();
  const d = page.getByRole("dialog", { name: title, exact: true });
  await expect(d).toBeVisible();
  await ready(d);
  return d;
}
async function step(d: Locator, direction = "Next step") {
  const before = Number(
    (await d.locator(".journey-step").textContent())!.match(/Step (\d)/i)![1],
  );
  await d.getByRole("button", { name: direction, exact: true }).click();
  await expect(d.locator(".journey-step")).toHaveText(
    `Step ${before + (direction === "Next step" ? 1 : -1)} of 4`,
  );
  await ready(d);
}

for (const [width, height] of [
  [440, 860],
  [956, 376],
])
  for (const index of [1, 2, 3])
    test(`zoomed ${kinds[index]} uses the complete ${width}x${height} viewport`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: "light" });
      await page.setViewportSize({ width, height });
      await page.goto("/");
      await page
        .getByRole("button", { name: "Color scheme", exact: true })
        .click();
      await page.getByText("Cobalt & rose", { exact: true }).click();
      const d = await start(page);
      for (let i = 0; i < index; i++) await step(d);
      await expectZoomUsesWholeViewport(d);
    });

for (const [width, height] of [
  [1280, 720],
  [440, 860],
  [956, 376],
]) {
  test(`overlay viewport has one border at ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    const d = await start(page);
    for (let i = 1; i < 4; i++) {
      await step(d);
      const m = await overlayViewport(d);
      expect(m.borders).toEqual([{ element: "journey-art", width: 1 }]);
    }
  });
  test(`overlay viewport contains the complete opening page at ${width}x${height}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    const d = await start(page);
    for (let i = 1; i < 4; i++) {
      await step(d);
      const m = await overlayViewport(d);
      console.log(JSON.stringify({ width, height, step: i + 1, ...m }));
      await page.screenshot({ path: testInfo.outputPath(`step-${i + 1}.png`) });
      expectWholeOverlayPage(m);
    }
  });
}

for (const [width, height] of [
  [1280, 720],
  [390, 844],
  [844, 390],
])
  test(`overlay navigation keeps the same vertical position at ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    const d = await start(page),
      positions: number[] = [];
    for (let i = 0; i < 4; i++) {
      positions.push(
        await d
          .getByRole("group", { name: "Journey steps", exact: true })
          .evaluate((el) => {
            const box = el.closest("dialog")!;
            const scroll = el.closest("aside")?.scrollTop ?? 0;
            return (
              el.getBoundingClientRect().top -
              box.getBoundingClientRect().top +
              box.scrollTop +
              scroll
            );
          }),
      );
      if (i < 3) await step(d);
    }
    expect(Math.max(...positions) - Math.min(...positions)).toBeLessThanOrEqual(
      1,
    );
  });

test("overlay journey adapters preserve complete ordinary presets and a detached base", async () => {
  const api = journeys as any;
  expect(api.overlayJourney?.title).toBe(title);
  expect(api.overlayJourney.steps.map((s: any) => s.overlay)).toEqual(kinds);
  const base = presetStudy(1);
  base.camera = { x: 17, y: -31, zoom: 2 };
  base.loom = presetLoom(1, base.config);
  base.garden = presetGarden(1);
  base.lace = presetLace(1);
  base.shorten = presetShorten(1);
  const before = structuredClone(base);
  const expected = [
    presetLoom(0, base.config),
    presetGarden(0),
    presetLace(0),
    presetShorten(0),
  ];
  for (const [i, kind] of kinds.entries()) {
    const study = api.overlayJourneyStudy(api.overlayJourney.steps[i], base);
    expect(study[kind]).toEqual(expected[i]);
    for (const other of kinds.filter((k) => k !== kind))
      expect(study[other]).toBeUndefined();
    const { loom, garden, lace, shorten, ...plain } = study;
    const { loom: a, garden: b, lace: c, shorten: e, ...original } = before;
    expect(plain).toEqual(original);
    study.config.curve.min = -99;
    study.camera.x = 999;
    expect(base).toEqual(before);
  }
});

test("overlay journey starts still, keeps edited workspace views, adopts and shares without replacing the base", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await settled(page);
  const base = (await copiedStudy(page)).study;
  const d = await start(page);
  await expect(d.getByRole("button", { name: /Pause/ })).toHaveCount(0);
  await expect(d.locator("svg text, svg foreignObject")).toHaveCount(0);
  const source = d.getByLabel("Circle radius", { exact: true });
  await expect(source).toHaveValue("1");
  await source.fill("1/2");
  await ready(d);
  await step(d);
  await expect(d.getByText("Step 2 of 4", { exact: true })).toBeVisible();
  await step(d, "Previous step");
  await expect(source).toHaveValue("0.5");
  await d.getByRole("button", { name: "Open study", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "The complex loom", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(title, { exact: true })).toBeHidden();
  const adopted = (await copiedStudy(page)).study;
  expect(adopted.loom.source.radius).toBe(0.5);
  const { loom, ...underlying } = adopted;
  expect(underlying).toEqual(base);
  await page
    .getByRole("button", { name: "Return to study", exact: true })
    .click();
  await settled(page);
  expect((await copiedStudy(page)).study).toEqual(base);
});

test("overlay guidance names the real controls and the lace's actual motion", () => {
  const steps = journeys.overlayJourney.steps;
  for (const [i, label] of [
    "Circle radius",
    "Minimum radius",
    "Star point",
    "Petal depth",
  ].entries())
    expect(steps[i].suggestion).toContain(label);
  expect(steps[2].suggestion).toContain("glide");
});

test("a failed overlay module reports an explicit refusal and permits return", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  await page.route(/\/assets\/Preview-[^/]+\.js$/, (route) => route.abort());
  await examplesButton(page).click();
  await gallery(page).getByRole("button", { name: title, exact: true }).click();
  const d = page.getByRole("dialog", { name: "Opening journey", exact: true });
  await expect(d.getByRole("alert")).toContainText(/load|fetch|import/i);
  await d
    .getByRole("button", { name: "Return to my study", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(examplesButton(page)).toBeFocused();
});

test("a loading overlay journey can be dismissed with Escape", async ({
  page,
}) => {
  let release!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  await page.route(/\/assets\/Preview-[^/]+\.js$/, async (route) => {
    await held;
    await route.continue().catch(() => {});
  });
  await page.goto("/");
  await settled(page);
  await examplesButton(page).click();
  await gallery(page).getByRole("button", { name: title, exact: true }).click();
  try {
    await expect(
      page.getByText("Opening Circles opening into a rosette…", {
        exact: true,
      }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Return to my study", exact: true }),
    ).toBeHidden();
    await expect(examplesButton(page)).toBeFocused();
  } finally {
    release();
  }
});

for (const [width, height] of [
  [1280, 720],
  [390, 844],
  [844, 390],
])
  test(`all four guided workspaces are reachable at ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    const d = await start(page);
    for (let i = 0; i < 4; i++) {
      await expect(d.getByText(title, { exact: true })).toBeVisible();
      await expect(
        d.getByText(`Step ${i + 1} of 4`, { exact: true }),
      ).toBeVisible();
      await expect(d.locator("svg text, svg foreignObject")).toHaveCount(0);
      const open = d.getByRole("button", { name: "Open study", exact: true });
      await open.scrollIntoViewIfNeeded();
      await expect(open).toBeInViewport({ ratio: 1 });
      await open.focus();
      await expect(open).toBeFocused();
      const boxes = await d.evaluate((el) => ({
        width: el.clientWidth,
        scroll: el.scrollWidth,
      }));
      expect(boxes.scroll).toBeLessThanOrEqual(boxes.width + 1);
      if (i < 3) await step(d);
    }
    await d
      .getByRole("button", { name: "Return to my study", exact: true })
      .click();
    await expect(examplesButton(page)).toBeFocused();
  });

for (const [width, height] of [
  [1280, 720],
  [390, 844],
  [844, 390],
])
  test(`focused overlay experiments keep navigation fixed at ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    const d = await start(page);
    const positions: number[] = [];
    for (const [i, label] of [
      "Circle radius",
      "Minimum radius",
      "Star point",
      "Petal depth",
    ].entries()) {
      await expect(d.getByRole("textbox")).toHaveCount(1);
      await expect(d.getByRole("combobox")).toHaveCount(0);
      await expect(d.getByRole("spinbutton")).toHaveCount(0);
      await expect(d.getByRole("checkbox")).toHaveCount(0);
      await expect(
        d.locator(".journey-art h3, .journey-art button"),
      ).toHaveCount(0);
      await expect(d.getByLabel(label, { exact: true })).toBeVisible();
      const nav = d.getByRole("group", { name: "Journey steps", exact: true });
      positions.push(
        await nav.evaluate((el) => {
          const box = el.closest("dialog")!;
          return (
            el.getBoundingClientRect().top -
            box.getBoundingClientRect().top +
            box.scrollTop
          );
        }),
      );
      if (i < 3) await step(d);
    }
    expect(Math.max(...positions) - Math.min(...positions)).toBeLessThanOrEqual(
      1,
    );
  });

// Observe real worker messages, while leaving the production transport and
// numerical result intact. Also track disposal rather than inferring it from UI.
async function traffic(page: Page) {
  await page.addInitScript(() => {
    const Native = Worker;
    const w = window as any;
    w.overlayTraffic = [];
    w.overlayWorkers = [];
    window.Worker = class extends Native {
      record = { dead: false, actions: [] as string[] };
      waiting = new Map<number, any>();
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        w.overlayWorkers.push(this.record);
        this.addEventListener("message", (e) => {
          const q = this.waiting.get(e.data.id);
          if (q) {
            q.ms = performance.now() - q.start;
            q.reply = JSON.parse(JSON.stringify(e.data.result));
            q.floats = e.data.lifted && Array.from(e.data.lifted.floats);
            q.places = e.data.lifted?.places;
          }
        });
      }
      postMessage(q: any, transfer?: any) {
        this.record.actions.push(q.action ?? "compute");
        if (["loom", "garden", "lace", "shorten"].includes(q.action)) {
          const log = {
            action: q.action,
            request: JSON.parse(JSON.stringify(q[q.action])),
            start: performance.now(),
          };
          w.overlayTraffic.push(log);
          this.waiting.set(q.id, log);
        }
        super.postMessage(q, transfer);
      }
      terminate() {
        this.record.dead = true;
        super.terminate();
      }
    };
  });
}

test("prepared overlay steps switch without requests or painted control and border flashes", async ({
  page,
}) => {
  await traffic(page);
  await page.goto("/");
  const d = await start(page);
  for (let i = 0; i < 3; i++) await step(d);
  for (let i = 0; i < 3; i++) await step(d, "Previous step");
  const requests = await page.evaluate(
    () => (window as any).overlayTraffic.length,
  );
  await page.evaluate(() => {
    const w = window as any;
    w.transitionFlashes = [];
    w.watchTransitions = true;
    const inspect = () => {
      const dialog = document.querySelector("dialog.guided-overlay[open]");
      const open = dialog?.querySelector<HTMLButtonElement>(
        ".journey-adopt button.export",
      );
      const play = dialog?.querySelector<HTMLButtonElement>(
        ".playback .animation-buttons button",
      );
      const slider = dialog?.querySelector('.playback input[type="range"]');
      const extra = dialog?.querySelector(".garden-placeholder");
      if (
        dialog &&
        (!open || open.disabled || !play || play.disabled || !slider || extra)
      )
        w.transitionFlashes.push({
          disabled: open?.disabled,
          play: play?.disabled,
          slider: !!slider,
          placeholder: !!extra,
        });
      if (w.watchTransitions) requestAnimationFrame(inspect);
    };
    requestAnimationFrame(inspect);
  });
  for (const target of [1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0]) {
    const at =
      Number(
        (await d.locator(".journey-step").innerText()).match(/Step (\d)/i)![1],
      ) - 1;
    await d
      .getByRole("button", {
        name: target > at ? "Next step" : "Previous step",
        exact: true,
      })
      .click();
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  await ready(d);
  await page.evaluate(() => {
    (window as any).watchTransitions = false;
  });
  expect(await page.evaluate(() => (window as any).transitionFlashes)).toEqual(
    [],
  );
  expect(await page.evaluate(() => (window as any).overlayTraffic.length)).toBe(
    requests,
  );
});

for (const [index, kind] of kinds.entries())
  test(`${kind} guided geometry matches the ordinary workspace, with native motion and complete adoption`, async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await traffic(page);
    await page.goto("/");
    await settled(page);
    await examplesButton(page).click();
    await gallery(page).locator(`[data-${kind}-example]`).first().click();
    const normal = page.getByRole("dialog");
    await expect(art(normal)).toHaveAttribute("aria-busy", "false");
    const ordinary = await page.evaluate(
      (kind) =>
        (window as any).overlayTraffic.find(
          (q: any) => q.action === kind && q.reply,
        ),
      kind,
    );
    expect(ordinary.reply).toBeTruthy();
    await normal
      .getByRole("button", { name: "Return to study", exact: true })
      .click();
    await page.evaluate(() => {
      (window as any).overlayTraffic = [];
    });
    const d = await start(page);
    for (let i = 0; i < index; i++) await step(d);
    const guided = await page.evaluate(
      (kind) =>
        (window as any).overlayTraffic.find(
          (q: any) => q.action === kind && q.reply,
        ),
      kind,
    );
    expect(guided.request).toEqual(ordinary.request);
    expect(guided.reply).toEqual(ordinary.reply);
    expect(guided.floats).toEqual(ordinary.floats);
    expect(guided.places).toEqual(ordinary.places);
    const result = restore(
      guided.reply,
      guided.floats && {
        floats: Float64Array.from(guided.floats),
        places: guided.places,
      },
    );
    console.log(
      `${kind} worker round trip: ordinary ${ordinary.ms.toFixed(1)} ms; journey ${guided.ms.toFixed(1)} ms`,
    );
    if (kind === "garden") expect(result.curvature.length).toBeGreaterThan(100);
    if (kind === "lace") expect(result.center.length).toBeGreaterThan(10);
    if (kind === "loom") expect(result.members).toHaveLength(12);
    const labels = [
      "Circle radius",
      "Minimum radius",
      "Star point",
      "Petal depth",
    ];
    const values = ["1/2", "1/50", "1/10", "1/5"];
    await d.getByLabel(labels[index], { exact: true }).fill(values[index]);
    await ready(d);
    const picture = d.locator("svg[tabindex]").first();
    await picture.focus();
    await picture.press("+");
    await picture.press("ArrowRight");

    const play = d.getByRole("button", {
      name: /^Play (traversal|reveal|motion)$/,
    });
    await play.click();
    await expect(d.getByRole("button", { name: /^Pause/ })).toBeVisible();
    await d.getByRole("button", { name: /^Pause/ }).click();
    const slider = d.getByRole("slider", {
      name: kind === "loom" ? "Source parameter" : "Animation progress",
      exact: true,
    });
    await slider.fill("0.5");
    await expect(slider).toHaveValue("0.5");
    await expect(
      d.getByRole("button", { name: /^(Resume|Play) / }).first(),
    ).toBeEnabled();
    await d.getByRole("button", { name: "Open study", exact: true }).click();
    const adopted = (await copiedStudy(page)).study;
    // The sampled motion is transient; the edited field and manual view survive.
    if (kind === "loom") {
      expect(adopted.loom.source.radius).toBe(0.5);
      expect(adopted.loom.views.source.zoom).toBeGreaterThan(1);
      expect(adopted.loom.views.source.x).not.toBe(0);
    } else {
      expect(
        adopted[kind][
          { garden: "minRadius", lace: "starPoint", shorten: "depth" }[kind]
        ],
      ).toBe([0.5, 0.02, 0.1, 0.2][index]);
      expect(adopted[kind].view.zoom).toBeGreaterThan(1);
      expect(adopted[kind].view.x).not.toBe(0);
    }
    await page
      .getByRole("button", { name: "Return to study", exact: true })
      .click();
  });

test("invalid scalar experiments refuse adoption, recover, and retain edits through navigation", async ({
  page,
}) => {
  await page.goto("/");
  const d = await start(page);
  for (let i = 0; i < 3; i++) await step(d);
  const depth = d.getByLabel("Petal depth", { exact: true });
  await depth.fill("pi");
  await expect(
    d.getByRole("button", { name: "Open study", exact: true }),
  ).toBeDisabled();
  await expect(d.locator(".field-error")).toContainText(
    /Petal depth|depth|0\.6/,
  );
  await depth.fill("1/5");
  await ready(d);
  await step(d, "Previous step");
  await step(d);
  await expect(depth).toHaveValue("0.2");
  await ready(d);
});

test("cross-notebook overlay entry and adoption preserve invalid planar drafts and use the last settled source", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await settled(page);
  const x = page.getByLabel("x(t)", { exact: true });
  await x.fill("2*cos(t)+1/8");
  await settled(page);
  const base = (await copiedStudy(page)).study;
  await x.fill("cos(");
  await expect(page.locator(".field-error").first()).toBeVisible();
  await chooseNotebook(page, "3d");
  await settled(page);
  const spatial = (await copiedStudy(page)).study;
  let d = await start(page);
  await d
    .getByRole("button", { name: "Return to my study", exact: true })
    .click();
  await settled(page);
  expect((await copiedStudy(page)).study).toEqual(spatial);
  d = await start(page);
  await step(d);
  await d.getByRole("button", { name: "Open study", exact: true }).click();
  const native = page.getByRole("dialog", {
    name: "The Apollonian garden",
    exact: true,
  });
  await expect(native).toBeVisible();
  const adopted = (await copiedStudy(page)).study;
  const { garden, ...underlying } = adopted;
  expect(underlying).toEqual(base);
  await native
    .getByRole("button", { name: "Return to study", exact: true })
    .click();
  await expect(x).toHaveValue("cos(");
  await expect(examplesButton(page)).toBeFocused();
  await chooseNotebook(page, "3d");
  await settled(page);
  expect((await copiedStudy(page)).study).toEqual(spatial);
});

test("navigation and return dispose pending overlay workers and discard late replies", async ({
  page,
}) => {
  await traffic(page);
  await page.addInitScript(() => {
    const parent = Object.getPrototypeOf(Worker.prototype);
    const original = Object.getOwnPropertyDescriptor(parent, "onmessage")!;
    const w = window as any;
    w.heldOverlayReplies = [];
    w.holdOverlayReplies = true;
    Object.defineProperty(Worker.prototype, "onmessage", {
      configurable: true,
      get() {
        return original.get!.call(this);
      },
      set(handler) {
        original.set!.call(this, (event: MessageEvent) => {
          if (w.holdOverlayReplies && event.data.result?.seed === "-1,2,2,3")
            w.heldOverlayReplies.push({
              flush: () => handler.call(this, event),
              record: (this as any).record,
            });
          else handler.call(this, event);
        });
      },
    });
  });
  await page.goto("/");
  const d = await start(page);
  await d.getByRole("button", { name: "Next step", exact: true }).click();
  await expect(d.locator(".journey-step")).toHaveText("Step 1 of 4");
  await expect(
    d.getByRole("slider", { name: "Source parameter", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as any).heldOverlayReplies.length))
    .toBe(1);
  await expect(
    d.getByRole("button", { name: "Open study", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => {
    (window as any).holdOverlayReplies = false;
  });
  await d.getByRole("button", { name: "Next step", exact: true }).click();
  await expect(d.locator(".journey-step")).toHaveText("Step 3 of 4");
  await ready(d);
  expect(
    await page.evaluate(
      () => (window as any).heldOverlayReplies[0].record.dead,
    ),
  ).toBe(true);
  await page.evaluate(() => {
    for (const held of (window as any).heldOverlayReplies) held.flush();
  });
  await expect(d.getByText("Step 3 of 4", { exact: true })).toBeVisible();
  await expect(d.locator("#garden-artwork")).toHaveCount(0);
  await d
    .getByRole("button", { name: "Return to my study", exact: true })
    .click();
  expect(
    await page.evaluate(() =>
      (window as any).overlayWorkers
        .filter((r: any) =>
          r.actions.some((a: string) => ["loom", "garden", "lace"].includes(a)),
        )
        .every((r: any) => r.dead),
    ),
  ).toBe(true);
  await expect(examplesButton(page)).toBeFocused();
});

test("history and incoming study links replace an overlay journey without stale adoption", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  await chooseNotebook(page, "4d");
  await start(page);
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await settled(page);
  await start(page);
  const replacement = presetStudy(1);
  const token = deflateRawSync(
    JSON.stringify({ v: 1, notebook: "2d", study: replacement }),
  ).toString("base64url");
  await page.evaluate((token) => {
    location.hash = `s=${token}`;
  }, token);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("x(t)", { exact: true })).toHaveValue(
    replacement.config.curve.x,
  );
  await settled(page);
});

test("an adopted guided packing uses ordinary vector export and a reopening link", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  const d = await start(page);
  await step(d);
  await d.getByLabel("Minimum radius", { exact: true }).fill("1/50");
  await ready(d);
  await d.getByRole("button", { name: "Open study", exact: true }).click();
  const native = page.getByRole("dialog", {
    name: "The Apollonian garden",
    exact: true,
  });
  await expect(native).toBeVisible();
  await native.getByLabel("Circle", { exact: true }).fill("20");
  await native
    .getByLabel("Presentation", { exact: true })
    .selectOption("selected");
  const copied = await copiedStudy(page);
  await native
    .getByRole("button", { name: "Export image", exact: true })
    .click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /SVG/ }).click();
  const download = await downloading;
  const svg = await readFile((await download.path())!, "utf8");
  expect(svg).toContain("<circle");
  expect(svg).not.toMatch(/<text\b|<foreignObject\b/);
  expect(svg).toContain("apollonian");
  await page.goto(copied.url);
  await expect(native).toBeVisible();
  await expect(native.getByLabel("Circle", { exact: true })).toHaveValue("20");
  await expect(native.getByLabel("Presentation", { exact: true })).toHaveValue(
    "selected",
  );
  await expect(
    native.getByRole("button", { name: "Open study", exact: true }),
  ).toHaveCount(0);
});

for (const [index, label, value, invalid] of [
  [0, "Circle radius", "1/2", "0"],
  [1, "Minimum radius", "1/50", "0"],
  [2, "Star point", "1/10", "pi"],
  [3, "Petal depth", "1/5", "pi"],
] as const)
  test(`${label} visibly changes its artwork and recovers from a refused experiment`, async ({
    page,
  }) => {
    await page.goto("/");
    const d = await start(page);
    for (let i = 0; i < index; i++) await step(d);
    const ink = () =>
      d.locator(".journey-art").evaluate((el) =>
        Array.from(el.querySelectorAll("path,circle"), (p) => ({
          d: p.getAttribute("d"),
          cx: p.getAttribute("cx"),
          cy: p.getAttribute("cy"),
          r: p.getAttribute("r"),
        })),
      );
    const before = await ink();
    expect(before.length).toBeGreaterThan(4);
    const field = d.getByLabel(label, { exact: true });
    await field.fill(invalid);
    await expect(
      d.getByRole("button", { name: "Open study", exact: true }),
    ).toBeDisabled();
    await expect(d.locator(".field-error")).toBeVisible();
    await field.fill(value);
    await ready(d);
    const after = await ink();
    expect(after).not.toEqual(before);
    if (index === 1) expect(after.length).toBeLessThan(before.length / 2);
    if (index === 0) {
      // Opening framing stays fixed: changing r cannot be hidden by a refit.
      const source = d.locator(".loom-panes svg").first();
      const extent = await source
        .locator("path")
        .evaluateAll((paths) =>
          Math.max(...paths.map((p) => p.getBoundingClientRect().width)),
        );
      await field.fill("1");
      await ready(d);
      const original = await source
        .locator("path")
        .evaluateAll((paths) =>
          Math.max(...paths.map((p) => p.getBoundingClientRect().width)),
        );
      expect(extent / original).toBeCloseTo(0.5, 2);
    }
  });

for (const theme of ["light", "dark"] as const)
  test(`overlay artwork walkthrough in ${theme} with an alternate palette`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto("/");
    await settled(page);
    await page
      .getByRole("button", { name: "Color scheme", exact: true })
      .click();
    await page.getByText("Cobalt & rose", { exact: true }).click();
    const d = await start(page);
    for (let i = 0; i < 4; i++) {
      await expect(d.getByRole("button", { name: /^Pause/ })).toHaveCount(0);
      await expect(
        d.locator(".journey-art svg text, .journey-art foreignObject"),
      ).toHaveCount(0);
      await page.screenshot({
        path: testInfo.outputPath(`${theme}-${kinds[i]}.png`),
      });
      if (i < 3) await step(d);
    }
  });

test("the compact overlay journey fits the phone keyboard and reveals its experiment", async ({
  page,
}) => {
  const keyboard = await scriptedKeyboard(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const d = await start(page);
  await step(d);
  const input = d.getByLabel("Minimum radius", { exact: true });
  await input.focus();
  await keyboard(260, 420);
  await expect
    .poll(async () => {
      const box = (await d.boundingBox())!;
      return [box.y, box.height];
    })
    .toEqual([260, 420]);
  await expect
    .poll(async () => {
      const box = (await d.locator(".journey-control .field").boundingBox())!;
      return box.y >= 260 && box.y + box.height <= 680;
    })
    .toBe(true);
  await input.blur();
  await keyboard(0, 844);
  await expect
    .poll(async () => {
      const box = (await d.boundingBox())!;
      return [box.y, box.height];
    })
    .toEqual([0, 844]);
  await page.keyboard.press("Escape");
  await expect(examplesButton(page)).toBeFocused();
});

test("the packing experiment remains bounded at its finest admitted radius", async ({
  page,
}) => {
  await traffic(page);
  await page.goto("/");
  const d = await start(page);
  await step(d);
  await d.getByLabel("Minimum radius", { exact: true }).fill("1e-6");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).overlayTraffic.some(
          (r: any) =>
            r.action === "garden" && r.request.minRadius === 1e-6 && r.reply,
        ),
      ),
    )
    .toBe(true);
  await ready(d);
  const measured = await page.evaluate(() =>
    (window as any).overlayTraffic.find(
      (r: any) =>
        r.action === "garden" && r.request.minRadius === 1e-6 && r.reply,
    ),
  );
  const result = restore(measured.reply, {
    floats: Float64Array.from(measured.floats),
    places: measured.places,
  });
  expect(result.curvature).toHaveLength(5000);
  expect(result.stopped).toBe("count");
  console.log(
    `Finest admitted packing: 5000 circles, count cap reached, worker round trip ${measured.ms.toFixed(1)} ms`,
  );
  await d
    .getByRole("button", { name: "Return to my study", exact: true })
    .click();
  expect(
    await page.evaluate(() =>
      (window as any).overlayWorkers
        .filter((r: any) => r.actions.includes("garden"))
        .every((r: any) => r.dead),
    ),
  ).toBe(true);
});

test("overlay preparation bounds retained geometry and releases replaced outcomes", () => {
  const scenes = new OverlayScenes();
  const study = presetStudy(0);
  const outcome = (length: number) => ({
    study,
    prepared: {
      kind: "garden",
      result: { values: new Float64Array(length) },
    } as unknown as PreparedOverlay,
  });
  for (let i = 0; i < 4; i++) scenes.set(i, outcome(10));
  expect(scenes.size).toBe(4);
  expect(scenes.numericEntries).toBe(40);
  expect(() => scenes.set(4, outcome(1))).toThrow(/budget/);
  expect(scenes.get(4)).toBeUndefined();
  scenes.set(0, outcome(overlayCacheLimit.numbers - 30));
  expect(scenes.numericEntries).toBe(overlayCacheLimit.numbers);
  const previous = scenes.get(1);
  expect(() => scenes.set(1, outcome(11))).toThrow(/budget/);
  expect(scenes.get(1)).toBe(previous);
  scenes.set(0, { study, failure: { message: "refused" } });
  expect(scenes.numericEntries).toBe(30);
  scenes.clear();
  expect(scenes.size).toBe(0);
  expect(scenes.numericEntries).toBe(0);
});
