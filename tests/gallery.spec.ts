import { test, expect, type Locator, type Page } from "@playwright/test";
import {
  choosePreset,
  examplesButton,
  chooseNotebook,
  exportImage,
  openExportSettings,
  openAnimation,
} from "./helpers";
import {
  gallery,
  heading,
  journeyTitles,
  settled,
  copiedStudy,
  observeAtlasWorkers,
  openAtlas,
} from "./gallery-helpers";

import { readFile } from "node:fs/promises";
import { presets } from "../web/presets";
import { decodePng } from "./png";
import { decodeVideo, frameDifference, probe as videoProbe } from "./video";
import { deflateRawSync } from "node:zlib";

for (const dimension of ["2d", "3d", "4d"] as const)
  test(`all journeys are available from the ${dimension} gallery`, async ({
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
      page.getByRole("dialog", { name: journeyTitles.at(-1), exact: true }),
    ).toBeVisible();
  });

for (const [path, count] of [
  ["/", 72],
  ["/?study=3d", 150],
  ["/?study=4d", 20],
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
  // End reaches the last card of all, curves that smooth themselves' convex
  // loop in 2D.
  await page.keyboard.press("End");
  await expect(dialog.locator(".example-card:visible").last()).toBeFocused();
  await expect(page.locator(".example-card:focus")).toHaveAttribute(
    "data-shorten-example",
    "4",
  );
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

// However many families a notebook has, a phone keeps them to one row that
// scrolls sideways, upright or on its side, so the pictures keep the
// screen; the row itself never widens the dialog.
for (const [width, height] of [
  [390, 844],
  [844, 390],
] as const)
  test(`the gallery's families stay one scrolling row on a ${width} × ${height} phone`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/?study=3d");
    await examplesButton(page).click();
    const row = gallery(page).locator(".gallery-families");
    await expect(row).toBeVisible();
    const tops = await row
      .getByRole("button")
      .evaluateAll((buttons) =>
        buttons.map((b) => Math.round(b.getBoundingClientRect().top)),
      );
    expect(tops.length).toBeGreaterThan(8);
    expect(new Set(tops).size).toBe(1);
    const [scroll, client] = await row.evaluate((r) => [
      r.scrollWidth,
      r.clientWidth,
    ]);
    expect(scroll).toBeGreaterThan(client);
    expect(
      await gallery(page).evaluate((d) => d.scrollWidth - d.clientWidth),
    ).toBeLessThanOrEqual(0);
    // The last family scrolls into reach, and the pictures fill most of
    // what the head leaves.
    const last = row.getByRole("button").last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    const grid = (await gallery(page)
      .locator(".gallery-grid-wrap")
      .boundingBox())!;
    expect(grid.height).toBeGreaterThan(height * 0.4);
  });

// A complex map's picture is the change it makes, so its thumbnail pairs the
// source plane with the image plane, twice as wide as other thumbnails. An
// animated preset may show another frame of its motion, named by its map
// parameter: its more striking end, or a frame between that tells it apart
// from a static example of the same map.
const thumbnailParameters: Record<string, string> = {
  "Circles folded into ellipses": "1",
  "A quintic rosette grown into a shell": "1",
  "A squared grid grown into a web": "0.55",
  "A strip curled into rings": "1",
  "Circles folded into a flower": "0.3",
};
test("complex-map thumbnails pair the source and image planes, twice as wide", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  await examplesButton(page).click();
  const section = gallery(page).getByRole("region", { name: "Complex maps" });
  const cards = section.locator("[data-loom-example]");
  await expect(cards).toHaveCount(20);
  const images: Record<string, string> = {};
  for (const card of await cards.all()) {
    const title = (await card.getAttribute("data-example-title"))!;
    await card.scrollIntoViewIfNeeded();
    const thumb = card.locator(".example-thumb");
    await expect(thumb).toHaveAttribute("data-state", "ready");
    const art = thumb.locator(".example-thumb-art > svg");
    await expect(art).toHaveAttribute("viewBox", "0 0 2000 760");
    await expect(art.locator("text")).toHaveCount(0);
    const panes = art.locator(":scope > svg");
    await expect(panes).toHaveCount(2);
    expect(
      await panes.evaluateAll((all) =>
        all.map((p) => [
          p.getAttribute("x") ?? "0",
          p.getAttribute("width"),
          p.getAttribute("viewBox"),
        ]),
      ),
      title,
    ).toEqual([
      ["0", "1000", "0 0 1000 760"],
      ["1000", "1000", "0 0 1000 760"],
    ]);
    // Each plane draws its own geometry: even the strip that opens on the
    // identity, whose two planes would be one picture at its start.
    const [source, image] = await panes.evaluateAll((all) =>
      all.map((p) => p.innerHTML),
    );
    expect(source, title).not.toBe(image);
    images[title] = image;
    expect(source.length, title).toBeGreaterThan(200);
    expect(image.length, title).toBeGreaterThan(200);
    const box = (await thumb.boundingBox())!;
    expect(Math.abs(box.width / box.height - 2000 / 760), title).toBeLessThan(
      0.02,
    );
    expect(await card.getAttribute("data-thumbnail-parameter"), title).toBe(
      thumbnailParameters[title] ?? null,
    );
  }
  // The web's growth is not drawn as the static web it ends on.
  expect(images["A squared grid grown into a web"]).not.toBe(
    images["A squared grid wrapped into a web"],
  );
});

// The wide cards tile their section evenly: one to a row on a phone held
// upright, two on its side and three on a desktop, never leaving a column
// empty or the page wider than the screen.
for (const [width, height, perRow] of [
  [1280, 800, 3],
  [390, 844, 1],
  [844, 390, 2],
] as const)
  test(`complex-map cards tile their section evenly at ${width} × ${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await settled(page);
    await examplesButton(page).click();
    await gallery(page)
      .locator(".gallery-families")
      .getByRole("button", { name: /^Complex maps/ })
      .click();
    const section = gallery(page).getByRole("region", {
      name: "Complex maps",
    });
    const grid = (await section.locator(".gallery-grid").boundingBox())!;
    const boxes = await section
      .locator("[data-loom-example]")
      .evaluateAll((all) => all.map((c) => c.getBoundingClientRect().toJSON()));
    expect(boxes).toHaveLength(20);
    const rows = new Map<number, DOMRect[]>();
    for (const b of boxes)
      rows.set(Math.round(b.top), [...(rows.get(Math.round(b.top)) ?? []), b]);
    const counts = [...rows.values()].map((r) => r.length);
    expect(
      counts.slice(0, -1).every((n) => n === perRow),
      `${counts}`,
    ).toBe(true);
    expect(counts.at(-1)).toBeLessThanOrEqual(perRow);
    // A full row reaches across the grid.
    const first = rows.values().next().value!;
    expect(first[0].left - grid.x).toBeLessThan(1);
    expect(grid.x + grid.width - first.at(-1)!.right).toBeLessThan(1);
    for (const b of boxes)
      expect(Math.abs(b.width - first[0].width)).toBeLessThan(1);
    expect(
      await gallery(page).evaluate((d) => d.scrollWidth - d.clientWidth),
    ).toBeLessThanOrEqual(0);
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
  const { ParameterAtlas, atlasDefaults, atlasBudget } =
    await import("../web/atlas");
  const { presetStudy } = await import("../web/planar-link");
  const study = presetStudy(
    presets.findIndex((p) => p.title === "Hypotrochoid & its evolute"),
  );
  const original = structuredClone(study);
  const calls: { config: any; resolve: (frame: any) => void }[] = [];
  let active = 0,
    maximum = 0;
  const atlas = new ParameterAtlas(
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
  expect(atlas.state.cells.map((c) => c.values)).toEqual([
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
  // The adopted study opens in an effect after the atlas closes, so the
  // previous study can still read as settled; a click then would land on
  // Copy link just as the adopted study disables it.
  await expect(page.locator(".plot-heading .eyebrow")).toHaveText(
    "YOUR OWN EXPLORATION",
  );
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
  await expect(help.locator(".hint-more")).toContainText("roulette");
  await expect(help.locator(".hint-more")).toContainText(
    "whole Lissajous frequencies",
  );
  await expect(help.locator(".hint-more")).toContainText(
    "a Fourier term's whole frequency and radius",
  );
  await expect(help.locator(".hint-more")).toContainText(
    "implicit level and a, when F uses a",
  );
  await expect(help.locator(".hint-more")).toContainText(
    "Cartesian point light",
  );
  await expect(help.locator(".hint-more")).toContainText("De Jong");
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
  const { ParameterAtlas, atlasDefaults } = await import("../web/atlas");
  const { presetStudy } = await import("../web/planar-link");
  let calls = 0;
  const scheduler = new ParameterAtlas(
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
  expect(scheduler.state.error).toMatch(/no curated parameter pair/i);
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
  const { ParameterAtlas, atlasDefaults } = await import("../web/atlas");
  const { presetStudy } = await import("../web/planar-link");
  const study = presetStudy(
    presets.findIndex((p) => p.title === "Hypotrochoid & its evolute"),
  );
  let calls = 0;
  const atlas = new ParameterAtlas(
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
  const { ParameterAtlas, atlasDefaults } = await import("../web/atlas");
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
    const atlas = new ParameterAtlas(
      {
        compute: (config) => {
          requested.push(structuredClone(config));
          return new Promise(() => {});
        },
      },
      () => {},
    );
    atlas.generate(study, structuredClone(ranges) as any);
    expect(atlas.state.cells[4]).toMatchObject({ values: [1.1, 0.83] });
    // Only the center is snapped; the other cells keep their axis values.
    expect(atlas.state.cells[0]).toMatchObject({
      values: [ranges.radius[0], ranges.arm[0]],
    });
    expect(atlas.state.cells[8]).toMatchObject({
      values: [ranges.radius[1], ranges.arm[1]],
    });
    atlas.cancel();
  }
  // A range centered elsewhere keeps its own midpoint.
  const offCenter = new ParameterAtlas(
    { compute: () => new Promise(() => {}) },
    () => {},
  );
  offCenter.generate(study, { radius: [1.5, 2], arm: [1, 2] });
  expect(offCenter.state.cells[4]).toMatchObject({ values: [1.75, 1.5] });
  offCenter.cancel();
  // The center's request is the frozen study's configuration, unchanged.
  const requested: any[] = [];
  const atlas = new ParameterAtlas(
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
  const { ParameterAtlas, atlasDefaults } = await import("../web/atlas");
  const { EngineError } = await import("../web/engine-client");
  const { presetStudy } = await import("../web/planar-link");
  const study = presetStudy(
    presets.findIndex((p) => p.title === "Hypotrochoid & its evolute"),
  );
  let calls = 0;
  let disposed = 0;
  const atlas = new ParameterAtlas(
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
  const { ParameterAtlas, atlasDefaults } = await import("../web/atlas");
  const { presetStudy } = await import("../web/planar-link");
  const study = presetStudy(
    presets.findIndex((p) => p.title === "Hypotrochoid & its evolute"),
  );
  let reject!: (error: Error) => void;
  const seen: (string | undefined)[] = [];
  const atlas = new ParameterAtlas(
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
  const { ParameterAtlas, atlasDefaults } = await import("../web/atlas");
  const { presetStudy } = await import("../web/planar-link");
  const study = presetStudy(
    presets.findIndex((p) => p.title === "Hypotrochoid & its evolute"),
  );
  let calls = 0;
  let reject!: (error: Error) => void;
  const atlas = new ParameterAtlas(
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
  const { ParameterAtlas, atlasDefaults } = await import("../web/atlas");
  const { presetStudy } = await import("../web/planar-link");
  const study = presetStudy(
    presets.findIndex((p) => p.title === "Hypotrochoid & its evolute"),
  );
  const shared: any = { config: null, result: { base: [{ x: 0, y: 1 }] } };
  let calls = 0;
  const atlas = new ParameterAtlas(
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
  const { ParameterAtlas, atlasDefaults } = await import("../web/atlas");
  const { presetStudy } = await import("../web/planar-link");
  const study = presetStudy(
    presets.findIndex((p) => p.title === "Hypotrochoid & its evolute"),
  );
  const original = structuredClone(study);
  const configs: any[] = [];
  const atlas = new ParameterAtlas(
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

test("atlas admission reserves capped previews and original-quality hidden families, refinement and composed work", async () => {
  const { atlasBudget } = await import("../web/atlas");
  const config = structuredClone(
    presets.find((p) => p.title === "Hypotrochoid & its evolute")!.config,
  );
  expect(atlasBudget(config)).toEqual({
    points: 40000,
    work: 360000,
    grid: 0,
    iterations: 0,
    density: 0,
    error: undefined,
  });
  expect(
    atlasBudget({ ...config, samples: 8000, lines: 256 }).error,
  ).toBeUndefined();
  expect(atlasBudget({ ...config, samples: 8001 }).error).toMatch(/limit/);
  expect(atlasBudget({ ...config, lines: 257 }).error).toMatch(/limit/);
  expect(atlasBudget({ ...config, adaptive: true }).error).toBeUndefined();
  expect(
    atlasBudget({
      ...config,
      samples: 8000,
      adaptive: true,
      adaptiveFrame: true,
      input: "pedal",
    }).error,
  ).toMatch(/limit/);
  expect(
    atlasBudget({
      ...config,
      adaptive: true,
      adaptiveFrame: true,
      kind: "rolling",
    }).error,
  ).toMatch(/limit/);
  expect(
    atlasBudget({
      ...config,
      adaptive: true,
      kind: "offset",
      stack: { ...config.stack, enabled: true, count: 16 },
    }).error,
  ).toMatch(/limit/);
  expect(config.samples).toBe(2000);
  expect(config.adaptive).toBeUndefined();
});

test("atlas refuses delivered geometry beyond its aggregate numeric storage cap", async () => {
  const { ParameterAtlas, atlasDefaults } = await import("../web/atlas");
  const { presetStudy } = await import("../web/planar-link");
  const study = presetStudy(
    presets.findIndex((p) => p.title === "Hypotrochoid & its evolute"),
  );
  // A single unexpected large reply must be rejected before copying or retaining it.
  const large = { base: Array(4000001).fill(0) };
  const atlas = new ParameterAtlas(
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
    "Set ranges, then generate 9 variants.",
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
      const input = [...root.querySelectorAll(".atlas-ranges input")]
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

test("atlas catalog supports only active roulette, consumed poles and curated map coefficients", async () => {
  const { atlasPairs, atlasDefaults, atlasRangeError } =
    await import("../web/atlas");
  const config = structuredClone(presets[0].config);
  expect(atlasPairs(config).map((p) => p.id)).toEqual([]);
  config.kind = "pedal";
  expect(atlasPairs(config).map((p) => p.id)).toEqual(["pole"]);
  config.kind = "inversion";
  config.input = "orthotomic";
  expect(atlasPairs(config).map((p) => p.id)).toEqual(["pole"]);
  config.curve.format = "roulette";
  expect(atlasPairs(config).map((p) => p.id)).toEqual(["roulette", "pole"]);
  config.curve.format = "implicit";
  expect(atlasPairs(config)).toEqual([]);
  config.curve.format = "attractor";
  expect(atlasPairs(config).map((p) => p.id)).toEqual(["clifford"]);
  config.curve.attractor.map = "dejong";
  expect(atlasPairs(config).map((p) => p.id)).toEqual(["dejong"]);
  config.curve.attractor.map = "henon";
  expect(atlasPairs(config)).toEqual([]);
  config.curve.format = "parametric";
  config.pole = { x: -3, y: 0 };
  const pair = atlasPairs(config)[0];
  const ranges = atlasDefaults(config, pair.id);
  expect(ranges.x[0]).toBeLessThan(-3);
  expect(ranges.x[1]).toBeGreaterThan(-3);
  expect(ranges.y[0]).toBeLessThan(0);
  expect(ranges.y[1]).toBeGreaterThan(0);
  expect(atlasRangeError({ ...ranges, y: [1, -1] }, pair.id)?.label).toBe(
    "Pole y to",
  );
});

for (const pair of ["roulette", "pole", "light", "clifford", "dejong"] as const)
  for (const size of [3, 5] as const)
    test(`atlas catalog ${pair} ${size} samples inclusive values and isolates preview quality from adoption`, async () => {
      const { ParameterAtlas, atlasDefaults, atlasPreviewConfig, atlasBudget } =
        await import("../web/atlas");
      const { presetStudy } = await import("../web/planar-link");
      const title =
        pair === "roulette"
          ? "Hypotrochoid & its evolute"
          : pair === "pole"
            ? "Ellipse & its pedal"
            : pair === "light"
              ? "Light inside a circle"
              : pair === "dejong"
                ? "De Jong attractor"
                : "Clifford attractor";
      const study = presetStudy(presets.findIndex((p) => p.title === title));
      study.config.curve.a = 7.25; // distinct from the map's coefficient a
      study.config.samples = 4000;
      study.config.lines = 144;
      study.config.curve.attractor.c = 0.93;
      const frozen = structuredClone(study);
      const calls: any[] = [];
      const atlas = new ParameterAtlas(
        {
          compute: async (config) => {
            calls.push(structuredClone(config));
            return { config, result: { base: [{ x: 1, y: 2 }] } } as any;
          },
        },
        () => {},
      );
      const ranges = atlasDefaults(study.config, pair);
      atlas.generate(study, ranges, { pair, size });
      await expect
        .poll(() => atlas.state.cells.filter((c) => c.frame).length)
        .toBe(size * size);
      expect(calls).toHaveLength(size * size);
      const keys =
        pair === "roulette"
          ? ["radius", "arm"]
          : pair === "pole" || pair === "light"
            ? ["x", "y"]
            : ["a", "b"];
      for (let i = 0; i < size * size; i++) {
        const values = atlas.state.cells[i].values;
        const expected = structuredClone(frozen.config);
        const target =
          pair === "roulette"
            ? expected.curve.roulette
            : pair === "pole"
              ? expected.pole
              : pair === "light"
                ? expected.source.position
                : expected.curve.attractor;
        target[keys[0]] = values[0];
        target[keys[1]] = values[1];
        expect(calls[i]).toEqual(atlasPreviewConfig(expected, size));
      }
      expect(atlas.state.cells[0].values).toEqual(
        keys.map((k) => ranges[k][0]),
      );
      expect(atlas.state.cells.at(-1)!.values).toEqual(
        keys.map((k) => ranges[k][1]),
      );
      const center = (size * size - 1) / 2;
      const current =
        pair === "roulette"
          ? frozen.config.curve.roulette
          : pair === "pole"
            ? frozen.config.pole
            : pair === "light"
              ? frozen.config.source.position
              : frozen.config.curve.attractor;
      expect(atlas.state.cells[center].values).toEqual(
        keys.map((k) => current[k]),
      );
      atlas.inspect(center);
      await expect.poll(() => !!atlas.state.selection?.frame).toBe(true);
      expect(calls.at(-1)).toEqual(frozen.config);
      expect(atlas.candidate()).toEqual(frozen);
      expect(study).toEqual(frozen);
      const reservation = atlasBudget(study.config, size);
      expect(reservation.error).toBeUndefined();
      expect(reservation.points).toBeLessThanOrEqual(500000);
      expect(reservation.iterations).toBeLessThanOrEqual(20000000);
      expect(reservation.density).toBeLessThanOrEqual(2000000);
      atlas.cancel();
    });

test("atlas twenty-five cell queue discards obsolete storage, coalesces inspection and enforces delivered numeric cap", async () => {
  const { ParameterAtlas, atlasDefaults } = await import("../web/atlas");
  const { presetStudy } = await import("../web/planar-link");
  const study = presetStudy(
    presets.findIndex((p) => p.title === "Clifford attractor"),
  );
  const calls: { config: any; resolve: (f: any) => void }[] = [];
  const atlas = new ParameterAtlas(
    {
      compute: (config) =>
        new Promise<any>((resolve) => calls.push({ config, resolve })),
    },
    () => {},
  );
  const finish = async (
    i: number,
    result: any = { base: [{ x: i, y: i }] },
  ) => {
    calls[i].resolve({ config: calls[i].config, result });
    await new Promise((r) => setTimeout(r, 0));
  };
  atlas.generate(study, atlasDefaults(study.config), {
    pair: "clifford",
    size: 5,
  });
  expect(calls).toHaveLength(1);
  expect(atlas.state.queued).toBe(24);
  await finish(0);
  atlas.inspect(0);
  atlas.inspect(0);
  expect(atlas.state.queued).toBeLessThanOrEqual(25);
  await finish(1);
  expect(calls).toHaveLength(3);
  await finish(2);
  expect(atlas.candidate()).not.toBeNull();
  const previous = atlas.state.cells[0].frame;
  atlas.generate(
    study,
    { a: [-2, -1], b: [1, 2] },
    { pair: "clifford", size: 5 },
  );
  expect(atlas.state.cells.every((c) => !c.frame)).toBe(true);
  expect(atlas.state.selection).toBeNull();
  expect(atlas.candidate()).toBeNull();
  const active = calls.length - 1;
  await finish(active);
  expect(atlas.state.cells.every((c) => !c.frame)).toBe(true);
  expect(previous?.result.base[0]).toEqual({ x: 0, y: 0 });
  await finish(active + 1, { counts: new Array(4000001).fill(0) });
  expect(atlas.state.cells[0].error).toMatch(/geometry limit/);
  expect(atlas.state.cells[0].frame).toBeUndefined();
  atlas.cancel();
  await finish(calls.length - 1);
  expect(atlas.state.cells).toEqual([]);
  expect(atlas.state.queued).toBe(0);
});

test("atlas shared framing combines robust member fits without discarding distant families", async () => {
  const { atlasSharedFrame } = await import("../web/atlas-framing");
  const { fitFrame, viewRect } = await import("../web/Plot");
  const config = structuredClone(presets[0].config);
  const path = (x: number, r: number) =>
    Array.from({ length: 40 }, (_, i) => ({
      x: x + r * Math.cos((i * Math.PI) / 20),
      y: r * Math.sin((i * Math.PI) / 20),
    }));
  const make = (base: any[], derived: any[]) => ({
    config,
    result: {
      base,
      derived,
      virtual: [],
      rays: [],
      family: [],
      circles: [],
      rolling: [],
      warnings: [],
      invalid: 0,
    },
  });
  const near = make(path(0, 1), [...path(500, 0.5), { x: 1e9, y: 1e9 }]);
  const far = make(path(-4000, 2), path(-3990, 1));
  const frames = [near, far];
  const shared = atlasSharedFrame(
    frames.map((frame) => ({ values: [0, 0], frame })),
  );
  expect(shared).toBeDefined();
  const window = viewRect(shared!);
  for (const frame of frames) {
    const w = viewRect(fitFrame(frame.result, frame.config));
    expect(window.x0).toBeLessThanOrEqual(w.x0 + 1e-9);
    expect(window.x1).toBeGreaterThanOrEqual(w.x1 - 1e-9);
    expect(window.y0).toBeLessThanOrEqual(w.y0 + 1e-9);
    expect(window.y1).toBeGreaterThanOrEqual(w.y1 - 1e-9);
  }
  expect(window.x1).toBeLessThan(10000); // asymptote did not swallow the grid
  expect((window.x1 - window.x0) / (window.y1 - window.y0)).toBeCloseTo(
    1000 / 760,
    12,
  );
  expect(
    atlasSharedFrame([{ values: [0, 0], error: "invalid" }]),
  ).toBeUndefined();
  const large = make(path(0, 100000), []);
  const largeShared = atlasSharedFrame([{ values: [0, 0], frame: large }])!;
  expect(largeShared.scale).toBeCloseTo(
    fitFrame(large.result, config).scale,
    10,
  );
});

for (const [pair, title] of [
  ["roulette", "Hypotrochoid & its evolute"],
  ["pole", "Ellipse & its pedal"],
  ["clifford", "Clifford attractor"],
] as const)
  for (const size of [3, 5] as const)
    test(`atlas direct ${pair} ${size} grid matches ordinary WASM at disclosed preview quality`, async ({
      page,
    }) => {
      await observeAtlasWorkers(page);
      await page.goto("/");
      await choosePreset(page, { label: title });
      await settled(page);
      const atlas = await openAtlas(page);
      await atlas
        .getByLabel("Grid size", { exact: true })
        .selectOption(String(size));
      if (size === 5) {
        await expect(atlas.locator(".atlas-cell")).toHaveCount(0);
        await atlas
          .getByRole("button", { name: "Generate atlas", exact: true })
          .click();
      }
      await expect(
        atlas.locator('.atlas-cell[data-state="valid"]'),
      ).toHaveCount(size * size);
      await expect(atlas.locator(".atlas-quality")).toContainText(
        "Preview quality",
      );
      if (pair === "clifford")
        await expect(atlas.locator(".atlas-quality")).toContainText("50,000");
      const check = await page.evaluate(
        async ({ pair, size }) => {
          const grid = (window as any).atlasWorkers[1];
          const requests = grid.requests.slice(-size * size);
          const ordinary = new Worker(grid.url);
          let same = true,
            nonempty = true;
          for (const request of requests) {
            const expected: any = await new Promise((resolve) => {
              ordinary.onmessage = (e) => resolve(e.data);
              ordinary.postMessage({
                ...request.data,
                id: 10000 + request.data.id,
              });
            });
            const actual = grid.replies.find(
              (r: any) => r.data.id === request.data.id,
            )?.data;
            same &&=
              JSON.stringify(expected.result) ===
                JSON.stringify(actual?.result) &&
              JSON.stringify(expected.config) ===
                JSON.stringify(actual?.config);
            nonempty &&=
              pair === "clifford"
                ? actual.result.attractor.accumulated === 50000 &&
                  actual.result.attractor.counts.some((v: number) => v > 0)
                : actual.result.base.filter(Boolean).length >= 1000 &&
                  actual.result.derived.filter(Boolean).length > 900;
          }
          ordinary.terminate();
          return { same, nonempty, maximum: grid.maximum };
        },
        { pair, size },
      );
      expect(check).toEqual({ same: true, nonempty: true, maximum: 1 });
      const independent = await atlas
        .locator("#atlas-cell-0 path")
        .evaluateAll((ps) => ps.map((p) => p.getAttribute("d")));
      await atlas.getByLabel("Framing", { exact: true }).selectOption("shared");
      await expect(
        atlas.getByText("Shared framing", { exact: true }),
      ).toBeVisible();
      if (pair !== "clifford") {
        await expect
          .poll(() =>
            atlas
              .locator("#atlas-cell-0 path")
              .evaluateAll((ps) => ps.map((p) => p.getAttribute("d"))),
          )
          .not.toEqual(independent);
      }
      await atlas
        .getByRole("button", { name: "Inspect row 1, column 1", exact: true })
        .click();
      await expect(
        atlas.getByRole("button", { name: "Adopt variant", exact: true }),
      ).toBeEnabled();
      const inspected = await page.evaluate(
        () => (window as any).atlasWorkers[1].replies.at(-1).data,
      );
      const original = await page.evaluate(
        () => (window as any).atlasWorkers[0].replies.at(-1).data,
      );
      expect(inspected.config.samples).toBe(original.config.samples);
      expect(inspected.config.lines).toBe(original.config.lines);
      if (pair === "clifford") {
        expect(inspected.result.attractor.accumulated).toBe(800000);
        expect(
          inspected.result.attractor.counts.filter((v: number) => v > 0).length,
        ).toBeGreaterThan(0);
      }
    });

test("atlas pair switching preserves frozen geometry and cannot apply dormant parameter fields", async ({
  page,
}) => {
  const { presetStudy } = await import("../web/planar-link");
  const study = presetStudy(
    presets.findIndex((p) => p.title === "Hypotrochoid & its evolute"),
  );
  study.config.kind = "orthotomic";
  study.config.pole = { x: -3, y: 0.2 };
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(
    `/#s=${deflateRawSync(JSON.stringify({ v: 1, notebook: "2d", study })).toString("base64url")}`,
  );
  await settled(page);
  const before = (await copiedStudy(page)).study;
  const atlas = await openAtlas(page);
  await atlas
    .getByLabel("Parameter pair", { exact: true })
    .selectOption("pole");
  await expect(atlas.locator(".atlas-cell")).toHaveCount(0);
  await atlas.getByLabel("Pole x from", { exact: true }).fill("-pi");
  await atlas.getByLabel("Pole x to", { exact: true }).fill("pi");
  await atlas.getByLabel("Pole y from", { exact: true }).fill("-phi");
  await atlas.getByLabel("Pole y to", { exact: true }).fill("phi");
  await atlas
    .getByRole("button", { name: "Generate atlas", exact: true })
    .click();
  await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(9);
  await atlas
    .getByRole("button", { name: "Inspect row 2, column 1", exact: true })
    .click();
  await expect(
    atlas.getByRole("button", { name: "Adopt variant", exact: true }),
  ).toBeEnabled();
  await atlas
    .getByRole("button", { name: "Adopt variant", exact: true })
    .click();
  await settled(page);
  const expected = structuredClone(before);
  expected.config.pole = { x: -Math.PI, y: 0 };
  expect((await copiedStudy(page)).study).toEqual(expected);
});

