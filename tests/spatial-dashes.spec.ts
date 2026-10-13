import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { deflateRawSync } from "node:zlib";
import { choosePreset } from "./helpers";
import {
  arcLengths,
  dashMeasures,
  dashOn,
  dashesPerPixel,
  dashesPerUnit,
  defaultSight,
  pagePhases,
  sightHelp,
  sightRecord,
  type Sight,
} from "../web/spatial/sight";
import {
  buildScene,
  camera,
  clip,
  page as pageOf,
  type Lens,
  type View,
} from "../web/spatial/scene";
import { linework, type LineGroup } from "../web/spatial/linework";
import { defaultLayers } from "../web/spatial/renderer";
import { spatialPresets } from "../web/spatial/presets";
import type { SpatialResult, Vec3 } from "../web/spatial/types";
import { curveMesh } from "./curve-mesh";

// Dashes behind sheets measured on the page: one period every 1% of the
// page's shorter side along the line as drawn, whatever its depth or tilt,
// rather than along the line in space, where perspective lengthens near
// dashes and shortens far ones.
const size = { width: 2000, height: 1520 };
const period = 15.2,
  on = dashOn * period;
const at = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const O = at(0, 0, 0);
const frac = (x: number) => x - Math.floor(x);
const pairs = (points: [Vec3, Vec3][]) =>
  new Float32Array(
    points.flatMap(([a, b]) =>
      [a, b].flatMap((p) => [p.x, p.y, p.z, 0, 0, 1, 0]),
    ),
  );
const front: View = {
  center: O,
  radius: 1,
  yaw: 0,
  pitch: 0,
  zoom: 1,
  panX: 0,
  panY: 0,
};
const lens = (l: Partial<Lens> = {}): Lens => ({
  projection: "perspective",
  eye: at(0, 0, 1),
  forward: at(1, 0, 0),
  up: at(0, 0, 1),
  fov: 60,
  near: 0.05,
  far: 40,
  ...l,
});
const lensed: View = { ...front, yaw: 0.3, pitch: 0.75, lens: lens() };
const pagePoint = (k: ReturnType<typeof camera>, c: readonly number[]) => {
  const p = pageOf(k, c);
  return [p.x, p.y] as const;
};
const dist = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);

test("the page's dash phase runs along each polyline as drawn, and restarts where it breaks", () => {
  expect(dashMeasures.map((d) => d.value)).toEqual(["space", "page"]);
  expect(defaultSight.dashes).toBeUndefined();
  expect(dashesPerPixel(size)).toBeCloseTo(1 / period, 12);
  // Face on, without perspective, the page measures what space does.
  const k = camera(front, size),
    unit = 760 / 1.16,
    per = 1 / period;
  const data = pairs([
    [at(-1, 0.1, -0.2), at(0, 0.1, -0.2)],
    [at(0, 0.1, -0.2), at(1, 0.1, -0.2)],
    // Tilted out of the page: only its 0.5 across the page counts.
    [at(1, 0.1, -0.2), at(1, 0.6, -0.9)],
    // A gap.
    [at(-1, -0.5, 0), at(-0.5, -0.5, 0)],
  ]);
  const phases = pagePhases(data, k, per);
  // Vertices are 32-bit floats.
  const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 5);
  near(phases[0], 0);
  near(phases[1], unit * per);
  near(phases[2], frac(unit * per));
  near(phases[3], frac(unit * per) + unit * per);
  near(phases[4], frac(phases[3]));
  near(phases[5], phases[4] + 0.5 * unit * per);
  near(phases[6], 0);
  near(phases[7], 0.5 * unit * per);
  // On the first two segments, the phase in space and on the page agree.
  const space = arcLengths(data),
    perUnit = dashesPerUnit(front);
  for (const v of [1, 3]) near(frac(phases[v]), frac(space[v] * perUnit));
});

