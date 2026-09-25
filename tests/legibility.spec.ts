import { test, expect, type Page } from "@playwright/test";
import { openExportSettings } from "./helpers";

// Every visible, enabled run of text on the page, with its rendered size and
// its contrast against the nearest opaque background behind it.
async function measure(page: Page) {
  return page.evaluate(() => {
    const channels = (c: string) => c.match(/[\d.]+/g)!.map(Number);
    const luminance = (c: string) => {
      const [r, g, b] = channels(c)
        .slice(0, 3)
        .map((v) => {
          v /= 255;
          return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const background = (el: Element) => {
      for (let n: Element | null = el; n; n = n.parentElement) {
        const c = getComputedStyle(n).backgroundColor;
        const alpha = channels(c)[3] ?? 1;
        if (alpha === 1) return c;
      }
      return getComputedStyle(document.documentElement).backgroundColor;
    };
    const faded = (el: Element) => {
      for (let n: Element | null = el; n; n = n.parentElement)
        if (Number(getComputedStyle(n).opacity) < 1) return true;
      return false;
    };
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    const found = [];
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const el = t.parentElement!;
      const text = t.textContent!.trim();
      // Disabled controls are exempt from contrast requirements.
      if (!text || !el.checkVisibility() || faded(el) || el.closest("svg"))
        continue;
      const style = getComputedStyle(el);
      const fg = luminance(style.color);
      const bg = luminance(background(el));
      found.push({
        text: text.slice(0, 40),
        size: parseFloat(style.fontSize),
        // Uppercase, letter-spaced labels may be slightly smaller.
        caps:
          style.textTransform === "uppercase" ||
          parseFloat(style.letterSpacing) >= 1,
        contrast: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05),
      });
    }
    return found;
  });
}

async function expectLegible(page: Page) {
  const measured = await measure(page);
  expect(measured.length).toBeGreaterThan(40);
  const problems = measured.filter(
    (m) => m.contrast < 4.5 || m.size < (m.caps ? 11 : 12),
  );
  expect(problems).toEqual([]);
}

for (const scheme of ["light", "dark"] as const) {
  for (const [width, height] of [
    [1440, 1000],
    [390, 844],
  ]) {
    test(`all page text is legible in the ${scheme} theme at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/");
      await expect(page.locator("#artwork")).toBeVisible();
      await expectLegible(page);
      await page
        .getByRole("button", { name: "diacaustic", exact: true })
        .click();
      await page
        .getByRole("combobox", { name: "Source coordinates" })
        .selectOption("polar");
      for (const topic of ["control modes", "source coordinates"])
        await page.getByRole("button", { name: `About ${topic}` }).click();
      await page.getByText("How the refractive indices work").click();
      await openExportSettings(page);
      await expectLegible(page);
      await page
        .getByRole("combobox", { name: "Start with a notebook example" })
        .selectOption("2");
      await page.locator(".diagnostics > summary").click();
      await expectLegible(page);
      await page
        .getByRole("textbox", { name: "t from", exact: true })
        .fill("t");
      await expect(page.getByRole("alert")).toBeVisible();
      await expectLegible(page);
    });
  }
}
