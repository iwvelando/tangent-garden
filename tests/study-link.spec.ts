import { test } from "@playwright/test";
import assert from "node:assert/strict";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import {
  LinkError,
  linkToken,
  maxLinkLength,
  readStudyLink,
  studyHref,
  writeStudyLink,
} from "../web/study-link";
import { planarStudy, type PlanarStudy } from "../web/planar-link";
import {
  defaultAnimation,
  spatialStudy,
  type SpatialStudy,
} from "../web/spatial/link";
import { tesseractStudy, type TesseractStudy } from "../web/tesseract/link";
import { presets } from "../web/presets";
import { spatialPresets } from "../web/spatial/presets";
import { tesseractPresets } from "../web/tesseract/presets";
import { defaultLayers } from "../web/spatial/renderer";
import { defaultCut } from "../web/spatial/cut";
import { defaultSight } from "../web/spatial/sight";
import { defaultPath, maxKeys } from "../web/spatial/path";
import { initialView } from "../web/tesseract/types";

// Links are encoded here independently of the app, with Node's zlib, so a
// fault shared by the app's encoder and decoder cannot hide.
const token = (value: unknown) =>
  deflateRawSync(Buffer.from(JSON.stringify(value))).toString("base64url");
const envelope = (notebook: string, study: unknown, v: unknown = 1) =>
  token({ v, notebook, study });
const unpack = (t: string) =>
  JSON.parse(inflateRawSync(Buffer.from(t, "base64url")).toString());

async function refused(
  work: () => unknown,
  field: string,
  message?: RegExp,
): Promise<LinkError> {
  try {
    await work();
  } catch (e) {
    assert.ok(e instanceof LinkError, `expected a LinkError, got ${e}`);
    assert.equal(e.field, field, e.message);
    if (message) assert.match(e.message, message);
    return e;
  }
  assert.fail(`expected ${field} to be refused`);
}

const planar = (i = 0): PlanarStudy => ({
  config: structuredClone(presets[i].config),
  bounds: { min: String(presets[i].config.curve.min), max: "2*pi" },
  length: 0.8,
  poleKind: "pedal",
  layers: {
    base: true,
    derived: true,
    lines: false,
    incident: true,
    virtual: true,
    axes: true,
  },
  camera: { x: 12.5, y: -40, zoom: 1.75 },
  animation: { mode: "reveal", camera: "hold", duration: 10, tracks: [] },
});
const spatial = (i = 0): SpatialStudy => ({
  config: structuredClone(spatialPresets[i].config),
  layers: { ...defaultLayers, rulings: false },
  view: { yaw: 1.1, pitch: -0.4, zoom: 2.5, panX: 0.3, panY: -0.2 },
  animation: {
    mode: "orbit",
    camera: "fit",
    duration: 7.5,
    tracks: [],
    path: {
      style: "smooth",
      keys: [
        {
          name: "Above",
          yaw: 0.3,
          pitch: 1.5,
          zoom: 0.2,
          panX: 0,
          panY: 0,
          turns: 0,
        },
        {
          name: "",
          yaw: -7,
          pitch: -1.5,
          zoom: 8,
          panX: 0.5,
          panY: -2,
          turns: -8,
        },
        { name: "Out", yaw: 2, pitch: 0, zoom: 1, panX: 0, panY: 0, turns: 8 },
      ],
    },
  },
  // A mirror's probe describes its light; a curve probe there is from a
  // link made before it had one.
  probe: {
    enabled: true,
    position: 0.25,
    target: spatialPresets[i].config.format === "rays" ? "light" : "curve",
    across: 0.5,
  },
  cut: {
    enabled: true,
    normal: { x: -0.25, y: 3, z: 1 / 3 },
    offset: -0.75,
    cuts: "surface",
    edge: false,
  },
  sight: { sheets: "through", opacity: 0.5, hidden: "dashed" },
});
const tesseract = (i = 0): TesseractStudy => ({
  config: structuredClone(tesseractPresets[i].config),
  layers: { edges: true, guides: false, faces: true, selectedSection: 0 },
  view: { ...initialView, zoom: 1.4 },
  diagramView: { ...initialView },
  motion: tesseractPresets[i].motion,
  duration: 12,
});

test("every preset round-trips through a link unchanged", async () => {
  for (const [i] of presets.entries()) {
    const study = planar(i);
    const read = await readStudyLink(await writeStudyLink("2d", study));
    assert.equal(read.notebook, "2d");
    assert.deepEqual(planarStudy(read.study), study, presets[i].title);
  }
  for (const [i] of spatialPresets.entries()) {
    const study = spatial(i);
    const read = await readStudyLink(await writeStudyLink("3d", study));
    assert.equal(read.notebook, "3d");
    assert.deepEqual(spatialStudy(read.study), study, spatialPresets[i].name);
  }
  for (const [i] of tesseractPresets.entries()) {
    const study = tesseract(i);
    const read = await readStudyLink(await writeStudyLink("4d", study));
    assert.equal(read.notebook, "4d");
    assert.deepEqual(tesseractStudy(read.study), study, `4D preset ${i}`);
  }
});

