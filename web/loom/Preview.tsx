import { AppHeader } from "../AppHeader";
import { AnimationButton } from "../AnimationButton";
import { ExportImageMenu } from "../ExportImageMenu";
import { MotionExportSettings, useMotionExport } from "../MotionExportSettings";
import { useDisclosure } from "../useDisclosure";
import { revealDrawing } from "../revealDrawing";
import type { Still } from "../export-image";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { EngineClient, EngineError } from "../engine-client";
import { Field, FieldErrorContext } from "../Field";
import { ScalarInput, ScalarStatus, type ScalarState } from "../ScalarInput";
import { ShareLink } from "../ShareLink";
import { useTheme } from "../useTheme";
import { useQuietFocus } from "../quiet-focus";
import { describeColors } from "../color-schemes";
import { LineWeightField } from "../LineWeightField";
import { tiered, withMore } from "../help";
import { svgWeightHelp } from "../line-weight";
import { play } from "../playback";
import {
  defaultLoom,
  replaceSource,
  loomRequest,
  traversal,
  memberInterval,
  sourceChoices,
  supportedSource,
  type LoomStudy,
  type LoomResult,
  type LoomMarker,
  type LoomSource,
} from "./model";
import type { LoomEntry } from "./Context";
import { LoomSession } from "./session";
import { PaneDrawing, loomFit, type DrawingProps, type Pane } from "./Drawing";
import { loomStill, loomMovie } from "./export";
import "./loom.css";
const labels: Record<string, string> = {
  "source.count": "Circle count",
  "source.xCount": "Vertical lines",
  "source.yCount": "Horizontal lines",
  "source.radius": "Circle radius",
  "source.xMin": "Grid x start",
  "source.xMax": "Grid x end",
  "source.yMin": "Grid y start",
  "source.yMax": "Grid y end",
  samples: "Samples per member",
  tolerance: "Refinement tolerance",
  selected: "Selected member",
  parameter: "Source parameter",
};
// Phones, upright or sideways, open with source settings folded so the
// artwork follows the family picker closely.
const phoneLayout =
  "(max-width: 700px), (orientation: landscape) and (max-height: 500px)";
