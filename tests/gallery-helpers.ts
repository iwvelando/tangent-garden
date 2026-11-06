import { expect, type Page } from "@playwright/test";
import { wireStudy } from "./study-link-wire";

// Shared by gallery.spec.ts (the gallery and its atlas) and journeys.spec.ts,
// split so that no one file holds a CI shard near its time limit
// (docs/contributing.md, CI shards).

export const gallery = (page: Page) =>
  page.getByRole("dialog", { name: "Notebook examples" });

export const heading = (page: Page) =>
  page.locator(".app:visible .plot-heading");

export const journeyTitles = [
  "Light finding a cusp",
  "Threads becoming surfaces",
  "Order inside apparent chaos",
  "A glimpse of four dimensions",
  "What a shadow leaves out",
  "A thread learns the surface",
  "Rules that grow a garden",
];

export async function settled(page: Page) {
  await expect(
    page.locator(
      ".app:visible .plot-wrap[aria-busy], .app:visible .spatial-stage",
    ),
  ).toHaveAttribute("aria-busy", "false");
}

// Copy link is disabled while a study computes, and settled() can return on
// the previous state just before an action's computation starts. Under load
// a click checked against the enabled button then landed on it disabled, so
// no click reached it; click again until one does.
export async function copiedStudy(page: Page) {
  const button = page.getByRole("button", { name: "Copy link", exact: true });
  await expect(async () => {
    const reached = button.evaluate(
      (b) =>
        new Promise<boolean>((resolve) => {
          b.addEventListener("click", () => resolve(true), { once: true });
          setTimeout(() => resolve(false), 1000);
        }),
    );
    await button.click();
    expect(await reached).toBe(true);
  }).toPass({ timeout: 15_000 });
  await expect(page.getByText("Link copied", { exact: true })).toBeVisible();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  await page.mouse.click(1, 1);
  return { url, study: wireStudy(url.split("#s=")[1]) };
}
