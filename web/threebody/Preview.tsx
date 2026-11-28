// #552 research preview: the three-body corpus through the real worker,
// shown only with ?research=552. It is evidence for the owner's go/no-go,
// not the T2 study: no link, export or editor. Playback, seeking and the
// trails select the history's immutable samples by physical time; nothing
// reintegrates or interpolates, and nothing is drawn past the terminal.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "../AppHeader";
import { EngineClient } from "../engine-client";
import { axisInks, plotPalette } from "../palette";
import { count, liveReadout, mebibytes, readout } from "../number-format";
import { useTheme } from "../useTheme";
import type { Vec } from "../types";
import { sampleAt, type ThreeBodyCase, type ThreeBodyPrepared } from "./model";
import "./threebody.css";

const page = { width: 1000, height: 760 };
// Samples per unit of physical time, within the 20,000 the engine allows.
const density = 200;
const reasons: Record<string, string> = {
  end: "reached the end",
  encounter: "stopped at a close encounter",
  unresolved: "stopped: the step could not be resolved",
  exhausted: "stopped: the step budget ran out",
  drift: "stopped: the energy error left its budget",
  nonfinite: "refused: the starting forces are not finite",
};

type Frame = { cx: number; cy: number; k: number };

// One frame for the whole history, so a later moment never rescales the
// drawing: every sample and the final state, with a margin. The close dance
// frames only the samples whose bodies are all within 2 of the starting
// center of mass, so a fleeing body leaves the frame instead of shrinking
// the rest.
function frameOf(
  p: ThreeBodyPrepared,
  masses: number[],
  close: boolean,
): Frame {
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  const take = (v: Vec) => {
    x0 = Math.min(x0, v.x);
    x1 = Math.max(x1, v.x);
    y0 = Math.min(y0, v.y);
    y1 = Math.max(y1, v.y);
  };
  let cx = 0,
    cy = 0;
  p.paths.forEach((path, i) => {
    cx += masses[i] * path.positions[0].x;
    cy += masses[i] * path.positions[0].y;
  });
  const inside = (k: number) =>
    !close ||
    p.paths.every(
      (path) =>
        Math.hypot(path.positions[k].x - cx, path.positions[k].y - cy) <= 2,
    );
  for (let k = 0; k < p.available; k++)
    if (inside(k)) for (const path of p.paths) take(path.positions[k]);
  if (!close) p.final.positions.forEach(take);
  const w = Math.max(x1 - x0, 1e-6),
    h = Math.max(y1 - y0, 1e-6);
  const k = 0.9 * Math.min(page.width / w, page.height / h);
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, k };
}

const at = (f: Frame, v: Vec) =>
  `${Math.round((page.width / 2 + (v.x - f.cx) * f.k) * 10) / 10} ${Math.round((page.height / 2 - (v.y - f.cy) * f.k) * 10) / 10}`;

