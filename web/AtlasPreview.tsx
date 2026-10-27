import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  RouletteAtlas,
  atlasBudget,
  atlasDefaults,
  atlasRangeError,
  atlasRangeHelp,
  type AtlasRanges,
  type AtlasState,
} from "./atlas";
import type { AtlasRequest } from "./AtlasContext";
import { EngineClient } from "./engine-client";
import { Field, FieldErrorContext } from "./Field";
import { NotebookMode } from "./NotebookMode";
import { Plot, fitFrame, viewRect } from "./Plot";
import type { PlanarStudy } from "./planar-link";
import { probeSample, sampleProbe } from "./planar-probe";
import { ScalarInput, ScalarStatus, type ScalarState } from "./ScalarInput";
import { useQuietFocus } from "./quiet-focus";
import { useTheme } from "./useTheme";
import type { Frame } from "./types";
import type { JourneyVia } from "./JourneyContext";
import "./atlas.css";

type AtlasTab = "grid" | "variant";
const short = (value: number) => Number(value.toPrecision(5)).toString();
function inspectedFraming(frame: Frame, study: PlanarStudy) {
  const fit = fitFrame(frame.result, frame.config);
  const { x, y, zoom } = study.camera;
  const scale = fit.scale * zoom;
  return {
    cx: fit.cx - x / scale,
    cy: fit.cy + y / scale,
    scale,
    span: fit.span / zoom,
  };
}

