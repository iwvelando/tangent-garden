import { test, expect, type Page } from "@playwright/test";
import { choosePreset, examplesButton } from "./helpers";

const gallery = (page: Page) =>
  page.getByRole("dialog", { name: "Notebook examples" });
const heading = (page: Page) => page.locator(".app:visible .plot-heading");

async function settled(page: Page) {
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
}

for (const [path, count] of [
  ["/", 43],
  ["/?study=3d", 15],
] as const)
  test(`the ${path === "/" ? "2D" : "3D"} gallery shows every example with a current thumbnail`, async ({
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
  test(`previous and next step through the ${path === "/" ? "2D" : "3D"} examples`, async ({
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
    // Thumbnails take the theme's paper, not a fixed colour.
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
