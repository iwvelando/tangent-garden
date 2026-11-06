import { useMemo } from "react";
import type { ColorScheme } from "../color-schemes";
import { plotPalette } from "../palette";
import { svgStroke, type LineWeight } from "../line-weight";
import { usePageGestures } from "../page-gestures";
import type { PlotCamera } from "../planar-link";
import {
  normalized,
  pageScale,
  shortenPage,
  shortenZoom,
  type Framing,
  type Nest,
  type ShortenContour,
} from "./model";

export type ShortenDrawingProps = {
  // The seed's largest radius, which fixes the physical frame.
  extent: number;
  family: ShortenContour[];
  // The loop at the motion's time, while a motion is frozen.
  current?: ShortenContour;
  framing: Framing;
  // During a motion, whether family loops later than the shown time are
  // drawn, faint, or left out, so the nest grows with the motion.
  nest: Nest;
  camera: PlotCamera;
  dark: boolean;
  scheme: ColorScheme;
  weight: LineWeight;
};
const { width, height } = shortenPage;

const fixed = (v: number) => v.toFixed(2);
function pathOf(x: number[], y: number[], k: number) {
  let d = "";
  for (let i = 0; i < x.length; i++)
    d += `${i ? "L" : "M"}${fixed(500 + x[i] * k)} ${fixed(380 - y[i] * k)}`;
  return d + "Z";
}

// The loops alone: the family in the base ink, the loop at the shown time
// in the derived ink, in page units at the camera's zoom; the pan is the
// group's translation. Physical framing is fixed by the seed, so the nest
// shrinks on the page; normalized framing rescales each loop about its
// centroid to the starting area. No text.
function Art(p: ShortenDrawingProps & { clip?: string }) {
  const palette = plotPalette(p.dark, p.scheme),
    stroke = svgStroke(p.weight);
  const k = pageScale(p.extent) * p.camera.zoom;
  const area0 = p.family[0]?.area ?? 1;
  const shape = (c: ShortenContour) => {
    if (p.framing !== "normalized") return pathOf(c.x, c.y, k);
    const n = normalized(c, area0);
    return pathOf(n.x, n.y, k);
  };
  const family = useMemo(
    () => p.family.map(shape),
    [p.family, p.framing, k, area0],
  );
  return (
    <>
      {p.clip && (
        <defs>
          <clipPath id={p.clip}>
            <rect width={width} height={height} />
          </clipPath>
        </defs>
      )}
      <rect width={width} height={height} fill={palette.bg} />
      <g clipPath={p.clip ? `url(#${p.clip})` : undefined}>
        <g
          transform={`translate(${p.camera.x} ${p.camera.y})`}
          fill="none"
          strokeLinejoin="round"
        >
          {family.map((d, i) => {
            const ahead =
              p.current !== undefined && p.family[i].t > p.current.t;
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
                      ? 0.5
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
      </g>
    </>
  );
}

// The still and export page: the same loops, with the study's record in
// the root's desc rather than in the drawing.
export function ShortenStill(p: ShortenDrawingProps & { metadata: unknown }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      style={{ background: plotPalette(p.dark, p.scheme).bg }}
    >
      <desc>{JSON.stringify(p.metadata)}</desc>
      <Art {...p} clip="shorten-clip" />
    </svg>
  );
}

// The live drawing: drag to pan, wheel or pinch to zoom, keys to move.
export function ShortenDrawing(
  p: ShortenDrawingProps & {
    busy: boolean;
    progress: number;
    onCamera?: (c: PlotCamera) => void;
  },
) {
  const gestures = usePageGestures({
    page: shortenPage,
    range: shortenZoom,
    camera: p.camera,
    onCamera: p.onCamera,
  });
  return (
    <svg
      {...gestures}
      id="shorten-artwork"
      overflow="hidden"
      style={{ background: plotPalette(p.dark, p.scheme).bg }}
      className="garden-drawing"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="A nest of loops shrinking by curve shortening"
      aria-busy={p.busy}
      data-zoom={p.camera.zoom}
      data-pan={`${p.camera.x},${p.camera.y}`}
      data-progress={p.progress}
      data-time={p.current?.t}
      data-framing={p.framing}
      data-nest={p.nest}
    >
      <Art {...p} />
    </svg>
  );
}
