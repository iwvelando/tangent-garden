import { expect, type Page } from "@playwright/test";
import { choosePreset } from "./helpers";

// Shared observations of Base sphere and fibers (docs/tesseracts.md): both
// panes, their returned correspondence and the drawing as export draws it.
export const stage = (p: Page) => p.locator(".tesseract-stage");
export const settle = (p: Page) =>
  expect(stage(p)).toHaveAttribute("aria-busy", "false");
export const panel = (p: Page, mode: "base" | "stereo") =>
  p.locator(`svg[data-representation="${mode}"]`);
export const desc = async (p: Page, mode: "base" | "stereo") =>
  JSON.parse(
    (await panel(p, mode).locator(":scope > desc").textContent()) ?? "{}",
  );
export const meta = async (p: Page) =>
  JSON.parse((await p.locator("#tesseract-artwork > desc").textContent())!);
export const selectedField = (p: Page) =>
  p.getByRole("spinbutton", { name: "Selected fiber", exact: true });
export const openPreset = async (p: Page, preset: string) => {
  await p.goto("/?study=4d");
  await settle(p);
  await choosePreset(p, { label: preset });
  await settle(p);
};
// What each pane draws as moving and selected, by sample.
export const roles = (p: Page) =>
  p
    .locator("#tesseract-artwork [data-correspondence]")
    .evaluateAll((es) =>
      es.map((e) => [
        e
          .closest("svg[data-representation]")!
          .getAttribute("data-representation"),
        e.getAttribute("data-correspondence"),
        e.getAttribute("data-sample") ?? e.getAttribute("data-source"),
      ]),
    );
export const correspondence = async (p: Page) => ({
  base: (await desc(p, "base")).weave.correspondence,
  stereo: (await desc(p, "stereo")).weave.correspondence,
});
// A screen point on a drawn element: a base marker's center, or a vertex
// of a fiber path, in page coordinates.
export const pointOn = (p: Page, selector: string, vertex = 0) =>
  p.locator(selector).evaluate((e, vertex) => {
    const svg = e.ownerSVGElement!;
    const m = svg.getScreenCTM()!;
    let x: number, y: number;
    if (e.tagName === "g") {
      const c = e.querySelector("circle:last-child") as SVGCircleElement;
      x = c.cx.baseVal.value;
      y = c.cy.baseVal.value;
    } else {
      const d = e
        .getAttribute("d")!
        .match(/-?\d+(?:\.\d+)?/g)!
        .map(Number);
      const i = Math.min(vertex, d.length / 2 - 1);
      x = d[2 * i];
      y = d[2 * i + 1];
    }
    return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
  }, vertex);

// The live drawing rasterized as export rasterizes it.
export const raster = (page: Page, width: number, height: number) =>
  page.evaluate(
    async ({ width, height }) => {
      const svg = document
        .getElementById("tesseract-artwork")!
        .cloneNode(true) as SVGSVGElement;
      svg.setAttribute("width", String(width));
      svg.setAttribute("height", String(height));
      const url = URL.createObjectURL(
        new Blob([new XMLSerializer().serializeToString(svg)], {
          type: "image/svg+xml",
        }),
      );
      try {
        const image = new Image();
        image.src = url;
        await image.decode();
        const c = document.createElement("canvas");
        c.width = width;
        c.height = height;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(image, 0, 0);
        return Array.from(ctx.getImageData(0, 0, width, height).data);
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    { width, height },
  );
