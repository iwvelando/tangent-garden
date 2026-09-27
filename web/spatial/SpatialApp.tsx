import { useEffect, useRef, useState } from "react";
import { EngineClient } from "../engine-client";
import { ScalarInput, ScalarStatus, type ScalarState } from "../ScalarInput";
import { useTheme } from "../useTheme";
import { SpatialPlot } from "./SpatialPlot";
import type { SpatialConfig, SpatialResult } from "./types";
import type { Layers } from "./renderer";
import "./spatial.css";

const studies = [
  {
    name: "Trefoil",
    detail: "Three folds, one continuous thread",
    p: 2,
    q: 3,
    radius: 2.4,
    tube: 0.85,
    length: 2.3,
  },
  {
    name: "Cinquefoil",
    detail: "A five-fold tangle of tangent silk",
    p: 2,
    q: 5,
    radius: 2.4,
    tube: 0.7,
    length: 1.8,
  },
  {
    name: "Woven orbit",
    detail: "Three turns around, four through",
    p: 3,
    q: 4,
    radius: 2.4,
    tube: 1.1,
    length: 2.1,
  },
];
const geometry = (index: number) => {
  const { name: _name, detail: _detail, ...parameters } = studies[index];
  return parameters;
};
const defaults: SpatialConfig = { ...geometry(0), samples: 960, lines: 96 };
export default function SpatialApp() {
  const theme = useTheme();
  const client = useRef<EngineClient | null>(null);
  const generation = useRef(0);
  const [config, setConfig] = useState<SpatialConfig>(defaults);
  const [preset, setPreset] = useState(0);
  const [states, setStates] = useState<Record<string, ScalarState>>({});
  const [frame, setFrame] = useState<{
    config: SpatialConfig;
    result: SpatialResult;
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [reset, setReset] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [layers, setLayers] = useState<Layers>({
    surface: true,
    rulings: true,
    edges: true,
  });
  useEffect(() => {
    client.current = new EngineClient();
    return () => {
      generation.current++;
      client.current?.dispose();
      client.current = null;
    };
  }, []);
  const pending = Object.values(states).some((s) => s.pending);
  const scalarError = Object.values(states).find((s) => s.error);
  useEffect(() => {
    let current = true;
    setBusy(true);
    setError("");
    if (pending || scalarError) {
      setBusy(pending);
      return;
    }
    const timer = setTimeout(() => {
      client
        .current!.spatial(config)
        .then((result) => {
          if (current) {
            setFrame({ config, result });
            setBusy(false);
          }
        })
        .catch((e: Error) => {
          if (current) {
            setError(e.message);
            setBusy(false);
          }
        });
    }, 100);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [config, pending, scalarError]);
  const scalarStatus = {
    client,
    generation,
    track: (_job: Promise<void>) => {},
    report: (id: string, state: ScalarState | null) =>
      setStates((old) => {
        const next = { ...old };
        if (state) next[id] = state;
        else delete next[id];
        return next;
      }),
  };
  const choose = (index: number) => {
    generation.current++;
    setStates({});
    setPreset(index);
    setConfig((c) => ({ ...c, ...geometry(index) }));
    setReset((n) => n + 1);
  };
  const failure = scalarError
    ? `${scalarError.name}: ${scalarError.error}`
    : error;
  return (
    <div
      className={`app spatial-app${theme.dark ? " dark" : ""}`}
      data-theme-preference={theme.preference}
    >
      <header>
        <a className="brand" href="./">
          <img
            className="brand-symbol"
            src={`${import.meta.env.BASE_URL}tangent-garden.svg`}
            alt=""
          />
          <span className="brand-name">Tangent Garden</span>
        </a>
        <div className="header-actions">
          <a className="spatial-back" href="./">
            ← 2D notebook
          </a>
          <button
            onClick={theme.toggle}
            aria-label={
              theme.dark ? "Use light background" : "Use dark background"
            }
          >
            {theme.dark ? "☼" : "◐"}
          </button>
          {theme.preference !== "system" && (
            <button className="system-theme" onClick={theme.followSystem}>
              Follow system
            </button>
          )}
        </div>
      </header>
      <main className="spatial-layout">
        <aside
          className="spatial-controls"
          aria-label="Spatial study parameters"
        >
          <div className="section-label">SPATIAL STUDIES / 001</div>
          <h1>A knot of tangents.</h1>
          <p className="spatial-intro">
            A single thread. A family of straight lines. A ribbon that folds
            back into itself.
          </p>
          <div className="spatial-badge">3D EXPLORATION</div>
          <label className="spatial-field">
            Starting curve
            <select
              aria-label="Starting curve"
              value={preset}
              onChange={(e) => choose(Number(e.target.value))}
            >
              {studies.map((s, i) => (
                <option key={s.name} value={i}>
                  {s.name} · ({s.p}, {s.q})
                </option>
              ))}
            </select>
          </label>
          <p className="spatial-caption">{studies[preset].detail}</p>
          <ScalarStatus.Provider value={scalarStatus}>
            <div key={generation.current}>
              {(
                [
                  ["radius", "Major radius R"],
                  ["tube", "Minor radius r"],
                  ["length", "Tangent reach L"],
                ] as const
              ).map(([key, label]) => (
                <label className="spatial-field" key={key}>
                  {label}
                  <ScalarInput
                    name={label}
                    value={config[key]}
                    onChange={(value) =>
                      setConfig((c) => ({ ...c, [key]: value }))
                    }
                  />
                </label>
              ))}
            </div>
          </ScalarStatus.Provider>
          <p className="spatial-caption">
            Constant expressions welcome: pi, e, phi.
          </p>
          <fieldset className="spatial-layers">
            <legend>Reveal the construction</legend>
            {(
              [
                ["surface", "Ribbon surface"],
                ["rulings", "Tangent rulings"],
                ["edges", "Ribbon edges"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={layers[key]}
                  onChange={(e) =>
                    setLayers((s) => ({ ...s, [key]: e.target.checked }))
                  }
                />
                {label}
              </label>
            ))}
          </fieldset>
          <details className="spatial-details">
            <summary>Sampling & definition</summary>
            <label className="spatial-field">
              Curve samples
              <input
                aria-label="Curve samples"
                type="number"
                min="240"
                max="2400"
                step="1"
                value={Number.isNaN(config.samples) ? "" : config.samples}
                onChange={(e) =>
                  setConfig((c) => ({ ...c, samples: e.target.valueAsNumber }))
                }
              />
            </label>
            <label className="spatial-field">
              Tangent lines
              <input
                aria-label="Tangent lines"
                type="number"
                min="12"
                max="240"
                step="1"
                value={Number.isNaN(config.lines) ? "" : config.lines}
                onChange={(e) =>
                  setConfig((c) => ({ ...c, lines: e.target.valueAsNumber }))
                }
              />
            </label>
            <p>
              r(t) = ((R + r cos qt) cos pt,
              <br />
              (R + r cos qt) sin pt, r sin qt)
            </p>
            <p>0 ≤ t ≤ 2π · T = r′ / |r′|</p>
            <p>
              Finite sampling approximates the sheets. Self-intersections are
              kept; the knot is a singular seam. Compare sample counts for
              delicate folds.
            </p>
          </details>
          {failure && (
            <p className="error" role="alert">
              {failure}
            </p>
          )}
          <p className="spatial-status" role="status">
            {busy
              ? "Growing the spatial study…"
              : failure
                ? "Resolve the input to update the study."
                : `${config.samples.toLocaleString()} samples · ${config.lines} tangents`}
          </p>
        </aside>
        <section
          className="spatial-stage"
          aria-label="Spatial artwork"
          aria-busy={busy || pending}
          data-config={frame ? JSON.stringify(frame.config) : undefined}
        >
          <div className="spatial-stage-heading">
            <span>TANGENT DEVELOPABLE</span>
            <span>ORTHOGRAPHIC / 3D</span>
          </div>
          <div className="spatial-canvas-wrap">
            {frame ? (
              <SpatialPlot
                result={frame.result}
                dark={theme.dark}
                layers={layers}
                reset={reset}
                spinning={spinning}
              />
            ) : (
              <div className="loading">Preparing the spatial engine…</div>
            )}
            {frame && failure && (
              <span className="spatial-stale">Previous valid study</span>
            )}
          </div>
          <div className="spatial-toolbar">
            <span>
              Drag to orbit · scroll to zoom
              <br />
              <small>Keyboard: arrows, + / −, Home</small>
            </span>
            <div>
              <button
                aria-pressed={spinning}
                onClick={() => setSpinning((s) => !s)}
              >
                {spinning ? "Pause rotation" : "Rotate view"}
              </button>
              <button onClick={() => setReset((n) => n + 1)}>Reset view</button>
            </div>
          </div>
          <div className="spatial-explanation">
            <div>
              <span className="section-label">BEHIND THE FOLDS</span>
              <h2>Straight lines, woven into space.</h2>
            </div>
            <div>
              <p>
                At every point of the knot, extend a straight line in the
                tangent direction. Together those lines sweep a{" "}
                <em>tangent developable</em>. The gold thread marks the original
                curve; the two sheets meet there in a sharp fold.
              </p>
              <p className="spatial-formula">
                S(t, u) = r(t) + u T(t) <span>−L ≤ u ≤ L</span>
              </p>
              {frame?.result.omitted ? (
                <p>
                  {frame.result.omitted} intervals have undefined or unresolved
                  surface normals; faces are omitted.
                </p>
              ) : null}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
