import type { Page } from "@playwright/test";

// The animation section starts open and its export settings collapsed, and a
// visitor's choice is remembered, so tests that drive them open the
// disclosures first. Opening an open section is a no-op.
export async function openAnimation(page: Page) {
  await open(page, "#animation-section");
}

export async function openExportSettings(page: Page) {
  await openAnimation(page);
  await open(page, "#export-settings");
}

export async function open(page: Page, selector: string) {
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

// Examples are chosen from the gallery dialog: by index into the notebook's
// preset list, or by title.
export const examplesButton = (page: Page) =>
  page.getByRole("button", { name: "Browse notebook examples" });

export async function choosePreset(
  page: Page,
  which: string | number | { label: string },
) {
  await examplesButton(page).click();
  const gallery = page.getByRole("dialog", { name: "Notebook examples" });
  await gallery
    .locator(
      typeof which === "object"
        ? `[data-example-title="${which.label.replace(/"/g, '\\"')}"]`
        : `[data-example="${which}"]`,
    )
    .click();
  await gallery.waitFor({ state: "hidden" });
}

// Every example's title, in preset order.
export async function exampleTitles(page: Page) {
  await examplesButton(page).click();
  const gallery = page.getByRole("dialog", { name: "Notebook examples" });
  const titles = await gallery
    .locator("[data-example]")
    .evaluateAll((cards) =>
      cards.map((c) => (c as HTMLElement).dataset.exampleTitle!),
    );
  await page.keyboard.press("Escape");
  await gallery.waitFor({ state: "hidden" });
  return titles;
}

export async function chooseNotebook(
  page: Page,
  dimension: "2d" | "3d" | "4d",
) {
  await page.locator(".app:visible .notebook-mode > button").click();
  await page
    .getByRole("menuitemradio", {
      name: { "2d": "2D curves", "3d": "3D curves", "4d": "4D shapes" }[
        dimension
      ],
      exact: true,
    })
    .click();
}

export async function openShapeAnimation(page: Page) {
  await open(page, "#shape-animation-section");
}
export async function openShapeExport(page: Page) {
  await openShapeAnimation(page);
  await open(page, "#shape-export-settings");
}
