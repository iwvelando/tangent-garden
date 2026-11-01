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
        // A preset replaces the whole study, so these share one page: each
        // reload restarts the 3D notebook, about a second locally and three
        // on CI's software WebGL.
        if (!page.url().includes("study=3d")) await page.goto("/?study=3d");
        await choosePreset(page, preset);
        // Its pairs mount as it settles; sweeping before then would find
        // the previous study's.
        await expect(page.locator(".spatial-stage")).toHaveAttribute(
          "aria-busy",
          "false",
        );
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
      // Already on a focal sheet, whose status words are its own.
      ["The curvature of an ellipsoid's focal sheet", false],
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
            name: "Principal curvatures & centers at a point",
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
        "Principal curvatures & centers at a point",
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
    // So does the coil input's radius and angle.
    setups.push(async () => {
      await page.goto("/?study=3d");
      await choosePreset(page, { label: "A coiled cord round a trefoil" });
      await expect(
        page.getByRole("textbox", { name: "Coil angle θ₀", exact: true }),
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
    // Other planes pair their offsets, and with them comes the choice of
    // side: here the corner preset's three planes.
    setups.push(async () => {
      await page.goto("/?study=3d");
      await choosePreset(page, {
        label: "An ellipsoid with a corner cut away",
      });
      await expect(
        page.getByRole("group", { name: "Plane 3" }).locator(".pair").first(),
      ).toBeVisible();
    });
    // A camera path's views pair their turns and leg times under their
    // names, here the preset's seven, with its turns refused.
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

// Opens every help toggle of every visible pair after each setup, and its
// Show more, and returns how many it opened.
async function sweepPairs(page: Page, setups: Setup[], scope = "aside") {
  let checked = 0;
  for (const setup of setups) {
    await setup();
    for (const pair of await page.locator(`${scope} .pair`).all()) {
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
        const help = page.locator(
          `#${await toggle.getAttribute("aria-controls")}`,
        );
        await expect(help).toBeVisible();
        expect(await boxes()).toEqual(before);
        // A help's Show more opens below both controls too.
        const more = help.locator(".help-more");
        if (await more.count()) {
          await more.click();
          await expect(help.locator(".hint-more")).toBeVisible();
          expect(await boxes()).toEqual(before);
        }
        await toggle.click();
        checked++;
      }
    }
  }
  return checked;
}

for (const width of [1440, 390])
  for (const [notebook, setups] of Object.entries(pairSetups))
    test(`help text in paired fields moves neither neighbor at ${width}px in ${notebook}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      const list = await setups(page);
      // The sweep grows with every example; a fixed limit runs out as the
      // gallery grows. A setup and its sweep take up to about two and a half
      // seconds locally and four and a half on CI, whose software WebGL
      // makes each reload of the 3D notebook slow, so six is ample.
      test.setTimeout(60_000 + 6_000 * list.length);
      // Guard against a sweep that silently finds nothing.
      expect(await sweepPairs(page, list)).toBeGreaterThanOrEqual(3);
    });

for (const width of [1440, 390]) {
  test(`construction tabs fill every row, with no gap, at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const group = page.getByRole("group", {
      name: "Construction",
      exact: true,
    });
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
  // A subsection that opens with a switch, whose help toggle makes its row
  // taller than a plain checkbox label, puts its checkbox where the layer
  // list puts its first one. Fonts differ by platform, hence within 1px.
  const boxes = await page
    .locator(".spatial-layers, .spatial-cut")
    .evaluateAll((sets) =>
      sets.map((set) => {
        const legend = set.querySelector("legend")!.getBoundingClientRect();
        const box = set
          .querySelector(
            "legend ~ div input[type=checkbox], legend ~ label input[type=checkbox]",
          )!
          .getBoundingClientRect();
        return [
          set.querySelector("legend")!.textContent,
          box.top - legend.bottom,
        ];
      }),
    );
  expect(boxes.map(([name]) => name)).toContain("Cut away");
  for (const [name, gap] of boxes)
    expect(
      Math.abs((gap as number) - (boxes[0][1] as number)),
      String(name),
    ).toBeLessThan(1);
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

// The surface probe's plots, both ways, fit a phone's sidebar, and their
// choice's help opens below it without moving the sliders above.
test("the surface probe's plots fit a phone, and their help moves nothing above", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?study=3d");
  await choosePreset(page, { label: "Beads that lose their envelope" });
  await page.getByLabel("Describe", { exact: true }).selectOption("surface");
  await page
    .getByRole("checkbox", {
      name: "Principal curvatures & centers at a point",
    })
    .check();
  // A bead's widest row, which has a contact circle to plot around.
  await page.getByRole("slider", { name: "Along t", exact: true }).fill("270");
  const plots = page.getByLabel("Plots", { exact: true });
  await plots.selectOption("both");
  const figures = page.locator(".spatial-probe .probe-plot");
  await expect(figures).toHaveCount(4);
  const probe = (await page.locator(".spatial-probe").boundingBox())!;
  for (const figure of await figures.all()) {
    const box = (await figure.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(probe.x - 0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(probe.x + probe.width + 0.5);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const sliders = page.locator(".spatial-probe input[type=range]");
  const boxes = () =>
    sliders.evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect(),
          p = e.closest(".spatial-probe")!.getBoundingClientRect();
        return [Math.round(r.x - p.x), Math.round(r.y - p.y)];
      }),
    );
  const before = await boxes();
  const control = async () => {
    const r = (await plots.boundingBox())!,
      p = (await page.locator(".spatial-probe").boundingBox())!;
    return [Math.round(r.x - p.x), Math.round(r.y - p.y)];
  };
  const select = await control();
  const toggle = page
    .locator(".spatial-probe .field", { has: plots })
    .locator(".help-toggle");
  await toggle.click();
  const help = page.locator(`#${await toggle.getAttribute("aria-controls")}`);
  await expect(help).toBeVisible();
  await help.locator(".help-more").click();
  await expect(help.locator(".hint-more")).toBeVisible();
  expect(await boxes()).toEqual(before);
  expect(await control()).toEqual(select);
});

// A field's label, its help toggle and any value at the end of its row
// share one line, in the probe panel as everywhere else: its checkbox's
// own label styles must not reach the fields beside it. The one exception
// is a paired probe slider's value, which changes length as the probe
// moves and so always takes its own line, flush under the label, rather
// than wrapping there for some values and not others.
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
        const below = row.matches(".pair > .probe-slider > .field-label")
          ? row.querySelector("b")
          : null;
        return {
          label: text.textContent,
          font: getComputedStyle(text).fontSize,
          offsets: [...row.children]
            .filter((e) => e !== text && e !== below)
            .map((e) => Math.abs(middle(e) - middle(text))),
          below: below && {
            drop: middle(below) - middle(text),
            left: Math.abs(
              below.getBoundingClientRect().left -
                text.getBoundingClientRect().left,
            ),
          },
        };
      }),
    );
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      // The sidebar's field labels are 13px, as in every other panel.
      expect(row, row.label!).toMatchObject({ font: "13px" });
      for (const offset of row.offsets)
        expect(offset, row.label!).toBeLessThan(1.5);
      // One line lower, at the label's left edge.
      if (row.below) {
        expect(row.below.drop, row.label!).toBeGreaterThan(12);
        expect(row.below.drop, row.label!).toBeLessThan(24);
        expect(row.below.left, row.label!).toBeLessThan(0.5);
      }
    }
    // The sphere's surface probe has its paired sliders.
    if (label === "A sphere collapsing to one focus")
      expect(rows.filter((r) => r.below)).toHaveLength(2);
  });

