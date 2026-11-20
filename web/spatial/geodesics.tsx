import { readout as formatNumber } from "../number-format";
import type { ReactNode } from "react";
import { describeColors, type ColorScheme } from "../color-schemes";
import { Field } from "../Field";
import { tiered, type Help } from "../help";
import {
  maxGeodesicSamples,
  maxGeodesicThreads,
  maxPolygonVertices,
  maxTransportArrows,
  minPolygonVertices,
  type GeodesicConfig,
  type PolygonVertex,
  type GeodesicResult,
  type SurfaceConfig,
  type SurfaceKind,
  type TransportConfig,
  type TransportPath,
  type Vec3,
} from "./types";
import { count, plural } from "../number-format";
import { roundedGenerated } from "../atlas";
import { surfaceCapabilities } from "./surface";
import { vertexLabel } from "./animation";
export { revealGeodesics, threadPath } from "./geodesic-path";

// Whether a kind's geodesic threads can be launched: the controls appear
// with these (engine3's geodesicSurface says when an ellipsoid's or a
// torus's shape cannot carry them).
export const carriesThreads = (kind: SurfaceKind) =>
  !!surfaceCapabilities[kind].geodesics;
// Whether its threads run within its patch, stopped at its edges.
const withinPatch = (kind: SurfaceKind) =>
  surfaceCapabilities[kind].geodesics === "patch";

// The middle of a domain, shortened only within rounding of its ends.
const middle = (lo: number, hi: number) =>
  Math.min(
    hi,
    Math.max(
      lo,
      roundedGenerated((lo + hi) / 2, Math.max(Math.abs(lo), Math.abs(hi))),
    ),
  );

// The range of k·x²/2 over [lo, hi].
const heightRange = (k: number, lo: number, hi: number) =>
  (Math.abs(k) *
    (Math.max(lo * lo, hi * hi) -
      (lo <= 0 && hi >= 0 ? 0 : Math.min(lo * lo, hi * hi)))) /
  2;

// Turning the threads on starts a small fan. On a whole surface it leaves
// the chart's origin, as long as a few turns around it: on an ellipsoid,
// one great circle of its largest semi-axis a, 2πa, and on a torus four
// turns of its outer equator, 8π(R + r). On a patch it leaves the middle
// of the domain, twice as long as the patch's diagonal in its own metric,
// so most threads reach an edge: hypot(a·Δu, Δv) with a the larger
// semi-axis on a cylinder, hypot(Δu, Δv, Δz) with Δz the range of heights
// on a paraboloid, and s·hypot(cosh v̄·Δu, sinh v₁ − sinh v₀) on the
// helicoid–catenoid family.
// Every default length is capped at the admitted thread length, 100000, so
// a large ellipsoid or torus launches a shorter fan rather than a refusal.
// The length is generated, so it is kept to three significant figures rather
// than show its arithmetic.
export function geodesicDefaults(s: SurfaceConfig): GeodesicConfig {
  const du = s.uMax - s.uMin,
    vMid = middle(s.vMin, s.vMax);
  const turn =
    s.kind === "torus"
      ? 4 * 2 * Math.PI * (Math.abs(s.a) + Math.abs(s.b))
      : s.kind === "cylinder"
        ? 2 * Math.hypot(Math.max(s.a, s.b) * du, s.vMax - s.vMin)
        : s.kind === "paraboloid"
          ? 2 *
            Math.hypot(
              du,
              s.vMax - s.vMin,
              heightRange(s.a, s.uMin, s.uMax) +
                heightRange(s.b, s.vMin, s.vMax),
            )
          : s.kind === "helicoid-catenoid"
            ? 2 *
              s.a *
              Math.hypot(
                Math.cosh(vMid) * du,
                Math.sinh(s.vMax) - Math.sinh(s.vMin),
              )
            : 2 *
              Math.PI *
              Math.max(Math.abs(s.a), Math.abs(s.b), Math.abs(s.c));
  const length = Number(
    (Number.isFinite(turn) && turn > 0 ? turn : 1).toPrecision(3),
  );
  const patch = withinPatch(s.kind);
  return {
    u: patch ? middle(s.uMin, s.uMax) : 0,
    v: patch ? vMid : 0,
    direction: 45,
    spread: 60,
    count: 12,
    length: Math.min(length, 100000),
    samples: 1200,
    selected: 1,
  };
}

