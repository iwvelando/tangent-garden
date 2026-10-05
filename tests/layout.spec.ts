import { test, expect, type Page } from "@playwright/test";
import { chooseNotebook, choosePreset, exampleTitles } from "./helpers";

const closing = "An open notebook for mathematical beauty.";

test("phones show the drawing, then the controls, then the explanation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  const top = async (selector: string) =>
    (await page.locator(selector).first().boundingBox())!.y;
  const plot = await top(".plot-wrap");
  const controls = await top("aside");
  const behind = await top(".explanation");
  const note = await top(".bottom-note");
  const last = await top(".closing");
  expect(plot).toBeLessThan(controls);
  expect(controls).toBeLessThan(behind);
  expect(behind).toBeLessThan(note);
  expect(note).toBeLessThan(last);
  await expect(page.getByText(closing, { exact: true })).toBeVisible();
  // The closing line ends the page.
  const bottom = await page.evaluate(() => document.body.scrollHeight);
  const box = (await page.locator(".closing").boundingBox())!;
  expect(bottom - (box.y + box.height)).toBeLessThan(80);
  await expect(page.getByText(/Computed entirely in your browser/)).toHaveCount(
    0,
  );
});

test("wide screens keep the explanation and closing line under the drawing", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  const article = page.locator("article");
  await expect(article.getByText("BEHIND THE LINES")).toBeVisible();
  await expect(article.getByText(closing, { exact: true })).toBeAttached();
  await expect(page.getByRole("complementary").getByText(closing)).toHaveCount(
    0,
  );
  await expect(page.getByText(/Computed entirely in your browser/)).toHaveCount(
    0,
  );
});

test("the explanation follows the layout when the window is resized", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("article .explanation")).toHaveCount(0);
  await expect(page.locator(".explanation")).toHaveCount(1);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator("article .explanation")).toHaveCount(1);
});

