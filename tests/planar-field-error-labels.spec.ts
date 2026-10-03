import { test, expect } from "@playwright/test";
import { presets } from "../web/presets";
import {
  defaultAnimation,
  defaultLayers,
  type PlanarStudy,
} from "../web/planar-link";
import type { Config } from "../web/types";
import { studyHref, writeStudyLink } from "../web/study-link";

// Every field the engine names in a validation error has a control that
// shows the error: each study is opened from a link, with one field out of
// range, and its error must stand under the control with this label, as
// the page's one alert. The labels are written out here, not derived from
// the notebook's own table (web/planar-fields.ts).
type Study = { config: Config; bounds: { min: string; max: string } };
type Case = [
  field: string,
  preset: string | ((c: Config) => boolean),
  change: (s: Study) => void,
  label: string,
];
const format = (f: Config["curve"]["format"]) => (c: Config) =>
  c.curve.format === f;
const kind = (k: Config["kind"]) => (c: Config) =>
  c.kind === k && c.curve.format === "parametric";
const ellipse = "Ellipse & its evolute";
const cases: Case[] = [
  ["samples", ellipse, (s) => (s.config.samples = 10), "Numerical samples"],
  ["lines", ellipse, (s) => (s.config.lines = 1), "Construction lines"],
  // Whole-number counts are checked in the worker, before Go.
  ["lines", ellipse, (s) => (s.config.lines = 20.5), "Construction lines"],
  ["curve.min", ellipse, (s) => (s.bounds.min = "-2e6"), "t from"],
  ["curve.max", ellipse, (s) => (s.bounds.max = "-1"), "to"],
  ["curve.x", ellipse, (s) => (s.config.curve.x = "cos("), "x(t)"],
  ["curve.y", ellipse, (s) => (s.config.curve.y = "q"), "y(t)"],
  [
    "curve.y",
    ellipse,
    (s) => {
      s.config.curve.format = "cartesian";
      s.config.curve.y = "t+";
    },
    "f(x)",
  ],
  [
    "curve.r",
    ellipse,
    (s) => {
      s.config.curve.format = "polar";
      s.config.curve.r = "1+";
    },
    "r(t)",
  ],
  ["input", ellipse, (s) => (s.config.input = "evolute"), "Construct on"],
  [
    "offset",
    kind("involute"),
    (s) => (s.config.offset = 2e5),
    "Initial string offset c",
  ],
  [
    "distance",
    "Flower & its offset",
    (s) => (s.config.distance = 2e5),
    "Offset distance d",
  ],
  [
    "source.radius",
    (c) => c.kind === "catacaustic" && c.source.kind === "point",
    (s) => {
      s.config.source.coordinates = "polar";
      s.config.source.radius = -1;
      s.config.source.theta = 0;
    },
    "Source radius r",
  ],
  [
    "nIncident",
    (c) => c.kind === "diacaustic",
    (s) => (s.config.nIncident = 0),
    "Incident index n₁",
  ],
  [
    "nTransmitted",
    (c) => c.kind === "diacaustic",
    (s) => (s.config.nTransmitted = 11),
    "Transmitted n₂",
  ],
  [
    "stack.count",
    "Flower & its offset stack",
    (s) => (s.config.stack.count = 1),
    "Number of offsets",
  ],
  [
    "stack.count",
    "Flower & its offset stack",
    (s) => (s.config.stack.count = 4.5),
    "Number of offsets",
  ],
  [
    "stack.from",
    "Flower & its offset stack",
    (s) => (s.config.stack.from = 2e5),
    "First offset distance",
  ],
  [
    "stack.to",
    "Flower & its offset stack",
    (s) => (s.config.stack.to = 2e5),
    "Last offset distance",
  ],
  [
    "curve.roulette.fixedRadius",
    "Hypotrochoid & its evolute",
    (s) => (s.config.curve.roulette.fixedRadius = 0),
    "Fixed radius R",
  ],
  [
    "curve.roulette.radius",
    "Hypotrochoid & its evolute",
    (s) => (s.config.curve.roulette.radius = 9),
    "Rolling radius r",
  ],
  [
    "curve.roulette.arm",
    "Hypotrochoid & its evolute",
    (s) => (s.config.curve.roulette.arm = -1),
    "Tracing distance d",
  ],
  [
    "curve.roulette.phase",
    "Hypotrochoid & its evolute",
    (s) => (s.config.curve.roulette.phase = 2e6),
    "Phase φ (radians)",
  ],
  [
    "curve.min",
    "Hypotrochoid & its evolute",
    (s) => (s.bounds.min = "-2e6"),
    "t from",
  ],
  [
    "curve.lissajous.amplitudeX",
    format("lissajous"),
    (s) => (s.config.curve.lissajous.amplitudeX = -1),
    "Amplitude A",
  ],
  [
    "curve.lissajous.amplitudeY",
    format("lissajous"),
    (s) => (s.config.curve.lissajous.amplitudeY = 2e5),
    "Amplitude B",
  ],
  [
    "curve.lissajous.frequencyX",
    format("lissajous"),
    (s) => (s.config.curve.lissajous.frequencyX = 2000),
    "Frequency m",
  ],
  [
    "curve.lissajous.frequencyY",
    format("lissajous"),
    (s) => (s.config.curve.lissajous.frequencyY = -2000),
    "Frequency n",
  ],
  [
    "curve.lissajous.phase",
    format("lissajous"),
    (s) => (s.config.curve.lissajous.phase = 2e6),
    "Phase φ (radians)",
  ],
  [
    "curve.terms.1.phase",
    format("fourier"),
    (s) => (s.config.curve.terms[1].phase = 2e6),
    "Phase φ₂",
  ],
  [
    "curve.terms.0.radius",
    format("fourier"),
    (s) => (s.config.curve.terms[0].radius = -1),
    "Radius r₁",
  ],
  [
    "curve.terms.1.frequency",
    format("fourier"),
    (s) => (s.config.curve.terms[1].frequency = 2000),
    "Frequency k₂",
  ],
  [
    "curve.pursuit.pursuers.2.speed",
    format("pursuit"),
    (s) => (s.config.curve.pursuit.pursuers[2].speed = -1),
    "Speed v₃",
  ],
  [
    "curve.pursuit.pursuers.1.y",
    format("pursuit"),
    (s) => (s.config.curve.pursuit.pursuers[1].y = 2e5),
    "Start y₂",
  ],
  [
    "curve.pursuit.capture",
    format("pursuit"),
    (s) => (s.config.curve.pursuit.capture = 0),
    "Capture distance ε",
  ],
  [
    "curve.field.seeds.0.y",
    format("field"),
    (s) => (s.config.curve.field.seeds[0].y = 2e5),
    "Seed y₁",
  ],
  [
    "curve.field.escape",
    format("field"),
    (s) => (s.config.curve.field.escape = 0),
    "Escape radius R",
  ],
  [
    "curve.field.x",
    format("field"),
    (s) => (s.config.curve.field.x = "y+"),
    "dx/dt",
  ],
  [
    "curve.field.y",
    format("field"),
    (s) => (s.config.curve.field.y = "q"),
    "dy/dt",
  ],
  [
    "curve.implicit.f",
    format("implicit"),
    (s) => (s.config.curve.implicit.f = "x+"),
    "F(x, y)",
  ],
  [
    "curve.implicit.window.xMin",
    format("implicit"),
    (s) => (s.config.curve.implicit.window.xMin = -2e5),
    "Window x from",
  ],
  [
    "curve.implicit.window.xMax",
    format("implicit"),
    (s) => (s.config.curve.implicit.window.xMax = 2e5),
    "Window x to",
  ],
  [
    "curve.implicit.window.yMax",
    format("implicit"),
    (s) => (s.config.curve.implicit.window.yMax = 2e5),
    "Window y to",
  ],
  [
    "curve.implicit.cells",
    format("implicit"),
    (s) => (s.config.curve.implicit.cells = 2),
    "Grid cells",
  ],
  [
    "curve.implicit.family.count",
    format("implicit"),
    (s) =>
      (s.config.curve.implicit.family = {
        enabled: true,
        from: 0,
        to: 1,
        count: 1,
      }),
    "Level count",
  ],
  [
    "curve.attractor.c",
    format("attractor"),
    (s) => (s.config.curve.attractor.c = 2000),
    "Coefficient c",
  ],
  [
    "curve.attractor.b",
    format("attractor"),
    (s) => (s.config.curve.attractor.b = 2000),
    "Coefficient b",
  ],
  [
    "curve.attractor.start.x",
    format("attractor"),
    (s) => (s.config.curve.attractor.start.x = 2e5),
    "Start x₀",
  ],
  [
    "curve.attractor.start.y",
    format("attractor"),
    (s) => (s.config.curve.attractor.start.y = 2e5),
    "Start y₀",
  ],
  [
    "curve.attractor.discard",
    format("attractor"),
    (s) => (s.config.curve.attractor.discard = -1),
    "Discarded iterates",
  ],
  [
    "curve.attractor.iterates",
    format("attractor"),
    (s) => (s.config.curve.attractor.iterates = 6e6),
    "Accumulated iterates",
  ],
  [
    "curve.attractor.cells",
    format("attractor"),
    (s) => (s.config.curve.attractor.cells = 2000),
    "Grid cells",
  ],
  [
    "curve.attractor.window.xMax",
    format("attractor"),
    (s) => {
      s.config.curve.attractor.fit = false;
      s.config.curve.attractor.window.xMax = 2e5;
    },
    "Window x to",
  ],
  [
    "rolling.radius",
    (c) => c.kind === "rolling" && c.rolling.shape !== "curve",
    (s) => (s.config.rolling.radius = 0),
    "Circle radius ρ",
  ],
  [
    "rolling.arm",
    (c) => c.kind === "rolling" && c.rolling.shape !== "curve",
    (s) => (s.config.rolling.arm = -1),
    "Tracing distance ℓ",
  ],
  [
    "rolling.phase",
    (c) => c.kind === "rolling" && c.rolling.shape !== "curve",
    (s) => (s.config.rolling.phase = 2e6),
    "Phase ψ (radians)",
  ],
  [
    "rolling.curve.start",
    (c) => c.kind === "rolling" && c.rolling.shape === "curve",
    (s) => (s.config.rolling.curve.start = 99),
    "Contact starts at t",
  ],
  [
    "rolling.point.y",
    (c) => c.kind === "rolling" && c.rolling.shape === "curve",
    (s) => (s.config.rolling.point.y = 2e5),
    "Tracing point y",
  ],
  [
    "rolling.point.x",
    (c) => c.kind === "rolling" && c.rolling.shape === "curve",
    (s) => (s.config.rolling.point.x = 2e5),
    "Tracing point x",
  ],
  [
    "rolling.curve.x",
    (c) => c.kind === "rolling" && c.rolling.shape === "curve",
    (s) => (s.config.rolling.curve.x = "cos("),
    "Rolling x(t)",
  ],
  [
    "rolling.curve.y",
    (c) => c.kind === "rolling" && c.rolling.shape === "curve",
    (s) => (s.config.rolling.curve.y = "q"),
    "Rolling y(t)",
  ],
  [
    "rolling.curve.min",
    (c) => c.kind === "rolling" && c.rolling.shape === "curve",
    (s) => (s.config.rolling.curve.min = -2e6),
    "Rolling t from",
  ],
  [
    "rolling.curve.max",
    (c) => c.kind === "rolling" && c.rolling.shape === "curve",
    (s) => (s.config.rolling.curve.max = -2e5),
    "Rolling t to",
  ],
  [
    "envelope.radius",
    (c) => c.kind === "envelope" && c.envelope.mode === "circle",
    (s) => (s.config.envelope.radius = "1+"),
    "Circle radius R(t)",
  ],
  [
    "envelope.x",
    (c) => c.kind === "envelope" && c.envelope.mode === "chord",
    (s) => (s.config.envelope.x = "q"),
    "Second point x(t)",
  ],
  [
    "envelope.y",
    (c) => c.kind === "envelope" && c.envelope.mode === "chord",
    (s) => (s.config.envelope.y = "q"),
    "Second point y(t)",
  ],
  [
    "envelope.angle",
    (c) => c.kind === "envelope" && c.envelope.mode === "angle",
    (s) => (s.config.envelope.angle = "t+"),
    "Direction angle θ(t)",
  ],
  [
    "inversion.radius",
    (c) => c.kind === "inversion",
    (s) => (s.config.inversion.radius = 0),
    "Inversion radius R",
  ],
];

