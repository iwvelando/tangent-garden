import { loomMetadata } from "./metadata";
import { renderToStaticMarkup } from "react-dom/server";
import { PairedDrawing, type DrawingProps } from "./Drawing";
import { pngFile, svgFile, saveFile } from "../export-image";
import { exportSvgAnimation } from "../export-animation";
import {
  defaultStill,
  stillSize,
  stillRecord,
  type Still,
} from "../export-image";
import type { MotionExport } from "../MotionExportSettings";

import { traversal, type LoomStudy, type LoomMarker } from "./model";
export function pairedSVG(
  source: DrawingProps,
  image: DrawingProps,
  metadata: unknown,
) {
  const text = renderToStaticMarkup(
    <PairedDrawing source={source} image={image} metadata={metadata} />,
  );
  return new DOMParser().parseFromString(text, "image/svg+xml")
    .documentElement as unknown as SVGSVGElement;
}
export async function loomStill(
  format: "svg" | "png",
  source: DrawingProps,
  image: DrawingProps,
  metadata: unknown,
  current: () => boolean = () => true,
  still: Still = defaultStill,
) {
  const record = {
    ...(metadata as object),
    ...stillRecord(still, { width: 2000, height: 760 }),
  };
  const svg = pairedSVG(source, image, record);
  const blob =
    format === "svg"
      ? svgFile(svg, still.transparent)
      : await loomMetadata(
          await pngFile(
            svg,
            stillSize(still, { width: 2000, height: 760 }).width,
            stillSize(still, { width: 2000, height: 760 }).height,
            still.transparent,
          ),
          "png",
          record,
        );
  if (current()) saveFile(blob, `complex-square.${format}`);
}
export async function loomMovie(o: {
  study: LoomStudy;
  source: DrawingProps;
  image: DrawingProps;
  metadata: unknown;
  options: MotionExport;
  signal: AbortSignal;
  current: () => boolean;
  marker: (q: ReturnType<typeof traversal>) => Promise<LoomMarker>;
  progress: (p: number) => void;
}) {
  const blob = await exportSvgAnimation({
    ...o.options,
    duration: o.study.duration,
    settings: { ...o.options.settings, layout: "columns" },
    signal: o.signal,
    lookahead: 1,
    sample: (p) => o.marker(traversal(o.study, p)),
    draw: (marker) =>
      new XMLSerializer().serializeToString(
        pairedSVG(
          { ...o.source, marker },
          { ...o.image, marker },
          { ...(o.metadata as object), parameter: marker.parameter },
        ),
      ),
    onProgress: (n, total) => o.progress(n / total),
  });
  const annotated = await loomMetadata(blob, o.options.format, o.metadata);
  if (o.current())
    saveFile(annotated, `tangent-garden-complex-square.${o.options.format}`);
}
