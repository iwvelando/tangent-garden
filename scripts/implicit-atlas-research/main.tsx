import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AtlasRangeFields,
  atlasCellKeyDown,
  useAtlasRanges,
} from "../../web/atlas-dialog";
import {
  atlasNumbers,
  axisRangeError,
  type AtlasSize,
  type AtlasState,
} from "../../web/atlas-queue";
import { colorSchemes } from "../../web/color-schemes";
import { EngineClient } from "../../web/engine-client";
import { Field } from "../../web/Field";
import { useTheme } from "../../web/useTheme";
import { studyHref, writeStudyLink } from "../../web/study-link";
import {
  AtlasPainter,
  inspectionPage,
  previewPages,
  sharedBounds,
  type Painted,
  type PaintStyle,
  type Slot,
} from "../../web/spatial/atlas-paint";
import type { Frame } from "../../web/spatial/types";
import {
  axes,
  budget,
  cases,
  experiment,
  ImplicitAtlas,
  previewConfig,
  typedBytes,
  type CaseId,
} from "./model";
import "../../web/style.css";
import "../../web/atlas.css";
import "./research.css";

type Stats = {
  started: number;
  numericalMs: number[];
  gridMs?: number;
  drawnMs?: number;
  retainedNumbers: number;
  typedBytes: number;
  peakNumbers: number;
};
const emptyStats = (): Stats => ({
  started: 0,
  numericalMs: [],
  retainedNumbers: 0,
  typedBytes: 0,
  peakNumbers: 0,
});
const emptyState = (): AtlasState<Frame> => ({
  cells: [],
  selection: null,
  queued: 0,
});
const short = (v: number) => Number(v.toPrecision(6)).toString();
const count = (v: number) => v.toLocaleString("en-US");

