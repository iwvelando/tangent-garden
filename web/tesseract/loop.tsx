// The 4D notebook's loop check (see ../loop-check.ts), loaded only when a
// loop is played, since it draws with React's static renderer as export
// does. Whole turns and slice passages end where they start by
// construction; the check confirms it on the drawing itself.
import { renderToStaticMarkup } from "react-dom/server";
import { Composition } from "./Composition";
import type { EngineClient } from "../engine-client";
import { exportBaseSize, type ExportLayout } from "../export-quality";
import { loopRefusal } from "../loop-check";
import {
  sample,
  type Config,
  type Layers,
  type Motion,
  type View,
} from "./types";

// Why the drawing at the end of the motion is not the drawing at its
// start, or null when a loop can join them.
export async function tesseractLoopGap(o: {
  client: EngineClient;
  config: Config;
  motion: Motion;
  view: View;
  diagramView: View;
  layers: Layers;
  layout?: ExportLayout;
}): Promise<string | null> {
  const size = exportBaseSize(o.layout);
  const draw = async (p: number) => {
    const config = sample(o.config, o.motion, p),
      result = await o.client.tesseract(config);
    return renderToStaticMarkup(
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size.width}
        height={size.height}
        viewBox={`0 0 ${size.width} ${size.height}`}
      >
        <Composition {...o} dark={false} config={config} result={result} />
      </svg>,
    );
  };
  return loopRefusal(
    await draw(0),
    await draw(1),
    " Choose Back and forth.",
    size,
  );
}
