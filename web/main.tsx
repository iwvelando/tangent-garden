import { NotebookContext, NotebookMode } from "./NotebookMode";
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { presets } from "./presets";
import { Plot, type Layers } from "./Plot";
import {
  isHarmonic,
  maxTerms,
  maxPursuers,
  ownsShape,
  usesPole,
  type Bounds,
  type Config,
  type Frame,
  type InversionSource,
  type Kind,
  type PoleKind,
  type Roll,
} from "./types";
import { EngineClient, boundText } from "./engine-client";
import { useTheme } from "./useTheme";
import { AnimationPanel } from "./AnimationPanel";
import { ExportImageMenu } from "./ExportImageMenu";
import { Field, HelpText, HelpToggle, useHelp } from "./Field";
import { ScalarInput, ScalarStatus, type ScalarState } from "./ScalarInput";
import { closureKey, closureNote, nextTerm, periodText } from "./harmonic";
import { captureNote, nextPursuer, regularPolygon } from "./pursuit";
import { pursuerLabels, termLabels } from "./animation";
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
const inversionOptions: Record<InversionSource, string> = {
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
function App({ active }: { active: boolean }) {
  const [config, setConfig] = useState<Config>(presets[0].config);
  const [preset, setPreset] = useState("0");
  // Remembers the pole construction while another tab is selected.
  const [poleKind, setPoleKind] = useState<PoleKind>("pedal");
  const [frame, setFrame] = useState<Frame | null>(null);
  const [bounds, setBounds] = useState<Bounds>({
    min: boundText(config.curve.min),
    max: boundText(config.curve.max),
  });
  const [expert, setExpert] = useState(false);
  const [animation, setAnimation] = useState<AnimationView | null>(null);
  const [animationRunning, setAnimationRunning] = useState(false);
  const [computeError, setError] = useState("");
  const [settledKey, setSettledKey] = useState("");
  const requestKey = JSON.stringify([config, bounds]);
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
      : computeError;
  const { dark, preference, toggle, followSystem } = useTheme();
  const [reset, setReset] = useState(0);
  const [length, setLength] = useState(0.8);
  const [layers, setLayers] = useState<Layers>({
    base: true,
    derived: true,
    lines: true,
    incident: true,
    virtual: true,
    axes: false,
  });
  const modeHelp = useHelp();
  const narrow = useMediaQuery("(max-width: 700px)");
  const expressions = useDisclosure("expressions");
  const indices = useDisclosure("indices");
  const diagnostics = useDisclosure("diagnostics");
  const samplesHelp =
    "More samples trace the curve more finely and take longer to compute; they do not raise numerical precision on their own." +
    (expert ? " Whole numbers from 64 to 32,768." : "");
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
  // On narrow screens the controls sit below the drawing, so playback started
  // from them would otherwise run out of sight. Wide layouts keep the drawing
  // in view already and are left untouched.
  const revealPlot = () => {
    const plot = plotWrap.current;
    if (!plot) return;
    // A docked playback bar covers the bottom of the screen.
    const bar = document.getElementById("playback");
    const limit =
      bar && getComputedStyle(bar).position === "fixed"
        ? bar.getBoundingClientRect().top
        : window.innerHeight;
    const { top, bottom } = plot.getBoundingClientRect();
    if (top >= 0 && bottom <= limit) return;
    plot.scrollIntoView({
      block: "start",
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  };
  useEffect(() => {
    const engine = new EngineClient();
    client.current = engine;
    return () => engine.dispose();
  }, []);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      client
        .current!.compute(config, bounds)
        .then((next) => {
          if (cancelled) return;
          setFrame(next);
          setError("");
          setSettledKey(requestKey);
        })
        .catch((reason) => {
          if (cancelled) return;
          setFrame(null);
          setError(reason.message);
          setSettledKey(requestKey);
        });
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [config, bounds]);
  const shown = animation?.frame ?? frame;
  const result = shown?.result;
  const optical = config.kind === "catacaustic" || config.kind === "diacaustic";
  // Chords that are not extended have envelope points beyond the segments.
  const chords =
    config.kind === "envelope" &&
    config.envelope.mode === "chord" &&
    !config.envelope.extend;
  const info =
    config.kind === "offset" && config.stack.enabled
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
  // On phones the controls follow the drawing directly, so the explanation
  // moves after them instead of separating the two.
  const behind = (
    <>
      <div className="explanation">
        <div>
          <span className="section-label">BEHIND THE LINES</span>
          <p>{info.description}</p>
        </div>
        <div className="formula">{info.formula}</div>
      </div>
      {result?.warnings.length !== 0 && result && (
        <details className="diagnostics" {...diagnostics}>
          <summary>Numerical notes · {result.invalid} omitted samples</summary>
          {result.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </details>
      )}
      <p className="bottom-note">
        {optical
          ? "A mathematical ray family: every sampled point participates. No occlusion or multiple bounces."
          : "The connecting lines reveal the geometry of the construction."}{" "}
        Finite sampling can miss fine detail; compare resolutions near
        singularities.
      </p>
      <p className="closing">An open notebook for mathematical beauty.</p>
    </>
  );
  return (
    <div
      className={dark ? "app dark" : "app"}
      data-theme-preference={preference}
    >
      <header>
        <a className="brand" href="./">
          <img
            className="brand-symbol"
            src={`${import.meta.env.BASE_URL}tangent-garden.svg`}
            alt=""
          />
          <span className="brand-name">Tangent Garden</span>
          <span className="brand-divider" />{" "}
          <small>CURVES & CONSTRUCTIONS</small>
        </a>
        <div className="header-actions">
          <NotebookMode />
          <span className="local-note">
            A little geometry. A lot of beauty.
          </span>
          <button
            onClick={toggle}
            title={
              preference === "system"
                ? "Following your system theme. Click to choose a fixed theme."
                : "Your theme choice is saved in this browser."
            }
            aria-label={dark ? "Use light background" : "Use dark background"}
          >
            {dark ? "☼" : "◐"}
          </button>
          {preference !== "system" && (
            <button
              className="system-theme"
              onClick={followSystem}
              title="Follow system changes, including time-of-day changes"
            >
              Follow system
            </button>
          )}
          <ExportImageMenu
            disabled={!result || busy || !!error || animationRunning}
            kind={config.kind}
          />
        </div>
      </header>
      <main>
        <ScalarStatus.Provider value={scalarStatus}>
          <aside aria-label="Study parameters">
            <div className="section-label">01 / THE STUDY</div>
            <Field label="Start with a notebook example">
              <select
                value={preset}
                onChange={(e) => {
                  setPreset(e.target.value);
                  scalarGeneration.current++;
                  const next = presets[+e.target.value].config;
                  if (usesPole(next.kind)) setPoleKind(next.kind);
                  setConfig(structuredClone(next));
                  setBounds({
                    min: boundText(presets[+e.target.value].config.curve.min),
                    max: boundText(presets[+e.target.value].config.curve.max),
                  });
                  setReset(reset + 1);
                }}
              >
                {preset === "custom" && (
                  <option value="custom">Custom study</option>
                )}
                {presets.map((p, i) => (
                  <option key={p.title} value={i}>
                    {p.title}
                  </option>
                ))}
              </select>
            </Field>
            <fieldset className="mode-switch" aria-labelledby="controls-legend">
              <legend>
                <span id="controls-legend">Controls</span>
                <HelpToggle topic="control modes" help={modeHelp} />
              </legend>
              <div className="mode-options">
                {[false, true].map((value) => (
                  <label key={String(value)}>
                    <input
                      type="radio"
                      name="controls-mode"
                      checked={expert === value}
                      onChange={() => setExpert(value)}
                    />
                    {value ? "Expert mode" : "Simple mode"}
                  </label>
                ))}
              </div>
              <HelpText help={modeHelp}>
                Simple mode offers presets and sliders. Expert mode takes exact
                whole numbers: 64–32,768 samples and 2–2,048 construction lines,
                never more lines than samples. Larger values take longer to
                compute and draw.
              </HelpText>
            </fieldset>
            <div className="tabs" role="group" aria-label="Construction">
              {tabs.map((k) => {
                const active =
                  config.kind === k || (k === "pedal" && usesPole(config.kind));
                return (
                  <button
                    className={active ? "active" : ""}
                    aria-pressed={active}
                    key={k}
                    onClick={() =>
                      !active && update({ kind: k === "pedal" ? poleKind : k })
                    }
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
                          : harmonic || config.curve.format === "pursuit"
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
                  Use explicit multiplication: <code>2*cos(t)</code>. Supports +
                  − * / ^, parentheses, pi, e, phi, sin, cos, tan, asin, acos,
                  atan, sinh, cosh, tanh, sech, exp, log, ln, sqrt, abs. Angles
                  are radians. Use <var>t</var> (or <var>x</var> for a graph),
                  and <var>a</var> for an adjustable shape coefficient. Bounds,
                  numeric parameters such as radii and phases, and animation
                  endpoints accept constant expressions such as 2*pi or -phi;
                  they cannot contain <var>t</var>, <var>x</var>, or
                  <var>a</var>.
                </p>
                <p>
                  <code>pi ≈ 3.1415926536</code> · circle constant
                  <br />
                  <code>e ≈ 2.7182818285</code> · natural logarithm base
                  <br />
                  <code>phi ≈ 1.6180339887</code> · golden ratio, (1+√5)/2
                </p>
              </details>
            </section>
            {usesPole(config.kind) && (
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
                  {poleOptions[config.kind].note} The pole is independent of the
                  light source and can lie on the curve.
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
                        enters. The index is the ratio of the speed of light in
                        vacuum to its phase speed in that medium. Familiar
                        examples are air ≈ 1, water ≈ 1.33, and glass ≈ 1.5;
                        real values depend on material and wavelength.
                      </p>
                      <p>
                        Snell’s law is n₁ sin θ₁ = n₂ sin θ₂, with angles
                        measured from the normal. If n₂ is larger, light bends
                        toward the normal; if smaller, it bends away. Equal
                        indices leave the direction unchanged. When n₁ &gt; n₂
                        and the incident angle exceeds asin(n₂/n₁), there is
                        total internal reflection: amber reflected rays replace
                        transmitted rays at those samples.
                      </p>
                      <p>
                        This explorer accepts any finite decimal from{" "}
                        <strong>0.01 through 10</strong>, inclusive, for either
                        index. These are computational limits, not a claim that
                        every value represents ordinary visible-light glass.
                        There is no 0.05-step restriction: 1.333 is valid. The
                        construction uses the ratio n₁/n₂, so scaling both
                        equally gives the same ray directions.
                      </p>
                    </details>
                  </>
                )}
              </section>
            )}
            {config.kind === "offset" && (
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
            {config.kind === "rolling" && (
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
                      base's left; on the right, its left side faces the base's
                      right. For a counterclockwise closed curve its left is its
                      inside. A closed rolling curve wraps around; an open one,
                      or one with a cusp, stops there. Overlaps are part of the
                      roulette, not collisions.
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
                      On a counterclockwise closed curve the left is the inside.
                      The circle rolls from the domain start and stops at a
                      cusp. Where it is larger than the curve's radius of
                      curvature, or the curve comes back near itself, it
                      overlaps the curve: this is the mathematical roulette, not
                      a collision.
                    </p>
                  </>
                )}
              </section>
            )}
            {config.kind === "envelope" && (
              <section>
                <div className="section-label">03 / THE FAMILY</div>
                <Field label="Family">
                  <select
                    value={config.envelope.mode}
                    onChange={(e) =>
                      update((c) => ({
                        envelope: {
                          ...c.envelope,
                          mode: e.target.value as "angle" | "chord" | "circle",
                        },
                      }))
                    }
                  >
                    <option value="chord">Chords to a second point</option>
                    <option value="angle">Lines turned to an angle θ(t)</option>
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
            {config.kind === "inversion" && (
              <section>
                <div className="section-label">03 / THE INVERSION</div>
                <Field label="Invert">
                  <select
                    value={config.inversion.of}
                    onChange={(e) => {
                      const of = e.target.value as InversionSource;
                      update((c) => ({ inversion: { ...c.inversion, of } }));
                    }}
                  >
                    {(Object.keys(inversionOptions) as InversionSource[]).map(
                      (k) => (
                        <option key={k} value={k}>
                          {inversionOptions[k]}
                        </option>
                      ),
                    )}
                  </select>
                </Field>
                <div className="pair">
                  {scalar("Inversion center x", ["inversion", "center", "x"])}
                  {scalar("Inversion center y", ["inversion", "center", "y"])}
                </div>
                {scalar("Inversion radius R", ["inversion", "radius"], {
                  topic: "inversion radius",
                  help: "Positive, at most 100,000. Points at distance R from the center stay fixed; the product of a point's distance and its image's is R².",
                })}
                {usesPole(config.inversion.of) && (
                  <div className="pair">
                    {scalar("Pole x", ["pole", "x"])}
                    {scalar("Pole y", ["pole", "y"])}
                  </div>
                )}
                {config.inversion.of === "offset" &&
                  scalar("Offset distance d", ["distance"], {
                    topic: "offset distance",
                    help: "Signed distance along the left normal, within ±100,000. Positive values move to the left of travel.",
                  })}
                <p className="note">
                  {config.inversion.of === "curve"
                    ? "Each segment joins a point of the curve to its image, along a ray from the center."
                    : "The derived curve is drawn faintly; each segment joins one of its points to its image, along a ray from the center."}{" "}
                  The image is left open where it runs off to infinity.
                </p>
              </section>
            )}
            {config.kind === "involute" && (
              <section>
                {scalar("Initial string offset c", ["offset"], {
                  topic: "initial string offset",
                  help: "Arc length starts at the domain minimum. The offset selects a member of the involute family.",
                })}
              </section>
            )}
            <section>
              <div className="section-label">
                {optical ||
                usesPole(config.kind) ||
                config.kind === "offset" ||
                config.kind === "rolling" ||
                config.kind === "envelope" ||
                config.kind === "inversion"
                  ? "04"
                  : "03"}{" "}
                / THE DRAWING
              </div>
              {expert ? (
                number(
                  "Construction lines",
                  config.lines,
                  (n) => update({ lines: n }),
                  {
                    step: 1,
                    min: 2,
                    max: Math.min(2048, config.samples),
                    help: "Whole numbers from 2 to 2,048, no more than the samples. Dense drawings slow interaction and export.",
                  },
                )
              ) : (
                <Field label="Construction lines" value={config.lines}>
                  <input
                    type="range"
                    min={Math.min(
                      8,
                      Number.isFinite(config.lines) ? config.lines : 8,
                    )}
                    max={Math.max(
                      180,
                      Number.isFinite(config.lines) ? config.lines : 180,
                    )}
                    value={config.lines}
                    onChange={(e) => update({ lines: +e.target.value })}
                  />
                </Field>
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
                      optical ||
                      (k === "virtual" && chords) ||
                      !["incident", "virtual"].includes(k),
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
                          base: "Base curve",
                          derived: "Derived curve",
                          lines: "Construction lines",
                          incident: "Incident rays",
                          virtual: "Virtual extensions",
                          axes: "Grid & axes",
                        }[k]
                      }
                    </label>
                  ))}
              </div>
              {expert ? (
                number(
                  "Numerical samples",
                  config.samples,
                  (n) => update({ samples: n }),
                  { step: 1, min: 64, max: 32768, help: samplesHelp },
                )
              ) : (
                <Field label="Numerical samples" help={samplesHelp}>
                  <select
                    value={config.samples}
                    onChange={(e) => update({ samples: +e.target.value })}
                  >
                    {![500, 1000, 2000, 4000].includes(config.samples) && (
                      <option value={config.samples}>
                        {config.samples} · custom
                      </option>
                    )}
                    <option value="500">500 · quick study</option>
                    <option value="1000">1,000 · standard</option>
                    <option value="2000">2,000 · fine</option>
                    <option value="4000">4,000 · finest</option>
                  </select>
                </Field>
              )}
            </section>
            <AnimationPanel
              getCurrentView={() => manualView.current}
              dark={dark}
              layers={layers}
              frame={frame}
              client={client}
              length={length}
              revision={JSON.stringify([config, bounds, length, active])}
              disabled={busy || !!error}
              onView={setAnimation}
              onRunning={setAnimationRunning}
              onPlay={revealPlot}
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
              disabled={!!animation}
              onClick={() => setReset(reset + 1)}
            >
              ↔ Fit view
            </button>
          </div>
          <div className="plot-wrap" ref={plotWrap} aria-busy={busy}>
            {error ? (
              <div className="error" role="alert">
                <strong>Let’s check the definition</strong>
                <p>{error}</p>
              </div>
            ) : result && shown ? (
              <Plot
                onViewport={(view) => {
                  manualView.current = view;
                }}
                result={result}
                config={shown.config}
                layers={layers}
                dark={dark}
                length={animation?.length ?? length}
                reset={reset}
                animation={animation}
              />
            ) : (
              <div className="loading">Preparing the numerical engine…</div>
            )}
            {busy && result && <span className="computing">Computing…</span>}
            <div className="plot-meta">
              <div className="legend">
                <span className="base-dot" />
                Base curve <span className="derived-dot" /> {config.kind}
              </div>
              <span>
                {animation
                  ? "Animation camera · Stop or Reset view restores manual framing"
                  : "Drag to pan · scroll to zoom"}
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
function Notebook() {
  const initial =
    new URLSearchParams(location.search).get("study") === "3d" ? "3d" : "2d";
  const [mode, setMode] = useState<"2d" | "3d">(initial);
  const [seen, setSeen] = useState({
    "2d": initial === "2d",
    "3d": initial === "3d",
  });
  const show = (next: "2d" | "3d") => {
    setSeen((s) => ({ ...s, [next]: true }));
    setMode(next);
  };
  const choose = (next: "2d" | "3d") => {
    if (next === mode) return;
    show(next);
    const url = new URL(location.href);
    if (next === "3d") url.searchParams.set("study", "3d");
    else url.searchParams.delete("study");
    history.pushState(null, "", url);
  };
  useEffect(() => {
    const pop = () =>
      show(
        new URLSearchParams(location.search).get("study") === "3d"
          ? "3d"
          : "2d",
      );
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  return (
    <NotebookContext.Provider value={{ mode, choose }}>
      {seen["2d"] && (
        <div hidden={mode !== "2d"}>
          <App active={mode === "2d"} />
        </div>
      )}
      {seen["3d"] && (
        <div hidden={mode !== "3d"}>
          <Suspense
            fallback={
              <div className="loading">Opening the spatial notebook…</div>
            }
          >
            <SpatialApp active={mode === "3d"} />
          </Suspense>
        </div>
      )}
    </NotebookContext.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<Notebook />);
