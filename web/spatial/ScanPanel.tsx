// Issue #406's research preview of the scan (scan.ts): its settings, its
// progress, and the candidates it found, each with small previews of the
// study either side and a way to draw either side at full quality. Shown
// only with ?research=406. Not a public feature.
import { useEffect, useMemo, useRef, useState } from "react";
import { Field, FieldErrorContext, type FieldErrorTarget } from "../Field";
import { tiered } from "../help";
import { count, plural, readout } from "../number-format";
import { ScalarInput } from "../ScalarInput";
import type { ColorScheme } from "../color-schemes";
import type { CutSpec } from "./cut";
import { drawPreview, type PreviewIntent } from "./event-previews";
import type { SpatialCamera } from "./link";
import type { Layers } from "./renderer";
import type { Sight } from "./sight";
import type { SpatialConfig, SpatialResult } from "./types";
import {
  axisValue,
  candidateTitle,
  describeReading,
  ScanSession,
  scanLimits,
  stabilityText,
  stopText,
  type ScanAxis,
  type ScanCandidate,
  type ScanRequest,
  type ScanResult,
  type ScanState,
} from "./scan";

// Suggested ranges: the stories' covered levels, and the research studies'.
export const scanRanges: Record<
  string,
  { axis: ScanAxis; from: number; to: number }
> = {
  "Two drops become one": { axis: "level", from: 0.64, to: 1.44 },
  "The instant a handle appears": { axis: "level", from: 0.64, to: 1.44 },
  "The tanglecube's three events": { axis: "level", from: -20, to: 4 },
  "Two handles open at once": { axis: "level", from: 0.01, to: 0.1 },
  "The tanglecube": { axis: "level", from: -18, to: 4 },
  "A double torus": { axis: "level", from: 0.005, to: 0.1 },
  "A gyroid, cut open": { axis: "level", from: -1.5, to: 1.5 },
  "Research: a sphere grows through its box": {
    axis: "level",
    from: 0.5,
    to: 3.5,
  },
  "Research: a drop born beside a bowl": { axis: "level", from: -1, to: 1.4 },
  "Research: two drops parted by a": { axis: "a", from: 0.6, to: 1.4 },
  "Research: a pole": { axis: "level", from: 0.5, to: 1.5 },
};

// At most this many candidates get previews, two each.
const previewed = 6;

type Previews = Record<number, { before?: string; after?: string }>;

