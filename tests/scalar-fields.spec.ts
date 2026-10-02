import { test, expect, type Locator, type Page } from "@playwright/test";
import { choosePreset, examplesButton } from "./helpers";

// Every numeric curve and construction parameter is a constant expression
// resolved by the Go parser, like the domain bounds: pi, e, phi, arithmetic,
// and functions, but never t, x, or a. Whole-number counts stay numeric.
async function ready(page: Page, preset: string) {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await choosePreset(page, { label: preset });
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
    preset: "Ellipse rolling on an ellipse",
    cases: [
      {
        name: "Rolling t from",
        text: "-pi",
        value: -Math.PI,
        path: ["rolling", "curve", "min"],
      },
      {
        name: "Rolling t to",
        text: "pi",
        value: Math.PI,
        path: ["rolling", "curve", "max"],
      },
      {
        name: "Contact starts at t",
        text: "-pi/phi",
        value: -Math.PI / phi,
        path: ["rolling", "curve", "start"],
      },
      {
        name: "Tracing point x",
        text: "e/2",
        value: Math.E / 2,
        path: ["rolling", "point", "x"],
      },
      {
        name: "Tracing point y",
        text: "-1/phi",
        value: -1 / phi,
        path: ["rolling", "point", "y"],
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
    preset: "Hyperbola into a lemniscate",
    cases: [
      {
        name: "Inversion center x",
        text: "-phi/10",
        value: -phi / 10,
        path: ["inversion", "center", "x"],
      },
      {
        name: "Inversion center y",
        text: "e/10",
        value: Math.E / 10,
        path: ["inversion", "center", "y"],
      },
      {
        name: "Inversion radius R",
        text: "sqrt(phi)",
        value: Math.sqrt(phi),
        path: ["inversion", "radius"],
      },
    ],
  },
  {
    preset: "Lissajous 3 : 2 & its pedal",
    cases: [
      {
        name: "Amplitude A",
        text: "phi",
        value: phi,
        path: ["curve", "lissajous", "amplitudeX"],
      },
      {
        name: "Amplitude B",
        text: "e/2",
        value: Math.E / 2,
        path: ["curve", "lissajous", "amplitudeY"],
      },
      {
        name: "Frequency m",
        text: "sqrt(2)",
        value: Math.SQRT2,
        path: ["curve", "lissajous", "frequencyX"],
      },
      {
        name: "Frequency n",
        text: "-pi",
        value: -Math.PI,
        path: ["curve", "lissajous", "frequencyY"],
      },
      {
        name: "Phase φ (radians)",
        text: "pi/3",
        value: Math.PI / 3,
        path: ["curve", "lissajous", "phase"],
      },
    ],
  },
  {
    preset: "Epicycles, turned inside out",
    cases: [
      {
        name: "Frequency k₁",
        text: "phi",
        value: phi,
        path: ["curve", "terms", "0", "frequency"],
      },
      {
        name: "Radius r₂",
        text: "1/e",
        value: 1 / Math.E,
        path: ["curve", "terms", "1", "radius"],
      },
      {
        name: "Phase φ₃",
        text: "-pi/4",
        value: -Math.PI / 4,
        path: ["curve", "terms", "2", "phase"],
      },
    ],
  },
  {
    preset: "Four chasers at unequal speeds",
    cases: [
      {
        name: "Start x₁",
        text: "sqrt(2)",
        value: Math.SQRT2,
        path: ["curve", "pursuit", "pursuers", "0", "x"],
      },
      {
        name: "Start y₃",
        text: "-phi",
        value: -phi,
        path: ["curve", "pursuit", "pursuers", "2", "y"],
      },
      {
        name: "Speed v₄",
        text: "e/2",
        value: Math.E / 2,
        path: ["curve", "pursuit", "pursuers", "3", "speed"],
      },
      {
        name: "Capture distance ε",
        text: "pi/100",
        value: Math.PI / 100,
        path: ["curve", "pursuit", "capture"],
      },
    ],
  },
  {
    preset: "Van der Pol limit cycle",
    cases: [
      {
        name: "Seed x₁",
        text: "-sqrt(2)",
        value: -Math.SQRT2,
        path: ["curve", "field", "seeds", "0", "x"],
      },
      {
        name: "Seed y₂",
        text: "phi",
        value: phi,
        path: ["curve", "field", "seeds", "1", "y"],
      },
      {
        name: "Escape radius R",
        text: "2*pi",
        value: 2 * Math.PI,
        path: ["curve", "field", "escape"],
      },
    ],
  },
  {
    preset: "Cassini ovals & the lemniscate",
    cases: [
      {
        name: "Level c",
        text: "phi",
        value: phi,
        path: ["curve", "implicit", "level"],
      },
      {
        name: "Window y to",
        text: "sqrt(3)",
        value: Math.sqrt(3),
        path: ["curve", "implicit", "window", "yMax"],
      },
      {
        name: "Levels from",
        text: "1/e",
        value: 1 / Math.E,
        path: ["curve", "implicit", "family", "from"],
      },
    ],
  },
  // A derived input shows its own pole or offset distance when the
  // construction does not.
  {
    preset: "Rolling on an ellipse's pedal",
    cases: [
      {
        name: "Pole y",
        text: "sqrt(2)/10",
        value: Math.SQRT2 / 10,
        path: ["pole", "y"],
      },
    ],
  },
  {
    preset: "Ellipse & its evolute",
    setup: async (page: Page) => {
      await page
        .getByRole("button", { name: "inversion", exact: true })
        .click();
      await page
        .getByRole("combobox", { name: "Construct on" })
        .selectOption("offset");
    },
    cases: [
      {
        name: "Offset distance d",
        text: "-1/e",
        value: -1 / Math.E,
        path: ["distance"],
      },
      {
        name: "Inversion radius R",
        text: "sqrt(3)",
        value: Math.sqrt(3),
        path: ["inversion", "radius"],
      },
    ],
  },
  {
    preset: "Clifford attractor",
    setup: (page: Page) =>
      page
        .getByRole("checkbox", { name: "Fit the window to the iterates" })
        .uncheck(),
    cases: [
      {
        name: "Coefficient a",
        text: "-sqrt(2)",
        value: -Math.SQRT2,
        path: ["curve", "attractor", "a"],
      },
      {
        name: "Coefficient d",
        text: "1/phi",
        value: 1 / phi,
        path: ["curve", "attractor", "d"],
      },
      {
        name: "Start y₀",
        text: "pi/30",
        value: Math.PI / 30,
        path: ["curve", "attractor", "start", "y"],
      },
      {
        name: "Window y to",
        text: "sqrt(3)",
        value: Math.sqrt(3),
        path: ["curve", "attractor", "window", "yMax"],
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
  await examplesButton(page).click();
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
    document.querySelector<HTMLButtonElement>('[data-example="4"]')!.click();
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
  await choosePreset(page, { label: "Hypotrochoid & its evolute" });
  await settled(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(field(page, "Phase φ (radians)")).toHaveValue("0");
  await expect(field(page, "Tracing distance d")).toHaveValue("3");
});

// Spatial parameters share the same Go scalar parser as planar controls.
// The stage carries no configuration until the engine's first spatial result
// arrives, which can lag on a slow machine. Returning undefined until then
// keeps expect.poll retrying instead of failing on a thrown TypeError.
async function spatialConfig(stage: Locator) {
  const config = await stage.getAttribute("data-config");
  return config ? JSON.parse(config) : undefined;
}

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
      .poll(async () => (await spatialConfig(stage))?.[key])
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
    .poll(async () => (await spatialConfig(stage))?.length)
    .toBe(Math.PI / 2);
});

test("spatial custom domain and shape fields share the bounded scalar parser", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await choosePreset(page, "3");
  const stage = page.locator(".spatial-stage");
  for (const [name, text, key, value] of [
    ["t from", "-pi", "min", -Math.PI],
    ["to", "2*pi", "max", 2 * Math.PI],
    ["Shape parameter a", "phi", "a", phi],
  ] as const) {
    await field(page, name).fill(text);
    await expect
      .poll(async () => (await spatialConfig(stage))?.curve[key])
      .toBe(value);
    await expect(field(page, name)).toHaveValue(text);
  }
  for (const name of ["t from", "to", "Shape parameter a"]) {
    await field(page, name).fill("t");
    await expect(page.getByRole("alert")).toBeVisible();
    await field(page, name).fill(name === "t from" ? "-pi" : "pi");
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
});

test("spatial involute anchor and string lengths share the bounded scalar parser", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await choosePreset(page, "3");
  const stage = page.locator(".spatial-stage");
  await page
    .getByLabel("Construction", { exact: true })
    .selectOption("involute");
  const involute = async () => (await spatialConfig(stage))?.involute;
  // Optional chaining throughout: see spatialConfig.
  for (const [name, text, key, value] of [
    ["Anchor t₀", "pi/2", "anchor", Math.PI / 2],
    ["String length c", "-e", "offset", -Math.E],
  ] as const) {
    await field(page, name).fill(text);
    await expect.poll(async () => (await involute())?.[key]).toBe(value);
    await expect(field(page, name)).toHaveValue(text);
  }
  await page.getByRole("checkbox", { name: "Family of involutes" }).check();
  for (const [name, text, key, value] of [
    ["c from", "-phi", "from", -phi],
    ["c to", "2*pi", "to", 2 * Math.PI],
  ] as const) {
    await field(page, name).fill(text);
    await expect
      .poll(async () => (await involute())?.family?.[key])
      .toBe(value);
  }
  for (const name of ["Anchor t₀", "c from", "c to"]) {
    for (const variable of ["t", "a"]) {
      await field(page, name).fill(variable);
      await expect(page.getByRole("alert")).toBeVisible();
    }
    await field(page, name).fill("1");
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
});

for (const construction of ["tangent-foot", "orthotomic"])
  test(`spatial ${construction} pole coordinates share the bounded scalar parser`, async ({
    page,
  }) => {
    await page.goto("/?study=3d");
    await page
      .getByLabel("Construction", { exact: true })
      .selectOption(construction);
    const stage = page.locator(".spatial-stage");
    for (const [axis, expression, value] of [
      ["x", "pi/2", Math.PI / 2],
      ["y", "-e", -Math.E],
      ["z", "phi", phi],
    ] as const) {
      await field(page, `Pole ${axis}`).fill(expression);
      await expect
        .poll(async () => (await spatialConfig(stage))?.pole?.[axis])
        .toBe(value);
      await expect(field(page, `Pole ${axis}`)).toHaveValue(expression);
      for (const variable of ["t", "x", "a"]) {
        await field(page, `Pole ${axis}`).fill(variable);
        await expect(page.getByRole("alert")).toBeVisible();
      }
      await field(page, `Pole ${axis}`).fill(expression);
      await expect(page.getByRole("alert")).toHaveCount(0);
    }
  });

test("spatial involute input anchor and string share the bounded scalar parser", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await page.getByLabel("Built on", { exact: true }).selectOption("involute");
  const stage = page.locator(".spatial-stage");
  // Optional chaining throughout: see spatialConfig.
  const unwinding = async () => (await spatialConfig(stage))?.unwinding;
  for (const [name, text, key, value] of [
    ["Input anchor t₀", "pi/3", "anchor", Math.PI / 3],
    ["Input string c", "-e/2", "offset", -Math.E / 2],
  ] as const) {
    await field(page, name).fill(text);
    await expect.poll(async () => (await unwinding())?.[key]).toBe(value);
    await expect(field(page, name)).toHaveValue(text);
    for (const variable of ["t", "x", "a"]) {
      await field(page, name).fill(variable);
      await expect(page.getByRole("alert")).toBeVisible();
    }
    await field(page, name).fill(text);
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
});

test("spatial inversion center, radius and derived pole share the bounded scalar parser", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await page
    .getByLabel("Construction", { exact: true })
    .selectOption("inversion");
  await page
    .getByLabel("Curve to invert", { exact: true })
    .selectOption("orthotomic");
  const stage = page.locator(".spatial-stage");
  // Optional chaining throughout: see spatialConfig.
  const at = async (path: readonly string[]) => {
    let o: unknown = await spatialConfig(stage);
    for (const k of path) o = (o as Record<string, unknown> | undefined)?.[k];
    return o;
  };
  for (const [name, text, value, path] of [
    ["Center x", "pi/2", Math.PI / 2, ["inversion", "center", "x"]],
    ["Center y", "-e", -Math.E, ["inversion", "center", "y"]],
    ["Center z", "phi", phi, ["inversion", "center", "z"]],
    ["Sphere radius R", "e/2", Math.E / 2, ["inversion", "radius"]],
    ["Pole z", "-pi", -Math.PI, ["pole", "z"]],
  ] as const) {
    await field(page, name).fill(text);
    await expect.poll(() => at(path)).toBe(value);
    await expect(field(page, name)).toHaveValue(text);
    for (const variable of ["t", "x", "a"]) {
      await field(page, name).fill(variable);
      await expect(page.getByRole("alert")).toBeVisible();
    }
    await field(page, name).fill(text);
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
});

test("spatial harmonic center, term, and domain fields share the bounded scalar parser", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await page
    .getByLabel("Spatial definition", { exact: true })
    .selectOption("harmonic");
  const stage = page.locator(".spatial-stage");
  // Optional chaining throughout: see spatialConfig.
  const at = async (path: readonly (string | number)[]) => {
    let o: unknown = await spatialConfig(stage);
    for (const k of path) o = (o as Record<string, unknown> | undefined)?.[k];
    return o;
  };
  const term = (k: number, ...rest: string[]) => [
    "harmonic",
    "terms",
    k,
    ...rest,
  ];
  // The default harmonic trefoil keeps turning under every value below.
  for (const [name, text, value, path] of [
    ["c₀ x", "pi/2", Math.PI / 2, ["harmonic", "center", "x"]],
    ["c₀ y", "-e", -Math.E, ["harmonic", "center", "y"]],
    ["c₀ z", "phi", phi, ["harmonic", "center", "z"]],
    ["Frequency ω₁", "sqrt(2)", Math.SQRT2, term(0, "frequency")],
    ["A₁ x", "1/phi", 1 / phi, term(0, "cosine", "x")],
    ["A₁ y", "e/10", Math.E / 10, term(0, "cosine", "y")],
    ["A₁ z", "-pi/10", -Math.PI / 10, term(0, "cosine", "z")],
    ["B₁ x", "1/e", 1 / Math.E, term(0, "sine", "x")],
    ["B₁ y", "phi/2", phi / 2, term(0, "sine", "y")],
    ["B₁ z", "-1/pi", -1 / Math.PI, term(0, "sine", "z")],
    ["Frequency ω₃", "-pi", -Math.PI, term(2, "frequency")],
    ["B₃ z", "e/5", Math.E / 5, term(2, "sine", "z")],
    ["t from", "-pi", -Math.PI, ["harmonic", "min"]],
    ["to", "3*pi/2", (3 * Math.PI) / 2, ["harmonic", "max"]],
  ] as const) {
    await field(page, name).fill(text);
    await expect.poll(() => at(path)).toBe(value);
    await expect(field(page, name)).toHaveValue(text);
    for (const variable of ["t", "x", "a"]) {
      await field(page, name).fill(variable);
      await expect(page.getByRole("alert")).toBeVisible();
    }
    await field(page, name).fill(text);
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
});

test("spatial frame reference, angle, twist, width and distance share the bounded scalar parser", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await page.getByLabel("Construction", { exact: true }).selectOption("framed");
  const stage = page.locator(".spatial-stage");
  // Optional chaining throughout: see spatialConfig.
  const at = async (path: readonly string[]) => {
    let o: unknown = await spatialConfig(stage);
    for (const k of path) o = (o as Record<string, unknown> | undefined)?.[k];
    return o;
  };
  for (const [name, text, value, path] of [
    ["N₀ x", "pi/2", Math.PI / 2, ["frame", "reference", "x"]],
    ["N₀ y", "-e", -Math.E, ["frame", "reference", "y"]],
    ["N₀ z", "phi", phi, ["frame", "reference", "z"]],
    ["Angle θ₀", "-pi/3", -Math.PI / 3, ["frame", "angle"]],
    ["Twist (turns)", "e", Math.E, ["frame", "twist"]],
    ["Half-width w", "1/phi", 1 / phi, ["frame", "width"]],
    ["Offset d", "pi/5", Math.PI / 5, ["frame", "offset"]],
  ] as const) {
    await field(page, name).fill(text);
    await expect.poll(() => at(path)).toBe(value);
    await expect(field(page, name)).toHaveValue(text);
    for (const variable of ["t", "x", "a"]) {
      await field(page, name).fill(variable);
      await expect(page.getByRole("alert")).toBeVisible();
    }
    await field(page, name).fill(text);
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
});

test("spatial canal radius shares the bounded scalar parser", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await page.getByLabel("Construction", { exact: true }).selectOption("canal");
  const stage = page.locator(".spatial-stage");
  // Optional chaining throughout: see spatialConfig.
  const at = async (path: readonly string[]) => {
    let o: unknown = await spatialConfig(stage);
    for (const k of path) o = (o as Record<string, unknown> | undefined)?.[k];
    return o;
  };
  for (const [name, text, value, path] of [
    ["Tube radius R", "1/(2*phi)", 1 / (2 * phi), ["canal", "radius"]],
    ["Angle θ₀", "pi/5", Math.PI / 5, ["frame", "angle"]],
    ["N₀ y", "e", Math.E, ["frame", "reference", "y"]],
  ] as const) {
    await field(page, name).fill(text);
    await expect.poll(() => at(path)).toBe(value);
    await expect(field(page, name)).toHaveValue(text);
    for (const variable of ["t", "x", "a"]) {
      await field(page, name).fill(variable);
      await expect(page.getByRole("alert")).toBeVisible();
    }
    await field(page, name).fill(text);
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
});

test("spatial vector-field seeds, escape and time share the bounded scalar parser", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await page
    .getByLabel("Spatial definition", { exact: true })
    .selectOption("field");
  const stage = page.locator(".spatial-stage");
  // Optional chaining throughout: see spatialConfig.
  const at = async (path: readonly string[]) => {
    let o: unknown = await spatialConfig(stage);
    for (const k of path) o = (o as Record<string, unknown> | undefined)?.[k];
    return o;
  };
  for (const [name, text, value, path] of [
    ["Seed y₂", "phi/2", phi / 2, ["field", "seeds", "1", "y"]],
    ["Seed z₁", "-1/e", -1 / Math.E, ["field", "seeds", "0", "z"]],
    ["Escape radius R", "4*pi", 4 * Math.PI, ["field", "escape"]],
    ["to", "3*pi", 3 * Math.PI, ["field", "max"]],
    ["Shape parameter a", "1/phi", 1 / phi, ["field", "a"]],
  ] as const) {
    await field(page, name).fill(text);
    await expect.poll(() => at(path)).toBe(value);
    await expect(field(page, name)).toHaveValue(text);
    for (const variable of ["t", "x", "a"]) {
      await field(page, name).fill(variable);
      await expect(page.getByRole("alert")).toBeVisible();
    }
    await field(page, name).fill(text);
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
});

test("spatial pursuer starts, speeds, capture and time share the bounded scalar parser", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await page
    .getByLabel("Spatial definition", { exact: true })
    .selectOption("pursuit");
  const stage = page.locator(".spatial-stage");
  // Optional chaining throughout: see spatialConfig.
  const at = async (path: readonly string[]) => {
    let o: unknown = await spatialConfig(stage);
    for (const k of path) o = (o as Record<string, unknown> | undefined)?.[k];
    return o;
  };
  for (const [name, text, value, path] of [
    ["Start x₂", "phi/2", phi / 2, ["pursuit", "pursuers", "1", "x"]],
    ["Start y₃", "-1/e", -1 / Math.E, ["pursuit", "pursuers", "2", "y"]],
    ["Start z₁", "sqrt(2)/2", Math.SQRT1_2, ["pursuit", "pursuers", "0", "z"]],
    ["Speed v₄", "pi/3", Math.PI / 3, ["pursuit", "pursuers", "3", "speed"]],
    [
      "Capture distance ε",
      "1/(100*pi)",
      1 / (100 * Math.PI),
      ["pursuit", "capture"],
    ],
    ["to", "sqrt(3)", Math.sqrt(3), ["pursuit", "max"]],
  ] as const) {
    await field(page, name).fill(text);
    await expect.poll(() => at(path)).toBe(value);
    await expect(field(page, name)).toHaveValue(text);
    for (const variable of ["t", "x", "a"]) {
      await field(page, name).fill(variable);
      await expect(page.getByRole("alert")).toBeVisible();
    }
    await field(page, name).fill(text);
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
});

test("spatial surface shape, domain, offset and reach share the bounded scalar parser", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await page
    .getByLabel("Spatial definition", { exact: true })
    .selectOption("surface");
  const stage = page.locator(".spatial-stage");
  // Optional chaining throughout: see spatialConfig.
  const at = async (path: readonly string[]) => {
    let o: unknown = await spatialConfig(stage);
    for (const k of path) o = (o as Record<string, unknown> | undefined)?.[k];
    return o;
  };
  const fields = [
    ["Major radius R", "phi", phi, ["surface", "a"]],
    ["Minor radius r", "1/e", 1 / Math.E, ["surface", "b"]],
    ["u from", "-pi/4", -Math.PI / 4, ["surface", "uMin"]],
    ["u to", "3*pi/2", (3 * Math.PI) / 2, ["surface", "uMax"]],
    ["v from", "-pi/3", -Math.PI / 3, ["surface", "vMin"]],
    ["v to", "sqrt(2)", Math.SQRT2, ["surface", "vMax"]],
    ["Offset d", "-1/pi", -1 / Math.PI, ["surface", "offset"]],
    ["Normal reach ℓ", "-sqrt(3)", -Math.sqrt(3), ["surface", "reach"]],
  ] as const;
  const check = async (
    name: string,
    text: string,
    value: number,
    path: readonly string[],
  ) => {
    await field(page, name).fill(text);
    await expect.poll(() => at(path)).toBe(value);
    await expect(field(page, name)).toHaveValue(text);
    for (const variable of ["t", "x", "a"]) {
      await field(page, name).fill(variable);
      await expect(page.getByRole("alert")).toBeVisible();
    }
    await field(page, name).fill(text);
    await expect(page.getByRole("alert")).toHaveCount(0);
  };
  for (const [name, text, value, path] of fields)
    await check(name, text, value, path);
  // Each kind names its own shape fields.
  await page.getByLabel("Surface", { exact: true }).selectOption("ellipsoid");
  for (const [name, text, value, key] of [
    ["Axis a", "pi/2", Math.PI / 2, "a"],
    ["Axis b", "e/2", Math.E / 2, "b"],
    ["Axis c", "1/phi", 1 / phi, "c"],
  ] as const)
    await check(name, text, value, ["surface", key]);
  await page.getByLabel("Surface", { exact: true }).selectOption("paraboloid");
  for (const [name, text, value, key] of [
    ["Curvature k₁", "-pi", -Math.PI, "a"],
    ["Curvature k₂", "sqrt(5)", Math.sqrt(5), "b"],
  ] as const)
    await check(name, text, value, ["surface", key]);
  await page.getByLabel("Surface", { exact: true }).selectOption("monkey");
  await check("Height k", "-e/3", -Math.E / 3, ["surface", "a"]);
  await page.getByLabel("Surface", { exact: true }).selectOption("cylinder");
  for (const [name, text, value, key] of [
    ["Semi-axis a", "2*pi/3", (2 * Math.PI) / 3, "a"],
    ["Semi-axis b", "phi-1", phi - 1, "b"],
  ] as const)
    await check(name, text, value, ["surface", key]);
});

test("spatial mirror light, source and ray length share the bounded scalar parser", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await page
    .getByLabel("Spatial definition", { exact: true })
    .selectOption("rays");
  const stage = page.locator(".spatial-stage");
  // Optional chaining throughout: see spatialConfig.
  const at = async (path: readonly string[]) => {
    let o: unknown = await spatialConfig(stage);
    for (const k of path) o = (o as Record<string, unknown> | undefined)?.[k];
    return o;
  };
  const check = async (
    name: string,
    text: string,
    value: number,
    path: readonly string[],
  ) => {
    await field(page, name).fill(text);
    await expect.poll(() => at(path)).toBe(value);
    await expect(field(page, name)).toHaveValue(text);
    for (const variable of ["t", "x", "a"]) {
      await field(page, name).fill(variable);
      await expect(page.getByRole("alert")).toBeVisible();
    }
    await field(page, name).fill(text);
    await expect(page.getByRole("alert")).toHaveCount(0);
  };
  for (const [name, text, value, path] of [
    ["Major radius R", "phi", phi, ["surface", "a"]],
    ["u to", "3*pi/2", (3 * Math.PI) / 2, ["surface", "uMax"]],
    ["Azimuth α (°)", "180/pi", 180 / Math.PI, ["rays", "azimuth"]],
    ["Elevation β (°)", "-60-e", -60 - Math.E, ["rays", "elevation"]],
    ["Ray length ℓ", "sqrt(2)", Math.SQRT2, ["rays", "length"]],
  ] as const)
    await check(name, text, value, path);
  await page.getByLabel("Light", { exact: true }).selectOption("point");
  for (const [name, text, value, key] of [
    ["Source x", "-pi/4", -Math.PI / 4, "x"],
    ["Source y", "1/e", 1 / Math.E, "y"],
    ["Source z", "2*phi", 2 * phi, "z"],
  ] as const)
    await check(name, text, value, ["rays", "source", key]);
  // An interface's indices, and a receiver's plane, window and centre.
  await page.getByLabel("Interaction", { exact: true }).selectOption("refract");
  await page.getByLabel("Receiver", { exact: true }).selectOption("y");
  for (const [name, text, value, path] of [
    ["Index n₁", "sqrt(2)", Math.SQRT2, ["rays", "n1"]],
    ["Index n₂", "phi", phi, ["rays", "n2"]],
    ["Plane at c", "-pi", -Math.PI, ["rays", "receiver", "at"]],
    ["Window size s", "2*e", 2 * Math.E, ["rays", "receiver", "size"]],
    ["Centre z", "1/phi", 1 / phi, ["rays", "receiver", "c1"]],
    ["Centre x", "-e/2", -Math.E / 2, ["rays", "receiver", "c2"]],
  ] as const)
    await check(name, text, value, path);
});