test("atlas Clifford full-density adoption survives links and PNG/SVG exports without preview overrides", async ({
  page,
}) => {
  await observeAtlasWorkers(page);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await choosePreset(page, { label: "Clifford attractor" });
  await settled(page);
  const before = (await copiedStudy(page)).study;
  const atlas = await openAtlas(page);
  await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(9);
  await atlas
    .getByRole("button", { name: "Inspect row 2, column 2", exact: true })
    .click();
  await expect(
    atlas.getByRole("button", { name: "Adopt variant", exact: true }),
  ).toBeEnabled();
  const fullImage = await atlas
    .locator("#atlas-inspected image")
    .getAttribute("href");
  const previewImage = await atlas
    .locator("#atlas-cell-4 image")
    .getAttribute("href");
  expect(fullImage).not.toBe(previewImage);
  await atlas
    .getByRole("button", { name: "Adopt variant", exact: true })
    .click();
  await settled(page);
  const after = await copiedStudy(page);
  expect(after.study).toEqual(before);
  expect(await page.locator("#artwork image").getAttribute("href")).toBe(
    fullImage,
  );
  const download = page.waitForEvent("download");
  await exportImage(page, "SVG");
  const svg = await readFile((await (await download).path())!, "utf8");
  expect(svg).toContain(fullImage!);
  expect(svg).not.toMatch(/<text\b/);
  expect(
    JSON.parse(svg.match(/<desc>(.*?)<\/desc>/s)![1]).curve.attractor.iterates,
  ).toBe(800000);
  const pngDownload = page.waitForEvent("download");
  await exportImage(page, "PNG");
  const png = decodePng(await readFile((await (await pngDownload).path())!));
  expect(png.width).toBeGreaterThanOrEqual(1000);
  // A real density image, rather than an empty-background fixture.
  const colors = new Set<string>();
  for (let i = 0; i < png.rgba.length; i += 4)
    colors.add(`${png.rgba[i]},${png.rgba[i + 1]},${png.rgba[i + 2]}`);
  expect(colors.size).toBeGreaterThan(100);
  await page.goto(after.url);
  await settled(page);
  expect((await copiedStudy(page)).study).toEqual(before);
  expect(await page.locator("#artwork image").getAttribute("href")).toBe(
    fullImage,
  );
});

for (const [family, title] of [
  ["roulette", "Hypotrochoid & its evolute"],
  ["pole", "Ellipse & its pedal"],
  ["light", "Light inside a circle"],
  ["dejong", "De Jong attractor"],
  ["clifford", "Clifford attractor"],
] as const)
  for (const mode of ["light", "dark"] as const)
    for (const width of [390, 1440])
      test(`atlas signature ${family} ${mode} ${width}px uses five columns and current palette`, async ({
        page,
      }, info) => {
        await page.setViewportSize({
          width,
          height: width === 390 ? 844 : 1000,
        });
        await page.emulateMedia({ colorScheme: mode });
        await page.addInitScript(() =>
          localStorage.setItem("tangent-garden.color-scheme", "forest"),
        );
        await page.goto("/");
        await choosePreset(page, { label: title });
        await settled(page);
        const atlas = await openAtlas(page);
        await atlas.getByLabel("Grid size", { exact: true }).selectOption("5");
        await atlas
          .getByRole("button", { name: "Generate atlas", exact: true })
          .click();
        await expect(
          atlas.locator('.atlas-cell[data-state="valid"]'),
        ).toHaveCount(25);
        expect(
          await atlas.evaluate((e) => e.scrollWidth <= e.clientWidth),
        ).toBe(true);
        const layout = await atlas.locator(".atlas-grid").evaluate((e) => ({
          columns: getComputedStyle(e).gridTemplateColumns.split(" ").length,
          width: e.getBoundingClientRect().width,
        }));
        expect(layout.columns).toBe(5);
        expect(layout.width).toBeGreaterThanOrEqual(640);
        await expect(atlas.locator("svg text")).toHaveCount(0);
        await atlas.screenshot({
          path: info.outputPath(`${family}-${mode}-${width}-atlas.png`),
        });
        const first = atlas.getByRole("button", {
          name: "Inspect row 1, column 1",
          exact: true,
        });
        await first.focus();
        await page.keyboard.press("ArrowRight");
        await expect(
          atlas.getByRole("button", {
            name: "Inspect row 1, column 2",
            exact: true,
          }),
        ).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(
          atlas.getByRole("button", { name: "Adopt variant", exact: true }),
        ).toBeEnabled();
        await atlas.screenshot({
          path: info.outputPath(`${family}-${mode}-${width}-inspection.png`),
        });
        await page.keyboard.press("Escape");
        await expect(
          page.getByRole("button", {
            name: "Explore parameter atlas",
            exact: true,
          }),
        ).toBeFocused();
      });

test("atlas inspection refines to the full-quality fitted camera before enabling adoption", async ({
  page,
}) => {
  const { presetStudy } = await import("../web/planar-link");
  const source = presetStudy(
    presets.findIndex((p) => p.title === "Ellipse & its pedal"),
  );
  source.config.samples = 3000;
  source.config.adaptive = true;
  source.config.adaptiveFrame = true;
  source.config.adaptiveView = true;
  source.config.curve.x = "2*cos(t)+0.15*cos(31*t)";
  source.config.curve.y = "1.1*sin(t)+0.15*sin(31*t)";
  source.camera = { x: 31, y: -19, zoom: 4 };
  await observeAtlasWorkers(page);
  await page.goto(
    `/#s=${deflateRawSync(JSON.stringify({ v: 1, notebook: "2d", study: source })).toString("base64url")}`,
  );
  await settled(page);
  const atlas = await openAtlas(page);
  await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(9);
  await atlas
    .getByRole("button", { name: "Inspect row 2, column 2", exact: true })
    .click();
  await expect(
    atlas.getByRole("button", { name: "Adopt variant", exact: true }),
  ).toBeEnabled();
  const inspection = await atlas
    .locator("#atlas-inspected path")
    .evaluateAll((ps) => ps.map((p) => p.getAttribute("d")));
  await atlas
    .getByRole("button", { name: "Adopt variant", exact: true })
    .click();
  await settled(page);
  expect(
    await page
      .locator("#artwork path")
      .evaluateAll((ps) => ps.map((p) => p.getAttribute("d"))),
  ).toEqual(inspection);
  const views = await page.evaluate(() => ({
    atlas: (window as any).atlasWorkers[1].requests.at(-1).data.view,
    ordinary: (window as any).atlasWorkers[0].requests.at(-1).data.view,
  }));
  expect(views.atlas).toBeDefined();
  expect(views.atlas).toEqual(views.ordinary);
});

test("atlas pole budgets reserve every integrated trajectory, pursuer and attempted step", async () => {
  const { atlasBudget } = await import("../web/atlas");
  const config = structuredClone(
    presets.find((p) => p.title === "Ellipse & its pedal")!.config,
  );
  config.samples = 8000;
  config.curve.format = "field";
  config.curve.field.seeds = Array.from({ length: 16 }, (_, x) => ({
    x,
    y: 0,
  }));
  expect(atlasBudget(config, 5).points).toBeGreaterThan(500000);
  expect(atlasBudget(config, 5).error).toMatch(/limit/);
  config.samples = 1000;
  expect(atlasBudget(config, 5).work).toBeGreaterThan(80000000);
  config.curve.field.seeds = config.curve.field.seeds.slice(0, 2);
  // Each attempted field step checks its speed, then uses seven RK stages;
  // both coordinates evaluate the field. Sampling between steps is extra.
  expect(atlasBudget(config, 5).work).toBeGreaterThan(26 * 2 * 50000 * 8 * 2);
  expect(atlasBudget(config, 5).error).toBeUndefined();
  config.curve.format = "pursuit";
  config.curve.pursuit.pursuers = Array.from({ length: 16 }, (_, x) => ({
    x,
    y: 0,
    speed: 1,
  }));
  expect(atlasBudget(config, 5).work).toBeGreaterThan(80000000);
  expect(atlasBudget(config, 5).error).toMatch(/limit/);
});

