import { createContext } from "react";
import type { PlanarStudy } from "./planar-link";
import type { JourneyVia } from "./JourneyContext";
import type { AtlasFacts } from "./atlas";
import type { SpatialAtlasFacts } from "./spatial/atlas";
import type { SpatialStudy } from "./spatial/link";
import type { TesseractStudy } from "./tesseract/link";

export type AtlasRequest = {
  study: PlanarStudy;
  // What the study's settled frame reported, such as whether F reads a.
  facts: AtlasFacts;
  via: JourneyVia;
  restoreFocus: (via: JourneyVia) => void;
};

// The 3D notebook's atlas (spatial/atlas.ts).
export type SpatialAtlasRequest = {
  study: SpatialStudy;
  facts: SpatialAtlasFacts;
  via: JourneyVia;
  restoreFocus: (via: JourneyVia) => void;
};
export type TesseractAtlasRequest = {
  study: TesseractStudy;
  via: JourneyVia;
  restoreFocus: (via: JourneyVia) => void;
};
// The Notebook owns the three notebooks' atlases.
export const AtlasContext = createContext<{
  begin: (request: AtlasRequest) => void;
  beginSpatial: (request: SpatialAtlasRequest) => void;
  beginTesseract: (request: TesseractAtlasRequest) => void;
}>({ begin: () => {}, beginSpatial: () => {}, beginTesseract: () => {} });