test("spatial implicit fields share the bounded scalar parser", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await page
    .getByLabel("Spatial definition", { exact: true })
    .selectOption("implicit");
  const stage = page.locator(".spatial-stage");
  // Optional chaining throughout: see spatialConfig.
  const at = async (path: readonly string[]) => {
    let o: unknown = await spatialConfig(stage);
    for (const k of path) o = (o as Record<string, unknown> | undefined)?.[k];
    return o;
  };
  for (const [name, text, value, path] of [
    ["Level c", "e/2", Math.E / 2, ["level"]],
    ["Shape parameter a", "sqrt(3)", Math.sqrt(3), ["a"]],
    ["x from", "-pi/2", -Math.PI / 2, ["box", "xMin"]],
    ["x to", "phi", phi, ["box", "xMax"]],
    ["y from", "-e/2", -Math.E / 2, ["box", "yMin"]],
    ["y to", "sqrt(2)", Math.SQRT2, ["box", "yMax"]],
    ["z from", "-1/phi", -1 / phi, ["box", "zMin"]],
    ["z to", "e/2", Math.E / 2, ["box", "zMax"]],
    ["Normal x", "1/e", 1 / Math.E, ["sections", "normal", "x"]],
    ["Normal y", "phi", phi, ["sections", "normal", "y"]],
    ["Normal z", "pi", Math.PI, ["sections", "normal", "z"]],
    ["First offset d₀", "-1/phi", -1 / phi, ["sections", "from"]],
    ["Last offset d₁", "pi/4", Math.PI / 4, ["sections", "to"]],
  ] as const) {
    await field(page, name).fill(text);
    await expect.poll(() => at(["implicit", ...path])).toBe(value);
    await expect(field(page, name)).toHaveValue(text);
    for (const variable of ["t", "x", "a"]) {
      await field(page, name).fill(variable);
      await expect(page.getByRole("alert")).toBeVisible();
    }
    await field(page, name).fill(text);
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
});

