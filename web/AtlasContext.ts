import { createContext } from "react";
import type { PlanarStudy } from "./planar-link";
import type { JourneyVia } from "./JourneyContext";

export type AtlasRequest = {
  study: PlanarStudy;
  via: JourneyVia;
  restoreFocus: (via: JourneyVia) => void;
};
export const AtlasContext = createContext<{
  begin: (request: AtlasRequest) => void;
}>({ begin: () => {} });
