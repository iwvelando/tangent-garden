import { test, expect, type Page } from "@playwright/test";
import { choosePreset, imageButton, open, openExportSettings } from "./helpers";

// Exports offer only the sizes this device can draw, in every notebook:
// still sizes in the Export image menu, and the animation export
// resolution. No file is encoded here; the refusals after a click are in
// still-export.spec.ts.

// A device whose canvases past an area come back with no context, as iOS
// Safari's do, and whose WebGL limits are lower than this machine's. Set
// before the page loads, since a notebook reads its limits once.
type Device = { area?: number; renderbuffer?: number; texture?: number };
async function device(page: Page, limits: Device) {
  await page.addInitScript((limits: Device) => {
    if (limits.area) {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        ...args: Parameters<typeof original>
      ) {
        if (args[0] === "2d" && this.width * this.height > limits.area!)
          return null;
        return original.apply(this, args);
      } as typeof original;
    }
    const real = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (
      this: WebGLRenderingContext,
      name: number,
    ) {
      const value = real.call(this, name);
      if (name === this.MAX_RENDERBUFFER_SIZE && limits.renderbuffer)
        return Math.min(value, limits.renderbuffer);
      if (name === this.MAX_TEXTURE_SIZE && limits.texture)
        return Math.min(value, limits.texture);
      return value;
    };
  }, limits);
}

const menu = (page: Page) => page.getByRole("menu", { name: "Export image" });
async function offered(page: Page) {
  await imageButton(page).click();
  const sizes = await menu(page).getByRole("menuitemradio").allTextContents();
  const png = await menu(page)
    .getByRole("menuitem", { name: /^PNG image/ })
    .textContent();
  const checked = await menu(page)
    .getByRole("menuitemradio", { checked: true })
    .allTextContents();
  await page.keyboard.press("Escape");
  return { sizes, png, checked };
}

const planar = async (page: Page) => {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await expect(imageButton(page)).toBeEnabled();
};
const spatialSettled = (page: Page) =>
  expect(page.locator(".spatial-stage")).toHaveAttribute("aria-busy", "false");
const spatial = async (page: Page, label: string) => {
  await page.goto("/?study=3d");
  await spatialSettled(page);
  await choosePreset(page, { label });
  await spatialSettled(page);
  await expect(imageButton(page)).toBeEnabled();
};
const fourSettled = (page: Page) =>
  expect(page.locator(".tesseract-stage")).toHaveAttribute(
    "aria-busy",
    "false",
  );
const four = async (page: Page) => {
  await page.goto("/?study=4d");
  await fourSettled(page);
  await expect(imageButton(page)).toBeEnabled();
};

test("an unlimited device is offered every still size", async ({ page }) => {
  await planar(page);
  expect(await offered(page)).toEqual({
    sizes: ["1000 × 760", "2000 × 1520", "3000 × 2280", "4000 × 3040"],
    png: "PNG image · 2000 × 1520",
    checked: ["2000 × 1520"],
  });
});

test("2D still sizes past the canvas area are not offered", async ({
  page,
}) => {
  await device(page, { area: 8_000_000 });
  await planar(page);
  expect(await offered(page)).toEqual({
    sizes: ["1000 × 760", "2000 × 1520", "3000 × 2280"],
    png: "PNG image · 2000 × 1520",
    checked: ["2000 × 1520"],
  });
});

test("a chosen size that does not fit falls back to the largest that does", async ({
  page,
}) => {
  await device(page, { area: 2_000_000 });
  await planar(page);
  expect(await offered(page)).toEqual({
    sizes: ["1000 × 760"],
    png: "PNG image · 1000 × 760",
    checked: ["1000 × 760"],
  });
});

