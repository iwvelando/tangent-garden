import { Field, HelpText, HelpToggle, useHelp } from "./Field";
import { ProbePlot } from "./ProbePlot";
import { probeColor, probeIndex } from "./probe";
import {
  probeHelp,
  probeHighlight,
  probeReadout,
  probeStraight,
  probeSupported,
  type PlanarProbe,
} from "./planar-probe";
import type { Config, Frame } from "./types";

// Four significant figures: curvature is differenced numerically from the
// curve's expressions to about 10⁻⁷ relative accuracy.
const short = (v: number) => String(Number(v.toPrecision(4)));
const count = (n: number, one: string, many: string) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

// The 2D probe's controls and readout. `frame` is the study's own result
// with diagnostics, or null while they are computed. `at` is the sample an
// animation has moved the probe to; the slider waits until it stops.
// `away` says why an animation that draws the probe has none on
// the frame it shows.
export function PlanarProbePanel({
  config,
  frame,
  probe,
  onProbe,
  animating,
  at: moving,
  away,
  dark,
}: {
  config: Config;
  frame: Frame | null;
  probe: PlanarProbe;
  onProbe: (change: (p: PlanarProbe) => PlanarProbe) => void;
  animating: boolean;
  at?: number;
  away?: string;
  dark: boolean;
}) {
  const help = useHelp();
  if (!probeSupported(config)) return null;
  const d = frame?.result.diagnostics;
  const n = d ? d.curvature.length - 1 : 0;
  const at = moving ?? probeIndex(probe.position, n);
  const readout = frame && d ? probeReadout(frame.result, at) : null;
  const swatch = (ink: "mark" | "tangent" | "normal") => ({
    background: probeColor(ink, dark),
  });
  return (
    <fieldset className="planar-probe">
      <legend>Probe</legend>
      {/* Content that comes and goes stays inside this wrapper: Chromium
          ends a slider's drag when a child is inserted directly into its
          fieldset. */}
      <div>
        <div className="probe-switch">
          <label className="check">
            <input
              type="checkbox"
              checked={probe.enabled}
              onChange={(e) => {
                const enabled = e.target.checked;
                onProbe((p) => ({ ...p, enabled }));
              }}
            />
            Tangent, normal & curvature at a point
          </label>
          <HelpToggle topic="the probe" help={help} />
        </div>
        <HelpText help={help}>{probeHelp(config, frame?.result)}</HelpText>
        {probe.enabled &&
          (animating && moving === undefined ? (
            <p className="probe-caption">
              {away ?? "The probe returns when the animation stops."}
            </p>
          ) : !readout || !d ? (
            <p className="probe-caption">Finding the curvature…</p>
          ) : (
            <>
              {probeStraight(frame!.result) && (
                <p className="probe-caption" data-testid="probe-straight">
                  This curve is straight: its curvature is zero everywhere, so
                  it has no osculating circle.
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
                    ? frame!.result.base[at]
                      ? "unknown here"
                      : "undefined: no point here"
                    : readout.flat
                      ? "0 (flat: no circle)"
                      : `${short(readout.curvature)} (turning ${readout.curvature > 0 ? "left" : "right"})`}
                </dd>
                <dt>Radius 1/|κ|</dt>
                <dd>
                  {readout.radius === null
                    ? "undefined"
                    : readout.infinite
                      ? `${short(readout.radius)} (circle not drawn)`
                      : short(readout.radius)}
                </dd>
                <dt>Arc length s</dt>
                <dd>
                  {readout.length === null
                    ? "undefined"
                    : short(readout.length)}
                </dd>
              </dl>
              {!probeStraight(frame!.result) && (
                <ProbePlot
                  values={d.curvature}
                  fromZero={false}
                  at={at}
                  label="κ"
                  ink={probeColor("mark", dark)}
                />
              )}
              <ul className="probe-legend">
                <li>
                  <span className="probe-dot" style={swatch("tangent")} />T
                </li>
                <li>
                  <span className="probe-dot" style={swatch("normal")} />N
                </li>
                <li>
                  <span className="probe-dot" style={swatch("mark")} />
                  Point, circle
                  {probeHighlight(frame!.config, frame!.result)
                    ? " & construction"
                    : ""}
                </li>
              </ul>
              {((d.flat > 0 && !probeStraight(frame!.result)) ||
                d.unknown > 0 ||
                d.clipped > 0) && (
                <p className="probe-caption probe-notes">
                  {[
                    d.flat > 0 &&
                      !probeStraight(frame!.result) &&
                      `κ vanishes at ${count(d.flat, "sample", "samples")}, where there is no circle`,
                    d.unknown > 0 &&
                      `κ is unknown at ${count(d.unknown, "sample", "samples")}, where the second derivative is unstable`,
                    d.clipped > 0 &&
                      `${count(d.clipped, "center lies", "centers lie")} beyond 100 study radii, at infinity`,
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
