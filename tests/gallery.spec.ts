import { test, expect, type Page } from "@playwright/test";
import {
  choosePreset,
  examplesButton,
  chooseNotebook,
  exportImage,
  openExportSettings,
  open,
  scriptedKeyboard,
} from "./helpers";

import { readFile } from "node:fs/promises";
import { presets } from "../web/presets";
import { wireStudy } from "./study-link-wire";
import { decodePng } from "./png";
import { decodeVideo, probe as videoProbe } from "./video";
import { deflateRawSync } from "node:zlib";

const gallery = (page: Page) =>
  page.getByRole("dialog", { name: "Notebook examples" });
const heading = (page: Page) => page.locator(".app:visible .plot-heading");

const journeyTitles = [
  "Light finding a cusp",
  "Threads becoming surfaces",
  "Order inside apparent chaos",
  "A glimpse of four dimensions",
];

for (const dimension of ["2d", "3d", "4d"] as const)
  test(`all four journeys are available from the ${dimension} gallery`, async ({
    page,
  }) => {
    await page.goto(dimension === "2d" ? "/" : `/?study=${dimension}`);
    await settled(page);
    await examplesButton(page).click();
    for (const title of journeyTitles)
      await expect(
        gallery(page).getByRole("button", { name: title, exact: true }),
      ).toBeVisible();
    await gallery(page)
      .getByRole("button", { name: journeyTitles[2], exact: true })
      .click();
    const preview = page.getByRole("dialog", {
      name: journeyTitles[2],
      exact: true,
    });
    for (const title of [
      "Clifford attractor",
      "De Jong attractor",
      "Lorenz's two wings",
    ]) {
      await expect(preview.locator(".journey-art")).toHaveAttribute(
        "aria-busy",
        "false",
      );
      await expect(
        preview.getByRole("heading", { name: title, exact: true }),
      ).toBeVisible();
      await expect(
        preview.getByRole("button", { name: "Pause", exact: true }),
      ).toHaveCount(0);
      await expect(preview.locator("svg text")).toHaveCount(0);
      expect(
        await page.evaluate(() => {
          const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
          return ids.filter((id, i) => ids.indexOf(id) !== i);
        }),
      ).toEqual([]);
      if (title !== "Lorenz's two wings")
        await preview
          .getByRole("button", { name: "Next step", exact: true })
          .click();
    }
    // Transient preview steps do not navigate away from the original notebook.
    expect(new URL(page.url()).searchParams.get("study")).toBe(
      dimension === "2d" ? null : dimension,
    );
    await page.keyboard.press("Escape");
    await expect(preview).toBeHidden();
    await expect(examplesButton(page)).toBeFocused();
    await settled(page);
  });

