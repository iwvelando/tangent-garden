import { test, expect, type Page } from "@playwright/test";
import { openAnimation, choosePreset } from "./helpers";

// The 2D drawing's keyboard camera, mirroring the 3D and 4D drawings' keys:
// arrows (with or without shift) pan by 20 page units of the 1000 × 760
// page, + or = and − zoom by 1.1 about the middle of the drawing, and Home
// fits the view, as Fit view does.
const artwork = (page: Page) => page.locator("#artwork");
async function ready(page: Page, preset = "1") {
  await page.goto("/");
  await expect(artwork(page)).toBeVisible();
  await choosePreset(page, preset);
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
}
// The camera's scale (page units per plot unit) and the plot point at the
// middle of the drawing.
async function camera(page: Page) {
  const svg = artwork(page);
  const [x, y] = (await svg.getAttribute("data-camera-center"))!
    .split(",")
    .map(Number);
  return { scale: Number(await svg.getAttribute("data-camera-scale")), x, y };
}
async function press(page: Page, ...keys: string[]) {
  for (const key of keys) await page.keyboard.press(key);
}

test("arrow keys pan, plus and minus zoom about the middle, and Home fits the view", async ({
  page,
}) => {
  await ready(page);
  await expect(artwork(page)).toHaveAttribute("tabindex", "0");
  await expect(artwork(page)).toHaveAttribute(
    "aria-label",
    /arrow keys to pan.*plus and minus to zoom.*Home fits the view/,
  );
  await expect(page.locator(".plot-meta")).toContainText(
    "keys: arrows, + / −, Home",
  );
  const fitted = await camera(page);
  await artwork(page).focus();
  // The drawing moves with the arrow: right moves it right, so the middle
  // of the page shows a point further left; down moves it down.
  await press(page, "ArrowRight", "ArrowRight", "ArrowDown");
  let c = await camera(page);
  expect(c.scale).toBe(fitted.scale);
  expect(c.x).toBeCloseTo(fitted.x - 40 / fitted.scale, 9);
  expect(c.y).toBeCloseTo(fitted.y + 20 / fitted.scale, 9);
  // Shift pans too, as a 3D drawing's shift-arrows do.
  await press(page, "Shift+ArrowLeft", "ArrowUp");
  c = await camera(page);
  expect(c.x).toBeCloseTo(fitted.x - 20 / fitted.scale, 9);
  expect(c.y).toBeCloseTo(fitted.y, 9);
  // Zooming keeps the point at the middle where it is.
  const before = c;
  await press(page, "+", "=");
  c = await camera(page);
  expect(c.scale).toBeCloseTo(fitted.scale * 1.21, 9);
  expect(c.x).toBeCloseTo(before.x, 9);
  expect(c.y).toBeCloseTo(before.y, 9);
  // Panning after a zoom moves by 20 page units at the new scale.
  await press(page, "ArrowLeft");
  expect((await camera(page)).x).toBeCloseTo(before.x + 20 / c.scale, 9);
  await press(page, "-", "-", "-");
  c = await camera(page);
  expect(c.scale).toBeCloseTo(fitted.scale / 1.1, 9);
  await press(page, "Home");
  await expect(artwork(page)).toHaveAttribute(
    "data-camera-scale",
    String(fitted.scale),
  );
  expect(await camera(page)).toEqual(fitted);
  // Other keys are left to the page.
  const ignored = await artwork(page).evaluate((svg) => {
    const e = new KeyboardEvent("keydown", {
      key: "a",
      bubbles: true,
      cancelable: true,
    });
    svg.dispatchEvent(e);
    return !e.defaultPrevented;
  });
  expect(ignored).toBe(true);
});

test("zoom keys stop at the wheel's limits", async ({ page }) => {
  await ready(page);
  const fitted = await camera(page);
  await artwork(page).focus();
  for (let i = 0; i < 40; i++) await page.keyboard.press("+");
  expect((await camera(page)).scale).toBeCloseTo(fitted.scale * 20, 9);
  for (let i = 0; i < 70; i++) await page.keyboard.press("-");
  expect((await camera(page)).scale).toBeCloseTo(fitted.scale * 0.1, 9);
});

test("keys hold still while an animation plays and explore the finished one", async ({
  page,
}) => {
  await ready(page);
  // The manual camera, moved away from the fitted one before playing.
  await artwork(page).focus();
  await press(page, "ArrowLeft", "-");
  const manual = await camera(page);
  await openAnimation(page);
  // A held animation pauses part way: its camera is the animation's.
  await page.getByRole("spinbutton", { name: "Duration (seconds)" }).fill("30");
  await page.getByRole("button", { name: "Play animation" }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const held = await camera(page);
  await artwork(page).focus();
  await press(page, "ArrowRight", "+");
  expect(await camera(page)).toEqual(held);
  // At its end the camera is released, and the keys explore it; Home
  // returns to the animation's framing.
  await page
    .getByRole("slider", { name: "Animation progress", exact: true })
    .press("End");
  await expect
    .poll(async () =>
      Number(await artwork(page).getAttribute("data-animation-progress")),
    )
    .toBe(1);
  const final = await camera(page);
  await artwork(page).focus();
  await press(page, "ArrowRight", "+");
  const explored = await camera(page);
  expect(explored.scale).toBeCloseTo(final.scale * 1.1, 9);
  expect(explored.x).toBeCloseTo(final.x - 20 / final.scale, 9);
  await press(page, "Home");
  expect(await camera(page)).toEqual(final);
  // Back to study restores the manual camera, untouched by the keys
  // pressed while the animation held the camera or was explored.
  await press(page, "ArrowDown");
  await page
    .getByRole("button", { name: "Back to study", exact: true })
    .click();
  await expect(artwork(page)).not.toHaveAttribute("data-animation-progress");
  expect(await camera(page)).toEqual(manual);
});
