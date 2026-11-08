import { createContext } from "react";
import type { JourneyVia } from "./JourneyContext";
import type { PlanarStudy } from "./planar-link";

export type FourierFitRequest = {
  study: PlanarStudy;
  via: JourneyVia;
  restoreFocus: (via: JourneyVia) => void;
};
export const FourierFitContext = createContext<{
  begin: (request: FourierFitRequest) => void;
}>({ begin: () => {} });