test("through a lens the phase is affine on the page, from either end, and restarts at the near plane", () => {
  const k = camera(lensed, size),
    per = dashesPerPixel(size);
  // Behind the eye (x < 0) to ahead, ahead to ahead, ahead to behind.
  const A = at(-1, 0.3, 0.5),
    B = at(3, 0.3, 0.5),
    C = at(6, -0.2, 0.9),
    D = at(-2, 0, 1.2);
  const data = pairs([
    [A, B],
    [B, C],
    [C, D],
  ]);
  const phases = pagePhases(data, k, per);
  // Clipped as stored, in 32-bit floats.
  const f = Math.fround;
  const c = [A, B, C, D].map((p) => clip(k, f(p.x), f(p.y), f(p.z)));
  // Where a segment crosses the near plane, z = −w in clip space.
  const crossing = (a: number[], b: number[]) => {
    const t = (a[2] + a[3]) / (a[2] + a[3] - b[2] - b[3]);
    return a.map((v, i) => v + (b[i] - v) * t);
  };
  expect(c[0][2] + c[0][3]).toBeLessThan(0);
  expect(c[3][2] + c[3][3]).toBeLessThan(0);
  const P = crossing(c[0], c[1]);
  // From the near plane the first segment starts anew.
  expect(phases[1]).toBeCloseTo(
    per * dist(pagePoint(k, c[1]), pagePoint(k, P)),
    6,
  );
  // The second continues it.
  expect(phases[2]).toBeCloseTo(frac(phases[1]), 9);
  expect(phases[3]).toBeCloseTo(
    phases[2] + per * dist(pagePoint(k, c[2]), pagePoint(k, c[1])),
    6,
  );
  expect(phases[4]).toBeCloseTo(frac(phases[3]), 9);
  // A hairline interpolates (phase·w, w) along clip space, which the GPU
  // does across a segment, clipped or not: at every point ahead of the near
  // plane their ratio is the phase measured on the page from the end ahead
  // of the eye.
  for (const [s, from, to, anchor] of [
    [0, c[0], c[1], 1],
    [4, c[2], c[3], 0],
  ] as const) {
    const qa = phases[s] * from[3],
      qb = phases[s + 1] * to[3];
    let tried = 0;
    for (let i = 0; i <= 200; i++) {
      const t = i / 200,
        p = from.map((v, j) => v + (to[j] - v) * t);
      if (p[2] + p[3] < 0) continue;
      const q = qa + (qb - qa) * t;
      const want = anchor
        ? phases[s + 1] - per * dist(pagePoint(k, to), pagePoint(k, p))
        : phases[s] + per * dist(pagePoint(k, p), pagePoint(k, from));
      expect(Math.abs(q / p[3] - want), `t = ${t}`).toBeLessThan(
        1e-6 * Math.max(1, Math.abs(want)),
      );
      tried++;
    }
    expect(tried).toBeGreaterThan(20);
  }
});

// The line drawing, as in the sight tests: the square x, y ∈ [−0.5, 0.5]
// at z = 0 faces the view, and lines run behind it.
function study(base: Vec3[], mesh = square()): SpatialResult {
  return {
    base,
    breaks: base.map(() => false),
    minus: [],
    plus: [],
    mesh,
    rulings: [],
    bounds: { center: O, radius: 1 },
    radius: 1,
    omitted: 0,
    invalid: 0,
  };
}
function quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3) {
  const corner = (p: Vec3) => ({
    position: p,
    normal: at(0, 0, 1),
    phase: 0,
    sampleIndex: 0,
  });
  const [p, q, r, s] = [a, b, c, d].map(corner);
  return curveMesh([p, q, r, p, r, s]);
}
const square = () =>
  quad(at(-0.5, -0.5, 0), at(0.5, -0.5, 0), at(0.5, 0.5, 0), at(-0.5, 0.5, 0));
// A floor at z = 0 reaching far behind the perspective eye.
const floor = (r = 50) =>
  quad(at(-r, -r, 0), at(r, -r, 0), at(r, r, 0), at(-r, r, 0));
const dashed = (
  result: SpatialResult,
  view: View,
  dashes?: Sight["dashes"],
): [number, number][][] =>
  (
    linework(buildScene(result), view, defaultLayers, false, {
      ...size,
      occlusion: "sampled",
      hidden: "dashed",
      ...(dashes && { dashes }),
    }) as LineGroup[]
  )
    .find((g) => g.layer === "base" && g.hidden)
    ?.strokes.flatMap((s) => s.paths) ?? [];
const pathLength = (p: [number, number][]) =>
  p.slice(1).reduce((s, q, i) => s + dist(q, p[i]), 0);

