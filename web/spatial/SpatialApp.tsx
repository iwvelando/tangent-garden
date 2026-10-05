import { StudyExplanation } from "../StudyExplanation";
import { RefineBetweenSamples } from "../RefineBetweenSamples";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { EngineClient, EngineError } from "../engine-client";
import { ScalarInput, ScalarStatus, type ScalarState } from "../ScalarInput";
import { useMediaQuery } from "../useMediaQuery";
import { useTheme } from "../useTheme";
import { useDisclosure } from "../useDisclosure";
import {
  Field,
  FieldErrorContext,
  StudyError,
  HelpText,
  HelpToggle,
  useHelp,
  type FieldErrorTarget,
} from "../Field";
import { fieldLabel } from "./fields";
import { AppHeader } from "../AppHeader";
import { AnimationButton } from "../AnimationButton";
import { NotebookMode } from "../NotebookMode";
import { revealDrawing } from "../revealDrawing";
import { ExportImageMenu } from "../ExportImageMenu";
import { saveFile } from "../export-image";
import { SpatialPlot } from "./SpatialPlot";
import { SpatialAnimationPanel } from "./SpatialAnimationPanel";
import { CutPanel } from "./CutPanel";
import { cutSpec, defaultCut, type Cut } from "./cut";
import { SightPanel } from "./SightPanel";
import { defaultSight, isPlain, sightSpec, type Sight } from "./sight";
import { spatialPresets } from "./presets";
import { ExampleGallery } from "../ExampleGallery";
import { spatialExamples, spatialThumbnail } from "../examples";
import {
  animationCamera,
  seedLabel,
  spatialPursuerLabels,
  type AnimationView,
} from "./animation";
import {
  maxFrameStrands,
  maxHarmonicTerms,
  composes,
  curveDomain,
  projectsInput,
  takesInput,
  usesSpatialPole,
  type FrameConfig,
  type RuledConfig,
  type CanalConfig,
  type FieldConfig,
  type SpatialPursuitConfig,
  type SurfaceConfig,
  type SurfaceKind,
  type RaysConfig,
  type ReceiverConfig,
  minReceiverBins,
  maxReceiverBins,
  maxSurfaceCells,
  maxSurfaceCurves,
  maxMeridians,
  maxSpatialSeeds,
  maxSpatialPursuers,
  type HarmonicCurve,
  type SpatialConfig,
  type Frame,
  type ImplicitConfig,
  minImplicitCells,
  maxImplicitCells,
  maxImplicitGrid,
  maxImplicitRefine,
  maxRefinedTetrahedra,
  maxSections,
} from "./types";
import { implicitGrid, implicitNote } from "./implicit";
import {
  harmonicClosureKey,
  harmonicClosureNote,
  harmonicLabels,
  nextHarmonicTerm,
} from "./harmonic";
import { periodText } from "../harmonic";
import { frameNote } from "./frame";
import { ruledNote } from "./ruled";
import { canalNote } from "./canal";
import { fieldNote, nextSpatialSeed } from "./field";
import { nextSpatialPursuer, pursuitNote } from "./pursuit";
import {
  surfaceCharts,
  surfaceDefaults,
  surfaceNames,
  surfaceNote,
  surfaceShape,
} from "./surface";
import { raysNote, receiverAxes } from "./rays";
import { defaultLayers, initialView, type Layers, type View } from "./renderer";
import { projections, viewBasis, type Projection } from "./scene";
import {
  LiveOrientation,
  feedOrientation,
  type OrientationFeed,
} from "../Orientation";
import type { NamedView } from "../named-views";
import { LinkNotice, ShareLink } from "../ShareLink";
import { LinkError, type SharedStudy } from "../study-link";
import {
  defaultAnimation,
  spatialStudy,
  type SpatialAnimation,
  type SpatialCamera,
  type SpatialStudy,
} from "./link";
import type { ImageFormat } from "./export";
import {
  defaultProbe,
  probeDrawing as drawProbe,
  probeIndex,
  probeRecord,
  probeSteps,
  probeSupport,
  probeTarget,
  gridded,
  probeOptions,
  surfaceProbeAt,
  type Probe,
} from "./probe";
import { ProbePanel } from "./ProbePanel";
import "./spatial.css";

// Saved image files, by format.
const imageNames: Record<ImageFormat, string> = {
  png: ".png",
  svg: ".svg",
  "svg-lines": "-lines.svg",
  "svg-visible": "-visible-lines.svg",
};

