import { expect, type Page } from "@playwright/test";
import { readout as short } from "../web/number-format";

// A displayed number read back: readouts print a true minus (U+2212), also
// in exponents, and live values pad their columns with figure spaces.
export function displayedNumber(text: string | null | undefined): number {
  const plain = (text ?? "").replace(/\u2007/g, "").replace(/\u2212/g, "-");
  return plain.trim() === "" ? NaN : Number(plain);
}

export type Frenet = [kappa: number, radius: number, torsion: number];
// A curve probe's κ, 1/κ and τ against closed forms. Six displayed digits
// reveal the differenced torsion's error, about 1e-5 relative: curvature
// and radius read exactly, and the torsion reads cleanly formatted within a
// relative bound.
export async function expectFrenet(page: Page, [kappa, radius, tau]: Frenet) {
  const readout = page.locator(".probe-readout dd");
  await expect(readout).toHaveText([short(kappa), short(radius), /./]);
  await expect
    .poll(async () => {
      const text = (await readout.nth(2).textContent()) ?? "";
      const torsion = displayedNumber(text);
      return text === short(torsion) ? Math.abs(torsion - tau) : Infinity;
    })
    .toBeLessThan(Math.abs(tau) * 5e-5 + 1e-9);
}

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

// Holds the page's animation frames until the returned call releases them.
// Playback advances only in an animation frame, and only a frame can ask for
// its last one, so nothing held can end it. Without the hold, a click on
// Pause races the clock: on CI each frame of a heavy WebGL study can take
// seconds (headless Chromium composites it in software and waits for each
// frame), the click's actionability checks wait for several frames, and the
// animation can end first. React reuses Pause's element for Replay, so the
// late click then replays it. Frames requested while held run, in order,
// after release; one cancelled meanwhile never runs. Playwright's own
// checks use their own frames, which are not held.
export async function holdFrames(page: Page) {
  await page.evaluate(() => {
    const request = window.requestAnimationFrame,
      cancel = window.cancelAnimationFrame;
    const held = new Map<number, FrameRequestCallback>(),
      released = new Map<number, number>();
    // Below any id the browser gives, so the two never meet.
    let next = -1;
    window.requestAnimationFrame = (callback) => {
      held.set(next, callback);
      return next--;
    };
    window.cancelAnimationFrame = (id) => {
      if (!held.delete(id)) cancel.call(window, released.get(id) ?? id);
    };
    (window as unknown as { releaseFrames: () => void }).releaseFrames = () => {
      window.requestAnimationFrame = request;
      for (const [id, callback] of held)
        released.set(id, request.call(window, callback));
      held.clear();
    };
  });
  return () =>
    page.evaluate(() =>
      (window as unknown as { releaseFrames: () => void }).releaseFrames(),
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

// Pixels clearly apart in two captures of the drawing, by the page's decoder.
export const changedPixels = (page: Page, a: string, b: string) =>
  page.evaluate(
    async ([one, two]) => {
      const read = async (url: string) => {
        const image = new Image();
        image.src = url;
        await image.decode();
        const c = document.createElement("canvas");
        c.width = image.width;
        c.height = image.height;
        const g = c.getContext("2d")!;
        g.drawImage(image, 0, 0);
        return g.getImageData(0, 0, c.width, c.height).data;
      };
      const x = await read(one),
        y = await read(two);
      let count = 0;
      for (let i = 0; i < x.length; i += 4)
        if (
          Math.abs(x[i] - y[i]) +
            Math.abs(x[i + 1] - y[i + 1]) +
            Math.abs(x[i + 2] - y[i + 2]) >
          32
        )
          count++;
      return count;
    },
    [a, b],
  );
