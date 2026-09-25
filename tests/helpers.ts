import type { Page } from "@playwright/test";

// The animation section and its export settings start collapsed, so tests that
// drive them open the disclosures first. Opening an open section is a no-op.
export async function openAnimation(page: Page) {
  await open(page, "#animation-section");
}

export async function openExportSettings(page: Page) {
  await openAnimation(page);
  await open(page, "#export-settings");
}

async function open(page: Page, selector: string) {
  const details = page.locator(selector);
  if ((await details.getAttribute("open")) === null)
    await details.locator(":scope > summary").click();
}

export const imageButton = (page: Page) =>
  page.getByRole("button", { name: "Export image" });

// Still-image exports live in the header's Export image menu.
export async function exportImage(page: Page, kind: "PNG" | "SVG") {
  await imageButton(page).click();
  await page.getByRole("menuitem", { name: new RegExp(`^${kind}`) }).click();
}