// However many journeys there are, they share one scrolling row beside the
// family filters, so the section never grows a misaligned wrap.
const fade = 32;
for (const [width, height] of [
  [360, 844],
  [390, 844],
  [844, 390],
  [1440, 844],
])
  test(`journeys share one scrolling row at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await settled(page);
    await examplesButton(page).click();
    const row = gallery(page).getByRole("group", {
      name: "Try a guided journey",
    });
    const track = row.locator(".gallery-journey-list");
    const buttons = row.getByRole("button");
    await expect(buttons).toHaveText(journeyTitles);
    const boxes = await buttons.evaluateAll((all) =>
      all.map((b) => b.getBoundingClientRect().toJSON()),
    );
    for (const box of boxes) expect(box.top).toBe(boxes[0].top);
    // The reassurance stays in view, outside the scrolling row, however
    // many journeys there are, and describes the group to assistive
    // technology. A phone held upright sets it beside the kicker; a wider
    // screen stacks the two, so the row runs on to the panel's edge.
    const note = row.getByText("Previewing keeps your work", {
      exact: true,
    });
    await expect(note).toBeInViewport({ ratio: 1 });
    await expect(row).toHaveAccessibleDescription("Previewing keeps your work");
    const kicker = (await row
      .getByText("Try a guided journey", { exact: true })
      .boundingBox())!;
    const said = (await note.boundingBox())!;
    const list = (await track.boundingBox())!;
    if (width > 700) {
      expect(said.y).toBeGreaterThanOrEqual(kicker.y + kicker.height);
      expect(Math.abs(said.x - kicker.x)).toBeLessThan(1);
      expect(said.y + said.height).toBeLessThanOrEqual(
        boxes[0].y + boxes[0].height + 1,
      );
      expect(list.x).toBeGreaterThan(
        Math.max(kicker.x + kicker.width, said.x + said.width),
      );
      const panel = await gallery(page)
        .locator(".gallery-body")
        .evaluate((b) => {
          const r = b.getBoundingClientRect();
          return r.left + b.clientLeft + b.clientWidth;
        });
      expect(Math.abs(list.x + list.width - panel)).toBeLessThan(1);
    } else if (width >= 390) {
      // Beside each other, the two texts share a baseline: an empty inline
      // block's bottom edge sits on its line's baseline.
      const baseline = (text: string) =>
        row.getByText(text, { exact: true }).evaluate((e) => {
          const mark = document.createElement("span");
          mark.style.display = "inline-block";
          e.append(mark);
          const y = mark.getBoundingClientRect().bottom;
          mark.remove();
          return y;
        });
      expect(
        Math.abs(
          (await baseline("Try a guided journey")) -
            (await baseline("Previewing keeps your work")),
        ),
      ).toBeLessThan(0.5);
    }
    // At most the kicker line, a wrapped note on the narrowest phones, and
    // a single row of buttons.
    const section = (await row.boundingBox())!;
    expect(section.height).toBeLessThan(
      boxes[0].height + (width < 390 ? 70 : 50),
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    // Only an end with more to scroll to fades, and a scroll settles at a
    // journey's start rather than partway through one.
    const edges = () =>
      track.evaluate((t) => ({
        start: t.hasAttribute("data-more-start"),
        end: t.hasAttribute("data-more-end"),
        mask: getComputedStyle(t).maskImage,
        overflow: t.scrollWidth > t.clientWidth,
      }));
    const rest = await edges();
    expect(rest.start).toBe(false);
    expect(rest.end).toBe(rest.overflow);
    expect(rest.mask === "none").toBe(!rest.overflow);
    if (rest.overflow) {
      await track.evaluate((t) => {
        const b = t.children[1] as HTMLElement;
        t.scrollTo({ left: b.offsetLeft - t.offsetLeft + b.offsetWidth / 3 });
      });
      await expect
        .poll(() =>
          track.evaluate((t, fade) => {
            const left = t.getBoundingClientRect().left;
            const max = t.scrollWidth - t.clientWidth;
            return (
              Math.abs(t.scrollLeft - max) < 1 ||
              [...t.children].some(
                (b) =>
                  Math.abs(b.getBoundingClientRect().left - left - fade) < 1.5,
              )
            );
          }, fade),
        )
        .toBe(true);
      // Scroll events, which mark the ends, arrive on the next frame.
      await expect.poll(async () => (await edges()).start).toBe(true);
    }
    // Keyboard focus brings an offscreen journey fully into the row's view,
    // clear of the fades, with room for its focus ring.
    const last = buttons.last();
    await buttons.first().focus();
    for (let i = 1; i < journeyTitles.length; i++)
      await page.keyboard.press("Tab");
    await expect(last).toBeFocused();
    await expect(last).toBeInViewport({ ratio: 1 });
    await expect(note).toBeInViewport({ ratio: 1 });
    await expect.poll(async () => (await edges()).end).toBe(false);
    const clear = await last.evaluate((b, fade) => {
      const t = b.parentElement!;
      const ring = b.getBoundingClientRect();
      const box = t.getBoundingClientRect();
      const start = t.hasAttribute("data-more-start") ? fade : 0;
      const end = t.hasAttribute("data-more-end") ? fade : 0;
      return (
        ring.left - 5 >= box.left + start &&
        ring.right + 5 <= box.right - end &&
        ring.top - 5 >= box.top &&
        ring.bottom + 5 <= box.bottom
      );
    }, fade);
    expect(clear).toBe(true);
    await last.click();
    await expect(
      page.getByRole("dialog", { name: journeyTitles[3], exact: true }),
    ).toBeVisible();
  });

async function settled(page: Page) {
  await expect(
    page.locator(
      ".app:visible .plot-wrap[aria-busy], .app:visible .spatial-stage",
    ),
  ).toHaveAttribute("aria-busy", "false");
}

for (const [path, count] of [
  ["/", 65],
  ["/?study=3d", 141],
  ["/?study=4d", 13],
] as const)
  test(`the ${path === "/" ? "2D" : path.endsWith("4d") ? "4D" : "3D"} gallery shows every example with a current thumbnail`, async ({
    page,
  }) => {
    await page.goto(path);
    const button = examplesButton(page);
    await expect(button).toHaveAttribute("aria-haspopup", "dialog");
    await button.click();
    const dialog = gallery(page);
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("searchbox", { name: "Search examples" }),
    ).toBeFocused();
    const cards = dialog.locator("[data-example]");
    await expect(cards).toHaveCount(count);
    await expect(
      dialog.locator('[data-example][aria-current="true"]'),
    ).toHaveAttribute("data-example", "0");
    // Each preset's thumbnail was rendered from its current definition.
    for (const card of await cards.all()) {
      await card.scrollIntoViewIfNeeded();
      await expect(
        card.locator(".example-thumb"),
        (await card.getAttribute("data-example-title")) ?? "",
      ).toHaveAttribute("data-state", "ready");
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(button).toBeFocused();
  });

test("choosing a card loads its example and closes the gallery", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  const before = await heading(page).locator(".eyebrow").innerText();
  await choosePreset(page, { label: "Chords & a cardioid" });
  await settled(page);
  await expect(page.locator(".example-current")).toHaveText(
    "Chords & a cardioid",
  );
  await expect(heading(page).locator(".eyebrow")).not.toHaveText(before);
  await expect(examplesButton(page)).toBeFocused();
  await examplesButton(page).click();
  await expect(gallery(page).locator('[aria-current="true"]')).toHaveAttribute(
    "data-example-title",
    "Chords & a cardioid",
  );
});

test("dismissing the gallery keeps the current study", async ({ page }) => {
  await page.goto("/");
  await settled(page);
  await page
    .getByRole("textbox", { name: "x(t)", exact: true })
    .fill("3*cos(t)");
  await expect(page.locator(".example-current")).toHaveText("Custom study");
  await examplesButton(page).click();
  await expect(gallery(page).locator('[aria-current="true"]')).toHaveCount(0);
  await gallery(page).getByRole("button", { name: "Close" }).click();
  await expect(gallery(page)).toBeHidden();
  await expect(
    page.getByRole("textbox", { name: "x(t)", exact: true }),
  ).toHaveValue("3*cos(t)");
});

test("search and families narrow the gallery", async ({ page }) => {
  await page.goto("/");
  await examplesButton(page).click();
  const dialog = gallery(page);
  const cards = dialog.locator("[data-example]:visible");
  await dialog
    .getByRole("searchbox", { name: "Search examples" })
    .fill("ellipse");
  // Titles, captions, and families all match.
  for (const text of await cards.allTextContents())
    expect(text.toLowerCase()).toContain("ellipse");
  await expect(
    dialog.locator('[data-example-title="Ellipse & its evolute"]'),
  ).toBeVisible();
  await expect(
    dialog.locator('[data-example-title="Chords of four"]'),
  ).toBeHidden();
  await dialog.getByRole("searchbox", { name: "Search examples" }).fill("zzzz");
  await expect(cards).toHaveCount(0);
  await expect(dialog.getByText("No examples match")).toBeVisible();
  await dialog.getByRole("searchbox", { name: "Search examples" }).fill("");
  const family = dialog
    .getByRole("group", { name: "Example family" })
    .getByRole("button", { name: /^Rolling/ });
  await family.click();
  await expect(family).toHaveAttribute("aria-pressed", "true");
  const titles = await cards.evaluateAll((c) =>
    c.map((e) => (e as HTMLElement).dataset.exampleTitle!),
  );
  expect(titles.length).toBeGreaterThan(2);
  expect(titles).toContain("Flower & a rolling circle");
  expect(titles).not.toContain("Ellipse & its evolute");
  // Enter in the search box takes the first match.
  await dialog
    .getByRole("searchbox", { name: "Search examples" })
    .fill("flower");
  await dialog
    .getByRole("searchbox", { name: "Search examples" })
    .press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page.locator(".example-current")).toHaveText(
    "Flower & a rolling circle",
  );
});

test("arrow keys move between cards", async ({ page }) => {
  await page.goto("/");
  await examplesButton(page).click();
  const dialog = gallery(page);
  // Reading order, which groups examples by family.
  const cards = dialog.locator("[data-example]");
  await cards.nth(0).focus();
  await page.keyboard.press("ArrowRight");
  await expect(cards.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(cards.nth(0)).toBeFocused();
  // Down lands in the next row, below.
  const top = (await cards.nth(0).boundingBox())!.y;
  await page.keyboard.press("ArrowDown");
  const below = page.locator("[data-example]:focus");
  expect((await below.boundingBox())!.y).toBeGreaterThan(top);
  await page.keyboard.press("End");
  await expect(dialog.locator("[data-example]:visible").last()).toBeFocused();
});

for (const path of ["/", "/?study=3d"])
  test(`previous and next step through the ${path === "/" ? "2D" : path.endsWith("4d") ? "4D" : "3D"} examples`, async ({
    page,
  }) => {
    await page.goto(path);
    const titles = await page.locator(".example-current").innerText();
    await page.getByRole("button", { name: "Next example" }).click();
    await expect(page.locator(".example-current")).not.toHaveText(titles);
    await page.getByRole("button", { name: "Previous example" }).click();
    await expect(page.locator(".example-current")).toHaveText(titles);
    // Wraps around at the start.
    await page.getByRole("button", { name: "Previous example" }).click();
    await examplesButton(page).click();
    // Cards are grouped by family, so find the last preset by index.
    const cards = gallery(page).locator("[data-example]");
    await expect(
      gallery(page).locator(`[data-example="${(await cards.count()) - 1}"]`),
    ).toHaveAttribute("aria-current", "true");
  });

for (const colorScheme of ["light", "dark"] as const)
  test(`the gallery fills a phone screen without sideways scrolling in ${colorScheme}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme });
    await page.goto("/");
    await examplesButton(page).click();
    const box = (await gallery(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(
      await gallery(page).evaluate((d) => d.scrollWidth - d.clientWidth),
    ).toBeLessThanOrEqual(0);
    // Thumbnails take the theme's paper, not a fixed color.
    const card = gallery(page).locator('[data-example="0"] .example-thumb');
    await expect(card).toHaveAttribute("data-state", "ready");
    const [paper, thumb] = await card.evaluate((t) => [
      getComputedStyle(t.closest(".app")!).getPropertyValue("--paper").trim(),
      getComputedStyle(t).backgroundColor,
    ]);
    const probe = await page.evaluate((c) => {
      const d = document.createElement("div");
      d.style.color = c;
      document.body.append(d);
      const v = getComputedStyle(d).color;
      d.remove();
      return v;
    }, paper);
    expect(thumb).toBe(probe);
  });

const journey = (page: Page) =>
  page.getByRole("dialog", { name: "Light finding a cusp", exact: true });
