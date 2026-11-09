import { choosePreset } from "./helpers";
import { expect, test, type Page, type Locator } from "@playwright/test";
import { fittedStudy } from "../web/fourier-fit";
import { writeStudyLink } from "../web/study-link";

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
  // The drawn points are kept as drawn, with the closing segment's after them.
  const closed = await surface.locator("polygon").getAttribute("points");
  expect(closed!.split(" ").slice(0, raw!.split(" ").length).join(" ")).toBe(
    raw,
  );
  await page.setViewportSize({ width: 500, height: 900 });
  expect(await surface.locator("polygon").getAttribute("points")).toBe(closed);
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
  const position = d.getByLabel("Correction reach", { exact: true });
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
  // Choosing another point while a fit is pending is kept, and starts nothing.
  await capture.focus();
  for (let i = 0; i < 3; i++) await capture.press("]");
  await d.getByLabel("Correction reach", { exact: true }).selectOption("0.2");
  await page.evaluate(() => (window as any).releaseFit());
  await expect(d.locator(".fit-result")).toHaveAttribute("aria-busy", "false");
  await expect(capture).toHaveAttribute("data-selected-point", "3");
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
  await expect(svg).toHaveAttribute("data-selected-point", "0");
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
  await expect(svg).toHaveAttribute("data-selected-point", "0");
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

// Content position, so a scroll that reveals a button is not mistaken for reflow.
const contentBox = (locator: Locator) =>
  locator.evaluate((e) => {
    const r = e.getBoundingClientRect();
    return {
      x: r.x,
      y: r.y + e.closest("dialog")!.scrollTop,
      width: r.width,
      height: r.height,
    };
  });
const fitSettled = (d: Locator) =>
  expect(d.locator(".fit-result")).toHaveAttribute("aria-busy", "false");
async function pageReady(page: Page) {
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
}
const fitButton = (d: Locator, name: string) =>
  d.getByRole("button", { name, exact: true });

// With correction off on arrival, drag the closing segment's middle: the line
// itself must bend, locally, with its ends and the original arc staying put.
// `arcPoints` is how many points precede the closing segment.
async function checkClosingSegmentBends(
  page: Page,
  d: Locator,
  arcPoints: number,
) {
  const svg = d.getByTestId("stroke-reference"),
    polygon = svg.locator("polygon").first();
  await fitButton(d, "Correct outline").click();
  await svg.scrollIntoViewIfNeeded();
  const points = async () => (await polygon.getAttribute("points"))!.split(" ");
  const original = await points();
  const middle = arcPoints + Math.floor((original.length - arcPoints) / 2);
  const at = await svg.evaluate((e, middle) => {
    const root = e as SVGSVGElement,
      p = root.querySelector("polygon")!.points.getItem(middle);
    const c = new DOMPoint(p.x, p.y).matrixTransform(root.getScreenCTM()!);
    return { x: c.x, y: c.y };
  }, middle);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x, at.y - 30, { steps: 4 });
  await page.mouse.up();
  await fitSettled(d);
  const bent = await points();
  expect(bent).toHaveLength(original.length);
  expect(bent[middle]).not.toBe(original[middle]);
  expect(bent[0]).toBe(original[0]);
  expect(bent[arcPoints - 1]).toBe(original[arcPoints - 1]);
  await expect(d.getByTestId("fit-residuals")).toContainText("edited outline");
  await fitButton(d, "Undo correction").click();
  await fitSettled(d);
  expect(await points()).toEqual(original);
  await fitButton(d, "Correct outline").click();
}

// A drawn stroke's closing segment corrects the same way as a source's.
export async function checkDrawnClosingSegment(page: Page) {
  await page.setViewportSize({ width: 1000, height: 650 });
  await page.goto("/");
  await pageReady(page);
  const d = await openFit(page),
    svg = d.getByTestId("stroke-reference");
  await svg.scrollIntoViewIfNeeded();
  const box = (await svg.boundingBox())!;
  const at = (a: number) => ({
    x: box.x + box.width * (0.5 + 0.35 * Math.cos(a)),
    y: box.y + box.height * (0.45 + 0.35 * Math.sin(a)),
  });
  await page.mouse.move(at(0).x, at(0).y);
  await page.mouse.down();
  const samples = 40;
  for (let j = 1; j <= samples; j++) {
    const p = at((Math.PI * j) / samples);
    await page.mouse.move(p.x, p.y);
  }
  await page.mouse.up();
  const stroke = Number(await svg.getAttribute("data-point-count"));
  await fitButton(d, "Close outline").click();
  await expect(fitButton(d, "Adopt fitted study")).toBeEnabled();
  expect(Number(await svg.getAttribute("data-point-count"))).toBeGreaterThan(
    stroke + 10,
  );
  await checkClosingSegmentBends(page, d, stroke);
}

