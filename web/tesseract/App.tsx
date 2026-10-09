import {
  cloneElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppHeader } from "../AppHeader";
import { Orientation } from "../Orientation";
import { turnTo, turntableBasis } from "../named-views";
import { AnimationButton } from "../AnimationButton";
import { NotebookMode } from "../NotebookMode";
import { useTheme } from "../useTheme";
import { useMediaQuery } from "../useMediaQuery";
import {
  Field,
  FieldErrorContext,
  StudyError,
  type FieldErrorTarget,
} from "../Field";
import { tiered, type Help } from "../help";
import { ScalarInput, ScalarStatus, type ScalarState } from "../ScalarInput";
import {
  EngineClient,
  EngineError,
  playbackEngineCount,
} from "../engine-client";
import { play as playFrames } from "../playback";
import { LineWeightField } from "../LineWeightField";
import { ExampleGallery } from "../ExampleGallery";
import { tesseractExamples, tesseractThumbnail } from "../examples";
import { ExportImageMenu } from "../ExportImageMenu";
import { saveFile, pngFile, stillSize, svgFile } from "../export-image";
import { AnimationPanel, type MotionExport } from "./AnimationPanel";
import { StudyPlot } from "./Plot";
import { exportBaseSize, type ExportLayout } from "../export-quality";
import { drawnInks, inks, sectionInk } from "./Drawing";
import { LegendEntries } from "../Legend";
import { Sampler } from "./sampler";
import { tesseractPresets } from "./presets";
import {
  motions,
  sample,
  initialView,
  type Config,
  type Result,
  type Layers,
  type Motion,
  type View,
} from "./types";
import { objects, modes } from "./objects";
import { axes, fieldLabel, labels } from "./fields";
import { LinkNotice, ShareLink } from "../ShareLink";
import { LinkError, type SharedStudy } from "../study-link";
import { tesseractStudy, type TesseractStudy } from "./link";
import { cycles, progressAt, type Pace, type Repeat } from "../timing";
import "./style.css";