test("a link carries probe playback with its probe", async () => {
  const study: SpatialStudy = {
    ...spatial(),
    animation: { ...spatial().animation, mode: "probe", camera: "current" },
  };
  const read = await readStudyLink(await writeStudyLink("3d", study));
  assert.deepEqual(spatialStudy(read.study), study);
  // On a surface, too: a canal's, a patch's, a tangent developable's, a
  // framed ribbon's or a ruled surface's.
  const named = (name: string) => {
    const i = spatialPresets.findIndex((p) => p.name === name);
    assert.ok(i >= 0, name);
    return i;
  };
  for (const i of [
    named("Beads that lose their envelope"),
    named("A torus revealing its centers"),
    named("Helix · a ribbon staircase"),
    named("The seam of a carried frame"),
    named("Chords of a rising helix"),
  ]) {
    const surface: SpatialStudy = {
      ...spatial(i),
      animation: { ...defaultAnimation, mode: "probe", duration: 4 },
      probe: { enabled: true, position: 0.7, target: "surface", across: 0.1 },
    };
    const back = await readStudyLink(await writeStudyLink("3d", surface));
    assert.deepEqual(spatialStudy(back.study), surface);
  }
});

test("links made before the surface probe keep their probe as it was", async () => {
  // A curve study's probe gains the defaults: the curve, half way across.
  const curve = structuredClone(spatial()) as any;
  curve.probe = { enabled: true, position: 0.25 };
  assert.deepEqual(spatialStudy(curve).probe, {
    enabled: true,
    position: 0.25,
    target: "curve",
    across: 0.5,
  });
  // A surface patch had no probe then, so its link opens without one.
  const torus = spatialPresets.findIndex(
    (p) => p.name === "A torus revealing its centers",
  );
  const patch = structuredClone(spatial(torus)) as any;
  patch.probe = { enabled: true, position: 0.25 };
  assert.equal(spatialStudy(patch).probe.enabled, false);
  patch.probe.target = "surface";
  assert.equal(spatialStudy(patch).probe.enabled, true);
  // A developable, framed or ruled study's probe then described its curve,
  // so the link keeps the curve probe on, as it drew.
  for (const name of [
    "Helix · a ribbon staircase",
    "The seam of a carried frame",
    "Chords of a rising helix",
  ]) {
    const ruled = structuredClone(
      spatial(spatialPresets.findIndex((p) => p.name === name)),
    ) as any;
    ruled.probe = { enabled: true, position: 0.25 };
    assert.deepEqual(spatialStudy(ruled).probe, {
      enabled: true,
      position: 0.25,
      target: "curve",
      across: 0.5,
    });
  }
});

test("a mirror's link carries the light or mirror probe; older ones open without it", async () => {
  const named = (name: string) =>
    spatialPresets.findIndex((p) => p.name === name);
  for (const name of [
    "A spherical bowl's cusped caustic",
    "A lamp in water over air",
  ])
    for (const target of ["light", "mirror"] as const) {
      const study: SpatialStudy = {
        ...spatial(named(name)),
        animation: { ...defaultAnimation, mode: "probe", duration: 4 },
        probe: { enabled: true, position: 0.3, target, across: 0.6 },
      };
      const back = await readStudyLink(await writeStudyLink("3d", study));
      assert.deepEqual(spatialStudy(back.study), study, `${name}: ${target}`);
    }
  // A mirror or interface offered no probe before, so a link from then,
  // whose probe named the curve or a surface, or nothing, opens without it.
  for (const target of ["curve", "surface", undefined]) {
    const old = structuredClone(
      spatial(named("A paraboloid gathering light")),
    ) as any;
    old.probe = { enabled: true, position: 0.25, ...(target && { target }) };
    assert.equal(spatialStudy(old).probe.enabled, false, String(target));
    // Probe playback needs the probe on.
    old.animation = {
      mode: "probe",
      camera: "hold",
      duration: 4,
      tracks: [],
    };
    await refused(() => Promise.resolve(spatialStudy(old)), "animation.mode");
  }
  // The light and the mirror name nothing in another study, whose probe
  // falls back to its own first target.
  const curve = structuredClone(spatial()) as any;
  curve.probe = { enabled: true, position: 0.25, target: "light", across: 0 };
  assert.equal(spatialStudy(curve).probe.enabled, true);
});

