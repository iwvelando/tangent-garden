import { test, expect, type Page } from "@playwright/test";
import { chooseNotebook, choosePreset, exampleTitles } from "./helpers";
import { isTiered, withMore, type Help } from "../web/help";
import { svgWeightHelp } from "../web/line-weight";
import { backAndForthHelp, onceHelp, paceHelp } from "../web/timing";
import { repeatHelp as planarRepeatHelp } from "../web/animation";
import { presets } from "../web/presets";
import {
  betweenHelp as planarBetweenHelp,
  betweenMotionHelp,
  probeHelp as planarProbeHelp,
} from "../web/planar-probe";
import { curveProbeMotionHelp } from "../web/probe";
import { cutHelp } from "../web/spatial/cut";
import {
  repeatHelp as spatialRepeatHelp,
  smoothLoopHelp,
} from "../web/spatial/loop";
import { pathHelp } from "../web/spatial/path";
import { spatialPresets } from "../web/spatial/presets";
import {
  betweenHelp as spatialBetweenHelp,
  describeHelp,
  probeHelp as spatialProbeHelp,
  probeMotionHelp as spatialProbeMotionHelp,
  probeSupport,
  surfaceProbeHelp,
} from "../web/spatial/probe";
import { rideHelp } from "../web/spatial/ride";
import { sightHelp } from "../web/spatial/sight";
import { surfaceShape } from "../web/spatial/surface";
import {
  objects,
  repeatHelp as tesseractRepeatHelp,
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
  add("once", onceHelp);
  add("back and forth", backAndForthHelp);
  table("pace", paceHelp);
  table("2D repeat", planarRepeatHelp);
  table("3D repeat", spatialRepeatHelp);
  table("4D repeat", tesseractRepeatHelp);
  add("2D between samples", planarBetweenHelp);
  add("2D probe motion", curveProbeMotionHelp);
  add("2D probe motion between samples", betweenMotionHelp);
  add("3D between samples", spatialBetweenHelp);
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
        add(
          `${name} ${target} probe motion`,
          spatialProbeMotionHelp(config, target),
        );
      }
  }
  for (const { name, config } of tesseractPresets) {
    const object = objects[config.object];
    for (const motion of motions(config))
      add(`${name} ${motion.label}`, motion.help);
    for (const field of object.numericFields ?? [])
      add(`${name} ${field.label}`, field.help);
    for (const choice of object.choices ?? [])
      add(`${name} ${choice.label}`, choice.help);
    for (const field of object.radiusFields)
      add(`${name} ${field.label}`, field.help);
    add(`${name} slice`, object.sliceHelp);
    add(`${name} spread`, object.spreadHelp, true);
  }
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
