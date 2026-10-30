import { createContext } from "react";
import type { PlanarStudy } from "../planar-link";
export type LoomEntry = {
  study: PlanarStudy;
  via: "keyboard" | "pointer";
  restoreFocus: (via: "keyboard" | "pointer") => void;
};
export const LoomContext = createContext<{
  begin: (request: LoomEntry) => void;
}>({ begin: () => {} });
