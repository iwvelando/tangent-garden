import { createContext, useContext, useEffect, useState } from "react";
import type { Journey } from "./journeys";

export type JourneyVia = "keyboard" | "pointer";
export type JourneyRequest = {
  journey: Journey;
  via: JourneyVia;
  restoreFocus: (via: JourneyVia) => void;
};
export const JourneyContext = createContext<{
  active: boolean;
  begin: (request: JourneyRequest) => void;
}>({ active: false, begin: () => {} });

// Entry belongs to the notebook containing the raw controls. Wait for its
// pending work before making that mounted notebook inert; an invalid draft
// remains available for correction. No serialization can preserve that text.
export function useJourneyEntry(active: boolean, busy: boolean, error: string) {
  const owner = useContext(JourneyContext);
  const [waiting, setWaiting] = useState<JourneyRequest | null>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!active) {
      setWaiting(null);
      setNotice("");
    } else if (waiting && !busy) {
      setWaiting(null);
      if (error)
        setNotice("Correct the highlighted input before starting the journey.");
      else {
        setNotice("");
        owner.begin(waiting);
      }
    }
  }, [active, waiting, busy, error]);
  return {
    active: owner.active,
    requested: !!waiting || owner.active,
    notice,
    onJourney: (
      journey: Journey,
      restoreFocus: JourneyRequest["restoreFocus"],
      via: JourneyVia,
    ) => {
      setWaiting({ journey, restoreFocus, via });
      setNotice("Waiting for your study’s inputs…");
    },
    onBrowse: () => {
      setWaiting(null);
      setNotice("");
    },
  };
}
