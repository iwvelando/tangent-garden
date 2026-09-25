import { useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { presets } from "./presets";
import { Plot, type Layers } from "./Plot";
import type { Bounds, Config, Frame, Kind } from "./types";
import { EngineClient, boundText } from "./engine-client";
import { useTheme } from "./useTheme";
import { AnimationPanel } from "./AnimationPanel";
import { ExportImageMenu } from "./ExportImageMenu";
import { Field, HelpText, HelpToggle, useHelp } from "./Field";
import { useDisclosure } from "./useDisclosure";
import { useMediaQuery } from "./useMediaQuery";
import type { AnimationView, Viewport } from "./animation";
import "./style.css";

const descriptions: Record<
  Kind,
  { title: string; description: string; formula: string }
> = {
  evolute: {
    title: "The envelope of normals",
    description:
      "Each normal meets its neighbors at a center of curvature. Together, those centers trace the evolute.",
    formula: "E(t) = r(t) + |r′(t)|² J r′(t) / det(r′(t), r″(t))",
  },
  involute: {
    title: "A curve, unwound",
    description:
      "Imagine unwinding a taut string from a curve. Its free end draws the involute; each line is a length of that string.",
    formula: "I(t) = r(t) − (s(t) + c) T(t)",
  },
  catacaustic: {
    title: "The envelope of reflected light",
    description:
      "A family of reflected rays gathers into a curve. Dashed extensions reveal the places where rays appear to meet behind the surface.",
    formula: "C(t) = r(t) − det(d, r′) / det(d, d′) · d",
  },
  diacaustic: {
    title: "The envelope of refracted light",
    description:
      "Light bends as it crosses a curve between two media. The envelope of transmitted rays is the diacaustic.",
    formula: "n₁ sin θ₁ = n₂ sin θ₂",
  },
};
function App() {
  const [config, setConfig] = useState<Config>(presets[0].config);
  const [preset, setPreset] = useState("0");
  const [frame, setFrame] = useState<Frame | null>(null);
  const [bounds, setBounds] = useState<Bounds>({
    min: boundText(config.curve.min),
    max: boundText(config.curve.max),
  });
  const [expert, setExpert] = useState(false);
  const [animation, setAnimation] = useState<AnimationView | null>(null);
  const [animationRunning, setAnimationRunning] = useState(false);
  const [computeError, setError] = useState("");
  const [settledKey, setSettledKey] = useState("");
  const requestKey = JSON.stringify([config, bounds]);
  // Derive readiness from the exact inputs, so neither export nor animation can
  // briefly consume the previous frame before the debounce effect runs.
  const busy = settledKey !== requestKey;
  const error = busy ? "" : computeError;
  const { dark, preference, toggle, followSystem } = useTheme();
  const [reset, setReset] = useState(0);
  const [length, setLength] = useState(0.8);
  const [layers, setLayers] = useState<Layers>({
    base: true,
    derived: true,
    lines: true,
    incident: true,
    virtual: true,
    axes: false,
  });
  const modeHelp = useHelp();
  const narrow = useMediaQuery("(max-width: 700px)");
  const expressions = useDisclosure("expressions");
  const indices = useDisclosure("indices");
  const diagnostics = useDisclosure("diagnostics");
  const samplesHelp =
    "More samples trace the curve more finely and take longer to compute; they do not raise numerical precision on their own." +
    (expert ? " Whole numbers from 64 to 32,768." : "");
  const client = useRef<EngineClient | null>(null);
  const manualView = useRef<Viewport | undefined>(undefined);
  const plotWrap = useRef<HTMLDivElement>(null);
  // On narrow screens the controls sit below the drawing, so playback started
  // from them would otherwise run out of sight. Wide layouts keep the drawing
  // in view already and are left untouched.
  const revealPlot = () => {
    const plot = plotWrap.current;
    if (!plot) return;
    // A docked playback bar covers the bottom of the screen.
    const bar = document.getElementById("playback");
    const limit =
      bar && getComputedStyle(bar).position === "fixed"
        ? bar.getBoundingClientRect().top
        : window.innerHeight;
    const { top, bottom } = plot.getBoundingClientRect();
    if (top >= 0 && bottom <= limit) return;
    plot.scrollIntoView({
      block: "start",
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  };
  useEffect(() => {
    const engine = new EngineClient();
    client.current = engine;
    return () => engine.dispose();
  }, []);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      client
        .current!.compute(config, bounds)
        .then((next) => {
          if (cancelled) return;
          setFrame(next);
          setError("");
          setSettledKey(requestKey);
        })
        .catch((reason) => {
          if (cancelled) return;
          setFrame(null);
          setError(reason.message);
          setSettledKey(requestKey);
        });
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [config, bounds]);
  const shown = animation?.frame ?? frame;
  const result = shown?.result;
  const optical = config.kind === "catacaustic" || config.kind === "diacaustic";
  const info = descriptions[config.kind];
  const update = (patch: Partial<Config>) => {
    setPreset("custom");
    setConfig({ ...config, ...patch });
  };
  const curve = (patch: Partial<Config["curve"]>) =>
    update({ curve: { ...config.curve, ...patch } });
  const number = (
    label: ReactNode,
    value: number,
    change: (n: number) => void,
    options: {
      step?: number | string;
      min?: number;
      max?: number;
      help?: ReactNode;
      topic?: string;
    } = {},
  ) => (
    <Field label={label} help={options.help} topic={options.topic}>
      <input
        type="number"
        value={Number.isNaN(value) ? "" : value}
        step={options.step ?? "any"}
        min={options.min}
        max={options.max}
        onChange={(e) => change(e.target.valueAsNumber)}
      />
    </Field>
  );
  // On phones the controls follow the drawing directly, so the explanation
  // moves after them instead of separating the two.
  const behind = (
    <>
      <div className="explanation">
        <div>
          <span className="section-label">BEHIND THE LINES</span>
          <p>{info.description}</p>
        </div>
        <div className="formula">{info.formula}</div>
      </div>
      {result?.warnings.length !== 0 && result && (
        <details className="diagnostics" {...diagnostics}>
          <summary>Numerical notes · {result.invalid} omitted samples</summary>
          {result.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </details>
      )}
      <p className="bottom-note">
        {optical
          ? "A mathematical ray family: every sampled point participates. No occlusion or multiple bounces."
          : "The connecting lines reveal the geometry of the construction."}{" "}
        Finite sampling can miss fine detail; compare resolutions near
        singularities.
      </p>
      <p className="closing">An open notebook for mathematical beauty.</p>
    </>
  );
  return (
    <div
      className={dark ? "app dark" : "app"}
      data-theme-preference={preference}
    >
      <header>
        <a className="brand" href="./">
          <img
            className="brand-symbol"
            src={`${import.meta.env.BASE_URL}tangent-garden.svg`}
            alt=""
          />
          <span className="brand-name">Tangent Garden</span>
          <span className="brand-divider" />{" "}
          <small>CURVES & CONSTRUCTIONS</small>
        </a>
        <div className="header-actions">
          <span className="local-note">
            A little geometry. A lot of beauty.
          </span>
          <button
            onClick={toggle}
            title={
              preference === "system"
                ? "Following your system theme. Click to choose a fixed theme."
                : "Your theme choice is saved in this browser."
            }
            aria-label={dark ? "Use light background" : "Use dark background"}
          >
            {dark ? "☼" : "◐"}
          </button>
          {preference !== "system" && (
            <button
              className="system-theme"
              onClick={followSystem}
              title="Follow system changes, including time-of-day changes"
            >
              Follow system
            </button>
          )}
          <ExportImageMenu
            disabled={!result || busy || !!error || animationRunning}
            kind={config.kind}
          />
        </div>
      </header>
      <main>
        <aside aria-label="Study parameters">
          <div className="section-label">01 / THE STUDY</div>
          <Field label="Start with a notebook example">
            <select
              value={preset}
              onChange={(e) => {
                setPreset(e.target.value);
                setConfig(structuredClone(presets[+e.target.value].config));
                setBounds({
                  min: boundText(presets[+e.target.value].config.curve.min),
                  max: boundText(presets[+e.target.value].config.curve.max),
                });
                setReset(reset + 1);
              }}
            >
              {preset === "custom" && (
                <option value="custom">Custom study</option>
              )}
              {presets.map((p, i) => (
                <option key={p.title} value={i}>
                  {p.title}
                </option>
              ))}
            </select>
          </Field>
          <fieldset className="mode-switch" aria-labelledby="controls-legend">
            <legend>
              <span id="controls-legend">Controls</span>
              <HelpToggle topic="control modes" help={modeHelp} />
            </legend>
            <div className="mode-options">
              {[false, true].map((value) => (
                <label key={String(value)}>
                  <input
                    type="radio"
                    name="controls-mode"
                    checked={expert === value}
                    onChange={() => setExpert(value)}
                  />
                  {value ? "Expert mode" : "Simple mode"}
                </label>
              ))}
            </div>
            <HelpText help={modeHelp}>
              Simple mode offers presets and sliders. Expert mode takes exact
              whole numbers: 64–32,768 samples and 2–2,048 construction lines,
              never more lines than samples. Larger values take longer to
              compute and draw.
            </HelpText>
          </fieldset>
          <div className="tabs" role="group" aria-label="Construction">
            {(Object.keys(descriptions) as Kind[]).map((k) => (
              <button
                className={config.kind === k ? "active" : ""}
                aria-pressed={config.kind === k}
                key={k}
                onClick={() => update({ kind: k })}
              >
                {k}
              </button>
            ))}
          </div>
          <section>
            <div className="section-label">02 / THE CURVE</div>
            <Field label="Definition">
              <select
                value={config.curve.format}
                onChange={(e) =>
                  curve({ format: e.target.value as Config["curve"]["format"] })
                }
              >
                <option value="parametric">Parametric · x(t), y(t)</option>
                <option value="cartesian">Cartesian · y = f(x)</option>
                <option value="polar">Polar · r(t)</option>
              </select>
            </Field>
            {config.curve.format === "parametric" && (
              <Field label="x(t)" className="equation">
                <input
                  value={config.curve.x}
                  onChange={(e) => curve({ x: e.target.value })}
                  spellCheck={false}
                />
              </Field>
            )}
            {config.curve.format !== "polar" ? (
              <Field
                label={config.curve.format === "cartesian" ? "f(x)" : "y(t)"}
                className="equation"
              >
                <input
                  value={config.curve.y}
                  onChange={(e) => curve({ y: e.target.value })}
                  spellCheck={false}
                />
              </Field>
            ) : (
              <Field label="r(t)" className="equation">
                <input
                  value={config.curve.r}
                  onChange={(e) => curve({ r: e.target.value })}
                  spellCheck={false}
                />
              </Field>
            )}
            <div className="pair">
              {(["min", "max"] as const).map((key) => (
                <Field
                  className="equation"
                  key={key}
                  label={
                    key === "min"
                      ? config.curve.format === "cartesian"
                        ? "x from"
                        : "t from"
                      : "to"
                  }
                >
                  <input
                    value={bounds[key]}
                    onChange={(e) => {
                      setPreset("custom");
                      setBounds({ ...bounds, [key]: e.target.value });
                    }}
                    spellCheck={false}
                  />
                </Field>
              ))}
            </div>
            {number(
              <>
                Shape parameter <var>a</var>
              </>,
              config.curve.a,
              (n) => curve({ a: n }),
              {
                topic: "shape parameter a",
                help: (
                  <>
                    Use <var>a</var> as an adjustable coefficient in your curve,
                    for example <code>a*cos(t)</code>, then animate it.
                    Expressions without a are unaffected.
                  </>
                ),
              },
            )}
            <details {...expressions}>
              <summary>Expression reference</summary>
              <p>
                Use explicit multiplication: <code>2*cos(t)</code>. Supports + −
                * / ^, parentheses, pi, e, phi, sin, cos, tan, asin, acos, atan,
                sinh, cosh, tanh, sech, exp, log, ln, sqrt, abs. Angles are
                radians. Use <var>t</var> (or <var>x</var> for a graph), and{" "}
                <var>a</var> for an adjustable shape coefficient. Bounds and
                animation endpoints accept constant expressions such as 2*pi or
                -phi; they cannot contain <var>t</var>, <var>x</var>, or
                <var>a</var>.
              </p>
              <p>
                <code>pi ≈ 3.1415926536</code> · circle constant
                <br />
                <code>e ≈ 2.7182818285</code> · natural logarithm base
                <br />
                <code>phi ≈ 1.6180339887</code> · golden ratio, (1+√5)/2
              </p>
            </details>
          </section>
          {optical && (
            <section>
              <div className="section-label">03 / THE LIGHT</div>
              <Field label="Source">
                <select
                  value={config.source.kind}
                  onChange={(e) =>
                    update({
                      source: {
                        ...config.source,
                        kind: e.target.value as "point" | "parallel",
                      },
                    })
                  }
                >
                  <option value="point">Point source</option>
                  <option value="parallel">At infinity · parallel rays</option>
                </select>
              </Field>
              {config.source.kind === "point" && (
                <Field
                  label="Source coordinates"
                  help={
                    config.source.coordinates === "polar"
                      ? "Radius r ≥ 0 is the distance from the origin. Angle θ is in radians, counterclockwise from +x; animate it from 0 to pi/2 for a quarter orbit. Angles are not wrapped."
                      : undefined
                  }
                >
                  <select
                    value={config.source.coordinates ?? "cartesian"}
                    onChange={(e) => {
                      const coordinates = e.target.value as
                        "cartesian" | "polar";
                      const position =
                        config.source.coordinates === "polar"
                          ? {
                              x:
                                (config.source.radius ?? 0) *
                                Math.cos(config.source.theta ?? 0),
                              y:
                                (config.source.radius ?? 0) *
                                Math.sin(config.source.theta ?? 0),
                            }
                          : config.source.position;
                      update({
                        source: {
                          ...config.source,
                          coordinates,
                          position,
                          radius: Math.hypot(position.x, position.y),
                          theta: Math.atan2(position.y, position.x),
                        },
                      });
                    }}
                  >
                    <option value="cartesian">Cartesian · x, y</option>
                    <option value="polar">Polar · r, θ</option>
                  </select>
                </Field>
              )}
              {config.source.kind === "point" &&
              config.source.coordinates === "polar" ? (
                <div className="pair">
                  {number(
                    "Source radius r",
                    config.source.radius ?? 0,
                    (radius) =>
                      update({ source: { ...config.source, radius } }),
                    { min: 0 },
                  )}
                  {number(
                    "Source theta θ (radians)",
                    config.source.theta ?? 0,
                    (theta) => update({ source: { ...config.source, theta } }),
                  )}
                </div>
              ) : config.source.kind === "point" ? (
                <div className="pair">
                  {number("Source x", config.source.position.x, (n) =>
                    update({
                      source: {
                        ...config.source,
                        position: { ...config.source.position, x: n },
                      },
                    }),
                  )}
                  {number("Source y", config.source.position.y, (n) =>
                    update({
                      source: {
                        ...config.source,
                        position: { ...config.source.position, y: n },
                      },
                    }),
                  )}
                </div>
              ) : (
                number("Travel direction (degrees)", config.source.angle, (n) =>
                  update({ source: { ...config.source, angle: n } }),
                )
              )}
              {config.source.kind === "parallel" && (
                <p className="note">0° travels right; 90° travels up.</p>
              )}
              {config.kind === "diacaustic" && (
                <>
                  <div className="pair">
                    {number(
                      "Incident index n₁",
                      config.nIncident,
                      (n) => update({ nIncident: n }),
                      { min: 0.01, max: 10 },
                    )}
                    {number(
                      "Transmitted n₂",
                      config.nTransmitted,
                      (n) => update({ nTransmitted: n }),
                      { min: 0.01, max: 10 },
                    )}
                  </div>
                  <p className="note">
                    Ratio n₁/n₂ ={" "}
                    {(config.nIncident / config.nTransmitted).toFixed(3)}. Each
                    ray crosses once.
                  </p>
                  <details {...indices}>
                    <summary>How the refractive indices work</summary>
                    <p>
                      The incident index n₁ describes the medium light is
                      leaving; transmitted index n₂ describes the medium it
                      enters. The index is the ratio of the speed of light in
                      vacuum to its phase speed in that medium. Familiar
                      examples are air ≈ 1, water ≈ 1.33, and glass ≈ 1.5; real
                      values depend on material and wavelength.
                    </p>
                    <p>
                      Snell’s law is n₁ sin θ₁ = n₂ sin θ₂, with angles measured
                      from the normal. If n₂ is larger, light bends toward the
                      normal; if smaller, it bends away. Equal indices leave the
                      direction unchanged. When n₁ &gt; n₂ and the incident
                      angle exceeds asin(n₂/n₁), there is total internal
                      reflection: amber reflected rays replace transmitted rays
                      at those samples.
                    </p>
                    <p>
                      This explorer accepts any finite decimal from{" "}
                      <strong>0.01 through 10</strong>, inclusive, for either
                      index. These are computational limits, not a claim that
                      every value represents ordinary visible-light glass. There
                      is no 0.05-step restriction: 1.333 is valid. The
                      construction uses the ratio n₁/n₂, so scaling both equally
                      gives the same ray directions.
                    </p>
                  </details>
                </>
              )}
            </section>
          )}
          {config.kind === "involute" && (
            <section>
              {number(
                "Initial string offset c",
                config.offset,
                (n) => update({ offset: n }),
                {
                  topic: "initial string offset",
                  help: "Arc length starts at the domain minimum. The offset selects a member of the involute family.",
                },
              )}
            </section>
          )}
          <section>
            <div className="section-label">
              {optical ? "04" : "03"} / THE DRAWING
            </div>
            {expert ? (
              number(
                "Construction lines",
                config.lines,
                (n) => update({ lines: n }),
                {
                  step: 1,
                  min: 2,
                  max: Math.min(2048, config.samples),
                  help: "Whole numbers from 2 to 2,048, no more than the samples. Dense drawings slow interaction and export.",
                },
              )
            ) : (
              <Field label="Construction lines" value={config.lines}>
                <input
                  type="range"
                  min={Math.min(
                    8,
                    Number.isFinite(config.lines) ? config.lines : 8,
                  )}
                  max={Math.max(
                    180,
                    Number.isFinite(config.lines) ? config.lines : 180,
                  )}
                  value={config.lines}
                  onChange={(e) => update({ lines: +e.target.value })}
                />
              </Field>
            )}
            {optical && (
              <Field label="Ray length" value={`${length.toFixed(1)}×`}>
                <input
                  type="range"
                  min=".1"
                  max="3"
                  step=".1"
                  value={length}
                  onChange={(e) => setLength(+e.target.value)}
                />
              </Field>
            )}
            <div className="layer-grid">
              {(Object.keys(layers) as (keyof Layers)[])
                .filter((k) => optical || !["incident", "virtual"].includes(k))
                .map((k) => (
                  <label className="check" key={k}>
                    <input
                      type="checkbox"
                      checked={layers[k]}
                      onChange={(e) =>
                        setLayers({ ...layers, [k]: e.target.checked })
                      }
                    />
                    {
                      {
                        base: "Base curve",
                        derived: "Derived curve",
                        lines: "Construction lines",
                        incident: "Incident rays",
                        virtual: "Virtual extensions",
                        axes: "Grid & axes",
                      }[k]
                    }
                  </label>
                ))}
            </div>
            {expert ? (
              number(
                "Numerical samples",
                config.samples,
                (n) => update({ samples: n }),
                { step: 1, min: 64, max: 32768, help: samplesHelp },
              )
            ) : (
              <Field label="Numerical samples" help={samplesHelp}>
                <select
                  value={config.samples}
                  onChange={(e) => update({ samples: +e.target.value })}
                >
                  {![500, 1000, 2000, 4000].includes(config.samples) && (
                    <option value={config.samples}>
                      {config.samples} · custom
                    </option>
                  )}
                  <option value="500">500 · quick study</option>
                  <option value="1000">1,000 · standard</option>
                  <option value="2000">2,000 · fine</option>
                  <option value="4000">4,000 · finest</option>
                </select>
              </Field>
            )}
          </section>
          <AnimationPanel
            getCurrentView={() => manualView.current}
            dark={dark}
            layers={layers}
            frame={frame}
            client={client}
            length={length}
            revision={JSON.stringify([config, bounds, length])}
            disabled={busy || !!error}
            onView={setAnimation}
            onRunning={setAnimationRunning}
            onPlay={revealPlot}
          />
        </aside>
        <article>
          <div className="plot-heading">
            <div>
              <div className="eyebrow">
                {preset === "custom"
                  ? "YOUR OWN EXPLORATION"
                  : presets[+preset].note}
              </div>
              <h1>{info.title}</h1>
            </div>
            <button
              className="fit"
              disabled={!!animation}
              onClick={() => setReset(reset + 1)}
            >
              ↔ Fit view
            </button>
          </div>
          <div className="plot-wrap" ref={plotWrap} aria-busy={busy}>
            {error ? (
              <div className="error" role="alert">
                <strong>Let’s check the definition</strong>
                <p>{error}</p>
              </div>
            ) : result && shown ? (
              <Plot
                onViewport={(view) => {
                  manualView.current = view;
                }}
                result={result}
                config={shown.config}
                layers={layers}
                dark={dark}
                length={animation?.length ?? length}
                reset={reset}
                animation={animation}
              />
            ) : (
              <div className="loading">Preparing the numerical engine…</div>
            )}
            {busy && result && <span className="computing">Computing…</span>}
            <div className="plot-meta">
              <div className="legend">
                <span className="base-dot" />
                Base curve <span className="derived-dot" /> {config.kind}
              </div>
              <span>
                {animation
                  ? "Animation camera · Stop or Reset view restores manual framing"
                  : "Drag to pan · scroll to zoom"}
              </span>
            </div>
          </div>
          {!narrow && behind}
        </article>
        {narrow && <div className="behind">{behind}</div>}
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
