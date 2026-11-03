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
import { LabStill, type LabDrawingProps } from "./Drawing";
import { labPage, type ShortenContour } from "./model";

export function labSVG(p: LabDrawingProps, metadata: unknown) {
  const text = renderToStaticMarkup(<LabStill {...p} metadata={metadata} />);
  return new DOMParser().parseFromString(text, "image/svg+xml")
    .documentElement as unknown as SVGSVGElement;
}

export async function labStill(
  format: "svg" | "png",
  drawing: LabDrawingProps,
  metadata: object,
  current: () => boolean,
  still: Still = defaultStill,
) {
  const record = { ...metadata, ...stillRecord(still, labPage) };
  const svg = labSVG(drawing, record);
  const size = stillSize(still, labPage);
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

// The motion through the shared encoder. Each frame's loop is sampled from
// the worker at that frame's physical time, so the file never depends on
// playback or on render speed.
export async function labMovie(o: {
  drawing: LabDrawingProps;
  metadata: object;
  duration: number;
  sample: (progress: number) => Promise<ShortenContour>;
  options: MotionExport;
  signal: AbortSignal;
  current: () => boolean;
  progress: (p: number) => void;
}) {
  const blob = await exportSvgAnimation({
    ...o.options,
    duration: o.duration,
    cyclic: false,
    signal: o.signal,
    lookahead: 1,
    sample: o.sample,
    draw: (contour, scale) => {
      const svg = labSVG({ ...o.drawing, current: contour }, o.metadata);
      svg.setAttribute("width", String(Math.round(labPage.width * scale)));
      svg.setAttribute("height", String(Math.round(labPage.height * scale)));
      return new XMLSerializer().serializeToString(svg);
    },
    onProgress: (n, of) => o.progress(n / of),
  });
  const annotated = await loomMetadata(blob, o.options.format, o.metadata);
  if (o.current()) saveFile(annotated, `curve-shortening.${o.options.format}`);
}