test("spatial ruled shift and rate share the bounded scalar parser", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await page.getByLabel("Construction", { exact: true }).selectOption("ruled");
  const stage = page.locator(".spatial-stage");
  // Optional chaining throughout: see spatialConfig.
  const at = async (path: readonly string[]) => {
    let o: unknown = await spatialConfig(stage);
    for (const k of path) o = (o as Record<string, unknown> | undefined)?.[k];
    return o;
  };
  for (const [name, text, value, path] of [
    ["Shift δ", "-pi/3", -Math.PI / 3, ["ruled", "shift"]],
    ["Rate m", "phi", phi, ["ruled", "rate"]],
  ] as const) {
    await field(page, name).fill(text);
    await expect.poll(() => at(path)).toBe(value);
    await expect(field(page, name)).toHaveValue(text);
    for (const variable of ["t", "x", "a"]) {
      await field(page, name).fill(variable);
      await expect(page.getByRole("alert")).toBeVisible();
    }
    await field(page, name).fill(text);
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
});

test("tesseract parameters accept constants, reject variables, and discard stale edits", async ({
  page,
}) => {
  await page.goto("/?study=4d");
  const stage = page.locator(".tesseract-stage");
  const settle = () => expect(stage).toHaveAttribute("aria-busy", "false");
  await settle();
  for (const name of ["xy", "xz", "yz", "xw", "yw", "zw"]) {
    await page
      .getByRole("textbox", { name: `${name} angle`, exact: true })
      .fill("pi/4");
  }
  await page
    .getByRole("textbox", { name: "4D eye distance", exact: true })
    .fill("2*e");
  await settle();
  let q = JSON.parse((await stage.getAttribute("data-config"))!);
  expect(q.angles).toEqual(Array(6).fill(Math.PI / 4));
  expect(q.distance).toBe(2 * Math.E);
  await page
    .getByRole("combobox", { name: "View of the tesseract" })
    .selectOption("stereo");
  await page
    .getByRole("textbox", { name: "Projection window radius" })
    .fill("2*phi");
  await settle();
  q = JSON.parse((await stage.getAttribute("data-config"))!);
  expect(q.clip).toBe(2 * phi);
  await page
    .getByRole("combobox", { name: "View of the tesseract" })
    .selectOption("section");
  await page.getByRole("textbox", { name: "Slice offset h" }).fill("1/phi");
  await page.getByRole("textbox", { name: "Section spread" }).fill("pi");
  await settle();
  q = JSON.parse((await stage.getAttribute("data-config"))!);
  expect(q.slice).toBe(1 / phi);
  expect(q.spread).toBe(Math.PI);
  for (const bad of ["t", "x", "a", "1/0"]) {
    await page.getByRole("textbox", { name: "Slice offset h" }).fill(bad);
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Export image" }),
    ).toBeDisabled();
  }
  await page.getByRole("textbox", { name: "Slice offset h" }).fill("pi/8");
  await choosePreset(page, { label: "A cube beyond a cube" });
  await settle();
  q = JSON.parse((await stage.getAttribute("data-config"))!);
  expect(q.slice).toBe(0);
  expect(q.angles).toEqual([0, 0, 0, 0, 0, 0]);
});

