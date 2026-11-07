// The 3D notebook's parameter atlas (atlas.ts), shown over the notebook as
// the planar atlas is: the shared dialog shell (../atlas-dialog.tsx), its
// cells drawn as the notebook draws by atlas-paint.ts.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  AtlasRangeFields,
  AtlasTabs,
  atlasCellKeyDown,
  useAtlasModal,
  useAtlasRanges,
  useAtlasTabs,
} from "../atlas-dialog";
import {
  atlasControlHelp,
  atlasGridSize,
  rememberAtlasGridSize,
} from "../atlas";
import type { AtlasRanges, AtlasSize } from "../atlas-queue";
import type { SpatialAtlasRequest } from "../AtlasContext";
import { EngineClient } from "../engine-client";
import { Field } from "../Field";
import type { JourneyVia } from "../JourneyContext";
import { NotebookMode } from "../NotebookMode";
import { useQuietFocus } from "../quiet-focus";
import { useTheme } from "../useTheme";
import "../atlas.css";
import {
  SpatialAtlas,
  spatialAtlasBudget,
  spatialAtlasDefaults,
  spatialAtlasPair,
  spatialAtlasPairs,
  spatialAtlasRangeError,
  spatialPreviewConfig,
  type SpatialAtlasState,
  type SpatialPairId,
} from "./atlas";
import {
  AtlasPainter,
  inspectionPage,
  previewPages,
  sharedBounds,
  type PaintStyle,
  type Painted,
  type Slot,
} from "./atlas-paint";
import type { SpatialStudy } from "./link";
import type { SpatialConfig } from "./types";

const short = (value: number) => Number(value.toPrecision(5)).toString();
const count = (n: number) => n.toLocaleString("en-US");
function quality(config: SpatialConfig) {
  if (config.format === "surface")
    return `${count(config.surface.uSamples)} × ${count(config.surface.vSamples)} grid cells`;
  return `${count(config.samples)} samples, ${config.lines} rulings, refinement ${config.adaptive ? "on" : "off"}`;
}

