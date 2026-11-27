// The plaque workshop, a mode of the lace dialog (docs/usage.md, Make a
// lace physical). It holds the lace's source frozen as it opened, edits
// the study's physical settings (a link saves them), prepares a solid in
// its own worker, one job at a time, draws the solid's actual top faces,
// reports every check, and saves the 3MF package. Returning leaves the
// lace exactly as it was.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { EngineClient, EngineError } from "../engine-client";
import { saveFile } from "../export-image";
import { CheckSetting, Field, FieldErrorContext, StudyError } from "../Field";
import { tiered } from "../help";
import { LegendEntries } from "../Legend";
import { count, mebibytes, plural, readout } from "../number-format";
import { plotPalette } from "../palette";
import {
  ScalarInput,
  type ScalarDraft,
  type ScalarState,
} from "../ScalarInput";
import { useTheme } from "../useTheme";
import type { LaceRequest, LaceResult } from "./model";
import {
  cropClip,
  defaultProfile,
  defaultProfiles,
  physicalLabel,
  physicalProblem,
  profileEdited,
  solidRequest,
  withPrinter,
  type CheckItem,
  type LacePhysical,
  type LaceSolid,
  type Lines,
  type ProfileLength,
  type Rim,
  type Treatment,
} from "./physical";

// Each control's help: the essentials first, the engine's limits stated
// (physical/lace.go, validate; physical/profile.go, Validate).
export const workshopHelp = {
  treatment: "Raised lines on a floor, or grooves cut into a slab.",
  diameter: tiered(
    "The plaque's diameter: 10–300 mm.",
    "A plaque wider than the printer's bed fails the build envelope check; it is never shrunk to fit.",
  ),
  line: "Every line's width, and the frame's: above 0, at most 20 mm.",
  floor: tiered(
    "Material under the lines: 0–20 mm; 0 is openwork.",
    "Openwork must still be one body: a clean rim or a crop frames the lace so that every piece is held.",
  ),
  relief: {
    raised: "Height above the floor: above 0, at most 20 mm.",
    recessed: "Depth below the top: above 0, at most 20 mm.",
  },
  preset:
    "Sets the line width, minimum wall and minimum raised line together: 2 or 3 mm.",
  lines:
    "The motif, the tile sides, or both; it starts as the study draws them.",
  rim: tiered(
    "Where lines grow too fine: whole tiles, a framed circle, or an enlarged crop.",
    "Whole tiles keeps the largest tiles while every gap holds the minimum. A clean rim cuts the lace at a circle joined to a frame. A crop enlarges a disk of the lace to fill the plaque.",
  ),
  clip: {
    rim: tiered(
      "Where the frame cuts the lace: 0.05–0.98 of the disk.",
      "Empty chooses it from the whole tiles that hold the minimums, drawing it in while any check still fails.",
    ),
    crop: "The disk of lace enlarged to the plaque: 0.05–0.95 of the disk's radius.",
  },
  simplify: tiered(
    "Removes material thinner than the minimum wall and fills narrower gaps.",
    "Off, those features fail the checks instead. On, what changed is marked on the drawing, and cells it filled or pieces it joined become notes.",
  ),
  faceDown:
    "Turns the plaque over so its face prints on the bed: suits recessed plaques and openwork.",
  printer: tiered(
    "The bed and minimums the checks use; it never changes the plaque's shape.",
    "Choosing another printer keeps the requested minimums. The printers' finest values are uncalibrated estimates. A link and the file carry every value, never only the printer's name.",
  ),
  grid: tiered(
    "The field's sampling step: 0.05–1 mm; empty chooses 0.2 mm.",
    "A finer step follows curves more closely and takes longer. A step needing more than 4,000,000 field nodes is refused.",
  ),
};

// Fields side by side, two to a row; an odd one out stands alone.
const paired = (fields: ReactNode[]) =>
  fields.map((f, i) =>
    i % 2 ? null : i + 1 < fields.length ? (
      <div className="pair" key={i}>
        {f}
        {fields[i + 1]}
      </div>
    ) : (
      f
    ),
  );
