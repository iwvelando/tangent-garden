// #543 research: the plaque workshop, shown only with ?research=543. It
// freezes the lace's source when opened, prepares a solid in its own
// worker, one job at a time, draws the solid's actual top faces, lists
// every check, and saves the 3MF package. Closing it returns to the lace
// as it was; nothing here enters study links.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { EngineClient, EngineError } from "../engine-client";
import { saveFile } from "../export-image";
import { Field, FieldErrorContext } from "../Field";
import { LegendEntries } from "../Legend";
import { count, mebibytes, readout } from "../number-format";
import { plotPalette } from "../palette";
import { useTheme } from "../useTheme";
import type { LaceRequest, LaceResult } from "./model";
import {
  defaultProfiles,
  type LaceSolid,
  type LaceSolidRequest,
  type Profile,
  type Rim,
  type Lines,
  type Treatment,
} from "./physical";

type Settings = {
  diameter: string;
  treatment: Treatment;
  line: string;
  floor: string;
  relief: string;
  rim: Rim;
  clip: string;
  grid: string;
  profile: number;
  lines: Lines;
  simplify: boolean;
  faceDown: boolean;
};

const initial: Settings = {
  diameter: "120",
  treatment: "raised",
  line: "2",
  floor: "1.6",
  relief: "1.2",
  rim: "motif",
  clip: "",
  grid: "",
  profile: 0,
  lines: "motif",
  simplify: false,
  faceDown: false,
};

// The profile's editable fields, grouped by what they are for: the
// minimums the checks use, and the slicing values that only count layers
// in the report. Neither changes the solid.
const minimumFields: [keyof Profile, string][] = [
  ["wall", "Minimum wall"],
  ["strut", "Minimum raised line"],
  ["gap", "Minimum gap"],
  ["floor", "Minimum floor"],
  ["xyDetail", "Printer's finest wall"],
  ["xyGap", "Printer's finest gap"],
  ["zDetail", "Printer's finest height step"],
];
const slicingFields: [keyof Profile, string][] = [
  ["nozzle", "Nozzle"],
  ["extrusionWidth", "Extrusion width"],
  ["firstLayer", "First layer height"],
  ["layerHeight", "Layer height"],
];
const profileFields = [...minimumFields, ...slicingFields];

const number = (text: string) => {
  const t = text.trim();
  return t === "" ? NaN : Number(t);
};

type Prepared = {
  key: string;
  solid: LaceSolid;
  wall: number;
  worker?: number;
  bytes?: number;
};

