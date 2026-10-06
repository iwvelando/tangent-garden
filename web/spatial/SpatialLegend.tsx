// The 3D drawing's legend. It describes the drawn study, whose result the
// renderer reports the layers of as it uploads it (sceneLayers in
// scene.ts), through a feed, so that each upload re-renders the legend
// alone. Until the drawn result's own report arrives, the legend follows
// the layers only: it never reads one study's geometry with another's
// entries.
import { useEffect, useState } from "react";
import { LegendEntries } from "../Legend";
import { spatialLegend } from "./legend";
import type { Layers } from "./scene";
import type { SpatialConfig, SpatialResult } from "./types";

type Drawable = { result: SpatialResult; layers: ReadonlySet<string> };
export type GeometryFeed = {
  last?: Drawable;
  listener?: (drawable: Drawable) => void;
};
export function feedGeometry(
  feed: GeometryFeed,
  result: SpatialResult,
  layers: ReadonlySet<string>,
) {
  feed.last = { result, layers };
  feed.listener?.(feed.last);
}

export function SpatialLegend({
  feed,
  config,
  result,
  layers,
  cutEdge,
}: {
  feed: GeometryFeed;
  // The drawn study, or the edited one before anything is drawn.
  config: SpatialConfig;
  result?: SpatialResult;
  layers: Layers;
  // Whether the cut's edge is drawn.
  cutEdge: boolean;
}) {
  const [drawn, setDrawn] = useState(feed.last);
  useEffect(() => {
    feed.listener = setDrawn;
    setDrawn(feed.last);
    return () => {
      feed.listener = undefined;
    };
  }, [feed]);
  const geometry = drawn && drawn.result === result ? drawn.layers : null;
  return (
    <div className="legend">
      <LegendEntries
        entries={[
          ...spatialLegend(config).map(({ layer, swatch, label }) => ({
            key: layer,
            shown:
              (layer === "base" || layers[layer as keyof Layers]) &&
              (geometry === null || geometry.has(layer)),
            content: (
              <>
                <span className={swatch} />
                {label}
              </>
            ),
          })),
          ...(cutEdge
            ? [
                {
                  key: "cut",
                  shown: true,
                  content: (
                    <>
                      <span className="cut-dot" />
                      Cut edge
                    </>
                  ),
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}
