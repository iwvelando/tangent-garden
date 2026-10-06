import { StudyExplanation } from "./StudyExplanation";
import {
  NotebookContext,
  NotebookMode,
  type FocusRequest,
} from "./NotebookMode";
import { AnimationButton } from "./AnimationButton";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { presets } from "./presets";
import { ExampleGallery } from "./ExampleGallery";
import { planarExamples, planarThumbnail } from "./examples";
import { Plot, legendGeometry, type Layers } from "./Plot";
import { LegendEntries } from "./Legend";
import { LineWeightField } from "./LineWeightField";
import { RefineBetweenSamples } from "./RefineBetweenSamples";
import { PlanarProbePanel } from "./PlanarProbePanel";
import {
  defaultProbe,
  probeSample,
  probeSupported,
  type PlanarProbe,
} from "./planar-probe";
import { refineBudget, refineDepth } from "./refinement";
import type { LineWeight } from "./line-weight";
import {
  isHarmonic,
  maxTerms,
  maxPursuers,
  maxSeeds,
  ownsShape,
  usesPole,
  inputAllowed,
  studyName,
  type Bounds,
  type Config,
  type Frame,
  type ConstructionInput,
  type Kind,
  type PoleKind,
  type AttractorMap,
  type Roll,
  type Vec,
  refinesBetweenSamples,
} from "./types";
import { EngineClient, EngineError, boundText } from "./engine-client";
import { fieldLabel } from "./planar-fields";
import { useTheme } from "./useTheme";
import { AnimationPanel } from "./AnimationPanel";
import { AppHeader } from "./AppHeader";
import { revealDrawing } from "./revealDrawing";
import { ExportImageMenu } from "./ExportImageMenu";
import { LinkNotice, ShareLink } from "./ShareLink";
import {
  LinkError,
  linkToken,
  readStudyLink,
  type SharedStudy,
} from "./study-link";
import {
  defaultAnimation,
  planarStudy,
  type PlanarAnimation,
  type PlanarStudy,
  type PlotCamera,
} from "./planar-link";
import {
  Field,
  FieldErrorContext,
  StudyError,
  type FieldErrorTarget,
} from "./Field";
import { ScalarInput, ScalarStatus, type ScalarState } from "./ScalarInput";
import { closureKey, closureNote, nextTerm, periodText } from "./harmonic";
import { captureNote, nextPursuer, regularPolygon } from "./pursuit";
import { endNote, nextSeed } from "./flow";
import { contourNote } from "./contour";
import { attractorNote, mapDefaults, mapFormulas, mapNames } from "./attractor";
import { pursuerLabels, seedLabels, termLabels } from "./animation";
import { useDisclosure } from "./useDisclosure";
import { useMediaQuery } from "./useMediaQuery";
import type { AnimationView, Viewport } from "./animation";
import "./style.css";

const descriptions: Record<
  Kind,
  { title: string; description: string; formula: string }
