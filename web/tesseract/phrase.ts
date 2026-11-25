// 4D animation phrases: one fixed 4D study moved, cut and viewed through
// named phases on one timeline (docs/architecture.md, 4D animation phrases).
// The timeline, its arrangement and its limits are shared with the other
// notebooks (../phrase-timeline.ts). The object's descriptor names the
// continuous values a phrase may move (ObjectDescriptor.phrase); this module
// applies them, checks the camera keys of each spatial pane and a
// selection's cuts, compiles boundary states from the immutable entry study
// and samples any absolute time. Nothing here parses expressions: Go
// resolves each key beforehand.
import {
  locatePhase,
  phraseKeys,
  phraseTrackTargets,
  timelineError,
  type Timeline,
  type TimelinePhase,
} from "../phrase-timeline";
import { roundedGenerated } from "../atlas-queue";
import type { Pace } from "../timing";
import { modeLabel, objects } from "./objects";
import { defaultNeighborhoodWidth } from "./sphere-paths";
import type { Config, Result, TesseractTarget, View } from "./types";

// The drawing's orbit and zoom limits (Plot.tsx), and the whole turns a
// camera key may add on its way.
export const pitchLimit = 1.5;
export const zoomLimits: readonly [number, number] = [0.2, 8];
export const maxTurns = 8;

const angleIndex = { xy: 0, xz: 1, yz: 2, xw: 3, yw: 4, zw: 5 } as const;
const isAngle = (t: TesseractTarget): t is keyof typeof angleIndex =>
  t in angleIndex;
const targetLabels: Record<TesseractTarget, string> = {
  xy: "xy angle",
  xz: "xz angle",
  yz: "yz angle",
  xw: "xw angle",
  yw: "yw angle",
  zw: "zw angle",
  distance: "4D eye distance",
  clip: "Projection window radius",
  slice: "Slice offset h",
  spread: "Section spread",
  "weave.alpha": "Central latitude α",
  "weave.spread": "Latitude spread",
  "weave.amplitude": "Flower amplitude A",
  "weave.tilt": "Tilt β",
  "weave.width": "Neighborhood width",
  "weave.trace": "Trace (turns)",
  "root.t": "Journey parameter t",
  "root.radius": "Radius r",
};
export const tesseractTargetLabel = (t: TesseractTarget) => targetLabels[t];

// The values a phrase may move in this study, its default first.
export const tesseractPhraseTargets = (config: Config): TesseractTarget[] =>
  objects[config.object].phrase?.(config) ?? [];

// Where the journey's moving point stands: t between Trace start and Trace
// end at the trace's progress (engine4/root.go).
const rootT = (c: Config) => {
  const { from, to, trace = 0 } = c.root!;
  return trace === 0
    ? from
    : trace === 1
      ? to
      : from * (1 - trace) + to * trace;
};
export function tesseractTargetValue(c: Config, t: TesseractTarget): number {
  if (isAngle(t)) return c.angles[angleIndex[t]];
  switch (t) {
    case "distance":
    case "clip":
    case "slice":
    case "spread":
      return c[t];
    case "weave.alpha":
      return c.weave!.alpha;
    case "weave.spread":
      return c.weave!.spread;
    case "weave.amplitude":
      return c.weave!.amplitude ?? 0;
    case "weave.tilt":
      return c.weave!.tilt ?? 0;
    case "weave.width":
      return c.weave!.width ?? defaultNeighborhoodWidth;
    case "weave.trace":
      return c.weave!.trace ?? 0;
    case "root.t":
      return rootT(c);
    case "root.radius":
      return c.root!.radius;
  }
}
// The study with one value set, and otherwise the same object: at its own
// value a study is returned unchanged, so a phrase at its entry values asks
// for the study exactly as drawn. The journey's point moves from Trace
// start, which stays its start marker; the trace lies behind it as seen
// from there.
export function applyTesseractTarget(
  c: Config,
  t: TesseractTarget,
  v: number,
): Config {
  if (Object.is(tesseractTargetValue(c, t), v)) return c;
  if (isAngle(t)) {
    const angles = [...c.angles] as Config["angles"];
    angles[angleIndex[t]] = v;
    return { ...c, angles };
  }
  switch (t) {
    case "distance":
    case "clip":
    case "slice":
    case "spread":
      return { ...c, [t]: v };
    case "weave.alpha":
      return { ...c, weave: { ...c.weave!, alpha: v } };
    case "weave.spread":
      return { ...c, weave: { ...c.weave!, spread: v } };
    case "weave.amplitude":
      return { ...c, weave: { ...c.weave!, amplitude: v } };
    case "weave.tilt":
      return { ...c, weave: { ...c.weave!, tilt: v } };
    case "weave.width":
      return { ...c, weave: { ...c.weave!, width: v } };
    case "weave.trace":
      return { ...c, weave: { ...c.weave!, trace: v } };
    case "root.t":
      return { ...c, root: { ...c.root!, to: v, trace: 1 } };
    case "root.radius":
      return { ...c, root: { ...c.root!, radius: v } };
  }
}

