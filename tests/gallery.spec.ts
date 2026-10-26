import { test, expect, type Page } from "@playwright/test";
import {
  choosePreset,
  examplesButton,
  chooseNotebook,
  exportImage,
  openExportSettings,
  scriptedKeyboard,
} from "./helpers";

import { readFile } from "node:fs/promises";
import { presets } from "../web/presets";
import { wireStudy } from "./study-link-wire";

const gallery = (page: Page) =>
  page.getByRole("dialog", { name: "Notebook examples" });
const heading = (page: Page) => page.locator(".app:visible .plot-heading");

async function settled(page: Page) {
  await expect(page.locator(".app:visible .plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
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