// Keep a retained fan's start admitted when choosing a surface: within a
// patch's domain, or within an ellipsoid's latitude range. Move only a
// coordinate that lies outside its range.
export function startWithin(s: SurfaceConfig): SurfaceConfig {
  const g = s.geodesics;
  if (!g) return s;
  if (s.kind === "ellipsoid" && Math.abs(g.v) > Math.PI / 2)
    return { ...s, geodesics: { ...g, v: 0 } };
  if (!withinPatch(s.kind)) return s;
  const inside = (x: number, lo: number, hi: number) => x >= lo && x <= hi;
  if (inside(g.u, s.uMin, s.uMax) && inside(g.v, s.vMin, s.vMax)) return s;
  return {
    ...s,
    geodesics: {
      ...g,
      u: inside(g.u, s.uMin, s.uMax) ? g.u : middle(s.uMin, s.uMax),
      v: inside(g.v, s.vMin, s.vMax) ? g.v : middle(s.vMin, s.vMax),
    },
  };
}

// Launching the threads (`surface.geodesics`). Absent means off, as in links
// made before it.
export const geodesicsHelp = tiered(
  "Traces threads that go straight on the surface, from one point in a fan of directions.",
  "On an ellipsoid whose shortest semi-axis is at least 1% of its longest, or a ring torus with R above r by 0.1% of r or more, they cover the whole surface. On a cylinder, paraboloid or the helicoid–catenoid family they stop at the patch's edge, except across a whole-turn cylinder's seam. Elsewhere they are unavailable.",
);
export const geodesicHelp = {
  start: tiered(
    "Where the threads start, in the chart's u and v.",
    "Each within ±100000. On an ellipsoid v₀ is a latitude, within ±π/2; at a pole, u₀ names the meridian whose direction is v. On a cylinder, a paraboloid or the helicoid–catenoid family the start lies within the patch's domain.",
  ),
  direction: tiered(
    "The fan's middle direction, in degrees from u toward v.",
    "Measured from unit X_u toward the perpendicular on X_v's side, whichever side the normal is on; within ±100000.",
  ),
  spread: tiered(
    "0–360°, shared evenly; 360° rings the point.",
    "Each thread leaves at the middle of its share, so a single thread leaves at β.",
  ),
  count: `1–${maxGeodesicThreads} threads in the fan.`,
  selected: "The thread drawn broad and described, counted from 1.",
  length: tiered(
    "Each thread's arc length, above 0 and at most 100000.",
    "Except on a sphere, the fan, with any arrow carried along a thread, shares 200,000 integration steps; a thread that runs out stops there, marked by a cross. On a cylinder, a paraboloid or the helicoid–catenoid family a thread also stops where it reaches the patch's edge.",
  ),
  samples: tiered(
    `8–${maxGeodesicSamples} per thread, 200,000 points in all.`,
    "Samples are evenly spaced in arc length. The integration takes its own steps between them. A carried arrow's path counts as one more thread, plus two points or, around a polygon of more than three vertices, one per vertex after the first.",
  ),
} satisfies Record<string, Help<string>>;

// What the fan is, which threads stopped short and why, and the colors.
export function geodesicsNote(
  g: GeodesicResult,
  config: GeodesicConfig,
  scheme: ColorScheme,
): string[] {
  if (g.unavailable) return [g.unavailable];
  const threads = plural(g.threads.length, "thread", "threads"),
    each = g.threads.length === 1 ? "" : "each ";
  const long = `${each}${formatNumber(config.length)} long, integrated in ${count(g.steps)} steps`;
  const out = [
    g.surface === "sphere"
      ? `${threads} on the sphere, ${each}a great circle traced exactly, ${formatNumber(config.length)} long.`
      : g.surface === "cylinder"
        ? `${threads} on the cylinder, ${long}; unrolled flat, ${g.threads.length === 1 ? "it is a straight line" : "each is a straight line"}.`
        : g.surface === "helicoid-catenoid"
          ? `${threads} on the patch, ${long}. Every angle θ bends the patch without stretching it, so ${g.threads.length === 1 ? "it keeps its" : "they keep their"} route in (u, v).`
          : g.surface === "ellipsoid"
            ? `${threads} over the whole ellipsoid, poles included, ${long}.`
            : `${threads} on the ${g.surface === "paraboloid" ? "paraboloid" : "torus"}, ${long}.`,
  ];
  const edged = g.threads.filter((t) => t.reason === "edge").length;
  if (edged)
    out.push(
      `${plural(edged, "thread stops where it reaches", "threads stop where they reach")} the patch's edge.`,
    );
  const exhausted = g.threads.filter((t) => t.reason === "exhausted").length;
  const unresolved = g.threads.filter((t) => t.reason === "unresolved").length;
  if (exhausted)
    out.push(
      `${plural(exhausted, "thread", "threads")} ran out of the fan's 200,000 steps before ${exhausted === 1 ? "its" : "their"} length, marked by a cross.`,
    );
  if (unresolved)
    out.push(
      `${plural(unresolved, "thread", "threads")} could not be integrated further, marked by a cross.`,
    );
  out.push(
    describeColors(
      "Threads shade from teal to gold in fan order; the selected thread is drawn broad.",
      scheme,
    ),
  );
  return out;
}

