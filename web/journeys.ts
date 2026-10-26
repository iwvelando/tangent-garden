import { setIn } from "./config-path";
import { presetStudy, type PlanarStudy } from "./planar-link";
import { presets } from "./presets";
import { spatialPresets } from "./spatial/presets";
import { presetStudy as spatialStudy, type SpatialStudy } from "./spatial/link";
import { tesseractPresets } from "./tesseract/presets";
import { fieldLabel as shapeFieldLabel } from "./tesseract/fields";
import {
  presetStudy as tesseractStudy,
  type TesseractStudy,
} from "./tesseract/link";

// The one control a step offers to experiment with, labeled as the notebook
// labels it: a numeric field of the configuration, or the probe's position
// along the curve.
export type JourneyControl =
  | { kind: "scalar"; label: string; path: string[] }
  | { kind: "probe"; label: string };

// Steps reference existing descriptors; titles and complete studies have one
// source of truth. Journey progress is transient, never part of a study link.
export type PlanarJourneyStep = {
  notebook: "2d";
  preset: number;
  note: string;
  suggestion: string;
  control: JourneyControl;
};
const step = (
  title: string,
  note: string,
  suggestion: string,
  control: JourneyControl,
): PlanarJourneyStep => {
  const preset = presets.findIndex((p) => p.title === title);
  if (preset < 0) throw new Error(`Unknown journey preset: ${title}`);
  return { notebook: "2d", preset, note, suggestion, control };
};

// A step's whole study with its control at `value`, exactly as choosing the
// example and then making that edit in the notebook would leave it; the
// example's own study while the control is unedited.
export type JourneyStep =
  | PlanarJourneyStep
  | {
      notebook: "3d" | "4d";
      preset: number;
      note: string;
      suggestion: string;
      control: Extract<JourneyControl, { kind: "scalar" }>;
    };
export type Journey = { title: string; steps: JourneyStep[] };
export type JourneyStudies = {
  "2d": PlanarStudy;
  "3d": SpatialStudy;
  "4d": TesseractStudy;
};
export type JourneyAdoption = {
  [N in keyof JourneyStudies]: {
    notebook: N;
    preset: number;
    study: JourneyStudies[N];
    custom: boolean;
  };
}[keyof JourneyStudies];
export type AdoptedJourney = JourneyAdoption & { id: number };

export function journeyStudy<S extends JourneyStep>(
  step: S,
  value?: number,
): JourneyStudies[S["notebook"]] {
  const study =
    step.notebook === "2d"
      ? presetStudy(step.preset)
      : step.notebook === "3d"
        ? spatialStudy(step.preset)
        : tesseractStudy(step.preset);
  const edited =
    value === undefined
      ? study
      : step.control.kind === "probe"
        ? {
            ...study,
            probe: { ...(study as PlanarStudy).probe, position: value },
          }
        : { ...study, config: setIn(study.config, step.control.path, value) };
  return edited as JourneyStudies[S["notebook"]];
}

export function journeyTitle(step: JourneyStep) {
  return step.notebook === "2d"
    ? presets[step.preset].title
    : step.notebook === "3d"
      ? spatialPresets[step.preset].name
      : tesseractPresets[step.preset].name;
}
const across = (
  notebook: "3d" | "4d",
  title: string,
  note: string,
  suggestion: string,
  label: string | null,
  path: string[],
): JourneyStep => {
  const descriptors = notebook === "3d" ? spatialPresets : tesseractPresets;
  const preset = descriptors.findIndex((p) => p.name === title);
  if (preset < 0) throw new Error(`Unknown journey preset: ${title}`);
  const controlLabel =
    notebook === "4d"
      ? shapeFieldLabel(tesseractPresets[preset].config, path.join("."))
      : label;
  if (!controlLabel)
    throw new Error(`Unknown journey control: ${path.join(".")}`);
  return {
    notebook,
    preset,
    note,
    suggestion,
    control: { kind: "scalar", label: controlLabel, path },
  };
};