export function ScanPanel({
  config,
  usesA,
  preset,
  settle,
  onChoose,
  run,
  look,
  held,
}: {
  config: SpatialConfig;
  usesA: boolean;
  preset: string;
  // Waits for the notebook's pending evaluations; false if another study
  // replaced this one meanwhile.
  settle: () => Promise<boolean>;
  onChoose: (axis: ScanAxis, value: number) => void;
  run: (config: SpatialConfig) => Promise<SpatialResult>;
  look: {
    camera: SpatialCamera;
    layers: Layers;
    dark: boolean;
    scheme: ColorScheme;
    cut: CutSpec | null;
    sight: Sight;
  };
  held: boolean;
}) {
  const q = config.implicit;
  const suggested = scanRanges[preset];
  const [axis, setAxis] = useState<ScanAxis>(suggested?.axis ?? "level");
  const around = (v: number): [number, number] => {
    const d = Math.max(0.25, Math.abs(v) * 0.25);
    return [v - d, v + d];
  };
  const [range, setRange] = useState<[number, number]>(() =>
    suggested
      ? [suggested.from, suggested.to]
      : around(axis === "level" ? q.level : q.a),
  );
  // A newly opened example suggests its own range.
  useEffect(() => {
    if (!suggested) return;
    setAxis(suggested.axis);
    setRange([suggested.from, suggested.to]);
  }, [preset]);
  const [samples, setSamples] = useState(17);
  const [depth, setDepth] = useState(5);
  const [recheck, setRecheck] = useState(true);
  const [critical, setCritical] = useState(true);
  const [state, setState] = useState<ScanState>({ status: "idle" });
  const session = useRef<ScanSession | null>(null);
  useEffect(() => {
    const s = new ScanSession(setState);
    session.current = s;
    return () => s.dispose();
  }, []);
  // The scan belongs to the study it was asked of: any change but the
  // scanned value itself forgets it.
  const studyKey = JSON.stringify({
    ...q,
    sections: null,
    ...(axis === "level" ? { level: 0 } : { a: 0 }),
    axis,
  });
  const scanned = useRef("");
  useEffect(() => {
    if (scanned.current && scanned.current !== studyKey) {
      scanned.current = "";
      session.current?.clear();
    }
  }, [studyKey]);

  async function scan() {
    if (!(await settle())) return;
    const request: ScanRequest = {
      implicit: { ...q },
      axis,
      from: range[0],
      to: range[1],
      samples,
      depth,
      recheck,
      critical,
    };
    scanned.current = studyKey;
    void session.current?.start(request);
  }
  const running = state.status === "running";
  const result: ScanResult | null =
    state.status === "running" ||
    state.status === "done" ||
    state.status === "canceled"
      ? state.result
      : null;
  const error =
    state.status === "failed"
      ? { field: state.field ?? "", message: state.message }
      : null;
  // A scan error is shown under the scan's own field it names.
  const errorLabel: Record<string, string> = {
    "scan.axis": "Scan along",
    "scan.from": "Scan from",
    "scan.to": "Scan to",
    "scan.samples": "Samples",
    "scan.depth": "Bisections",
  };
  const target = useMemo<FieldErrorTarget | null>(
    () =>
      error
        ? {
            label: errorLabel[error.field] ?? "Scan from",
            message: error.message,
            claim: () => {},
            touch: () => {},
          }
        : null,
    [error?.field, error?.message],
  );

  // Previews: the study at each shown candidate's two ends, one calculation
  // at a time, after the scan and while the notebook is idle.
  const [previews, setPreviews] = useState<Previews>({});
  const previewKey =
    state.status === "done" || state.status === "canceled"
      ? JSON.stringify([
          studyKey,
          state.result?.candidates.map((c) => [c.lo, c.hi]),
          look.layers,
          look.dark,
          look.scheme,
          look.cut,
          look.sight,
        ])
      : "";
  useEffect(() => {
    setPreviews({});
    if (!previewKey || !result || held) return;
    let current = true;
    const urls: string[] = [];
    const at = (v: number): SpatialConfig => ({
      ...config,
      implicit: {
        ...config.implicit,
        ...(result.axis === "level" ? { level: v } : { a: v }),
      },
    });
    void (async () => {
      const shown = result.candidates.slice(0, previewed);
      for (let k = 0; k < shown.length && current; k++) {
        for (const side of ["before", "after"] as const) {
          const c = shown[k];
          try {
            const r = await run(at(side === "before" ? c.lo : c.hi));
            if (!current) return;
            const intent = {
              ...look,
              story: { previewZoom: 1 },
            } as unknown as PreviewIntent;
            const url = URL.createObjectURL(await drawPreview(r, intent));
            if (!current) {
              URL.revokeObjectURL(url);
              return;
            }
            urls.push(url);
            setPreviews((p) => ({ ...p, [k]: { ...p[k], [side]: url } }));
          } catch {
            // A failed preview leaves its place empty.
          }
        }
      }
    })();
    return () => {
      current = false;
      for (const u of urls) URL.revokeObjectURL(u);
    };
  }, [previewKey, held]);

  const value = axis === "level" ? q.level : q.a;
  return (
    <details className="spatial-details scan-panel" open>
      <summary>Scan for changes (research)</summary>
      <FieldErrorContext.Provider value={target}>
        <p className="note">
          Meshes the study across a range and reports where its pieces change. A
          candidate is what the mesh shows on these grids, not a proof.
        </p>
        <Field
          label="Scan along"
          help={tiered(
            "The level c, or the shape parameter a when F reads it.",
            "Only the chosen value changes; the box, cells and refinement stay the study's.",
          )}
        >
          <select
            value={axis}
            disabled={running}
            onChange={(e) => {
              const next = e.target.value as ScanAxis;
              setAxis(next);
              setRange(around(next === "level" ? q.level : q.a));
            }}
          >
            <option value="level">Level c</option>
            <option value="a" disabled={!usesA}>
              Shape parameter a{usesA ? "" : " (F does not read a)"}
            </option>
          </select>
        </Field>
        <div className="pair">
          <Field
            label="Scan from"
            help={tiered(
              "The range scanned, both ends included; nothing outside it.",
              "Each end within ±100000, the second above the first.",
            )}
          >
            <ScalarInput
              name="Scan from"
              value={range[0]}
              onChange={(v) => setRange((r) => [v, r[1]])}
            />
          </Field>
          <Field label="Scan to">
            <ScalarInput
              name="Scan to"
              value={range[1]}
              onChange={(v) => setRange((r) => [r[0], v])}
            />
          </Field>
        </div>
        <div className="pair">
          <Field
            label="Samples"
            help={tiered(
              `Evenly spaced meshes, ${scanLimits.samples[0]}–${scanLimits.samples[1]}.`,
              "Two changes between neighboring samples that undo each other are not seen.",
            )}
          >
            <input
              type="number"
              min={scanLimits.samples[0]}
              max={scanLimits.samples[1]}
              step="1"
              value={Number.isNaN(samples) ? "" : samples}
              disabled={running}
              onChange={(e) => setSamples(e.target.valueAsNumber)}
            />
          </Field>
          <Field
            label="Bisections"
            help={tiered(
              `Halvings of each bracket, ${scanLimits.depth[0]}–${scanLimits.depth[1]}.`,
              "Finer brackets on one grid; the grids' disagreement usually outweighs them.",
            )}
          >
            <input
              type="number"
              min={scanLimits.depth[0]}
              max={scanLimits.depth[1]}
              step="1"
              value={Number.isNaN(depth) ? "" : depth}
              disabled={running}
              onChange={(e) => setDepth(e.target.valueAsNumber)}
            />
          </Field>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={recheck}
            disabled={running}
            onChange={(e) => setRecheck(e.target.checked)}
          />
          Recheck on two other grids
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={critical}
            disabled={running}
            onChange={(e) => setCritical(e.target.checked)}
          />
          Look for critical points
        </label>
        <div className="scan-actions">
          {running ? (
            <button type="button" onClick={() => session.current?.cancel()}>
              Cancel scan
            </button>
          ) : (
            <button type="button" onClick={() => void scan()}>
              Scan
            </button>
          )}
        </div>
      </FieldErrorContext.Provider>
      {result && (
        <ScanReport
          result={result}
          state={state}
          previews={previews}
          value={value}
          axis={axis}
          onChoose={async (a, v) => {
            if (await settle()) onChoose(a, v);
          }}
        />
      )}
      {state.status === "running" && !result && (
        <p className="note">Starting the scan…</p>
      )}
    </details>
  );
}