// The length a return is measured in, per surface.
const returnUnits: Record<GeodesicResult["surface"], string> = {
  sphere: "r",
  ellipsoid: "of the largest semi-axis",
  torus: "r",
  cylinder: "of the larger semi-axis",
  paraboloid: "of the patch's half-extent",
  "helicoid-catenoid": "s",
  "": "",
};

// The angle between two unit vectors a chord d apart, in degrees.
const turned = (d: number) =>
  (2 * Math.asin(Math.min(1, d / 2)) * 180) / Math.PI;

// Joachimsthal's p·D on an ellipsoid of semi-axes (a, b, c), at point p
// heading t: the distance from the center to the tangent plane times the
// semi-diameter along t, constant along a geodesic.
export function joachimsthal(
  [a, b, c]: readonly [number, number, number],
  p: Vec3,
  t: Vec3,
) {
  const normal =
      (p.x / a ** 2) ** 2 + (p.y / b ** 2) ** 2 + (p.z / c ** 2) ** 2,
    along = (t.x / a) ** 2 + (t.y / b) ** 2 + (t.z / c) ** 2;
  return 1 / Math.sqrt(normal * along);
}

// The selected thread, described: where it leaves, how far it ran, its
// invariant (given an ellipsoid's semi-axes), and how near it returns to
// its start.
export function selectedNote(
  g: GeodesicResult,
  axes?: readonly [number, number, number],
): string {
  const th = g.threads[g.selected - 1];
  if (!th) return "";
  const k = g.selected;
  const edge =
    th.edge === "uMin" || th.edge === "uMax"
      ? `u = ${formatNumber(th.endU)}`
      : `v = ${formatNumber(th.endV)}`;
  const ran =
    th.reason === "end"
      ? "runs its whole length"
      : th.reason === "edge"
        ? `reaches the patch's edge ${edge} at ${formatNumber(th.reached)}`
        : th.reason === "exhausted"
          ? `ran out of steps at ${formatNumber(th.reached)}`
          : `could not be integrated past ${formatNumber(th.reached)}`;
  const p = th.points[0],
    t = th.tangents[0];
  const invariant =
    g.surface === "torus"
      ? `; Clairaut's ρ cos ψ is ${formatNumber(p.x * t.y - p.y * t.x)}`
      : g.surface === "ellipsoid" && axes
        ? `; Joachimsthal's p·D is ${formatNumber(joachimsthal(axes, p, t))}`
        : "";
  const back =
    th.reason !== "end"
      ? ""
      : th.closes
        ? ", and returns to its start within 10⁻⁶ in position and direction"
        : `, and ends ${formatNumber(th.return.position)} ${returnUnits[g.surface]} from its start, heading ${formatNumber(turned(th.return.direction))}° from its first direction`;
  return `Thread ${k} leaves at ${formatNumber(th.direction)}° and ${ran}${invariant}${back}.`;
}

type Vector = (
  label: string,
  value: number,
  set: (value: number) => void,
  help?: Help<string>,
) => ReactNode;

function Whole({
  label,
  value,
  min,
  max,
  help,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  help: Help<string>;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label} help={help}>
      <input
        type="number"
        min={min}
        max={max}
        step="1"
        value={Number.isNaN(value) ? "" : value}
        onChange={(e) => onChange(e.target.valueAsNumber)}
      />
    </Field>
  );
}