// Without the slider, the keyboard still reaches every point: [ and ] step
// through the closed outline by about 1%, and Shift by exactly one point.
export async function checkKeyboardPointStepping(page: Page) {
  await page.setViewportSize({ width: 1000, height: 650 });
  await page.goto("/");
  await pageReady(page);
  const d = await openFit(page),
    svg = d.getByTestId("stroke-reference");
  await fitButton(d, "Use current curve").click();
  await expect(fitButton(d, "Adopt fitted study")).toBeEnabled();
  await fitButton(d, "Correct outline").click();
  await expect(d.getByLabel("Outline point", { exact: true })).toHaveCount(0);
  const polygon = svg.locator("polygon").first();
  const original = await polygon.getAttribute("points");
  const unique = original!.split(" ").length - 1;
  const step = Math.max(1, Math.round(unique / 100));
  await svg.focus();
  await expect(svg).toHaveAttribute("data-selected-point", "0");
  await svg.press("]");
  await expect(svg).toHaveAttribute("data-selected-point", String(step));
  await svg.press("Shift+]");
  await expect(svg).toHaveAttribute("data-selected-point", String(step + 1));
  await svg.press("Shift+[");
  await svg.press("[");
  await expect(svg).toHaveAttribute("data-selected-point", "0");
  // It wraps around the closed outline.
  await svg.press("Shift+[");
  await expect(svg).toHaveAttribute("data-selected-point", String(unique - 1));
  await svg.press("Shift+]");
  await expect(svg).toHaveAttribute("data-selected-point", "0");
  await svg.press("]");
  // Named to assistive technology; choosing edits nothing.
  await expect(svg).toHaveAttribute(
    "aria-label",
    new RegExp(`point ${step + 1} of ${unique}$`),
  );
  expect(await polygon.getAttribute("points")).toBe(original);
  await expect(fitButton(d, "Undo correction")).toBeDisabled();
  // Browser and system shortcuts pass through, while a layout that types a
  // bracket with Option or AltGr (reported with Alt, or Ctrl and Alt) steps.
  const key = (init: KeyboardEventInit) =>
    svg.evaluate((e, init) => {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ...init,
      });
      e.dispatchEvent(event);
      return event.defaultPrevented;
    }, init);
  const selected = String(step);
  await svg.press("Shift+[");
  await svg.press("Shift+]");
  for (const shortcut of [
    { key: "[", metaKey: true },
    { key: "]", metaKey: true },
    { key: "[", ctrlKey: true },
    { key: "-", metaKey: true },
    { key: "=", ctrlKey: true },
    { key: "Home", metaKey: true },
    { key: "ArrowLeft", metaKey: true },
    { key: "ArrowLeft", altKey: true },
    { key: "Home", altKey: true },
    { key: "-", altKey: true },
  ]) {
    expect(await key(shortcut), JSON.stringify(shortcut)).toBe(false);
    await expect(svg).toHaveAttribute("data-selected-point", selected);
  }
  await expect(fitButton(d, "Undo correction")).toBeDisabled();
  expect(await key({ key: "]", altKey: true })).toBe(true);
  await expect(svg).toHaveAttribute("data-selected-point", String(2 * step));
  expect(await key({ key: "[", ctrlKey: true, altKey: true })).toBe(true);
  await expect(svg).toHaveAttribute("data-selected-point", selected);
  // An arrow then moves the point chosen.
  const position = () =>
    svg.evaluate((e, step) => {
      const p = (e as SVGSVGElement)
        .querySelector("polygon")!
        .points.getItem(step);
      return p.x;
    }, step);
  const x = await position();
  await svg.press("ArrowRight");
  await fitSettled(d);
  expect(await position()).toBeGreaterThan(x);
}