> = {
  evolute: {
    title: "The envelope of normals",
    description:
      "Each normal meets its neighbors at a center of curvature. Together, those centers trace the evolute.",
    formula: "E(t) = r(t) + |r′(t)|² J r′(t) / det(r′(t), r″(t))",
  },
  involute: {
    title: "A curve, unwound",
    description:
      "Imagine unwinding a taut string from a curve. Its free end draws the involute; each line is a length of that string.",
    formula: "I(t) = r(t) − (s(t) + c) T(t)",
  },
  catacaustic: {
    title: "The envelope of reflected light",
    description:
      "A family of reflected rays gathers into a curve. Dashed extensions reveal the places where rays appear to meet behind the surface.",
    formula: "C(t) = r(t) − det(d, r′) / det(d, d′) · d",
  },
  diacaustic: {
    title: "The envelope of refracted light",
    description:
      "Light bends as it crosses a curve between two media. The envelope of transmitted rays is the diacaustic.",
    formula: "n₁ sin θ₁ = n₂ sin θ₂",
  },
  pedal: {
    title: "The feet of the tangents",
    description:
      "Drop a perpendicular from a fixed point, the pole, onto each tangent line. The feet of those perpendiculars trace the pedal curve. The two segments meet at a right angle.",
    formula: "H(t) = r(t) + ((P − r(t)) · T(t)) T(t)",
  },
  contrapedal: {
    title: "The feet of the normals",
    description:
      "Drop a perpendicular from the pole onto each normal line instead. The feet trace the contrapedal, which is also the pedal of the evolute. The two segments meet at a right angle.",
    formula: "K(t) = r(t) + ((P − r(t)) · N(t)) N(t)",
  },
  orthotomic: {
    title: "The pole, reflected",
    description:
      "Reflect the pole across each tangent line: continue past the pedal foot by the same distance. The reflections trace the orthotomic, twice the pedal as seen from the pole. Dashed segments show the reflected half.",
    formula: "Q(t) = 2H(t) − P",
  },
  offset: {
    title: "The curve, carried along its normals",
    description:
      "Move every point the same signed distance along its normal; positive distances go to the left of travel. Where the distance reaches the radius of curvature, the offset folds back in a cusp that lies on the evolute.",
    formula: "O(t) = r(t) + d N(t)",
  },
  rolling: {
    title: "A circle, rolled along the curve",
    description:
      "A circle rolls along the curve without slipping, touching it on one side. A point fixed to the circle traces a roulette. The contact is momentarily at rest, so each line from the contact to the tracing point is normal to the roulette.",
    formula: "P(t) = r + σρN + ℓ · rot(ψ − σs/ρ)(−σN)",
  },
  envelope: {
    title: "The envelope of turning lines",
    description:
      "Through each point of the curve passes a line, turned to the direction angle θ(t). Neighbouring lines cross ever closer together; the curve they all touch is their envelope.",
    formula: "E = r + λu,  det(r′ + λu′, u) = 0",
  },
  inversion: {
    title: "Inversion in a circle",
    description:
      "Carry each point along its ray from the center O until the product of the two distances is R². Points inside the circle go outside, the circle itself stays put, and lines and circles become lines or circles. Where the curve passes through O its image runs off to infinity; where the curve runs off to infinity its image passes through O. Inversion reverses the sense of turning.",
    formula: "I(p) = O + R² (p − O) / |p − O|²",
  },
};
// Chords share the envelope tab but explain their two endpoints.
const chordDescription = {
  title: "The envelope of chords",
  description:
    "Join each point of the curve to a second point moving with the same t. Neighbouring chords cross ever closer together; the curve they all touch is their envelope. Dashed parts lie on the chords' extensions, beyond the segments.",
  formula: "E = r + λ(q − r),  det(r′ + λu′, u) = 0",
};
// Circles share the envelope tab but explain their two branches.
const circleDescription = {
  title: "The envelope of moving circles",
  description:
    "Center a circle of radius R(t) on each point of the curve. Neighbouring circles cross ever closer together, touching their envelope on either side of travel. The branches meet where the radius changes as fast as the center moves, and vanish where it changes faster: there each circle nests inside its neighbours.",
  formula: "E = c + R(−kT ± √(1−k²) N),  k = R′/|c′|",
};
// A rolling curve shares the rolling tab but explains contact matching.
const rollingCurveDescription = {
  title: "A curve, rolled along the curve",
  description:
    "A second curve rolls along the first without slipping: equal arc lengths are laid against each other, and the two stay tangent at the contact. A point fixed to the rolling curve traces a roulette. The contact is momentarily at rest, so each line from it to the tracing point is normal to the roulette.",
  formula: "P = r + rot(θ)(Q − m(u)),  arc m(u₀→u) = s",
};
// A stack of offsets shares the offset tab but explains the family.
const stackDescription = {
  title: "A stack of parallel curves",
  description:
    "Offset the curve by evenly spaced signed distances along its normals. Each normal segment crosses the whole stack at a right angle. Circles centered on the curve touch the offsets at their radius: the offsets ±R are the envelope of those circles.",
  formula: "Oₖ(t) = r(t) + dₖ N(t)",
};
// An implicit curve replaces the construction altogether.
const implicitDescription = {
  title: "A level set and its gradient",
  description:
    "Sample F on a grid and mark where it lies above or below the level c. The curve F = c runs between them, through every cell whose corners disagree; each crossing is then found exactly and the pieces refined onto the curve. Where F has a saddle the pieces split or join as c passes it. The gradient of F is normal to the curve, pointing toward larger values.",
  formula: "F(x, y) = c,  ∇F ⟂ curve",
};
// So does an iterated map, whose formula depends on the map.
const attractorDescription = (map: AttractorMap) => ({
  title: "The visit density of an iterated map",
  description:
    "An iterated map sends each point to the next. From the start, the first iterates are discarded and the rest counted in the cells of a grid; each cell is shaded by the logarithm of its visits. The iterates are separate points, never joined into a curve. Coefficients that give a strange attractor are found by trying, and a picture like this does not prove the orbit is chaotic.",
  formula: mapFormulas[map],
});
// One tab per family; the pole constructions share a tab and a selector.
const tabs: Kind[] = [
  "evolute",
  "involute",
  "catacaustic",
  "diacaustic",
  "pedal",
  "offset",
  "rolling",
  "envelope",
  "inversion",
];
const inputOptions: Record<ConstructionInput, string> = {
  curve: "The curve itself",
  evolute: "Its evolute",
  pedal: "Its pedal",
  contrapedal: "Its contrapedal",
  orthotomic: "Its orthotomic",
  offset: "Its offset",
};
const poleOptions: Record<PoleKind, { label: string; note: string }> = {
  pedal: {
    label: "Pedal · tangent foot",
    note: "Project this point onto each tangent.",
  },
  contrapedal: {
    label: "Contrapedal · normal foot",
    note: "Project this point onto each normal.",
  },
  orthotomic: {
    label: "Orthotomic · reflected pole",
    note: "Reflect this point across each tangent.",
  },
};
// Numeric parameters addressed by their path in the configuration. An unset
// optional value, such as a polar source radius before first use, reads as 0.
function getIn(config: Config, path: string[]): number {
  return path.reduce<any>((o, k) => o?.[k], config) ?? 0;
}
function setIn(config: Config, path: string[], value: number): Config {
  const next = structuredClone(config);
  const parent = path.slice(0, -1).reduce<any>((o, k) => o[k], next);
  parent[path.at(-1)!] = value;
  return next;
}
function App({ active, shared }: { active: boolean; shared?: SharedStudy }) {
  const [config, setConfig] = useState<Config>(presets[0].config);
  const [preset, setPreset] = useState("0");
  // Remembers the pole construction while another tab is selected.
  const [poleKind, setPoleKind] = useState<PoleKind>("pedal");
  const [frame, setFrame] = useState<Frame | null>(null);
  const [bounds, setBounds] = useState<Bounds>({
    min: boundText(config.curve.min),
    max: boundText(config.curve.max),
  });
  const [animation, setAnimation] = useState<AnimationView | null>(null);
  const [animationRunning, setAnimationRunning] = useState(false);
  // The engine's error, and the configuration path of the field it names.
  const [computeError, setError] = useState<{
    message: string;
    field?: string;
  }>({ message: "" });
  // The field showing the failure under its control, if any, and the name
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
  const [settledKey, setSettledKey] = useState("");
  // The probe asks Go for the base curve's diagnostics (planar-probe.ts).
  const [probe, setProbe] = useState<PlanarProbe>(defaultProbe);
  const probing = probe.enabled && probeSupported(config);
  const requestKey = JSON.stringify([config, bounds, probing]);
  // Derive readiness from the exact inputs, so neither export nor animation can
  // briefly consume the previous frame before the debounce effect runs.
  // Fields whose constant expressions Go is still evaluating, or rejected.
  const [scalars, setScalars] = useState<Record<string, ScalarState>>({});
  const scalarStates = Object.values(scalars);
  const scalarError = scalarStates.find((s) => s.error);
  const busy = settledKey !== requestKey || scalarStates.some((s) => s.pending);
  const error = busy
    ? ""
    : scalarError
      ? `${scalarError.name}: ${scalarError.error}`
      : computeError.message;
  const theme = useTheme();
  const { dark, preference } = theme;
  const [reset, setReset] = useState(0);
  const [refit, setRefit] = useState(0);
  const [length, setLength] = useState(0.8);
  const [layers, setLayers] = useState<Layers>({
    base: true,
    derived: true,
    lines: true,
    incident: true,
    virtual: true,
    axes: false,
  });
  const [weight, setWeight] = useState<LineWeight>("regular");
  const narrow = useMediaQuery("(max-width: 700px)");
  const expressions = useDisclosure("expressions");
  const indices = useDisclosure("indices");
  const diagnostics = useDisclosure("diagnostics");
  const refinable = refinesBetweenSamples(config.curve.format);
  const samplesHelp =
    "Whole numbers from 64 to 32,768. More samples trace the curve more finely and take longer to compute; they do not raise numerical precision on their own." +
    (refinable
      ? ` Refining between samples halves a sample interval, at most ${refineDepth} times, wherever the chord drawn across it strays from the curve by more than 1/5000 of the radius fitted to that curve's samples, judged at three points along it, and stops after ${refineBudget.toLocaleString("en-US")} added points per curve. It refines the curve, a derived curve it is built on, and a pedal, contrapedal, orthotomic, evolute, offset, caustic or inverted curve, each curve of an offset stack on its own, the involute, whose string length it carries on from the sample before by the same rule the samples use, a rolling circle's or curve's trace, whose distance rolled it carries on the same way, through any cusp between samples, and an envelope of lines or chords, or each branch of an envelope of circles on its own; every construction's lines, circles and rolling positions stay on the evenly spaced samples. A gap or jump it finds between samples breaks the curve and the curves built on it there; a passage of the inverted curve through the center is found the same way. Where a caustic or a chord envelope turns from real to virtual between samples, that change is placed to within 1/${2 ** refineDepth} of a sample interval, so its solid and dashed parts meet. A feature narrower than its three points can still be missed.`
      : "");
  const client = useRef<EngineClient | null>(null);
  const scalarJobs = useRef(new Set<Promise<void>>());
  const scalarGeneration = useRef(0);
  const scalarStatus = useMemo(
    () => ({
      client,
      generation: scalarGeneration,
      // Handlers that compute from other numeric fields wait for pending
      // evaluations, so they see the values just entered.
      track: (job: Promise<void>) => {
        scalarJobs.current.add(job);
        void job.finally(() => scalarJobs.current.delete(job));
      },
      resolved: () => Promise.allSettled([...scalarJobs.current]),
      report: (id: string, state: ScalarState | null) =>
        setScalars((previous) => {
          if (!state && !(id in previous)) return previous;
          const next = { ...previous };
          if (state) next[id] = state;
          else delete next[id];
          return next;
        }),
    }),
    [],
  );
  const manualView = useRef<Viewport | undefined>(undefined);
  const plotWrap = useRef<HTMLDivElement>(null);
  const revealPlot = () =>
    revealDrawing(plotWrap.current, document.getElementById("playback"));
  useEffect(() => {
    const engine = new EngineClient();
    client.current = engine;
    return () => engine.dispose();
  }, []);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      client
        .current!.compute(config, bounds, { diagnostics: probing })
        .then((next) => {
          if (cancelled) return;
          setFrame(next);
          setError({ message: "" });
          setSettledKey(requestKey);
        })
        .catch((reason) => {
          if (cancelled) return;
          // The previous valid study stays in view, marked as such.
          setError({
            message: reason.message,
            field: reason instanceof EngineError ? reason.field : undefined,
          });
          setSettledKey(requestKey);
        });
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [config, bounds, probing]);
  const shown = animation?.frame ?? frame;
  const result = shown?.result;
  // What the legend names: the drawn study's entries, each while its layer
  // draws something.
  const drawnFormat = (shown?.config ?? config).curve.format;
  const drawn = shown
    ? legendGeometry(shown.result, shown.config, layers)
    : { base: layers.base, derived: layers.derived };
  // A level set and an iterated map have no parameter, so no construction
  // applies to them.
  const implicit = config.curve.format === "implicit";
  const attractor = config.curve.format === "attractor";
  const unparametrized = implicit || attractor;
  const optical =
    !unparametrized &&
    (config.kind === "catacaustic" || config.kind === "diacaustic");
  // Chords that are not extended have envelope points beyond the segments.
  const chords =
    !unparametrized &&
    config.kind === "envelope" &&
    config.envelope.mode === "chord" &&
    !config.envelope.extend;
  const info = implicit
    ? implicitDescription
    : attractor
      ? attractorDescription(config.curve.attractor.map)
      : config.kind === "offset" && config.stack.enabled
        ? stackDescription
        : config.kind === "rolling" && config.rolling.shape === "curve"
          ? rollingCurveDescription
          : config.kind === "envelope" && config.envelope.mode === "chord"
            ? chordDescription
            : config.kind === "envelope" && config.envelope.mode === "circle"
              ? circleDescription
              : descriptions[config.kind];
  // Changes apply to the latest configuration, never to this render's copy:
  // a constant expression resolved by Go can land between a state update and
  // the next render, and a stale copy would overwrite it.
  const update = (
    patch: Partial<Config> | ((c: Config) => Partial<Config>),
  ) => {
    setPreset("custom");
    setConfig((c) => ({
      ...c,
      ...(typeof patch === "function" ? patch(c) : patch),
    }));
  };
  const curve = (patch: Partial<Config["curve"]>) =>
    update((c) => ({ curve: { ...c.curve, ...patch } }));
  const number = (
    label: ReactNode,
    value: number,
    change: (n: number) => void,
    options: {
      step?: number | string;
      min?: number;
      max?: number;
      help?: ReactNode;
      topic?: string;
    } = {},
  ) => (
    <Field label={label} help={options.help} topic={options.topic}>
      <input
        type="number"
        value={Number.isNaN(value) ? "" : value}
        step={options.step ?? "any"}
        min={options.min}
        max={options.max}
        onChange={(e) => change(e.target.valueAsNumber)}
      />
    </Field>
  );
  // A numeric parameter entered as a constant expression; see ScalarInput.
  // The value is applied to the latest configuration, since it arrives after
  // Go has evaluated the text.
  const scalar = (
    label: ReactNode,
    path: string[],
    options: { help?: ReactNode; topic?: string; name?: string } = {},
  ) => (
    <Field label={label} help={options.help} topic={options.topic}>
      <ScalarInput
        name={options.name ?? String(label)}
        value={getIn(config, path)}
        onChange={(value) => {
          setPreset("custom");
          setConfig((c) => setIn(c, path, value));
        }}
      />
    </Field>
  );
  const roll = config.curve.roulette;
  const rollTo = (patch: Partial<Config["curve"]["roulette"]>) =>
    update((c) => ({
      curve: { ...c.curve, roulette: { ...c.curve.roulette, ...patch } },
    }));
  // Closure comes from the engine and depends only on the roll and radii, so
  // the last result stays valid while other inputs recompute. Showing it
  // throughout keeps the note and button from reflowing the controls.
  const computed = frame?.config.curve.roulette;
  const closure =
    frame?.config.curve.format === "roulette" &&
    computed?.roll === roll.roll &&
    computed.radius === roll.radius &&
    (roll.roll === "line" || computed.fixedRadius === roll.fixedRadius)
      ? frame.result.roulette
      : undefined;
  const rouletteControls = (
    <>
      <Field label="Rolling">
        <select
          value={roll.roll}
          onChange={(e) => rollTo({ roll: e.target.value as Roll })}
        >
          <option value="inside">Inside a fixed circle · hypotrochoid</option>
          <option value="outside">Outside a fixed circle · epitrochoid</option>
          <option value="line">Along a line · trochoid</option>
        </select>
      </Field>
      <div className="pair">
        {roll.roll !== "line" &&
          scalar("Fixed radius R", ["curve", "roulette", "fixedRadius"])}
        {scalar("Rolling radius r", ["curve", "roulette", "radius"], {
          topic: "roulette radii",
          help: "Radii are positive and at most 100,000. A circle rolling inside must be smaller than the fixed circle.",
        })}
      </div>
      <div className="pair">
        {scalar("Tracing distance d", ["curve", "roulette", "arm"], {
          topic: "tracing distance",
          help: "Distance of the tracing point from the rolling center, 0–100,000. d = r traces the rim and gives cusps; larger values give loops.",
        })}
        {scalar("Phase φ (radians)", ["curve", "roulette", "phase"], {
          topic: "roulette phase",
          help: "At t = 0 the tracing arm points at the contact; the phase turns it counterclockwise by φ radians.",
        })}
      </div>
      <p className="note" data-testid="closure-note">
        {roll.roll === "line"
          ? "Along a line the trace repeats every turn of the circle, shifted by 2πr. It never closes."
          : !closure
            ? "Checking whether the trace closes…"
            : closure.turns > 0
              ? `R/r = ${closure.lobes}/${closure.turns}: the trace closes after ${closure.turns} ${closure.turns === 1 ? "turn" : "turns"} of the rolling center (t over ${2 * closure.turns}π), with ${closure.lobes} ${closure.lobes === 1 ? "arch" : "arches"}.`
              : "R/r is not a ratio of whole numbers with at most 200 turns, so the trace never closes exactly. It is not forced closed."}
      </p>
      {closure && closure.turns > 0 && (
        <button
          className="closure"
          type="button"
          onClick={() => {
            const span = `${2 * closure.turns}*pi`;
            setPreset("custom");
            setBounds({
              ...bounds,
              max: bounds.min.trim() === "0" ? span : `(${bounds.min})+${span}`,
            });
          }}
        >
          Trace one full period
        </button>
      )}
    </>
  );
  const harmonic = isHarmonic(config.curve.format);
  // Like a roulette's, a harmonic curve's closure note stays while inputs
  // that cannot change it recompute.
  const harmonicClosure =
    frame &&
    frame.config.curve.format === config.curve.format &&
    closureKey(frame.config.curve) === closureKey(config.curve)
      ? frame.result.harmonic
      : undefined;
  const periodButton = harmonicClosure && harmonicClosure.period > 0 && (
    <button
      className="closure"
      type="button"
      onClick={() => {
        const span = periodText(harmonicClosure.period).expression;
        setPreset("custom");
        setBounds({
          ...bounds,
          max: bounds.min.trim() === "0" ? span : `(${bounds.min})+${span}`,
        });
      }}
    >
      Trace one full period
    </button>
  );
  const harmonicNote = (
    <>
      <p className="note" data-testid="closure-note">
        {harmonicClosure
          ? closureNote(harmonicClosure)
          : "Checking whether the curve closes…"}
      </p>
      {periodButton}
    </>
  );
  const lissajous = ["curve", "lissajous"];
  const lissajousControls = (
    <>
      <div className="pair">
        {scalar("Amplitude A", [...lissajous, "amplitudeX"], {
          topic: "Lissajous amplitudes",
          help: "Half-widths of the figure, 0–100,000: x swings between ±A and y between ±B.",
        })}
        {scalar("Amplitude B", [...lissajous, "amplitudeY"])}
      </div>
      <div className="pair">
        {scalar("Frequency m", [...lissajous, "frequencyX"], {
          topic: "Lissajous frequencies",
          help: "Radians per unit t, within ±1,000. Whole numbers close after t spans 2π, other whole-number ratios eventually, and the rest never.",
        })}
        {scalar("Frequency n", [...lissajous, "frequencyY"])}
      </div>
      {scalar("Phase φ (radians)", [...lissajous, "phase"], {
        topic: "Lissajous phase",
        help: "Shifts x against y. With m = n, φ = π/2 draws an ellipse and φ = 0 a segment.",
      })}
      {harmonicNote}
    </>
  );
  const terms = config.curve.terms;
  // Adding or removing a term renumbers the fields after it, so evaluations
  // still pending for them land first.
  const editTerms = async (
    change: (terms: Config["curve"]["terms"]) => Config["curve"]["terms"],
  ) => {
    await scalarStatus.resolved();
    update((c) => ({ curve: { ...c.curve, terms: change(c.curve.terms) } }));
  };
  const fourierControls = (
    <>
      <p className="note">
        Each term is a vector of radius r (0–100,000) turning at frequency k
        radians per unit t (within ±1,000, counterclockwise when positive), from
        angle φ radians at t = 0. The vectors are chained from the origin in
        this order.
      </p>
      {terms.map((_, i) => (
        <div
          className="term"
          role="group"
          aria-labelledby={`term-${i}`}
          key={i}
        >
          <div className="term-heading">
            <span id={`term-${i}`}>Term {i + 1}</span>
            <button
              type="button"
              aria-label={`Remove term ${i + 1}`}
              disabled={terms.length === 1}
              onClick={() => editTerms((t) => t.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </div>
          <div className="pair trio">
            {scalar(termLabels.Frequency(i + 1), [
              "curve",
              "terms",
              String(i),
              "frequency",
            ])}
            {scalar(termLabels.Radius(i + 1), [
              "curve",
              "terms",
              String(i),
              "radius",
            ])}
            {scalar(termLabels.Phase(i + 1), [
              "curve",
              "terms",
              String(i),
              "phase",
            ])}
          </div>
        </div>
      ))}
      <button
        className="closure"
        type="button"
        disabled={terms.length >= maxTerms}
        onClick={() => editTerms((t) => [...t, nextTerm(t)])}
      >
        {terms.length >= maxTerms ? "At most 16 terms" : "Add a term"}
      </button>
      {harmonicNote}
    </>
  );
  const pursuers = config.curve.pursuit.pursuers;
  // Like term edits, adding or removing a pursuer renumbers the fields after
  // it, so pending evaluations land first.
  const editPursuers = async (
    change: (
      pursuers: Config["curve"]["pursuit"]["pursuers"],
    ) => Config["curve"]["pursuit"]["pursuers"],
  ) => {
    await scalarStatus.resolved();
    update((c) => ({
      curve: {
        ...c.curve,
        pursuit: {
          ...c.curve.pursuit,
          pursuers: change(c.curve.pursuit.pursuers),
        },
      },
    }));
  };
  const chase =
    frame?.config.curve.format === "pursuit" ? frame.result.pursuit : undefined;
  const captured =
    chase?.capture && chase.capture.time > frame!.config.curve.min
      ? chase.capture
      : undefined;
  const pursuitControls = (
    <>
      <p className="note">
        Each pursuer starts at (x, y) (within ±100,000) when t is at the domain
        start and runs straight at the next one, the last at the first, at its
        own speed v (0–100,000). The first pursuer&rsquo;s path is the curve the
        construction uses.
      </p>
      {pursuers.map((_, i) => (
        <div
          className="term"
          role="group"
          aria-labelledby={`pursuer-${i}`}
          key={i}
        >
          <div className="term-heading">
            <span id={`pursuer-${i}`}>
              Pursuer {i + 1}, chasing {i + 1 === pursuers.length ? 1 : i + 2}
            </span>
            <button
              type="button"
              aria-label={`Remove pursuer ${i + 1}`}
              disabled={pursuers.length === 2}
              onClick={() => editPursuers((p) => p.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </div>
          <div className="pair trio">
            {(["X", "Y", "Speed"] as const).map((field) =>
              scalar(pursuerLabels[field](i + 1), [
                "curve",
                "pursuit",
                "pursuers",
                String(i),
                field.toLowerCase(),
              ]),
            )}
          </div>
        </div>
      ))}
      <div className="pair">
        <button
          className="closure"
          type="button"
          disabled={pursuers.length >= maxPursuers}
          onClick={() => editPursuers((p) => [...p, nextPursuer(p)])}
        >
          {pursuers.length >= maxPursuers
            ? "At most 16 pursuers"
            : "Add a pursuer"}
        </button>
        <button
          className="closure"
          type="button"
          onClick={() => editPursuers(regularPolygon)}
        >
          Space evenly on a circle
        </button>
      </div>
      {scalar("Capture distance ε", ["curve", "pursuit", "capture"], {
        topic: "capture distance",
        help: "A pursuer’s direction is undefined on its target, so the chase stops, for everyone, the first time any pursuer comes this close to its own target (0–100,000). Nobody merges or changes target.",
      })}
      <p className="note" data-testid="capture-note">
        {chase ? captureNote(chase, frame!.config.curve.min) : "Chasing…"}
      </p>
      {captured && (
        <button
          className="closure"
          type="button"
          onClick={() => {
            setPreset("custom");
            setBounds({ ...bounds, max: String(captured.time) });
          }}
        >
          End the domain at the capture
        </button>
      )}
    </>
  );
  const seeds = config.curve.field.seeds;
  const toField = (patch: Partial<Config["curve"]["field"]>) =>
    update((c) => ({
      curve: { ...c.curve, field: { ...c.curve.field, ...patch } },
    }));
  // Adding or removing a seed renumbers the fields after it, so pending
  // evaluations land first.
  const editSeeds = async (change: (seeds: Vec[]) => Vec[]) => {
    await scalarStatus.resolved();
    update((c) => ({
      curve: {
        ...c.curve,
        field: { ...c.curve.field, seeds: change(c.curve.field.seeds) },
      },
    }));
  };
  const flows =
    frame?.config.curve.format === "field" ? frame.result.field : undefined;
  const fieldControls = (
    <>
      <p className="note">
        Each trajectory starts at its seed (within ±100,000) when t is at the
        domain start and follows the field: its velocity at (x, y) at time t is
        (dx/dt, dy/dt). Use <var>x</var>, <var>y</var>, <var>t</var>, and{" "}
        <var>a</var>. The first seed&rsquo;s trajectory is the curve the
        construction uses.
      </p>
      <Field label="dx/dt" className="equation">
        <input
          value={config.curve.field.x}
          onChange={(e) => toField({ x: e.target.value })}
          spellCheck={false}
        />
      </Field>
      <Field label="dy/dt" className="equation">
        <input
          value={config.curve.field.y}
          onChange={(e) => toField({ y: e.target.value })}
          spellCheck={false}
        />
      </Field>
      {seeds.map((_, i) => (
        <div
          className="term"
          role="group"
          aria-labelledby={`seed-${i}`}
          key={i}
        >
          <div className="term-heading">
            <span id={`seed-${i}`}>Seed {i + 1}</span>
            <button
              type="button"
              aria-label={`Remove seed ${i + 1}`}
              disabled={seeds.length === 1}
              onClick={() => editSeeds((s) => s.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </div>
          <div className="pair">
            {(["X", "Y"] as const).map((field) =>
              scalar(seedLabels[field](i + 1), [
                "curve",
                "field",
                "seeds",
                String(i),
                field.toLowerCase(),
              ]),
            )}
          </div>
        </div>
      ))}
      <button
        className="closure"
        type="button"
        disabled={seeds.length >= maxSeeds}
        onClick={() => editSeeds((s) => [...s, nextSeed(s)])}
      >
        {seeds.length >= maxSeeds ? "At most 16 seeds" : "Add a seed"}
      </button>
      {scalar("Escape radius R", ["curve", "field", "escape"], {
        topic: "escape radius",
        help: "A trajectory ends the first time it leaves the circle of this radius about the origin (0–100,000), so a field that runs off to infinity stops in view. A seed outside the circle has no path.",
      })}
      <p className="note" data-testid="field-note">
        {flows ? endNote(flows, frame!.config.curve.min) : "Integrating…"}
      </p>
    </>
  );
  const toImplicit = (patch: Partial<Config["curve"]["implicit"]>) =>
    update((c) => ({
      curve: { ...c.curve, implicit: { ...c.curve.implicit, ...patch } },
    }));
  const levels = config.curve.implicit.family;
  const levelSets =
    frame?.config.curve.format === "implicit"
      ? frame.result.contours
      : undefined;
  const implicitControls = (
    <>
      <p className="note">
        The curve is every point of the window where F(x, y) equals the level c.
        Use <var>x</var>, <var>y</var>, and <var>a</var>. It has no parameter,
        so no construction applies; the normals show F&rsquo;s gradient,
        pointing across the curve toward larger values.
      </p>
      <Field label="F(x, y)" className="equation">
        <input
          value={config.curve.implicit.f}
          onChange={(e) => toImplicit({ f: e.target.value })}
          spellCheck={false}
        />
      </Field>
      {scalar("Level c", ["curve", "implicit", "level"], {
        topic: "level c",
        help: "The curve is F = c. As c passes a saddle value of F, pieces of the curve split or join.",
      })}
      <div className="pair">
        {scalar("Window x from", ["curve", "implicit", "window", "xMin"])}
        {scalar("Window x to", ["curve", "implicit", "window", "xMax"], {
          topic: "window",
          help: "The curve is sought only in this rectangle, within ±100,000. Contours that leave it are cut off at its edge.",
        })}
      </div>
      <div className="pair">
        {scalar("Window y from", ["curve", "implicit", "window", "yMin"])}
        {scalar("Window y to", ["curve", "implicit", "window", "yMax"])}
      </div>
      {number(
        "Grid cells",
        config.curve.implicit.cells,
        (n) => toImplicit({ cells: n }),
        {
          step: 1,
          min: 4,
          max: 1024,
          topic: "grid cells",
          help: "Whole numbers from 4 to 1,024 along the window's longer side. F is sampled at the cells' corners, so a piece of the curve smaller than a cell can be missed; crossings and the curve between them are then found exactly.",
        },
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={levels.enabled}
          onChange={(e) =>
            toImplicit({ family: { ...levels, enabled: e.target.checked } })
          }
        />
        Family of levels
      </label>
      {levels.enabled && (
        <>
          <div className="pair">
            {scalar("Levels from", ["curve", "implicit", "family", "from"])}
            {scalar("Levels to", ["curve", "implicit", "family", "to"], {
              topic: "family of levels",
              help: "Evenly spaced levels from the first to the last, both included, drawn beside the curve.",
            })}
          </div>
          {number(
            "Level count",
            levels.count,
            (n) =>
              update((c) => ({
                curve: {
                  ...c.curve,
                  implicit: {
                    ...c.curve.implicit,
                    family: { ...c.curve.implicit.family, count: n },
                  },
                },
              })),
            { step: 1, min: 2, max: 64, help: "Whole numbers from 2 to 64." },
          )}
        </>
      )}
      <p className="note" data-testid="contour-note">
        {levelSets ? contourNote(levelSets) : "Tracing…"}
      </p>
    </>
  );
  const iterated = config.curve.attractor;
  const toAttractor = (patch: Partial<Config["curve"]["attractor"]>) =>
    update((c) => ({
      curve: { ...c.curve, attractor: { ...c.curve.attractor, ...patch } },
    }));
  const visits =
    frame?.config.curve.format === "attractor"
      ? frame.result.attractor
      : undefined;
  const attractorControls = (
    <>
      <p className="note">
        Each point is sent to the next by the map. The iterates are counted in
        the cells they land in, never joined; a cell&rsquo;s shade is the
        logarithm of its visits. The orbit is sensitive to rounding, so a
        different build or device can give different iterates and a similar
        density.
      </p>
      <Field
        label="Map"
        topic="iterated map"
        help="Choosing a map loads coefficients known to give an intricate orbit from nearby starts. Other coefficients may give a few points, a cycle, or an orbit that leaves."
      >
        <select
          value={iterated.map}
          onChange={(e) => {
            const map = e.target.value as AttractorMap;
            toAttractor({ map, ...mapDefaults[map] });
          }}
        >
          {(Object.keys(mapNames) as AttractorMap[]).map((m) => (
            <option key={m} value={m}>
              {mapNames[m]}
            </option>
          ))}
        </select>
      </Field>
      <div className="pair">
        {scalar("Coefficient a", ["curve", "attractor", "a"])}
        {scalar("Coefficient b", ["curve", "attractor", "b"], {
          topic: "map coefficients",
          help: "Finite, within ±1,000. The formula above shows where each enters.",
        })}
      </div>
      {iterated.map !== "henon" && (
        <div className="pair">
          {scalar("Coefficient c", ["curve", "attractor", "c"])}
          {scalar("Coefficient d", ["curve", "attractor", "d"])}
        </div>
      )}
      <div className="pair">
        {scalar("Start x₀", ["curve", "attractor", "start", "x"])}
        {scalar("Start y₀", ["curve", "attractor", "start", "y"], {
          topic: "start",
          help: "Where the orbit begins, within ±100,000. It ends if an iterate leaves |x|, |y| ≤ 100,000.",
        })}
      </div>
      <div className="pair">
        {number(
          "Discarded iterates",
          iterated.discard,
          (n) => toAttractor({ discard: n }),
          { step: 1, min: 0, max: 1000000 },
        )}
        {number(
          "Accumulated iterates",
          iterated.iterates,
          (n) => toAttractor({ iterates: n }),
          {
            step: 1,
            min: 0,
            max: 5000000,
            topic: "iterates",
            help: "Whole numbers: up to 1,000,000 discarded while the orbit settles, then up to 5,000,000 counted. More iterates give a smoother density and take longer.",
          },
        )}
      </div>
      {number("Grid cells", iterated.cells, (n) => toAttractor({ cells: n }), {
        step: 1,
        min: 4,
        max: 1024,
        topic: "density grid",
        help: "Whole numbers from 4 to 1,024 along the window's longer side. Each cell is one pixel of the density, drawn with square edges at any size.",
      })}
      <label className="check">
        <input
          type="checkbox"
          checked={iterated.fit}
          onChange={(e) => toAttractor({ fit: e.target.checked })}
        />
        Fit the window to the iterates
      </label>
      {!iterated.fit && (
        <>
          <div className="pair">
            {scalar("Window x from", ["curve", "attractor", "window", "xMin"])}
            {scalar("Window x to", ["curve", "attractor", "window", "xMax"], {
              topic: "density window",
              help: "Iterates are counted only in this rectangle, within ±100,000; the note counts those outside it. A fitted window is the accumulated iterates' bounds, and this one stands in when none are accumulated.",
            })}
          </div>
          <div className="pair">
            {scalar("Window y from", ["curve", "attractor", "window", "yMin"])}
            {scalar("Window y to", ["curve", "attractor", "window", "yMax"])}
          </div>
        </>
      )}
      <p className="note" data-testid="attractor-note">
        {visits
          ? attractorNote(visits, frame!.config.curve.attractor.discard)
          : "Iterating…"}
      </p>
    </>
  );
  // On phones the controls follow the drawing directly, so the explanation
  // moves after them instead of separating the two.
  const behind = (
    <StudyExplanation
      title="Curves, revealed by construction."
      formula={info.formula}
      diagnostics={
        result &&
        result.warnings.length > 0 && (
          <details className="diagnostics" {...diagnostics}>
            <summary>
              Numerical notes · {result.invalid} omitted samples
            </summary>
            {result.warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </details>
        )
      }
      note={
        optical
          ? "A mathematical ray family: every sampled point participates. No occlusion or multiple bounces."
          : "The connecting lines reveal the geometry of the construction."
      }
    >
      <p>{info.description}</p>
      {!unparametrized && config.input !== "curve" && (
        <p data-testid="input-description">
          Here it acts on the curve&rsquo;s {config.input}, drawn faintly with
          the curve, which is evaluated from the curve&rsquo;s definition at
          every t rather than from its drawn points.
        </p>
      )}
    </StudyExplanation>
  );
  const choosePreset = (index: number) => {
    touched.current = null;
    setPreset(String(index));
    scalarGeneration.current++;
    const next = presets[index].config;
    if (usesPole(next.kind)) setPoleKind(next.kind);
    setConfig(structuredClone(next));
    setProbe(presets[index].probe ?? defaultProbe);
    setBounds({
      min: boundText(next.curve.min),
      max: boundText(next.curve.max),
    });
    setReset(reset + 1);
    // A preset brings its own animation setup, or plays the current one
    // once, steadily (timing.ts).
    setRestoredAnimation({
      id: -++presetAnimations.current,
      settings: presets[index].animation ?? {
        ...(animationSettings.current ?? defaultAnimation),
        repeat: "once",
        pace: "steady",
      },
    });
  };
  // A shared study replaces the whole study, as a preset does, and restores
  // the sender's layers, framing, and animation setup.
  const [linkNotice, setLinkNotice] = useState("");
  const camera = useRef<PlotCamera>({ x: 0, y: 0, zoom: 1 });
  const [restoredCamera, setRestoredCamera] = useState<{
    reset: number;
    camera: PlotCamera;
  } | null>(null);
  const animationSettings = useRef<PlanarAnimation | null>(null);
  // Preset setups count down from -1, apart from links' ids.
  const presetAnimations = useRef(0);
  const [restoredAnimation, setRestoredAnimation] = useState<{
    id: number;
    settings: PlanarAnimation;
  } | null>(null);
  const openStudy = (id: number, study: PlanarStudy) => {
    touched.current = null;
    setPreset("custom");
    scalarGeneration.current++;
    setPoleKind(study.poleKind);
    setConfig(study.config);
    setBounds(study.bounds);
    setLength(study.length);
    setLayers(study.layers);
    setWeight(study.weight);
    setProbe(study.probe);
    setRestoredCamera({ reset: reset + 1, camera: study.camera });
    setReset(reset + 1);
    setRestoredAnimation({ id, settings: study.animation });
  };
  useEffect(() => {
    if (!shared) return;
    setLinkNotice(shared.error ?? "");
    if (shared.error !== undefined) return;
    try {
      openStudy(shared.id, planarStudy(shared.study));
    } catch (e) {
      setLinkNotice(
        e instanceof LinkError ? e.message : "This link could not be read.",
      );
    }
  }, [shared?.id]);
  const snapshot = (): PlanarStudy => ({
    config,
    bounds,
    length,
    poleKind,
    layers,
    camera: camera.current,
    weight,
    probe,
    animation: animationSettings.current ?? defaultAnimation,
  });
  // Where the error is shown: under the input that failed to parse, or
  // under the control the engine's error names, or, for an error about the
  // whole study, the control just changed; the drawing shows it only when
  // no such field can.
  const failureTarget: Pick<FieldErrorTarget, "id" | "label"> = scalarError
    ? scalarError.control
      ? { id: scalarError.control }
      : { label: scalarError.name }
    : {
        label:
          (computeError.field && fieldLabel(config, computeError.field)) ??
          touched.current ??
          undefined,
      };
  const fieldError = useMemo<FieldErrorTarget>(
    () => ({ ...failureTarget, message: error, claim, touch }),
    [failureTarget.id, failureTarget.label, error],
  );
  const claimedHere = !!error && claimed !== null;
  return (
    <div
      className={dark ? "app dark" : "app"}
      data-theme-preference={preference}
    >
      <AppHeader theme={theme}>
        <ShareLink
          notebook="2d"
          study={snapshot}
          disabled={!result || busy || !!error}
        />
        <AnimationButton section="animation-section" />
        <ExportImageMenu
          disabled={!result || busy || !!error || animationRunning}
          kind={studyName(config)}
        />
      </AppHeader>
      <main>
        <ScalarStatus.Provider value={scalarStatus}>
          <aside aria-label="Study parameters">
            {linkNotice && (
              <LinkNotice
                text={linkNotice}
                onDismiss={() => setLinkNotice("")}
              />
            )}
            <FieldErrorContext.Provider value={fieldError}>
              <div className="section-label">01 / THE STUDY</div>
              <NotebookMode />
              <ExampleGallery
                examples={planarExamples}
                current={preset === "custom" ? null : +preset}
                onChoose={choosePreset}
                thumbnail={planarThumbnail}
                dark={dark}
              />
              <div className="tabs" role="group" aria-label="Construction">
                {tabs.map((k) => {
                  const active =
                    !unparametrized &&
                    (config.kind === k ||
                      (k === "pedal" && usesPole(config.kind)));
                  return (
                    <button
                      className={active ? "active" : ""}
                      aria-pressed={active}
                      key={k}
                      disabled={unparametrized}
                      title={
                        implicit
                          ? "An implicit curve has no parameter to build a construction on."
                          : attractor
                            ? "An iterated map has no parameter to build a construction on."
                            : undefined
                      }
                      onClick={() => {
                        if (active) return;
                        const kind = k === "pedal" ? poleKind : k;
                        // An evolute cannot feed every construction.
                        update((c) => ({
                          kind,
                          input: inputAllowed(kind, c.input)
                            ? c.input
                            : "curve",
                        }));
                      }}
                    >
                      {k}
                    </button>
                  );
                })}
              </div>
              <section>
                <div className="section-label">02 / THE CURVE</div>
                <Field label="Definition">
                  <select
                    value={config.curve.format}
                    onChange={(e) =>
                      curve({
                        format: e.target.value as Config["curve"]["format"],
                      })
                    }
                  >
                    <option value="parametric">Parametric · x(t), y(t)</option>
                    <option value="cartesian">Cartesian · y = f(x)</option>
                    <option value="polar">Polar · r(t)</option>
                    <option value="roulette">Roulette · rolling circle</option>
                    <option value="lissajous">
                      Lissajous · A sin(mt + φ), B sin(nt)
                    </option>
                    <option value="fourier">Fourier · rotating circles</option>
                    <option value="pursuit">
                      Pursuit · each chases the next
                    </option>
                    <option value="field">Vector field · trajectories</option>
                    <option value="implicit">Implicit · F(x, y) = c</option>
                    <option value="attractor">Attractor · iterated map</option>
                  </select>
                </Field>
                {config.curve.format === "roulette" ? (
                  rouletteControls
                ) : config.curve.format === "lissajous" ? (
                  lissajousControls
                ) : config.curve.format === "fourier" ? (
                  fourierControls
                ) : config.curve.format === "pursuit" ? (
                  pursuitControls
                ) : config.curve.format === "field" ? (
                  fieldControls
                ) : implicit ? (
                  implicitControls
                ) : attractor ? (
                  attractorControls
                ) : (
                  <>
                    {config.curve.format === "parametric" && (
                      <Field label="x(t)" className="equation">
                        <input
                          value={config.curve.x}
                          onChange={(e) => curve({ x: e.target.value })}
                          spellCheck={false}
                        />
                      </Field>
                    )}
                    {config.curve.format !== "polar" ? (
                      <Field
                        label={
                          config.curve.format === "cartesian" ? "f(x)" : "y(t)"
                        }
                        className="equation"
                      >
                        <input
                          value={config.curve.y}
                          onChange={(e) => curve({ y: e.target.value })}
                          spellCheck={false}
                        />
                      </Field>
                    ) : (
                      <Field label="r(t)" className="equation">
                        <input
                          value={config.curve.r}
                          onChange={(e) => curve({ r: e.target.value })}
                          spellCheck={false}
                        />
                      </Field>
                    )}
                  </>
                )}
                {!unparametrized && (
                  <div className="pair">
                    {(["min", "max"] as const).map((key) => (
                      <Field
                        className="equation"
                        key={key}
                        topic={
                          key !== "min"
                            ? undefined
                            : config.curve.format === "roulette"
                              ? "rolling parameter t"
                              : harmonic ||
                                  config.curve.format === "pursuit" ||
                                  config.curve.format === "field"
                                ? "time parameter t"
                                : undefined
                        }
                        help={
                          key !== "min"
                            ? undefined
                            : config.curve.format === "roulette"
                              ? config.curve.roulette.roll === "line"
                                ? "t is the angle the rolling circle has turned, in radians; its center moves r·t along the line."
                                : "t is the angle of the rolling center around the fixed center, in radians. One turn is 2*pi."
                              : harmonic
                                ? "t is time: a vector of frequency k turns through k·t radians."
                                : config.curve.format === "pursuit"
                                  ? "t is time: the pursuers start from their positions when t is at the domain start, and a pursuer of speed v runs v·t in time t."
                                  : config.curve.format === "field"
                                    ? "t is time: every trajectory starts from its seed when t is at the domain start. Fields may depend on t."
                                    : undefined
                        }
                        label={
                          key === "min"
                            ? config.curve.format === "cartesian"
                              ? "x from"
                              : "t from"
                            : "to"
                        }
                      >
                        <input
                          value={bounds[key]}
                          onChange={(e) => {
                            setPreset("custom");
                            setBounds({ ...bounds, [key]: e.target.value });
                          }}
                          spellCheck={false}
                        />
                      </Field>
                    ))}
                  </div>
                )}
                {config.curve.format !== "roulette" &&
                  !ownsShape(config.curve.format) &&
                  scalar(
                    <>
                      Shape parameter <var>a</var>
                    </>,
                    ["curve", "a"],
                    {
                      topic: "shape parameter a",
                      help: (
                        <>
                          Use <var>a</var> as an adjustable coefficient in your
                          curve, for example <code>a*cos(t)</code>, then animate
                          it. Expressions without a are unaffected.
                        </>
                      ),
                      name: "Shape parameter a",
                    },
                  )}
                <details {...expressions}>
                  <summary>Expression reference</summary>
                  <p>
                    Use explicit multiplication: <code>2*cos(t)</code>. Supports
                    + − * / ^, parentheses, pi, e, phi, sin, cos, tan, asin,
                    acos, atan, sinh, cosh, tanh, sech, exp, log, ln, sqrt, abs.
                    Angles are radians. Use <var>t</var> (or <var>x</var> for a
                    graph), and <var>a</var> for an adjustable shape
                    coefficient. A vector field uses <var>x</var>, <var>y</var>,
                    and <var>t</var>; an implicit curve uses <var>x</var> and{" "}
                    <var>y</var>. Bounds, numeric parameters such as radii and
                    phases, and animation endpoints accept constant expressions
                    such as 2*pi or -phi; they cannot contain <var>t</var>,{" "}
                    <var>x</var>,<var>y</var>, or <var>a</var>.
                  </p>
                  <p>
                    <code>pi ≈ 3.1415926536</code> · circle constant
                    <br />
                    <code>e ≈ 2.7182818285</code> · natural logarithm base
                    <br />
                    <code>phi ≈ 1.6180339887</code> · golden ratio, (1+√5)/2
                  </p>
                </details>
                {!unparametrized && (
                  <>
                    <Field
                      label="Construct on"
                      topic="construction input"
                      help="The construction acts on this curve: the curve itself, or a curve derived from it, which is drawn faintly with it. A derived curve is evaluated from the curve's definition at every t, never from its drawn points. Its evolute cannot feed the evolute or the caustics, which would need the curve's fourth derivative."
                    >
                      <select
                        value={config.input}
                        onChange={(e) =>
                          update({ input: e.target.value as ConstructionInput })
                        }
                      >
                        {(Object.keys(inputOptions) as ConstructionInput[]).map(
                          (k) => (
                            <option
                              key={k}
                              value={k}
                              disabled={!inputAllowed(config.kind, k)}
                            >
                              {inputOptions[k]}
                            </option>
                          ),
                        )}
                      </select>
                    </Field>
                    {usesPole(config.input) && !usesPole(config.kind) && (
                      <div className="pair">
                        {scalar("Pole x", ["pole", "x"])}
                        {scalar("Pole y", ["pole", "y"])}
                      </div>
                    )}
                    {config.input === "offset" &&
                      (config.kind !== "offset" || config.stack.enabled) &&
                      scalar("Offset distance d", ["distance"], {
                        topic: "offset distance",
                        help: "Signed distance along the left normal, within ±100,000. Positive values move to the left of travel.",
                      })}
                  </>
                )}
              </section>
              {!unparametrized && usesPole(config.kind) && (
                <section>
                  <div className="section-label">03 / THE POLE</div>
                  <Field label="Projection">
                    <select
                      value={config.kind}
                      onChange={(e) => {
                        const kind = e.target.value as PoleKind;
                        setPoleKind(kind);
                        update({ kind });
                      }}
                    >
                      {(Object.keys(poleOptions) as PoleKind[]).map((k) => (
                        <option key={k} value={k}>
                          {poleOptions[k].label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <p className="note">
                    {poleOptions[config.kind].note} The pole is independent of
                    the light source and can lie on the curve.
                  </p>
                  <div className="pair">
                    {scalar("Pole x", ["pole", "x"])}
                    {scalar("Pole y", ["pole", "y"])}
                  </div>
                </section>
              )}
              {optical && (
                <section>
                  <div className="section-label">03 / THE LIGHT</div>
                  <Field label="Source">
                    <select
                      value={config.source.kind}
                      onChange={(e) =>
                        update((c) => ({
                          source: {
                            ...c.source,
                            kind: e.target.value as "point" | "parallel",
                          },
                        }))
                      }
                    >
                      <option value="point">Point source</option>
                      <option value="parallel">
                        At infinity · parallel rays
                      </option>
                    </select>
                  </Field>
                  {config.source.kind === "point" && (
                    <Field
                      label="Source coordinates"
                      help={
                        config.source.coordinates === "polar"
                          ? "Radius r ≥ 0 is the distance from the origin. Angle θ is in radians, counterclockwise from +x; animate it from 0 to pi/2 for a quarter orbit. Angles are not wrapped."
                          : undefined
                      }
                    >
                      <select
                        value={config.source.coordinates ?? "cartesian"}
                        onChange={(e) => {
                          const coordinates = e.target.value as
                            "cartesian" | "polar";
                          setPreset("custom");
                          // Convert the coordinates just entered, not those
                          // from before Go finished evaluating them.
                          void scalarStatus.resolved().then(() =>
                            setConfig((c) => {
                              const position =
                                c.source.coordinates === "polar"
                                  ? {
                                      x:
                                        (c.source.radius ?? 0) *
                                        Math.cos(c.source.theta ?? 0),
                                      y:
                                        (c.source.radius ?? 0) *
                                        Math.sin(c.source.theta ?? 0),
                                    }
                                  : c.source.position;
                              return {
                                ...c,
                                source: {
                                  ...c.source,
                                  coordinates,
                                  position,
                                  radius: Math.hypot(position.x, position.y),
                                  theta: Math.atan2(position.y, position.x),
                                },
                              };
                            }),
                          );
                        }}
                      >
                        <option value="cartesian">Cartesian · x, y</option>
                        <option value="polar">Polar · r, θ</option>
                      </select>
                    </Field>
                  )}
                  {config.source.kind === "point" &&
                  config.source.coordinates === "polar" ? (
                    <div className="pair">
                      {scalar("Source radius r", ["source", "radius"])}
                      {scalar("Source theta θ (radians)", ["source", "theta"])}
                    </div>
                  ) : config.source.kind === "point" ? (
                    <div className="pair">
                      {scalar("Source x", ["source", "position", "x"])}
                      {scalar("Source y", ["source", "position", "y"])}
                    </div>
                  ) : (
                    scalar("Travel direction (degrees)", ["source", "angle"])
                  )}
                  {config.source.kind === "parallel" && (
                    <p className="note">0° travels right; 90° travels up.</p>
                  )}
                  {config.kind === "diacaustic" && (
                    <>
                      <div className="pair">
                        {scalar("Incident index n₁", ["nIncident"])}
                        {scalar("Transmitted n₂", ["nTransmitted"])}
                      </div>
                      <p className="note">
                        Ratio n₁/n₂ ={" "}
                        {(config.nIncident / config.nTransmitted).toFixed(3)}.
                        Each ray crosses once.
                      </p>
                      <details {...indices}>
                        <summary>How the refractive indices work</summary>
                        <p>
                          The incident index n₁ describes the medium light is
                          leaving; transmitted index n₂ describes the medium it
                          enters. The index is the ratio of the speed of light
                          in vacuum to its phase speed in that medium. Familiar
                          examples are air ≈ 1, water ≈ 1.33, and glass ≈ 1.5;
                          real values depend on material and wavelength.
                        </p>
                        <p>
                          Snell’s law is n₁ sin θ₁ = n₂ sin θ₂, with angles
                          measured from the normal. If n₂ is larger, light bends
                          toward the normal; if smaller, it bends away. Equal
                          indices leave the direction unchanged. When n₁ &gt; n₂
                          and the incident angle exceeds asin(n₂/n₁), there is
                          total internal reflection: amber reflected rays
                          replace transmitted rays at those samples.
                        </p>
                        <p>
                          This explorer accepts any finite decimal from{" "}
                          <strong>0.01 through 10</strong>, inclusive, for
                          either index. These are computational limits, not a
                          claim that every value represents ordinary
                          visible-light glass. There is no 0.05-step
                          restriction: 1.333 is valid. The construction uses the
                          ratio n₁/n₂, so scaling both equally gives the same
                          ray directions.
                        </p>
                      </details>
                    </>
                  )}
                </section>
              )}
              {!unparametrized && config.kind === "offset" && (
                <section>
                  <div className="section-label">03 / THE OFFSET</div>
                  <Field label="Offsets">
                    <select
                      value={config.stack.enabled ? "stack" : "single"}
                      onChange={(e) =>
                        update((c) => ({
                          stack: {
                            ...c.stack,
                            enabled: e.target.value === "stack",
                          },
                        }))
                      }
                    >
                      <option value="single">One offset</option>
                      <option value="stack">A stack of offsets</option>
                    </select>
                  </Field>
                  {config.stack.enabled ? (
                    <>
                      <div className="pair">
                        {scalar("First offset distance", ["stack", "from"], {
                          topic: "offset stack distances",
                          help: "The stack runs evenly from the first distance to the last, both included, each within ±100,000. Positive values move to the left of travel.",
                        })}
                        {scalar("Last offset distance", ["stack", "to"])}
                      </div>
                      {number(
                        "Number of offsets",
                        config.stack.count,
                        (count) =>
                          update((c) => ({ stack: { ...c.stack, count } })),
                        {
                          step: 1,
                          min: 2,
                          max: 64,
                          help: "Whole numbers from 2 to 64. Offsets × samples may not exceed 131,072.",
                        },
                      )}
                    </>
                  ) : (
                    scalar("Offset distance d", ["distance"], {
                      topic: "offset distance",
                      help: "Signed distance along the left normal, within ±100,000. Positive values move to the left of travel, which is inward on a counterclockwise closed curve. Negative values move to the right.",
                    })
                  )}
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={config.circles}
                      onChange={(e) => update({ circles: e.target.checked })}
                    />
                    Generating circles
                  </label>
                  <p className="note">
                    Circles have the largest distance as their radius. Cusps and
                    self-crossings are part of the offset, not errors: it is the
                    full parallel curve, not a trimmed outline.
                  </p>
                </section>
              )}
              {!unparametrized && config.kind === "rolling" && (
                <section>
                  <div className="section-label">
                    03 / THE ROLLING{" "}
                    {config.rolling.shape === "curve" ? "CURVE" : "CIRCLE"}
                  </div>
                  <div className="pair">
                    <Field label="Rolling shape">
                      <select
                        value={config.rolling.shape}
                        onChange={(e) =>
                          update((c) => ({
                            rolling: {
                              ...c.rolling,
                              shape: e.target.value as "circle" | "curve",
                            },
                          }))
                        }
                      >
                        <option value="circle">Circle</option>
                        <option value="curve">Curve · x(t), y(t)</option>
                      </select>
                    </Field>
                    <Field label="Side of the curve">
                      <select
                        value={config.rolling.side}
                        onChange={(e) =>
                          update((c) => ({
                            rolling: {
                              ...c.rolling,
                              side: e.target.value as "left" | "right",
                            },
                          }))
                        }
                      >
                        <option value="left">Left of travel</option>
                        <option value="right">Right of travel</option>
                      </select>
                    </Field>
                  </div>
                  {config.rolling.shape === "curve" ? (
                    <>
                      {(["x", "y"] as const).map((key) => (
                        <Field
                          key={key}
                          label={`Rolling ${key}(t)`}
                          className="equation"
                          topic={key === "x" ? "rolling curve" : undefined}
                          help={
                            key === "x"
                              ? "The rolling curve in its own frame, in t (and a). It is placed on the base so the two stay tangent at the contact, with equal arc lengths rolled on each."
                              : undefined
                          }
                        >
                          <input
                            value={config.rolling.curve[key]}
                            onChange={(e) => {
                              const text = e.target.value;
                              update((c) => ({
                                rolling: {
                                  ...c.rolling,
                                  curve: { ...c.rolling.curve, [key]: text },
                                },
                              }));
                            }}
                            spellCheck={false}
                          />
                        </Field>
                      ))}
                      <div className="pair">
                        {scalar("Rolling t from", ["rolling", "curve", "min"])}
                        {scalar("Rolling t to", ["rolling", "curve", "max"])}
                      </div>
                      {scalar(
                        "Contact starts at t",
                        ["rolling", "curve", "start"],
                        {
                          topic: "rolling curve start",
                          help: "The rolling curve's point that touches the base at its domain start. On the left the contact runs toward the end of the rolling curve's domain; on the right, toward its start.",
                        },
                      )}
                      <div className="pair">
                        {scalar("Tracing point x", ["rolling", "point", "x"], {
                          topic: "rolling curve tracing point",
                          help: "A point fixed to the rolling curve, in the same frame as x(t), y(t); within ±100,000.",
                        })}
                        {scalar("Tracing point y", ["rolling", "point", "y"])}
                      </div>
                      <p className="note">
                        On the left, the rolling curve's own left side faces the
                        base's left; on the right, its left side faces the
                        base's right. For a counterclockwise closed curve its
                        left is its inside. A closed rolling curve wraps around;
                        an open one, or one with a cusp, stops there. Overlaps
                        are part of the roulette, not collisions.
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="pair">
                        {scalar("Circle radius ρ", ["rolling", "radius"], {
                          topic: "rolling circle radius",
                          help: "Positive and at most 100,000.",
                        })}
                        {scalar("Tracing distance ℓ", ["rolling", "arm"], {
                          topic: "rolling tracing distance",
                          help: "Distance of the tracing point from the circle's center, 0–100,000. ℓ = ρ traces the rim, with cusps on the curve; larger values give loops.",
                        })}
                      </div>
                      {scalar("Phase ψ (radians)", ["rolling", "phase"], {
                        topic: "rolling phase",
                        help: "At the domain start the tracing arm points at the contact; the phase turns it counterclockwise by ψ radians.",
                      })}
                      <p className="note">
                        On a counterclockwise closed curve the left is the
                        inside. The circle rolls from the domain start and stops
                        at a cusp. Where it is larger than the curve's radius of
                        curvature, or the curve comes back near itself, it
                        overlaps the curve: this is the mathematical roulette,
                        not a collision.
                      </p>
                    </>
                  )}
                </section>
              )}
              {!unparametrized && config.kind === "envelope" && (
                <section>
                  <div className="section-label">03 / THE FAMILY</div>
                  <Field label="Family">
                    <select
                      value={config.envelope.mode}
                      onChange={(e) =>
                        update((c) => ({
                          envelope: {
                            ...c.envelope,
                            mode: e.target.value as
                              "angle" | "chord" | "circle",
                          },
                        }))
                      }
                    >
                      <option value="chord">Chords to a second point</option>
                      <option value="angle">
                        Lines turned to an angle θ(t)
                      </option>
                      <option value="circle">Circles of radius R(t)</option>
                    </select>
                  </Field>
                  {config.envelope.mode === "circle" ? (
                    <>
                      <Field
                        label="Circle radius R(t)"
                        className="equation"
                        topic="circle radius"
                        help="Positive, in t (and a). Each circle is centered on the curve's point at t; where the radius is not positive there is no circle."
                      >
                        <input
                          value={config.envelope.radius}
                          onChange={(e) => {
                            const radius = e.target.value;
                            update((c) => ({
                              envelope: { ...c.envelope, radius },
                            }));
                          }}
                          spellCheck={false}
                        />
                      </Field>
                      <p className="note">
                        Each circle is drawn with its radii to the touching
                        points. Where |R′| exceeds the curve's speed the circles
                        nest, and the envelope has gaps; a stationary center has
                        no envelope point.
                      </p>
                    </>
                  ) : config.envelope.mode === "chord" ? (
                    <>
                      {(["x", "y"] as const).map((key) => (
                        <Field
                          key={key}
                          label={`Second point ${key}(t)`}
                          className="equation"
                          topic={key === "x" ? "second point" : undefined}
                          help={
                            key === "x"
                              ? "The chord's other endpoint, in t (and a), over the curve's domain. With x = cos(a*t), y = sin(a*t) on the unit circle, animate a for the multiplication tables."
                              : undefined
                          }
                        >
                          <input
                            value={config.envelope[key]}
                            onChange={(e) => {
                              const text = e.target.value;
                              update((c) => ({
                                envelope: { ...c.envelope, [key]: text },
                              }));
                            }}
                            spellCheck={false}
                          />
                        </Field>
                      ))}
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={config.envelope.extend}
                          onChange={(e) => {
                            const extend = e.target.checked;
                            update((c) => ({
                              envelope: { ...c.envelope, extend },
                            }));
                          }}
                        />
                        Extend chords to full lines
                      </label>
                      <p className="note">
                        Where the two endpoints coincide the chord has no
                        direction, and the envelope has a gap.
                      </p>
                    </>
                  ) : (
                    <>
                      <Field
                        label="Direction angle θ(t)"
                        className="equation"
                        topic="direction angle"
                        help="In radians, counterclockwise from +x, in t (and a). Each line passes through the curve's point at t. A turn by exactly pi gives the same line."
                      >
                        <input
                          value={config.envelope.angle}
                          onChange={(e) => {
                            const angle = e.target.value;
                            update((c) => ({
                              envelope: { ...c.envelope, angle },
                            }));
                          }}
                          spellCheck={false}
                        />
                      </Field>
                      <p className="note">
                        Lines are unbounded and drawn across the view. Parallel
                        neighbours meet at infinity, so the envelope has gaps
                        there.
                      </p>
                    </>
                  )}
                </section>
              )}
              {!unparametrized && config.kind === "inversion" && (
                <section>
                  <div className="section-label">03 / THE INVERSION</div>
                  <div className="pair">
                    {scalar("Inversion center x", ["inversion", "center", "x"])}
                    {scalar("Inversion center y", ["inversion", "center", "y"])}
                  </div>
                  {scalar("Inversion radius R", ["inversion", "radius"], {
                    topic: "inversion radius",
                    help: "Positive, at most 100,000. Points at distance R from the center stay fixed; the product of a point's distance and its image's is R².",
                  })}
                  <p className="note">
                    {config.input === "curve"
                      ? "Each segment joins a point of the curve to its image, along a ray from the center."
                      : "Each segment joins a point of the curve's " +
                        config.input +
                        " to its image, along a ray from the center."}{" "}
                    The image is left open where it runs off to infinity.
                  </p>
                </section>
              )}
              {!unparametrized && config.kind === "involute" && (
                <section>
                  {scalar("Initial string offset c", ["offset"], {
                    topic: "initial string offset",
                    help: "Arc length starts at the domain minimum. The offset selects a member of the involute family.",
                  })}
                </section>
              )}
              <section>
                <div className="section-label">
                  {!unparametrized &&
                  (optical ||
                    usesPole(config.kind) ||
                    config.kind === "offset" ||
                    config.kind === "rolling" ||
                    config.kind === "envelope" ||
                    config.kind === "inversion")
                    ? "04"
                    : "03"}{" "}
                  / THE DRAWING
                </div>
                {number(
                  "Construction lines",
                  config.lines,
                  (n) => update({ lines: n }),
                  {
                    step: 1,
                    min: 2,
                    max: Math.min(2048, config.samples),
                    help: "Whole numbers from 2 to 2,048, no more than the samples. Dense drawings slow interaction and export.",
                  },
                )}
                {optical && (
                  <Field label="Ray length" value={`${length.toFixed(1)}×`}>
                    <input
                      type="range"
                      min=".1"
                      max="3"
                      step=".1"
                      value={length}
                      onChange={(e) => setLength(+e.target.value)}
                    />
                  </Field>
                )}
                <div className="layer-grid">
                  {(Object.keys(layers) as (keyof Layers)[])
                    .filter(
                      (k) =>
                        (optical ||
                          (k === "virtual" && chords) ||
                          !["incident", "virtual"].includes(k)) &&
                        !(attractor && k === "derived"),
                    )
                    .map((k) => (
                      <label className="check" key={k}>
                        <input
                          type="checkbox"
                          checked={layers[k]}
                          onChange={(e) =>
                            setLayers({ ...layers, [k]: e.target.checked })
                          }
                        />
                        {
                          {
                            base: implicit
                              ? "Curve F = c"
                              : attractor
                                ? "Visit density"
                                : "Base curve",
                            derived: implicit
                              ? "Other levels"
                              : "Derived curve",
                            lines: "Construction lines",
                            incident: "Incident rays",
                            virtual: "Virtual extensions",
                            axes: "Grid & axes",
                          }[k]
                        }
                      </label>
                    ))}
                </div>
                <LineWeightField value={weight} onChange={setWeight} />
                {!unparametrized &&
                  number(
                    "Numerical samples",
                    config.samples,
                    (n) => update({ samples: n }),
                    { step: 1, min: 64, max: 32768, help: samplesHelp },
                  )}
                {refinable && (
                  <RefineBetweenSamples
                    checked={!!config.adaptive}
                    onChange={(adaptive) => update({ adaptive })}
                    refined={
                      result?.adaptive && Object.values(result.adaptive).flat()
                    }
                  />
                )}
              </section>
            </FieldErrorContext.Provider>
            {error && !claimedHere && <StudyError message={error} />}
            <PlanarProbePanel
              config={config}
              frame={
                // While an animation holds or moves the probe, the readout
                // describes the frame it shows.
                animation?.probe !== undefined
                  ? animation.frame
                  : probing && !busy
                    ? frame
                    : null
              }
              probe={probe}
              onProbe={setProbe}
              animating={!!animation && !animation.complete}
              at={animation?.probe}
              away={animation?.probeAway}
              dark={dark}
            />
            <AnimationPanel
              getCurrentView={() => manualView.current}
              dark={dark}
              layers={layers}
              weight={weight}
              probe={probing ? probe : null}
              frame={frame}
              client={client}
              length={length}
              revision={JSON.stringify([
                config,
                bounds,
                length,
                active,
                probing,
              ])}
              disabled={busy || !!error}
              onView={setAnimation}
              onRunning={setAnimationRunning}
              onPlay={revealPlot}
              settings={animationSettings}
              restore={busy ? null : restoredAnimation}
            />
          </aside>
        </ScalarStatus.Provider>
        <article>
          <div className="plot-heading">
            <div>
              <div className="eyebrow">
                {preset === "custom"
                  ? "YOUR OWN EXPLORATION"
                  : presets[+preset].note}
              </div>
              <h1>{info.title}</h1>
            </div>
            <button
              className="fit"
              disabled={!!animation && !animation.complete}
              onClick={() =>
                animation ? setRefit(refit + 1) : setReset(reset + 1)
              }
            >
              ↔ Fit view
            </button>
          </div>
          <div
            className="plot-wrap"
            ref={plotWrap}
            aria-busy={busy}
            // The probe while it is on, as an example's fingerprint records
            // it (examples/index.ts).
            data-probe={probing ? JSON.stringify(probe) : undefined}
          >
            {result && shown ? (
              <Plot
                onViewport={(view) => {
                  manualView.current = view;
                }}
                initialCamera={restoredCamera}
                onCamera={(c) => {
                  camera.current = c;
                }}
                result={result}
                config={shown.config}
                layers={layers}
                weight={weight}
                probe={
                  probing && result
                    ? (probeSample(result, probe) ?? undefined)
                    : undefined
                }
                dark={dark}
                length={animation?.length ?? length}
                reset={reset}
                refit={refit}
                animation={animation}
              />
            ) : (
              <div className="loading">
                {error
                  ? "Check the study definition to begin."
                  : "Preparing the numerical engine…"}
              </div>
            )}
            {frame && error && (
              <span className="stale-study">Previous valid study</span>
            )}
            {busy && result && <span className="computing">Computing…</span>}
            <div className="plot-meta">
              <div className="legend">
                <LegendEntries
                  entries={[
                    {
                      key: "base",
                      shown: drawn.base,
                      content: (
                        <>
                          <span className="base-dot" />
                          {drawnFormat === "implicit"
                            ? "Curve F = c"
                            : drawnFormat === "attractor"
                              ? "Visit density"
                              : "Base curve"}
                        </>
                      ),
                    },
                    ...(drawnFormat === "attractor"
                      ? []
                      : [
                          {
                            key: "derived",
                            shown: drawn.derived,
                            content: (
                              <>
                                <span className="derived-dot" />
                                {drawnFormat === "implicit"
                                  ? "Other levels"
                                  : (shown?.config ?? config).kind}
                              </>
                            ),
                          },
                        ]),
                  ]}
                />
              </div>
              <span>
                {animation?.complete
                  ? "Drag to pan · scroll or pinch to zoom · keys: arrows, + / −, Home · Back to study restores your study"
                  : animation
                    ? "Animation camera · Stop restores manual framing"
                    : "Drag to pan · scroll or pinch to zoom · keys: arrows, + / −, Home"}
              </span>
            </div>
          </div>
          {!narrow && behind}
        </article>
        {narrow && <div className="behind">{behind}</div>}
      </main>
    </div>
  );
}
const SpatialApp = lazy(() => import("./spatial/SpatialApp"));
const TesseractApp = lazy(() => import("./tesseract/App"));
type NotebookKind = "2d" | "3d" | "4d";
const notebookKind = (): NotebookKind => {
  const study = new URLSearchParams(location.search).get("study");
  return study === "3d" || study === "4d" ? study : "2d";
};
function Notebook() {
  const focusRequest = useRef<FocusRequest>(false);
  const initial = notebookKind();
  const [mode, setMode] = useState<NotebookKind>(initial);
  const [seen, setSeen] = useState({
    "2d": initial === "2d",
    "3d": initial === "3d",
    "4d": initial === "4d",
  });
  const show = (next: NotebookKind) => {
    setSeen((s) => ({ ...s, [next]: true }));
    setMode(next);
  };
  const choose = (next: NotebookKind, via: "keyboard" | "pointer") => {
    if (next === mode) return;
    focusRequest.current = via;
    show(next);
    const url = new URL(location.href);
    if (next === "2d") url.searchParams.delete("study");
    else url.searchParams.set("study", next);
    history.pushState(null, "", url);
  };
  useEffect(() => {
    const pop = () => show(notebookKind());
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  // A study link in the fragment opens in its notebook. The fragment is then
  // removed, so later edits never sit under a link to the original.
  const [shared, setShared] = useState<
    Partial<Record<NotebookKind, SharedStudy>>
  >({});
  const links = useRef(0);
  useEffect(() => {
    const receive = async () => {
      const token = linkToken(location.hash);
      if (token === null) return;
      const id = ++links.current;
      let next: { notebook: NotebookKind; link: SharedStudy };
      try {
        const { notebook, study } = await readStudyLink(token);
        next = { notebook, link: { id, study } };
      } catch (e) {
        const error =
          e instanceof LinkError ? e.message : "This link could not be read.";
        next = { notebook: notebookKind(), link: { id, error } };
      }
      // A later link replaces one still being read.
      if (id !== links.current) return;
      const url = new URL(location.href);
      url.hash = "";
      if (next.notebook === "2d") url.searchParams.delete("study");
      else url.searchParams.set("study", next.notebook);
      history.replaceState(null, "", url);
      show(next.notebook);
      setShared((s) => ({ ...s, [next.notebook]: next.link }));
    };
    void receive();
    window.addEventListener("hashchange", receive);
    return () => window.removeEventListener("hashchange", receive);
  }, []);
  return (
    <NotebookContext.Provider value={{ mode, choose, focusRequest }}>
      {seen["2d"] && (
        <div hidden={mode !== "2d"}>
          <App active={mode === "2d"} shared={shared["2d"]} />
        </div>
      )}
      {seen["3d"] && (
        <div hidden={mode !== "3d"}>
          <Suspense
            fallback={
              <div className="loading">Opening the spatial notebook…</div>
            }
          >
            <SpatialApp active={mode === "3d"} shared={shared["3d"]} />
          </Suspense>
        </div>
      )}
      {seen["4d"] && (
        <div hidden={mode !== "4d"}>
          <Suspense
            fallback={
              <div className="loading">Opening the fourth dimension…</div>
            }
          >
            <TesseractApp active={mode === "4d"} shared={shared["4d"]} />
          </Suspense>
        </div>
      )}
    </NotebookContext.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<Notebook />);