export default function SpatialAtlasPreview({
  request,
  onReturn,
  onAdopt,
}: {
  request: SpatialAtlasRequest;
  onReturn: (via: JourneyVia) => void;
  onAdopt: (study: SpatialStudy, via: JourneyVia) => void;
}) {
  const study = request.study;
  const theme = useTheme();
  const dialog = useRef<HTMLDialogElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const tabsId = useId();
  const title = useId();
  const quiet = useQuietFocus(dialog);
  const via = useRef(request.via);
  const pairs = useMemo(() => spatialAtlasPairs(study.config), [study]);
  const [pair, setPair] = useState<SpatialPairId>(
    () => pairs[0]?.id ?? "windings",
  );
  const descriptor = spatialAtlasPair(pair);
  const [size, setSize] = useState<AtlasSize>(atlasGridSize);
  const [framing, setFraming] = useState("independent");
  const preview = useMemo(
    () => spatialPreviewConfig(study.config, size),
    [study, size],
  );
  const [ranges, setRanges] = useState<AtlasRanges>(() =>
    spatialAtlasDefaults(study.config, pair),
  );
  const [state, setState] = useState<SpatialAtlasState>({
    cells: [],
    selection: null,
    queued: 0,
  });
  const scheduler = useRef<SpatialAtlas | null>(null);
  const tabs = useAtlasTabs(dialog, state.selection !== null, quiet);
  const scalars = useAtlasRanges(() => scheduler.current?.cancel());
  const rangeError = spatialAtlasRangeError(ranges, pair, size);
  const budget = spatialAtlasBudget(study.config, size);
  // Once the atlas's worker has failed, its range errors are that failure.
  const failure = state.failed
    ? null
    : scalars.invalid
      ? {
          label: scalars.invalid.name,
          message: `${scalars.invalid.name}: ${scalars.invalid.error}`,
        }
      : rangeError;
  const blocked =
    scalars.editing ||
    scalars.pending ||
    !!failure ||
    !!budget.error ||
    !!state.failed;

  // Drawings: the latest image or failure of each cell and the inspection.
  const painter = useRef<AtlasPainter | null>(null);
  const [images, setImages] = useState<Partial<Record<Slot, Painted>>>({});
  const clearImage = (slot: Slot) => {
    painter.current?.clear(slot);
    setImages((previous) => {
      if (!(slot in previous)) return previous;
      const next = { ...previous };
      delete next[slot];
      return next;
    });
  };
  useEffect(() => {
    const engine = new EngineClient();
    scalars.client.current = engine;
    const atlas = new SpatialAtlas(engine, setState);
    scheduler.current = atlas;
    const paint = new AtlasPainter((slot, painted) =>
      setImages((previous) => ({ ...previous, [slot]: painted })),
    );
    painter.current = paint;
    atlas.generate(study, spatialAtlasDefaults(study.config, pair), {
      pair,
      size,
    });
    return () => {
      scalars.generation.current++;
      atlas.cancel();
      engine.dispose();
      paint.dispose();
    };
  }, []);
  useAtlasModal(dialog, back, request.via, quiet);
  const style: PaintStyle = useMemo(
    () => ({
      camera: study.view,
      projection: study.projection,
      lensAngle: study.lensAngle,
      layers: study.layers,
      cut: study.cut,
      sight: study.sight,
      dark: theme.dark,
      scheme: theme.scheme,
    }),
    [study, theme.dark, theme.scheme],
  );
  // Shared-scale artwork waits for every outcome, then appears at one
  // common sphere; independent fits appear as they arrive.
  const gridComplete =
    state.cells.length > 0 && state.cells.every((c) => c.frame || c.error);
  const waitingForSharedFrame = framing === "shared" && !gridComplete;
  const shared = useMemo(
    () =>
      framing === "shared" && gridComplete
        ? sharedBounds(
            state.cells.flatMap((c) =>
              c.frame ? [c.frame.result.bounds] : [],
            ),
          )
        : undefined,
    [framing, state.cells, gridComplete],
  );
  const [shownCells, setShownCells] = useState(0);
  useEffect(() => {
    const paint = painter.current;
    if (!paint) return;
    state.cells.forEach((cell, index) => {
      if (!cell.frame || waitingForSharedFrame) clearImage(index);
      else
        paint.request(
          index,
          cell.frame.result,
          shared ?? cell.frame.result.bounds,
          style,
          previewPages[size],
        );
    });
    for (let index = state.cells.length; index < shownCells; index++)
      clearImage(index);
    setShownCells(state.cells.length);
  }, [state.cells, shared, waitingForSharedFrame, style, size]);
  const selected = state.selection;
  useEffect(() => {
    const frame = selected?.frame;
    if (!frame) clearImage("inspection");
    else
      painter.current?.request(
        "inspection",
        frame.result,
        frame.result.bounds,
        style,
        inspectionPage,
      );
  }, [selected, style]);

  const ending = useRef(false);
  const finish = (action = () => onReturn(via.current)) => {
    if (ending.current) return;
    ending.current = true;
    scheduler.current?.cancel();
    dialog.current?.close();
    action();
  };
  const select = (index: number) => {
    scheduler.current?.inspect(index);
    tabs.showVariant();
  };
  const cell = selected && state.cells[selected.index];
  const inspection = images.inspection;
  const capped =
    preview.format === "surface"
      ? preview.surface.uSamples < study.config.surface.uSamples ||
        preview.surface.vSamples < study.config.surface.vSamples
      : false;
  return (
    <dialog
      ref={dialog}
      className="atlas spatial-atlas"
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
              PARAMETER ATLAS · 3D · {size} × {size}
            </div>
            <h2 id={title}>A field of possible forms</h2>
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
          tab={tabs.tab}
          selected={!!selected}
          buttons={tabs.buttons}
          activate={tabs.activate}
        />
        <div
          role="tabpanel"
          id={`${tabsId}-grid-panel`}
          aria-labelledby={`${tabsId}-grid-tab`}
          hidden={tabs.tab !== "grid"}
        >
          <div className="atlas-layout">
            <div className="atlas-controls">
              <Field label="Parameter pair" help={atlasControlHelp.pair}>
                <select
                  value={pair}
                  onChange={(event) => {
                    const next = event.target.value as SpatialPairId;
                    if (next === pair) return;
                    scalars.forget();
                    scalars.edit();
                    setPair(next);
                    setRanges(spatialAtlasDefaults(study.config, next));
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
                {framing === "shared" ? (
                  <>
                    <span>Shared framing</span>: one sphere holds every variant.
                    Artwork appears once every variant has finished.
                  </>
                ) : (
                  "Independent framing: each variant about its own bounds."
                )}{" "}
                Every cell keeps your camera, cut and sight.
              </p>
              <p className="note atlas-quality">
                Preview quality: {quality(preview)}.{" "}
                {capped &&
                  "A coarser grid can blur focal-sheet folds near umbilics. "}
                Inspect at original quality before adoption.
              </p>
              <p className="note">Original quality: {quality(study.config)}.</p>
              <details>
                <summary>Atlas limits</summary>
                <p className="note">
                  At most 25 previews and one inspection, one calculation in
                  flight and 25 unsent requests. Knot previews use at most 480
                  samples and 48 rulings (240 and 24 for 5 × 5); ellipsoid
                  previews at most 72 × 72 grid cells (48 × 48). Knots reserve
                  up to 1,000,000 curve points, ellipsoids 1,000,000 sheet cells
                  and 2,000,000 geodesic points. Retained geometry is limited to
                  four million numbers, and images to the previews and one
                  inspection.
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
                {state.cells.map((cell, index) => {
                  const image = images[index];
                  return (
                    <div
                      className="atlas-cell"
                      key={index}
                      data-state={
                        cell.frame
                          ? "valid"
                          : cell.error
                            ? "invalid"
                            : "pending"
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
                        {cell.frame && image?.status === "ready" ? (
                          <div className="atlas-art">
                            <img
                              src={image.url}
                              alt=""
                              data-view={JSON.stringify(image.view)}
                            />
                          </div>
                        ) : (
                          <div className="atlas-placeholder">
                            {cell.error
                              ? "Unavailable"
                              : !cell.frame
                                ? "Pending"
                                : waitingForSharedFrame
                                  ? "Waiting for shared scale"
                                  : image?.status === "failed"
                                    ? "Could not be drawn"
                                    : "Drawing…"}
                          </div>
                        )}
                        <span className="atlas-values">
                          {descriptor.axes[0].symbol} = {short(cell.values[0])}
                          <br />
                          {descriptor.axes[1].symbol} = {short(cell.values[1])}
                        </span>
                      </button>
                      {cell.error && (
                        <p className="field-error">{cell.error}</p>
                      )}
                      {cell.frame && image?.status === "failed" && (
                        <p className="field-error">{image.message}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
        <div
          role="tabpanel"
          id={`${tabsId}-variant-panel`}
          aria-labelledby={`${tabsId}-variant-tab`}
          hidden={tabs.tab !== "variant"}
        >
          {selected && (
            <section
              className="atlas-inspection"
              aria-label="Full-quality inspection"
              aria-busy={
                !selected.error && (!selected.frame || inspection === undefined)
              }
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
                  disabled={!selected.frame || blocked}
                  onClick={() => {
                    const candidate = scheduler.current?.candidate();
                    if (candidate)
                      finish(() => onAdopt(candidate, via.current));
                  }}
                >
                  Adopt variant
                </button>
              </div>
              {selected.frame && inspection?.status === "ready" ? (
                <div className="atlas-inspected-art">
                  <img
                    src={inspection.url}
                    alt=""
                    data-view={JSON.stringify(inspection.view)}
                  />
                </div>
              ) : (
                <p>
                  {selected.error ??
                    (!selected.frame
                      ? "Calculating this variant independently…"
                      : inspection?.status === "failed"
                        ? `This variant could not be drawn: ${inspection.message} It can still be adopted.`
                        : "Drawing this variant…")}
                </p>
              )}
              <p className="note">
                The probe is not drawn here, and the drawing is not refined to a
                zoomed view; both return with the study.
              </p>
            </section>
          )}
        </div>
      </div>
    </dialog>
  );
}