// The panes whose views a phrase may key: the drawing's own view, and in
// paired views the companion's, unless the pane is a flat diagram.
export type PhrasePane = "view" | "companionView";
export function phrasePanes(c: Config): PhrasePane[] {
  const d = objects[c.object];
  if (c.mode === "paired" && d.pairedModes)
    return (["view", "companionView"] as const).filter(
      (_, i) => !d.flat?.({ ...c, mode: d.pairedModes![i] }),
    );
  return d.flat?.(c) ? [] : ["view"];
}
// A pane's name, as its panel is captioned.
export function paneLabel(c: Config, pane: PhrasePane): string {
  const d = objects[c.object];
  const mode =
    c.mode === "paired" && d.pairedModes
      ? d.pairedModes[pane === "view" ? 0 : 1]
      : c.mode;
  return d.panelLabels?.[mode] ?? modeLabel(c.object, mode);
}
// The selection a phrase may cut to at a phase start, where the study
// shows one.
function selectionOf(c: Config) {
  const s = objects[c.object].selection;
  return s?.visible(c) ? s : undefined;
}

// A camera key: a pane's view at the phase's end, with the whole turns
// added on the way to it.
export type TesseractPhraseView = View & { turns: number };
export type TesseractPhrasePhase = TimelinePhase<TesseractTarget> & {
  // Each spatial pane's view at the phase's end, or the opening view;
  // omitted holds the preceding view.
  view?: TesseractPhraseView | "entry";
  companionView?: TesseractPhraseView | "entry";
  // The selected item from the phase's start (counted from 0): a cut.
  selected?: number;
};
export type TesseractPhrase = Timeline<TesseractTarget, TesseractPhrasePhase>;

export const tesseractPhraseKeys = (phrase: TesseractPhrase) =>
  phraseKeys(phrase);
// The name of a pane's field in errors and controls: the second spatial
// pane's carries a 2, as further parameters' keys do.
const paneSuffix = (pane: PhrasePane) => (pane === "view" ? "" : " 2");