test("links are compact, url-safe, and readable by an independent decoder", async () => {
  let longest = 0;
  for (const [i] of spatialPresets.entries()) {
    const t = await writeStudyLink("3d", spatial(i));
    assert.match(t, /^[A-Za-z0-9_-]+$/);
    assert.deepEqual(unpack(t), { v: 1, notebook: "3d", study: spatial(i) });
    longest = Math.max(longest, t.length);
  }
  // Presets are about 2 KB of JSON; a shared link should stay near 1.5 KB.
  assert.ok(longest < 2000, `longest 3D preset link is ${longest} characters`);
});

test("hrefs carry the notebook in the query and the study in the fragment", () => {
  const base = "https://example.test/garden/?study=3d#s=old";
  assert.equal(
    studyHref(base, "2d", "abc"),
    "https://example.test/garden/#s=abc",
  );
  assert.equal(
    studyHref("https://example.test/", "4d", "x_-y"),
    "https://example.test/?study=4d#s=x_-y",
  );
  assert.equal(linkToken("#s=abc_-9"), "abc_-9");
  assert.equal(linkToken("#other"), null);
  assert.equal(linkToken(""), null);
});

test("damaged, oversized, and future links are refused without a study", async () => {
  await refused(() => readStudyLink("not base64!"), "link", /damaged/);
  await refused(() => readStudyLink("AAAA"), "link", /damaged/);
  const whole = envelope("2d", planar());
  await refused(() => readStudyLink(whole.slice(0, 40)), "link", /damaged/);
  await refused(() => readStudyLink(token("just text")), "link", /damaged/);
  await refused(
    () => readStudyLink("A".repeat(maxLinkLength + 1)),
    "link",
    /too long/,
  );
  // A small link that inflates past the bound: a decompression bomb.
  const bomb = deflateRawSync(
    Buffer.from(
      JSON.stringify({ v: 1, notebook: "2d", study: "x".repeat(4e6) }),
    ),
  ).toString("base64url");
  assert.ok(bomb.length < maxLinkLength);
  await refused(() => readStudyLink(bomb), "link", /too large/);
  await refused(
    () => readStudyLink(envelope("2d", planar(), 2)),
    "link",
    /newer version/,
  );
  await refused(() => readStudyLink(envelope("2d", planar(), 0)), "link");
  await refused(() => readStudyLink(envelope("2d", planar(), "1")), "link");
  await refused(() => readStudyLink(envelope("5d", planar())), "notebook");
  await refused(() => readStudyLink(token({ v: 1, notebook: "2d" })), "study");
});

test("a too-large study is refused when the link is made", async () => {
  // Random text does not compress, so the link grows with it.
  const study = planar();
  study.config.curve.x = Array.from({ length: 30_000 }, () =>
    String.fromCharCode(33 + Math.floor(Math.random() * 90)),
  ).join("");
  await refused(() => writeStudyLink("2d", study), "link", /too large/);
});

test("every invalid field is refused by name", async () => {
  const cases: [string, (s: any) => void, RegExp?][] = [
    ["config.curve.x", (s) => (s.config.curve.x = 3), /text/],
    ["config.curve.x", (s) => (s.config.curve.x = "x".repeat(4001)), /long/],
    ["config.curve.a", (s) => (s.config.curve.a = "1"), /number/],
    ["config.curve.a", (s) => (s.config.curve.a = null), /number/],
    ["config.circles", (s) => (s.config.circles = 1), /true or false/],
    ["config.curve.format", (s) => (s.config.curve.format = "spline")],
    ["config.kind", (s) => (s.config.kind = "toString")],
    ["config.kind", (s) => (s.config.kind = "__proto__")],
    ["config.curve.colour", (s) => (s.config.curve.colour = 1), /known/],
    ["config.__proto__", (s) => (s.config = JSON.parse(`{"__proto__":{}}`))],
    ["config.curve", (s) => (s.config.curve = [])],
    ["config.curve.terms", (s) => (s.config.curve.terms = {}), /list/],
    [
      "config.curve.terms",
      (s) =>
        (s.config.curve.terms = Array.from({ length: 17 }, () => ({
          frequency: 1,
          radius: 1,
          phase: 0,
        }))),
      /16/,
    ],
    [
      "config.curve.terms[1].radius",
      (s) =>
        (s.config.curve.terms = [
          { frequency: 1, radius: 1, phase: 0 },
          { frequency: 2, radius: "big", phase: 0 },
        ]),
    ],
    ["config.source.coordinates", (s) => (s.config.source.coordinates = "")],
    ["camera.zoom", (s) => (s.camera.zoom = 50)],
    ["camera.zoom", (s) => (s.camera.zoom = 0)],
    ["length", (s) => (s.length = 9)],
    ["poleKind", (s) => (s.poleKind = "evolute")],
    ["layers.axes", (s) => (s.layers.axes = "yes")],
    ["animation.duration", (s) => (s.animation.duration = 0)],
    ["animation.duration", (s) => (s.animation.duration = 4000)],
    ["animation.mode", (s) => (s.animation.mode = "trace")],
    [
      "animation.tracks[0].target",
      (s) =>
        (s.animation.tracks = [{ target: "surfaceA", from: "0", to: "1" }]),
    ],
    [
      "animation.tracks[1].target",
      (s) =>
        (s.animation.tracks = [
          { target: "a", from: "0", to: "1" },
          { target: "a", from: "1", to: "2" },
        ]),
      /twice/,
    ],
    ["bounds.max", (s) => (s.bounds.max = 2)],
  ];
  for (const [field, change, message] of cases) {
    const study = structuredClone(planar()) as any;
    change(study);
    await refused(() => planarStudy(study), field, message);
  }
  await refused(() => planarStudy(null), "study");
  await refused(() => planarStudy([]), "study");
});