test("curved 4D radii share scalar parsing and invalidate superseded definitions", async ({
  page,
}) => {
  await page.goto("/?study=4d");
  const stage = page.locator(".tesseract-stage");
  const settle = () => expect(stage).toHaveAttribute("aria-busy", "false");
  await settle();
  await choosePreset(page, { label: "A ring in passing" });
  await page
    .getByRole("textbox", { name: "Core radius R", exact: true })
    .fill("phi");
  await page
    .getByRole("textbox", { name: "Tube radius r", exact: true })
    .fill("pi/8");
  await page
    .getByRole("textbox", { name: "Slice offset h", exact: true })
    .fill("1/e");
  await page
    .getByRole("textbox", { name: "Section spread", exact: true })
    .fill("phi/4");
  await settle();
  let q = JSON.parse((await stage.getAttribute("data-config"))!);
  expect(q.radius).toBe(phi);
  expect(q.tube).toBe(Math.PI / 8);
  expect(q.slice).toBe(1 / Math.E);
  expect(q.spread).toBe(phi / 4);
  for (const name of ["Core radius R", "Tube radius r"]) {
    for (const bad of ["t", "x", "a", "1/0"]) {
      await page.getByRole("textbox", { name, exact: true }).fill(bad);
      await expect(page.getByRole("alert")).toBeVisible();
    }
    await page
      .getByRole("textbox", { name, exact: true })
      .fill(name === "Core radius R" ? "phi" : "pi/8");
  }
  await page
    .getByRole("textbox", { name: "Core radius R", exact: true })
    .fill("e");
  await choosePreset(page, { label: "A sphere in passing" });
  await page
    .getByRole("textbox", { name: "4-ball radius R", exact: true })
    .fill("2*phi");
  await settle();
  q = JSON.parse((await stage.getAttribute("data-config"))!);
  expect(q.object).toBe("ball");
  expect(q.radius).toBe(2 * phi);
  await page
    .getByRole("textbox", { name: "4-ball radius R", exact: true })
    .fill("a");
  await expect(page.getByRole("alert")).toBeVisible();
  await choosePreset(page, { label: "A sphere in passing" });
  await settle();
  expect(JSON.parse((await stage.getAttribute("data-config"))!).radius).toBe(2);
});

