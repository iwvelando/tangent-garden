import { Field, HelpText, HelpToggle, useHelp } from "../Field";
import { hex, lineColor } from "./palette";
import {
  plotScale,
  probeHelp,
  probeIndex,
  probeInk,
  probeReadout,
  probeStraight,
  probeSupport,
  straightNote,
  type Probe,
} from "./probe";
import type { Frame, SpatialConfig } from "./types";

// Four significant figures: τ from expressions or an integrated path is
// differenced numerically to about 10⁻⁵ relative accuracy.
const short = (v: number) => String(Number(v.toPrecision(4)));
const count = (n: number, one: string, many: string) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;
const width = 240,
  height = 44;

// One diagnostic along the whole base, broken where it is undefined, with
// the probe's sample marked. Geometry only: its range is stated beside it.
function Plot({
  values,
  fromZero,
  at,
  label,
  dark,
}: {
  values: (number | null)[];
  fromZero: boolean;
  at: number;
  label: string;
  dark: boolean;
}) {
  const { lo, hi, runs, pinned } = plotScale(values, fromZero);
  if (!runs.length)
    return (
      <p className="spatial-caption">{label} is undefined at every sample.</p>
    );
  const n = Math.max(1, values.length - 1);
  const x = (i: number) => (i / n) * width;
  const y = (v: number) => 2 + (1 - (v - lo) / (hi - lo)) * (height - 4);
  return (
    <figure className="probe-plot">
      <figcaption>
        {label} from {short(lo)} to {short(hi)}
        {pinned > 0 &&
          `; ${count(pinned, "sample", "samples")} beyond, pinned to the edge`}
      </figcaption>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {lo < 0 && hi > 0 && (
          <line className="probe-zero" x1={0} x2={width} y1={y(0)} y2={y(0)} />
        )}
        {runs.map((run, k) => (
          <polyline
            key={k}
            className="probe-series"
            points={run.map(([i, v]) => `${x(i)},${y(v)}`).join(" ")}
          />
        ))}
        <line
          x1={x(at)}
          x2={x(at)}
          y1={0}
          y2={height}
          stroke={hex(lineColor(probeInk.mark, 0, dark))}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </figure>
  );
}

// The parameter probe's controls and readout. `frame` is the study's own
// result with diagnostics, or null while they are computed or while an
// animation that does not move the probe plays. `at` is the sample an
// animation has moved the probe to; the slider waits until it stops.
export function ProbePanel({
  config,
  frame,
  probe,
  onProbe,
  animating,
  at: moving,
  dark,
}: {
  config: SpatialConfig;
  frame: Frame | null;
  probe: Probe;
  onProbe: (change: (p: Probe) => Probe) => void;
  animating: boolean;
  at?: number;
  dark: boolean;
}) {
  const help = useHelp();
  if (!probeSupport(config).available) return null;
  const d = frame?.result.diagnostics;
  const n = d ? d.curvature.length - 1 : 0;
  const at = moving ?? probeIndex(probe.position, n);
  const readout = frame && d ? probeReadout(frame.result, at) : null;
  const swatch = (ink: number) => ({
    background: hex(lineColor(ink, 0, dark)),
  });
  return (
    <fieldset className="spatial-probe">
      <legend>Probe the curve</legend>
      <div className="probe-switch">
        <label>
          <input
            type="checkbox"
            checked={probe.enabled}
            onChange={(e) => {
              const enabled = e.target.checked;
              onProbe((p) => ({ ...p, enabled }));
            }}
          />
          Frame, curvature &amp; torsion at a point
        </label>
        <HelpToggle topic="the probe" help={help} />
      </div>
      <HelpText help={help}>{probeHelp(config)}</HelpText>
      {probe.enabled &&
        (animating ? (
          <p className="spatial-caption">
            The probe returns when the animation stops.
          </p>
        ) : !readout || !d ? (
          <p className="spatial-caption">Finding the curvature and torsion…</p>
        ) : (
          <>
            {probeStraight(d) && (
              <p className="spatial-caption" data-testid="probe-straight">
                {straightNote(frame!.config)}
              </p>
            )}
            <Field
              label="Point"
              value={`t = ${short(readout.t)}`}
              className="probe-slider"
            >
              <input
                type="range"
                min={0}
                max={n}
                step={1}
                value={at}
                disabled={moving !== undefined}
                aria-valuetext={`t = ${short(readout.t)}, sample ${at} of ${n}`}
                onChange={(e) => {
                  const position = e.target.valueAsNumber / n;
                  onProbe((p) => ({ ...p, position }));
                }}
              />
            </Field>
            <dl className="probe-readout">
              <dt>Curvature κ</dt>
              <dd>
                {readout.curvature === null
                  ? "unknown here"
                  : readout.flat
                    ? "0 (flat: N, B and τ undefined)"
                    : short(readout.curvature)}
              </dd>
              <dt>Radius 1/κ</dt>
              <dd>
                {readout.radius === null
                  ? "undefined"
                  : readout.infinite
                    ? `${short(readout.radius)} (circle not drawn)`
                    : short(readout.radius)}
              </dd>
              <dt>Torsion τ</dt>
              <dd>
                {readout.torsion !== null
                  ? short(readout.torsion)
                  : readout.flat || readout.curvature === null
                    ? "undefined"
                    : "unknown here"}
              </dd>
            </dl>
            {!probeStraight(d) && (
              <>
                <Plot
                  values={d.curvature}
                  fromZero
                  at={at}
                  label="κ"
                  dark={dark}
                />
                <Plot
                  values={d.torsion}
                  fromZero={false}
                  at={at}
                  label="τ"
                  dark={dark}
                />
              </>
            )}
            <ul className="probe-legend">
              <li>
                <span className="probe-dot" style={swatch(probeInk.tangent)} />T
              </li>
              <li>
                <span className="probe-dot" style={swatch(probeInk.normal)} />N
              </li>
              <li>
                <span className="probe-dot" style={swatch(probeInk.binormal)} />
                B
              </li>
              <li>
                <span className="probe-dot" style={swatch(probeInk.mark)} />
                Point, circle
                {probeSupport(frame!.config).highlight ? " & construction" : ""}
              </li>
            </ul>
            {((d.flat > 0 && !probeStraight(d)) ||
              d.unknown > 0 ||
              d.clipped > 0) && (
              <p className="spatial-caption probe-notes">
                {[
                  d.flat > 0 &&
                    !probeStraight(d) &&
                    `κ vanishes at ${count(d.flat, "sample", "samples")}, where N, B and τ are undefined`,
                  d.unknown > 0 &&
                    `τ is unknown at ${count(d.unknown, "sample", "samples")}, where r‴ is unstable`,
                  d.clipped > 0 &&
                    `${count(d.clipped, "centre lies", "centres lie")} beyond 100 study radii, at infinity`,
                ]
                  .filter(Boolean)
                  .join("; ")}
                .
              </p>
            )}
          </>
        ))}
    </fieldset>
  );
}
