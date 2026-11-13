// Page helpers shared by the 24-cell specs (cell24*.spec.ts).
import { expect, type Page } from "@playwright/test";
import { choosePreset } from "./helpers";

export const signature = "The heart of a cell";
export const crystal = "A crystal and its companion";
export const stage = (p: Page) => p.locator(".tesseract-stage");
export const settle = (p: Page) =>
  expect(stage(p)).toHaveAttribute("aria-busy", "false");
export const artwork = (p: Page) => p.locator("#tesseract-artwork");
export const meta = async (p: Page) =>
  JSON.parse((await p.locator("#tesseract-artwork > desc").textContent())!);
export const selectedField = (p: Page) =>
  p.getByRole("spinbutton", { name: "Selected cell", exact: true });
export const show = (p: Page) =>
  p.getByRole("combobox", { name: "Show", exact: true });
export const open = async (p: Page, preset = signature) => {
  await p.goto("/?study=4d");
  await settle(p);
  await choosePreset(p, { label: preset });
  await settle(p);
};
// Drawn paths by role, and markers by role.
export const counts = (p: Page) =>
  artwork(p).evaluate((svg) => {
    const out: Record<string, number> = {};
    for (const e of svg.querySelectorAll("path[data-role], g[data-role]")) {
      const r = e.getAttribute("data-role")!;
      out[r] = (out[r] ?? 0) + 1;
    }
    return out;
  });
// Screen-independent drawing coordinates of a path's points or a marker's
// center, in the 1000 × 760 viewBox.
export const pathPoints = (p: Page, selector: string) =>
  artwork(p)
    .locator(selector)
    .evaluateAll((es) =>
      es.map((e) =>
        e
          .getAttribute("d")!
          .match(/-?\d+(?:\.\d+)?/g)!
          .map(Number),
      ),
    );
export const markerAt = (p: Page, id: string) =>
  artwork(p)
    .locator(`g[data-marker="${id}"] circle:last-child`)
    .evaluate((c) => [
      Number(c.getAttribute("cx")),
      Number(c.getAttribute("cy")),
    ]);
// A marker's position on the page.
export const screenOf = (p: Page, id: string) =>
  artwork(p)
    .locator(`g[data-marker="${id}"] circle:last-child`)
    .evaluate((c) => {
      const m = (c as SVGCircleElement).ownerSVGElement!.getScreenCTM()!;
      const x = Number(c.getAttribute("cx")),
        y = Number(c.getAttribute("cy"));
      return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
    });
export const selected = async (p: Page) =>
  (await meta(p)).polytope.selectedCell;

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
