import { test, expect } from "@playwright/test";
import { spatialPresets } from "../web/spatial/presets";
import { defaultAnimation, type SpatialStudy } from "../web/spatial/link";
import { defaultLayers, initialView } from "../web/spatial/renderer";
import { defaultProbe } from "../web/spatial/probe";
import { defaultCut } from "../web/spatial/cut";
import { defaultSight } from "../web/spatial/sight";
import type { SpatialConfig } from "../web/spatial/types";
import { studyHref, writeStudyLink } from "../web/study-link";

// Every field the engine names in a validation error has a control that
// shows the error: each study is opened from a link, with one field out of
// range, and its error must stand under the control with this label, as
// the page's one alert. The labels are written out here, not derived from
// the notebook's own table (web/spatial/fields.ts).
type Case = [
  field: string,
  preset: string | ((c: SpatialConfig) => boolean),
  change: (c: SpatialConfig) => void,
  label: string,
];
const named = (format: SpatialConfig["format"]) => (c: SpatialConfig) =>
  c.format === format;
const cases: Case[] = [
  ["samples", "Trefoil · (2, 3)", (c) => (c.samples = 100), "Curve samples"],
  ["lines", "Trefoil · (2, 3)", (c) => (c.lines = 2), "Tangent lines"],
  ["length", "Trefoil · (2, 3)", (c) => (c.length = 30), "Tangent reach L"],
  ["radius", "Trefoil · (2, 3)", (c) => (c.radius = 30), "Major radius R"],
  ["p", "Trefoil · (2, 3)", (c) => (c.p = 9), "Knot winding"],
  [
    "rays.azimuth",
    "A paraboloid gathering light",
    (c) => (c.rays.azimuth = 2e5),
    "Azimuth α (°)",
  ],
  [
    "implicit.refine",
    "A sphere and its latitudes",
    (c) => (c.implicit.refine = 9),
    "Refinement levels",
  ],
  ["tube", "Trefoil · (2, 3)", (c) => (c.tube = 3), "Minor radius r"],
  [
    "pole.y",
    "A knot through perpendiculars",
    (c) => (c.pole.y = 2e5),
    "Pole y",
  ],
  [
    "unwinding.offset",
    "A sheet of Viviani's normals",
    (c) => (c.unwinding.offset = 2e5),
    "Input string c",
  ],
  [
    "unwinding.anchor",
    "A sheet of Viviani's normals",
    (c) => (c.unwinding.anchor = 99),
    "Input anchor t₀",
  ],
  [
    "coil.radius",
    "A coiled cord round a trefoil",
    (c) => (c.coil.radius = -1),
    "Coil radius d",
  ],
  [
    "coil.angle",
    "A coiled cord round a trefoil",
    (c) => (c.coil.angle = 2e3),
    "Coil angle θ₀",
  ],
  [
    "coil.turns",
    "Threads twisted round a coiled helix",
    (c) => (c.coil.turns = 101),
    "Coil turns",
  ],
  [
    "curve.min",
    "Helix · a ribbon staircase",
    (c) => (c.curve.min = 2e6),
    "t from",
  ],
  ["curve.max", "Helix · a ribbon staircase", (c) => (c.curve.max = -99), "to"],
  ["curve.y", "Helix · a ribbon staircase", (c) => (c.curve.y = "t+"), "y(t)"],
  [
    "involute.anchor",
    "Unwinding a staircase",
    (c) => (c.involute.anchor = 99),
    "Anchor t₀",
  ],
  [
    "involute.family.to",
    "Unwinding a staircase",
    (c) => (c.involute.family.to = 2e5),
    "c to",
  ],
  [
    "involute.family.count",
    "Unwinding a staircase",
    (c) => (c.involute.family.count = 30),
    "Involutes",
  ],
  [
    "involute.offset",
    "Unwinding a staircase",
    (c) => {
      c.involute.family.enabled = false;
      c.involute.offset = 2e5;
    },
    "String length c",
  ],
  [
    "inversion.radius",
    "A staircase drawn into a sphere",
    (c) => (c.inversion.radius = 0),
    "Sphere radius R",
  ],
  [
    "inversion.center.z",
    "A staircase drawn into a sphere",
    (c) => (c.inversion.center.z = 2e5),
    "Center z",
  ],
  [
    "harmonic.center.x",
    "A harmonic trefoil",
    (c) => (c.harmonic.center.x = 2e5),
    "c₀ x",
  ],
  [
    "harmonic.terms.1.frequency",
    "A harmonic trefoil",
    (c) => (c.harmonic.terms[1].frequency = 2000),
    "Frequency ω₂",
  ],
  [
    "harmonic.terms.0.sine.y",
    "A harmonic trefoil",
    (c) => (c.harmonic.terms[0].sine.y = 2e5),
    "B₁ y",
  ],
  ["harmonic.max", "A harmonic trefoil", (c) => (c.harmonic.max = -1), "to"],
  [
    "frame.angle",
    "A band around the trefoil",
    (c) => (c.frame.angle = 2000),
    "Angle θ₀",
  ],
  [
    "frame.twist",
    "A band around the trefoil",
    (c) => (c.frame.twist = 200),
    "Twist (turns)",
  ],
  [
    "frame.width",
    "A band around the trefoil",
    (c) => (c.frame.width = -1),
    "Half-width w",
  ],
  [
    "frame.offset",
    "A band around the trefoil",
    (c) => (c.frame.offset = -1),
    "Offset d",
  ],
  [
    "frame.strands",
    "A band around the trefoil",
    (c) => (c.frame.strands = 13),
    "Offset strands",
  ],
  [
    "frame.reference.z",
    "A band around the trefoil",
    (c) => (c.frame.reference.z = 2e5),
    "N₀ z",
  ],
  [
    "ruled.rate",
    "Chords across the trefoil",
    (c) => (c.ruled.rate = 200),
    "Rate m",
  ],
  [
    "ruled.shift",
    "Chords across the trefoil",
    (c) => (c.ruled.shift = 2e6),
    "Shift δ",
  ],
  [
    "ruled.thread.x",
    (c) => c.construction === "ruled" && c.ruled.partner === "thread",
    (c) => (c.ruled.thread.x = "t+"),
    "b x(t)",
  ],
  [
    "canal.radius",
    "A tube around the trefoil",
    (c) => (c.canal.radius = 0),
    "Tube radius R",
  ],
  [
    "canal.meridians",
    "A tube around the trefoil",
    (c) => (c.canal.meridians = 13),
    "Meridians",
  ],
  [
    "canal.profile",
    "A tube around the trefoil",
    (c) => (c.canal.profile = "-1"),
    "Profile ρ(t)",
  ],
  [
    "field.seeds.0.y",
    "A rising vortex",
    (c) => (c.field.seeds[0].y = 2e5),
    "Seed y₁",
  ],
  [
    "field.escape",
    "A rising vortex",
    (c) => (c.field.escape = 0),
    "Escape radius R",
  ],
  ["field.z", "A rising vortex", (c) => (c.field.z = "x+"), "dz/dt"],
  ["field.max", "A rising vortex", (c) => (c.field.max = -99), "to"],
  [
    "pursuit.pursuers.1.x",
    "Four pursuers on a tetrahedron",
    (c) => (c.pursuit.pursuers[1].x = 2e5),
    "Start x₂",
  ],
  [
    "pursuit.pursuers.0.speed",
    "Four pursuers on a tetrahedron",
    (c) => (c.pursuit.pursuers[0].speed = -1),
    "Speed v₁",
  ],
  [
    "pursuit.capture",
    "Four pursuers on a tetrahedron",
    (c) => (c.pursuit.capture = 0),
    "Capture distance ε",
  ],
  [
    "surface.b",
    "A torus revealing its centers",
    (c) => (c.surface.b = 0),
    "Minor radius r",
  ],
  [
    "surface.c",
    "The focal sheets of an ellipsoid",
    (c) => (c.surface.c = 0),
    "Axis c",
  ],
  [
    "surface.vMax",
    "The focal sheets of an ellipsoid",
    (c) => (c.surface.vMax = -99),
    "v to",
  ],
  [
    "surface.uSamples",
    "The focal sheets of an ellipsoid",
    (c) => (c.surface.uSamples = 4),
    "u samples",
  ],
  [
    "surface.curves",
    "The focal sheets of an ellipsoid",
    (c) => (c.surface.curves = 1),
    "Parameter curves",
  ],
  [
    "surface.offset",
    "The focal sheets of an ellipsoid",
    (c) => (c.surface.offset = 2e5),
    "Offset d",
  ],
  [
    "surface.reach",
    "The focal sheets of an ellipsoid",
    (c) => (c.surface.reach = 2e5),
    "Normal reach ℓ",
  ],
  [
    "rays.elevation",
    "A paraboloid gathering light",
    (c) => (c.rays.elevation = 2e5),
    "Elevation β (°)",
  ],
  [
    "rays.length",
    "A paraboloid gathering light",
    (c) => (c.rays.length = -1),
    "Ray length ℓ",
  ],
  [
    "rays.source.x",
    "An ellipsoid refocusing its lamp",
    (c) => (c.rays.source.x = 2e5),
    "Source x",
  ],
  [
    "rays.n2",
    "A glass ellipsoid focusing a beam",
    (c) => (c.rays.n2 = 0),
    "Index n₂",
  ],
  [
    "rays.receiver.at",
    "A glass dome's ring of light",
    (c) => (c.rays.receiver.at = 2e5),
    "Plane at c",
  ],
  [
    "rays.receiver.c2",
    "A glass dome's ring of light",
    (c) => (c.rays.receiver.c2 = 2e5),
    "Centre y",
  ],
  [
    "rays.receiver.size",
    "A glass dome's ring of light",
    (c) => (c.rays.receiver.size = 0),
    "Window size s",
  ],
  [
    "rays.receiver.bins",
    "A glass dome's ring of light",
    (c) => (c.rays.receiver.bins = 1),
    "Bins",
  ],
  [
    "implicit.box.yMax",
    "A sphere and its latitudes",
    (c) => (c.implicit.box.yMax = 2e5),
    "y to",
  ],
  [
    "implicit.cells",
    "A sphere and its latitudes",
    (c) => (c.implicit.cells = 1),
    "Cells",
  ],
  [
    "implicit.sections.normal.x",
    named("implicit"),
    (c) => {
      c.implicit.sections.count = 3;
      c.implicit.sections.normal = { x: 2e5, y: 0, z: 1 };
    },
    "Normal x",
  ],
  [
    "implicit.sections.to",
    named("implicit"),
    (c) => {
      c.implicit.sections.count = 3;
      c.implicit.sections.to = 2e5;
    },
    "Last offset d₁",
  ],
  [
    "implicit.f",
    "A sphere and its latitudes",
    (c) => (c.implicit.f = "x+"),
    "F(x, y, z)",
  ],
];