async function startJourney(page: Page) {
  await examplesButton(page).click();
  await gallery(page)
    .getByRole("button", { name: "Light finding a cusp", exact: true })
    .click();
}
async function journeyReady(page: Page) {
  await expect(journey(page)).toBeVisible();
  await expect(journey(page).locator(".journey-art")).toHaveAttribute(
    "aria-busy",
    "false",
  );
}
async function copiedStudy(page: Page) {
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  await page.mouse.click(1, 1);
  return { url, study: wireStudy(url.split("#s=")[1]) };
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
] as const)
  test(`journey adoption in ${item.notebook} equals a normal edited preset, preserves the source, and exports`, async ({
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
    expect(decoded.width).toBe(1000);
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

test("journey retains edited studies, raw drafts, layers, animations, probes and manual cameras in all notebooks", async ({
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
    page.locator(".app:visible").getByLabel("Slice offset h", { exact: true }),
  ).toHaveAttribute("aria-invalid", "true");
  await chooseNotebook(page, "2d");
  const dialog = await excursion(page, journeyTitles[2]);
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
    page.locator(".app:visible").getByLabel("Major radius R", { exact: true }),
  ).toHaveValue("1+1/4");
  expect((await copiedStudy(page)).study).toEqual(spatial.study);
  await chooseNotebook(page, "4d");
  await expect(
    page.locator(".app:visible").getByLabel("Slice offset h", { exact: true }),
  ).toHaveValue("sqrt(-1)");
  await expect(
    page.locator(".app:visible").getByLabel("Slice offset h", { exact: true }),
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

test("journey entry waits for delayed scalar resolution and keeps invalid drafts editable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const send = Worker.prototype.postMessage;
    (window as any).releaseScalar = () => {};
    Worker.prototype.postMessage = function (message: any, ...rest: any[]) {
      if (message.action === "scalars") {
        (window as any).releaseScalar = () => send.call(this, message, ...rest);
      } else send.call(this, message, ...rest);
    };
  });
  await page.goto("/");
  await settled(page);
  const input = page.getByLabel("Shape parameter a", { exact: true });
  await input.fill("2*pi");
  await startJourney(page);
  await expect(journey(page)).toBeHidden();
  await page.evaluate(() => (window as any).releaseScalar());
  await journeyReady(page);
  await journey(page)
    .getByRole("button", { name: "Return to my study", exact: true })
    .click();
  await expect(input).toHaveValue("2*pi");
  await input.fill("sqrt(-1)");
  await startJourney(page);
  await page.evaluate(() => (window as any).releaseScalar());
  await expect(
    page.getByText(
      "Correct the highlighted input before starting the journey.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(journey(page)).toBeHidden();
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
function interceptComputeReplies(page: Page) {
  return page.addInitScript(() => {
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
          const deliver = () => {
            if (event.data.config) w.delivered++;
            listener.call(this, event);
          };
          if (w.holdReplies && event.data.config) w.replies.push(deliver);
          else deliver();
        });
      },
    });
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

test("atlas opens nine roulette variants and cancel preserves the original study", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await choosePreset(page, { label: "Hypotrochoid & its evolute" });
  await settled(page);
  const before = (await copiedStudy(page)).study;
  await page
    .getByRole("button", { name: "Explore parameter atlas", exact: true })
    .click();
  const atlas = page.getByRole("dialog", {
    name: "A field of possible flowers",
    exact: true,
  });
  await expect(atlas).toBeVisible();
  await expect(atlas.locator(".atlas-cell[data-state=valid]")).toHaveCount(9);
  await expect(
    atlas.getByText("Independent framing", { exact: true }),
  ).toBeVisible();
  await expect(atlas.locator("svg text")).toHaveCount(0);
  await atlas
    .getByRole("button", { name: "Inspect row 2, column 2", exact: true })
    .click();
  await expect(atlas.locator(".atlas-inspection")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(
    atlas.getByRole("button", { name: "Adopt variant", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(atlas).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Explore parameter atlas", exact: true }),
  ).toBeFocused();
  expect((await copiedStudy(page)).study).toEqual(before);
});

test("atlas scheduler bounds work, supersedes stale generations and isolates snapshots", async () => {
  const { RouletteAtlas, atlasDefaults, atlasBudget } =
    await import("../web/atlas");
  const { presetStudy } = await import("../web/planar-link");
  const study = presetStudy(
    presets.findIndex((p) => p.title === "Hypotrochoid & its evolute"),
  );
  const original = structuredClone(study);
  const calls: { config: any; resolve: (frame: any) => void }[] = [];
  let active = 0,
    maximum = 0;
  const atlas = new RouletteAtlas(
    {
      compute: (config: any) => {
        active++;
        maximum = Math.max(maximum, active);
        return new Promise<any>((resolve) =>
          calls.push({
            config,
            resolve: (frame) => {
              active--;
              resolve(frame);
            },
          }),
        );
      },
    },
    () => {},
  );
  const finish = async (n: number) => {
    const call = calls[n];
    call.resolve({
      config: structuredClone(call.config),
      result: { base: [{ x: n, y: 1 }] },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  atlas.generate(study, atlasDefaults(study.config));
  study.config.curve.roulette.phase = 99;
  expect(calls).toHaveLength(1);
  expect(atlas.state.cells).toHaveLength(9);
  expect(atlas.state.queued).toBeLessThanOrEqual(9);
  expect(atlas.state.cells.map((c) => [c.radius, c.arm])).toEqual([
    [1.5, 2.25],
    [2, 2.25],
    [2.5, 2.25],
    [1.5, 3],
    [2, 3],
    [2.5, 3],
    [1.5, 3.75],
    [2, 3.75],
    [2.5, 3.75],
  ]);
  atlas.generate(original, { radius: [1, 3], arm: [0, 2] });
  expect(calls).toHaveLength(1); // a newer generation cannot enqueue behind the active request
  await finish(0);
  expect(atlas.state.cells.every((c) => !c.frame)).toBe(true);
  expect(calls).toHaveLength(2);
  expect(calls[1].config.curve.roulette.phase).toBe(
    original.config.curve.roulette.phase,
  );
  await finish(1);
  const saved = structuredClone(atlas.state.cells[0].frame);
  atlas.inspect(0);
  atlas.inspect(0); // only the latest selection may be presented
  await finish(2);
  expect(calls).toHaveLength(4);
  await finish(3);
  expect(atlas.state.selection?.frame).toBeDefined();
  const candidate = atlas.candidate()!;
  expect(candidate.config.curve.roulette.radius).toBe(1);
  expect(candidate.config.curve.roulette.arm).toBe(0);
  const expected = structuredClone(original);
  expected.config.curve.roulette.radius = 1;
  expected.config.curve.roulette.arm = 0;
  expect(candidate).toEqual(expected);
  candidate.layers.base = false;
  candidate.config.curve.roulette.phase = 123;
  expect(atlas.candidate()).toEqual(expected);
  expect(atlas.state.cells[0].frame).toEqual(saved);
  expect(maximum).toBe(1);
  atlas.cancel();
  const last = calls.length - 1;
  if (active) await finish(last);
  expect(atlas.state.cells).toHaveLength(0);
  expect(atlas.state.selection).toBeNull();
  expect(atlas.state.queued).toBe(0);
  expect(atlasBudget({ ...original.config, samples: 32768 }).error).toMatch(
    /atlas.*limit/i,
  );
});

async function observeAtlasWorkers(page: Page, delay = 0) {
  await page.addInitScript(
    ({ delay }) => {
      const Native = window.Worker;
      const logs: any[] = [];
      Object.assign(window, { atlasWorkers: logs, atlasDelay: delay });
      window.Worker = class extends Native {
        log: any;
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          this.log = {
            url: String(url),
            requests: [],
            replies: [],
            active: 0,
            maximum: 0,
            terminated: false,
          };
          logs.push(this.log);
        }
        postMessage(data: any, options?: any) {
          if (data.action === "compute" && !data.probeOnly) {
            this.log.active++;
            this.log.maximum = Math.max(this.log.maximum, this.log.active);
            this.log.requests.push({
              data: structuredClone(data),
              started: performance.now(),
            });
          }
          super.postMessage(data, options);
        }
        set onmessage(handler: any) {
          super.onmessage = (event: MessageEvent) => {
            const deliver = () => {
              const request = this.log.requests.find(
                (r: any) => r.data.id === event.data.id,
              );
              if (request) {
                this.log.active--;
                this.log.replies.push({
                  data: structuredClone(event.data),
                  took: performance.now() - request.started,
                });
              }
              handler?.call(this, event);
            };
            if (logs.indexOf(this.log) > 0)
              setTimeout(deliver, (window as any).atlasDelay);
            else deliver();
          };
        }
        terminate() {
          this.log.terminated = true;
          super.terminate();
        }
      };
    },
    { delay },
  );
}

async function openAtlas(page: Page) {
  await page
    .getByRole("button", { name: "Explore parameter atlas", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "A field of possible flowers",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("atlas geometry and resolved parameters match ordinary WASM requests in every cell", async ({
  page,
}, info) => {
  await observeAtlasWorkers(page);
  await page.goto("/");
  await choosePreset(page, { label: "Hypotrochoid & its evolute" });
  await settled(page);
  const atlas = await openAtlas(page);
  await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(9);
  const observations = await page.evaluate(async () => {
    const logs = (window as any).atlasWorkers;
    const original = logs[0].replies.at(-1).data;
    const grid = logs[1];
    const ordinary = new Worker(grid.url);
    const results = [];
    for (let i = 0; i < 9; i++) {
      const request = grid.requests[i].data;
      const data: any = await new Promise((resolve) => {
        ordinary.onmessage = (e) => resolve(e.data);
        ordinary.postMessage({ ...request, id: i + 100 });
      });
      const actual = grid.replies[i].data;
      results.push({
        same:
          JSON.stringify(data.result) === JSON.stringify(actual.result) &&
          JSON.stringify(data.config) === JSON.stringify(actual.config),
        resultSame:
          JSON.stringify(data.result) === JSON.stringify(actual.result),
        configSame:
          JSON.stringify(data.config) === JSON.stringify(actual.config),
        referenceError: data.error,
        referenceKeys: Object.keys(data),
        samples: actual.result.base.length,
        derived: actual.result.derived.filter(Boolean).length,
        radius: actual.config.curve.roulette.radius,
        arm: actual.config.curve.roulette.arm,
        milliseconds: grid.replies[i].took,
        bytes: JSON.stringify(actual.result).length,
      });
    }
    ordinary.terminate();
    return {
      results,
      maximum: grid.maximum,
      workersBeforeOrdinary: logs.length - 1,
      centerMatchesOriginal:
        JSON.stringify(grid.replies[4].data.result) ===
        JSON.stringify(original.result),
    };
  });
  expect(observations.maximum).toBe(1);
  expect(observations.workersBeforeOrdinary).toBe(2);
  expect(observations.centerMatchesOriginal).toBe(true);
  for (const result of observations.results) {
    expect(result, JSON.stringify(result)).toHaveProperty("same", true);
    expect(result.samples).toBe(2000);
    expect(result.derived).toBeGreaterThan(1900);
  }
  await info.attach("atlas-wasm-measurements", {
    body: JSON.stringify(observations, null, 2),
    contentType: "application/json",
  });
});

test("atlas expression ranges identify invalid cells and never adopt invalid drafts", async ({
  page,
}) => {
  await page.goto("/");
  await choosePreset(page, { label: "Hypotrochoid & its evolute" });
  const atlas = await openAtlas(page);
  await atlas.getByLabel("Rolling radius from", { exact: true }).fill("pi");
  await atlas.getByLabel("Rolling radius to", { exact: true }).fill("2*pi");
  await atlas.getByLabel("Tracing distance from", { exact: true }).fill("0");
  await atlas.getByLabel("Tracing distance to", { exact: true }).fill("phi");
  await atlas
    .getByRole("button", { name: "Generate atlas", exact: true })
    .click();
  await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(6);
  await expect(atlas.locator('.atlas-cell[data-state="invalid"]')).toHaveCount(
    3,
  );
  for (const row of [1, 2, 3])
    await expect(
      atlas.getByRole("button", {
        name: `Inspect row ${row}, column 3`,
        exact: true,
      }),
    ).toBeDisabled();
  await expect(
    atlas.locator('.atlas-cell[data-state="invalid"]').first(),
  ).toContainText("smaller than the fixed radius");
  await atlas
    .getByRole("button", { name: "Inspect row 1, column 1", exact: true })
    .click();
  await expect(
    atlas.getByRole("button", { name: "Adopt variant", exact: true }),
  ).toBeEnabled();
  await atlas.getByRole("tab", { name: "Atlas grid", exact: true }).click();
  await atlas.getByLabel("Rolling radius to", { exact: true }).fill("pi");
  await expect(
    atlas.getByLabel("Rolling radius to", { exact: true }),
  ).toHaveAttribute("aria-invalid", "true");
  await expect(
    atlas.getByRole("button", { name: "Generate atlas", exact: true }),
  ).toBeDisabled();
  await expect(atlas.locator(".atlas-cell")).toHaveCount(0);
  await atlas.getByLabel("Rolling radius to", { exact: true }).fill("1");
  await expect(atlas.getByRole("alert")).toContainText("Rolling radius to");
  await atlas.getByLabel("Rolling radius to", { exact: true }).fill("t+1");
  await expect(
    atlas.getByLabel("Rolling radius to", { exact: true }),
  ).toHaveAttribute("aria-invalid", "true");
  await expect(atlas.getByRole("alert")).toContainText("Rolling radius to");
});

test("atlas adoption changes only its two parameters and matches copied-link reload and SVG export", async ({
  page,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await choosePreset(page, { label: "Hypotrochoid & its evolute" });
  await page.getByLabel("Fixed radius R", { exact: true }).fill("2+4");
  await page.getByLabel("t from", { exact: true }).fill("-pi/3");
  await settled(page);
  const artwork = page.locator("#artwork");
  await artwork.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("+");
  const before = (await copiedStudy(page)).study;
  const atlas = await openAtlas(page);
  await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(9);
  await atlas
    .getByRole("button", { name: "Inspect row 3, column 1", exact: true })
    .click();
  await expect(
    atlas.getByRole("button", { name: "Adopt variant", exact: true }),
  ).toBeEnabled();
  const inspectedPaths = await atlas
    .locator("#atlas-inspected path")
    .evaluateAll((paths) => paths.map((p) => p.getAttribute("d")));
  await atlas
    .getByRole("button", { name: "Adopt variant", exact: true })
    .click();
  await expect(atlas).toBeHidden();
  await settled(page);
  const expected = structuredClone(before);
  expected.config.curve.roulette.radius = 1.5;
  expected.config.curve.roulette.arm = 3.75;
  const after = await copiedStudy(page);
  expect(after.study).toEqual(expected);
  await expect(page.locator(".plot-heading .eyebrow")).toHaveText(
    "YOUR OWN EXPLORATION",
  );
  await expect(page.getByLabel("Fixed radius R", { exact: true })).toHaveValue(
    "2+4",
  );
  await expect(page.getByLabel("t from", { exact: true })).toHaveValue("-pi/3");
  expect(
    await artwork
      .locator("path")
      .evaluateAll((paths) => paths.map((p) => p.getAttribute("d"))),
  ).toEqual(inspectedPaths);
  const download = page.waitForEvent("download");
  await exportImage(page, "SVG");
  const saved = await download;
  const svg = await readFile((await saved.path())!, "utf8");
  expect(svg).not.toMatch(/<text\b/);
  const metadata = JSON.parse(
    svg
      .match(/<desc>(.*?)<\/desc>/s)![1]
      .replaceAll("&quot;", '"')
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&amp;", "&"),
  );
  expect(metadata.curve.roulette.radius).toBe(1.5);
  expect(metadata.curve.roulette.arm).toBe(3.75);
  await page.goto(after.url);
  await settled(page);
  expect((await copiedStudy(page)).study).toEqual(expected);
  expect(
    await artwork
      .locator("path")
      .evaluateAll((paths) => paths.map((p) => p.getAttribute("d"))),
  ).toEqual(inspectedPaths);
});

test("atlas delayed work is serial and cannot revive after regeneration, cancel or notebook switch", async ({
  page,
}) => {
  await observeAtlasWorkers(page, 250);
  await page.goto("/");
  await choosePreset(page, { label: "Hypotrochoid & its evolute" });
  let atlas = await openAtlas(page);
  await expect(atlas.locator('.atlas-cell[data-state="pending"]')).toHaveCount(
    9,
  );
  await atlas.getByLabel("Rolling radius from", { exact: true }).fill("1");
  await atlas.getByLabel("Rolling radius to", { exact: true }).fill("3");
  await atlas
    .getByRole("button", { name: "Generate atlas", exact: true })
    .click();
  await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(9);
  await expect(atlas.locator(".atlas-values").first()).toContainText("r = 1");
  expect(
    await page.evaluate(() => (window as any).atlasWorkers[1].maximum),
  ).toBe(1);
  await atlas
    .getByRole("button", { name: "Inspect row 1, column 1", exact: true })
    .click();
  await atlas
    .getByRole("button", { name: "Cancel atlas", exact: true })
    .click();
  await expect(atlas).toBeHidden();
  await settled(page);
  expect(
    await page.evaluate(() => (window as any).atlasWorkers[1].terminated),
  ).toBe(true);
  await page.waitForTimeout(400);
  await expect(page.locator(".atlas")).toHaveCount(0);
  atlas = await openAtlas(page);
  await atlas.getByRole("radio", { name: "3D studies", exact: true }).click();
  await expect(atlas).toBeHidden();
  await expect(page.locator("#spatial-artwork")).toBeVisible();
  await page.waitForTimeout(400);
  await expect(page.locator(".atlas")).toHaveCount(0);
});

for (const mode of ["light", "dark"] as const)
  for (const width of [390, 1440])
    test(`atlas artwork and keyboard controls at ${width}px in ${mode} with alternate colors`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.emulateMedia({ colorScheme: mode });
      await page.addInitScript(() =>
        localStorage.setItem("tangent-garden.color-scheme", "forest"),
      );
      await page.goto("/");
      await choosePreset(page, { label: "Hypotrochoid & its evolute" });
      const atlas = await openAtlas(page);
      await expect(
        atlas.locator('.atlas-cell[data-state="valid"]'),
      ).toHaveCount(9);
      expect(await atlas.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
        true,
      );
      const first = atlas.getByRole("button", {
        name: "Inspect row 1, column 1",
        exact: true,
      });
      await first.focus();
      await page.keyboard.press("Enter");
      await expect(
        atlas.getByRole("button", { name: "Adopt variant", exact: true }),
      ).toBeEnabled();
      await expect(atlas.locator("svg text")).toHaveCount(0);
      await atlas.getByRole("tab", { name: "Atlas grid", exact: true }).click();
      const selectedInk = await first.evaluate((e) => {
        const style = getComputedStyle(e);
        return {
          border: style.borderTopColor,
          ink: style.getPropertyValue("--base-ink").trim(),
        };
      });
      const ink = selectedInk.ink
        .match(/[a-f\d]{2}/gi)!
        .map((v) => parseInt(v, 16));
      expect(selectedInk.border).toBe(`rgb(${ink.join(", ")})`);
      await first.scrollIntoViewIfNeeded();
      await atlas.screenshot({
        path: info.outputPath(`atlas-${mode}-${width}.png`),
      });
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", {
          name: "Explore parameter atlas",
          exact: true,
        }),
      ).toBeFocused();
    });

test("atlas defaults stay finite and increasing at scalar extremes and zero tracing distance", async () => {
  const { atlasDefaults, atlasRangeError } = await import("../web/atlas");
  for (const radius of [Number.MIN_VALUE, 2, 100000])
    for (const arm of [0, Number.MIN_VALUE, 100000]) {
      const config = structuredClone(presets[0].config);
      Object.assign(config.curve.roulette, { radius, arm });
      const ranges = atlasDefaults(config);
      expect(atlasRangeError(ranges)).toBeNull();
      expect(ranges.radius[0]).toBeGreaterThan(0);
      expect(ranges.arm[0]).toBeGreaterThanOrEqual(0);
      if (arm === 0) expect(ranges.arm).toEqual([0, radius]);
    }
});

test("atlas entry stays disabled for invalid and pending scalar edits", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (data: any, options?: any) {
      if (data.action === "scalars")
        setTimeout(() => post.call(this, data, options), 350);
      else post.call(this, data, options);
    };
  });
  await page.goto("/");
  await choosePreset(page, { label: "Hypotrochoid & its evolute" });
  const entry = page.getByRole("button", {
    name: "Explore parameter atlas",
    exact: true,
  });
  await expect(entry).toBeEnabled();
  const radius = page.getByLabel("Rolling radius r", { exact: true });
  await radius.fill("t");
  await expect(entry).toBeDisabled();
  await expect(radius).toHaveAttribute("aria-invalid", "true");
  await expect(entry).toBeDisabled();
  await expect(page.locator(".atlas")).toHaveCount(0);
  await expect(radius).toHaveValue("t");
  await radius.fill("6");
  await expect(radius).toHaveAttribute("aria-invalid", "true");
  await expect(entry).toBeDisabled();
  await radius.fill("1+2");
  await expect(entry).toBeDisabled();
  await expect(entry).toBeEnabled();
  const atlas = await openAtlas(page);
  await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(9);
  await expect(atlas.locator(".atlas-values").nth(4)).toContainText("r = 3");
  await page.keyboard.press("Escape");
  await expect(radius).toHaveValue("1+2");
});

test("atlas entry uses tiered compatibility help and disables unsupported or excessive studies", async ({
  page,
}) => {
  await observeAtlasWorkers(page);
  await page.goto("/");
  await settled(page);
  const entry = page.getByRole("button", {
    name: "Explore parameter atlas",
    exact: true,
  });
  await expect(entry).toBeDisabled();
  await expect(
    page.getByText(
      "Available for roulette curves. Try Hypotrochoid & its evolute in the examples.",
      { exact: true },
    ),
  ).toHaveCount(0);
  const info = page.getByRole("button", {
    name: "About parameter atlas",
    exact: true,
  });
  await info.click();
  const help = page.locator(`#${await info.getAttribute("aria-controls")}`);
  await expect(help.locator(".hint-brief")).toContainText(
    "for supported definitions",
  );
  await expect(help.locator(".hint-more")).toBeHidden();
  await help.getByRole("button", { name: "Show more", exact: true }).click();
  await expect(help.locator(".hint-more")).toContainText("Roulette");
  await expect(help.locator(".hint-more")).toContainText("along a line");
  expect(await page.evaluate(() => (window as any).atlasWorkers.length)).toBe(
    1,
  );
  await choosePreset(page, { label: "Hypotrochoid & its evolute" });
  await expect(entry).toBeEnabled();
  await page.getByLabel("Numerical samples", { exact: true }).fill("32768");
  await settled(page);
  await expect(entry).toBeDisabled();
  await expect(page.locator(".atlas")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).atlasWorkers.length)).toBe(
    1,
  );
  await expect(
    page.getByLabel("Numerical samples", { exact: true }),
  ).toHaveValue("32768");
  // Admission remains defensive even when a caller bypasses the entry button.
  const { RouletteAtlas, atlasDefaults } = await import("../web/atlas");
  const { presetStudy } = await import("../web/planar-link");
  let calls = 0;
  const scheduler = new RouletteAtlas(
    {
      compute: async () => {
        calls++;
        throw new Error("unexpected request");
      },
    },
    () => {},
  );
  const unsupported = presetStudy(0);
  scheduler.generate(unsupported, atlasDefaults(unsupported.config));
  expect(scheduler.state.error).toMatch(/available for roulette/);
  expect(calls).toBe(0);
});

test("atlas preserves edited layers, probe, animation, raw bounds and refined manual camera on cancel and adoption", async ({
  page,
}) => {
  const { presetStudy } = await import("../web/planar-link");
  const source = presetStudy(
    presets.findIndex((p) => p.title === "Hypotrochoid & its evolute"),
  );
  source.config.adaptive = true;
  source.config.adaptiveView = true;
  source.config.adaptiveFrame = true;
  source.layers = {
    base: true,
    derived: true,
    lines: false,
    incident: false,
    virtual: false,
    axes: true,
  };
  source.weight = "bold";
  source.probe = { enabled: true, between: true, position: 0.417 };
  source.camera = { x: 31, y: -19, zoom: 4 };
  source.length = 1.1;
  source.stop = true;
  source.poleKind = "orthotomic";
  source.animation = {
    ...source.animation,
    duration: 17,
    mode: "parameters",
    camera: "current",
    tracks: [{ target: "rollRadius", from: "1", to: "3" }],
  } as any;
  const token = deflateRawSync(
    JSON.stringify({ v: 1, notebook: "2d", study: source }),
  ).toString("base64url");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`/#s=${token}`);
  await settled(page);
  await page.getByLabel("Fixed radius R", { exact: true }).fill("2+3");
  await page.getByLabel("t from", { exact: true }).fill("-pi/7");
  await settled(page);
  const before = (await copiedStudy(page)).study;
  let atlas = await openAtlas(page);
  await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(9);
  for (const [row, column] of [
    [1, 1],
    [3, 3],
    [2, 2],
  ]) {
    await atlas.getByRole("tab", { name: "Atlas grid", exact: true }).click();
    await atlas
      .getByRole("button", {
        name: `Inspect row ${row}, column ${column}`,
        exact: true,
      })
      .click();
    await expect(
      atlas.getByRole("button", { name: "Adopt variant", exact: true }),
    ).toBeEnabled();
  }
  await page.keyboard.press("Escape");
  await settled(page);
  expect((await copiedStudy(page)).study).toEqual(before);
  await expect(page.getByLabel("Fixed radius R", { exact: true })).toHaveValue(
    "2+3",
  );
  await expect(page.getByLabel("t from", { exact: true })).toHaveValue("-pi/7");
  atlas = await openAtlas(page);
  await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(9);
  await atlas
    .getByRole("button", { name: "Inspect row 2, column 3", exact: true })
    .click();
  await expect(
    atlas.getByRole("button", { name: "Adopt variant", exact: true }),
  ).toBeEnabled();
  const inspected = await atlas
    .locator("#atlas-inspected path")
    .evaluateAll((paths) => paths.map((p) => p.getAttribute("d")));
  await atlas
    .getByRole("button", { name: "Adopt variant", exact: true })
    .click();
  await settled(page);
  const expected = structuredClone(before);
  expected.config.curve.roulette.radius = 2.5;
  expect((await copiedStudy(page)).study).toEqual(expected);
  expect(
    await page
      .locator("#artwork path")
      .evaluateAll((paths) => paths.map((p) => p.getAttribute("d"))),
  ).toEqual(inspected);
  await expect(page.getByLabel("Fixed radius R", { exact: true })).toHaveValue(
    "2+3",
  );
});

test("atlas engine timeout stops unsent numerical work instead of queuing behind a timed-out computation", async () => {
  const { RouletteAtlas, atlasDefaults } = await import("../web/atlas");
  const { presetStudy } = await import("../web/planar-link");
  const study = presetStudy(
    presets.findIndex((p) => p.title === "Hypotrochoid & its evolute"),
  );
  let calls = 0;
  const atlas = new RouletteAtlas(
    {
      compute: async () => {
        calls++;
        throw new Error(
          "Calculation timed out. Reduce the resolution or simplify the expression.",
        );
      },
    },
    () => {},
  );
  atlas.generate(study, atlasDefaults(study.config));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(calls).toBe(1);
  expect(atlas.state.queued).toBe(0);
  expect(atlas.state.error).toMatch(/timed out/);
});

test("atlas center cell keeps the frozen values exactly when rounding moves the midpoint", async () => {
  const { RouletteAtlas, atlasDefaults } = await import("../web/atlas");
  const { presetStudy } = await import("../web/planar-link");
  const study = presetStudy(
    presets.findIndex((p) => p.title === "Hypotrochoid & its evolute"),
  );
  // 0.75·0.83 and 1.25·0.83 halve and sum to 0.8299999999999998, and the
  // entered range 0.63 to 1.03 to 0.8300000000000001.
  study.config.curve.roulette.radius = 1.1;
  study.config.curve.roulette.arm = 0.83;
  for (const ranges of [
    atlasDefaults(study.config),
    { radius: [0.9, 1.3], arm: [0.63, 1.03] } as const,
  ]) {
    const requested: any[] = [];
    const atlas = new RouletteAtlas(
      {
        compute: (config) => {
          requested.push(structuredClone(config));
          return new Promise(() => {});
        },
      },
      () => {},
    );
    atlas.generate(study, structuredClone(ranges) as any);
    expect(atlas.state.cells[4]).toMatchObject({ radius: 1.1, arm: 0.83 });
    // Only the center is snapped; the other cells keep their axis values.
    expect(atlas.state.cells[0]).toMatchObject({
      radius: ranges.radius[0],
      arm: ranges.arm[0],
    });
    expect(atlas.state.cells[8]).toMatchObject({
      radius: ranges.radius[1],
      arm: ranges.arm[1],
    });
    atlas.cancel();
  }
  // A range centered elsewhere keeps its own midpoint.
  const offCenter = new RouletteAtlas(
    { compute: () => new Promise(() => {}) },
    () => {},
  );
  offCenter.generate(study, { radius: [1.5, 2], arm: [1, 2] });
  expect(offCenter.state.cells[4]).toMatchObject({ radius: 1.75, arm: 1.5 });
  offCenter.cancel();
  // The center's request is the frozen study's configuration, unchanged.
  const requested: any[] = [];
  const atlas = new RouletteAtlas(
    {
      compute: async (config) => {
        requested.push(structuredClone(config));
        return { config, result: { base: [] } } as any;
      },
    },
    () => {},
  );
  atlas.generate(study, atlasDefaults(study.config));
  await expect.poll(() => requested.length).toBe(9);
  expect(requested[4]).toEqual(study.config);
});

test("atlas treats any engine refusal as an unavailable cell, whatever its wording", async () => {
  const { RouletteAtlas, atlasDefaults } = await import("../web/atlas");
  const { EngineError } = await import("../web/engine-client");
  const { presetStudy } = await import("../web/planar-link");
  const study = presetStudy(
    presets.findIndex((p) => p.title === "Hypotrochoid & its evolute"),
  );
  let calls = 0;
  let disposed = 0;
  const atlas = new RouletteAtlas(
    {
      compute: async (config) => {
        // Wording a transport failure also uses must not end the atlas.
        if (calls++ === 0)
          throw new EngineError(
            "The rolling path is not closed; the request timed out of range.",
            "curve.roulette.radius",
          );
        return { config, result: { base: [] } } as any;
      },
      dispose: () => {
        disposed++;
      },
    },
    () => {},
  );
  atlas.generate(study, atlasDefaults(study.config));
  await expect.poll(() => calls).toBe(9);
  await expect
    .poll(() => atlas.state.cells.filter((c) => c.frame).length)
    .toBe(8);
  expect(atlas.state.cells[0].error).toMatch(/not closed/);
  expect(atlas.state.error).toBeUndefined();
  expect(disposed).toBe(0);
});

for (const width of [390, 1440])
  test(`atlas tabs switch between grid and full-quality variant without scrolling at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await observeAtlasWorkers(page);
    await page.goto("/");
    await choosePreset(page, { label: "Hypotrochoid & its evolute" });
    const atlas = await openAtlas(page);
    const gridTab = atlas.getByRole("tab", { name: "Atlas grid", exact: true });
    const variantTab = atlas.getByRole("tab", {
      name: "Selected variant",
      exact: true,
    });
    await expect(gridTab).toHaveAttribute("aria-selected", "true");
    await expect(variantTab).toBeDisabled();
    await atlas
      .getByLabel("Tracing distance from", { exact: true })
      .fill("1+1");
    await atlas
      .getByRole("button", { name: "Generate atlas", exact: true })
      .click();
    await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(
      9,
    );
    const cell = atlas.getByRole("button", {
      name: "Inspect row 1, column 1",
      exact: true,
    });
    await cell.click();
    await expect(
      atlas.getByRole("button", { name: "Adopt variant", exact: true }),
    ).toBeEnabled();
    await expect(variantTab).toHaveAttribute("aria-selected", "true");
    await expect(variantTab).toBeFocused();
    await expect(
      atlas.getByRole("button", { name: "Adopt variant", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    const centers = await atlas
      .locator(".atlas-inspected-art")
      .evaluate((art) => {
        const a = art.getBoundingClientRect();
        const panel = art.closest(".atlas-inspection")!.getBoundingClientRect();
        return {
          art: (a.left + a.right) / 2,
          panel: (panel.left + panel.right) / 2,
        };
      });
    expect(Math.abs(centers.art - centers.panel)).toBeLessThan(1);
    await expect(
      atlas.getByRole("tabpanel", { name: "Atlas grid", exact: true }),
    ).toBeHidden();
    await expect(
      atlas.getByRole("heading", {
        name: "Inspect variant · row 1, column 1",
        exact: true,
      }),
    ).toBeInViewport();
    await expect(
      atlas.getByRole("button", { name: "Back to variants", exact: true }),
    ).toHaveCount(0);
    const requests = await page.evaluate(
      () => (window as any).atlasWorkers[1].requests.length,
    );
    await gridTab.click();
    await expect(
      atlas.getByLabel("Tracing distance from", { exact: true }),
    ).toHaveValue("1+1");
    await expect(cell).toBeVisible();
    await expect(cell).toHaveAttribute("aria-pressed", "true");
    await expect(
      atlas.getByRole("tabpanel", { name: "Selected variant", exact: true }),
    ).toBeHidden();
    await page.keyboard.press("ArrowRight");
    await expect(variantTab).toBeFocused();
    await expect(variantTab).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Home");
    await expect(gridTab).toBeFocused();
    await expect(gridTab).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("End");
    await expect(variantTab).toBeFocused();
    expect(
      await page.evaluate(
        () => (window as any).atlasWorkers[1].requests.length,
      ),
    ).toBe(requests);
  });

test("atlas reports a worker failure that arrives after an edit and keeps it through later edits", async () => {
  const { RouletteAtlas, atlasDefaults } = await import("../web/atlas");
  const { presetStudy } = await import("../web/planar-link");
  const study = presetStudy(
    presets.findIndex((p) => p.title === "Hypotrochoid & its evolute"),
  );
  let reject!: (error: Error) => void;
  const seen: (string | undefined)[] = [];
  const atlas = new RouletteAtlas(
    {
      compute: () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    },
    (state) => seen.push(state.failed),
  );
  atlas.generate(study, atlasDefaults(study.config));
  // A range edit cancels the generation while its request is still running.
  atlas.cancel();
  reject(
    new Error(
      "Calculation timed out. Reduce the resolution or simplify the expression.",
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(seen.at(-1)).toMatch(/timed out/);
  atlas.cancel();
  expect(atlas.state.failed).toMatch(/timed out/);
  expect(atlas.state.error).toBe(atlas.state.failed);
});

test("atlas stale worker timeout also invalidates a replacement generation", async () => {
  const { RouletteAtlas, atlasDefaults } = await import("../web/atlas");
  const { presetStudy } = await import("../web/planar-link");
  const study = presetStudy(
    presets.findIndex((p) => p.title === "Hypotrochoid & its evolute"),
  );
  let calls = 0;
  let reject!: (error: Error) => void;
  const atlas = new RouletteAtlas(
    {
      compute: () => {
        calls++;
        return new Promise((_, fail) => {
          reject = fail;
        });
      },
    },
    () => {},
  );
  atlas.generate(study, atlasDefaults(study.config));
  atlas.generate(study, { radius: [1, 3], arm: [0, 2] });
  reject(
    new Error(
      "Calculation timed out. Reduce the resolution or simplify the expression.",
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(calls).toBe(1);
  expect(atlas.state.queued).toBe(0);
  expect(atlas.state.error).toMatch(/timed out/);
  atlas.generate(study, atlasDefaults(study.config));
  expect(calls).toBe(1);
});

test("atlas owns delivered geometry independently across cells and inspection", async () => {
  const { RouletteAtlas, atlasDefaults } = await import("../web/atlas");
  const { presetStudy } = await import("../web/planar-link");
  const study = presetStudy(
    presets.findIndex((p) => p.title === "Hypotrochoid & its evolute"),
  );
  const shared: any = { config: null, result: { base: [{ x: 0, y: 1 }] } };
  let calls = 0;
  const atlas = new RouletteAtlas(
    {
      compute: async (config) => {
        shared.config = config;
        shared.result.base[0].x = ++calls;
        return shared;
      },
    },
    () => {},
  );
  atlas.generate(study, atlasDefaults(study.config));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(atlas.state.cells.map((c) => c.frame!.result.base[0]!.x)).toEqual([
    1, 2, 3, 4, 5, 6, 7, 8, 9,
  ]);
  atlas.state.cells[0].frame!.result.base[0]!.x = 999;
  atlas.inspect(1);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(atlas.state.selection!.frame!.result.base[0]!.x).toBe(10);
  expect(atlas.state.cells[1].frame!.result.base[0]!.x).toBe(2);
  shared.result.base[0].x = 500;
  expect(atlas.state.selection!.frame!.result.base[0]!.x).toBe(10);
});

test("atlas freezes the whole study before later queued cells or adoption read it", async () => {
  const { RouletteAtlas, atlasDefaults } = await import("../web/atlas");
  const { presetStudy } = await import("../web/planar-link");
  const study = presetStudy(
    presets.findIndex((p) => p.title === "Hypotrochoid & its evolute"),
  );
  const original = structuredClone(study);
  const configs: any[] = [];
  const atlas = new RouletteAtlas(
    {
      compute: async (config) => {
        configs.push(structuredClone(config));
        return { config, result: { base: [{ x: 0, y: 1 }] } } as any;
      },
    },
    () => {},
  );
  atlas.generate(study, atlasDefaults(study.config));
  study.config.curve.roulette.phase = 99;
  study.layers.base = false;
  study.animation.duration = 123;
  study.bounds.max = "pi";
  study.camera.zoom = 6;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(configs).toHaveLength(9);
  expect(configs.map((c) => c.curve.roulette.phase)).toEqual(
    Array(9).fill(original.config.curve.roulette.phase),
  );
  atlas.inspect(0);
  await new Promise((resolve) => setTimeout(resolve, 0));
  original.config.curve.roulette.radius = 1.5;
  original.config.curve.roulette.arm = 2.25;
  expect(atlas.candidate()).toEqual(original);
});

test("atlas pending range replacements and a newer study link discard old work", async ({
  page,
}) => {
  await observeAtlasWorkers(page, 250);
  await page.goto("/");
  await choosePreset(page, { label: "Hypotrochoid & its evolute" });
  let atlas = await openAtlas(page);
  const from = atlas.getByLabel("Rolling radius from", { exact: true });
  await from.fill("pi/2");
  await from.fill("phi");
  await atlas
    .getByRole("button", { name: "Generate atlas", exact: true })
    .click();
  await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(9);
  await expect(atlas.locator(".atlas-values").first()).toContainText(
    "r = 1.618",
  );
  await expect(from).toHaveValue("phi");
  const { presetStudy } = await import("../web/planar-link");
  const replacement = presetStudy(0);
  replacement.config.curve.a = 7;
  const token = deflateRawSync(
    JSON.stringify({ v: 1, notebook: "2d", study: replacement }),
  ).toString("base64url");
  await atlas
    .getByRole("button", { name: "Inspect row 1, column 1", exact: true })
    .click();
  await page.goto(`/#s=${token}`);
  await expect.poll(() => new URL(page.url()).hash).toBe("");
  await expect(atlas).toBeHidden();
  await settled(page);
  await expect(
    page.getByLabel("Shape parameter a", { exact: true }),
  ).toHaveValue("7");
  await page.waitForTimeout(400);
  await expect(page.locator(".atlas")).toHaveCount(0);
  await expect(
    page.getByLabel("Shape parameter a", { exact: true }),
  ).toHaveValue("7");
});

test("atlas entry stops playback and desktop sidebar scrolling leaves the drawing fixed", async ({
  page,
}) => {
  await page.goto("/");
  await choosePreset(page, { label: "Hypotrochoid & its evolute" });
  await settled(page);
  const before = await page.locator("#artwork").boundingBox();
  await page.locator("aside").evaluate((e) => {
    e.scrollTop = e.scrollHeight;
  });
  expect(await page.locator("#artwork").boundingBox()).toEqual(before);
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  const atlas = await openAtlas(page);
  await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(9);
  await page.keyboard.press("Escape");
  await settled(page);
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Play animation", exact: true }),
  ).toBeEnabled();
});

