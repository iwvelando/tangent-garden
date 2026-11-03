import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppHeader } from "../AppHeader";
import { ExportImageMenu } from "../ExportImageMenu";
import type { Still } from "../export-image";
import { EngineClient } from "../engine-client";
import { useTheme } from "../useTheme";
import { useQuietFocus } from "../quiet-focus";
import { ProgressSlider } from "../ProgressSlider";
import { MotionExportSettings, useMotionExport } from "../MotionExportSettings";
import { useDisclosure } from "../useDisclosure";
import { play } from "../playback";
import { plotPalette } from "../palette";
import { LabDrawing, type LabDrawingProps } from "./Drawing";
import { labMovie, labStill } from "./export";
import {
  defaultLab,
  familyTimes,
  labPage,
  requestOf,
  seedOf,
  stopText,
  timeAt,
  type LabSettings,
  type ShortenContour,
  type ShortenReply,
} from "./model";
import "./shorten.css";

// What the film key excludes: presentation and family settings, which only
// change which times are sampled or how loops are drawn.
const filmKey = (s: LabSettings) => JSON.stringify(requestOf(s, []));
const fmt = (v: number, digits = 4) =>
  Number.isFinite(v) ? v.toPrecision(digits) : "—";

type Family = { key: string; reply: ShortenReply; ms: number };
type Shown = { key: string; p: number; contour: ShortenContour; ms: number };