test("3D and 4D fields are refused by name", async () => {
  const spatialCases: [string, (s: any) => void][] = [
    ["config.format", (s) => (s.config.format = "knot")],
    ["config.pole.w", (s) => (s.config.pole.w = 0)],
    ["config.surface.kind", (s) => (s.config.surface.kind = "klein")],
    ["config.implicit.refine", (s) => (s.config.implicit.refine = "2")],
    ["view.pitch", (s) => (s.view.pitch = 2)],
    ["view.zoom", (s) => (s.view.zoom = 9)],
    ["probe.position", (s) => (s.probe.position = 1.5)],
    ["probe.enabled", (s) => (s.probe.enabled = "yes")],
    ["probe.glow", (s) => (s.probe.glow = true)],
    ["probe.target", (s) => (s.probe.target = "ribbon")],
    ["probe.across", (s) => (s.probe.across = -0.1)],
    ["layers.glow", (s) => (s.layers.glow = true)],
    ["animation.mode", (s) => (s.animation.mode = "spin")],
    [
      "animation.mode",
      (s) => {
        s.animation.mode = "probe";
        s.probe.enabled = false;
      },
    ],
    [
      "animation.mode",
      (s) => {
        s.animation.mode = "probe";
        s.config.format = "rays";
      },
    ],
    [
      "animation.tracks[0].target",
      (s) =>
        (s.animation.tracks = [{ target: "contourLevel", from: "0", to: "1" }]),
    ],
  ];
  for (const [field, change] of spatialCases) {
    const study = structuredClone(spatial()) as any;
    change(study);
    await refused(() => spatialStudy(study), field);
  }
  const lift = tesseractPresets.findIndex((p) => p.config.object === "lift");
  const tesseractCases: [string, (s: any) => void][] = [
    ["config.object", (s) => (s.config.object = "klein")],
    ["config.angles", (s) => (s.config.angles = [0, 0, 0])],
    ["config.angles[2]", (s) => (s.config.angles[2] = "0")],
    ["config.mode", (s) => (s.config.mode = "diagram")],
    ["config.lift.center", (s) => (s.config.lift.center = [0, 0])],
    ["motion", (s) => (s.motion = "latitude")],
    ["layers.selectedSection", (s) => (s.layers.selectedSection = "0")],
    ["diagramView.yaw", (s) => (s.diagramView.yaw = "0")],
  ];
  for (const [field, change] of tesseractCases) {
    const study = structuredClone(tesseract(lift)) as any;
    change(study);
    await refused(() => tesseractStudy(study), field);
  }
});

test("fields a link predates take the notebook's defaults", async () => {
  const study = planar(3) as any;
  delete study.config.stack;
  delete study.config.curve.lissajous.phase;
  delete study.layers.axes;
  delete study.animation;
  const read = planarStudy(study);
  assert.deepEqual(read.config.stack, presets[0].config.stack);
  assert.equal(
    read.config.curve.lissajous.phase,
    presets[0].config.curve.lissajous.phase,
  );
  assert.equal(read.layers.axes, false);
  assert.deepEqual(read.animation, {
    mode: "reveal",
    camera: "hold",
    duration: 10,
    tracks: [],
  });
  // Optional fields stay absent rather than being invented.
  assert.equal("coordinates" in read.config.source, false);

  // A 4D object's own parameters come from that object's defaults.
  const lift = tesseractPresets.findIndex((p) => p.config.object === "lift");
  const four = tesseract(lift) as any;
  delete four.config.lift.height;
  const readFour = tesseractStudy(four);
  assert.equal(
    readFour.config.lift!.height,
    (await import("../web/tesseract/objects")).objects.lift.defaults(
      tesseractPresets[0].config,
    ).lift!.height,
  );
  const weave = structuredClone(tesseractPresets[0].config) as any;
  weave.object = "weave";
  weave.mode = "stereo";
  const readWeave = tesseractStudy({ ...tesseract(), config: weave });
  assert.equal(readWeave.config.weave!.family, "fibers");
});

