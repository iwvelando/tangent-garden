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
import { EngineClient } from "../engine-client";
import { exportSvgAnimation } from "../export-animation";
import type { MotionExport } from "../MotionExportSettings";
import { cycles, progressAt } from "../timing";
import { markupRefusal } from "../loop-check";
import { LaceStill, type LaceDrawingProps } from "./Drawing";
import {
  lacePage,
  movedResult,
  type LaceRequest,
  type LaceResult,
  type LaceStudyMotion,
} from "./model";

export function laceSVG(p: LaceDrawingProps, metadata: unknown) {
  const text = renderToStaticMarkup(<LaceStill {...p} metadata={metadata} />);
  return new DOMParser().parseFromString(text, "image/svg+xml")
    .documentElement as unknown as SVGSVGElement;
}

// Why a loop's last frame is not its first, or null when they match: the
// whole drawing at both ends, with its tiles, camera, layers and
// appearance, compared as markup (mathematics.md#seamless-loops).
export function laceLoopRefusal(
  start: LaceDrawingProps,
  end: LaceDrawingProps,
) {
  const markup = (p: LaceDrawingProps) =>
    renderToStaticMarkup(<LaceStill {...p} metadata={null} />);
  return markupRefusal(
    markup(start),
    markup(end),
    " Back and forth returns smoothly.",
  );
}

// A vector SVG, or a PNG drawn from it at the target size, each carrying the
// study's record: the SVG in its root desc, the PNG in an iTXt chunk.
export async function laceStill(
  format: "svg" | "png",
  drawing: LaceDrawingProps,
  metadata: object,
  current: () => boolean = () => true,
  still: Still = defaultStill,
) {
  const record = { ...metadata, ...stillRecord(still, lacePage) };
  const svg = laceSVG(drawing, record);
  const size = stillSize(still, lacePage);
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
  if (current()) saveFile(blob, `hyperbolic-lace.${format}`);
}

// The motion as MP4 or animated WebP through the shared encoder. Each
// frame is the frozen patch moved by Go to that frame's time, drawn as
// vector SVG at the encoding's size, so nothing is upscaled and no raster
// is warped. The export's own worker freezes the patch and is ended when
// the export finishes or is canceled.
export async function laceMovie(o: {
  drawing: LaceDrawingProps;
  request: LaceRequest;
  motion: LaceStudyMotion;
  metadata: object;
  options: MotionExport;
  signal: AbortSignal;
  current: () => boolean;
  progress: (p: number) => void;
}) {
  const client = new EngineClient();
  const end = () => client.dispose();
  o.signal.addEventListener("abort", end);
  const { offset, orbits, turns, duration, repeat } = o.motion;
  try {
    const blob = await exportSvgAnimation({
      ...o.options,
      duration,
      cyclic: cycles(repeat),
      signal: o.signal,
      lookahead: 1,
      sample: async (time): Promise<LaceResult> =>
        movedResult(
          o.drawing.result,
          await client.laceFrame({
            lace: o.request,
            motion: { offset, orbits, turns },
            progress: progressAt(time, repeat, "steady"),
          }),
        ),
      draw: (result, scale) => {
        const svg = laceSVG({ ...o.drawing, result }, o.metadata);
        svg.setAttribute("width", String(Math.round(lacePage.width * scale)));
        svg.setAttribute("height", String(Math.round(lacePage.height * scale)));
        return new XMLSerializer().serializeToString(svg);
      },
      onProgress: (n, of) => o.progress(n / of),
    });
    const annotated = await loomMetadata(blob, o.options.format, o.metadata);
    if (o.current())
      saveFile(annotated, `hyperbolic-lace-motion.${o.options.format}`);
  } finally {
    o.signal.removeEventListener("abort", end);
    end();
  }
}
