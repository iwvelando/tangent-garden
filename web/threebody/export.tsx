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
import {
  geometryOf,
  ThreeBodyStill,
  type ThreeBodyDrawingProps,
} from "./Drawing";
import { threeBodyPage } from "./model";

export function threeBodySVG(p: ThreeBodyDrawingProps, metadata: unknown) {
  const text = renderToStaticMarkup(
    <ThreeBodyStill {...p} metadata={metadata} />,
  );
  return new DOMParser().parseFromString(text, "image/svg+xml")
    .documentElement as unknown as SVGSVGElement;
}

// A vector SVG, or a PNG drawn from it at the target size, each carrying the
// study's record: the SVG in its root desc, the PNG in an iTXt chunk.
export async function threeBodyStill(
  format: "svg" | "png",
  drawing: ThreeBodyDrawingProps,
  metadata: object,
  current: () => boolean = () => true,
  still: Still = defaultStill,
) {
  const record = { ...metadata, ...stillRecord(still, threeBodyPage) };
  const svg = threeBodySVG(drawing, record);
  const size = stillSize(still, threeBodyPage);
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
  if (current()) saveFile(blob, `three-bodies.${format}`);
}

// The motion as MP4 or animated WebP through the shared encoder. Each frame
// shows the frozen history at that frame's physical time, progress times
// the history's last time, so the file depends neither on playback nor on
// render speed; each frame is drawn as vector SVG at the encoding's size.
// The motion runs once, so the file never promises a loop.
export async function threeBodyMovie(o: {
  drawing: ThreeBodyDrawingProps;
  metadata: object;
  duration: number;
  end: number;
  options: MotionExport;
  signal: AbortSignal;
  current: () => boolean;
  progress: (p: number) => void;
}) {
  const geometry = geometryOf(
    o.drawing.history,
    o.drawing.frame,
    o.drawing.camera.zoom,
  );
  const blob = await exportSvgAnimation({
    ...o.options,
    duration: o.duration,
    cyclic: false,
    signal: o.signal,
    lookahead: 1,
    sample: async (progress) => Math.min(1, Math.max(0, progress)) * o.end,
    draw: (time, scale) => {
      const svg = threeBodySVG({ ...o.drawing, geometry, time }, o.metadata);
      svg.setAttribute(
        "width",
        String(Math.round(threeBodyPage.width * scale)),
      );
      svg.setAttribute(
        "height",
        String(Math.round(threeBodyPage.height * scale)),
      );
      return new XMLSerializer().serializeToString(svg);
    },
    onProgress: (n, of) => o.progress(n / of),
  });
  const annotated = await loomMetadata(blob, o.options.format, o.metadata);
  if (o.current())
    saveFile(annotated, `three-bodies-motion.${o.options.format}`);
}
