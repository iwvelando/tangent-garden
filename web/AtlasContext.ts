import { createContext } from "react";
import type { PlanarStudy } from "./planar-link";
import type { JourneyVia } from "./JourneyContext";
import type { AtlasFacts } from "./atlas";

export type AtlasRequest = {
  study: PlanarStudy;
  // What the study's settled frame reported, such as whether F reads a.
  facts: AtlasFacts;
  via: JourneyVia;
  restoreFocus: (via: JourneyVia) => void;
};
export const AtlasContext = createContext<{
  begin: (request: AtlasRequest) => void;
}>({ begin: () => {} });