// A press focuses the drawing so its keys work next, without ringing it. A
// keyboard reader keeps the ring, whichever input came first. Chromium also
// outlines any focused SVG itself, whether or not :focus-visible matches.
export async function checkDrawingFocusRing(page: Page) {
  await page.setViewportSize({ width: 1000, height: 650 });
  await page.goto("/");
  await pageReady(page);
  const d = await leafFit(page),
    svg = d.getByTestId("stroke-reference");
  const outline = () => svg.evaluate((e) => getComputedStyle(e).outlineStyle);
  const press = async () => {
    await svg.scrollIntoViewIfNeeded();
    const at = await svg.evaluate((e) => {
      const root = e as SVGSVGElement,
        p = root.querySelector("polygon")!.points.getItem(10);
      const c = new DOMPoint(p.x, p.y).matrixTransform(root.getScreenCTM()!);
      return { x: c.x, y: c.y };
    });
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.up();
    await expect(svg).toBeFocused();
  };
  await fitButton(d, "Correct outline").click();
  await press();
  expect(await outline(), "press after pointer use").toBe("none");
  // The keyboard brings the ring back at its first key.
  await page.keyboard.press("]");
  await expect(d).not.toHaveAttribute("data-quiet", "");
  await expect.poll(outline, "key after a press").not.toBe("none");
  // The very first press after keyboard use is already a pointer's.
  await press();
  expect(await outline(), "first press after a key").toBe("none");
}

// Open curves wait for an explicit close: nothing is fitted or invisibly
// joined until then, and the closed result behaves as any other outline.
export async function checkOpenCurveImport(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await pageReady(page);
  await choosePreset(page, { label: "Cycloid & its evolute" });
  await pageReady(page);
  const d = await openFit(page),
    capture = d.getByTestId("stroke-reference");
  const adopt = fitButton(d, "Adopt fitted study"),
    close = fitButton(d, "Close outline");
  await fitButton(d, "Use current curve").click();
  await expect(close).toBeEnabled();
  await expect(capture).toHaveAttribute("data-source", "curve");
  await expect(capture).toHaveAttribute("data-closed", "false");
  await expect(capture.locator("polygon")).toHaveCount(0);
  const open = await capture.locator("polyline").getAttribute("points");
  expect(open!.split(" ").length).toBeGreaterThan(256);
  await expect(d.getByRole("alert")).toHaveCount(0);
  await expect(adopt).toBeDisabled();
  await expect(fitButton(d, "Correct outline")).toBeDisabled();
  await expect(d.locator(".fit-art svg")).toHaveCount(0);
  // The explanation sits right under the action that resolves it.
  const note = d.getByTestId("open-source-note");
  await expect(note).toContainText("Close outline");
  const below = (await contentBox(note)).y - (await contentBox(close)).y;
  expect(below - (await contentBox(close)).height).toBeLessThanOrEqual(16);
  expect(below).toBeGreaterThan(0);
  // The whole arch is in frame before anything has been fitted.
  const inFrame = await capture.evaluate((e) => {
    const root = e as SVGSVGElement,
      v = root.viewBox.baseVal;
    return Array.from(root.querySelector("polyline")!.points).every(
      (p) =>
        p.x >= v.x &&
        p.x <= v.x + v.width &&
        p.y >= v.y &&
        p.y <= v.y + v.height,
    );
  });
  expect(inFrame).toBe(true);
  // A term choice before closing carries over without a stray refusal.
  await d.getByLabel("Total terms", { exact: true }).selectOption("12");
  await fitSettled(d);
  await expect(d.getByRole("alert")).toHaveCount(0);
  await expect(adopt).toBeDisabled();

  await close.click();
  await expect(adopt).toBeEnabled();
  await expect(close).toBeDisabled();
  await expect(capture).toHaveAttribute("data-closed", "true");
  const closed = capture.locator("polygon").first();
  // The same arch, now with editable points along its closing segment.
  const before = open!.split(" "),
    vertices = (await closed.getAttribute("points"))!.split(" ");
  expect(vertices.length).toBeGreaterThan(before.length + 100);
  expect(vertices.slice(0, before.length)).toEqual(before);
  await expect(note).toHaveCount(0);
  await expect(d.getByText("Closed by a straight segment")).toBeVisible();
  await expect(d.getByTestId("source-sampling")).toBeVisible();
  const terms = JSON.parse(
    (await d.locator("#fit-artwork desc").textContent())!,
  ).curve.terms;
  expect(terms).toHaveLength(12);
  await checkClosingSegmentBends(page, d, before.length);
  // Correction, history and Reset all treat it as an ordinary outline.
  await fitButton(d, "Correct outline").click();
  await capture.focus();
  await capture.press("ArrowRight");
  await fitSettled(d);
  await expect(d.getByTestId("fit-residuals")).toContainText("edited outline");
  expect((await closed.getAttribute("points"))!.split(" ")).not.toEqual(
    vertices,
  );
  await fitButton(d, "Undo correction").click();
  await fitSettled(d);
  expect((await closed.getAttribute("points"))!.split(" ")).toEqual(vertices);
  await fitButton(d, "Correct outline").click();
  await adopt.click();
  await pageReady(page);
  await expect(fitDialog(page)).toHaveCount(0);
  const adopted = () =>
    page
      .locator("#artwork desc")
      .textContent()
      .then((text) => JSON.parse(text!).curve);
  await expect.poll(async () => (await adopted()).format).toBe("fourier");
  expect((await adopted()).terms).toEqual(terms);
}

