import { createContext } from "react";
import type { JourneyVia } from "./JourneyContext";

export type FourierFitRequest = {
  via: JourneyVia;
  restoreFocus: (via: JourneyVia) => void;
};
export const FourierFitContext = createContext<{
  begin: (request: FourierFitRequest) => void;
}>({ begin: () => {} });