test("dashes on the page keep their length on the page when a line tilts away or recedes", () => {
  // Face on, they are the dashes measured in space.
  const behind = [at(-1, 0.1, -0.2), at(0, 0.1, -0.2), at(1, 0.1, -0.2)];
  for (const zoom of [1, 2]) {
    const view = { ...front, zoom };
    const a = dashed(study(behind), view),
      b = dashed(study(behind), view, "page");
    expect(b.length).toBe(a.length);
    b.forEach((p, i) =>
      p.forEach(([x, y], j) => {
        expect(x).toBeCloseTo(a[i][j][0], 6);
        expect(y).toBeCloseTo(a[i][j][1], 6);
      }),
    );
  }
  // Tilted, in space they shorten by the cosine of the tilt; on the page
  // every whole dash is 8.36 px.
  const tilted = [at(-1, 0.1, -0.2), at(1, 0.1, -0.9)];
  const whole = (paths: [number, number][][]) =>
    paths.slice(1, -1).map(pathLength);
  const cos = 2 / Math.hypot(2, 0.7);
  for (const l of whole(dashed(study(tilted), front)))
    expect(l).toBeCloseTo(on * cos, 6);
  const flat = whole(dashed(study(tilted), front, "page"));
  expect(flat.length).toBeGreaterThan(30);
  for (const l of flat) expect(l).toBeCloseTo(on, 6);

  // Through a lens, a line receding behind a floor: in space its dashes
  // shrink on the page by more than half from near to far; on the page
  // every whole dash is 8.36 px, and dashes start one period apart along
  // the line as drawn.
  const from = at(1.5, 0, -0.4),
    to = at(4, 0, -0.4);
  const deep = dashed(study([from, to], floor()), lensed);
  const spans = whole(deep);
  expect(Math.max(...spans) / Math.min(...spans)).toBeGreaterThan(2);
  const even = dashed(study([from, to], floor()), lensed, "page");
  expect(even.length).toBeGreaterThan(15);
  for (const l of whole(even)) expect(l).toBeCloseTo(on, 6);
  for (let i = 2; i < even.length - 1; i++)
    expect(dist(even[i][0], even[i - 1][0])).toBeCloseTo(period, 6);
  // A line passing behind the eye, either way along it: what the page shows
  // is dashed just as evenly.
  for (const ends of [
    [at(4, 0.3, -0.4), at(-3, 0.3, -0.4)],
    [at(-3, 0.3, -0.4), at(4, 0.3, -0.4)],
  ]) {
    const passing = dashed(study(ends, floor()), lensed, "page");
    expect(passing.length).toBeGreaterThan(15);
    const k = camera(lensed, size),
      f = Math.fround,
      ahead = ends[0].x > 0 ? ends[0] : ends[1],
      end = pagePoint(k, clip(k, f(ahead.x), f(ahead.y), f(ahead.z)));
    if (ends[0].x > 0) {
      // Starting ahead of the eye, the line's first dash is whole, from its
      // start.
      expect(dist(passing[0][0], end)).toBeLessThan(1e-6);
      expect(pathLength(passing[0])).toBeCloseTo(on, 6);
    } else {
      // Coming from behind the eye, it ends with the phase pagePhases gives
      // its end: within a dash, or a gap's share of a period past one.
      const phase = frac(
        pagePhases(pairs([ends as [Vec3, Vec3]]), k, 1 / period)[1],
      );
      const last = passing.at(-1)!;
      expect(dist(last.at(-1)!, end)).toBeCloseTo(
        phase < dashOn ? 0 : (phase - dashOn) * period,
        3,
      );
    }
    for (const l of whole(passing)) expect(l).toBeCloseTo(on, 6);
    for (let i = 2; i < passing.length - 1; i++)
      expect(dist(passing[i][0], passing[i - 1][0])).toBeCloseTo(period, 6);
  }
});

test("an export records dashes on the page only when hidden lines are dashed that way", () => {
  const plain = sightRecord({ ...defaultSight, hidden: "dashed" }, true)!;
  expect(plain).not.toHaveProperty("dashes");
  expect(
    sightRecord({ ...defaultSight, hidden: "dashed", dashes: "space" }, true),
  ).toEqual(plain);
  expect(
    sightRecord({ ...defaultSight, hidden: "faint", dashes: "page" }, true),
  ).toEqual(sightRecord({ ...defaultSight, hidden: "faint" }, true));
  const paged = sightRecord(
    { ...defaultSight, hidden: "dashed", dashes: "page" },
    true,
  )!;
  expect(paged).toMatchObject({ hidden: "dashed", dashes: "page" });
  expect(paged.statement).toMatch(/1% of the shorter side/);
  expect(paged.statement).toMatch(/on the page/);
  expect(paged.statement).not.toMatch(/in space/);
});

