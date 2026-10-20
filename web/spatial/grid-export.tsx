// Exports of the grid of views beside a curve study's drawing (grid.ts):
// one image or video holding every view, each cell a page of its own at the
// drawing's proportions, the 3D drawing first and the face-on views after
// it in reading order. The face-on views are drawn from their vectors at
// the export's own size, never scaled from the screen.
import { renderToStaticMarkup } from "react-dom/server";
import { plotPalette } from "../palette";
import { drawable, browserLimit } from "../export-image";
import { captionBand } from "../export-quality";
import type { ColorScheme } from "../color-schemes";
import type { LineWeight } from "../line-weight";
import {
  gridCells,
  gridLayout,
  gridPage,
  page,
  type Framing,
  type PlaneView,
} from "./grid";
import { PlaneDrawing } from "./PlaneViews";
import type { Layers } from "./scene";
import type { SpatialResult, Vec3 } from "./types";

// What the face-on views draw in an export, beside the 3D drawing, and
// what a file records of them.
export type GridPlanes = {
  views: PlaneView[];
  framing: Framing;
  weight: LineWeight;
  probe?: Vec3 | null;
};

export const gridRecord = (p: GridPlanes, result: SpatialResult) => ({
  layout: gridLayout(p.views),
  views: ["drawing", ...p.views],
  plane: { plane: result.shadow!.plane, at: result.shadow!.at },
  // The face-on views' middle on the plane and page units per unit.
  framing: { cx: p.framing.cx, cy: p.framing.cy, scale: p.framing.scale },
});

// Where cell k (the drawing is 0) stands, in units of its size.
const origin = (k: number) => ({ column: k % 2, row: Math.floor(k / 2) });

// A face-on view as SVG markup on its page.
export function planeMarkup(
  view: PlaneView,
  result: SpatialResult,
  planes: GridPlanes,
  layers: Layers,
  dark: boolean,
  scheme: ColorScheme,
) {
  return renderToStaticMarkup(
    <PlaneDrawing
      view={view}
      result={result}
      framing={planes.framing}
      layers={layers}
      dark={dark}
      scheme={scheme}
      weight={planes.weight}
      probe={planes.probe}
    />,
  );
}

// The rules between cells, in the drawing's axis ink.
function rules(views: PlaneView[], dark: boolean, scheme: ColorScheme) {
  const { width, height } = gridPage(views);
  const d =
    `M${page.width},0V${height}` +
    (gridCells(views).rows > 1 ? `M0,${page.height}H${width}` : "");
  return `<path d="${d}" stroke="${plotPalette(dark, scheme).axis}" stroke-width="1" fill="none"/>`;
}

const xml = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

// The grid as one SVG element, size pixels wide and high: the 3D drawing's
// markup (an embedded image, or its lines as an SVG of their own) in the
// first cell, and the face-on views as vectors in the others, each placed
// on its page by its own viewBox.
export function gridSvg(o: {
  drawing: string;
  result: SpatialResult;
  planes: GridPlanes;
  layers: Layers;
  dark: boolean;
  scheme: ColorScheme;
  size: { width: number; height: number };
  title: string;
  metadata: unknown;
}) {
  const { views } = o.planes;
  const whole = gridPage(views);
  const cells = views.map((view, i) => {
    const { column, row } = origin(i + 1);
    return planeMarkup(
      view,
      o.result,
      o.planes,
      o.layers,
      o.dark,
      o.scheme,
    ).replace(
      /^<svg /,
      `<svg x="${column * page.width}" y="${row * page.height}" `,
    );
  });
  const text = `<svg xmlns="http://www.w3.org/2000/svg" width="${o.size.width}" height="${o.size.height}" viewBox="0 0 ${whole.width} ${whole.height}"><title>${xml(o.title)}</title><desc>${xml(JSON.stringify(o.metadata))}</desc><rect width="${whole.width}" height="${whole.height}" fill="${plotPalette(o.dark, o.scheme).bg}"/>${o.drawing}${cells.join("")}${rules(views, o.dark, o.scheme)}</svg>`;
  return new DOMParser().parseFromString(text, "image/svg+xml")
    .documentElement as unknown as SVGSVGElement;
}

// The 3D drawing's lines, an SVG of their own, placed in the first cell.
export const drawingLines = (svg: string) =>
  svg.replace(
    /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="\d+" height="\d+"/,
    `<svg x="0" y="0" width="${page.width}" height="${page.height}"`,
  );
// The 3D drawing as an embedded image in the first cell.
export const drawingImage = (href: string) =>
  `<image width="${page.width}" height="${page.height}" href="${href}"/>`;

// A video frame of the grid: the 3D drawing's canvas, drawn as it is, and
// the face-on views rasterized from their vectors at each cell's size, on
// a canvas of the whole grid. With captions, one per cell in reading order,
// each row of cells sits below a band (captionBand) that names them, in
// the page's own type, outside every drawing.
export async function gridFrame(
  context: CanvasRenderingContext2D,
  drawing: HTMLCanvasElement,
  result: SpatialResult,
  planes: GridPlanes,
  layers: Layers,
  dark: boolean,
  scheme: ColorScheme,
  captions?: string[],
) {
  const { width, height } = context.canvas;
  const { columns, rows } = gridCells(planes.views);
  const scale = width / gridPage(planes.views).width,
    band = captions ? captionBand * scale : 0;
  const cell = { width: width / columns, height: height / rows - band };
  // Where cell k's drawing starts.
  const at = (k: number) => {
    const { column, row } = origin(k);
    return { x: column * cell.width, y: row * (cell.height + band) + band };
  };
  const palette = plotPalette(dark, scheme);
  context.fillStyle = palette.bg;
  context.fillRect(0, 0, width, height);
  context.drawImage(drawing, at(0).x, at(0).y, cell.width, cell.height);
  for (const [i, view] of planes.views.entries()) {
    const markup = planeMarkup(
      view,
      result,
      planes,
      layers,
      dark,
      scheme,
    ).replace(
      / width="1000" height="760"/,
      ` width="${cell.width}" height="${cell.height}"`,
    );
    const url = URL.createObjectURL(
      new Blob([markup], { type: "image/svg+xml" }),
    );
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      context.drawImage(image, at(i + 1).x, at(i + 1).y);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  if (captions) {
    // The page's own caption ink (--muted), as the captions above the views
    // on screen.
    context.fillStyle = dark ? "#91a4a9" : "#5f6d69";
    context.font = `${Math.round(band * 0.55)}px ${getComputedStyle(document.body).fontFamily}`;
    context.textBaseline = "middle";
    captions.forEach((caption, k) => {
      const { x, y } = at(k);
      context.fillText(
        caption,
        x + band * 0.4,
        y - band / 2,
        cell.width - band,
      );
    });
  }
  context.strokeStyle = palette.axis;
  context.lineWidth = scale;
  context.beginPath();
  context.moveTo(cell.width, 0);
  context.lineTo(cell.width, height);
  if (rows > 1) {
    context.moveTo(0, cell.height + band);
    context.lineTo(width, cell.height + band);
  }
  context.stroke();
}

// A 2D canvas of a size, or the browser's limit named.
export function gridCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context || !drawable(context, width, height))
    throw browserLimit(width, height);
  return { canvas, context };
}