export function PhysicalWorkshop({
  source,
  lines,
  onClose,
}: {
  source: LaceRequest;
  // What the study draws: the motif, the tile sides, or both.
  lines: Lines;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [settings, setSettings] = useState<Settings>(() => ({
    ...initial,
    lines,
  }));
  const [profiles, setProfiles] = useState<Profile[]>(() =>
    structuredClone(defaultProfiles),
  );
  const [profileText, setProfileText] = useState<Record<string, string>>({});
  const [prepared, setPrepared] = useState<Prepared>();
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<{ message: string; field?: string }>();
  const [overlay, setOverlay] = useState<LaceResult>();
  const job = useRef<EngineClient | null>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const jobId = useRef(0);

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
  useEffect(() => () => job.current?.dispose(), []);

  const profile = profiles[settings.profile];
  const request = (): LaceSolidRequest | { message: string; field: string } => {
    const fields: [string, string, number][] = [
      ["diameter", "Diameter", number(settings.diameter)],
      ["design.line", "Line width", number(settings.line)],
      ["design.floor", "Floor", number(settings.floor)],
      [
        "design.relief",
        settings.treatment === "raised" ? "Relief" : "Depth",
        number(settings.relief),
      ],
    ];
    const grid = settings.grid.trim() === "" ? 0 : number(settings.grid);
    if (!Number.isFinite(grid))
      return {
        field: "grid",
        message: "Grid step: enter a number or leave it empty.",
      };
    for (const [field, label, v] of fields)
      if (!Number.isFinite(v))
        return { field, message: `${label}: enter a number.` };
    const clip = number(settings.clip);
    if (settings.rim === "crop" && !Number.isFinite(clip))
      return { field: "clip", message: "Crop radius: enter a number." };
    if (settings.clip.trim() !== "" && !Number.isFinite(clip))
      return {
        field: "clip",
        message: "Rim radius: enter a number or leave it empty.",
      };
    const edited = { ...profile };
    for (const [k, label] of profileFields) {
      const text = profileText[`${settings.profile}.${k}`];
      if (text === undefined) continue;
      const v = number(text);
      if (!Number.isFinite(v))
        return { field: `profile.${k}`, message: `${label}: enter a number.` };
      (edited as Record<string, unknown>)[k] = v;
    }
    return {
      lace: source,
      diameter: fields[0][2],
      design: {
        treatment: settings.treatment,
        line: fields[1][2],
        floor: fields[2][2],
        relief: fields[3][2],
        ...(settings.simplify && { simplify: true }),
        ...(settings.faceDown && { faceDown: true }),
      },
      rim: settings.rim,
      ...(Number.isFinite(clip) && { clip }),
      ...(grid > 0 && { grid }),
      lines: settings.lines,
      profile: edited,
    };
  };
  const built = request();
  const key = "lace" in built ? JSON.stringify(built) : "";
  const current = !!prepared && prepared.key === key;

  async function prepare() {
    const q = request();
    if (!("lace" in q)) {
      setError(q);
      return;
    }
    job.current?.dispose();
    const client = new EngineClient();
    job.current = client;
    const id = ++jobId.current;
    setRunning(true);
    setError(undefined);
    setStatus("Preparing the solid…");
    const start = performance.now();
    try {
      const { result, timings } = await client.laceSolid(q);
      if (id !== jobId.current) return;
      setPrepared({
        key: JSON.stringify(q),
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
          ? "Prepared: every required check passes."
          : "Prepared, not validated: a required check fails or is unresolved.",
      );
    } catch (e) {
      if (id !== jobId.current) return;
      setStatus("");
      setError({
        message: e instanceof Error ? e.message : String(e),
        field: e instanceof EngineError ? e.field : undefined,
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
    setStatus("Canceled; the source lace is unchanged.");
  }
  function save() {
    if (!prepared || !current) return;
    const s = prepared.solid;
    const name = `hyperbolic-lace-${settings.treatment}-${readout(number(settings.diameter))}mm${s.validated ? "" : "-not-validated"}.3mf`;
    saveFile(new Blob([s.package as BlobPart], { type: "model/3mf" }), name);
  }

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    setSettings((s) => ({ ...s, [k]: v }));
  const text = (
    k: keyof Settings,
    label: string,
    unit: string,
    help: string,
  ) => (
    <Field label={`${label} (${unit})`} help={help}>
      <input
        type="text"
        inputMode="decimal"
        value={settings[k] as string}
        onChange={(e) => set(k, e.currentTarget.value as never)}
      />
    </Field>
  );
  const check = (k: "simplify" | "faceDown", label: string, help: string) => (
    <Field label={label} help={help}>
      <input
        type="checkbox"
        checked={settings[k]}
        onChange={(e) => set(k, e.currentTarget.checked)}
      />
    </Field>
  );
  const profileField = (k: keyof Profile, label: string) => (
    <Field key={k} label={label}>
      <input
        type="text"
        inputMode="decimal"
        value={profileText[`${settings.profile}.${k}`] ?? String(profile[k])}
        onChange={(e) => {
          const v = e.currentTarget.value;
          setProfileText((t) => ({ ...t, [`${settings.profile}.${k}`]: v }));
        }}
      />
    </Field>
  );
  const s = prepared?.solid;
  return (
    <FieldErrorContext.Provider value={null}>
      <div className="garden-layout lace-workshop">
        <main className="lace-workshop-main">
          <div
            ref={viewRef}
            className="garden-view lace-workshop-view"
            aria-busy={running || undefined}
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
              <p className="garden-placeholder" role="status">
                {running
                  ? "Preparing the solid…"
                  : "Choose a size and treatment, then prepare the solid."}
              </p>
            )}
          </div>
          {s && <Legend solid={s} dark={theme.dark} scheme={theme.scheme} />}
          {s && <Report solid={s} prepared={prepared!} />}
        </main>
        <aside>
          <section aria-label="Make physical (research)">
            <p className="eyebrow">Research preview · #543</p>
            <h3>Make physical</h3>
            <p className="note">
              A plaque from this lace, as the 3MF file will hold it. Not a
              public feature: limits and checks are being evaluated.
            </p>
            <Field
              label="Treatment"
              help="Raised lines on a floor, or grooves cut into a slab."
            >
              <select
                value={settings.treatment}
                onChange={(e) =>
                  set("treatment", e.currentTarget.value as Treatment)
                }
              >
                <option value="raised">Raised</option>
                <option value="recessed">Recessed</option>
              </select>
            </Field>
            {text(
              "diameter",
              "Diameter",
              "mm",
              "The plaque's diameter: 10–300 mm.",
            )}
            <Field
              label="Wall preset"
              help="Sets the line width and the requested wall and strut: 2 or 3 mm."
            >
              <select
                value={
                  profile.wall === 3 && number(settings.line) === 3
                    ? "3"
                    : profile.wall === 2 && number(settings.line) === 2
                      ? "2"
                      : ""
                }
                onChange={(e) => {
                  const w = Number(e.currentTarget.value);
                  if (!w) return;
                  set("line", String(w));
                  setProfiles((ps) =>
                    ps.map((p) => ({ ...p, wall: w, strut: w })),
                  );
                  setProfileText((t) => {
                    const out = { ...t };
                    for (const k of Object.keys(out))
                      if (k.endsWith(".wall") || k.endsWith(".strut"))
                        delete out[k];
                    return out;
                  });
                }}
              >
                <option value="">Custom</option>
                <option value="2">2 mm</option>
                <option value="3">3 mm</option>
              </select>
            </Field>
            {text(
              "line",
              settings.treatment === "raised" ? "Line width" : "Groove width",
              "mm",
              "The width of every line and of the frame.",
            )}
            {text(
              "floor",
              "Floor",
              "mm",
              settings.treatment === "raised"
                ? "The plaque under the raised lines; 0 prints the lines alone, as openwork."
                : "The material left under a groove; 0 cuts the grooves through, as openwork.",
            )}
            {text(
              "relief",
              settings.treatment === "raised" ? "Relief" : "Depth",
              "mm",
              settings.treatment === "raised"
                ? "How far the lines rise above the floor."
                : "How deep the grooves are cut.",
            )}
            <Field
              label="Lines"
              help="The motif, the tile sides, or both: as the study draws them."
            >
              <select
                value={settings.lines}
                onChange={(e) => set("lines", e.currentTarget.value as Lines)}
              >
                <option value="motif">Motif</option>
                <option value="sides">Tile sides</option>
                <option value="both">Motif and tile sides</option>
              </select>
            </Field>
            <Field
              label="Rim"
              help="Where lines and gaps grow too fine: whole tiles, a framed circle, or an enlarged crop."
            >
              <select
                value={settings.rim}
                onChange={(e) => set("rim", e.currentTarget.value as Rim)}
              >
                <option value="motif">Whole tiles</option>
                <option value="rim">Clean rim</option>
                <option value="crop">Crop and enlarge</option>
              </select>
            </Field>
            {settings.rim !== "motif" &&
              text(
                "clip",
                settings.rim === "crop" ? "Crop radius" : "Rim radius",
                "of the disk",
                settings.rim === "crop"
                  ? "The disk enlarged to the plaque: 0.05–0.95."
                  : "Where the frame cuts the lace: 0.05–0.98; empty chooses it from whole tiles.",
              )}
            {check(
              "simplify",
              "Remove features below the minimums",
              "Removes material thinner than the minimum wall and fills gaps narrower than the minimum gap, and counts what it changed.",
            )}
            {check(
              "faceDown",
              "Face down",
              "Turns the plaque over so its decorated face prints on the bed: suits recessed plaques and openwork.",
            )}
            <Field
              label="Printer profile"
              help="Sets the minimums the checks use and where the file places the plaque; it never changes the solid's shape."
            >
              <select
                value={settings.profile}
                onChange={(e) => set("profile", Number(e.currentTarget.value))}
              >
                {profiles.map((p, i) => (
                  <option key={p.id} value={i}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <details className="lace-workshop-profile">
              <summary>Minimums the checks use (mm)</summary>
              {minimumFields.map(([k, label]) => profileField(k, label))}
              <p className="note">
                A check needs the larger of a minimum and the printer's finest;
                the printer's values are estimates, not calibrations.
              </p>
            </details>
            <details className="lace-workshop-profile">
              <summary>Slicing, for the layer note only (mm)</summary>
              {slicingFields.map(([k, label]) => profileField(k, label))}
              <p className="note">
                These only count the layers each height slices to in the report;
                set them in the slicer. Bed {readout(profile.envelope[0])} ×{" "}
                {readout(profile.envelope[1])} × {readout(profile.envelope[2])}{" "}
                mm.
              </p>
            </details>
            {text(
              "grid",
              "Grid step",
              "mm",
              "The field's sampling step, 0.05–1 mm; empty chooses 0.2 mm, or coarser for a large plaque.",
            )}
            <div className="animation-buttons">
              <button
                type="button"
                disabled={running || !("lace" in built)}
                onClick={() => void prepare()}
              >
                {current ? "Prepare again" : "Prepare solid"}
              </button>
              <button type="button" disabled={!running} onClick={cancel}>
                Cancel
              </button>
            </div>
            <button type="button" disabled={!current || running} onClick={save}>
              {s && current && !s.validated
                ? "Save 3MF (not validated)"
                : "Save 3MF"}
            </button>
            <p className="note" role="status">
              {status}
              {prepared && !current && !running
                ? " Settings changed: prepare again before saving."
                : ""}
            </p>
            {error && (
              <div className="study-error" role="alert">
                <p>{error.message}</p>
              </div>
            )}
            <button type="button" onClick={onClose}>
              Back to the lace
            </button>
          </section>
        </aside>
      </div>
    </FieldErrorContext.Provider>
  );
}

// TopView draws the solid's upward faces from its actual triangles: the
// plan's top in the motif's ink, the rest's in a pale ink, then the
// source's left-out tiles faintly, failing cells, narrow gaps and fused
// pieces. Geometry only.
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
    const mix = (a: string, b: string, t: number) => {
      const c = (h: string, i: number) =>
        parseInt(h.slice(1 + 2 * i, 3 + 2 * i), 16);
      const ch = (i: number) =>
        Math.round(c(a, i) * t + c(b, i) * (1 - t))
          .toString(16)
          .padStart(2, "0");
      return `#${ch(0)}${ch(1)}${ch(2)}`;
    };
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
      style={{ opacity: stale ? 0.45 : 1 }}
      role="img"
      aria-label="Top view of the prepared plaque"
    />
  );
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
  const swatch = (color: string, alpha = 1) => (
    <span
      className="base-dot"
      style={{ background: color, opacity: alpha, borderColor: color }}
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
            shown: true,
            content: (
              <>
                {swatch(p.line, 0.25)}
                {raised ? "Floor" : "Slab"}
              </>
            ),
          },
          {
            key: "left-out",
            shown: true,
            content: (
              <>
                {swatch(p.incident, 0.6)}
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

function Report({
  solid: s,
  prepared,
}: {
  solid: LaceSolid;
  prepared: Prepared;
}) {
  const why =
    s.cutoff.reason === "manufacturing"
      ? `The profile ends the lace: whole tiles from model radius ${readout(s.cutoff.radius, 3)} on are left out.`
      : s.cutoff.reason === "clip"
        ? `A frame cuts the lace at model radius ${readout(s.clip, 3)}.`
        : "The source patch ends before any manufacturing limit.";
  return (
    <section className="lace-workshop-report" aria-label="Solid report">
      <p className="note">
        <strong>{s.validated ? "Validated." : "Not validated."}</strong>{" "}
        {count(s.cutoff.admitted)} of {count(s.source.tiles)} source tiles kept
        ({count(s.cutoff.rounds)} rounds, {count(s.cutoff.failedRounds)}{" "}
        failed). {why} Source: {count(s.source.beyondDepth)} candidates beyond
        the depth, {count(s.source.nearRim)} too near the rim
        {s.source.stopped
          ? `, stopped by the ${s.source.stopped} limit`
          : ""}; {count(s.source.pieces)} separate source{" "}
        {s.source.pieces === 1 ? "piece" : "pieces"}. Scale{" "}
        {readout(s.scale, 4)} mm per model unit; grid step {readout(s.grid, 3)}{" "}
        mm.
      </p>
      <ul className="lace-workshop-checks">
        {s.checks.map((c) => (
          <li key={c.id} data-status={c.status}>
            <p className="lace-check-head">
              <span>
                {c.label}
                {c.required ? "" : " (advisory)"}
              </span>
              <strong>{c.status}</strong>
            </p>
            <p className="lace-check-detail">
              {c.evidence}
              {c.limit
                ? ` · ${readout(c.value, 4)} against ${readout(c.limit, 4)}`
                : c.value
                  ? ` · ${readout(c.value, 4)}`
                  : ""}
              {c.detail ? ` · ${c.detail}` : ""}
            </p>
            {c.hint && c.status !== "pass" && (
              <p className="lace-check-hint">{c.hint}</p>
            )}
          </li>
        ))}
      </ul>
      <p className="note">
        Bounds {readout(s.mesh.max[0] - s.mesh.min[0], 5)} ×{" "}
        {readout(s.mesh.max[1] - s.mesh.min[1], 5)} ×{" "}
        {readout(s.mesh.max[2] - s.mesh.min[2], 5)} mm; volume{" "}
        {readout(s.mesh.volume, 5)} mm³; {count(s.mesh.components)}{" "}
        {s.mesh.components === 1 ? "body" : "bodies"}.{" "}
        {s.levels.Plan > s.levels.Rest
          ? `Raised lines' top at ${readout(s.levels.Plan)} mm, floor's at ${readout(s.levels.Rest)} mm.`
          : `Slab top at ${readout(s.levels.Rest)} mm, groove floors at ${readout(s.levels.Plan)} mm.`}{" "}
        Contour within {readout(s.stats.deviation, 3)} mm of the exact boundary;{" "}
        {count(s.stats.specks)} specks under a grid step filled.
      </p>
      <p className="note">
        Work: {count(s.stats.strokes)} strokes, {count(s.stats.nodes)} field
        nodes, {count(s.stats.evaluations)} stroke evaluations,{" "}
        {count(s.stats.vertices)} vertices, {count(s.stats.triangles)}{" "}
        triangles, {count(s.stats.pairTests)} triangle-pair tests. Time:{" "}
        {readout(prepared.wall, 4)} ms from request to reply
        {prepared.worker !== undefined
          ? `, ${readout(prepared.worker, 4)} ms in the worker`
          : ""}{" "}
        (
        {Object.entries(s.stats.millis)
          .map(([k, v]) => `${k} ${readout(v, 3)}`)
          .join(", ")}{" "}
        ms). Storage: mesh {mebibytes(s.stats.meshBytes)}, package{" "}
        {mebibytes(s.stats.packageBytes)}, transferred{" "}
        {mebibytes(prepared.bytes ?? 0)}, grid arrays about{" "}
        {mebibytes(s.stats.workingBytes)}
        {s.stats.memory
          ? `; the worker's Go memory reached ${mebibytes(s.stats.memory)}`
          : ""}
        .
      </p>
    </section>
  );
}
