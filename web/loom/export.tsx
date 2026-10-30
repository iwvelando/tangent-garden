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

import {
  loomFrame,
  poleExclusion,
  type LoomStudy,
  type LoomMarker,
  type LoomResult,
} from "./model";
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
  if (current())
    saveFile(blob, `complex-${(metadata as { map: string }).map}.${format}`);
}
export async function loomMovie(o: {
  study: LoomStudy;
  source: DrawingProps;
  image: DrawingProps;
  metadata: unknown;
  options: MotionExport;
  signal: AbortSignal;
  current: () => boolean;
  marker: (q: ReturnType<typeof loomFrame>) => Promise<LoomMarker>;
  frame: (q: ReturnType<typeof loomFrame>) => Promise<LoomResult>;
  progress: (p: number) => void;
}) {
  const blob = await exportSvgAnimation({
    ...o.options,
    duration: o.study.duration,
    settings: { ...o.options.settings, layout: "columns" },
    signal: o.signal,
    lookahead: 1,
    sample: async (p) => {
      const request = loomFrame(o.study, p);
      const result = o.study.motion ? await o.frame(request) : undefined;
      if (result && result.numericEntries > 2000000)
        throw new Error("The loom exceeded its retained geometry budget.");
      return {
        request,
        result,
        marker: result?.marker ?? (await o.marker(request)),
      };
    },
    draw: ({ request, result, marker }) => {
      const geometry = result ? { result } : {};
      const exclusion = poleExclusion(request, o.study.showExclusion ?? true);
      return new XMLSerializer().serializeToString(
        pairedSVG(
          { ...o.source, ...geometry, exclusion, marker },
          { ...o.image, ...geometry, marker },
          {
            ...(o.metadata as object),
            parameter: marker.parameter,
            mapParameter: request.mapParameter,
          },
        ),
      );
    },
    onProgress: (n, total) => o.progress(n / total),
  });
  const annotated = await loomMetadata(blob, o.options.format, o.metadata);
  if (o.current())
    saveFile(
      annotated,
      `tangent-garden-complex-${o.study.map}.${o.options.format}`,
    );
}
