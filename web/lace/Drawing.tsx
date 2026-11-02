import { useMemo, type ReactNode } from "react";
import type { ColorScheme } from "../color-schemes";
import { svgStroke, type LineWeight } from "../line-weight";
import { usePageGestures } from "../page-gestures";
import { plotPalette } from "../palette";
import type { PlotCamera } from "../planar-link";
import type { Vec } from "../types";
import {
  hitTile,
  lacePage,
  laceScale,
  laceStrokes,
  laceZoom,
  presented,
  type LacePresentation,
  type LaceResult,
} from "./model";

export type LaceDrawingProps = {
  result: LaceResult;
  edges: boolean;
  motif: boolean;
  presentation: LacePresentation;
  // Breadth-first index of the selected tile, or −1.
  selected: number;
  camera: PlotCamera;
  dark: boolean;
  scheme: ColorScheme;
  weight: LineWeight;
};
const { width, height } = lacePage;

const fixed = (v: number) => String(+v.toFixed(3));
// One geodesic arc as SVG path commands, in page units at scale k (the pan
// is the enclosing group's translation). A geodesic's arc inside the disk
// is less than half its circle, so it is the minor arc. The page turns the
// model's y down, so an arc running clockwise in the model, its angle
// decreasing, runs with increasing angle on the page: SVG's positive
// sweep. A diameter's segment is a line.
export function arcCommand(
  s: Vec,
  e: Vec,
  c: Vec,
  radius: number,
  straight: boolean,
  k: number,
) {
  const from = `M${fixed(500 + s.x * k)} ${fixed(380 - s.y * k)}`;
  const to = `${fixed(500 + e.x * k)} ${fixed(380 - e.y * k)}`;
  if (straight) return `${from}L${to}`;
  const clockwise = (s.x - c.x) * (e.y - c.y) - (s.y - c.y) * (e.x - c.x) < 0;
  const r = fixed(radius * k);
  return `${from}A${r} ${r} 0 0 ${clockwise ? 1 : 0} ${to}`;
}

// Strokes taper toward the rim as the tiles shrink there, so the finite
// patch's last rings read as lace rather than a solid band. A stroke's
// level is how many half-octaves its tile is drawn smaller than the center
// tile at 1× zoom, and its width falls by a quarter-octave per level,
// with the square root of its drawn size, to a floor. Zooming in draws
// tiles larger, so their strokes widen back toward full width.
const levels = 24;
export const taper = (level: number) => Math.max(0.06, 2 ** (-level / 4));
const levelOf = (size: number, reference: number) =>
  Math.max(0, Math.min(levels, Math.ceil(2 * Math.log2(reference / size))));

// Regular widths by role, in page units before tapering.
const widths = {
  rim: 1.4,
  edge: 0.9,
  motif: 1.6,
  pathEdge: 1.4,
  pathMotif: 1.8,
  selectedEdge: 2,
  selectedMotif: 2.2,
};
type Role = keyof typeof widths;