// Through the real app: a straight core inside a tube along z, seen through
// the wide lens looking down the axis and panned aside, so the core runs
// along the page's middle row from near the eye to far behind the target.
const stage = (p: Page) => p.locator(".spatial-stage");
const settled = (p: Page) =>
  expect(stage(p)).toHaveAttribute("aria-busy", "false");
const sightBox = (p: Page) => p.getByRole("group", { name: "See through" });
const tube = (sight: Partial<Sight>) => {
  const config = structuredClone(spatialPresets[0].config);
  config.format = "parametric";
  config.construction = "canal";
  config.canal = { ...config.canal, radius: 0.25, profile: "1", meridians: 0 };
  // Far from the origin, so positions are measured from a drawing origin
  // near the study; from behind the eye, so the first segment is clipped at
  // the near plane; and in segments longest near the eye, so each dash is
  // placed within its segment.
  config.curve = {
    ...config.curve,
    x: "300",
    y: "-200",
    z: "-2+8*(1-t)^4",
    a: 1,
    min: 0,
    max: 1,
  };
  config.samples = 240;
  config.adaptive = false;
  return {
    config,
    layers: Object.fromEntries(
      Object.keys(defaultLayers).map((k) => [k, k === "surface"]),
    ),
    view: { yaw: 0, pitch: 0, zoom: 1.5, panX: 0.5, panY: 0 },
    animation: { mode: "reveal", camera: "hold", duration: 10, tracks: [] },
    sight: { ...defaultSight, ...sight },
    projection: "wide",
  };
};
const linkTo = (s: unknown) =>
  `/?study=3d#s=${deflateRawSync(
    Buffer.from(JSON.stringify({ v: 1, notebook: "3d", study: s })),
  ).toString("base64url")}`;
async function download(p: Page, item: string | RegExp) {
  await p.getByRole("button", { name: "Export image", exact: true }).click();
  const event = p.waitForEvent("download");
  await p
    .getByRole("menuitem", { name: item, exact: typeof item === "string" })
    .click();
  return readFile((await (await event).path())!);
}
// A band of rows around the page's middle, as RGB, from a PNG.
async function band(p: Page, bytes: Buffer, rows: number) {
  return p.evaluate(
    async ([bytes, rows]) => {
      const bitmap = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: "image/png" }),
      );
      const c = document.createElement("canvas");
      c.width = bitmap.width;
      c.height = bitmap.height;
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(bitmap, 0, 0);
      return [
        ...g.getImageData(0, c.height / 2 - rows, c.width, 2 * rows).data,
      ];
    },
    [Array.from(bytes), rows] as const,
  );
}
// The columns where a dashed drawing differs from the same drawing with
// hidden lines hidden, by at least a third of the most any column does:
// where a dash crosses the band.
function inked(dashedBand: number[], hiddenBand: number[]) {
  const n = size.width,
    rows = dashedBand.length / 4 / n,
    most: number[] = [];
  for (let x = 0; x < n; x++) {
    let m = 0;
    for (let y = 0; y < rows; y++) {
      let d = 0;
      for (let k = 0; k < 3; k++) {
        const i = 4 * (y * n + x) + k;
        d += Math.abs(dashedBand[i] - hiddenBand[i]);
      }
      m = Math.max(m, d);
    }
    most.push(m);
  }
  const top = Math.max(...most);
  return most.map((m) => m > top / 3);
}
// Runs of inked columns within [lo, hi): their starts and lengths.
function runs(ink: boolean[], lo: number, hi: number) {
  const out: { start: number; length: number }[] = [];
  for (let x = lo; x < hi; x++)
    if (ink[x] && !ink[x - 1]) {
      let e = x;
      while (e < hi && ink[e]) e++;
      if (e < hi) out.push({ start: x, length: e - x });
      x = e;
    }
  return out.slice(1);
}

