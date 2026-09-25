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

export function svgFile(svg: SVGSVGElement): Blob {
  return new Blob([new XMLSerializer().serializeToString(svg)], {
    type: "image/svg+xml",
  });
}

// The drawing is rasterized from vectors at the target size, never upscaled
// from a screen-sized image. The SVG uses only inline attributes, so it renders
// the same outside the page.
export async function pngFile(
  svg: SVGSVGElement,
  width: number,
  height: number,
): Promise<Blob> {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute("width", String(width));
  copy.setAttribute("height", String(height));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Canvas drawing is unavailable.");
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