// The fan's own fields, shown while the threads are on.
export function GeodesicFields({
  g,
  vector,
  set,
}: {
  g: GeodesicConfig;
  vector: Vector;
  set: (change: (g: GeodesicConfig) => GeodesicConfig) => void;
}) {
  const scalar =
    (key: "u" | "v" | "direction" | "spread" | "length") => (value: number) =>
      set((g) => ({ ...g, [key]: value }));
  return (
    <>
      <div className="pair">
        {vector("Start u₀", g.u, scalar("u"), geodesicHelp.start)}
        {vector("Start v₀", g.v, scalar("v"))}
      </div>
      <div className="pair">
        {vector(
          "Direction β (°)",
          g.direction,
          scalar("direction"),
          geodesicHelp.direction,
        )}
        {vector(
          "Fan spread (°)",
          g.spread,
          scalar("spread"),
          geodesicHelp.spread,
        )}
      </div>
      <div className="pair">
        <Whole
          label="Threads"
          value={g.count}
          min={1}
          max={maxGeodesicThreads}
          help={geodesicHelp.count}
          onChange={(count) =>
            // Fewer threads keep the selection among them.
            set((g) => ({
              ...g,
              count,
              selected:
                Number.isInteger(count) && count >= 1
                  ? Math.min(g.selected, count)
                  : g.selected,
            }))
          }
        />
        <Whole
          label="Selected thread"
          value={g.selected}
          min={1}
          max={Math.max(1, g.count)}
          help={geodesicHelp.selected}
          onChange={(selected) => set((g) => ({ ...g, selected }))}
        />
      </div>
      <div className="pair">
        {vector(
          "Thread length L",
          g.length,
          scalar("length"),
          geodesicHelp.length,
        )}
        <Whole
          label="Samples per thread"
          value={g.samples}
          min={8}
          max={maxGeodesicSamples}
          help={geodesicHelp.samples}
          onChange={(samples) => set((g) => ({ ...g, samples }))}
        />
      </div>
    </>
  );
}

// The length a kind's arrow is drawn against, as engine3's geodesic scale:
// an ellipsoid's largest semi-axis, a cylinder's larger one, the family's
// scale s, half a paraboloid patch's largest extent along x, y or z; on a
// torus, its tube radius.
function arrowScale(s: SurfaceConfig) {
  switch (s.kind) {
    case "torus":
      return Math.abs(s.b);
    case "cylinder":
      return Math.max(Math.abs(s.a), Math.abs(s.b));
    case "helicoid-catenoid":
      return Math.abs(s.a);
    case "paraboloid":
      return (
        Math.max(
          s.uMax - s.uMin,
          s.vMax - s.vMin,
          heightRange(s.a, s.uMin, s.uMax) + heightRange(s.b, s.vMin, s.vMax),
        ) / 2
      );
    default:
      return Math.max(Math.abs(s.a), Math.abs(s.b), Math.abs(s.c));
  }
}

// Carrying an arrow starts it along the selected thread at a right angle to
// it, to its left, drawn about a third of the surface's scale or half the
// tube's radius, capped at the admitted length 100000, to two figures,
// with eight reference arrows. A tall paraboloid's scale can exceed that
// limit even though its shape parameters and domain are admitted.
export function transportDefaults(s: SurfaceConfig): TransportConfig {
  const r = (s.kind === "torus" ? 0.5 : 0.3) * arrowScale(s);
  return {
    path: "thread",
    angle: 90,
    size: Number(
      Math.min(100000, Number.isFinite(r) && r > 0 ? r : 0.3).toPrecision(2),
    ),
    arrows: 8,
  };
}

// A polygon starts as the octant triangle's corners, (r, 0, 0), (0, r, 0)
// and (0, 0, r), so choosing it keeps the path the triangle drew.
export const polygonDefaults = (): PolygonVertex[] => [
  { u: 0, v: 0 },
  { u: Math.PI / 2, v: 0 },
  { u: 0, v: Math.PI / 2 },
];

// The vertex an added one follows: the middle of the closing side, from
// the last vertex back to the first, so the path keeps its shape. Its
// coordinates are generated angles (see generatedAngle); a pole keeps the
// longitude it was entered with.
export function nextVertex(vs: PolygonVertex[]): PolygonVertex {
  // A link may leave a polygon short of three: fill in the octant's next
  // corner.
  if (vs.length < 3) return polygonDefaults()[vs.length];
  const point = ({ u, v }: PolygonVertex) => [
    Math.cos(v) * Math.cos(u),
    Math.cos(v) * Math.sin(u),
    Math.sin(v),
  ];
  const a = point(vs[vs.length - 1]),
    b = point(vs[0]);
  const m = a.map((x, k) => x + b[k]);
  const size = Math.hypot(...m);
  if (!(size > 1e-9)) return { ...vs[vs.length - 1] };
  const v = Math.asin(Math.max(-1, Math.min(1, m[2] / size)));
  const u =
    Math.hypot(m[0], m[1]) > 1e-12 * size
      ? Math.atan2(m[1], m[0])
      : vs[vs.length - 1].u;
  return { u: generatedAngle(u), v: generatedAngle(v) };
}

