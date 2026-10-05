// Still-image exports of the drawing as currently shown, including manual
// pan/zoom and a paused animation frame. Everything stays in the browser.

export function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// A still's size, as a whole multiple of the drawing's own page (1000 × 760,
// or a 4D pair's), and whether its background is left transparent. The
// default is the size every still had before it could be chosen, and
// exports record a setting only when it differs, so default files are
// unchanged.
export type Still = { scale: number; transparent: boolean };
export const stillScales = [1, 2, 3, 4];
export const defaultStill: Still = { scale: 2, transparent: false };
export const drawingPage = { width: 1000, height: 760 };
export function stillSize(still: Still, base = drawingPage) {
  if (!stillScales.includes(still.scale))
    throw new Error("Choose an image size of 1, 2, 3 or 4 times the page.");
  return { width: base.width * still.scale, height: base.height * still.scale };
}
export function stillRecord(still: Still, base = drawingPage) {
  return {
    ...(still.scale !== defaultStill.scale
      ? { image: stillSize(still, base) }
      : {}),
    ...(still.transparent ? { background: "transparent" } : {}),
  };
}
// A size this device cannot draw, named rather than saved as a blank file.
export class StillLimit extends Error {}
export const browserLimit = (width: number, height: number) =>
  new StillLimit(
    `This browser can't draw a ${width} × ${height} image. Choose a smaller size.`,
  );

export function svgFile(svg: SVGSVGElement, transparent = false): Blob {
  return new Blob(
    [
      new XMLSerializer().serializeToString(
        transparent ? withoutBackground(svg) : svg,
      ),
    ],
    { type: "image/svg+xml" },
  );
}

// A copy of a drawing with its background left out, not painted over: the
// root's CSS background and every rectangle that fills an svg's own
// viewBox from its corner (the page, or a 4D pair's panels). The metadata
// records it.
function withoutBackground(svg: SVGSVGElement) {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.style.removeProperty("background");
  copy.style.removeProperty("background-color");
  if (copy.getAttribute("style") === "") copy.removeAttribute("style");
  for (const root of [copy, ...copy.querySelectorAll("svg")]) {
    const box = root
      .getAttribute("viewBox")
      ?.trim()
      .split(/[\s,]+/);
    if (box?.length !== 4) continue;
    for (const child of [...root.children])
      if (
        child.localName === "rect" &&
        !child.hasAttribute("x") &&
        !child.hasAttribute("y") &&
        child.getAttribute("width") === box[2] &&
        child.getAttribute("height") === box[3] &&
        (child.getAttribute("fill") ?? "none") !== "none"
      )
        child.remove();
  }
  const desc = copy.querySelector(":scope > desc");
  if (desc?.textContent)
    try {
      desc.textContent = JSON.stringify({
        ...JSON.parse(desc.textContent),
        background: "transparent",
      });
    } catch {
      // Not a record: the file still has no background.
    }
  return copy;
}

// The drawing is rasterized from vectors at the target size, never upscaled
// from a screen-sized image. The SVG uses only inline attributes, so it renders
// the same outside the page.
export async function pngFile(
  svg: SVGSVGElement,
  width: number,
  height: number,
  transparent = false,
): Promise<Blob> {
  const copy = transparent
    ? withoutBackground(svg)
    : (svg.cloneNode(true) as SVGSVGElement);
  copy.setAttribute("width", String(width));
  copy.setAttribute("height", String(height));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: transparent });
  if (!context || !drawable(context, width, height))
    throw browserLimit(width, height);
  const url = URL.createObjectURL(svgFile(copy));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    context.drawImage(image, 0, 0, width, height);
  } finally {
    URL.revokeObjectURL(url);
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob?.type === "image/png"
          ? resolve(blob)
          : reject(new Error("PNG encoding failed.")),
      "image/png",
    ),
  );
}

// Past its canvas limits a browser can give no context, or one that draws
// nothing. One pixel in the far corner tells, then is cleared back to the
// canvas's starting state.
export function drawable(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  context.fillStyle = "#fff";
  context.fillRect(width - 1, height - 1, 1, 1);
  const drawn = context.getImageData(width - 1, height - 1, 1, 1).data[3];
  context.clearRect(width - 1, height - 1, 1, 1);
  return drawn === 255;
}
