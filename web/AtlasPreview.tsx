import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AtlasRangeFields,
  AtlasTabs,
  atlasCellKeyDown,
  useAtlasModal,
  useAtlasRanges,
  useAtlasTabs,
} from "./atlas-dialog";
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
  atlasControlHelp,
  type AtlasRanges,
  type AtlasState,
} from "./atlas";
import type { AtlasRequest } from "./AtlasContext";
import { EngineClient } from "./engine-client";
import { Field } from "./Field";
import { NotebookMode } from "./NotebookMode";
import { Plot, fitFrame, viewRect } from "./Plot";
import type { PlanarStudy } from "./planar-link";
import { probeSample, sampleProbe } from "./planar-probe";
import { useQuietFocus } from "./quiet-focus";
import { useTheme } from "./useTheme";
import { refinesBetweenSamples, type Frame } from "./types";
import type { JourneyVia } from "./JourneyContext";
import "./atlas.css";
import { atlasSharedFrame } from "./atlas-framing";
import { AtlasSheetExport } from "./AtlasSheetExport";
import { sheetSvg } from "./atlas-sheet";
import { renderToStaticMarkup } from "react-dom/server";
import { planarSheetDefinition } from "./planar-sheet-definition";

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
  const tabsId = useId();
  const quiet = useQuietFocus(dialog);
  const via = useRef(request.via);
  const title = useId();
  const facts = request.facts;
  const pairs = useMemo(() => atlasPairs(study.config, facts), [study, facts]);
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
      : config.curve.format === "implicit"
        ? `${config.curve.implicit.cells.toLocaleString("en-US")} grid cells along the window's longer side, ${config.lines} construction lines`
        : `${config.samples.toLocaleString("en-US")} samples, ${config.lines} construction lines, refinement ${config.adaptive && refinesBetweenSamples(config.curve.format) ? "on" : "off"}`;
  const [ranges, setRanges] = useState<AtlasRanges>(() =>
    atlasDefaults(study.config, pair),
  );
  const [state, setState] = useState<AtlasState>({
    cells: [],
    selection: null,
    queued: 0,
  });
  const scheduler = useRef<ParameterAtlas | null>(null);
  const tabs = useAtlasTabs(dialog, state.selection !== null, quiet);
  const { tab } = tabs;
  const scalars = useAtlasRanges(() => scheduler.current?.cancel());
  const { client, generation, pending, invalid, editing } = scalars;
  const rangeError = atlasRangeError(ranges, pair, size);
  const budget = atlasBudget(study.config, size, facts);
  // Range expressions are evaluated by the atlas's own worker. Once it has
  // failed, their errors are that failure, shown once below, not the fields'.
  const failure = state.failed
    ? null
    : invalid
      ? { label: invalid.name, message: `${invalid.name}: ${invalid.error}` }
      : rangeError;
  const blocked =
    editing || pending || !!failure || !!budget.error || !!state.failed;
  useEffect(() => {
    const engine = new EngineClient();
    client.current = engine;
    const atlas = new ParameterAtlas(engine, setState);
    scheduler.current = atlas;
    atlas.generate(study, atlasDefaults(study.config, pair), {
      pair,
      size,
      facts,
    });
    return () => {
      generation.current++;
      atlas.cancel();
      engine.dispose();
    };
  }, []);
  useAtlasModal(dialog, back, request.via, quiet);
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
    tabs.showVariant();
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
  // A fit of arriving subsets moves every completed member. Reveal the
  // shared-scale artwork once, after valid and unavailable outcomes settle.
  // Inspection still uses each finished member immediately.
  const gridComplete =
    state.cells.length > 0 && state.cells.every((c) => c.frame || c.error);
  const waitingForSharedFrame = framing === "shared" && !gridComplete;
  const sharedFrame = useMemo(
    () =>
      framing === "shared" && gridComplete
        ? atlasSharedFrame(state.cells)
        : undefined,
    [framing, state.cells, gridComplete],
  );
  const selected = state.selection;
  const frame =
    focusStage.current === selected?.index ? undefined : selected?.frame;
  const cell = selected && state.cells[selected.index];
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
        <AtlasTabs
          id={tabsId}
          tab={tab}
          selected={!!selected}
          buttons={tabs.buttons}
          activate={tabs.activate}
        />
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
                    scalars.forget();
                    scalars.edit();
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
                      scalars.edit();
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
              <AtlasRangeFields
                pairKey={pair}
                axes={descriptor.axes}
                ranges={ranges}
                setRanges={setRanges}
                failure={failure}
                scalars={scalars}
              />
              <button
                type="button"
                disabled={blocked}
                onClick={() =>
                  scheduler.current?.generate(study, ranges, {
                    pair,
                    size,
                    facts,
                  })
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
                {framing === "shared" ? (
                  <>
                    <span>Shared framing</span>. Artwork appears once every
                    variant has finished.
                  </>
                ) : (
                  "Independent framing"
                )}
              </p>
              <p className="note atlas-quality">
                Preview quality: {quality(preview)}.{" "}
                {preview.curve.format === "implicit" &&
                  preview.curve.implicit.cells <
                    study.config.curve.implicit.cells &&
                  "A coarser grid can join or split contours near a saddle. "}
                Inspect at original quality before adoption.
              </p>
              <p className="note">Original quality: {quality(study.config)}.</p>
              <AtlasSheetExport
                cells={state.cells}
                size={size}
                disabled={blocked}
                notebook="2d"
                source={study}
                preview={preview}
                axes={descriptor.axes}
                framing={framing}
                dark={theme.dark}
                scheme={theme.scheme}
                definition={(format) => planarSheetDefinition(preview, format)}
                painter={() => ({
                  draw: async (frame, page, signal, index) => {
                    signal.throwIfAborted();
                    return sheetSvg(
                      renderToStaticMarkup(
                        <Plot
                          id={`atlas-sheet-${index}`}
                          framing={sharedFrame}
                          {...frame}
                          layers={study.layers}
                          weight={study.weight}
                          dark={theme.dark}
                          scheme={theme.scheme}
                          length={study.length}
                          stop={study.stop}
                          reset={0}
                        />,
                      ),
                      page,
                    );
                  },
                  dispose() {},
                })}
              />
              <details>
                <summary>Atlas limits</summary>
                <p className="note">
                  At most 25 previews and one inspection, one calculation in
                  flight and 25 unsent requests. Up to 80,000 uniform samples,
                  2,560 construction lines, 500,000 reserved path points and 80
                  million weighted work units. Map densities reserve at most 20
                  million evaluated iterations and two million bins. Implicit
                  previews use at most 256 grid cells (160 for 5 × 5), and grids
                  reserve at most two million evaluations of F. Retained
                  geometry is limited to four million numbers.
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
                      onKeyDown={(event) =>
                        atlasCellKeyDown(event, index, size)
                      }
                    >
                      {cell.frame && !waitingForSharedFrame ? (
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
                          {cell.error
                            ? "Unavailable"
                            : cell.frame
                              ? "Waiting for shared scale"
                              : "Pending"}
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
