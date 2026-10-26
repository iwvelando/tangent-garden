import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { EngineClient } from "../engine-client";
import type { ColorScheme } from "../color-schemes";
import type { ShapeFrame } from "../JourneyPreview";
import { Field } from "../Field";
import { ProgressSlider } from "../ProgressSlider";
import { play } from "../playback";
import { cycles, progressAt } from "../timing";
import type { TesseractStudy } from "./link";
import { sample } from "./types";
import { Plot } from "./Plot";
import { Sampler } from "./sampler";
import "./style.css";

// The notebook's sampler, timeline and bounded playback scheduler, with only
// transport controls exposed. The retained notebook owns sharing and export.
export default function JourneyDrawing(p: {
  study: TesseractStudy;
  frame: ShapeFrame | null;
  pending: boolean;
  slow: boolean;
  requested: number;
  revision: string;
  invalid: boolean;
  error?: string;
  client: { current: EngineClient | null };
  dark: boolean;
  scheme: ColorScheme;
}) {
  const [view, setView] = useState(p.study.view);
  const [motion, setMotion] = useState<ShapeFrame | null>(null);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  const epoch = useRef(0);
  const sampler = useMemo(() => new Sampler(p.client.current!), []);
  const stop = () => {
    epoch.current++;
    sampler.cancel();
    setPlaying(false);
    setPreparing(false);
    setMotion(null);
    setProgress(0);
    setError("");
  };
  useLayoutEffect(stop, [p.revision]);
  const at = async (time: number): Promise<ShapeFrame> => {
    const config = sample(
      p.study.config,
      p.study.motion,
      progressAt(time, p.study.repeat, p.study.pace),
    );
    return { config, result: await p.client.current!.tesseract(config) };
  };
  useLayoutEffect(() => {
    if (!playing) return;
    const ticket = ++epoch.current;
    const halt = play({
      from: progress,
      duration: p.study.duration * 1000,
      repeat: cycles(p.study.repeat),
      lanes: [at],
      show: (frame, time) => {
        if (ticket === epoch.current) {
          setMotion(frame);
          setProgress(time);
        }
      },
      end: () => {
        if (ticket === epoch.current) setPlaying(false);
      },
      fail: (e) => {
        if (ticket === epoch.current) {
          setError((e as Error).message);
          setPlaying(false);
        }
      },
    });
    return () => {
      epoch.current++;
      halt();
    };
  }, [playing]);
  useEffect(
    () => () => {
      epoch.current++;
      sampler.cancel();
    },
    [],
  );
  const seek = async (time: number) => {
    const ticket = ++epoch.current;
    // Keep the controlled slider at the entered time while its calculation
    // settles; otherwise the browser's change event can re-enter at the old
    // value and supersede this request.
    setProgress(time);
    const config = sample(
      p.study.config,
      p.study.motion,
      progressAt(time, p.study.repeat, p.study.pace),
    );
    try {
      const result = await sampler.request(config);
      if (result && ticket === epoch.current) setMotion({ config, result });
    } catch (e) {
      if (ticket === epoch.current) setError((e as Error).message);
    }
  };
  const start = async () => {
    if (preparing) return;
    const ticket = ++epoch.current;
    setPreparing(true);
    try {
      if (p.study.repeat === "loop") {
        const { tesseractLoopGap } = await import("./loop");
        const gap = await tesseractLoopGap({
          client: p.client.current!,
          config: p.study.config,
          motion: p.study.motion,
          view,
          layers: p.study.layers,
          diagramView: p.study.diagramView,
        });
        if (ticket !== epoch.current) return;
        if (gap) {
          setError(gap);
          return;
        }
      }
      if (ticket !== epoch.current) return;
      if (progress >= 1) setProgress(0);
      setError("");
      setPlaying(true);
    } catch (e) {
      if (ticket === epoch.current) setError((e as Error).message);
    } finally {
      if (ticket === epoch.current) setPreparing(false);
    }
  };
  const shown = (p.pending ? null : motion) ?? p.frame;
  const failure = p.error || error;
  const disabled =
    (p.pending && p.slow) || !p.frame || p.invalid || !!p.error || preparing;
  return (
    <div className="journey-drawing">
      <div className="journey-art" aria-busy={p.pending}>
        {shown && (
          <Plot
            id="journey-artwork"
            result={shown.result}
            config={shown.config}
            view={view}
            onView={setView}
            layers={p.study.layers}
            dark={p.dark}
            scheme={p.scheme}
          />
        )}
      </div>
      <p
        className="journey-feedback note"
        role={failure ? "alert" : p.pending && p.slow ? "status" : undefined}
      >
        {failure
          ? `${failure} Return to your study or try another step.`
          : p.pending && p.slow
            ? `Preparing step ${p.requested + 1}…`
            : ""}
      </p>
      <div
        inert={p.pending || undefined}
        className={motion || playing ? "playback active" : "playback"}
        role="group"
        aria-label="Playback"
      >
        <div className="animation-buttons">
          {playing ? (
            <button
              onClick={() => {
                epoch.current++;
                setPlaying(false);
              }}
            >
              Pause
            </button>
          ) : (
            <button
              className="export"
              disabled={disabled}
              onClick={() => void start()}
            >
              {preparing
                ? "Preparing…"
                : progress >= 1
                  ? "Replay"
                  : motion
                    ? "Resume"
                    : "Play animation"}
            </button>
          )}
          <button disabled={!motion && !playing && !preparing} onClick={stop}>
            {progress >= 1 ? "Back to study" : "Stop"}
          </button>
        </div>
        <div className="timeline">
          <Field
            label="Animation progress"
            value={`${Math.round(progress * 100)}%`}
          >
            <ProgressSlider
              progress={progress}
              disabled={disabled || playing || !motion}
              onSeek={(time) => void seek(time)}
            />
          </Field>
          <div className="note" aria-live="off">
            {playing
              ? `${(progress * p.study.duration).toFixed(1)} / ${p.study.duration} s`
              : progress >= 1
                ? "Complete"
                : motion
                  ? "Paused"
                  : "Ready to play"}
          </div>
        </div>
      </div>
    </div>
  );
}
