import type { IconName } from "./icons";
import { setIn } from "./config-path";
import { overlayJourney, type OverlayJourney } from "./overlay-journeys";
export { overlayJourney, overlayJourneyStudy } from "./overlay-journeys";
import { presetStudy, type PlanarStudy } from "./planar-link";
import { presets } from "./presets";
import { spatialPresets } from "./spatial/presets";
import { presetStudy as spatialStudy, type SpatialStudy } from "./spatial/link";
import { tesseractPresets } from "./tesseract/presets";
import { fieldLabel as shapeFieldLabel } from "./tesseract/fields";
import { objects, type ObjectDescriptor } from "./tesseract/objects";
import { motions } from "./tesseract/types";
import { fieldLabel as spatialFieldLabel } from "./spatial/fields";
import {
  presetStudy as tesseractStudy,
  type TesseractStudy,
} from "./tesseract/link";

// The one control a step offers to experiment with, labeled as the notebook
// labels it: a numeric field of the configuration, the probe's position
// along the curve, or, in 4D, one of the object descriptor's discrete
// choices or its selected item.
export type ChoiceKey = NonNullable<ObjectDescriptor["choices"]>[number]["key"];
export type JourneyControl =
  | { kind: "scalar"; label: string; path: string[] }
  | { kind: "probe"; label: string }
  | { kind: "choice"; label: string; key: ChoiceKey }
  | { kind: "selection"; label: string };
type ShapeControl = Exclude<JourneyControl, { kind: "probe" }>;
// An experiment's edited value: a number for a scalar, probe or selection
// (counted from 0), and a choice's option value.
export type JourneyValue = number | string;

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
      notebook: "3d";
      preset: number;
      note: string;
      suggestion: string;
      control: Extract<JourneyControl, { kind: "scalar" }>;
    }
  | ShapeJourneyStep;
export type ShapeJourneyStep = {
  notebook: "4d";
  preset: number;
  note: string;
  suggestion: string;
  control: ShapeControl;
};
export type StudyJourney = {
  kind?: undefined;
  title: string;
  icon: IconName;
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
// edit: an atlas adoption changes two fields of the study rather than
// replacing it, so controls keep their raw text and Reset view keeps
// returning where it did, as after any edit.
export type AdoptedJourney = JourneyAdoption & { id: number; edit?: true };

export function journeyStudy<S extends JourneyStep>(
  step: S,
  value?: JourneyValue,
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
      : step.control.kind === "choice" || step.control.kind === "selection"
        ? shapeEdit(study as TesseractStudy, step.control, value)
        : step.control.kind === "probe"
          ? {
              ...study,
              probe: { ...(study as PlanarStudy).probe, position: value },
            }
          : {
              ...study,
              config: setIn(study.config, step.control.path, value as number),
            };
  return edited as JourneyStudies[S["notebook"]];
}

// A 4D study kept valid after an edit, as the notebook keeps it: the
// descriptor's reconciliation (a selection beyond a reduced count), then a
// motion the study no longer offers gives way to the first one offered,
// and Loop gives way to Back and forth for a motion that does not loop.
export function reconcileShapeStudy(study: TesseractStudy): TesseractStudy {
  const reconcile = objects[study.config.object].reconcile;
  const config = reconcile ? reconcile(study.config) : study.config;
  const offered = motions(config);
  const motion = offered.some((m) => m.value === study.motion)
    ? study.motion
    : offered[0].value;
  const loops = !!offered.find((m) => m.value === motion)?.loops;
  const repeat =
    !loops && study.repeat === "loop" ? "back-and-forth" : study.repeat;
  return config === study.config &&
    motion === study.motion &&
    repeat === study.repeat
    ? study
    : { ...study, config, motion, repeat };
}

// A descriptor choice or selection applied as the notebook's own control
// applies it. A value the control cannot offer is refused, never coerced:
// an option the descriptor lacks, or a selection that is not one of the
// drawing's items.
function shapeEdit(
  study: TesseractStudy,
  control: Extract<ShapeControl, { kind: "choice" | "selection" }>,
  value: JourneyValue,
): TesseractStudy {
  const descriptor = objects[study.config.object];
  if (control.kind === "choice") {
    const choice = descriptor.choices!.find((c) => c.key === control.key)!;
    if (
      typeof value !== "string" ||
      !choice.values.some((option) => option.value === value)
    )
      throw new RangeError(
        `${choice.label} offers no option ${JSON.stringify(value)}.`,
      );
    const key = descriptor.parameterKey!;
    return reconcileShapeStudy({
      ...study,
      config: {
        ...study.config,
        [key]: { ...study.config[key], [control.key]: value },
      },
    });
  }
  const selection = descriptor.selection!;
  const count = selection.count(study.config);
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value >= count
  )
    throw new RangeError(
      `${selection.label} must be a whole number from 1 to ${count}.`,
    );
  return reconcileShapeStudy({
    ...study,
    config: selection.set(study.config, value),
  });
}

