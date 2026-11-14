import {
  OverlayJourneyLayout,
  type OverlayGuide,
} from "../OverlayJourneyGuide";
import { withOverlay } from "../overlay-journeys";
import { AppHeader } from "../AppHeader";
import { AnimationButton } from "../AnimationButton";
import { ExportImageMenu } from "../ExportImageMenu";
import { MotionExportSettings, useMotionExport } from "../MotionExportSettings";
import { useDisclosure } from "../useDisclosure";
import { revealDrawing } from "../revealDrawing";
import type { Still } from "../export-image";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { EngineClient, EngineError } from "../engine-client";
import { Field, FieldErrorContext } from "../Field";
import { ScalarInput, ScalarStatus, type ScalarState } from "../ScalarInput";
import { ShareLink } from "../ShareLink";
import { useTheme } from "../useTheme";
import { useQuietFocus } from "../quiet-focus";
import { describeColors } from "../color-schemes";
import { LineWeightField } from "../LineWeightField";
import { tiered, withMore } from "../help";
import { svgWeightHelp } from "../line-weight";
import { play } from "../playback";
import {
  defaultLoom,
  maps,
  mapHelp,
  mapText,
  mapParameterOf,
  withMapParameter,
  coefficientHelp,
  replaceMap,
  loomFrame,
  poleExclusion,
  replaceSource,
  loomRequest,
  traversal,
  memberInterval,
  sourceChoices,
  supportedSource,
  loomPaths,
  pathNote,
  sameCurve,
  type LoomStudy,
  type LoomResult,
  type LoomMarker,
  type LoomSource,
  type LoomRequest,
  type LoomCoefficients,
} from "./model";
import type { LoomEntry } from "./Context";
import { LoomSession } from "./session";
import { PaneDrawing, loomFit, type DrawingProps, type Pane } from "./Drawing";
import { loomStill, loomMovie } from "./export";
import "./loom.css";
import { count as countText } from "../number-format";
const labels: Record<string, string> = {
  degree: "Degree",
  mapParameter: "Map parameter",
  wrap: "Map parameter",
  fold: "Map parameter",
  exclusionRadius: "Pole exclusion radius",
  ...Object.fromEntries(
    ["a", "b", "c", "d"].flatMap((k) => [
      [`coefficients.${k}.x`, `Re ${k}`],
      [`coefficients.${k}.y`, `Im ${k}`],
    ]),
  ),
  "source.count": "Circle count",
  "source.xCount": "Vertical lines",
  "source.yCount": "Horizontal lines",
  "source.radius": "Circle radius",
  "source.xMin": "Grid x start",
  "source.xMax": "Grid x end",
  "source.yMin": "Grid y start",
  "source.yMax": "Grid y end",
  samples: "Samples per member",
  tolerance: "Refinement tolerance",
  selected: "Selected member",
  parameter: "Source parameter",
};
// Phones, upright or sideways, open with source settings folded so the
// artwork follows the family picker closely.
const phoneLayout =
  "(max-width: 700px), (orientation: landscape) and (max-height: 500px)";
// Gaps by reason, in the engine's terms: undefined (invalid), still beyond
// tolerance at the depth limit (unresolved), a derived path's stationary
// base point or run through infinity (singular), or out of budget
// (exhausted).
function gapSummary(result: LoomResult) {
  const count = {
    invalid: 0,
    excluded: 0,
    clipped: 0,
    unresolved: 0,
    singular: 0,
    exhausted: 0,
  };
  for (const m of result.members)
    for (const g of m.intervals)
      if (g.reason in count) count[g.reason as keyof typeof count]++;
  const parts = [
    count.excluded && `${countText(count.excluded)} excluded`,
    count.clipped && `${countText(count.clipped)} clipped`,
    count.invalid && `${countText(count.invalid)} undefined`,
    count.singular && `${countText(count.singular)} singular`,
    count.unresolved && `${countText(count.unresolved)} unresolved`,
    count.exhausted && `${countText(count.exhausted)} out of budget`,
  ].filter(Boolean);
  return `${result.exhausted ? "Refinement ran out of budget. " : ""}${parts.length ? `Gaps: ${parts.join(", ")}.` : "No gaps."}`;
}
// Coefficients and the degree count only for the map that reads them, as
// loomRequest sends them: a retained degree under eᶻ must not make the frames
// playback shows look stale.
const usedCoefficients = (s: LoomRequest) =>
  "coefficients" in maps[s.map] ? s.coefficients : undefined;
const geometryKey = (s: LoomRequest) =>
  JSON.stringify([
    s.map,
    maps[s.map].degree ? s.degree : undefined,
    s.mapParameter,
    // A family's own s, absent at 1; other maps never send it.
    maps[s.map].parameterKey !== "mapParameter" ? mapParameterOf(s) : undefined,
    s.exclusionRadius,
    s.source,
    s.samples,
    s.tolerance,
    usedCoefficients(s),
  ]);