// Links made by version 1 of the format, frozen when it shipped. They must
// keep opening with these values as studies gain fields: extend a schema's
// defaults rather than regenerating these.
const v1 = {
  "2d":
    "jVbbbuM2EP0XPiVOrFKkrv6ABYpiX4o-7KLYBWiJTrihSJWivHKD_HtnSFp2ahTNQxCNNdcz" +
    "Z2b0So5klz8SY73cW_tCdoT15JFMfu5PZPdKOmsO6gmfXpTp4bU8Wj17CTrd7I4S34jg4mDd" +
    "IDxoODtr6YPKgv42nZ3u_D2I4JHwzaRMFB2I-QPNeNDgm_DjoAzZUfgvwDhnWVlVvKZVXvCy" +
    "zWv2eHEPkZ3VGpwoM6ke4x3UIvvfRa_miezKrOBVWeFfmze0BdP0BrwIN5AdfyTjs5jAFX17" +
    "JFpNk_hhUQFqGkatAAT5JRS3il9jrU7-NUvTnb4EJ6v4NfhOPvOsrGndVpxVdVs0bVVBEC_d" +
    "AAH-fL0YBY_n1PLrlN4pbYuLFs2K8j8Vq2s9dqX2DZ5nN83KY4XhUbqYzBIinwLy0ygldDpH" +
    "twv6qBiH9BuaN2VTc15Fxaxu8obnRcOKqqGsbW4stxCesZLRlvMWGgE9LJJtWxctq9uc5eCE" +
    "octb25bStmoaAI-yIm-TZcF50_Cat3lelyXYfsA0lra9Mf5AxtXZ9H8zvsGpOJv-C6j2yhRa" +
    "0onRzw4blFEKzoDEUvfYIZyeUxobsbnLt8t3dr85bRccUHCwto5mqXkpFR4kjt7lBP6RjMhw" +
    "hSzuYvsP4PTubtmK--_s4YSOQXpYJQih5VHqSHcxKB3WgTRirzF172aJxLdDYpm3wP0MYOns" +
    "bCBCC_F-wsqwP0Mpn3Gst6C3fMbBhodT_AmmBJ_DtGclGHVSaxyECjMW3jvReevQySBGSLrT" +
    "6gC7BreUCPaA8x6NMXZItw_sxCUmnE9ArhBlCHGvABaHHaAUGK9gKoWXELWhNPxyQJBijR8r" +
    "or4UUV-KqCh9A2mys-vk1RIdrQKMYBztpLyyJiW5dpEI86TBYNuiYH41Hew3RDUPA221PJe1" +
    "Wpg_nDDToGAz9sGTPRwm6YMKlOuFwQxoQKV7edfLg9DT2kzgaxm7GR5SN3F1dcp1GkFK-rh8" +
    "lQm3Iaxf2Pzq6RnLmp4D55IFud5HZVq94em8ma5uCXL-fBHWmwFNay5n492FqDIGs9WUnNZ5" +
    "3ZZNtbYdQYk4nxnA0vbBlkgD5LZjiDnYkH33nFgVsYfD5R9G9QtLdwwzEps1J0wniXLx0lxw" +
    "PBcbb1u5WTVxAiGsm1LHO2ipdDedXE9B0B9nvKkRH6gNDxH2gAWaAv4oFGi2h0714XYFgAgl" +
    "CSJSbEaFwbU0T_4ZkWgiiX5LbJS90Djw4hTuwSvZh75E_vfSqeNl5FPIVKtamRnfHpXzMzhL" +
    "olhWXSSQGGDOUr1VLHjLgAd_W2ReHH9hFHxGJIRSZ0bhwNRjchcvYUYhvdkl9ToQF9bFS1yM" +
    "QIMnGT9ItP6EXwbkTHLoLaKJLCeIzbe3t7d_AA",
  "3d":
    "nVbbcts4DP2VDp-a1PLoYsmXf8jTvrSzk87QFGWzoUiVopzYHv_7AqAkK67TdvbFJgEQAMGD" +
    "A53ZgW2SGTPWy621L2zDspLNWOu78sg2ZyasqdQOV5V1Nfdg4K3rWrABVetdJ7yyBsSlPEht" +
    "G77VEpSNhT849Qbu5_mMgbN4xk6wu8yYMgfpWjoGEaTx0vW28cQyBkvHSwXBNikeajoMv-Wt" +
    "ZMGJ1Z2nKNyIvXV00FZVKz0tK14rTbeQBtMq2abiupWgcbZmmwi8ekvOhe0MHMov4HjPXW2N" +
    "En9MDjQ15PYv1MbJn5004kjFFLZVZrz9zaGJKvhLetVl9s5PlN44Sv_kKL3vKLvxE988xgcq" +
    "8PM8Y7UyJKg5qIt5usqSVZ7Fy2S5zlfFBSvJazr-ogzUlznrOQIigpOqVidldoAGJyvpIJ2P" +
    "cuBmh3ABgX9VrX__kAifV1X6Pa4zxKbjpmxDqbVtOwdHWSt5jbBwHT30mTXceYNvxxAbCGq_" +
    "d5KXfQosnS8eoTCf_QOjbEgAxQgCSIwl84I8cgQZBGv3qvIhYcEN1-hpAChkBmk2zlYKb8IS" +
    "8FFLp0rFDagXWCol9Rg9OvZR3_pgHLtOyjIA6lfg3EFMkEUfG0aDJbykbAVvILM0vnnVJJ3n" +
    "RZEt4yJZZPk6WQKOOF4ozSHppnNtpzwVFJfQt3cTnC8BFHGxXCXJqsgXywJu00h8ieRO7tFf" +
    "2Ef_y3_0NwGe8QEbT8CJ53Gc35ZkvsS7A7IqLqboHqiPU7dt8fQKfNHJ7ql30T3dbZYZOwwW" +
    "h48sun943WgJJcZXOIy7DHSicwdcJyn2ExKoHPlsQnoAcUGdkhN0jy2mr5DF-MDU0I1aCg_3" +
    "MElg_7Rnaa12e-RY6B2utdR41ZOqO-o9wJCWBx6cRGvYt7Zzd3s6g9hamh2eo3SFVIfAo43m" +
    "yDcwcQzOCR6yFkn4S-mvVSdJxLVV2DzrAmlZQS2UCFCssHG-p5--fDrS7-l7Gl4lwbgwh2i1" +
    "tW-UG5U9SpA73p7C-8LyOBEfr-LTRHwaxNjxUmts5BW2KVWSKmtwKuoPaK0fMwQSHDQBLZNR" +
    "M463-QIsui3hsfgFFkMpEzzfUEl_ggfIZADIuojx9UxY92AZuOYzuP8CsXPiu-zRPzzQKn0c" +
    "ue-eCXJhb4IERVqUZUH2-9EQXgPvqPmRSON87Sf4apDE1DAd2hHEstxh-kEJNAqDxfhRAKwf" +
    "rMMWmPaH7AEdJPA5YkBi3dWGvkHCOnxyyKuxc7JtrClxKl2DNHvpRqMB3mF3eO8c4KCaVk7z" +
    "C1Opzx_n4lWJw2kIrZzQV9VkSAQB-PlBodTViDtnXyfeZDm95HFnr8cHmgi7AM9xO_BEn6MV" +
    "XCfvdum1XkJBbUbbnjOQP_tyKOc7RP6gH1p8yHHokT5NbPtxR52Jyws6kq-IjiN_RfSvwVb5" +
    "QGH4RWOxhQLwufmK0oSW36ixMvp4UHXPSmdW2xLZxbqtQoIT8AoOkMj2VuMnQNm53rSgSosX" +
    "HGfPl8vlPw",
  "4d":
    "bZLbToQwEIbfZa6RwLYcH8AX0BiN8aJLB7YKLSktm3XDuzuFPWhiSMg_p38-JpxhhjqNQBuH" +
    "e2O-oAYuIYLJeXmC-gyN0a3qgjL7T2wcNfSqddRihVR-gnoXgfN7hDqJ8yyCxtsZKU1yMJLS" +
    "YLFFi7pBGhK660P1PYluz0cEUk1OhI6a0-5eBZWQGi0KCTWLKd0Yr90K21klt7oYxtUuD_Ve" +
    "jev8yhfQUTu01120ZfLjaKxbkQ-ouoML0GVSJWleVZwVvOJFdoEMpaLMWFWmOWNVwXnJImit" +
    "GcjxIY2zi6kzFN_D7SqPa1sSJ9k180xtu2UhOnFCOwU-lF1gd9YjfZNXMkSt6CcKW9HcaxP2" +
    "dHmUT_RWRpMx-cwKj8HlJI5hEy0alWsOQdMNvk0ASGNCHoV-Xa9F4m2blUp0Vgwvfy3Y7pcH" +
    "y24m_1oMZkMBabffQXorthRflh8",
};

