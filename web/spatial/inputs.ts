// The curves a construction can be built on (engine3.Request.Input): one
// descriptor each, read by the controls, legend, layers and export title.
import type { CurveInput } from "./types";

export type InputDescriptor = {
  // The choice under Built on.
  option: string;
  // The curve's name in the legend.
  name: string;
  // Appended to an export's title.
  title: string;
  // The layer of representative lines from the base to the input curve.
  connectors: string;
  // Whether the input is a tangent projection from the pole, drawn with
  // the pole and the feet of its perpendiculars.
  pole: boolean;
};

export const curveInputs: Record<CurveInput, InputDescriptor> = {
  base: {
    option: "The base curve",
    name: "Base curve",
    title: "",
    connectors: "",
    pole: false,
  },
  "tangent-foot": {
    option: "Its tangent-foot curve",
    name: "Tangent-foot curve",
    title: " on the tangent-foot curve",
    connectors: "Perpendiculars & tangent feet",
    pole: true,
  },
  orthotomic: {
    option: "Its tangent-line orthotomic",
    name: "Tangent-line orthotomic",
    title: " on the tangent-line orthotomic",
    connectors: "Perpendiculars & tangent feet",
    pole: true,
  },
  involute: {
    option: "Its involute",
    name: "Involute",
    title: " on the involute",
    connectors: "Strings from the base",
    pole: false,
  },
  coil: {
    option: "A coil around it",
    name: "Coil",
    title: " on the coil",
    connectors: "Coil arms",
    pole: false,
  },
};