// Gaps by reason, in the engine's terms: undefined (invalid), still beyond
// tolerance at the depth limit (unresolved), or out of budget (exhausted).
function gapSummary(result: LoomResult) {
  const count = { invalid: 0, unresolved: 0, exhausted: 0 };
  for (const m of result.members)
    for (const g of m.intervals)
      if (g.reason in count) count[g.reason as keyof typeof count]++;
  const parts = [
    count.invalid && `${count.invalid.toLocaleString()} undefined`,
    count.unresolved && `${count.unresolved.toLocaleString()} unresolved`,
    count.exhausted && `${count.exhausted.toLocaleString()} out of budget`,
  ].filter(Boolean);
  return `${result.exhausted ? "Refinement ran out of budget. " : ""}${parts.length ? `Gaps: ${parts.join(", ")}.` : "No gaps."}`;
}
export function LoomPreview({
  entry,
  onReturn,
}: {
  entry: LoomEntry;
  onReturn: (via: "keyboard" | "pointer") => void;
}) {
  const theme = useTheme(),
    dialog = useRef<HTMLDialogElement>(null),
    back = useRef<HTMLButtonElement>(null),
    quiet = useQuietFocus(dialog);
  const [study, setStudy] = useState<LoomStudy>(() =>
    structuredClone(entry.study.loom ?? defaultLoom(entry.study.config)),
  );
  const [sourceSettings, setSourceSettings] = useState(
    () => !matchMedia(phoneLayout).matches,
  );
  const [weight, setWeight] = useState(entry.study.weight);
  const [result, setResult] = useState<LoomResult>();
  const [resultKey, setResultKey] = useState("");
  const [placed, setPlaced] = useState<{ key: string; marker: LoomMarker }>();
  const [error, setError] = useState<{ message: string; field?: string }>({
    message: "",
  });
  const [scalars, setScalars] = useState<Record<string, ScalarState>>({});
  const scalarClient = useRef<EngineClient | null>(null),
    generation = useRef(0),
    jobs = useRef(new Set<Promise<void>>());
  const session = useRef<LoomSession | null>(null);
  const [playing, setPlaying] = useState(false),
    [exporting, setExporting] = useState(false),
    [exportProgress, setExportProgress] = useState(0);
  const stop = useRef<() => void>(() => {}),
    exportGeneration = useRef(0);
  const exportState = useMotionExport("columns");
  const exportSection = useDisclosure("loom-export");
  const panes = useRef<HTMLDivElement>(null),
    playback = useRef<HTMLDivElement>(null);
  const exportAbort = useRef<AbortController | null>(null);
  const key = JSON.stringify([study.source, study.samples, study.tolerance]);
  const markerKey = JSON.stringify([key, study.selected, study.parameter]);
  const sourceError =
    study.source.kind === "curve" && !supportedSource(study.source)
      ? "This source is unsupported. Choose a direct parametric, Cartesian, polar, roulette, Lissajous or Fourier curve."
      : "";
  const durationError =
    !Number.isFinite(study.duration) ||
    study.duration < 0.1 ||
    study.duration > 3600
      ? "Traversal duration must be 0.1–3,600 seconds."
      : "";
  const ready =
    !sourceError &&
    !durationError &&
    resultKey === key &&
    placed?.key === markerKey &&
    !!result &&
    !error.message &&
    !Object.values(scalars).some((s) => s.pending || s.error);
  const scalarStatus = useMemo(
    () => ({
      client: scalarClient,
      generation,
      track: (job: Promise<void>) => {
        jobs.current.add(job);
        void job.finally(() => jobs.current.delete(job));
      },
      report: (id: string, state: ScalarState | null) =>
        setScalars((s) => {
          const next = { ...s };
          if (state) next[id] = state;
          else delete next[id];
          return next;
        }),
    }),
    [],
  );
  const fail = (e: Error) => {
    setError({
      message: e.message,
      field: e instanceof EngineError ? e.field : undefined,
    });
    setPlaying(false);
  };
  useEffect(() => {
    session.current = new LoomSession(() => new EngineClient());
    scalarClient.current = new EngineClient();
    return () => {
      stop.current();
      exportGeneration.current++;
      exportAbort.current?.abort();
      session.current?.cancel();
      scalarClient.current?.dispose();
      generation.current++;
    };
  }, []);
  useLayoutEffect(() => {
    if (entry.via === "pointer") quiet.onPointerDown();
    dialog.current!.showModal();
    quiet.quiet();
    back.current!.focus();
    document.documentElement.classList.add("loom-open");
    return () => document.documentElement.classList.remove("loom-open");
  }, []);
  useEffect(() => {
    stop.current();
    setPlaying(false);
    setError({ message: "" });
    session.current!.update(
      loomRequest(study),
      false,
      (r: LoomResult) => {
        // This bound covers restored geometry; the worker transfers its buffer.
        if (r.numericEntries > 2000000) {
          fail(new Error("The loom exceeded its retained geometry budget."));
          return;
        }
        setStudy((s) =>
          s.framing
            ? s
            : {
                ...s,
                framing: {
                  source: loomFit(r, "source"),
                  image: loomFit(r, "image"),
                },
              },
        );
        setResult(r);
        setResultKey(key);
        setPlaced({ key: markerKey, marker: r.marker });
      },
      fail,
    );
  }, [key]);
  useEffect(() => {
    if (resultKey !== key || !result) return;
    if (placed?.key === markerKey) return;
    setError({ message: "" });
    session.current!.update(
      loomRequest(study),
      true,
      (r: { marker: LoomMarker }) =>
        setPlaced({ key: markerKey, marker: r.marker }),
      fail,
    );
  }, [markerKey, resultKey]);
  const pause = () => {
    stop.current();
    if (playing) {
      session.current?.cancel();
      session.current = new LoomSession(() => new EngineClient());
      if (placed)
        setStudy((s) => ({ ...s, parameter: placed.marker.parameter }));
    }
    setPlaying(false);
  };
  const setSource = (change: (s: LoomSource) => LoomSource) => {
    pause();
    setStudy((s) => {
      const source = change(s.source);
      const selected = 0;
      return {
        ...s,
        framing: source.kind === s.source.kind ? s.framing : undefined,
        source,
        selected,
        parameter: memberInterval(source, selected)[0],
      };
    });
  };
  const select = (id: number) => {
    pause();
    setStudy((s) => {
      const [lo, hi] = memberInterval(s.source, id);
      return {
        ...s,
        selected: id,
        parameter: Math.max(lo, Math.min(hi, s.parameter)),
      };
    });
  };
  const changeParameter = (parameter: number) => {
    pause();
    setStudy((s) => ({ ...s, parameter }));
  };
  const marker = placed?.marker;
  const progress = (() => {
    const [lo, hi] = memberInterval(study.source, study.selected);
    return (study.parameter - lo) / (hi - lo);
  })();
  const start = () => {
    if (!ready) return;
    const frozen = structuredClone(study);
    revealDrawing(panes.current, playback.current);
    setPlaying(true);
    stop.current = play<LoomMarker>({
      from: progress >= 1 ? 0 : progress,
      duration: frozen.duration * 1000,
      lanes: [(p) => session.current!.point(traversal(frozen, p))],
      show: (marker) => {
        setStudy((s) => ({ ...s, parameter: marker.parameter }));
        setPlaced({
          key: JSON.stringify([key, frozen.selected, marker.parameter]),
          marker,
        });
      },
      end: () => setPlaying(false),
      fail: (e) => fail(e as Error),
    });
  };
  const props = (pane: Pane): DrawingProps => ({
    result: result!,
    marker: marker!,
    pane,
    selected: marker!.member,
    camera: study.views[pane],
    framing: study.framing?.[pane],
    dark: theme.dark,
    scheme: theme.scheme,
    weight,
    onCamera: (c) =>
      setStudy((s) => ({ ...s, views: { ...s.views, [pane]: c } })),
    onSelect: select,
  });
  const metadata = () => ({
    kind: "complex-loom",
    map: "square",
    formula: "w = z²",
    pace: "uniform source parameter",
    layout: "source left; image right",
    source: study.source,
    samples: study.samples,
    tolerance: study.tolerance,
    selected: study.selected,
    parameter: study.parameter,
    views: study.views,
    framing: study.framing,
    duration: study.duration,
    theme: theme.dark ? "dark" : "light",
    scheme: theme.scheme,
    weight,
  });
  async function still(kind: string, settings: Still) {
    if (!ready) return;
    pause();
    const id = ++exportGeneration.current;
    try {
      await loomStill(
        kind as "svg" | "png",
        props("source"),
        props("image"),
        metadata(),
        () => id === exportGeneration.current,
        settings,
      );
    } catch (e) {
      if (id === exportGeneration.current) fail(e as Error);
    }
  }
  function cancelExport() {
    exportGeneration.current++;
    exportAbort.current?.abort();
    session.current?.cancel();
    session.current = new LoomSession(() => new EngineClient());
    setExporting(false);
  }
  async function movie() {
    if (!ready) return;
    pause();
    setExporting(true);
    setExportProgress(0);
    const id = ++exportGeneration.current;
    const controller = new AbortController();
    exportAbort.current = controller;
    try {
      await loomMovie({
        study: structuredClone(study),
        source: props("source"),
        image: props("image"),
        metadata: metadata(),
        options: {
          format: exportState.chosen,
          fps: exportState.fps,
          settings: {
            scale: exportState.scale,
            quality: exportState.quality,
            layout: "columns",
          },
          loop: exportState.loop,
        },
        signal: controller.signal,
        current: () => id === exportGeneration.current,
        marker: (q) => session.current!.point(q),
        progress: setExportProgress,
      });
    } catch (e) {
      if (id === exportGeneration.current) fail(e as Error);
    } finally {
      if (id === exportGeneration.current) setExporting(false);
    }
  }
  useEffect(() => {
    if (exporting) cancelExport();
    else exportGeneration.current++;
  }, [
    key,
    markerKey,
    weight,
    study.views,
    study.framing,
    theme.dark,
    theme.scheme,
  ]);
  const scalarError = Object.values(scalars).find((s) => s.error);
  const message = scalarError
    ? `${scalarError.name}: ${scalarError.error}`
    : sourceError || durationError || error.message;
  const title =
    scalarError?.name ??
    (sourceError
      ? "Source family"
      : durationError
        ? "Traversal duration"
        : error.field
          ? labels[error.field]
          : undefined);
  const [claimed, setClaimed] = useState(false);
  const claim = useCallback((_key: string, on: boolean) => setClaimed(on), []);
  const target = useMemo(
    () => ({ label: title, message, claim, touch: () => {} }),
    [title, message, claim],
  );
  const [lo, hi] = memberInterval(study.source, study.selected);
  const scalar = (
    name: string,
    k: "radius" | "xMin" | "xMax" | "yMin" | "yMax",
    help: string,
  ) => (
    <Field label={name} help={help}>
      <ScalarInput
        name={name}
        value={study.source[k]}
        onChange={(v) => setSource((s) => ({ ...s, [k]: v }))}
      />
    </Field>
  );
  return (
    <dialog
      ref={dialog}
      className="loom"
      aria-labelledby="loom-title"
      onCancel={(e) => {
        e.preventDefault();
        onReturn("keyboard");
      }}
      onPointerDown={quiet.onPointerDown}
      onKeyDownCapture={quiet.onKeyDownCapture}
    >
      <AppHeader theme={theme} appearance={false}>
        <button
          ref={back}
          onClick={(e) => onReturn(e.detail === 0 ? "keyboard" : "pointer")}
        >
          Return to study
        </button>
        <ShareLink
          notebook="2d"
          study={() => ({ ...entry.study, weight, loom: study })}
          disabled={!ready || exporting}
        />
        <AnimationButton section="loom-animation-section" />
        <ExportImageMenu
          kind="complex-square"
          revision={
            markerKey +
            JSON.stringify([
              study.views,
              study.framing,
              theme.dark,
              theme.scheme,
              weight,
            ])
          }
          disabled={!ready || exporting}
          base={{ width: 2000, height: 760 }}
          onSave={still}
        />
      </AppHeader>
      <div className="loom-content">
        <div className="loom-heading">
          <p className="eyebrow">Complex transformation · w = z²</p>
          <h2 id="loom-title">The complex loom</h2>
          <p>Choose a thread in one plane. Find its square in the other.</p>
        </div>
        <ScalarStatus.Provider value={scalarStatus}>
          <FieldErrorContext.Provider value={target}>
            <div className="loom-layout">
              <aside>
                <fieldset disabled={exporting}>
                  <Field
                    label="Source family"
                    help={tiered(
                      "Choose a grid, circles, or the curve from your base study.",
                      "Curve from your base study uses a frozen copy of the curve you were viewing when you opened the loom. Return to study to edit it, then reopen the loom to refresh the copy.",
                    )}
                  >
                    <select
                      value={study.source.kind}
                      onChange={(e) => {
                        generation.current++;
                        setScalars({});
                        setSource((s) =>
                          replaceSource(
                            s,
                            e.target.value as LoomSource["kind"],
                          ),
                        );
                      }}
                    >
                      {Object.entries(sourceChoices).map(([v, label]) => (
                        <option key={v} value={v}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {study.source.kind === "curve" && (
                    <>
                      <p className="note">
                        This is a frozen copy of your base study’s{" "}
                        {study.source.curve.format} curve. Return to study, edit
                        the curve, then reopen the loom to update the copy.
                      </p>
                    </>
                  )}
                  <details
                    className="loom-source-settings"
                    open={sourceSettings}
                    onToggle={(e) => setSourceSettings(e.currentTarget.open)}
                  >
                    <summary>Source settings</summary>
                    {study.source.kind === "grid" ? (
                      <>
                        <div className="pair">
                          <Field
                            label="Vertical lines"
                            help="1–32 lines; a single line sits centrally."
                          >
                            <input
                              type="number"
                              min={1}
                              max={32}
                              value={study.source.xCount}
                              onChange={(e) =>
                                setSource((s) => ({
                                  ...s,
                                  xCount: +e.target.value,
                                }))
                              }
                            />
                          </Field>
                          <Field
                            label="Horizontal lines"
                            help="1–32 lines; a single line sits centrally."
                          >
                            <input
                              type="number"
                              min={1}
                              max={32}
                              value={study.source.yCount}
                              onChange={(e) =>
                                setSource((s) => ({
                                  ...s,
                                  yCount: +e.target.value,
                                }))
                              }
                            />
                          </Field>
                        </div>
                        <div className="pair">
                          {scalar(
                            "Grid x start",
                            "xMin",
                            "Horizontal start; within ±1,000,000.",
                          )}
                          {scalar(
                            "Grid x end",
                            "xMax",
                            "Horizontal end; span 0.000001–100,000.",
                          )}
                        </div>
                        <div className="pair">
                          {scalar(
                            "Grid y start",
                            "yMin",
                            "Vertical start; within ±1,000,000.",
                          )}
                          {scalar(
                            "Grid y end",
                            "yMax",
                            "Vertical end; span 0.000001–100,000.",
                          )}
                        </div>
                      </>
                    ) : study.source.kind !== "curve" ? (
                      <>
                        <Field
                          label="Circle count"
                          help="1–32 circles, retained separately even when their images coincide."
                        >
                          <input
                            type="number"
                            min={1}
                            max={32}
                            value={study.source.count}
                            onChange={(e) =>
                              setSource((s) => ({
                                ...s,
                                count: +e.target.value,
                              }))
                            }
                          />
                        </Field>
                        {scalar(
                          "Circle radius",
                          "radius",
                          "Positive, at most 1,000,000. Concentric radii increase evenly to this value.",
                        )}
                      </>
                    ) : null}
                    <details>
                      <summary>Sampling and limits</summary>
                      <Field
                        label="Samples per member"
                        help="4–1,024 initial samples per member."
                      >
                        <input
                          type="number"
                          min={4}
                          max={1024}
                          value={study.samples}
                          onChange={(e) => {
                            pause();
                            setStudy((s) => ({
                              ...s,
                              samples: +e.target.value,
                            }));
                          }}
                        />
                      </Field>
                      <Field
                        label="Refinement tolerance"
                        help={tiered(
                          "Relative chord error in both panes: 0.000001–0.05.",
                          "Each source interval is tested in the mapped image and source. Refinement stops at depth 16, 500,000 delivered points across both panes or 1,000,000 map evaluations. Unresolved and invalid intervals remain gaps; finite sampling cannot certify topology.",
                        )}
                      >
                        <ScalarInput
                          name="Refinement tolerance"
                          value={study.tolerance}
                          onChange={(v) => {
                            pause();
                            setStudy((s) => ({ ...s, tolerance: v }));
                          }}
                        />
                      </Field>
                    </details>
                    <LineWeightField
                      value={weight}
                      onChange={setWeight}
                      help={withMore(
                        svgWeightHelp,
                        "In small paired panes, a hairline can look heavier than Fine.",
                      )}
                    />
                    <p className="note">
                      Mapped families do not support downstream constructions.
                    </p>
                  </details>
                </fieldset>
              </aside>
              <main>
                <div ref={panes} className="loom-panes" aria-busy={!ready}>
                  {(["source", "image"] as const).map((pane) => (
                    <section key={pane}>
                      <div className="loom-pane-heading">
                        <h3>
                          {pane === "source"
                            ? "Source plane · z"
                            : "Image plane · z²"}
                        </h3>
                        <button
                          disabled={exporting}
                          onClick={() =>
                            setStudy((s) => ({
                              ...s,
                              framing: {
                                source:
                                  s.framing?.source ??
                                  loomFit(result!, "source"),
                                image:
                                  s.framing?.image ?? loomFit(result!, "image"),
                                [pane]: loomFit(result!, pane),
                              },
                              views: {
                                ...s.views,
                                [pane]: { x: 0, y: 0, zoom: 1 },
                              },
                            }))
                          }
                        >
                          Fit {pane}
                        </button>
                      </div>
                      {result && marker ? (
                        <PaneDrawing
                          {...props(pane)}
                          onCamera={
                            exporting ? undefined : props(pane).onCamera
                          }
                          onSelect={exporting ? undefined : select}
                        />
                      ) : (
                        <p>Preparing paired geometry…</p>
                      )}
                    </section>
                  ))}
                </div>
                <div className="loom-controls">
                  {result && marker && (
                    <>
                      <p className="note">
                        {describeColors("Teal", theme.scheme)} threads retain
                        their source identities; the selected member is
                        highlighted. Drag each pane to pan; scroll to zoom.
                        Keyboard: arrows, +/−, Home.
                      </p>
                      <fieldset
                        disabled={exporting || resultKey !== key}
                        className="loom-traversal"
                      >
                        <Field label="Selected member">
                          <select
                            value={study.selected}
                            onChange={(e) => select(+e.target.value)}
                          >
                            {result.members.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field
                          label="Source parameter"
                          className="loom-parameter"
                          helpBeforeControl
                          value={study.parameter.toPrecision(6)}
                          help={tiered(
                            "Move corresponding points at the same original source parameter.",
                            "Traversal advances uniformly in the source parameter, not arc length. Rotated circles have center r exp(iα), α = 2πk/N and z(θ) = r exp(iα)(1 + exp(iθ)); θ increases counterclockwise from the outermost point. At θ = π the point is critical, but maps to zero.",
                          )}
                        >
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step="any"
                            value={progress}
                            aria-valuetext={String(study.parameter)}
                            onChange={(e) =>
                              changeParameter(
                                traversal(study, +e.target.value).parameter,
                              )
                            }
                          />
                        </Field>
                      </fieldset>
                      <div
                        ref={playback}
                        id="loom-playback"
                        className={`playback ${playing ? "active" : ""}`}
                        role="group"
                        aria-label="Playback"
                      >
                        <div className="animation-buttons">
                          <button
                            disabled={(!ready && !playing) || exporting}
                            onClick={() => (playing ? pause() : start())}
                          >
                            {playing ? "Pause traversal" : "Play traversal"}
                          </button>
                          <button
                            onClick={() =>
                              exporting ? cancelExport() : changeParameter(lo)
                            }
                          >
                            {exporting ? "Cancel export" : "Stop traversal"}
                          </button>
                        </div>
                      </div>
                      <fieldset disabled={exporting || resultKey !== key}>
                        <Field
                          label="Exact source parameter"
                          help="Enter a source parameter, including constants such as pi."
                        >
                          <ScalarInput
                            name="Exact source parameter"
                            value={study.parameter}
                            onChange={changeParameter}
                          />
                        </Field>
                        <div
                          className="loom-correspondence"
                          data-parameter={marker.parameter}
                        >
                          {marker.source && marker.image ? (
                            <p>
                              z = ({marker.source.x.toPrecision(5)},{" "}
                              {marker.source.y.toPrecision(5)}) → w = (
                              {marker.image.x.toPrecision(5)},{" "}
                              {marker.image.y.toPrecision(5)}).{" "}
                              {marker.critical
                                ? "Critical point: derivative zero; no regular conformality."
                                : "Regular map point."}
                            </p>
                          ) : (
                            <p>
                              Correspondence undefined here; the marker is
                              omitted.
                            </p>
                          )}
                        </div>
                      </fieldset>
                      <section className="animation-section">
                        <details id="loom-animation-section" open>
                          <summary className="section-label">ANIMATION</summary>
                          <fieldset disabled={exporting}>
                            <Field
                              label="Traversal duration"
                              help="0.1–3,600 seconds at uniform source-parameter pace."
                            >
                              <input
                                type="number"
                                min={0.1}
                                max={3600}
                                step="any"
                                value={
                                  Number.isNaN(study.duration)
                                    ? ""
                                    : study.duration
                                }
                                onChange={(e) => {
                                  pause();
                                  setStudy((s) => ({
                                    ...s,
                                    duration:
                                      e.target.value === ""
                                        ? NaN
                                        : +e.target.value,
                                  }));
                                }}
                              />
                            </Field>
                            <MotionExportSettings
                              state={exportState}
                              id="loom-export-settings"
                              disclosure={exportSection}
                            />
                          </fieldset>
                          <button
                            className="animation-export"
                            disabled={
                              !ready ||
                              playing ||
                              exporting ||
                              exportState.formats?.[exportState.chosen] !==
                                "yes" ||
                              Math.ceil(study.duration * exportState.fps) > 7200
                            }
                            onClick={() => void movie()}
                          >
                            Export {exportState.text.name} ↗
                          </button>
                          {exporting && (
                            <p role="status" aria-live="off">
                              Exporting {exportState.text.short}…{" "}
                              {Math.round(exportProgress * 100)}%
                            </p>
                          )}
                        </details>
                      </section>
                      <p className="note" data-gaps>
                        {gapSummary(result)} {result.points.toLocaleString()}{" "}
                        paired points.
                      </p>
                    </>
                  )}
                  {!ready && !message && (
                    <p className="note" role="status">
                      Computing correspondence…
                    </p>
                  )}
                  {message && !claimed && (
                    <p className="study-error" role="alert">
                      {message}
                    </p>
                  )}
                </div>
              </main>
            </div>
          </FieldErrorContext.Provider>
        </ScalarStatus.Provider>
      </div>
    </dialog>
  );
}
