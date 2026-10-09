import { test, expect, type Page } from "@playwright/test";
import { chooseNotebook, choosePreset } from "./helpers";
const artwork = (page: Page) => page.locator("#spatial-artwork");
const stage = (page: Page) => page.locator(".spatial-stage");
async function ready(page: Page) {
  await page.goto("/?study=3d");
  await expect(artwork(page)).toBeVisible();
  await expect(stage(page)).toHaveAttribute("aria-busy", "false");
}
const pixels = (page: Page) =>
  artwork(page).evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
const view = async (page: Page) =>
  JSON.parse((await artwork(page).getAttribute("data-view"))!);
// The browser's own loss and restoration of the drawing's context, as a
// driver crash or a GPU reset would cause.
const lose = (page: Page) =>
  artwork(page).evaluate((canvas: HTMLCanvasElement) => {
    const extension = canvas
      .getContext("webgl")!
      .getExtension("WEBGL_lose_context")!;
    (window as unknown as { lost: WEBGL_lose_context }).lost = extension;
    extension.loseContext();
  });
const restore = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { lost: WEBGL_lose_context }).lost.restoreContext(),
  );

test("a lost 3D context is rebuilt on restore with the camera kept", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await ready(page);
  const canvas = artwork(page);
  await canvas.focus();
  for (const key of ["ArrowRight", "ArrowRight", "ArrowUp", "+"])
    await page.keyboard.press(key);
  const camera = await view(page),
    drawn = await pixels(page);
  expect(camera.yaw).not.toBe(0);

  await lose(page);
  await expect(page.getByRole("alert")).toContainText("context was lost");
  await expect(page.getByRole("alert")).not.toContainText("Reload");
  // The camera still answers while nothing can be drawn, without errors.
  await canvas.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowRight");

  await restore(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect.poll(() => pixels(page)).toBe(drawn);
  expect(await view(page)).toEqual(camera);
  // It keeps answering the camera after the restore.
  await canvas.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => pixels(page)).not.toBe(drawn);
  expect(errors).toEqual([]);
});

test("a context restored after a study change draws the current study", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await ready(page);
  await choosePreset(page, "1");
  await expect(stage(page)).toHaveAttribute("aria-busy", "false");
  const expected = await pixels(page);
  await choosePreset(page, "0");
  await expect(stage(page)).toHaveAttribute("aria-busy", "false");
  expect(await pixels(page)).not.toBe(expected);

  await lose(page);
  await expect(page.getByRole("alert")).toContainText("context was lost");
  // The 2D notebook stays usable while the 3D context is lost.
  await chooseNotebook(page, "2d");
  await expect(page.locator("#artwork")).toBeVisible();
  await chooseNotebook(page, "3d");
  await expect(artwork(page)).toBeVisible();
  await choosePreset(page, "1");
  await restore(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(stage(page)).toHaveAttribute("aria-busy", "false");
  await expect.poll(() => pixels(page)).toBe(expected);
  expect(errors).toEqual([]);
});
