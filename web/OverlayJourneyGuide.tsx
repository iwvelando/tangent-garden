import type { PreparedOverlay, OverlayFailure } from "./overlay-preparation";
import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { useJourneyViewport } from "./useJourneyViewport";
import type { JourneyVia } from "./JourneyContext";
import type { PlanarStudy } from "./planar-link";
import {
  overlayJourneyTitle,
  overlayJourneyPaneLabels,
  type OverlayJourneyStep,
} from "./overlay-journeys";

export type OverlayGuide = {
  title: string;
  steps: OverlayJourneyStep[];
  index: number;
  requested: number;
  prepared?: PreparedOverlay;
  failure?: OverlayFailure;
  pending?: boolean;
  slow?: boolean;
  capture: (
    study: PlanarStudy,
    prepared?: PreparedOverlay,
    failure?: OverlayFailure,
  ) => void;
  go: (index: number, via: JourneyVia) => void;
  open: (study: PlanarStudy, via: JourneyVia) => void;
};

// Native workspaces supply their real field, drawing and player. All authored
// copy shares sizing cells, as in ordinary journeys, so navigation stays put.
export function OverlayJourneyLayout({
  guide,
  study,
  disabled,
  busy,
  error,
  backRef,
  onReturn,
  control,
  drawing,
  player,
  prepared,
  failure,
}: {
  guide: OverlayGuide;
  study: PlanarStudy;
  disabled: boolean;
  busy: boolean;
  error: string;
  backRef: RefObject<HTMLButtonElement | null>;
  onReturn: (via: JourneyVia) => void;
  control: ReactNode;
  drawing: ReactNode;
  player: ReactNode;
  prepared?: PreparedOverlay;
  failure?: OverlayFailure;
}) {
  const root = useRef<HTMLDivElement>(null);
  useJourneyViewport(root);
  useLayoutEffect(() => {
    guide.capture(study, prepared, failure);
  });
  const paneLabels = guide.steps
    .map(overlayJourneyPaneLabels)
    .find(Boolean) ?? ["", ""];
  const paired = !!overlayJourneyPaneLabels(guide.steps[guide.index]);
  return (
    <div ref={root} className="journey-body">
      <div className="journey-heading">
        <div>
          <div className="example-kicker">A path through the garden</div>
          <h2>{guide.title}</h2>
        </div>
        <button
          ref={backRef}
          onClick={(e) => onReturn(e.detail ? "pointer" : "keyboard")}
        >
          Return to my study
        </button>
      </div>
      <div className="journey-content">
        <p className="example-kicker journey-step" role="status">
          Step {guide.index + 1} of {guide.steps.length}
        </p>
        <div className="journey-intro">
          {guide.steps.map((step, i) => (
            <div
              key={i}
              className="journey-copy"
              data-current={i === guide.index}
              aria-hidden={i !== guide.index || undefined}
            >
              <h3>{overlayJourneyTitle(step)}</h3>
              <p>{step.note}</p>
            </div>
          ))}
        </div>
        <div className="journey-drawing">
          <div
            className="overlay-pane-captions"
            aria-hidden={!paired || undefined}
            style={{ visibility: paired ? "visible" : "hidden" }}
          >
            {paneLabels.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
          <div
            className="journey-art"
            data-overlay={guide.steps[guide.index].overlay}
            aria-busy={busy}
          >
            {drawing}
          </div>
          <p
            className="journey-feedback note"
            role={error ? "alert" : undefined}
          >
            {error ||
              guide.failure?.message ||
              (guide.pending && guide.slow ? "Preparing the next step…" : "")}
          </p>
          <div inert={guide.pending || undefined}>{player}</div>
        </div>
        <div
          className="journey-navigation"
          role="group"
          aria-label="Journey steps"
        >
          <button
            disabled={guide.requested === 0}
            onClick={(e) =>
              guide.go(guide.requested - 1, e.detail ? "pointer" : "keyboard")
            }
          >
            Previous step
          </button>
          <button
            disabled={guide.requested === guide.steps.length - 1}
            onClick={(e) =>
              guide.go(guide.requested + 1, e.detail ? "pointer" : "keyboard")
            }
          >
            Next step
          </button>
        </div>
        <div
          inert={guide.pending || undefined}
          className="journey-adopt"
          role="group"
          aria-label="Explore this study"
        >
          <div className="journey-experiments">
            {guide.steps.map((step, i) => (
              <p
                key={i}
                className="note"
                data-current={i === guide.index}
                aria-hidden={i !== guide.index || undefined}
              >
                {step.suggestion} Open study keeps your change; then edit
                anything, copy a link or export.
              </p>
            ))}
          </div>
          <div className="journey-controls">
            <div className="journey-control" data-current="true">
              {control}
            </div>
          </div>
          <button
            className="export"
            disabled={
              disabled || (!!guide.pending && !!guide.slow) || !!guide.failure
            }
            onClick={(e) =>
              guide.open(study, e.detail ? "pointer" : "keyboard")
            }
          >
            Open study
          </button>
        </div>
      </div>
    </div>
  );
}