const study = (s: Study): PlanarStudy => ({
  ...s,
  length: 0.8,
  poleKind: "pedal",
  layers: defaultLayers,
  camera: { x: 0, y: 0, zoom: 1 },
  animation: defaultAnimation,
});

// In groups, so the table runs in parallel.
const groups = 4;
for (let g = 0; g < groups; g++)
  test(`validation errors stand under the control they name (${g + 1} of ${groups})`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    for (const [path, preset, change, label] of cases.filter(
      (_, k) => k % groups === g,
    )) {
      const found = presets.find((p) =>
        typeof preset === "string" ? p.title === preset : preset(p.config),
      );
      expect(found, path).toBeDefined();
      const s: Study = {
        config: structuredClone(found!.config),
        bounds: {
          min: String(found!.config.curve.min),
          max: String(found!.config.curve.max),
        },
      };
      change(s);
      const token = await writeStudyLink("2d", study(s));
      await page.goto("about:blank");
      await page.goto(
        studyHref("http://localhost/", "2d", token).replace(
          "http://localhost",
          "",
        ),
      );
      const alert = page.getByRole("alert");
      await expect(alert, path).toHaveCount(1);
      // By its label's own text: a layer toggle may share the name.
      const field = page.locator(".field").filter({
        has: page.locator(".field-label > label").getByText(label, {
          exact: true,
        }),
      });
      await expect(
        field.getByRole("alert"),
        `${path} under ${label}`,
      ).toHaveCount(1);
      await expect(
        field.locator("input, select, textarea").first(),
        path,
      ).toHaveAttribute("aria-invalid", "true");
    }
  });
