import { tesseractAtlasEntryHelp } from "../web/tesseract/atlas";
import { spatialAtlasEntryHelp } from "../web/spatial/atlas";
import { test, expect, type Page } from "@playwright/test";
import { chooseNotebook, choosePreset, exampleTitles } from "./helpers";
import { helpText, isTiered, withMore, type Help } from "../web/help";
import { svgWeightHelp } from "../web/line-weight";
import { spatialViewHelp, viewHelp } from "../web/refinement";
import { planarPathHelp } from "../web/planar-path";
import { backAndForthHelp, onceHelp, paceHelp } from "../web/timing";
import { repeatHelp as planarRepeatHelp } from "../web/animation";
import { presets } from "../web/presets";
import { familyMotionHelp } from "../web/family-motion";
import {
  phraseHelp,
  phrasePaceHelp,
  phraseRayLengthHelp,
} from "../web/PhraseEditor";
import {
  atlasRangeHelp,
  atlasWholeRangeHelp,
  atlasEntryHelp,
  atlasControlHelp,
} from "../web/atlas";
import {
  fitEntryHelp,
  fitTermsHelp,
  fitSourceHelp,
  fitCorrectionHelp,
  fitOutlineViewHelp,
} from "../web/fourier-fit";
import {
  betweenHelp as planarBetweenHelp,
  betweenMotionHelp,
  probeHelp as planarProbeHelp,
} from "../web/planar-probe";
import { curveProbeMotionHelp } from "../web/probe";
import { cutHelp } from "../web/spatial/cut";
import {
  harmonicFitEntryHelp,
  harmonicFitParameterHelp,
  harmonicFitTermsHelp,
} from "../web/spatial/harmonic-fit";
import {
  repeatHelp as spatialRepeatHelp,
  smoothLoopHelp,
} from "../web/spatial/loop";
import { pathHelp } from "../web/spatial/path";
import { easedPath, easingFactorHelp, transitionHelp } from "../web/key-views";
import { spatialPresets } from "../web/spatial/presets";
import {
  betweenHelp as spatialBetweenHelp,
  describeHelp,
  probeHelp as spatialProbeHelp,
  probeMotionHelp as spatialProbeMotionHelp,
  probeSupport,
  surfacePlotsHelp,
  surfaceProbeHelp,
  pointProbed,
  betweenGridHelp,
} from "../web/spatial/probe";
import { fullRefinementHelp } from "../web/spatial/receiver-view";
import { restartHelp } from "../web/spatial/restart";
import { rideHelp } from "../web/spatial/ride";
import { sightHelp } from "../web/spatial/sight";
import { surfaceShape } from "../web/spatial/surface";
import {
  defaultConfig as tesseractDefaults,
  objectHelp,
  objects,
  repeatHelp as tesseractRepeatHelp,
  viewHelp as tesseractViewHelp,
} from "../web/tesseract/objects";
import { tesseractPresets } from "../web/tesseract/presets";
import { motions } from "../web/tesseract/types";

// Help opens on its essentials: one short line, shorter still in a paired
// column. Whatever more a reader may want waits behind Show more, and is
// itself a short paragraph, so a narrow sidebar column never opens onto a
// page of text (AGENTS.md, Help text).
const briefWords = 20;
const pairedBriefWords = 12;
const moreWords = 60;

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

// Reads every help in the sidebar, open or not, folded sections included,
// and returns each one's topic, essentials and more.
async function helps(page: Page) {
  return page.locator(".app:visible aside").evaluate((aside) =>
    Array.from(aside.querySelectorAll(".help-toggle"), (toggle) => {
      const help = document.getElementById(
        toggle.getAttribute("aria-controls")!,
      )!;
      const brief = help.querySelector(".hint-brief");
      let essentials = help.textContent ?? "";
      if (brief) {
        const copy = brief.cloneNode(true) as HTMLElement;
        copy.querySelector(".help-more")?.remove();
        essentials = copy.textContent ?? "";
      }
      return {
        topic: toggle.getAttribute("aria-label")!,
        paired: toggle.closest(".pair") !== null,
        essentials: essentials.trim(),
        more: help.querySelector(".hint-more")?.textContent?.trim() ?? null,
      };
    }),
  );
}

