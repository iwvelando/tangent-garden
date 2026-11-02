import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppHeader } from "../AppHeader";
import { ExportImageMenu } from "../ExportImageMenu";
import type { Still } from "../export-image";
import { EngineClient, EngineError } from "../engine-client";
import {
  CheckSetting,
  Field,
  FieldErrorContext,
  HelpText,
  HelpToggle,
  useHelp,
} from "../Field";
import { useCameraMove } from "../camera-move";
import { LatestSession } from "../latest-session";
import type { PlotCamera } from "../planar-link";
import { ScalarInput, ScalarStatus, type ScalarState } from "../ScalarInput";
import { ShareLink } from "../ShareLink";
import { useTheme } from "../useTheme";
import { useQuietFocus } from "../quiet-focus";
import { LegendEntries } from "../Legend";
import { LineWeightField } from "../LineWeightField";
import type { LaceEntry } from "./Context";
import { LaceDrawing, type LaceDrawingProps } from "./Drawing";
import { laceStill } from "./export";
import {
  addressOf,
  addressText,
  cutoffSummary,
  defaultLace,
  explain,
  followView,
  indexOf,
  laceHelp,
  laceLimits,
  lacePage,
  laceRequest,
  laceScale,
  neighbors,
  sideName,
  tileName,
  type LacePresentation,
  type LaceRequest,
  type LaceResult,
  type LaceStudy,
} from "./model";
import "../garden/garden.css";
import "./lace.css";

const labels: Record<string, string> = {
  depth: "Depth",
  maxTiles: "Tile limit",
  starPoint: "Star point",
  tiling: "Tiling",
};

