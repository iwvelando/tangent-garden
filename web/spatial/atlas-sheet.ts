import type { SheetPainter } from "../atlas-sheet";
import { paintView, type PaintStyle } from "./atlas-paint";
import { createRenderer } from "./renderer";
import { cutSpec } from "./cut";
import { sightSpec, unprobed } from "./sight";
import type { Bounds3, Frame } from "./types";

// One renderer for the whole export, always drawing the retained mesh at
// the output cell's real resolution (never the atlas's small PNG).
export function spatialSheetPainter(
  style: PaintStyle,
  bounds?: Bounds3,
): SheetPainter<Frame> {
  const canvas = document.createElement("canvas");
  const renderer = createRenderer(canvas, style.scheme);
  return {
    async draw(frame, page, signal) {
      signal.throwIfAborted();
      renderer.upload(frame.result);
      renderer.setProbe([]);
      renderer.setCut(cutSpec(style.cut).spec);
      renderer.setSight(sightSpec(unprobed(style.sight)).spec);
      renderer.draw(
        paintView(bounds ?? frame.result.bounds, style),
        style.layers,
        style.dark,
        page,
      );
      if (canvas.getContext("webgl")?.isContextLost())
        throw new Error("The graphics context was lost while drawing.");
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) =>
            b
              ? resolve(b)
              : reject(new Error("The variant could not be encoded.")),
          "image/png",
        ),
      );
      signal.throwIfAborted();
      return blob;
    },
    dispose() {
      renderer.dispose();
      canvas
        .getContext("webgl")
        ?.getExtension("WEBGL_lose_context")
        ?.loseContext();
      canvas.width = canvas.height = 0;
    },
  };
}