// An open help toggle keeps its filled look while the pointer rests on it,
// as it does after a tap on iOS, in every theme: the buttons' own hover
// fill must not cover it and leave its glyph dark on dark.
test("an open help toggle stays filled under the pointer in every theme", async ({
  page,
}) => {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/");
    await expect(page.locator("#artwork")).toBeVisible();
    const toggle = page.locator("aside .help-toggle").first();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await toggle.hover();
    const style = await toggle.evaluate((t) => {
      const s = getComputedStyle(t);
      return { fill: s.backgroundColor, ring: s.borderColor, glyph: s.color };
    });
    expect(style.fill, scheme).toBe(style.ring);
    expect(style.glyph, scheme).not.toBe(style.fill);
  }
});

for (const width of [390, 1440])
  test(`atlas help and range errors never move paired controls at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    const setups = [
      "Hypotrochoid & its evolute",
      "Ellipse & its pedal",
      "Clifford attractor",
    ].map((title) => async () => {
      const atlas = page.getByRole("dialog", {
        name: "A field of possible flowers",
        exact: true,
      });
      if (await atlas.isVisible())
        await atlas
          .getByRole("button", { name: "Cancel atlas", exact: true })
          .click();
      await choosePreset(page, { label: title });
      await expect(page.locator(".plot-wrap")).toHaveAttribute(
        "aria-busy",
        "false",
      );
      await page
        .getByRole("button", { name: "Explore parameter atlas", exact: true })
        .click();
      await expect(
        atlas.locator('.atlas-cell[data-state="valid"]'),
      ).toHaveCount(9);
    });
    expect(await sweepPairs(page, setups, ".atlas")).toBeGreaterThanOrEqual(12);
    const atlas = page.getByRole("dialog", {
      name: "A field of possible flowers",
      exact: true,
    });
    const from = atlas.getByLabel("Coefficient a from", { exact: true });
    const to = atlas.getByLabel("Coefficient a to", { exact: true });
    const before = (await to.boundingBox())!.y;
    await from.fill("t");
    await expect(from).toHaveAttribute("aria-invalid", "true");
    expect((await to.boundingBox())!.y).toBe(before);
  });

for (const width of [390, 1440])
  for (const mode of ["light", "dark"] as const)
    test(`atlas entry help and parameter pair use ordinary spacing at ${width}px in ${mode}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: mode });
      await page.goto("/");
      await choosePreset(page, { label: "Ellipse & its pedal" });
      const about = page.getByRole("button", {
        name: "About parameter atlas",
        exact: true,
      });
      await about.click();
      const help = page.locator(
        `#${await about.getAttribute("aria-controls")}`,
      );
      const shape = page.getByRole("button", {
        name: "About shape parameter a",
        exact: true,
      });
      await shape.click();
      const reference = page.locator(
        `#${await shape.getAttribute("aria-controls")}`,
      );
      const referenceGap = await reference.evaluate(
        (e) =>
          e.getBoundingClientRect().top -
          e.closest(".field")!.querySelector("input")!.getBoundingClientRect()
            .bottom,
      );
      const gap = () =>
        help.evaluate(
          (e) =>
            e.getBoundingClientRect().top -
            e
              .closest(".atlas-entry")!
              .querySelector(".atlas-entry-actions")!
              .getBoundingClientRect().bottom,
        );
      expect(referenceGap).toBe(8);
      expect.soft(await gap()).toBe(referenceGap);
      await help
        .getByRole("button", { name: "Show more", exact: true })
        .click();
      expect.soft(await gap()).toBe(referenceGap);
      await page
        .getByRole("button", { name: "Explore parameter atlas", exact: true })
        .click();
      const atlas = page.getByRole("dialog", {
        name: "A field of possible flowers",
        exact: true,
      });
      const spacing = await atlas.evaluate((root) => {
        const first = root
          .querySelector(".atlas-controls > .field:first-child select")!
          .getBoundingClientRect();
        const labels = [
          ...root.querySelectorAll(".atlas-controls > .pair .field-label"),
        ].map((e) => e.getBoundingClientRect().top);
        const options = [
          ...root.querySelectorAll(".atlas-controls > .pair select"),
        ].map((e) => e.getBoundingClientRect().bottom);
        const ranges = [
          ...root.querySelectorAll(
            ".atlas-ranges > .pair:first-child .field-label",
          ),
        ].map((e) => e.getBoundingClientRect().top);
        return {
          pair: Math.min(...labels) - first.bottom,
          ranges: Math.min(...ranges) - Math.max(...options),
        };
      });
      expect.soft(spacing.pair).toBe(16);
      expect(spacing.ranges).toBe(16);
    });

