import { useRef, useState } from "react";
import type { EngineClient } from "../engine-client";
import type { ColorScheme } from "../color-schemes";
import type { NamedView } from "../named-views";
import {
  feedOrientation,
  LiveOrientation,
  type OrientationFeed,
} from "../Orientation";
import { plotGestures, SpatialPlot } from "./SpatialPlot";
import { viewBasis } from "./scene";
import { SpatialAnimationPanel } from "./SpatialAnimationPanel";
import {
  animationCamera,
  type AnimationView,
  type Viewport,
} from "./animation";
import type { SpatialStudy } from "./link";
import type { Frame } from "./types";
import { cutSpec } from "./cut";
import "./spatial.css";

export default function JourneyDrawing(p: {
  study: SpatialStudy;
  frame: Frame | null;
  pending: boolean;
  slow: boolean;
  requested: number;
  revision: string;
  invalid: boolean;
  // Why Play is unavailable, for the status beside it.
  unavailable?: string;
  error?: string;
  onError: (message: string) => void;
  client: { current: EngineClient | null };
  dark: boolean;
  scheme: ColorScheme;
  // Reset view, the named views and what the drawing answers to, for a
  // drawing the reader is meant to turn over. A guided journey has none.
  viewControls?: boolean;
}) {
  const [motion, setMotion] = useState<AnimationView | null>(null);
  const [reset, setReset] = useState(0),
    [refit, setRefit] = useState(0),
    [turn, setTurn] = useState<{ id: number; to: NamedView } | null>(null),
    [running, setRunning] = useState(false);
  const orientation = useRef<OrientationFeed>({});
  const view = useRef<Viewport | undefined>(undefined);
  const animation = p.pending ? null : motion;
  const shown = animation?.frame ?? p.frame;
  const camera = animation ? animationCamera(animation) : undefined;
  const cut = cutSpec(p.study.cut);
  return (
    <div className="journey-drawing">
      <div className="journey-art" aria-busy={p.pending}>
        {shown && (
          <SpatialPlot
            id="journey-artwork"
            showError={false}
            result={shown.result}
            dark={p.dark}
            scheme={p.scheme}
            layers={p.study.layers}
            reset={reset}
            refit={refit}
            turn={turn}
            spinning={false}
            override={animation?.complete ? undefined : camera}
            released={animation?.complete ? camera : undefined}
            restored={{ reset: 0, view: p.study.view }}
            home={p.study.view}
            sight={p.study.sight}
            projection={p.study.projection}
            lensAngle={p.study.lensAngle}
            cut={animation?.cut ?? cut.spec}
            onViewport={(v) => {
              view.current = v;
              if (p.viewControls)
                feedOrientation(orientation.current, viewBasis(v));
            }}
            onError={p.onError}
          />
        )}
      </div>
      {p.viewControls && (
        <div className="journey-view">
          <div className="journey-view-row">
            <LiveOrientation
              feed={orientation.current}
              dark={p.dark}
              disabled={running}
              onTurn={(to) => setTurn((t) => ({ id: (t?.id ?? 0) + 1, to }))}
            />
            <button
              type="button"
              disabled={running}
              onClick={() =>
                animation?.complete
                  ? setRefit((n) => n + 1)
                  : setReset((n) => n + 1)
              }
            >
              Reset view
            </button>
          </div>
          <p className="note">{plotGestures}</p>
        </div>
      )}
      <p
        className="journey-feedback note"
        role={p.error ? "alert" : p.pending && p.slow ? "status" : undefined}
      >
        {p.error
          ? `${p.error} Return to your study or try another step.`
          : p.pending && p.slow
            ? `Preparing step ${p.requested + 1}…`
            : ""}
      </p>
      <div inert={p.pending || undefined}>
        <SpatialAnimationPanel
          preview
          frame={p.frame}
          client={p.client}
          length={p.study.config.length}
          revision={p.revision}
          disabled={(p.pending && p.slow) || !p.frame || !!p.error || p.invalid}
          unavailable={p.unavailable}
          probe={null}
          cut={cut.spec}
          sight={p.study.sight}
          dark={p.dark}
          scheme={p.scheme}
          layers={p.study.layers}
          getCurrentView={() => view.current}
          onView={setMotion}
          onRunning={setRunning}
          onPlay={() => {}}
          onReveal={() => {}}
          restore={p.frame ? { id: 0, settings: p.study.animation } : null}
          onShowView={() => {}}
        />
      </div>
    </div>
  );
}
