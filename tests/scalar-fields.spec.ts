import { test, expect, type Page } from "@playwright/test";

// Every numeric curve and construction parameter is a constant expression
// resolved by the Go parser, like the domain bounds: pi, e, phi, arithmetic,
// and functions, but never t, x, or a. Whole-number counts stay numeric.
async function ready(page: Page, preset: string) {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await page
    .getByRole("combobox", { name: "Start with a notebook example" })
    .selectOption({ label: preset });
  await settled(page);
}
async function settled(page: Page) {
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
}
async function definition(page: Page) {
  return JSON.parse((await page.locator("#artwork desc").textContent())!);
}
const field = (page: Page, name: string) =>
  page.getByRole("textbox", { name, exact: true });
const phi = (1 + Math.sqrt(5)) / 2;

type Case = { name: string; text: string; value: number; path: string[] };
const studies: {
  preset: string;
  setup?: (page: Page) => Promise<void>;
  cases: Case[];
}[] = [
  {
    preset: "Hypotrochoid & its evolute",
    cases: [
      {
        name: "Fixed radius R",
        text: "2*e",
        value: 2 * Math.E,
        path: ["curve", "roulette", "fixedRadius"],
      },
      {
        name: "Rolling radius r",
        text: "phi",
        value: phi,
        path: ["curve", "roulette", "radius"],
      },
      {
        name: "Tracing distance d",
        text: "e",
        value: Math.E,
        path: ["curve", "roulette", "arm"],
      },
      {
        name: "Phase φ (radians)",
        text: "pi/2",
        value: Math.PI / 2,
        path: ["curve", "roulette", "phase"],
      },
    ],
  },
  {
    preset: "Flower & a rolling circle",
    cases: [
      {
        name: "Circle radius ρ",
        text: "phi/10",
        value: phi / 10,
        path: ["rolling", "radius"],
      },
      {
        name: "Tracing distance ℓ",
        text: "e/10",
        value: Math.E / 10,
        path: ["rolling", "arm"],
      },
      {
        name: "Phase ψ (radians)",
        text: "-pi",
        value: -Math.PI,
        path: ["rolling", "phase"],
      },
    ],
  },
  {
    preset: "Ellipse & its evolute",
    cases: [
      {
        name: "Shape parameter a",
        text: "phi",
        value: phi,
        path: ["curve", "a"],
      },
    ],
  },
  {
    preset: "Ellipse & its pedal",
    cases: [
      { name: "Pole x", text: "-phi", value: -phi, path: ["pole", "x"] },
      { name: "Pole y", text: "e/10", value: Math.E / 10, path: ["pole", "y"] },
    ],
  },
  {
    preset: "Light inside a circle",
    cases: [
      {
        name: "Source x",
        text: "1/e",
        value: 1 / Math.E,
        path: ["source", "position", "x"],
      },
      {
        name: "Source y",
        text: "-1/phi",
        value: -1 / phi,
        path: ["source", "position", "y"],
      },
    ],
  },
  {
    preset: "Light inside a circle",
    setup: async (page) => {
      await page
        .getByRole("combobox", { name: "Source coordinates" })
        .selectOption("polar");
    },
    cases: [
      {
        name: "Source radius r",
        text: "phi/2",
        value: phi / 2,
        path: ["source", "radius"],
      },
      {
        name: "Source theta θ (radians)",
        text: "pi/2",
        value: Math.PI / 2,
        path: ["source", "theta"],
      },
    ],
  },
  {
    preset: "Parallel light & a circle",
    cases: [
      {
        name: "Travel direction (degrees)",
        text: "180/pi",
        value: 180 / Math.PI,
        path: ["source", "angle"],
      },
    ],
  },
  {
    preset: "Through a parabola",
    cases: [
      {
        name: "Incident index n₁",
        text: "phi",
        value: phi,
        path: ["nIncident"],
      },
      {
        name: "Transmitted n₂",
        text: "sqrt(2)",
        value: Math.SQRT2,
        path: ["nTransmitted"],
      },
    ],
  },
  {
    preset: "Flower & its offset",
    cases: [
      {
        name: "Offset distance d",
        text: "-1/e",
        value: -1 / Math.E,
        path: ["distance"],
      },
    ],
  },
  {
    preset: "Flower & its offset stack",
    cases: [
      {
        name: "First offset distance",
        text: "-pi/4",
        value: -Math.PI / 4,
        path: ["stack", "from"],
      },
      {
        name: "Last offset distance",
        text: "e/4",
        value: Math.E / 4,
        path: ["stack", "to"],
      },
    ],
  },
  {
    preset: "Unwinding a circle",
    cases: [
      {
        name: "Initial string offset c",
        text: "pi",
        value: Math.PI,
        path: ["offset"],
      },
    ],
  },
];