// A refusal reads as an error and appears beside the action that caused it.
export async function checkFitErrorsBesideActions(page: Page) {
  const gap = fittedStudy([{ frequency: 1, radius: 1, phase: 0 }]);
  gap.config.curve = {
    ...gap.config.curve,
    format: "parametric",
    x: "cos(t)",
    y: "sin(t)+0*sqrt(cos(t))",
  };
  const derived = fittedStudy([{ frequency: 1, radius: 1, phase: 0 }]);
  derived.config.input = "evolute" as typeof derived.config.input;
  const gapLink = await writeStudyLink("2d", gap),
    derivedLink = await writeStudyLink("2d", derived);
  for (const size of [
    { width: 390, height: 844 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(size);
    await page.goto(`/#s=${gapLink}`);
    await page.reload();
    await pageReady(page);
    const d = await openFit(page),
      current = fitButton(d, "Use current curve");
    await current.click();
    const alert = d.getByRole("alert");
    await expect(alert).toContainText("gap");
    await expect(alert).toHaveClass(/field-error/);
    const box = await contentBox(alert),
      button = await contentBox(current);
    expect(box.y - button.y - button.height).toBeGreaterThanOrEqual(0);
    expect(box.y - button.y - button.height).toBeLessThanOrEqual(16);
    expect(
      await alert.evaluate((e) => getComputedStyle(e).color),
      "error ink, not note ink",
    ).not.toBe(
      await d
        .locator(".fit-draft .note")
        .first()
        .evaluate((e) => getComputedStyle(e).color),
    );
    await expect(d.getByRole("status")).not.toContainText("gap");
    await expect(d.getByText("Source not admitted")).toBeVisible();
    // Retried through a term change, then gone with the source it described.
    await d.getByLabel("Total terms", { exact: true }).selectOption("12");
    await expect(alert).toContainText("gap");
    await fitButton(d, "Use example leaf").click();
    await expect(alert).toHaveCount(0);
    // A refused drawn outline names the problem beside Close outline.
    await fitButton(d, "Reset outline").click();
    const svg = d.getByTestId("stroke-reference");
    await svg.scrollIntoViewIfNeeded();
    const area = (await svg.boundingBox())!;
    await page.mouse.click(area.x + area.width / 2, area.y + area.height / 2);
    const close = fitButton(d, "Close outline");
    await close.click();
    await expect(alert).toContainText("three");
    const refusal = await contentBox(alert),
      action = await contentBox(close);
    expect(refusal.y - action.y - action.height).toBeGreaterThanOrEqual(0);
    expect(refusal.y - action.y - action.height).toBeLessThanOrEqual(16);
    await fitButton(d, "Cancel drawing").click();

    await page.goto(`/#s=${derivedLink}`);
    await page.reload();
    await pageReady(page);
    // Known in advance is not a failure: gray, quiet, and explained on request.
    const e = await openFit(page);
    const unavailable = fitButton(e, "Use current curve");
    await expect(unavailable).toBeDisabled();
    await expect(e.locator(".field-error")).toHaveCount(0);
    await expect(e.getByRole("alert")).toHaveCount(0);
    await fitButton(e, "About current curve").click();
    await fitButton(e, "Show more").first().click();
    await expect(e.locator(".fit-source-action .hint")).toContainText(
      "Construct on",
    );
    await fitButton(e, "Cancel drawing").click();
  }
}

// A trackpad behaves as fingers do on a phone: pinch zooms about the fingers,
// two fingers pan. A mouse wheel arrives as the same two-finger scroll.
export async function checkOutlineTrackpad(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await pageReady(page);
  const d = await leafFit(page),
    svg = d.getByTestId("stroke-reference");
  const original = await svg.locator("polygon").first().getAttribute("points");
  const preview = await d.locator("#fit-artwork").innerHTML();
  await fitButton(d, "Correct outline").click();
  await svg.scrollIntoViewIfNeeded();
  // A native listener's update commits on React's own schedule, not at once.
  const committed = () =>
    page.evaluate(
      () =>
        new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0))),
    );
  const wheel = async (init: {
    u?: number;
    v?: number;
    dx?: number;
    dy?: number;
    ctrl?: boolean;
    mode?: number;
  }) => {
    const prevented = await svg.evaluate((e, o) => {
      const b = e.getBoundingClientRect();
      const event = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        // Whole pixels, as a mouse event's coordinates always are.
        clientX: Math.round(b.x + b.width * (o.u ?? 0.5)),
        clientY: Math.round(b.y + b.height * (o.v ?? 0.5)),
        deltaX: o.dx ?? 0,
        deltaY: o.dy ?? 0,
        deltaMode: o.mode ?? 0,
        ctrlKey: !!o.ctrl,
      });
      e.dispatchEvent(event);
      return event.defaultPrevented;
    }, init);
    await committed();
    return prevented;
  };
  // What the page point (u, v) shows, in the outline's own coordinates.
  const modelAt = (u: number, v: number) =>
    svg.evaluate(
      (e, [u, v]) => {
        const root = e as SVGSVGElement,
          b = e.getBoundingClientRect();
        const p = new DOMPoint(
          Math.round(b.x + b.width * u),
          Math.round(b.y + b.height * v),
        ).matrixTransform(root.getScreenCTM()!.inverse());
        return { x: p.x, y: p.y };
      },
      [u, v],
    );
  const vertex = () =>
    svg.evaluate((e) => {
      const root = e as SVGSVGElement,
        p = root.querySelector("polygon")!.points.getItem(0);
      const at = new DOMPoint(p.x, p.y).matrixTransform(root.getScreenCTM()!);
      return { x: at.x, y: at.y };
    });
  const span = async () =>
    await svg.evaluate((e) => (e as SVGSVGElement).viewBox.baseVal.width);
  const view = await svg.getAttribute("viewBox"),
    full = await span();

  // Pinch out, anchored under the fingers rather than at the middle.
  const anchor = await modelAt(0.3, 0.7);
  expect(await wheel({ u: 0.3, v: 0.7, dy: -20, ctrl: true })).toBe(true);
  expect(full / (await span())).toBeCloseTo(Math.exp(0.2), 6);
  const held = await modelAt(0.3, 0.7);
  // Within the single precision an SVG transform carries.
  expect(Math.hypot(held.x - anchor.x, held.y - anchor.y)).toBeLessThan(1e-5);
  await expect(d.locator(".fit-outline-view-note")).toContainText("1.2×");
  // A wheel notch held with Ctrl sends a far larger delta, yet stays a step.
  const before = await span();
  await wheel({ dy: -100, ctrl: true });
  expect(before / (await span())).toBeLessThan(1.3);
  expect(before / (await span())).toBeGreaterThan(1.2);
  await fitButton(d, "Fit outline").click();
  expect(await svg.getAttribute("viewBox")).toBe(view);
  // The range holds: nothing past 32× or below the fitted view.
  await wheel({ dy: 100, ctrl: true });
  expect(await svg.getAttribute("viewBox")).toBe(view);

  // Two-finger scroll moves the content the way the fingers push it.
  const start = await vertex();
  expect(await wheel({ dx: 30, dy: -40 })).toBe(true);
  let moved = await vertex();
  expect(moved.x - start.x).toBeCloseTo(-30, 3);
  expect(moved.y - start.y).toBeCloseTo(40, 3);
  expect(await span()).toBeCloseTo(full, 9);
  // A wheel that counts in lines is scaled to pixels.
  await wheel({ dy: 2, mode: 1 });
  const lines = await vertex();
  expect(lines.y - moved.y).toBeCloseTo(-32, 3);
  await fitButton(d, "Fit outline").click();

  // Safari reports a trackpad pinch as gesture events with a running scale.
  const gesture = async (type: string, scale: number) => {
    const prevented = await svg.evaluate(
      (e, [type, scale]) => {
        const b = e.getBoundingClientRect();
        const event = Object.assign(
          new Event(type as string, { bubbles: true, cancelable: true }),
          {
            scale: scale as number,
            clientX: Math.round(b.x + b.width * 0.25),
            clientY: Math.round(b.y + b.height * 0.25),
          },
        );
        e.dispatchEvent(event);
        return event.defaultPrevented;
      },
      [type, scale] as const,
    );
    await committed();
    return prevented;
  };
  const pinched = await modelAt(0.25, 0.25);
  expect(await gesture("gesturestart", 1)).toBe(true);
  expect(await gesture("gesturechange", 1.5)).toBe(true);
  expect(full / (await span())).toBeCloseTo(1.5, 6);
  await gesture("gesturechange", 1.8);
  expect(full / (await span()), "scale runs from the start").toBeCloseTo(
    1.8,
    6,
  );
  await gesture("gestureend", 1.8);
  const after = await modelAt(0.25, 0.25);
  expect(Math.hypot(after.x - pinched.x, after.y - pinched.y)).toBeLessThan(
    1e-5,
  );
  await fitButton(d, "Fit outline").click();
  // iOS fires the same events during a touch pinch the pointers already
  // handle, so held pointers own the view and a gesture must not double it.
  await svg.evaluate((e) => {
    (e as SVGSVGElement).setPointerCapture = () => {};
    const b = e.getBoundingClientRect();
    e.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 71,
        pointerType: "touch",
        isPrimary: true,
        button: 0,
        clientX: b.x + 2,
        clientY: b.y + 2,
      }),
    );
  });
  await gesture("gesturestart", 1);
  await gesture("gesturechange", 2);
  await gesture("gestureend", 2);
  await wheel({ dy: -20, ctrl: true });
  expect(await svg.getAttribute("viewBox")).toBe(view);
  await svg.evaluate((e) => {
    e.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        pointerId: 71,
        pointerType: "touch",
      }),
    );
  });

  // None of this edits anything.
  expect(await svg.locator("polygon").first().getAttribute("points")).toBe(
    original,
  );
  expect(await d.locator("#fit-artwork").innerHTML()).toBe(preview);
  await expect(fitButton(d, "Undo correction")).toBeDisabled();

  // Real input: the wheel pans the outline and leaves the dialog where it was.
  const area = (await svg.boundingBox())!;
  await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
  const scroll = await d.evaluate((e) => e.scrollTop);
  const real = await vertex();
  await page.mouse.wheel(0, 40);
  await expect.poll(async () => (await vertex()).y).not.toBe(real.y);
  expect(await d.evaluate((e) => e.scrollTop)).toBe(scroll);
  await fitButton(d, "Fit outline").click();

  // Outside correction the dialog keeps its ordinary scrolling.
  await fitButton(d, "Correct outline").click();
  const quiet = await svg.getAttribute("viewBox");
  expect(await wheel({ dy: 40 })).toBe(false);
  expect(await wheel({ dy: -20, ctrl: true })).toBe(false);
  expect(await gesture("gesturestart", 1)).toBe(false);
  await gesture("gesturechange", 2);
  expect(await svg.getAttribute("viewBox")).toBe(quiet);
}