test("atlas generated defaults remove endpoint arithmetic tails without rounding the source or entered ranges", async () => {
  const { atlasDefaults, ParameterAtlas } = await import("../web/atlas");
  const { presetStudy } = await import("../web/planar-link");
  const roulette = presetStudy(
    presets.findIndex((p) => p.title === "Hypotrochoid & its evolute"),
  );
  roulette.config.curve.roulette.radius = 1.2345678901234567;
  roulette.config.curve.roulette.arm = 0;
  // A copied source value has no arithmetic tail to remove.
  expect(atlasDefaults(roulette.config, "roulette").arm).toEqual([
    0,
    roulette.config.curve.roulette.radius,
  ]);
  const pedal = presetStudy(
    presets.findIndex((p) => p.title === "Ellipse & its pedal"),
  );
  expect(atlasDefaults(pedal.config, "pole")).toEqual({
    x: [0.65, 2.65],
    y: [-0.7, 1.3],
  });
  const clifford = presetStudy(
    presets.findIndex((p) => p.title === "Clifford attractor"),
  );
  expect(atlasDefaults(clifford.config, "clifford")).toEqual({
    a: [-1.75, -1.05],
    b: [1.2, 2],
  });
  for (const [x, y] of [
    [-0.19999999999999996, 0.30000000000000004],
    [1.234567890123456, -0.2],
    [1.15, -0.2],
    [1e-17, -1e-17],
    [1e-300, -1e-300],
  ]) {
    pedal.config.pole = { x, y };
    const frozen = structuredClone(pedal);
    const ranges = atlasDefaults(pedal.config, "pole");
    const dx = Math.max(Math.abs(x) / 4, 1),
      dy = Math.max(Math.abs(y) / 4, 1);
    const raw = { x: [x - dx, x + dx], y: [y - dy, y + dy] };
    for (const key of ["x", "y"])
      for (const i of [0, 1])
        expect(Math.abs(ranges[key][i] - raw[key][i])).toBeLessThanOrEqual(
          Number.EPSILON *
            Math.max(
              Math.abs(raw[key][i]),
              Math.abs(pedal.config.pole[key]),
              key === "x" ? dx : dy,
            ),
        );
    if (x === -0.19999999999999996)
      expect(ranges).toEqual({ x: [-1.2, 0.8], y: [-0.7, 1.3] });
    for (const size of [3, 5] as const) {
      const calls: any[] = [];
      const atlas = new ParameterAtlas(
        {
          compute: async (config) => {
            calls.push(structuredClone(config));
            return { config, result: { base: [] } } as any;
          },
        },
        () => {},
      );
      atlas.generate(pedal, ranges, { pair: "pole", size });
      await expect.poll(() => calls.length).toBe(size * size);
      expect(atlas.state.cells[(size * size - 1) / 2].values).toEqual([x, y]);
      atlas.inspect((size * size - 1) / 2);
      await expect.poll(() => !!atlas.state.selection?.frame).toBe(true);
      expect(calls.at(-1)).toEqual(frozen.config);
      expect(atlas.candidate()).toEqual(frozen);
      atlas.cancel();
    }
    expect(pedal).toEqual(frozen);
  }
  // A deliberately off-center range is never replaced by the source value.
  const atlas = new ParameterAtlas(
    { compute: () => new Promise(() => {}) },
    () => {},
  );
  pedal.config.pole = { x: 1, y: -0.2 };
  const entered = {
    x: [0.6499999999999999, 2.6500000000000004],
    y: [-1.2, 0.8],
  } as any;
  atlas.generate(pedal, entered, { pair: "pole", size: 5 });
  expect(atlas.state.cells[0].values).toEqual([entered.x[0], entered.y[0]]);
  expect(atlas.state.cells[24].values).toEqual([entered.x[1], entered.y[1]]);
  expect(atlas.state.cells[12].values[0]).not.toBe(1);
  atlas.cancel();
});

test("atlas grid size stays chosen across cancel, adoption, another study and reload", async ({
  page,
}) => {
  await page.goto("/");
  await choosePreset(page, { label: "Ellipse & its pedal" });
  let atlas = await openAtlas(page);
  await atlas.getByLabel("Grid size", { exact: true }).selectOption("5");
  await atlas
    .getByRole("button", { name: "Cancel atlas", exact: true })
    .click();
  await page.reload();
  await choosePreset(page, { label: "Hypotrochoid & its evolute" });
  atlas = await openAtlas(page);
  await expect(atlas.getByLabel("Grid size", { exact: true })).toHaveValue("5");
  await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(
    25,
  );
  await atlas
    .getByRole("button", { name: "Inspect row 3, column 3", exact: true })
    .click();
  await expect(
    atlas.getByRole("button", { name: "Adopt variant", exact: true }),
  ).toBeEnabled();
  await atlas
    .getByRole("button", { name: "Adopt variant", exact: true })
    .click();
  await settled(page);
  atlas = await openAtlas(page);
  await expect(atlas.getByLabel("Grid size", { exact: true })).toHaveValue("5");
  await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(
    25,
  );
  await atlas.getByLabel("Grid size", { exact: true }).selectOption("3");
  await atlas
    .getByRole("button", { name: "Cancel atlas", exact: true })
    .click();
  await choosePreset(page, { label: "Clifford attractor" });
  atlas = await openAtlas(page);
  await expect(atlas.getByLabel("Grid size", { exact: true })).toHaveValue("3");
  await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(9);
  await atlas
    .getByRole("button", { name: "Cancel atlas", exact: true })
    .click();
  await page.reload();
  await choosePreset(page, { label: "Clifford attractor" });
  atlas = await openAtlas(page);
  await expect(atlas.getByLabel("Grid size", { exact: true })).toHaveValue("3");
  await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(9);
});

test("atlas grid size survives denied browser storage in memory", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem,
      set = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key === "tangent-garden.atlas-size")
        throw new DOMException("denied", "SecurityError");
      return get.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === "tangent-garden.atlas-size")
        throw new DOMException("denied", "SecurityError");
      return set.call(this, key, value);
    };
  });
  await page.goto("/");
  await choosePreset(page, { label: "Ellipse & its pedal" });
  let atlas = await openAtlas(page);
  await atlas.getByLabel("Grid size", { exact: true }).selectOption("5");
  await atlas
    .getByRole("button", { name: "Cancel atlas", exact: true })
    .click();
  atlas = await openAtlas(page);
  await expect(atlas.getByLabel("Grid size", { exact: true })).toHaveValue("5");
  await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(
    25,
  );
});

test("atlas numeric range text stays clean after adoption and center inspection keeps ordinary WASM geometry", async ({
  page,
}) => {
  await observeAtlasWorkers(page);
  await page.goto("/");
  for (const [title, fromName, fromValue, toName, toValue] of [
    ["Ellipse & its pedal", "Pole x from", "0.65", "Pole x to", "2.65"],
    [
      "Clifford attractor",
      "Coefficient a to",
      "-1.05",
      "Coefficient b from",
      "1.2",
    ],
  ]) {
    await choosePreset(page, { label: title });
    await settled(page);
    let atlas = await openAtlas(page);
    await expect(atlas.getByLabel(fromName, { exact: true })).toHaveValue(
      fromValue,
    );
    await expect(atlas.getByLabel(toName, { exact: true })).toHaveValue(
      toValue,
    );
    await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(
      9,
    );
    await atlas
      .getByRole("button", { name: "Inspect row 2, column 2", exact: true })
      .click();
    await expect(
      atlas.getByRole("button", { name: "Adopt variant", exact: true }),
    ).toBeEnabled();
    expect(
      await page.evaluate(() => {
        const logs = (window as any).atlasWorkers;
        return (
          JSON.stringify(logs.at(-1).replies.at(-1).data.result) ===
          JSON.stringify(logs[0].replies.at(-1).data.result)
        );
      }),
    ).toBe(true);
    await atlas
      .getByRole("button", { name: "Adopt variant", exact: true })
      .click();
    await settled(page);
    atlas = await openAtlas(page);
    await expect(atlas.getByLabel(fromName, { exact: true })).toHaveValue(
      fromValue,
    );
    await expect(atlas.getByLabel(toName, { exact: true })).toHaveValue(
      toValue,
    );
    if (title === "Ellipse & its pedal") {
      await atlas
        .getByRole("button", { name: "Inspect row 1, column 1", exact: true })
        .click();
      await expect(
        atlas.getByRole("button", { name: "Adopt variant", exact: true }),
      ).toBeEnabled();
      await atlas
        .getByRole("button", { name: "Adopt variant", exact: true })
        .click();
      await settled(page);
      atlas = await openAtlas(page);
      await expect(
        atlas.getByLabel("Pole y from", { exact: true }),
      ).toHaveValue("-1.7");
      await expect(atlas.getByLabel("Pole y to", { exact: true })).toHaveValue(
        "0.3",
      );
    }
    await atlas
      .getByRole("button", { name: "Cancel atlas", exact: true })
      .click();
  }
});

test("atlas cancellation-aware values match exact decimal arithmetic through two adoption generations", async () => {
  const { atlasDefaults, atlasPair, ParameterAtlas } =
    await import("../web/atlas");
  const { presetStudy } = await import("../web/planar-link");
  // Exact rational expectations keep binary subtraction/interpolation errors
  // out of the oracle. These finite decimal fixtures stay within safe integers.
  type Q = { n: bigint; d: bigint };
  const q = (n: bigint, d = 1n): Q => {
    let a = n < 0n ? -n : n,
      b = d;
    while (b) [a, b] = [b, a % b];
    return { n: n / a, d: d / a };
  };
  const decimal = (text: string): Q => {
    const sign = text.startsWith("-") ? -1n : 1n;
    const [whole, fraction = ""] = text.replace("-", "").split(".");
    return q(sign * BigInt(whole + fraction), 10n ** BigInt(fraction.length));
  };
  const add = (a: Q, b: Q) => q(a.n * b.d + b.n * a.d, a.d * b.d);
  const mul = (a: Q, b: Q) => q(a.n * b.n, a.d * b.d);
  const neg = (a: Q) => q(-a.n, a.d);
  const abs = (a: Q) => q(a.n < 0n ? -a.n : a.n, a.d);
  const greater = (a: Q, b: Q) => a.n * b.d > b.n * a.d;
  const number = (a: Q) => {
    if (
      (a.n < 0n ? -a.n : a.n) > BigInt(Number.MAX_SAFE_INTEGER) ||
      a.d > BigInt(Number.MAX_SAFE_INTEGER)
    )
      throw new Error("Exact-decimal fixture exceeds safe integer conversion");
    return Number(a.n) / Number(a.d);
  };
  const mismatches: unknown[] = [];
  let studies = 0,
    cells = 0,
    expectedStudies = 0,
    expectedCells = 0;
  // Batch identical exact comparisons so stack capture does not dominate a
  // sweep with thousands of observations. Keep bounded, actionable failures.
  const check = (
    actual: number[] | undefined,
    expected: number[],
    context: string,
  ) => {
    if (
      (!actual ||
        actual.length !== expected.length ||
        actual.some((v, i) => !Object.is(v, expected[i]))) &&
      mismatches.length < 10
    )
      mismatches.push({ context, actual, expected });
  };
  for (const [pair, title, starts] of [
    ["roulette", "Hypotrochoid & its evolute", [["2", "3"]]],
    [
      "pole",
      "Ellipse & its pedal",
      [
        ["1.65", "0.3"],
        ["1.15", "-0.2"],
        ["-0.85", "1.25"],
      ],
    ],
    [
      "clifford",
      "Clifford attractor",
      [
        ["-1.4", "1.6"],
        ["0.35", "-0.3"],
      ],
    ],
  ] as const)
    for (const size of [3, 5] as const)
      for (const start of starts) {
        const descriptor = atlasPair(pair);
        const base = presetStudy(presets.findIndex((p) => p.title === title));
        const visit = (source: Q[], depth: number) => {
          const study = structuredClone(base);
          const values = source.map(number);
          const owner =
            pair === "roulette"
              ? study.config.curve.roulette
              : pair === "pole"
                ? study.config.pole
                : study.config.curve.attractor;
          descriptor.axes.forEach((a, i) => (owner[a.key] = values[i]));
          const expected = source.map((v) => {
            if (pair === "roulette")
              return [mul(v, q(3n, 4n)), mul(v, q(5n, 4n))];
            const minimum = pair === "pole" ? q(1n) : q(1n, 4n);
            const quarter = mul(abs(v), q(1n, 4n));
            const d = greater(quarter, minimum) ? quarter : minimum;
            return [add(v, neg(d)), add(v, d)];
          });
          const ranges = atlasDefaults(study.config, pair);
          studies++;
          descriptor.axes.forEach((a, i) =>
            check(
              ranges[a.key],
              expected[i].map(number),
              `${pair} ${values} ${a.key} defaults`,
            ),
          );
          if (depth === 0) return;
          const atlas = new ParameterAtlas(
            { compute: () => new Promise(() => {}) },
            () => {},
          );
          atlas.generate(study, ranges, { pair, size });
          if (atlas.state.cells.length !== size * size)
            mismatches.push({
              context: "grid size",
              actual: atlas.state.cells.length,
              expected: size * size,
            });
          const children: Q[][] = [];
          for (let row = 0; row < size; row++)
            for (let col = 0; col < size; col++) {
              const selected = expected.map(([a, b], i) => {
                const step = i === 0 ? col : row;
                return add(
                  mul(a, q(BigInt(size - 1 - step), BigInt(size - 1))),
                  mul(b, q(BigInt(step), BigInt(size - 1))),
                );
              });
              cells++;
              check(
                atlas.state.cells[row * size + col]?.values,
                selected.map(number),
                `${pair} ${size} source ${values} cell ${row},${col}`,
              );
              children.push(selected);
            }
          atlas.cancel();
          for (const child of children) visit(child, depth - 1);
        };
        expectedStudies += 1 + size ** 2 + size ** 4;
        expectedCells += size ** 2 + size ** 4;
        visit(start.map(decimal), 2);
      }
  expect({ studies, cells }).toEqual({
    studies: expectedStudies,
    cells: expectedCells,
  });
  expect(studies).toBe(4452);
  expect(mismatches).toEqual([]);
});

test("atlas reopening the adopted x 1.15 y -0.2 pedal has clean subtraction bounds", async ({
  page,
}) => {
  await observeAtlasWorkers(page);
  await page.goto("/");
  await choosePreset(page, { label: "Ellipse & its pedal" });
  let atlas = await openAtlas(page);
  await atlas.getByLabel("Grid size", { exact: true }).selectOption("5");
  await atlas
    .getByRole("button", { name: "Generate atlas", exact: true })
    .click();
  await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(
    25,
  );
  await atlas
    .getByRole("button", { name: "Inspect row 2, column 2", exact: true })
    .click();
  await expect(
    atlas.getByRole("button", { name: "Adopt variant", exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () => (window as any).atlasWorkers.at(-1).replies.at(-1).data.config.pole,
    ),
  ).toEqual({ x: 1.15, y: -0.2 });
  await atlas
    .getByRole("button", { name: "Adopt variant", exact: true })
    .click();
  await settled(page);
  atlas = await openAtlas(page);
  for (const [name, value] of [
    ["Pole x from", "0.15"],
    ["Pole x to", "2.15"],
    ["Pole y from", "-1.2"],
    ["Pole y to", "0.8"],
  ])
    await expect(atlas.getByLabel(name, { exact: true })).toHaveValue(value);
});

test("atlas admission and inspection ignore refinement where the definition cannot refine", async ({
  page,
}) => {
  const { atlasBudget } = await import("../web/atlas");
  // Go never refines a chase or a trajectory, and the refinement control is
  // hidden for them, so a flag left on from another definition is dormant.
  for (const title of [
    "Four chasers at unequal speeds",
    "Ellipse & its pedal",
  ]) {
    const config = structuredClone(
      presets.find((p) => p.title === title)!.config,
    );
    config.kind = "pedal";
    if (title === "Ellipse & its pedal") {
      config.curve.format = "field";
      config.samples = 1000;
    }
    for (const size of [3, 5] as const) {
      const plain = atlasBudget({ ...config, adaptive: false }, size);
      expect(plain.error).toBeUndefined();
      expect(
        atlasBudget(
          {
            ...config,
            adaptive: true,
            adaptiveView: true,
            adaptiveFrame: true,
          },
          size,
        ),
      ).toEqual(plain);
    }
  }
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await observeAtlasWorkers(page);
  await page.goto("/");
  await choosePreset(page, { label: "Ellipse & its pedal" });
  await settled(page);
  const refine = page.getByRole("checkbox", {
    name: "Refine between samples",
  });
  await refine.check();
  await settled(page);
  await page.getByLabel("Definition", { exact: true }).selectOption("pursuit");
  await settled(page);
  await expect(refine).toHaveCount(0);
  const study = (await copiedStudy(page)).study;
  expect(study.config.adaptive).toBe(true);
  study.config.adaptiveView = true;
  study.camera = { x: 20, y: -10, zoom: 3 };
  await page.goto(
    `/#s=${deflateRawSync(JSON.stringify({ v: 1, notebook: "2d", study })).toString("base64url")}`,
  );
  await settled(page);
  const atlas = await openAtlas(page);
  await expect(atlas.getByText(/^Original quality:/)).toContainText(
    "refinement off",
  );
  await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(9);
  await atlas
    .getByRole("button", { name: "Inspect row 2, column 2", exact: true })
    .click();
  await expect(
    atlas.getByRole("button", { name: "Adopt variant", exact: true }),
  ).toBeEnabled();
  const requests = await page.evaluate(() =>
    (window as any).atlasWorkers[1].requests.map((r: any) => r.data.view),
  );
  // Nine previews and one inspection, none refined to a view.
  expect(requests).toHaveLength(10);
  expect(requests.every((view: unknown) => view === undefined)).toBe(true);
});

test("atlas names a 5 × 5 limit when the same study fits 3 × 3", async ({
  page,
}) => {
  const { atlasBudget } = await import("../web/atlas");
  const { presetStudy } = await import("../web/planar-link");
  const study = presetStudy(
    presets.findIndex((p) => p.title === "Rolling on an ellipse's pedal"),
  );
  study.config.samples = 2000;
  expect(atlasBudget(study.config, 3).error).toBeUndefined();
  expect(atlasBudget(study.config, 5).error).toMatch(/5 × 5/);
  expect(atlasBudget(study.config, 5).error).toMatch(/3 × 3/);
  // A study over both limits keeps the general advice.
  study.config.samples = 8000;
  expect(atlasBudget(study.config, 5).error).not.toMatch(/3 × 3/);
  study.config.samples = 2000;
  await page.addInitScript(() =>
    localStorage.setItem("tangent-garden.atlas-size", "5"),
  );
  await page.goto(
    `/#s=${deflateRawSync(JSON.stringify({ v: 1, notebook: "2d", study })).toString("base64url")}`,
  );
  await settled(page);
  const atlas = await openAtlas(page);
  await expect(atlas.getByLabel("Grid size", { exact: true })).toHaveValue("5");
  await expect(atlas.getByRole("alert")).toContainText("3 × 3");
  await atlas.getByLabel("Grid size", { exact: true }).selectOption("3");
  await expect(atlas.getByRole("alert")).toHaveCount(0);
  await atlas
    .getByRole("button", { name: "Generate atlas", exact: true })
    .click();
  await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(9);
});

test("atlas previews request the documented capped quality", async () => {
  const { ParameterAtlas, atlasDefaults } = await import("../web/atlas");
  const { presetStudy } = await import("../web/planar-link");
  for (const [pair, title] of [
    ["roulette", "Hypotrochoid & its evolute"],
    ["pole", "Ellipse & its pedal"],
    ["clifford", "Clifford attractor"],
  ] as const)
    for (const size of [3, 5] as const) {
      const study = presetStudy(presets.findIndex((p) => p.title === title));
      Object.assign(study.config, {
        samples: 4000,
        lines: 144,
        adaptive: pair !== "clifford",
        adaptiveView: pair !== "clifford",
        adaptiveFrame: pair !== "clifford",
      });
      Object.assign(study.config.curve.attractor, {
        iterates: 400000,
        discard: 5000,
        cells: 512,
      });
      const calls: any[] = [];
      const atlas = new ParameterAtlas(
        {
          compute: async (config) => {
            calls.push(structuredClone(config));
            return { config, result: { base: [] } } as any;
          },
        },
        () => {},
      );
      atlas.generate(study, atlasDefaults(study.config, pair), { pair, size });
      await expect.poll(() => calls.length).toBe(size * size);
      expect(atlas.state.error).toBeUndefined();
      for (const config of calls)
        if (pair === "clifford")
          expect({
            lines: config.lines,
            ...config.curve.attractor,
          }).toMatchObject({
            lines: size === 3 ? 128 : 64,
            iterates: 50000,
            discard: 1000,
            cells: 128,
          });
        else
          expect(config).toMatchObject({
            samples: size === 3 ? 2000 : 1000,
            lines: size === 3 ? 128 : 64,
            adaptive: false,
            adaptiveView: false,
            adaptiveFrame: false,
          });
      atlas.cancel();
    }
});

test("atlas entry refuses an unsupported study that settles after the request", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await choosePreset(page, { label: "Hypotrochoid & its evolute" });
  await settled(page);
  // The request and a change to an unsupported definition arrive together.
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Explore parameter atlas",
    )!;
    const label = [...document.querySelectorAll("label")].find((l) =>
      l.textContent?.startsWith("Definition"),
    )!;
    const select = (label.querySelector("select") ??
      document.getElementById(label.htmlFor)) as HTMLSelectElement;
    button.click();
    Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value",
    )!.set!.call(select, "pursuit");
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settled(page);
  await expect(
    page.locator(".atlas-entry [role=status]", {
      hasText: "no curated parameter pair",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "A field of possible flowers" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Definition", { exact: true })).toHaveValue(
    "pursuit",
  );
  expect(errors).toEqual([]);
});

