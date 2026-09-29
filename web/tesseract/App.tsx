import { cloneElement, useEffect, useRef, useState } from "react";
import { AppHeader } from "../AppHeader";
import { useTheme } from "../useTheme";
import { Field } from "../Field";
import { ScalarInput, ScalarStatus, type ScalarState } from "../ScalarInput";
import { EngineClient } from "../engine-client";
import { ExampleGallery } from "../ExampleGallery";
import { tesseractExamples, tesseractThumbnail } from "../examples";
import { ExportImageMenu } from "../ExportImageMenu";
import { saveFile, pngFile, svgFile } from "../export-image";
import { AnimationPanel, type MotionExport } from "./AnimationPanel";
import { Plot } from "./Plot";
import { inks, sectionInk } from "./Drawing";
import { Sampler } from "./sampler";
import { tesseractPresets } from "./presets";
import {
  sample,
  initialView,
  type Config,
  type Result,
  type Layers,
  type Motion,
} from "./types";
import { objects, modes } from "./objects";
import "./style.css";
export default function TesseractApp({ active = true }: { active?: boolean }) {
  const theme = useTheme(),
    { dark } = theme;
  const [config, setConfig] = useState<Config>(() =>
    structuredClone(tesseractPresets[0].config),
  );
  const remembered = useRef<Partial<Record<Config["object"], Config>>>({
    tesseract: structuredClone(tesseractPresets[0].config),
  });
  const [preset, setPreset] = useState<number | null>(0),
    [view, setView] = useState({ ...initialView }),
    [spinning, setSpinning] = useState(false);
  const [layers, setLayers] = useState<Layers>({
    edges: true,
    guides: true,
    faces: true,
    selectedSection: 0,
  });
  const [motion, setMotion] = useState<Motion>("double"),
    [progress, setProgress] = useState(0),
    [playing, setPlaying] = useState(false),
    [duration, setDuration] = useState(12);
  const [frame, setFrame] = useState<{ config: Config; result: Result } | null>(
      null,
    ),
    [error, setError] = useState("");
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
    scalarError = Object.values(scalars).find((s) => s.error)?.error;
  // Playback holds the view buttons; a finished animation hands them back.
  const held = preview && (playing || progress < 1);
  const request = preview ? sample(config, motion, progress) : config,
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
  const stop = () => {
    epoch.current++;
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
            setError(e.message);
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
    const ticket = ++epoch.current,
      start = performance.now(),
      from = progress;
    let raf = 0;
    const tick = async (now: number) => {
      if (ticket !== epoch.current) return;
      const p = Math.max(
          from,
          Math.min(1, from + (now - start) / (duration * 1000)),
        ),
        q = sample(config, motion, p);
      try {
        const result = await sampler.current!.request(q);
        if (ticket !== epoch.current || !result) return;
        setFrame({ config: q, result });
        setSettled(JSON.stringify(q));
        setProgress(p);
        setError("");
        if (p >= 1) setPlaying(false);
        else raf = requestAnimationFrame(tick);
      } catch (e) {
        if (ticket === epoch.current) {
          setError((e as Error).message);
          setPlaying(false);
        }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      epoch.current++;
      cancelAnimationFrame(raf);
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
  };
  const update = (change: (c: Config) => Config) => {
    stop();
    setProgress(0);
    setPreview(false);
    setPreset(null);
    setConfig(change);
  };
  const scalar = (
    label: string,
    value: number,
    change: (c: Config, n: number) => Config,
    help?: string,
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
    stop();
    generation.current++;
    setScalars({});
    setConfig(structuredClone(tesseractPresets[i].config));
    setPreset(i);
    setMotion(tesseractPresets[i].motion);
    setProgress(0);
    setPreview(false);
    setView({ ...initialView });
    setSpinning(false);
    setError("");
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
        layers: { ...layers },
        dark,
        duration,
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
  const curved = descriptor.legend === "sections";
  const info = descriptor.explanation(config);
  const selected =
    frame?.result.sections[
      Math.min(
        layers.selectedSection ?? 0,
        (frame?.result.sections.length ?? 1) - 1,
      )
    ];
  return (
    <div className={`app tesseract-app ${dark ? "dark" : ""}`}>
      <AppHeader theme={theme}>
        <ExportImageMenu
          menuId="tesseract-export-image"
          kind="tesseract"
          disabled={busy || !!error || !!scalarError || playing || !!exporting}
          onSave={async (format) => {
            const svg = document.getElementById(
              "tesseract-artwork",
            ) as unknown as SVGSVGElement;
            const blob =
              format === "svg" ? svgFile(svg) : await pngFile(svg, 2000, 1520);
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
            <section>
              <div className="section-label">01 / BEYOND THREE DIMENSIONS</div>
              <ExampleGallery
                examples={tesseractExamples}
                current={preset}
                onChoose={choose}
                thumbnail={tesseractThumbnail}
                dark={dark}
              />
              <Field label="4D object">
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
                          `${["xy", "xz", "yz", "xw", "yw", "zw"][k]} angle`,
                          config.angles[k],
                          (c, n) => {
                            const angles = [...c.angles] as Config["angles"];
                            angles[k] = n;
                            return { ...c, angles };
                          },
                          "Radians; pi/2 is a quarter turn. Applied in order xy, xz, yz, xw, yw, zw. Positive turns carry the first named axis toward the second.",
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
                      "Curves per direction",
                      config.curves,
                      3,
                      16,
                      (c, curves) => ({ ...c, curves }),
                    )}
                    {count(
                      "Curve samples",
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
              {config.mode === "perspective" &&
                scalar(
                  "4D eye distance",
                  config.distance,
                  (c, distance) => ({ ...c, distance }),
                  "From 2.05 to 20. The tesseract has circumradius 2, so the eye stays outside every rotation.",
                )}
              {config.mode === "stereo" &&
                scalar(
                  "Projection window radius",
                  config.clip,
                  (c, clip) => ({ ...c, clip }),
                  "From 2 to 12 in projected space. Arcs passing through infinity are clipped at this sphere and left open. A larger window reveals more distant branches.",
                )}
              {config.mode === "section" ? (
                <>
                  {scalar(
                    "Slice offset h",
                    config.slice,
                    (c, slice) => ({ ...c, slice }),
                    descriptor.sliceHelp,
                  )}
                  <div className="pair">
                    {count(
                      "Section count",
                      config.count,
                      1,
                      25,
                      (c, count) => ({ ...c, count }),
                    )}
                    {scalar(
                      "Section spread",
                      config.spread,
                      (c, spread) => ({ ...c, spread }),
                      descriptor.spreadHelp,
                    )}
                  </div>
                  {curved && (
                    <Field
                      label="Selected section"
                      help="Section numbers follow the ordered slice family. The selected outline is stronger; negative h uses dashes and nonnegative h uses solid strokes. Selection stays fixed during passage and exports."
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
                          if (!Number.isInteger(n) || n < 1 || n > config.count)
                            return;
                          controller.current?.abort();
                          setLayers((l) => ({ ...l, selectedSection: n - 1 }));
                        }}
                      />
                    </Field>
                  )}
                </>
              ) : (
                <>
                  {count("Face grid lines", config.grid, 0, 12, (c, grid) => ({
                    ...c,
                    grid,
                  }))}
                  {config.mode === "stereo" &&
                    count(
                      "Arc samples",
                      config.samples,
                      8,
                      256,
                      (c, samples) => ({ ...c, samples }),
                    )}
                </>
              )}
              <div className="layer-grid">
                {(["edges", "guides", "faces"] as const)
                  .filter(
                    (k) =>
                      k === "edges" ||
                      (k === "faces"
                        ? !curved &&
                          config.mode === "section" &&
                          config.count === 1
                        : config.mode !== "section"),
                  )
                  .map((k) => (
                    <label className="check" key={k}>
                      <input
                        type="checkbox"
                        checked={layers[k]}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          controller.current?.abort();
                          setLayers((l) => ({ ...l, [k]: checked }));
                        }}
                      />
                      {
                        {
                          edges: "Edges & section contours",
                          guides: "Face lattice",
                          faces: "Translucent section faces",
                        }[k]
                      }
                    </label>
                  ))}
              </div>
            </section>
            <AnimationPanel
              {...{
                config,
                motion,
                duration,
                preview,
                playing,
                exporting,
              }}
              // Export renders frames apart from the live preview, whose
              // progress would otherwise resample the drawing on every frame.
              progress={exporting ? exportProgress : progress}
              error={exportError}
              disabled={!ready || !!error || !!scalarError || scalarBusy}
              onMotion={(m) => {
                resetMotion();
                setMotion(m);
              }}
              onDuration={(n) => {
                stop();
                setDuration(n);
              }}
              onPause={stop}
              onStop={exporting ? stop : resetMotion}
              onSeek={editTimeline}
              onPlay={() => {
                if (progress >= 1) setProgress(0);
                setSpinning(false);
                setPreview(true);
                setPlaying(true);
                if (matchMedia("(max-width: 700px)").matches)
                  stage.current?.scrollIntoView({
                    behavior: "instant",
                    block: "start",
                  });
              }}
              onExport={(options) => void save(options)}
            />
          </aside>
        </ScalarStatus.Provider>
        <article>
          <div className="plot-heading">
            <div>
              <div className="eyebrow">
                FOUR DIMENSIONS /{" "}
                {config.mode === "section" ? "A CROSS-SECTION" : "A PROJECTION"}
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
                disabled={held || !!exporting}
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
            data-progress={progress}
          >
            <div className="tesseract-canvas-wrap">
              {frame && (
                <Plot
                  result={frame.result}
                  config={frame.config}
                  {...{ view, layers, dark }}
                  onView={(v) => {
                    if (held || exporting) return;
                    controller.current?.abort();
                    setView(v);
                  }}
                />
              )}
              {!frame && !error && (
                <div className="loading">Opening the fourth dimension…</div>
              )}
              {(error || scalarError) && (
                <div className="error tesseract-error" role="alert">
                  <strong>Let’s check the definition</strong>
                  <p>{scalarError || error}</p>
                </div>
              )}
              {busy && frame && <span className="computing">Computing…</span>}
            </div>
            <div className={`plot-meta ${curved ? "section-meta" : ""}`}>
              <div className="tesseract-legend">
                {curved &&
                  frame?.result.sections.map((s, i) => (
                    <span key={s.id} data-section={s.id}>
                      <i style={{ background: sectionInk(i, dark) }} />
                      <span className="section-number">{i + 1}: h = </span>
                      <span className="section-level">
                        {s.level.toPrecision(3).replace("-", "−")}
                      </span>
                      <span className="section-stroke">
                        {s.level < 0 ? " (dashed)" : " (solid)"}
                      </span>
                    </span>
                  ))}
                {!curved &&
                  inks(dark).map((color, i) => (
                    <span key={i}>
                      <i style={{ background: color }} />
                      {["x", "y", "z", "w"][i]}
                    </span>
                  ))}
              </div>
              <span>
                Orthographic · drag to orbit · shift-drag or two fingers to pan
                · scroll or pinch to zoom · keys: arrows, + / −, Home
              </span>
            </div>
          </div>
          <div className="tesseract-explanation">
            <h2>{info[0]}</h2>
            <p>{info[1]}</p>
            <code>{info[2]}</code>
            <p className="note">{descriptor.colorNote(config)}</p>
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
              {frame && config.mode === "stereo"
                ? `${frame.result.clipped} source curves clipped at the projection window. Open ends are intentional.`
                : ""}
            </p>
          </div>
        </article>
      </main>
    </div>
  );
}
