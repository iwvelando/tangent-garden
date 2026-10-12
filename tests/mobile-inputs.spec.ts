import { test, expect, type Page } from "@playwright/test";
import { choosePreset, examplesButton } from "./helpers";

// Native iOS keyboard zoom isn't reproduced by desktop browser engines.
// Guard its small-text trigger, including the equation/projection overrides.
async function expectReadableInputs(page: Page) {
  const fields = page.locator(
    'input:not([type="range"]):not([type="checkbox"]):not([type="radio"]):visible, select:visible, textarea:visible',
  );
  expect(await fields.count()).toBeGreaterThan(0);
  for (const field of await fields.all()) {
    expect(
      await field.evaluate((e) => parseFloat(getComputedStyle(e).fontSize)),
      await field.evaluate((e) => e.outerHTML.slice(0, 180)),
    ).toBeGreaterThanOrEqual(16);
  }
}

test.describe("touch input typography", () => {
  test.use({ hasTouch: true, isMobile: true });
  for (const width of [390, 844]) {
    test(`inputs avoid the focus-zoom trigger at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 390 });
      for (const path of ["/", "/?study=3d", "/?study=4d"]) {
        await page.goto(path);
        await expect(page.locator(".plot-wrap")).toBeVisible();
        // Include controls tucked into sampling and export disclosures.
        for (const details of await page.locator("aside details").all()) {
          if ((await details.getAttribute("open")) === null)
            await details.locator(":scope > summary").click();
        }
        await expectReadableInputs(page);
        const field = page.locator('aside input[type="text"]:visible').first();
        await field.focus();
        await expectReadableInputs(page);
        await field.blur();
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width);
        // Keep user-controlled zoom available.
        await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
          "content",
          "width=device-width, initial-scale=1.0",
        );
        await examplesButton(page).click();
        await expectReadableInputs(page);
        await page.keyboard.press("Escape");
      }
      await page.goto("/?study=3d");
      await choosePreset(page, { label: "Viviani's curve, from every side" });
      await expect(
        page.getByLabel("View 1 name", { exact: true }),
      ).toBeVisible();
      await expectReadableInputs(page);
    });
  }
});

test("desktop retains compact input typography", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".equation input").first()).toHaveCSS(
    "font-size",
    "12px",
  );
});