const study = (config: SpatialConfig): SpatialStudy => ({
  config,
  layers: defaultLayers,
  view: initialView,
  animation: defaultAnimation,
  probe: defaultProbe,
  cut: defaultCut,
  sight: defaultSight,
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
      const found = spatialPresets.find((p) =>
        typeof preset === "string" ? p.name === preset : preset(p.config),
      );
      expect(found, path).toBeDefined();
      const config = structuredClone(found!.config);
      change(config);
      const token = await writeStudyLink("3d", study(config));
      await page.goto("about:blank");
      await page.goto(
        studyHref("http://localhost/?study=3d", "3d", token).replace(
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

// The cut plane's own Offset d shows only its own errors: the surface's
// offset error stands under the surface's field alone.
test("a label shared with the cut panel does not take the study's error", async ({
  page,
}) => {
  const found = spatialPresets.find(
    (p) => p.name === "The focal sheets of an ellipsoid",
  )!;
  const config = structuredClone(found.config);
  config.surface.offset = 2e5;
  const token = await writeStudyLink("3d", {
    ...study(config),
    cut: { ...defaultCut, enabled: true },
  });
  await page.goto(
    studyHref("http://localhost/?study=3d", "3d", token).replace(
      "http://localhost",
      "",
    ),
  );
  await expect(page.getByRole("alert")).toHaveCount(1);
  await expect(
    page.locator(".spatial-cut .field").getByRole("alert"),
  ).toHaveCount(0);
  await expect(
    page
      .locator(".field")
      .filter({
        has: page
          .locator(".field-label > label")
          .getByText("Offset d", { exact: true }),
      })
      .getByRole("alert"),
  ).toHaveCount(1);
  // And the cut's own unparsable offset stands under the cut's field (the
  // cut panel also reports the value it lacks), not under the surface's
  // field of the same name.
  await page
    .locator(".spatial-cut")
    .getByRole("textbox", { name: "Offset d", exact: true })
    .fill("t");
  await expect(
    page.locator(".spatial-cut .field").getByRole("alert"),
  ).toContainText("not allowed");
  await expect(
    page
      .locator(".field:not(.spatial-cut .field)")
      .filter({
        has: page
          .locator(".field-label > label")
          .getByText("Offset d", { exact: true }),
      })
      .getByRole("alert"),
  ).toHaveCount(0);
});