export function LoomPreview({
  entry,
  onReturn,
  journey,
}: {
  entry: LoomEntry;
  journey?: OverlayGuide;
  onReturn: (via: "keyboard" | "pointer") => void;
}) {
  const theme = useTheme(),
    dialog = useRef<HTMLDialogElement>(null),
    back = useRef<HTMLButtonElement>(null),
    quiet = useQuietFocus(dialog);
  const [study, setStudy] = useState<LoomStudy>(() =>
    structuredClone(entry.study.loom ?? defaultLoom(entry.study.config)),
  );
  const [sourceSettings, setSourceSettings] = useState(
    () => !matchMedia(phoneLayout).matches,
  );
  const [weight, setWeight] = useState(entry.study.weight);
  const prepared =
    journey?.prepared?.kind === "loom" ? journey.prepared : undefined;
  const [result, setResult] = useState<LoomResult | undefined>(
    () => prepared?.result,
  );
  const [resultKey, setResultKey] = useState(() =>
    prepared ? geometryKey(study) : "",
  );
  const [placed, setPlaced] = useState<
    { key: string; marker: LoomMarker } | undefined
  >(
    () =>
      prepared && {
        key: JSON.stringify([
          geometryKey(study),
          study.selected,
          study.parameter,
        ]),
        marker: prepared.marker,
      },
  );
  const [error, setError] = useState<{
    message: string;
    field?: string;
    request?: string;
  }>({
    message: "",
  });
  const [scalars, setScalars] = useState<Record<string, ScalarState>>({});
  // A degenerate coefficient matrix names no single component; its error
  // shows under the coefficient changed last.
  const lastCoefficient = useRef<string | undefined>(undefined);
  const scalarClient = useRef<EngineClient | null>(null),
    generation = useRef(0),
    jobs = useRef(new Set<Promise<void>>());
  const session = useRef<LoomSession | null>(null);
  const [sessionVersion, setSessionVersion] = useState(0);
  const [playbackActive, setPlaybackActive] = useState(false);
  const [scrubProgress, setScrubProgress] = useState<number | null>(null);
  const scrubRevision = useRef(0);
  const scrubOwner = useRef<{ context: string } | null>(null);
  const currentStudy = useRef(study);
  currentStudy.current = study;
  // Only the scrubbed coordinate may change without invalidating delivered
  // frames. Cameras and display settings do not affect numerical ownership.
  const scrubContext = (s: LoomStudy) =>
    JSON.stringify([
      s.map,
      loomRequest(s).degree,
      s.exclusionRadius,
      s.source,
      s.samples,
      s.tolerance,
      s.selected,
      s.motion,
      s.motion ? s.parameter : mapParameterOf(s),
      usedCoefficients(s),
    ]);
  const [playing, setPlaying] = useState(false),
    [exporting, setExporting] = useState(false),
    [exportProgress, setExportProgress] = useState(0);
  const stop = useRef<() => void>(() => {}),
    exportGeneration = useRef(0);
  const exportState = useMotionExport("columns");
  const exportSection = useDisclosure("loom-export");
  const panes = useRef<HTMLDivElement>(null),
    playback = useRef<HTMLDivElement>(null);
  const exportAbort = useRef<AbortController | null>(null);
  const playerActive = playbackActive || exporting;
  const measurePlayback = () => {
    const bar = playback.current,
      box = dialog.current;
    if (bar && box)
      box.style.setProperty("--loom-playback-height", `${bar.offsetHeight}px`);
  };
  const key = geometryKey(study);
  const [applied, setApplied] = useState<LoomRequest>(loomRequest(study));
  const mapInfo = maps[study.map],
    text = mapText(study);
  // An example's derived path brings its own curve, not the base study's.
  const ownCurve = sameCurve(study.source.curve, entry.study.config.curve);
  const markerKey = JSON.stringify([key, study.selected, study.parameter]);
  const activeError =
    error.request && error.request !== markerKey
      ? { message: "", field: undefined }
      : error;
  const sourceError =
    study.source.kind === "curve" && !supportedSource(study.source)
      ? "This source is unsupported. Choose a parametric, Cartesian, polar, roulette, Lissajous or Fourier curve."
      : "";
  const durationError =
    !Number.isFinite(study.duration) ||
    study.duration < 0.1 ||
    study.duration > 3600
      ? "Traversal duration must be 0.1–3,600 seconds."
      : "";
  const badMotionField =
    study.motion &&
    (["from", "to"] as const).find((k) => {
      const v = study.motion![k];
      return (
        !mapInfo.parameterized ||
        !Number.isFinite(v) ||
        v < mapInfo.range[0] ||
        v > mapInfo.range[1]
      );
    });
  const motionLabel = badMotionField ? `Map motion ${badMotionField}` : "";
  const motionError = badMotionField
    ? `${motionLabel} must be ${mapInfo.range[0]}–${mapInfo.range[1]}.`
    : "";
  const ready =
    !sourceError &&
    !durationError &&
    !motionError &&
    resultKey === key &&
    placed?.key === markerKey &&
    !!result &&
    !activeError.message &&
    !Object.values(scalars).some((s) => s.pending || s.error);
  // Point intent may be newer than the displayed marker. Keep its controls
  // usable; captures explicitly resolve that intent before drawing it.
  const interval = memberInterval(study.source, study.selected);
  // A scrubbed map parameter whose frame is still on its way holds no action
  // back, so no button blinks while the thumb moves. Playback and movies
  // compute every frame, a link saves the study rather than the drawing, and
  // a still computes the scrubbed frame before drawing it.
  const scrubbedMap =
    !!study.motion &&
    !!resultKey &&
    resultKey ===
      geometryKey(withMapParameter(study, mapParameterOf(applied)!));
  const actionable =
    !!result &&
    !sourceError &&
    !durationError &&
    !motionError &&
    !activeError.message &&
    !Object.values(scalars).some((s) => s.pending || s.error) &&
    Number.isFinite(study.parameter) &&
    study.parameter >= interval[0] &&
    study.parameter <= interval[1];
  const canAct = actionable && (resultKey === key || scrubbedMap);
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
  const fail = (e: Error, request?: string) => {
    setError({
      message: e.message,
      request,
      field: e instanceof EngineError ? e.field : undefined,
    });
    setPlaying(false);
  };
  useEffect(() => {
    session.current = new LoomSession(() => new EngineClient());
    scalarClient.current = new EngineClient();
    return () => {
      stop.current();
      exportGeneration.current++;
      exportAbort.current?.abort();
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
    document.documentElement.classList.add("loom-open");
    return () => document.documentElement.classList.remove("loom-open");
  }, []);
  // Safari can leave the visual viewport shorter than the layout viewport
  // containing the modal's fixed player. Follow its visible bottom without
  // moving the reader's scroll position. Pinch zoom keeps native behavior.
  useLayoutEffect(() => {
    const viewport = window.visualViewport,
      box = dialog.current!;
    const phone = matchMedia("(max-width: 700px)");
    const fit = () => {
      if (phone.matches && viewport && Math.abs(viewport.scale - 1) < 0.01) {
        const top = Math.max(0, viewport.offsetTop);
        box.style.top = `${top}px`;
        box.style.height = box.style.maxHeight = `${viewport.height}px`;
        box.style.setProperty("--loom-view-height", `${viewport.height}px`);
        box.style.setProperty(
          "--loom-dock-bottom",
          `${Math.max(0, window.innerHeight - top - viewport.height)}px`,
        );
      } else {
        box.style.top = box.style.height = box.style.maxHeight = "";
        box.style.removeProperty("--loom-view-height");
        box.style.removeProperty("--loom-dock-bottom");
      }
    };
    fit();
    window.addEventListener("resize", fit);
    viewport?.addEventListener("resize", fit);
    viewport?.addEventListener("scroll", fit);
    phone.addEventListener("change", fit);
    return () => {
      window.removeEventListener("resize", fit);
      viewport?.removeEventListener("resize", fit);
      viewport?.removeEventListener("scroll", fit);
      phone.removeEventListener("change", fit);
    };
  }, []);
  useLayoutEffect(() => {
    const bar = playback.current;
    if (!bar) return;
    const observer = new ResizeObserver(measurePlayback);
    observer.observe(bar);
    measurePlayback();
    return () => observer.disconnect();
  }, [!!result]);
  useLayoutEffect(() => {
    if (!playbackActive) return;
    measurePlayback();
    revealDrawing(panes.current, playback.current);
  }, [playbackActive]);
  // One intent owns both paths. Separate effects can let a point request
  // supersede the geometry needed to satisfy that same edited study.
  useEffect(() => {
    const owner = scrubOwner.current;
    const continuous = !!owner && owner.context === scrubContext(study);
    if (resultKey === key && placed?.key === markerKey && !continuous) {
      if (error.message) setError({ message: "" });
      return;
    }
    stop.current();
    setPlaying(false);
    let canceled = false;
    const request = loomRequest(study);
    const pointOnly =
      !!result && resultKey === key && !(continuous && study.motion);
    const valid = () =>
      continuous
        ? scrubOwner.current === owner &&
          owner.context === scrubContext(currentStudy.current)
        : !canceled;
    const submit = () => {
      const active = session.current!;
      (continuous ? active.scrub.bind(active) : active.update.bind(active))(
        request,
        pointOnly,
        (r: LoomResult | { marker: LoomMarker }) => {
          if (!valid()) return;
          if ("members" in r) {
            if (r.numericEntries > 2000000) {
              fail(
                new Error("The loom exceeded its retained geometry budget."),
                markerKey,
              );
              return;
            }
            setStudy((s) =>
              s.framing
                ? s
                : {
                    ...s,
                    framing: {
                      source: loomFit(r, "source"),
                      image: loomFit(r, "image"),
                    },
                  },
            );
            setApplied(request);
            setResult(r);
            setResultKey(key);
          }
          setError({ message: "" });
          setPlaced({ key: markerKey, marker: r.marker });
        },
        (e) => {
          if (valid()) fail(e, markerKey);
        },
      );
    };
    const timer = continuous
      ? undefined
      : setTimeout(submit, pointOnly || !result ? 0 : 120);
    if (continuous) submit();
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [markerKey, sessionVersion]);
  const resetSession = () => {
    scrubOwner.current = null;
    session.current?.cancel();
    session.current = new LoomSession(() => new EngineClient());
    setSessionVersion((v) => v + 1);
  };
  const pause = () => {
    scrubOwner.current = null;
    stop.current();
    if (playing) {
      resetSession();
      if (placed)
        setStudy((s) => ({ ...s, parameter: placed.marker.parameter }));
    }
    setPlaying(false);
  };
  const setSource = (change: (s: LoomSource) => LoomSource) => {
    pause();
    setStudy((s) => {
      const source = change(s.source);
      const selected = 0;
      return {
        ...s,
        // A new family or path starts fresh reference fits.
        framing:
          source.kind === s.source.kind && source.input === s.source.input
            ? s.framing
            : undefined,
        source,
        selected,
        parameter: memberInterval(source, selected)[0],
      };
    });
  };
  const select = (id: number) => {
    pause();
    setStudy((s) => {
      const [lo, hi] = memberInterval(s.source, id);
      return {
        ...s,
        selected: id,
        parameter: Math.max(lo, Math.min(hi, s.parameter)),
      };
    });
  };
  const changeParameter = (parameter: number, scrub = false) => {
    const owner = scrubOwner.current;
    pause();
    if (scrub)
      scrubOwner.current =
        owner?.context === scrubContext(study)
          ? owner
          : { context: scrubContext(study) };
    setStudy((s) => ({ ...s, parameter }));
  };
  const marker = placed?.marker;
  const progress = (() => {
    if (study.motion) {
      const { from, to } = study.motion;
      return from === to
        ? 0
        : Math.max(
            0,
            Math.min(1, ((mapParameterOf(study) ?? from) - from) / (to - from)),
          );
    }
    const [lo, hi] = memberInterval(study.source, study.selected);
    return (study.parameter - lo) / (hi - lo);
  })();
  const seekMotion = async (p: number, scrub = false) => {
    // Echo the thumb before awaiting scalar endpoints. Otherwise WebKit can
    // restore the old controlled value and send it again on change/release.
    const revision = ++scrubRevision.current;
    setScrubProgress(p);
    const owner = scrubOwner.current;
    pause();
    const current = generation.current;
    await Promise.all([...jobs.current]);
    if (revision !== scrubRevision.current) return;
    if (current === generation.current) {
      if (scrub) {
        const context = scrubContext(currentStudy.current);
        scrubOwner.current = owner?.context === context ? owner : { context };
      }
      setStudy((s) => withMapParameter(s, mapParameterOf(loomFrame(s, p))!));
    }
    setScrubProgress(null);
  };
  const start = () => {
    if (!canAct) return;
    scrubOwner.current = null;
    const frozen = structuredClone(study);
    if (playbackActive) revealDrawing(panes.current, playback.current);
    setPlaybackActive(true);
    setPlaying(true);
    stop.current = play<LoomResult | { marker: LoomMarker }>({
      from: progress >= 1 ? 0 : progress,
      duration: frozen.duration * 1000,
      lanes: [
        (p) =>
          frozen.motion
            ? session.current!.frame(loomFrame(frozen, p))
            : session
                .current!.point(loomFrame(frozen, p))
                .then((marker) => ({ marker })),
      ],
      show: (frame, p) => {
        const request = loomFrame(frozen, p),
          nextKey = geometryKey(request);
        if ("members" in frame) {
          if (frame.numericEntries > 2000000) {
            pause();
            fail(new Error("The loom exceeded its retained geometry budget."));
            return;
          }
          setResult(frame);
          setResultKey(nextKey);
          setApplied(request);
        }
        setStudy((s) => {
          const next = { ...s, parameter: request.parameter };
          return frozen.motion
            ? withMapParameter(next, mapParameterOf(request)!)
            : next;
        });
        setPlaced({
          key: JSON.stringify([nextKey, frozen.selected, request.parameter]),
          marker: frame.marker,
        });
      },
      end: () => setPlaying(false),
      fail: (e) => fail(e as Error),
    });
  };
  const props = (
    pane: Pane,
    shown = { result: result!, request: applied },
  ): DrawingProps => ({
    result: shown.result,
    marker: marker!,
    pane,
    selected: marker!.member,
    camera: study.views[pane],
    framing: study.framing?.[pane],
    dark: theme.dark,
    scheme: theme.scheme,
    weight,
    imageLabel: text.imageLabel,
    exclusion: poleExclusion(
      shown.request,
      study.showExclusion ?? true,
      shown.result,
    ),
    ...(shown.request.source.kind === "curve" && {
      path: {
        construction: loomPaths[shown.request.source.input].construction,
        pole: shown.request.source.pole ?? { x: 0, y: 0 },
      },
    }),
    onCamera: (c) =>
      setStudy((s) => ({ ...s, views: { ...s.views, [pane]: c } })),
    onSelect: select,
  });
  const metadata = () => ({
    kind: "complex-loom",
    map: study.map,
    ...(mapInfo.degree && { degree: study.degree }),
    formula: text.formula,
    mapParameter: study.mapParameter,
    ...(mapInfo.parameterKey !== "mapParameter" && {
      [mapInfo.parameterKey]: mapParameterOf(study),
    }),
    ...("coefficients" in mapInfo && { coefficients: study.coefficients }),
    exclusionRadius: study.exclusionRadius,
    showExclusion: study.showExclusion,
    exclusion: mapInfo.exportDomain,
    motion: study.motion,
    pace: study.motion ? "uniform map parameter" : "uniform source parameter",
    layout: "source left; image right",
    source: study.source,
    samples: study.samples,
    tolerance: study.tolerance,
    selected: study.selected,
    parameter: study.parameter,
    views: study.views,
    framing: study.framing,
    duration: study.duration,
    theme: theme.dark ? "dark" : "light",
    scheme: theme.scheme,
    weight,
  });
  async function still(kind: string, settings: Still) {
    if (!canAct) return;
    pause();
    const id = ++exportGeneration.current;
    try {
      // A scrubbed map frame may still be on its way: compute it, and show
      // it too, since this request supersedes the scrub's.
      const request = loomRequest(study);
      const frame =
        resultKey === key ? undefined : await session.current!.frame(request);
      if (id !== exportGeneration.current) return;
      if (frame && frame.numericEntries > 2000000)
        throw new Error("The loom exceeded its retained geometry budget.");
      if (frame) {
        setApplied(request);
        setResult(frame);
        setResultKey(key);
      }
      const marker =
        frame?.marker ??
        (placed?.key === markerKey
          ? placed.marker
          : await session.current!.point(request));
      if (id !== exportGeneration.current) return;
      setPlaced({ key: markerKey, marker });
      const shown = frame && { result: frame, request };
      await loomStill(
        kind as "svg" | "png",
        { ...props("source", shown), marker, selected: study.selected },
        { ...props("image", shown), marker, selected: study.selected },
        metadata(),
        () => id === exportGeneration.current,
        settings,
      );
    } catch (e) {
      if (id === exportGeneration.current) fail(e as Error);
    }
  }
  function cancelExport() {
    exportGeneration.current++;
    exportAbort.current?.abort();
    resetSession();
    setExporting(false);
  }
  async function movie() {
    if (!canAct) return;
    const pending = resultKey !== key || placed?.key !== markerKey;
    pause();
    setExporting(true);
    setExportProgress(0);
    const id = ++exportGeneration.current;
    const controller = new AbortController();
    exportAbort.current = controller;
    try {
      await loomMovie({
        study: structuredClone(study),
        source: { ...props("source"), selected: study.selected },
        image: { ...props("image"), selected: study.selected },
        metadata: metadata(),
        options: {
          format: exportState.chosen,
          fps: exportState.fps,
          settings: {
            scale: exportState.scale,
            quality: exportState.quality,
            layout: "columns",
          },
          loop: exportState.loop,
        },
        signal: controller.signal,
        current: () => id === exportGeneration.current,
        marker: (q) => session.current!.point(q),
        frame: (q) => session.current!.frame(q),
        progress: setExportProgress,
      });
    } catch (e) {
      if (id === exportGeneration.current) fail(e as Error);
    } finally {
      if (id === exportGeneration.current) {
        setExporting(false);
        // The movie's requests superseded a scrubbed frame or point that
        // was on its way; ask for it again.
        if (pending) setSessionVersion((v) => v + 1);
      }
    }
  }
  useEffect(() => {
    if (exporting) cancelExport();
    else exportGeneration.current++;
  }, [
    key,
    markerKey,
    weight,
    study.views,
    study.framing,
    study.motion,
    study.showExclusion,
    theme.dark,
    theme.scheme,
  ]);
  const scalarError = Object.values(scalars).find((s) => s.error);
  const message = scalarError
    ? `${scalarError.name}: ${scalarError.error}`
    : sourceError || durationError || motionError || activeError.message;
  const title =
    scalarError?.name ??
    (sourceError
      ? "Source family"
      : durationError
        ? "Traversal duration"
        : motionError
          ? motionLabel
          : activeError.field === "coefficients"
            ? lastCoefficient.current
            : activeError.field
              ? labels[activeError.field]
              : undefined);
  const [claimed, setClaimed] = useState(false);
  const claim = useCallback((_key: string, on: boolean) => setClaimed(on), []);
  const target = useMemo(
    () => ({ label: title, message, claim, touch: () => {} }),
    [title, message, claim],
  );
  const [lo, hi] = memberInterval(study.source, study.selected);
  const scalar = (
    name: string,
    k: "radius" | "xMin" | "xMax" | "yMin" | "yMax",
    help: string,
  ) => (
    <Field label={name} help={help}>
      <ScalarInput
        name={name}
        value={study.source[k]}
        onChange={(v) => setSource((s) => ({ ...s, [k]: v }))}
      />
    </Field>
  );
  const paneHeadings = (["source", "image"] as const).map((pane) => (
    <div key={pane} className="loom-pane-heading">
      <h3>{pane === "source" ? "Source plane · z" : text.imageHeading}</h3>
      <button
        disabled={exporting || (!!journey && !result)}
        onClick={() =>
          setStudy((s) => ({
            ...s,
            framing: {
              source: s.framing?.source ?? loomFit(result!, "source"),
              image: s.framing?.image ?? loomFit(result!, "image"),
              [pane]: loomFit(result!, pane),
            },
            views: {
              ...s.views,
              [pane]: { x: 0, y: 0, zoom: 1 },
            },
          }))
        }
      >
        Fit {pane}
      </button>
    </div>
  ));
  const artwork = (
    <div ref={panes} className="loom-panes" aria-busy={!ready}>
      {(["source", "image"] as const).map((pane, index) => (
        <section key={pane}>
          {!journey && paneHeadings[index]}
          {result && marker ? (
            <PaneDrawing
              {...props(pane)}
              onCamera={exporting ? undefined : props(pane).onCamera}
              onSelect={exporting ? undefined : select}
            />
          ) : (
            <p>Preparing paired geometry…</p>
          )}
        </section>
      ))}
    </div>
  );
  const playbackControls = result && marker && (
    <div
      ref={playback}
      id="loom-playback"
      className={`playback ${playerActive ? "active" : ""}`}
      role="group"
      aria-label="Playback"
    >
      <div className="animation-buttons">
        <button
          disabled={(!canAct && !playing) || exporting}
          onClick={() => (playing ? pause() : start())}
        >
          {playing
            ? study.motion
              ? "Pause map motion"
              : "Pause traversal"
            : playbackActive && progress < 1
              ? study.motion
                ? "Resume map motion"
                : "Resume traversal"
              : study.motion
                ? "Play map motion"
                : "Play traversal"}
        </button>
        <button
          onClick={() => {
            if (exporting) cancelExport();
            else {
              if (study.motion) void seekMotion(0);
              else changeParameter(lo);
              setPlaybackActive(false);
            }
          }}
        >
          {exporting
            ? "Cancel export"
            : study.motion
              ? "Stop map motion"
              : "Stop traversal"}
        </button>
      </div>
      <div className="timeline">
        <fieldset disabled={exporting}>
          <Field
            label={study.motion ? "Motion progress" : "Source parameter"}
            className="loom-parameter"
            helpBeforeControl
            value={(study.motion
              ? mapParameterOf(study)!
              : study.parameter
            ).toPrecision(6)}
            help={
              study.motion
                ? "Seek the same absolute map time used by playback and export."
                : tiered(
                    "Move corresponding points at the same original source parameter.",
                    text.traversalHelp,
                  )
            }
          >
            <input
              type="range"
              min={0}
              max={1}
              step="any"
              value={scrubProgress ?? progress}
              aria-valuetext={String(
                study.motion ? mapParameterOf(study) : study.parameter,
              )}
              onChange={(e) =>
                study.motion
                  ? seekMotion(+e.target.value, true)
                  : changeParameter(
                      traversal(study, +e.target.value).parameter,
                      true,
                    )
              }
            />
          </Field>
        </fieldset>
        <div className="note" aria-live="off">
          {Number.isFinite(progress) && !durationError
            ? `${(progress * study.duration).toFixed(1)} / ${study.duration} s`
            : "—"}
          {playbackActive && !playing && progress < 1 ? " · Paused" : ""}
        </div>
        <div className="animation-values">
          t = {marker.parameter.toPrecision(6)}
          {study.motion && (
            <>
              {" "}
              · {mapInfo.symbol} ={" "}
              {(mapParameterOf(applied) ?? 0).toPrecision(6)}
            </>
          )}
        </div>
      </div>
    </div>
  );
  const experiment = scalar(
    "Circle radius",
    "radius",
    "Positive, at most 1,000,000. Concentric radii increase evenly to this value.",
  );
  if (journey)
    return (
      <dialog
        ref={dialog}
        className="journey guided-overlay"
        aria-label={journey.title}
        onCancel={(e) => {
          e.preventDefault();
          onReturn("keyboard");
        }}
        onPointerDown={quiet.onPointerDown}
        onKeyDownCapture={quiet.onKeyDownCapture}
      >
        <ScalarStatus.Provider value={scalarStatus}>
          <FieldErrorContext.Provider value={target}>
            <OverlayJourneyLayout
              guide={journey}
              study={withOverlay({ ...entry.study, weight }, "loom", study)}
              disabled={!canAct || exporting}
              busy={!ready}
              error={!claimed ? message : ""}
              backRef={back}
              onReturn={onReturn}
              control={experiment}
              drawing={artwork}
              prepared={
                ready && result && placed
                  ? { kind: "loom", result, marker: placed.marker }
                  : undefined
              }
              failure={
                activeError.message
                  ? { message: activeError.message, field: activeError.field }
                  : undefined
              }
              player={playbackControls}
            />
          </FieldErrorContext.Provider>
        </ScalarStatus.Provider>
      </dialog>
    );
  return (
    <dialog
      ref={dialog}
      className="loom"
      aria-labelledby="loom-title"
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
          study={() => ({ ...entry.study, weight, loom: study })}
          disabled={!canAct || exporting}
        />
        <AnimationButton section="loom-animation-section" />
        <ExportImageMenu
          kind={`complex-${text.kind}`}
          revision={
            markerKey +
            JSON.stringify([
              study.views,
              study.framing,
              theme.dark,
              theme.scheme,
              weight,
            ])
          }
          disabled={!canAct || exporting}
          base={{ width: 2000, height: 760 }}
          onSave={still}
        />
      </AppHeader>
      <div className="loom-content">
        <div className="loom-heading">
          <p className="eyebrow">Complex transformation · {text.formula}</p>
          <h2 id="loom-title">The complex loom</h2>
          <p>
            Choose a thread in one plane. Find its {mapInfo.imageNoun} in the
            other.
          </p>
        </div>
        <ScalarStatus.Provider value={scalarStatus}>
          <FieldErrorContext.Provider value={target}>
            <div className="loom-layout">
              <aside>
                <fieldset disabled={exporting}>
                  <Field label="Complex map" help={mapHelp}>
                    <select
                      value={study.map}
                      onChange={async (e) => {
                        const map = e.target.value as LoomRequest["map"];
                        pause();
                        await Promise.all([...jobs.current]);
                        setStudy((s) =>
                          replaceMap(
                            s,
                            map,
                            result ? 295 / loomFit(result, "source").scale : 1,
                          ),
                        );
                      }}
                    >
                      {Object.entries(maps).map(([id, m]) => (
                        <option key={id} value={id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {mapInfo.degree && (
                    <Field label="Degree" help={mapInfo.degree.help}>
                      <select
                        value={study.degree}
                        onChange={(e) => {
                          const degree = +e.currentTarget.value;
                          pause();
                          setStudy((s) => ({ ...s, degree }));
                        }}
                      >
                        {Array.from(
                          {
                            length:
                              mapInfo.degree.range[1] -
                              mapInfo.degree.range[0] +
                              1,
                          },
                          (_, i) => mapInfo.degree.range[0] + i,
                        ).map((n) => (
                          <option key={n} value={n}>
                            {mapText({ map: study.map, degree: n }).formula}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                  {mapInfo.parameterized && (
                    <details>
                      <summary>Map settings</summary>
                      <p className="note">{mapInfo.note}</p>
                      <Field
                        label="Map parameter"
                        help={
                          "parameterHelp" in mapInfo
                            ? mapInfo.parameterHelp
                            : `${mapInfo.range[0]}–${mapInfo.range[1]}. Zero gives the identity map.`
                        }
                      >
                        <ScalarInput
                          name="Map parameter"
                          value={mapParameterOf(study)!}
                          onChange={(v) => {
                            pause();
                            setStudy((s) => withMapParameter(s, v));
                          }}
                        />
                      </Field>
                      {"coefficients" in mapInfo &&
                        (["a", "b", "c", "d"] as const).map((k) => (
                          <div className="pair" key={k}>
                            {(["x", "y"] as const).map((part) => {
                              const name = `${part === "x" ? "Re" : "Im"} ${k}`;
                              return (
                                <Field
                                  key={part}
                                  label={name}
                                  help={
                                    part === "x"
                                      ? coefficientHelp(k)
                                      : undefined
                                  }
                                >
                                  <ScalarInput
                                    name={name}
                                    value={study.coefficients![k][part]}
                                    onChange={(v) => {
                                      pause();
                                      lastCoefficient.current = name;
                                      setStudy((s) => ({
                                        ...s,
                                        coefficients: {
                                          ...s.coefficients!,
                                          [k]: {
                                            ...s.coefficients![k],
                                            [part]: v,
                                          },
                                        } as LoomCoefficients,
                                      }));
                                    }}
                                  />
                                </Field>
                              );
                            })}
                          </div>
                        ))}
                      {mapInfo.exclusion && (
                        <>
                          <Field
                            label="Pole exclusion radius"
                            help={tiered(
                              "Omit a closed source disk: 0.000001–1,000,000 source units.",
                              "The initial radius is 2.5% of the circle radius, grid half-span or frozen curve’s fitted half-height. This deliberate domain restriction omits part of the mathematical image. Analytic circles and lines split at crossings; arbitrary expression checks are finite and cannot certify topology. Values outside the supported range are refused.",
                            )}
                          >
                            <ScalarInput
                              name="Pole exclusion radius"
                              value={study.exclusionRadius!}
                              onChange={(v) => {
                                pause();
                                setStudy((s) => ({ ...s, exclusionRadius: v }));
                              }}
                            />
                          </Field>
                          <label className="check">
                            <input
                              type="checkbox"
                              checked={study.showExclusion ?? true}
                              onChange={(e) => {
                                const checked = e.currentTarget.checked;
                                setStudy((s) => ({
                                  ...s,
                                  showExclusion: checked,
                                }));
                              }}
                            />{" "}
                            Show pole exclusion
                          </label>
                          <p className="note">
                            Dashed source disk: excluded boundary and interior.
                            Images beyond radius 100,000,000 are clipped; gaps
                            stay open.
                          </p>
                        </>
                      )}
                    </details>
                  )}
                  <Field
                    label="Source family"
                    help={tiered(
                      "Choose a grid, circles, or the curve from your base study.",
                      "Curve from your base study uses a frozen copy of the curve you were viewing when you opened the loom. Return to study to edit it, then reopen the loom to refresh the copy.",
                    )}
                  >
                    <select
                      value={study.source.kind}
                      onChange={(e) => {
                        const kind = e.currentTarget
                          .value as LoomSource["kind"];
                        generation.current++;
                        setScalars({});
                        setSource((s) => replaceSource(s, kind));
                      }}
                    >
                      {Object.entries(sourceChoices).map(([v, label]) => (
                        <option key={v} value={v}>
                          {v === "curve" && !ownCurve
                            ? "The example’s curve"
                            : label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {study.source.kind === "curve" && (
                    <>
                      <Field
                        label="Path"
                        help={tiered(
                          "Map the curve itself or one of its derived curves, at the base curve's parameter t.",
                          "Derived paths use your study's pole and offset distance, frozen when the loom opened. Each is undefined where the curve stops or has no tangent, and the evolute also where it runs to infinity at an inflection; those gaps stay open in both planes.",
                        )}
                      >
                        <select
                          value={study.source.input}
                          onChange={(e) => {
                            const input = e.currentTarget
                              .value as LoomSource["input"];
                            const { pole, distance } = entry.study.config;
                            setSource((s) => ({
                              ...s,
                              input,
                              // An older link froze neither setting; the
                              // base study beneath it supplies them.
                              pole: s.pole ?? { ...pole },
                              distance: s.distance ?? distance,
                            }));
                          }}
                        >
                          {Object.entries(loomPaths).map(([v, path]) => (
                            <option key={v} value={v}>
                              {path.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <p className="note" data-path-note>
                        {pathNote(study.source, ownCurve)}
                        {ownCurve &&
                          " Return to study, edit the curve, then reopen the loom to update the copy."}
                      </p>
                    </>
                  )}
                  <details
                    className="loom-source-settings"
                    open={sourceSettings}
                    onToggle={(e) => setSourceSettings(e.currentTarget.open)}
                  >
                    <summary>Source settings</summary>
                    {study.source.kind === "grid" ? (
                      <>
                        <div className="pair">
                          <Field
                            label="Vertical lines"
                            help="1–32 lines; a single line sits centrally."
                          >
                            <input
                              type="number"
                              min={1}
                              max={32}
                              value={
                                Number.isNaN(study.source.xCount)
                                  ? ""
                                  : study.source.xCount
                              }
                              onChange={(e) => {
                                const value = e.currentTarget.valueAsNumber;
                                setSource((s) => ({ ...s, xCount: value }));
                              }}
                            />
                          </Field>
                          <Field
                            label="Horizontal lines"
                            help="1–32 lines; a single line sits centrally."
                          >
                            <input
                              type="number"
                              min={1}
                              max={32}
                              value={
                                Number.isNaN(study.source.yCount)
                                  ? ""
                                  : study.source.yCount
                              }
                              onChange={(e) => {
                                const value = e.currentTarget.valueAsNumber;
                                setSource((s) => ({ ...s, yCount: value }));
                              }}
                            />
                          </Field>
                        </div>
                        <div className="pair">
                          {scalar(
                            "Grid x start",
                            "xMin",
                            "Horizontal start; within ±1,000,000.",
                          )}
                          {scalar(
                            "Grid x end",
                            "xMax",
                            "Horizontal end; span 0.000001–100,000.",
                          )}
                        </div>
                        <div className="pair">
                          {scalar(
                            "Grid y start",
                            "yMin",
                            "Vertical start; within ±1,000,000.",
                          )}
                          {scalar(
                            "Grid y end",
                            "yMax",
                            "Vertical end; span 0.000001–100,000.",
                          )}
                        </div>
                      </>
                    ) : study.source.kind !== "curve" ? (
                      <>
                        <Field
                          label="Circle count"
                          help="1–32 circles, retained separately even when their images coincide."
                        >
                          <input
                            type="number"
                            min={1}
                            max={32}
                            value={
                              Number.isNaN(study.source.count)
                                ? ""
                                : study.source.count
                            }
                            onChange={(e) => {
                              const value = e.currentTarget.valueAsNumber;
                              setSource((s) => ({ ...s, count: value }));
                            }}
                          />
                        </Field>
                        {experiment}
                      </>
                    ) : null}
                    <details>
                      <summary>Sampling and limits</summary>
                      <Field
                        label="Samples per member"
                        help="4–1,024 initial samples per member."
                      >
                        <input
                          type="number"
                          min={4}
                          max={1024}
                          value={
                            Number.isNaN(study.samples) ? "" : study.samples
                          }
                          onChange={(e) => {
                            const value = e.currentTarget.valueAsNumber;
                            pause();
                            setStudy((s) => ({ ...s, samples: value }));
                          }}
                        />
                      </Field>
                      <Field
                        label="Refinement tolerance"
                        help={tiered(
                          "Relative chord error in both panes: 0.000001–0.05.",
                          "Each source interval is tested in the mapped image and source. Refinement stops at depth 16, 500,000 delivered points across both panes or 1,000,000 evaluations, 22 for each point of a derived path. Unresolved and invalid intervals remain gaps; finite sampling cannot certify topology.",
                        )}
                      >
                        <ScalarInput
                          name="Refinement tolerance"
                          value={study.tolerance}
                          onChange={(v) => {
                            pause();
                            setStudy((s) => ({ ...s, tolerance: v }));
                          }}
                        />
                      </Field>
                    </details>
                    <LineWeightField
                      value={weight}
                      onChange={setWeight}
                      help={withMore(
                        svgWeightHelp,
                        "In small paired panes, a hairline can look heavier than Fine.",
                      )}
                    />
                    <p className="note">
                      Mapped families do not support downstream constructions.
                    </p>
                  </details>
                </fieldset>
              </aside>
              <main>
                {artwork}
                <div className="loom-controls">
                  {result && marker && (
                    <>
                      <p className="note">
                        {describeColors("Teal", theme.scheme)} threads retain
                        their source identities; the selected member is
                        highlighted. Drag each pane to pan; scroll to zoom.
                        Keyboard: arrows, +/−, Home.
                      </p>
                      <fieldset disabled={exporting} className="loom-traversal">
                        <Field label="Selected member">
                          <select
                            value={study.selected}
                            onChange={(e) => select(+e.target.value)}
                          >
                            {result.members.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                      </fieldset>
                      {playbackControls}
                      <fieldset disabled={exporting}>
                        <Field
                          label="Exact source parameter"
                          help="Enter a source parameter, including constants such as pi."
                        >
                          <ScalarInput
                            name="Exact source parameter"
                            value={study.parameter}
                            onChange={changeParameter}
                          />
                        </Field>
                        <div
                          className="loom-correspondence"
                          data-parameter={marker.parameter}
                        >
                          {marker.source && marker.image ? (
                            <p>
                              {marker.base &&
                                `Base point (${marker.base.x.toPrecision(5)}, ${marker.base.y.toPrecision(5)}); `}
                              z = ({marker.source.x.toPrecision(5)},{" "}
                              {marker.source.y.toPrecision(5)}) →{" "}
                              {marker.intermediate &&
                                text.intermediate &&
                                `${text.intermediate} = (${marker.intermediate.x.toPrecision(5)}, ${marker.intermediate.y.toPrecision(5)}) → `}
                              w = ({marker.image.x.toPrecision(5)},{" "}
                              {marker.image.y.toPrecision(5)}).{" "}
                              {marker.critical
                                ? "Critical point: derivative zero; no regular conformality."
                                : "Regular map point."}
                              {!!marker.translates?.length &&
                                ` ${marker.translates.length} other source ${marker.translates.length === 1 ? "point" : "points"} ${text.shared} share this image (hollow markers).`}
                            </p>
                          ) : (
                            <p>
                              Correspondence undefined, excluded or clipped
                              here; the image marker is omitted.
                            </p>
                          )}
                        </div>
                      </fieldset>
                      <section className="animation-section">
                        <details id="loom-animation-section" open>
                          <summary className="section-label">ANIMATION</summary>
                          <fieldset disabled={exporting}>
                            {mapInfo.parameterized && (
                              <>
                                <Field
                                  label="Motion"
                                  help="Animate the point or the map parameter separately."
                                >
                                  <select
                                    value={study.motion ? "map" : "point"}
                                    onChange={(e) => {
                                      const mode = e.currentTarget.value;
                                      pause();
                                      setStudy((s) => {
                                        const { motion: _motion, ...rest } = s;
                                        const info = maps[s.map];
                                        return mode === "map"
                                          ? {
                                              ...s,
                                              motion: {
                                                mode: "map",
                                                from:
                                                  "motionFrom" in info
                                                    ? info.motionFrom
                                                    : (mapParameterOf(s) ??
                                                      info.initial),
                                                to: info.range[1],
                                              },
                                            }
                                          : rest;
                                      });
                                    }}
                                  >
                                    <option value="point">
                                      Point traversal
                                    </option>
                                    <option value="map">Map parameter</option>
                                  </select>
                                </Field>
                                {study.motion && (
                                  <>
                                    <div className="pair">
                                      {(["from", "to"] as const).map((k) => (
                                        <Field
                                          key={k}
                                          label={`Map motion ${k}`}
                                          help={`${mapInfo.range[0]}–${mapInfo.range[1]}; ${k} parameter.`}
                                        >
                                          <ScalarInput
                                            name={`Map motion ${k}`}
                                            value={study.motion![k]}
                                            onChange={(v) => {
                                              pause();
                                              setStudy((s) => ({
                                                ...s,
                                                motion: {
                                                  ...s.motion!,
                                                  [k]: v,
                                                },
                                              }));
                                            }}
                                          />
                                        </Field>
                                      ))}
                                    </div>
                                  </>
                                )}
                              </>
                            )}
                            <Field
                              label="Traversal duration"
                              help={
                                study.motion
                                  ? "0.1–3,600 seconds at uniform map-parameter pace."
                                  : "0.1–3,600 seconds at uniform source-parameter pace."
                              }
                            >
                              <input
                                type="number"
                                min={0.1}
                                max={3600}
                                step="any"
                                value={
                                  Number.isNaN(study.duration)
                                    ? ""
                                    : study.duration
                                }
                                onChange={(e) => {
                                  const value = e.currentTarget.valueAsNumber;
                                  pause();
                                  setStudy((s) => ({
                                    ...s,
                                    duration: value,
                                  }));
                                }}
                              />
                            </Field>
                            <MotionExportSettings
                              state={exportState}
                              id="loom-export-settings"
                              disclosure={exportSection}
                            />
                          </fieldset>
                          <button
                            className="animation-export"
                            disabled={
                              !canAct ||
                              playing ||
                              exporting ||
                              exportState.formats?.[exportState.chosen] !==
                                "yes" ||
                              Math.ceil(study.duration * exportState.fps) > 7200
                            }
                            onClick={() => void movie()}
                          >
                            Export {exportState.text.name} ↗
                          </button>
                          {exporting && (
                            <p role="status" aria-live="off">
                              Exporting {exportState.text.short}…{" "}
                              {Math.round(exportProgress * 100)}%
                            </p>
                          )}
                        </details>
                      </section>
                      <p className="note" data-gaps>
                        {gapSummary(result)} {countText(result.points)} paired
                        points.
                      </p>
                    </>
                  )}
                  {!result && !message && (
                    <p className="note" role="status">
                      Computing correspondence…
                    </p>
                  )}
                  {message && !claimed && (
                    <p className="study-error" role="alert">
                      {message}
                    </p>
                  )}
                </div>
              </main>
            </div>
          </FieldErrorContext.Provider>
        </ScalarStatus.Provider>
      </div>
    </dialog>
  );
}
