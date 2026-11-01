import { createContext } from "react";
import type { PlanarStudy } from "../planar-link";
// The garden opens over the notebook's study, which carries the garden to
// open in its `garden` field and is otherwise left as it was.
export type GardenEntry = {
  study: PlanarStudy;
  via: "keyboard" | "pointer";
  restoreFocus: (via: "keyboard" | "pointer") => void;
};
export const GardenContext = createContext<{
  begin: (request: GardenEntry) => void;
}>({ begin: () => {} });
