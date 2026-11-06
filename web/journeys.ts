import { setIn } from "./config-path";
import { overlayJourney, type OverlayJourney } from "./overlay-journeys";
export { overlayJourney, overlayJourneyStudy } from "./overlay-journeys";
import { presetStudy, type PlanarStudy } from "./planar-link";
import { presets } from "./presets";
import { spatialPresets } from "./spatial/presets";
import { presetStudy as spatialStudy, type SpatialStudy } from "./spatial/link";
import { tesseractPresets } from "./tesseract/presets";
import { fieldLabel as shapeFieldLabel } from "./tesseract/fields";
import { fieldLabel as spatialFieldLabel } from "./spatial/fields";
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
export type StudyJourney = {
  kind?: undefined;
  title: string;
  steps: JourneyStep[];
};
export type Journey = StudyJourney | OverlayJourney;
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
      : (label ??
        spatialFieldLabel(spatialPresets[preset].config, path.join(".")));
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

export const threadsJourney: StudyJourney = {
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
export const orderJourney: StudyJourney = {
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
export const dimensionsJourney: StudyJourney = {
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
export const shadowJourney: StudyJourney = {
  title: "What a shadow leaves out",
  steps: [
    across(
      "4d",
      "The heart of a cell",
      "To draw the 4D 24-cell and its companion dual, we rotate them and drop the fourth coordinate, making a 3D shadow. The highlighted octahedron's center is a vertex of the dual; crossings in this shadow need not meet in 4D.",
      "Try changing xw angle by pi/4 to turn the cell and its dual edges before projection, then play their rotation.",
      null,
      ["angles", "3"],
    ),
    across(
      "4d",
      "A crystal meeting its own dual",
      "Now a 3D plane cuts both rotated 4D crystals: you see only what lies in that plane. Move the cut to change the two solids it reveals, or pass beyond them into empty space; their sections need not be duals in 3D.",
      "Try Slice offset h at 1/2 to move the plane, then play its passage through both crystals.",
      null,
      ["slice"],
    ),
    across(
      "4d",
      "The second time around",
      "Pane 1 shows a point circling in the input plane z and its square root in the value plane w. Pane 2 combines their four coordinates into one path, rotates it in 4D and drops the fourth coordinate: the first lap returns z, and the second returns w.",
      "Try Radius r at 1/2 to compare the sizes of the z and w circles, then play both circuits.",
      null,
      ["root", "radius"],
    ),
  ],
};

export const surfaceJourney: StudyJourney = {
  title: "A thread learns the surface",
  steps: [
    across(
      "3d",
      "A torus woven from one point",
      "These threads go straight within a torus even as they bend in space. Launched from one point in every direction, some weave its outside while others pass through the hole. Together they reveal the hidden surface.",
      "Try Thread length L at 15 to see how the textile builds, then play to reveal every thread together.",
      null,
      ["surface", "geodesics", "length"],
    ),
    across(
      "3d",
      "An arrow carried along a torus thread",
      "Follow one geodesic on a torus with a tangent arrow. Parallel transport carries it without turning within the surface: its angle to the thread stays fixed even as both turn in space. This is a separate study of one path.",
      "Try Arrow angle α (°) at 0 to align it with the thread, then play its journey across the surface.",
      null,
      ["surface", "geodesics", "transport", "angle"],
    ),
    across(
      "3d",
      "A staircase becoming a throat",
      "Leave the torus for a helicoid's grid. This surface bends into a catenoid while every grid curve keeps its length. It is a new surface and a new construction, not a continuous deformation of the previous torus threads.",
      "Try Associate angle θ at pi/4 to inspect the bend halfway, then play the full unfolding.",
      null,
      ["surface", "b"],
    ),
  ],
};

export const journeys: Journey[] = [
  lightJourney,
  threadsJourney,
  orderJourney,
  dimensionsJourney,
  shadowJourney,
  surfaceJourney,
  overlayJourney,
];
