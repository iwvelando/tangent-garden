import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ParameterAtlas,
  atlasBudget,
  atlasGridSize,
  rememberAtlasGridSize,
  atlasPairs,
  atlasPair,
  atlasPreviewConfig,
  type AtlasSize,
  type AtlasPairId,
  atlasDefaults,
  atlasRangeError,
  atlasRangeHelp,
  atlasControlHelp,
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
import { refinesBetweenSamples, type Frame } from "./types";
import type { JourneyVia } from "./JourneyContext";
import "./atlas.css";
import { atlasSharedFrame } from "./atlas-framing";

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
  const pairs = useMemo(() => atlasPairs(study.config), [study]);
  // Entry admits only supported studies; without a pair, the scheduler
  // refuses and the dialog shows why rather than failing to render.
  const [pair, setPair] = useState<AtlasPairId>(
    () => pairs[0]?.id ?? "roulette",
  );
  const descriptor = atlasPair(pair);
  const [size, setSize] = useState<AtlasSize>(atlasGridSize);
  const [framing, setFraming] = useState("independent");
  const preview = useMemo(
    () => atlasPreviewConfig(study.config, size),
    [study, size],
  );
  const quality = (config: typeof study.config) =>
    config.curve.format === "attractor"
      ? `${config.curve.attractor.iterates.toLocaleString("en-US")} accumulated iterates, ${config.curve.attractor.discard.toLocaleString("en-US")} discarded, grid up to ${config.curve.attractor.cells} × ${config.curve.attractor.cells} bins, ${config.lines} orbit segments`
      : `${config.samples.toLocaleString("en-US")} samples, ${config.lines} construction lines, refinement ${config.adaptive && refinesBetweenSamples(config.curve.format) ? "on" : "off"}`;
  const [ranges, setRanges] = useState<AtlasRanges>(() =>
    atlasDefaults(study.config),
  );
  const [state, setState] = useState<AtlasState>({
    cells: [],
    selection: null,
    queued: 0,
  });
  const scheduler = useRef<ParameterAtlas | null>(null);
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
  const rangeError = atlasRangeError(ranges, pair);
  const budget = atlasBudget(study.config, size);
  // Range expressions are evaluated by the atlas's own worker. Once it has
  // failed, their errors are that failure, shown once below, not the fields'.
  const failure = state.failed
    ? null
    : invalid
      ? { label: invalid.name, message: `${invalid.name}: ${invalid.error}` }
      : rangeError;
  const blocked =
    editing || pending || !!failure || !!budget.error || !!state.failed;
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
    const atlas = new ParameterAtlas(engine, setState);
    scheduler.current = atlas;
    atlas.generate(study, atlasDefaults(study.config, pair), { pair, size });
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
  const focusStage = useRef<number | null>(null);
  const select = (index: number) => {
    // Establish the candidate's full-quality fit before refining to its manual
    // camera. A capped thumbnail can have different extrema or refined reach.
    focusStage.current =
      study.config.adaptive &&
      refinesBetweenSamples(study.config.curve.format) &&
      study.config.adaptiveView &&
      study.camera.zoom > 1
        ? index
        : null;
    scheduler.current?.inspect(index);
    gridScroll.current = dialog.current?.scrollTop ?? 0;
    setTab("variant");
  };
  useLayoutEffect(() => {
    const selected = state.selection;
    if (!selected?.frame || focusStage.current !== selected.index) return;
    focusStage.current = null;
    scheduler.current?.inspect(
      selected.index,
      viewRect(inspectedFraming(selected.frame, study)),
    );
  }, [state.selection]);
  const sharedFrame = useMemo(
    () => (framing === "shared" ? atlasSharedFrame(state.cells) : undefined),
    [framing, state.cells],
  );
  const selected = state.selection;
  const frame =
    focusStage.current === selected?.index ? undefined : selected?.frame;
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
            <div className="eyebrow">
              PARAMETER ATLAS · {size} × {size}
            </div>
            <h2 id={title}>A field of possible flowers</h2>
          </div>
          <button ref={back} type="button" onClick={() => finish()}>
            Cancel atlas
          </button>
        </div>
        <NotebookMode />
        <p className="note">
          Your study stays here until you adopt a variant.{" "}
          {descriptor.axes[0].label} runs across columns;{" "}
          {descriptor.axes[1].label.toLowerCase()} runs down rows.
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
              <Field label="Parameter pair" help={atlasControlHelp.pair}>
                <select
                  value={pair}
                  onChange={(event) => {
                    const next = event.target.value as AtlasPairId;
                    if (next === pair) return;
                    generation.current++;
                    editRanges();
                    setScalars({});
                    setPair(next);
                    setRanges(atlasDefaults(study.config, next));
                  }}
                >
                  {pairs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="pair">
                <Field label="Grid size" help={atlasControlHelp.size}>
                  <select
                    value={size}
                    onChange={(event) => {
                      const next = Number(event.target.value) as AtlasSize;
                      if (next === size) return;
                      editRanges();
                      rememberAtlasGridSize(next);
                      setSize(next);
                    }}
                  >
                    <option value="3">3 × 3</option>
                    <option value="5">5 × 5</option>
                  </select>
                </Field>
                <Field label="Framing" help={atlasControlHelp.framing}>
                  <select
                    value={framing}
                    onChange={(event) => setFraming(event.target.value)}
                  >
                    <option value="independent">Fit each variant</option>
                    <option value="shared">Use one common scale</option>
                  </select>
                </Field>
              </div>
              <ScalarStatus.Provider value={status}>
                <FieldErrorContext.Provider
                  value={{
                    ...failure,
                    message: failure?.message ?? "",
                    claim: () => {},
                    touch: () => {},
                  }}
                >
                  <div
                    className="atlas-ranges"
                    key={pair}
                    onChangeCapture={editRanges}
                  >
                    {descriptor.axes.map(({ key, label }) => (
                      <div className="pair" key={key}>
                        {([0, 1] as const).map((index) => {
                          const name = `${label} ${index === 0 ? "from" : "to"}`;
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
                onClick={() =>
                  scheduler.current?.generate(study, ranges, { pair, size })
                }
              >
                Generate atlas
              </button>
              <p className="atlas-feedback" role="status">
                {state.cells.length
                  ? `${state.cells.filter((c) => c.frame || c.error).length} of ${size * size} variants ready.`
                  : `Set ranges, then generate ${size * size} variants.`}
              </p>
              {(budget.error || state.error) && (
                <p role="alert" className="field-error">
                  {budget.error ?? state.error}
                </p>
              )}
              <p className="note">
                {framing === "shared"
                  ? "Shared framing"
                  : "Independent framing"}
              </p>
              <p className="note atlas-quality">
                Preview quality: {quality(preview)}. Inspect at original quality
                before adoption.
              </p>
              <p className="note">Original quality: {quality(study.config)}.</p>
              <details>
                <summary>Atlas limits</summary>
                <p className="note">
                  At most 25 previews and one inspection, one calculation in
                  flight and 25 unsent requests. Up to 80,000 uniform samples,
                  2,560 construction lines, 500,000 reserved path points and 80
                  million weighted work units. Clifford densities reserve at
                  most 20 million evaluated iterations and two million bins.
                  Retained geometry is limited to four million numbers.
                </p>
              </details>
            </div>
            <div className="atlas-grid-scroll">
              <div
                className="atlas-grid"
                data-size={size}
                role="group"
                aria-label={`${descriptor.label} variants`}
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
                      aria-label={`Inspect row ${Math.floor(index / size) + 1}, column ${(index % size) + 1}`}
                      onClick={() => select(index)}
                      onKeyDown={(event) => {
                        const step =
                          event.key === "ArrowRight"
                            ? 1
                            : event.key === "ArrowLeft"
                              ? -1
                              : event.key === "ArrowDown"
                                ? size
                                : event.key === "ArrowUp"
                                  ? -size
                                  : 0;
                        if (
                          !step &&
                          event.key !== "Home" &&
                          event.key !== "End"
                        )
                          return;
                        event.preventDefault();
                        const buttons = event.currentTarget
                          .closest(".atlas-grid")!
                          .querySelectorAll<HTMLButtonElement>(
                            ".atlas-cell > button",
                          );
                        let target =
                          event.key === "Home"
                            ? 0
                            : event.key === "End"
                              ? buttons.length - 1
                              : index + step;
                        const direction =
                          step || (event.key === "Home" ? 1 : -1);
                        while (target >= 0 && target < buttons.length) {
                          if (!buttons[target].disabled) {
                            buttons[target].focus();
                            break;
                          }
                          target += direction;
                        }
                      }}
                    >
                      {cell.frame ? (
                        <div className="atlas-art" inert>
                          <Plot
                            id={`atlas-cell-${index}`}
                            framing={sharedFrame}
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
                        {descriptor.axes[0].symbol} = {short(cell.values[0])}
                        <br />
                        {descriptor.axes[1].symbol} = {short(cell.values[1])}
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
                    Inspect variant · row{" "}
                    {Math.floor(selected.index / size) + 1}, column{" "}
                    {(selected.index % size) + 1}
                  </h3>
                  <p className="note">
                    {descriptor.axes[0].symbol} ={" "}
                    {cell && short(cell.values[0])} ·{" "}
                    {descriptor.axes[1].symbol} ={" "}
                    {cell && short(cell.values[1])} · Original quality and
                    manual camera
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
