import { test, expect, type Locator, type Page } from "@playwright/test";
import { choosePreset } from "./helpers";

// Each notebook's legend names what the drawing shows: an entry appears
// exactly when its layer is on and the drawn study has that geometry, and
// hiding or showing one moves nothing around the legend. Entries are read
// as text, leaving out a hidden entry's reserved place.
const shown = (legend: Locator) =>
  legend.evaluate((l) =>
    Array.from(l.querySelectorAll<HTMLElement>("[data-legend]"))
      .filter((e) => getComputedStyle(e).visibility === "visible")
      .map((e) => e.textContent!.trim()),
  );
const box = (locator: Locator) =>
  locator.evaluate((e) => {
    const r = e.getBoundingClientRect();
    return [r.x + scrollX, r.y + scrollY, r.width, r.height].map(
      (n) => Math.round(n * 10) / 10,
    );
  });
const layer = (page: Page, name: string) =>
  page.getByRole("checkbox", { name, exact: true });

const spatial = {
  stage: (page: Page) => page.locator(".spatial-stage"),
  legend: (page: Page) => page.locator(".spatial-stage .plot-meta .legend"),
  async open(page: Page, preset?: string) {
    await page.goto("/?study=3d");
    await expect(page.locator("#spatial-artwork")).toBeVisible();
    await this.settle(page);
    if (preset) {
      await choosePreset(page, { label: preset });
      await this.settle(page);
    }
  },
  settle: (page: Page) =>
    expect(page.locator(".spatial-stage")).toHaveAttribute(
      "aria-busy",
      "false",
    ),
};

test("a 3D preset's hidden shell leaves the legend, and returns with its layer", async ({
  page,
}) => {
  await spatial.open(page, "The whole focal surface of an ellipsoid");
  const legend = spatial.legend(page);
  await expect
    .poll(() => shown(legend))
    .toEqual(["Focal sheet 1", "Focal sheet 2"]);
  await layer(page, "Surface patch").check();
  await expect
    .poll(() => shown(legend))
    .toEqual(["Surface", "Focal sheet 1", "Focal sheet 2"]);
  await layer(page, "Focal sheet 1 · κ₁").uncheck();
  await expect.poll(() => shown(legend)).toEqual(["Surface", "Focal sheet 2"]);
});

test("3D legends follow the layers of every kind of study", async ({
  page,
}) => {
  await spatial.open(page);
  const legend = spatial.legend(page);
  // The opening study: a curve and its tangent developable.
  await expect
    .poll(() => shown(legend))
    .toEqual(["Base curve", "Tangent developable"]);
  await layer(page, "Ribbon surface").uncheck();
  await expect.poll(() => shown(legend)).toEqual(["Base curve"]);
  await layer(page, "Ribbon surface").check();
  await expect
    .poll(() => shown(legend))
    .toEqual(["Base curve", "Tangent developable"]);

  await choosePreset(page, { label: "A cage of rings round a (3, 4) knot" });
  await spatial.settle(page);
  await expect.poll(() => shown(legend)).toEqual(["Base curve"]);
  await layer(page, "Canal surface").check();
  await expect
    .poll(() => shown(legend))
    .toEqual(["Base curve", "Canal surface"]);

  await choosePreset(page, { label: "A Klein bottle in twenty-four slices" });
  await spatial.settle(page);
  await expect.poll(() => shown(legend)).toEqual(["Section curves"]);
  await layer(page, "Section curves").uncheck();
  await expect.poll(() => shown(legend)).toEqual([]);
  await layer(page, "Level surface").check();
  await expect.poll(() => shown(legend)).toEqual(["Level surface"]);
});

test("a 3D legend leaves out a layer with nothing to draw", async ({
  page,
}) => {
  // A cylinder bends one way only: its first focal sheet lies at infinity.
  await spatial.open(page, "An elliptic cylinder and its evolute");
  const legend = spatial.legend(page);
  await expect(layer(page, "Focal sheet 1 · κ₁")).toBeChecked();
  await expect.poll(() => shown(legend)).toEqual(["Surface", "Focal sheet 2"]);
});

test("a 3D composition's base curve follows its layer", async ({ page }) => {
  await spatial.open(page);
  await page
    .getByLabel("Built on", { exact: true })
    .selectOption("tangent-foot");
  await spatial.settle(page);
  const legend = spatial.legend(page);
  await expect
    .poll(() => shown(legend))
    .toEqual(["Tangent-foot curve", "Tangent developable", "Base curve"]);
  await layer(page, "Base curve").uncheck();
  await expect
    .poll(() => shown(legend))
    .toEqual(["Tangent-foot curve", "Tangent developable"]);
});

