import { test, expect, type Page } from "@playwright/test";
async function ready(page: Page) {
  await page.goto("/?study=3d");
  await expect(page.locator("#spatial-artwork")).toBeVisible();
  await expect(page.locator(".spatial-stage")).toHaveAttribute(
    "aria-busy",
    "false",
  );
}
async function pixels(page: Page) {
  return page
    .locator("canvas")
    .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
}
test("spatial construction renders, orbits, zooms, layers, and resets", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await ready(page);
  const canvas = page.locator("canvas");
  const original = await pixels(page);
  // A functioning context must draw substantial geometry, not just a canvas.
  const colors = await canvas.evaluate((canvas: HTMLCanvasElement) => {
    const gl = canvas.getContext("webgl")!;
    const data = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(
      0,
      0,
      canvas.width,
      canvas.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      data,
    );
    let distinct = 0;
    for (let i = 0; i < data.length; i += 4)
      if (
        Math.abs(data[i] - data[0]) +
          Math.abs(data[i + 1] - data[1]) +
          Math.abs(data[i + 2] - data[2]) >
        60
      )
        distinct++;
    return distinct / (canvas.width * canvas.height);
  });
  expect(colors).toBeGreaterThan(0.03);
  await canvas.focus();
  await page.keyboard.press("ArrowRight");
  expect(await pixels(page)).not.toBe(original);
  await page.getByRole("button", { name: "Reset view" }).click();
  expect(await pixels(page)).toBe(original);
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 80,
    box.y + box.height / 2 + 25,
  );
  await page.mouse.up();
  expect(await pixels(page)).not.toBe(original);
  await page.getByRole("button", { name: "Reset view" }).click();
  await canvas.hover();
  await page.mouse.wheel(0, -200);
  await expect.poll(() => pixels(page)).not.toBe(original);
  await page.getByRole("button", { name: "Reset view" }).click();
  await page.getByLabel("Ribbon surface", { exact: true }).uncheck();
  expect(await pixels(page)).not.toBe(original);
  await page.getByLabel("Ribbon surface", { exact: true }).check();
  expect(await pixels(page)).toBe(original);
  await page.getByRole("button", { name: "Rotate view", exact: true }).click();
  await expect.poll(() => pixels(page)).not.toBe(original);
  await page
    .getByRole("button", { name: "Pause rotation", exact: true })
    .click();
  const paused = await pixels(page);
  await page.waitForTimeout(100);
  expect(await pixels(page)).toBe(paused);
  for (const preset of ["1", "2", "0"]) {
    await page.getByLabel("Starting curve").selectOption(preset);
    await expect(page.locator(".spatial-stage")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});
test("counts, invalid input, pending scalar replacement and desktop scrolling", async ({
  page,
}) => {
  await ready(page);
  await page.getByText("Sampling & definition", { exact: true }).click();
  await page.getByLabel("Curve samples", { exact: true }).fill("721");
  await page.getByLabel("Tangent lines", { exact: true }).fill("117");
  await expect(page.getByRole("status")).toHaveText(
    "721 samples · 117 tangents",
  );
  await page.getByLabel("Curve samples", { exact: true }).fill("240.5");
  await expect(page.getByRole("alert")).toContainText("whole numbers");
  await page.getByLabel("Curve samples", { exact: true }).fill("2401");
  await expect(page.getByRole("alert")).toContainText("240–2400");
  await page.getByLabel("Curve samples", { exact: true }).fill("721");
  await page
    .getByRole("textbox", { name: "Major radius R", exact: true })
    .fill("phi+2");
  await page.getByLabel("Starting curve").selectOption("1");
  await expect(
    page.getByRole("textbox", { name: "Major radius R", exact: true }),
  ).toHaveValue("2.4");
  await expect(page.locator(".spatial-stage")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  const bounds = await page.locator("canvas").boundingBox();
  await page.locator(".spatial-controls").hover();
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(100);
  expect(await page.locator("canvas").boundingBox()).toEqual(bounds);
});
test("themes follow system, persist choices, and tolerate denied storage", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await ready(page);
  await expect(page.locator(".spatial-app")).toHaveClass(/dark/);
  const dark = await pixels(page);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator(".spatial-app")).not.toHaveClass(/dark/);
  expect(await pixels(page)).not.toBe(dark);
  await page.getByRole("button", { name: "Use dark background" }).click();
  await page.reload();
  await expect(page.locator(".spatial-app")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "Follow system" }).click();
  await expect(page.locator(".spatial-app")).not.toHaveClass(/dark/);
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("Denied");
      },
    });
  });
  await ready(page);
  await page.getByRole("button", { name: "Use dark background" }).click();
  await expect(page.locator(".spatial-app")).toHaveClass(/dark/);
});
test("narrow screens retain artwork, touch orbit, and controls without overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  const canvas = page.locator("canvas");
  const original = await pixels(page);
  const touch = await page.context().newCDPSession(page);
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: 180, y: 250 }],
  });
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: 230, y: 290 }],
  });
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  expect(await pixels(page)).not.toBe(original);
  await page
    .getByRole("textbox", { name: "Tangent reach L", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("textbox", { name: "Tangent reach L", exact: true }),
  ).toBeVisible();
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    const artwork = (await canvas.boundingBox())!;
    const controls = (await page.locator(".spatial-controls").boundingBox())!;
    const explanation = (await page
      .locator(".spatial-explanation")
      .boundingBox())!;
    expect(controls.y).toBeGreaterThan(artwork.y + artwork.height);
    expect(explanation.y).toBeGreaterThan(controls.y);
    expect(
      await page.evaluate(
        () =>
          getComputedStyle(document.querySelector(".spatial-app")!).overflow,
      ),
    ).toBe("visible");
  }
});