function viewError(
  view: unknown,
  phase: number,
  suffix: string,
): string | null {
  if (view === "entry") return null;
  const v = (typeof view === "object" && view) as TesseractPhraseView | false;
  if (
    !v ||
    ![v.yaw, v.pitch, v.zoom, v.panX, v.panY].every(
      (x) => typeof x === "number" && Number.isFinite(x),
    ) ||
    Math.abs(v.pitch) > pitchLimit ||
    v.zoom < zoomLimits[0] ||
    v.zoom > zoomLimits[1]
  )
    return `Phase ${phase + 1} view${suffix} is outside the drawing's orbit and zoom limits.`;
  if (!Number.isInteger(v.turns) || Math.abs(v.turns) > maxTurns)
    return `Phase ${phase + 1} turns${suffix} must be a whole number from −${maxTurns} to ${maxTurns}.`;
  return null;
}
export function tesseractPhraseError(
  config: Config,
  phrase: TesseractPhrase,
): string | null {
  const panes = phrasePanes(config);
  const selection = selectionOf(config);
  const named = (
    objects[config.object].selection?.label ?? "Selection"
  ).toLowerCase();
  return timelineError(
    phrase,
    tesseractPhraseTargets(config),
    tesseractTargetLabel,
    {
      phase: (p, i) => {
        for (const pane of ["view", "companionView"] as const) {
          const suffix = paneSuffix(pane);
          if (p[pane] === undefined) continue;
          if (!panes.includes(pane))
            return `Phase ${i + 1} view${suffix}: this view has no ${suffix ? "second camera" : "camera"} to move.`;
          const problem = viewError(p[pane], i, suffix);
          if (problem) return problem;
        }
        if (p.selected === undefined) return null;
        if (!selection)
          return `Phase ${i + 1} ${named}: this view has no selection to change.`;
        const count = selection.count(config);
        return Number.isInteger(p.selected) &&
          p.selected >= 0 &&
          p.selected < count
          ? null
          : `Phase ${i + 1} ${named} must be a whole number from 1 to ${count}.`;
      },
    },
  );
}

// A constant's text: an exact multiple of π over a small whole number as
// such (Go evaluates k*pi/n in the same order), and otherwise the shortest
// text that reads back as the same number.
export function constantText(v: number): string {
  for (let n = 1; n <= 12; n++)
    for (let k = -48; k <= 48; k++) {
      if (k === 0 || (k * Math.PI) / n !== v) continue;
      const coefficient = k === 1 ? "" : k === -1 ? "-" : `${k}*`;
      return `${coefficient}pi${n === 1 ? "" : `/${n}`}`;
    }
  return String(v);
}
// A starter end value: a quarter turn further for an angle, one turn of
// the trace, the whole journey of 2πn, and otherwise three quarters of the
// value without a binary tail (contributing.md, Generated numeric
// defaults).
function starterKey(c: Config, t: TesseractTarget, start: number): string {
  if (isAngle(t)) return start === 0 ? "pi/2" : `${constantText(start)} + pi/2`;
  if (t === "weave.trace") return String(start + 1);
  if (t === "root.t") {
    const n = c.root!.degree ?? 2;
    return start < n * Math.PI ? `${2 * n}*pi` : "0";
  }
  return start === 0
    ? "0.5"
    : String(
        roundedGenerated(
          start * 0.75,
          Math.max(Math.abs(start), Math.abs(start * 0.75)),
        ),
      );
}
// A starter for a study without a phrase: move its first parameter, hold
// and return exactly, at the views it opens with.
export function defaultTesseractPhrase(
  config: Config,
  target = tesseractPhraseTargets(config)[0],
): TesseractPhrase {
  const start = tesseractTargetValue(config, target);
  return {
    target,
    phases: [
      {
        name: "Move the parameter",
        duration: 4,
        pace: "ease",
        key: starterKey(config, target, start),
      },
      { name: "Hold", duration: 1, pace: "ease" },
      { name: "Return", duration: 4, pace: "ease", key: constantText(start) },
    ],
  };
}

type Boundary = {
  values: number[];
  // The selected item, where the study shows a selection.
  selected?: number;
  view: View;
  companionView: View;
};
export type CompiledTesseractPhrase = {
  config: Config;
  targets: TesseractTarget[];
  labels: string[];
  duration: number;
  entry: { view: View; diagramView: View };
  phases: {
    name: string;
    start: number;
    end: number;
    pace: Pace;
    from: Boundary;
    to: Boundary;
    // Whether the phase moves a parameter, so its end needs new geometry.
    moves: boolean;
    turns: Record<PhrasePane, number>;
  }[];
};

