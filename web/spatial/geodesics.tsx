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
export { revealGeodesics, threadPath } from "./geodesic-path";

// The surfaces whose geodesic threads can be launched: the controls appear
// with these, and a sphere or a ring torus traces them (engine3's
// geodesicSurface says when a shape of either kind cannot).
export const geodesicKinds: SurfaceKind[] = ["ellipsoid", "torus"];

// Turning the threads on starts a small fan from the chart's origin, as
// long as a few turns around the surface: for a sphere of radius r, one
// great circle, 2πr, and for a torus four turns of its outer equator,
// 8π(R + r). The length is generated, so it is kept to three significant
// figures rather than show its arithmetic.
export function geodesicDefaults(s: SurfaceConfig): GeodesicConfig {
  const turn =
    s.kind === "torus"
      ? 4 * 2 * Math.PI * (Math.abs(s.a) + Math.abs(s.b))
      : 2 * Math.PI * Math.max(Math.abs(s.a), Math.abs(s.b), Math.abs(s.c));
  const length = Number(
    (Number.isFinite(turn) && turn > 0 ? turn : 1).toPrecision(3),
  );
  return {
    u: 0,
    v: 0,
    direction: 45,
    spread: 60,
    count: 12,
    length,
    samples: 1200,
    selected: 1,
  };
}

// Launching the threads (`surface.geodesics`). Absent means off, as in links
// made before it.
export const geodesicsHelp = tiered(
  "Traces threads that go straight on the surface, from one point in a fan of directions.",
  "They run on the whole surface, not only the drawn patch, on a sphere (equal axes) or a ring torus whose R exceeds r by at least 0.1% of r. Elsewhere they are unavailable.",
);
export const geodesicHelp = {
  start: tiered(
    "Where the threads start, in the chart's u and v.",
    "Each within ±100000. On a sphere v₀ is a latitude, within ±π/2; at a pole, u₀ names the meridian whose direction is v.",
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
    "On a torus the fan, with any arrow carried along a thread, shares 200,000 integration steps; a thread that runs out stops there, marked by a cross.",
  ),
  samples: tiered(
    `8–${maxGeodesicSamples} per thread, 200,000 points in all.`,
    "Samples are evenly spaced in arc length. The integration takes its own steps between them. A carried arrow's path counts as one more thread, plus two points.",
  ),
} satisfies Record<string, Help<string>>;

const count = (n: number, one: string, many: string) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;
const format = (x: number) =>
  Math.abs(x) >= 1e-3 || x === 0
    ? x.toPrecision(4).replace(/\.?0+$/, "")
    : x.toExponential(1);

// What the fan is, which threads stopped short and why, and the colors.
export function geodesicsNote(
  g: GeodesicResult,
  config: GeodesicConfig,
  scheme: ColorScheme,
): string[] {
  if (g.unavailable) return [g.unavailable];
  const threads = count(g.threads.length, "thread", "threads"),
    each = g.threads.length === 1 ? "" : "each ";
  const out = [
    g.surface === "sphere"
      ? `${threads} on the sphere, ${each}a great circle traced exactly, ${format(config.length)} long.`
      : `${threads} on the torus, ${each}${format(config.length)} long, integrated in ${g.steps.toLocaleString()} steps.`,
  ];
  const exhausted = g.threads.filter((t) => t.reason === "exhausted").length;
  const unresolved = g.threads.filter((t) => t.reason === "unresolved").length;
  if (exhausted)
    out.push(
      `${count(exhausted, "thread", "threads")} ran out of the fan's 200,000 steps before ${exhausted === 1 ? "its" : "their"} length, marked by a cross.`,
    );
  if (unresolved)
    out.push(
      `${count(unresolved, "thread", "threads")} could not be integrated further, marked by a cross.`,
    );
  out.push(
    describeColors(
      "Threads shade from teal to gold in fan order; the selected thread is drawn broad.",
      scheme,
    ),
  );
  return out;
}

// The angle between two unit vectors a chord d apart, in degrees.
const turned = (d: number) =>
  (2 * Math.asin(Math.min(1, d / 2)) * 180) / Math.PI;

// The selected thread, described: where it leaves, how far it ran, its
// invariant, and how near it returns to its start.
export function selectedNote(g: GeodesicResult): string {
  const th = g.threads[g.selected - 1];
  if (!th) return "";
  const k = g.selected;
  const ran =
    th.reason === "end"
      ? "runs its whole length"
      : th.reason === "exhausted"
        ? `ran out of steps at ${format(th.reached)}`
        : `could not be integrated past ${format(th.reached)}`;
  const invariant =
    g.surface === "torus"
      ? `; Clairaut's ρ cos ψ is ${format(th.points[0].x * th.tangents[0].y - th.points[0].y * th.tangents[0].x)}`
      : "";
  const back =
    th.reason !== "end"
      ? ""
      : th.closes
        ? ", and returns to its start within 10⁻⁶ in position and direction"
        : `, and ends ${format(th.return.position)} r from its start, heading ${format(turned(th.return.direction))}° from its first direction`;
  return `Thread ${k} leaves at ${format(th.direction)}° and ${ran}${invariant}${back}.`;
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
  return `${d > 0 ? "+" : d < 0 ? "−" : ""}${format(Math.abs(d))}°`;
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
      `Along thread ${g.selected} the arrow keeps its ${format(config.angle)}° angle to the thread, as along any geodesic.`,
    );
  if (tr.reason === "exhausted")
    out.push(
      `It ran out of its share of the 200,000 steps at ${format(tr.reached)}.`,
    );
  else if (tr.reason === "unresolved")
    out.push(`It could not be integrated past ${format(tr.reached)}.`);
  const drift = Math.max(tr.drift.norm, tr.drift.tangency);
  out.push(
    drift < 1e-12
      ? "Its length stays 1 and it stays tangent to rounding."
      : `Its length stays 1 and it stays tangent within ${format(drift)}.`,
  );
  out.push(
    describeColors(
      "The arrow is drawn in rust, its reference arrows in slate.",
      scheme,
    ),
  );
  return out;
}
