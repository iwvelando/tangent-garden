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
import { EngineClient } from "../engine-client";
import { GardenStill, type GardenDrawingProps } from "./Drawing";
import {
  gardenPage,
  framed,
  revealCount,
  seedCount,
  type GardenRequest,
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
      revealCount(
        total,
        progressAt(time, o.reveal.repeat, "steady"),
        seedCount(o.drawing.result),
      ),
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

// The glide as MP4 or animated WebP. Each frame is the frozen packing
// inverted by Go about that frame's pole, drawn as vector SVG at the
// encoding's size. The export's own worker freezes the packing again, from
// the same request, and is ended when the export finishes or is canceled.
export async function gardenGlideMovie(o: {
  drawing: GardenDrawingProps & { result: GardenResult };
  request: GardenRequest;
  metadata: object;
  timing: GardenReveal;
  options: MotionExport;
  signal: AbortSignal;
  current: () => boolean;
  progress: (p: number) => void;
}) {
  const client = new EngineClient();
  const end = () => client.dispose();
  o.signal.addEventListener("abort", end);
  const { duration, repeat } = o.timing;
  try {
    const blob = await exportSvgAnimation({
      ...o.options,
      duration,
      cyclic: cycles(repeat),
      signal: o.signal,
      lookahead: 1,
      sample: async (time): Promise<GardenResult> => {
        const progress = progressAt(time, repeat, "steady");
        if (progress === 0 || progress === 1) return o.drawing.result;
        return framed(
          o.drawing.result,
          await client.gardenFrame({ garden: o.request, progress }),
        );
      },
      draw: (result, scale) => {
        const svg = gardenSVG({ ...o.drawing, result }, o.metadata);
        svg.setAttribute("width", String(Math.round(gardenPage.width * scale)));
        svg.setAttribute(
          "height",
          String(Math.round(gardenPage.height * scale)),
        );
        return new XMLSerializer().serializeToString(svg);
      },
      onProgress: (n, of) => o.progress(n / of),
    });
    const annotated = await loomMetadata(blob, o.options.format, o.metadata);
    if (o.current())
      saveFile(annotated, `apollonian-garden-glide.${o.options.format}`);
  } finally {
    o.signal.removeEventListener("abort", end);
    end();
  }
}
