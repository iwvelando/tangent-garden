import { createContext } from "react";
import type { PlanarStudy } from "../planar-link";
// Hyperbolic lace opens over the notebook's study, which carries the lace
// to open in its `lace` field and is otherwise left as it was.
export type LaceEntry = {
  study: PlanarStudy;
  via: "keyboard" | "pointer";
  restoreFocus: (via: "keyboard" | "pointer") => void;
};
export const LaceContext = createContext<{
  begin: (request: LaceEntry) => void;
}>({ begin: () => {} });
