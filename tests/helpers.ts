import type { Page } from "@playwright/test";

// Links conform configuration fields in schema order. Historical SVG
// recordings use the preset's order; preserve every observed field and
// value while restoring only that order in their metadata.
export function svgConfigOrder(svg: Buffer, original: object): Buffer {
  return Buffer.from(
    svg.toString("utf8").replace(/<desc>(.*?)<\/desc>/s, (_, desc: string) => {
      const metadata = JSON.parse(
        desc
          .replaceAll("&lt;", "<")
          .replaceAll("&gt;", ">")
          .replaceAll("&amp;", "&"),
      );
      const config = metadata.config;
      const keys = new Set([...Object.keys(original), ...Object.keys(config)]);
      metadata.config = Object.fromEntries(
        [...keys]
          .filter((key) => Object.hasOwn(config, key))
          .map((key) => [key, config[key]]),
      );
      return `<desc>${JSON.stringify(metadata).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</desc>`;
    }),
  );
}

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
  await page
    .locator(".app:visible")
    .getByRole("radiogroup", { name: "Study dimension" })
    .getByRole("radio", { name: `${dimension.toUpperCase()} studies` })
    .click();
}

export async function openShapeAnimation(page: Page) {
  await open(page, "#shape-animation-section");
}
export async function openShapeExport(page: Page) {
  await openShapeAnimation(page);
  await open(page, "#shape-export-settings");
}

export async function chooseColorScheme(page: Page, id: string) {
  const header = page.locator(".app:visible header");
  await header
    .getByRole("button", { name: "Color scheme", exact: true })
    .click();
  await header.locator(`[role="menuitemradio"][data-scheme="${id}"]`).click();
}

// Holds the Pause button's click handler as React rendered it while the
// animation played, and returns a call to it. A click that lands after
// playback ends, but before React draws the Replay button in Pause's place,
// reaches this same handler; calling it later reproduces that click.
export async function stalePause(page: Page) {
  await page
    .getByRole("button", { name: "Pause", exact: true })
    .evaluate((button) => {
      const key = Object.keys(button).find((k) =>
        k.startsWith("__reactProps$"),
      )!;
      (window as unknown as { stalePause: () => void }).stalePause = (
        button as unknown as Record<string, { onClick: () => void }>
      )[key].onClick;
    });
  return () =>
    page.evaluate(() =>
      (window as unknown as { stalePause: () => void }).stalePause(),
    );
}

// iOS opens its keyboard over the page without shrinking the layout viewport:
// it shortens the visual viewport and may pan it down inside the layout one,
// and sometimes leaves it panned after the keyboard closes. Desktop engines
// never do this, so stand in a scripted visual viewport the page reads.
export async function scriptedKeyboard(page: Page) {
  await page.addInitScript(() => {
    const viewport = Object.assign(new EventTarget(), {
      offsetLeft: 0,
      offsetTop: 0,
      pageLeft: 0,
      pageTop: 0,
      scale: 1,
      width: innerWidth,
      height: innerHeight,
    });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      get: () => viewport,
    });
    (window as unknown as { keyboard: unknown }).keyboard = (
      offsetTop: number,
      height: number,
    ) => {
      viewport.offsetTop = offsetTop;
      viewport.pageTop = scrollY + offsetTop;
      viewport.height = height;
      viewport.dispatchEvent(new Event("resize"));
      viewport.dispatchEvent(new Event("scroll"));
    };
  });
  return (offsetTop: number, height: number) =>
    page.evaluate(
      ([top, h]) =>
        (
          window as unknown as { keyboard: (a: number, b: number) => void }
        ).keyboard(top, h),
      [offsetTop, height],
    );
}
