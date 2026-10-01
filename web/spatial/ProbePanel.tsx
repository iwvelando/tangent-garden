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
  probeTarget,
  straightNote,
  surfaceInk,
  surfaceProbeAt,
  surfaceProbeHelp,
  surfaceProbeReadout,
  surfaceTerms,
  type Probe,
  type ProbeTarget,
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
  const support = probeSupport(config);
  if (!support.available) return null;
  const target = probeTarget(config, probe);
  const both = support.targets.length > 1;
  const d = frame?.result.diagnostics;
  const n = d ? d.curvature.length - 1 : 0;
  const at = moving ?? probeIndex(probe.position, n);
  const readout = frame && d ? probeReadout(frame.result, at) : null;
  const swatch = (ink: number) => ({
    background: hex(lineColor(ink, 0, dark)),
  });
  return (
    <fieldset className="spatial-probe">
      <legend>
        {both
          ? "Probe the curve or surface"
          : target === "surface"
            ? "Probe the surface"
            : "Probe the curve"}
      </legend>
      {/* Content that comes and goes stays inside this wrapper: Chromium
          ends a slider's drag when a child is inserted directly into its
          fieldset. */}
      <div>
        {both && (
          <Field
            label="Describe"
            help={`The curve: its Frenet frame, curvature and torsion. The surface: the ${surfaceTerms(config).surface}'s principal directions, curvatures and centres. Both stand at the same place along t.`}
          >
            <select
              value={target}
              disabled={moving !== undefined}
              onChange={(e) => {
                const target = e.target.value as ProbeTarget;
                onProbe((p) => ({ ...p, target }));
              }}
            >
              <option value="curve">The curve</option>
              <option value="surface">The surface</option>
            </select>
          </Field>
        )}
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
            {target === "surface"
              ? "Principal curvatures & centres at a point"
              : "Frame, curvature & torsion at a point"}
          </label>
          <HelpToggle topic="the probe" help={help} />
        </div>
        <HelpText help={help}>
          {target === "surface" ? surfaceProbeHelp(config) : probeHelp(config)}
        </HelpText>
        {probe.enabled && target === "surface" && (
          <SurfaceProbe
            config={config}
            frame={frame}
            probe={probe}
            onProbe={onProbe}
            animating={animating}
            at={moving}
            dark={dark}
          />
        )}
        {probe.enabled &&
          target === "curve" &&
          (animating ? (
            <p className="spatial-caption">
              The probe returns when the animation stops.
            </p>
          ) : !readout || !d ? (
            <p className="spatial-caption">
              Finding the curvature and torsion…
            </p>
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
                  <span
                    className="probe-dot"
                    style={swatch(probeInk.tangent)}
                  />
                  T
                </li>
                <li>
                  <span className="probe-dot" style={swatch(probeInk.normal)} />
                  N
                </li>
                <li>
                  <span
                    className="probe-dot"
                    style={swatch(probeInk.binormal)}
                  />
                  B
                </li>
                <li>
                  <span className="probe-dot" style={swatch(probeInk.mark)} />
                  Point, circle
                  {probeSupport(frame!.config).highlight
                    ? " & construction"
                    : ""}
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
      </div>
    </fieldset>
  );
}

// The surface probe's controls and readout, as ProbePanel's for the curve.
// The grid sample is the nearest row and column to the probe's fractions;
// an animation moving the probe gives its row as `at`.
function SurfaceProbe({
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
  const d = frame?.result.surfaceDiagnostics;
  if (animating)
    return (
      <p className="spatial-caption">
        The probe returns when the animation stops.
      </p>
    );
  if (!frame || !d)
    return (
      <p className="spatial-caption">
        Finding the principal curvatures and centres…
      </p>
    );
  const terms = surfaceTerms(frame.config);
  const rows = d.u.length - 1,
    columns = d.v.length;
  const place = surfaceProbeAt(d, probe.position, probe.across);
  const row = moving ?? place.row,
    column = place.column;
  const r = surfaceProbeReadout(frame.result, row, column)!;
  const swatch = (ink: number) => ({
    background: hex(lineColor(ink, 0, dark)),
  });
  // No surface or no normal here: every value is blank.
  const blank = r.missing || r.singular;
  const value = (k: number | null) =>
    blank ? "—" : k === null ? "unknown here" : short(k);

  return (
    <>
      <div className="pair">
        <Field
          label={terms.sliders[0]}
          value={`${terms.along} = ${short(r.u)}`}
          className="probe-slider"
        >
          <input
            type="range"
            min={0}
            max={rows}
            step={1}
            value={row}
            disabled={moving !== undefined}
            aria-valuetext={`${terms.along} = ${short(r.u)}, row ${row} of ${rows}`}
            onChange={(e) => {
              const position = e.target.valueAsNumber / rows;
              onProbe((p) => ({ ...p, position }));
            }}
          />
        </Field>
        <Field
          label={terms.sliders[1]}
          value={`${terms.around} = ${short(r.v)}`}
          className="probe-slider"
        >
          <input
            type="range"
            min={0}
            max={columns - 1}
            step={1}
            value={column}
            disabled={moving !== undefined}
            aria-valuetext={`${terms.around} = ${short(r.v)}, column ${column} of ${columns - 1}`}
            onChange={(e) => {
              const across =
                e.target.valueAsNumber / (d.periodic ? columns : columns - 1);
              onProbe((p) => ({ ...p, across }));
            }}
          />
        </Field>
      </div>
      {/* Always four rows and a two-line status, so that the controls
          below never move as the probe crosses a gap or a singular point,
          as it does during probe playback. */}
      <dl className="probe-readout">
        <dt>{terms.branches[0]}</dt>
        <dd>{value(r.curvature[0])}</dd>
        <dt>{terms.branches[1]}</dt>
        <dd>{value(r.curvature[1])}</dd>
        <dt>Radii 1/κ</dt>
        <dd>
          {blank
            ? "—"
            : r.radius
                .map((x, b) =>
                  r.curvature[b] === null
                    ? "unknown"
                    : x === null || r.infinite[b]
                      ? "∞"
                      : short(x),
                )
                .join(", ")}
        </dd>
        <dt>Gaussian K, mean H</dt>
        <dd>
          {blank
            ? "—"
            : r.gauss === null || r.mean === null
              ? "unknown here"
              : `${short(r.gauss)}, ${short(r.mean)}`}
        </dd>
      </dl>
      <p className="spatial-caption probe-status" data-testid="probe-status">
        {r.missing
          ? terms.missing
          : r.singular
            ? "Singular here: no normal or principal curvatures."
            : r.umbilic
              ? "An umbilic: every direction is principal, so none is drawn."
              : r.infinite.some(Boolean)
                ? "A centre lies beyond 100 study radii, at infinity: its circle is not drawn."
                : ""}
      </p>
      {[0, 1].map((b) => (
        <Plot
          key={b}
          values={d.curvature[b].map((line) => line[column])}
          fromZero={false}
          at={row}
          label={`${terms.branches[b]} along ${terms.along}`}
          dark={dark}
        />
      ))}
      <ul className="probe-legend">
        <li>
          <span className="probe-dot" style={swatch(probeInk.normal)} />
          Normal
        </li>
        {[0, 1].map((b) => (
          <li key={b}>
            <span className="probe-dot" style={swatch(surfaceInk[b])} />
            {terms.branches[b]}: direction, circle & centre
          </li>
        ))}
        <li>
          <span className="probe-dot" style={swatch(probeInk.mark)} />
          Point
          {d.kind === "canal" ? " & contact circle" : ""}
        </li>
      </ul>
      {(d.singular > 0 ||
        d.umbilics > 0 ||
        d.unknown > 0 ||
        d.clipped[0] > 0 ||
        d.clipped[1] > 0) && (
        <p className="spatial-caption probe-notes">
          {[
            d.singular > 0 &&
              `${count(d.singular, "point is", "points are")} singular, without a normal`,
            d.umbilics > 0 &&
              `${count(d.umbilics, "point is an umbilic", "points are umbilics")}`,
            d.unknown > 0 &&
              `${terms.branches[1]} is unknown at ${count(d.unknown, "point", "points")}, where its derivatives are unstable`,
            ...[0, 1].map(
              (b) =>
                d.clipped[b] > 0 &&
                `${count(d.clipped[b], "centre", "centres")} of ${terms.branches[b]} ${d.clipped[b] === 1 ? "lies" : "lie"} beyond 100 study radii, at infinity`,
            ),
          ]
            .filter(Boolean)
            .join("; ")}
          .
        </p>
      )}
    </>
  );
}