// Opening a field's help pushes down only what lies below it: the field
// beside it in a pair keeps its place, and paired controls stay level even
// when one label wraps. Every preset, both widths, and polar source
// coordinates cover every pair with help. Each notebook is its own test, so
// that the sweep's time grows per notebook as presets are added.
type Setup = () => Promise<unknown>;
const pairSetups: Record<string, (page: Page) => Promise<Setup[]>> = {
  "2D": async (page) => {
    await page.goto("/");
    await expect(page.locator("#artwork")).toBeVisible();
    const labels = await exampleTitles(page);
    // Each study's own pairs appear once it settles; sweeping before then
    // would find them mounting under it.
    const settled = () =>
      expect(page.locator(".plot-wrap")).toHaveAttribute("aria-busy", "false");
    const setups: Setup[] = labels.map((label) => async () => {
      await choosePreset(page, { label });
      await settled();
    });
    setups.push(async () => {
      await choosePreset(page, { label: "Light inside a circle" });
      await page
        .getByRole("combobox", { name: "Source coordinates" })
        .selectOption("polar");
      await settled();
    });
    // An iterated map's window appears only when it is not fitted.
    setups.push(async () => {
      await choosePreset(page, { label: "Clifford attractor" });
      await page
        .getByRole("checkbox", { name: "Fit the window to the iterates" })
        .uncheck();
      await settled();
    });
    return setups;
  },
  "3D": async (page) => {
    const setups: Setup[] = [];
    for (const preset of [
      "0",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "11",
      "12",
      "15",
      "17",
      "18",
      "19",
      "21",
      "24",
      "29",
      "30",
      "32",
      "35",
      "37",
      "39",
      "40",
      "43",
    ])
      setups.push(async () => {
        await page.goto("/?study=3d");
        await choosePreset(page, preset);
        if (
          (await page
            .locator("#spatial-animation-section")
            .getAttribute("open")) === null
        )
          await page.locator("#spatial-animation-section > summary").click();
        await page
          .getByLabel("Animate", { exact: true })
          .selectOption("parameters");
      });
    // The surface probe's sliders pair only while it is on: a canal's, a
    // patch's, and a tangent developable's, framed ribbon's and ruled
    // surface's.
    for (const [preset, describes] of [
      ["Beads that lose their envelope", true],
      ["A torus revealing its centers", false],
      ["Helix · a ribbon staircase", true],
      ["The seam of a carried frame", true],
      ["Chords of a rising helix", true],
    ] as const)
      setups.push(async () => {
        await page.goto("/?study=3d");
        await choosePreset(page, { label: preset });
        if (describes)
          await page
            .getByLabel("Describe", { exact: true })
            .selectOption("surface");
        await page
          .getByRole("checkbox", {
            name: "Principal curvatures & centres at a point",
          })
          .check();
        await expect(page.locator(".spatial-probe .pair")).toBeVisible();
      });
    // On a mirror or interface, the light's and the mirror's.
    for (const [preset, target, name] of [
      [
        "A spherical bowl's cusped caustic",
        "light",
        "Wavefront, foci & rays at a point",
      ],
      [
        "A lamp in water over air",
        "mirror",
        "Principal curvatures & centres at a point",
      ],
    ] as const)
      setups.push(async () => {
        await page.goto("/?study=3d");
        await choosePreset(page, { label: preset });
        await page.getByLabel("Describe", { exact: true }).selectOption(target);
        await page.getByRole("checkbox", { name }).check();
        await expect(page.locator(".spatial-probe .pair")).toBeVisible();
      });
    // The involute input's anchor and string pair only while a
    // construction is built on it.
    setups.push(async () => {
      await page.goto("/?study=3d");
      await choosePreset(page, { label: "A trefoil's string, unwound" });
      await expect(
        page.getByRole("textbox", { name: "Input string c", exact: true }),
      ).toBeVisible();
    });
    // The cut's fields pair only while it is on, on a curve and a surface;
    // its refusal must not move them either.
    for (const preset of [
      "Trefoil · (2, 3)",
      "An ellipsoid hiding its centers",
    ])
      setups.push(async () => {
        await page.goto("/?study=3d");
        await choosePreset(page, { label: preset });
        await page.getByRole("checkbox", { name: "Cut with a plane" }).check();
        await expect(page.locator(".spatial-cut .pair").first()).toBeVisible();
      });
    // A camera path's views pair their names and turns, here the preset's
    // seven, with its turns refused.
    setups.push(async () => {
      await page.goto("/?study=3d");
      await choosePreset(page, { label: "Viviani's curve, from every side" });
      await page.getByLabel("View 6 turns", { exact: true }).fill("1.5");
      await page.getByRole("button", { name: "Play animation" }).click();
      await expect(page.locator(".animation-error")).toBeVisible();
      await expect(page.locator(".path-view .pair").first()).toBeVisible();
    });
    // Flown while the geometry moves, the views stand under the animation
    // camera, after the preset's parameter track.
    setups.push(async () => {
      await page.goto("/?study=3d");
      await choosePreset(page, { label: "A helix's string, always level" });
      await expect(
        page.getByLabel("Animation camera", { exact: true }),
      ).toHaveValue("path");
      await expect(page.locator(".path-view .pair").first()).toBeVisible();
    });
    // Riding a ray pairs its crossing and its distances under the camera.
    setups.push(async () => {
      await page.goto("/?study=3d");
      await choosePreset(page, { label: "Riding a ray through coma" });
      await expect(
        page.getByLabel("Animation camera", { exact: true }),
      ).toHaveValue("ride");
      await expect(
        page.getByLabel("Turn window", { exact: true }),
      ).toBeVisible();
    });
    return setups;
  },
  "4D": async (page) => {
    const setups: Setup[] = [];
    for (const preset of [
      "A cube beyond a cube",
      "Spherical loom",
      "An octahedron within",
      "Section garden",
      "A sphere in passing",
      "A ring in passing",
      "The missing middle",
      "Beside the wall",
      "Rings from a sphere",
      "Tori between two circles",
    ])
      setups.push(async () => {
        await page.goto("/?study=4d");
        await choosePreset(page, { label: preset });
      });
    setups.push(async () => {
      await page.goto("/?study=4d");
      await choosePreset(page, { label: "The missing middle" });
      await page
        .getByRole("combobox", { name: "View operation", exact: true })
        .selectOption("lifted");
      await page.getByText("Lift motion endpoints", { exact: true }).click();
    });
    setups.push(async () => {
      await page.goto("/?study=4d");
      await choosePreset(page, { label: "Tori between two circles" });
      await page
        .getByText("Latitude motion endpoints", { exact: true })
        .click();
    });
    return setups;
  },
};