// Research preview for #322: one curve-shortening experiment through the
// production worker, renderer and exports. Not a product study.
export function ShortenLab({ onReturn }: { onReturn: () => void }) {
  const theme = useTheme(),
    dialog = useRef<HTMLDialogElement>(null),
    back = useRef<HTMLButtonElement>(null),
    quiet = useQuietFocus(dialog);
  const [s, setS] = useState<LabSettings>(defaultLab);
  const [family, setFamily] = useState<Family>();
  const [shown, setShown] = useState<Shown>();
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false),
    [exportProgress, setExportProgress] = useState(0);
  const client = useRef<EngineClient | null>(null),
    generation = useRef(0),
    seekId = useRef(0),
    stopClock = useRef<() => void>(() => {}),
    exportId = useRef(0),
    exportAbort = useRef<AbortController | null>(null);
  const exportState = useMotionExport();
  const exportSection = useDisclosure("shorten-export");
  const key = filmKey(s);
  const familyKey = JSON.stringify([key, s.count, s.spacing]);
  const ready = family?.key === familyKey;
  useEffect(() => {
    client.current = new EngineClient();
    return () => {
      generation.current++;
      stopClock.current();
      exportAbort.current?.abort();
      client.current?.dispose();
    };
  }, []);
  useLayoutEffect(() => {
    dialog.current!.showModal();
    quiet.quiet();
    back.current!.focus();
  }, []);
  // The film's summary, then the family at its times. The worker keeps the
  // film, so the second request only samples it.
  useEffect(() => {
    const id = ++generation.current;
    setError("");
    const t0 = performance.now();
    void (async () => {
      try {
        const head = await client.current!.shorten(requestOf(s, []));
        const times = familyTimes(head.result.end, s.count, s.spacing);
        const all = await client.current!.shorten(requestOf(s, times));
        if (id !== generation.current) return;
        setFamily({
          key: familyKey,
          reply: all.result,
          ms: performance.now() - t0,
        });
      } catch (e) {
        if (id === generation.current) setError((e as Error).message);
      }
    })();
  }, [familyKey]);
  const end = ready ? family.reply.end : NaN;
  const sample = async (p: number) => {
    const t = timeAt(p, end, s.pacing);
    const t0 = performance.now();
    const r = await client.current!.shorten(requestOf(s, [t]));
    return { contour: r.result.contours[0], ms: performance.now() - t0 };
  };
  // The loop at the slider's time, sampled afresh for each seek: it
  // depends only on the settings and the time.
  const seek = (p: number) => {
    if (!ready) return;
    pause();
    setProgress(p);
    const id = ++seekId.current;
    setBusy(true);
    void sample(p)
      .then(({ contour, ms }) => {
        if (id !== seekId.current) return;
        setShown({ key, p, contour, ms });
        setBusy(false);
      })
      .catch((e) => {
        if (id === seekId.current) {
          setError((e as Error).message);
          setBusy(false);
        }
      });
  };
  // A new film starts at its beginning.
  useEffect(() => {
    if (ready) seek(0);
  }, [familyKey, ready, s.pacing]);
  const pause = () => {
    stopClock.current();
    stopClock.current = () => {};
    setPlaying(false);
  };
  const start = () => {
    if (!ready || exporting) return;
    seekId.current++;
    const from = progress >= 1 ? 0 : progress;
    setPlaying(true);
    stopClock.current = play<{ contour: ShortenContour; ms: number }>({
      from,
      duration: s.duration * 1000,
      lanes: [sample],
      show: (v, p) => {
        setProgress(p);
        setShown({ key, p, contour: v.contour, ms: v.ms });
      },
      end: () => {
        stopClock.current = () => {};
        setPlaying(false);
      },
      fail: (e) => {
        pause();
        setError((e as Error).message);
      },
    });
  };
  const edit = (change: Partial<LabSettings>) => {
    pause();
    seekId.current++;
    setProgress(0);
    setS((x) => ({ ...x, ...change }));
  };
  const seed = seedOf(s);
  const current = shown?.key === key ? shown.contour : undefined;
  const drawing = (): LabDrawingProps | undefined =>
    ready
      ? {
          seed,
          family: family.reply.contours,
          current,
          framing: s.framing,
          dark: theme.dark,
          scheme: theme.scheme,
        }
      : undefined;
  const metadata = () => ({
    kind: "curve-shortening",
    research: "https://github.com/iwvelando/tangent-garden/issues/322",
    flow: "dX/dt = −κ n_out, support function h_t = −1/(h + h_θθ)",
    seed,
    nodes: s.nodes,
    tau: s.tau,
    horizon: s.horizon,
    end: family?.reply.end,
    stop: family?.reply.stop,
    family: family?.reply.contours.map((c) => c.t),
    spacing: s.spacing,
    framing:
      s.framing === "normalized"
        ? "each loop scaled by √(A₀/A) about its centroid (presentation only)"
        : "physical, fixed frame",
    ...(current && { time: current.t }),
    theme: theme.dark ? "dark" : "light",
    scheme: theme.scheme,
  });
  async function still(format: string, settings: Still) {
    const props = drawing();
    if (!props) return;
    const id = ++exportId.current;
    await labStill(
      format as "svg" | "png",
      props,
      metadata(),
      () => id === exportId.current,
      settings,
    );
  }
  async function movie() {
    const props = drawing();
    if (!props) return;
    pause();
    setExporting(true);
    setExportProgress(0);
    const id = ++exportId.current;
    const controller = new AbortController();
    exportAbort.current = controller;
    // Its own engine, so playback and seeks cannot replace the film it
    // samples; the film is solved again there, identically.
    const engine = new EngineClient();
    try {
      await labMovie({
        drawing: props,
        metadata: { ...metadata(), pacing: s.pacing, duration: s.duration },
        duration: s.duration,
        sample: async (p) =>
          (
            await engine.shorten(
              requestOf(s, [timeAt(p, family!.reply.end, s.pacing)]),
            )
          ).result.contours[0],
        options: {
          format: exportState.chosen,
          fps: exportState.fps,
          settings: { scale: exportState.scale, quality: exportState.quality },
          loop: exportState.loop,
        },
        signal: controller.signal,
        current: () => id === exportId.current,
        progress: setExportProgress,
      });
    } catch (e) {
      if (id === exportId.current && !controller.signal.aborted)
        setError((e as Error).message);
    } finally {
      engine.dispose();
      if (id === exportId.current) setExporting(false);
    }
  }
  const props = drawing();
  const palette = plotPalette(theme.dark, theme.scheme);
  const r = family?.reply;
  const a0 = r?.contours[0]?.area;
  const predicted =
    current && a0 !== undefined ? a0 - 2 * Math.PI * current.t : NaN;
  const radio = <K extends keyof LabSettings>(
    k: K,
    label: string,
    options: [LabSettings[K], string][],
    presentation = false,
  ) => (
    <label className="shorten-field">
      <span>{label}</span>
      <select
        aria-label={label}
        value={String(s[k])}
        disabled={exporting}
        onChange={(e) => {
          const v = options.find(
            ([o]) => String(o) === e.currentTarget.value,
          )![0];
          if (presentation) setS((x) => ({ ...x, [k]: v }));
          else edit({ [k]: v } as Partial<LabSettings>);
        }}
      >
        {options.map(([o, text]) => (
          <option key={String(o)} value={String(o)}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <dialog
      ref={dialog}
      className="shorten"
      aria-labelledby="shorten-title"
      onCancel={(e) => {
        e.preventDefault();
        onReturn();
      }}
      onPointerDown={quiet.onPointerDown}
      onKeyDownCapture={quiet.onKeyDownCapture}
    >
      <AppHeader theme={theme} appearance={false}>
        <button ref={back} onClick={onReturn}>
          Return to study
        </button>
        <ExportImageMenu
          kind="curve-shortening"
          revision={JSON.stringify([
            familyKey,
            s.framing,
            current?.t,
            theme.dark,
            theme.scheme,
          ])}
          disabled={!props || playing || exporting}
          base={labPage}
          onSave={still}
        />
      </AppHeader>
      <div className="shorten-content">
        <div className="shorten-heading">
          <p className="eyebrow">
            Research preview · issue #322 · not a released study
          </p>
          <h2 id="shorten-title">A flower remembering a circle</h2>
          <p>
            A convex loop moves inward at its curvature. Ripples fade first; the
            loop rounds and shrinks toward a point.
          </p>
        </div>
        <div className="shorten-layout">
          <main>
            <div
              className="shorten-view"
              data-progress={progress}
              data-busy={busy || !ready ? "" : undefined}
              data-playing={playing || undefined}
            >
              {props ? (
                <LabDrawing {...props} busy={busy} />
              ) : (
                <p className="shorten-placeholder" role="status">
                  {error || "Solving the flow…"}
                </p>
              )}
            </div>
            <div className="shorten-key">
              <span>
                <i
                  style={{ "--swatch": palette.base } as React.CSSProperties}
                />{" "}
                Loops at {s.count}{" "}
                {s.spacing === "time"
                  ? "equal time steps"
                  : "equal-radius steps"}
              </span>
              <span>
                <i
                  style={{ "--swatch": palette.derived } as React.CSSProperties}
                />{" "}
                Loop at the shown time
              </span>
              <span>
                {s.framing === "normalized"
                  ? "Normalized: each loop scaled by √(A₀/A) about its centroid. Presentation only."
                  : "Physical scale, fixed frame."}
              </span>
            </div>
            <div className="shorten-readout" aria-live="off">
              {r && current ? (
                <>
                  <p>
                    t = {fmt(current.t)} of extinction T = {fmt(r.extinction)} (
                    {fmt((100 * current.t) / r.extinction, 3)}%) · film ends at{" "}
                    {fmt(r.end)}, {stopText[r.stop] ?? r.stop}
                  </p>
                  <p>
                    Area {fmt(current.area, 7)}; A₀ − 2πt = {fmt(predicted, 7)}{" "}
                    (polygon areas) · length {fmt(current.length, 6)} · ρ from{" "}
                    {fmt(current.minRho)} to {fmt(current.maxRho)}
                  </p>
                  <p className="note">
                    Solve: {r.stats.accepted} steps, {r.stats.rejected}{" "}
                    rejected, {r.stats.remeshed} remeshes,{" "}
                    {r.stats.nodeUpdates.toLocaleString("en-US")} node updates,{" "}
                    {r.stats.checkpoints} checkpoints every {r.stats.stride}{" "}
                    steps · family in {fmt(family!.ms, 3)} ms · this loop
                    recomputed {current.steps} steps in {fmt(shown!.ms, 3)} ms
                  </p>
                </>
              ) : (
                <p>{error}</p>
              )}
            </div>
          </main>
          <aside>
            <section
              className="shorten-missing"
              aria-label="Missing product integration"
            >
              <h3>Not yet integrated</h3>
              <ul>
                <li>
                  No gallery entry, preset, thumbnail or study link: opened by
                  ?lab=curve-shortening only.
                </li>
                <li>
                  Seeds limited to the experiment; radius and center edits
                  (covariance) are tested in Go only.
                </li>
                <li>
                  No tiered help, field-error placement or ScalarInput
                  constants.
                </li>
                <li>
                  No pan or zoom; the physical frame is fixed by the seed.
                </li>
                <li>
                  Export records are minimal; settings are not restored from
                  files.
                </li>
              </ul>
            </section>
            {radio("mode", "Seed", [
              [6, "Six lobes, |ε|·35 ≤ ½"],
              [3, "Three lobes, |ε|·8 ≤ ½"],
              [0, "Circle"],
            ])}
            {s.mode !== 0 &&
              radio("ripple", "Ripple", [
                [1, "Largest allowed"],
                [0.5, "Half"],
                [-1, "Largest, inverted"],
              ])}
            {radio("nodes", "Nodes", [
              [128, "128"],
              [256, "256"],
              [512, "512"],
            ])}
            {radio("tau", "Step factor τ", [
              [0.01, "0.01"],
              [0.005, "0.005"],
              [0.0025, "0.0025"],
            ])}
            {radio("horizon", "Horizon", [
              [0.5, "0.5 T"],
              [0.9, "0.9 T"],
              [0.98, "0.98 T"],
              [0.999, "0.999 T (curvature floor)"],
            ])}
            {radio("count", "Contours", [
              [6, "6"],
              [12, "12"],
              [24, "24"],
              [48, "48"],
            ])}
            {radio("spacing", "Spacing", [
              ["radius", "Equal radius"],
              ["time", "Equal time"],
            ])}
            {radio(
              "framing",
              "View",
              [
                ["physical", "Physical"],
                ["normalized", "Normalized"],
              ],
              true,
            )}
            <h3 className="shorten-section">Motion</h3>
            <div className="playback" role="group" aria-label="Motion playback">
              <div className="animation-buttons">
                <button
                  disabled={!ready || exporting}
                  onClick={() => (playing ? pause() : start())}
                >
                  {playing
                    ? "Pause motion"
                    : progress > 0 && progress < 1
                      ? "Resume motion"
                      : "Play motion"}
                </button>
                <button
                  disabled={!exporting && !playing && progress === 0}
                  onClick={() => {
                    if (exporting) {
                      exportId.current++;
                      exportAbort.current?.abort();
                      setExporting(false);
                    } else seek(0);
                  }}
                >
                  {exporting ? "Cancel export" : "Stop motion"}
                </button>
              </div>
              <label className="shorten-field">
                <span>Animation progress</span>
                <ProgressSlider
                  progress={progress}
                  disabled={!ready || exporting}
                  onSeek={seek}
                />
              </label>
            </div>
            {radio(
              "pacing",
              "Pacing",
              [
                ["radius", "Equal radius"],
                ["time", "Physical time"],
              ],
              true,
            )}
            {radio(
              "duration",
              "Duration",
              [
                [4, "4 s"],
                [8, "8 s"],
                [16, "16 s"],
              ],
              true,
            )}
            <fieldset disabled={exporting} className="shorten-export">
              <MotionExportSettings
                state={exportState}
                id="shorten-export-settings"
                cyclic={false}
                disclosure={exportSection}
              />
            </fieldset>
            <button
              className="animation-export"
              disabled={
                !ready ||
                exporting ||
                exportState.formats?.[exportState.chosen] !== "yes"
              }
              onClick={() => void movie()}
            >
              Export {exportState.text.name} ↗
            </button>
            {exporting && (
              <p role="status" aria-live="off">
                Exporting {exportState.text.short}…{" "}
                {Math.round(exportProgress * 100)}%
              </p>
            )}
          </aside>
        </div>
      </div>
    </dialog>
  );
}