const plainView = ({ yaw, pitch, zoom, panX, panY }: View): View => ({
  yaw,
  pitch,
  zoom,
  panX,
  panY,
});
// Compiles every boundary once from the immutable entry study. keys are the
// Go-resolved values of tesseractPhraseKeys, in that order; entry holds the
// views when Play is pressed.
export function compileTesseractPhrase(
  config: Config,
  phrase: TesseractPhrase,
  keys: number[],
  entry: { view: View; diagramView: View },
): CompiledTesseractPhrase {
  const error = tesseractPhraseError(config, phrase);
  if (error) throw new Error(error);
  const texts = tesseractPhraseKeys(phrase);
  if (keys.length !== texts.length || !keys.every(Number.isFinite))
    throw new Error("Every phase key must resolve to a finite constant.");
  const targets = phraseTrackTargets(phrase);
  const selection = selectionOf(config);
  const opening = {
    view: plainView(entry.view),
    companionView: plainView(entry.diagramView),
  };
  let previous: Boundary = {
    values: targets.map((t) => tesseractTargetValue(config, t)),
    ...(selection && { selected: selection.get(config) }),
    ...opening,
  };
  let duration = 0,
    k = 0;
  const phases = phrase.phases.map((p, i) => {
    const from: Boundary = {
      ...previous,
      ...(p.selected !== undefined && { selected: p.selected }),
    };
    const values = from.values.map((held, track) =>
      texts[k]?.phase === i && texts[k].track === track ? keys[k++] : held,
    );
    const keyed = (pane: PhrasePane) => {
      const key = p[pane];
      return key === undefined
        ? from[pane]
        : key === "entry"
          ? opening[pane]
          : plainView(key);
    };
    const to: Boundary = {
      ...from,
      values,
      view: keyed("view"),
      companionView: keyed("companionView"),
    };
    const start = duration;
    duration += p.duration;
    previous = to;
    const turns = (pane: PhrasePane) =>
      typeof p[pane] === "object" ? (p[pane] as TesseractPhraseView).turns : 0;
    return {
      name: p.name,
      start,
      end: duration,
      pace: p.pace,
      from,
      to,
      moves: values.some((v, track) => v !== from.values[track]),
      turns: { view: turns("view"), companionView: turns("companionView") },
    };
  });
  return {
    config: structuredClone(config),
    targets,
    labels: targets.map(tesseractTargetLabel),
    duration,
    entry: { view: { ...entry.view }, diagramView: { ...entry.diagramView } },
    phases,
  };
}

// A camera leg at progress p: yaw the shorter way round plus whole turns,
// pitch and pan linearly, zoom geometrically; exactly its views at both
// ends (mathematics.md#4d-animation-phrases).
export function cameraLeg(from: View, to: View, turns: number, p: number) {
  if (p <= 0 || (from === to && turns === 0)) return from;
  if (p >= 1) return to;
  const tau = 2 * Math.PI;
  let d = (to.yaw - from.yaw) % tau;
  if (d > Math.PI) d -= tau;
  else if (d <= -Math.PI) d += tau;
  d += tau * turns;
  const mix = (a: number, b: number) => a + (b - a) * p;
  return {
    yaw: from.yaw + d * p,
    pitch: mix(from.pitch, to.pitch),
    zoom: from.zoom * Math.pow(to.zoom / from.zoom, p),
    panX: mix(from.panX, to.panX),
    panY: mix(from.panY, to.panY),
  };
}