test("a 4D pair offers only the sizes its canvas can hold", async ({
  page,
}) => {
  await device(page, { area: 8_000_000 });
  await four(page);
  await choosePreset(page, { label: "Beside the wall" });
  await fourSettled(page);
  await page
    .getByRole("combobox", { name: "View operation", exact: true })
    .selectOption("paired");
  await fourSettled(page);
  expect(await offered(page)).toEqual({
    sizes: ["2000 × 760", "4000 × 1520"],
    png: "PNG image · 4000 × 1520",
    checked: ["4000 × 1520"],
  });
});

test("3D still sizes stop at the WebGL page limit", async ({ page }) => {
  await device(page, { renderbuffer: 2500 });
  await spatial(page, "Trefoil · (2, 3)");
  expect((await offered(page)).sizes).toEqual(["1000 × 760", "2000 × 1520"]);
});

test("see-through sheets add the texture limit, and only for them", async ({
  page,
}) => {
  await device(page, { texture: 3500 });
  await spatial(page, "Trefoil · (2, 3)");
  expect((await offered(page)).sizes).toHaveLength(4);
  await choosePreset(page, { label: "A Klein bottle passing through itself" });
  await spatialSettled(page);
  expect((await offered(page)).sizes).toEqual([
    "1000 × 760",
    "2000 × 1520",
    "3000 × 2280",
  ]);
});

test("a transparent 3D still also needs a canvas of its size", async ({
  page,
}) => {
  await device(page, { area: 8_000_000 });
  await spatial(page, "Trefoil · (2, 3)");
  await imageButton(page).click();
  const radios = menu(page).getByRole("menuitemradio");
  await expect(radios).toHaveCount(4);
  await radios.nth(3).click();
  const box = menu(page).getByRole("menuitemcheckbox", {
    name: "Transparent background",
  });
  await box.click();
  await expect(radios).toHaveText(["1000 × 760", "2000 × 1520", "3000 × 2280"]);
  await expect(
    menu(page).getByRole("menuitem", { name: /^PNG image/ }),
  ).toHaveText("PNG image · 3000 × 2280, transparent");
  // The choice is kept: opaque again, the page is 4000 × 3040.
  await box.click();
  await expect(radios).toHaveCount(4);
  await expect(
    menu(page).getByRole("menuitem", { name: /^PNG image/ }),
  ).toHaveText("PNG image · 4000 × 3040");
});

test("keyboard navigation wraps after still sizes shrink and expand", async ({
  page,
}) => {
  await device(page, { area: 8_000_000 });
  await spatial(page, "Trefoil · (2, 3)");
  await imageButton(page).click();
  const box = menu(page).getByRole("menuitemcheckbox", {
    name: "Transparent background",
  });
  const navigate = async () => {
    const buttons = menu(page).locator("button");
    const count = await buttons.count();
    await page.keyboard.press("Home");
    for (let i = 0; i < count; i++) {
      await expect(buttons.nth(i)).toBeFocused();
      await page.keyboard.press("ArrowDown");
    }
    await expect(buttons.first()).toBeFocused();
    for (let i = count - 1; i >= 0; i--) {
      await page.keyboard.press("ArrowUp");
      await expect(buttons.nth(i)).toBeFocused();
    }
    await page.keyboard.press("End");
    await expect(box).toBeFocused();
  };
  await navigate();
  for (const count of [3, 4, 3]) {
    await box.click();
    await expect(menu(page).getByRole("menuitemradio")).toHaveCount(count);
    await navigate();
  }
  await page.keyboard.press("Escape");
  await expect(imageButton(page)).toBeFocused();
  await imageButton(page).click();
  await navigate();
});

const resolution = (page: Page) =>
  page.getByRole("slider", { name: "Export resolution", exact: true });

test("an unlimited device can export animations up to 200%", async ({
  page,
}) => {
  await planar(page);
  await openExportSettings(page);
  await expect(resolution(page)).toHaveAttribute("max", "2");
  await expect(resolution(page)).toHaveValue("2");
});

