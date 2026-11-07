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
import type { TesseractAtlasRequest } from "../AtlasContext";
import { EngineClient } from "../engine-client";
import { Field } from "../Field";
import type { JourneyVia } from "../JourneyContext";
import { NotebookMode } from "../NotebookMode";
import { useQuietFocus } from "../quiet-focus";
import { useTheme } from "../useTheme";
import { useMediaQuery } from "../useMediaQuery";
import { paneCaptions } from "./Composition";
import { objects } from "./objects";
import { fieldLabel } from "./fields";
import type { TesseractStudy } from "./link";
import { AtlasArtwork, sharedAtlasRadii } from "./atlas-art";
import {
  TesseractAtlas,
  tesseractAtlasBudget,
  tesseractAtlasDefaults,
  tesseractAtlasPair,
  tesseractAtlasPairs,
  tesseractAtlasRangeError,
  tesseractPreviewConfig,
  type TesseractAtlasState,
  type TesseractPairId,
} from "./atlas";
import "../atlas.css";

const short = (n: number) =>
  Number(n.toPrecision(6)).toString().replace("-", "−");
export default function TesseractAtlasPreview({
  request,
  onReturn,
  onAdopt,
}: {
  request: TesseractAtlasRequest;
  onReturn: (via: JourneyVia) => void;
  onAdopt: (study: TesseractStudy, via: JourneyVia) => void;
}) {
  const study = request.study;
  const theme = useTheme();
  const narrow = useMediaQuery("(max-width: 700px)");
  const dialog = useRef<HTMLDialogElement>(null),
    back = useRef<HTMLButtonElement>(null);
  const tabsId = useId(),
    title = useId();
  const quiet = useQuietFocus(dialog),
    via = useRef(request.via);
  const pairs = useMemo(() => tesseractAtlasPairs(study.config), [study]);
  const [pair, setPair] = useState<TesseractPairId>(pairs[0]?.id ?? "rotation");
  const descriptor = tesseractAtlasPair(study.config, pair);
  const [size, setSize] = useState<AtlasSize>(atlasGridSize);
  const [framing, setFraming] = useState("independent");
  const [ranges, setRanges] = useState<AtlasRanges>(() =>
    tesseractAtlasDefaults(study.config, pair),
  );
  const [state, setState] = useState<TesseractAtlasState>({
    cells: [],
    selection: null,
    queued: 0,
  });
  const tabs = useAtlasTabs(dialog, !!state.selection, quiet);
  const numerical = useRef<{
    engine: EngineClient;
    atlas: TesseractAtlas;
    working: number;
  } | null>(null);
  const startEngine = () => {
    const engine = new EngineClient();
    let slot: NonNullable<typeof numerical.current>;
    const atlas = new TesseractAtlas(
      {
        dispose: () => engine.dispose(),
        tesseract: async (c) => {
          slot.working++;
          try {
            return await engine.tesseract(c);
          } finally {
            slot.working--;
          }
        },
      },
      (next) => {
        if (numerical.current === slot) setState(next);
      },
    );
    slot = { engine, atlas, working: 0 };
    numerical.current = slot;
    scalars.client.current = engine;
    return atlas;
  };
  const scalars = useAtlasRanges(() => {
    const slot = numerical.current;
    slot?.atlas.cancel();
    // A numerical edit must not queue parsing behind synchronous Go work.
    if (slot?.working && !slot.atlas.state.failed) {
      numerical.current = null;
      slot.engine.dispose();
      startEngine();
    }
  });
  useEffect(() => {
    const atlas = startEngine();
    atlas.generate(study, tesseractAtlasDefaults(study.config, pair), {
      pair,
      size,
    });
    return () => {
      scalars.generation.current++;
      const slot = numerical.current;
      numerical.current = null;
      slot?.atlas.cancel();
      slot?.engine.dispose();
    };
  }, []);
  useAtlasModal(dialog, back, request.via, quiet);
  const rangeError = tesseractAtlasRangeError(study.config, ranges, pair, size);
  const budget = tesseractAtlasBudget(study.config, size);
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
  const complete =
    state.cells.length > 0 && state.cells.every((c) => c.frame || c.error);
  const shared = useMemo(
    () =>
      framing === "shared" && complete
        ? sharedAtlasRadii(
            state.cells.flatMap((c) => (c.frame ? [c.frame.result] : [])),
          )
        : undefined,
    [framing, complete, state.cells],
  );
  const waiting = framing === "shared" && !complete;
  const preview = tesseractPreviewConfig(study.config, size);
  const sampleLabel = fieldLabel(study.config, "samples")!.toLowerCase();
  const countNote = objects[study.config.object].countNote;
  const samplingNote =
    typeof countNote === "function" ? countNote(study.config) : countNote;
  const selected = state.selection,
    cell = selected && state.cells[selected.index];
  const paired =
    !!objects[study.config.object].pairedModes &&
    study.config.mode === "paired";
  const ending = useRef(false);
  const finish = (action = () => onReturn(via.current)) => {
    if (ending.current) return;
    ending.current = true;
    numerical.current?.atlas.cancel();
    dialog.current?.close();
    action();
  };
  return (
    <dialog
      ref={dialog}
      className="atlas tesseract-atlas"
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
              PARAMETER ATLAS · 4D · {size} × {size}
            </div>
            <h2 id={title}>A field of possible worlds</h2>
          </div>
          <button ref={back} type="button" onClick={() => finish()}>
            Cancel atlas
          </button>
        </div>
        <NotebookMode />
        <p className="note">
          Your study stays here until you adopt a variant.{" "}
          {descriptor?.axes[0].label} runs across columns;{" "}
          {descriptor?.axes[1].label.toLowerCase()} runs down rows.
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
                  onChange={(e) => {
                    const next = e.target.value as TesseractPairId;
                    if (next === pair) return;
                    scalars.forget();
                    scalars.edit();
                    setPair(next);
                    setRanges(tesseractAtlasDefaults(study.config, next));
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
                    onChange={(e) => {
                      const next = Number(e.target.value) as AtlasSize;
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
                    onChange={(e) => setFraming(e.target.value)}
                  >
                    <option value="independent">Fit each variant</option>
                    <option value="shared">Use one common scale</option>
                  </select>
                </Field>
              </div>
              {descriptor && (
                <AtlasRangeFields
                  pairKey={pair}
                  axes={descriptor.axes}
                  ranges={ranges}
                  setRanges={setRanges}
                  failure={failure}
                  scalars={scalars}
                />
              )}
              <button
                type="button"
                disabled={blocked}
                onClick={() =>
                  numerical.current?.atlas.generate(study, ranges, {
                    pair,
                    size,
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
                {framing === "shared"
                  ? "Shared framing: artwork appears when every variant finishes, at one scale per panel."
                  : "Independent framing: each variant keeps its ordinary framing radius."}{" "}
                Every panel keeps its source camera.
              </p>
              {paired && (
                <p className="note">
                  {paneCaptions(study.config.object, "rows").join(" · ")}
                </p>
              )}
              <p className="note atlas-quality">
                Preview quality: at most {preview.samples} {sampleLabel}
                {objects[study.config.object].atlas?.grid
                  ? ` and ${preview.grid} face grid lines`
                  : ""}
                ; source counts and selected correspondence kept. Inspect at
                original quality before adoption.
              </p>
              <p className="note">
                Original quality: {study.config.samples} {sampleLabel}
                {objects[study.config.object].atlas?.grid
                  ? ` and ${study.config.grid} face grid lines`
                  : ""}
                .
              </p>
              <details>
                <summary>Atlas limits and projection</summary>
                {samplingNote && <p className="note">{samplingNote}</p>}
                <p className="note">
                  At most 25 previews and one original-quality inspection; one
                  calculation in flight and 25 unsent requests. Samples cap at
                  64 / 32 for 3 × 3 / 5 × 5, or 256 / 128 for the root journey;
                  cube grid lines cap at 4 / 2. Across previews and inspection,
                  at most 1,000,000 points are reserved. Retained geometry,
                  including both panels and source coordinates, is limited to
                  4,000,000 numbers. At most 26 vector images are held.
                </p>
                <p className="note">
                  Angles stay within ±1000000 radians; projection windows within
                  2–12 and eye distances within 2.05–20. Hopf latitude stays
                  within 0–π/2, with nonnegative flower amplitude keeping α ± A
                  inside. Invalid cells are unavailable. Projection clips at the
                  ordinary finite window; open arcs are intentional. Source
                  identities and correspondence remain those of the numerical
                  result.
                </p>
              </details>
            </div>
            <div className="atlas-grid-scroll">
              <div
                className="atlas-grid"
                data-size={size}
                role="group"
                aria-label={`${descriptor?.label ?? "Parameter"} variants`}
              >
                {state.cells.map((c, i) => (
                  <div
                    className="atlas-cell"
                    key={i}
                    data-state={
                      c.frame ? "valid" : c.error ? "invalid" : "pending"
                    }
                  >
                    <button
                      type="button"
                      disabled={!c.frame || blocked}
                      aria-pressed={selected?.index === i}
                      aria-label={`Inspect row ${Math.floor(i / size) + 1}, column ${(i % size) + 1}`}
                      onClick={() => {
                        numerical.current?.atlas.inspect(i);
                        tabs.showVariant();
                      }}
                      onKeyDown={(e) => atlasCellKeyDown(e, i, size)}
                    >
                      {c.frame && !waiting ? (
                        <AtlasArtwork
                          frame={c.frame}
                          study={study}
                          dark={theme.dark}
                          scheme={theme.scheme}
                          radii={shared}
                        />
                      ) : (
                        <div className="atlas-placeholder">
                          {c.error
                            ? "Unavailable"
                            : c.frame
                              ? "Waiting for shared scale"
                              : "Pending"}
                        </div>
                      )}
                      <span className="atlas-values">
                        {descriptor?.axes[0].symbol} = {short(c.values[0])}
                        <br />
                        {descriptor?.axes[1].symbol} = {short(c.values[1])}
                      </span>
                    </button>
                    {c.error && <p className="field-error">{c.error}</p>}
                    {c.frame?.result.weave && (
                      <p className="note atlas-diagnostic">
                        {c.frame.result.weave.retainedArcs} open arcs ·{" "}
                        {c.frame.result.weave.absentSources} outside window
                      </p>
                    )}
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
          hidden={tabs.tab !== "variant"}
        >
          {selected && (
            <section
              className="atlas-inspection"
              aria-label="Full-quality inspection"
              aria-busy={!selected.frame && !selected.error}
            >
              <div className="atlas-inspection-header">
                <div>
                  <h3>
                    Inspect variant · row{" "}
                    {Math.floor(selected.index / size) + 1}, column{" "}
                    {(selected.index % size) + 1}
                  </h3>
                  <p className="note">
                    {descriptor?.axes[0].symbol} ={" "}
                    {cell && short(cell.values[0])} ·{" "}
                    {descriptor?.axes[1].symbol} ={" "}
                    {cell && short(cell.values[1])} · Original quality and both
                    source cameras
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!selected.frame || blocked}
                  onClick={() => {
                    const candidate = numerical.current?.atlas.candidate();
                    if (candidate)
                      finish(() => onAdopt(candidate, via.current));
                  }}
                >
                  Adopt variant
                </button>
              </div>
              {paired && (
                <p className="note">
                  {paneCaptions(
                    study.config.object,
                    narrow ? "rows" : "columns",
                  ).join(" · ")}
                </p>
              )}
              {selected.frame ? (
                <>
                  <AtlasArtwork
                    frame={selected.frame}
                    study={study}
                    dark={theme.dark}
                    scheme={theme.scheme}
                    inspection
                    layout={narrow ? "rows" : "columns"}
                  />
                  <p className="note">
                    {objects[study.config.object].diagnostics(
                      selected.frame.result,
                    )}
                  </p>
                </>
              ) : (
                <p>
                  {selected.error ?? "Calculating this variant independently…"}
                </p>
              )}
              <p className="note">
                Adopt to explore, play, share or export through the ordinary
                study controls.
              </p>
            </section>
          )}
        </div>
      </div>
    </dialog>
  );
}