// The entry study with each track at a value and the selection, if any:
// the study a phrase asks the engine for.
export function phraseConfig(
  phrase: CompiledTesseractPhrase,
  values: number[],
  selected: number | undefined,
): Config {
  let config = phrase.config;
  const selection = selectionOf(config);
  if (selection && selected !== undefined && selected !== selection.get(config))
    config = selection.set(config, selected);
  return phrase.targets.reduce(
    (c, t, track) => applyTesseractTarget(c, t, values[track]),
    config,
  );
}
// The phrase's whole state at absolute seconds, from the boundaries alone.
export function tesseractPhraseAt(
  phrase: CompiledTesseractPhrase,
  seconds: number,
) {
  const { index, phase, p } = locatePhase(phrase, seconds);
  const mix = (a: number, b: number) => (a === b ? a : a * (1 - p) + b * p);
  const values = phase.from.values.map((from, track) =>
    mix(from, phase.to.values[track]),
  );
  return {
    config: phraseConfig(phrase, values, phase.from.selected),
    index,
    p,
    values,
    selected: phase.from.selected,
    phase: phase.name,
    view: cameraLeg(phase.from.view, phase.to.view, phase.turns.view, p),
    companionView: cameraLeg(
      phase.from.companionView,
      phase.to.companionView,
      phase.turns.companionView,
      p,
    ),
  };
}

// Each track's least and greatest value over the phrase, for its readout.
export const phraseRanges = (phrase: CompiledTesseractPhrase) =>
  phrase.targets.map((_, track) => {
    const all = phrase.phases.flatMap((p) => [
      p.from.values[track],
      p.to.values[track],
    ]);
    return [Math.min(...all), Math.max(...all)] as const;
  });
type PhraseEngine = { tesseract: (config: Config) => Promise<Result> };
export type TesseractPhraseFrame = {
  config: Config;
  result: Result;
  // Both panes' views: the drawing's and its companion's.
  view: View;
  diagramView: View;
  phase: string;
  tracks: { label: string; value: number; range: readonly [number, number] }[];
};
// One sampler for playback, seeks, loop checks and export. The caller maps
// repeat time into absolute phrase seconds and owns cancellation. Each
// engine keeps only its latest geometry, keyed by every track's value and
// the selection: holds and camera legs make no request, and a frame at the
// entry values and selection is the study as drawn (original).
export function createTesseractPhraseSampler(options: {
  phrase: CompiledTesseractPhrase;
  original: { config: Config; result: Result };
}) {
  const { phrase, original } = options;
  const frames = new WeakMap<
    PhraseEngine,
    { input: string; result: Promise<Result> }
  >();
  const opening = phrase.phases[0].from;
  const openingSelected = selectionOf(phrase.config)?.get(phrase.config);
  const ranges = phraseRanges(phrase);
  return async (
    seconds: number,
    engine: PhraseEngine,
  ): Promise<TesseractPhraseFrame> => {
    const state = tesseractPhraseAt(phrase, seconds);
    const entry =
      state.values.every((v, k) => v === opening.values[k]) &&
      state.selected === openingSelected;
    const input = `${state.values.join()}|${state.selected ?? ""}`;
    let cached = frames.get(engine);
    if (!cached || cached.input !== input) {
      const pending = entry
        ? Promise.resolve(original.result)
        : engine.tesseract(state.config);
      cached = { input, result: pending };
      frames.set(engine, cached);
      const mine = cached;
      pending.catch(() => {
        if (frames.get(engine) === mine) frames.delete(engine);
      });
    }
    const result = await cached.result;
    return {
      config: entry ? original.config : state.config,
      result,
      view: state.view,
      diagramView: state.companionView,
      phase: state.phase,
      tracks: phrase.targets.map((_, track) => ({
        label: phrase.labels[track],
        value: state.values[track],
        range: ranges[track],
      })),
    };
  };
}

// A prepared phrase: compiled from the study as Play found it, with the
// study's own frame and the sampler every phrase frame comes from.
export type PhraseSession = {
  compiled: CompiledTesseractPhrase;
  original: { config: Config; result: Result };
  sample: ReturnType<typeof createTesseractPhraseSampler>;
};

// The field a phrase problem names, so it is shown under that control.
export const tesseractPhraseProblemField = (problem?: string) =>
  /^Phase \d+ (duration|key \d|key|view \d|view|turns \d|turns|name|selected \w+)\b/.exec(
    problem ?? "",
  )?.[0];
