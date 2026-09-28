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
