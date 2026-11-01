import type { ColorScheme } from "../color-schemes";
import type { ReactNode } from "react";
import { Drawing } from "./Drawing";
import { objects, type ObjectDescriptor } from "./objects";
import {
  initialView,
  type Config,
  type Result,
  type View,
  type Layers,
} from "./types";
import { exportBaseSize, type ExportLayout } from "../export-quality";
import { plotPalette } from "../palette";
export type DrawingProps = {
  result: Result;
  config: Config;
  view: View;
  layers: Layers;
  dark: boolean;
  scheme?: ColorScheme;
};
export type CompositionProps = DrawingProps & {
  diagramView?: View;
  layout?: ExportLayout;
};
export type PanelViewport = {
  x: number;
  y: number;
  width: number;
  height: number;
};
// A paired study's modes in display order: left to right, or top to bottom.
export const pairedOrder = (d: ObjectDescriptor): Config["mode"][] =>
  d.companionFirst ? [...d.pairedModes!].reverse() : [...d.pairedModes!];
// Compose already-projected Go geometry. No collision or 4D geometry is
// evaluated here. One returned result determines both panels' physical time.
export function Composition(
  p: CompositionProps & {
    // index is 0 for the result's own panel and 1 for its companion's,
    // wherever the layout places them.
    renderPanel?: (
      panel: DrawingProps,
      viewport: PanelViewport,
      index: number,
    ) => ReactNode;
  },
) {
  const companion = p.result.companion;
  if (!companion) return <Drawing {...p} />;
  const layout = p.layout ?? "columns",
    size = exportBaseSize(layout),
    descriptor = objects[p.config.object],
    modes = descriptor.pairedModes!,
    panels: DrawingProps[] = [
      {
        ...p,
        config: { ...p.config, mode: modes[0] },
        result: {
          ...p.result,
          companion: undefined,
          operation: modes[0],
          emittedPoints: p.result.emittedPoints - companion.emittedPoints,
          evaluations: p.result.evaluations - companion.evaluations,
        },
      },
      {
        ...p,
        config: { ...p.config, mode: modes[1] },
        result: companion,
        view: p.diagramView ?? initialView,
      },
    ],
    // Logical panel indices in display order.
    order = descriptor.companionFirst ? [1, 0] : [0, 1];
  return (
    <>
      <title>{objects[p.config.object].title(p.config)}</title>
      <desc>
        {JSON.stringify({
          config: p.config,
          view: p.view,
          layers: p.layers,
          layout,
          object: p.result.object,
          operation: p.result.operation,
          emittedPoints: p.result.emittedPoints,
          evaluations: p.result.evaluations,
          views: order
            .map((i) => panels[i])
            .map((panel) => ({
              operation: panel.config.mode,
              view: panel.view,
              bypass: panel.result.bypass,
              markers: panel.result.markers,
              framingRadius: panel.result.radius,
            })),
          limitations: objects[p.config.object].limitations,
          rendering: "transparent vector construction",
        })}
      </desc>
      <rect
        width={size.width}
        height={size.height}
        fill={plotPalette(p.dark, p.scheme).bg}
      />
      {order.map((index, position) => {
        const panel = panels[index];
        const viewport = {
          x: layout === "columns" ? position * 1000 : 0,
          y: layout === "rows" ? position * 760 : 0,
          width: 1000,
          height: 760,
        };
        return (
          <g key={panel.config.mode}>
            {p.renderPanel ? (
              p.renderPanel(panel, viewport, index)
            ) : (
              <svg
                {...viewport}
                data-representation={panel.config.mode}
                viewBox="0 0 1000 760"
                overflow="hidden"
              >
                <Drawing {...panel} />
              </svg>
            )}
          </g>
        );
      })}
      <path
        d={layout === "columns" ? "M1000,0V760" : "M0,760H1000"}
        stroke={plotPalette(p.dark, p.scheme).axis}
        strokeWidth="1"
      />
    </>
  );
}