// How a study is sampled is for the curious: a heading and an info toggle
// keep the detail out of the way until it is asked for.
function SamplingNote({ children }: { children: ReactNode }) {
  const help = useHelp();
  return (
    <div className="sampling-note">
      <div className="field-label">
        <span>How it&rsquo;s sampled</span>
        <HelpToggle topic="how it’s sampled" help={help} />
      </div>
      <HelpText help={help}>{children}</HelpText>
    </div>
  );
}
export default function SpatialApp({
  active = true,
  shared,
}: {
  active?: boolean;
  shared?: SharedStudy;
}) {
  const theme = useTheme(),
    narrow = useMediaQuery("(max-width: 700px)"),
    expressions = useDisclosure("expressions");
  const client = useRef<EngineClient | null>(null),
    generation = useRef(0),
    jobs = useRef(new Set<Promise<void>>());
  const [config, setConfig] = useState<SpatialConfig>(spatialPresets[0].config);
  const [customOpened, setCustomOpened] = useState(false);
  const [preset, setPreset] = useState("0"),
    [states, setStates] = useState<Record<string, ScalarState>>({});
  const [frame, setFrame] = useState<Frame | null>(null),
    [settled, setSettled] = useState("");
  // The engine's error, and the configuration path of the field it names.
  const [error, setError] = useState<{ message: string; field?: string }>({
      message: "",
    }),
    [renderError, setRenderError] = useState(""),
    [imageBusy, setImageBusy] = useState(false);
  // The field showing the failure under its control, if any, and the label
  // of the control last changed.
  const [claimed, setClaimed] = useState<string | null>(null);
  const claim = useCallback(
    (key: string, on: boolean) =>
      setClaimed((c) => (on ? key : c === key ? null : c)),
    [],
  );
  const touched = useRef<string | null>(null);
  const touch = useCallback((label: string) => {
    touched.current = label;
  }, []);
  const [reset, setReset] = useState(0),
    [refit, setRefit] = useState(0),
    [spinning, setSpinning] = useState(false);
  const [animation, setAnimation] = useState<AnimationView | null>(null),
    [running, setRunning] = useState(false);
  const [layers, setLayers] = useState<Layers>(defaultLayers);
  // The parameter probe asks Go for diagnostics only while it is on, and
  // only for what it describes: the curve or the surface.
  const [probe, setProbe] = useState<Probe>(defaultProbe);
  const probing = probe.enabled && probeSupport(config).available,
    target = probeTarget(config, probe);
  // The cutaway plane: a drawing setting, never sent to Go.
  const [cut, setCut] = useState<Cut>(defaultCut);
  const userCut = useMemo(() => cutSpec(cut), [cut]);
  // Seeing through sheets and drawing lines behind them: a drawing setting
  // too. seeThrough is whether the device could draw see-through sheets.
  const [sight, setSight] = useState<Sight>(defaultSight);
  const userSight = useMemo(() => sightSpec(sight), [sight]);
  const [seeThrough, setSeeThrough] = useState(true);
  // Whether the device could draw strokes rather than hairlines.
  const [stroking, setStroking] = useState(true);
  // The manual camera's projection: kept by Reset view, carried by links.
  const [lensing, setLensing] = useState<Projection>("orthographic");
  // A named view asked for, and the drawn camera's axes beside the drawing.
  const [turn, setTurn] = useState<{ id: number; to: NamedView } | null>(null);
  const orientation = useRef<OrientationFeed>({});
  const viewport = useRef<View | undefined>(undefined),
    plotWrap = useRef<HTMLDivElement>(null),
    imageAbort = useRef<AbortController | null>(null);
  const pending = Object.values(states).some((s) => s.pending),
    scalarError = Object.values(states).find((s) => s.error);
  const key = JSON.stringify(config),
    request = probing ? `${key}\u0000probe:${target}` : key,
    busy = settled !== request || pending;
  const revision = JSON.stringify([key, states, active]);
  useEffect(() => {
    client.current = new EngineClient();
    return () => {
      generation.current++;
      client.current?.dispose();
      client.current = null;
      imageAbort.current?.abort();
    };
  }, []);
  useEffect(() => {
    let current = true;
    setError({ message: "" });
    if (pending || scalarError) {
      setSettled(request);
      return;
    }
    const timer = setTimeout(() => {
      client
        .current!.computeSpatial(config, {
          ...(probing ? probeOptions(target) : {}),
        })
        .then((value) => {
          if (current) {
            setFrame(value);
            setSettled(request);
          }
        })
        .catch((e: Error) => {
          if (current) {
            setError({
              message: e.message,
              field: e instanceof EngineError ? e.field : undefined,
            });
            setSettled(request);
          }
        });
    }, 140);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [request, pending, scalarError]);
  useEffect(() => {
    imageAbort.current?.abort();
    setImageBusy(false);
    setSpinning(false);
  }, [revision]);
  const scalarStatus = useMemo(
    () => ({
      client,
      generation,
      track: (job: Promise<void>) => {
        jobs.current.add(job);
        void job.finally(() => jobs.current.delete(job));
      },
      report: (id: string, state: ScalarState | null) =>
        setStates((old) => {
          if (!state && !(id in old)) return old;
          const next = { ...old };
          if (state) next[id] = state;
          else delete next[id];
          return next;
        }),
    }),
    [],
  );
  const update = (change: (c: SpatialConfig) => SpatialConfig) => {
    setPreset("");
    setConfig(change);
  };
  const choose = (index: string) => {
    if (index === "") return;
    generation.current++;
    touched.current = null;
    setStates({});
    setPreset(index);
    setCustomOpened(spatialPresets[+index].config.format === "parametric");
    setConfig(structuredClone(spatialPresets[+index].config));
    // A preset brings its own cut, or none, so it draws as its picture.
    setCut(structuredClone(spatialPresets[+index].cut ?? defaultCut));
    setSight(structuredClone(spatialPresets[+index].sight ?? defaultSight));
    // And its own camera path, or none.
    setPresetFlight((f) => ({
      id: (f?.id ?? 0) + 1,
      flight: spatialPresets[+index].flight,
    }));
    const probed = spatialPresets[+index].probe;
    setProbe((p) =>
      probed
        ? structuredClone(probed)
        : {
            ...p,
            position: defaultProbe.position,
            across: defaultProbe.across,
          },
    );
    // And its own projection and opening view, or orthographic from the
    // default view.
    setLensing(spatialPresets[+index].projection ?? "orthographic");
    const opening = spatialPresets[+index].view;
    setRestoredView(
      opening ? { reset: reset + 1, view: { ...opening } } : null,
    );
    setReset(reset + 1);
  };
  // A shared study replaces the whole study, as a preset does, and restores
  // the sender's layers, camera, and animation setup.
  const [linkNotice, setLinkNotice] = useState("");
  const manualCamera = useRef<SpatialCamera>({ ...initialView });
  const [restoredView, setRestoredView] = useState<{
    reset: number;
    view: SpatialCamera;
  } | null>(null);
  const animationSettings = useRef<SpatialAnimation | null>(null);
  const [presetFlight, setPresetFlight] = useState<{
    id: number;
    flight?: (typeof spatialPresets)[number]["flight"];
  } | null>(null);
  const [restoredAnimation, setRestoredAnimation] = useState<{
    id: number;
    settings: SpatialAnimation;
  } | null>(null);
  const openStudy = (id: number, study: SpatialStudy) => {
    generation.current++;
    touched.current = null;
    setStates({});
    setPreset("");
    setCustomOpened(study.config.format === "parametric");
    setConfig(study.config);
    setLayers(study.layers);
    setProbe(study.probe);
    setCut(study.cut);
    setSight(study.sight);
    setLensing(study.projection);
    setRestoredView({ reset: reset + 1, view: study.view });
    setReset(reset + 1);
    setRestoredAnimation({ id, settings: study.animation });
  };
  useEffect(() => {
    if (!shared) return;
    setLinkNotice(shared.error ?? "");
    if (shared.error !== undefined) return;
    try {
      openStudy(shared.id, spatialStudy(shared.study));
    } catch (e) {
      setLinkNotice(
        e instanceof LinkError ? e.message : "This link could not be read.",
      );
    }
  }, [shared?.id]);
  const snapshot = (): SpatialStudy => ({
    config,
    layers,
    view: manualCamera.current,
    animation: animationSettings.current ?? defaultAnimation,
    // What the probe describes, not the target last chosen elsewhere, so
    // that a mirror's link names the light or the mirror.
    probe: { ...probe, target: probeTarget(config, probe) },
    cut,
    sight,
    projection: lensing,
  });
  // The cut's buttons compute from its numeric fields, so they wait for
  // evaluations still pending for them; a preset chosen meanwhile wins.
  async function changeCut(change: (c: Cut) => Cut) {
    const token = generation.current;
    await Promise.allSettled([...jobs.current]);
    if (token !== generation.current) return;
    setCut(change);
  }
  // Toward the viewer of the shown camera, to three decimals: only the
  // direction counts.
  const faceView = () => {
    const v = viewport.current;
    if (!v) return;
    const round = (x: number) => Math.round(x * 1000) / 1000 + 0;
    void changeCut((c) => ({
      ...c,
      normal: {
        x: round(-Math.cos(v.pitch) * Math.sin(v.yaw)),
        y: round(Math.sin(v.pitch)),
        z: round(Math.cos(v.pitch) * Math.cos(v.yaw)),
      },
    }));
  };
  const centerCut = () => {
    const center = viewport.current?.center;
    if (!center) return;
    void changeCut((c) => {
      const { x, y, z } = c.normal,
        length = Math.hypot(x, y, z);
      if (!(length > 0) || !Number.isFinite(length)) return c;
      return {
        ...c,
        offset: (x * center.x + y * center.y + z * center.z) / length + 0,
      };
    });
  };
  const flipCut = () =>
    void changeCut((c) => ({
      ...c,
      normal: { x: -c.normal.x + 0, y: -c.normal.y + 0, z: -c.normal.z + 0 },
      offset: -c.offset + 0,
    }));
  async function definition(format: SpatialConfig["format"]) {
    const token = generation.current;
    await Promise.allSettled([...jobs.current]);
    if (token !== generation.current) return;
    setConfig((c) => {
      if (
        format === "torus" ||
        format === "harmonic" ||
        format === "field" ||
        format === "pursuit" ||
        format === "surface" ||
        format === "rays" ||
        format === "implicit"
      )
        return { ...c, format };
      // Preserve an edited custom definition. A generated knot can also be opened
      // as expressions, with every pending scalar resolved before conversion.
      if (c.format === "parametric" || customOpened) return { ...c, format };
      const h = `(${c.radius}+${c.tube}*cos(${c.q}*t))`;
      return {
        ...c,
        format,
        curve: {
          ...c.curve,
          x: `${h}*cos(${c.p}*t)`,
          y: `${h}*sin(${c.p}*t)`,
          z: `${c.tube}*sin(${c.q}*t)`,
          min: 0,
          max: 2 * Math.PI,
        },
      };
    });
    if (format === "parametric") setCustomOpened(true);
    setPreset("");
  }
  const involute = config.construction === "involute";
  const inversion = config.construction === "inversion";
  const framed = config.construction === "framed";
  const ruled = config.construction === "ruled";
  const canal = config.construction === "canal";
  const none = config.construction === "none";
  const flowing = config.format === "field";
  const chasing = config.format === "pursuit";
  // A surface is not a curve: no construction applies to it.
  const surfacing = config.format === "surface";
  // A mirror is a surface patch lit for a single reflection; it shares the
  // patch's controls but not its offset or normal lines.
  const mirroring = config.format === "rays";
  // Refracting, the same patch is an interface between two media; either
  // may add a receiver plane.
  const refracting = mirroring && config.rays.interaction === "refract";
  const receiving = mirroring && config.rays.receiver.plane !== "none";
  const face = refracting ? "interface" : "mirror";
  const patched = surfacing || mirroring;
  // A level set is found in a box, not drawn from a parameter: no
  // construction applies to it either.
  const leveled = config.format === "implicit";
  const curveless = patched || leveled;
  // Only a curve given by a formula can be evaluated between its samples.
  const refinable = !curveless && !flowing && !chasing;
  const setCanal = (change: (q: CanalConfig) => CanalConfig) =>
    update((c) => ({ ...c, canal: change(c.canal) }));
  const setRuling = (change: (r: RuledConfig) => RuledConfig) =>
    update((c) => ({ ...c, ruled: change(c.ruled) }));
  const setFraming = (change: (f: FrameConfig) => FrameConfig) =>
    update((c) => ({ ...c, frame: change(c.frame) }));
  const projection =
    config.construction === "tangent-foot" ||
    config.construction === "orthotomic";
  const orthotomic = config.construction === "orthotomic";
  const projectionName = orthotomic
    ? "Tangent-line orthotomic"
    : "Tangent-foot curve";
  // A construction built on a derived input draws that curve as its own,
  // with the base curve beneath it.
  const composing = composes(config);
  const inputName = {
    base: "Base curve",
    "tangent-foot": "Tangent-foot curve",
    orthotomic: "Tangent-line orthotomic",
    involute: "Involute",
  }[config.input];
  const unwinding = config.unwinding;
  // Choosing the involute keeps its anchor where the domain allows, and
  // otherwise moves it to the domain's middle. The choice applies at once;
  // the anchor is checked again once evaluations still pending for the
  // domain land, unless the input or the study has changed meanwhile.
  const centerAnchor = (c: SpatialConfig) => {
    const [lo, hi] = curveDomain(c);
    const anchor = c.unwinding.anchor;
    return c.input === "involute" && !(anchor >= lo && anchor <= hi)
      ? { ...c, unwinding: { ...c.unwinding, anchor: (lo + hi) / 2 } }
      : c;
  };
  function chooseInput(input: SpatialConfig["input"]) {
    update((c) => centerAnchor({ ...c, input }));
    if (input !== "involute" || jobs.current.size === 0) return;
    const token = generation.current;
    void Promise.allSettled([...jobs.current]).then(() => {
      if (token === generation.current) setConfig(centerAnchor);
    });
  }
  const inversionSource = {
    base: "the base curve",
    "tangent-foot": "the tangent-foot curve",
    orthotomic: "the tangent-line orthotomic",
  }[config.inversion.input];
  const harmonic = config.harmonic;
  const setHarmonic = (change: (h: HarmonicCurve) => HarmonicCurve) =>
    update((c) => ({ ...c, harmonic: change(c.harmonic) }));
  // Adding or removing a term renumbers the fields after it, so evaluations
  // still pending for them land first; a preset chosen meanwhile wins.
  async function editTerms(
    change: (terms: HarmonicCurve["terms"]) => HarmonicCurve["terms"],
  ) {
    const token = generation.current;
    await Promise.allSettled([...jobs.current]);
    if (token !== generation.current) return;
    setHarmonic((h) => ({ ...h, terms: change(h.terms) }));
  }
  // Closure depends only on the moving frequencies and the domain, so the
  // last result still describes a curve whose vectors have changed.
  const closure =
    frame?.config.format === "harmonic" &&
    harmonicClosureKey(frame.config.harmonic) === harmonicClosureKey(harmonic)
      ? frame.result.harmonic
      : undefined;
  const vector = (
    label: string,
    value: number,
    set: (value: number) => void,
    help?: string,
  ) => (
    <Field key={label} label={label} help={help}>
      <ScalarInput name={label} value={value} onChange={set} />
    </Field>
  );
  const harmonicControls = (
    <>
      <p className="note">
        r(t) = c₀ + Σ [Aₖ cos(ωₖ t) + Bₖ sin(ωₖ t)]. Each term is a vector
        turning around the ellipse spanned by Aₖ and Bₖ, from Aₖ at t = 0
        towards Bₖ, at ωₖ radians per unit t. The vectors are chained from c₀ in
        this order.
      </p>
      <div className="pair trio">
        {(["x", "y", "z"] as const).map((axis) =>
          vector(
            harmonicLabels.center(axis),
            harmonic.center[axis],
            (value) =>
              setHarmonic((h) => ({
                ...h,
                center: { ...h.center, [axis]: value },
              })),
            axis === "x"
              ? "The fixed center c₀ the vectors start from. Coordinates within ±100000."
              : undefined,
          ),
        )}
      </div>
      {harmonic.terms.map((term, i) => (
        <div
          className="term"
          role="group"
          aria-labelledby={`spatial-term-${i}`}
          key={i}
        >
          <div className="term-heading">
            <span id={`spatial-term-${i}`}>Term {i + 1}</span>
            <button
              type="button"
              aria-label={`Remove term ${i + 1}`}
              disabled={harmonic.terms.length === 1}
              onClick={() => void editTerms((t) => t.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </div>
          {vector(
            harmonicLabels.frequency(i + 1),
            term.frequency,
            (value) =>
              setHarmonic((h) => ({
                ...h,
                terms: h.terms.map((t, j) =>
                  j === i ? { ...t, frequency: value } : t,
                ),
              })),
            "Radians per unit t, within ±1000; negative turns from Aₖ away from Bₖ. At 0 the term is the fixed translation Aₖ.",
          )}
          {(["cosine", "sine"] as const).map((field) => (
            <div className="pair trio" key={field}>
              {(["x", "y", "z"] as const).map((axis) =>
                vector(
                  harmonicLabels[field](i + 1, axis),
                  term[field][axis],
                  (value) =>
                    setHarmonic((h) => ({
                      ...h,
                      terms: h.terms.map((t, j) =>
                        j === i
                          ? { ...t, [field]: { ...t[field], [axis]: value } }
                          : t,
                      ),
                    })),
                  axis === "x"
                    ? field === "cosine"
                      ? "Aₖ is the vector at t = 0. Coordinates within ±100000."
                      : "Bₖ is the vector a quarter turn later. Parallel to Aₖ, the ellipse flattens to a segment."
                    : undefined,
                ),
              )}
            </div>
          ))}
        </div>
      ))}
      <button
        className="closure"
        type="button"
        disabled={harmonic.terms.length >= maxHarmonicTerms}
        onClick={() => void editTerms((t) => [...t, nextHarmonicTerm(t)])}
      >
        {harmonic.terms.length >= maxHarmonicTerms
          ? "At most 8 terms"
          : "Add a term"}
      </button>
      <div className="pair">
        {(
          [
            ["min", "t from"],
            ["max", "to"],
          ] as const
        ).map(([key, label]) => (
          <Field label={label} key={key}>
            <ScalarInput
              name={label}
              value={harmonic[key]}
              onChange={(value) => setHarmonic((h) => ({ ...h, [key]: value }))}
            />
          </Field>
        ))}
      </div>
      <p className="note" data-testid="closure-note">
        {closure
          ? harmonicClosureNote(closure, harmonic.max - harmonic.min)
          : "Checking whether the curve closes…"}
      </p>
      {closure && closure.period > 0 && !closure.closed && (
        <button
          className="closure"
          type="button"
          onClick={() =>
            setHarmonic((h) => ({ ...h, max: h.min + closure.period }))
          }
        >
          Trace one full period ({periodText(closure.period).text})
        </button>
      )}
    </>
  );
  const setField = (change: (f: FieldConfig) => FieldConfig) =>
    update((c) => ({ ...c, field: change(c.field) }));
  // Adding or removing a seed renumbers the fields after it, so evaluations
  // still pending for them land first; a preset chosen meanwhile wins.
  async function editSeeds(
    change: (seeds: FieldConfig["seeds"]) => FieldConfig["seeds"],
  ) {
    const token = generation.current;
    await Promise.allSettled([...jobs.current]);
    if (token !== generation.current) return;
    setField((f) => ({ ...f, seeds: change(f.seeds) }));
  }
  const flows =
    frame?.config.format === "field" ? frame.result.field : undefined;
  const fieldControls = (
    <>
      <p className="note">
        Each trajectory starts at its seed (within ±100,000) when t is at the
        interval start and follows the field: its velocity at (x, y, z) at time
        t is (dx/dt, dy/dt, dz/dt). Use <var>x</var>, <var>y</var>, <var>z</var>
        , <var>t</var>, and <var>a</var>. The first seed&rsquo;s trajectory is
        the curve a construction uses.
      </p>
      {(["x", "y", "z"] as const).map((axis) => (
        <Field label={`d${axis}/dt`} className="equation" key={axis}>
          <input
            value={config.field[axis]}
            spellCheck={false}
            onChange={(e) =>
              setField((f) => ({ ...f, [axis]: e.target.value }))
            }
          />
        </Field>
      ))}
      <Field
        label="Shape parameter a"
        help="Use a in any of the three expressions, then animate it with a parameter track."
      >
        <ScalarInput
          name="Shape parameter a"
          value={config.field.a}
          onChange={(value) => setField((f) => ({ ...f, a: value }))}
        />
      </Field>
      {config.field.seeds.map((seed, i) => (
        <div
          className="term"
          role="group"
          aria-labelledby={`spatial-seed-${i}`}
          key={i}
        >
          <div className="term-heading">
            <span id={`spatial-seed-${i}`}>Seed {i + 1}</span>
            <button
              type="button"
              aria-label={`Remove seed ${i + 1}`}
              disabled={config.field.seeds.length === 1}
              onClick={() => void editSeeds((s) => s.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </div>
          <div className="pair trio">
            {(["x", "y", "z"] as const).map((axis) =>
              vector(seedLabel(i + 1, axis), seed[axis], (value) =>
                setField((f) => ({
                  ...f,
                  seeds: f.seeds.map((s, j) =>
                    j === i ? { ...s, [axis]: value } : s,
                  ),
                })),
              ),
            )}
          </div>
        </div>
      ))}
      <button
        className="closure"
        type="button"
        disabled={config.field.seeds.length >= maxSpatialSeeds}
        onClick={() => void editSeeds((s) => [...s, nextSpatialSeed(s)])}
      >
        {config.field.seeds.length >= maxSpatialSeeds
          ? "At most 12 seeds"
          : "Add a seed"}
      </button>
      <div className="pair">
        {(
          [
            ["min", "t from"],
            ["max", "to"],
          ] as const
        ).map(([key, label]) => (
          <Field label={label} key={key}>
            <ScalarInput
              name={label}
              value={config.field[key]}
              onChange={(value) => setField((f) => ({ ...f, [key]: value }))}
            />
          </Field>
        ))}
      </div>
      {vector(
        "Escape radius R",
        config.field.escape,
        (value) => setField((f) => ({ ...f, escape: value })),
        "A trajectory ends the first time it leaves the sphere of this radius about the origin (0–100,000), so a field that runs off to infinity stops in view. A seed outside the sphere has no path.",
      )}
      <p className="note" data-testid="field-note">
        {flows
          ? fieldNote(
              flows,
              frame!.config.field.min,
              frame!.config.construction !== "none",
            )
          : "Integrating…"}
      </p>
    </>
  );
  const setPursuit = (
    change: (q: SpatialPursuitConfig) => SpatialPursuitConfig,
  ) => update((c) => ({ ...c, pursuit: change(c.pursuit) }));
  // Adding or removing a pursuer renumbers the fields after it, so
  // evaluations still pending for them land first; a preset chosen meanwhile
  // wins.
  async function editPursuers(
    change: (
      pursuers: SpatialPursuitConfig["pursuers"],
    ) => SpatialPursuitConfig["pursuers"],
  ) {
    const token = generation.current;
    await Promise.allSettled([...jobs.current]);
    if (token !== generation.current) return;
    setPursuit((q) => ({ ...q, pursuers: change(q.pursuers) }));
  }
  const chase =
    frame?.config.format === "pursuit" ? frame.result.pursuit : undefined;
  const captured =
    chase?.capture && chase.capture.time > frame!.config.pursuit.min
      ? chase.capture
      : undefined;
  const pursuitControls = (
    <>
      <p className="note">
        Each pursuer starts at (x, y, z) (within ±100,000) when t is at the
        interval start and runs straight at the next one, the last at the first,
        at its own speed v (0–100,000). The first pursuer&rsquo;s path is the
        curve a construction uses.
      </p>
      {config.pursuit.pursuers.map((pursuer, i, all) => (
        <div
          className="term"
          role="group"
          aria-labelledby={`spatial-pursuer-${i}`}
          key={i}
        >
          <div className="term-heading">
            <span id={`spatial-pursuer-${i}`}>
              Pursuer {i + 1}, chasing {i + 1 === all.length ? 1 : i + 2}
            </span>
            <button
              type="button"
              aria-label={`Remove pursuer ${i + 1}`}
              disabled={all.length === 2}
              onClick={() =>
                void editPursuers((p) => p.filter((_, j) => j !== i))
              }
            >
              Remove
            </button>
          </div>
          <div className="pair quad">
            {(["X", "Y", "Z", "Speed"] as const).map((field) => {
              const key = field.toLowerCase() as "x" | "y" | "z" | "speed";
              return vector(
                spatialPursuerLabels[field](i + 1),
                pursuer[key],
                (value) =>
                  setPursuit((q) => ({
                    ...q,
                    pursuers: q.pursuers.map((p, j) =>
                      j === i ? { ...p, [key]: value } : p,
                    ),
                  })),
              );
            })}
          </div>
        </div>
      ))}
      <button
        className="closure"
        type="button"
        disabled={config.pursuit.pursuers.length >= maxSpatialPursuers}
        onClick={() => void editPursuers((p) => [...p, nextSpatialPursuer(p)])}
      >
        {config.pursuit.pursuers.length >= maxSpatialPursuers
          ? "At most 16 pursuers"
          : "Add a pursuer"}
      </button>
      <div className="pair">
        {(
          [
            ["min", "t from"],
            ["max", "to"],
          ] as const
        ).map(([key, label]) => (
          <Field label={label} key={key}>
            <ScalarInput
              name={label}
              value={config.pursuit[key]}
              onChange={(value) => setPursuit((q) => ({ ...q, [key]: value }))}
            />
          </Field>
        ))}
      </div>
      {vector(
        "Capture distance ε",
        config.pursuit.capture,
        (value) => setPursuit((q) => ({ ...q, capture: value })),
        "A pursuer’s direction is undefined on its target, so the chase stops, for everyone, the first time any pursuer comes this close to its own target (0–100,000). Nobody merges or changes target.",
      )}
      <p className="note" data-testid="pursuit-note">
        {chase
          ? pursuitNote(
              chase,
              frame!.config.pursuit.min,
              frame!.config.construction !== "none",
            )
          : "Chasing…"}
      </p>
      {captured && (
        <button
          className="closure"
          type="button"
          onClick={() => {
            setPreset("");
            setPursuit((q) => ({ ...q, max: captured.time }));
          }}
        >
          End the interval at the capture
        </button>
      )}
    </>
  );
  const setSurface = (change: (s: SurfaceConfig) => SurfaceConfig) =>
    update((c) => ({ ...c, surface: change(c.surface) }));
  // Each kind's shape fields mean something different, so choosing a kind
  // starts from its own shape and whole chart; evaluations still pending
  // land first, and a preset chosen meanwhile wins.
  async function chooseSurface(kind: SurfaceKind) {
    const token = generation.current;
    await Promise.allSettled([...jobs.current]);
    if (token !== generation.current) return;
    setSurface((s) => ({ ...s, kind, ...surfaceDefaults[kind] }));
  }
  const patch =
    frame?.config.format === "surface" ? frame.result.surface : undefined;
  const mirror =
    frame?.config.format === "rays" ? frame.result.rays : undefined;
  const setRays = (change: (r: RaysConfig) => RaysConfig) =>
    update((c) => ({ ...c, rays: change(c.rays) }));
  const setReceiver = (change: (r: ReceiverConfig) => ReceiverConfig) =>
    setRays((r) => ({ ...r, receiver: change(r.receiver) }));
  const interactionControls = (
    <>
      <Field
        label="Interaction"
        help="One reflection, from a mirror, or one refraction, through an interface between two media. Either happens once: the outgoing light never meets the surface again."
      >
        <select
          value={config.rays.interaction}
          onChange={(e) => {
            const interaction = e.target.value as RaysConfig["interaction"];
            setRays((r) => ({ ...r, interaction }));
          }}
        >
          <option value="reflect">Reflection · a mirror</option>
          <option value="refract">Refraction · an interface</option>
        </select>
      </Field>
      {refracting && (
        <div className="pair">
          {vector(
            "Index n₁",
            config.rays.n1,
            (n1) => setRays((r) => ({ ...r, n1 })),
            "Refractive indices on the incident side, where n points, and beyond it; each positive and at most 100. The ratio is η = n₁/n₂, and light leaving the denser side beyond its critical angle is totally reflected.",
          )}
          {vector("Index n₂", config.rays.n2, (n2) =>
            setRays((r) => ({ ...r, n2 })),
          )}
        </div>
      )}
    </>
  );
  const [first, second] =
    receiverAxes[
      config.rays.receiver.plane === "none" ? "z" : config.rays.receiver.plane
    ];
  const receiverControls = (
    <>
      <Field
        label="Receiver"
        help="A plane that collects the outgoing rays and measures the irradiance they deliver to a square window, as a study separate from the caustics."
      >
        <select
          value={config.rays.receiver.plane}
          onChange={(e) => {
            const plane = e.target.value as ReceiverConfig["plane"];
            setReceiver((r) => ({ ...r, plane }));
          }}
        >
          <option value="none">None</option>
          <option value="x">Plane x = c</option>
          <option value="y">Plane y = c</option>
          <option value="z">Plane z = c</option>
        </select>
      </Field>
      {receiving && (
        <>
          <div className="pair">
            {vector(
              "Plane at c",
              config.rays.receiver.at,
              (at) => setReceiver((r) => ({ ...r, at })),
              "Where the plane stands, within ±100000, and the side of its square window, positive and at most 100000.",
            )}
            {vector("Window size s", config.rays.receiver.size, (size) =>
              setReceiver((r) => ({ ...r, size })),
            )}
          </div>
          <div className="pair">
            {vector(
              `Centre ${first}`,
              config.rays.receiver.c1,
              (c1) => setReceiver((r) => ({ ...r, c1 })),
              "The window's centre on the plane, each coordinate within ±100000.",
            )}
            {vector(`Centre ${second}`, config.rays.receiver.c2, (c2) =>
              setReceiver((r) => ({ ...r, c2 })),
            )}
          </div>
          <Field
            label="Bins"
            help={`${minReceiverBins}–${maxReceiverBins} bins each way; each shows the mean irradiance over its square.`}
          >
            <input
              type="number"
              min={minReceiverBins}
              max={maxReceiverBins}
              step="1"
              value={
                Number.isNaN(config.rays.receiver.bins)
                  ? ""
                  : config.rays.receiver.bins
              }
              onChange={(e) => {
                const bins = e.target.valueAsNumber;
                setReceiver((r) => ({ ...r, bins }));
              }}
            />
          </Field>
        </>
      )}
    </>
  );
  const lightControls = (
    <>
      <Field
        label="Light"
        help={`Parallel light, as from a distant source, or a point source. Either ${refracting ? "refracts" : "reflects"} once; nothing blocks it on the way in or out.`}
      >
        <select
          value={config.rays.light}
          onChange={(e) => {
            const light = e.target.value as RaysConfig["light"];
            setRays((r) => ({ ...r, light }));
          }}
        >
          <option value="parallel">Parallel light</option>
          <option value="point">Point source</option>
        </select>
      </Field>
      {config.rays.light === "parallel" ? (
        <div className="pair">
          {vector(
            "Azimuth α (°)",
            config.rays.azimuth,
            (azimuth) => setRays((r) => ({ ...r, azimuth })),
            "The light travels along (cos β cos α, cos β sin α, sin β), in degrees within ±100000: β = −90 is straight down.",
          )}
          {vector("Elevation β (°)", config.rays.elevation, (elevation) =>
            setRays((r) => ({ ...r, elevation })),
          )}
        </div>
      ) : (
        <div className="pair trio">
          {(["x", "y", "z"] as const).map((axis) =>
            vector(
              `Source ${axis}`,
              config.rays.source[axis],
              (value) =>
                setRays((r) => ({
                  ...r,
                  source: { ...r.source, [axis]: value },
                })),
              axis === "x"
                ? "Where the light leaves, each coordinate within ±100000."
                : undefined,
            ),
          )}
        </div>
      )}
      {vector(
        "Ray length ℓ",
        config.rays.length,
        (length) => setRays((r) => ({ ...r, length })),
        `Each ${refracting ? "transmitted" : "reflected"} ray runs ℓ from the ${face}, and its virtual extension ℓ back behind it; parallel light arrives from ℓ away. 0–100000; 0 hides the rays.`,
      )}
      {receiverControls}
      <p className="note" data-testid="rays-note">
        {mirror && frame
          ? raysNote(mirror, frame.config.rays).join(" ")
          : "Following the light…"}
      </p>
    </>
  );
  const shapeFields = surfaceShape[config.surface.kind].map((f) =>
    vector(
      f.label,
      config.surface[f.key],
      (value) => setSurface((s) => ({ ...s, [f.key]: value })),
      f.help,
    ),
  );
  const surfaceControls = (
    <>
      <Field
        label="Surface"
        help="An analytic patch with exact first and second derivatives. Choosing one starts from its own shape and whole chart."
      >
        <select
          value={config.surface.kind}
          onChange={(e) => void chooseSurface(e.target.value as SurfaceKind)}
        >
          {(Object.keys(surfaceNames) as SurfaceKind[]).map((kind) => (
            <option key={kind} value={kind}>
              {surfaceNames[kind]}
            </option>
          ))}
        </select>
      </Field>
      <p className="note">
        {surfaceCharts[config.surface.kind]}. A domain shorter than the whole
        chart opens the surface, so what lies inside it shows.
      </p>
      {shapeFields.length === 1 ? (
        shapeFields
      ) : (
        <div className={shapeFields.length === 3 ? "pair trio" : "pair"}>
          {shapeFields}
        </div>
      )}
      {(["u", "v"] as const).map((axis) => (
        <div className="pair" key={axis}>
          {vector(
            `${axis} from`,
            config.surface[`${axis}Min`],
            (value) => setSurface((s) => ({ ...s, [`${axis}Min`]: value })),
            axis === "u"
              ? "The parameter intervals the patch covers, each within ±1000000 and 0.000001–100000 wide."
              : undefined,
          )}
          {vector(`${axis} to`, config.surface[`${axis}Max`], (value) =>
            setSurface((s) => ({ ...s, [`${axis}Max`]: value })),
          )}
        </div>
      ))}
      {mirroring && interactionControls}
      <Field
        label={
          refracting ? "Incident side" : mirroring ? "Mirror side" : "Normal"
        }
        help={
          refracting
            ? "The light arrives on the side n points to, in index n₁, and crosses into n₂; light from behind is unlit. Nothing is inferred about inside and outside."
            : mirroring
              ? "The mirror reflects on the side n points to: light arriving against n reflects, and light from behind it is unlit. Nothing is inferred about inside and outside."
              : "Which side n points to. Reversing it negates both curvatures and swaps the focal sheets' numbers; the geometry stays."
        }
      >
        <select
          value={config.surface.reverse ? "reverse" : "forward"}
          onChange={(e) => {
            const reverse = e.target.value === "reverse";
            setSurface((s) => ({ ...s, reverse }));
          }}
        >
          <option value="forward">Along X_u × X_v</option>
          <option value="reverse">Reversed</option>
        </select>
      </Field>
      {mirroring ? (
        lightControls
      ) : (
        <>
          <div className="pair">
            {vector(
              "Offset d",
              config.surface.offset,
              (offset) => setSurface((s) => ({ ...s, offset })),
              "The offset surface X + d n, signed along n, within ±100000; 0 hides it.",
            )}
            {vector(
              "Normal reach ℓ",
              config.surface.reach,
              (reach) => setSurface((s) => ({ ...s, reach })),
              "Each normal line runs from X to X + ℓn: signed along n, within ±100000. 0 hides them.",
            )}
          </div>
          <p className="note" data-testid="surface-note">
            {patch ? surfaceNote(patch).join(" ") : "Measuring the curvature…"}
          </p>
        </>
      )}
    </>
  );
  const setImplicit = (change: (q: ImplicitConfig) => ImplicitConfig) =>
    update((c) => ({ ...c, implicit: change(c.implicit) }));
  const setSections = (
    change: (s: ImplicitConfig["sections"]) => ImplicitConfig["sections"],
  ) => setImplicit((q) => ({ ...q, sections: change(q.sections) }));
  const levelSet =
    frame?.config.format === "implicit" ? frame.result.implicit : undefined;
  const implicitControls = (
    <>
      <Field
        label="F(x, y, z)"
        help="An expression in x, y, z and a, but not t. The surface is where F = c, meshed within the box; ∇F points to larger F."
      >
        <input
          value={config.implicit.f}
          spellCheck={false}
          onChange={(e) => {
            const f = e.target.value;
            setImplicit((q) => ({ ...q, f }));
          }}
        />
      </Field>
      <div className="pair">
        {vector(
          "Level c",
          config.implicit.level,
          (level) => setImplicit((q) => ({ ...q, level })),
          "The level, and a shape parameter a free for the expression; both finite. Animating either sweeps a family of surfaces.",
        )}
        {vector("Shape parameter a", config.implicit.a, (a) =>
          setImplicit((q) => ({ ...q, a })),
        )}
      </div>
      {(["x", "y", "z"] as const).map((axis) => (
        <div className="pair" key={axis}>
          {vector(
            `${axis} from`,
            config.implicit.box[`${axis}Min`],
            (value) =>
              setImplicit((q) => ({
                ...q,
                box: { ...q.box, [`${axis}Min`]: value },
              })),
            axis === "x"
              ? "The box the surface is sought in: each bound within ±100000, each side at least 0.000001 wide. Where the surface meets the box, it is cut open."
              : undefined,
          )}
          {vector(`${axis} to`, config.implicit.box[`${axis}Max`], (value) =>
            setImplicit((q) => ({
              ...q,
              box: { ...q.box, [`${axis}Max`]: value },
            })),
          )}
        </div>
      ))}
      <Field
        label="Section planes"
        help={`From 0 to ${maxSections} parallel planes, evenly spaced; each cuts the surface in the planar level set of F on it.`}
      >
        <input
          type="number"
          min="0"
          max={maxSections}
          step="1"
          value={
            Number.isNaN(config.implicit.sections.count)
              ? ""
              : config.implicit.sections.count
          }
          onChange={(e) => {
            const count = e.target.valueAsNumber;
            setSections((s) => ({ ...s, count }));
          }}
        />
      </Field>
      {config.implicit.sections.count > 0 && (
        <>
          <div className="pair trio">
            {(["x", "y", "z"] as const).map((axis) =>
              vector(
                `Normal ${axis}`,
                config.implicit.sections.normal[axis],
                (value) =>
                  setSections((s) => ({
                    ...s,
                    normal: { ...s.normal, [axis]: value },
                  })),
                axis === "x"
                  ? "The planes' normal n, not zero, each coordinate within ±100000. It is made a unit vector n̂."
                  : undefined,
              ),
            )}
          </div>
          <div className="pair">
            {vector(
              "First offset d₀",
              config.implicit.sections.from,
              (from) => setSections((s) => ({ ...s, from })),
              "The planes n̂·p = d, with d evenly from d₀ to d₁, both included; a single plane stands at d₀. Each within ±100000.",
            )}
            {vector("Last offset d₁", config.implicit.sections.to, (to) =>
              setSections((s) => ({ ...s, to })),
            )}
          </div>
        </>
      )}
      <p className="note" data-testid="implicit-note">
        {levelSet ? implicitNote(levelSet).join(" ") : "Meshing the level set…"}
      </p>
      <details {...expressions} className="spatial-details">
        <summary>Expression reference</summary>
        <p>
          Use x, y, z, a, pi, e, phi; + − * / ^; sin, cos, tan, asin, acos,
          atan, sinh, cosh, tanh, sech, exp, log, ln, sqrt, abs. Trigonometry
          uses radians. Write multiplication explicitly, such as 2*x*y.
          Constants only in numeric controls.
        </p>
      </details>
    </>
  );
  const failure = scalarError
    ? `${scalarError.name}: ${scalarError.error}`
    : error.message;
  // Where the failure is shown: under the input that failed to parse, or
  // under the control the engine's error names, or, for an error about the
  // whole study, the control just changed; the notebook shows it below the
  // study only when no such field can.
  const failureTarget: Pick<FieldErrorTarget, "id" | "label"> = scalarError
    ? scalarError.control
      ? { id: scalarError.control }
      : { label: scalarError.name }
    : {
        label:
          (error.field && fieldLabel(config, error.field)) ??
          touched.current ??
          undefined,
      };
  const fieldError = useMemo<FieldErrorTarget>(
    () => ({ ...failureTarget, message: failure, claim, touch }),
    [failureTarget.id, failureTarget.label, failure],
  );
  // Fields outside the study's own controls show only their own inputs'
  // errors, so a shared label never claims another's.
  const panelError = useMemo<FieldErrorTarget>(
    () => ({ ...fieldError, label: undefined }),
    [fieldError],
  );
  const claimedHere = !!failure && claimed !== null;
  const shown = animation?.frame ?? frame,
    camera = animation ? animationCamera(animation) : undefined,
    // A finished animation hands its camera over to be explored.
    override = animation?.complete ? undefined : camera,
    released = animation?.complete ? camera : undefined;
  const ready = !!frame && !busy && !failure && !renderError;
  // The probe draws on the study's own result, or where an animation that
  // moves it has taken it; other animation frames go without it. The
  // user's position is kept for when the animation stops.
  const moving = animation?.probe !== undefined ? animation : null;
  const probeFrame = moving
    ? moving.frame
    : !animation &&
        probing &&
        frame &&
        probeSteps(frame.result, probeTarget(frame.config, probe)) !== null
      ? frame
      : null;
  // The sample (or a surface's row) the probe stands at; a surface probe's
  // column follows probe.across.
  const probeAt = moving
    ? moving.probe!
    : probeFrame
      ? gridded(probeTarget(probeFrame.config, probe))
        ? surfaceProbeAt(
            probeFrame.result.surfaceDiagnostics!,
            probe.position,
            probe.across,
          ).row
        : probeIndex(probe.position, probeFrame.result.base.length - 1)
      : 0;
  const probeSetup = moving?.probeSetup ?? probe;
  // The cut as drawn: where an animation that moves it has taken it, or the
  // entered plane.
  const drawnCut = animation?.cut ?? userCut.spec;
  // The cut's edge in the legend while it is drawn.
  const cutLegend = drawnCut?.edge ? (
    <>
      {" "}
      <span className="cut-dot" /> Cut edge
    </>
  ) : null;
  const probeDrawing = useMemo(
    () =>
      probeFrame
        ? drawProbe(probeFrame.result, probeFrame.config, probeSetup, probeAt)
        : [],
    [probeFrame, probeAt, probeSetup.target, probeSetup.across],
  );
  async function save(format: string) {
    if (!shown || !viewport.current) return;
    imageAbort.current?.abort();
    const controller = new AbortController();
    imageAbort.current = controller;
    setImageBusy(true);
    const snapshot = structuredClone({
      frame: shown,
      view: viewport.current,
      layers,
      dark: theme.dark,
      cut: drawnCut,
      sight: userSight.spec,
    });
    try {
      const { imageFile } = await import("./export");
      controller.signal.throwIfAborted();
      const blob = await imageFile(
        snapshot.frame,
        snapshot.view,
        snapshot.layers,
        snapshot.dark,
        format as ImageFormat,
        controller.signal,
        probeFrame && probeDrawing.length && shown === probeFrame
          ? {
              batches: probeDrawing,
              record: probeRecord(
                probeFrame.result,
                probeFrame.config,
                probeSetup,
                probeAt,
              ),
            }
          : undefined,
        snapshot.cut,
        snapshot.sight,
      );
      controller.signal.throwIfAborted();
      saveFile(
        blob,
        `tangent-garden-spatial${imageNames[format as ImageFormat]}`,
      );
    } catch (e) {
      if (!controller.signal.aborted) throw e;
    } finally {
      if (imageAbort.current === controller) {
        imageAbort.current = null;
        setImageBusy(false);
      }
    }
  }
  const showPlot = () => {
    setSpinning(false);
    revealDrawing(
      plotWrap.current,
      document.getElementById("spatial-playback"),
    );
  };
  // On phones the controls follow the drawing directly, so the explanation
  // moves after them instead of separating the two.
  const unreached = shown?.result.involute?.unreached ?? 0;
  const inverted = shown?.result.inversion;
  const composition = shown?.result.composition;
  const frameResult =
    shown?.config.construction === "framed" ? shown.result.frame : undefined;
  const transported = config.frame.kind === "rotation-minimizing";
  // N₀, θ₀ with twist, and the closed-loop seam: shared by the framed ribbon
  // and the canal surface, whose angle is carried by the same frame.
  const referenceFields = (
    <div className="pair trio">
      {(["x", "y", "z"] as const).map((axis) =>
        vector(
          `N₀ ${axis}`,
          config.frame.reference[axis],
          (value) =>
            setFraming((f) => ({
              ...f,
              reference: { ...f.reference, [axis]: value },
            })),
          axis === "x"
            ? "Reference normal N₀, nonzero and within ±100000. Projected onto the normal plane where each unbroken stretch begins, it sets U there."
            : undefined,
        ),
      )}
    </div>
  );
  const angleFields = (
    <div className="pair">
      {vector(
        "Angle θ₀",
        config.frame.angle,
        (angle) => setFraming((f) => ({ ...f, angle })),
        "Where D starts, in radians from U towards V, within ±1000.",
      )}
      {vector(
        "Twist (turns)",
        config.frame.twist,
        (twist) => setFraming((f) => ({ ...f, twist })),
        "Turns of D about the tangent, spread by arc length over the curve, within ±100.",
      )}
    </div>
  );
  const closureField = (
    <Field
      label="Closed-loop seam"
      help="On an unbroken closed loop the carried frame can return turned. Show that seam, or spread the opposite twist evenly along the loop."
    >
      <select
        value={config.frame.closure}
        onChange={(e) => {
          const closure = e.target.value as FrameConfig["closure"];
          setFraming((f) => ({ ...f, closure }));
        }}
      >
        <option value="seam">Show the seam</option>
        <option value="distribute">Distribute the correction</option>
      </select>
    </Field>
  );
  const frameControls = (
    <>
      <Field
        label="Frame"
        help="Rotation-minimizing frames are carried along without turning about the tangent. Frenet frames follow the curvature and serve only as a diagnostic."
      >
        <select
          value={config.frame.kind}
          onChange={(e) => {
            const kind = e.target.value as FrameConfig["kind"];
            setFraming((f) => ({ ...f, kind }));
          }}
        >
          <option value="rotation-minimizing">
            Rotation-minimizing (transported)
          </option>
          <option value="frenet">Frenet (diagnostic)</option>
        </select>
      </Field>
      {transported && referenceFields}
      {angleFields}
      <div className="pair">
        {vector(
          "Half-width w",
          config.frame.width,
          (width) => setFraming((f) => ({ ...f, width })),
          "The ribbon spans −w to w along D. 0 hides it; at most 100000.",
        )}
        {vector(
          "Offset d",
          config.frame.offset,
          (offset) => setFraming((f) => ({ ...f, offset })),
          "Distance of each strand r + dD from the curve, from 0 to 100000.",
        )}
      </div>
      <Field
        label="Offset strands"
        help={`From 0 to ${maxFrameStrands} offset curves, spaced evenly around the tangent.`}
      >
        <input
          type="number"
          min="0"
          max={maxFrameStrands}
          step="1"
          value={Number.isNaN(config.frame.strands) ? "" : config.frame.strands}
          onChange={(e) => {
            const strands = e.target.valueAsNumber;
            setFraming((f) => ({ ...f, strands }));
          }}
        />
      </Field>
      {transported && closureField}
      <p className="note" data-testid="frame-note">
        {frameResult
          ? frameNote(frameResult).join(" ")
          : "Carrying the frame along the curve…"}
      </p>
    </>
  );
  const ruledShown =
    shown?.config.construction === "ruled" ? shown.result : undefined;
  const ruledControls = (
    <>
      <Field
        label="Partner"
        help="Join each point to another point of the same curve, or to a second thread b(t)."
      >
        <select
          value={config.ruled.partner}
          onChange={(e) => {
            const partner = e.target.value as RuledConfig["partner"];
            setRuling((r) => ({ ...r, partner }));
          }}
        >
          <option value="chord">The curve itself (chords)</option>
          <option value="thread">A second thread b(t)</option>
        </select>
      </Field>
      {config.ruled.partner === "thread" &&
        (["x", "y", "z"] as const).map((axis) => (
          <Field
            label={`b ${axis}(t)`}
            key={axis}
            help={
              axis === "x"
                ? "The second thread, in t only, evaluated wherever the correspondence sends it."
                : undefined
            }
          >
            <input
              value={config.ruled.thread[axis]}
              spellCheck={false}
              onChange={(e) => {
                const text = e.target.value;
                setRuling((r) => ({
                  ...r,
                  thread: { ...r.thread, [axis]: text },
                }));
              }}
            />
          </Field>
        ))}
      <div className="pair">
        {vector(
          "Shift δ",
          config.ruled.shift,
          (shift) => setRuling((r) => ({ ...r, shift })),
          "The partner of a(t) sits at parameter mt + δ, with δ within ±1000000.",
        )}
        {vector(
          "Rate m",
          config.ruled.rate,
          (rate) => setRuling((r) => ({ ...r, rate })),
          "How fast the partner's parameter runs, within ±100. On a closed curve a whole number keeps the surface closed.",
        )}
      </div>
      <p className="note" data-testid="ruled-note">
        {ruledShown?.ruled
          ? ruledNote(ruledShown).join(" ")
          : "Stringing the rulings…"}
      </p>
    </>
  );
  const canalShown =
    shown?.config.construction === "canal" ? shown.result : undefined;
  const canalControls = (
    <>
      <div className="pair">
        {vector(
          "Tube radius R",
          config.canal.radius,
          (radius) => setCanal((q) => ({ ...q, radius })),
          "Each sphere has radius R·ρ(t); R is above 0 and at most 100000.",
        )}
        <Field
          label="Meridians"
          help={`From 0 to ${maxMeridians} curves at evenly spaced angles around each contact circle.`}
        >
          <input
            type="number"
            min="0"
            max={maxMeridians}
            step="1"
            value={
              Number.isNaN(config.canal.meridians) ? "" : config.canal.meridians
            }
            onChange={(e) => {
              const meridians = e.target.valueAsNumber;
              setCanal((q) => ({ ...q, meridians }));
            }}
          />
        </Field>
      </div>
      <Field
        label="Profile ρ(t)"
        help="Scales the radius along the curve, in t only. 1 gives a tube of constant radius."
      >
        <input
          value={config.canal.profile}
          spellCheck={false}
          onChange={(e) => {
            const profile = e.target.value;
            setCanal((q) => ({ ...q, profile }));
          }}
        />
      </Field>
      <p className="note">
        The angle around each circle is carried by a rotation-minimizing frame.
        It places the meridians, not the surface.
      </p>
      {referenceFields}
      {angleFields}
      {closureField}
      <p className="note" data-testid="canal-note">
        {canalShown?.canal && canalShown.frame
          ? [
              ...canalNote(canalShown),
              ...frameNote(canalShown.frame, "meridians"),
            ].join(" ")
          : "Rolling the spheres along the curve…"}
      </p>
    </>
  );
  const poleFields = (
    <>
      <div className="pair">
        {(["x", "y"] as const).map((axis) => (
          <Field
            key={axis}
            label={`Pole ${axis}`}
            help={`Independent pole coordinate ${axis}, within ±100000. The pole is a geometric point, not a light source.`}
          >
            <ScalarInput
              name={`Pole ${axis}`}
              value={config.pole[axis]}
              onChange={(value) =>
                update((c) => ({
                  ...c,
                  pole: { ...c.pole, [axis]: value },
                }))
              }
            />
          </Field>
        ))}
      </div>
      <Field
        label="Pole z"
        help="Height of the independent pole, within ±100000. All three coordinates accept constant expressions."
      >
        <ScalarInput
          name="Pole z"
          value={config.pole.z}
          onChange={(value) =>
            update((c) => ({ ...c, pole: { ...c.pole, z: value } }))
          }
        />
      </Field>
    </>
  );
  // What the construction below is built on, when that is a derived curve.
  const builtOn = composing && (
    <p className="bottom-note composition-note">
      {config.input === "involute" ? (
        <>
          Built on the involute I(t) = r(t) + (c − s(t)) T(t) of the base curve
          r, unwound by a string of length c from its anchor, drawn in grey with
          representative strings. The involute runs along the base's principal
          normal, so the base lies in its normal planes. The construction below
          acts on it in place of r: arc length is integrated at every point,
          never measured along a polyline.
        </>
      ) : (
        <>
          Built on the{" "}
          {config.input === "orthotomic"
            ? "tangent-line orthotomic Q(t) = 2H(t) − P"
            : "tangent-foot curve H(t) = r(t) + ((P − r(t)) · T(t)) T(t)"}{" "}
          of the base curve r, drawn in grey with its perpendiculars from the
          pole P. The construction below acts on that curve in place of r: it is
          evaluated from the base at every sample, never redrawn from a
          polyline.
        </>
      )}
      {composition && composition.cusps > 0
        ? ` It stops or turns back at ${composition.cusps} ${composition.cusps === 1 ? "cusp" : "cusps"}, where the construction is broken rather than joined across.`
        : ""}
      {composition && composition.unreached > 0
        ? ` Arc length does not cross a break of the base, so ${composition.unreached} ${composition.unreached === 1 ? "sample lies" : "samples lie"} beyond the involute's reach.`
        : ""}
    </p>
  );
  const behind = leveled ? (
    <StudyExplanation
      label="BEHIND THE LEVEL SET"
      title="A surface where a field takes one value."
      formula={
        <>
          F(x, y, z) = c <span>n = ∇F / |∇F|</span>
        </>
      }
      note="Gold curves are the sections, on planes outlined in grey with the box. Teal edges are where the box cuts the surface open; rust edges and crosses mark where it stops beside cells left out, and where F changes sign across a pole or a jump."
      diagnostics={
        levelSet &&
        (levelSet.discontinuities > 0 ||
          levelSet.nonfinite > 0 ||
          levelSet.ambiguous > 0) && (
          <p className="bottom-note">
            The surface is never joined across a pole, a jump, or a point where
            F is undefined, and its topology is only as fine as its grid.
          </p>
        )
      }
    >
      <p>
        An expression F gives every point of space a number, and the points
        where it equals c form a <em>level surface</em>. It has no parameters,
        so it is found rather than traced: F is sampled on a grid, and the
        surface passes wherever F − c changes sign between neighbouring points,
        with ∇F square to it, pointing to larger F. Sweeping c sweeps a family
        of surfaces whose shape changes as c passes a critical value: two drops
        join through a saddle, a torus closes its hole. A plane cuts the surface
        in a planar level set, the kind of curve the 2D notebook draws for F(x,
        y) = c. The note counts the mesh&rsquo;s pieces and their Euler
        characteristic V − E + F: 2 for a sphere, 0 for a torus, −2 for a double
        torus.
      </p>
    </StudyExplanation>
  ) : mirroring ? (
    <StudyExplanation
      label={refracting ? "BEHIND THE INTERFACE" : "BEHIND THE MIRROR"}
      title="A geometric fold of rays."
      formula={
        refracting ? (
          <>
            T = ηI + (ηc − √k) n <span>C = X + T / μ</span>
          </>
        ) : (
          <>
            R = I − 2(I·n) n <span>C = X + R / μ</span>
          </>
        )
      }
      note={`Gold lines are ${refracting ? "transmitted" : "reflected"} rays where the parameter curves cross, grey their incident rays and, where a caustic point lies behind the ${face}, their virtual extensions${refracting ? "; beyond the critical angle, grey rays are totally reflected" : ""}. Rust marks the first caustic (μ₁), slate the second; a virtual caustic is drawn only by its lines, and a caustic that collapses by its parameter curves, or as a cross.${receiving ? " The receiver's shade is irradiance, darker (lighter in the dark theme) where more light lands." : ""}`}
      diagnostics={
        mirror &&
        (mirror.unlit > 0 ||
          mirror.singular > 0 ||
          mirror.total > 0 ||
          mirror.clipped.some((n) => n > 0)) && (
          <p className="bottom-note">
            A caustic is never joined through infinity, from real to virtual, or
            past the edge of the light.
          </p>
        )
      }
    >
      {refracting ? (
        <p>
          Light meets the interface at X travelling along I, in a medium of
          index n₁ on the side n points to, and crosses into index n₂ along T,
          bent by Snell&rsquo;s law, n₁ sin θ₁ = n₂ sin θ₂, with η = n₁/n₂, c =
          −I·n and k = 1 − η²(1 − c²). Where k &lt; 0, light leaving the denser
          side beyond the critical angle cannot cross and is totally reflected.
          Neighbouring transmitted rays cross, nearly, at the centres of
          curvature of the transmitted wavefront, which form the{" "}
          <em>caustic</em>, real ahead of the interface (μ &gt; 0) or virtual
          behind it. An ellipsoid whose eccentricity is 1/n brings a parallel
          beam to one focus; a plane seen from a lamp only images it virtually,
          smeared into two caustics. Each lit sample refracts once, and the
          transmitted light never meets the surface again.
        </p>
      ) : (
        <p>
          Light meets the mirror at X travelling along I and leaves along its
          reflection R. Neighbouring reflected rays cross, nearly, at up to two
          places along each ray: the centres of curvature of the reflected
          wavefront, where it bends by μ₁ and μ₂. Together those points form the{" "}
          <em>caustic</em>, the bright fold where reflected light gathers.
          Converging rays (μ &gt; 0) cross ahead of the mirror, in a real
          caustic; diverging rays only appear to leave a virtual caustic behind
          it. A paraboloid sends light along its axis through one focus; a
          sphere cannot, and folds it into a cusped sheet and a line on the
          axis. Each lit sample reflects once, whatever may stand in the way.
        </p>
      )}
      {receiving && (
        <p>
          The caustic is a geometric set, not a brightness. The receiver is a
          separate study of flux: each cell of the surface sends the light it
          intercepts, |I·n| dA for parallel light of unit irradiance or |I·n| dA
          / d² for a lamp of unit intensity, spread evenly over where its rays
          cross the plane. Each bin shows the mean irradiance over its square,
          with nothing absorbed, no Fresnel losses and no shadows, and the note
          accounts for every part of the light.
        </p>
      )}
    </StudyExplanation>
  ) : surfacing ? (
    <StudyExplanation
      label="BEHIND THE NORMALS"
      title="A surface revealing its centers."
      formula={
        <>
          Fᵢ = X + n / κᵢ <span>X_d = X + d n</span>
        </>
      }
      note="Grey lines are normals at the crossings of the parameter curves. Rust marks the first focal sheet (the larger curvature κ₁), slate the second; a sheet that collapses is drawn by its parameter curves, or as a cross."
      diagnostics={
        shown?.result.surface &&
        (shown.result.surface.singular > 0 ||
          shown.result.surface.focal.some((f) => f.clipped > 0)) && (
          <p className="bottom-note">
            A focal sheet is never joined through infinity, and nothing is drawn
            where the chart has no normal.
          </p>
        )
      }
    >
      <p>
        At each point of a surface the normal line stands square to it, and
        nearby normals cross it at up to two places: the centres of the two
        principal curvatures κ₁ and κ₂, the most and least the surface bends
        there. Together they form the two <em>focal sheets</em>. A
        sphere&rsquo;s normals all meet at its centre; a torus&rsquo;s meet its
        core circle and its axis, so both sheets collapse to curves. Where a
        curvature vanishes its centre runs off to infinity. The offset X + d n
        keeps the same normals, and turns inside out wherever it passes a focal
        sheet.
      </p>
    </StudyExplanation>
  ) : none ? (
    chasing ? (
      <StudyExplanation
        label="BEHIND THE CHASE"
        title="Pursuers closing in space."
        formula={
          <>
            pᵢ′ = vᵢ (pᵢ₊₁ − pᵢ) / |pᵢ₊₁ − pᵢ| <span>pᵢ(t₀) = start</span>
          </>
        }
        note="Grey polygons join the pursuers, in chase order, at evenly spaced times; crosses mark the starts and, when the chase stops early, where everyone stood."
        diagnostics={
          shown?.result.pursuit &&
          (shown.result.pursuit.capture || shown.result.pursuit.exhausted) && (
            <p className="bottom-note">
              The chase is never continued past a capture or its step budget:
              later samples are left empty, and nobody merges or changes target.
            </p>
          )
        }
      >
        <p>
          Each pursuer runs straight at the next, the last at the first, each at
          its own speed. From a regular polygon the chase keeps its shape as it
          turns and shrinks, tracing logarithmic spirals; from a regular
          tetrahedron the four spiral down a paraboloid, carried each to the
          next by a quarter turn and a reflection. Out of any plane, the paths
          twist through space. A pursuer&rsquo;s direction is undefined on its
          target, so the chase stops the moment anyone comes within the capture
          distance of their own.
        </p>
      </StudyExplanation>
    ) : flowing ? (
      <StudyExplanation
        label="BEHIND THE FLOW"
        title="Paths that follow a field."
        formula={
          <>
            r′(t) = V(r(t), t) <span>r(t₀) = seed</span>
          </>
        }
        note="Grey strokes show the field's direction, not its speed, at evenly spaced times; crosses mark the seeds and any trajectory that stops early."
        diagnostics={
          shown?.result.field?.ends.some((e) => e.reason !== "end") && (
            <p className="bottom-note">
              A trajectory that stops early is never continued: its later
              samples are left empty.
            </p>
          )
        }
      >
        <p>
          Give every point of space a velocity, and a seed dropped anywhere
          drifts along it. Its path, the <em>trajectory</em>, has the field as
          its tangent at every moment. The rising vortex turns its seeds into
          helices; Lorenz&rsquo;s and Rössler&rsquo;s equations fold them around
          unstable equilibria, where nearby seeds drift apart. Every path is
          integrated on its own, to its own error tolerance, and all are shown
          at the same times, so a reveal grows them together.
        </p>
      </StudyExplanation>
    ) : (
      <StudyExplanation
        label="THE CURVE ALONE"
        title="A curve before any construction."
        formula={<>r(t) = (x(t), y(t), z(t))</>}
        note="Choose a construction to build on the curve."
        diagnostics={
          shown &&
          shown.result.invalid > 0 && (
            <p className="bottom-note">
              {shown.result.invalid} invalid samples leave gaps in the curve.
            </p>
          )
        }
      >
        <p>
          The gold thread is the curve itself, with nothing built on it. Every
          construction in this notebook starts here.
        </p>
      </StudyExplanation>
    )
  ) : canal ? (
    <StudyExplanation
      label="BEHIND THE SPHERES"
      title="A surface that every sphere touches."
      formula={
        <>
          |X − c|² = R², (X − c) · c′ = −RR′ <span>R = R·ρ(t)</span>
        </>
      }
      note="Circles mark where representative spheres touch the surface; grey great circles mark spheres with no real circle. Meridians show how the frame carries the angle."
      diagnostics={
        shown &&
        (shown.result.invalid > 0 || shown.result.omitted > 0) && (
          <p className="bottom-note">
            {shown.result.invalid} invalid samples · {shown.result.omitted}{" "}
            intervals without a surface. The surface is never joined across a
            break in the curve or where a sphere has no real contact circle.
          </p>
        )
      }
    >
      <p>
        Roll a sphere along the curve, its centre on the curve and its radius
        R(t) changing as it goes. The surface that touches every sphere is their{" "}
        <em>envelope</em>, a canal surface. Each sphere touches it along a
        circle: the points of the sphere that the neighbouring spheres share.
        With a constant radius that circle stands square to the curve, and the
        envelope is a tube. As the radius grows it leans back along the tangent
        and shrinks; where the radius changes as fast as the centre moves, the
        circle closes to a point, and faster still the spheres nest inside one
        another with no envelope at all. Nothing is trimmed: a tube wider than
        the curve can turn folds through itself, and it is drawn that way.
      </p>
    </StudyExplanation>
  ) : ruled ? (
    <StudyExplanation
      label="BEHIND THE RULINGS"
      title="A surface strung from straight threads."
      formula={
        <>
          S(t, u) = (1 − u) a(t) + u b(mt + δ) <span>0 ≤ u ≤ 1</span>
        </>
      }
      note="Straight lines join corresponding points at representative samples. Hide the surface for a drawing of threads alone."
      diagnostics={
        shown &&
        (shown.result.invalid > 0 || shown.result.omitted > 0) && (
          <p className="bottom-note">
            {shown.result.invalid} invalid samples · {shown.result.omitted}{" "}
            intervals without a surface. The surface is never joined where
            either thread is missing, leaves its domain, or jumps.
          </p>
        )
      }
    >
      <p>
        Pair every point a(t) of the curve with a partner and join the two by a
        straight segment. The pairing is part of the definition: here the
        partner of t sits at parameter mt + δ, on the same curve for a family of
        chords or on a second thread. Sliding δ turns one thread against the
        other, and the rulings cross to weave a curved surface. Shading uses the
        true surface normal S<sub>t</sub> × S<sub>u</sub>, which turns along a
        ruling unless the surface is developable, as a cylinder or cone is.
        Nothing is trimmed: where neighbouring rulings pass through one another,
        as at the waist of the harmonic loom, the sheet crosses itself.
      </p>
    </StudyExplanation>
  ) : framed ? (
    <StudyExplanation
      label="BEHIND THE FRAME"
      title="A ribbon carried without twisting."
      formula={
        <>
          S(t, u) = r(t) + u D(t) <span>D = cos θ U + sin θ V</span>
        </>
      }
      note="At representative samples the longer arm marks U, the shorter V, and the grey arm the tangent T. Gold arms at the start of a closed loop mark the seam."
      diagnostics={
        shown &&
        (shown.result.invalid > 0 || shown.result.omitted > 0) && (
          <p className="bottom-note">
            {shown.result.invalid} invalid samples · {shown.result.omitted}{" "}
            intervals without a ribbon. A frame is never joined across a break
            in the curve or a reversal of its normal.
          </p>
        )
      }
    >
      <p>
        At each point of the curve, the tangent T leaves a whole plane of normal
        directions, and a <em>frame</em> picks two of them, U and V. A
        rotation-minimizing frame carries U along as if on a wire, turning only
        as much as the tangent forces it to. The ribbon and the offset strands
        lean in the direction D, turned by θ within that frame. Twist is a
        property of this geometry, not of the rotating view, and this ribbon is
        a framed surface, not a tangent developable. Around a closed loop the
        carried frame can come back turned: that angle belongs to the curve
        itself.
      </p>
    </StudyExplanation>
  ) : inversion ? (
    <StudyExplanation
      label="BEHIND THE SPHERE"
      title="Space turned inside out around one point."
      formula={
        <>
          J(p) = O + R² (p − O) / |p − O|² <span>|OJ| · |Op| = R²</span>
        </>
      }
      note="Each segment joins a point to its image; both lie on one ray from the center O. Three great circles mark the sphere."
      diagnostics={
        shown &&
        (shown.result.invalid > 0 ||
          (inverted?.invalid ?? 0) > 0 ||
          (inverted?.crossings ?? 0) > 0 ||
          inverted?.collapsed) && (
          <p className="bottom-note">
            {shown.result.invalid} invalid base samples ·{" "}
            {inverted?.invalid ?? 0} points without a finite image ·{" "}
            {inverted?.crossings ?? 0} passages through the center. The image
            leaves through infinity there, so it is never joined across.
            {inverted?.collapsed &&
              " The image collapses to a point, shown as a cross."}
          </p>
        )
      }
    >
      <p>
        Sphere inversion sends each point p along the ray from the center O to
        the point J whose distance from O is R² divided by that of p. The sphere
        stays fixed, its inside and outside trade places, and O itself goes to
        infinity. Here it inverts {inversionSource}: circles and lines become
        circles or lines, and a curve through O opens out into branches that run
        off to infinity.
      </p>
    </StudyExplanation>
  ) : projection ? (
    <StudyExplanation
      label="BEHIND THE PERPENDICULARS"
      title={
        orthotomic
          ? "Half a turn around every tangent."
          : "One pole, a moving perpendicular."
      }
      formula={
        <>
          {orthotomic
            ? "Q(t) = 2H(t) − P"
            : "H(t) = r(t) + ((P − r(t)) · T(t)) T(t)"}
          <span>
            {orthotomic
              ? "H is the tangent foot of P"
              : "T is the unit tangent"}
          </span>
        </>
      }
      note="The small crosses mark tangent feet H; the larger cross marks the fixed pole P."
      diagnostics={
        shown &&
        (shown.result.invalid > 0 ||
          (shown.result.projection?.invalid ?? 0) > 0 ||
          shown.result.projection?.collapsed) && (
          <p className="bottom-note">
            {shown.result.invalid} invalid base samples ·{" "}
            {shown.result.projection?.invalid ?? 0} invalid image samples.
            Undefined tangents and unresolved intervals leave gaps.
            {shown.result.projection?.collapsed &&
              " The image collapses to a point, shown as a cross."}
          </p>
        )
      }
    >
      <p>
        Drop a perpendicular from the pole P onto the tangent line at each point
        of the curve. Its foot H traces the <em>tangent-foot curve</em>. Extend
        P–H by the same distance beyond H to get the{" "}
        <em>tangent-line orthotomic</em>: a half-turn of P around the tangent.
        The segments from the base to H show that H lies on the tangent. In
        space a tangent has a whole normal plane; no particular normal direction
        is chosen.
      </p>
    </StudyExplanation>
  ) : involute ? (
    <StudyExplanation
      label="BEHIND THE FILAMENTS"
      title="A taut string, unwound in space."
      formula={
        <>
          I(t) = r(t) + (c − s(t)) T(t){" "}
          <span>s(t) = ∫ from t₀ to t of |r′|</span>
        </>
      }
      note="Each filament is traced by the free end of a string held taut along the tangent."
      diagnostics={
        shown &&
        (shown.result.invalid > 0 || unreached > 0) && (
          <p className="bottom-note">
            {shown.result.invalid} invalid samples · {unreached} regular samples
            beyond a gap from the anchor. Arc length is never carried across a
            gap, so no filament is drawn there.
          </p>
        )
      }
    >
      <p>
        Wrap a string along the curve, starting with length c at the anchor t₀,
        and unwind it while keeping it taut along the tangent. Its free end
        traces an <em>involute</em>. Where the string runs out, at s = c, the
        filament touches the curve in a cusp. Every filament crosses the tangent
        strings at right angles; changing c gives a family of them.
      </p>
    </StudyExplanation>
  ) : (
    <StudyExplanation
      label="BEHIND THE FOLDS"
      title="Straight lines, woven into space."
      formula={
        <>
          S(t, u) = r(t) + u T(t) <span>−L ≤ u ≤ L</span>
        </>
      }
      note="The curve and its tangent lines define the ribbon surface."
      diagnostics={
        shown &&
        (shown.result.omitted > 0 || shown.result.invalid > 0) && (
          <p className="bottom-note">
            {shown.result.invalid} invalid samples · {shown.result.omitted}{" "}
            intervals without a stable ribbon surface. The curve and tangents
            remain visible where defined.
          </p>
        )
      }
    >
      <p>
        At every regular point of the curve, extend a straight line in the
        tangent direction. Together those lines sweep a{" "}
        <em>tangent developable</em>. The gold thread marks the original curve;
        the two sheets meet there in a sharp fold, except where the curve
        momentarily stops twisting.
      </p>
    </StudyExplanation>
  );
  return (
    <div
      className={`app spatial-app${theme.dark ? " dark" : ""}`}
      data-theme-preference={theme.preference}
    >
      <AppHeader theme={theme}>
        <ShareLink notebook="3d" study={snapshot} disabled={!ready} />
        <AnimationButton section="spatial-animation-section" />
        <ExportImageMenu
          disabled={!ready || running || imageBusy}
          kind="spatial"
          menuId="spatial-export-image-menu"
          svgLabel="SVG · embedded 3D image"
          extraItems={[
            { format: "svg-lines", label: "Lines (SVG) · every line" },
            {
              format: "svg-visible",
              label: "Lines (SVG) · visible only, sampled",
            },
          ]}
          onSave={save}
        />
      </AppHeader>
      <main>
        <aside
          className="spatial-controls"
          aria-label="Spatial study parameters"
        >
          {linkNotice && (
            <LinkNotice text={linkNotice} onDismiss={() => setLinkNotice("")} />
          )}
          <div className="section-label">01 / THE STUDY</div>
          <NotebookMode />
          <ExampleGallery
            examples={spatialExamples}
            current={preset === "" ? null : +preset}
            onChoose={(i) => choose(String(i))}
            thumbnail={spatialThumbnail}
            dark={theme.dark}
          />
          <ScalarStatus.Provider value={scalarStatus}>
            <FieldErrorContext.Provider value={fieldError}>
              <div key={generation.current}>
                <Field label="Spatial definition">
                  <select
                    value={config.format}
                    onChange={(e) =>
                      void definition(e.target.value as SpatialConfig["format"])
                    }
                  >
                    <option value="torus">Torus knot generator</option>
                    <option value="parametric">
                      Parametric · x(t), y(t), z(t)
                    </option>
                    <option value="harmonic">
                      Harmonic sum · generating vectors
                    </option>
                    <option value="field">
                      Vector field · trajectories r′ = V
                    </option>
                    <option value="pursuit">
                      Pursuit · each chases the next
                    </option>
                    <option value="surface">Surface patch · X(u, v)</option>
                    <option value="rays">Mirror or interface · rays</option>
                    <option value="implicit">
                      Implicit surface · F(x, y, z) = c
                    </option>
                  </select>
                </Field>
                {config.format === "harmonic" ? (
                  harmonicControls
                ) : patched ? (
                  surfaceControls
                ) : leveled ? (
                  implicitControls
                ) : flowing ? (
                  fieldControls
                ) : chasing ? (
                  pursuitControls
                ) : config.format === "torus" ? (
                  <>
                    {(
                      [
                        ["radius", "Major radius R"],
                        ["tube", "Minor radius r"],
                      ] as const
                    ).map(([key, label]) => (
                      <Field
                        key={key}
                        label={label}
                        help={
                          key === "radius"
                            ? "Distance from the torus center to the tube center. From 0.1 to 20."
                            : "Tube radius, at least 0.01 and smaller than R."
                        }
                      >
                        <ScalarInput
                          name={label}
                          value={config[key]}
                          onChange={(value) =>
                            update((c) => ({ ...c, [key]: value }))
                          }
                        />
                      </Field>
                    ))}
                    <Field label="Knot winding">
                      <select
                        value={`${config.p},${config.q}`}
                        onChange={(e) => {
                          const [p, q] = e.target.value.split(",").map(Number);
                          update((c) => ({ ...c, p, q }));
                        }}
                      >
                        {[
                          [2, 3],
                          [2, 5],
                          [3, 4],
                          [3, 5],
                          [4, 5],
                          [5, 7],
                        ].map(([p, q]) => (
                          <option key={`${p},${q}`} value={`${p},${q}`}>
                            {p} around · {q} through
                          </option>
                        ))}
                      </select>
                    </Field>
                  </>
                ) : (
                  <>
                    {(["x", "y", "z"] as const).map((axis) => (
                      <Field label={`${axis}(t)`} key={axis}>
                        <input
                          value={config.curve[axis]}
                          spellCheck={false}
                          onChange={(e) =>
                            update((c) => ({
                              ...c,
                              curve: { ...c.curve, [axis]: e.target.value },
                            }))
                          }
                        />
                      </Field>
                    ))}
                    <div className="pair">
                      {(
                        [
                          ["min", "t from"],
                          ["max", "to"],
                        ] as const
                      ).map(([key, label]) => (
                        <Field label={label} key={key}>
                          <ScalarInput
                            name={label}
                            value={config.curve[key]}
                            onChange={(value) =>
                              update((c) => ({
                                ...c,
                                curve: { ...c.curve, [key]: value },
                              }))
                            }
                          />
                        </Field>
                      ))}
                    </div>
                    <Field
                      label="Shape parameter a"
                      help="Use a in any coordinate expression, then animate it with a parameter track."
                    >
                      <ScalarInput
                        name="Shape parameter a"
                        value={config.curve.a}
                        onChange={(value) =>
                          update((c) => ({
                            ...c,
                            curve: { ...c.curve, a: value },
                          }))
                        }
                      />
                    </Field>
                    <details {...expressions} className="spatial-details">
                      <summary>Expression reference</summary>
                      <p>
                        Use t, a, pi, e, phi; + − * / ^; sin, cos, tan, asin,
                        acos, atan, sinh, cosh, tanh, sech, exp, log, ln, sqrt,
                        abs. Trigonometry uses radians. Write multiplication
                        explicitly, such as 2*cos(t). Constants only in numeric
                        controls.
                      </p>
                    </details>
                  </>
                )}
                {!curveless && (
                  <>
                    <Field label="Construction">
                      <select
                        value={config.construction}
                        onChange={(e) => {
                          const construction = e.target
                            .value as SpatialConfig["construction"];
                          update((c) => ({ ...c, construction }));
                        }}
                      >
                        <option value="developable">Tangent developable</option>
                        <option value="involute">
                          Involute · unwinding strings
                        </option>
                        <option value="tangent-foot">
                          Tangent-foot projection
                        </option>
                        <option value="orthotomic">
                          Tangent-line orthotomic
                        </option>
                        <option value="inversion">Sphere inversion</option>
                        <option value="framed">
                          Framed ribbon · offset strands
                        </option>
                        <option value="ruled">
                          Ruled surface · chords & threads
                        </option>
                        <option value="canal">Tube · canal surface</option>
                        <option value="none">None · the curve alone</option>
                      </select>
                    </Field>
                    {takesInput(config) && (
                      <>
                        <Field
                          label="Built on"
                          help="Build the construction on the base curve, on its tangent-foot curve or tangent-line orthotomic from the pole, or on one of its involutes. The derived curve is evaluated from the base at every sample, and the construction stops wherever it has a cusp."
                        >
                          <select
                            value={config.input}
                            onChange={(e) =>
                              chooseInput(
                                e.target.value as SpatialConfig["input"],
                              )
                            }
                          >
                            <option value="base">The base curve</option>
                            <option value="tangent-foot">
                              Its tangent-foot curve
                            </option>
                            <option value="orthotomic">
                              Its tangent-line orthotomic
                            </option>
                            <option value="involute">Its involute</option>
                          </select>
                        </Field>
                        {projectsInput(config) && poleFields}
                        {composing && config.input === "involute" && (
                          <div className="pair">
                            <Field
                              label="Input anchor t₀"
                              help="Where the input's arc length s starts, as a parameter value inside the domain, on a regular stretch of the base."
                            >
                              <ScalarInput
                                name="Input anchor t₀"
                                value={unwinding.anchor}
                                onChange={(value) =>
                                  update((c) => ({
                                    ...c,
                                    unwinding: {
                                      ...c.unwinding,
                                      anchor: value,
                                    },
                                  }))
                                }
                              />
                            </Field>
                            <Field
                              label="Input string c"
                              help="Signed string length at the input's anchor, within ±100000. The involute has a cusp where s = c, and stops wherever the base is straight."
                            >
                              <ScalarInput
                                name="Input string c"
                                value={unwinding.offset}
                                onChange={(value) =>
                                  update((c) => ({
                                    ...c,
                                    unwinding: {
                                      ...c.unwinding,
                                      offset: value,
                                    },
                                  }))
                                }
                              />
                            </Field>
                          </div>
                        )}
                      </>
                    )}
                    {canal ? (
                      canalControls
                    ) : ruled ? (
                      ruledControls
                    ) : framed ? (
                      frameControls
                    ) : inversion ? (
                      <>
                        <Field
                          label="Curve to invert"
                          help="Invert the base curve, or one of its tangent projections from the pole."
                        >
                          <select
                            value={config.inversion.input}
                            onChange={(e) => {
                              const input = e.target
                                .value as SpatialConfig["inversion"]["input"];
                              update((c) => ({
                                ...c,
                                inversion: { ...c.inversion, input },
                              }));
                            }}
                          >
                            <option value="base">Base curve</option>
                            <option value="tangent-foot">
                              Tangent-foot projection
                            </option>
                            <option value="orthotomic">
                              Tangent-line orthotomic
                            </option>
                          </select>
                        </Field>
                        <div className="pair">
                          {(["x", "y"] as const).map((axis) => (
                            <Field
                              key={axis}
                              label={`Center ${axis}`}
                              help={`Inversion center coordinate ${axis}, within ±100000. The center itself has no image.`}
                            >
                              <ScalarInput
                                name={`Center ${axis}`}
                                value={config.inversion.center[axis]}
                                onChange={(value) =>
                                  update((c) => ({
                                    ...c,
                                    inversion: {
                                      ...c.inversion,
                                      center: {
                                        ...c.inversion.center,
                                        [axis]: value,
                                      },
                                    },
                                  }))
                                }
                              />
                            </Field>
                          ))}
                        </div>
                        <div className="pair">
                          <Field
                            label="Center z"
                            help="Height of the inversion center, within ±100000."
                          >
                            <ScalarInput
                              name="Center z"
                              value={config.inversion.center.z}
                              onChange={(value) =>
                                update((c) => ({
                                  ...c,
                                  inversion: {
                                    ...c.inversion,
                                    center: { ...c.inversion.center, z: value },
                                  },
                                }))
                              }
                            />
                          </Field>
                          <Field
                            label="Sphere radius R"
                            help="Radius of the inversion sphere, greater than 0 and at most 100000. Points on it stay fixed."
                          >
                            <ScalarInput
                              name="Sphere radius R"
                              value={config.inversion.radius}
                              onChange={(value) =>
                                update((c) => ({
                                  ...c,
                                  inversion: { ...c.inversion, radius: value },
                                }))
                              }
                            />
                          </Field>
                        </div>
                        {config.inversion.input !== "base" && poleFields}
                      </>
                    ) : projection ? (
                      poleFields
                    ) : involute ? (
                      <>
                        <Field
                          label="Anchor t₀"
                          help="Where arc length s starts, as a parameter value inside the domain. The string there has length c."
                        >
                          <ScalarInput
                            name="Anchor t₀"
                            value={config.involute.anchor}
                            onChange={(value) =>
                              update((c) => ({
                                ...c,
                                involute: { ...c.involute, anchor: value },
                              }))
                            }
                          />
                        </Field>
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={config.involute.family.enabled}
                            onChange={(e) => {
                              const enabled = e.target.checked;
                              update((c) => ({
                                ...c,
                                involute: {
                                  ...c.involute,
                                  family: { ...c.involute.family, enabled },
                                },
                              }));
                            }}
                          />
                          Family of involutes
                        </label>
                        {config.involute.family.enabled ? (
                          <>
                            <div className="pair">
                              {(
                                [
                                  ["from", "c from"],
                                  ["to", "c to"],
                                ] as const
                              ).map(([key, label]) => (
                                <Field
                                  label={label}
                                  key={key}
                                  help={
                                    key === "from"
                                      ? "String length of the first filament, within ±100000."
                                      : "String length of the last; members are evenly spaced."
                                  }
                                >
                                  <ScalarInput
                                    name={label}
                                    value={config.involute.family[key]}
                                    onChange={(value) =>
                                      update((c) => ({
                                        ...c,
                                        involute: {
                                          ...c.involute,
                                          family: {
                                            ...c.involute.family,
                                            [key]: value,
                                          },
                                        },
                                      }))
                                    }
                                  />
                                </Field>
                              ))}
                            </div>
                            <Field
                              label="Involutes"
                              help="From 2 to 24 filaments, and at most 48,000 points in all (involutes × samples)."
                            >
                              <input
                                type="number"
                                min="2"
                                max="24"
                                step="1"
                                value={
                                  Number.isNaN(config.involute.family.count)
                                    ? ""
                                    : config.involute.family.count
                                }
                                onChange={(e) => {
                                  const count = e.target.valueAsNumber;
                                  update((c) => ({
                                    ...c,
                                    involute: {
                                      ...c.involute,
                                      family: { ...c.involute.family, count },
                                    },
                                  }));
                                }}
                              />
                            </Field>
                          </>
                        ) : (
                          <Field
                            label="String length c"
                            help="Signed length of the string at the anchor, within ±100000. The filament touches the curve where s = c."
                          >
                            <ScalarInput
                              name="String length c"
                              value={config.involute.offset}
                              onChange={(value) =>
                                update((c) => ({
                                  ...c,
                                  involute: { ...c.involute, offset: value },
                                }))
                              }
                            />
                          </Field>
                        )}
                      </>
                    ) : none ? null : (
                      <Field
                        label="Tangent reach L"
                        help="Half-length of each straight tangent segment, in world units. Greater than 0 and at most 20."
                      >
                        <ScalarInput
                          name="Tangent reach L"
                          value={config.length}
                          onChange={(value) =>
                            update((c) => ({ ...c, length: value }))
                          }
                        />
                      </Field>
                    )}
                  </>
                )}
              </div>
            </FieldErrorContext.Provider>
          </ScalarStatus.Provider>
          <p className="spatial-caption">
            Constant expressions welcome: pi, e, phi.
          </p>
          {/* The curve alone, unless a field or harmonic, has no layers. */}
          {(curveless ||
            !(
              none &&
              !flowing &&
              !chasing &&
              config.format !== "harmonic"
            )) && (
            <fieldset className="spatial-layers">
              <legend>Reveal the construction</legend>
              {(leveled
                ? ([
                    ["surface", "Level surface"],
                    ["sections", "Section curves"],
                    ["planes", "Section planes"],
                    ["box", "Box, cuts & open edges"],
                  ] as const)
                : mirroring
                  ? ([
                      ["surface", refracting ? "Interface" : "Mirror"],
                      ["curves", "Parameter curves"],
                      [
                        "incident",
                        config.rays.light === "point"
                          ? "Incident rays & source"
                          : "Incident rays",
                      ],
                      [
                        "reflected",
                        refracting ? "Transmitted rays" : "Reflected rays",
                      ],
                      ["focal1", "Caustic 1 · μ₁"],
                      ["focal2", "Caustic 2 · μ₂"],
                      ["virtual", "Virtual rays & caustics"],
                      ...(receiving
                        ? ([["receiver", "Receiver irradiance"]] as const)
                        : []),
                    ] as const)
                  : surfacing
                    ? ([
                        ["surface", "Surface patch"],
                        ["curves", "Parameter curves"],
                        ["normals", "Normal lines"],
                        ["offset", "Offset surface"],
                        ["focal1", "Focal sheet 1 · κ₁"],
                        ["focal2", "Focal sheet 2 · κ₂"],
                      ] as const)
                    : [
                        ...(none
                          ? []
                          : canal
                            ? ([
                                ["surface", "Canal surface"],
                                ["circles", "Contact circles"],
                                ["meridians", "Meridians"],
                                ["frames", "Frames"],
                                ...(canalShown?.frame?.closed
                                  ? ([["seam", "Seam"]] as const)
                                  : []),
                              ] as const)
                            : ruled
                              ? ([
                                  ["surface", "Ruled surface"],
                                  ["rulings", "Rulings"],
                                  ["edges", "Partner thread"],
                                ] as const)
                              : framed
                                ? ([
                                    ["surface", "Ribbon surface"],
                                    ["rulings", "Cross-lines"],
                                    ["edges", "Ribbon edges"],
                                    ["strands", "Strands"],
                                    ["frames", "Frames"],
                                    ...(frameResult?.closed
                                      ? ([["seam", "Seam"]] as const)
                                      : []),
                                  ] as const)
                                : inversion
                                  ? ([
                                      ["inverse", "Inverted curve"],
                                      [
                                        "correspondences",
                                        "Correspondence segments",
                                      ],
                                      ["sphere", "Inversion sphere & center"],
                                      ...(config.inversion.input === "base"
                                        ? []
                                        : ([
                                            ["source", "Projection & pole"],
                                          ] as const)),
                                    ] as const)
                                  : projection
                                    ? ([
                                        ["projection", projectionName],
                                        [
                                          "connectors",
                                          "Perpendiculars & tangent feet",
                                        ],
                                        ["pole", "Pole marker"],
                                      ] as const)
                                    : involute
                                      ? ([
                                          ["filaments", "Involute filaments"],
                                          ["strings", "Unwinding strings"],
                                        ] as const)
                                      : ([
                                          ["surface", "Ribbon surface"],
                                          ["rulings", "Tangent rulings"],
                                          ["edges", "Ribbon edges"],
                                        ] as const)),
                        ...(composing && config.input === "involute"
                          ? ([
                              ["parent", "Base curve"],
                              ["connectors", "Strings from the base"],
                            ] as const)
                          : composing
                            ? ([
                                ["parent", "Base curve"],
                                ["connectors", "Perpendiculars & tangent feet"],
                                ["pole", "Pole marker"],
                              ] as const)
                            : []),
                        ...(config.format === "harmonic"
                          ? ([
                              ["vectors", "Vector sums"],
                              ["ellipses", "Generating ellipses"],
                            ] as const)
                          : []),
                        ...(flowing
                          ? ([
                              ["trajectories", "Other trajectories"],
                              ["arrows", "Field directions"],
                              ["seeds", "Seeds & early stops"],
                            ] as const)
                          : []),
                        ...(chasing
                          ? ([
                              ["trajectories", "Other pursuers"],
                              ["polygons", "Connecting polygons"],
                              ["seeds", "Starts & capture"],
                            ] as const)
                          : []),
                      ]
              ).map(([key, label]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={layers[key]}
                    onChange={(e) =>
                      setLayers((s) => ({ ...s, [key]: e.target.checked }))
                    }
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          )}
          <ScalarStatus.Provider value={scalarStatus}>
            <FieldErrorContext.Provider value={panelError}>
              <CutPanel
                cut={cut}
                onCut={setCut}
                error={userCut.error}
                onFace={faceView}
                onCenter={centerCut}
                onFlip={flipCut}
                peeling={animation?.cut !== undefined}
              />
              <SightPanel
                sight={sight}
                onSight={setSight}
                error={userSight.error}
                unavailable={!seeThrough}
                unstroked={!stroking}
              />
            </FieldErrorContext.Provider>
          </ScalarStatus.Provider>
          <ProbePanel
            config={config}
            frame={probeFrame}
            probe={probe}
            onProbe={setProbe}
            animating={!!animation && !moving}
            at={moving?.probe}
            away={moving ? undefined : animation?.probeAway}
            dark={theme.dark}
          />
          <FieldErrorContext.Provider value={fieldError}>
            <details className="spatial-details">
              <summary>Sampling & definition</summary>
              {leveled ? (
                <>
                  <div className="pair">
                    <Field
                      label="Cells"
                      help={`${minImplicitCells}–${maxImplicitCells} cells along the box's longest side, as many along the others as keeps them nearest to cubes, and at most ${maxImplicitGrid.toLocaleString()} in all.`}
                    >
                      <input
                        type="number"
                        min={minImplicitCells}
                        max={maxImplicitCells}
                        step="1"
                        value={
                          Number.isNaN(config.implicit.cells)
                            ? ""
                            : config.implicit.cells
                        }
                        onChange={(e) => {
                          const cells = e.target.valueAsNumber;
                          setImplicit((q) => ({ ...q, cells }));
                        }}
                      />
                    </Field>
                    <Field
                      label="Refinement levels"
                      help={`0–${maxImplicitRefine} octree levels; 0 meshes the grid alone. Where an edge of the grid's tetrahedra has both ends on one side of the level and its midpoint on the other, every tetrahedron around it is halved, and the halves are tested in turn, each level halving the cell, up to ${maxRefinedTetrahedra.toLocaleString()} tetrahedra.`}
                    >
                      <input
                        type="number"
                        min={0}
                        max={maxImplicitRefine}
                        step="1"
                        value={
                          Number.isNaN(config.implicit.refine)
                            ? ""
                            : config.implicit.refine
                        }
                        onChange={(e) => {
                          const refine = e.target.valueAsNumber;
                          setImplicit((q) => ({ ...q, refine }));
                        }}
                      />
                    </Field>
                  </div>
                  <SamplingNote>
                    F is evaluated at every grid point, and every cube is split
                    into six tetrahedra around its diagonal, the same way in
                    every cube, so neighbours agree on their shared faces.
                    Within a tetrahedron the surface is one triangle or two,
                    with no ambiguous case; a grid face whose corners alternate
                    is counted, since there the split, not F, decides whether
                    the surface joins. Each vertex is found on F itself, by
                    false position with bisection, to 10⁻¹² of its edge, and a
                    sign change whose value does not shrink with its bracket is
                    a pole or a jump, never meshed. Cubes touching a point where
                    F is not finite are left out. Normals are ∇F by five-point
                    differences, not the mesh&rsquo;s. Sections are traced as
                    the 2D notebook traces implicit curves, on their own grid of
                    four times the box&rsquo;s cells, at most 256, and refined
                    to a thousandth of a cell. The mesh is limited to 200,000
                    triangles and 400,000 grid edges searched; the sections
                    share 65,536 bisected edges and 131,072 points. Refinement
                    samples F at the midpoint of every edge of the tetrahedra,
                    and halves those around an edge whose midpoint lies across
                    the level from both its ends: a neck, gap or thread thinner
                    than a cell, or a face whose diagonal joins what its centre
                    separates. Tetrahedra are halved by newest-vertex bisection,
                    together with every one on the same edge, so the mesh never
                    cracks where sizes meet. Refinement only follows what its
                    samples see: a piece that falls between all of them is still
                    missed.
                  </SamplingNote>
                </>
              ) : patched ? (
                <>
                  <div className="pair">
                    {(
                      [
                        ["uSamples", "u samples"],
                        ["vSamples", "v samples"],
                      ] as const
                    ).map(([key, label]) => (
                      <Field
                        key={key}
                        label={label}
                        help={
                          key === "uSamples"
                            ? `12–240 cells each way, and at most ${maxSurfaceCells.toLocaleString()} in all.`
                            : undefined
                        }
                      >
                        <input
                          type="number"
                          min="12"
                          max="240"
                          step="1"
                          value={
                            Number.isNaN(config.surface[key])
                              ? ""
                              : config.surface[key]
                          }
                          onChange={(e) => {
                            const value = e.target.valueAsNumber;
                            setSurface((s) => ({ ...s, [key]: value }));
                          }}
                        />
                      </Field>
                    ))}
                  </div>
                  <Field
                    label="Parameter curves"
                    help={
                      mirroring
                        ? `2–${maxSurfaceCurves} curves each way, drawn on the ${face} and its caustics; rays stand where they cross.`
                        : `2–${maxSurfaceCurves} curves each way, drawn on the surface and its focal sheets; normal lines stand where they cross.`
                    }
                  >
                    <input
                      type="number"
                      min="2"
                      max={maxSurfaceCurves}
                      step="1"
                      value={
                        Number.isNaN(config.surface.curves)
                          ? ""
                          : config.surface.curves
                      }
                      onChange={(e) => {
                        const curves = e.target.valueAsNumber;
                        setSurface((s) => ({ ...s, curves }));
                      }}
                    />
                  </Field>
                  {mirroring ? (
                    <SamplingNote>
                      Positions, normals and their derivatives come from each
                      patch&rsquo;s exact first and second derivatives at every
                      grid sample, and so do the outgoing rays&rsquo; directions
                      and derivatives. Caustic points are the centres of
                      curvature of the outgoing wavefront, from its shape
                      operator across each ray. A caustic edge is joined only
                      when its curvature keeps its sign and the caustic point
                      halfway along it is lit, finite, and between its ends, so
                      a caustic is never joined through infinity, past the edge
                      of the light, or across its own cusps. Caustic points
                      beyond 100 surface radii are treated as at infinity. A
                      receiver takes each cell&rsquo;s flux from its midpoint,
                      spreads it evenly over the two triangles its
                      corners&rsquo; rays make on the plane, and gives every bin
                      the flux inside it, by exact area.
                    </SamplingNote>
                  ) : (
                    <SamplingNote>
                      Positions, normals and principal curvatures come from each
                      patch&rsquo;s exact first and second derivatives at every
                      grid sample. Where X_u × X_v vanishes the chart is
                      singular and has no normal. A focal edge is joined only
                      when its curvature keeps its sign and the focal point
                      halfway along it is finite and lies between its ends, so a
                      sheet is never joined through infinity, even between
                      samples. Centres of curvature beyond 100 surface radii are
                      treated as at infinity.
                    </SamplingNote>
                  )}
                </>
              ) : (
                <>
                  <Field label="Curve samples">
                    <input
                      type="number"
                      min="240"
                      max="2400"
                      step="1"
                      value={Number.isNaN(config.samples) ? "" : config.samples}
                      onChange={(e) =>
                        update((c) => ({
                          ...c,
                          samples: e.target.valueAsNumber,
                        }))
                      }
                    />
                  </Field>
                  <Field
                    label={
                      none
                        ? flowing
                          ? "Field arrows"
                          : chasing
                            ? "Connecting polygons"
                            : "Representative samples"
                        : canal
                          ? "Contact circles"
                          : ruled
                            ? "Rulings"
                            : framed
                              ? "Frames & cross-lines"
                              : inversion
                                ? "Correspondences"
                                : projection
                                  ? "Projection constructions"
                                  : involute
                                    ? "Unwinding strings"
                                    : "Tangent lines"
                    }
                  >
                    <input
                      type="number"
                      min="12"
                      max="240"
                      step="1"
                      value={Number.isNaN(config.lines) ? "" : config.lines}
                      onChange={(e) =>
                        update((c) => ({ ...c, lines: e.target.valueAsNumber }))
                      }
                    />
                  </Field>
                  {refinable && (
                    <>
                      <RefineBetweenSamples
                        checked={config.adaptive}
                        onChange={(adaptive) =>
                          update((c) => ({ ...c, adaptive }))
                        }
                        refined={
                          shown?.result.adaptive &&
                          Object.values(shown.result.adaptive).flat()
                        }
                      />
                    </>
                  )}
                  <SamplingNote>
                    Finite sampling can miss fine detail. Compare resolutions
                    near poles, stationary points, and tight folds.
                    {refinable && (
                      <>
                        {" "}
                        Refining between samples halves a sample interval, at
                        most 10 times, wherever the chord drawn across it strays
                        from the curve by more than 1/5000 of the radius fitted
                        to that curve&rsquo;s samples, judged at three points
                        along it, and stops after 16,384 added points per curve.
                        It refines the curve, a projection, an inverted curve,
                        each involute, each offset strand and the base under a
                        derived input; the ribbon, partner threads, contact
                        circles and every surface stay on the evenly spaced
                        samples. Between samples an involute&rsquo;s arc length
                        carries on from the sample before it by the same Simpson
                        step, and a strand&rsquo;s frame by the same two
                        reflections. A gap or jump it finds between samples
                        breaks the curve and any surface there; a passage of the
                        inverted curve through the center is found the same way.
                        A feature narrower than its three points can still be
                        missed.
                      </>
                    )}{" "}
                    Invalid samples and unresolved tangent or normal intervals
                    leave gaps. Involute arc length uses Simpson's rule on each
                    sample interval, as does the arc length that spreads a
                    frame's twist. A transported frame is carried between
                    samples by two reflections. A harmonic curve's vector sums
                    sit at the same evenly spaced samples as the construction
                    lines, and its derivatives are exact. A ruled surface's
                    partner is evaluated at mt + δ for the same samples, and a
                    second thread is differentiated like a custom curve. A canal
                    surface's profile ρ(t) is differentiated the same way,
                    checked at each interval's midpoint, and drawn on at most
                    480 contact circles, always including those beside a gap. A
                    vector field&rsquo;s trajectories are integrated with
                    adaptive Dormand&ndash;Prince steps, each to its own error
                    tolerance and within 50,000 steps, and sampled at the same
                    evenly spaced times; the first one&rsquo;s velocity is the
                    field itself. A chase is integrated the same way, as one
                    system, within 40,000 steps, and the first pursuer&rsquo;s
                    velocity and acceleration come from the pursuit law itself.
                  </SamplingNote>
                </>
              )}
            </details>
          </FieldErrorContext.Provider>
          {failure && !claimedHere && <StudyError message={failure} />}
          <p className="spatial-status" role="status">
            {busy
              ? "Growing the spatial study…"
              : failure
                ? "Resolve the input to update the study."
                : leveled
                  ? `${implicitGrid(config.implicit.box, config.implicit.cells).join(" × ")} cells · ${config.implicit.sections.count} section ${config.implicit.sections.count === 1 ? "plane" : "planes"}${config.implicit.refine > 0 ? ` · up to ${config.implicit.refine} refinement ${config.implicit.refine === 1 ? "level" : "levels"}` : ""}`
                  : patched
                    ? `${config.surface.uSamples} × ${config.surface.vSamples} cells · ${config.surface.curves} parameter curves`
                    : `${config.samples.toLocaleString()} samples · ${config.lines} ${none ? (flowing ? "arrows" : chasing ? "polygons" : "lines") : canal ? "circles" : ruled ? "rulings" : framed ? "frames" : inversion ? "correspondences" : projection ? "projections" : involute ? "strings" : "tangents"}`}
          </p>
          <SpatialAnimationPanel
            frame={frame}
            client={client}
            length={config.length}
            revision={revision}
            disabled={!ready || !active || imageBusy}
            probe={probing ? probe : null}
            cut={userCut.spec}
            sight={userSight.spec}
            dark={theme.dark}
            layers={layers}
            getCurrentView={() =>
              viewport.current ? structuredClone(viewport.current) : undefined
            }
            onView={setAnimation}
            onRunning={setRunning}
            onPlay={showPlot}
            settings={animationSettings}
            restore={busy ? null : restoredAnimation}
            flight={busy ? null : presetFlight}
            onShowView={(view) => {
              setRestoredView({ reset: reset + 1, view });
              setReset(reset + 1);
            }}
          />
        </aside>
        <article
          className="spatial-stage"
          aria-label="Spatial artwork"
          aria-busy={busy}
          data-config={shown ? JSON.stringify(shown.config) : undefined}
          // The entered cut while it is on, as a preset's fingerprint
          // includes it (see examples/index.ts).
          data-cut={cut.enabled ? JSON.stringify(cut) : undefined}
          // The entered sight when it is not the default, likewise.
          data-sight={
            isPlain(sight) && sight.weight === defaultSight.weight
              ? undefined
              : JSON.stringify(sight)
          }
          // The projection when perspective, and the chosen preset's opening
          // view, likewise.
          data-projection={lensing === "orthographic" ? undefined : lensing}
          // The chosen preset's probe, likewise.
          data-probe={
            preset !== "" && spatialPresets[+preset].probe
              ? JSON.stringify(spatialPresets[+preset].probe)
              : undefined
          }
          data-opening={
            preset !== "" && spatialPresets[+preset].view
              ? JSON.stringify(spatialPresets[+preset].view)
              : undefined
          }
          data-progress={animation?.progress}
          data-time={animation?.time}
          data-mode={animation?.mode}
          data-camera={camera ? JSON.stringify(camera) : undefined}
        >
          <div className="plot-heading">
            <div>
              <div className="eyebrow">
                {preset !== ""
                  ? spatialPresets[+preset].detail
                  : "YOUR OWN EXPLORATION"}
              </div>
              <h1>
                {leveled
                  ? "A level surface and its sections"
                  : refracting
                    ? "An interface and its caustics"
                    : mirroring
                      ? "A mirror and its caustics"
                      : surfacing
                        ? "A surface and its centers of curvature"
                        : none
                          ? flowing
                            ? "Paths that follow a field"
                            : chasing
                              ? "Pursuers closing in space"
                              : "A curve in space"
                          : canal
                            ? "A surface enveloping spheres"
                            : ruled
                              ? "A surface of straight threads"
                              : framed
                                ? "A ribbon carried by a frame"
                                : inversion
                                  ? "A curve inverted in a sphere"
                                  : projection
                                    ? projectionName
                                    : involute
                                      ? "Filaments unwound from a curve"
                                      : "A ribbon of tangent lines"}
              </h1>
            </div>
            <div className="view-buttons lensed">
              <select
                className="fit projection"
                aria-label="Projection"
                value={lensing}
                disabled={!!override || running}
                onChange={(e) => setLensing(e.target.value as Projection)}
              >
                {(Object.keys(projections) as Projection[]).map((p) => (
                  <option key={p} value={p}>
                    {projections[p].label}
                  </option>
                ))}
              </select>
              <button
                className="fit"
                disabled={!!override || running || !!renderError}
                aria-pressed={spinning}
                onClick={() => setSpinning((s) => !s)}
              >
                {spinning ? "Pause rotation" : "Rotate view"}
              </button>
              <button
                className="fit"
                disabled={!!override || running}
                onClick={() =>
                  released ? setRefit((n) => n + 1) : setReset((n) => n + 1)
                }
              >
                Reset view
              </button>
            </div>
          </div>
          <div className="plot-wrap" ref={plotWrap}>
            <div className="spatial-canvas-wrap">
              {shown ? (
                <SpatialPlot
                  result={shown.result}
                  dark={theme.dark}
                  layers={layers}
                  reset={reset}
                  spinning={spinning && active}
                  override={override}
                  released={released}
                  refit={refit}
                  onViewport={(v) => {
                    viewport.current = v;
                    feedOrientation(orientation.current, viewBasis(v));
                  }}
                  onError={setRenderError}
                  restored={restoredView}
                  onCamera={(c) => {
                    manualCamera.current = c;
                  }}
                  probe={probeDrawing}
                  cut={drawnCut}
                  sight={userSight.spec}
                  onSeeThrough={setSeeThrough}
                  onStrokes={setStroking}
                  projection={lensing}
                  turn={turn}
                />
              ) : (
                <div className="loading">
                  {failure
                    ? "Check the study definition to begin."
                    : "Preparing the spatial engine…"}
                </div>
              )}
              {frame && failure && (
                <span className="stale-study">Previous valid study</span>
              )}
            </div>
            <div className="plot-meta">
              {leveled ? (
                <div className="legend">
                  <span className="surface-dot" /> Level surface{" "}
                  <span className="thread-dot" /> Section curves
                  {cutLegend}
                </div>
              ) : mirroring ? (
                <div className="legend">
                  <span className="surface-dot" />{" "}
                  {refracting ? "Interface" : "Mirror"}{" "}
                  <span className="thread-dot" />{" "}
                  {refracting ? "Transmitted rays" : "Reflected rays"}{" "}
                  <span className="focal-dot" /> Caustic 1{" "}
                  <span className="focal-dot second" /> Caustic 2{cutLegend}
                </div>
              ) : surfacing ? (
                <div className="legend">
                  <span className="surface-dot" /> Surface{" "}
                  <span className="focal-dot" /> Focal sheet 1{" "}
                  <span className="focal-dot second" /> Focal sheet 2{cutLegend}
                </div>
              ) : (
                <div className="legend">
                  <span className="thread-dot" />{" "}
                  {composing
                    ? inputName
                    : flowing
                      ? "Trajectory 1"
                      : chasing
                        ? "Pursuer 1"
                        : "Base curve"}{" "}
                  {!(none && !flowing && !chasing) && (
                    <span className="ribbon-dot" />
                  )}{" "}
                  {none
                    ? flowing
                      ? "Other trajectories"
                      : chasing
                        ? "Other pursuers"
                        : ""
                    : canal
                      ? "Canal surface"
                      : ruled
                        ? "Ruled surface"
                        : framed
                          ? "Framed ribbon"
                          : inversion
                            ? "Inverted curve"
                            : projection
                              ? projectionName
                              : involute
                                ? "Involute filaments"
                                : "Tangent developable"}
                  {composing && (
                    <>
                      {" "}
                      <span className="parent-dot" /> Base curve
                    </>
                  )}
                  {cutLegend}
                </div>
              )}
              <span>
                {released?.lens
                  ? `Perspective from the ray · drag, pan or zoom to return to the ${lensing === "orthographic" ? "orthographic" : "held"} view · Home to the ray · Back to study restores your view`
                  : released
                    ? "Drag to orbit · shift-drag or two fingers to pan · scroll or pinch to zoom · Back to study restores your view"
                    : camera?.lens
                      ? "Perspective · riding a ray · Stop restores manual framing"
                      : animation
                        ? "Animation camera · Stop restores manual framing"
                        : "Drag to orbit · shift-drag or two fingers to pan · scroll or pinch to zoom · keys: arrows, + / −, Home"}
              </span>
            </div>
          </div>
          {shown && (
            <LiveOrientation
              feed={orientation.current}
              dark={theme.dark}
              disabled={!!override || running}
              onTurn={(to) => {
                setSpinning(false);
                setTurn((t) => ({ id: (t?.id ?? 0) + 1, to }));
              }}
            />
          )}
          {!narrow && builtOn}
          {!narrow && behind}
        </article>
        {narrow && (
          <div className="behind spatial-explanation">
            {builtOn}
            {behind}
          </div>
        )}
      </main>
    </div>
  );
}
