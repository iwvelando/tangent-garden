import { choosePreset } from "./helpers";
import { expect, test, type Page, type Locator } from "@playwright/test";

export const fitDialog = (page: Page) =>
  page.getByRole("dialog", { name: /^Your (leaf|curve), made of circles$/ });
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
  const entryBox = page.locator(".fit-entry").filter({ has: entry });
  await expect(entry).toBeFocused();
  await expect(entryBox).toHaveAttribute("data-quiet", "");
  await entry.press("Enter");
  await expect(fitDialog(page)).toBeVisible();
  await expect(
    fitDialog(page).getByRole("button", { name: "Cancel drawing" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(entry).toBeFocused();
  await expect(entryBox).not.toHaveAttribute("data-quiet", "");
}

export async function checkCurrentCurveReturn(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await choosePreset(page, { label: "Hypotrochoid & its evolute" });
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  const entry = page.getByRole("button", { name: "Draw a loop", exact: true });
  let d = await openFit(page);
  await d
    .getByRole("button", { name: "Use current curve", exact: true })
    .click();
  await expect(
    d.getByRole("button", { name: "Adopt fitted study" }),
  ).toBeEnabled();
  await expect(
    d.getByRole("heading", { name: "1. Original curve", exact: true }),
  ).toBeVisible();
  const art = d.getByTestId("stroke-reference");
  expect(await art.evaluate((e) => getComputedStyle(e).touchAction)).toBe(
    "pan-y pinch-zoom",
  );
  await d.getByLabel("Show target outline in preview", { exact: true }).check();
  await d.getByLabel("Preview position", { exact: true }).fill("0.5");
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await d.evaluate((e) => {
      e.scrollTop = 0;
    });
    await d.screenshot({
      path: test.info().outputPath(`current-curve-${colorScheme}.png`),
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await d
    .getByRole("button", { name: "About current curve", exact: true })
    .click();
  await d.getByRole("button", { name: "Show more", exact: true }).click();
  await expect(d.getByText(/32,768 evaluations/)).toBeVisible();
  await d.getByLabel("Show target outline in preview", { exact: true }).check();
  await expect(d.getByTestId("fit-reference")).toBeVisible();
  await d.getByRole("button", { name: "Cancel drawing", exact: true }).click();
  await expect(entry).toBeFocused();
  await expect(page.getByLabel("Definition", { exact: true })).toHaveValue(
    "roulette",
  );
  await entry.press("Enter");
  d = fitDialog(page);
  await expect(
    d.getByRole("button", { name: "Cancel drawing", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(entry).toBeFocused();
}

// Info belongs to its action, including when a narrow input column stacks
// choices. Opening help must leave the neighboring desktop action in place.
export async function checkFitActionHelpLayout(page: Page) {
  // Playwright scrolls the dialog to reveal the info button on a phone.
  // Compare content positions so that scroll is not mistaken for reflow.
  const box = (locator: Locator) =>
    locator.evaluate((e) => {
      const r = e.getBoundingClientRect();
      return {
        x: r.x,
        y: r.y + e.closest("dialog")!.scrollTop,
        width: r.width,
        height: r.height,
      };
    });
  await page.goto("/");
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  const dialog = await openFit(page);
  const current = dialog.getByRole("button", {
    name: "Use current curve",
    exact: true,
  });
  const info = dialog.getByRole("button", {
    name: "About current curve",
    exact: true,
  });
  const example = dialog.getByRole("button", {
    name: "Use example leaf",
    exact: true,
  });
  const reset = dialog.getByRole("button", {
    name: "Reset outline",
    exact: true,
  });
  const close = dialog.getByRole("button", {
    name: "Close outline",
    exact: true,
  });
  const help = dialog.locator(`#${await info.getAttribute("aria-controls")}`);
  for (const size of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 568, height: 320 },
  ]) {
    await page.setViewportSize(size);
    const button = await box(current),
      icon = await box(info);
    expect
      .soft(
        Math.abs(button.y + button.height / 2 - icon.y - icon.height / 2),
        "info icon centered on its button",
      )
      .toBeLessThan(1);
    expect(icon.x - button.x - button.width).toBeGreaterThanOrEqual(8);
    const neighbor = await box(example);
    // At 844px the dialog has two narrow columns; at 568px it has one
    // wider column, which can keep the two input choices side by side.
    const narrow = size.width === 390 || size.width === 844;
    if (narrow) {
      expect(neighbor.y).toBeGreaterThanOrEqual(button.y + button.height + 8);
      expect(Math.abs(neighbor.x - button.x)).toBeLessThan(1);
      expect(
        Math.abs(neighbor.x + neighbor.width - icon.x - icon.width),
      ).toBeLessThan(1);
    } else expect(Math.abs(neighbor.y - button.y)).toBeLessThan(1);
    await info.click();
    await expect(help).toBeVisible();
    const brief = await box(help);
    expect(
      brief.y - button.y - button.height,
      "help directly below current curve",
    ).toBeGreaterThanOrEqual(8);
    expect(brief.y - button.y - button.height).toBeLessThanOrEqual(12);
    expect(Math.abs(brief.x - button.x)).toBeLessThan(1);
    if (narrow)
      expect((await box(example)).y).toBeGreaterThanOrEqual(
        brief.y + brief.height + 8,
      );
    else expect((await box(example)).y).toBe(neighbor.y);
    await help.getByRole("button", { name: "Show more", exact: true }).click();
    const expanded = await box(help);
    if (narrow)
      expect((await box(example)).y).toBeGreaterThanOrEqual(
        expanded.y + expanded.height + 8,
      );
    else expect((await box(example)).y).toBe(neighbor.y);
    const a = await box(reset),
      b = await box(close);
    expect(Math.abs(a.y - b.y)).toBeLessThan(1);
    expect(Math.abs(a.width - b.width)).toBeLessThan(1);
    expect(Math.abs(a.x - button.x)).toBeLessThan(1);
    expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
      true,
    );
    await dialog.locator(".fit-actions").screenshot({
      path: test.info().outputPath(`fit-actions-${size.width}.png`),
    });
    await info.click();
  }
}

export async function checkOutlineCorrection(page: Page) {
  await page.goto("/");
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  const raw = page.getByLabel("Shape parameter a", { exact: true });
  await raw.fill("2*pi");
  await raw.blur();
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  const before = await page.locator("#artwork").innerHTML();
  const d = await leafFit(page);
  const capture = d.getByTestId("stroke-reference");
  const original = await capture
    .locator("polygon")
    .first()
    .getAttribute("points");
  const art = await d.locator("#fit-artwork").innerHTML();
  const residual = await d.getByTestId("fit-residuals").textContent();
  await d.getByRole("button", { name: "Correct outline", exact: true }).click();
  await expect(
    d.getByRole("button", { name: "Correct outline", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await capture.focus();
  await capture.press("ArrowRight");
  await expect(d.locator(".fit-result")).toHaveAttribute("aria-busy", "false");
  await expect(d.getByTestId("fit-residuals")).toContainText("edited outline");
  await expect(
    d.getByRole("heading", { name: "1. Edited outline", exact: true }),
  ).toBeVisible();
  const changed = await capture
    .locator("polygon")
    .first()
    .getAttribute("points");
  expect(changed).not.toBe(original);
  expect(changed!.split(" ")).toHaveLength(original!.split(" ").length);
  expect(await d.getByTestId("fit-residuals").textContent()).not.toBe(residual);
  expect(await d.locator("#fit-artwork").innerHTML()).not.toBe(art);
  await d.getByLabel("Show target outline in preview", { exact: true }).check();
  expect(
    await d
      .getByTestId("fit-reference")
      .locator("polygon")
      .getAttribute("points"),
  ).toBe(changed);
  await d.getByRole("button", { name: "Undo correction", exact: true }).click();
  await expect(d.locator(".fit-result")).toHaveAttribute("aria-busy", "false");
  expect(await capture.locator("polygon").first().getAttribute("points")).toBe(
    original,
  );
  expect(await d.locator("#fit-artwork").innerHTML()).toBe(art);
  await d.getByRole("button", { name: "Redo correction", exact: true }).click();
  await expect(d.locator(".fit-result")).toHaveAttribute("aria-busy", "false");
  expect(await capture.locator("polygon").first().getAttribute("points")).toBe(
    changed,
  );
  // Reachability and equal scale through rotations, with real pointer capture.
  for (const size of [
    { width: 1000, height: 650 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size);
    await capture.scrollIntoViewIfNeeded();
    expect(await capture.evaluate((e) => getComputedStyle(e).touchAction)).toBe(
      "none",
    );
    const handle = capture.locator(".fit-edit-handle");
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + 12,
      box.y + box.height / 2 - 8,
      { steps: 3 },
    );
    await page.mouse.up();
    await expect(d.locator(".fit-result")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(
      d.getByRole("button", { name: "Undo correction", exact: true }),
    ).toBeEnabled();
    await expect(
      d.getByRole("button", { name: "Adopt fitted study", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    expect(await d.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  }
  await d
    .getByRole("button", { name: "Restore original outline", exact: true })
    .click();
  await expect(d.locator(".fit-result")).toHaveAttribute("aria-busy", "false");
  expect(await capture.locator("polygon").first().getAttribute("points")).toBe(
    original,
  );
  await d.getByRole("button", { name: "Cancel drawing", exact: true }).click();
  expect(await page.locator("#artwork").innerHTML()).toBe(before);
  await expect(raw).toHaveValue("2*pi");
  await openFit(page);
  await expect(
    d.getByRole("button", { name: "Correct outline", exact: true }),
  ).toBeDisabled();
}

export async function checkCorrectionStability(page: Page) {
  await page.addInitScript(() => {
    const send = Worker.prototype.postMessage;
    (window as any).holdFit = false;
    (window as any).releaseFit = () => {};
    Worker.prototype.postMessage = function (q: any, ...rest: any[]) {
      if (q.action === "fourier-fit" && q.correction && (window as any).holdFit)
        (window as any).releaseFit = () => send.call(this, q, ...rest);
      else send.call(this, q, ...rest);
    };
  });
  await page.goto("/");
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  const d = await leafFit(page),
    capture = d.getByTestId("stroke-reference");
  await d.getByRole("button", { name: "Correct outline", exact: true }).click();
  await capture.focus();
  await capture.press("ArrowRight");
  await expect(d.locator(".fit-result")).toHaveAttribute("aria-busy", "false");
  const status = await d.getByRole("status").textContent();
  const residual = await d.getByTestId("fit-residuals").textContent();
  const artwork = await d.locator("#fit-artwork").innerHTML();
  const position = d.getByLabel("Outline point", { exact: true });
  const play = d.getByRole("button", { name: "Play circles", exact: true });
  const restore = d.getByRole("button", {
    name: "Restore original outline",
    exact: true,
  });
  const adopt = d.getByRole("button", {
    name: "Adopt fitted study",
    exact: true,
  });
  await adopt.hover();
  const opacity = await adopt.evaluate((e) => getComputedStyle(e).opacity);
  const hoverFilter = await adopt.evaluate((e) => getComputedStyle(e).filter);
  await page.evaluate(() => ((window as any).holdFit = true));
  await capture.focus();
  await capture.press("ArrowUp");
  await expect(d.locator(".fit-result")).toHaveAttribute("aria-busy", "true");
  await expect(adopt).toBeDisabled();
  expect(await adopt.evaluate((e) => getComputedStyle(e).opacity)).toBe(
    opacity,
  );
  expect(await adopt.evaluate((e) => getComputedStyle(e).filter)).toBe(
    hoverFilter,
  );
  await expect(position).toBeEnabled();
  await expect(play).toBeEnabled();
  await expect(restore).toBeEnabled();
  expect(await d.getByRole("status").textContent()).toBe(status);
  expect(await d.getByTestId("fit-residuals").textContent()).toBe(residual);
  expect(await d.locator("#fit-artwork").innerHTML()).toBe(artwork);
  await position.fill("3");
  await d.getByLabel("Correction reach", { exact: true }).selectOption("0.2");
  await page.evaluate(() => (window as any).releaseFit());
  await expect(d.locator(".fit-result")).toHaveAttribute("aria-busy", "false");
  await expect(position).toHaveValue("3");
  expect(await d.getByRole("status").textContent()).toBe(status);
  expect(await d.getByTestId("fit-residuals").textContent()).not.toBe(residual);
  // Keep Shift down across successive repeat-like micro adjustments.
  await page.keyboard.down("Shift");
  for (let i = 0; i < 3; i++) {
    await capture.focus();
    await capture.press("ArrowRight");
    await expect(d.locator(".fit-result")).toHaveAttribute("aria-busy", "true");
    expect(await adopt.evaluate((e) => getComputedStyle(e).opacity)).toBe(
      opacity,
    );
    expect(await adopt.evaluate((e) => getComputedStyle(e).filter)).toBe(
      hoverFilter,
    );
    await expect(position).toBeEnabled();
    await expect(restore).toBeEnabled();
    expect(await d.getByRole("status").textContent()).toBe(status);
    await page.evaluate(() => (window as any).releaseFit());
    await expect(d.locator(".fit-result")).toHaveAttribute(
      "aria-busy",
      "false",
    );
  }
  await page.keyboard.up("Shift");
  // Restore must also work while another correction is outstanding.
  await capture.focus();
  await capture.press("ArrowUp");
  await expect(d.locator(".fit-result")).toHaveAttribute("aria-busy", "true");
  await restore.click();
  await expect(d.locator(".fit-result")).toHaveAttribute("aria-busy", "false");
  await expect(d.getByTestId("fit-residuals")).not.toContainText(
    "edited outline",
  );
  await page.evaluate(() => (window as any).releaseFit());
  await expect(
    d.getByRole("button", { name: "Redo correction", exact: true }),
  ).toBeDisabled();
}

export async function checkOutlineZoom(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  const d = await leafFit(page),
    svg = d.getByTestId("stroke-reference");
  await d.getByRole("button", { name: "Correct outline", exact: true }).click();
  const original = await svg.locator("polygon").first().getAttribute("points");
  const preview = await d.locator("#fit-artwork").innerHTML();
  const view = await svg.getAttribute("viewBox");
  const zoomIn = d.getByRole("button", {
    name: "Zoom in on outline",
    exact: true,
  });
  await zoomIn.click();
  expect(await svg.getAttribute("viewBox")).not.toBe(view);
  expect(await svg.locator("polygon").first().getAttribute("points")).toBe(
    original,
  );
  expect(await d.locator("#fit-artwork").innerHTML()).toBe(preview);
  await expect(
    d.getByRole("button", { name: "Undo correction", exact: true }),
  ).toBeDisabled();
  await d.getByRole("button", { name: "Fit outline", exact: true }).click();
  expect(await svg.getAttribute("viewBox")).toBe(view);
  // Programmatic pointer events exercise WebKit's multi-contact transition;
  // real browser touch dispatch is checked separately in Chromium.
  await svg.evaluate((e) => {
    const box = e.getBoundingClientRect(),
      x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    // Synthetic events have no native capture. The event sequence still runs
    // the production gesture handlers and their coordinate transformations.
    e.setPointerCapture = () => {};
    (window as any).outlineTouch = (
      type: string,
      id: number,
      dx: number,
      dy = 0,
    ) =>
      e.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: id,
          pointerType: "touch",
          isPrimary: id === 11,
          button: 0,
          clientX: x + dx,
          clientY: y + dy,
        }),
      );
    (window as any).outlineTouch("pointerdown", 11, -30);
    (window as any).outlineTouch("pointermove", 11, -32);
    (window as any).outlineTouch("pointerdown", 12, 30);
    (window as any).outlineTouch("pointermove", 11, -65);
    (window as any).outlineTouch("pointermove", 12, 65);
  });
  expect(await svg.getAttribute("viewBox")).not.toBe(view);
  const pinched = await svg.getAttribute("viewBox");
  await svg.evaluate(() => {
    const t = (window as any).outlineTouch;
    t("pointerdown", 13, 0, -30);
    t("pointermove", 13, 80, -30);
    t("pointerup", 13, 80, -30);
  });
  expect(await svg.getAttribute("viewBox")).toBe(pinched);
  await svg.evaluate(() => {
    const t = (window as any).outlineTouch;
    t("pointerup", 12, 65);
    t("pointermove", 11, -80);
    t("pointerup", 11, -80);
  });
  expect(await svg.getAttribute("viewBox")).toBe(pinched);
  expect(await svg.locator("polygon").first().getAttribute("points")).toBe(
    original,
  );
  expect(await d.locator("#fit-artwork").innerHTML()).toBe(preview);
  await expect(
    d.getByRole("button", { name: "Undo correction", exact: true }),
  ).toBeDisabled();
  await expect(d.getByLabel("Outline point", { exact: true })).toHaveValue("0");
  await expect(svg.locator(".fit-edit-vector")).toHaveCount(0);
  await d.getByLabel("Total terms", { exact: true }).selectOption("12");
  await expect(d.locator(".fit-result")).toHaveAttribute("aria-busy", "false");
  expect(await svg.getAttribute("viewBox")).toBe(pinched);
  // A fresh one-finger correction works after navigation; keyboard nudges
  // also use the close-up span, and history does not reset that view.
  await svg.focus();
  await svg.press("Shift+ArrowRight");
  await expect(d.locator(".fit-result")).toHaveAttribute("aria-busy", "false");
  expect(await svg.locator("polygon").first().getAttribute("points")).not.toBe(
    original,
  );
  expect(await svg.getAttribute("viewBox")).toBe(pinched);
  await d.getByRole("button", { name: "Undo correction", exact: true }).click();
  await expect(d.locator(".fit-result")).toHaveAttribute("aria-busy", "false");
  expect(await svg.getAttribute("viewBox")).toBe(pinched);
  expect(await svg.locator("polygon").first().getAttribute("points")).toBe(
    original,
  );
  for (let i = 0; i < 20 && (await zoomIn.isEnabled()); i++)
    await zoomIn.click();
  await expect(zoomIn).toBeDisabled();
  await d.getByRole("button", { name: "Fit outline", exact: true }).click();
  expect(await svg.getAttribute("viewBox")).toBe(view);
  await expect(
    d.getByRole("button", { name: "Zoom out of outline", exact: true }),
  ).toBeDisabled();
  await zoomIn.click();
  await d.getByRole("button", { name: "Correct outline", exact: true }).click();
  await d.getByRole("button", { name: "Correct outline", exact: true }).click();
  expect(await svg.getAttribute("viewBox")).toBe(view);
}

export async function checkOutlineOpenSpacePan(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  const d = await openFit(page),
    svg = d.getByTestId("stroke-reference");
  await d
    .getByRole("button", { name: "Use current curve", exact: true })
    .click();
  await expect(
    d.getByRole("button", { name: "Adopt fitted study", exact: true }),
  ).toBeEnabled();
  await d.getByRole("button", { name: "Correct outline", exact: true }).click();
  await svg.scrollIntoViewIfNeeded();
  const original = await svg.locator("polygon").first().getAttribute("points");
  const preview = await d.locator("#fit-artwork").innerHTML();
  const residual = await d.getByTestId("fit-residuals").textContent();
  const view = await svg.getAttribute("viewBox");
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 100,
    box.y + box.height / 2 + 12,
    { steps: 5 },
  );
  await page.mouse.up();
  expect(await svg.getAttribute("viewBox")).not.toBe(view);
  expect(await svg.locator("polygon").first().getAttribute("points")).toBe(
    original,
  );
  expect(await d.locator("#fit-artwork").innerHTML()).toBe(preview);
  expect(await d.getByTestId("fit-residuals").textContent()).toBe(residual);
  await expect(d.getByLabel("Outline point", { exact: true })).toHaveValue("0");
  await expect(
    d.getByRole("button", { name: "Undo correction", exact: true }),
  ).toBeDisabled();
  await d.getByRole("button", { name: "Fit outline", exact: true }).click();
  expect(await svg.getAttribute("viewBox")).toBe(view);
  // At the ellipse's rightmost point, 14 CSS pixels is inside the touch
  // allowance and outside the mouse/pen allowance at either magnification.
  for (const zoomed of [false, true]) {
    if (zoomed)
      await d
        .getByRole("button", { name: "Zoom in on outline", exact: true })
        .click();
    for (const type of ["mouse", "pen", "touch"]) {
      await svg.scrollIntoViewIfNeeded();
      const before = await svg.getAttribute("viewBox");
      await svg.evaluate((e, type) => {
        const root = e as SVGSVGElement,
          p = root.querySelector("polygon")!.points.getItem(0);
        const at = new DOMPoint(p.x, p.y).matrixTransform(root.getScreenCTM()!);
        root.setPointerCapture = () => {};
        for (const [event, dx] of [
          ["pointerdown", 14],
          ["pointermove", 22],
          ["pointerup", 22],
        ] as const)
          root.dispatchEvent(
            new PointerEvent(event, {
              bubbles: true,
              pointerId: 41,
              isPrimary: true,
              pointerType: type,
              button: 0,
              clientX: at.x + dx,
              clientY: at.y,
            }),
          );
      }, type);
      await expect(d.locator(".fit-result")).toHaveAttribute(
        "aria-busy",
        "false",
      );
      if (type === "touch") {
        expect(await svg.getAttribute("viewBox")).toBe(before);
        expect(
          await svg.locator("polygon").first().getAttribute("points"),
        ).not.toBe(original);
        await d
          .getByRole("button", { name: "Undo correction", exact: true })
          .click();
        await expect(d.locator(".fit-result")).toHaveAttribute(
          "aria-busy",
          "false",
        );
      } else {
        expect(await svg.getAttribute("viewBox")).not.toBe(before);
        expect(
          await svg.locator("polygon").first().getAttribute("points"),
        ).toBe(original);
      }
      await d.getByRole("button", { name: "Fit outline", exact: true }).click();
      if (zoomed)
        await d
          .getByRole("button", { name: "Zoom in on outline", exact: true })
          .click();
    }
    await d.getByRole("button", { name: "Fit outline", exact: true }).click();
  }
  // The sparse leaf's closing edge is still editable between vertices.
  await d
    .getByRole("button", { name: "Use example leaf", exact: true })
    .click();
  await d.getByRole("button", { name: "Close outline", exact: true }).click();
  await expect(
    d.getByRole("button", { name: "Adopt fitted study", exact: true }),
  ).toBeEnabled();
  await d.getByRole("button", { name: "Correct outline", exact: true }).click();
  await svg.scrollIntoViewIfNeeded();
  const leaf = await svg.locator("polygon").first().getAttribute("points");
  const leafView = await svg.getAttribute("viewBox");
  const closing = await svg.evaluate((e) => {
    const root = e as SVGSVGElement,
      poly = root.querySelector("polygon")!;
    const m = root.getScreenCTM()!;
    const points = Array.from(poly.points, (p) =>
      new DOMPoint(p.x, p.y).matrixTransform(m),
    );
    const first = points[0],
      last = points.at(-1)!;
    const x = (first.x + last.x) / 2,
      y = (first.y + last.y) / 2;
    return {
      x,
      y,
      nearest: Math.min(...points.map((p) => Math.hypot(p.x - x, p.y - y))),
    };
  });
  expect(closing.nearest).toBeGreaterThan(10);
  await page.mouse.move(closing.x, closing.y);
  await page.mouse.down();
  await page.mouse.move(closing.x + 8, closing.y, { steps: 3 });
  await page.mouse.up();
  await expect(d.locator(".fit-result")).toHaveAttribute("aria-busy", "false");
  expect(await svg.getAttribute("viewBox")).toBe(leafView);
  expect(await svg.locator("polygon").first().getAttribute("points")).not.toBe(
    leaf,
  );
}