test("links made by version 1 keep opening", async () => {
  const planarLink = await readStudyLink(v1["2d"]);
  assert.equal(planarLink.notebook, "2d");
  const p = planarStudy(planarLink.study);
  assert.equal(p.config.curve.format, "roulette");
  assert.equal(p.config.curve.roulette.fixedRadius, 2 * Math.E);
  assert.deepEqual(p.bounds, { min: "0", max: "4*pi" });
  assert.equal(p.layers.lines, false);
  assert.deepEqual(p.camera, { x: 60, y: -25, zoom: 1.5 });
  assert.deepEqual(p.animation, {
    mode: "parameters",
    camera: "fit",
    duration: 7.5,
    tracks: [{ target: "rollFixed", from: "2*e", to: "pi" }],
  });

  const spatialLink = await readStudyLink(v1["3d"]);
  assert.equal(spatialLink.notebook, "3d");
  const s = spatialStudy(spatialLink.study);
  assert.equal(s.config.format, "torus");
  assert.equal(s.config.tube, Math.PI / 5);
  assert.equal(s.layers.rulings, false);
  assert.deepEqual(s.view, {
    yaw: 0.9,
    pitch: 0.2,
    zoom: 1.8,
    panX: 0.1,
    panY: -0.3,
  });
  assert.equal(s.animation.mode, "orbit");
  // Links made before refinement mesh the grid alone.
  assert.equal(s.config.implicit.refine, 0);
  // Links made before the parameter probe open without it.
  assert.deepEqual(s.probe, {
    enabled: false,
    position: 0.5,
    target: "curve",
    across: 0.5,
  });
  // Links made before the cut open without it.
  assert.deepEqual(s.cut, defaultCut);
  // Links made before seeing through open opaque, hiding hidden lines.
  assert.deepEqual(s.sight, defaultSight);
  // Links made before camera paths fly none.
  assert.deepEqual(s.animation.path, defaultPath);

  const fourLink = await readStudyLink(v1["4d"]);
  assert.equal(fourLink.notebook, "4d");
  const f = tesseractStudy(fourLink.study);
  assert.equal(f.config.object, "lift");
  assert.equal(f.config.lift!.height, (1 + Math.sqrt(5)) / 4);
  assert.equal(f.layers.guides, false);
  assert.equal(f.view.zoom, 1.3);
  assert.equal(f.motion, "drift");
  assert.equal(f.duration, 4);
});