function ScanReport({
  result,
  state,
  previews,
  value,
  axis,
  onChoose,
}: {
  result: ScanResult;
  state: ScanState;
  previews: Previews;
  value: number;
  axis: ScanAxis;
  onChoose: (axis: ScanAxis, value: number) => void;
}) {
  const running = state.status === "running";
  const elapsed = "elapsed" in state ? state.elapsed : 0;
  const changes = result.candidates.filter(
    (c) => c.kind === "change" || c.kind === "box",
  ).length;
  const summary = running
    ? `Meshed ${plural(result.calls, "study", "studies")}…`
    : `${state.status === "canceled" ? "Canceled" : stopText(result)}: ${plural(changes, "candidate", "candidates")} from ${plural(result.calls, "mesh", "meshes")}, in ${readout(elapsed / 1000, 2)} s.`;
  return (
    <div className="scan-report">
      <p className="note" role="status">
        {running ? "" : summary}
      </p>
      {running && <p className="note">{summary}</p>}
      <ScanTrack result={result} value={value} />
      {result.unresolved > 0 && (
        <p className="note">
          {plural(result.unresolved, "sample", "samples")} left out: their
          meshes are incomplete, so they show no topology.
        </p>
      )}
      <ol className="scan-candidates">
        {result.candidates.map((c, k) => (
          <CandidateItem
            key={k}
            c={c}
            axis={result.axis}
            images={previews[k]}
            value={value}
            onChoose={(v) => onChoose(result.axis, v)}
            selectable={result.axis === axis}
          />
        ))}
      </ol>
      {!running && !result.candidates.length && (
        <p className="note">
          No sample reads differently from its neighbor. A change between two
          samples that is undone before the next is not seen; try more samples.
        </p>
      )}
    </div>
  );
}