test("every localized lift geometric field accepts constants and rejects variables", async ({
  page,
}) => {
  await page.goto("/?study=4d");
  const stage = page.locator(".tesseract-stage");
  const settle = () => expect(stage).toHaveAttribute("aria-busy", "false");
  await settle();
  await choosePreset(page, { label: "The missing middle" });
  await settle();
  await page
    .getByRole("combobox", { name: "View operation", exact: true })
    .selectOption("lifted");
  await settle();
  await page.getByText("Lift motion endpoints", { exact: true }).click();
  const fields: [string, string, string, number?][] = [
    ["Lift center x", "phi", "center", 0],
    ["Lift center y", "-1/e", "center", 1],
    ["Lift center z", "pi/8", "center", 2],
    ["Lift support radius L", "pi/2", "support"],
    ["Lift height A", "1/e", "height"],
    ["Presentation xw angle", "pi/6", "angle"],
    ["Drift start x", "-pi", "from", 0],
    ["Drift start y", "1/e", "from", 1],
    ["Drift start z", "phi/4", "from", 2],
    ["Drift end x", "pi", "to", 0],
    ["Drift end y", "-1/e", "to", 1],
    ["Drift end z", "-phi/4", "to", 2],
    ["Support start", "1/e", "radiusFrom"],
    ["Support end", "phi", "radiusTo"],
  ];
  const expected = [
    phi,
    -1 / Math.E,
    Math.PI / 8,
    Math.PI / 2,
    1 / Math.E,
    Math.PI / 6,
    -Math.PI,
    1 / Math.E,
    phi / 4,
    Math.PI,
    -1 / Math.E,
    -phi / 4,
    1 / Math.E,
    phi,
  ];
  for (const [i, [name, expression, key, index]] of fields.entries()) {
    const input = page.getByRole("textbox", { name, exact: true });
    await input.fill(expression);
    await settle();
    const l = JSON.parse((await stage.getAttribute("data-config"))!).lift;
    expect(index === undefined ? l[key] : l[key][index]).toBe(expected[i]);
    for (const bad of ["t", "x", "a", "1/0"]) {
      await input.fill(bad);
      await expect(page.getByRole("alert")).toBeVisible();
    }
    await input.fill(expression);
    await settle();
  }
  await page
    .getByRole("textbox", { name: "Lift height A", exact: true })
    .fill("pi");
  await choosePreset(page, { label: "The missing middle" });
  await settle();
  expect(
    JSON.parse((await stage.getAttribute("data-config"))!).lift.height,
  ).toBe(0.32);
});

