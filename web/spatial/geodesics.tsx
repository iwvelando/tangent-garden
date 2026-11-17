import { readout as formatNumber } from "../number-format";
import type { ReactNode } from "react";
import { describeColors, type ColorScheme } from "../color-schemes";
import { Field } from "../Field";
import { tiered, type Help } from "../help";
import {
  maxGeodesicSamples,
  maxGeodesicThreads,
  maxTransportArrows,
  type GeodesicConfig,
  type GeodesicResult,
  type SurfaceConfig,
  type SurfaceKind,
  type TransportConfig,
  type TransportPath,
} from "./types";
import { count, plural } from "../number-format";
import { roundedGenerated } from "../atlas";
import { surfaceCapabilities } from "./surface";
export { revealGeodesics, threadPath } from "./geodesic-path";

// Whether a kind's geodesic threads can be launched: the controls appear
// with these (engine3's geodesicSurface says when a sphere's or torus's
// shape cannot carry them).
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

// Turning the threads on starts a small fan. On a whole surface it leaves
// the chart's origin, as long as a few turns around it: for a sphere of
// radius r, one great circle, 2πr, and for a torus four turns of its outer
// equator, 8π(R + r). On a patch it leaves the middle of the domain, twice
// as long as the patch's diagonal in its own metric, so most threads reach
// an edge: hypot(a·Δu, Δv) with a the larger semi-axis on a cylinder, and
// s·hypot(cosh v̄·Δu, sinh v₁ − sinh v₀) on the helicoid–catenoid family.
// The length is generated, so it is kept to three significant figures
// rather than show its arithmetic.
export function geodesicDefaults(s: SurfaceConfig): GeodesicConfig {
  const du = s.uMax - s.uMin,
    vMid = middle(s.vMin, s.vMax);
  const turn =
    s.kind === "torus"
      ? 4 * 2 * Math.PI * (Math.abs(s.a) + Math.abs(s.b))
      : s.kind === "cylinder"
        ? 2 * Math.hypot(Math.max(s.a, s.b) * du, s.vMax - s.vMin)
        : s.kind === "helicoid-catenoid"
          ? 2 *
            s.a *
            Math.hypot(
              Math.cosh(vMid) * du,
              Math.sinh(s.vMax) - Math.sinh(s.vMin),
            )
          : 2 * Math.PI * Math.max(Math.abs(s.a), Math.abs(s.b), Math.abs(s.c));
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
    length,
    samples: 1200,
    selected: 1,
  };
}

// A study whose surface keeps its threads in the patch, with the start
// moved to the patch's middle when it lies outside, so that choosing such a
// surface leaves a study that draws.
export function startWithin(s: SurfaceConfig): SurfaceConfig {
  const g = s.geodesics;
  if (!g || !withinPatch(s.kind)) return s;
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
  "On a sphere (equal axes) or a ring torus whose R exceeds r by at least 0.1% of r they run over the whole surface. On a cylinder or the helicoid–catenoid family they stop at the patch's edge; a cylinder spanning a whole turn of u lets them cross its seam. Elsewhere they are unavailable.",
);
export const geodesicHelp = {
  start: tiered(
    "Where the threads start, in the chart's u and v.",
    "Each within ±100000. On a sphere v₀ is a latitude, within ±π/2; at a pole, u₀ names the meridian whose direction is v. On a cylinder or the helicoid–catenoid family the start lies within the patch's domain.",
  ),
  direction: tiered(
    "The fan's middle direction, in degrees from u toward v.",
    "Measured from unit X_u toward unit X_v, whichever side the normal is on; within ±100000.",
  ),
  spread: tiered(
    "0–360°, shared evenly; 360° rings the point.",
    "Each thread leaves at the middle of its share, so a single thread leaves at β.",
  ),
  count: `1–${maxGeodesicThreads} threads in the fan.`,
  selected: "The thread drawn broad and described, counted from 1.",
  length: tiered(
    "Each thread's arc length, above 0 and at most 100000.",
    "Except on a sphere, the fan, with any arrow carried along a thread, shares 200,000 integration steps; a thread that runs out stops there, marked by a cross. On a cylinder or the helicoid–catenoid family a thread also stops where it reaches the patch's edge.",
  ),
  samples: tiered(
    `8–${maxGeodesicSamples} per thread, 200,000 points in all.`,
    "Samples are evenly spaced in arc length. The integration takes its own steps between them. A carried arrow's path counts as one more thread, plus two points.",
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
          : `${threads} on the torus, ${long}.`,
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
  torus: "r",
  cylinder: "of the larger semi-axis",
  "helicoid-catenoid": "s",
  "": "",
};

// The angle between two unit vectors a chord d apart, in degrees.
const turned = (d: number) =>
  (2 * Math.asin(Math.min(1, d / 2)) * 180) / Math.PI;

// The selected thread, described: where it leaves, how far it ran, its
// invariant, and how near it returns to its start.
export function selectedNote(g: GeodesicResult): string {
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
  const invariant =
    g.surface === "torus"
      ? `; Clairaut's ρ cos ψ is ${formatNumber(th.points[0].x * th.tangents[0].y - th.points[0].y * th.tangents[0].x)}`
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

// Carrying an arrow starts it along the selected thread at a right angle to
// it, to its left, drawn about a third of the sphere's radius or half the
// tube's, to two figures, with eight reference arrows.
export function transportDefaults(s: SurfaceConfig): TransportConfig {
  const r =
    s.kind === "torus"
      ? 0.5 * Math.abs(s.b)
      : 0.3 * Math.max(Math.abs(s.a), Math.abs(s.b), Math.abs(s.c));
  return {
    path: "thread",
    angle: 90,
    size: Number((Number.isFinite(r) && r > 0 ? r : 0.3).toPrecision(2)),
    arrows: 8,
  };
}

// Carrying a tangent arrow (`surface.geodesics.transport`). Absent means
// off, as in links made before it.
export const transportHelp = tiered(
  "Carries a tangent arrow along a path without turning it within the surface: parallel transport.",
  "It stays a unit tangent vector and is never reset at a corner, so a closed path can bring it home turned. Play moves it along its path and holds where it arrives.",
);
export const transportFieldHelp = {
  path: tiered(
    "The selected thread, or on a sphere the octant triangle.",
    "The triangle runs from (r, 0, 0) to (0, r, 0), (0, 0, r) and back along quarter great circles. A torus has no triangle.",
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
};

// The arrow's own fields, shown while it is carried.
export function TransportFields({
  t,
  vector,
  set,
}: {
  t: TransportConfig;
  vector: Vector;
  set: (change: (t: TransportConfig) => TransportConfig) => void;
}) {
  return (
    <>
      <div className="pair">
        <Field label="Arrow's path" help={transportFieldHelp.path}>
          <select
            value={t.path}
            onChange={(e) => {
              const path = e.target.value as TransportPath;
              set((t) => ({ ...t, path }));
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
    </>
  );
}

const signed = (radians: number) => {
  const d = (radians * 180) / Math.PI;
  return `${d > 0 ? "+" : d < 0 ? "−" : ""}${formatNumber(Math.abs(d))}°`;
};

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
  else if (tr.returns)
    out.push(
      `Thread ${g.selected} returns to its start, and the arrow comes home turned ${signed(tr.holonomy)}, keeping its angle to the thread as along any geodesic.`,
    );
  else
    out.push(
      `Along thread ${g.selected} the arrow keeps its ${formatNumber(config.angle)}° angle to the thread, as along any geodesic.`,
    );
  if (tr.reason === "exhausted")
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
