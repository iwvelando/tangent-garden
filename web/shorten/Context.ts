import { createContext } from "react";
import type { PlanarStudy } from "../planar-link";
// Curves that smooth themselves open over the notebook's study, which
// carries the study to open in its `shorten` field and is otherwise left
// as it was.
export type ShortenEntry = {
  study: PlanarStudy;
  via: "keyboard" | "pointer";
  restoreFocus: (via: "keyboard" | "pointer") => void;
};
export const ShortenContext = createContext<{
  begin: (request: ShortenEntry) => void;
}>({ begin: () => {} });