// Refinement's settings stack evenly under its checkbox: the first, whose
// row has no help toggle, is as far from the next as they are from each other.
test("refinement's checkboxes are evenly spaced", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Refine between samples", { exact: true }).click();
  const centers = await page.evaluate(() =>
    [
      "Refine between samples",
      "Refine to the view as you zoom",
      "Frame the points between samples",
    ].map((text) => {
      const label = [...document.querySelectorAll("label.check")].find(
        (l) => l.textContent!.trim() === text,
      )!;
      const box = label.querySelector("input")!.getBoundingClientRect();
      return box.top + box.height / 2;
    }),
  );
  // Within a pixel: Linux font metrics move a label row by half a pixel,
  // while the uneven spacing this guards was 5.5px short.
  expect(
    Math.abs(centers[1] - centers[0] - (centers[2] - centers[1])),
  ).toBeLessThan(1);
});

// The 3D probe's switches start at the panel's edge together, and an open
// help keeps the switches' own gap before the next switch, at desktop and
// phone widths. The first switch's checkbox once kept the browser's margin
// and sat 4px in; its open help once touched the switch below.
for (const width of [1440, 390])
  test(`the 3D probe's switches line up and keep their gap below an open help (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?study=3d");
    await choosePreset(page, {
      label: "A spheroid's evolute, spun about its axis",
    });
    await expect(page.locator(".spatial-stage")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    const panel = page.locator(".spatial-probe");
    const switches = panel.locator(".probe-switch");
    const box = (i: number) =>
      switches
        .nth(i)
        .locator("input")
        .evaluate((e) => {
          const r = e.getBoundingClientRect();
          return { left: r.left, top: r.top };
        });
    const gap = () =>
      switches.nth(1).evaluate((s) => {
        let help = s.previousElementSibling as HTMLElement;
        while (help.hidden) help = help.previousElementSibling as HTMLElement;
        return (
          s.getBoundingClientRect().top - help.getBoundingClientRect().bottom
        );
      });
    const first = await box(0),
      second = await box(1);
    expect(Math.abs(first.left - second.left)).toBeLessThanOrEqual(0.5);
    // Closed, the switches are 13px apart.
    const closed = await gap();
    expect(closed).toBeGreaterThanOrEqual(12);
    await panel
      .getByRole("button", { name: /the probe/ })
      .first()
      .click();
    await expect(
      switches.nth(0).locator("xpath=following-sibling::div[1]"),
    ).toBeVisible();
    // Allowing a pixel for fonts on CI's Linux runners.
    expect(Math.abs((await gap()) - 13)).toBeLessThanOrEqual(1);
  });

// Beside the sidebar on a phone held sideways, the 3D view buttons take
// their own row and the title the column's width, rather than the title
// wrapping word by word in what the buttons leave. A wide desktop keeps
// them on one row.
for (const [width, height, stacked] of [
  [844, 390, true],
  [1024, 768, true],
  [1440, 900, false],
] as const)
  test(`the 3D title ${stacked ? "takes the column's width" : "shares its row"} at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/?study=3d");
    await choosePreset(page, { label: "A staircase becoming a throat" });
    const heading = page.locator(".app:visible .plot-heading");
    const m = await heading.evaluate((h) => {
      const title = h.firstElementChild!.getBoundingClientRect(),
        buttons = h.lastElementChild!.getBoundingClientRect(),
        row = h.getBoundingClientRect();
      return {
        title: title.width,
        width: row.width,
        below: buttons.top >= title.bottom,
      };
    });
    expect(m.below).toBe(stacked);
    if (stacked) expect(m.title).toBeGreaterThanOrEqual(m.width - 1);
  });