export function ThreeBodyPreview({
  onReturn,
}: {
  onReturn: (via: "keyboard" | "pointer") => void;
}) {
  const theme = useTheme();
  const dialog = useRef<HTMLDialogElement>(null);
  const client = useRef<EngineClient | null>(null);
  const [cases, setCases] = useState<ThreeBodyCase[]>([]);
  const [name, setName] = useState("figure-eight");
  const [duration, setDuration] = useState<number | null>(null);
  const [prepared, setPrepared] = useState<{
    key: string;
    result: ThreeBodyPrepared;
    prepare: number;
    bytes: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [trail, setTrail] = useState<"full" | "window">("full");
  const [windowLength, setWindowLength] = useState(3);
  const [triangle, setTriangle] = useState(false);
  const [framing, setFraming] = useState<"whole" | "close">("whole");
  const request = useRef(0);

  useLayoutEffect(() => {
    dialog.current?.showModal();
    document.documentElement.classList.add("threebody-open");
    return () => document.documentElement.classList.remove("threebody-open");
  }, []);
  useEffect(() => {
    const c = new EngineClient();
    client.current = c;
    c.threeBodyCorpus().then(setCases, (e) => setError(String(e.message)));
    return () => c.dispose();
  }, []);
  const chosen = cases.find((c) => c.name === name);
  const span = duration ?? chosen?.duration ?? 0;
  const key = `${name}:${span}`;
  // A newer request replaces an older one: its reply never replaces the
  // newer history.
  useEffect(() => {
    if (!chosen || !client.current || !(span > 0)) return;
    const id = ++request.current;
    setPlaying(false);
    const samples = Math.min(
      20000,
      Math.max(2, Math.round(span * density) + 1),
    );
    client.current
      .threeBody({ bodies: chosen.bodies, duration: span, samples })
      .then(
        (r) => {
          if (id !== request.current) return;
          setPrepared({ key, ...r });
          setError(null);
          setTime(0);
        },
        (e) => {
          if (id !== request.current) return;
          setError(String(e.message));
        },
      );
  }, [key, chosen]);

  const result = prepared?.result;
  const end = result?.final.time ?? 0;
  // Playback advances physical time at the chosen speed and stops at the
  // end; the clock never extrapolates before its start.
  useEffect(() => {
    if (!playing || !result) return;
    let frame = 0;
    const from = performance.now(),
      start = time >= end ? 0 : time;
    const tick = (now: number) => {
      const t = Math.min(end, start + (Math.max(0, now - from) / 1000) * speed);
      setTime(t);
      if (t >= end) setPlaying(false);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, result, speed]);

  const palette = plotPalette(theme.dark, theme.scheme);
  const inks = axisInks(theme.dark, theme.scheme).slice(0, 3);
  const frame = useMemo(
    () =>
      result && chosen
        ? frameOf(
            result,
            chosen.bodies.map((b) => b.mass),
            framing === "close",
          )
        : null,
    [result, framing],
  );
  // Each body's samples as page vertices, once per history: a frame only
  // joins a slice of them.
  const vertices = useMemo(
    () =>
      result && frame
        ? result.paths.map((p) => p.positions.map((v) => at(frame, v)))
        : [],
    [result, frame],
  );
  const drawing = (() => {
    if (!result || !frame || result.available < 1) return null;
    const k = sampleAt(result, time);
    const past = time >= end && end > result.times[result.available - 1];
    const from =
      trail === "full" ? 0 : Math.max(0, sampleAt(result, time - windowLength));
    const heads = result.paths.map((p, i) =>
      past ? result.final.positions[i] : p.positions[k],
    );
    return (
      <svg
        className="threebody-drawing"
        viewBox={`0 0 ${page.width} ${page.height}`}
        role="img"
        aria-label="Three bodies and their trails"
        aria-busy={prepared?.key !== key || undefined}
        style={{ background: palette.bg }}
      >
        {result.paths.map((_, i) => {
          let d = "M" + vertices[i].slice(from, k + 1).join("L");
          if (past) d += `L${at(frame, result.final.positions[i])}`;
          return (
            <path
              key={i}
              d={d}
              fill="none"
              stroke={inks[i]}
              strokeWidth={1.6}
              strokeOpacity={0.8}
              strokeLinejoin="round"
            />
          );
        })}
        {triangle && (
          <polygon
            points={heads.map((v) => at(frame, v)).join(" ")}
            fill="none"
            stroke={palette.line}
            strokeWidth={1}
            strokeDasharray="5 4"
          />
        )}
        {heads.map((v, i) => {
          const [x, y] = at(frame, v).split(" ");
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={4 + 10 * Math.sqrt(chosen?.bodies[i].mass ?? 0.3)}
              fill={inks[i]}
              stroke={palette.bg}
              strokeWidth={1.5}
            />
          );
        })}
      </svg>
    );
  })();

  const t = result?.terminal;
  const d = result?.diagnostics;
  return (
    <dialog
      ref={dialog}
      className="threebody"
      aria-labelledby="threebody-title"
      onCancel={(e) => {
        e.preventDefault();
        onReturn("keyboard");
      }}
    >
      <AppHeader theme={theme} appearance={false}>
        <button
          onClick={(e) => onReturn(e.detail === 0 ? "keyboard" : "pointer")}
        >
          Return to the notebook
        </button>
      </AppHeader>
      <div className="threebody-content">
        <div className="threebody-heading">
          <p className="eyebrow">
            Research preview · #552 · G = 1, total mass 1
          </p>
          <h2 id="threebody-title">Three bodies</h2>
          <p>
            Three point masses pull on one another. The history is integrated
            once; playback and the slider choose among its fixed-time samples.
          </p>
        </div>
        <div className="threebody-layout">
          <main>
            {drawing ?? (
              <p className="threebody-placeholder" role="status">
                {error ?? "Integrating the history…"}
              </p>
            )}
            <ul className="legend threebody-legend">
              {inks.map((ink, i) => (
                <li key={i}>
                  <span
                    className="threebody-swatch"
                    style={{ background: ink }}
                  />
                  Body {i + 1}
                  {chosen && ` · mass ${readout(chosen.bodies[i].mass, 4)}`}
                </li>
              ))}
            </ul>
            <div
              className="threebody-playback"
              role="group"
              aria-label="Playback"
            >
              <button disabled={!result} onClick={() => setPlaying((p) => !p)}>
                {playing ? "Pause" : time > 0 && time < end ? "Resume" : "Play"}
              </button>
              <label className="threebody-scrub">
                <span>Time</span>
                <input
                  type="range"
                  min={0}
                  max={end || 1}
                  step="any"
                  value={time}
                  disabled={!result}
                  onChange={(e) => {
                    setPlaying(false);
                    // The input serializes its value with fewer digits than
                    // its max: the end itself is the last value.
                    const v = e.currentTarget.valueAsNumber;
                    setTime(v >= end * (1 - 1e-9) ? end : v);
                  }}
                />
              </label>
              <span className="threebody-clock" aria-live="off">
                t = {liveReadout(time, [0, span || 1])} of {readout(span, 4)}
              </span>
            </div>
            {error && result && (
              <p className="study-error" role="alert">
                {error}
              </p>
            )}
          </main>
          <aside>
            <label className="field">
              <span className="field-label">Configuration</span>
              <select
                value={name}
                onChange={(e) => {
                  setName(e.currentTarget.value);
                  setDuration(null);
                }}
              >
                {cases.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">
                Duration (time units, at most 100)
              </span>
              <select
                value={duration ?? "case"}
                onChange={(e) =>
                  setDuration(
                    e.currentTarget.value === "case"
                      ? null
                      : Number(e.currentTarget.value),
                  )
                }
              >
                <option value="case">
                  As studied{chosen && ` (${readout(chosen.duration, 4)})`}
                </option>
                {[10, 25, 50, 100].map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Speed (time units per second)</span>
              <select
                value={speed}
                onChange={(e) => setSpeed(Number(e.currentTarget.value))}
              >
                {[0.25, 0.5, 1, 2, 4].map((v) => (
                  <option key={v} value={v}>
                    {readout(v)}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="threebody-trails">
              <legend>Trails</legend>
              <label className="check">
                <input
                  type="radio"
                  name="threebody-trail"
                  checked={trail === "full"}
                  onChange={() => setTrail("full")}
                />
                Whole history so far
              </label>
              <label className="check">
                <input
                  type="radio"
                  name="threebody-trail"
                  checked={trail === "window"}
                  onChange={() => setTrail("window")}
                />
                The last
                <select
                  aria-label="Trail length in time units"
                  value={windowLength}
                  onChange={(e) => {
                    setTrail("window");
                    setWindowLength(Number(e.currentTarget.value));
                  }}
                >
                  {[0.5, 1, 3, 10].map((v) => (
                    <option key={v} value={v}>
                      {readout(v)}
                    </option>
                  ))}
                </select>
                time units
              </label>
            </fieldset>
            <fieldset className="threebody-trails">
              <legend>Frame</legend>
              <label className="check">
                <input
                  type="radio"
                  name="threebody-frame"
                  checked={framing === "whole"}
                  onChange={() => setFraming("whole")}
                />
                The whole history
              </label>
              <label className="check">
                <input
                  type="radio"
                  name="threebody-frame"
                  checked={framing === "close"}
                  onChange={() => setFraming("close")}
                />
                The close dance: while all three stay within 2 of the start
              </label>
            </fieldset>
            <label className="check">
              <input
                type="checkbox"
                checked={triangle}
                onChange={(e) => setTriangle(e.currentTarget.checked)}
              />
              Connecting triangle
            </label>
            {chosen && (
              <div className="threebody-about">
                <h3>About this configuration</h3>
                <p>
                  <strong>Periodicity.</strong> {chosen.periodicity}.
                </p>
                <p>
                  <strong>Stability.</strong> {chosen.stability}.
                </p>
                {chosen.period > 0 && (
                  <p>Period {readout(chosen.period, 9)} time units.</p>
                )}
                <p className="note">
                  {chosen.source}.{" "}
                  {chosen.length !== 1 &&
                    `Published lengths are divided by ${readout(chosen.length, 6)} and times multiplied by ${readout(chosen.timeFactor, 6)}.`}
                </p>
              </div>
            )}
            {result && t && d && (
              <div className="threebody-about">
                <h3>This history</h3>
                <p role="status">
                  The integration {reasons[t.reason] ?? t.reason} at t ={" "}
                  {readout(t.time, 6)}
                  {t.reason === "encounter" &&
                    `: bodies ${t.pair[0]} and ${t.pair[1]} came within ${readout(t.separation, 3)}`}
                  .
                </p>
                <dl className="threebody-facts">
                  <dt>Steps</dt>
                  <dd>
                    {count(result.accepted)} accepted, {count(result.rejected)}{" "}
                    rejected, of {count(200000)}
                  </dd>
                  <dt>Samples</dt>
                  <dd>
                    {count(result.available)} of {count(result.times.length)}
                  </dd>
                  <dt>Energy error</dt>
                  <dd>{readout(d.energyError, 2)} (relative)</dd>
                  <dt>Momentum change</dt>
                  <dd>{readout(d.momentumError, 2)}</dd>
                  <dt>Angular momentum change</dt>
                  <dd>{readout(d.angularError, 2)} (relative)</dd>
                  <dt>Center of mass off its line</dt>
                  <dd>{readout(d.centerError, 2)}</dd>
                  <dt>Closest approach</dt>
                  <dd>
                    {readout(d.closest, 3)} at t = {readout(d.closestTime, 4)}
                  </dd>
                  <dt>Worker</dt>
                  <dd>
                    {readout(prepared!.prepare, 3)} ms;{" "}
                    {mebibytes(d.retainedBytes)} retained,{" "}
                    {mebibytes(prepared!.bytes)} sent
                  </dd>
                </dl>
              </div>
            )}
          </aside>
        </div>
      </div>
    </dialog>
  );
}