// Opens every help toggle of every visible pair after each setup and
// returns how many it opened.
async function sweepPairs(page: Page, setups: Setup[]) {
  let checked = 0;
  for (const setup of setups) {
    await setup();
    for (const pair of await page.locator("aside .pair").all()) {
      if (!(await pair.isVisible())) continue;
      const controls = pair.locator(":scope > .field > :is(input, select)");
      const boxes = async () =>
        (await controls.evaluateAll((els) =>
          els.map((e) => {
            // Relative to the pair, since clicking may scroll the sidebar.
            const r = e.getBoundingClientRect();
            const p = e.closest(".pair")!.getBoundingClientRect();
            return [Math.round(r.x - p.x), Math.round(r.y - p.y)];
          }),
        )) as [number, number][];
      const before = await boxes();
      // Controls sharing a row are level.
      for (const [x, y] of before)
        for (const [x2, y2] of before)
          if (x !== x2 && Math.abs(y - y2) < 30) expect(y2).toBe(y);
      for (const toggle of await pair.locator(".help-toggle").all()) {
        await toggle.click();
        await expect(
          page.locator(`#${await toggle.getAttribute("aria-controls")}`),
        ).toBeVisible();
        expect(await boxes()).toEqual(before);
        await toggle.click();
        checked++;
      }
    }
  }
  return checked;
}

for (const width of [1440, 390])
  for (const [notebook, setups] of Object.entries(pairSetups))
    test(`help text in paired fields moves neither neighbour at ${width}px in ${notebook}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      const list = await setups(page);
      // The sweep grows with every example; a fixed limit runs out as the
      // gallery grows. About a second a setup locally, so three is ample.
      test.setTimeout(60_000 + 3_000 * list.length);
      // Guard against a sweep that silently finds nothing.
      expect(await sweepPairs(page, list)).toBeGreaterThanOrEqual(3);
    });

for (const width of [1440, 390]) {
  test(`construction tabs fill every row, with no gap, at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const group = page.getByRole("group", { name: "Construction" });
    const whole = (await group.boundingBox())!;
    const boxes = await group
      .getByRole("button")
      .evaluateAll((all) => all.map((b) => b.getBoundingClientRect().toJSON()));
    const rows = new Map<number, { left: number; right: number }[]>();
    for (const b of boxes) {
      const y = Math.round(b.top);
      rows.set(y, [...(rows.get(y) ?? []), { left: b.left, right: b.right }]);
    }
    expect(rows.size).toBeGreaterThan(1);
    for (const row of rows.values()) {
      expect(row[0].left).toBeCloseTo(whole.x, 0);
      expect(row.at(-1)!.right).toBeCloseTo(whole.x + whole.width, 0);
      // Tabs in one row share its width equally.
      const widths = row.map((b) => b.right - b.left);
      expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1);
    }
  });
}

test("every header control is the same height in every notebook", async ({
  page,
}) => {
  const heights = async () =>
    page
      .locator(".app:visible header button:visible")
      .evaluateAll((buttons) =>
        buttons.map((b) => [
          b.textContent?.trim(),
          b.getBoundingClientRect().height,
        ]),
      );
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.locator("#artwork")).toBeVisible();
    // A fixed theme shows Follow system beside the toggle.
    await page
      .locator(".app:visible header button[aria-label*='background']")
      .click();
    for (const dimension of ["2d", "3d", "4d"] as const) {
      if (dimension !== "2d") await chooseNotebook(page, dimension);
      await expect(
        page.locator(".app:visible header .system-theme"),
      ).toBeVisible();
      const found = await heights();
      expect(found.length, `${dimension} at ${width}px`).toBeGreaterThanOrEqual(
        4,
      );
      const first = found[0][1] as number;
      for (const [name, height] of found)
        expect(
          Math.abs((height as number) - first),
          `${name} in ${dimension} at ${width}px: ${JSON.stringify(found)}`,
        ).toBeLessThan(0.5);
    }
  }
});