test("atlas entry invalidates a pending still export and never emits its late file", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const encode = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
      (window as any).atlasEncoding = true;
      return encode.call(
        this,
        (blob) => setTimeout(() => callback(blob), 900),
        ...args,
      );
    };
  });
  await page.goto("/");
  await choosePreset(page, { label: "Hypotrochoid & its evolute" });
  await settled(page);
  const downloads: string[] = [];
  page.on("download", (file) => downloads.push(file.suggestedFilename()));
  await exportImage(page, "PNG");
  await expect
    .poll(() => page.evaluate(() => !!(window as any).atlasEncoding))
    .toBe(true);
  const atlas = await openAtlas(page);
  await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(9);
  await page.waitForTimeout(1100);
  expect(downloads).toEqual([]);
  await page.keyboard.press("Escape");
  await settled(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("atlas admission accounts for hidden families, refinement and composed work without reducing quality", async () => {
  const { atlasBudget } = await import("../web/atlas");
  const config = structuredClone(
    presets.find((p) => p.title === "Hypotrochoid & its evolute")!.config,
  );
  expect(atlasBudget(config)).toEqual({
    points: 40000,
    work: 360000,
    error: undefined,
  });
  expect(
    atlasBudget({ ...config, samples: 8000, lines: 256 }).error,
  ).toBeUndefined();
  expect(atlasBudget({ ...config, samples: 8001 }).error).toMatch(/limit/);
  expect(atlasBudget({ ...config, lines: 257 }).error).toMatch(/limit/);
  expect(atlasBudget({ ...config, adaptive: true }).error).toBeUndefined();
  expect(
    atlasBudget({ ...config, adaptive: true, input: "pedal" }).error,
  ).toMatch(/limit/);
  expect(
    atlasBudget({ ...config, adaptive: true, kind: "rolling" }).error,
  ).toMatch(/limit/);
  expect(
    atlasBudget({
      ...config,
      adaptive: true,
      kind: "offset",
      stack: { ...config.stack, enabled: true },
    }).error,
  ).toMatch(/limit/);
  expect(config.samples).toBe(2000);
  expect(config.adaptive).toBeUndefined();
});

test("atlas refuses delivered geometry beyond its aggregate numeric storage cap", async () => {
  const { RouletteAtlas, atlasDefaults } = await import("../web/atlas");
  const { presetStudy } = await import("../web/planar-link");
  const study = presetStudy(
    presets.findIndex((p) => p.title === "Hypotrochoid & its evolute"),
  );
  // A single unexpected large reply must be rejected before copying or retaining it.
  const large = { base: Array(4000001).fill(0) };
  const atlas = new RouletteAtlas(
    { compute: async (config) => ({ config, result: large }) as any },
    () => {},
  );
  atlas.generate(study, atlasDefaults(study.config));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(atlas.state.cells).toHaveLength(9);
  expect(
    atlas.state.cells.every(
      (c) => !c.frame && /geometry limit/.test(c.error ?? ""),
    ),
  ).toBe(true);
  expect(atlas.state.queued).toBe(0);
  expect(atlas.candidate()).toBeNull();
});

test("atlas typing keeps the Generate button and feedback stable between scalar replies", async ({
  page,
}) => {
  await observeAtlasWorkers(page, 40);
  await page.goto("/");
  await choosePreset(page, { label: "Hypotrochoid & its evolute" });
  const atlas = await openAtlas(page);
  await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(9);
  await atlas.locator(".atlas-controls").evaluate((controls) => {
    const button = [...controls.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Generate atlas",
    )!;
    const status = controls.querySelector(".atlas-feedback")!;
    const disabled: boolean[] = [];
    const messages: string[] = [];
    const record = () => {
      if (disabled.at(-1) !== button.disabled) disabled.push(button.disabled);
      const text = status.textContent!.trim();
      if (messages.at(-1) !== text) messages.push(text);
    };
    const observer = new MutationObserver(record);
    observer.observe(controls, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["disabled"],
    });
    record();
    Object.assign(window, { atlasTyping: { disabled, messages, observer } });
  });
  const input = atlas.getByLabel("Tracing distance from", { exact: true });
  await input.fill("0");
  await input.pressSequentially(".125", { delay: 90 });
  await expect(
    atlas.getByRole("button", { name: "Generate atlas", exact: true }),
  ).toBeEnabled();
  const observed = await page.evaluate(() => {
    const { disabled, messages, observer } = (window as any).atlasTyping;
    observer.disconnect();
    return { disabled, messages };
  });
  expect(observed.disabled).toEqual([false, true, false]);
  expect(observed.messages).toEqual([
    "9 of 9 variants ready.",
    "Set ranges, then generate nine variants.",
  ]);
  await expect(input).toHaveValue("0.125");
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 1440, height: 1000 },
])
  test(`atlas actions and headers align with their drawings at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await choosePreset(page, { label: "Hypotrochoid & its evolute" });
    const atlas = await openAtlas(page);
    await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(
      9,
    );
    if (viewport.width > 700) {
      const alignment = await atlas.evaluate((root) => {
        const label = root
          .querySelector(".atlas-controls .field-label")!
          .getBoundingClientRect();
        const grid = root.querySelector(".atlas-grid")!.getBoundingClientRect();
        return { label: label.top, grid: grid.top };
      });
      expect(Math.abs(alignment.label - alignment.grid)).toBeLessThan(1);
    }
    await atlas
      .getByRole("button", { name: "Inspect row 1, column 2", exact: true })
      .click();
    const adopt = atlas.getByRole("button", {
      name: "Adopt variant",
      exact: true,
    });
    await expect(adopt).toBeEnabled();
    const layout = await atlas.evaluate((root) => {
      const button = [...root.querySelectorAll("button")]
        .find((b) => b.textContent?.trim() === "Adopt variant")!
        .getBoundingClientRect();
      const heading = root
        .querySelector(".atlas-inspection h3")!
        .getBoundingClientRect();
      const art = root
        .querySelector(".atlas-inspected-art")!
        .getBoundingClientRect();
      const tabs = root.querySelector(".atlas-tabs")!.getBoundingClientRect();
      return {
        buttonTop: button.top,
        buttonBottom: button.bottom,
        headingLeft: heading.left,
        artLeft: art.left,
        artTop: art.top,
        tabsBottom: tabs.bottom,
      };
    });
    expect(layout.buttonBottom).toBeLessThanOrEqual(layout.artTop - 8);
    expect(Math.abs(layout.headingLeft - layout.artLeft)).toBeLessThan(1);
    expect(layout.buttonTop - layout.tabsBottom).toBeLessThan(160);
    await expect(adopt).toBeInViewport({ ratio: 1 });
  });

test("atlas Generate spacing is independent of paired-field margins on first portrait open and rotation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    // Model the observed zero clearance by removing a subgrid child's margin.
    // This does not reproduce the iPhone's underlying first-layout bug.
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(
      ".atlas-controls .pair > .field { margin-block-end: 0; }",
    );
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  });
  await page.goto("/");
  await choosePreset(page, { label: "Hypotrochoid & its evolute" });
  const atlas = await openAtlas(page);
  const gap = () =>
    atlas.evaluate((root) => {
      const input = [...root.querySelectorAll(".atlas-controls input")]
        .at(-1)!
        .getBoundingClientRect();
      const button = [...root.querySelectorAll("button")]
        .find((b) => b.textContent?.trim() === "Generate atlas")!
        .getBoundingClientRect();
      return button.top - input.bottom;
    });
  await expect.poll(gap).toBeGreaterThanOrEqual(12);
  const initial = await gap();
  await page.setViewportSize({ width: 844, height: 390 });
  await expect.poll(gap).toBeGreaterThanOrEqual(12);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(gap).toBe(initial);
});

test("atlas inspection timeout returns to the grid with its failure visible", async ({
  page,
}) => {
  await page.goto("/");
  await choosePreset(page, { label: "Hypotrochoid & its evolute" });
  const atlas = await openAtlas(page);
  await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(9);
  // A real timeout: Go never replies, and EngineClient's own deadline (cut
  // from 30 s) rejects the request. Scalar evaluations still reach Go.
  await page.evaluate(() => {
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (data: any, options?: any) {
      if (data.action !== "compute") post.call(this, data, options);
    };
    const later = window.setTimeout;
    window.setTimeout = ((handler: TimerHandler, ms?: number, ...rest: any[]) =>
      later(handler, ms === 30000 ? 50 : ms, ...rest)) as typeof setTimeout;
  });
  await atlas
    .getByRole("button", { name: "Inspect row 1, column 1", exact: true })
    .click();
  await expect(atlas.getByRole("alert")).toContainText("timed out");
  await expect(
    atlas.getByRole("tab", { name: "Atlas grid", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    atlas.getByRole("tab", { name: "Selected variant", exact: true }),
  ).toBeDisabled();
  await expect(
    atlas.getByRole("button", { name: "Adopt variant", exact: true }),
  ).toHaveCount(0);
  // The disposed worker cannot evaluate a range. That is the atlas's
  // failure, not the entered expression's, and it stays on screen.
  const to = atlas.getByLabel("Rolling radius to", { exact: true });
  await to.fill("2*pi");
  await expect(atlas.getByRole("alert")).toHaveText(
    "The atlas’s numerical engine stopped: Calculation timed out. Reduce the resolution or simplify the expression. Close the atlas and reopen it to continue.",
  );
  await expect(to).not.toHaveAttribute("aria-invalid", "true");
  await expect(atlas).not.toContainText("Numerical engine");
  await expect(
    atlas.getByRole("button", { name: "Generate atlas", exact: true }),
  ).toBeDisabled();
});

test("atlas keeps focus in a range when editing after inspecting a variant", async ({
  page,
}) => {
  await page.goto("/");
  await choosePreset(page, { label: "Hypotrochoid & its evolute" });
  const atlas = await openAtlas(page);
  await atlas
    .getByRole("button", { name: "Inspect row 1, column 1", exact: true })
    .click();
  await expect(
    atlas.getByRole("button", { name: "Adopt variant", exact: true }),
  ).toBeEnabled();
  await atlas.getByRole("tab", { name: "Atlas grid", exact: true }).click();
  const input = atlas.getByLabel("Tracing distance from", { exact: true });
  await input.focus();
  await input.press("End");
  await input.pressSequentially("12", { delay: 80 });
  await expect(input).toHaveValue("2.2512");
  await expect(input).toBeFocused();
  await expect(
    atlas.getByRole("tab", { name: "Selected variant", exact: true }),
  ).toBeDisabled();
});
