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
import { cycles, type Repeat } from "../timing";
import { ShortenStill, type ShortenDrawingProps } from "./Drawing";
import { shortenPage, type ShortenContour } from "./model";

export function shortenSVG(p: ShortenDrawingProps, metadata: unknown) {
  const text = renderToStaticMarkup(
    <ShortenStill {...p} metadata={metadata} />,
  );
  return new DOMParser().parseFromString(text, "image/svg+xml")
    .documentElement as unknown as SVGSVGElement;
}

// A vector SVG, or a PNG drawn from it at the target size, each carrying the
// study's record: the SVG in its root desc, the PNG in an iTXt chunk.
export async function shortenStill(
  format: "svg" | "png",
  drawing: ShortenDrawingProps,
  metadata: object,
  current: () => boolean = () => true,
  still: Still = defaultStill,
) {
  const record = { ...metadata, ...stillRecord(still, shortenPage) };
  const svg = shortenSVG(drawing, record);
  const size = stillSize(still, shortenPage);
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
  if (current()) saveFile(blob, `curve-shortening.${format}`);
}

// The motion as MP4 or animated WebP through the shared encoder. Each
// frame's loop is sampled from the worker at that frame's physical time, so
// the file depends neither on playback nor on render speed, and each frame
// is drawn as vector SVG at the encoding's size.
export async function shortenMovie(o: {
  drawing: ShortenDrawingProps;
  metadata: object;
  duration: number;
  repeat: Repeat;
  sample: (time: number) => Promise<ShortenContour>;
  options: MotionExport;
  signal: AbortSignal;
  current: () => boolean;
  progress: (p: number) => void;
}) {
  const blob = await exportSvgAnimation({
    ...o.options,
    duration: o.duration,
    cyclic: cycles(o.repeat),
    signal: o.signal,
    lookahead: 1,
    sample: o.sample,
    draw: (contour, scale) => {
      const svg = shortenSVG({ ...o.drawing, current: contour }, o.metadata);
      svg.setAttribute("width", String(Math.round(shortenPage.width * scale)));
      svg.setAttribute(
        "height",
        String(Math.round(shortenPage.height * scale)),
      );
      return new XMLSerializer().serializeToString(svg);
    },
    onProgress: (n, of) => o.progress(n / of),
  });
  const annotated = await loomMetadata(blob, o.options.format, o.metadata);
  if (o.current())
    saveFile(annotated, `curve-shortening-motion.${o.options.format}`);
}
