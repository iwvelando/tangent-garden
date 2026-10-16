import { test, expect } from "@playwright/test";
import { choosePreset } from "./helpers";
import { spatialPresets } from "../web/spatial/presets";
import { app, planar, settled, tesseract, walk } from "./preset-study";

// Every 2D and 4D example replaces the whole study (see preset-study.ts);
// the 3D examples are walked in preset-study-3d-*.spec.ts.
walk(planar);
walk(tesseract);

const mode = (page: Parameters<typeof app>[0]) =>
  app(page).getByLabel("Animate", { exact: true });

// The reported case: an animation varying the gyroid's shape parameter a
// is not carried into the tanglecube, whose surface does not use a.
test("3d: an example without an animation of its own does not keep the previous one", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await choosePreset(page, { label: "A gyroid, cut open" });
  await settled(page, ".spatial-stage");
  await mode(page).selectOption("parameters");
  const track = app(page).getByLabel("Parameter 1", { exact: true });
  await track.selectOption("implicitA");
  await expect(track).toHaveValue("implicitA");
  await choosePreset(page, { label: "The tanglecube" });
  await settled(page, ".spatial-stage");
  await expect(mode(page)).toHaveValue("reveal");
});

// The first example chosen on a page brings its own animation too.
test("3d: the first example chosen opens with its own animation", async ({
  page,
}) => {
  const name = "A coiled cord round a trefoil";
  const flight = spatialPresets.find((p) => p.name === name)!.flight!;
  await page.goto("/?study=3d");
  await settled(page, ".spatial-stage");
  await choosePreset(page, { label: name });
  await settled(page, ".spatial-stage");
  await expect(mode(page)).toHaveValue(flight.animate!.mode);
  await expect(app(page).getByLabel("Repeat", { exact: true })).toHaveValue(
    flight.repeat!,
  );
});
