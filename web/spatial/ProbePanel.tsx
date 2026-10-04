import { Field, HelpText, HelpToggle, useHelp } from "../Field";
import { ProbePlot } from "../ProbePlot";
import { hex, lineColor } from "./palette";
import {
  describeHelp,
  gridded,
  lightProbeReadout,
  probeLegend,
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
  targetName,
  type Probe,
  type ProbeTarget,
} from "./probe";
import type { Frame, SpatialConfig, SurfaceDiagnostics } from "./types";

// Four significant figures: τ from expressions or an integrated path is
// differenced numerically to about 10⁻⁵ relative accuracy.
const short = (v: number) => String(Number(v.toPrecision(4)));
const count = (n: number, one: string, many: string) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

// One diagnostic along the whole base, in the probe's ink (../ProbePlot.tsx).
function Plot({
  dark,
  ...plot
}: {
  values: (number | null)[];
  fromZero: boolean;
  at: number;
  label: string;
  dark: boolean;
  resolution?: number;
}) {
  return (
    <ProbePlot
      {...plot}
      ink={hex(lineColor(probeInk.mark, 0, dark))}
      captionClass="spatial-caption"
    />
  );
}

// The parameter probe's controls and readout. `frame` is the study's own
// result with diagnostics, or null while they are computed or while an
// animation that does not move the probe plays. `at` is the sample an
// animation has moved the probe to; the slider waits until it stops.
// `away` says why a parameter animation that draws the probe has none on
// the frame it shows.
export function ProbePanel({
  config,
  frame,
  probe,
  onProbe,
  animating,
  at: moving,
  away,
  dark,
}: {
  config: SpatialConfig;
  frame: Frame | null;
  probe: Probe;
  onProbe: (change: (p: Probe) => Probe) => void;
  animating: boolean;
  at?: number;
  away?: string;
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
      <legend>{probeLegend(config, target)}</legend>
      {/* Content that comes and goes stays inside this wrapper: Chromium
          ends a slider's drag when a child is inserted directly into its
          fieldset. */}
      <div>
        {both && (
          <Field label="Describe" help={describeHelp(config)}>
            <select
              value={target}
              disabled={moving !== undefined || away !== undefined}
              onChange={(e) => {
                const target = e.target.value as ProbeTarget;
                onProbe((p) => ({ ...p, target }));
              }}
            >
              {support.targets.map((t) => (
                <option key={t} value={t}>
                  {targetName(config, t)}
                </option>
              ))}
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
            {gridded(target)
              ? surfaceTerms(config, target).switch
              : "Frame, curvature & torsion at a point"}
          </label>
          <HelpToggle topic="the probe" help={help} />
        </div>
        <HelpText help={help}>
          {gridded(target)
            ? surfaceProbeHelp(config, target)
            : probeHelp(config)}
        </HelpText>
        {probe.enabled && gridded(target) && (
          <SurfaceProbe
            config={config}
            frame={frame}
            probe={probe}
            onProbe={onProbe}
            animating={animating}
            at={moving}
            away={away}
            dark={dark}
          />
        )}
        {probe.enabled &&
          target === "curve" &&
          (animating ? (
            <p className="spatial-caption">
              {away ?? "The probe returns when the animation stops."}
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
  away,
  dark,
}: {
  config: SpatialConfig;
  frame: Frame | null;
  probe: Probe;
  onProbe: (change: (p: Probe) => Probe) => void;
  animating: boolean;
  at?: number;
  away?: string;
  dark: boolean;
}) {
  const d = frame?.result.surfaceDiagnostics;
  if (animating)
    return (
      <p className="spatial-caption">
        {away ?? "The probe returns when the animation stops."}
      </p>
    );
  const target = probeTarget(config, probe);
  if (!frame || !d)
    return (
      <p className="spatial-caption">
        {target === "light"
          ? "Finding the light's wavefront and foci…"
          : "Finding the principal curvatures and centres…"}
      </p>
    );
  const terms = surfaceTerms(frame.config, probeTarget(frame.config, probe));
  const rows = d.u.length - 1,
    columns = d.v.length;
  const place = surfaceProbeAt(d, probe.position, probe.across);
  const row = moving ?? place.row,
    column = place.column;
  const r = surfaceProbeReadout(frame.result, row, column)!;
  const swatch = (ink: number) => ({
    background: hex(lineColor(ink, 0, dark)),
  });
  // Both plots ignore variation below 10⁻⁴ of the column's largest
  // curvature: rounding noise, as in a developable's zero curvature along
  // its rulings, not geometry.
  const resolution =
    1e-4 *
    Math.max(
      0,
      ...[0, 1].flatMap((b) =>
        d.curvature[b].map((line) => Math.abs(line[column] ?? 0)),
      ),
    );
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
      {d.light ? (
        <LightReadout
          frame={frame}
          d={d}
          row={row}
          column={column}
          dark={dark}
        />
      ) : (
        <>
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
          <p
            className="spatial-caption probe-status"
            data-testid="probe-status"
          >
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
              resolution={resolution}
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
              {terms.through ? ` & ${terms.through}` : ""}
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
                  `${terms.unknownBranch} unknown at ${count(d.unknown, "point", "points")}, ${terms.unknown}`,
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
      )}
    </>
  );
}

// The light probe's readout at grid sample (row, column): the outgoing
// wavefront's curvatures, the signed distances along the ray to its foci,
// the astigmatic interval between them and the angles at the surface,
// then a status, the curvatures along the row, the legend and the
// study's counts.
function LightReadout({
  frame,
  d,
  row,
  column,
  dark,
}: {
  frame: Frame;
  d: SurfaceDiagnostics;
  row: number;
  column: number;
  dark: boolean;
}) {
  const r = lightProbeReadout(frame.result, row, column)!,
    light = d.light!,
    terms = surfaceTerms(frame.config, "light"),
    m = terms.surface,
    refract = frame.config.rays.interaction === "refract";
  const swatch = (ink: number) => ({
    background: hex(lineColor(ink, 0, dark)),
  });
  // As the surface probe's plots, ignoring variation below 10⁻⁴ of the
  // column's largest curvature.
  const resolution =
    1e-4 *
    Math.max(
      0,
      ...[0, 1].flatMap((b) =>
        d.curvature[b].map((line) => Math.abs(line[column] ?? 0)),
      ),
    );
  // Nothing leaves the point: every value but the angle is blank.
  const blank = r.state !== "traced";
  // Signed along the ray: a virtual focus, behind the surface, is negative.
  const focus = (b: number) =>
    r.infinite[b] || r.distance[b] === null ? "∞" : short(r.distance[b]!);
  const angle = (x: number | null) => (x === null ? "—" : `${short(x)}°`);
  return (
    <>
      {/* Always five rows and a two-line status, as the surface probe's. */}
      <dl className="probe-readout">
        <dt>{terms.branches[0]}</dt>
        <dd>{blank ? "—" : short(r.curvature[0]!)}</dd>
        <dt>{terms.branches[1]}</dt>
        <dd>{blank ? "—" : short(r.curvature[1]!)}</dd>
        <dt>Foci 1/μ along the ray</dt>
        <dd>{blank ? "—" : `${focus(0)}, ${focus(1)}`}</dd>
        <dt>Astigmatic interval</dt>
        <dd>{blank ? "—" : r.interval === null ? "∞" : short(r.interval)}</dd>
        <dt>{refract ? "Angles θ, θ′" : "Angle of incidence θ"}</dt>
        <dd>
          {refract
            ? `${angle(r.theta)}, ${angle(r.thetaPrime)}`
            : angle(r.theta)}
        </dd>
      </dl>
      <p className="spatial-caption probe-status" data-testid="probe-status">
        {r.state === "singular"
          ? `Singular here: the ${m} has no normal, so no ray leaves.`
          : r.state === "source"
            ? "The source is here: no ray arrives or leaves."
            : r.state === "unlit"
              ? `Unlit: the light grazes the ${m} here or arrives behind it.`
              : r.state === "total"
                ? "Beyond the critical angle: the light is totally reflected, and nothing is transmitted."
                : r.stigmatic
                  ? "Stigmatic: both foci coincide, so no direction is drawn."
                  : r.infinite.some(Boolean)
                    ? "A focus lies beyond 100 study radii, at infinity: its circle is not drawn."
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
          resolution={resolution}
        />
      ))}
      <ul className="probe-legend">
        <li>
          <span className="probe-dot" style={swatch(probeInk.normal)} />
          {terms.normal}
        </li>
        {[0, 1].map((b) => (
          <li key={b}>
            <span className="probe-dot" style={swatch(surfaceInk[b])} />
            {terms.branches[b]}: {terms.legend}
          </li>
        ))}
        <li>
          <span className="probe-dot" style={swatch(probeInk.mark)} />
          Point
        </li>
      </ul>
      {(d.singular > 0 ||
        d.umbilics > 0 ||
        light.unlit > 0 ||
        light.total > 0 ||
        light.atSource > 0 ||
        d.clipped[0] > 0 ||
        d.clipped[1] > 0) && (
        <p className="spatial-caption probe-notes">
          {[
            d.singular > 0 &&
              `${count(d.singular, "point is", "points are")} singular, without a normal`,
            d.umbilics > 0 &&
              `${count(d.umbilics, "point is", "points are")} stigmatic`,
            light.unlit > 0 &&
              `${count(light.unlit, "point is", "points are")} unlit`,
            light.total > 0 &&
              `${count(light.total, "point is", "points are")} beyond the critical angle`,
            light.atSource > 0 &&
              `${count(light.atSource, "point is", "points are")} at the source`,
            ...[0, 1].map(
              (b) =>
                d.clipped[b] > 0 &&
                `${count(d.clipped[b], "focus", "foci")} of ${terms.branches[b]} ${d.clipped[b] === 1 ? "lies" : "lie"} beyond 100 study radii, at infinity`,
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