export function LacePreview({
  entry,
  onReturn,
}: {
  entry: LaceEntry;
  onReturn: (via: "keyboard" | "pointer") => void;
}) {
  const theme = useTheme(),
    dialog = useRef<HTMLDialogElement>(null),
    back = useRef<HTMLButtonElement>(null),
    quiet = useQuietFocus(dialog);
  const [study, setStudy] = useState<LaceStudy>(() =>
    structuredClone(entry.study.lace ?? defaultLace),
  );
  // The result shown and the generation settings it answers.
  const [shown, setShown] = useState<{ key: string; result: LaceResult }>();
  const [error, setError] = useState<{
    message: string;
    field?: string;
    key?: string;
  }>({ message: "" });
  const [scalars, setScalars] = useState<Record<string, ScalarState>>({});
  const followHelp = useHelp();
  // The tile number as typed, while it is being typed.
  const [tileDraft, setTileDraft] = useState<string>();
  // Asking again after a failure that names no field, such as a timeout.
  const [attempt, setAttempt] = useState(0);
  const scalarClient = useRef<EngineClient | null>(null),
    generation = useRef(0),
    jobs = useRef(new Set<Promise<void>>());
  const session = useRef<LatestSession<LaceRequest, LaceResult> | null>(null);
  const exportGeneration = useRef(0);
  const key = JSON.stringify(laceRequest(study));
  const result = shown?.result;
  const current = shown?.key === key;
  // Whole-number fields are checked here, as the worker would, so the
  // refusal names the field without a round trip.
  const countError = !Number.isInteger(study.depth)
    ? { field: "depth", message: "Enter a whole number." }
    : !Number.isInteger(study.maxTiles)
      ? { field: "maxTiles", message: "Enter a whole number." }
      : undefined;
  const scalarError = Object.values(scalars).find((s) => s.error);
  const scalarPending = Object.values(scalars).some((s) => s.pending);
  const activeError =
    countError ??
    (error.message && error.key === key
      ? { field: error.field, message: error.message }
      : undefined);
  const valid = !activeError && !scalarError && !scalarPending;
  const ready = valid && current;
  const selected = result ? indexOf(result, study.selected) : -1;
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
  useEffect(() => {
    session.current = new LatestSession(
      () => new EngineClient(),
      (client, q: LaceRequest) => client.lace(q),
    );
    scalarClient.current = new EngineClient();
    return () => {
      exportGeneration.current++;
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
    document.documentElement.classList.add("garden-open");
    return () => document.documentElement.classList.remove("garden-open");
  }, []);
  // Generation follows the settings. Typed edits wait briefly, as the
  // ordinary editor does; the session keeps only the newest unsent intent.
  useEffect(() => {
    if (current || countError || scalarError || scalarPending) return;
    const request = laceRequest(study);
    const timer = setTimeout(
      () =>
        session.current!.update(
          request,
          (r) => {
            setShown({ key, result: r });
            setError({ message: "" });
          },
          (e) =>
            setError({
              message: e.message,
              field: e instanceof EngineError ? e.field : undefined,
              key,
            }),
        ),
      result ? 120 : 0,
    );
    return () => {
      clearTimeout(timer);
      session.current?.invalidate();
    };
  }, [key, !!countError, !!scalarError, scalarPending, attempt]);
  // Follow selection's eased camera move, which a manual change stops.
  const { moveTo, halt } = useCameraMove({
    view: study.view,
    setView: (view) => setStudy((s) => ({ ...s, view })),
    scale: laceScale,
  });
  const select = (i: number, typed = false) => {
    if (!result) return;
    if (!typed) setTileDraft(undefined);
    setStudy((s) => ({
      ...s,
      selected: i >= 0 ? addressOf(result, i) : undefined,
    }));
    if (study.follow && i >= 0) moveTo(followView(result, i));
  };
  // Following starts by remembering the reader's view, and ends by going
  // back to it.
  const setFollow = (on: boolean) => {
    if (on) {
      setStudy((s) => ({ ...s, follow: true, viewBeforeFollow: s.view }));
      if (result && selected >= 0) moveTo(followView(result, selected));
    } else {
      const back = study.viewBeforeFollow ?? study.view;
      setStudy(({ follow: _, viewBeforeFollow: __, ...s }) => s);
      moveTo(back);
    }
  };
  const manual = (view: PlotCamera) => {
    halt();
    setStudy((s) => ({ ...s, view }));
  };
  const drawing = (): LaceDrawingProps | undefined =>
    result && {
      result,
      edges: study.edges,
      motif: study.motif,
      presentation: study.presentation,
      selected,
      camera: study.view,
      dark: theme.dark,
      scheme: theme.scheme,
      weight: study.weight,
    };
  const metadata = () => ({
    kind: "hyperbolic-lace",
    tiling: "{7,3}",
    model: "Poincaré disk",
    metric: "ds² = 4|dz|²/(1 − |z|²)², curvature −1",
    units: "rim radius = 1",
    depth: study.depth,
    maxTiles: study.maxTiles,
    starPoint: study.starPoint,
    tiles: result?.center.length,
    omitted: result?.omitted,
    stopped: result?.stopped || undefined,
    finite: result
      ? `A finite patch of an infinite tiling: ${result.center.length} tiles within ${Math.max(0, ...result.depth)} reflections of the center tile. The rim is the disk's boundary at infinity; no tile reaches it.`
      : undefined,
    edges: study.edges,
    motif: study.motif,
    presentation: study.presentation,
    ...(selected >= 0 &&
      result && {
        selected: {
          number: selected + 1,
          address: addressOf(result, selected),
          depth: result.depth[selected],
          reversed: result.reversed[selected],
        },
      }),
    view: study.view,
    theme: theme.dark ? "dark" : "light",
    scheme: theme.scheme,
    weight: study.weight,
  });
  async function still(format: string, settings: Still) {
    const props = drawing();
    if (!ready || !props) return;
    const id = ++exportGeneration.current;
    try {
      await laceStill(
        format as "svg" | "png",
        props,
        metadata(),
        () => id === exportGeneration.current,
        settings,
      );
    } catch (e) {
      if (id === exportGeneration.current)
        setError({ message: (e as Error).message, key });
    }
  }
  const drawn = JSON.stringify([
    key,
    selected,
    study.edges,
    study.motif,
    study.presentation,
    study.view,
    study.weight,
    theme.dark,
    theme.scheme,
  ]);
  // Any change to what the still would show discards one being made.
  useEffect(() => {
    exportGeneration.current++;
  }, [drawn]);
  const message = scalarError
    ? `${scalarError.name}: ${scalarError.error}`
    : (activeError?.message ?? "");
  const title =
    scalarError?.name ??
    (activeError?.field ? labels[activeError.field] : undefined);
  const [claimed, setClaimed] = useState(false);
  const claim = useCallback((_key: string, on: boolean) => setClaimed(on), []);
  const target = useMemo(
    () => ({ label: title, message, claim, touch: () => {} }),
    [title, message, claim],
  );
  const props = drawing();
  const summary = shown && cutoffSummary(shown.result, JSON.parse(shown.key));
  const about = result && selected >= 0 ? explain(result, selected) : undefined;
  const around = result && selected >= 0 ? neighbors(result, selected) : [];
  const whole = (
    k: "depth" | "maxTiles",
    label: string,
    min: number,
    max: number,
  ) => (
    <Field label={label} help={laceHelp[k]}>
      <input
        type="number"
        min={min}
        max={max}
        value={Number.isNaN(study[k]) ? "" : study[k]}
        onChange={(e) => {
          const value = e.currentTarget.valueAsNumber;
          setStudy((s) => ({ ...s, [k]: value }));
        }}
      />
    </Field>
  );
  const layer = (k: "edges" | "motif", label: string) => (
    <CheckSetting
      label={label}
      topic={label}
      checked={study[k]}
      onChange={(on) => setStudy((s) => ({ ...s, [k]: on }))}
      help={laceHelp[k]}
    />
  );
  return (
    <dialog
      ref={dialog}
      className="garden lace"
      aria-labelledby="lace-title"
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
          // One mode per link: a garden there would open instead.
          study={() => {
            const { garden: _, ...base } = entry.study;
            return { ...base, lace: study };
          }}
          disabled={!ready}
        />
        <ExportImageMenu
          kind="hyperbolic-lace"
          revision={drawn}
          disabled={!ready}
          base={lacePage}
          onSave={still}
        />
      </AppHeader>
      <div className="garden-content">
        <div className="garden-heading">
          <p className="eyebrow">Poincaré disk · regular tiling {"{7,3}"}</p>
          <h2 id="lace-title">Hyperbolic lace</h2>
          <p>
            Heptagons meeting three at a corner cannot tile a flat plane, but
            they tile the hyperbolic plane, drawn here in a disk whose rim is
            infinitely far away. Every tile is the center tile reflected across
            sides, as is its motif.
          </p>
        </div>
        <ScalarStatus.Provider value={scalarStatus}>
          <FieldErrorContext.Provider value={target}>
            <div className="garden-layout">
              <main>
                <div className="garden-view">
                  {props ? (
                    <LaceDrawing
                      {...props}
                      busy={!ready}
                      onCamera={manual}
                      onSelect={select}
                    />
                  ) : (
                    <p className="garden-placeholder" role="status">
                      Reflecting tiles…
                    </p>
                  )}
                </div>
                <p className="note garden-gestures">
                  Click or tap a tile to select it. Drag to pan; scroll or pinch
                  to zoom, which enlarges the drawing without moving the disk.
                  Keys: arrows, + / −, Home.{" "}
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => manual({ x: 0, y: 0, zoom: 1 })}
                  >
                    Reset view
                  </button>
                </p>
                <div className="legend garden-legend">
                  <LegendEntries
                    entries={[
                      {
                        key: "motif",
                        shown: study.motif,
                        content: (
                          <>
                            <span className="base-dot" />
                            Motif
                          </>
                        ),
                      },
                      {
                        key: "edges",
                        shown: study.edges,
                        content: (
                          <>
                            <span className="line-dot" />
                            Tile sides
                          </>
                        ),
                      },
                      {
                        key: "rim",
                        shown: true,
                        content: (
                          <>
                            <span className="base-dot garden-thick" />
                            Rim
                          </>
                        ),
                      },
                      {
                        key: "selected",
                        shown: selected >= 0,
                        content: (
                          <>
                            <span className="derived-dot" />
                            Selected tile
                          </>
                        ),
                      },
                    ]}
                  />
                </div>
              </main>
              <aside>
                <section
                  className="garden-selection"
                  aria-label="Selected tile"
                >
                  {result && (
                    <>
                      <div className="garden-picker">
                        <Field label="Tile" help={laceHelp.tile}>
                          <input
                            type="number"
                            min={1}
                            max={result.center.length}
                            value={
                              tileDraft ?? (selected >= 0 ? selected + 1 : "")
                            }
                            placeholder="None"
                            onChange={(e) => {
                              // An emptied or out-of-range entry stays as
                              // typed until it names a tile or is left.
                              setTileDraft(e.currentTarget.value);
                              const n = e.currentTarget.valueAsNumber;
                              if (
                                Number.isInteger(n) &&
                                n >= 1 &&
                                n <= result.center.length
                              )
                                select(n - 1, true);
                            }}
                            onBlur={() => setTileDraft(undefined)}
                          />
                        </Field>
                        <div
                          className="garden-step"
                          role="group"
                          aria-label="Step through tiles"
                        >
                          <button
                            type="button"
                            disabled={selected === 0}
                            onClick={() =>
                              select(selected < 0 ? 0 : selected - 1)
                            }
                            aria-label="Previous tile"
                          >
                            ‹ Previous
                          </button>
                          <button
                            type="button"
                            disabled={selected === result.center.length - 1}
                            onClick={() => select(selected + 1)}
                            aria-label="Next tile"
                          >
                            Next ›
                          </button>
                          <button
                            type="button"
                            disabled={selected < 0 && !study.selected}
                            onClick={() => {
                              setTileDraft(undefined);
                              setStudy((s) => ({ ...s, selected: undefined }));
                            }}
                          >
                            Clear selection
                          </button>
                        </div>
                      </div>
                      <div className="garden-follow">
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={!!study.follow}
                            onChange={(e) => setFollow(e.target.checked)}
                          />
                          Follow selection
                        </label>
                        <HelpToggle
                          topic="following the selection"
                          help={followHelp}
                        />
                      </div>
                      <HelpText help={followHelp}>{laceHelp.follow}</HelpText>
                      {about ? (
                        <div className="garden-about">
                          <h3>{tileName(selected)}</h3>
                          <p className="garden-facts">{about.facts}</p>
                          <p className="garden-facts">
                            Sides crossed from the center:{" "}
                            {addressText(addressOf(result, selected))}
                          </p>
                          <p>{about.text}</p>
                          <div
                            className="garden-generators lace-neighbors"
                            role="group"
                            aria-label="Neighboring tiles"
                          >
                            {around.map((t, k) => (
                              <button
                                key={k}
                                type="button"
                                disabled={t < 0}
                                onClick={() => select(t)}
                                aria-label={
                                  t < 0
                                    ? `Across ${sideName(k)}: beyond the patch`
                                    : `Across ${sideName(k)}: ${tileName(t)}`
                                }
                              >
                                {k + 1}: {t < 0 ? "—" : t + 1}
                              </button>
                            ))}
                          </div>
                          <p className="hint">
                            The tile across each side, as side: tile; a dash
                            lies beyond the patch.
                          </p>
                        </div>
                      ) : (
                        <p className="note">
                          {study.selected
                            ? "The selected tile lies beyond the current cutoffs."
                            : "No tile selected."}
                        </p>
                      )}
                    </>
                  )}
                </section>
                <Field label="Presentation" help={laceHelp.presentation}>
                  <select
                    value={study.presentation}
                    onChange={(e) => {
                      const presentation = e.currentTarget
                        .value as LacePresentation;
                      setStudy((s) => ({ ...s, presentation }));
                    }}
                  >
                    <option value="complete">Every tile</option>
                    <option value="selected">Selected tile and its path</option>
                  </select>
                </Field>
                {study.presentation === "selected" && selected < 0 && (
                  <p className="note">
                    Select a tile to see the tiles crossed to reach it; until
                    then only the center tile is drawn.
                  </p>
                )}
                <div className="lace-layers">
                  {layer("motif", "Motif")}
                  {layer("edges", "Tile sides")}
                </div>
                <h3 className="garden-section">Motif</h3>
                <Field label="Star point" help={laceHelp.starPoint}>
                  <ScalarInput
                    name="Star point"
                    value={study.starPoint}
                    onChange={(v) => setStudy((s) => ({ ...s, starPoint: v }))}
                  />
                </Field>
                <h3 className="garden-section">Cutoffs</h3>
                <div className="pair">
                  {whole("depth", "Depth", 0, laceLimits.depth)}
                  {whole("maxTiles", "Tile limit", 1, laceLimits.tiles)}
                </div>
                <p
                  className="note garden-summary lace-summary"
                  data-current={current || undefined}
                >
                  {summary ? (
                    <>
                      {summary.text}
                      {summary.stopped && (
                        <>
                          {" "}
                          <strong className="garden-stopped">
                            {summary.stopped}
                          </strong>
                        </>
                      )}
                    </>
                  ) : (
                    "Generating…"
                  )}
                </p>
                <LineWeightField
                  value={study.weight}
                  onChange={(weight) => setStudy((s) => ({ ...s, weight }))}
                />
                <p className="note">
                  This study is still. Zoom and pan move the camera, not the
                  disk: tiles nearer the rim stay smaller in the drawing but are
                  the same size in the disk's own measure.
                </p>
                {!claimed && message && (
                  <div className="study-error" role="alert">
                    <p>
                      {title ? `${title}: ` : ""}
                      {message}
                    </p>
                    {!title && (
                      <button
                        type="button"
                        onClick={() => {
                          // The constant parser's worker may have failed too.
                          scalarClient.current?.dispose();
                          scalarClient.current = new EngineClient();
                          setError({ message: "" });
                          setAttempt((n) => n + 1);
                        }}
                      >
                        Try again
                      </button>
                    )}
                  </div>
                )}
              </aside>
            </div>
          </FieldErrorContext.Provider>
        </ScalarStatus.Provider>
      </div>
    </dialog>
  );
}