test("a tiered help opens on its essentials, and Show more reveals the rest", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  const toggle = page.getByRole("button", {
    name: "About Line weight",
    exact: true,
  });
  await toggle.click();
  const help = page.locator(`#${await toggle.getAttribute("aria-controls")}`);
  const brief = help.locator(".hint-brief");
  await expect(brief).toContainText("How wide lines are drawn");
  const more = help.getByRole("button", { name: "Show more" });
  const detail = help.locator(".hint-more");
  await expect(detail).toBeHidden();
  await expect(more).toHaveAttribute(
    "aria-controls",
    (await detail.getAttribute("id"))!,
  );
  await more.click();
  await expect(detail).toBeVisible();
  // The detail keeps the limits the engine enforces.
  await expect(detail).toContainText("one pixel");
  await expect(help.getByRole("button", { name: "Show less" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  // The field's control is described by the whole help while it is open.
  const select = page.getByRole("combobox", { name: "Line weight" });
  await expect(select).toHaveAttribute(
    "aria-describedby",
    (await help.getAttribute("id"))!,
  );
  // Closing the help folds the detail away again, so it reopens on its
  // essentials.
  await toggle.click();
  await expect(help).toBeHidden();
  await toggle.click();
  await expect(detail).toBeHidden();
  await expect(help.getByRole("button", { name: "Show more" })).toBeVisible();
});

const notebooks: Record<string, (page: Page) => Promise<string[]>> = {
  "2D": async (page) => {
    await page.goto("/");
    await expect(page.locator("#artwork")).toBeVisible();
    return exampleTitles(page);
  },
  "3D": async (page) => {
    await page.goto("/");
    await chooseNotebook(page, "3d");
    return exampleTitles(page);
  },
  "4D": async (page) => {
    await page.goto("/");
    await chooseNotebook(page, "4d");
    return exampleTitles(page);
  },
};

for (const [notebook, titles] of Object.entries(notebooks))
  test(`every help in every ${notebook} example opens on a short essentials line`, async ({
    page,
  }) => {
    const labels = await titles(page);
    test.setTimeout(60_000 + 3_000 * labels.length);
    let checked = 0;
    for (const label of labels) {
      await choosePreset(page, { label });
      for (const { topic, paired, essentials, more } of await helps(page)) {
        expect
          .soft(
            words(essentials),
            `${label} · ${topic} opens with ${words(essentials)} words: ${essentials}`,
          )
          .toBeLessThanOrEqual(paired ? pairedBriefWords : briefWords);
        // A second tier has something to show, and stays short.
        if (more !== null) {
          expect.soft(words(more), `${label} · ${topic}`).toBeGreaterThan(0);
          expect
            .soft(
              words(more),
              `${label} · ${topic} shows ${words(more)} more words: ${more}`,
            )
            .toBeLessThanOrEqual(moreWords);
        }
        checked++;
      }
    }
    // Guard against a sweep that silently finds nothing.
    expect(checked).toBeGreaterThan(labels.length);
  });

// Helps that only another setting shows, which no example opens on, so the
// sweep above never reads them: Loop, Ease, a camera flight or ride, the
// cut's options, every probe target, and 4D motions. They are checked from
// the tables the notebooks show them from, at the paired limit where a
// table's help sits in a pair.
test("every help a setting reveals keeps to the same limits", () => {
  const helps: [string, Help<string>, boolean?][] = [];
  const add = (name: string, help: Help<string> | undefined, paired = false) =>
    help && helps.push([name, help, paired]);
  const table = (
    name: string,
    entries: Record<string, Help<string>>,
    paired: string[] = [],
  ) => {
    for (const [key, help] of Object.entries(entries))
      add(`${name}.${key}`, help, paired.includes(key));
  };
  add("line weight", svgWeightHelp);
  add("atlas ranges", atlasRangeHelp, true);
  add("atlas whole-number ranges", atlasWholeRangeHelp, true);
  add("atlas entry", atlasEntryHelp);
  add("spatial atlas entry", spatialAtlasEntryHelp);
  add("4D atlas entry", tesseractAtlasEntryHelp);
  add("harmonic fit entry", harmonicFitEntryHelp);
  add("harmonic fit terms", harmonicFitTermsHelp);
  add("harmonic fit sampling", harmonicFitParameterHelp);
  add("drawn Fourier terms", fitTermsHelp);
  add("drawn Fourier entry", fitEntryHelp);
  add("current-curve Fourier input", fitSourceHelp);
  add("Fourier outline correction", fitCorrectionHelp);
  add("Fourier outline view", fitOutlineViewHelp);
  table("family motion", familyMotionHelp);
  add("phrase mode", phraseHelp);
  add("phrase pace", phrasePaceHelp, true);
  add("phrase ray length", phraseRayLengthHelp);
  table("atlas controls", atlasControlHelp, ["size", "framing"]);
  add("once", onceHelp);
  add("back and forth", backAndForthHelp);
  table("pace", paceHelp);
  table("2D repeat", planarRepeatHelp);
  table("3D repeat", spatialRepeatHelp);
  table("4D repeat", tesseractRepeatHelp);
  add("2D between samples", planarBetweenHelp);
  add("2D refinement to the view", viewHelp);
  table("2D key views", planarPathHelp);
  add("2D eased steady path", easedPath(planarPathHelp.steady));
  add("2D eased smooth path", easedPath(planarPathHelp.smooth));
  add("3D eased steady path", easedPath(pathHelp.steady));
  add("3D eased smooth path", easedPath(pathHelp.smooth));
  add("key-view easing", transitionHelp);
  add("key-view easing factor", easingFactorHelp);
  add("partial 2D easing", easedPath(planarPathHelp.smooth, 0.25));
  add("partial 3D easing", easedPath(pathHelp.smooth, 0.25));
  add("2D probe motion", curveProbeMotionHelp);
  add("2D probe motion between samples", betweenMotionHelp);
  add("3D between samples", spatialBetweenHelp);
  add("3D refinement to the view", spatialViewHelp);
  add("involute restart", restartHelp);
  add("3D full refinement while playing", fullRefinementHelp);
  const { add: _title, ...cutHelps } = cutHelp;
  table("cut", cutHelps, ["offset", "cuts", "beyond"]);
  const { framing: _framing, ...pathHelps } = pathHelp;
  table("key views", pathHelps, ["turns", "leg"]);
  add("key views smooth in a loop", withMore(pathHelp.smooth, smoothLoopHelp));
  table("ride", rideHelp, ["ray", "follow", "turn"]);
  const {
    flat: _flat,
    unstroked: _unstroked,
    unavailable: _unavailable,
    ...sightHelps
  } = sightHelp;
  table("sight", sightHelps, [
    "weight",
    "depth",
    "sheets",
    "hidden",
    "opacity",
  ]);
  for (const [kind, fields] of Object.entries(surfaceShape))
    for (const field of fields) add(`${kind} ${field.label}`, field.help, true);
  for (const { title, config } of presets) {
    add(`${title} probe`, planarProbeHelp(config));
    add(
      `${title} probe between samples`,
      planarProbeHelp(config, undefined, true),
    );
  }
  for (const { name, config } of spatialPresets) {
    add(`${name} probe`, spatialProbeHelp(config));
    add(`${name} probe between samples`, spatialProbeHelp(config, true));
    add(`${name} describe`, describeHelp(config));
    for (const target of probeSupport(config).targets)
      if (target !== "curve") {
        add(`${name} ${target} probe`, surfaceProbeHelp(config, target));
        add(`${name} ${target} plots`, surfacePlotsHelp(config, target));
        add(
          `${name} ${target} probe motion`,
          spatialProbeMotionHelp(config, target),
        );
        if (pointProbed(config, target)) {
          add(
            `${name} ${target} probe between grid samples`,
            surfaceProbeHelp(config, target, true),
          );
          add(
            `${name} ${target} probe motion between grid samples`,
            spatialProbeMotionHelp(config, target, true),
          );
          add(
            `${name} ${target} between grid samples`,
            betweenGridHelp(config, target),
          );
        }
      }
  }
  for (const { name, config } of tesseractPresets) {
    const object = objects[config.object];
    for (const motion of motions(config))
      add(`${name} ${motion.label}`, motion.help);
    for (const field of object.numericFields ?? [])
      add(
        `${name} ${field.label}`,
        typeof field.help === "function" ? field.help(config) : field.help,
      );
    if (object.selection?.visible(config))
      add(
        `${name} ${object.selection.label}`,
        typeof object.selection.help === "function"
          ? object.selection.help(config)
          : object.selection.help,
      );
    for (const choice of object.choices ?? [])
      add(`${name} ${choice.label}`, choice.help);
    for (const field of object.radiusFields)
      add(`${name} ${field.label}`, field.help);
    add(`${name} slice`, object.sliceHelp);
    add(`${name} spread`, object.spreadHelp, true);
  }
  // The 4D object and view menus explain the current choice behind Show
  // more, for every object and each of its views.
  const explained = new Set<string>();
  for (const [key, object] of Object.entries(objects)) {
    const config = object.defaults(tesseractDefaults);
    const help = objectHelp(config);
    add(`4D object ${key}`, help);
    expect(isTiered(help), key).toBe(true);
    explained.add(isTiered(help) ? help.more : "");
    for (const mode of object.modes) {
      const view = tesseractViewHelp({ ...config, mode });
      add(`4D ${key} view ${mode}`, view);
      expect(isTiered(view) && view.more.length > 0, `${key} ${mode}`).toBe(
        true,
      );
    }
    if (object.distanceHelp) add(`4D ${key} eye distance`, object.distanceHelp);
  }
  expect(explained.size).toBe(Object.keys(objects).length);
  for (const [name, help, paired] of helps) {
    const brief = isTiered(help) ? help.brief : help;
    expect
      .soft(words(brief), `${name} opens with ${words(brief)} words: ${brief}`)
      .toBeLessThanOrEqual(paired ? pairedBriefWords : briefWords);
    if (isTiered(help))
      expect
        .soft(
          words(help.more),
          `${name} shows ${words(help.more)} more words: ${help.more}`,
        )
        .toBeLessThanOrEqual(moreWords);
  }
  expect(helps.length).toBeGreaterThan(200);
});

test("path help distinguishes zero, partial and fully settling easing factors", () => {
  for (const style of [
    planarPathHelp.steady,
    planarPathHelp.smooth,
    pathHelp.steady,
    pathHelp.smooth,
  ]) {
    expect(easedPath(style, 0)).toEqual(style);
    expect(helpText(easedPath(style, 0.25))).toContain(
      "softening speed changes",
    );
    expect(helpText(easedPath(style, 0.25))).not.toContain("easing to rest");
    expect(helpText(easedPath(style, 0.5))).toContain("easing to rest");
    expect(helpText(easedPath(style, 1))).toContain("easing to rest");
  }
});

test("phrase pace help explains interpolation within phases rather than retiming the complete phrase", async () => {
  const { phrasePaceHelp } = await import("../web/PhraseEditor");
  expect(phrasePaceHelp).toBeDefined();
  expect(helpText(phrasePaceHelp)).toContain("within each phase");
});

test("Apollonian garden help fits both tiers", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Browse notebook examples" }).click();
  await page.locator("[data-garden-example]").first().click();
  const d = page.getByRole("dialog", { name: "The Apollonian garden" });
  await expect(d.locator("#garden-artwork")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  const entries = await d.evaluate((root) =>
    Array.from(root.querySelectorAll(".help-toggle"), (toggle) => {
      const h = document.getElementById(toggle.getAttribute("aria-controls")!)!;
      const brief = h.querySelector(".hint-brief")?.cloneNode(true) as
        HTMLElement | undefined;
      brief?.querySelector(".help-more")?.remove();
      return {
        topic: toggle.getAttribute("aria-label"),
        paired: !!toggle.closest(".pair"),
        brief: brief?.textContent ?? h.textContent ?? "",
        more: h.querySelector(".hint-more")?.textContent ?? "",
      };
    }),
  );
  expect(entries.map((e) => e.topic)).toEqual([
    "About Circle",
    "About following the selection",
    "About Presentation",
    "About Animation progress",
    "About Reveal duration",
    "About Repeat",
    "About Export resolution",
    "About Export quality",
    "About Minimum radius",
    "About Depth",
    "About Circle limit",
    "About zoom detail",
    "About Line weight",
  ]);
  for (const e of entries) {
    expect(words(e.brief), e.topic!).toBeLessThanOrEqual(
      e.paired ? pairedBriefWords : 20,
    );
    expect(words(e.more), e.topic!).toBeLessThanOrEqual(moreWords);
  }
  // The help states the limits the engine enforces.
  const text = entries.map((e) => `${e.brief} ${e.more}`).join(" ");
  for (const limit of [
    "above 0, at most 1",
    "0–12",
    "4–5,000",
    "20,000",
    // The reveal's duration, and the zoom past which detail begins.
    "0.1–3,600",
    "1.4×",
  ])
    expect(text).toContain(limit);
});

test("hyperbolic lace help fits both tiers and states the engine's limits", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Browse notebook examples" }).click();
  await page.locator('[data-lace-example="1"]').click();
  const d = page.getByRole("dialog", { name: "Hyperbolic lace" });
  await expect(d.locator("#lace-artwork")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  const entries = await d.evaluate((root) =>
    Array.from(root.querySelectorAll(".help-toggle"), (toggle) => {
      const h = document.getElementById(toggle.getAttribute("aria-controls")!)!;
      const brief = h.querySelector(".hint-brief")?.cloneNode(true) as
        HTMLElement | undefined;
      brief?.querySelector(".help-more")?.remove();
      return {
        topic: toggle.getAttribute("aria-label"),
        paired: !!toggle.closest(".pair"),
        brief: brief?.textContent ?? h.textContent ?? "",
        more: h.querySelector(".hint-more")?.textContent ?? "",
      };
    }),
  );
  expect(entries.map((e) => e.topic)).toEqual([
    "About Tile",
    "About following the selection",
    "About Presentation",
    "About Motif",
    "About Tile sides",
    "About Animation progress",
    "About Farthest offset",
    "About Orbits",
    "About Turns",
    "About Duration",
    "About Repeat",
    "About Export resolution",
    "About Export quality",
    "About Offset",
    "About Direction",
    "About Rotation",
    "About Star point",
    "About Depth",
    "About Tile limit",
    "About Line weight",
  ]);
  for (const e of entries) {
    expect(words(e.brief), e.topic!).toBeLessThanOrEqual(
      e.paired ? pairedBriefWords : 20,
    );
    expect(words(e.more), e.topic!).toBeLessThanOrEqual(moreWords);
  }
  // The help states the limits the engine enforces.
  const text = entries.map((e) => `${e.brief} ${e.more}`).join(" ");
  for (const limit of [
    "0–8",
    "1–1,000",
    "10,000",
    "(0)",
    "(1)",
    "617",
    // The isometry and motion (engine.LaceMaxOffset and so on).
    "0–0.8",
    "−100–100 radians",
    "−3–3",
    "0.1–3,600",
    "7,200 frames",
  ])
    expect(text).toContain(limit);
});

test("complex loom help fits both tiers in every source family", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page
    .getByRole("button", { name: "Open complex loom", exact: true })
    .click();
  const d = page.getByRole("dialog", { name: "The complex loom" });
  await expect(d.locator(".loom-panes")).toHaveAttribute("aria-busy", "false");
  await d.getByText("Sampling and limits", { exact: true }).click();
  for (const map of [
    "square",
    "power",
    "exp",
    "exp-power",
    "mobius",
    "joukowski",
    "fractional",
  ]) {
    await d.getByLabel("Complex map", { exact: true }).selectOption(map);
    await expect(d.locator(".loom-panes")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    if (
      map === "mobius" ||
      map === "joukowski" ||
      map === "fractional" ||
      map === "exp" ||
      map === "exp-power" ||
      map === "power"
    )
      await d.getByLabel("Motion", { exact: true }).selectOption("map");
    for (const family of ["rosette", "grid", "concentric", "curve"]) {
      await d.getByLabel("Source family", { exact: true }).selectOption(family);
      await expect(d.locator(".loom-panes")).toHaveAttribute(
        "aria-busy",
        "false",
      );
      const entries = await d.evaluate((root) =>
        Array.from(root.querySelectorAll(".help-toggle"), (toggle) => {
          const h = document.getElementById(
            toggle.getAttribute("aria-controls")!,
          )!;
          const brief = h.querySelector(".hint-brief")?.cloneNode(true) as
            HTMLElement | undefined;
          brief?.querySelector(".help-more")?.remove();
          return {
            topic: toggle.getAttribute("aria-label"),
            paired: !!toggle.closest(".pair"),
            brief: brief?.textContent ?? h.textContent ?? "",
            more: h.querySelector(".hint-more")?.textContent ?? "",
          };
        }),
      );
      expect(entries.length).toBeGreaterThan(5);
      for (const e of entries) {
        expect(words(e.brief), e.topic!).toBeLessThanOrEqual(
          e.paired ? 12 : 20,
        );
        expect(words(e.more), e.topic!).toBeLessThanOrEqual(60);
      }
    }
  }
});

test("curves that smooth themselves help fits both tiers and states the engine's limits", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Browse notebook examples" }).click();
  await page.locator('[data-shorten-example="0"]').click();
  const d = page.getByRole("dialog", { name: "Curves that smooth themselves" });
  const art = d.locator("#shorten-artwork");
  await expect(art).toHaveAttribute("aria-busy", "false");
  const read = () =>
    d.evaluate((root) =>
      Array.from(root.querySelectorAll(".help-toggle"), (toggle) => {
        const h = document.getElementById(
          toggle.getAttribute("aria-controls")!,
        )!;
        const brief = h.querySelector(".hint-brief")?.cloneNode(true) as
          HTMLElement | undefined;
        brief?.querySelector(".help-more")?.remove();
        return {
          topic: toggle.getAttribute("aria-label"),
          paired: !!toggle.closest(".pair"),
          brief: brief?.textContent ?? h.textContent ?? "",
          more: h.querySelector(".hint-more")?.textContent ?? "",
        };
      }),
    );
  const flower = await read();
  expect(flower.map((e) => e.topic)).toEqual([
    "About Seed",
    "About Petals",
    "About Petal depth",
    "About Ruffles",
    "About Ruffle depth",
    "About Phase",
    "About Loops",
    "About Spacing",
    "About Nest",
    "About View",
    "About Animation progress",
    "About Duration",
    "About Repeat",
    "About Pacing",
    "About Export resolution",
    "About Export quality",
    "About Line weight",
  ]);
  // The convex seed's own help, shown under another setting.
  await d.getByLabel("Seed", { exact: true }).selectOption("convex");
  await expect(art).toHaveAttribute("aria-busy", "false");
  const convex = (await read()).filter((e) =>
    ["About Lobes", "About Ripple"].includes(e.topic!),
  );
  expect(convex).toHaveLength(2);
  const entries = [...flower, ...convex];
  for (const e of entries) {
    expect(words(e.brief), e.topic!).toBeLessThanOrEqual(
      e.paired ? pairedBriefWords : 20,
    );
    expect(words(e.more), e.topic!).toBeLessThanOrEqual(moreWords);
  }
  // The help states the limits the engine enforces.
  const text = entries.map((e) => `${e.brief} ${e.more}`).join(" ");
  for (const limit of [
    "2–12",
    "8–64",
    "at most 0.9",
    "1/16",
    "1/70",
    "1–48",
    "0.1–3,600",
    "7,200",
    "√(A₀/A)",
  ])
    expect(text).toContain(limit);
});
