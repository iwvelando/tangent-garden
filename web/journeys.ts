import { setIn } from "./config-path";
import { presetStudy, type PlanarStudy } from "./planar-link";
import { presets } from "./presets";

// The one control a step offers to experiment with, labeled as the notebook
// labels it: a numeric field of the configuration, or the probe's position
// along the curve.
export type JourneyControl =
  | { kind: "scalar"; label: string; path: string[] }
  | { kind: "probe"; label: string };

// Steps reference existing descriptors; titles and complete studies have one
// source of truth. Journey progress is transient, never part of a study link.
export type PlanarJourneyStep = {
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
  return { preset, note, suggestion, control };
};

// A step's whole study with its control at `value`, exactly as choosing the
// example and then making that edit in the notebook would leave it; the
// example's own study while the control is unedited.
export function journeyStudy(
  step: PlanarJourneyStep,
  value?: number,
): PlanarStudy {
  const study = presetStudy(step.preset);
  if (value === undefined) return study;
  return step.control.kind === "probe"
    ? { ...study, probe: { ...study.probe, position: value } }
    : { ...study, config: setIn(study.config, step.control.path, value) };
}

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