for (const weight of ["hairline", "regular"] as const)
  test(`the drawing dashes a receding line evenly on the page, as the line drawing does (${weight})`, async ({
    page,
  }) => {
    const shots: Record<string, number[]> = {};
    const rows = weight === "hairline" ? 2 : 4;
    let svg = "";
    for (const [name, sight] of [
      ["hidden", { weight }],
      ["space", { weight, hidden: "dashed" }],
      ["page", { weight, hidden: "dashed", dashes: "page" }],
    ] as const) {
      await page.goto(linkTo(tube(sight)));
      await settled(page);
      shots[name] = await band(page, await download(page, /^PNG/), rows);
      if (name === "page")
        svg = (
          await download(page, "Lines (SVG) · visible only, sampled")
        ).toString("utf8");
    }
    // Inside the tube, from just past the vanishing point to the page's
    // edge.
    const lo = 1095,
      hi = 1990;
    const space = runs(inked(shots.space, shots.hidden), lo, hi),
      even = runs(inked(shots.page, shots.hidden), lo, hi);
    console.log(`Dashes (${weight})`, {
      space: space.map((r) => r.length),
      page: even.map((r) => r.length),
    });
    // In space, near dashes are several times the far ones on the page.
    const lengths = space.map((r) => r.length);
    expect(Math.max(...lengths) / Math.min(...lengths)).toBeGreaterThan(2.5);
    // On the page, every dash is 8.36 px within a pixel or two at its ends,
    // and they start one period apart.
    expect(even.length).toBeGreaterThan(15);
    for (const r of even)
      expect(Math.abs(r.length - on), `${r.start}`).toBeLessThan(2.2);
    for (let i = 1; i < even.length; i++)
      expect(Math.abs(even[i].start - even[i - 1].start - period)).toBeLessThan(
        2.2,
      );
    // The line drawing puts its dashes where the drawing does.
    const group = svg.match(/<g id="hidden-base"[^>]*>(.*?)<\/g>/s)?.[1] ?? "";
    // Each dash's left end, whichever way its path runs.
    const starts = [...group.matchAll(/d="([^"]*)"/g)]
      .flatMap((m) => m[1].split(/(?=M)/))
      .map((path) =>
        Math.min(
          ...[...path.matchAll(/[ML]?([\d.]+)[ ,][\d.]+/g)].map((p) => +p[1]),
        ),
      )
      .filter((x) => x > lo + period && x < hi - period);
    expect(starts.length).toBeGreaterThan(12);
    for (const x of starts) {
      const off = Math.min(...even.map((r) => Math.abs(r.start - x)));
      expect(off, `${x}`).toBeLessThan(2);
    }
    expect(svg).toMatch(/measured along the line on the page/);
  });

test("the Dashes control shows with dashed lines, sets the drawing, and presets bring their own", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await settled(page);
  const box = sightBox(page);
  const dashes = box.getByLabel("Dashes", { exact: true });
  await expect(dashes).toHaveCount(0);
  await box
    .getByLabel("Lines behind sheets", { exact: true })
    .selectOption("dashed");
  await expect(dashes).toHaveValue("space");
  await expect(dashes.locator("option")).toHaveText(
    dashMeasures.map((d) => d.label),
  );
  await dashes.selectOption("page");
  await expect(page.locator("#spatial-artwork")).toHaveAttribute(
    "data-sight",
    JSON.stringify({
      sheets: "opaque",
      opacity: 0.35,
      hidden: "dashed",
      dashes: "page",
    }),
  );
  expect(sightHelp.dashes).toBeTruthy();
  // Faint lines have no dashes to measure.
  await box
    .getByLabel("Lines behind sheets", { exact: true })
    .selectOption("faint");
  await expect(dashes).toHaveCount(0);
  const paged = spatialPresets.filter((p) => p.sight?.dashes === "page");
  expect(paged.length).toBeGreaterThan(0);
  for (const p of paged) {
    await choosePreset(page, { label: p.name });
    await settled(page);
    await expect(dashes, p.name).toHaveValue("page");
    expect(p.projection ?? p.flight?.ride, p.name).toBeTruthy();
  }
  // A preset without its own sight measures dashes in space again.
  await choosePreset(page, { label: "A Klein bottle passing through itself" });
  await settled(page);
  await expect(dashes).toHaveValue("space");
});
