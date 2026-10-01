import { test, expect, type Page } from "@playwright/test";
import { open } from "./helpers";

// The progress slider snaps to steps of 0.001, so a frame paused between
// steps shows as the nearest one. Choosing that same step (Home at 0.0004,
// which already reads 0) fires no change, and once left the frame between
// steps for good. Every notebook's slider must still seek there.
const notebooks = [
  {
    name: "2D",
    path: "/",
    section: "#animation-section",
    progress: (page: Page) =>
      page.locator("#artwork").getAttribute("data-animation-progress"),
  },
  {
    name: "3D",
    path: "/?study=3d",
    section: "#spatial-animation-section",
    progress: (page: Page) =>
      page.locator(".spatial-stage").getAttribute("data-progress"),
  },
  {
    name: "4D",
    path: "/?study=4d",
    section: "#shape-animation-section",
    progress: (page: Page) =>
      page.locator(".tesseract-stage").getAttribute("data-progress"),
  },
];

for (const n of notebooks)
  test(`the ${n.name} progress slider seeks to the start from just after it`, async ({
    page,
  }) => {
    await page.goto(n.path);
    await open(page, n.section);
    const section = page.locator(n.section);
    const at = async () => Number(await n.progress(page));
    // An hour long: pausing within 1.8 s of the start leaves the frame
    // before the slider's first step.
    await section.getByLabel("Duration (seconds)").fill("3600");
    const slider = page.getByRole("slider", { name: "Animation progress" });
    const pauseEarly = async (play: string) => {
      await section.getByRole("button", { name: play, exact: true }).click();
      await expect.poll(at).toBeGreaterThan(0);
      await section.getByRole("button", { name: "Pause", exact: true }).click();
      const p = await at();
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThan(0.0005);
      await expect(slider).toHaveValue("0");
    };
    // The Home key.
    await pauseEarly("Play animation");
    await slider.focus();
    await page.keyboard.press("Home");
    await expect.poll(at).toBe(0);
    // A click at the slider's start.
    await pauseEarly("Resume");
    const box = (await slider.boundingBox())!;
    await page.mouse.click(box.x + 1, box.y + box.height / 2);
    await expect.poll(at).toBe(0);
  });