// Each of the six rotation angles shares one help.
const angleHelp = tiered(
  "Radians; pi/2 is a quarter turn.",
  "Each angle stays within ±1000000. Turns apply in order xy, xz, yz, xw, yw, zw, each carrying its first axis toward its second.",
);
export default function TesseractApp({
  active = true,
  shared,
}: {
  active?: boolean;
  shared?: SharedStudy;
}) {
  const theme = useTheme(),
    narrow = useMediaQuery("(max-width: 700px)"),
    { dark } = theme;
  const [config, setConfig] = useState<Config>(() =>
    structuredClone(tesseractPresets[0].config),
  );
  const remembered = useRef<Partial<Record<Config["object"], Config>>>({
    tesseract: structuredClone(tesseractPresets[0].config),
  });
  const [preset, setPreset] = useState<number | null>(0),
    [view, setView] = useState({ ...initialView }),
    [spinning, setSpinning] = useState(false),
    [diagramView, setDiagramView] = useState<View>({ ...initialView }),
    [stacked, setStacked] = useState(
      () => matchMedia("(max-width: 700px)").matches,
    );
  const pairedShadow = useRef<View | null>(null);
  useEffect(() => {
    const media = matchMedia("(max-width: 700px)");
    const change = () => setStacked(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  const [layers, setLayers] = useState<Layers>({
    edges: true,
    guides: true,
    faces: true,
    selectedSection: 0,
  });
  const [motion, setMotion] = useState<Motion>("double"),
    [progress, setProgress] = useState(0),
    [playing, setPlaying] = useState(false),
    [duration, setDuration] = useState(12),
    // How the duration is spent (../timing.ts); progress is the time on
    // the timeline, from which the motion's progress follows.
    [repeat, setRepeat] = useState<Repeat>("once"),
    [pace, setPace] = useState<Pace>("steady"),
    [loopError, setLoopError] = useState("");
  const [frame, setFrame] = useState<{ config: Config; result: Result } | null>(
      null,
    ),
    // The engine's error, and the request path of the field it names.
    [failed, setFailed] = useState<{ message: string; field?: string }>({
      message: "",
    });
  const error = failed.message,
    setError = (message: string, field?: string) =>
      setFailed({ message, field });
  // The field showing the failure under its control, if any, and the label
  // of the control last changed.
  const [claimed, setClaimed] = useState<string | null>(null);
  const claim = useCallback(
    (key: string, on: boolean) =>
      setClaimed((c) => (on ? key : c === key ? null : c)),
    [],
  );
  const touched = useRef<string | null>(null);
  const touch = useCallback((label: string) => {
    touched.current = label;
  }, []);
  const [scalars, setScalars] = useState<Record<string, ScalarState>>({});
  const client = useRef<EngineClient | null>(null),
    sampler = useRef<Sampler | null>(null),
    generation = useRef(0),
    epoch = useRef(0),
    jobs = useRef(new Set<Promise<void>>());
  const [preview, setPreview] = useState(false);
  const [revision, setRevision] = useState(0);
  const [ready, setReady] = useState(false),
    [settled, setSettled] = useState("");
  const [exporting, setExporting] = useState(""),
    [exportProgress, setExportProgress] = useState(0),
    [exportError, setExportError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const scalarBusy = Object.values(scalars).some((s) => s.pending),
    scalarState = Object.values(scalars).find((s) => s.error),
    scalarError = scalarState?.error;
  // Only a single pass completes; a repeating animation is never finished.
  const complete = repeat === "once" && progress >= 1,
    motionProgress = progressAt(progress, repeat, pace);
  // Playback holds the view buttons; a finished animation hands them back.
  const held = preview && (playing || !complete);
  const request = preview ? sample(config, motion, motionProgress) : config,
    key = JSON.stringify(request);
  const busy = !ready || scalarBusy || (!playing && key !== settled);
  useEffect(() => {
    const c = new EngineClient();
    client.current = c;
    sampler.current = new Sampler(c);
    setReady(true);
    return () => {
      epoch.current++;
      sampler.current?.cancel();
      c.dispose();
      controller.current?.abort();
    };
  }, []);
  const checks = useRef(0);
  const stop = () => {
    epoch.current++;
    checks.current++;
    setRevision((r) => r + 1);
    sampler.current?.cancel();
    setPlaying(false);
    controller.current?.abort();
  };
  useEffect(() => {
    if (!active) {
      stop();
      setSpinning(false);
    }
  }, [active]);
  useEffect(() => {
    if (!ready || playing || !active || scalarBusy) return;
    const ticket = ++epoch.current;
    const timer = setTimeout(() => {
      void sampler
        .current!.request(request)
        .then((result) => {
          if (ticket !== epoch.current || !result) return;
          if (!preview)
            remembered.current[request.object] = structuredClone(request);
          setFrame({ config: request, result });
          setSettled(key);
          setError("");
        })
        .catch((e: Error) => {
          if (ticket === epoch.current) {
            setError(e.message, e instanceof EngineError ? e.field : undefined);
            setSettled(key);
          }
        });
    }, 40);
    return () => {
      clearTimeout(timer);
      epoch.current++;
    };
  }, [key, ready, playing, active, scalarBusy, revision]);
  useEffect(() => {
    if (!playing || !ready || !active) return;
    const ticket = ++epoch.current;
    // Every frame is calculated; while one engine calculates, a helper,
    // alive only while playback runs, can calculate the next.
    const helper = playbackEngineCount() > 1 ? new EngineClient() : null;
    const frameAt = async (engine: EngineClient, p: number) => {
      const q = sample(config, motion, progressAt(p, repeat, pace));
      return { config: q, result: await engine.tesseract(q) };
    };
    // Each engine holds at most one calculation; slow devices skip
    // intermediate times instead of queuing work.
    const halt = playFrames({
      from: progress,
      duration: duration * 1000,
      repeat: cycles(repeat),
      lanes: [client.current!, ...(helper ? [helper] : [])].map(
        (engine) => (p: number) => frameAt(engine, p),
      ),
      show: (next, p) => {
        if (ticket !== epoch.current) return;
        setFrame(next);
        setSettled(JSON.stringify(next.config));
        setProgress(p);
        setError("");
      },
      // Ending playback releases the helper with the effect.
      end: () => {
        if (ticket === epoch.current) setPlaying(false);
      },
      fail: (e) => {
        if (ticket !== epoch.current) return;
        setError(
          (e as Error).message,
          e instanceof EngineError ? e.field : undefined,
        );
        setPlaying(false);
      },
    });
    return () => {
      epoch.current++;
      halt();
      helper?.dispose();
    };
  }, [playing, ready, active]);
  useEffect(() => {
    if (!spinning || !active || preview || exporting) return;
    let raf = 0,
      last = performance.now();
    const tick = (now: number) => {
      const delta = Math.max(0, Math.min(50, now - last));
      last = now;
      setView((v) => ({ ...v, yaw: v.yaw + delta * 0.00018 }));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spinning, active, preview, exporting]);
  const resetMotion = () => {
    stop();
    setProgress(0);
    setPreview(false);
    setLoopError("");
  };
  // Only a whole turn or a slice passage returns to its start; another
  // motion keeps repeating, back and forth.
  const loopable = !!motions(config).find((m) => m.value === motion)?.loops;
  useEffect(() => {
    if (!loopable && repeat === "loop") setRepeat("back-and-forth");
  }, [loopable, repeat]);
  const update = (change: (c: Config) => Config) => {
    stop();
    setProgress(0);
    setPreview(false);
    setLoopError("");
    setPreset(null);
    setConfig(change);
  };
  const scalar = (
    label: string,
    value: number,
    change: (c: Config, n: number) => Config,
    help?: Help<string>,
  ) => (
    <Field label={label} help={help}>
      <ScalarInput
        name={label}
        value={value}
        onChange={(n) => update((c) => change(c, n))}
      />
    </Field>
  );
  const count = (
    label: string,
    value: number,
    min: number,
    max: number,
    change: (c: Config, n: number) => Config,
  ) => (
    <Field label={label}>
      <input
        type="number"
        min={min}
        max={max}
        step="1"
        value={Number.isNaN(value) ? "" : value}
        onChange={(e) => {
          const n = e.target.value === "" ? NaN : Number(e.target.value);
          update((c) => change(c, n));
        }}
      />
    </Field>
  );
  const choose = (i: number) => {
    touched.current = null;
    stop();
    generation.current++;
    setScalars({});
    setConfig(structuredClone(tesseractPresets[i].config));
    setPreset(i);
    setMotion(tesseractPresets[i].motion);
    setRepeat(tesseractPresets[i].repeat ?? "once");
    setPace(tesseractPresets[i].pace ?? "steady");
    setLoopError("");
    setProgress(0);
    setPreview(false);
    setView({ ...initialView });
    setDiagramView({ ...initialView });
    pairedShadow.current = null;
    setSpinning(false);
    setError("");
  };
  // A shared study replaces the whole study, as a preset does, and restores
  // the sender's layers, views, and motion.
  const [linkNotice, setLinkNotice] = useState("");
  const openStudy = (study: TesseractStudy) => {
    touched.current = null;
    stop();
    generation.current++;
    setScalars({});
    setConfig(study.config);
    setPreset(null);
    setLayers(study.layers);
    setMotion(study.motion);
    setDuration(study.duration);
    setRepeat(study.repeat);
    setPace(study.pace);
    setLoopError("");
    setProgress(0);
    setPreview(false);
    setView(study.view);
    setDiagramView(study.diagramView);
    pairedShadow.current = null;
    setSpinning(false);
    setError("");
  };
  useEffect(() => {
    if (!shared) return;
    setLinkNotice(shared.error ?? "");
    if (shared.error !== undefined) return;
    try {
      openStudy(tesseractStudy(shared.study));
    } catch (e) {
      setLinkNotice(
        e instanceof LinkError ? e.message : "This link could not be read.",
      );
    }
  }, [shared?.id]);
  const snapshot = (): TesseractStudy => ({
    config,
    layers,
    view,
    diagramView,
    motion,
    duration,
    repeat,
    pace,
  });
  const play = async () => {
    setLoopError("");
    // A loop joins the end to the start, so they must be the same drawing.
    if (repeat === "loop") {
      const ticket = ++checks.current;
      try {
        const { tesseractLoopGap } = await import("./loop");
        const gap = await tesseractLoopGap({
          client: client.current!,
          config,
          motion,
          view,
          diagramView,
          layers,
          layout,
        });
        if (ticket !== checks.current) return;
        if (gap) {
          setLoopError(gap);
          return;
        }
      } catch (e) {
        if (ticket === checks.current) setLoopError((e as Error).message);
        return;
      }
    }
    if (complete) setProgress(0);
    setSpinning(false);
    setPreview(true);
    setPlaying(true);
    if (matchMedia("(max-width: 700px)").matches)
      stage.current?.scrollIntoView({
        behavior: "instant",
        block: "start",
      });
  };
  const editTimeline = (p: number) => {
    stop();
    setPreview(true);
    setProgress(p);
  };
  const save = async (options: MotionExport) => {
    stop();
    setSpinning(false);
    setExportError("");
    const abort = new AbortController();
    controller.current = abort;
    setExporting("Preparing…");
    setExportProgress(0);
    try {
      const { exportMotion } = await import("./export");
      const blob = await exportMotion({
        config: structuredClone(config),
        motion,
        view: { ...view },
        diagramView: { ...diagramView },
        layers: { ...layers },
        dark,
        duration,
        repeat,
        pace,
        ...options,
        signal: abort.signal,
        onProgress: (n, total) => {
          if (controller.current !== abort) return;
          setExporting(`${n} / ${total} frames`);
          setExportProgress(n / total);
        },
      });
      abort.signal.throwIfAborted();
      saveFile(blob, `tangent-garden-tesseract.${options.format}`);
    } catch (e) {
      if (!abort.signal.aborted) setExportError((e as Error).message);
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        setExporting("");
      }
    }
  };
  useEffect(() => {
    controller.current?.abort();
  }, [dark]);
  const descriptor = objects[config.object];
  const layout: ExportLayout | undefined =
    config.mode === "paired" && descriptor.pairedModes
      ? stacked
        ? "rows"
        : "columns"
      : undefined;
  const liveLayout: ExportLayout | undefined = frame?.result.companion
    ? stacked
      ? "rows"
      : "columns"
    : undefined;
  const curved = descriptor.legend === "sections";
  const indexed = curved || descriptor.legend === "latitudes";
  // What the drawing shows, by ink, and the drawn study's legend items.
  const drawn = frame ? drawnInks(frame.result, layers) : null;
  const drawnDescriptor = objects[(frame?.config ?? config).object];
  const numericStudy = descriptor.parameterKey !== undefined;
  const parameterKey = descriptor.parameterKey ?? "lift";
  const parameters = config[parameterKey] as unknown as Record<
    string,
    number | number[]
  >;
  const liftFields =
    descriptor.numericFields?.filter((f) => !f.visible || f.visible(config)) ??
    [];
  const renderNumericFields = (endpoints: boolean) => {
    const fields = liftFields.filter((f) => !!f.endpoint === endpoints);
    const rows: (typeof fields)[] = [];
    for (const f of fields) {
      const previous = rows.at(-1);
      if (
        previous &&
        (f.group
          ? previous[0].group === f.group
          : !previous[0].group && previous.length < 2)
      )
        previous.push(f);
      else rows.push([f]);
    }
    return rows.map((row) => (
      <div
        key={row[0].label}
        role={row[0].group ? "group" : undefined}
        aria-label={row[0].group}
      >
        {row[0].group && <div className="term-heading">{row[0].group}</div>}
        <div className={row[0].group ? "pair trio" : "pair"}>
          {row.map((f) =>
            cloneElement(
              scalar(
                f.label,
                f.index === undefined
                  ? (parameters[f.key] as number)
                  : (parameters[f.key] as number[])[f.index],
                (c, n) => {
                  const lift = { ...c[parameterKey] } as unknown as Record<
                    string,
                    number | number[]
                  >;
                  if (f.index === undefined)
                    Object.assign(lift, { [f.key]: n });
                  else {
                    const values = [...(lift[f.key] as number[])];
                    values[f.index] = n;
                    Object.assign(lift, { [f.key]: values });
                  }
                  return { ...c, [parameterKey]: lift };
                },
                f.help,
              ),
              {
                key: f.label,
                ...(f.group
                  ? {
                      label: (
                        <>
                          <span className="lift-coordinate-context">
                            {f.group}{" "}
                          </span>
                          {["x", "y", "z"][f.index!]}
                        </>
                      ),
                      topic: f.label,
                    }
                  : {}),
              },
            ),
          )}
        </div>
      </div>
    ));
  };
  const choices = descriptor.choices?.map((choice) => (
    <Field key={choice.key} label={choice.label} help={choice.help}>
      <select
        value={(parameters as unknown as Record<string, string>)[choice.key]}
        onChange={(e) => {
          const value = e.target.value;
          update((c) => ({
            ...c,
            [parameterKey]: {
              ...c[parameterKey],
              [choice.key]: value,
            },
          }));
        }}
      >
        {choice.values.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  ));
  const info = descriptor.explanation(config);
  const selected =
    frame?.result.sections[
      Math.min(
        layers.selectedSection ?? 0,
        (frame?.result.sections.length ?? 1) - 1,
      )
    ];
  // Where the failure is shown: under the input that failed to parse, or
  // under the control the engine's error names, or, for an error about the
  // whole study, the control just changed; the drawing shows it only when
  // no such field can.
  const failure = scalarError || error;
  const failureTarget: Pick<FieldErrorTarget, "id" | "label"> = scalarState
    ? scalarState.control
      ? { id: scalarState.control }
      : { label: scalarState.name }
    : {
        label:
          (failed.field && fieldLabel(config, failed.field)) ??
          touched.current ??
          undefined,
      };
  const fieldError = useMemo<FieldErrorTarget>(
    () => ({ ...failureTarget, message: failure, claim, touch }),
    [failureTarget.id, failureTarget.label, failure],
  );
  const claimedHere = !!failure && claimed !== null;
  // On phones the explanation follows the controls, as in the other
  // notebooks, so the examples come straight after the drawing.
  const explanation = (
    <div className="tesseract-explanation">
      <h2>{info[0]}</h2>
      <p>{info[1]}</p>
      <code>{info[2]}</code>
      <p className="note">{descriptor.colorNote(config)}</p>
      {frame && descriptor.readouts && (
        <div className="lift-readout">
          {descriptor.readouts(frame.result).map(({ label, value }) => (
            <span key={label}>
              {label}: <b>{value}</b>
            </span>
          ))}
        </div>
      )}
      {frame && descriptor.comparisonReadouts && (
        <details className="comparison-readout">
          <summary>{descriptor.comparisonLabel}</summary>
          {descriptor.comparisonNote && <p>{descriptor.comparisonNote}</p>}
          <div className="lift-readout">
            {descriptor
              .comparisonReadouts(frame.result)
              .map(({ label, value }) => (
                <span key={label}>
                  {label}: <b>{value}</b>
                </span>
              ))}
          </div>
        </details>
      )}
      {curved && selected ? (
        <p className="section-identity" data-section={selected.id}>
          Selected section{" "}
          {Math.min(
            layers.selectedSection ?? 0,
            frame!.result.sections.length - 1,
          ) + 1}{" "}
          · {descriptor.sectionDetail(selected)}
        </p>
      ) : null}
      <p className="tesseract-diagnostics" role="status">
        {frame && descriptor.diagnostics(frame.result)}
      </p>
    </div>
  );
  return (
    <div className={`app tesseract-app ${dark ? "dark" : ""}`}>
      <AppHeader theme={theme}>
        <ShareLink
          notebook="4d"
          study={snapshot}
          disabled={busy || !!error || !!scalarError}
        />
        <AnimationButton section="shape-animation-section" />
        <ExportImageMenu
          menuId="tesseract-export-image"
          kind="tesseract"
          disabled={busy || !!error || !!scalarError || playing || !!exporting}
          base={exportBaseSize(liveLayout)}
          onSave={async (format, still) => {
            const svg = document.getElementById(
              "tesseract-artwork",
            ) as unknown as SVGSVGElement;
            const size = stillSize(still, exportBaseSize(liveLayout));
            const blob =
              format === "svg"
                ? svgFile(svg, still.transparent)
                : await pngFile(
                    svg,
                    size.width,
                    size.height,
                    still.transparent,
                  );
            saveFile(blob, `tangent-garden-tesseract.${format}`);
          }}
        />
      </AppHeader>
      <main>
        <ScalarStatus.Provider
          value={{
            client,
            generation,
            track: (job) => {
              jobs.current.add(job);
              void job.finally(() => jobs.current.delete(job));
            },
            report: (id, s) => {
              if (s?.pending) stop();
              setScalars((prev) => {
                const next = { ...prev };
                if (s) next[id] = s;
                else delete next[id];
                return next;
              });
            },
          }}
        >
          <aside className="tesseract-controls">
            <FieldErrorContext.Provider value={fieldError}>
              <section>
                {linkNotice && (
                  <LinkNotice
                    text={linkNotice}
                    onDismiss={() => setLinkNotice("")}
                  />
                )}
                <div className="section-label">
                  01 / BEYOND THREE DIMENSIONS
                </div>
                <NotebookMode />
                <ExampleGallery
                  examples={tesseractExamples}
                  current={preset}
                  onChoose={choose}
                  thumbnail={tesseractThumbnail}
                  dark={dark}
                />
                <Field label={labels.object}>
                  <select
                    value={config.object}
                    onChange={(e) => {
                      const object = e.target.value as Config["object"];
                      // An object replacement invalidates scalar jobs from the previous definition.
                      stop();
                      generation.current++;
                      setScalars({});
                      setMotion(objects[object].motion);
                      update((c) => {
                        const saved = remembered.current[object];
                        if (saved) return structuredClone(saved);
                        return objects[object].defaults(c);
                      });
                    }}
                  >
                    {Object.entries(objects).map(([key, object]) => (
                      <option key={key} value={key}>
                        {object.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={descriptor.viewLabel}>
                  <select
                    value={config.mode}
                    onChange={(e) => {
                      const mode = e.target.value as Config["mode"];
                      if (descriptor.linkedViews) {
                        stop();
                        // The paired shadow camera is kept only across a
                        // paired → diagram → paired excursion.
                        if (config.mode === "paired" && mode === "diagram") {
                          pairedShadow.current = { ...view };
                          setView({ ...diagramView });
                        } else {
                          if (mode === "paired" && config.mode === "diagram") {
                            setDiagramView({ ...view });
                            if (pairedShadow.current)
                              setView({ ...pairedShadow.current });
                          }
                          pairedShadow.current = null;
                        }
                        if (descriptor.flat?.({ ...config, mode }))
                          setSpinning(false);
                        setPreset(null);
                        setConfig((c) => ({ ...c, mode }));
                        return;
                      }
                      if (mode !== "section" && motion === "slice")
                        setMotion("double");
                      update((c) => ({ ...c, mode }));
                    }}
                  >
                    {descriptor.modes.map((mode) => (
                      <option key={mode} value={mode}>
                        {modes[mode]}
                      </option>
                    ))}
                  </select>
                </Field>
                <p className="note">{descriptor.selectorNote}</p>
              </section>
              {descriptor.rotations && (
                <section>
                  <div className="section-label">
                    02 / TURN IN FOUR DIMENSIONS
                  </div>
                  {[0, 2, 4].map((i) => (
                    <div className="pair" key={i}>
                      {[i, i + 1].map((k) =>
                        cloneElement(
                          scalar(
                            `${axes[k]} angle`,
                            config.angles[k],
                            (c, n) => {
                              const angles = [...c.angles] as Config["angles"];
                              angles[k] = n;
                              return { ...c, angles };
                            },
                            angleHelp,
                          ),
                          { key: k },
                        ),
                      )}
                    </div>
                  ))}
                  <p className="note">
                    The w planes turn through the fourth dimension. Drag the
                    drawing to change your viewpoint in 3D.
                  </p>
                </section>
              )}
              <section>
                <div className="section-label">
                  {descriptor.constructionNumber} / THE CONSTRUCTION
                </div>
                {curved && (
                  <>
                    <div className="pair">
                      {descriptor.radiusFields.map((field) =>
                        cloneElement(
                          scalar(
                            field.label,
                            config[field.key],
                            (c, n) => ({ ...c, [field.key]: n }),
                            field.help,
                          ),
                          { key: field.key },
                        ),
                      )}
                    </div>
                    <div className="pair">
                      {count(
                        labels.curves,
                        config.curves,
                        3,
                        16,
                        (c, curves) => ({ ...c, curves }),
                      )}
                      {count(
                        labels.curveSamples,
                        config.samples,
                        8,
                        256,
                        (c, samples) => ({ ...c, samples }),
                      )}
                    </div>
                    <p className="note">
                      Finite boundary linework. Families share a budget of 512
                      curves and 65,536 points; reduce counts if the budget is
                      exceeded.
                    </p>
                  </>
                )}
                {numericStudy && (
                  <>
                    {descriptor.choicesFirst && choices}
                    {renderNumericFields(false)}
                    {descriptor.countFields ? (
                      <>
                        {[0, 2].map((start) => (
                          <div className="pair" key={start}>
                            {descriptor.countFields!(config)
                              .slice(start, start + 2)
                              .map((f) =>
                                cloneElement(
                                  count(
                                    f.label,
                                    config[f.key],
                                    f.min,
                                    f.max,
                                    (c, n) => ({ ...c, [f.key]: n }),
                                  ),
                                  { key: f.key },
                                ),
                              )}
                          </div>
                        ))}
                        {descriptor.countNote && (
                          <p className="note">{descriptor.countNote}</p>
                        )}
                      </>
                    ) : (
                      count(
                        descriptor.sampleLabel!,
                        config.samples,
                        8,
                        256,
                        (c, samples) => ({ ...c, samples }),
                      )
                    )}
                    {descriptor.motionEndpointsLabel && (
                      <details className="subsection">
                        <summary>{descriptor.motionEndpointsLabel}</summary>
                        {renderNumericFields(true)}
                      </details>
                    )}
                    {!descriptor.choicesFirst && choices}
                  </>
                )}
                {config.mode === "perspective" &&
                  scalar(
                    labels.distance,
                    config.distance,
                    (c, distance) => ({ ...c, distance }),
                    "From 2.05 to 20, so the eye stays outside the tesseract.",
                  )}
                {config.mode === "stereo" &&
                  scalar(
                    labels.clip,
                    config.clip,
                    (c, clip) => ({ ...c, clip }),
                    "From 2 to 12. Arcs reaching this sphere are left open; a larger window shows more.",
                  )}
                {config.mode === "section" ? (
                  <>
                    {scalar(
                      labels.slice,
                      config.slice,
                      (c, slice) => ({ ...c, slice }),
                      descriptor.sliceHelp,
                    )}
                    <div className="pair">
                      {count(labels.count, config.count, 1, 25, (c, count) => ({
                        ...c,
                        count,
                      }))}
                      {scalar(
                        labels.spread,
                        config.spread,
                        (c, spread) => ({ ...c, spread }),
                        descriptor.spreadHelp,
                      )}
                    </div>
                    {curved && (
                      <Field
                        label="Selected section"
                        help="Which section is drawn stronger, counted in slice order."
                      >
                        <input
                          type="number"
                          min="1"
                          max={config.count}
                          step="1"
                          value={
                            Math.min(
                              layers.selectedSection ?? 0,
                              config.count - 1,
                            ) + 1
                          }
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            if (
                              !Number.isInteger(n) ||
                              n < 1 ||
                              n > config.count
                            )
                              return;
                            controller.current?.abort();
                            setLayers((l) => ({
                              ...l,
                              selectedSection: n - 1,
                            }));
                          }}
                        />
                      </Field>
                    )}
                  </>
                ) : (
                  !numericStudy && (
                    <>
                      {count(labels.grid, config.grid, 0, 12, (c, grid) => ({
                        ...c,
                        grid,
                      }))}
                      {config.mode === "stereo" &&
                        count(
                          labels.arcSamples,
                          config.samples,
                          8,
                          256,
                          (c, samples) => ({ ...c, samples }),
                        )}
                    </>
                  )
                )}
                <div className="layer-grid">
                  {(
                    descriptor.layerOptions?.(config) ??
                    (["edges", "guides", "faces"] as const)
                      .filter(
                        (k) =>
                          k === "edges" ||
                          (k === "faces"
                            ? !curved &&
                              config.mode === "section" &&
                              config.count === 1
                            : config.mode !== "section"),
                      )
                      .map((k) => ({
                        key: k,
                        label: {
                          edges: "Edges & section contours",
                          guides: "Face lattice",
                          faces: "Translucent section faces",
                        }[k],
                      }))
                  ).map(({ key: k, label }) => (
                    <label className="check" key={k}>
                      <input
                        type="checkbox"
                        checked={!!layers[k]}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          controller.current?.abort();
                          setLayers((l) => ({ ...l, [k]: checked }));
                        }}
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <LineWeightField
                  value={layers.weight ?? "regular"}
                  onChange={(weight) => {
                    controller.current?.abort();
                    // Regular is the drawing without a weight, as before.
                    setLayers(({ weight: _, ...l }) =>
                      weight === "regular" ? l : { ...l, weight },
                    );
                  }}
                />
              </section>
            </FieldErrorContext.Provider>
            {failure && !claimedHere && <StudyError message={failure} />}
            <AnimationPanel
              {...{
                config,
                layout,
                motion,
                duration,
                repeat,
                pace,
                preview,
                playing,
                exporting,
              }}
              complete={!exporting && complete}
              // Export renders frames apart from the live preview, whose
              // progress would otherwise resample the drawing on every frame.
              progress={exporting ? exportProgress : progress}
              error={exportError || loopError}
              disabled={!ready || !!error || !!scalarError || scalarBusy}
              onMotion={(m) => {
                resetMotion();
                setMotion(m);
              }}
              onDuration={(n) => {
                stop();
                setDuration(n);
              }}
              onRepeat={(r) => {
                stop();
                setLoopError("");
                setRepeat(r);
              }}
              onPace={(n) => {
                stop();
                setPace(n);
              }}
              onPause={stop}
              onStop={exporting ? stop : resetMotion}
              onSeek={editTimeline}
              onPlay={() => void play()}
              onExport={(options) => void save(options)}
            />
          </aside>
        </ScalarStatus.Provider>
        <article>
          <div className="plot-heading">
            <div>
              <div className="eyebrow">
                FOUR DIMENSIONS /{" "}
                {config.mode === "paired"
                  ? "TWO LINKED VIEWS"
                  : config.mode === "diagram"
                    ? "A COORDINATE DIAGRAM"
                    : config.mode === "section" || config.mode === "reference"
                      ? "A CROSS-SECTION"
                      : "A PROJECTION"}
              </div>
              <h1>
                {preset === null
                  ? modes[config.mode]
                  : tesseractPresets[preset].name}
              </h1>
            </div>
            <div className="view-buttons">
              <button
                className="fit"
                aria-pressed={spinning}
                disabled={held || !!exporting || descriptor.flat?.(config)}
                onClick={() => setSpinning((s) => !s)}
              >
                {spinning ? "Pause rotation" : "Rotate view"}
              </button>
              <button
                className="fit"
                disabled={held || !!exporting}
                onClick={() => {
                  setSpinning(false);
                  setView({ ...initialView });
                  setDiagramView({ ...initialView });
                  pairedShadow.current = null;
                }}
              >
                Reset view
              </button>
            </div>
          </div>
          <div
            className="plot-wrap tesseract-stage"
            ref={stage}
            aria-busy={busy}
            data-config={frame ? JSON.stringify(frame.config) : undefined}
            data-progress={preview ? motionProgress : progress}
            data-time={preview ? progress : undefined}
          >
            {frame?.result.companion && (
              <div className="paired-view-labels" data-layout={liveLayout}>
                {objects[frame.config.object].pairedModes?.map(
                  (mode, index) => (
                    <span key={mode}>
                      {`${index + 1} / ${modes[mode]} (${
                        liveLayout === "rows"
                          ? ["top", "bottom"][index]
                          : ["left", "right"][index]
                      })`}
                    </span>
                  ),
                )}
              </div>
            )}
            <div
              className={`tesseract-canvas-wrap ${liveLayout ? "paired-canvas" : ""}`}
              data-layout={liveLayout}
            >
              {frame && (
                <StudyPlot
                  result={frame.result}
                  config={frame.config}
                  {...{ view, diagramView, layers, dark }}
                  layout={liveLayout}
                  onDiagramView={(v) => {
                    if (held || exporting) return;
                    controller.current?.abort();
                    setDiagramView(v);
                  }}
                  onView={(v) => {
                    if (held || exporting) return;
                    controller.current?.abort();
                    setView(v);
                  }}
                />
              )}
              {!frame && (
                <div className="loading">
                  {failure
                    ? "Check the study definition to begin."
                    : "Opening the fourth dimension…"}
                </div>
              )}
              {frame && failure && (
                <span className="stale-study">Previous valid study</span>
              )}
              {busy && frame && <span className="computing">Computing…</span>}
            </div>
            <div
              className={`plot-meta ${indexed ? "section-meta" : descriptor.legend === "threads" ? "thread-meta" : ""}`}
            >
              <div className="tesseract-legend">
                <LegendEntries
                  entries={
                    indexed
                      ? // The section key reports every section, an empty
                        // one too, while the layer that draws them is on.
                        (frame?.result.sections ?? []).map((s, i) => {
                          const [number, level, suffix] =
                            descriptor.sectionKey!(s, i);
                          return {
                            key: s.id,
                            shown: layers.edges,
                            attributes: { "data-section": s.id },
                            content: (
                              <>
                                <i
                                  style={{ background: sectionInk(i, dark) }}
                                />
                                <span className="section-number">{number}</span>
                                <span className="section-level">{level}</span>
                                <span className="section-stroke">{suffix}</span>
                              </>
                            ),
                          };
                        })
                      : (
                          (typeof drawnDescriptor.legendItems === "function"
                            ? drawnDescriptor.legendItems(
                                frame?.config ?? config,
                              )
                            : drawnDescriptor.legendItems) ??
                          inks(dark).map((_, i) => ({
                            label: ["x", "y", "z", "w"][i],
                            family: i,
                            roles: undefined,
                          }))
                        ).map(({ label, family, roles }) => ({
                          key: label,
                          shown:
                            !drawn ||
                            drawn.some(
                              (ink) =>
                                ink.family === family &&
                                (!roles ||
                                  roles.some((role) => role === ink.role)),
                            ),
                          content: (
                            <>
                              <i style={{ background: inks(dark)[family] }} />
                              {label}
                            </>
                          ),
                        }))
                  }
                />
              </div>
              <span>
                {descriptor.viewingHelp?.(config) ??
                  "Orthographic · drag to orbit · shift-drag or two fingers to pan · scroll or pinch to zoom · keys: arrows, + / −, Home"}
              </span>
            </div>
          </div>
          {frame && !descriptor.flat?.(config) && (
            <Orientation
              basis={turntableBasis(view.yaw, view.pitch)}
              dark={dark}
              disabled={held || !!exporting}
              onTurn={(name) => {
                if (held || exporting) return;
                controller.current?.abort();
                setSpinning(false);
                setView((v) => turnTo(v, name));
              }}
            />
          )}
          {!narrow && explanation}
        </article>
        {narrow && <div className="behind">{explanation}</div>}
      </main>
    </div>
  );
}