test("finite engraving sampling, curated applicability and literal aggregate ceilings", async () => {
  const { familyTargets, familyValues, familyBudget, familyDefaults } =
    await import("../web/planar-family");
  const { presetStudy } = await import("../web/planar-link");
  const s = presetStudy(0);
  expect(familyTargets(s.config)).toEqual([]); // unused a is not a track
  s.config.curve.x = "a*cos(t)";
  expect(familyTargets(s.config).map((t) => t.target)).toEqual(["a"]);
  s.config.kind = "pedal";
  expect(familyTargets(s.config).map((t) => t.target)).toEqual([
    "poleX",
    "poleY",
    "a",
  ]);
  s.config.kind = "catacaustic";
  expect(familyTargets(s.config).map((t) => t.target)).toEqual([
    "sourceX",
    "sourceY",
    "a",
  ]);
  s.config.source.coordinates = "polar";
  expect(familyTargets(s.config).map((t) => t.target)).toEqual([
    "sourceTheta",
    "sourceRadius",
    "a",
  ]);
  // A theta default turns once around the lamp's circle and stops one step
  // short, so its last member never repeats the first lamp position.
  s.config.source.theta = 1;
  const turn = familyDefaults(s.config, "sourceTheta");
  expect(turn.from).toBe(1);
  expect(turn.to).toBe(1 + (2 * Math.PI * 15) / 16);
  const positions = familyValues(turn, 1).map((v) =>
    [Math.cos(v), Math.sin(v)].map((c) => c.toFixed(9)).join(),
  );
  expect(new Set(positions).size).toBe(turn.count);
  const f = {
    ...familyDefaults(s.config),
    enabled: true,
    from: -1.2,
    to: 0.8,
    count: 5,
  };
  expect(familyValues(f, -0.2)).toEqual([-1.2, -0.7, -0.2, 0.3, 0.8]);
  expect(familyValues({ ...f, from: 0.8, to: -1.2 }, -0.2)).toEqual([
    0.8, 0.3, -0.2, -0.7, -1.2,
  ]);
  expect(
    familyValues(
      { ...f, from: 0.12345678901234567, to: 0.12345678901234567 },
      0,
    ),
  ).toEqual(Array(5).fill(0.12345678901234567));
  s.config.samples = 7800;
  s.config.lines = 32;
  const admitted = familyBudget(s.config, { ...f, count: 32 });
  expect(admitted.points).toBe(499200);
  expect(admitted.work).toBe(4492800);
  expect(admitted.error).toBeUndefined();
  expect(
    familyBudget({ ...s.config, samples: 7813 }, { ...f, count: 32 }).error,
  ).toMatch(/limit/);
  expect(
    familyBudget({ ...s.config, adaptive: true }, { ...f, count: 32 }).error,
  ).toMatch(/limit/);
  expect(familyBudget(s.config, { ...f, target: "poleX" }).error).toMatch(
    /supported/,
  );
  for (const format of ["implicit", "attractor", "field", "pursuit"] as const)
    expect(
      familyTargets({ ...s.config, curve: { ...s.config.curve, format } }),
    ).toEqual([]);
  expect(
    familyTargets({
      ...s.config,
      kind: "offset",
      stack: { ...s.config.stack, enabled: true },
    }),
  ).toEqual([]);
});

test("finite engraving scheduler owns full-quality results and retires stale and fatal work", async () => {
  const { PlanarFamily, familyDefaults } = await import("../web/planar-family");
  const { presetStudy } = await import("../web/planar-link");
  const { EngineError } = await import("../web/engine-client");
  const s = presetStudy(0);
  s.config.kind = "pedal";
  const f = {
    ...familyDefaults(s.config),
    enabled: true,
    count: 3,
    from: -1,
    to: 1,
  };
  const calls: any[] = [];
  let disposed = false;
  const scheduler = new PlanarFamily(
    {
      compute: (config: any, bounds: any, options: any) =>
        new Promise<any>((resolve, reject) =>
          calls.push({ config, bounds, options, resolve, reject }),
        ),
      dispose: () => {
        disposed = true;
      },
    },
    () => {},
  );
  const tick = () => new Promise((r) => setTimeout(r, 0));
  scheduler.generate(s, f);
  expect(calls).toHaveLength(1);
  expect(scheduler.state.queued).toBe(2);
  expect(calls[0].config.samples).toBe(s.config.samples);
  const original = structuredClone(s);
  s.config.curve.x = "999";
  scheduler.generate(original, { ...f, from: 2, to: 4 });
  expect(calls).toHaveLength(1);
  const frame = (i: number) => ({
    config: calls[i].config,
    result: {
      base: [{ x: 1, y: 2 }],
      derived: [{ x: i, y: 3 }],
      rays: [],
      family: [],
    },
  });
  calls[0].resolve(frame(0));
  await tick();
  expect(scheduler.state.members.every((m) => !m.frame)).toBe(true);
  expect(calls[1].config.pole.x).toBe(2);
  calls[1].resolve(frame(1));
  await tick();
  const own = structuredClone(scheduler.state.members[0].frame);
  calls[1].config.curve.x = "corrupted";
  expect(scheduler.state.members[0].frame).toEqual(own);
  calls[2].reject(new EngineError("bad member"));
  await tick();
  expect(scheduler.state.members[1].error).toBe("bad member");
  calls[3].resolve(frame(3));
  await tick();
  expect(scheduler.state.members.filter((m) => m.frame)).toHaveLength(2);
  expect(scheduler.state.members.map((m) => m.value)).toEqual([2, 3, 4]);
  expect(scheduler.state.retained).toBeGreaterThan(0);
  scheduler.cancel();
  expect(scheduler.state.members).toEqual([]);
  scheduler.generate(original, f);
  calls[4].reject(new Error("worker deadline"));
  await tick();
  expect(disposed).toBe(true);
  expect(scheduler.state.queued).toBe(0);
  expect(scheduler.state.failed).toMatch(/worker deadline/);
  scheduler.generate(original, f);
  expect(calls).toHaveLength(5);
});

test("finite engraving production overlay, selected construction, recovery and vector still", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  const before = await page.locator("#artwork").innerHTML();
  await page.getByRole("button", { name: "catacaustic", exact: true }).click();
  await settled(page);
  await page.getByLabel("Finite engraving", { exact: true }).check();
  await settled(page);
  await expect(page.locator("[data-family-member]")).toHaveCount(16);
  await expect(page.locator("#artwork text")).toHaveCount(0);
  const desc = JSON.parse(
    (await page.locator("#artwork > desc").textContent())!,
  );
  expect(desc.family.presentation).toBe("family");
  expect(desc.family.members).toHaveLength(16);
  await page
    .getByLabel("Family presentation", { exact: true })
    .selectOption("selected");
  await page.getByLabel("Selected member", { exact: true }).selectOption("7");
  await settled(page);
  await expect(page.locator("[data-family-member]")).toHaveCount(1);
  await expect(page.locator("[data-family-member]")).toHaveAttribute(
    "data-family-member",
    "7",
  );
  await expect(
    page.locator('#artwork [data-family-member] circle[r="5"]'),
  ).toHaveCount(1);
  const download = page.waitForEvent("download");
  await exportImage(page, "SVG");
  const image = await readFile((await (await download).path())!, "utf8");
  expect(image).toContain("<path");
  expect(image).not.toContain("<image");
  expect(
    JSON.parse(/<desc>(.*?)<\/desc>/s.exec(image)![1]).family.selected,
  ).toBe(7);
  await page.getByLabel("Finite engraving", { exact: true }).uncheck();
  await settled(page);
  await page.getByRole("button", { name: "evolute", exact: true }).click();
  await settled(page);
  expect(await page.locator("#artwork").innerHTML()).toBe(before);
});

test("lamp lace preset declares a circular polar track and explanatory member", async () => {
  const { presetStudy } = await import("../web/planar-link");
  const index = presets.findIndex((p) => p.title === "A lamp's lace");
  expect(index).toBeGreaterThanOrEqual(0);
  const s = presetStudy(index);
  expect(s.family).toMatchObject({
    enabled: true,
    target: "sourceTheta",
    count: 16,
    presentation: "family",
  });
  expect(s.config.source).toMatchObject({
    kind: "point",
    coordinates: "polar",
    radius: 0.3,
  });
  expect(s.config.curve.x).toBe("1.02*cos(t)");
  expect(s.config.curve.y).toBe("sin(t)");
  expect(s.family!.from).toBe(0);
  // Inclusive sampling of a whole turn would draw the first lamp twice: the
  // last member stops one step short, so all sixteen positions are distinct.
  expect(s.family!.to).toBe((15 * Math.PI) / 8);
  const { familyValues } = await import("../web/planar-family");
  const turns = familyValues(s.family!, 0).map(
    (v) => Math.round((v / (2 * Math.PI)) * 16) % 16,
  );
  expect(new Set(turns).size).toBe(16);
});

test("lamp lace production WASM members match standalone geometry at their displayed values", async ({
  page,
}, info) => {
  await observeAtlasWorkers(page);
  await page.goto("/");
  await choosePreset(page, { label: "A lamp's lace" });
  await settled(page);
  const observations = await page.evaluate(async () => {
    const logs = (window as any).atlasWorkers;
    const family = logs.find((l: any) => l.requests.length === 16);
    const ordinary = new Worker(family.url);
    const members = [];
    for (const [i, item] of family.requests.entries()) {
      const expected: any = await new Promise((resolve) => {
        ordinary.onmessage = (e) => resolve(e.data);
        ordinary.postMessage({ ...item.data, id: i + 100 });
      });
      const actual = family.replies[i].data;
      members.push({
        same: JSON.stringify(actual.result) === JSON.stringify(expected.result),
        configSame:
          JSON.stringify(actual.config) === JSON.stringify(expected.config),
        value: actual.config.source.theta,
        samples: actual.result.base.length,
        finite: actual.result.derived.filter(Boolean).length,
        rays: actual.result.rays.length,
        bytes: JSON.stringify(actual.result).length,
        milliseconds: family.replies[i].took,
      });
    }
    ordinary.terminate();
    return { members, maximum: family.maximum };
  });
  expect(observations.maximum).toBe(1);
  expect(observations.members).toHaveLength(16);
  const values = await page
    .locator("[data-family-member]")
    .evaluateAll((nodes) =>
      nodes.map((n) => Number(n.getAttribute("data-family-value"))),
    );
  expect(values).toEqual(observations.members.map((m) => m.value));
  for (const m of observations.members) {
    expect(m.same).toBe(true);
    expect(m.configSame).toBe(true);
    expect(m.samples).toBe(1500);
    expect(m.finite).toBeGreaterThan(1400);
    expect(m.rays).toBe(24);
  }
  await info.attach("lamp-lace-worker-transport", {
    body: JSON.stringify(observations, null, 2),
    contentType: "application/json",
  });
});

test("finite engraving reverse sampling is bit-exact and coincident values preserve entered precision", async () => {
  const { familyValues, familyDefaults } = await import("../web/planar-family");
  const { presetStudy } = await import("../web/planar-link");
  const f = familyDefaults(presetStudy(0).config);
  for (const count of [3, 16, 31, 32]) {
    const forward = { ...f, from: 0, to: 2 * Math.PI, count };
    expect(
      familyValues({ ...forward, from: forward.to, to: forward.from }, 0),
    ).toEqual(familyValues(forward, 0).reverse());
    const value = 0.12345678901234567;
    expect(familyValues({ ...forward, from: value, to: value }, value)).toEqual(
      Array(count).fill(value),
    );
  }
});

test("finite engraving camera is shared independently and disabling restores the source camera", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await settled(page);
  const art = page.locator("#artwork");
  await art.focus();
  await page.keyboard.press("+");
  await page.keyboard.press("ArrowRight");
  const source = await art.getAttribute("data-camera-center");
  await page.getByRole("button", { name: "catacaustic", exact: true }).click();
  await settled(page);
  const sourceView = await art.getAttribute("data-camera-center");
  await page.getByLabel("Finite engraving", { exact: true }).check();
  await settled(page);
  await art.focus();
  await page.keyboard.press("+");
  await page.keyboard.press("ArrowLeft");
  const familyView = await art.getAttribute("data-camera-center");
  const shared = (await copiedStudy(page)).study as any;
  expect(shared.family.camera.zoom).toBeGreaterThan(1);
  await page.goto(
    `/#s=${deflateRawSync(Buffer.from(JSON.stringify({ v: 1, notebook: "2d", study: shared }))).toString("base64url")}`,
  );
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
  await settled(page);
  expect(await art.getAttribute("data-camera-center")).toBe(familyView);
  await page.getByLabel("Finite engraving", { exact: true }).uncheck();
  await settled(page);
  expect(await art.getAttribute("data-camera-center")).toBe(sourceView);
  expect(source).not.toBe("0,0");
});

for (const target of [
  "sourceX",
  "sourceY",
  "sourceRadius",
  "poleX",
  "poleY",
  "a",
] as const)
  test(`finite engraving curated ${target} uses real standalone requests`, async ({
    page,
  }) => {
    const { presetStudy } = await import("../web/planar-link");
    const { familyDefaults } = await import("../web/planar-family");
    const study = presetStudy(0);
    study.config.kind = target.startsWith("source") ? "catacaustic" : "pedal";
    study.config.curve.x = "a*cos(t)";
    if (target === "sourceRadius")
      study.config.source = {
        ...study.config.source,
        coordinates: "polar",
        radius: 0.3,
        theta: 0.4,
      };
    study.family = {
      ...familyDefaults(study.config, target),
      enabled: true,
      count: 3,
      from: target === "a" ? -1 : 0.1,
      to: 0.6,
    };
    await observeAtlasWorkers(page);
    await page.goto(
      `/#s=${deflateRawSync(Buffer.from(JSON.stringify({ v: 1, notebook: "2d", study }))).toString("base64url")}`,
    );
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
    await settled(page);
    const outcome = await page.evaluate(async () => {
      const logs = (window as any).atlasWorkers;
      const family = logs.find((l: any) => l.requests.length === 3);
      const ordinary = new Worker(family.url);
      const checks = [];
      for (const [i, call] of family.requests.entries()) {
        const data: any = await new Promise((resolve) => {
          ordinary.onmessage = (e) => resolve(e.data);
          ordinary.postMessage({ ...call.data, id: 100 + i });
        });
        checks.push({
          same:
            JSON.stringify(data.result) ===
            JSON.stringify(family.replies[i].data.result),
          finite: data.result.derived.filter(Boolean).length,
          rays: data.result.rays.length,
        });
      }
      ordinary.terminate();
      return checks;
    });
    expect(outcome).toHaveLength(3);
    for (const result of outcome) {
      expect(result.same).toBe(true);
      expect(result.finite).toBeGreaterThan(900);
      expect(result.rays).toBe(48);
    }
    if (target === "a")
      await expect(
        page.locator("#artwork [data-testid=base-curve]"),
      ).toHaveCount(3);
    else
      await expect(
        page.locator("#artwork [data-testid=base-curve]"),
      ).toHaveCount(1);
  });

