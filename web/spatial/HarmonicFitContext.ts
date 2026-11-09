import { createContext } from "react";
import type { JourneyVia } from "../JourneyContext";
import type { SpatialStudy } from "./link";

export type HarmonicFitEntry = {
  study: SpatialStudy;
  via: JourneyVia;
  restoreFocus: (via: JourneyVia) => void;
};
export const HarmonicFitContext = createContext<{
  begin: (request: HarmonicFitEntry) => void;
}>({ begin: () => {} });