export const lightJourney = {
  title: "Light finding a cusp",
  steps: [
    step(
      "Light inside a circle",
      "A point of light on the rim sends rays across a circular mirror. Their reflections gather along a heart-shaped curve with a cusp.",
      "Try moving Source x inside the circle to see how the gathered curve changes.",
      { kind: "scalar", label: "Source x", path: ["source", "position", "x"] },
    ),
    step(
      "Parallel light & a circle",
      "Now the incoming rays are parallel, like distant sunlight. The same circular mirror gathers them along a curve with two cusps.",
      "Try changing Travel direction to turn the incoming light: 0° travels right; 90° travels up.",
      {
        kind: "scalar",
        label: "Travel direction (degrees)",
        path: ["source", "angle"],
      },
    ),
    step(
      "Sunlight gathering in an oval mirror",
      "Stretch the mirror into an oval. Its changing curvature reshapes the gathered rays; the probe shows one ray beside the circle that best fits the mirror there.",
      "Try moving the Point along the mirror to compare its curvature and reflected ray.",
      { kind: "probe", label: "Point" },
    ),
  ],
};

export const threadsJourney: Journey = {
  title: "Threads becoming surfaces",
  steps: [
    across(
      "3d",
      "Trefoil · (2, 3)",
      "A closed thread winds around a torus. Straight tangents sweep a folded surface along it: the tangent developable.",
      "Try changing Tangent reach L to extend or shorten those tangents.",
      "Tangent reach L",
      ["length"],
    ),
    across(
      "3d",
      "A knot shedding filaments",
      "On a different knot, strings unwind from the curve to trace involutes. This is another construction on a thread, rather than a physical transformation of the first surface.",
      "Try changing the c from control to adjust the first filament's string length.",
      "c from",
      ["involute", "family", "from"],
    ),
    across(
      "3d",
      "A tube around the trefoil",
      "Return to the trefoil. Circles normal to the curve join into a tube, the envelope of spheres of one radius carried along the thread.",
      "Try changing Tube radius R to thicken the tube, then play to reveal its construction.",
      "Tube radius R",
      ["canal", "radius"],
    ),
  ],
};
export const orderJourney: Journey = {
  title: "Order inside apparent chaos",
  steps: [
    step(
      "Clifford attractor",
      "One deterministic rule sends a point to the next. Count repeated visits to a grid and intricate order appears; the separate iterates are not joined into a curve, and this picture alone does not prove chaos.",
      "Try a small change to Coefficient a and compare where the visits gather.",
      {
        kind: "scalar",
        label: "Coefficient a",
        path: ["curve", "attractor", "a"],
      },
    ),
    step(
      "De Jong attractor",
      "Change the rule, keeping the same idea of repeated visits. Another arrangement emerges from sines and cosines; changing a coefficient can also lead to a short cycle or an escaping orbit.",
      "Try a small change to Coefficient b to reshape the visit density.",
      {
        kind: "scalar",
        label: "Coefficient b",
        path: ["curve", "attractor", "b"],
      },
    ),
    across(
      "3d",
      "Lorenz's two wings",
      "Now follow continuous time in three dimensions. Two nearby starting points follow the Lorenz differential equations, winding around two wings. These are trajectories, unlike the unconnected points of the iterated maps.",
      "Try changing Shape parameter a, the Lorenz parameter ρ, then play to reveal the paths.",
      "Shape parameter a",
      ["field", "a"],
    ),
  ],
};
export const dimensionsJourney: Journey = {
  title: "A glimpse of four dimensions",
  steps: [
    across(
      "4d",
      "A cube beyond a cube",
      "A tesseract has sixteen vertices and thirty-two edges. A perspective projection into three dimensions makes it look like one cube inside another; their apparent sizes come from projection.",
      "Try changing 4D eye distance to compare the apparent sizes, then play the four-dimensional rotation.",
      null,
      ["distance"],
    ),
    across(
      "4d",
      "An octahedron within",
      "A section is different from a shadow: keep only points in one three-dimensional plane through the rotated tesseract. This central diagonal cut is an octahedron; moving the plane changes the solid.",
      "Try changing Slice offset h to move the section through the tesseract.",
      null,
      ["slice"],
    ),
    across(
      "4d",
      "Hopf circles, flowing forever",
      "Leave the polytope for linked circles on the three-sphere in four dimensions. Stereographic projection opens a fiber weave into ordinary space; a circle meeting the projection pole opens into a line within the drawing's finite window.",
      "Try changing Central latitude α to move the circle family, then play its seamless double rotation.",
      null,
      ["weave", "alpha"],
    ),
  ],
};
export const journeys: Journey[] = [
  lightJourney,
  threadsJourney,
  orderJourney,
  dimensionsJourney,
];