test("finite engraving partial and all-invalid families preserve gaps and disclose missing members", async ({
  page,
}) => {
  const { presetStudy } = await import("../web/planar-link");
  const { familyDefaults } = await import("../web/planar-family");
  const study = presetStudy(0);
  study.config.kind = "pedal";
  study.config.curve.x = "sqrt(a)*cos(t)";
  study.config.curve.y = "sqrt(a)*sin(t)";
  study.family = {
    ...familyDefaults(study.config, "a"),
    enabled: true,
    count: 3,
    from: -1,
    to: 1,
  };
  await page.goto(
    `/#s=${deflateRawSync(Buffer.from(JSON.stringify({ v: 1, notebook: "2d", study }))).toString("base64url")}`,
  );
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
  await settled(page);
  await expect(page.locator("[data-family-member]")).toHaveCount(1);
  await expect(
    page.getByText("1 of 3 members available.", { exact: true }),
  ).toBeVisible();
  let desc = JSON.parse((await page.locator("#artwork > desc").textContent())!);
  expect(desc.family.partial).toBe(true);
  expect(desc.family.members.filter((m: any) => m.error)).toHaveLength(2);
  const download = page.waitForEvent("download");
  await exportImage(page, "SVG");
  expect(await readFile((await (await download).path())!, "utf8")).toContain(
    '\"partial\":true',
  );
  await page.getByLabel("Family to", { exact: true }).fill("-1");
  await settled(page);
  await expect(
    page.getByRole("button", { name: "Export image", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("0 of 3 members available.", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Finite engraving", { exact: true }).uncheck();
  await settled(page);
  await expect(page.getByLabel("x(t)", { exact: true })).toHaveValue(
    "sqrt(a)*cos(t)",
  );
});

test("finite engraving scalar edits reset target ranges and preserve work on a refused budget", async ({
  page,
}) => {
  await page.goto("/");
  await choosePreset(page, { label: "A lamp's lace" });
  await settled(page);
  await page.getByLabel("Family from", { exact: true }).fill("-pi");
  await page.getByLabel("Family to", { exact: true }).fill("pi");
  await settled(page);
  await page
    .getByLabel("Family parameter", { exact: true })
    .selectOption("sourceRadius");
  await settled(page);
  await expect(page.getByLabel("Family from", { exact: true })).toHaveValue(
    "0",
  );
  await expect(page.getByLabel("Family to", { exact: true })).toHaveValue(
    "1.3",
  );
  await page.getByLabel("Family members", { exact: true }).fill("32");
  await page.getByLabel("Numerical samples", { exact: true }).fill("32768");
  await settled(page);
  await expect(page.getByRole("alert")).toContainText(/limit/);
  await expect(
    page.getByRole("button", { name: "Export image", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Finite engraving", { exact: true }).uncheck();
  await settled(page);
  await expect(
    page.getByLabel("Numerical samples", { exact: true }),
  ).toHaveValue("32768");
  await expect(page.getByLabel("Source radius r", { exact: true })).toHaveValue(
    "0.3",
  );
});

test("finite engraving invalid constants identify their own field", async ({
  page,
}) => {
  await page.goto("/");
  await choosePreset(page, { label: "A lamp's lace" });
  await settled(page);
  const from = page.getByLabel("Family from", { exact: true });
  await from.fill("a");
  await expect(from).toHaveAttribute("aria-invalid", "true");
  await expect(from.locator("..").locator(".field-error")).toContainText(
    /constant|variable|a/,
  );
  await expect(
    page.getByRole("button", { name: "Export image", exact: true }),
  ).toBeDisabled();
  await from.fill("pi/2");
  await settled(page);
  await expect(from).not.toHaveAttribute("aria-invalid", "true");
  // A refused setting, not a parse error, also belongs to its own control,
  // and the panel does not repeat it.
  const to = page.getByLabel("Family to", { exact: true });
  await to.fill("");
  await expect(to).toHaveAttribute("aria-invalid", "true");
  await expect(to.locator("..").locator(".field-error")).toHaveText(
    "Family to must be a finite constant.",
  );
  await expect(page.getByRole("alert")).toHaveCount(1);
  await to.fill("2*pi");
  await settled(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("finite engraving cancels deferred generations, selection coalesces and notebook replacement retires its worker", async ({
  page,
}) => {
  await observeAtlasWorkers(page, 200);
  await page.goto("/");
  await choosePreset(page, { label: "A lamp's lace" });
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).atlasWorkers[1]?.requests.length ?? 0,
      ),
    )
    .toBe(1);
  await page.getByLabel("Finite engraving", { exact: true }).uncheck();
  await expect
    .poll(() => page.evaluate(() => (window as any).atlasWorkers[1].terminated))
    .toBe(true);
  await page.getByLabel("Finite engraving", { exact: true }).check();
  for (const value of ["3", "9", "1"])
    await page
      .getByLabel("Selected member", { exact: true })
      .selectOption(value);
  await settled(page);
  const data = await page.evaluate(() =>
    (window as any).atlasWorkers.map((l: any) => ({
      requests: l.requests.length,
      maximum: l.maximum,
      terminated: l.terminated,
    })),
  );
  expect(data[1].requests).toBe(1);
  expect(data[2].requests).toBe(16);
  expect(data[2].maximum).toBe(1);
  await page
    .getByLabel("Family presentation", { exact: true })
    .selectOption("selected");
  await expect(page.locator("[data-family-member]")).toHaveAttribute(
    "data-family-member",
    "1",
  );
  await chooseNotebook(page, "3d");
  await expect
    .poll(() => page.evaluate(() => (window as any).atlasWorkers[2].terminated))
    .toBe(true);
  await chooseNotebook(page, "2d");
  await settled(page);
  await expect(page.locator("[data-family-member]")).toHaveAttribute(
    "data-family-member",
    "1",
  );
});

test("finite engraving worker deadline stops the queue and re-enable starts a fresh engine", async ({
  page,
}) => {
  await observeAtlasWorkers(page);
  await page.goto("/");
  await settled(page);
  await page.evaluate(() => {
    const post = Worker.prototype.postMessage;
    const later = window.setTimeout;
    (window as any).blockFamily = true;
    Worker.prototype.postMessage = function (data: any, options?: any) {
      if (data.action !== "compute" || !(window as any).blockFamily)
        post.call(this, data, options);
    };
    // Only while delivery is blocked: a fresh engine's first request loads
    // its WASM, which a loaded CI runner cannot do in 80 ms.
    window.setTimeout = ((handler: TimerHandler, ms?: number, ...rest: any[]) =>
      later(
        handler,
        ms === 30000 && (window as any).blockFamily ? 80 : ms,
        ...rest,
      )) as typeof setTimeout;
  });
  await choosePreset(page, { label: "A lamp's lace" });
  await expect(page.getByRole("alert")).toContainText("timed out");
  const dead = await page.evaluate(() => (window as any).atlasWorkers[1]);
  expect(dead.requests).toHaveLength(0); // the test blocked delivery to the native worker
  expect(dead.terminated).toBe(true);
  await page.getByLabel("Family from", { exact: true }).fill("1");
  await expect(page.getByRole("alert")).toContainText("timed out");
  await page.evaluate(() => {
    (window as any).blockFamily = false;
  });
  await page.getByLabel("Finite engraving", { exact: true }).uncheck();
  await page.getByLabel("Finite engraving", { exact: true }).check();
  await settled(page);
  await expect(page.locator("[data-family-member]")).toHaveCount(16);
});

test("finite engraving legend names the members it draws, not the previous study", async ({
  page,
}) => {
  // The notebook opens on an evolute; the family's members are catacaustics.
  await page.goto("/");
  await settled(page);
  await expect(page.locator('.legend [data-legend="derived"]')).toHaveText(
    "evolute",
  );
  await choosePreset(page, { label: "A lamp's lace" });
  await settled(page);
  await expect(page.locator("[data-family-member]")).toHaveCount(16);
  await expect(page.locator('.legend [data-legend="derived"]')).toHaveText(
    "catacaustic",
  );
});

test("choosing an ordinary preset after the lamp's lace leaves no family behind", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  const opening = await page.locator("#artwork").innerHTML();
  await choosePreset(page, { label: "A lamp's lace" });
  await settled(page);
  await expect(page.locator("[data-family-member]")).toHaveCount(16);
  await choosePreset(page, 0);
  await settled(page);
  await expect(
    page.getByLabel("Finite engraving", { exact: true }),
  ).not.toBeChecked();
  await expect(page.locator(".plot-wrap")).not.toHaveAttribute("data-family");
  await expect(page.locator("[data-family-member]")).toHaveCount(0);
  await expect(page.locator("#artwork")).toHaveJSProperty("innerHTML", opening);
  await expect(
    page.getByRole("button", { name: "Animation", exact: true }),
  ).toBeVisible();
});

test("finite engraving caps bind independently at their literal limits and the scheduler retires what it refuses", async () => {
  const { PlanarFamily, familyBudget, familyDefaults, familyValues } =
    await import("../web/planar-family");
  const { presetStudy } = await import("../web/planar-link");
  const { EngineError } = await import("../web/engine-client");
  const s = presetStudy(0);
  s.config.curve.x = "a*cos(t)";
  s.config.lines = 24;
  const f = { ...familyDefaults(s.config, "a"), enabled: true };
  // Weighted work alone: a refined rolling construction of two members.
  const rolling = { ...s.config, kind: "rolling" as const, adaptive: true };
  const work = (samples: number) =>
    familyBudget({ ...rolling, samples }, { ...f, count: 2 });
  expect(work(977)).toMatchObject({ points: 69444, work: 79999488 });
  expect(work(977).error).toBeUndefined();
  expect(work(978)).toMatchObject({ points: 69448, work: 80004096 });
  expect(work(978).numbers).toBeLessThan(4000000);
  expect(work(978).error).toMatch(/limit/);
  // Retained numbers alone: three members refined to the view.
  const framed = { ...s.config, adaptive: true, adaptiveFrame: true };
  const numbers = (samples: number) =>
    familyBudget({ ...framed, samples }, { ...f, count: 3 });
  expect(numbers(25234).numbers).toBe(3999936);
  expect(numbers(25234).error).toBeUndefined();
  expect(numbers(25235).numbers).toBe(4000032);
  expect(numbers(25235).points).toBeLessThan(500000);
  expect(numbers(25235).work).toBeLessThan(80000000);
  expect(numbers(25235).error).toMatch(/limit/);
  // Member count, and the field each setting's refusal names.
  expect(familyBudget(s.config, { ...f, count: 32 }).error).toBeUndefined();
  expect(familyBudget(s.config, { ...f, count: 33 })).toMatchObject({
    field: "Family members",
  });
  expect(familyBudget(s.config, { ...f, count: 1 }).field).toBe(
    "Family members",
  );
  // A generated midpoint that lands on the entered value keeps it exactly,
  // where shortening would otherwise drop its last digits.
  const entered = 0.12345678901234568;
  expect(
    familyValues({ ...f, from: 0, to: 2 * entered, count: 3 }, entered)[1],
  ).toBe(entered);

  const calls: any[] = [];
  const scheduler = new PlanarFamily(
    {
      compute: () =>
        new Promise<any>((resolve, reject) => calls.push({ resolve, reject })),
    },
    () => {},
  );
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const points = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ x: i, y: 0 }));
  const frame = (derived: unknown[]) => ({
    config: s.config,
    result: { base: [], derived, rays: [], family: [] },
  });
  // A stale member's refusal never reaches its replacement.
  scheduler.generate(s, { ...f, count: 3 });
  scheduler.generate(s, { ...f, count: 3, from: 5, to: 6 });
  calls[0].reject(new EngineError("stale refusal"));
  await tick();
  expect(scheduler.state.members.some((m) => m.error)).toBe(false);
  // Delivered geometry is counted against four million numbers: a member
  // that would pass it is refused, and later small members still arrive.
  calls[1].resolve(frame(points(1500000)));
  await tick();
  expect(scheduler.state.retained).toBe(3000000);
  calls[2].resolve(frame(points(500001)));
  await tick();
  expect(scheduler.state.members[1].error).toMatch(/retained geometry limit/);
  expect(scheduler.state.retained).toBe(3000000);
  // A member with no finite derived point is explicitly unavailable.
  calls[3].resolve(frame([null, null]));
  await tick();
  expect(scheduler.state.members[2].error).toMatch(/No finite derived/);
  expect(scheduler.state.pending).toBe(false);
  // Canceling drops the queue: the request in flight is the last one.
  scheduler.generate(s, { ...f, count: 3 });
  expect(calls).toHaveLength(5);
  expect(scheduler.state.queued).toBe(2);
  scheduler.cancel();
  expect(scheduler.state.queued).toBe(0);
  calls[4].resolve(frame(points(2)));
  await tick();
  expect(calls).toHaveLength(5);
  expect(scheduler.state.members).toEqual([]);
});

test("finite engraving survives clearing the member count before typing a new one", async ({
  page,
}) => {
  await page.goto("/");
  await choosePreset(page, { label: "A lamp's lace" });
  await settled(page);
  const count = page.getByLabel("Family members", { exact: true });
  await count.fill("");
  await expect(count).toHaveAttribute("aria-invalid", "true");
  await count.fill("8");
  await settled(page);
  await expect(page.locator("#artwork [data-family-member]")).toHaveCount(8);
  await expect(page.getByLabel("Selected member", { exact: true })).toHaveValue(
    "4",
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("finite engraving refined to its view keeps its drawing while a zoom recomputes it", async ({
  page,
}) => {
  await page.goto("/");
  await choosePreset(page, { label: "A lamp's lace" });
  await page.getByLabel("Family members", { exact: true }).fill("8");
  await page.getByText("Refine between samples", { exact: true }).click();
  await page
    .getByText("Refine to the view as you zoom", { exact: true })
    .click();
  await settled(page);
  const members = page.locator("#artwork [data-family-member]");
  await expect(members).toHaveCount(8);
  await page.evaluate(() => {
    const seen = ((window as any).seen = { busy: false, lost: false });
    const wrap = document.querySelector(".plot-wrap")!;
    new MutationObserver(() => {
      if (wrap.getAttribute("aria-busy") === "true") seen.busy = true;
      if (
        !wrap.querySelector("[data-family-member]") ||
        wrap.querySelector(".loading")
      )
        seen.lost = true;
    }).observe(wrap, { subtree: true, childList: true, attributes: true });
  });
  await page.locator("#artwork").focus();
  await page.keyboard.press("+");
  await page.keyboard.press("+");
  await expect
    .poll(() => page.evaluate(() => (window as any).seen.busy))
    .toBe(true);
  await settled(page);
  await expect(members).toHaveCount(8);
  expect(await page.evaluate(() => (window as any).seen.lost)).toBe(false);
});

test("a linked trace animation survives opening with the engraving on", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await choosePreset(page, { label: "A lamp's lace" });
  await settled(page);
  const shared = (await copiedStudy(page)).study as any;
  shared.animation.mode = "trace";
  // A fresh page, so the notebook has no frame of its own yet.
  await page.goto(
    `/#s=${deflateRawSync(Buffer.from(JSON.stringify({ v: 1, notebook: "2d", study: shared }))).toString("base64url")}`,
  );
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
  await settled(page);
  await expect(page.locator("#artwork [data-family-member]")).toHaveCount(16);
  // Shared again with the engraving on, the animation is unchanged.
  expect(((await copiedStudy(page)).study as any).animation.mode).toBe("trace");
  await page.getByLabel("Finite engraving", { exact: true }).uncheck();
  await settled(page);
  await expect(
    page.getByRole("combobox", { name: "Animate", exact: true }),
  ).toHaveValue("trace");
});

test("finite engraving motion membership has exact boundaries and keeps unavailable slots", async () => {
  const { familyMotionMembers } = await import("../web/family-motion");
  const members = Array.from({ length: 16 }, (_, id) => ({
    id,
    value: id,
    ...(id === 2 ? { error: "singular" } : {}),
  }));
  const ids = (mode: "reveal" | "window", width: number, progress: number) =>
    familyMotionMembers(members, { mode, width, progress }).map((m) => m.id);
  // Expectations are literal, independent of the production membership rule.
  expect(ids("reveal", 3, 0)).toEqual([0]);
  expect(ids("reveal", 3, 1 / 15 - 1e-9)).toEqual([0]);
  expect(ids("reveal", 3, 1 / 15)).toEqual([0, 1]);
  expect(ids("reveal", 3, 0.5)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  expect(ids("reveal", 3, 0.999999999)).toHaveLength(15);
  expect(ids("reveal", 3, 1)).toEqual(members.map((m) => m.id));
  expect(ids("window", 3, 0)).toEqual([0, 1, 2]);
  expect(ids("window", 3, 1 / 14 - 1e-9)).toEqual([0, 1, 2]);
  expect(ids("window", 3, 1 / 14)).toEqual([1, 2, 3]);
  expect(ids("window", 3, 0.5)).toEqual([7, 8, 9]);
  expect(ids("window", 3, 1)).toEqual([13, 14, 15]);
  expect(ids("window", 16, 1)).toEqual(members.map((m) => m.id));
  expect(ids("window", 1, 1)).toEqual([15]);
  expect(
    familyMotionMembers(members, { mode: "window", width: 3, progress: 0 })[2],
  ).toBe(members[2]);
  for (const progress of [1, 0.5, 0, 0.5, 1])
    expect(ids("window", 3, progress)).toEqual(
      progress === 0 ? [0, 1, 2] : progress === 1 ? [13, 14, 15] : [7, 8, 9],
    );
  const { sampleFamily, defaultFamilyAnimation } =
    await import("../web/family-motion");
  const { presetStudy } = await import("../web/planar-link");
  const source = presetStudy(0);
  const frame = {
    config: source.config,
    result: { base: [], derived: [], rays: [], family: [] },
  } as any;
  const prepared = {
    settings: { ...source.family, count: 16 } as any,
    members,
    setup: { ...defaultFamilyAnimation, mode: "window" as const },
    view: { cx: 0, cy: 0, span: 2, scale: 100 },
  };
  for (let i = 0; i < 1000; i++) {
    const sampled = sampleFamily(
      prepared,
      frame,
      i / 999,
      0.8,
      false,
      "source-generation",
    );
    expect(sampled.family!.members).toBe(members);
    expect(sampled.frame).toBe(frame);
    expect(sampled.owner).toBe("source-generation");
  }
  expect(members).toHaveLength(16);
  expect(members[2].error).toBe("singular");
});

test("finite engraving turnaround holds the exact endpoint for visible absolute time", async () => {
  const { familyProgressAt } = await import("../web/family-motion");
  const p = (time: number, duration = 8) =>
    familyProgressAt(time, {
      duration,
      repeat: "back-and-forth",
      pace: "steady",
    });
  expect(p(0)).toBe(0);
  expect(p(0.4375 - 1e-8)).toBeLessThan(1);
  for (const t of [0.4375, 0.45, 0.499, 0.5, 0.501, 0.55, 0.5625])
    expect(p(t)).toBe(1);
  expect(p(0.5625 + 1e-8)).toBeLessThan(1);
  expect(p(1)).toBe(0);
  expect(p(0.25)).toBeCloseTo(4 / 7, 14);
  expect(p(0.75)).toBeCloseTo(4 / 7, 14);
  // Very short animations spend at most a quarter of their time resting.
  expect(p(0.375, 0.4)).toBe(1);
  expect(p(0.625, 0.4)).toBe(1);
  expect(p(0.25, 0.4)).toBeCloseTo(2 / 3, 14);
  expect(
    familyProgressAt(0.5, { duration: 8, repeat: "once", pace: "steady" }),
  ).toBe(0.5);
  expect(
    familyProgressAt(0.4375, {
      duration: 8,
      repeat: "back-and-forth",
      pace: "ease",
    }),
  ).toBe(1);
});

async function familyAnimation(page: Page) {
  await openAnimation(page);
  await expect(page.locator("#animation-section")).toHaveCount(1);
  await page.getByLabel("Repeat", { exact: true }).selectOption("once");
}
async function pauseFamily(page: Page) {
  await expect(
    page.getByRole("button", { name: "Play animation", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
}

test("finite engraving uses the normal animation panel and prepared member geometry", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).motionComputes = 0;
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (data: any, options?: any) {
      if (data.action === "compute") (window as any).motionComputes++;
      post.call(this, data, options);
    };
  });
  await page.goto("/");
  await choosePreset(page, { label: "A lamp's lace" });
  await settled(page);
  const art = page.locator("#artwork"),
    members = art.locator("[data-family-member]");
  const paths = await members
    .getByTestId("derived-curve")
    .evaluateAll((ns) => ns.map((n) => n.getAttribute("d")));
  expect(paths).toHaveLength(16);
  expect(paths.every((d) => d && d.length > 100)).toBe(true);
  const requests = await page.evaluate(() => (window as any).motionComputes);
  await page
    .locator(".family-panel")
    .getByRole("button", { name: "About finite engraving", exact: true })
    .click();
  await page
    .locator(".family-panel")
    .getByRole("button", { name: "Show more", exact: true })
    .click();
  await expect(page.locator(".family-panel")).toContainText("in Animation");
  await familyAnimation(page);
  await expect(
    page.getByRole("button", { name: "Preview engraving motion", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Stop", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Selected member", { exact: true }).selectOption("0");
  await page
    .getByRole("checkbox", { name: "Incident rays", exact: true })
    .check();
  await pauseFamily(page);
  const slider = page.getByRole("slider", {
    name: "Animation progress",
    exact: true,
  });
  for (const [time, ids] of [
    [0, [0]],
    [0.5, [0, 1, 2, 3, 4, 5, 6, 7]],
    [1, Array.from({ length: 16 }, (_, i) => i)],
  ] as const) {
    await slider.fill(String(time));
    await expect
      .poll(() =>
        members.evaluateAll((ns) =>
          ns.map((n) => Number(n.getAttribute("data-family-member"))),
        ),
      )
      .toEqual(ids);
    await expect(art.getByTestId("base-curve")).toHaveCount(1);
    await expect(art.locator('[data-family-member="0"] line')).toHaveCount(24);
  }
  expect(await page.evaluate(() => (window as any).motionComputes)).toBe(
    requests,
  );
  await page
    .getByRole("button", { name: "Back to study", exact: true })
    .click();
  expect(
    await members
      .getByTestId("derived-curve")
      .evaluateAll((ns) => ns.map((n) => n.getAttribute("d"))),
  ).toEqual(paths);
  await page.getByLabel("Animate", { exact: true }).selectOption("window");
  await page.getByLabel("Window members", { exact: true }).fill("3");
  await pauseFamily(page);
  await slider.fill("1");
  await expect
    .poll(() =>
      members.evaluateAll((ns) =>
        ns.map((n) => Number(n.getAttribute("data-family-member"))),
      ),
    )
    .toEqual([13, 14, 15]);
  await slider.fill("0");
  await expect
    .poll(() =>
      members.evaluateAll((ns) =>
        ns.map((n) => Number(n.getAttribute("data-family-member"))),
      ),
    )
    .toEqual([0, 1, 2]);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const at = await slider.inputValue();
  await page.waitForTimeout(100);
  await expect(slider).toHaveValue(at);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(slider).toHaveCount(0);
  await page.getByLabel("Family members", { exact: true }).fill("2");
  await settled(page);
  await expect(page.getByLabel("Window members", { exact: true })).toHaveValue(
    "2",
  );
  await pauseFamily(page);
  await choosePreset(page, 0);
  await settled(page);
  await expect(members).toHaveCount(0);
  await openAnimation(page);
  await expect(page.getByLabel("Animate", { exact: true })).toHaveValue(
    "reveal",
  );
});

for (const narrow of [false, true])
  test(`finite engraving shared playback restores edited camera and vector capture at ${narrow ? "phone" : "desktop"} width`, async ({
    page,
  }) => {
    if (narrow) await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await choosePreset(page, { label: "A lamp's lace" });
    await settled(page);
    await page
      .getByLabel("Family presentation", { exact: true })
      .selectOption("selected");
    await page.getByLabel("Selected member", { exact: true }).selectOption("7");
    const art = page.locator("#artwork");
    await art.focus();
    await page.keyboard.press("+");
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(
        async () =>
          JSON.parse(
            (await page.locator(".plot-wrap").getAttribute("data-family"))!,
          ).camera,
      )
      .toEqual({ x: 20, y: 0, zoom: 1.1 });
    const scale = await art.getAttribute("data-camera-scale"),
      center = await art.getAttribute("data-camera-center");
    await familyAnimation(page);
    await page
      .getByLabel("Animation camera", { exact: true })
      .selectOption("current");
    await pauseFamily(page);
    const slider = page.getByRole("slider", {
      name: "Animation progress",
      exact: true,
    });
    await slider.fill("0.5");
    await expect(art.locator("[data-family-member]")).toHaveCount(8);
    await expect(art).toHaveAttribute("data-camera-scale", scale!);
    await expect(art).toHaveAttribute("data-camera-center", center!);
    const download = page.waitForEvent("download");
    await exportImage(page, "SVG");
    const svg = await readFile((await (await download).path())!, "utf8");
    expect(svg).not.toContain("<image");
    expect(
      [...svg.matchAll(/data-family-member="(\d+)"/g)].map((m) => Number(m[1])),
    ).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(
      JSON.parse(/<desc>(.*?)<\/desc>/s.exec(svg)![1]).family.motion.progress,
    ).toBe(0.5);
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    // Saved animation setup changes metadata but never the original geometry/camera.
    await expect(art.locator("[data-family-member]")).toHaveAttribute(
      "data-family-member",
      "7",
    );
    await expect(art).toHaveAttribute("data-camera-scale", scale!);
    await expect(art).toHaveAttribute("data-camera-center", center!);
    await expect(
      page.getByLabel("Selected member", { exact: true }),
    ).toHaveValue("7");
  });

test("finite engraving construction toggles draw only its selected member", async ({
  page,
}) => {
  await page.goto("/");
  await choosePreset(page, { label: "A lamp's lace" });
  await settled(page);
  const member = page.locator('#artwork [data-family-member="4"]');
  await page
    .getByRole("checkbox", { name: "Construction lines", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "Incident rays", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "Virtual extensions", exact: true })
    .check();
  await expect.poll(() => member.locator("line").count()).toBeGreaterThan(24);
  expect(
    await page
      .locator(
        '#artwork [data-family-member]:not([data-family-member="4"]) line',
      )
      .count(),
  ).toBe(0);
  const before = await member
    .locator("line")
    .evaluateAll((ns) => ns.map((n) => n.outerHTML));
  await page
    .getByRole("checkbox", { name: "Stop rays at the caustic", exact: true })
    .check();
  await expect
    .poll(() =>
      member.locator("line").evaluateAll((ns) => ns.map((n) => n.outerHTML)),
    )
    .not.toEqual(before);
  await page
    .getByRole("checkbox", { name: "Construction lines", exact: true })
    .uncheck();
  await page
    .getByRole("checkbox", { name: "Incident rays", exact: true })
    .uncheck();
  await expect(member.locator("line")).toHaveCount(0);
});

test("lamp lace opens clean with authored family playback and working construction layers", async () => {
  const { presetStudy } = await import("../web/planar-link");
  const s = presetStudy(presets.findIndex((p) => p.title === "A lamp's lace"));
  expect(s.layers).toMatchObject({
    lines: false,
    incident: false,
    virtual: false,
  });
  expect(s.family!.animation).toEqual({
    mode: "reveal",
    width: 3,
    duration: 8,
    repeat: "back-and-forth",
    pace: "steady",
    camera: "hold",
  });
});

for (const family of [false, true])
  test(`shared ${family ? "family" : "ordinary"} playback keeps its timeline inside the scrolled desktop sidebar`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 700 });
    await page.goto("/");
    if (family) await choosePreset(page, { label: "A lamp's lace" });
    await settled(page);
    await openAnimation(page);
    await page.locator("aside").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const art = await page.locator("#artwork").boundingBox();
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    const slider = page.getByRole("slider", {
      name: "Animation progress",
      exact: true,
    });
    await expect(slider).toBeVisible();
    await expect
      .poll(async () => {
        const bounds = await slider.boundingBox(),
          aside = await page.locator("aside").boundingBox();
        return (
          !!bounds &&
          !!aside &&
          bounds.y >= aside.y &&
          bounds.y + bounds.height <= aside.y + aside.height
        );
      })
      .toBe(true);
    expect(await page.locator("#artwork").boundingBox()).toEqual(art);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const buttons = await page
      .locator("#playback button")
      .evaluateAll((ns) => ns.map((n) => n.getBoundingClientRect().height));
    expect(Math.max(...buttons)).toBeLessThanOrEqual(50);
  });

for (const [mode, repeat, allConstruction] of [
  ["reveal", "once", false],
  ["window", "once", false],
  ["reveal", "back-and-forth", false],
  ["window", "once", true],
] as const)
  test(`finite engraving ${mode} ${repeat}${allConstruction ? " all-construction" : ""} movie decodes with exact timing and held-current endpoint geometry`, async ({
    page,
  }) => {
    // Full-page reference rasters and a decoded movie: 27–41 s per variant
    // on CI runners, and back-and-forth's third reference exceeded 60 s.
    test.slow();
    await page.addInitScript(() => {
      (window as any).exportSVGs = [];
      const create = URL.createObjectURL;
      URL.createObjectURL = function (blob: Blob | MediaSource) {
        if (
          (window as any).recordExportSVG &&
          blob instanceof Blob &&
          blob.type === "image/svg+xml"
        )
          void blob
            .text()
            .then((text) => (window as any).exportSVGs.push(text));
        return create.call(this, blob);
      };
    });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await choosePreset(page, { label: "A lamp's lace" });
    await settled(page);
    await page
      .getByRole("button", { name: "Color scheme", exact: true })
      .click();
    await page.getByText("Cobalt & rose", { exact: true }).click();
    const art = page.locator("#artwork");
    await art.focus();
    await page.keyboard.press("+");
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(
        async () =>
          JSON.parse(
            (await page.locator(".plot-wrap").getAttribute("data-family"))!,
          ).camera,
      )
      .toEqual({ x: 20, y: 0, zoom: 1.1 });
    if (allConstruction) {
      await page.getByLabel("Family members", { exact: true }).fill("4");
      await page
        .getByRole("spinbutton", { name: "Construction lines", exact: true })
        .fill("4");
      await settled(page);
      await page
        .getByRole("checkbox", {
          name: "Construction lines for all members",
          exact: true,
        })
        .check();
      await page
        .getByRole("checkbox", { name: "Construction lines", exact: true })
        .check();
      await page
        .getByRole("checkbox", { name: "Incident rays", exact: true })
        .check();
    }
    await familyAnimation(page);
    await page.getByLabel("Animate", { exact: true }).selectOption(mode);
    if (allConstruction)
      await page.getByLabel("Window members", { exact: true }).fill("2");
    if (repeat === "back-and-forth") {
      await page.getByLabel("Repeat", { exact: true }).selectOption(repeat);
      await page.getByLabel("Duration (seconds)", { exact: true }).fill("0.4");
    }
    await page
      .getByLabel("Animation camera", { exact: true })
      .selectOption("current");
    await openExportSettings(page);
    await page.getByLabel("Export resolution", { exact: true }).fill("1");
    await page.getByLabel("Export quality", { exact: true }).fill("80");
    await page
      .getByLabel("Export frame rate", { exact: true })
      .selectOption("15");
    await pauseFamily(page);
    const slider = page.getByRole("slider", {
      name: "Animation progress",
      exact: true,
    });
    const refs = [];
    const liveSVGs: string[] = [];
    for (const time of repeat === "once" ? [0, 1] : [0, 0.5, 0.833]) {
      await slider.fill(String(time));
      await expect(art).toHaveAttribute("data-animation-time", String(time));
      if (repeat === "back-and-forth")
        await expect(art.locator("[data-family-member]")).toHaveCount(
          time === 0 ? 1 : time === 0.5 ? 16 : 7,
        );
      liveSVGs.push(
        await art.evaluate((svg) => new XMLSerializer().serializeToString(svg)),
      );
      refs.push(
        await art.evaluate(async (svg) => {
          const copy = svg.cloneNode(true) as SVGSVGElement;
          const url = URL.createObjectURL(
            new Blob([new XMLSerializer().serializeToString(copy)], {
              type: "image/svg+xml",
            }),
          );
          try {
            const image = new Image();
            image.src = url;
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = 1000;
            canvas.height = 760;
            const ctx = canvas.getContext("2d")!;
            ctx.drawImage(image, 0, 0, 1000, 760);
            return Array.from(ctx.getImageData(0, 0, 1000, 760).data);
          } finally {
            URL.revokeObjectURL(url);
          }
        }),
      );
    }
    await page
      .getByRole("button", {
        name: repeat === "once" ? "Back to study" : "Stop",
        exact: true,
      })
      .click();
    await page.getByLabel("Duration (seconds)", { exact: true }).fill("0.4");
    await page.evaluate(() => {
      (window as any).recordExportSVG = true;
    });
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export MP4 video", exact: false })
      .click();
    const saved = await download,
      path = (await saved.path())!;
    expect(saved.suggestedFilename()).toContain(`family-${mode}`);
    const exportedSVGs = await page.evaluate(
      () => (window as any).exportSVGs as string[],
    );
    expect(exportedSVGs).toHaveLength(6);
    const indices = repeat === "once" ? [0, 5] : [0, 3, 5];
    const comparison = await page.evaluate(
      ({ exportedSVGs, liveSVGs, indices }) => {
        const lines = (text: string) =>
          [
            ...new DOMParser()
              .parseFromString(text, "image/svg+xml")
              .querySelectorAll("line"),
          ].map((n) =>
            ["x1", "y1", "x2", "y2", "stroke", "opacity"].map((a) =>
              n.getAttribute(a),
            ),
          );
        return indices.map((index, k) => {
          const actual = lines(exportedSVGs[index]),
            expected = lines(liveSVGs[k]);
          const mismatch = actual.findIndex(
            (line, j) => JSON.stringify(line) !== JSON.stringify(expected[j]),
          );
          return {
            index,
            actual: actual.length,
            expected: expected.length,
            mismatch,
            got: actual[mismatch],
            want: expected[mismatch],
          };
        });
      },
      { exportedSVGs, liveSVGs, indices },
    );
    for (const frame of comparison) {
      expect(frame.actual).toBe(frame.expected);
      expect(frame.mismatch).toBe(-1);
      if (allConstruction) expect(frame.actual).toBe(16);
    }
    const probed = videoProbe(path);
    expect(probed).not.toBeNull();
    expect(probed!.frames).toBe(6);
    expect(probed!.durations.reduce((a, b) => a + b, 0)).toBe(400);
    expect([probed!.width, probed!.height]).toEqual([1000, 760]);
    for (const [i, reference] of (repeat === "once"
      ? [
          [0, refs[0]],
          [5, refs[1]],
        ]
      : [
          [0, refs[0]],
          [3, refs[1]],
          [5, refs[2]],
        ]) as [number, number[]][]) {
      const diff = frameDifference(path, 1000, 760, i, reference);
      expect(diff).not.toBeNull();
      expect(diff!.meanDifference).toBeLessThan(2);
      expect(diff!.unmatchedInk).toBeLessThan(0.08);
    }
    const decoded = await decodeVideo(page, await readFile(path));
    expect(decoded.duration).toBeCloseTo(0.4, 3);
    expect(decoded.first.hash).not.toBe(decoded.last.hash);
    await expect(page.locator("#artwork [data-family-member]")).toHaveCount(
      allConstruction ? 4 : 16,
    );
  });

test("planar thumbnail fingerprints include authored layer visibility", async ({
  page,
}) => {
  const p = presets.find((p) => p.title === "A lamp's lace")!;
  let hash = 0x811c9dc5;
  for (const c of JSON.stringify({
    config: p.config,
    family: p.family,
    layers: p.layers,
  }))
    hash = Math.imul(hash ^ c.codePointAt(0)!, 0x01000193) >>> 0;
  await page.goto("/");
  await examplesButton(page).click();
  await expect(
    gallery(page).getByRole("button", { name: "A lamp's lace", exact: true }),
  ).toHaveAttribute("data-fingerprint", hash.toString(16).padStart(8, "0"));
});

test("finite engraving edits and cancellation discard obsolete shared movie and playback sessions", async ({
  page,
}) => {
  const downloads: string[] = [];
  page.on("download", (d) => downloads.push(d.suggestedFilename()));
  await page.goto("/");
  await choosePreset(page, { label: "A lamp's lace" });
  await settled(page);
  await familyAnimation(page);
  await openExportSettings(page);
  await page.getByLabel("Export resolution", { exact: true }).fill("0.5");
  await page.getByLabel("Duration (seconds)", { exact: true }).fill("10");
  const save = page.getByRole("button", {
    name: "Export MP4 video",
    exact: false,
  });
  await save.click();
  await page
    .getByRole("button", { name: "Cancel export", exact: true })
    .click();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(
    page.getByRole("button", { name: "Cancel export", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("checkbox", {
      name: "Construction lines for all members",
      exact: true,
    })
    .check();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(
    page.getByRole("button", { name: "Cancel export", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Family members", { exact: true }).fill("8");
  await settled(page);
  await expect(save).toBeEnabled();
  await expect(page.locator("#artwork [data-family-member]")).toHaveCount(8);
  await expect(
    page.getByRole("button", { name: "Play animation", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByLabel("Family from", { exact: true }).fill("pi");
  await page.getByLabel("Family to", { exact: true }).focus();
  await settled(page);
  await expect(
    page.getByRole("slider", { name: "Animation progress", exact: true }),
  ).toHaveCount(0);
  await page.waitForTimeout(100);
  await expect(page.locator("#artwork")).not.toHaveAttribute(
    "data-animation-time",
  );
  await pauseFamily(page);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.waitForTimeout(150);
  expect(downloads).toEqual([]);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("finite engraving all-member construction applies to visible slots and retires stale sessions without resampling", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => {
    (window as any).familyComputes = 0;
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (data: any, options?: any) {
      if (data.action === "compute") (window as any).familyComputes++;
      post.call(this, data, options);
    };
  });
  await page.goto("/");
  await choosePreset(page, { label: "A lamp's lace" });
  await settled(page);
  const scope = page.getByRole("checkbox", {
    name: "Construction lines for all members",
    exact: true,
  });
  await expect(scope).toBeVisible();
  await expect(scope).not.toBeChecked();
  const requests = await page.evaluate(() => (window as any).familyComputes);
  const members = page.locator("#artwork [data-family-member]");
  const ink = () =>
    members.evaluateAll((ns) =>
      ns.map((n) => ({
        id: Number(n.getAttribute("data-family-member")),
        lines: n.querySelectorAll("line").length,
      })),
    );
  await page
    .getByRole("checkbox", { name: "Incident rays", exact: true })
    .check();
  await expect
    .poll(ink)
    .toEqual(
      Array.from({ length: 16 }, (_, id) => ({ id, lines: id === 4 ? 24 : 0 })),
    );
  await scope.check();
  await expect
    .poll(ink)
    .toEqual(Array.from({ length: 16 }, (_, id) => ({ id, lines: 24 })));
  // All-member scope does not turn on outgoing/virtual layers implicitly.
  await expect(
    page.getByRole("checkbox", { name: "Construction lines", exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Virtual extensions", exact: true }),
  ).not.toBeChecked();
  expect(((await copiedStudy(page)).study as any).family.allConstruction).toBe(
    true,
  );
  await familyAnimation(page);
  await page.getByLabel("Animate", { exact: true }).selectOption("window");
  await page.getByLabel("Window members", { exact: true }).fill("3");
  await pauseFamily(page);
  const slider = page.getByRole("slider", {
    name: "Animation progress",
    exact: true,
  });
  await slider.fill("1");
  await expect.poll(ink).toEqual([
    { id: 13, lines: 24 },
    { id: 14, lines: 24 },
    { id: 15, lines: 24 },
  ]);
  const download = page.waitForEvent("download");
  await exportImage(page, "SVG");
  const svg = await readFile((await (await download).path())!, "utf8");
  expect(
    JSON.parse(/<desc>(.*?)<\/desc>/s.exec(svg)![1]).family.allConstruction,
  ).toBe(true);
  expect(
    [...svg.matchAll(/data-family-member="(\d+)"/g)].map((m) => +m[1]),
  ).toEqual([13, 14, 15]);
  expect((svg.match(/<line /g) ?? []).length).toBe(72);
  await scope.uncheck();
  await expect(slider).toHaveCount(0);
  await expect
    .poll(ink)
    .toEqual(
      Array.from({ length: 16 }, (_, id) => ({ id, lines: id === 4 ? 24 : 0 })),
    );
  await pauseFamily(page);
  await slider.fill("1");
  await expect.poll(ink).toEqual([
    { id: 13, lines: 0 },
    { id: 14, lines: 0 },
    { id: 15, lines: 0 },
  ]);
  expect(await page.evaluate(() => (window as any).familyComputes)).toBe(
    requests,
  );
});

test("finite engraving all-member construction also applies to pedal constructions", async ({
  page,
}) => {
  await page.goto("/");
  await choosePreset(page, { label: "Ellipse & its pedal" });
  await settled(page);
  await page.getByLabel("Finite engraving", { exact: true }).check();
  await page.getByLabel("Family members", { exact: true }).fill("3");
  await settled(page);
  const members = page.locator("#artwork [data-family-member]");
  await expect(members).toHaveCount(3);
  const counts = () =>
    members.evaluateAll((ns) =>
      ns.map((n) => n.querySelectorAll("line").length),
    );
  await expect
    .poll(async () => (await counts()).map((n) => n > 0))
    .toEqual([true, false, false]);
  await page
    .getByRole("checkbox", {
      name: "Construction lines for all members",
      exact: true,
    })
    .check();
  await expect
    .poll(async () => (await counts()).map((n) => n > 0))
    .toEqual([true, true, true]);
});

test("atlas point light applicability follows consumed Cartesian coordinates and preserves other pairs", async () => {
  const { atlasPairs, atlasPair } = await import("../web/atlas");
  const c = structuredClone(presets[0].config);
  for (const format of [
    "parametric",
    "cartesian",
    "polar",
    "roulette",
    "lissajous",
    "fourier",
    "field",
    "pursuit",
    "implicit",
    "attractor",
  ] as const)
    for (const kind of [
      "evolute",
      "catacaustic",
      "diacaustic",
      "pedal",
      "inversion",
    ] as const)
      for (const input of ["curve", "pedal", "offset"] as const)
        for (const source of ["cartesian", "polar", "parallel"] as const) {
          c.curve.format = format;
          c.kind = kind;
          c.input = input;
          c.source.kind = source === "parallel" ? "parallel" : "point";
          c.source.coordinates = source === "polar" ? "polar" : "cartesian";
          const expected =
            !["implicit", "attractor"].includes(format) &&
            ["catacaustic", "diacaustic"].includes(kind) &&
            source === "cartesian";
          expect(
            atlasPairs(c).some((p) => p.id === "light"),
            JSON.stringify({ format, kind, input, source }),
          ).toBe(expected);
        }
  c.curve.format = "roulette";
  c.kind = "diacaustic";
  c.input = "pedal";
  c.source.kind = "point";
  delete c.source.coordinates; // old Cartesian studies omit this optional field
  expect(atlasPairs(c).map((p) => p.id)).toEqual(["roulette", "pole", "light"]);
  expect(atlasPair("light").axes.map((a) => a.path)).toEqual([
    ["source", "position", "x"],
    ["source", "position", "y"],
  ]);
  expect(atlasPair("dejong").axes.map((a) => a.path)).toEqual([
    ["curve", "attractor", "a"],
    ["curve", "attractor", "b"],
  ]);
});

test("atlas new pairs use clean scale-aware ranges, exact centers and unchanged literal work limits", async () => {
  const { atlasDefaults, atlasBudget, ParameterAtlas } =
    await import("../web/atlas");
  const { presetStudy } = await import("../web/planar-link");
  for (const [pair, title] of [
    ["light", "Light inside a circle"],
    ["dejong", "De Jong attractor"],
  ] as const) {
    const study = presetStudy(presets.findIndex((p) => p.title === title));
    for (const values of [
      [1.15, -0.2],
      [1e-17, -1e-17],
      [1.234567890123456, -0.2],
      [999, -999],
    ]) {
      const target =
        pair === "light"
          ? study.config.source.position
          : study.config.curve.attractor;
      const [x, y] = pair === "light" ? ["x", "y"] : ["a", "b"];
      target[x] = values[0];
      target[y] = values[1];
      const frozen = structuredClone(study);
      const ranges = atlasDefaults(study.config, pair);
      if (values[0] === 1.15)
        expect(ranges).toEqual(
          pair === "light"
            ? { x: [0.15, 2.15], y: [-1.2, 0.8] }
            : { a: [0.8625, 1.4375], b: [-0.45, 0.05] },
        );
      for (const size of [3, 5] as const) {
        const atlas = new ParameterAtlas(
          { compute: () => new Promise(() => {}) },
          () => {},
        );
        atlas.generate(study, ranges, { pair, size });
        expect(atlas.state.error).toBeUndefined();
        expect(atlas.state.cells[(size * size - 1) / 2].values).toEqual(values);
        expect(atlas.state.cells[0].values).toEqual([
          ranges[x][0],
          ranges[y][0],
        ]);
        expect(atlas.state.cells.at(-1)!.values).toEqual([
          ranges[x][1],
          ranges[y][1],
        ]);
        atlas.cancel();
      }
      expect(study).toEqual(frozen);
    }
    if (pair === "light") {
      Object.assign(study.config, {
        samples: 8000,
        lines: 256,
        adaptive: false,
      });
      expect(atlasBudget(study.config, 3).error).toBeUndefined();
      expect(atlasBudget(study.config, 5).error).toBeUndefined();
      expect(atlasBudget({ ...study.config, samples: 8001 }, 3).error).toMatch(
        /limit/,
      );
      expect(atlasBudget({ ...study.config, lines: 257 }, 5).error).toMatch(
        /limit/,
      );
    } else {
      Object.assign(study.config.curve.attractor, {
        iterates: 5000000,
        discard: 1000000,
        cells: 1024,
        fit: true,
      });
      const b = atlasBudget(study.config, 5);
      expect(b).toMatchObject({
        iterations: 13525000,
        density: 1458176,
        error: undefined,
      });
      study.config.curve.attractor.iterates = 9000000;
      expect(atlasBudget(study.config, 5).error).toMatch(/limit/);
      study.config.curve.attractor.iterates = 5000000;
      study.config.curve.attractor.cells = 1300;
      expect(atlasBudget(study.config, 5).error).toMatch(/5 × 5/);
      expect(atlasBudget(study.config, 3).error).toBeUndefined();
    }
  }
});

for (const [pair, title] of [
  ["light", "Light inside a circle"],
  ["dejong", "De Jong attractor"],
] as const)
  for (const size of [3, 5] as const)
    test(`atlas independent ${pair} ${size} preview and inspection equal ordinary requests`, async ({
      page,
    }, info) => {
      const { presetStudy } = await import("../web/planar-link");
      const source = presetStudy(presets.findIndex((p) => p.title === title));
      source.config.samples = 4000;
      source.config.lines = 144;
      source.config.curve.a = 7.25;
      Object.assign(source.config.curve.attractor, {
        iterates: 120000,
        discard: 2500,
        cells: 512,
      });
      await observeAtlasWorkers(page);
      await page.goto(
        `/#s=${deflateRawSync(JSON.stringify({ v: 1, notebook: "2d", study: source })).toString("base64url")}`,
      );
      await settled(page);
      const atlas = await openAtlas(page);
      await expect(
        atlas.getByLabel("Parameter pair", { exact: true }),
      ).toHaveValue(pair);
      await atlas
        .getByLabel("Grid size", { exact: true })
        .selectOption(String(size));
      const labels =
        pair === "light"
          ? ["Source x", "Source y"]
          : ["Coefficient a", "Coefficient b"];
      const ranges =
        pair === "light"
          ? [
              [0, 2],
              [-1, 1],
            ]
          : [
              [1, 2],
              [-3, -2],
            ];
      for (let i = 0; i < 2; i++) {
        // Keep intermediate endpoints increasing.
        await atlas
          .getByLabel(`${labels[i]} from`, { exact: true })
          .fill(String(ranges[i][0]));
        await atlas
          .getByLabel(`${labels[i]} to`, { exact: true })
          .fill(String(ranges[i][1]));
      }
      await atlas
        .getByRole("button", { name: "Generate atlas", exact: true })
        .click();
      await expect(
        atlas.locator('.atlas-cell[data-state="valid"]'),
      ).toHaveCount(size * size);
      await expect(atlas.locator(".atlas-quality")).toContainText(
        pair === "light"
          ? `${size === 3 ? "2,000" : "1,000"} samples`
          : "50,000 accumulated iterates, 1,000 discarded",
      );
      await expect(atlas.getByText(/^Original quality:/)).toContainText(
        pair === "light"
          ? "4,000 samples"
          : "120,000 accumulated iterates, 2,500 discarded",
      );
      const compare = async (full: boolean) =>
        page.evaluate(
          async ({ source, pair, size, ranges, full }) => {
            const grid = (window as any).atlasWorkers[1];
            const requests = full
              ? [grid.requests.at(-1)]
              : grid.requests.slice(-size * size);
            const ordinary = new Worker(grid.url);
            const outcomes = [];
            // Study-link conformance may reorder fields; compare every value.
            const canonical = (v: any): any =>
              Array.isArray(v)
                ? v.map(canonical)
                : v && typeof v === "object"
                  ? Object.fromEntries(
                      Object.keys(v)
                        .sort()
                        .map((k) => [k, canonical(v[k])]),
                    )
                  : v;
            for (let i = 0; i < requests.length; i++) {
              // Assemble from the independent frozen source and known entered grid,
              // never from the request being checked or an atlas config helper.
              const config = structuredClone(source.config);
              const index = full ? 0 : i;
              const x =
                ranges[0][0] +
                ((ranges[0][1] - ranges[0][0]) * (index % size)) / (size - 1);
              const y =
                ranges[1][0] +
                ((ranges[1][1] - ranges[1][0]) * Math.floor(index / size)) /
                  (size - 1);
              if (pair === "light") config.source.position = { x, y };
              else Object.assign(config.curve.attractor, { a: x, b: y });
              if (!full) {
                config.lines = size === 3 ? 128 : 64;
                if (pair === "light") {
                  config.samples = size === 3 ? 2000 : 1000;
                  // No refinement requested in the source: absent flags stay absent.
                } else
                  Object.assign(config.curve.attractor, {
                    iterates: 50000,
                    discard: 1000,
                    cells: 128,
                  });
              }
              const expected: any = await new Promise((resolve) => {
                ordinary.onmessage = (e) => resolve(e.data);
                ordinary.postMessage({
                  id: 10000 + i,
                  action: "compute",
                  config,
                  bounds: source.bounds,
                  base: location.origin + "/",
                });
              });
              const actual = grid.replies.find(
                (r: any) => r.data.id === requests[i].data.id,
              ).data;
              const density = actual.result?.attractor;
              outcomes.push({
                same:
                  JSON.stringify(expected.result) ===
                    JSON.stringify(actual.result) &&
                  JSON.stringify(canonical(expected.config)) ===
                    JSON.stringify(canonical(actual.config)),
                resultSame:
                  JSON.stringify(expected.result) ===
                  JSON.stringify(actual.result),
                error: expected.error,
                nonempty:
                  pair === "light"
                    ? actual.result.derived.filter(Boolean).length > 900
                    : density.accumulated === (full ? 120000 : 50000) &&
                      density.counts.some((n: number) => n > 0),
                conserved:
                  !density ||
                  density.counts.reduce((a: number, b: number) => a + b, 0) +
                    density.outside ===
                    density.accumulated,
                milliseconds: grid.replies.find(
                  (r: any) => r.data.id === requests[i].data.id,
                ).took,
              });
            }
            ordinary.terminate();
            return { outcomes, maximum: grid.maximum };
          },
          { source, pair, size, ranges, full },
        );
      const previews = await compare(false);
      for (const outcome of previews.outcomes)
        expect(outcome, JSON.stringify(outcome)).toMatchObject({
          same: true,
          nonempty: true,
          conserved: true,
        });
      expect(previews.maximum).toBe(1);
      await atlas.getByLabel("Framing", { exact: true }).selectOption("shared");
      await expect(
        atlas.getByText("Shared framing", { exact: true }),
      ).toBeVisible();
      await atlas.screenshot({
        path: info.outputPath(`${pair}-${size}-grid.png`),
      });
      await atlas
        .getByRole("button", { name: "Inspect row 1, column 1", exact: true })
        .click();
      await expect(
        atlas.getByRole("button", { name: "Adopt variant", exact: true }),
      ).toBeEnabled();
      const inspection = await compare(true);
      expect(inspection.outcomes[0]).toMatchObject({
        same: true,
        nonempty: true,
        conserved: true,
      });
      await atlas.screenshot({
        path: info.outputPath(`${pair}-${size}-inspection.png`),
      });
      await info.attach("independent-atlas-observations", {
        body: JSON.stringify({ previews, inspection }, null, 2),
        contentType: "application/json",
      });
    });

for (const [pair, title] of [
  ["light", "Light inside a circle"],
  ["dejong", "De Jong attractor"],
] as const)
  test(`atlas ${pair} cancel and adoption preserve edited study through playback links and real still exports`, async ({
    page,
  }) => {
    const { presetStudy } = await import("../web/planar-link");
    const source = presetStudy(presets.findIndex((p) => p.title === title));
    source.camera = { x: 31, y: -19, zoom: 1.4 };
    source.weight = "bold";
    source.layers.lines = false;
    source.layers.axes = true;
    source.probe = {
      enabled: pair === "light",
      between: true,
      position: 0.417,
    };
    source.animation = { ...source.animation, duration: 10, camera: "current" };
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(
      `/#s=${deflateRawSync(JSON.stringify({ v: 1, notebook: "2d", study: source })).toString("base64url")}`,
    );
    await settled(page);
    const raw = page.getByLabel(
      pair === "light" ? "Shape parameter a" : "Coefficient c",
      { exact: true },
    );
    const text = pair === "light" ? "2+1" : "2+0.4";
    await raw.fill(text);
    await settled(page);
    const before = (await copiedStudy(page)).study;
    let atlas = await openAtlas(page);
    await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(
      9,
    );
    await atlas
      .getByRole("button", { name: "Inspect row 1, column 1", exact: true })
      .click();
    await expect(
      atlas.getByRole("button", { name: "Adopt variant", exact: true }),
    ).toBeEnabled();
    await page.keyboard.press("Escape");
    expect((await copiedStudy(page)).study).toEqual(before);
    await expect(raw).toHaveValue(text);
    atlas = await openAtlas(page);
    await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(
      9,
    );
    await atlas
      .getByRole("button", { name: "Inspect row 1, column 1", exact: true })
      .click();
    await expect(
      atlas.getByRole("button", { name: "Adopt variant", exact: true }),
    ).toBeEnabled();
    const drawing = await atlas.locator("#atlas-inspected").evaluate((e) => ({
      paths: [...e.querySelectorAll("path")].map((p) => p.getAttribute("d")),
      image: e.querySelector("image")?.getAttribute("href"),
    }));
    await atlas
      .getByRole("button", { name: "Adopt variant", exact: true })
      .click();
    await expect(page.locator(".plot-heading .eyebrow")).toHaveText(
      "YOUR OWN EXPLORATION",
    );
    await settled(page);
    const expected = structuredClone(before);
    if (pair === "light") expected.config.source.position = { x: 0, y: -1 };
    else Object.assign(expected.config.curve.attractor, { a: 1.05, b: -2.875 });
    const adopted = await copiedStudy(page);
    expect(adopted.study).toEqual(expected);
    await expect(raw).toHaveValue(text);
    expect(
      await page.locator("#artwork").evaluate((e) => ({
        paths: [...e.querySelectorAll("path")].map((p) => p.getAttribute("d")),
        image: e.querySelector("image")?.getAttribute("href"),
      })),
    ).toEqual(drawing);
    const download = page.waitForEvent("download");
    await exportImage(page, "SVG");
    const svg = await readFile((await (await download).path())!, "utf8");
    expect(svg).not.toMatch(/<text\b/);
    const metadata = JSON.parse(
      svg
        .match(/<desc>(.*?)<\/desc>/s)![1]
        .replaceAll("&quot;", '"')
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&amp;", "&"),
    );
    expect(metadata.source).toEqual(expected.config.source);
    expect(metadata.curve.attractor).toEqual(expected.config.curve.attractor);
    if (pair === "dejong") expect(svg).toContain(drawing.image!);
    const pngDownload = page.waitForEvent("download");
    await exportImage(page, "PNG");
    const png = decodePng(await readFile((await (await pngDownload).path())!));
    expect(png.width).toBeGreaterThanOrEqual(1000);
    const colors = new Set<string>();
    for (let i = 0; i < png.rgba.length; i += 4)
      colors.add(`${png.rgba[i]},${png.rgba[i + 1]},${png.rgba[i + 2]}`);
    expect(colors.size).toBeGreaterThan(100);
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(
      page.getByRole("slider", { name: "Animation progress", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: /^(Stop|Back to study)$/ }).click();
    await settled(page);
    expect((await copiedStudy(page)).study).toEqual(expected);
    await page.goto(adopted.url);
    await settled(page);
    expect((await copiedStudy(page)).study).toEqual(expected);
  });

for (const [pair, title, label, ranges] of [
  ["dejong", "De Jong attractor", "Coefficient a", [999, 1001]],
] as const)
  test(`atlas ${pair} ordinary validation exposes unavailable cells without clamping`, async ({
    page,
  }) => {
    await page.goto("/");
    await choosePreset(page, { label: title });
    const atlas = await openAtlas(page);
    await atlas
      .getByLabel(`${label} to`, { exact: true })
      .fill(String(ranges[1]));
    await atlas
      .getByLabel(`${label} from`, { exact: true })
      .fill(String(ranges[0]));
    await atlas
      .getByRole("button", { name: "Generate atlas", exact: true })
      .click();
    await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(
      6,
    );
    await expect(
      atlas.locator('.atlas-cell[data-state="invalid"]'),
    ).toHaveCount(3);
    await expect(
      atlas.locator('.atlas-cell[data-state="invalid"]').first(),
    ).toContainText(pair === "light" ? "100000" : "1000");
    for (const row of [1, 2, 3])
      await expect(
        atlas.getByRole("button", {
          name: `Inspect row ${row}, column 3`,
          exact: true,
        }),
      ).toBeDisabled();
    await atlas
      .getByRole("button", { name: "Inspect row 2, column 1", exact: true })
      .click();
    await expect(
      atlas.getByRole("button", { name: "Adopt variant", exact: true }),
    ).toBeEnabled();
  });

test("atlas point source coordinate and map transitions admit only the current active pair", async ({
  page,
}) => {
  await page.goto("/");
  await choosePreset(page, { label: "Light inside a circle" });
  const entry = page.getByRole("button", {
    name: "Explore parameter atlas",
    exact: true,
  });
  await expect(entry).toBeEnabled();
  await page
    .getByLabel("Source coordinates", { exact: true })
    .selectOption("polar");
  await settled(page);
  await expect(entry).toBeDisabled();
  await page
    .getByLabel("Source coordinates", { exact: true })
    .selectOption("cartesian");
  await settled(page);
  await expect(entry).toBeEnabled();
  await page.getByLabel("Source", { exact: true }).selectOption("parallel");
  await settled(page);
  await expect(entry).toBeDisabled();
  await page.getByLabel("Source", { exact: true }).selectOption("point");
  await settled(page);
  let atlas = await openAtlas(page);
  await expect(atlas.getByLabel("Parameter pair", { exact: true })).toHaveValue(
    "light",
  );
  await page.keyboard.press("Escape");
  await choosePreset(page, { label: "De Jong attractor" });
  atlas = await openAtlas(page);
  await expect(atlas.getByLabel("Parameter pair", { exact: true })).toHaveValue(
    "dejong",
  );
  await page.keyboard.press("Escape");
  await page.getByLabel("Map", { exact: true }).selectOption("henon");
  await settled(page);
  await expect(entry).toBeDisabled();
  await page.getByLabel("Map", { exact: true }).selectOption("clifford");
  await settled(page);
  atlas = await openAtlas(page);
  await expect(atlas.getByLabel("Parameter pair", { exact: true })).toHaveValue(
    "clifford",
  );
  await page.keyboard.press("Escape");
  await page.getByLabel("Map", { exact: true }).selectOption("dejong");
  await settled(page);
  atlas = await openAtlas(page);
  await expect(atlas.getByLabel("Parameter pair", { exact: true })).toHaveValue(
    "dejong",
  );
});

test("atlas new pair range edits and study replacement retire delayed previews and inspection", async ({
  page,
}) => {
  const { presetStudy } = await import("../web/planar-link");
  const source = presetStudy(
    presets.findIndex((p) => p.title === "Hypotrochoid & its evolute"),
  );
  source.config.kind = "catacaustic";
  source.config.input = "pedal";
  await observeAtlasWorkers(page, 150);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(
    `/#s=${deflateRawSync(JSON.stringify({ v: 1, notebook: "2d", study: source })).toString("base64url")}`,
  );
  await settled(page);
  const before = (await copiedStudy(page)).study;
  let atlas = await openAtlas(page);
  await atlas
    .getByLabel("Parameter pair", { exact: true })
    .selectOption("light");
  await atlas.getByLabel("Source x to", { exact: true }).fill("5");
  await atlas.getByLabel("Source x from", { exact: true }).fill("pi/2");
  // Scalar work also shares the busy worker. A pair switch owns new fields.
  await atlas
    .getByLabel("Parameter pair", { exact: true })
    .selectOption("pole");
  await expect(atlas.getByLabel("Pole x from", { exact: true })).toHaveValue(
    "-1",
  );
  await atlas
    .getByLabel("Parameter pair", { exact: true })
    .selectOption("light");
  await expect(atlas.getByLabel("Source x from", { exact: true })).toHaveValue(
    "0",
  );
  await atlas.getByLabel("Grid size", { exact: true }).selectOption("5");
  await atlas
    .getByRole("button", { name: "Generate atlas", exact: true })
    .click();
  await expect(
    atlas.getByRole("button", { name: "Inspect row 1, column 1", exact: true }),
  ).toBeEnabled();
  await atlas
    .getByRole("button", { name: "Inspect row 1, column 1", exact: true })
    .click();
  await expect(
    atlas.getByRole("button", { name: "Adopt variant", exact: true }),
  ).toBeDisabled();
  await atlas.getByRole("tab", { name: "Atlas grid", exact: true }).click();
  await atlas.getByLabel("Source x from", { exact: true }).fill("0.5");
  await expect(atlas.locator(".atlas-cell")).toHaveCount(0);
  await expect(
    atlas.getByRole("tab", { name: "Selected variant", exact: true }),
  ).toBeDisabled();
  await atlas
    .getByRole("button", { name: "Generate atlas", exact: true })
    .click();
  await expect(
    atlas.getByRole("button", { name: "Inspect row 1, column 1", exact: true }),
  ).toBeEnabled();
  await atlas
    .getByRole("button", { name: "Inspect row 1, column 1", exact: true })
    .click();
  const replacement = presetStudy(
    presets.findIndex((p) => p.title === "De Jong attractor"),
  );
  replacement.config.curve.attractor.c = 1.37;
  await page.goto(
    `/#s=${deflateRawSync(JSON.stringify({ v: 1, notebook: "2d", study: replacement })).toString("base64url")}`,
  );
  await expect.poll(() => new URL(page.url()).hash).toBe("");
  await expect(atlas).toBeHidden();
  await settled(page);
  expect((await copiedStudy(page)).study).toEqual(replacement);
  expect(
    await page.evaluate(() => (window as any).atlasWorkers[1].terminated),
  ).toBe(true);
  atlas = await openAtlas(page);
  await expect(atlas.getByLabel("Parameter pair", { exact: true })).toHaveValue(
    "dejong",
  );
  await page.keyboard.press("Escape");
  expect((await copiedStudy(page)).study).toEqual(replacement);
  expect(before.config.kind).toBe("catacaustic");
});

test("atlas largest admitted new interactions retain quality and cancel alongside existing equivalents", async ({
  page,
}, info) => {
  const { presetStudy } = await import("../web/planar-link");
  await observeAtlasWorkers(page);
  const measurements = [];
  for (const pair of ["roulette", "light", "clifford", "dejong"] as const) {
    const density = pair === "clifford" || pair === "dejong";
    const source = presetStudy(
      presets.findIndex(
        (p) =>
          p.title ===
          (density
            ? pair === "clifford"
              ? "Clifford attractor"
              : "De Jong attractor"
            : "Hypotrochoid & its evolute"),
      ),
    );
    if (density)
      Object.assign(source.config.curve.attractor, {
        iterates: 5000000,
        discard: 1000000,
        cells: 1024,
        fit: true,
      });
    else {
      source.config.kind = "catacaustic";
      source.config.samples = 8000;
    }
    source.config.lines = 256;
    await page.goto(
      `/#s=${deflateRawSync(JSON.stringify({ v: 1, notebook: "2d", study: source })).toString("base64url")}`,
    );
    await expect.poll(() => new URL(page.url()).hash).toBe("");
    await settled(page);
    const atlas = await openAtlas(page);
    await atlas
      .getByLabel("Parameter pair", { exact: true })
      .selectOption(pair);
    await atlas.getByLabel("Grid size", { exact: true }).selectOption("5");
    await atlas.getByLabel("Framing", { exact: true }).selectOption("shared");
    const started = await page.evaluate(() => performance.now());
    await atlas
      .getByRole("button", { name: "Generate atlas", exact: true })
      .click();
    await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(
      25,
    );
    const gridShown = await page.evaluate(() => performance.now());
    await atlas
      .getByRole("button", { name: "Inspect row 3, column 3", exact: true })
      .click();
    await expect(
      atlas.getByRole("button", { name: "Adopt variant", exact: true }),
    ).toBeEnabled();
    const inspection = await page.evaluate(() => {
      const grid = (window as any).atlasWorkers.at(-1);
      const full = grid.replies.at(-1);
      return {
        maximum: grid.maximum,
        workerMilliseconds: full.took,
        config: full.data.config,
        density: full.data.result.attractor && {
          accumulated: full.data.result.attractor.accumulated,
          bins: full.data.result.attractor.counts.length,
        },
      };
    });
    expect(inspection.maximum).toBe(1);
    expect(inspection.config.lines).toBe(256);
    if (density) {
      expect(inspection.density.accumulated).toBe(5000000);
      expect(inspection.config.curve.attractor.cells).toBe(1024);
    } else expect(inspection.config.samples).toBe(8000);
    await atlas.getByRole("tab", { name: "Atlas grid", exact: true }).click();
    await atlas
      .getByRole("button", { name: "Inspect row 1, column 1", exact: true })
      .click();
    const cancelObservation = await page.evaluate(() => ({
      time: performance.now(),
      active: (window as any).atlasWorkers.at(-1).active,
    }));
    await atlas
      .getByRole("button", { name: "Cancel atlas", exact: true })
      .click();
    await expect(atlas).toBeHidden();
    const returned = await page.evaluate(() => ({
      time: performance.now(),
      terminated: (window as any).atlasWorkers.at(-1).terminated,
    }));
    expect(returned.terminated).toBe(true);
    measurements.push({
      pair,
      framing: "shared",
      gridMilliseconds: gridShown - started,
      inspectionWorkerMilliseconds: inspection.workerMilliseconds,
      cancelUiMilliseconds: returned.time - cancelObservation.time,
      activeAtCancel: cancelObservation.active,
      maximum: inspection.maximum,
    });
  }
  await info.attach("largest-atlas-interactions", {
    body: JSON.stringify(
      {
        browser: await page.evaluate(() => navigator.userAgent),
        method:
          "Request/transport and visible UI timings via Playwright, not FPS or heap; actual phone pending",
        measurements,
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
});

for (const [title, label] of [
  ["Light inside a circle", "Source x"],
  ["De Jong attractor", "Coefficient a"],
])
  test(`atlas ${title} waits for scalar settlement and keeps raw drafts`, async ({
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
    await choosePreset(page, { label: title });
    const entry = page.getByRole("button", {
      name: "Explore parameter atlas",
      exact: true,
    });
    const field = page.getByLabel(label, { exact: true });
    await field.fill("t");
    await expect(entry).toBeDisabled();
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await field.fill("1+2");
    await expect(entry).toBeDisabled();
    await expect(entry).toBeEnabled();
    const atlas = await openAtlas(page);
    await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(
      9,
    );
    await expect(atlas.locator(".atlas-values").nth(4)).toContainText(
      `${title === "Light inside a circle" ? "x" : "a"} = 3`,
    );
    await page.keyboard.press("Escape");
    await expect(field).toHaveValue("1+2");
  });

for (const [pair, title] of [
  ["light", "Through a parabola"],
  ["dejong", "De Jong attractor"],
] as const)
  test(`atlas shared ${pair} framing waits for all outcomes and reveals one stable grid`, async ({
    page,
  }, info) => {
    const { presetStudy } = await import("../web/planar-link");
    const source = presetStudy(presets.findIndex((p) => p.title === title));
    if (pair === "dejong") source.config.curve.attractor.a = 999; // fifteen valid, ten unavailable at 5×5
    await page.addInitScript(() => {
      localStorage.setItem("tangent-garden.atlas-size", "5");
      const Native = Worker;
      let workers = 0;
      Object.assign(window, { atlasDeliveries: [] });
      window.Worker = class extends Native {
        atlas = workers++ > 0;
        set onmessage(handler: any) {
          super.onmessage = (event: MessageEvent) => {
            if (this.atlas)
              (window as any).atlasDeliveries.push(() =>
                handler?.call(this, event),
              );
            else handler?.call(this, event);
          };
        }
      };
    });
    await page.goto(
      `/#s=${deflateRawSync(JSON.stringify({ v: 1, notebook: "2d", study: source })).toString("base64url")}`,
    );
    await settled(page);
    const atlas = await openAtlas(page);
    await atlas.getByLabel("Framing", { exact: true }).selectOption("shared");
    const release = async () => {
      await expect
        .poll(() => page.evaluate(() => (window as any).atlasDeliveries.length))
        .toBeGreaterThan(0);
      await page.evaluate(() => (window as any).atlasDeliveries.shift()());
    };
    await release();
    await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(
      1,
    );
    await expect(atlas.locator(".atlas-art")).toHaveCount(0);
    await expect(atlas.locator(".atlas-cell").first()).toContainText(
      "Waiting for shared scale",
    );
    // A completed member is inspectable while another numerical request waits.
    await atlas
      .getByRole("button", { name: "Inspect row 1, column 1", exact: true })
      .click();
    await release(); // active second preview
    await release(); // priority full-quality inspection
    await expect(
      atlas.getByRole("button", { name: "Adopt variant", exact: true }),
    ).toBeEnabled();
    await atlas.getByRole("tab", { name: "Atlas grid", exact: true }).click();
    await expect(atlas.locator(".atlas-art")).toHaveCount(0);
    // Independent fits remain progressive; returning to shared hides partial fits.
    await atlas
      .getByLabel("Framing", { exact: true })
      .selectOption("independent");
    await expect(atlas.locator(".atlas-art")).toHaveCount(2);
    await atlas.getByLabel("Framing", { exact: true }).selectOption("shared");
    for (let completed = 2; completed < 25; completed++) {
      await expect(atlas.locator(".atlas-art")).toHaveCount(0);
      await release();
      await expect(
        atlas.locator('.atlas-cell:not([data-state="pending"])'),
      ).toHaveCount(completed + 1);
    }
    const valid = pair === "light" ? 25 : 15;
    await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(
      valid,
    );
    await expect(atlas.locator(".atlas-art")).toHaveCount(valid);
    await expect(
      atlas.getByText("Waiting for shared scale", { exact: true }),
    ).toHaveCount(0);
    await expect(atlas.locator("svg text")).toHaveCount(0);
    const paths = () =>
      atlas
        .locator(".atlas-art")
        .evaluateAll((arts) => arts.map((a) => a.innerHTML));
    const final = await paths();
    await atlas
      .getByRole("button", { name: "Inspect row 1, column 1", exact: true })
      .click();
    await release();
    await expect(
      atlas.getByRole("button", { name: "Adopt variant", exact: true }),
    ).toBeEnabled();
    await atlas.getByRole("tab", { name: "Atlas grid", exact: true }).click();
    expect(await paths()).toEqual(final);
    for (const [width, height] of [
      [390, 844],
      [844, 390],
      [1280, 700],
    ]) {
      await page.setViewportSize({ width, height });
      expect(await atlas.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
        true,
      );
      const scroll = atlas.locator(".atlas-grid-scroll");
      await scroll.scrollIntoViewIfNeeded();
      await scroll.evaluate(
        (e) => (e.scrollLeft = e.scrollWidth - e.clientWidth),
      );
      const last = atlas.getByRole("button", {
        name: `Inspect row 5, column ${pair === "light" ? 5 : 3}`,
        exact: true,
      });
      await last.scrollIntoViewIfNeeded();
      await expect(last).toBeInViewport();
      await last.click();
      await release();
      const adopt = atlas.getByRole("button", {
        name: "Adopt variant",
        exact: true,
      });
      await expect(adopt).toBeEnabled();
      await expect(adopt).toBeInViewport({ ratio: 1 });
      await atlas.getByRole("tab", { name: "Atlas grid", exact: true }).click();
    }
    await atlas.screenshot({
      path: info.outputPath(`${pair}-stable-shared-grid.png`),
    });
    // Regeneration never retains the old generation's completed common frame.
    await atlas
      .getByRole("button", { name: "Generate atlas", exact: true })
      .click();
    await expect(atlas.locator(".atlas-art")).toHaveCount(0);
    await release();
    await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(
      1,
    );
    await expect(atlas.locator(".atlas-art")).toHaveCount(0);
    await page.keyboard.press("Escape");
  });

// Each picture is decorative: its button keeps its name, its geometry stays in
// its box, and its inks are the current scheme's.
async function expectIcons(buttons: Locator, names: (string | RegExp)[]) {
  await expect(buttons).toHaveText(names);
  for (const button of await buttons.all()) {
    const icon = button.locator("svg.icon");
    await expect(icon).toHaveAttribute("aria-hidden", "true");
    const fits = await icon.evaluate((svg) => {
      const box = (svg as unknown as SVGGraphicsElement).getBBox();
      return (
        box.width > 8 &&
        box.height > 6 &&
        box.x >= -0.5 &&
        box.y >= -0.5 &&
        box.x + box.width <= 24.5 &&
        box.y + box.height <= 24.5
      );
    });
    expect(fits, await button.textContent()).toBe(true);
  }
}

test("construction, entry and journey buttons carry scheme-colored pictures", async ({
  page,
}) => {
  await page.goto("/");
  await settled(page);
  await expectIcons(
    page.getByRole("group", { name: "Construction" }).getByRole("button"),
    [
      /evolute/i,
      /involute/i,
      /catacaustic/i,
      /diacaustic/i,
      /pedal/i,
      /offset/i,
      /rolling/i,
      /envelope/i,
      /inversion/i,
    ],
  );
  for (const name of [
    "Explore parameter atlas",
    "Draw a loop",
    "Open complex loom",
  ])
    await expect(
      page.getByRole("button", { name, exact: true }).locator("svg.icon"),
    ).toHaveCount(1);
  const tab = page
    .getByRole("group", { name: "Construction" })
    .getByRole("button", { name: "Catacaustic" });
  const inks = () =>
    tab.evaluate((b) => {
      const s = getComputedStyle(b);
      return {
        base: s.getPropertyValue("--base-ink"),
        drawn: getComputedStyle(b.querySelector("svg.icon .b")!).stroke,
      };
    });
  const before = await inks();
  await page.getByRole("button", { name: /color scheme/i }).click();
  await page.getByRole("menuitemradio").last().click();
  await expect.poll(async () => (await inks()).base).not.toBe(before.base);
  await expect.poll(async () => (await inks()).drawn).not.toBe(before.drawn);
  await page.keyboard.press("Escape");
  await examplesButton(page).click();
  await expectIcons(
    gallery(page)
      .getByRole("group", { name: "Try a guided journey" })
      .getByRole("button"),
    journeyTitles,
  );
});

test("the harmonic fit entry draws a knot and the chain that traces it", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await settled(page);
  const icon = page
    .getByRole("button", { name: "Fit into harmonic terms", exact: true })
    .locator("svg.icon");
  await expect(icon).toHaveAttribute("aria-hidden", "true");
  await expect(icon.locator(".b")).toHaveCount(1);
  await expect(icon.locator(".d")).toHaveCount(1);
  const fits = await icon.evaluate((svg) => {
    const box = (svg as unknown as SVGGraphicsElement).getBBox();
    return (
      box.width > 8 &&
      box.height > 6 &&
      box.x >= -0.5 &&
      box.y >= -0.5 &&
      box.x + box.width <= 24.5 &&
      box.y + box.height <= 24.5
    );
  });
  expect(fits).toBe(true);
  const inks = () =>
    icon.evaluate((svg) => {
      const s = getComputedStyle(svg);
      return [
        s.getPropertyValue("--base-ink"),
        getComputedStyle(svg.querySelector(".b")!).stroke,
      ];
    });
  const before = await inks();
  await page.getByRole("button", { name: /color scheme/i }).click();
  await page.getByRole("menuitemradio").last().click();
  await expect.poll(async () => (await inks())[0]).not.toBe(before[0]);
  await expect.poll(async () => (await inks())[1]).not.toBe(before[1]);
});

for (const notebook of ["3D", "4D"])
  test(`the ${notebook} atlas entry carries the same picture`, async ({
    page,
  }) => {
    await page.goto("/");
    await settled(page);
    await page
      .getByRole("radio", { name: `${notebook} studies`, exact: true })
      .click();
    await expect(
      page
        .getByRole("button", { name: "Explore parameter atlas", exact: true })
        .locator("svg.icon"),
    ).toHaveCount(1);
  });