test("every shell bypass geometric field shares scalar parsing and supersedes stale edits", async ({
  page,
}) => {
  await page.goto("/?study=4d");
  const stage = page.locator(".tesseract-stage");
  const settle = () => expect(stage).toHaveAttribute("aria-busy", "false");
  await settle();
  await choosePreset(page, { label: "Beside the wall" });
  await settle();
  const fields: [string, string, string, number, number?][] = [
    ["Inner radius a", "1/phi", "inner", 1 / phi],
    ["Outer radius b", "phi", "outer", phi],
    ["Fourth-coordinate extent ε", "1/e", "extent", 1 / Math.E],
    ["Route height H", "pi", "height", Math.PI],
    ["Outside point x", "pi", "outside", Math.PI, 0],
    ["Outside point y", "phi", "outside", phi, 1],
    ["Outside point z", "e", "outside", Math.E, 2],
    ["Route position s", "1/phi", "position", 1 / phi],
    ["First comparison w", "pi", "w1", Math.PI],
    ["Second comparison w", "-e", "w2", -Math.E],
  ];
  for (const [name, expression, key, value, index] of fields) {
    const input = page.getByRole("textbox", { name, exact: true });
    await input.fill(expression);
    await settle();
    const q = JSON.parse((await stage.getAttribute("data-config"))!).bypass;
    expect(index === undefined ? q[key] : q[key][index]).toBe(value);
    for (const bad of ["t", "x", "a", "1/0"]) {
      await input.fill(bad);
      await expect(page.getByRole("alert")).toBeVisible();
    }
    await input.fill(expression);
    await settle();
  }
  await page
    .getByRole("textbox", { name: "Route height H", exact: true })
    .fill("phi");
  await choosePreset(page, { label: "Beside the wall" });
  await settle();
  expect(
    JSON.parse((await stage.getAttribute("data-config"))!).bypass.height,
  ).toBe(1.2);
});

