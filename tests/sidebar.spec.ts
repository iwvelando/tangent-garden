import { test, expect, type Page } from "@playwright/test";
import { openAnimation, openExportSettings } from "./helpers";

test("explanations are available on demand instead of always visible", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  const aside = page.getByRole("complementary");
  await expect(aside.locator(".hint:visible")).toHaveCount(0);
  await expect(aside.locator("[title]")).toHaveCount(0);

  const shape = page.getByRole("spinbutton", { name: "Shape parameter a" });
  const shapeHelp = page.getByRole("button", {
    name: "About shape parameter a",
  });
  await expect(shapeHelp).toHaveAttribute("aria-expanded", "false");
  await shapeHelp.click();
  await expect(shapeHelp).toHaveAttribute("aria-expanded", "true");
  await expect(shape).toHaveAccessibleDescription(/Expressions without a/);
  await shapeHelp.click();
  await expect(shape).toHaveAccessibleDescription("");

  await page.getByRole("button", { name: "About control modes" }).click();
  await expect(aside.getByText(/Expert mode takes exact/)).toBeVisible();
  await expect(page.getByRole("group", { name: "Controls" })).toBeVisible();

  // Hints that carry live values or orientation stay visible.
  await page.getByRole("button", { name: "diacaustic", exact: true }).click();
  await expect(aside.getByText(/Ratio n₁\/n₂ = /)).toBeVisible();
});

test("animation and its export settings start collapsed with a summary", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  const play = page.getByRole("button", { name: "Play animation" });
  await expect(play).toBeHidden();
  await openAnimation(page);
  await expect(play).toBeVisible();
  const fps = page.getByRole("combobox", { name: "Export frame rate" });
  await expect(fps).toBeHidden();
  const summary = page.locator("#export-settings > summary");
  await expect(summary).toContainText("30 fps · 1000 × 760 · quality 60");
  await summary.click();
  await fps.selectOption("15");
  await expect(summary).toContainText("15 fps");
});

test("the animation section stays open while an animation is active", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await openAnimation(page);
  await page.getByRole("button", { name: "Play animation" }).click();
  const stop = page.getByRole("button", { name: "Stop", exact: true });
  await expect(stop).toBeVisible();
  await page.locator("#animation-section > summary").click();
  await expect(stop).toBeVisible();
  await stop.click();
  await page.locator("#animation-section > summary").click();
  await expect(stop).toBeHidden();
});

// The toggle event that saves a section's state follows the visible change
// asynchronously, so wait for the stored value before leaving the page.
async function saved(page: Page, expected: Record<string, boolean>) {
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("tangent-garden.sections") ?? "{}"),
      ),
    )
    .toMatchObject(expected);
}

test("open sections are remembered between visits", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await openExportSettings(page);
  await page.getByText("Expression reference", { exact: true }).click();
  await saved(page, { expressions: true });
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "Export frame rate" }),
  ).toBeVisible();
  await expect(page.getByText(/Use explicit multiplication/)).toBeVisible();
  await page.locator("#animation-section > summary").click();
  await saved(page, { animation: false });
  await page.reload();
  await expect(page.locator("#animation-section")).not.toHaveAttribute("open");
  // A closed parent keeps the nested choice for the next time it opens.
  await openAnimation(page);
  await expect(
    page.getByRole("combobox", { name: "Export frame rate" }),
  ).toBeVisible();
});

test("sections still open and close when storage is unavailable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error("disabled");
    };
    Storage.prototype.setItem = () => {
      throw new Error("disabled");
    };
  });
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await openExportSettings(page);
  await expect(
    page.getByRole("combobox", { name: "Export frame rate" }),
  ).toBeVisible();
  await page.locator("#animation-section > summary").click();
  await expect(
    page.getByRole("button", { name: "Play animation" }),
  ).toBeHidden();
});

test("playing on a narrow screen brings the drawing into view", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await openAnimation(page);
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill("5");
  const play = page.getByRole("button", { name: "Play animation" });
  await play.scrollIntoViewIfNeeded();
  const plot = page.locator(".plot-wrap");
  await expect(plot).not.toBeInViewport();
  await play.click();
  await expect(plot).toBeInViewport({ ratio: 1 });
  // Scrolling away while paused, then resuming, returns to the drawing.
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(plot).not.toBeInViewport();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(plot).toBeInViewport({ ratio: 1 });
});

test("playing on a wide screen leaves both panes where they are", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await openAnimation(page);
  const aside = page.getByRole("complementary");
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill(".2");
  const play = page.getByRole("button", { name: "Play animation" });
  await play.scrollIntoViewIfNeeded();
  const before = await aside.evaluate((el) => el.scrollTop);
  await play.click();
  await expect(
    page.getByRole("button", { name: "Replay", exact: true }),
  ).toBeVisible();
  expect(await aside.evaluate((el) => el.scrollTop)).toBe(before);
  expect(await page.locator("article").evaluate((el) => el.scrollTop)).toBe(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

for (const [width, height] of [
  [390, 844],
  [375, 667],
]) {
  test(`playback controls dock beside the drawing at ${width} × ${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await expect(page.locator("#artwork")).toBeVisible();
    await openAnimation(page);
    await page
      .getByRole("spinbutton", { name: "Duration (seconds)" })
      .fill("5");
    await page.getByRole("button", { name: "Play animation" }).click();
    const plot = page.locator(".plot-wrap");
    const bar = page.getByRole("group", { name: "Playback" });
    await expect(plot).toBeInViewport({ ratio: 1 });
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const slider = page.getByRole("slider", {
      name: "Animation progress",
      exact: true,
    });
    await expect(slider).toBeInViewport({ ratio: 1 });
    // The docked bar sits below the drawing rather than covering it.
    await expect(plot).toBeInViewport({ ratio: 1 });
    const plotBox = (await plot.boundingBox())!;
    const barBox = (await bar.boundingBox())!;
    expect(barBox.y).toBeGreaterThanOrEqual(plotBox.y + plotBox.height - 1);
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(height + 1);
    const scrolled = await page.evaluate(() => window.scrollY);
    await slider.press("End");
    await expect(slider).toHaveValue("1");
    await expect(page.locator(".plot-wrap .computing")).toHaveCount(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
    await page.getByRole("button", { name: "Reset view", exact: true }).click();
    await expect(bar).not.toHaveCSS("position", "fixed");
  });
}

test("playback controls stay in the sidebar on a wide screen", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await openAnimation(page);
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill("5");
  await page.getByRole("button", { name: "Play animation" }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const bar = page.getByRole("group", { name: "Playback" });
  await expect(bar).not.toHaveCSS("position", "fixed");
  await expect(
    page.getByRole("complementary").getByRole("group", { name: "Playback" }),
  ).toBeVisible();
});
