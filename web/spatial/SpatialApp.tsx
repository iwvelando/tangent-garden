import { StudyExplanation } from "../StudyExplanation";
import { useEffect, useMemo, useRef, useState } from "react";
import { EngineClient } from "../engine-client";
import { ScalarInput, ScalarStatus, type ScalarState } from "../ScalarInput";
import { useMediaQuery } from "../useMediaQuery";
import { useTheme } from "../useTheme";
import { useDisclosure } from "../useDisclosure";
import { Field } from "../Field";
import { AppHeader } from "../AppHeader";
import { revealDrawing } from "../revealDrawing";
import { ExportImageMenu } from "../ExportImageMenu";
import { saveFile } from "../export-image";
import { SpatialPlot } from "./SpatialPlot";
import { SpatialAnimationPanel } from "./SpatialAnimationPanel";
import { spatialPresets } from "./presets";
import { ExampleGallery } from "../ExampleGallery";
import { spatialExamples, spatialThumbnail } from "../examples";
import { animationCamera, type AnimationView } from "./animation";
import type { SpatialConfig, Frame } from "./types";
import type { Layers, View } from "./renderer";
import "./spatial.css";
export default function SpatialApp({ active = true }: { active?: boolean }) {
  const theme = useTheme(),
    narrow = useMediaQuery("(max-width: 700px)"),
    expressions = useDisclosure("expressions");
  const client = useRef<EngineClient | null>(null),
    generation = useRef(0),
    jobs = useRef(new Set<Promise<void>>());
  const [config, setConfig] = useState<SpatialConfig>(spatialPresets[0].config);
  const [customOpened, setCustomOpened] = useState(false);
  const [preset, setPreset] = useState("0"),
    [states, setStates] = useState<Record<string, ScalarState>>({});
  const [frame, setFrame] = useState<Frame | null>(null),
    [settled, setSettled] = useState("");
  const [error, setError] = useState(""),
    [renderError, setRenderError] = useState(""),
    [imageBusy, setImageBusy] = useState(false);
  const [reset, setReset] = useState(0),
    [spinning, setSpinning] = useState(false);
  const [animation, setAnimation] = useState<AnimationView | null>(null),
    [running, setRunning] = useState(false);
  const [layers, setLayers] = useState<Layers>({
    surface: true,
    rulings: true,
    edges: true,
  });
  const viewport = useRef<View | undefined>(undefined),
    plotWrap = useRef<HTMLDivElement>(null),
    imageAbort = useRef<AbortController | null>(null);
  const pending = Object.values(states).some((s) => s.pending),
    scalarError = Object.values(states).find((s) => s.error);
  const key = JSON.stringify(config),
    busy = settled !== key || pending;
  const revision = JSON.stringify([key, states, active]);
  useEffect(() => {
    client.current = new EngineClient();
    return () => {
      generation.current++;
      client.current?.dispose();
      client.current = null;
      imageAbort.current?.abort();
    };
  }, []);
  useEffect(() => {
    let current = true;
    setError("");
    if (pending || scalarError) {
      setSettled(key);
      return;
    }
    const timer = setTimeout(() => {
      client
        .current!.computeSpatial(config)
        .then((value) => {
          if (current) {
            setFrame(value);
            setSettled(key);
          }
        })
        .catch((e: Error) => {
          if (current) {
            setError(e.message);
            setSettled(key);
          }
        });
    }, 140);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [key, pending, scalarError]);
  useEffect(() => {
    imageAbort.current?.abort();
    setImageBusy(false);
    setSpinning(false);
  }, [revision]);
  const scalarStatus = useMemo(
    () => ({
      client,
      generation,
      track: (job: Promise<void>) => {
        jobs.current.add(job);
        void job.finally(() => jobs.current.delete(job));
      },
      report: (id: string, state: ScalarState | null) =>
        setStates((old) => {
          if (!state && !(id in old)) return old;
          const next = { ...old };
          if (state) next[id] = state;
          else delete next[id];
          return next;
        }),
    }),
    [],
  );
  const update = (change: (c: SpatialConfig) => SpatialConfig) => {
    setPreset("");
    setConfig(change);
  };
  const choose = (index: string) => {
    if (index === "") return;
    generation.current++;
    setStates({});
    setPreset(index);
    setCustomOpened(spatialPresets[+index].config.format === "parametric");
    setConfig(structuredClone(spatialPresets[+index].config));
    setReset((n) => n + 1);
  };
  async function definition(format: SpatialConfig["format"]) {
    const token = generation.current;
    await Promise.allSettled([...jobs.current]);
    if (token !== generation.current) return;
    setConfig((c) => {
      if (format === "torus") return { ...c, format };
      // Preserve an edited custom definition. A generated knot can also be opened
      // as expressions, with every pending scalar resolved before conversion.
      if (c.format === "parametric" || customOpened) return { ...c, format };
      const h = `(${c.radius}+${c.tube}*cos(${c.q}*t))`;
      return {
        ...c,
        format,
        curve: {
          ...c.curve,
          x: `${h}*cos(${c.p}*t)`,
          y: `${h}*sin(${c.p}*t)`,
          z: `${c.tube}*sin(${c.q}*t)`,
          min: 0,
          max: 2 * Math.PI,
        },
      };
    });
    if (format === "parametric") setCustomOpened(true);
    setPreset("");
  }
  const failure = scalarError
    ? `${scalarError.name}: ${scalarError.error}`
    : error;
  const shown = animation?.frame ?? frame,
    override = animation ? animationCamera(animation) : undefined;
  const ready = !!frame && !busy && !failure && !renderError;
  async function save(format: "png" | "svg") {
    if (!shown || !viewport.current) return;
    imageAbort.current?.abort();
    const controller = new AbortController();
    imageAbort.current = controller;
    setImageBusy(true);
    const snapshot = structuredClone({
      frame: shown,
      view: viewport.current,
      layers,
      dark: theme.dark,
    });
    try {
      const { imageFile } = await import("./export");
      controller.signal.throwIfAborted();
      const blob = await imageFile(
        snapshot.frame,
        snapshot.view,
        snapshot.layers,
        snapshot.dark,
        format,
        controller.signal,
      );
      controller.signal.throwIfAborted();
      saveFile(blob, `tangent-garden-spatial.${format}`);
    } catch (e) {
      if (!controller.signal.aborted) throw e;
    } finally {
      if (imageAbort.current === controller) {
        imageAbort.current = null;
        setImageBusy(false);
      }
    }
  }
  const showPlot = () => {
    setSpinning(false);
    revealDrawing(
      plotWrap.current,
      document.getElementById("spatial-playback"),
    );
  };
  // On phones the controls follow the drawing directly, so the explanation
  // moves after them instead of separating the two.
  const behind = (
    <StudyExplanation
      label="BEHIND THE FOLDS"
      title="Straight lines, woven into space."
      formula={
        <>
          S(t, u) = r(t) + u T(t) <span>−L ≤ u ≤ L</span>
        </>
      }
      note="The curve and its tangent lines define the ribbon surface."
      diagnostics={
        shown &&
        (shown.result.omitted > 0 || shown.result.invalid > 0) && (
          <p className="bottom-note">
            {shown.result.invalid} invalid samples · {shown.result.omitted}{" "}
            intervals without a stable ribbon surface. The curve and tangents
            remain visible where defined.
          </p>
        )
      }
    >
      <p>
        At every regular point of the curve, extend a straight line in the
        tangent direction. Together those lines sweep a{" "}
        <em>tangent developable</em>. The gold thread marks the original curve;
        the two sheets meet there in a sharp fold, except where the curve
        momentarily stops twisting.
      </p>
    </StudyExplanation>
  );
  return (
    <div
      className={`app spatial-app${theme.dark ? " dark" : ""}`}
      data-theme-preference={theme.preference}
    >
      <AppHeader theme={theme}>
        <ExportImageMenu
          disabled={!ready || running || imageBusy}
          kind="spatial"
          menuId="spatial-export-image-menu"
          svgLabel="SVG · embedded 3D image"
          onSave={save}
        />
      </AppHeader>
      <main>
        <aside
          className="spatial-controls"
          aria-label="Spatial study parameters"
        >
          <div className="section-label">01 / THE STUDY</div>
          <ExampleGallery
            examples={spatialExamples}
            current={preset === "" ? null : +preset}
            onChoose={(i) => choose(String(i))}
            thumbnail={spatialThumbnail}
            dark={theme.dark}
          />
          <ScalarStatus.Provider value={scalarStatus}>
            <div key={generation.current}>
              <Field label="Spatial definition">
                <select
                  value={config.format}
                  onChange={(e) =>
                    void definition(e.target.value as SpatialConfig["format"])
                  }
                >
                  <option value="torus">Torus knot generator</option>
                  <option value="parametric">
                    Parametric · x(t), y(t), z(t)
                  </option>
                </select>
              </Field>
              {config.format === "torus" ? (
                <>
                  {(
                    [
                      ["radius", "Major radius R"],
                      ["tube", "Minor radius r"],
                    ] as const
                  ).map(([key, label]) => (
                    <Field
                      key={key}
                      label={label}
                      help={
                        key === "radius"
                          ? "Distance from the torus center to the tube center. From 0.1 to 20."
                          : "Tube radius, at least 0.01 and smaller than R."
                      }
                    >
                      <ScalarInput
                        name={label}
                        value={config[key]}
                        onChange={(value) =>
                          update((c) => ({ ...c, [key]: value }))
                        }
                      />
                    </Field>
                  ))}
                  <Field label="Knot winding">
                    <select
                      value={`${config.p},${config.q}`}
                      onChange={(e) => {
                        const [p, q] = e.target.value.split(",").map(Number);
                        update((c) => ({ ...c, p, q }));
                      }}
                    >
                      {[
                        [2, 3],
                        [2, 5],
                        [3, 4],
                        [3, 5],
                        [4, 5],
                        [5, 7],
                      ].map(([p, q]) => (
                        <option key={`${p},${q}`} value={`${p},${q}`}>
                          {p} around · {q} through
                        </option>
                      ))}
                    </select>
                  </Field>
                </>
              ) : (
                <>
                  {(["x", "y", "z"] as const).map((axis) => (
                    <Field label={`${axis}(t)`} key={axis}>
                      <input
                        value={config.curve[axis]}
                        spellCheck={false}
                        onChange={(e) =>
                          update((c) => ({
                            ...c,
                            curve: { ...c.curve, [axis]: e.target.value },
                          }))
                        }
                      />
                    </Field>
                  ))}
                  <div className="pair">
                    {(
                      [
                        ["min", "t from"],
                        ["max", "to"],
                      ] as const
                    ).map(([key, label]) => (
                      <Field label={label} key={key}>
                        <ScalarInput
                          name={label}
                          value={config.curve[key]}
                          onChange={(value) =>
                            update((c) => ({
                              ...c,
                              curve: { ...c.curve, [key]: value },
                            }))
                          }
                        />
                      </Field>
                    ))}
                  </div>
                  <Field
                    label="Shape parameter a"
                    help="Use a in any coordinate expression, then animate it with a parameter track."
                  >
                    <ScalarInput
                      name="Shape parameter a"
                      value={config.curve.a}
                      onChange={(value) =>
                        update((c) => ({
                          ...c,
                          curve: { ...c.curve, a: value },
                        }))
                      }
                    />
                  </Field>
                  <details {...expressions} className="spatial-details">
                    <summary>Expression reference</summary>
                    <p>
                      Use t, a, pi, e, phi; + − * / ^; sin, cos, tan, asin,
                      acos, atan, sinh, cosh, tanh, sech, exp, log, ln, sqrt,
                      abs. Trigonometry uses radians. Write multiplication
                      explicitly, such as 2*cos(t). Constants only in numeric
                      controls.
                    </p>
                  </details>
                </>
              )}
              <Field
                label="Tangent reach L"
                help="Half-length of each straight tangent segment, in world units. Greater than 0 and at most 20."
              >
                <ScalarInput
                  name="Tangent reach L"
                  value={config.length}
                  onChange={(value) => update((c) => ({ ...c, length: value }))}
                />
              </Field>
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
            <Field label="Curve samples">
              <input
                type="number"
                min="240"
                max="2400"
                step="1"
                value={Number.isNaN(config.samples) ? "" : config.samples}
                onChange={(e) =>
                  update((c) => ({ ...c, samples: e.target.valueAsNumber }))
                }
              />
            </Field>
            <Field label="Tangent lines">
              <input
                type="number"
                min="12"
                max="240"
                step="1"
                value={Number.isNaN(config.lines) ? "" : config.lines}
                onChange={(e) =>
                  update((c) => ({ ...c, lines: e.target.valueAsNumber }))
                }
              />
            </Field>
            <p>
              Finite sampling can miss fine detail. Compare resolutions near
              poles, stationary points, and tight folds. Invalid samples and
              unresolved tangent or normal intervals leave gaps.
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
          <SpatialAnimationPanel
            frame={frame}
            client={client}
            length={config.length}
            revision={revision}
            disabled={!ready || !active || imageBusy}
            dark={theme.dark}
            layers={layers}
            getCurrentView={() =>
              viewport.current ? structuredClone(viewport.current) : undefined
            }
            onView={setAnimation}
            onRunning={setRunning}
            onPlay={showPlot}
          />
        </aside>
        <article
          className="spatial-stage"
          aria-label="Spatial artwork"
          aria-busy={busy}
          data-config={shown ? JSON.stringify(shown.config) : undefined}
          data-progress={animation?.progress}
          data-mode={animation?.mode}
          data-camera={override ? JSON.stringify(override) : undefined}
        >
          <div className="plot-heading">
            <div>
              <div className="eyebrow">
                {preset !== ""
                  ? spatialPresets[+preset].detail
                  : "YOUR OWN EXPLORATION"}
              </div>
              <h1>A ribbon of tangent lines</h1>
            </div>
            <div className="view-buttons">
              <button
                className="fit"
                disabled={!!animation || running || !!renderError}
                aria-pressed={spinning}
                onClick={() => setSpinning((s) => !s)}
              >
                {spinning ? "Pause rotation" : "Rotate view"}
              </button>
              <button
                className="fit"
                disabled={!!animation || running}
                onClick={() => setReset((n) => n + 1)}
              >
                Reset view
              </button>
            </div>
          </div>
          <div className="plot-wrap" ref={plotWrap}>
            <div className="spatial-canvas-wrap">
              {shown ? (
                <SpatialPlot
                  result={shown.result}
                  dark={theme.dark}
                  layers={layers}
                  reset={reset}
                  spinning={spinning && active}
                  override={override}
                  onViewport={(v) => {
                    viewport.current = v;
                  }}
                  onError={setRenderError}
                />
              ) : (
                <div className="loading">
                  {failure
                    ? "Check the study definition to begin."
                    : "Preparing the spatial engine…"}
                </div>
              )}
              {frame && failure && (
                <span className="spatial-stale">Previous valid study</span>
              )}
            </div>
            <div className="plot-meta">
              <div className="legend">
                <span className="thread-dot" /> Base curve{" "}
                <span className="ribbon-dot" /> Tangent developable
              </div>
              <span>
                {animation
                  ? "Animation camera · Stop or Reset view restores manual framing"
                  : "Orthographic · drag to orbit · shift-drag to pan · scroll to zoom · keys: arrows, + / −, Home"}
              </span>
            </div>
          </div>
          {!narrow && behind}
        </article>
        {narrow && <div className="behind spatial-explanation">{behind}</div>}
      </main>
    </div>
  );
}