test("a link carries the cut and a peel; refuses a zero normal and a peel without the cut", async () => {
  const study: SpatialStudy = {
    ...spatial(),
    animation: { ...spatial().animation, mode: "cut", camera: "follow" },
  };
  const read = await readStudyLink(await writeStudyLink("3d", study));
  assert.deepEqual(spatialStudy(read.study), study);
  // Every scope, and the limits themselves.
  for (const cuts of ["surface", "sheets", "all"] as const) {
    const edge: SpatialStudy = {
      ...spatial(),
      cut: {
        enabled: true,
        normal: { x: 100000, y: -100000, z: 0 },
        offset: -100000,
        cuts,
        edge: true,
      },
    };
    assert.deepEqual(spatialStudy(structuredClone(edge)), edge, cuts);
  }
  // A cut missing fields takes their defaults.
  const partial = structuredClone(spatial()) as any;
  partial.cut = { enabled: true, offset: 0.5 };
  assert.deepEqual(spatialStudy(partial).cut, {
    ...defaultCut,
    enabled: true,
    offset: 0.5,
  });
  const bad = (change: (cut: any, s: any) => void) => {
    const s = structuredClone(study) as any;
    change(s.cut, s);
    return () => spatialStudy(s);
  };
  await refused(
    bad((c) => (c.normal = { x: 0, y: 0, z: 0 })),
    "cut.normal",
    /not be zero/,
  );
  // An off cut may keep any plane it was left with.
  assert.doesNotThrow(
    bad((c, s) => {
      c.normal = { x: 0, y: 0, z: 0 };
      c.enabled = false;
      s.animation.mode = "reveal";
    }),
  );
  await refused(
    bad((c) => (c.offset = 100001)),
    "cut.offset",
  );
  await refused(
    bad((c) => (c.normal.y = -1e6)),
    "cut.normal.y",
  );
  await refused(
    bad((c) => (c.cuts = "lines")),
    "cut.cuts",
  );
  await refused(
    bad((c) => (c.edge = "yes")),
    "cut.edge",
  );
  await refused(
    bad((c) => (c.extra = 1)),
    "cut.extra",
  );
  await refused(
    bad((c) => (c.enabled = false)),
    "animation.mode",
    /only while the cut is on/,
  );
});

test("a link carries seeing through; refuses an opacity outside its range or an unknown way", async () => {
  for (const hidden of ["hide", "faint", "dashed"] as const)
    for (const sheets of ["opaque", "through"] as const)
      for (const opacity of [0.05, 0.8]) {
        const study: SpatialStudy = {
          ...spatial(),
          sight: { sheets, opacity, hidden },
        };
        const read = await readStudyLink(await writeStudyLink("3d", study));
        assert.deepEqual(spatialStudy(read.study), study);
      }
  // Missing fields take their defaults.
  const partial = structuredClone(spatial()) as any;
  partial.sight = { hidden: "faint" };
  assert.deepEqual(spatialStudy(partial).sight, {
    ...defaultSight,
    hidden: "faint",
  });
  const bad = (change: (sight: any) => void) => {
    const s = structuredClone(spatial()) as any;
    change(s.sight);
    return () => spatialStudy(s);
  };
  await refused(
    bad((v) => (v.opacity = 0.9)),
    "sight.opacity",
  );
  await refused(
    bad((v) => (v.opacity = 0.01)),
    "sight.opacity",
  );
  await refused(
    bad((v) => (v.sheets = "glass")),
    "sight.sheets",
  );
  await refused(
    bad((v) => (v.hidden = "dotted")),
    "sight.hidden",
  );
  await refused(
    bad((v) => (v.extra = 1)),
    "sight.extra",
  );
});

