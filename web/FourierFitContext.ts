import { createContext } from "react";
import type { JourneyVia } from "./JourneyContext";
import type { PlanarStudy } from "./planar-link";
import type { LaceEntry } from "./lace/Context";

export type FourierFitRequest = {
  study: PlanarStudy;
  via: JourneyVia;
  restoreFocus: (via: JourneyVia) => void;
  // Opened from hyperbolic lace to redraw its loop: the lace to return to,
  // as it stood. The study is then the lace's loop as a Fourier curve.
  lace?: LaceEntry;
};
export const FourierFitContext = createContext<{
  begin: (request: FourierFitRequest) => void;
}>({ begin: () => {} });
