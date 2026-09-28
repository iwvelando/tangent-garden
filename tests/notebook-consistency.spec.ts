import { test, expect } from "@playwright/test";

for (const width of [1440, 390]) {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`notebooks share menus, explanation styles and paper at ${width}px in ${colorScheme}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme });
      let planarStyles: unknown;
      let planarHeader: unknown;
      let planarFrame: unknown;
      for (const spatial of [false, true]) {
        await page.goto(spatial ? "/?study=3d" : "/");
        const button = page.getByRole("button", {
          name: "Export image",
          exact: true,
        });
        await expect(button).toBeEnabled();
        const before = await button.boundingBox();
        await button.click();
        const menu = page.getByRole("menu", { name: "Export image" });
        await expect(menu).toBeVisible();
        expect(await button.boundingBox()).toEqual(before);
        const box = (await menu.boundingBox())!;
        expect(box.y).toBeCloseTo(before!.y + before!.height + 6, 0);
        expect(box.x + box.width).toBeCloseTo(before!.x + before!.width, 0);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        await expect(menu.getByRole("menuitem").first()).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(menu).toHaveCount(0);
        await expect(button).toBeFocused();
        const styles = await page.locator(".app:visible").evaluate((app) => {
          return [
            ".explanation h2",
            ".explanation p",
            ".formula",
            ".bottom-note",
            ".closing",
            ".explanation .section-label",
            ".plot-heading .eyebrow",
            ".plot-heading h1",
            ".plot-heading button",
            ".plot-meta",
            ".plot-meta .legend",
            "aside > .section-label",
          ].map((selector) => {
            const element = app.querySelector(selector);
            if (!element) return selector + " missing";
            const style = getComputedStyle(element);
            return [
              style.fontFamily,
              style.fontSize,
              style.lineHeight,
              style.letterSpacing,
              style.fontWeight,
              style.textTransform,
              style.color,
            ];
          });
        });
        // The frame around the drawing is shared; only the drawing differs.
        const frame = await page.locator(".app:visible").evaluate((app) => {
          const wrap = app.querySelector(".plot-wrap");
          const heading = app.querySelector(".plot-heading");
          const drawing = app.querySelector("#artwork, .spatial-canvas-wrap");
          if (!wrap || !heading || !drawing) return "frame missing";
          const style = getComputedStyle(wrap);
          return {
            border: style.border,
            radius: style.borderRadius,
            headingTop: Math.round(heading.getBoundingClientRect().top),
            drawingHeight: Math.round(drawing.getBoundingClientRect().height),
            wrapLeft: Math.round(wrap.getBoundingClientRect().left),
            wrapRight: Math.round(wrap.getBoundingClientRect().right),
            sidebarFirst: app
              .querySelector("aside")
              ?.firstElementChild?.textContent?.trim(),
            sidebarHeading: !!app.querySelector("aside h1"),
          };
        });
        if (spatial) expect(frame).toEqual(planarFrame);
        else planarFrame = frame;
        await expect(
          page.locator(".app:visible .explanation .section-label"),
        ).toHaveText(spatial ? "BEHIND THE FOLDS" : "BEHIND THE LINES");
        if (spatial) expect(styles).toEqual(planarStyles);
        else planarStyles = styles;
        const header = page.locator(".app:visible header");
        const brand = header.locator(".brand-name");
        const headerShape = {
          text: await header.innerText(),
          height: (await header.boundingBox())!.height,
          brandLines: Math.round(
            (await brand.boundingBox())!.height /
              parseFloat(
                await brand.evaluate((e) => getComputedStyle(e).fontSize),
              ),
          ),
        };
        expect(headerShape.brandLines).toBe(1);
        if (spatial) expect(headerShape).toEqual(planarHeader);
        else planarHeader = headerShape;
        const rgb = colorScheme === "dark" ? [11, 21, 23] : [243, 241, 234];
        await expect(
          page.locator(spatial ? ".spatial-stage" : "article"),
        ).toHaveCSS("background-color", `rgb(${rgb.join(", ")})`);
        if (spatial) {
          const pixel = await page
            .locator("#spatial-artwork")
            .evaluate((c: HTMLCanvasElement) => {
              const gl = c.getContext("webgl")!;
              const bytes = new Uint8Array(4);
              gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
              return Array.from(bytes).slice(0, 3);
            });
          expect(pixel).toEqual(rgb);
        } else {
          await expect(page.locator("#artwork")).toHaveCSS(
            "background-color",
            `rgb(${rgb.join(", ")})`,
          );
        }
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width);
        await page.screenshot({
          path: testInfo.outputPath(`${spatial ? "3d" : "2d"}.png`),
          fullPage: true,
        });
        await page
          .locator(".app:visible .explanation")
          .scrollIntoViewIfNeeded();
        await page.screenshot({
          path: testInfo.outputPath(`${spatial ? "3d" : "2d"}-explanation.png`),
        });
      }
    });
  }
}

test("each 3D example names itself above a shared construction title", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  const presets = page.getByLabel("Start with a notebook example");
  const heading = page.locator(".app:visible .plot-heading");
  await expect(presets.locator("option")).toHaveCount(5);
  const eyebrows = new Set<string>();
  for (const option of await presets.locator("option").all()) {
    await presets.selectOption((await option.getAttribute("value"))!);
    await expect(heading.locator("h1")).toHaveText("A ribbon of tangent lines");
    eyebrows.add(await heading.locator(".eyebrow").innerText());
  }
  expect(eyebrows.size).toBe(5);
  expect(eyebrows).toContain("THREE HARMONICS; THE THREAD PAUSES TWICE");
  await page.getByRole("textbox", { name: "z(t)", exact: true }).fill("t/4");
  await expect(heading.locator(".eyebrow")).toHaveText("YOUR OWN EXPLORATION");
  await expect(
    heading.getByRole("button", { name: "Rotate view" }),
  ).toBeVisible();
  await expect(
    heading.getByRole("button", { name: "Reset view" }),
  ).toBeVisible();
  await expect(page.locator(".app:visible .plot-meta .legend")).toContainText(
    /Base curve.*Tangent developable/,
  );
  await expect(page.locator(".app:visible .plot-meta")).toContainText(
    "Orthographic",
  );
});

test("custom study is an edit status, not a preset action, in both notebooks", async ({
  page,
}) => {
  for (const spatial of [false, true]) {
    await page.goto(spatial ? "/?study=3d" : "/");
    const presets = page.getByLabel("Start with a notebook example");
    await expect(
      presets.locator("option").filter({ hasText: "Custom study" }),
    ).toHaveCount(0);
    if (spatial) await presets.selectOption("3");
    await page
      .getByRole("textbox", { name: spatial ? "z(t)" : "x(t)", exact: true })
      .fill(spatial ? "t/4" : "3*cos(t)");
    const custom = presets.locator("option:checked");
    await expect(custom).toHaveText("Custom study");
    await expect(custom).toBeDisabled();
    await presets.selectOption("0");
    await expect(
      presets.locator("option").filter({ hasText: "Custom study" }),
    ).toHaveCount(0);
  }
});

test("playing on a phone snaps the drawing into view in both notebooks", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const spatial of [false, true]) {
    await page.goto(spatial ? "/?study=3d" : "/");
    const app = page.locator(".app:visible");
    await expect(app.locator(".plot-wrap")).toBeVisible();
    await app
      .locator(spatial ? "#spatial-animation-section" : "#animation-section")
      .locator(":scope > summary")
      .click();
    await app.getByRole("spinbutton", { name: "Duration (seconds)" }).fill("5");
    const play = app.getByRole("button", { name: "Play animation" });
    await play.scrollIntoViewIfNeeded();
    await expect(app.locator(".plot-wrap")).not.toBeInViewport();
    // Measured in the same task as the click: an instant jump has already
    // happened, while a smooth scroll would still be under way.
    const place = () =>
      page.evaluate(() => {
        const visible = (e: HTMLElement) => e.offsetParent !== null;
        const wrap = [
          ...document.querySelectorAll<HTMLElement>(".plot-wrap"),
        ].find(visible)!;
        [...document.querySelectorAll<HTMLButtonElement>("button")]
          .find(
            (b) => visible(b) && /^(Play animation|Resume)$/.test(b.innerText),
          )!
          .click();
        const box = wrap.getBoundingClientRect();
        return box.top >= 0 && box.bottom <= innerHeight;
      });
    expect(await place()).toBe(true);
    await app.getByRole("button", { name: "Pause", exact: true }).click();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(app.locator(".plot-wrap")).not.toBeInViewport();
    expect(await place()).toBe(true);
  }
});

test("every 2D example names itself in its own words", async ({ page }) => {
  await page.goto("/");
  const presets = page.getByLabel("Start with a notebook example");
  const eyebrow = page.locator(".app:visible .plot-heading .eyebrow");
  const lines = new Set<string>();
  const values = await presets
    .locator("option")
    .evaluateAll((o) => o.map((e) => (e as HTMLOptionElement).value));
  for (const value of values) {
    await presets.selectOption(value);
    lines.add(await eyebrow.innerText());
  }
  expect(lines.size).toBe(values.length);
  for (const line of lines) expect(line).not.toMatch(/FROM THE NOTEBOOKS/);
});

// Small phones, a folding phone's cover screen, or enlarged text wrap the
// export button to the start of its row, leaving no room to its left.
for (const width of [280, 320]) {
  test(`the export menu stays on screen when the header wraps at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 700 });
    for (const spatial of [false, true]) {
      await page.goto(spatial ? "/?study=3d" : "/");
      const button = page.getByRole("button", {
        name: "Export image",
        exact: true,
      });
      await expect(button).toBeEnabled();
      await button.click();
      const box = (await page
        .getByRole("menu", { name: "Export image" })
        .boundingBox())!;
      const anchor = (await button.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y).toBeCloseTo(anchor.y + anchor.height + 6, 0);
      for (const item of await page.getByRole("menuitem").all()) {
        const itemBox = (await item.boundingBox())!;
        expect(itemBox.x).toBeGreaterThanOrEqual(0);
        expect(itemBox.x + itemBox.width).toBeLessThanOrEqual(width);
      }
      if (spatial) continue;
      // An export error hangs from the same place and must fit too.
      await page.evaluate(() => {
        HTMLCanvasElement.prototype.toBlob = function (callback) {
          callback(null);
        };
      });
      await page.getByRole("menuitem", { name: /^PNG/ }).click();
      const alert = (await page.getByRole("alert").boundingBox())!;
      expect(alert.x).toBeGreaterThanOrEqual(0);
      expect(alert.x + alert.width).toBeLessThanOrEqual(width);
    }
  });
}