const planar = {
  legend: (page: Page) => page.locator(".app:visible .plot-meta .legend"),
  settle: (page: Page) => expect(page.locator("#artwork")).toBeVisible(),
};

test("2D legends follow the base and derived layers", async ({ page }) => {
  await page.goto("/");
  await planar.settle(page);
  const legend = planar.legend(page);
  const [base, derived] = ["Base curve", "Derived curve"].map((n) =>
    layer(page, n),
  );
  const kind = await page
    .locator(".app:visible")
    .evaluate((app) =>
      (
        app.querySelector(".legend [data-legend='derived']") as HTMLElement
      ).textContent!.trim(),
    );
  await expect.poll(() => shown(legend)).toEqual(["Base curve", kind]);
  await derived.uncheck();
  await expect.poll(() => shown(legend)).toEqual(["Base curve"]);
  await base.uncheck();
  await expect.poll(() => shown(legend)).toEqual([]);
  await derived.check();
  await expect.poll(() => shown(legend)).toEqual([kind]);
});

test("a 2D legend leaves out a derived curve with nothing to draw", async ({
  page,
}) => {
  // A line has no center of curvature: its evolute lies at infinity.
  await page.goto("/");
  await planar.settle(page);
  await page
    .getByRole("group", { name: "Construction" })
    .getByRole("button", { name: "evolute", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Definition", exact: true })
    .selectOption("parametric");
  await page.getByRole("textbox", { name: "x(t)", exact: true }).fill("t");
  await page.getByRole("textbox", { name: "y(t)", exact: true }).fill("t/2");
  await expect(page.getByTestId("derived-curve")).toHaveAttribute("d", "");
  await expect.poll(() => shown(planar.legend(page))).toEqual(["Base curve"]);
});

const four = {
  legend: (page: Page) => page.locator(".tesseract-stage .tesseract-legend"),
  async open(page: Page, preset: string) {
    await page.goto("/?study=4d");
    await this.settle(page);
    await choosePreset(page, { label: preset });
    await this.settle(page);
  },
  settle: (page: Page) =>
    expect(page.locator(".tesseract-stage")).toHaveAttribute(
      "aria-busy",
      "false",
    ),
};

test("a 4D legend names a lift's guides and connectors only when drawn", async ({
  page,
}) => {
  await four.open(page, "The missing middle");
  const legend = four.legend(page);
  await expect
    .poll(() => shown(legend))
    .toEqual(["Straight threads", "Circular strand"]);
  await layer(page, "Missing-region guide").check();
  await four.settle(page);
  await expect
    .poll(() => shown(legend))
    .toEqual(["Straight threads", "Circular strand", "Missing-region guide"]);
  await page
    .getByRole("combobox", { name: "View operation", exact: true })
    .selectOption("lifted");
  await four.settle(page);
  await layer(page, "Displacement connectors").check();
  await four.settle(page);
  await expect
    .poll(() => shown(legend))
    .toEqual([
      "Straight threads",
      "Circular strand",
      "Missing-region guide",
      "Displacement connectors",
    ]);
  await layer(page, "Lifted centerlines").uncheck();
  await four.settle(page);
  await expect
    .poll(() => shown(legend))
    .toEqual(["Missing-region guide", "Displacement connectors"]);
});

test("a 4D bypass legend names coordinate guides only in the diagram", async ({
  page,
}) => {
  await four.open(page, "Beside the wall");
  const legend = four.legend(page);
  const shadow = await shown(legend);
  expect(shadow).toContain("Outer boundary");
  expect(shadow).not.toContain("Coordinate guides");
  await page
    .getByRole("combobox", { name: "View operation", exact: true })
    .selectOption("diagram");
  await four.settle(page);
  await expect.poll(() => shown(legend)).toContain("Coordinate guides");
  // Paired, the legend names both representations' geometry.
  await page
    .getByRole("combobox", { name: "View operation", exact: true })
    .selectOption("paired");
  await four.settle(page);
  await expect.poll(() => shown(legend)).toContain("Coordinate guides");
  await layer(page, "Shell and coordinate guides").uncheck();
  await four.settle(page);
  // Comparison points share the boundaries' inks but are not boundaries.
  await layer(page, "Comparison points").check();
  await four.settle(page);
  const unguided = await shown(legend);
  expect(unguided).not.toContain("Inner boundary");
  expect(unguided).not.toContain("Outer boundary");
  expect(unguided).not.toContain("Coordinate guides");
});

test("4D direction and section keys follow the layers that draw them", async ({
  page,
}) => {
  await four.open(page, "An orthogonal shadow");
  const legend = four.legend(page);
  await expect.poll(() => shown(legend)).toEqual(["x", "y", "z", "w"]);
  await layer(page, "Edges & section contours").uncheck();
  await four.settle(page);
  // The face lattice is drawn in the same inks.
  await expect.poll(() => shown(legend)).toEqual(["x", "y", "z", "w"]);
  await layer(page, "Face lattice").uncheck();
  await four.settle(page);
  await expect.poll(() => shown(legend)).toEqual([]);

  // A single section's translucent faces carry the inks of its cells' axes.
  await choosePreset(page, { label: "An octahedron within" });
  await layer(page, "Translucent section faces").check();
  await four.settle(page);
  const faced = await shown(legend);
  expect(faced.length).toBeGreaterThan(0);
  await layer(page, "Translucent section faces").uncheck();
  await four.settle(page);
  await expect.poll(() => shown(legend)).toEqual([]);
  await layer(page, "Translucent section faces").check();

  // Layers persist from study to study.
  await choosePreset(page, { label: "A sphere in passing" });
  await layer(page, "Edges & section contours").check();
  await four.settle(page);
  const sections = await legend.locator("[data-section]").count();
  expect(sections).toBeGreaterThan(1);
  await expect.poll(async () => (await shown(legend)).length).toBe(sections);
  await layer(page, "Edges & section contours").uncheck();
  await four.settle(page);
  await expect.poll(() => shown(legend)).toEqual([]);
});

// Hiding a layer must not move what sits beside or below the legend.
const stable: {
  notebook: string;
  open: (page: Page) => Promise<void>;
  meta: (page: Page) => Locator;
  below: (page: Page) => Locator;
  toggles: string[];
  settle: (page: Page) => Promise<void>;
}[] = [
  {
    notebook: "2D",
    open: async (page) => {
      await page.goto("/");
      await planar.settle(page);
    },
    meta: (page) => page.locator(".app:visible .plot-meta"),
    below: (page) => page.locator(".app:visible .explanation"),
    toggles: ["Derived curve", "Base curve"],
    settle: planar.settle,
  },
  {
    notebook: "3D",
    open: (page) =>
      spatial.open(page, "The whole focal surface of an ellipsoid"),
    meta: (page) => page.locator(".spatial-stage .plot-meta"),
    below: (page) => page.locator(".spatial-stage .camera-controls"),
    toggles: ["Focal sheet 1 · κ₁", "Focal sheet 2 · κ₂"],
    settle: spatial.settle,
  },
  {
    notebook: "4D",
    open: async (page) => {
      await four.open(page, "The missing middle");
      await page
        .getByRole("combobox", { name: "View operation", exact: true })
        .selectOption("lifted");
      await four.settle(page);
      await layer(page, "Missing-region guide").check();
      await layer(page, "Displacement connectors").check();
      await four.settle(page);
    },
    meta: (page) => page.locator(".tesseract-stage .plot-meta"),
    below: (page) => page.locator(".tesseract-app .orientation"),
    toggles: [
      "Displacement connectors",
      "Missing-region guide",
      "Lifted centerlines",
    ],
    settle: four.settle,
  },
];
for (const { notebook, open, meta, below, toggles, settle } of stable)
  for (const width of [1440, 1100, 390])
    test(`hiding layers moves nothing beside the ${notebook} legend at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await open(page);
      const before = [await box(meta(page)), await box(below(page))];
      for (const name of toggles) {
        await layer(page, name).uncheck();
        await settle(page);
        expect([await box(meta(page)), await box(below(page))]).toEqual(before);
      }
    });

test("a 3D legend never names another study's geometry", async ({ page }) => {
  // The legend describes the drawn study: while a new study is computed,
  // its labels must not meet the geometry of the study still drawn. Every
  // state the legend passes through is recorded.
  await spatial.open(page, "The whole focal surface of an ellipsoid");
  await layer(page, "Surface patch").check();
  await spatial.settle(page);
  await spatial.legend(page).evaluate((legend) => {
    const w = window as unknown as { legendStates: string[][] };
    w.legendStates = [];
    const record = () =>
      w.legendStates.push(
        Array.from(legend.querySelectorAll<HTMLElement>("[data-legend]"))
          .filter((e) => getComputedStyle(e).visibility === "visible")
          .map((e) => e.textContent!.trim()),
      );
    new MutationObserver(record).observe(legend, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
  });
  await choosePreset(page, {
    label: "A trefoil's osculating circle, all the way round",
  });
  await spatial.settle(page);
  const states = await page.evaluate(
    () => (window as unknown as { legendStates: string[][] }).legendStates,
  );
  // The curve is always drawn, so every state of a curve study names it.
  expect(states.length).toBeGreaterThan(0);
  for (const state of states) expect(state).toContain("Base curve");
});