function App() {
  const theme = useTheme();
  const [id, setId] = useState<CaseId>("drops");
  const sample = useMemo(() => experiment(id), [id]);
  const source = sample.study;
  const [ranges, setRanges] = useState(sample.ranges);
  const [size, setSize] = useState<AtlasSize>(3);
  const [framing, setFraming] = useState("independent");
  const [state, setState] = useState(emptyState);
  const [images, setImages] = useState<Partial<Record<Slot, Painted>>>({});
  const [href, setHref] = useState("");
  const [sourceHref, setSourceHref] = useState("");
  const stats = useRef(emptyStats());
  const engine = useRef<EngineClient | null>(null);
  const queue = useRef<ImplicitAtlas | null>(null);
  const generation = useRef(0);
  const painter = useRef<AtlasPainter | null>(null);
  const cancel = () => {
    generation.current++;
    queue.current?.cancel();
    stats.current.retainedNumbers = 0;
    stats.current.typedBytes = 0;
    setState(emptyState());
    engine.current?.dispose();
    engine.current = null;
    painter.current?.dispose();
    painter.current = null;
    setImages({});
    setHref("");
  };
  const scalars = useAtlasRanges(cancel);
  // Range parsing cannot be trapped behind a meshing request during an edit.
  useEffect(() => {
    const parser = new EngineClient();
    scalars.client.current = parser;
    return () => {
      cancel();
      parser.dispose();
    };
  }, []);
  useEffect(() => {
    let current = true;
    void writeStudyLink("3d", source).then((token) => {
      if (current)
        setSourceHref(studyHref(new URL("/", location.href).href, "3d", token));
    });
    return () => {
      current = false;
    };
  }, [source]);
  useEffect(() => {
    let current = true;
    setHref("");
    const candidate = queue.current?.candidate();
    if (candidate)
      void writeStudyLink("3d", candidate).then((token) => {
        if (current)
          setHref(studyHref(new URL("/", location.href).href, "3d", token));
      });
    return () => {
      current = false;
    };
  }, [state.selection]);
  const generate = () => {
    cancel();
    const client = new EngineClient();
    const token = generation.current;
    engine.current = client;
    stats.current = { ...emptyStats(), started: performance.now() };
    const measured = {
      dispose: () => client.dispose(),
      computeSpatial: async (
        config: Parameters<EngineClient["computeSpatial"]>[0],
      ) => {
        const start = performance.now();
        const frame = await client.computeSpatial(config);
        stats.current.numericalMs.push(performance.now() - start);
        return frame;
      },
    };
    const atlas = new ImplicitAtlas(measured, (next) => {
      if (queue.current !== atlas || generation.current !== token) return;
      const frames = [
        ...next.cells.map((c) => c.frame),
        next.selection?.frame,
      ].filter((f) => !!f);
      stats.current.retainedNumbers = frames.reduce(
        (n, f) => n + atlasNumbers(f.result),
        0,
      );
      stats.current.typedBytes = frames.reduce(
        (n, f) => n + typedBytes(f.result),
        0,
      );
      stats.current.peakNumbers = Math.max(
        stats.current.peakNumbers,
        stats.current.retainedNumbers,
      );
      if (next.cells.length && next.cells.every((c) => c.frame || c.error))
        stats.current.gridMs ??= performance.now() - stats.current.started;
      setState(next);
    });
    queue.current = atlas;
    atlas.generate(source, ranges, size);
  };
  const complete =
    state.cells.length > 0 && state.cells.every((c) => c.frame || c.error);
  const bounds =
    framing === "shared" && complete
      ? sharedBounds(
          state.cells.flatMap((c) => (c.frame ? [c.frame.result.bounds] : [])),
        )
      : undefined;
  const style: PaintStyle = {
    camera: source.view,
    projection: source.projection,
    lensAngle: source.lensAngle,
    layers: source.layers,
    cut: source.cut,
    sight: source.sight,
    dark: theme.dark,
    scheme: theme.scheme,
  };
  const selected = state.selection;
  useEffect(() => {
    if (!state.cells.length) return;
    painter.current ??= new AtlasPainter((slot, painted) => {
      if (!painted) return;
      setImages((old) => ({ ...old, [slot]: painted }));
    });
    if (framing !== "shared" || complete)
      state.cells.forEach((c, i) => {
        if (c.frame)
          painter.current!.request(
            i,
            c.frame.result,
            bounds ?? c.frame.result.bounds,
            style,
            previewPages[size],
          );
      });
    if (selected?.frame)
      painter.current.request(
        "inspection",
        selected.frame.result,
        selected.frame.result.bounds,
        style,
        inspectionPage,
      );
  }, [state, framing, theme.dark, theme.scheme]);
  useEffect(() => {
    if (complete && state.cells.every((c, i) => c.error || images[i]))
      stats.current.drawnMs ??= performance.now() - stats.current.started;
  }, [images, complete]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  });
  // Reproducibility hooks exist only in the separate research entry.
  Object.assign(window, {
    research: {
      queue: queue.current,
      source,
      stats: stats.current,
      images,
      direct: async (config: Frame["config"]) => {
        const client = new EngineClient();
        try {
          return await client.computeSpatial(config);
        } finally {
          client.dispose();
        }
      },
    },
  });
  const reservation = budget(source.config, size);
  const failure = axisRangeError(ranges, axes, size);
  const blocked =
    scalars.pending ||
    scalars.editing ||
    !!scalars.invalid ||
    !!failure ||
    !!reservation.error;
  const preview = previewConfig(source.config, size).implicit;
  const image = (slot: Slot, alt: string) => {
    const p = images[slot];
    return p?.status === "ready" ? (
      <img src={p.url} alt={alt} />
    ) : (
      <p>
        {p?.status === "failed"
          ? "Could not be drawn: " + p.message
          : "Drawing…"}
      </p>
    );
  };
  return (
    <main
      className={"app implicit-research" + (theme.dark ? " dark" : "")}
      style={theme.style}
    >
      <div className="research-heading">
        <div>
          <p className="eyebrow">S02.4 · RESEARCH PROTOTYPE</p>
          <h1>A field of implicit forms</h1>
        </div>
        <button onClick={theme.toggle}>
          Use {theme.dark ? "light" : "dark"} theme
        </button>
      </div>
      <p className="note">
        Compare coarse meshes, then inspect at the source’s original quality. A
        preview can miss a piece, join a gap or misread a singularity.
      </p>
      <div className="research-layout">
        <section className="research-controls" aria-label="Experiment controls">
          <Field label="Experiment">
            <select
              value={id}
              onChange={(e) => {
                cancel();
                scalars.forget();
                setId(e.target.value as CaseId);
                setRanges(experiment(e.target.value as CaseId).ranges);
              }}
            >
              {cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <div className="pair">
            <Field label="Grid size">
              <select
                value={size}
                onChange={(e) => {
                  scalars.edit();
                  setSize(Number(e.target.value) as AtlasSize);
                }}
              >
                <option value="3">3 × 3</option>
                <option value="5">5 × 5</option>
              </select>
            </Field>
            <Field label="Framing">
              <select
                value={framing}
                onChange={(e) => {
                  painter.current?.clearAll();
                  setImages({});
                  setFraming(e.target.value);
                }}
              >
                <option value="independent">Fit each variant</option>
                <option value="shared">Use one common scale</option>
              </select>
            </Field>
          </div>
          <AtlasRangeFields
            pairKey={id}
            axes={axes}
            ranges={ranges}
            setRanges={setRanges}
            failure={failure}
            scalars={scalars}
          />
          <div className="research-actions">
            <button disabled={blocked} onClick={generate}>
              Generate atlas
            </button>
            <button onClick={cancel}>Cancel atlas</button>
          </div>
          <p role="status">
            {state.cells.length
              ? state.cells.filter((c) => c.frame || c.error).length +
                " of " +
                state.cells.length +
                " variants ready."
              : "Set ranges, then generate variants."}
          </p>
          {(reservation.error ||
            state.error ||
            (!failure && scalars.invalid)) && (
            <p role="alert" className="field-error">
              {reservation.error ?? state.error ?? scalars.invalid?.error}
            </p>
          )}
          <p className="note">
            Preview: ≤ {preview.cells} cells along the longest box side, no
            refinement; {preview.sections.count} sections. Original:{" "}
            {source.config.implicit.cells} cells,{" "}
            {source.config.implicit.refine} refinement levels.
          </p>
          <p className="note">
            The source camera, layers, cut, sight and lens are kept. Inspection
            omits the probe and view refinement.
          </p>
          <Field label="Color scheme">
            <select
              value={theme.scheme}
              onChange={(e) =>
                theme.chooseScheme(e.target.value as typeof theme.scheme)
              }
            >
              {colorSchemes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <p>
            <a href={sourceHref} target="_blank" rel="noreferrer">
              Open source study
            </a>
          </p>
          <details>
            <summary>Research limits and measurements</summary>
            <p className="note">
              Reservation: {count(reservation.gridCells)} base grid cells and ≤{" "}
              {count(reservation.sectionCells)} section cells, including one
              original-quality inspection. Limits: 400,000 and 2,000,000
              respectively. These do not bound every field evaluation.
            </p>
            <p className="note">
              One mesh request at a time, ≤ 25 previews and one inspection, ≤
              4,000,000 retained numbers. Preview images ≤ 600 × 456 (3 × 3) or
              360 × 274 (5 × 5), inspection ≤ 1,600 × 1,216. Cancel terminates
              the meshing worker. Range parsing uses a separate worker.
            </p>
            <p className="note">
              Retained: {count(stats.current.retainedNumbers)} numbers;{" "}
              {count(stats.current.typedBytes)} typed-array bytes. Neither
              measures total heap or GPU memory. Grid:{" "}
              {stats.current.gridMs?.toFixed(0) ?? "—"} ms; all drawings:{" "}
              {stats.current.drawnMs?.toFixed(0) ?? "—"} ms.
            </p>
          </details>
        </section>
        <section
          aria-label="Comparison grid"
          className="research-grid atlas-grid"
          data-size={size}
        >
          {state.cells.map((cell, i) => (
            <div
              key={i}
              className="research-cell atlas-cell"
              data-state={
                cell.error ? "unavailable" : cell.frame ? "ready" : "pending"
              }
            >
              <button
                disabled={!cell.frame || blocked}
                aria-label={
                  "Inspect row " +
                  (Math.floor(i / size) + 1) +
                  ", column " +
                  ((i % size) + 1)
                }
                aria-pressed={selected?.index === i}
                onKeyDown={(e) => atlasCellKeyDown(e, i, size)}
                onClick={() => {
                  setHref("");
                  painter.current?.clear("inspection");
                  setImages((old) => {
                    const next = { ...old };
                    delete next.inspection;
                    return next;
                  });
                  queue.current?.inspect(i);
                }}
              >
                <div className="research-art">
                  {cell.frame ? (
                    framing === "shared" && !complete ? (
                      <p>Waiting for common scale</p>
                    ) : (
                      image(i, "Coarse implicit surface")
                    )
                  ) : (
                    <p>{cell.error ? "Unavailable" : "Computing…"}</p>
                  )}
                </div>
                <span>
                  c = {short(cell.values[0])} · a = {short(cell.values[1])}
                </span>
              </button>
              {cell.error && <p className="field-error">{cell.error}</p>}
              {cell.frame && (
                <p className="note">
                  {cell.frame.result.implicit!.positions.length / 3} vertices ·{" "}
                  {cell.frame.result.implicit!.components.length} mesh pieces
                  {cell.frame.result.implicit!.nonfinite
                    ? " · undefined samples"
                    : ""}
                  {cell.frame.result.implicit!.discontinuities
                    ? " · discontinuities"
                    : ""}
                  {cell.frame.result.implicit!.singular
                    ? " · singular vertices"
                    : ""}
                </p>
              )}
            </div>
          ))}
        </section>
      </div>
      {selected && (
        <section
          className="inspection"
          aria-label="Original-quality inspection"
          aria-busy={!selected.frame && !selected.error}
        >
          <h2>
            Original-quality inspection · c ={" "}
            {short(state.cells[selected.index].values[0])}, a ={" "}
            {short(state.cells[selected.index].values[1])}
          </h2>
          {selected.frame && href && (
            <p>
              <a href={href} target="_blank" rel="noreferrer">
                Open selected study
              </a>{" "}
              in the ordinary notebook to edit, play, share and export. The
              source notebook stays untouched.
            </p>
          )}
          {selected.frame ? (
            <>
              {image("inspection", "Original-quality implicit surface")}
              <p className="note">
                {selected.frame.result.implicit!.positions.length / 3} vertices
                · {selected.frame.result.implicit!.components.length} mesh
                pieces. Mesh topology is a finite-resolution observation.
              </p>
            </>
          ) : (
            <p>{selected.error ?? "Computing at original quality…"}</p>
          )}
        </section>
      )}
      <p className="note">
        This local experiment does not add implicit surfaces to the public
        atlas. In-place adoption and source-draft restoration belong to the
        downstream delivery after an owner go/no-go decision.
      </p>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