for (const study of studies)
  test(`${study.cases.map((c) => c.name).join(", ")} accept constant expressions`, async ({
    page,
  }) => {
    await ready(page, study.preset);
    await study.setup?.(page);
    for (const c of study.cases) {
      await field(page, c.name).fill(c.text);
      await settled(page);
      await expect(page.getByRole("alert")).toHaveCount(0);
      const value = c.path.reduce((o, k) => o[k], await definition(page));
      expect(value).toBeCloseTo(c.value, 14);
      // The field keeps the expression as entered.
      await expect(field(page, c.name)).toHaveValue(c.text);
    }
  });

test("invalid constant expressions name their field and recover", async ({
  page,
}) => {
  await ready(page, "Hypotrochoid & its evolute");
  const phase = field(page, "Phase φ (radians)");
  await phase.fill("t");
  await expect(page.getByRole("alert")).toContainText("Phase φ (radians)");
  await expect(page.getByRole("alert")).toContainText("not allowed");
  await phase.fill("2 pi");
  await expect(page.getByRole("alert")).toContainText("use * for");
  await phase.fill("a");
  await expect(page.getByRole("alert")).toContainText("only allowed in curve");
  await phase.fill("");
  await expect(page.getByRole("alert")).toContainText("finite number");
  await phase.fill("pi/3");
  await settled(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect((await definition(page)).curve.roulette.phase).toBe(Math.PI / 3);
  // Plain decimals keep working exactly.
  await phase.fill("0.25");
  await settled(page);
  expect((await definition(page)).curve.roulette.phase).toBe(0.25);
});

test("fields show new values set elsewhere, replacing an expression", async ({
  page,
}) => {
  await ready(page, "Light inside a circle");
  await page
    .getByRole("combobox", { name: "Source coordinates" })
    .selectOption("polar");
  // Type the point and switch back in one task, while Go is still evaluating
  // it: the conversion must use the point just entered.
  await page.evaluate(() => {
    const type = (label: string, text: string) => {
      const input = [...document.querySelectorAll("label")].find(
        (l) => l.textContent === label,
      )!.control as HTMLInputElement;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    type("Source theta θ (radians)", "pi/2");
    type("Source radius r", "phi");
    const select = [...document.querySelectorAll("label")].find(
      (l) => l.textContent === "Source coordinates",
    )!.control as HTMLSelectElement;
    select.value = "cartesian";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settled(page);
  const { x, y } = (await definition(page)).source.position;
  expect(x).toBeCloseTo(0, 12);
  expect(y).toBeCloseTo(phi, 12);
  await expect(field(page, "Source y")).toHaveValue(String(y));
  // An expression still being evaluated when a preset is chosen is dropped,
  // not applied to the preset.
  await ready(page, "Ellipse & its evolute");
  await page.evaluate(() => {
    const control = (label: string) =>
      [...document.querySelectorAll("label")].find(
        (l) => l.textContent === label,
      )!.control as HTMLInputElement & HTMLSelectElement;
    const input = control("Shape parameter a");
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "2*pi");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const select = control("Start with a notebook example");
    select.value = "4";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settled(page);
  expect((await definition(page)).curve.x).toBe("2*(t-sin(t))");
  expect((await definition(page)).curve.a).toBe(1);
  await expect(field(page, "Shape parameter a")).toHaveValue("1");
  // A preset replaces an edited expression with its own value, and an
  // invalid entry does not survive the change either.
  await ready(page, "Hypotrochoid & its evolute");
  await field(page, "Phase φ (radians)").fill("pi");
  await field(page, "Tracing distance d").fill("x");
  await expect(page.getByRole("alert")).toContainText("Tracing distance d");
  await page
    .getByRole("combobox", { name: "Start with a notebook example" })
    .selectOption({ label: "Hypotrochoid & its evolute" });
  await settled(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(field(page, "Phase φ (radians)")).toHaveValue("0");
  await expect(field(page, "Tracing distance d")).toHaveValue("3");
});

// Spatial parameters share the same Go scalar parser as planar controls.
test("spatial radii and tangent reach accept constants and reject variables", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  const stage = page.locator(".spatial-stage");
  await expect(page.locator("#spatial-artwork")).toBeVisible();
  for (const [name, text, key, value] of [
    ["Major radius R", "2*pi", "radius", 2 * Math.PI],
    ["Minor radius r", "phi", "tube", phi],
    ["Tangent reach L", "e", "length", Math.E],
  ] as const) {
    await field(page, name).fill(text);
    await expect
      .poll(
        async () => JSON.parse((await stage.getAttribute("data-config"))!)[key],
      )
      .toBe(value);
    await expect(field(page, name)).toHaveValue(text);
  }
  for (const variable of ["t", "x", "a"]) {
    await field(page, "Tangent reach L").fill(variable);
    await expect(page.getByRole("alert")).toBeVisible();
  }
  await field(page, "Tangent reach L").fill("pi/2");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect
    .poll(
      async () => JSON.parse((await stage.getAttribute("data-config"))!).length,
    )
    .toBe(Math.PI / 2);
});