// Turning correction on adds only what it needs, without moving any button.
export async function checkCorrectionToggleKeepsControls(page: Page) {
  await page.goto("/");
  await pageReady(page);
  const d = await leafFit(page),
    svg = d.getByTestId("stroke-reference");
  const toggle = fitButton(d, "Correct outline");
  const steady = [
    svg,
    toggle,
    fitButton(d, "Use current curve"),
    fitButton(d, "Use example leaf"),
    fitButton(d, "Reset outline"),
    fitButton(d, "Close outline"),
    fitButton(d, "Undo correction"),
    fitButton(d, "Redo correction"),
    fitButton(d, "Restore original outline"),
  ];
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1000, height: 650 },
    { width: 430, height: 932 },
    { width: 412, height: 915 },
    { width: 390, height: 844 },
    { width: 360, height: 800 },
    { width: 320, height: 568 },
    { width: 844, height: 390 },
    { width: 568, height: 320 },
  ]) {
    await page.setViewportSize(size);
    const before = await Promise.all(steady.map(contentBox));
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    const during = await Promise.all(steady.map(contentBox));
    for (const [i, box] of during.entries())
      for (const key of ["x", "y", "width", "height"] as const)
        expect
          .soft(
            Math.abs(box[key] - before[i][key]),
            `${size.width}px: control ${i} ${key} stays put`,
          )
          .toBeLessThan(0.5);
    // The view controls share the toggle's row, directly under the canvas.
    const canvas = before[0],
      switcher = before[1];
    expect(switcher.y - canvas.y - canvas.height).toBeLessThanOrEqual(16);
    for (const name of [
      "Zoom in on outline",
      "Zoom out of outline",
      "Fit outline",
    ]) {
      const box = await contentBox(fitButton(d, name));
      expect
        .soft(
          Math.abs(box.y + box.height / 2 - switcher.y - switcher.height / 2),
          `${size.width}px: ${name} beside the toggle`,
        )
        .toBeLessThan(1);
      expect.soft(box.width).toBeGreaterThanOrEqual(40);
      expect.soft(box.x).toBeGreaterThan(switcher.x + switcher.width);
    }
    expect(await d.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    // Every button here is one height, none wrapped onto a second line.
    const heights = await d
      .locator(".fit-draft button:not(.help-toggle):visible")
      .evaluateAll((all) =>
        all.map((b) => [b.textContent, b.getBoundingClientRect().height]),
      );
    const usual = heights.find(([name]) => name === "Reset outline")![1];
    for (const [name, height] of heights)
      expect.soft(height, `${size.width}px: ${name} height`).toBe(usual);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(fitButton(d, "Fit outline")).toHaveCount(0);
    const after = await Promise.all(steady.map(contentBox));
    for (const [i, box] of after.entries())
      expect.soft(Math.abs(box.y - before[i].y)).toBeLessThan(0.5);
  }
}