// A printer's name without its process, which the note below states.
const printerName = (name: string) => name.split(", ")[0];
const minimums: ProfileLength[] = ["wall", "strut", "gap", "floor"];
const finest: ProfileLength[] = ["xyDetail", "xyGap", "zDetail"];
const slicing: ProfileLength[] = [
  "nozzle",
  "extrusionWidth",
  "layerHeight",
  "firstLayer",
];
// The checks of the solid as a mesh, whatever the printer.
const geometry = new Set([
  "closed",
  "oriented",
  "components",
  "degenerate",
  "intersections",
]);
// Checks whose value and limit are lengths.
const lengths = new Set([
  "line",
  "floor",
  "relief",
  "cells",
  "envelope",
  "layers-low",
  "layers-high",
]);

type Prepared = {
  key: string;
  solid: LaceSolid;
  wall: number;
  worker?: number;
  bytes?: number;
};

export function PhysicalWorkshop({
  source,
  settings,
  update,
  retained,
  scalarError,
  scalarPending,
  focus,
  onClose,
}: {
  // The lace's generation settings and static isometry, frozen.
  source: LaceRequest;
  settings: LacePhysical;
  // Applied to the latest settings, as ScalarInput resolves late.
  update: (change: (p: LacePhysical) => LacePhysical) => void;
  // Raw scalar text, kept while the workshop is closed.
  retained: Map<string, ScalarDraft>;
  scalarError?: ScalarState;
  scalarPending: boolean;
  // Moves focus by script, quietly after a tap.
  focus: (el: HTMLElement | null) => void;
  onClose: (via: "keyboard" | "pointer") => void;
}) {
  const theme = useTheme();
  const [prepared, setPrepared] = useState<Prepared>();
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<{
    message: string;
    field?: string;
    key: string;
  }>();
  const [overlay, setOverlay] = useState<LaceResult>();
  const job = useRef<EngineClient | null>(null);
  const jobId = useRef(0);
  const viewRef = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => focus(back.current), []);

  // The source patch without its view's detail, for showing what the
  // cutoff left out.
  useEffect(() => {
    const client = new EngineClient();
    client
      .lace(source)
      .then(setOverlay)
      .catch(() => {})
      .finally(() => client.dispose());
    return () => client.dispose();
  }, [source]);
  // Returning ends any job; its result is never applied.
  useEffect(
    () => () => {
      jobId.current++;
      job.current?.dispose();
    },
    [],
  );

  const p = settings;
  const raised = p.treatment === "raised";
  const request = useMemo(() => solidRequest(source, p), [source, p]);
  const key = JSON.stringify(request);
  const current = prepared?.key === key;
  const problem = physicalProblem(p);
  const engineError = error?.key === key ? error : undefined;
  const blocked = !!problem || !!scalarError || scalarPending;

  // One error under its control: an entry Go cannot read, a required
  // value left empty, then Go's refusal of this request.
  const label = (field?: string) =>
    field ? physicalLabel(field, p) : undefined;
  const shown = scalarError
    ? { label: scalarError.name, message: scalarError.error ?? "" }
    : problem
      ? { label: label(problem.field), message: problem.message }
      : engineError
        ? {
            label: label(engineError.field),
            message: engineError.field?.startsWith("lace.")
              ? `The lace: ${engineError.message}`
              : engineError.message,
          }
        : undefined;
  const [claimed, setClaimed] = useState(false);
  const claim = useCallback((_: string, on: boolean) => setClaimed(on), []);
  const target = useMemo(
    () =>
      shown && {
        label: shown.label,
        message: shown.message,
        claim,
        touch: () => {},
      },
    [shown?.label, shown?.message, claim],
  );

  async function prepare() {
    if (blocked) return;
    job.current?.dispose();
    const client = new EngineClient();
    job.current = client;
    const id = ++jobId.current;
    const q = request;
    const k = key;
    setRunning(true);
    setError(undefined);
    setStatus("Preparing the solid…");
    const start = performance.now();
    try {
      const { result, timings } = await client.laceSolid(q);
      if (id !== jobId.current) return;
      setPrepared({
        key: k,
        solid: result,
        wall: performance.now() - start,
        worker: timings?.prepare,
        bytes: timings?.bytes,
      });
      // On a phone the drawing sits above the controls: bring the new
      // solid into view.
      requestAnimationFrame(() =>
        viewRef.current?.scrollIntoView({ block: "nearest" }),
      );
      setStatus(
        result.validated
          ? "Prepared and validated: every required check passes."
          : "Prepared, not validated: a required check fails or is unresolved.",
      );
    } catch (e) {
      if (id !== jobId.current) return;
      setStatus("");
      setError({
        message: e instanceof Error ? e.message : String(e),
        field: e instanceof EngineError ? e.field : undefined,
        key: k,
      });
    } finally {
      if (id === jobId.current) {
        setRunning(false);
        client.dispose();
        if (job.current === client) job.current = null;
      }
    }
  }
  function cancel() {
    jobId.current++;
    job.current?.dispose();
    job.current = null;
    setRunning(false);
    setStatus("Canceled; nothing was prepared.");
  }
  function save() {
    if (!prepared || !current) return;
    const s = prepared.solid;
    const name = `hyperbolic-lace-${source.tiling.replace(",", "-")}-${p.treatment}-${readout(p.diameter)}mm${s.validated ? "" : "-not-validated"}.3mf`;
    saveFile(new Blob([s.package as BlobPart], { type: "model/3mf" }), name);
  }

  const set = <K extends keyof LacePhysical>(k: K, v: LacePhysical[K]) =>
    update((s) => ({ ...s, [k]: v }));
  // A length in millimeters, or a fraction of the disk, as a constant
  // expression. Empty is NaN, which an optional field takes as automatic.
  const length = (
    field: string,
    value: number | undefined,
    apply: (s: LacePhysical, v: number) => LacePhysical,
    help?: Parameters<typeof Field>[0]["help"],
  ) => {
    const name = label(field)!;
    return (
      <Field key={field} label={name} help={help}>
        <ScalarInput
          name={name}
          value={value ?? NaN}
          retained={retained}
          onChange={(v) => update((s) => apply(s, v))}
        />
      </Field>
    );
  };
  const profileField = (k: ProfileLength) =>
    length(`profile.${k}`, p.profile[k], (s, v) => ({
      ...s,
      profile: { ...s.profile, [k]: v },
    }));
  const bedField = (i: 0 | 1 | 2) =>
    length(`profile.envelope.${i}`, p.profile.envelope[i], (s, v) => {
      const envelope = [...s.profile.envelope] as [number, number, number];
      envelope[i] = v;
      return { ...s, profile: { ...s.profile, envelope } };
    });
  const printer = defaultProfiles.findIndex((d) => d.id === p.profile.id);
  const preset = [2, 3].find(
    (w) => p.line === w && p.profile.wall === w && p.profile.strut === w,
  );
  const s = prepared?.solid;
  return (
    <FieldErrorContext.Provider value={target ?? null}>
      <div className="garden-layout lace-workshop">
        <main className="lace-workshop-main">
          <div className="lace-workshop-figure">
            <div
              ref={viewRef}
              className="garden-view lace-workshop-view"
              aria-busy={running}
            >
              {s ? (
                <TopView
                  solid={s}
                  overlay={overlay}
                  dark={theme.dark}
                  scheme={theme.scheme}
                  stale={!current}
                />
              ) : (
                <p className="garden-placeholder">
                  {running
                    ? "Preparing the solid…"
                    : "Choose a size and treatment, then prepare the solid."}
                </p>
              )}
            </div>
            {s && <Legend solid={s} dark={theme.dark} scheme={theme.scheme} />}
          </div>
          {s && <Report solid={s} prepared={prepared!} stale={!current} />}
        </main>
        <aside>
          <section
            className="lace-workshop-controls"
            aria-labelledby="lace-workshop-title"
          >
            <div className="lace-workshop-heading">
              <h3 id="lace-workshop-title">Make physical</h3>
              <button
                ref={back}
                type="button"
                onClick={(e) =>
                  onClose(e.detail === 0 ? "keyboard" : "pointer")
                }
              >
                Back to the lace
              </button>
            </div>
            <p className="note">
              A printable plaque of this lace, drawn as the 3MF file holds it.
            </p>
            <Field label="Treatment" help={workshopHelp.treatment}>
              <select
                value={p.treatment}
                onChange={(e) =>
                  set("treatment", e.currentTarget.value as Treatment)
                }
              >
                <option value="raised">Raised lines</option>
                <option value="recessed">Recessed grooves</option>
              </select>
            </Field>
            <div className="pair">
              {length(
                "diameter",
                p.diameter,
                (s, v) => ({ ...s, diameter: v }),
                workshopHelp.diameter,
              )}
              {length(
                "design.line",
                p.line,
                (s, v) => ({ ...s, line: v }),
                workshopHelp.line,
              )}
            </div>
            <div className="pair">
              {length(
                "design.floor",
                p.floor,
                (s, v) => ({ ...s, floor: v }),
                workshopHelp.floor,
              )}
              {length(
                "design.relief",
                p.relief,
                (s, v) => ({ ...s, relief: v }),
                workshopHelp.relief[p.treatment],
              )}
            </div>
            <Field label="Wall preset" help={workshopHelp.preset}>
              <select
                value={preset ?? ""}
                onChange={(e) => {
                  const w = Number(e.currentTarget.value);
                  if (!w) return;
                  update((s) => ({
                    ...s,
                    line: w,
                    profile: { ...s.profile, wall: w, strut: w },
                  }));
                }}
              >
                <option value="">Custom</option>
                <option value="2">2 mm</option>
                <option value="3">3 mm</option>
              </select>
            </Field>
            <Field label="Lines" help={workshopHelp.lines}>
              <select
                value={p.lines}
                onChange={(e) => set("lines", e.currentTarget.value as Lines)}
              >
                <option value="motif">Motif</option>
                <option value="sides">Tile sides</option>
                <option value="both">Motif and tile sides</option>
              </select>
            </Field>
            <Field label="Rim" help={workshopHelp.rim}>
              <select
                value={p.rim}
                onChange={(e) => {
                  const rim = e.currentTarget.value as Rim;
                  update((s) => ({
                    ...s,
                    rim,
                    // A crop needs a radius it accepts.
                    ...(rim === "crop" &&
                      !(s.clip !== undefined && s.clip <= 0.95) && {
                        clip: cropClip,
                      }),
                  }));
                }}
              >
                <option value="motif">Whole tiles</option>
                <option value="rim">Clean rim</option>
                <option value="crop">Crop and enlarge</option>
              </select>
            </Field>
            {p.rim !== "motif" &&
              length(
                "clip",
                p.clip,
                (s, v) => {
                  if (Number.isNaN(v) && s.rim === "rim") {
                    const { clip: _, ...rest } = s;
                    return rest;
                  }
                  return { ...s, clip: v };
                },
                workshopHelp.clip[p.rim],
              )}
            <CheckSetting
              label="Remove features below the minimums"
              topic="removing features below the minimums"
              checked={!!p.simplify}
              onChange={(on) =>
                update(({ simplify: _, ...s }) =>
                  on ? { ...s, simplify: true } : s,
                )
              }
              help={workshopHelp.simplify}
            />
            <CheckSetting
              label="Face down"
              topic="Face down"
              checked={!!p.faceDown}
              onChange={(on) =>
                update(({ faceDown: _, ...s }) =>
                  on ? { ...s, faceDown: true } : s,
                )
              }
              help={workshopHelp.faceDown}
            />
            <Field label="Printer" help={workshopHelp.printer}>
              <select
                value={printer < 0 ? "link" : String(printer)}
                onChange={(e) => {
                  const d = defaultProfiles[Number(e.currentTarget.value)];
                  if (d)
                    update((s) => ({
                      ...s,
                      profile: withPrinter(s.profile, d),
                    }));
                }}
              >
                {defaultProfiles.map((d, i) => (
                  <option key={d.id} value={i}>
                    {printerName(d.name)}
                  </option>
                ))}
                {printer < 0 && (
                  <option value="link">
                    {printerName(p.profile.name) || "From the link"}
                  </option>
                )}
              </select>
            </Field>
            <p className="note">
              {readout(p.profile.nozzle)} mm nozzle,{" "}
              {readout(p.profile.layerHeight)} mm layers; bed{" "}
              {readout(p.profile.envelope[0])} ×{" "}
              {readout(p.profile.envelope[1])} ×{" "}
              {readout(p.profile.envelope[2])} mm
              {profileEdited(p.profile)
                ? defaultProfile(p.profile.id)
                  ? "; values edited."
                  : "; values from the link."
                : "."}
            </p>
            <details className="lace-workshop-profile">
              <summary>Minimums the checks use</summary>
              {paired(minimums.map(profileField))}
              {paired(finest.map(profileField))}
              <p className="note">
                Each check needs the larger of a minimum and the printer's
                finest value.
              </p>
            </details>
            <details className="lace-workshop-profile">
              <summary>Printer bed and slicing</summary>
              {paired(([0, 1, 2] as const).map(bedField))}
              {paired(slicing.map(profileField))}
              <p className="note">
                The slicing values only count the layers each height prints in;
                choose them in the slicer.
              </p>
            </details>
            {length(
              "grid",
              p.grid,
              (s, v) => {
                if (Number.isNaN(v)) {
                  const { grid: _, ...rest } = s;
                  return rest;
                }
                return { ...s, grid: v };
              },
              workshopHelp.grid,
            )}
            <div className="animation-buttons">
              <button
                type="button"
                disabled={running || blocked}
                onClick={() => void prepare()}
              >
                {current ? "Prepare again" : "Prepare solid"}
              </button>
              <button type="button" disabled={!running} onClick={cancel}>
                Cancel
              </button>
            </div>
            <button
              type="button"
              className="lace-workshop-save"
              disabled={!current || running}
              onClick={save}
            >
              {s && current && !s.validated
                ? "Save 3MF (not validated) ↓"
                : "Save 3MF ↓"}
            </button>
            <p className="note" role="status">
              {status}
              {prepared && !current && !running
                ? " Settings changed: prepare again before saving."
                : ""}
            </p>
            {shown && !claimed && <StudyError message={shown.message} />}
          </section>
        </aside>
      </div>
    </FieldErrorContext.Provider>
  );
}

