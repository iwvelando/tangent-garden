import { test, expect } from "@playwright/test";
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
// coordinates cover every pair with help.
for (const width of [1440, 390]) {
  test(`help text in paired fields moves neither neighbour at ${width}px`, async ({
    page,
  }) => {
    test.slow();
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await expect(page.locator("#artwork")).toBeVisible();
    const labels = await exampleTitles(page);
    const setups: (() => Promise<unknown>)[] = labels.map(
      (label) => () => choosePreset(page, { label }),
    );
    setups.push(async () => {
      await choosePreset(page, { label: "Light inside a circle" });
      await page
        .getByRole("combobox", { name: "Source coordinates" })
        .selectOption("polar");
    });
    // An iterated map's window appears only when it is not fitted.
    setups.push(async () => {
      await choosePreset(page, { label: "Clifford attractor" });
      await page
        .getByRole("checkbox", { name: "Fit the window to the iterates" })
        .uncheck();
    });
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
    for (const preset of [
      "A cube beyond a cube",
      "Spherical loom",
      "An octahedron within",
      "Section garden",
      "A sphere in passing",
      "A ring in passing",
      "The missing middle",
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
    // Guard against a sweep that silently finds nothing.
    expect(checked).toBeGreaterThanOrEqual(10);
  });
}

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