const artworks = {
  "2d": "#artwork",
  "3d": "#spatial-artwork",
  "4d": "#tesseract-artwork",
} as const;

// Switching notebooks keeps the study's label, dimension picker and examples
// where the reader left them.
test("every notebook starts its controls at the same height on a desktop", async ({
  page,
}) => {
  await page.goto("/");
  let first: number[] | undefined;
  for (const dimension of ["2d", "3d", "4d"] as const) {
    if (dimension !== "2d") await chooseNotebook(page, dimension);
    await expect(page.locator(artworks[dimension])).toBeVisible();
    const aside = page.locator(".app:visible aside");
    const top = (await aside.boundingBox())!.y;
    const offsets = [
      (await aside.locator(".section-label").first().boundingBox())!.y - top,
      (await aside.locator(".notebook-mode").boundingBox())!.y - top,
      (await aside.locator(".example-picker").boundingBox())!.y - top,
    ];
    if (!first) first = offsets;
    else
      offsets.forEach((y, i) =>
        expect(Math.abs(y - first![i]), dimension).toBeLessThan(1),
      );
    // Nothing rules off the study above its label.
    expect(
      await aside
        .locator(".section-label")
        .first()
        .evaluate((label) => {
          for (
            let e = label.parentElement;
            e && e.tagName !== "ASIDE";
            e = e.parentElement
          )
            if (parseFloat(getComputedStyle(e).borderTopWidth) > 0) return true;
          return false;
        }),
      dimension,
    ).toBe(false);
  }
});

test("section headings and their rules stand apart from field labels in every notebook and theme", async ({
  page,
}) => {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/");
    for (const dimension of ["2d", "3d", "4d"] as const) {
      if (dimension !== "2d") await chooseNotebook(page, dimension);
      await expect(page.locator(artworks[dimension])).toBeVisible();
      const aside = page.locator(".app:visible aside");
      const style = await aside.evaluate((a) => {
        const color = (e: Element | null) => e && getComputedStyle(e).color;
        const section = a.querySelector("section");
        return {
          labels: [...a.querySelectorAll(".section-label")].map(color),
          field: color(a.querySelector(".field-label")),
          rule: section && getComputedStyle(section).borderTopColor,
          plain: getComputedStyle(a).borderRightColor,
        };
      });
      const where = `${dimension} ${scheme}`;
      expect(style.labels.length, where).toBeGreaterThan(1);
      expect(new Set(style.labels).size, where).toBe(1);
      expect(style.labels[0], where).not.toBe(style.field);
      // The rule above a section takes the heading's hue, not the border's.
      expect(style.rule, where).not.toBe(style.plain);
    }
  }
});

// A 3D subsection that opens with a field starts as close under its heading
// as one that opens with a checkbox.
test("3D subsections open the same distance under their headings", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await chooseNotebook(page, "3d");
  await expect(page.locator(artworks["3d"])).toBeVisible();
  const gaps = await page
    .locator(".spatial-layers, .spatial-cut, .spatial-sight, .spatial-probe")
    .evaluateAll((sets) =>
      sets.map((set) => {
        const legend = set.querySelector("legend")!.getBoundingClientRect();
        const first = set
          .querySelector("legend ~ div label, legend ~ label")!
          .getBoundingClientRect();
        return [
          set.querySelector("legend")!.textContent,
          first.top - legend.bottom,
        ];
      }),
    );
  expect(gaps.map(([name]) => name)).toEqual(
    expect.arrayContaining(["Lines", "See through", "Cut away"]),
  );
  const reference = gaps[0][1] as number;
  for (const [name, gap] of gaps)
    expect(Math.abs((gap as number) - reference), String(name)).toBeLessThan(2);
});

