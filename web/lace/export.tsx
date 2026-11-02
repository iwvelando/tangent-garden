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
import { LaceStill, type LaceDrawingProps } from "./Drawing";
import { lacePage } from "./model";

export function laceSVG(p: LaceDrawingProps, metadata: unknown) {
  const text = renderToStaticMarkup(<LaceStill {...p} metadata={metadata} />);
  return new DOMParser().parseFromString(text, "image/svg+xml")
    .documentElement as unknown as SVGSVGElement;
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
