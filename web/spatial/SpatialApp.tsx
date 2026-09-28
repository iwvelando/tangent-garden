import { StudyExplanation } from "../StudyExplanation";
import { useEffect, useMemo, useRef, useState } from "react";
import { EngineClient } from "../engine-client";
import { ScalarInput, ScalarStatus, type ScalarState } from "../ScalarInput";
import { useMediaQuery } from "../useMediaQuery";
import { useTheme } from "../useTheme";
import { useDisclosure } from "../useDisclosure";
import { Field } from "../Field";
import { AppHeader } from "../AppHeader";
import { revealDrawing } from "../revealDrawing";
import { ExportImageMenu } from "../ExportImageMenu";
import { saveFile } from "../export-image";
import { SpatialPlot } from "./SpatialPlot";
import { SpatialAnimationPanel } from "./SpatialAnimationPanel";
import { spatialPresets } from "./presets";
import { ExampleGallery } from "../ExampleGallery";
import { spatialExamples, spatialThumbnail } from "../examples";
import { animationCamera, type AnimationView } from "./animation";
import {
  maxFrameStrands,
  maxHarmonicTerms,
  usesSpatialPole,
  type FrameConfig,
  type RuledConfig,
  type HarmonicCurve,
  type SpatialConfig,
  type Frame,
} from "./types";
import {
  harmonicClosureKey,
  harmonicClosureNote,
  harmonicLabels,
  nextHarmonicTerm,
} from "./harmonic";
import { periodText } from "../harmonic";
import { frameNote } from "./frame";
import { ruledNote } from "./ruled";
import { defaultLayers, type Layers, type View } from "./renderer";
import "./spatial.css";
export default function SpatialApp({ active = true }: { active?: boolean }) {
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
  const [error, setError] = useState(""),
    [renderError, setRenderError] = useState(""),
    [imageBusy, setImageBusy] = useState(false);
  const [reset, setReset] = useState(0),
    [spinning, setSpinning] = useState(false);
  const [animation, setAnimation] = useState<AnimationView | null>(null),
    [running, setRunning] = useState(false);
  const [layers, setLayers] = useState<Layers>(defaultLayers);
  const viewport = useRef<View | undefined>(undefined),
    plotWrap = useRef<HTMLDivElement>(null),
    imageAbort = useRef<AbortController | null>(null);
  const pending = Object.values(states).some((s) => s.pending),
    scalarError = Object.values(states).find((s) => s.error);
  const key = JSON.stringify(config),
    busy = settled !== key || pending;
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
    setError("");
    if (pending || scalarError) {
      setSettled(key);
      return;
    }
    const timer = setTimeout(() => {
      client
        .current!.computeSpatial(config)
        .then((value) => {
          if (current) {
            setFrame(value);
            setSettled(key);
          }
        })
        .catch((e: Error) => {
          if (current) {
            setError(e.message);
            setSettled(key);
          }
        });
    }, 140);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [key, pending, scalarError]);
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
    setStates({});
    setPreset(index);
    setCustomOpened(spatialPresets[+index].config.format === "parametric");
    setConfig(structuredClone(spatialPresets[+index].config));
    setReset((n) => n + 1);
  };
  async function definition(format: SpatialConfig["format"]) {
    const token = generation.current;
    await Promise.allSettled([...jobs.current]);
    if (token !== generation.current) return;
    setConfig((c) => {
      if (format === "torus" || format === "harmonic") return { ...c, format };
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
  const failure = scalarError
    ? `${scalarError.name}: ${scalarError.error}`
    : error;
  const shown = animation?.frame ?? frame,
    override = animation ? animationCamera(animation) : undefined;
  const ready = !!frame && !busy && !failure && !renderError;
  async function save(format: "png" | "svg") {
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
    });
    try {
      const { imageFile } = await import("./export");
      controller.signal.throwIfAborted();
      const blob = await imageFile(
        snapshot.frame,
        snapshot.view,
        snapshot.layers,
        snapshot.dark,
        format,
        controller.signal,
      );
      controller.signal.throwIfAborted();
      saveFile(blob, `tangent-garden-spatial.${format}`);
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
  const frameResult =
    shown?.config.construction === "framed" ? shown.result.frame : undefined;
  const transported = config.frame.kind === "rotation-minimizing";
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
      {transported && (
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
      )}
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
      {transported && (
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
      )}
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
  const behind = ruled ? (
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
        <ExportImageMenu
          disabled={!ready || running || imageBusy}
          kind="spatial"
          menuId="spatial-export-image-menu"
          svgLabel="SVG · embedded 3D image"
          onSave={save}
        />
      </AppHeader>
      <main>
        <aside
          className="spatial-controls"
          aria-label="Spatial study parameters"
        >
          <div className="section-label">01 / THE STUDY</div>
          <ExampleGallery
            examples={spatialExamples}
            current={preset === "" ? null : +preset}
            onChoose={(i) => choose(String(i))}
            thumbnail={spatialThumbnail}
            dark={theme.dark}
          />
          <ScalarStatus.Provider value={scalarStatus}>
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
                </select>
              </Field>
              {config.format === "harmonic" ? (
                harmonicControls
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
                  <option value="involute">Involute · unwinding strings</option>
                  <option value="tangent-foot">Tangent-foot projection</option>
                  <option value="orthotomic">Tangent-line orthotomic</option>
                  <option value="inversion">Sphere inversion</option>
                  <option value="framed">Framed ribbon · offset strands</option>
                  <option value="ruled">
                    Ruled surface · chords & threads
                  </option>
                </select>
              </Field>
              {ruled ? (
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
              ) : (
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
            </div>
          </ScalarStatus.Provider>
          <p className="spatial-caption">
            Constant expressions welcome: pi, e, phi.
          </p>
          <fieldset className="spatial-layers">
            <legend>Reveal the construction</legend>
            {[
              ...(ruled
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
                        ["correspondences", "Correspondence segments"],
                        ["sphere", "Inversion sphere & center"],
                        ...(config.inversion.input === "base"
                          ? []
                          : ([["source", "Projection & pole"]] as const)),
                      ] as const)
                    : projection
                      ? ([
                          ["projection", projectionName],
                          ["connectors", "Perpendiculars & tangent feet"],
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
              ...(config.format === "harmonic"
                ? ([
                    ["vectors", "Vector sums"],
                    ["ellipses", "Generating ellipses"],
                  ] as const)
                : []),
            ].map(([key, label]) => (
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
          <details className="spatial-details">
            <summary>Sampling & definition</summary>
            <Field label="Curve samples">
              <input
                type="number"
                min="240"
                max="2400"
                step="1"
                value={Number.isNaN(config.samples) ? "" : config.samples}
                onChange={(e) =>
                  update((c) => ({ ...c, samples: e.target.valueAsNumber }))
                }
              />
            </Field>
            <Field
              label={
                ruled
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
            <p>
              Finite sampling can miss fine detail. Compare resolutions near
              poles, stationary points, and tight folds. Invalid samples and
              unresolved tangent or normal intervals leave gaps. Involute arc
              length uses Simpson's rule on each sample interval, as does the
              arc length that spreads a frame's twist. A transported frame is
              carried between samples by two reflections. A harmonic curve's
              vector sums sit at the same evenly spaced samples as the
              construction lines, and its derivatives are exact. A ruled
              surface's partner is evaluated at mt + δ for the same samples, and
              a second thread is differentiated like a custom curve.
            </p>
          </details>
          {failure && (
            <p className="error" role="alert">
              {failure}
            </p>
          )}
          <p className="spatial-status" role="status">
            {busy
              ? "Growing the spatial study…"
              : failure
                ? "Resolve the input to update the study."
                : `${config.samples.toLocaleString()} samples · ${config.lines} ${ruled ? "rulings" : framed ? "frames" : inversion ? "correspondences" : projection ? "projections" : involute ? "strings" : "tangents"}`}
          </p>
          <SpatialAnimationPanel
            frame={frame}
            client={client}
            length={config.length}
            revision={revision}
            disabled={!ready || !active || imageBusy}
            dark={theme.dark}
            layers={layers}
            getCurrentView={() =>
              viewport.current ? structuredClone(viewport.current) : undefined
            }
            onView={setAnimation}
            onRunning={setRunning}
            onPlay={showPlot}
          />
        </aside>
        <article
          className="spatial-stage"
          aria-label="Spatial artwork"
          aria-busy={busy}
          data-config={shown ? JSON.stringify(shown.config) : undefined}
          data-progress={animation?.progress}
          data-mode={animation?.mode}
          data-camera={override ? JSON.stringify(override) : undefined}
        >
          <div className="plot-heading">
            <div>
              <div className="eyebrow">
                {preset !== ""
                  ? spatialPresets[+preset].detail
                  : "YOUR OWN EXPLORATION"}
              </div>
              <h1>
                {ruled
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
            <div className="view-buttons">
              <button
                className="fit"
                disabled={!!animation || running || !!renderError}
                aria-pressed={spinning}
                onClick={() => setSpinning((s) => !s)}
              >
                {spinning ? "Pause rotation" : "Rotate view"}
              </button>
              <button
                className="fit"
                disabled={!!animation || running}
                onClick={() => setReset((n) => n + 1)}
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
                  onViewport={(v) => {
                    viewport.current = v;
                  }}
                  onError={setRenderError}
                />
              ) : (
                <div className="loading">
                  {failure
                    ? "Check the study definition to begin."
                    : "Preparing the spatial engine…"}
                </div>
              )}
              {frame && failure && (
                <span className="spatial-stale">Previous valid study</span>
              )}
            </div>
            <div className="plot-meta">
              <div className="legend">
                <span className="thread-dot" /> Base curve{" "}
                <span className="ribbon-dot" />{" "}
                {ruled
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
              </div>
              <span>
                {animation
                  ? "Animation camera · Stop or Reset view restores manual framing"
                  : "Orthographic · drag to orbit · shift-drag to pan · scroll to zoom · keys: arrows, + / −, Home"}
              </span>
            </div>
          </div>
          {!narrow && behind}
        </article>
        {narrow && <div className="behind spatial-explanation">{behind}</div>}
      </main>
    </div>
  );
}