// On phones every notebook puts its view buttons on their own row, under the
// title and aligned with it, then the drawing, then the controls with the
// examples, and only then the explanation.
test("phones order every notebook's heading, drawing, controls and explanation alike", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  for (const dimension of ["2d", "3d", "4d"] as const) {
    if (dimension !== "2d") await chooseNotebook(page, dimension);
    const drawing = page.locator(artworks[dimension]);
    await expect(drawing).toBeVisible();
    const app = page.locator(".app:visible");
    const title = (await app.locator(".plot-heading h1").boundingBox())!;
    const buttons = await app
      .locator(".plot-heading :is(button, select):visible")
      .evaluateAll((es) => es.map((e) => e.getBoundingClientRect().toJSON()));
    expect(buttons.length, dimension).toBeGreaterThan(0);
    expect(buttons[0].y, dimension).toBeGreaterThan(title.y + title.height);
    expect(Math.abs(buttons[0].x - title.x), dimension).toBeLessThan(1);
    // One row: the 3D projection sits beside the buttons, not above them.
    for (const b of buttons)
      expect(
        Math.abs(b.y + b.height / 2 - (buttons[0].y + buttons[0].height / 2)),
        dimension,
      ).toBeLessThan(1);
    const top = async (selector: string) =>
      (await app.locator(selector).first().boundingBox())!.y;
    const picture = (await drawing.boundingBox())!;
    const controls = await top("aside");
    const examples = await top(".example-picker");
    const explanation = await top(
      dimension === "4d" ? ".tesseract-explanation" : ".explanation",
    );
    expect(buttons[0].y + buttons[0].height, dimension).toBeLessThan(picture.y);
    expect(picture.y + picture.height, dimension).toBeLessThan(controls);
    expect(examples, dimension).toBeLessThan(explanation);
    expect(controls, dimension).toBeLessThan(explanation);
  }
});

// The drawing keeps one frame across notebooks, so switching dimension never
// moves the drawing's edges or the legend under it.
for (const [width, height] of [
  [1440, 900],
  [390, 844],
] as const) {
  test(`every notebook's drawing has the same frame at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    let first: number[] | undefined;
    for (const dimension of ["2d", "3d", "4d"] as const) {
      if (dimension !== "2d") await chooseNotebook(page, dimension);
      await expect(page.locator(artworks[dimension])).toBeVisible();
      const frame = await page
        .locator(".app:visible .plot-wrap")
        .evaluate((e) => {
          const box = e.getBoundingClientRect();
          // Measured from the page's top, wherever it is scrolled.
          return [box.top + scrollY, box.bottom + scrollY];
        });
      // On phones the headings above differ in length; the height must not.
      const shape =
        width > 700 ? frame : [frame[1] - frame[0], frame[1] - frame[0]];
      if (!first) first = shape;
      else
        shape.forEach((y, i) =>
          expect(
            Math.abs(y - first![i]),
            `${dimension}: ${shape}`,
          ).toBeLessThan(1),
        );
    }
  });
}

// A field's label, its help toggle and any value at the end of its row
// share one line, in the probe panel as everywhere else: its checkbox's
// own label styles must not reach the fields beside it.
for (const label of [
  "Helix · a ribbon staircase",
  "A sphere collapsing to one focus",
])
  test(`probe fields keep their labels on their help toggles' line · ${label}`, async ({
    page,
  }) => {
    await page.goto("/?study=3d");
    await expect(page.locator(".spatial-stage")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await choosePreset(page, { label });
    const probe = page.locator(".spatial-probe");
    await probe.locator(".probe-switch input[type=checkbox]").check();
    await expect(page.locator(".spatial-stage")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(probe.locator("input[type=range]").first()).toBeVisible();
    const rows = await probe.locator(".field-label").evaluateAll((rows) =>
      rows.map((row) => {
        const middle = (e: Element) => {
          const r = e.getBoundingClientRect();
          return r.top + r.height / 2;
        };
        const text = row.querySelector("label")!;
        return {
          label: text.textContent,
          font: getComputedStyle(text).fontSize,
          offsets: [...row.children]
            .filter((e) => e !== text)
            .map((e) => Math.abs(middle(e) - middle(text))),
        };
      }),
    );
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      // The sidebar's field labels are 13px, as in every other panel.
      expect(row, row.label!).toMatchObject({ font: "13px" });
      for (const offset of row.offsets)
        expect(offset, row.label!).toBeLessThan(1.5);
    }
  });