function Geometry(p: LaceDrawingProps) {
  const palette = plotPalette(p.dark, p.scheme),
    stroke = svgStroke(p.weight);
  const { result: r, presentation, selected, edges, motif } = p;
  const zoom = p.camera.zoom;
  return useMemo(() => {
    const k = laceScale * zoom;
    const shown = presented(r, presentation, selected);
    const path = new Set<number>();
    if (selected >= 0)
      for (let t = selected; t >= 0; t = r.parent[t]) path.add(t);
    const shownTiles = new Set(shown);
    // Reference sizes: the center tile's reach and side, drawn at 1×.
    const v0 = r.vertex[r.corners[0]],
      v1 = r.vertex[r.corners[1]];
    const sideRef = Math.hypot(v1.x - v0.x, v1.y - v0.y) * laceScale;
    const reachRef = r.vertexRadius * laceScale;
    const runs = new Map<string, string[]>();
    const add = (role: Role, level: number, d: string) => {
      const key = `${role} ${level}`;
      let run = runs.get(key);
      if (!run) runs.set(key, (run = []));
      run.push(d);
    };
    const tileRole = (t: number, base: Role, pathRole: Role, sel: Role) =>
      t === selected ? sel : path.has(t) ? pathRole : base;
    if (edges || selected >= 0) {
      // Each shown edge once, in the role of its most prominent tile; with
      // edges hidden, only the selected tile's sides mark it.
      const role = new Map<number, Role>();
      const rank: Record<Role, number> = {
        edge: 0,
        pathEdge: 1,
        selectedEdge: 2,
      } as Record<Role, number>;
      for (const t of shown)
        for (let s = 0; s < 7; s++) {
          const e = r.sides[7 * t + s];
          const want = tileRole(t, "edge", "pathEdge", "selectedEdge");
          if (!edges && want !== "selectedEdge") continue;
          const had = role.get(e);
          if (had === undefined || rank[want] > rank[had]) role.set(e, want);
        }
      for (const [e, which] of role) {
        const a = r.vertex[r.edgeA[e]],
          b = r.vertex[r.edgeB[e]];
        const size = Math.hypot(b.x - a.x, b.y - a.y) * k;
        add(
          which,
          levelOf(size, sideRef),
          arcCommand(
            a,
            b,
            r.edgeCenter[e],
            r.edgeRadius[e],
            r.edgeStraight[e],
            k,
          ),
        );
      }
    }
    if (motif)
      for (const t of shownTiles) {
        const which = tileRole(t, "motif", "pathMotif", "selectedMotif");
        let out = 0;
        for (let c = 0; c < 7; c++) {
          const v = r.vertex[r.corners[7 * t + c]];
          out = Math.max(
            out,
            Math.hypot(v.x - r.center[t].x, v.y - r.center[t].y),
          );
        }
        const level = levelOf(out * k, reachRef);
        for (let s = 0; s < laceStrokes; s++) {
          const a = laceStrokes * t + s;
          add(
            which,
            level,
            arcCommand(
              r.arcStart[a],
              r.arcEnd[a],
              r.arcCenter[a],
              r.arcRadius[a],
              r.arcStraight[a],
              k,
            ),
          );
        }
      }
    const ink: Record<Role, string> = {
      rim: palette.base,
      edge: palette.line,
      motif: palette.base,
      pathEdge: palette.base,
      pathMotif: palette.base,
      selectedEdge: palette.derived,
      selectedMotif: palette.derived,
    };
    // With a selection, the rest of the lace recedes.
    const recede = selected >= 0;
    const order: Role[] = [
      "edge",
      "motif",
      "pathEdge",
      "pathMotif",
      "selectedEdge",
      "selectedMotif",
    ];
    const out: ReactNode[] = [];
    for (const role of order)
      for (let level = 0; level <= levels; level++) {
        const run = runs.get(`${role} ${level}`);
        if (!run) continue;
        out.push(
          <path
            key={`${role}-${level}`}
            data-role={role}
            data-level={level}
            d={run.join("")}
            stroke={ink[role]}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={
              recede && (role === "edge" || role === "motif")
                ? 0.35
                : role === "edge"
                  ? 0.7
                  : undefined
            }
            {...stroke(widths[role] * taper(level))}
          />,
        );
      }
    // The rim, the disk's boundary at infinity, which no tile reaches.
    out.push(
      <circle
        key="rim"
        data-role="rim"
        cx={500}
        cy={380}
        r={k}
        stroke={ink.rim}
        {...stroke(widths.rim)}
      />,
    );
    return out;
  }, [
    r,
    presentation,
    selected,
    edges,
    motif,
    zoom,
    p.weight,
    palette.base,
    palette.derived,
    palette.line,
  ]);
}

function Art(p: LaceDrawingProps & { clip: string }) {
  const palette = plotPalette(p.dark, p.scheme);
  return (
    <>
      <defs>
        <clipPath id={p.clip}>
          <rect width={width} height={height} />
        </clipPath>
      </defs>
      <rect width={width} height={height} fill={palette.bg} />
      <g clipPath={`url(#${p.clip})`}>
        <g transform={`translate(${p.camera.x} ${p.camera.y})`} fill="none">
          <Geometry {...p} />
        </g>
      </g>
    </>
  );
}

// The still and export page: the same geometry, with the study's record in
// the root's desc rather than in the drawing.
export function LaceStill(p: LaceDrawingProps & { metadata: unknown }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      // The page's color fills whatever viewer shows the file, as the
      // other notebooks' exports do.
      style={{ background: plotPalette(p.dark, p.scheme).bg }}
    >
      <desc>{JSON.stringify(p.metadata)}</desc>
      <Art {...p} clip="lace-clip" />
    </svg>
  );
}

// The live drawing: drag to pan, wheel or pinch to zoom, keys to move, and
// a click or tap on a tile to select it.
export function LaceDrawing(
  p: LaceDrawingProps & {
    busy: boolean;
    onCamera?: (c: PlotCamera) => void;
    onSelect?: (i: number) => void;
  },
) {
  const gestures = usePageGestures({
    page: lacePage,
    range: laceZoom,
    camera: p.camera,
    onCamera: p.onCamera,
    onTap:
      p.onSelect &&
      ((at, tolerance) => {
        const i = hitTile(
          p.result,
          presented(p.result, p.presentation, p.selected),
          at,
          p.camera,
          tolerance,
        );
        if (i >= 0) p.onSelect?.(i);
      }),
  });
  return (
    <svg
      {...gestures}
      id="lace-artwork"
      className="garden-drawing"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Hyperbolic tiling with a reflected motif"
      aria-busy={p.busy}
      data-zoom={p.camera.zoom}
      data-pan={`${p.camera.x},${p.camera.y}`}
      data-selected={p.selected}
      data-presentation={p.presentation}
      data-tiles={p.result.center.length}
    >
      <Art {...p} clip="lace-live-clip" />
    </svg>
  );
}