// A generated angle in radians: a simple fraction of π (denominators up to
// 12, as the fields show them) when it lies within its rounding budget of
// one, and otherwise the value with any rounding tail removed. Both are
// meaningful doubles, so candidates keep at most 15 digits.
function generatedAngle(x: number) {
  const budget = Number.EPSILON * Math.max(Math.abs(x), Math.PI);
  for (let q = 1; q <= 12; q++) {
    const exact = (Math.round((x * q) / Math.PI) * Math.PI) / q;
    if (Math.abs(exact - x) <= budget) return exact;
  }
  return roundedGenerated(x, Math.PI, 15);
}

// Carrying a tangent arrow (`surface.geodesics.transport`). Absent means
// off, as in links made before it.
export const transportHelp = tiered(
  "Carries a tangent arrow along a path without turning it within the surface: parallel transport.",
  "It stays a unit tangent vector and is never reset at a corner, so a closed path can bring it home turned. Along a thread on a patch it stops where the thread reaches the edge. Play moves it along its path and holds where it arrives.",
);
export const transportFieldHelp = {
  path: tiered(
    "The selected thread, or a sphere's octant triangle or polygon.",
    "The triangle runs from (r, 0, 0) to (0, r, 0), (0, 0, r) and back along quarter great circles. A polygon joins its 3–12 vertices by shorter great-circle arcs, closing back to the first. Off a sphere both are unavailable.",
  ),
  vertices: tiered(
    "Each corner's longitude u and latitude v.",
    "u within ±100000 and v within ±π/2. Neighbors, and the last and first, may neither coincide nor lie opposite, within 10⁻⁶ radians. The signed area is positive counterclockwise seen from outside, counting each region once for every turn around it.",
  ),
  angle: tiered(
    "Degrees from the path's direction toward its left, N × T.",
    "N points out of the sphere or the tube, whichever way the normal is set; within ±100000.",
  ),
  size: tiered(
    "How long it is drawn; the carried vector has length 1.",
    "Above 0 and at most 100000, in the surface's units.",
  ),
  arrows: tiered(
    `0–${maxTransportArrows} left along the way, the first at the start.`,
    "They stand at equal arc lengths along the path and appear as Play passes them.",
  ),
} satisfies Record<string, Help<string>>;

const pathLabels: Record<TransportPath, string> = {
  thread: "Selected thread",
  triangle: "Octant triangle",
  // Short enough for a phone's paired column; the layer names it in full.
  polygon: "Polygon",
};

// The arrow's own fields, shown while it is carried. Choosing the polygon
// fills in its default vertices when there are none; any vertices are
// kept whatever the path. editVertices adds or removes one once pending
// evaluations have landed, since it renumbers the fields after it.
export function TransportFields({
  t,
  vector,
  set,
  editVertices,
}: {
  t: TransportConfig;
  vector: Vector;
  set: (change: (t: TransportConfig) => TransportConfig) => void;
  editVertices: (change: (vs: PolygonVertex[]) => PolygonVertex[]) => void;
}) {
  const vertices = t.vertices ?? [];
  return (
    <>
      <div className="pair">
        <Field label="Arrow's path" help={transportFieldHelp.path}>
          <select
            value={t.path}
            onChange={(e) => {
              const path = e.target.value as TransportPath;
              set((t) => ({
                ...t,
                path,
                ...(path === "polygon" &&
                  !t.vertices?.length && { vertices: polygonDefaults() }),
              }));
            }}
          >
            {(Object.keys(pathLabels) as TransportPath[]).map((p) => (
              <option key={p} value={p}>
                {pathLabels[p]}
              </option>
            ))}
          </select>
        </Field>
        {vector(
          "Arrow angle α (°)",
          t.angle,
          (angle) => set((t) => ({ ...t, angle })),
          transportFieldHelp.angle,
        )}
      </div>
      <div className="pair">
        {vector(
          "Arrow length",
          t.size,
          (size) => set((t) => ({ ...t, size })),
          transportFieldHelp.size,
        )}
        <Whole
          label="Reference arrows"
          value={t.arrows}
          min={0}
          max={maxTransportArrows}
          help={transportFieldHelp.arrows}
          onChange={(arrows) => set((t) => ({ ...t, arrows }))}
        />
      </div>
      {t.path === "polygon" && (
        <>
          {vertices.map((vertex, i) => (
            <div
              className="term"
              role="group"
              aria-labelledby={`spatial-vertex-${i}`}
              key={i}
            >
              <div className="term-heading">
                <span id={`spatial-vertex-${i}`}>Vertex {i + 1}</span>
                <button
                  type="button"
                  aria-label={`Remove vertex ${i + 1}`}
                  disabled={vertices.length <= minPolygonVertices}
                  onClick={() =>
                    editVertices((vs) => vs.filter((_, j) => j !== i))
                  }
                >
                  Remove
                </button>
              </div>
              <div className="pair">
                {(["u", "v"] as const).map((c) =>
                  vector(
                    vertexLabel(i + 1, c),
                    vertex[c],
                    (value) =>
                      set((t) => ({
                        ...t,
                        vertices: (t.vertices ?? []).map((p, j) =>
                          j === i ? { ...p, [c]: value } : p,
                        ),
                      })),
                    i === 0 && c === "u"
                      ? transportFieldHelp.vertices
                      : undefined,
                  ),
                )}
              </div>
            </div>
          ))}
          <button
            className="closure"
            type="button"
            disabled={vertices.length >= maxPolygonVertices}
            onClick={() => editVertices((vs) => [...vs, nextVertex(vs)])}
          >
            {vertices.length >= maxPolygonVertices
              ? `At most ${maxPolygonVertices} vertices`
              : "Add a vertex"}
          </button>
        </>
      )}
    </>
  );
}

