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
import { usesSpatialPole, type SpatialConfig, type Frame } from "./types";
import { defaultLayers, type Layers, type View } from "./renderer";
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
  const [layers, setLayers] = useState<Layers>(defaultLayers);
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
  const involute = config.construction === "involute";
  const projection = usesSpatialPole(config);
  const orthotomic = config.construction === "orthotomic";
  const projectionName = orthotomic
    ? "Tangent-line orthotomic"
    : "Tangent-foot curve";
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
  const unreached = shown?.result.involute?.unreached ?? 0;
  const behind = projection ? (
    <StudyExplanation
      label="BEHIND THE PERPENDICULARS"
      title={
        orthotomic
          ? "Half a turn around every tangent."
          : "One pole, a moving perpendicular."
      }
      formula={
        <>
          {orthotomic
            ? "Q(t) = 2H(t) − P"
            : "H(t) = r(t) + ((P − r(t)) · T(t)) T(t)"}
          <span>
            {orthotomic
              ? "H is the tangent foot of P"
              : "T is the unit tangent"}
          </span>
        </>
      }
      note="The small crosses mark tangent feet H; the larger cross marks the fixed pole P."
      diagnostics={
        shown &&
        (shown.result.invalid > 0 ||
          (shown.result.projection?.invalid ?? 0) > 0 ||
          shown.result.projection?.collapsed) && (
          <p className="bottom-note">
            {shown.result.invalid} invalid base samples ·{" "}
            {shown.result.projection?.invalid ?? 0} invalid image samples.
            Undefined tangents and unresolved intervals leave gaps.
            {shown.result.projection?.collapsed &&
              " The image collapses to a point, shown as a cross."}
          </p>
        )
      }
    >
      <p>
        Drop a perpendicular from the pole P onto the tangent line at each point
        of the curve. Its foot H traces the <em>tangent-foot curve</em>. Extend
        P–H by the same distance beyond H to get the{" "}
        <em>tangent-line orthotomic</em>: a half-turn of P around the tangent.
        The segments from the base to H show that H lies on the tangent. In
        space a tangent has a whole normal plane; no particular normal direction
        is chosen.
      </p>
    </StudyExplanation>
  ) : involute ? (
    <StudyExplanation
      label="BEHIND THE FILAMENTS"
      title="A taut string, unwound in space."
      formula={
        <>
          I(t) = r(t) + (c − s(t)) T(t){" "}
          <span>s(t) = ∫ from t₀ to t of |r′|</span>
        </>
      }
      note="Each filament is traced by the free end of a string held taut along the tangent."
      diagnostics={
        shown &&
        (shown.result.invalid > 0 || unreached > 0) && (
          <p className="bottom-note">
            {shown.result.invalid} invalid samples · {unreached} regular samples
            beyond a gap from the anchor. Arc length is never carried across a
            gap, so no filament is drawn there.
          </p>
        )
      }
    >
      <p>
        Wrap a string along the curve, starting with length c at the anchor t₀,
        and unwind it while keeping it taut along the tangent. Its free end
        traces an <em>involute</em>. Where the string runs out, at s = c, the
        filament touches the curve in a cusp. Every filament crosses the tangent
        strings at right angles; changing c gives a family of them.
      </p>
    </StudyExplanation>
  ) : (
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
              <Field label="Construction">
                <select
                  value={config.construction}
                  onChange={(e) => {
                    const construction = e.target
                      .value as SpatialConfig["construction"];
                    update((c) => ({ ...c, construction }));
                  }}
                >
                  <option value="developable">Tangent developable</option>
                  <option value="involute">Involute · unwinding strings</option>
                  <option value="tangent-foot">Tangent-foot projection</option>
                  <option value="orthotomic">Tangent-line orthotomic</option>
                </select>
              </Field>
              {projection ? (
                <>
                  <div className="pair">
                    {(["x", "y"] as const).map((axis) => (
                      <Field
                        key={axis}
                        label={`Pole ${axis}`}
                        help={`Independent pole coordinate ${axis}, within ±100000. The pole is a geometric point, not a light source.`}
                      >
                        <ScalarInput
                          name={`Pole ${axis}`}
                          value={config.pole[axis]}
                          onChange={(value) =>
                            update((c) => ({
                              ...c,
                              pole: { ...c.pole, [axis]: value },
                            }))
                          }
                        />
                      </Field>
                    ))}
                  </div>
                  <Field
                    label="Pole z"
                    help="Height of the independent pole, within ±100000. All three coordinates accept constant expressions."
                  >
                    <ScalarInput
                      name="Pole z"
                      value={config.pole.z}
                      onChange={(value) =>
                        update((c) => ({ ...c, pole: { ...c.pole, z: value } }))
                      }
                    />
                  </Field>
                </>
              ) : involute ? (
                <>
                  <Field
                    label="Anchor t₀"
                    help="Where arc length s starts, as a parameter value inside the domain. The string there has length c."
                  >
                    <ScalarInput
                      name="Anchor t₀"
                      value={config.involute.anchor}
                      onChange={(value) =>
                        update((c) => ({
                          ...c,
                          involute: { ...c.involute, anchor: value },
                        }))
                      }
                    />
                  </Field>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={config.involute.family.enabled}
                      onChange={(e) => {
                        const enabled = e.target.checked;
                        update((c) => ({
                          ...c,
                          involute: {
                            ...c.involute,
                            family: { ...c.involute.family, enabled },
                          },
                        }));
                      }}
                    />
                    Family of involutes
                  </label>
                  {config.involute.family.enabled ? (
                    <>
                      <div className="pair">
                        {(
                          [
                            ["from", "c from"],
                            ["to", "c to"],
                          ] as const
                        ).map(([key, label]) => (
                          <Field
                            label={label}
                            key={key}
                            help={
                              key === "from"
                                ? "String length of the first filament, within ±100000."
                                : "String length of the last; members are evenly spaced."
                            }
                          >
                            <ScalarInput
                              name={label}
                              value={config.involute.family[key]}
                              onChange={(value) =>
                                update((c) => ({
                                  ...c,
                                  involute: {
                                    ...c.involute,
                                    family: {
                                      ...c.involute.family,
                                      [key]: value,
                                    },
                                  },
                                }))
                              }
                            />
                          </Field>
                        ))}
                      </div>
                      <Field
                        label="Involutes"
                        help="From 2 to 24 filaments, and at most 48,000 points in all (involutes × samples)."
                      >
                        <input
                          type="number"
                          min="2"
                          max="24"
                          step="1"
                          value={
                            Number.isNaN(config.involute.family.count)
                              ? ""
                              : config.involute.family.count
                          }
                          onChange={(e) => {
                            const count = e.target.valueAsNumber;
                            update((c) => ({
                              ...c,
                              involute: {
                                ...c.involute,
                                family: { ...c.involute.family, count },
                              },
                            }));
                          }}
                        />
                      </Field>
                    </>
                  ) : (
                    <Field
                      label="String length c"
                      help="Signed length of the string at the anchor, within ±100000. The filament touches the curve where s = c."
                    >
                      <ScalarInput
                        name="String length c"
                        value={config.involute.offset}
                        onChange={(value) =>
                          update((c) => ({
                            ...c,
                            involute: { ...c.involute, offset: value },
                          }))
                        }
                      />
                    </Field>
                  )}
                </>
              ) : (
                <Field
                  label="Tangent reach L"
                  help="Half-length of each straight tangent segment, in world units. Greater than 0 and at most 20."
                >
                  <ScalarInput
                    name="Tangent reach L"
                    value={config.length}
                    onChange={(value) =>
                      update((c) => ({ ...c, length: value }))
                    }
                  />
                </Field>
              )}
            </div>
          </ScalarStatus.Provider>
          <p className="spatial-caption">
            Constant expressions welcome: pi, e, phi.
          </p>
          <fieldset className="spatial-layers">
            <legend>Reveal the construction</legend>
            {(projection
              ? ([
                  ["projection", projectionName],
                  ["connectors", "Perpendiculars & tangent feet"],
                  ["pole", "Pole marker"],
                ] as const)
              : involute
                ? ([
                    ["filaments", "Involute filaments"],
                    ["strings", "Unwinding strings"],
                  ] as const)
                : ([
                    ["surface", "Ribbon surface"],
                    ["rulings", "Tangent rulings"],
                    ["edges", "Ribbon edges"],
                  ] as const)
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
            <Field
              label={
                projection
                  ? "Projection constructions"
                  : involute
                    ? "Unwinding strings"
                    : "Tangent lines"
              }
            >
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
              unresolved tangent or normal intervals leave gaps. Involute arc
              length uses Simpson's rule on each sample interval.
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
                : `${config.samples.toLocaleString()} samples · ${config.lines} ${projection ? "projections" : involute ? "strings" : "tangents"}`}
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
              <h1>
                {projection
                  ? projectionName
                  : involute
                    ? "Filaments unwound from a curve"
                    : "A ribbon of tangent lines"}
              </h1>
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
                <span className="ribbon-dot" />{" "}
                {projection
                  ? projectionName
                  : involute
                    ? "Involute filaments"
                    : "Tangent developable"}
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
