import type { ReactNode } from "react";
import { describeColors, type ColorScheme } from "../color-schemes";
import { Field } from "../Field";
import { tiered, type Help } from "../help";
import {
  maxGeodesicSamples,
  maxGeodesicThreads,
  type GeodesicConfig,
  type GeodesicResult,
  type SurfaceConfig,
  type SurfaceKind,
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
    "On a torus the fan shares 200,000 integration steps; a thread that runs out stops there, marked by a cross.",
  ),
  samples: tiered(
    `8–${maxGeodesicSamples} per thread, 200,000 points in all.`,
    "Samples are evenly spaced in arc length. The integration takes its own steps between them.",
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