test("2D animation resolution stops where the canvas does", async ({
  page,
}) => {
  await device(page, { area: 2_000_000 });
  await planar(page);
  await openExportSettings(page);
  const slider = resolution(page);
  await expect(slider).toHaveAttribute("max", "1.5");
  await expect(slider).toHaveValue("1.5");
  await expect(slider).toHaveAttribute("aria-valuetext", "1500 by 1140 pixels");
  const field = page.locator("#export-settings");
  await field
    .getByRole("button", { name: "About Export resolution", exact: true })
    .click();
  await field.getByRole("button", { name: "Show more" }).click();
  await expect(field).toContainText(
    "This device draws animations at most 1500 × 1140.",
  );
});

test("3D animation resolution stops at the WebGL page limit", async ({
  page,
}) => {
  await device(page, { renderbuffer: 1600 });
  await spatial(page, "Trefoil · (2, 3)");
  await open(page, "#spatial-animation-section");
  await open(page, "#spatial-export-settings");
  await expect(resolution(page)).toHaveAttribute("max", "1.5");
  await expect(resolution(page)).toHaveAttribute(
    "aria-valuetext",
    "1500 by 1140 pixels",
  );
});

test("4D animation resolution stops where the canvas does", async ({
  page,
}) => {
  await device(page, { area: 2_000_000 });
  await four(page);
  await open(page, "#shape-animation-section");
  await open(page, "#shape-export-settings");
  await expect(resolution(page)).toHaveAttribute("max", "1.5");
  await expect(resolution(page)).toHaveAttribute(
    "aria-valuetext",
    "1500 by 1140 pixels",
  );
});

for (const notebook of ["2D", "3D", "4D", "4D paired"] as const) {
  test(`${notebook} resets animation exports to this device's available defaults`, async ({
    page,
  }) => {
    await device(page, { area: 2_000_000, renderbuffer: 1600 });
    if (notebook === "2D") {
      await planar(page);
      await openExportSettings(page);
    } else if (notebook === "3D") {
      await spatial(page, "Trefoil · (2, 3)");
      await open(page, "#spatial-animation-section");
      await open(page, "#spatial-export-settings");
    } else {
      await four(page);
      if (notebook === "4D paired") {
        await choosePreset(page, { label: "Beside the wall" });
        await fourSettled(page);
        await page
          .getByRole("combobox", { name: "View operation", exact: true })
          .selectOption("paired");
        await fourSettled(page);
      }
      await open(page, "#shape-animation-section");
      await open(page, "#shape-export-settings");
    }
    const reset = page.getByRole("button", { name: /^Reset export settings/ });
    const quality = page.getByRole("slider", {
      name: "Export quality",
      exact: true,
    });
    const format = page.getByRole("combobox", { name: "Export format" });
    await expect(format).toBeVisible();
    const paired = notebook === "4D paired";
    const size = paired ? "2000 × 760" : "1500 × 1140";
    const scale = paired ? "1" : "1.5";
    for (const [encoding, defaultQuality] of [
      ["mp4", "60"],
      ["webp", "85"],
    ]) {
      await format.selectOption(encoding);
      await expect(reset).toHaveText(
        `Reset export settings to ${size} · quality ${defaultQuality}`,
      );
      await expect(reset).toBeDisabled();
      await resolution(page).fill("0.5");
      await quality.fill("70");
      await expect(reset).toBeEnabled();
      await reset.click();
      await expect(resolution(page)).toHaveValue(scale);
      await expect(quality).toHaveValue(defaultQuality);
      await expect(reset).toBeDisabled();
    }
    if (paired) {
      // Reset keeps the full default choice for a view with more room.
      await page
        .getByRole("combobox", { name: "View operation", exact: true })
        .selectOption("diagram");
      await fourSettled(page);
      await expect(resolution(page)).toHaveValue("1.5");
      await expect(reset).toHaveText(
        "Reset export settings to 1500 × 1140 · quality 85",
      );
      await expect(reset).toBeDisabled();
    }
  });
}
