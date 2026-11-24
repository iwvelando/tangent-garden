import { createContext } from "react";
import type { JourneyVia } from "./JourneyContext";
import type { PlanarStudy } from "./planar-link";
import type { LaceEntry } from "./lace/Context";
import type { ShortenEntry } from "./shorten/Context";

export type FourierFitRequest = {
  study: PlanarStudy;
  via: JourneyVia;
  restoreFocus: (via: JourneyVia) => void;
  // Opened from hyperbolic lace to redraw its loop: the lace to return to,
  // as it stood. The study is then the lace's loop as a Fourier curve.
  lace?: LaceEntry;
  // Opened from curves that smooth themselves to redraw its loop, likewise:
  // the study to return to, as it stood.
  shorten?: ShortenEntry;
};
export const FourierFitContext = createContext<{
  begin: (request: FourierFitRequest) => void;
}>({ begin: () => {} });
