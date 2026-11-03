import { useMemo } from "react";
import type { ColorScheme } from "../color-schemes";
import { plotPalette } from "../palette";
import { svgStroke } from "../line-weight";
import {
  labPage,
  normalized,
  pageScale,
  pathOf,
  type Framing,
  type Nest,
  type ShortenContour,
} from "./model";

export type LabDrawingProps = {
  // The seed's largest radius, which fixes the physical frame.
  extent: number;
  family: ShortenContour[];
  current?: ShortenContour;
  framing: Framing;
  // Whether family loops later than the shown time are drawn, faint, or
  // left out, so the nest grows with the motion.
  nest: Nest;
  dark: boolean;
  scheme: ColorScheme;
};
const { width, height } = labPage;

// The loops alone: the family in the base ink, the loop at the shown time
// in the derived ink. Physical framing is fixed by the seed, so the nest
// shrinks on the page; normalized framing rescales each loop about its
// centroid to the starting area. No text.
function Art(p: LabDrawingProps) {
  const palette = plotPalette(p.dark, p.scheme),
    stroke = svgStroke("regular");
  const k = pageScale(p.extent);
  const area0 = p.family[0]?.area ?? 1;
  const shape = (c: ShortenContour) =>
    p.framing === "normalized"
      ? (() => {
          const n = normalized(c, area0);
          return pathOf(n.x, n.y, k);
        })()
      : pathOf(c.x, c.y, k);
  const family = useMemo(
    () => p.family.map(shape),
    [p.family, p.framing, k, area0],
  );
  return (
    <>
      <rect width={width} height={height} fill={palette.bg} />
      <g fill="none" strokeLinejoin="round">
        {family.map((d, i) => {
          const ahead = p.current !== undefined && p.family[i].t > p.current.t;
          if (ahead && p.nest === "grows") return null;
          return (
            <path
              key={i}
              data-role="family"
              d={d}
              stroke={palette.base}
              opacity={
                ahead && p.nest === "ghost"
                  ? 0.18
                  : p.framing === "normalized"
                    ? 0.45
                    : 0.85
              }
              {...stroke(1.1)}
            />
          );
        })}
        {p.current && (
          <path
            data-role="current"
            d={shape(p.current)}
            stroke={palette.derived}
            {...stroke(2.4)}
          />
        )}
      </g>
    </>
  );
}

export function LabStill(p: LabDrawingProps & { metadata: unknown }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      style={{ background: plotPalette(p.dark, p.scheme).bg }}
    >
      <desc>{JSON.stringify(p.metadata)}</desc>
      <Art {...p} />
    </svg>
  );
}

export function LabDrawing(p: LabDrawingProps & { busy: boolean }) {
  return (
    <svg
      className="shorten-drawing"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Curve-shortening contours"
      aria-busy={p.busy}
    >
      <Art {...p} />
    </svg>
  );
}