// A number with its sign, + or −, none for 0, and an angle in degrees
// likewise.
const signedNumber = (x: number) =>
  `${x > 0 ? "+" : x < 0 ? "−" : ""}${formatNumber(Math.abs(x))}`;
const signed = (radians: number) =>
  `${signedNumber((radians * 180) / Math.PI)}°`;

// Where the arrow went and how it came back, how well it kept its length
// and tangency, and the colors.
export function transportNote(
  g: GeodesicResult,
  config: TransportConfig,
  scheme: ColorScheme,
): string[] {
  const tr = g.transport;
  if (!tr || tr.unavailable) return [];
  const out: string[] = [];
  if (tr.path === "triangle")
    out.push(
      `Around the octant triangle the arrow comes home turned ${signed(tr.holonomy)} about the outward normal: the area enclosed, πr²/2, times the curvature 1/r².`,
    );
  else if (tr.path === "polygon") {
    // The radius, from where the path starts; the area over r² is the
    // turn, less a whole turn when it exceeds a half turn either way.
    const p = tr.samples.points[0];
    const turns = Math.round(
      (tr.area / (p.x ** 2 + p.y ** 2 + p.z ** 2) - tr.holonomy) /
        (2 * Math.PI),
    );
    const whole =
      turns > 0
        ? ", less a whole turn"
        : turns < 0
          ? ", plus a whole turn"
          : "";
    out.push(
      `Around the polygon the arrow comes home turned ${signed(tr.holonomy)} about the outward normal: the signed area it encloses, ${signedNumber(tr.area)}, times the curvature 1/r²${whole}.`,
    );
  } else if (tr.returns)
    out.push(
      `Thread ${g.selected} ends within 10⁻⁶ of its start, heading the same way, with the arrow turned ${signed(tr.holonomy)} there; along a geodesic it keeps its angle to the thread.`,
    );
  else
    out.push(
      `Along thread ${g.selected} the arrow keeps its ${formatNumber(config.angle)}° angle to the thread, as along any geodesic.`,
    );
  if (tr.reason === "edge")
    out.push(
      "It stops with its thread where the path reaches the patch's edge.",
    );
  else if (tr.reason === "exhausted")
    out.push(
      `It ran out of its share of the 200,000 steps at ${formatNumber(tr.reached)}.`,
    );
  else if (tr.reason === "unresolved")
    out.push(`It could not be integrated past ${formatNumber(tr.reached)}.`);
  const drift = Math.max(tr.drift.norm, tr.drift.tangency);
  out.push(
    drift < 1e-12
      ? "Its length stays 1 and it stays tangent to rounding."
      : `Its length stays 1 and it stays tangent within ${formatNumber(drift)}.`,
  );
  out.push(
    describeColors(
      "The arrow is drawn in rust, its reference arrows in slate.",
      scheme,
    ),
  );
  return out;
}