// TopView draws the solid's upward faces from its actual triangles: the
// plan's top in the motif's ink, the rest's in a pale ink, then the
// source's left-out tiles faintly, simplified detail, failing cells,
// narrow gaps and fused pieces. Geometry only.
function TopView({
  solid,
  overlay,
  dark,
  scheme,
  stale,
}: {
  solid: LaceSolid;
  overlay?: LaceResult;
  dark: boolean;
  scheme: Parameters<typeof plotPalette>[1];
  stale: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const size = Math.round(c.clientWidth * devicePixelRatio) || 800;
    c.width = size;
    c.height = size;
    const g = c.getContext("2d")!;
    const p = plotPalette(dark, scheme);
    g.fillStyle = p.bg;
    g.fillRect(0, 0, size, size);
    const R = solid.radius;
    const k = (size / 2 - 8) / R;
    const X = (x: number) => size / 2 + x * k;
    const Y = (y: number) => size / 2 - y * k;
    // A solid turned over for printing is drawn as designed, face up:
    // the turn (x, y, z) → (x, −y, H − z) is its own inverse.
    const H = Math.max(solid.levels.Plan, solid.levels.Rest);
    const v = solid.faceDown
      ? solid.vertices.map((x, i) =>
          i % 3 === 1 ? -x : i % 3 === 2 ? H - x : x,
        )
      : solid.vertices;
    const t = solid.triangles;
    const planZ = solid.levels.Plan,
      restZ = solid.levels.Rest;
    // Opaque inks, the floor's mixed toward the background, so that the
    // thin strokes hiding seams between triangles never show as a mesh.
    for (const [z, ink] of [
      [restZ, mix(p.line, p.bg, 0.25)],
      [planZ, p.base],
    ] as const) {
      g.beginPath();
      for (let i = 0; i < t.length; i += 3) {
        const a = 3 * t[i],
          b = 3 * t[i + 1],
          d = 3 * t[i + 2];
        if (v[a + 2] !== z || v[b + 2] !== z || v[d + 2] !== z) continue;
        const cross =
          (v[b] - v[a]) * (v[d + 1] - v[a + 1]) -
          (v[b + 1] - v[a + 1]) * (v[d] - v[a]);
        if (cross <= 0) continue;
        g.moveTo(X(v[a]), Y(v[a + 1]));
        g.lineTo(X(v[b]), Y(v[b + 1]));
        g.lineTo(X(v[d]), Y(v[d + 1]));
        g.closePath();
      }
      g.fillStyle = ink;
      g.fill();
      g.strokeStyle = ink;
      g.lineWidth = 0.6;
      g.stroke();
    }
    // The source's tiles the cutoff left out, faintly.
    if (overlay && solid.cutoff.tiles) {
      const kept = new Set(solid.cutoff.tiles);
      const n = overlay.center.length;
      const per = overlay.arcFirst ? 0 : overlay.arcStart.length / n;
      g.strokeStyle = p.incident;
      g.globalAlpha = 0.55;
      g.lineWidth = 1;
      g.beginPath();
      for (let i = 0; i < n; i++) {
        if (kept.has(i)) continue;
        const lo = overlay.arcFirst ? overlay.arcFirst[i] : i * per,
          hi = overlay.arcFirst ? overlay.arcFirst[i + 1] : (i + 1) * per;
        for (let j = lo; j < hi; j++) {
          const sc = solid.scale;
          const a = overlay.arcStart[j],
            b = overlay.arcEnd[j];
          g.moveTo(X(a.x * sc), Y(a.y * sc));
          if (overlay.arcStraight[j]) g.lineTo(X(b.x * sc), Y(b.y * sc));
          else {
            const c = overlay.arcCenter[j];
            const t0 = Math.atan2(-(a.y - c.y), a.x - c.x),
              t1 = Math.atan2(-(b.y - c.y), b.x - c.x);
            let d = t1 - t0;
            while (d > Math.PI) d -= 2 * Math.PI;
            while (d < -Math.PI) d += 2 * Math.PI;
            g.arc(
              X(c.x * sc),
              Y(c.y * sc),
              overlay.arcRadius[j] * sc * k,
              t0,
              t0 + d,
              d < 0,
            );
          }
        }
      }
      g.stroke();
      g.globalAlpha = 1;
    }
    // What removing features below the minimums changed.
    if (solid.simplifiedAt) {
      g.fillStyle = p.incident;
      for (let i = 0; i < solid.simplifiedAt.length; i += 2)
        g.fillRect(
          X(solid.simplifiedAt[i]) - 1,
          Y(solid.simplifiedAt[i + 1]) - 1,
          2,
          2,
        );
    }
    // Narrow gaps, failing cells and fused pieces.
    if (solid.narrow) {
      g.fillStyle = p.probe;
      for (let i = 0; i < solid.narrow.length; i += 2)
        g.fillRect(X(solid.narrow[i]) - 1, Y(solid.narrow[i + 1]) - 1, 2, 2);
    }
    g.strokeStyle = p.derived;
    g.lineWidth = 2;
    for (const c of solid.problems ?? []) {
      g.beginPath();
      g.arc(X(c.x), Y(c.y), Math.max(4, c.radius * k), 0, 2 * Math.PI);
      g.stroke();
    }
    if (solid.fusedAt) {
      g.fillStyle = p.derived;
      for (let i = 0; i < solid.fusedAt.length; i += 2) {
        g.beginPath();
        g.arc(
          X(solid.fusedAt[i]),
          Y(solid.fusedAt[i + 1]),
          2.5,
          0,
          2 * Math.PI,
        );
        g.fill();
      }
    }
  }, [solid, overlay, dark, scheme]);
  return (
    <canvas
      ref={canvas}
      className="lace-workshop-canvas"
      data-stale={stale || undefined}
      data-triangles={solid.triangles.length / 3}
      role="img"
      aria-label={
        stale
          ? "Top view of the plaque last prepared, before the settings changed"
          : "Top view of the prepared plaque"
      }
    />
  );
}

