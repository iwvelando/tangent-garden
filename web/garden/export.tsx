import { renderToStaticMarkup } from "react-dom/server";
import {
  defaultStill,
  pngFile,
  saveFile,
  stillRecord,
  stillSize,
  svgFile,
  type Still,
} from "../export-image";
import { loomMetadata } from "../loom/metadata";
import { exportSvgAnimation } from "../export-animation";
import type { MotionExport } from "../MotionExportSettings";
import { cycles, progressAt } from "../timing";
import { GardenStill, type GardenDrawingProps } from "./Drawing";
import {
  gardenPage,
  revealCount,
  type GardenReveal,
  type GardenResult,
} from "./model";

export function gardenSVG(p: GardenDrawingProps, metadata: unknown) {
  const text = renderToStaticMarkup(<GardenStill {...p} metadata={metadata} />);
  return new DOMParser().parseFromString(text, "image/svg+xml")
    .documentElement as unknown as SVGSVGElement;
}

// A vector SVG, or a PNG drawn from it at the target size, each carrying the
// study's record: the SVG in its root desc, the PNG in an iTXt chunk.
export async function gardenStill(
  format: "svg" | "png",
  drawing: GardenDrawingProps,
  metadata: object,
  current: () => boolean = () => true,
  still: Still = defaultStill,
) {
  const record = { ...metadata, ...stillRecord(still, gardenPage) };
  const svg = gardenSVG(drawing, record);
  const size = stillSize(still, gardenPage);
  const blob =
    format === "svg"
      ? svgFile(svg, still.transparent)
      : await loomMetadata(
          await pngFile(svg, size.width, size.height, still.transparent),
          "png",
          {
            ...record,
            ...(still.transparent && { background: "transparent" }),
          },
        );
  if (current()) saveFile(blob, `apollonian-garden.${format}`);
}

// The reveal as MP4 or animated WebP through the shared encoder. Each frame
// is the frozen packing's first revealCount circles at that frame's time,
// drawn as vector SVG at the encoding's size, so nothing is upscaled.
export async function gardenMovie(o: {
  drawing: GardenDrawingProps & { result: GardenResult };
  metadata: object;
  reveal: GardenReveal;
  options: MotionExport;
  signal: AbortSignal;
  current: () => boolean;
  progress: (p: number) => void;
}) {
  const total = o.drawing.result.curvature.length;
  const blob = await exportSvgAnimation({
    ...o.options,
    duration: o.reveal.duration,
    cyclic: cycles(o.reveal.repeat),
    signal: o.signal,
    lookahead: 1,
    sample: async (time) =>
      revealCount(total, progressAt(time, o.reveal.repeat, "steady")),
    draw: (count, scale) => {
      const svg = gardenSVG({ ...o.drawing, count }, o.metadata);
      svg.setAttribute("width", String(Math.round(gardenPage.width * scale)));
      svg.setAttribute("height", String(Math.round(gardenPage.height * scale)));
      return new XMLSerializer().serializeToString(svg);
    },
    onProgress: (n, of) => o.progress(n / of),
  });
  const annotated = await loomMetadata(blob, o.options.format, o.metadata);
  if (o.current())
    saveFile(annotated, `apollonian-garden-reveal.${o.options.format}`);
}
