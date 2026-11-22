// Scan for changes (scan.ts): an implicit study's scan along its level or
// shape parameter, its progress, and the candidates it found, each led by
// its critical point when one was found, with small previews of the study
// either side that draw that side at full quality when chosen.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { roundedGenerated } from "../atlas-queue";
import type { EngineClient } from "../engine-client";
import {
  CheckSetting,
  Field,
  FieldErrorContext,
  HelpText,
  HelpToggle,
  useHelp,
  type FieldErrorTarget,
} from "../Field";
import { tiered } from "../help";
import { useShowDrawing } from "../MobileNotebookNav";
import { count, plural, readout } from "../number-format";
import { ScalarInput, ScalarStatus, type ScalarState } from "../ScalarInput";
import { drawPreview, type PreviewLook } from "./event-previews";
import {
  axisValue,
  candidateNote,
  candidateTitle,
  indexName,
  leadingCritical,
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
import {
  closeUpZoom,
  ScanPreviews,
  scanPreviewed,
  type ScanPreviewIntent,
  type ScanPreviewSlots,
} from "./scan-previews";
import type { SpatialConfig, SpatialResult } from "./types";

export type ScanSuggestion = { axis: ScanAxis; from: number; to: number };

// The panel's always-visible note, and its help.
export const scanIntro =
  "Meshes the study across a range and lists where its pieces change: what these grids show, not a proof.";
export const scanIntroHelp = tiered(
  `At most ${count(scanLimits.cells)} grid cells and ${count(scanLimits.calls)} meshes a scan; Cancel keeps what was found.`,
  "Changing the study, except the value scanned, forgets the scan. Nothing of it enters a link or export.",
);
export const scanAxisHelp = tiered(
  "The value scanned: the level c, or the shape parameter a when F reads it.",
  "The box, cells and refinement stay the study's. Each mesh is kept only as its reading: the Euler characteristics of its closed pieces and of the pieces the box cuts.",
);
export const scanRangeHelp = tiered(
  "The range scanned, both ends included.",
  "Nothing outside it is searched. Each end within ±100000, the second above the first.",
);
export const scanSamplesHelp = tiered(
  `Evenly spaced meshes, ${scanLimits.samples[0]}–${scanLimits.samples[1]}.`,
  "A change undone before the next sample is not seen; more samples see closer pairs.",
);
export const scanDepthHelp = tiered(
  `Halvings of each bracket, ${scanLimits.depth[0]}–${scanLimits.depth[1]}.`,
  "Bisection stops early when the rechecks need the rest of the work limit. The grids' disagreement usually outweighs a narrower bracket.",
);
export const scanRecheckHelp = tiered(
  "Looks for each change again on two other grids.",
  "One with a cell more, which moves the lattice, and one with half again as many (two thirds at the grid limit). A change found on all three is stable, and its spread across them is its uncertainty.",
);
export const scanCriticalHelp = tiered(
  "Looks beside each change for points where ∇F vanishes, by Newton's method.",
  "Numerical evidence, not a certificate. It finds a birth's level, which the mesh sees late, and tells a change inside the box from one the box makes. Unstable box changes with none beside them merge.",
);

// A range about a value, for a study no example suggests one for.
function around(v: number): [number, number] {
  const d = Math.max(0.25, Math.abs(v) / 4);
  const scale = Math.max(Math.abs(v), d);
  return [roundedGenerated(v - d, scale), roundedGenerated(v + d, scale)];
}

// The panel's labels for the scan's request paths, so an error is shown
// under the field it names.
const errorLabel: Record<string, string> = {
  "scan.axis": "Scan along",
  "scan.from": "Scan from",
  "scan.to": "Scan to",
  "scan.samples": "Samples",
  "scan.depth": "Bisections",
};

export function ScanPanel({
  config,
  usesA,
  suggestion,
  client,
  settle,
  onChoose,
  run,
  look,
  held,
}: {
  config: SpatialConfig;
  usesA: boolean;
  // The example's suggested range. The notebook mounts the panel afresh
  // whenever an example or link replaces the study, forgetting any scan.
  suggestion?: ScanSuggestion;
  // The notebook's engine, which resolves the range's expressions.
  client: { current: EngineClient | null };
  // Waits for the notebook's pending evaluations; false if another study
  // replaced this one meanwhile.
  settle: () => Promise<boolean>;
  onChoose: (axis: ScanAxis, value: number) => void;
  run: (config: SpatialConfig) => Promise<SpatialResult>;
  // The previews' look, read when a scan's previews are asked for.
  look: () => PreviewLook;
  held: boolean;
}) {
  const q = config.implicit;
  const value = (axis: ScanAxis) => (axis === "level" ? q.level : q.a);
  const [axis, setAxis] = useState<ScanAxis>(suggestion?.axis ?? "level");
  const [range, setRange] = useState<[number, number]>(() =>
    suggestion ? [suggestion.from, suggestion.to] : around(q.level),
  );
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
  // The range's expressions resolve here, apart from the notebook's, so a
  // range being typed never holds or refuses the study itself.
  const [scalars, setScalars] = useState<Record<string, ScalarState>>({});
  const jobs = useRef(new Set<Promise<void>>());
  const generation = useRef(0);
  const scalarStatus = useMemo(
    () => ({
      client,
      generation,
      track: (job: Promise<void>) => {
        jobs.current.add(job);
        void job.finally(() => jobs.current.delete(job));
      },
      report: (id: string, s: ScalarState | null) =>
        setScalars((old) => {
          if (!s && !(id in old)) return old;
          const next = { ...old };
          if (s) next[id] = s;
          else delete next[id];
          return next;
        }),
    }),
    [],
  );
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
  // An error found before the scan starts, under the field it names.
  const [problem, setProblem] = useState<{
    label: string;
    message: string;
  } | null>(null);

  async function scan() {
    await Promise.allSettled([...jobs.current]);
    if (!(await settle())) return;
    const named = (label: string, message: string) => {
      setProblem({ label, message });
      return false;
    };
    const ok =
      (Number.isFinite(range[0]) ||
        named("Scan from", "Scan from must be a finite constant.")) &&
      (Number.isFinite(range[1]) ||
        named("Scan to", "Scan to must be a finite constant.")) &&
      (Number.isInteger(samples) ||
        named("Samples", "Samples must be a whole number.")) &&
      (Number.isInteger(depth) ||
        named("Bisections", "Bisections must be a whole number."));
    if (!ok) return;
    setProblem(null);
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
  // A range's own parse error first, then one found before starting, then
  // the engine's, each under its field.
  const typed = Object.values(scalars).find((s) => s.error);
  const failedLabel =
    state.status === "failed" ? errorLabel[state.field ?? ""] : undefined;
  const failed =
    state.status === "failed" && failedLabel
      ? { label: failedLabel, message: state.message }
      : null;
  // A refusal of the study itself, or of no one field, is shown once
  // beside Scan: it belongs to none of the scan's fields.
  const refused =
    state.status === "failed" && !failedLabel ? state.message : null;
  const shown = typed?.error
    ? { id: typed.control, message: typed.error }
    : (problem ?? failed);
  const target = useMemo<FieldErrorTarget | null>(
    () =>
      shown
        ? {
            ...("id" in shown && shown.id
              ? { id: shown.id }
              : { label: "label" in shown ? shown.label : "Scan from" }),
            message: shown.message,
            claim: () => {},
            touch: () => {},
          }
        : null,
    [JSON.stringify(shown)],
  );

  // Previews of the first candidates that change, after the scan stops,
  // while the notebook is idle.
  const [slots, setSlots] = useState<ScanPreviewSlots>([]);
  const previews = useRef<ScanPreviews | null>(null);
  useEffect(() => {
    const p = new ScanPreviews(run, drawPreview, setSlots);
    previews.current = p;
    return () => p.dispose();
  }, []);
  const stopped =
    (state.status === "done" || state.status === "canceled") && result
      ? result
      : null;
  const shownLook = look();
  const previewKey = stopped
    ? JSON.stringify([
        studyKey,
        stopped.candidates.map((c) => [c.lo, c.hi]),
        shownLook.layers,
        shownLook.dark,
        shownLook.scheme,
        shownLook.cut,
        shownLook.sight,
      ])
    : "";
  useEffect(() => {
    previews.current?.hold(held);
    if (!stopped) {
      previews.current?.request(null);
      return;
    }
    const at = (v: number): SpatialConfig => ({
      ...config,
      implicit: {
        ...config.implicit,
        ...(stopped.axis === "level" ? { level: v } : { a: v }),
      },
    });
    const intent: ScanPreviewIntent = {
      key: previewKey,
      look: shownLook,
      candidates: previewedOf(stopped).map((c) => {
        const lead = leadingCritical(c);
        return {
          before: at(c.lo),
          after: at(c.hi),
          ...(lead && {
            focus: { center: lead.at, zoom: closeUpZoom(config.implicit) },
          }),
        };
      }),
    };
    previews.current?.request(intent);
  }, [previewKey, held]);

  const showDrawing = useShowDrawing();
  const intro = useHelp();
  return (
    <details className="spatial-details scan-panel">
      <summary>Scan for changes</summary>
      <ScalarStatus.Provider value={scalarStatus}>
        <FieldErrorContext.Provider value={target}>
          <div className="scan-intro">
            <p className="note">
              {scanIntro}{" "}
              <HelpToggle topic="scanning for changes" help={intro} />
            </p>
            <HelpText help={intro}>{scanIntroHelp}</HelpText>
          </div>
          <Field label="Scan along" help={scanAxisHelp}>
            <select
              value={axis}
              disabled={running}
              onChange={(e) => {
                const next = e.target.value as ScanAxis;
                setAxis(next);
                setRange(around(value(next)));
              }}
            >
              <option value="level">Level c</option>
              <option value="a" disabled={!usesA}>
                Shape parameter a{usesA ? "" : " (F does not read a)"}
              </option>
            </select>
          </Field>
          <div className="pair">
            <Field label="Scan from" help={scanRangeHelp}>
              <ScalarInput
                name="Scan from"
                value={range[0]}
                disabled={running}
                onChange={(v) => setRange((r) => [v, r[1]])}
              />
            </Field>
            <Field label="Scan to">
              <ScalarInput
                name="Scan to"
                value={range[1]}
                disabled={running}
                onChange={(v) => setRange((r) => [r[0], v])}
              />
            </Field>
          </div>
          <div className="pair">
            <Field label="Samples" help={scanSamplesHelp}>
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
            <Field label="Bisections" help={scanDepthHelp}>
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
          <CheckSetting
            label="Recheck on two other grids"
            topic="rechecking on two other grids"
            checked={recheck}
            disabled={running}
            onChange={setRecheck}
            help={scanRecheckHelp}
          />
          <CheckSetting
            label="Look for critical points"
            topic="looking for critical points"
            checked={critical}
            disabled={running}
            onChange={setCritical}
            help={scanCriticalHelp}
          />
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
            {refused && (
              <p className="field-error" role="alert">
                {refused}
              </p>
            )}
          </div>
        </FieldErrorContext.Provider>
      </ScalarStatus.Provider>
      {state.status === "running" && !result && (
        <p className="note scan-progress">Starting the scan…</p>
      )}
      {result && (
        <ScanReport
          result={result}
          state={state}
          slots={slots}
          value={value(result.axis)}
          selectable={result.axis === axis}
          onChoose={async (a, v) => {
            if (!(await settle())) return;
            onChoose(a, v);
            showDrawing();
          }}
        />
      )}
    </details>
  );
}

const capitalized = (s: string) => s[0].toUpperCase() + s.slice(1);
const sides = (c: ScanCandidate) => c.kind === "change" || c.kind === "box";
// The candidates with previews: the first that change.
const previewedOf = (r: ScanResult) =>
  r.candidates.filter(sides).slice(0, scanPreviewed);

function ScanReport({
  result,
  state,
  slots,
  value,
  selectable,
  onChoose,
}: {
  result: ScanResult;
  state: ScanState;
  slots: ScanPreviewSlots;
  value: number;
  selectable: boolean;
  onChoose: (axis: ScanAxis, value: number) => void;
}) {
  const running = state.status === "running";
  const elapsed = "elapsed" in state ? state.elapsed : 0;
  const changes = result.candidates.filter(sides).length;
  const unresolved = result.candidates.length - changes;
  const found = [
    plural(changes, "candidate", "candidates"),
    ...(unresolved ? [`${count(unresolved)} singular or unresolved`] : []),
  ].join(" and ");
  const summary = running
    ? `Meshed ${plural(result.calls, "study", "studies")}…`
    : `${stopText({ ...result, stop: state.status === "canceled" ? "canceled" : result.stop })}: ${found} from ${plural(result.calls, "mesh", "meshes")}, in ${readout(elapsed / 1000, 2)} s.`;
  const previewed = previewedOf(result);
  return (
    <div className="scan-report">
      <p className="note" role="status">
        {running ? "" : summary}
      </p>
      {running && <p className="note scan-progress">{summary}</p>}
      <ScanTrack result={result} value={value} />
      {result.curtailed && (
        <p className="note">
          Bisection stopped early, to leave the work limit room for the
          rechecks.
        </p>
      )}
      {result.unresolved > 0 && (
        <p className="note">
          {plural(result.unresolved, "sample", "samples")} left out: their
          meshes are incomplete, so they show no topology.
        </p>
      )}
      {!running && !result.candidates.length && (
        <p className="note">
          No sample reads differently from its neighbor. A change undone before
          the next sample is not seen; try more samples.
        </p>
      )}
      {result.candidates.length > 0 && (
        <ol className="scan-candidates">
          {result.candidates.map((c, k) => {
            const p = previewed.indexOf(c);
            return (
              <CandidateItem
                key={k}
                c={c}
                axis={result.axis}
                slots={p >= 0 ? (slots[p] ?? null) : undefined}
                value={value}
                selectable={selectable && !running}
                onChoose={(v) => onChoose(result.axis, v)}
              />
            );
          })}
        </ol>
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

// A note's two tiers, as help shows them: the brief always, the rest
// behind Show more.
function TieredNote({ brief, more }: { brief: string; more: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="scan-note">
      <p className="note">
        {brief}
        {more && (
          <>
            {" "}
            <button
              type="button"
              className="text-button help-more"
              aria-expanded={open}
              aria-controls={id}
              onClick={() => setOpen(!open)}
            >
              {open ? "Show less" : "Show more"}
            </button>
          </>
        )}
      </p>
      {more && (
        <p className="note" id={id} hidden={!open}>
          {more}
        </p>
      )}
    </div>
  );
}

function CandidateItem({
  c,
  axis,
  slots,
  value,
  selectable,
  onChoose,
}: {
  c: ScanCandidate;
  axis: ScanAxis;
  // A previewed candidate's images (null until asked for); undefined for
  // one past the previewed, which shows its sides without images.
  slots?: ScanPreviewSlots[number] | null;
  value: number;
  selectable: boolean;
  onChoose: (v: number) => void;
}) {
  const lead = leadingCritical(c);
  const note = candidateNote(axis, c);
  const leads = lead && c.kind !== "unresolved";
  const closeUp = leads && slots !== undefined;
  return (
    <li
      className={`scan-candidate ${c.kind}`}
      data-kind={c.kind}
      data-stability={c.stability}
    >
      <p className="scan-title">
        <b>{candidateTitle(axis, c)}</b>
        <span className={`scan-stability ${c.stability}`}>
          {stabilityText[c.stability]}
        </span>
      </p>
      {leads && (
        <p className="scan-lead">
          {capitalized(indexName(axis, lead))} ·{" "}
          {plural(lead.points, "point", "points")} · found numerically
        </p>
      )}
      <TieredNote brief={note.brief} more={note.more} />
      {sides(c) && (
        <>
          {closeUp && (
            <p className="scan-closeup">Close-ups about the critical point</p>
          )}
          <div
            className={`scan-sides${slots === undefined ? " plain" : ""}`}
            role="group"
            aria-label="Either side"
          >
            {(["before", "after"] as const).map((side) => {
              const v = side === "before" ? c.lo : c.hi;
              const slot = slots?.[side];
              return (
                <button
                  type="button"
                  key={side}
                  className="scan-side"
                  data-side={side}
                  aria-pressed={value === v}
                  disabled={!selectable}
                  onClick={() => onChoose(v)}
                >
                  {slots !== undefined && (
                    <span
                      className="scan-image"
                      aria-busy={!slot || slot.status === "pending"}
                    >
                      {slot?.status === "ready" && (
                        <img src={slot.url} alt="" />
                      )}
                    </span>
                  )}
                  <span className="scan-side-label">
                    {side === "before" ? "Before" : "After"} ·{" "}
                    {axisValue(axis, v)}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </li>
  );
}