// a toward b: an opaque mix of two #rrggbb inks, t of a.
function mix(a: string, b: string, t: number) {
  const c = (h: string, i: number) =>
    parseInt(h.slice(1 + 2 * i, 3 + 2 * i), 16);
  const ch = (i: number) =>
    Math.round(c(a, i) * t + c(b, i) * (1 - t))
      .toString(16)
      .padStart(2, "0");
  return `#${ch(0)}${ch(1)}${ch(2)}`;
}

function Legend({
  solid,
  dark,
  scheme,
}: {
  solid: LaceSolid;
  dark: boolean;
  scheme: Parameters<typeof plotPalette>[1];
}) {
  const p = plotPalette(dark, scheme);
  const raised = solid.levels.Plan > solid.levels.Rest;
  const swatch = (color: string) => (
    <span
      className="base-dot"
      style={{ background: color, borderColor: color }}
    />
  );
  return (
    <div className="legend garden-legend">
      <LegendEntries
        entries={[
          {
            key: "plan",
            shown: true,
            content: (
              <>
                {swatch(p.base)}
                {raised ? "Raised lines" : "Grooves"}
              </>
            ),
          },
          {
            key: "rest",
            shown: solid.levels.Rest > 0,
            content: (
              <>
                {swatch(mix(p.line, p.bg, 0.25))}
                {raised ? "Floor" : "Slab"}
              </>
            ),
          },
          {
            key: "left-out",
            shown: !!solid.cutoff.tiles,
            content: (
              <>
                {swatch(p.incident)}
                Left out
              </>
            ),
          },
          {
            key: "simplified",
            shown: !!solid.simplifiedAt?.length,
            content: (
              <>
                {swatch(p.incident)}
                Simplified
              </>
            ),
          },
          {
            key: "failing",
            shown: !!solid.problems?.length || !!solid.fusedAt?.length,
            content: (
              <>
                {swatch(p.derived)}
                Failing
              </>
            ),
          },
          {
            key: "narrow",
            shown: !!solid.narrow?.length,
            content: (
              <>
                {swatch(p.probe)}
                Narrow gaps
              </>
            ),
          },
        ]}
      />
    </div>
  );
}