// A 4D step whose experiment is one of its object's discrete choices, by
// key, or its selected item. The label and options are the descriptor's;
// a choice or selection the example does not show cannot be a step.
export function shapeStep(
  title: string,
  note: string,
  suggestion: string,
  control: { kind: "choice"; key: ChoiceKey } | { kind: "selection" },
): ShapeJourneyStep {
  const preset = tesseractPresets.findIndex((p) => p.name === title);
  if (preset < 0) throw new Error(`Unknown journey preset: ${title}`);
  const config = tesseractPresets[preset].config;
  const descriptor = objects[config.object];
  if (control.kind === "selection") {
    const selection = descriptor.selection;
    if (!selection?.visible(config))
      throw new Error(`${title} shows no selection to experiment with`);
    return {
      notebook: "4d",
      preset,
      note,
      suggestion,
      control: { kind: "selection", label: selection.label },
    };
  }
  const choice = descriptor.choices?.find((c) => c.key === control.key);
  if (!choice || (choice.visible && !choice.visible(config)))
    throw new Error(`${title} shows no choice ${control.key}`);
  return {
    notebook: "4d",
    preset,
    note,
    suggestion,
    control: { kind: "choice", label: choice.label, key: control.key },
  };
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
  icon: "cusp" as const,
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
  icon: "threads",
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
  icon: "order",
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
  icon: "tesseract",
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
  icon: "shadow",
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
  icon: "geodesic",
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

export const hopfJourney: StudyJourney = {
  title: "Every point owns a circle",
  icon: "hopf",
  steps: [
    shapeStep(
      "A circle over every point",
      "Pane 1 is the base sphere S²; pane 2 shows circles of the 3-sphere in four dimensions, projected into space. Each point on the latitude owns one whole circle, its Hopf fiber, and any two fibers link once.",
      "Try tapping another point or fiber in either pane, or set Selected fiber, then play to carry that circle around the latitude.",
      { kind: "selection" },
    ),
    shapeStep(
      "A flower below, a bouquet above",
      "Now the path on the sphere wanders north and south as a five-petal flower. Its points lift to fibers on different tori, so the linked circles gather into a bouquet instead of lying on one torus.",
      "Try Base path at Latitude to flatten the flower into one circle of latitude, then play the trace.",
      { kind: "choice", key: "path" },
    ),
    across(
      "4d",
      "Hopf circles, flowing forever",
      "Leave the base sphere behind. Fibers over three latitudes lie on three nested tori, turning together in four dimensions; a circle that meets the projection pole opens into a line within the drawing's finite window.",
      "Try Latitude spread at 1/8 to draw the three tori together, then play the seamless double rotation.",
      null,
      ["weave", "spread"],
    ),
  ],
};

export const crystalJourney: StudyJourney = {
  title: "When a crystal meets its dual",
  icon: "duality",
  steps: [
    shapeStep(
      "Into the crystal",
      "The 24-cell has 24 octahedral cells. Its polar dual is another 24-cell: this is self-dual, the same kind of polytope at a different scale. Each selected cell's diagonals meet at a vertex of the dual, even in this perspective shadow.",
      "Try Selected cell, tap a center, or press [ and ] on the drawing; then play the four-dimensional rotation.",
      { kind: "selection" },
    ),
    shapeStep(
      "Cube within a cube, and its dual",
      "The tesseract has eight cubes; its polar 16-cell has sixteen tetrahedra. These are different kinds of polytope. A selected cube's four diagonals meet at a 16-cell vertex; the tetrahedra's centers are not tesseract vertices.",
      "Try Selected cube, tap a center, or press [ and ]; compare the correspondence while the pair turns.",
      { kind: "selection" },
    ),
    across(
      "4d",
      "A tesseract meeting its dual",
      "Now one plane cuts both corner-first crystals. At the center, the tesseract gives an octahedron and the 16-cell a cuboctahedron. The octahedron's 3D dual is a cube: cutting a 4D dual pair need not give dual sections.",
      "Try Slice offset h at 1/4. Play deliberately starts at an empty plane, then passes through both crystals.",
      null,
      ["slice"],
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
  hopfJourney,
  crystalJourney,
];