test("every spherical weave geometric field shares scalar parsing and supersedes stale edits", async ({
  page,
}) => {
  await page.goto("/?study=4d");
  const stage = page.locator(".tesseract-stage");
  const settle = () => expect(stage).toHaveAttribute("aria-busy", "false");
  await settle();
  await choosePreset(page, { label: "Tori between two circles" });
  await settle();
  await page.getByText("Latitude motion endpoints", { exact: true }).click();
  const config = async () =>
    JSON.parse((await stage.getAttribute("data-config"))!);
  const fields: [string, string, (c: any) => number, number][] = [
    [
      "Central latitude α",
      "pi/4 + 1/e/10",
      (c) => c.weave.alpha,
      Math.PI / 4 + 1 / Math.E / 10,
    ],
    ["Latitude spread", "1/phi", (c) => c.weave.spread, 1 / phi],
    ["Latitude start", "pi/6", (c) => c.weave.alphaFrom, Math.PI / 6],
    ["Latitude end", "pi/3", (c) => c.weave.alphaTo, Math.PI / 3],
    ["Projection window radius", "e", (c) => c.clip, Math.E],
    ["xw angle", "pi/5", (c) => c.angles[3], Math.PI / 5],
  ];
  for (const [name, expression, read, value] of fields) {
    const input = page.getByRole("textbox", { name, exact: true });
    await input.fill(expression);
    await settle();
    expect(read(await config())).toBe(value);
    for (const bad of ["t", "x", "a", "1/0"]) {
      await input.fill(bad);
      await expect(page.getByRole("alert")).toBeVisible();
    }
    await input.fill(expression);
    await settle();
  }
  await page
    .getByRole("textbox", { name: "Central latitude α", exact: true })
    .fill("pi/3");
  await choosePreset(page, { label: "Tori between two circles" });
  await settle();
  expect((await config()).weave.alpha).toBe(Math.PI / 4);
});