const statusWord: Record<CheckItem["status"], string> = {
  pass: "Passes",
  fail: "Fails",
  unresolved: "Unresolved",
  warn: "Note",
};

function Checks({ title, checks }: { title: string; checks: CheckItem[] }) {
  if (!checks.length) return null;
  return (
    <>
      <h4 className="lace-workshop-group">{title}</h4>
      <ul className="lace-workshop-checks" aria-label={title}>
        {checks.map((c) => (
          <li key={c.id} data-status={c.status}>
            <p className="lace-check-head">
              <span>{c.label}</span>
              <strong>{statusWord[c.status]}</strong>
            </p>
            <p className="lace-check-detail">{checkDetail(c)}</p>
            {c.hint && c.status !== "pass" && (
              <p className="lace-check-hint">{c.hint}</p>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

// How a length check's limit reads: a bound the value may not pass, the
// height a slicer prints, or the least it needs.
const limitWord = (id: string) =>
  id === "envelope"
    ? "at most"
    : id.startsWith("layers-")
      ? "slices to"
      : id === "resolution"
        ? "at most"
        : "needs";
// A check's evidence, a length against its limit, and Go's detail, which
// carries every count.
function checkDetail(c: CheckItem) {
  const evidence = {
    exact: "Exact",
    conservative: "Conservative",
    sampled: "Sampled",
    measured: "Measured",
  }[c.evidence];
  const parts = [evidence];
  // Simplifying judges the grid step itself, a length.
  if (lengths.has(c.id) || (c.id === "resolution" && c.limit > 0))
    parts.push(
      !c.limit
        ? `${readout(c.value, 4)} mm`
        : `${readout(c.value, 4)} mm, ${limitWord(c.id)} ${readout(c.limit, 4)} mm`,
    );
  if (c.detail) parts.push(c.detail);
  return parts.join(" · ");
}

function Report({
  solid: s,
  prepared,
  stale,
}: {
  solid: LaceSolid;
  prepared: Prepared;
  stale: boolean;
}) {
  const required = s.checks.filter((c) => c.required);
  const failing = required.filter((c) => c.status === "fail").length;
  const unresolved = required.filter((c) => c.status === "unresolved").length;
  const verdict = s.validated
    ? "Validated: every required check passes."
    : `Not validated: ${[
        failing &&
          plural(failing, "required check fails", "required checks fail"),
        unresolved && plural(unresolved, "is unresolved", "are unresolved"),
      ]
        .filter(Boolean)
        .join(" and ")}.`;
  const why =
    s.cutoff.reason === "manufacturing"
      ? `Whole tiles from ${readout(s.cutoff.radius, 3)} of the disk's radius on are left out, where they grow too fine.`
      : s.cutoff.reason === "clip"
        ? `A frame cuts the lace at ${readout(s.clip, 3)} of the disk's radius.`
        : "The source patch ends before any tile grows too fine.";
  const w = s.mesh.max[0] - s.mesh.min[0],
    d = s.mesh.max[1] - s.mesh.min[1],
    h = s.mesh.max[2] - s.mesh.min[2];
  return (
    <section
      className="lace-workshop-report"
      aria-label="Solid report"
      data-stale={stale || undefined}
    >
      <p
        className="lace-workshop-verdict"
        data-validated={s.validated || undefined}
      >
        <strong>{verdict}</strong>
        {stale ? " Settings changed since: prepare again." : ""}
      </p>
      <p className="note">
        {readout(w, 5)} × {readout(d, 5)} × {readout(h, 5)} mm,{" "}
        {plural(s.mesh.components, "body", "bodies")}
        {s.faceDown ? ", turned face down for printing" : ""}.{" "}
        {count(s.cutoff.admitted)} of {count(s.source.tiles)} tiles kept. {why}{" "}
        {s.levels.Plan > s.levels.Rest
          ? `Lines rise to ${readout(s.levels.Plan)} mm${s.levels.Rest ? `, the floor's top at ${readout(s.levels.Rest)} mm` : ""}.`
          : `The slab's top is at ${readout(s.levels.Rest)} mm, the grooves' floors at ${readout(s.levels.Plan)} mm.`}
      </p>
      <Checks
        title="The solid"
        checks={s.checks.filter((c) => geometry.has(c.id))}
      />
      <Checks
        title="Against the printer"
        checks={s.checks.filter((c) => c.required && !geometry.has(c.id))}
      />
      <Checks title="Notes" checks={s.checks.filter((c) => !c.required)} />
      <details className="lace-workshop-work">
        <summary>Construction and work</summary>
        <p className="note">
          Scale {readout(s.scale, 4)} mm per unit of the disk's radius; grid
          step {readout(s.grid, 3)} mm. The contour lies within{" "}
          {readout(s.stats.deviation, 3)} mm of the exact boundary;{" "}
          {plural(s.stats.specks, "speck")} under a grid step filled.{" "}
          {plural(s.source.pieces, "separate source piece")}.
        </p>
        <p className="note">
          {count(s.stats.strokes)} strokes, {count(s.stats.nodes)} field nodes,{" "}
          {count(s.stats.vertices)} vertices, {count(s.stats.triangles)}{" "}
          triangles, {count(s.stats.pairTests)} triangle-pair tests. Prepared in{" "}
          {readout(prepared.wall / 1000, 3)} s
          {prepared.worker !== undefined
            ? ` (${readout(prepared.worker / 1000, 3)} s in the worker)`
            : ""}
          ; the file is {mebibytes(s.stats.packageBytes)}
          {s.stats.memory
            ? `, and the worker's memory reached ${mebibytes(s.stats.memory)}`
            : ""}
          .
        </p>
      </details>
    </section>
  );
}