export function AtlasPreview({
  request,
  onReturn,
  onAdopt,
}: {
  request: AtlasRequest;
  onReturn: (via: JourneyVia) => void;
  onAdopt: (study: PlanarStudy, via: JourneyVia) => void;
}) {
  const study = request.study;
  const theme = useTheme();
  const dialog = useRef<HTMLDialogElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const tabButtons = useRef<
    Partial<Record<AtlasTab, HTMLButtonElement | null>>
  >({});
  const gridScroll = useRef(0);
  const [tab, setTab] = useState<AtlasTab>("grid");
  const tabsId = useId();
  const [editing, setEditing] = useState(false);
  const editTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const quiet = useQuietFocus(dialog);
  const via = useRef(request.via);
  const title = useId();
  const [ranges, setRanges] = useState<AtlasRanges>(() =>
    atlasDefaults(study.config),
  );
  const [state, setState] = useState<AtlasState>({
    cells: [],
    selection: null,
    queued: 0,
  });
  const scheduler = useRef<RouletteAtlas | null>(null);
  const client = useRef<EngineClient | null>(null);
  const [scalars, setScalars] = useState<Record<string, ScalarState>>({});
  const generation = useRef(0);
  const status = useMemo(
    () => ({
      client,
      generation,
      track: () => {},
      report: (id: string, value: ScalarState | null) =>
        setScalars((previous) => {
          const next = { ...previous };
          if (value) next[id] = value;
          else delete next[id];
          return next;
        }),
    }),
    [],
  );
  const pending = Object.values(scalars).some((s) => s.pending);
  const invalid = Object.values(scalars).find((s) => s.error);
  const rangeError = atlasRangeError(ranges);
  const budget = atlasBudget(study.config);
  const failure = invalid
    ? { label: invalid.name, message: `${invalid.name}: ${invalid.error}` }
    : rangeError;
  const blocked = editing || pending || !!failure || !!budget.error;
  useEffect(() => () => clearTimeout(editTimer.current), []);
  const editRanges = () => {
    scheduler.current?.cancel();
    setEditing(true);
    clearTimeout(editTimer.current);
    editTimer.current = setTimeout(() => setEditing(false), 300);
  };
  useEffect(() => {
    const engine = new EngineClient();
    client.current = engine;
    const atlas = new RouletteAtlas(engine, setState);
    scheduler.current = atlas;
    atlas.generate(study, atlasDefaults(study.config));
    return () => {
      generation.current++;
      atlas.cancel();
      engine.dispose();
    };
  }, []);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const { scrollX: x, scrollY: y } = window;
    root.classList.add("atlas-open");
    return () => {
      root.classList.remove("atlas-open");
      if (window.scrollX !== x || window.scrollY !== y) window.scrollTo(x, y);
    };
  }, []);
  useEffect(() => {
    if (request.via === "pointer") quiet.onPointerDown();
    dialog.current!.showModal();
    quiet.quiet();
    back.current!.focus();
  }, []);
  // Fit the modal above iOS's keyboard and scroll only its own contents.
  useEffect(() => {
    const viewport = window.visualViewport;
    const box = dialog.current!;
    if (!viewport) return;
    const phone = matchMedia("(max-width: 700px)");
    let focused = -Infinity;
    let timer = 0;
    const fit = () => {
      if (phone.matches && Math.abs(viewport.scale - 1) < 0.01) {
        box.style.top = `${Math.max(0, viewport.offsetTop)}px`;
        box.style.height = box.style.maxHeight = `${viewport.height}px`;
      } else box.style.top = box.style.height = box.style.maxHeight = "";
      if (performance.now() - focused > 1000) return;
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        const active = document.activeElement;
        if (!(active instanceof HTMLElement) || !box.contains(active)) return;
        const target = (
          active.closest(".field") ?? active
        ).getBoundingClientRect();
        const frame = box.getBoundingClientRect();
        if (target.top < frame.top + 8)
          box.scrollTop += target.top - frame.top - 8;
        else if (target.bottom > frame.bottom - 8)
          box.scrollTop += target.bottom - frame.bottom + 8;
      }, 150);
    };
    const focus = () => {
      focused = performance.now();
      fit();
    };
    fit();
    viewport.addEventListener("resize", fit);
    viewport.addEventListener("scroll", fit);
    phone.addEventListener("change", fit);
    box.addEventListener("focusin", focus);
    return () => {
      clearTimeout(timer);
      viewport.removeEventListener("resize", fit);
      viewport.removeEventListener("scroll", fit);
      phone.removeEventListener("change", fit);
      box.removeEventListener("focusin", focus);
    };
  }, []);
  const ending = useRef(false);
  const finish = (action = () => onReturn(via.current)) => {
    if (ending.current) return;
    ending.current = true;
    scheduler.current?.cancel();
    dialog.current?.close();
    action();
  };
  const select = (index: number) => {
    const frame = state.cells[index].frame!;
    const view =
      study.config.adaptive &&
      study.config.adaptiveView &&
      study.camera.zoom > 1
        ? viewRect(inspectedFraming(frame, study))
        : undefined;
    scheduler.current?.inspect(index, view);
    gridScroll.current = dialog.current?.scrollTop ?? 0;
    setTab("variant");
  };
  const selected = state.selection;
  const frame = selected?.frame;
  const cell = selected && state.cells[selected.index];
  const activateTab = (next: AtlasTab) => {
    if (next === tab || (next === "variant" && !selected)) return;
    if (tab === "grid") gridScroll.current = dialog.current?.scrollTop ?? 0;
    setTab(next);
  };
  useLayoutEffect(() => {
    if (tab === "variant" && !selected) {
      gridScroll.current = 0;
      setTab("grid");
    }
  }, [tab, selected !== null]);
  useLayoutEffect(() => {
    quiet.quiet();
    tabButtons.current[tab]?.focus({ preventScroll: true });
    if (dialog.current)
      dialog.current.scrollTop = tab === "grid" ? gridScroll.current : 0;
  }, [tab]);
  return (
    <dialog
      ref={dialog}
      className="atlas"
      aria-labelledby={title}
      onCancel={(e) => {
        e.preventDefault();
        finish();
      }}
      onPointerDown={() => {
        via.current = "pointer";
        quiet.onPointerDown();
      }}
      onKeyDownCapture={() => {
        via.current = "keyboard";
        quiet.onKeyDownCapture();
      }}
    >
      <div className="atlas-body">
        <div className="atlas-heading">
          <div>
            <div className="eyebrow">PARAMETER ATLAS · 3 × 3</div>
            <h2 id={title}>A field of possible flowers</h2>
          </div>
          <button ref={back} type="button" onClick={() => finish()}>
            Cancel atlas
          </button>
        </div>
        <NotebookMode />
        <p className="note">
          Your study stays here until you adopt a variant. Radius runs across
          columns; tracing distance runs down rows.
        </p>
        <div className="atlas-tabs" role="tablist" aria-label="Atlas views">
          {(["grid", "variant"] as const).map((key) => (
            <button
              key={key}
              ref={(button) => {
                tabButtons.current[key] = button;
              }}
              type="button"
              role="tab"
              id={`${tabsId}-${key}-tab`}
              aria-controls={`${tabsId}-${key}-panel`}
              aria-selected={tab === key}
              tabIndex={tab === key ? 0 : -1}
              disabled={key === "variant" && !selected}
              onClick={() => activateTab(key)}
              onKeyDown={(event) => {
                const keys: AtlasTab[] = selected
                  ? ["grid", "variant"]
                  : ["grid"];
                const index = keys.indexOf(key);
                const target =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? keys.length - 1
                      : event.key === "ArrowRight"
                        ? (index + 1) % keys.length
                        : event.key === "ArrowLeft"
                          ? (index + keys.length - 1) % keys.length
                          : null;
                if (target === null) return;
                event.preventDefault();
                activateTab(keys[target]);
              }}
            >
              {key === "grid" ? "Atlas grid" : "Selected variant"}
            </button>
          ))}
        </div>
        <div
          role="tabpanel"
          id={`${tabsId}-grid-panel`}
          aria-labelledby={`${tabsId}-grid-tab`}
          hidden={tab !== "grid"}
        >
          <div className="atlas-layout">
            <div className="atlas-controls">
              <ScalarStatus.Provider value={status}>
                <FieldErrorContext.Provider
                  value={{
                    ...failure,
                    message: failure?.message ?? "",
                    claim: () => {},
                    touch: () => {},
                  }}
                >
                  <div className="atlas-ranges" onChangeCapture={editRanges}>
                    {(["radius", "arm"] as const).map((key) => (
                      <div className="pair" key={key}>
                        {([0, 1] as const).map((index) => {
                          const name = `${key === "radius" ? "Rolling radius" : "Tracing distance"} ${index === 0 ? "from" : "to"}`;
                          return (
                            <Field
                              key={index}
                              label={name}
                              help={index === 0 ? atlasRangeHelp : undefined}
                            >
                              <ScalarInput
                                name={name}
                                value={ranges[key][index]}
                                onChange={(value) =>
                                  setRanges((previous) => {
                                    const pair = [...previous[key]] as [
                                      number,
                                      number,
                                    ];
                                    pair[index] = value;
                                    return { ...previous, [key]: pair };
                                  })
                                }
                              />
                            </Field>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </FieldErrorContext.Provider>
              </ScalarStatus.Provider>
              <button
                type="button"
                disabled={blocked}
                onClick={() => scheduler.current?.generate(study, ranges)}
              >
                Generate atlas
              </button>
              <p className="atlas-feedback" role="status">
                {state.cells.length
                  ? `${state.cells.filter((c) => c.frame || c.error).length} of 9 variants ready.`
                  : "Set ranges, then generate nine variants."}
              </p>
              {(budget.error || state.error) && (
                <p role="alert" className="field-error">
                  {budget.error ?? state.error}
                </p>
              )}
              <p className="note">Independent framing</p>
              <p className="note">
                Original quality: {study.config.samples.toLocaleString("en-US")}{" "}
                samples, {study.config.lines} construction lines, refinement{" "}
                {study.config.adaptive ? "on" : "off"}.
              </p>
              <details>
                <summary>Atlas limits</summary>
                <p className="note">
                  Nine previews and one inspection. At most 80,000 total uniform
                  samples, 2,560 construction lines, 500,000 reserved path
                  points and 80 million weighted work units. Delivered geometry
                  is limited to four million numbers. Quality is never lowered.
                </p>
              </details>
            </div>
            <div>
              <div
                className="atlas-grid"
                role="group"
                aria-label="Roulette variants"
              >
                {state.cells.map((cell, index) => (
                  <div
                    className="atlas-cell"
                    key={index}
                    data-state={
                      cell.frame ? "valid" : cell.error ? "invalid" : "pending"
                    }
                  >
                    <button
                      type="button"
                      disabled={!cell.frame || blocked}
                      aria-pressed={selected?.index === index}
                      aria-label={`Inspect row ${Math.floor(index / 3) + 1}, column ${(index % 3) + 1}`}
                      onClick={() => select(index)}
                    >
                      {cell.frame ? (
                        <div className="atlas-art" inert>
                          <Plot
                            id={`atlas-cell-${index}`}
                            result={cell.frame.result}
                            config={cell.frame.config}
                            layers={study.layers}
                            weight={study.weight}
                            dark={theme.dark}
                            scheme={theme.scheme}
                            length={study.length}
                            stop={study.stop}
                            reset={0}
                          />
                        </div>
                      ) : (
                        <div className="atlas-placeholder">
                          {cell.error ? "Unavailable" : "Pending"}
                        </div>
                      )}
                      <span className="atlas-values">
                        r = {short(cell.radius)}
                        <br />d = {short(cell.arm)}
                      </span>
                    </button>
                    {cell.error && <p className="field-error">{cell.error}</p>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div
          role="tabpanel"
          id={`${tabsId}-variant-panel`}
          aria-labelledby={`${tabsId}-variant-tab`}
          hidden={tab !== "variant"}
        >
          {selected && (
            <section
              className="atlas-inspection"
              aria-label="Full-quality inspection"
              aria-busy={!frame && !selected.error}
            >
              <div className="atlas-inspection-header">
                <div>
                  <h3>
                    Inspect variant · row {Math.floor(selected.index / 3) + 1},
                    column {(selected.index % 3) + 1}
                  </h3>
                  <p className="note">
                    r = {cell && short(cell.radius)} · d ={" "}
                    {cell && short(cell.arm)} · Original quality and manual
                    camera
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!frame || blocked}
                  onClick={() => {
                    const candidate = scheduler.current?.candidate();
                    if (candidate)
                      finish(() => onAdopt(candidate, via.current));
                  }}
                >
                  Adopt variant
                </button>
              </div>
              {frame ? (
                <div className="atlas-inspected-art" inert>
                  <Plot
                    id="atlas-inspected"
                    result={frame.result}
                    config={frame.config}
                    layers={study.layers}
                    weight={study.weight}
                    probe={
                      study.probe.enabled
                        ? (frame.result.probe ??
                          sampleProbe(
                            frame.result,
                            probeSample(frame.result, study.probe) ?? 0,
                          ) ??
                          undefined)
                        : undefined
                    }
                    dark={theme.dark}
                    scheme={theme.scheme}
                    length={study.length}
                    stop={study.stop}
                    reset={0}
                    framing={inspectedFraming(frame, study)}
                  />
                </div>
              ) : (
                <p>
                  {selected.error ?? "Calculating this variant independently…"}
                </p>
              )}
            </section>
          )}
        </div>
      </div>
    </dialog>
  );
}