test("a link carries a camera path and its flight; refuses turns, views and names outside their limits", async () => {
  const study: SpatialStudy = {
    ...spatial(),
    animation: { ...spatial().animation, mode: "path", duration: 24 },
  };
  const read = await readStudyLink(await writeStudyLink("3d", study));
  assert.deepEqual(spatialStudy(read.study), study);
  // A path may be unfinished: no views, or one, while it is being made.
  for (const keys of [[], study.animation.path.keys.slice(0, 1)]) {
    const short = structuredClone(study);
    short.animation.path.keys = keys;
    assert.deepEqual(spatialStudy(structuredClone(short)), short);
  }
  // A path without a style flies steadily; an animation without a path
  // flies none.
  const partial = structuredClone(spatial()) as any;
  delete partial.animation.path.style;
  assert.equal(spatialStudy(partial).animation.path.style, "steady");
  delete partial.animation.path;
  assert.deepEqual(spatialStudy(partial).animation.path, defaultPath);
  const bad = (change: (path: any) => void) => {
    const s = structuredClone(study) as any;
    change(s.animation.path);
    return () => spatialStudy(s);
  };
  const keys = "animation.path.keys";
  await refused(
    bad((p) => (p.keys = Array.from({ length: maxKeys + 1 }, () => p.keys[0]))),
    keys,
  );
  await refused(
    bad((p) => (p.keys[1].turns = 1.5)),
    `${keys}[1].turns`,
    /whole/,
  );
  await refused(
    bad((p) => (p.keys[1].turns = 9)),
    `${keys}[1].turns`,
  );
  await refused(
    bad((p) => (p.keys[0].turns = 1)),
    `${keys}[0].turns`,
    /first/,
  );
  await refused(
    bad((p) => (p.keys[2].pitch = 1.6)),
    `${keys}[2].pitch`,
  );
  await refused(
    bad((p) => (p.keys[2].zoom = 0.1)),
    `${keys}[2].zoom`,
  );
  await refused(
    bad((p) => (p.keys[2].yaw = "1")),
    `${keys}[2].yaw`,
  );
  await refused(
    bad((p) => (p.keys[2].name = "x".repeat(61))),
    `${keys}[2].name`,
    /60/,
  );
  await refused(
    bad((p) => (p.keys[2].roll = 0)),
    `${keys}[2].roll`,
  );
  await refused(
    bad((p) => (p.style = "bouncy")),
    "animation.path.style",
  );
  await refused(
    bad((p) => (p.keys = {})),
    keys,
  );
});

test("a link carries the curve a construction is built on; older links build on the base", async () => {
  for (const input of [
    "base",
    "tangent-foot",
    "orthotomic",
    "involute",
  ] as const) {
    const study = spatial();
    study.config = {
      ...study.config,
      construction: "involute",
      input,
      unwinding: { anchor: 0.25, offset: -Math.PI },
      pole: { x: -1, y: 0.5, z: 2 },
    };
    study.layers = { ...study.layers, parent: false, connectors: false };
    const read = await readStudyLink(await writeStudyLink("3d", study));
    assert.deepEqual(spatialStudy(read.study), study);
  }
  // A link made before composition drew every construction on the base,
  // with every layer it did not name shown.
  const older = structuredClone(spatial()) as any;
  delete older.config.input;
  delete older.layers.parent;
  const read = spatialStudy(older);
  assert.equal(read.config.input, "base");
  assert.equal(read.layers.parent, true);
  const bad = structuredClone(spatial()) as any;
  bad.config.input = "evolute";
  await refused(() => spatialStudy(bad), "config.input");
});

test("a link carries the involute a construction is built on; older links take the default", async () => {
  // A link made before the involute input has no unwinding, and draws
  // exactly as before, since only the involute input reads it.
  const older = structuredClone(spatial()) as any;
  delete older.config.unwinding;
  const read = spatialStudy(older);
  assert.deepEqual(read.config.unwinding, spatialPresets[0].config.unwinding);
  assert.equal(read.config.input, "base");
  const bad = structuredClone(spatial()) as any;
  bad.config.unwinding.offset = "1";
  await refused(() => spatialStudy(bad), "config.unwinding.offset");
  // The inversion's own input does not take the involute.
  const inverted = structuredClone(spatial()) as any;
  inverted.config.inversion.input = "involute";
  await refused(() => spatialStudy(inverted), "config.inversion.input");
});
