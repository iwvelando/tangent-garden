import { test, expect } from "@playwright/test";
import {
  chooseNotebook,
  choosePreset,
  openShapeAnimation,
  openShapeExport,
} from "./helpers";

for (const width of [320, 390, 1440]) {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`study menu and shared viewport controls at ${width}px in ${colorScheme}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme });
      await page.goto("/");
      const choice = (name: string) =>
        page
          .locator(".app:visible")
          .getByRole("radio", { name: `${name} studies` });
      await expect(choice("2D")).toBeChecked();
      await choice("2D").focus();
      await page.keyboard.press("ArrowLeft");
      await expect(page.locator("#tesseract-artwork")).toBeVisible();
      await expect(choice("4D")).toBeFocused();
      await expect(choice("4D")).toBeChecked();
      const buttons = page.locator(".app:visible .header-actions");
      const row = await buttons
        .locator(":scope > button, :scope > div > button")
        .evaluateAll((es) =>
          es.map(
            (e) =>
              e.getBoundingClientRect().y +
              e.getBoundingClientRect().height / 2,
          ),
        );
      expect(Math.max(...row) - Math.min(...row)).toBeLessThan(2);
      await expect(page.locator("#shape-animation-section")).toHaveAttribute(
        "open",
      );
      const paper = colorScheme === "dark" ? "#0b1517" : "#f3f1ea";
      await expect(
        page.locator("#tesseract-artwork > rect").first(),
      ).toHaveAttribute("fill", paper);
      const text = await page
        .locator(".app:visible .plot-meta > span")
        .innerText();
      const labels = await page
        .locator(".app:visible .view-buttons button")
        .allTextContents();
      await page.screenshot({ path: info.outputPath("4d-controls.png") });
      await chooseNotebook(page, "3d");
      await expect(page.locator("#spatial-artwork")).toBeVisible();
      expect(
        await page
          .locator(".app:visible .view-buttons button")
          .allTextContents(),
      ).toEqual(labels);
      // The same gestures; the 3D notebook names its projection in the
      // Projection menu instead of the caption.
      await expect(page.locator(".app:visible .plot-meta > span")).toHaveText(
        text.replace(/^Orthographic · drag/, "Drag"),
      );
      await expect(page.getByLabel("Projection", { exact: true })).toHaveValue(
        "orthographic",
      );
    });
  }
}

test("4D rotation, reset, keyboard framing, and animation preserve the manual view", async ({
  page,
}) => {
  await page.goto("/?study=4d");
  const art = page.locator("#tesseract-artwork");
  await expect(art).toBeVisible();
  const view = async () =>
    JSON.parse((await art.locator("desc").textContent())!).view;
  const initial = await view();
  await page.getByRole("button", { name: "Rotate view", exact: true }).click();
  await expect
    .poll(async () => (await view()).yaw)
    .toBeGreaterThan(initial.yaw + 0.02);
  await page
    .getByRole("button", { name: "Pause rotation", exact: true })
    .click();
  const paused = await view();
  await page.waitForTimeout(100);
  expect(await view()).toEqual(paused);
  await page.getByRole("button", { name: "Reset view", exact: true }).click();
  expect(await view()).toEqual(initial);
  await art.focus();
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("+");
  const manual = await view();
  expect(manual.panX).toBeGreaterThan(initial.panX);
  expect(manual.zoom).toBeGreaterThan(initial.zoom);
  await openShapeAnimation(page);
  await page.getByRole("button", { name: "Play animation" }).click();
  await expect(
    page.getByRole("button", { name: "Rotate view", exact: true }),
  ).toBeDisabled();
  await art.focus();
  await page.keyboard.press("Home");
  expect(await view()).toEqual(manual);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("slider", { name: "Animation progress" }).fill("0.7");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.locator(".tesseract-stage")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  expect(await view()).toEqual(manual);
});

test("4D animation adapts to the study and shares export defaults, limits and disclosure persistence", async ({
  page,
}) => {
  await page.goto("/?study=4d");
  await expect(page.locator("#tesseract-artwork")).toBeVisible();
  await openShapeExport(page);
  const animate = page.getByRole("combobox", { name: "Animate", exact: true });
  await expect(animate.locator("option")).toHaveCount(2);
  await choosePreset(page, { label: "An octahedron within" });
  await expect(animate).toHaveValue("slice");
  await expect(animate.locator("option")).toHaveCount(3);
  await page
    .getByRole("combobox", { name: "View of the tesseract" })
    .selectOption("stereo");
  await expect(animate).toHaveValue("double");
  await expect(animate.locator("option")).toHaveCount(2);
  const scale = page.getByRole("slider", {
    name: "Export resolution",
    exact: true,
  });
  const quality = page.getByRole("slider", {
    name: "Export quality",
    exact: true,
  });
  const fps = page.getByRole("combobox", { name: "Export frame rate" });
  await expect(scale).toHaveValue("2");
  await expect(quality).toHaveValue("60");
  await fps.selectOption("60");
  await page
    .getByRole("combobox", { name: "Export format" })
    .selectOption("webp");
  await expect(quality).toHaveValue("85");
  // 60 fps stays chosen for WebP, which says what it costs.
  await expect(fps).toHaveValue("60");
  await expect(fps.locator('option[value="60"]')).toHaveText(
    "60 fps · larger file",
  );
  await expect(
    page
      .locator("#shape-export-settings")
      .getByText("WebP stores every frame whole"),
  ).toBeVisible();
  await fps.selectOption("30");
  await scale.fill("0.75");
  await quality.fill("42");
  await page.getByRole("button", { name: /Reset export settings/ }).click();
  await expect(scale).toHaveValue("2");
  await expect(quality).toHaveValue("85");
  await page
    .getByRole("spinbutton", { name: "Duration (seconds)" })
    .fill("1000");
  await expect(
    page.getByRole("button", { name: /Export animated WebP/ }),
  ).toBeDisabled();
  await expect(
    page.getByText("Export is limited to 7,200 frames.", { exact: false }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator("#shape-animation-section")).toHaveAttribute(
    "open",
  );
  await expect(page.locator("#shape-export-settings")).toHaveAttribute("open");
});
