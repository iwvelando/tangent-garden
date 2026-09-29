import { test, expect, type Page } from "@playwright/test";
import { choosePreset } from "./helpers";

const settle = (page: Page) =>
  expect(page.locator(".tesseract-stage")).toHaveAttribute(
    "aria-busy",
    "false",
  );
const footerLayout = (page: Page) =>
  page.locator(".tesseract-stage .plot-meta").evaluate((footer) => {
    const box = (element: Element) => {
      const r = element.getBoundingClientRect();
      return [r.x + scrollX, r.y + scrollY, r.width, r.height].map(
        (n) => Math.round(n * 10) / 10,
      );
    };
    const hint = footer.querySelector(":scope > span")!;
    const range = document.createRange();
    range.selectNodeContents(hint);
    return {
      footer: box(footer),
      hint: hint.getClientRects().length ? box(hint) : null,
      hintLines: Array.from(range.getClientRects(), (r) =>
        [r.x + scrollX, r.y + scrollY, r.width, r.height].map(
          (n) => Math.round(n * 10) / 10,
        ),
      ),
      sections: Array.from(footer.querySelectorAll("[data-section]"), box),
      readouts: Array.from(
        footer.querySelectorAll(
          ".section-number, .section-level, .section-stroke",
        ),
        box,
      ),
    };
  });

for (const width of [1440, 1100, 390])
  for (const theme of ["light", "dark"] as const)
    for (const preset of ["A sphere in passing", "A ring in passing"])
      test(`section legend and camera help stay fixed through passage: ${preset}, ${width}, ${theme}`, async ({
        page,
      }, testInfo) => {
        await page.setViewportSize({ width, height: 1000 });
        await page.emulateMedia({ colorScheme: theme });
        await page.goto("/?study=4d");
        await settle(page);
        await choosePreset(page, { label: preset });
        await settle(page);
        await page
          .getByRole("button", { name: "Play animation", exact: true })
          .click();
        await page.getByRole("button", { name: "Pause", exact: true }).click();
        const slider = page.getByRole("slider", { name: "Animation progress" });
        await slider.fill("0");
        await settle(page);
        const initial = await footerLayout(page);
        for (const progress of [0.16, 0.5, 0.833, 1]) {
          await slider.fill(String(progress));
          await settle(page);
          expect(await footerLayout(page)).toEqual(initial);
          if (width !== 1100 && [0.16, 0.833].includes(progress))
            await page.locator(".tesseract-stage").screenshot({
              path: testInfo.outputPath(`passage-${progress}.png`),
            });
        }
        await expect(page.locator("#tesseract-artwork text")).toHaveCount(0);
        const overflow = await page
          .locator(".tesseract-legend [data-section]")
          .evaluateAll((entries) =>
            entries.some((entry) => entry.scrollWidth > entry.clientWidth + 1),
          );
        expect(overflow).toBe(false);
      });

test("existing tesseract section legend and camera help retain their wording", async ({
  page,
}) => {
  await page.goto("/?study=4d");
  await settle(page);
  await choosePreset(page, { label: "Section garden" });
  await settle(page);
  expect(
    await page.locator(".tesseract-legend span").allTextContents(),
  ).toEqual(["x", "y", "z", "w"]);
  await expect(page.locator(".tesseract-stage .plot-meta > span")).toHaveText(
    "Orthographic · drag to orbit · shift-drag or two fingers to pan · scroll or pinch to zoom · keys: arrows, + / −, Home",
  );
  await expect(page.locator(".tesseract-diagnostics")).toHaveText(
    "17 of 17 sections intersect the tesseract.",
  );
});

for (const radius of [0.002, 100])
  test(`custom section family keeps scientific and signed readouts fixed: R=${radius}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/?study=4d");
    await settle(page);
    await choosePreset(page, { label: "A sphere in passing" });
    await page
      .getByRole("textbox", { name: "4-ball radius R", exact: true })
      .fill(String(radius));
    await page
      .getByRole("textbox", { name: "Section spread", exact: true })
      .fill(String(4 * radius));
    await page
      .getByRole("spinbutton", { name: "Section count", exact: true })
      .fill("25");
    await settle(page);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const slider = page.getByRole("slider", { name: "Animation progress" });
    await slider.fill("0");
    await settle(page);
    const initial = await footerLayout(page);
    for (const progress of [0.16, 0.5, 0.833, 1]) {
      await slider.fill(String(progress));
      await settle(page);
      expect(await footerLayout(page)).toEqual(initial);
    }
    expect(await page.locator(".tesseract-legend [data-section]").count()).toBe(
      25,
    );
    expect(
      await page
        .locator(".tesseract-legend [data-section]")
        .evaluateAll((entries) =>
          entries.some((e) => e.scrollWidth > e.clientWidth + 1),
        ),
    ).toBe(false);
  });
