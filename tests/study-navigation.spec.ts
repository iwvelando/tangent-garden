import { test, expect, type Page } from "@playwright/test";

const artwork = {
  "2d": "#artwork",
  "3d": "#spatial-artwork",
  "4d": "#tesseract-artwork",
} as const;
const sections = {
  "2d": "#animation-section",
  "3d": "#spatial-animation-section",
  "4d": "#shape-animation-section",
} as const;
const app = (page: Page) => page.locator(".app:visible");
const picker = (page: Page) =>
  app(page).getByRole("radiogroup", { name: "Study dimension" });

// The study dimension is chosen beside the examples it offers, so a reader
// picks a notebook and then an example without crossing the page.
for (const width of [320, 390, 1440]) {
  test(`the study dimension is chosen above the examples at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.locator(artwork["2d"])).toBeVisible();
    await expect(app(page).locator("header [role=radiogroup]")).toHaveCount(0);
    await expect(
      app(page).locator("header").getByText("2D studies"),
    ).toHaveCount(0);
    for (const dimension of ["2d", "3d", "4d"] as const) {
      if (dimension !== "2d") {
        await app(page).getByRole("radio", { name: "2D studies" }).focus();
        for (let i = 0; i < (dimension === "3d" ? 1 : 2); i++)
          await page.keyboard.press("ArrowRight");
        await expect(page.locator(artwork[dimension])).toBeVisible();
        // Focus follows the choice into the newly shown notebook.
        await expect(
          app(page).getByRole("radio", {
            name: `${dimension.toUpperCase()} studies`,
          }),
        ).toBeFocused();
        await app(page).getByRole("radio", { name: "2D studies" }).click();
        await expect(page.locator(artwork["2d"])).toBeVisible();
        await app(page)
          .getByRole("radio", { name: `${dimension.toUpperCase()} studies` })
          .click();
      }
      await expect(page.locator(artwork[dimension])).toBeVisible();
      await expect(
        app(page).getByRole("radio", {
          name: `${dimension.toUpperCase()} studies`,
        }),
      ).toBeChecked();
      await expect(
        picker(page).getByRole("radio", { checked: true }),
      ).toHaveCount(1);
      // Between the study's label and its example card, and as wide as both.
      const label = (await app(page)
        .locator("aside .section-label")
        .first()
        .boundingBox())!;
      const group = (await picker(page).boundingBox())!;
      const card = (await app(page).locator(".example-picker").boundingBox())!;
      expect(group.y).toBeGreaterThan(label.y + label.height);
      expect(group.y + group.height).toBeLessThan(card.y);
      expect(group.x).toBeCloseTo(card.x, 0);
      expect(group.width).toBeCloseTo(card.width, 0);
      // Each choice is a whole segment on one line.
      for (const segment of await picker(page).locator("label").all()) {
        const box = (await segment.boundingBox())!;
        expect(box.height).toBeLessThan(44);
        expect(box.height).toBeGreaterThanOrEqual(32);
      }
    }
    expect(new URL(page.url()).searchParams.get("study")).toBe("4d");
  });
}

// The Animation button sits beside Export image, matching it, and brings the
// animation section into view open, without moving a desktop drawing.
for (const width of [390, 1440]) {
  for (const dimension of ["2d", "3d", "4d"] as const) {
    test(`Animation opens and shows the ${dimension} animation section at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(dimension === "2d" ? "/" : `/?study=${dimension}`);
      const drawing = page.locator(artwork[dimension]);
      await expect(drawing).toBeVisible();
      const header = app(page).locator("header");
      const button = header.getByRole("button", {
        name: "Animation",
        exact: true,
      });
      const exportButton = header.getByRole("button", {
        name: "Export image",
        exact: true,
      });
      await expect(button).toBeEnabled();
      const box = (await button.boundingBox())!;
      const exportBox = (await exportButton.boundingBox())!;
      const share = (await header
        .getByRole("button", { name: /Copy link/ })
        .boundingBox())!;
      // In the action row between Copy link and Export image.
      expect(box.y).toBeCloseTo(exportBox.y, 0);
      expect(box.height).toBeCloseTo(exportBox.height, 0);
      expect(box.x).toBeGreaterThan(share.x + share.width);
      expect(box.x + box.width).toBeLessThan(exportBox.x);
      const fill = (l: typeof button) =>
        l.evaluate((e) => getComputedStyle(e).backgroundColor);
      expect(await fill(button)).toBe(await fill(exportButton));

      // Starting from a closed section, as a returning reader may have left it.
      const section = page.locator(sections[dimension]);
      const summary = section.locator(":scope > summary");
      await summary.click();
      await expect(section).not.toHaveAttribute("open");
      await page.evaluate(() => window.scrollTo(0, 0));
      await app(page)
        .locator("aside")
        .evaluate((e) => e.scrollTo(0, 0));
      const before = (await drawing.boundingBox())!;

      await button.click();
      await expect(section).toHaveAttribute("open");
      await expect(summary).toBeFocused();
      await expect(summary).toBeInViewport({ ratio: 1 });
      // Its controls follow on screen, not just the heading.
      await expect(
        section.locator(":scope > summary + *").first(),
      ).toBeInViewport();
      if (width > 700) {
        expect(await page.evaluate(() => window.scrollY)).toBe(0);
        expect((await drawing.boundingBox())!.y).toBe(before.y);
      } else {
        expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      }
      // The reader's choice to open it is remembered like a summary click.
      await page.reload();
      await expect(page.locator(sections[dimension])).toHaveAttribute("open");
    });
  }
}

// Each radio covers its whole segment, even where the browser's own style
// gives radios a small fixed size (as iOS Safari does), so a focus ring can
// only ever outline the segment.
test("each dimension's radio covers its segment", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(artwork["2d"])).toBeVisible();
  // An author rule as weak as any browser default; the page's policy allows
  // constructed sheets where it refuses inline style.
  await page.evaluate(() => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync("input { width: 16px; height: 16px; }");
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  });
  for (const segment of await picker(page).locator("label").all()) {
    const label = (await segment.boundingBox())!;
    const radio = (await segment.locator("input").boundingBox())!;
    expect(radio).toEqual(label);
  }
});

// A tap or click leaves no focus ring on the notebook it opens, though focus
// moves there; arrow keys show the ring on the segment they choose.
test("the dimension picker rings its choice only for the keyboard", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(artwork["2d"])).toBeVisible();
  const ring = (name: string) =>
    app(page)
      .getByRole("radio", { name })
      .evaluate((input) =>
        [input, input.parentElement!].some(
          (e) => getComputedStyle(e).outlineStyle !== "none",
        ),
      );
  await app(page).getByRole("radio", { name: "3D studies" }).click();
  await expect(page.locator(artwork["3d"])).toBeVisible();
  await expect(
    app(page).getByRole("radio", { name: "3D studies" }),
  ).toBeFocused();
  expect(await ring("3D studies")).toBe(false);
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(artwork["4d"])).toBeVisible();
  await expect(
    app(page).getByRole("radio", { name: "4D studies" }),
  ).toBeFocused();
  expect(await ring("4D studies")).toBe(true);
});
