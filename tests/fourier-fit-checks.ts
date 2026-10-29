import { expect, type Page } from "@playwright/test";

export const fitDialog = (page: Page) =>
  page.getByRole("dialog", { name: "Your leaf, made of circles" });
export async function openFit(page: Page) {
  await page.getByRole("button", { name: "Draw a loop", exact: true }).click();
  await expect(fitDialog(page)).toBeVisible();
  return fitDialog(page);
}
export async function leafFit(page: Page, count = 8) {
  const dialog = await openFit(page);
  await dialog
    .getByRole("button", { name: "Use example leaf", exact: true })
    .click();
  await dialog
    .getByLabel("Total terms", { exact: true })
    .selectOption(String(count));
  await dialog.getByRole("button", { name: "Close outline" }).click();
  await expect(
    dialog.getByRole("button", { name: "Adopt fitted study" }),
  ).toBeEnabled();
  return dialog;
}

// Keep the entire drawing visible when a phone user scrolls just far enough
// to reach Play. Check both orientations on the same retained fit.
export async function checkFitPlaybackLayout(page: Page) {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/");
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  const dialog = await leafFit(page);
  for (const size of [
    { width: 844, height: 390 },
    { width: 390, height: 844 },
    { width: 568, height: 320 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size);
    const play = dialog.getByRole("button", {
      name: "Play circles",
      exact: true,
    });
    const slider = dialog.getByLabel("Preview position", { exact: true });
    await play.evaluate((button) => button.scrollIntoView({ block: "end" }));
    const art = (await dialog.locator(".fit-art").boundingBox())!;
    const button = (await play.boundingBox())!;
    const range = (await slider.boundingBox())!;
    const terms = (await dialog
      .getByLabel("Total terms", { exact: true })
      .boundingBox())!;
    const heading = (await dialog
      .getByRole("heading", {
        name: "2. Find the shape in circles",
        exact: true,
      })
      .boundingBox())!;
    expect(Math.abs(art.x - terms.x)).toBeLessThan(1);
    expect(Math.abs(art.width - terms.width)).toBeLessThan(1);
    expect(Math.abs(art.x - heading.x)).toBeLessThan(1);
    expect(Math.abs(button.x - art.x)).toBeLessThan(1);
    expect(Math.abs(range.x + range.width - art.x - art.width)).toBeLessThan(1);
    const picture = (await dialog.locator("#fit-artwork").boundingBox())!;
    expect(Math.abs(picture.width - art.width + 2)).toBeLessThan(1);
    expect(Math.abs(picture.height - art.height + 2)).toBeLessThan(1);
    const axes = await dialog.locator("#fit-artwork").evaluate((svg) => {
      const m = (svg as SVGSVGElement).getScreenCTM()!;
      return { x: Math.hypot(m.a, m.b), y: Math.hypot(m.c, m.d) };
    });
    expect(Math.abs(axes.x - axes.y)).toBeLessThan(1e-12);
    expect(
      Math.abs(button.y + button.height / 2 - range.y - range.height / 2),
    ).toBeLessThan(2);
    expect(button.y - art.y - art.height).toBeGreaterThanOrEqual(8);
    expect(button.y - art.y - art.height).toBeLessThanOrEqual(16);
    expect(range.x).toBeGreaterThanOrEqual(button.x + button.width + 8);
    expect(range.width).toBeGreaterThan(100);
    const visible = await dialog.evaluate((e) => {
      const box = e.getBoundingClientRect();
      return {
        top: Math.max(0, box.top + e.clientTop),
        bottom: Math.min(
          innerHeight,
          box.top + e.clientTop + e.clientHeight,
          e.querySelector("footer")!.getBoundingClientRect().top - 8,
        ),
      };
    });
    expect(art.y).toBeGreaterThanOrEqual(visible.top - 1);
    expect(button.y + button.height).toBeLessThanOrEqual(visible.bottom + 1);
    const scroll = await dialog.evaluate((e) => e.scrollTop);
    await play.click();
    const pause = dialog.getByRole("button", {
      name: "Pause circles",
      exact: true,
    });
    await expect(pause).toBeVisible();
    // WebKit rounds the fractional scroll alignment by one pixel when the
    // button is clicked. The drawing must remain fully visible after it.
    expect(
      Math.abs((await dialog.evaluate((e) => e.scrollTop)) - scroll),
    ).toBeLessThanOrEqual(1);
    expect(
      (await dialog.locator(".fit-art").boundingBox())!.y,
    ).toBeGreaterThanOrEqual(visible.top - 1);
    expect((await pause.boundingBox())!.width).toBe(button.width);
    await pause.click();
    await slider.fill("0.5");
    await expect(slider).toHaveValue("0.5");
    await expect(dialog.getByTestId("epicycles")).toBeVisible();
    await dialog
      .getByRole("button", { name: "About Total terms", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Show more", exact: true })
      .click();
    const expanded = (await dialog.locator(".fit-art").boundingBox())!;
    const expandedPlay = (await play.boundingBox())!;
    expect(expandedPlay.y - expanded.y - expanded.height).toBeLessThanOrEqual(
      16,
    );
    await dialog
      .getByRole("button", { name: "About Total terms", exact: true })
      .click();
  }
}

export async function checkFitAdoptionVisibility(page: Page) {
  await page.addInitScript(() =>
    localStorage.setItem("tangent-garden.color-scheme", "forest"),
  );
  await page.goto("/");
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  const dialog = await openFit(page);
  const adopt = dialog.getByRole("button", {
    name: "Adopt fitted study",
    exact: true,
  });
  for (const size of [
    { width: 844, height: 390 },
    { width: 390, height: 844 },
    { width: 568, height: 320 },
    { width: 1440, height: 1000 },
  ]) {
    await page.setViewportSize(size);
    await dialog.evaluate((e) => (e.scrollTop = 0));
    await expect(adopt).toBeDisabled();
    await expect(adopt).toBeInViewport({ ratio: 1 });
    await expect(
      dialog.getByText("Replaces your current study.", { exact: true }),
    ).toBeInViewport({ ratio: 1 });
  }
  await dialog
    .getByRole("button", { name: "Use example leaf", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Close outline" }).click();
  await expect(adopt).toBeEnabled();
  for (const dark of [false, true]) {
    await page.emulateMedia({ colorScheme: dark ? "dark" : "light" });
    for (const size of [
      { width: 844, height: 390 },
      { width: 390, height: 844 },
      { width: 568, height: 320 },
      { width: 1440, height: 1000 },
    ]) {
      await page.setViewportSize(size);
      for (const where of ["start", "playback", "end"]) {
        if (where === "playback")
          await dialog
            .getByRole("button", { name: "Play circles", exact: true })
            .evaluate((e) => e.scrollIntoView({ block: "end" }));
        else
          await dialog.evaluate(
            (e, where) =>
              (e.scrollTop = where === "start" ? 0 : e.scrollHeight),
            where,
          );
        await expect(adopt).toBeInViewport({ ratio: 1 });
        const footerGap = await dialog.evaluate((e) => {
          const box = e.getBoundingClientRect(),
            footer = e.querySelector("footer")!.getBoundingClientRect();
          return box.top + e.clientTop + e.clientHeight - footer.bottom;
        });
        expect(Math.abs(footerGap)).toBeLessThan(1);
        const unoccluded = await adopt.evaluate((button) => {
          const r = button.getBoundingClientRect();
          return button.contains(
            document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
          );
        });
        expect(unoccluded).toBe(true);
      }
      const appearance = await adopt.evaluate((button) => {
        const style = getComputedStyle(button),
          panel = getComputedStyle(button.closest("dialog")!);
        return {
          background: style.backgroundColor,
          panel: panel.backgroundColor,
          ink: style.color,
          height: button.getBoundingClientRect().height,
        };
      });
      expect(appearance.background).not.toBe("rgba(0, 0, 0, 0)");
      expect(appearance.background).not.toBe(appearance.panel);
      expect(appearance.ink).not.toBe(appearance.background);
      expect(appearance.height).toBeGreaterThanOrEqual(44);
      const luminance = (color: string) => {
        const rgb = color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
          .map((v) => {
            const s = v / 255;
            return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          });
        return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
      };
      const a = luminance(appearance.background),
        b = luminance(appearance.ink);
      expect(
        (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
      ).toBeGreaterThanOrEqual(4.5);
    }
  }
  await dialog.getByRole("button", { name: "Reset outline" }).click();
  await expect(adopt).toBeDisabled();
  await expect(adopt).toBeInViewport({ ratio: 1 });
}

// Real pointer capture in both engines. WebKit does not focus clicked
// buttons; Cancel must nevertheless restore the exact raw draft and camera.
export async function checkFitMouseAndReturn(page: Page) {
  await page.goto("/");
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  const input = page.getByLabel("Shape parameter a", { exact: true });
  await input.fill("2*pi");
  await input.blur();
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.locator("#artwork").focus();
  await page.keyboard.press("+");
  const before = await page.locator("#artwork").innerHTML();
  const camera = await page
    .locator("#artwork")
    .getAttribute("data-camera-scale");
  const dialog = await openFit(page);
  await expect(
    page
      .locator(".app")
      .filter({ has: page.locator("#artwork") })
      .locator(".."),
  ).toHaveAttribute("inert", "");
  const surface = dialog.getByTestId("stroke-reference");
  await surface.scrollIntoViewIfNeeded();
  const box = (await surface.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.3, {
    steps: 5,
  });
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.8, {
    steps: 5,
  });
  await page.mouse.up();
  await expect(surface).toHaveAttribute("data-closed", "false");
  const raw = await surface.locator("polyline").getAttribute("points");
  expect(raw!.split(" ").length).toBeGreaterThan(3);
  await dialog.getByRole("button", { name: "Close outline" }).click();
  await expect(
    dialog.getByRole("button", { name: "Adopt fitted study" }),
  ).toBeEnabled();
  expect(await surface.locator("polygon").getAttribute("points")).toBe(raw);
  await page.setViewportSize({ width: 500, height: 900 });
  expect(await surface.locator("polygon").getAttribute("points")).toBe(raw);
  await dialog.getByRole("button", { name: "Cancel drawing" }).click();
  await expect(input).toHaveValue("2*pi");
  expect(await page.locator("#artwork").innerHTML()).toBe(before);
  expect(await page.locator("#artwork").getAttribute("data-camera-scale")).toBe(
    camera,
  );
  const entry = page.getByRole("button", { name: "Draw a loop", exact: true });
  await expect(entry).toBeFocused();
  await expect(page.locator(".fit-entry")).toHaveAttribute("data-quiet", "");
  await entry.press("Enter");
  await expect(fitDialog(page)).toBeVisible();
  await expect(
    fitDialog(page).getByRole("button", { name: "Cancel drawing" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(entry).toBeFocused();
  await expect(page.locator(".fit-entry")).not.toHaveAttribute(
    "data-quiet",
    "",
  );
}