// The range as a line: a tick at each sample meshed, by what it read, and
// each candidate's spread. Outside the drawing, so labels may appear.
function ScanTrack({ result, value }: { result: ScanResult; value: number }) {
  const width = 300,
    height = 36;
  const x = (v: number) =>
    4 + ((v - result.from) / (result.to - result.from)) * (width - 8);
  const tone = (s: ScanResult["samples"][number]) =>
    s.reading.status === "complete"
      ? "complete"
      : s.reading.status === "cut"
        ? "cut"
        : "unresolved";
  return (
    <svg
      className="scan-track"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${count(result.samples.length)} samples from ${readout(result.from)} to ${readout(result.to)}`}
    >
      <line x1={4} x2={width - 4} y1={18} y2={18} className="scan-axis" />
      {result.candidates.map((c, k) => (
        <rect
          key={k}
          x={x(c.spread[0]) - 2}
          width={Math.max(4, x(c.spread[1]) - x(c.spread[0]) + 4)}
          y={6}
          height={24}
          className={`scan-spread ${c.kind}`}
        />
      ))}
      {result.samples.map((s, k) => (
        <line
          key={k}
          x1={x(s.value)}
          x2={x(s.value)}
          y1={s.coarse ? 10 : 14}
          y2={s.coarse ? 26 : 22}
          className={`scan-tick ${tone(s)}${s.reading.singular ? " singular" : ""}`}
        />
      ))}
      {value >= result.from && value <= result.to && (
        <circle cx={x(value)} cy={18} r={3} className="scan-here" />
      )}
    </svg>
  );
}

function CandidateItem({
  c,
  axis,
  images,
  value,
  onChoose,
  selectable,
}: {
  c: ScanCandidate;
  axis: ScanAxis;
  images?: { before?: string; after?: string };
  value: number;
  onChoose: (v: number) => void;
  selectable: boolean;
}) {
  const where =
    c.spread[0] === c.lo && c.spread[1] === c.hi
      ? `Between ${readout(c.lo)} and ${readout(c.hi)}.`
      : `Between ${readout(c.lo)} and ${readout(c.hi)} on this grid; from ${readout(c.spread[0])} to ${readout(c.spread[1])} across the grids.`;
  const rechecks = [c.lattice, c.finer]
    .filter((r) => r)
    .map(
      (r) =>
        `${count(r!.cells)} cells: ${
          {
            pending: "pending",
            agrees: "the same change",
            below: "the change lies lower",
            above: "the change lies higher",
            differs: "reads differently",
            unresolved: "incomplete",
            skipped: "skipped",
          }[r!.outcome]
        }`,
    );
  const critical = c.critical ?? [];
  return (
    <li className={`scan-candidate ${c.kind}`}>
      <p className="scan-title">
        <b>{candidateTitle(axis, c)}</b>
        <span className={`scan-stability ${c.stability}`}>
          {stabilityText[c.stability]}
        </span>
      </p>
      <p className="note">
        {describeReading(c.before)} → {describeReading(c.after)}. {where}
        {c.through
          ? ` Through a sample at ${readout(c.through.value)} that reads ${describeReading(c.through.reading)}${c.through.reading.singular ? ", with vertices where ∇F vanishes" : ""}.`
          : ""}
      </p>
      {rechecks.length > 0 && (
        <p className="note">Rechecked on {rechecks.join("; ")}.</p>
      )}
      {critical.length > 0 && (
        <p className="note">
          {critical
            .map(
              (k) =>
                `A critical point${k.points > 1 ? ` (${count(k.points)} found)` : ""} at ${axisValue(axis, k.value)}${k.index >= 0 ? `, index ${count(k.index)}` : ", degenerate"}`,
            )
            .join("; ")}
          , found numerically.
        </p>
      )}
      {(c.kind === "change" || c.kind === "box") && (
        <div className="scan-sides">
          {(["before", "after"] as const).map((side) => {
            const v = side === "before" ? c.lo : c.hi;
            return (
              <figure key={side}>
                {images?.[side] ? (
                  <img src={images[side]} alt="" width={180} height={120} />
                ) : (
                  <div className="scan-placeholder" />
                )}
                <button
                  type="button"
                  aria-pressed={value === v}
                  disabled={!selectable}
                  onClick={() => onChoose(v)}
                >
                  {side === "before" ? "Before" : "After"}: {axisValue(axis, v)}
                </button>
              </figure>
            );
          })}
        </div>
      )}
    </li>
  );
}