// A button that its own press makes unavailable keeps the keyboard's place.
export async function checkDisablingKeepsFocus(page: Page) {
  await page.addInitScript(() => {
    const Native = Worker;
    (window as any).workers = 0;
    window.Worker = class extends Native {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        (window as any).workers++;
      }
    };
  });
  await page.setViewportSize({ width: 1000, height: 650 });
  await page.goto("/");
  await pageReady(page);
  const d = await leafFit(page),
    svg = d.getByTestId("stroke-reference");
  const focused = (locator: Locator) => expect(locator).toBeFocused();
  await fitButton(d, "Correct outline").click();
  const edit = async () => {
    await svg.focus();
    await svg.press("ArrowRight");
    await fitSettled(d);
  };
  await edit();
  const undo = fitButton(d, "Undo correction");
  await undo.focus();
  await page.keyboard.press("Enter");
  await expect(undo).toBeDisabled();
  await fitSettled(d);
  await focused(undo);
  // Dimmed like any disabled button, and inert to a further press.
  expect(await undo.evaluate((e) => getComputedStyle(e).opacity)).toBe("0.45");
  const workers = await page.evaluate(() => (window as any).workers);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  await fitSettled(d);
  expect(await page.evaluate(() => (window as any).workers)).toBe(workers);
  await focused(undo);
  await expect(fitButton(d, "Redo correction")).toBeEnabled();

  const redo = fitButton(d, "Redo correction");
  await redo.focus();
  await page.keyboard.press("Enter");
  await expect(redo).toBeDisabled();
  await fitSettled(d);
  await focused(redo);

  const restore = fitButton(d, "Restore original outline");
  await restore.focus();
  await page.keyboard.press("Space");
  await expect(restore).toBeDisabled();
  await fitSettled(d);
  await focused(restore);

  await fitButton(d, "Zoom in on outline").click();
  const out = fitButton(d, "Zoom out of outline");
  await out.focus();
  await page.keyboard.press("Enter");
  await expect(out).toBeDisabled();
  await focused(out);

  await fitButton(d, "Correct outline").click();
  const reset = fitButton(d, "Reset outline");
  await reset.focus();
  await page.keyboard.press("Enter");
  await expect(reset).toBeDisabled();
  await focused(reset);
  await page.keyboard.press("Enter");
  await focused(reset);

  await fitButton(d, "Use example leaf").click();
  const close = fitButton(d, "Close outline");
  await close.focus();
  await page.keyboard.press("Enter");
  await expect(close).toBeDisabled();
  await fitSettled(d);
  await focused(close);
  // Escape still reaches the dialog from a dimmed button.
  await page.keyboard.press("Escape");
  await expect(fitDialog(page)).toHaveCount(0);
}

