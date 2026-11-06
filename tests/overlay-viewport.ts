import { expect, type Locator } from "@playwright/test";
import { decodePng } from "./png";

// Assert painted geometry in the letterbox strips, not just a correctly sized
// SVG element: a nested fixed-page clip can hide this ink while all boxes fit.
export async function expectZoomUsesWholeViewport(d: Locator) {
  const svg = d.locator(".journey-art svg").first();
  await svg.focus();
  for (let i = 0; i < 4; i++) await svg.press("+");
  const area = await svg.evaluate((el) => {
    const box = el.getBoundingClientRect(),
      m = el.getScreenCTM()!,
      v = el.viewBox.baseVal;
    const a = new DOMPoint(v.x, v.y).matrixTransform(m),
      b = new DOMPoint(v.x + v.width, v.y + v.height).matrixTransform(m);
    return {
      width: box.width,
      height: box.height,
      left: a.x - box.left,
      right: b.x - box.left,
      top: a.y - box.top,
      bottom: b.y - box.top,
    };
  });
  const png = decodePng(await svg.screenshot());
  const counts = { before: 0, after: 0 };
  const vertical = area.top > 5;
  for (let y = 3; y < png.height - 3; y++)
    for (let x = 3; x < png.width - 3; x++) {
      const sx = (x * area.width) / png.width,
        sy = (y * area.height) / png.height;
      const side = vertical
        ? sy < area.top - 3
          ? "before"
          : sy > area.bottom + 3
            ? "after"
            : undefined
        : sx < area.left - 3
          ? "before"
          : sx > area.right + 3
            ? "after"
            : undefined;
      if (!side) continue;
      const at = 4 * (y * png.width + x),
        rgb = [png.rgba[at], png.rgba[at + 1], png.rgba[at + 2]];
      if (Math.max(...rgb) - Math.min(...rgb) > 22) counts[side]++;
    }
  expect(counts.before, "zoomed ink before the fixed page").toBeGreaterThan(8);
  expect(counts.after, "zoomed ink after the fixed page").toBeGreaterThan(8);
}

// Read CSS boxes and the actual SVG page-to-screen mapping. A valid viewBox
// alone does not establish that its parent lets the entire page be seen.
export async function overlayViewport(d: Locator) {
  return d.locator(".journey-art").evaluate((frame) => {
    const svg = frame.querySelector<SVGSVGElement>("svg")!;
    const box = frame.getBoundingClientRect();
    const style = getComputedStyle(frame);
    const inside = {
      left: box.left + parseFloat(style.borderLeftWidth),
      top: box.top + parseFloat(style.borderTopWidth),
      right: box.right - parseFloat(style.borderRightWidth),
      bottom: box.bottom - parseFloat(style.borderBottomWidth),
    };
    const matrix = svg.getScreenCTM()!;
    const page = svg.viewBox.baseVal;
    const top = new DOMPoint(page.x, page.y).matrixTransform(matrix);
    const bottom = new DOMPoint(
      page.x + page.width,
      page.y + page.height,
    ).matrixTransform(matrix);
    const rect = svg.getBoundingClientRect();
    return {
      inside,
      page: { left: top.x, top: top.y, right: bottom.x, bottom: bottom.y },
      svg: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      },
      borders: [frame, ...frame.querySelectorAll(".garden-view, svg")]
        .map((el) => ({
          element:
            el.className instanceof SVGAnimatedString
              ? el.className.baseVal
              : el.className,
          width: parseFloat(getComputedStyle(el).borderTopWidth),
        }))
        .filter((b) => b.width > 0),
      rim: (() => {
        const circle = svg.querySelector('[data-role="rim"]');
        if (!circle) return undefined;
        const r = circle.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      })(),
      zoom: svg.dataset.zoom,
    };
  });
}

export function expectWholeOverlayPage(
  m: Awaited<ReturnType<typeof overlayViewport>>,
) {
  expect(m.zoom).toBe("1");
  for (const [name, r] of [
    ["SVG element", m.svg],
    ["SVG page", m.page],
    ["rim", m.rim],
  ] as const) {
    if (!r) continue;
    expect(r.left, `${name} left`).toBeGreaterThanOrEqual(m.inside.left - 1);
    expect(r.top, `${name} top`).toBeGreaterThanOrEqual(m.inside.top - 1);
    expect(r.right, `${name} right`).toBeLessThanOrEqual(m.inside.right + 1);
    expect(r.bottom, `${name} bottom`).toBeLessThanOrEqual(m.inside.bottom + 1);
  }
}
