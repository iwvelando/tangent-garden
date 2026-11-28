import { createContext } from "react";
import type { PlanarStudy } from "../planar-link";
// Three bodies open over the notebook's study, which carries the study to
// open in its `threeBody` field and is otherwise left as it was.
export type ThreeBodyEntry = {
  study: PlanarStudy;
  via: "keyboard" | "pointer";
  restoreFocus: (via: "keyboard" | "pointer") => void;
};
export const ThreeBodyContext = createContext<{
  begin: (request: ThreeBodyEntry) => void;
}>({ begin: () => {} });
