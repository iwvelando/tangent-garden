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
import { GardenStill, type GardenDrawingProps } from "./Drawing";
import { gardenPage } from "./model";

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