// A press near the outline selects; only a deliberate drag corrects it.
export async function checkCorrectionDragThreshold(page: Page) {
  await page.setViewportSize({ width: 1000, height: 650 });
  await page.goto("/");
  await pageReady(page);
  const d = await leafFit(page),
    svg = d.getByTestId("stroke-reference");
  await fitButton(d, "Correct outline").click();
  await svg.scrollIntoViewIfNeeded();
  const polygon = svg.locator("polygon").first();
  const original = await polygon.getAttribute("points");
  const undo = fitButton(d, "Undo correction");
  const press = (
    type: string,
    path: [number, number][],
    release = true,
    index = 10,
  ) =>
    svg.evaluate(
      (e, { type, path, release, index }) => {
        const root = e as SVGSVGElement,
          p = root.querySelector("polygon")!.points.getItem(index);
        const at = new DOMPoint(p.x, p.y).matrixTransform(root.getScreenCTM()!);
        root.setPointerCapture = () => {};
        const send = (event: string, dx: number, dy: number) =>
          root.dispatchEvent(
            new PointerEvent(event, {
              bubbles: true,
              pointerId: 51,
              isPrimary: true,
              pointerType: type,
              button: 0,
              clientX: at.x + dx,
              clientY: at.y + dy,
            }),
          );
        send("pointerdown", 0, 0);
        for (const [dx, dy] of path) send("pointermove", dx, dy);
        if (release) send("pointerup", ...path.at(-1)!);
      },
      { type, path, release, index },
    );
  const vertex = (index: number) =>
    svg.evaluate((e, index) => {
      const p = (e as SVGSVGElement)
        .querySelector("polygon")!
        .points.getItem(index);
      return { x: p.x, y: p.y };
    }, index);
  const scale = await svg.evaluate(
    (e) => (e as SVGSVGElement).getScreenCTM()!.a,
  );
  // Tremor below the threshold selects the point and changes nothing else.
  let tried = 10;
  for (const [type, path] of [
    ["mouse", [[3, 2]]],
    ["pen", [[2, -3]]],
    ["touch", [[7, 0]]],
    [
      "touch",
      [
        [5, 5],
        [-4, -6],
        [0, 7],
      ],
    ],
    // Out and exactly back, once deliberate, is still no change.
    [
      "mouse",
      [
        [9, 0],
        [0, 0],
      ],
    ],
  ] as [string, [number, number][]][]) {
    tried++;
    await press(type, path, true, tried);
    await fitSettled(d);
    expect(await polygon.getAttribute("points"), `${type} tremor`).toBe(
      original,
    );
    await expect(undo).toBeDisabled();
    await expect(svg).toHaveAttribute("data-selected-point", String(tried));
  }
  // No drag preview until the threshold is crossed, then it stays.
  await press("touch", [[5, 0]], false);
  await expect(svg.locator(".fit-edit-vector")).toHaveCount(0);
  await svg.evaluate((e) => {
    const root = e as SVGSVGElement,
      p = root.querySelector("polygon")!.points.getItem(10);
    const at = new DOMPoint(p.x, p.y).matrixTransform(root.getScreenCTM()!);
    for (const [event, dx] of [
      ["pointermove", 9],
      ["pointermove", 2],
    ] as const)
      root.dispatchEvent(
        new PointerEvent(event, {
          bubbles: true,
          pointerId: 51,
          pointerType: "touch",
          clientX: at.x + dx,
          clientY: at.y,
        }),
      );
  });
  await expect(svg.locator(".fit-edit-vector")).toHaveCount(1);
  // Back within the threshold, a drag that was deliberate still commits, at
  // exactly the pointer's displacement.
  const start = await vertex(10);
  await svg.evaluate((e) => {
    const root = e as SVGSVGElement,
      p = root.querySelector("polygon")!.points.getItem(10);
    const at = new DOMPoint(p.x, p.y).matrixTransform(root.getScreenCTM()!);
    root.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        pointerId: 51,
        pointerType: "touch",
        clientX: at.x + 2,
        clientY: at.y,
      }),
    );
  });
  await fitSettled(d);
  await expect(undo).toBeEnabled();
  const landed = await vertex(10);
  expect(landed.x - start.x).toBeCloseTo(2 / scale, 6);
  await undo.click();
  await fitSettled(d);
  expect(await polygon.getAttribute("points")).toBe(original);
  // At the threshold it commits, without losing the distance it took to cross.
  for (const [type, dx] of [
    ["mouse", 4],
    ["pen", 4],
    ["touch", 8],
  ] as const) {
    const from = await vertex(10);
    await press(type, [[dx, 0]]);
    await fitSettled(d);
    await expect(undo).toBeEnabled();
    expect((await vertex(10)).x - from.x).toBeCloseTo(dx / scale, 6);
    await undo.click();
    await fitSettled(d);
    expect(await polygon.getAttribute("points")).toBe(original);
  }
}