test("the cut plane's normal and offset share the bounded scalar parser", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await expect(page.locator("#spatial-artwork")).toBeVisible();
  const cut = page.getByRole("group", { name: "Cut away" });
  await cut.getByRole("checkbox", { name: "Cut with a plane" }).check();
  const drawn = async () => {
    const value = await page
      .locator("#spatial-artwork")
      .getAttribute("data-cut");
    return value ? JSON.parse(value).plane : undefined;
  };
  for (const [name, text] of [
    ["Normal x", "phi"],
    ["Normal y", "e"],
    ["Normal z", "-pi"],
    ["Offset d", "pi/4"],
  ] as const) {
    await field(page, name).fill(text);
    await expect(field(page, name)).toHaveValue(text);
  }
  // Only the normal's direction counts.
  const length = Math.hypot(phi, Math.E, Math.PI);
  await expect.poll(drawn).toEqual({
    normal: { x: phi / length, y: Math.E / length, z: -Math.PI / length },
    offset: Math.PI / 4,
  });
  for (const name of ["Normal x", "Normal y", "Normal z", "Offset d"]) {
    for (const variable of ["t", "x", "a"]) {
      await field(page, name).fill(variable);
      await expect(page.getByRole("alert").first()).toContainText(
        `Cut ${name.toLowerCase()}`,
      );
    }
    await field(page, name).fill(name === "Offset d" ? "-1/phi" : "1");
    await expect(page.getByRole("alert")).toHaveCount(0);
  }
  await expect.poll(async () => (await drawn())?.offset).toBe(-1 / phi);
});

test("the see-through opacity shares the bounded scalar parser", async ({
  page,
}) => {
  await page.goto("/?study=3d");
  await expect(page.locator("#spatial-artwork")).toBeVisible();
  const box = page.getByRole("group", { name: "See through" });
  await box.getByLabel("Sheets", { exact: true }).selectOption("through");
  const drawn = async () => {
    const value = await page
      .locator("#spatial-artwork")
      .getAttribute("data-sight");
    return value ? JSON.parse(value).opacity : undefined;
  };
  await field(page, "Opacity α").fill("1/phi^3");
  await expect.poll(drawn).toBe(1 / phi ** 3);
  for (const variable of ["t", "x", "a"]) {
    await field(page, "Opacity α").fill(variable);
    await expect(page.getByRole("alert").first()).toContainText(
      "Sheet opacity α",
    );
  }
  await field(page, "Opacity α").fill("pi/10");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect.poll(drawn).toBe(Math.PI / 10);
});
