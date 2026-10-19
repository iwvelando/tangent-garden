import { test, expect } from "@playwright/test";
import { openAnimation, chooseColorScheme } from "./helpers";

test("system theme follows live changes, and overrides persist until reset", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator(".app")).toHaveClass("app dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator(".app")).toHaveClass("app");
  await page.getByRole("button", { name: "Use dark background" }).click();
  await page.reload();
  await expect(page.locator(".app")).toHaveClass("app dark");
  await expect(page.locator(".app")).toHaveAttribute(
    "data-theme-preference",
    "dark",
  );
  await page
    .getByRole("button", { name: "Follow system", exact: true })
    .click();
  await expect(page.locator(".app")).toHaveClass("app");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator(".app")).toHaveClass("app dark");
  await page.reload();
  await expect(page.locator(".app")).toHaveAttribute(
    "data-theme-preference",
    "system",
  );
});

test("theme works when local storage is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error("disabled");
    };
    Storage.prototype.setItem = () => {
      throw new Error("disabled");
    };
    Storage.prototype.removeItem = () => {
      throw new Error("disabled");
    };
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator(".app")).toHaveClass("app dark");
  await page.getByRole("button", { name: "Use light background" }).click();
  await expect(page.locator(".app")).toHaveClass("app");
  await expect(page.locator("#artwork")).toBeVisible();
});

test("bounds use the Go constant parser, and exact counts are validated", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await page.getByRole("textbox", { name: "t from", exact: true }).fill("-phi");
  await page
    .getByRole("textbox", { name: "to", exact: true })
    .fill("2*pi+ln(e)");
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  let q = JSON.parse((await page.locator("#artwork desc").textContent())!);
  expect(q.curve.min).toBeCloseTo(-(1 + Math.sqrt(5)) / 2, 12);
  expect(q.curve.max).toBeCloseTo(2 * Math.PI + 1, 12);
  await page.getByRole("textbox", { name: "to", exact: true }).fill("t+1");
  await expect(page.getByRole("alert")).toContainText("not allowed");
  await page.getByRole("textbox", { name: "to", exact: true }).fill("2*pi");
  await page
    .getByRole("spinbutton", { name: "Numerical samples", exact: true })
    .fill("777");
  await page
    .getByRole("spinbutton", { name: "Construction lines", exact: true })
    .fill("240");
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
  q = JSON.parse((await page.locator("#artwork desc").textContent())!);
  expect(q.samples).toBe(777);
  expect(q.lines).toBe(240);
  await page
    .getByRole("spinbutton", { name: "Construction lines", exact: true })
    .fill("12.5");
  await expect(page.getByRole("alert")).toContainText("whole numbers");
  await page
    .getByRole("spinbutton", { name: "Construction lines", exact: true })
    .fill("12");
  await page
    .getByRole("spinbutton", { name: "Numerical samples", exact: true })
    .fill("63");
  await expect(page.getByRole("alert")).toContainText("64");
  await page
    .getByRole("spinbutton", { name: "Numerical samples", exact: true })
    .fill("64");
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("sidebar scrolling leaves the drawing stationary and decimal indices are valid", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await openAnimation(page);
  const before = await page.locator("#artwork").boundingBox();
  await page
    .getByRole("button", { name: "Play animation" })
    .scrollIntoViewIfNeeded();
  const after = await page.locator("#artwork").boundingBox();
  expect(after!.y).toBe(before!.y);
  expect(
    await page.getByRole("complementary").evaluate((el) => el.scrollTop),
  ).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.getByRole("button", { name: "diacaustic", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Incident index n₁" });
  await input.fill("1.333");
  expect(
    await input.evaluate((el: HTMLInputElement) => el.validity.valid),
  ).toBe(true);
  await page
    .getByText("How the refractive indices work", { exact: true })
    .click();
  await expect(
    page.getByText("0.01 through 10", { exact: true }),
  ).toBeVisible();
  await input.fill("0");
  await expect(page.getByRole("alert")).toContainText("medium indices");
});

// Palette preferences are browser appearance, independent of a shared study.
test("color schemes preserve the default inks and keep alternate inks legible", async () => {
  const { plotPalette, axisInks } = await import("../web/palette");
  const { colorSchemes, validColorScheme } =
    await import("../web/color-schemes");
  const { spatialPalette, lineColor, hex, palette } =
    await import("../web/spatial/palette");
  expect(plotPalette(false)).toMatchObject({
    bg: "#f3f1ea",
    base: "#186b6b",
    derived: "#bc562e",
    line: "#397f82",
  });
  expect(plotPalette(true)).toMatchObject({
    bg: "#0b1517",
    base: "#72c9c4",
    derived: "#f3bc83",
    line: "#86b5b6",
  });
  expect(hex(lineColor(1, 0, false))).toBe("#1a4d4a");
  expect(hex(lineColor(2, 0, true))).toBe("#ffde94");
  const luminance = (hex: string) => {
    const c = hex
      .match(/[a-f\d]{2}/gi)!
      .map((x) => parseInt(x, 16) / 255)
      .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  };
  const contrast = (a: string, b: string) => {
    const x = luminance(a),
      y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const { sectionInk } = await import("../web/tesseract/Drawing");
  expect(sectionInk(0, false)).toBe("hsl(170 55% 36%)");
  for (const { id } of colorSchemes.filter((s) => s.id !== "default")) {
    expect(sectionInk(0, false, id)).not.toBe(sectionInk(0, false));
    expect(sectionInk(0, true, id)).not.toBe(sectionInk(0, true));
  }
  expect(colorSchemes.map((s) => s.id)).toEqual([
    "default",
    "cobalt",
    "plum",
    "forest",
  ]);
  expect(validColorScheme("unknown")).toBe("default");
  for (const { id } of colorSchemes)
    for (const dark of [false, true]) {
      expect(validColorScheme(id)).toBe(id);
      const p = plotPalette(dark, id);
      // Principal strokes and coordinate families exceed 3:1 on their paper.
      for (const ink of [p.base, p.derived, p.line, ...axisInks(dark, id)])
        expect(contrast(ink, p.bg), `${id} ${dark} ${ink}`).toBeGreaterThan(3);
      expect(p.base).not.toBe(p.derived);
      if (id !== "default") {
        expect(p.base).not.toBe(plotPalette(dark).base);
        const s = spatialPalette(id);
        expect(s.rust).not.toEqual(s.curve);
        expect(s.rust).not.toEqual(s.slate);
        // Construction lines stand apart from the lit surface and the
        // receding lines stay fainter than offsets, as in the default.
        const k = dark ? 1 : 0;
        expect(s.construction[k]).not.toEqual(s.teal[k]);
        expect(s.recede[k]).not.toEqual(s.offset[k]);
        expect(contrast(hex(s.construction[k]), p.bg)).toBeGreaterThan(
          contrast(hex(s.teal[k]), p.bg),
        );
        // The shaded surface is softer than the scheme's 2D ink, as the
        // default's is, so shading leaves its lines visible.
        expect(contrast(hex(s.teal[k]), p.bg)).toBeLessThan(
          contrast(p.base, p.bg),
        );
        expect(contrast(hex(palette.teal[k]), p.bg)).toBeLessThan(
          contrast(plotPalette(dark).base, p.bg),
        );
        expect(contrast(hex(s.recede[k]), p.bg)).toBeLessThan(
          contrast(hex(s.offset[k]), p.bg),
        );
        expect(hex(lineColor(1, 0, dark, id))).toBe(
          hex(s.construction[dark ? 1 : 0]),
        );
        for (const ink of [1, 2, 3, 5, 6])
          expect(
            contrast(hex(lineColor(ink, 0.5, dark, id)), p.bg),
          ).toBeGreaterThan(3);
      }
    }
});

for (const dark of [false, true])
  test(`color schemes update drawings, legends and exports in ${dark ? "dark" : "light"}`, async ({
    page,
  }) => {
    const { readFile } = await import("node:fs/promises");
    const { exportImage, chooseNotebook, imageButton } =
      await import("./helpers");
    await page.emulateMedia({ colorScheme: dark ? "dark" : "light" });
    await page.goto("/");
    await expect(imageButton(page)).toBeEnabled();
    const select = page.getByRole("button", {
      name: "Color scheme",
      exact: true,
    });
    await expect(select).toHaveAttribute("data-scheme", "default");
    const before = await page.locator("#artwork desc").textContent();
    for (const id of ["cobalt", "plum", "forest"] as const) {
      const { plotPalette } = await import("../web/palette");
      await chooseColorScheme(page, id);
      const p = plotPalette(dark, id);
      await expect(
        page.locator(`#artwork [stroke="${p.base}"]`).first(),
      ).toBeVisible();
      await expect(page.locator(".base-dot")).toHaveCSS(
        "background-color",
        await page.evaluate((hex) => {
          const c = document.createElement("canvas").getContext("2d")!;
          c.fillStyle = hex;
          c.fillRect(0, 0, 1, 1);
          return `rgb(${Array.from(c.getImageData(0, 0, 1, 1).data)
            .slice(0, 3)
            .join(", ")})`;
        }, p.base),
      );
      expect(await page.locator("#artwork desc").textContent()).toBe(before);
      const downloaded = page.waitForEvent("download");
      await exportImage(page, "SVG");
      const svg = await readFile((await (await downloaded).path())!, "utf8");
      expect(svg).toContain(p.base);
      expect(svg).toContain(p.derived);
    }
    await page.reload();
    await expect(select).toHaveAttribute("data-scheme", "forest");
    for (const dimension of ["3d", "4d", "2d"] as const) {
      await chooseNotebook(page, dimension);
      await expect(
        page
          .locator(".app:visible")
          .getByRole("button", { name: "Color scheme", exact: true }),
      ).toHaveAttribute("data-scheme", "forest");
    }
    await chooseColorScheme(page, "default");
    expect(
      await page.evaluate(() =>
        localStorage.getItem("tangent-garden.color-scheme"),
      ),
    ).toBeNull();
  });

test("color scheme survives notebook changes with denied storage", async ({
  page,
}) => {
  const { chooseNotebook } = await import("./helpers");
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error("disabled");
    };
    Storage.prototype.setItem = () => {
      throw new Error("disabled");
    };
    Storage.prototype.removeItem = () => {
      throw new Error("disabled");
    };
  });
  await page.goto("/");
  await chooseColorScheme(page, "plum");
  for (const d of ["3d", "4d", "2d"] as const) {
    await chooseNotebook(page, d);
    await expect(
      page
        .locator(".app:visible")
        .getByRole("button", { name: "Color scheme", exact: true }),
    ).toHaveAttribute("data-scheme", "plum");
  }
});

test("palette icon opens a keyboard-accessible swatch menu", async ({
  page,
}) => {
  await page.goto("/");
  const button = page.getByRole("button", {
    name: "Color scheme",
    exact: true,
  });
  await expect(button.locator("svg")).toBeVisible();
  await button.press("Enter");
  const menu = page.getByRole("menu", { name: "Color scheme", exact: true });
  await expect(menu.getByRole("menuitemradio")).toHaveCount(4);
  await expect(menu.getByRole("menuitemradio").first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(button).toHaveAttribute("data-scheme", "cobalt");
  await expect(button).toBeFocused();
  await expect(menu).toHaveCount(0);
  await button.click();
  await page.keyboard.press("Escape");
  await expect(button).toBeFocused();
  await expect(menu).toHaveCount(0);
  await button.click();
  await page.locator("h1").click();
  await expect(menu).toHaveCount(0);
});

for (const width of [320, 360, 390, 700, 768, 900, 1024])
  test(`palette and theme controls fit without moving mobile actions at ${width}px`, async ({
    page,
  }, info) => {
    const { chooseNotebook } = await import("./helpers");
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    for (const dimension of ["2d", "3d", "4d"] as const) {
      if (dimension !== "2d") await chooseNotebook(page, dimension);
      const app = page.locator(".app:visible");
      const header = app.locator("header");
      await header.scrollIntoViewIfNeeded();
      if (width > 700)
        expect(
          (await header.locator(".brand-name").boundingBox())!.height,
        ).toBeLessThan(40);
      const before = await header.boundingBox();
      await header
        .getByRole("button", { name: /Use (light|dark) background/ })
        .click();
      const after = await header.boundingBox();
      if (width > 700)
        expect(
          (await header.locator(".brand-name").boundingBox())!.height,
        ).toBeLessThan(40);
      expect(after).toEqual(before);
      await expect(
        header.getByRole("button", { name: "Follow system", exact: true }),
      ).toBeVisible();
      const controls = await header
        .locator("button:visible, a.brand")
        .evaluateAll((elements) =>
          elements.map((e) => {
            const r = e.getBoundingClientRect();
            return {
              name: e.textContent,
              x: r.x,
              y: r.y,
              right: r.right,
              bottom: r.bottom,
            };
          }),
        );
      for (const c of controls) {
        expect(c.x, String(c.name)).toBeGreaterThanOrEqual(0);
        expect(c.right, String(c.name)).toBeLessThanOrEqual(width);
      }
      for (let i = 0; i < controls.length; i++)
        for (let j = i + 1; j < controls.length; j++) {
          const a = controls[i],
            b = controls[j];
          expect(
            a.right <= b.x + 0.5 ||
              b.right <= a.x + 0.5 ||
              a.bottom <= b.y + 0.5 ||
              b.bottom <= a.y + 0.5,
            `${a.name} overlaps ${b.name}`,
          ).toBe(true);
        }
      await chooseColorScheme(
        page,
        dimension === "2d" ? "cobalt" : dimension === "3d" ? "forest" : "plum",
      );
      await header
        .getByRole("button", { name: "Color scheme", exact: true })
        .click();
      const menu = page.getByRole("menu", {
        name: "Color scheme",
        exact: true,
      });
      const box = (await menu.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: info.outputPath(`${dimension}-${width}-palette.png`),
      });
      await page.keyboard.press("Escape");
      await header
        .getByRole("button", { name: "Follow system", exact: true })
        .click();
    }
  });

for (const dark of [false, true])
  test(`alternate schemes reach 3D pixels and 4D vectors in ${dark ? "dark" : "light"}`, async ({
    page,
  }) => {
    const { chooseNotebook, imageButton } = await import("./helpers");
    const { plotPalette, axisInks } = await import("../web/palette");
    const { readFile } = await import("node:fs/promises");
    await page.emulateMedia({ colorScheme: dark ? "dark" : "light" });
    await page.goto("/?study=3d");
    const canvas = page.locator("#spatial-artwork");
    await expect(imageButton(page)).toBeEnabled();
    await canvas.focus();
    await page.keyboard.press("ArrowRight");
    const camera = await canvas.getAttribute("data-view");
    const before = await canvas.evaluate((c: HTMLCanvasElement) =>
      c.toDataURL(),
    );
    for (const id of ["cobalt", "plum", "forest"] as const) {
      await chooseColorScheme(page, id);
      const colors = plotPalette(dark, id);
      expect(await canvas.getAttribute("data-view")).toBe(camera);
      expect(
        await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL()),
      ).not.toBe(before);
      // Read the shader's actual output, rather than a copied color formula.
      const count = await canvas.evaluate(
        (c: HTMLCanvasElement, hex: string) => {
          const target = hex.match(/[a-f\d]{2}/gi)!.map((s) => parseInt(s, 16));
          const gl = c.getContext("webgl")!,
            bytes = new Uint8Array(c.width * c.height * 4);
          gl.readPixels(
            0,
            0,
            c.width,
            c.height,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            bytes,
          );
          let found = 0;
          for (let i = 0; i < bytes.length; i += 4)
            if (target.every((n, j) => Math.abs(bytes[i + j] - n) < 6)) found++;
          return found;
        },
        colors.derived,
      );
      expect(count).toBeGreaterThan(20);
      await imageButton(page).click();
      const download = page.waitForEvent("download");
      await page.getByRole("menuitem", { name: /SVG.*every line/i }).click();
      const svg = await readFile((await (await download).path())!, "utf8");
      expect(svg).toContain(colors.derived);
    }
    await chooseNotebook(page, "4d");
    await expect(page.locator(".tesseract-stage")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    const geometry = await page
      .locator("#tesseract-artwork path")
      .evaluateAll((paths) => paths.map((p) => p.getAttribute("d")));
    for (const id of ["cobalt", "plum", "forest"] as const) {
      await chooseColorScheme(page, id);
      await expect(page.locator("#tesseract-artwork")).toBeVisible();
      for (const ink of axisInks(dark, id))
        expect(
          await page
            .locator(`#tesseract-artwork path[stroke="${ink}"]`)
            .count(),
        ).toBeGreaterThan(0);
      expect(
        await page
          .locator("#tesseract-artwork path")
          .evaluateAll((paths) => paths.map((p) => p.getAttribute("d"))),
      ).toEqual(geometry);
    }
  });

test("invalid color preferences reset safely and cross-tab changes update the palette", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("tangent-garden.color-scheme", "unknown"),
  );
  await page.goto("/");
  const button = page.getByRole("button", {
    name: "Color scheme",
    exact: true,
  });
  await expect(button).toHaveAttribute("data-scheme", "default");
  await page.evaluate(() =>
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "tangent-garden.color-scheme",
        newValue: "cobalt",
      }),
    ),
  );
  await expect(button).toHaveAttribute("data-scheme", "cobalt");
  await page.evaluate(() =>
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "tangent-garden.color-scheme",
        newValue: "unknown",
      }),
    ),
  );
  await expect(button).toHaveAttribute("data-scheme", "default");
});

test("3D explanations name the selected colors while default wording stays unchanged", async ({
  page,
}) => {
  const { choosePreset } = await import("./helpers");
  await page.goto("/?study=3d");
  await choosePreset(page, { label: "A paraboloid gathering light" });
  await expect(page.getByText(/Gold lines are reflected rays/)).toBeVisible();
  await chooseColorScheme(page, "cobalt");
  await expect(page.getByText(/Rose lines are reflected rays/)).toBeVisible();
  await expect(page.getByText(/Violet marks the first caustic/)).toBeVisible();
});

for (const dimension of ["2d", "3d", "4d"] as const)
  test(`${dimension} animation export keeps its selected drawing colors`, async ({
    page,
  }) => {
    const { open, imageButton } = await import("./helpers");
    const { readFile } = await import("node:fs/promises");
    const { execFileSync } = await import("node:child_process");
    const { probe } = await import("./video");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(dimension === "2d" ? "/" : `/?study=${dimension}`);
    await expect(imageButton(page)).toBeEnabled();
    await chooseColorScheme(page, "cobalt");
    await open(
      page,
      dimension === "2d"
        ? "#animation-section"
        : dimension === "3d"
          ? "#spatial-animation-section"
          : "#shape-animation-section",
    );
    await page
      .getByRole("spinbutton", { name: "Duration (seconds)", exact: true })
      .fill(".2");
    await open(
      page,
      dimension === "2d"
        ? "#export-settings"
        : dimension === "3d"
          ? "#spatial-export-settings"
          : "#shape-export-settings",
    );
    await page
      .getByRole("combobox", { name: "Export frame rate", exact: true })
      .selectOption("15");
    await page
      .getByRole("slider", { name: "Export resolution", exact: true })
      .fill("1");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /^Export MP4 video/ }).click();
    const path = (await (await download).path())!;
    const info = probe(path);
    if (!info) return;
    expect(info.frames).toBe(3);
    expect(info.durations.reduce((n, x) => n + x, 0)).toBe(200);
    // Decode actual compressed pixels independently, allowing lossy codec rounding.
    const pixels = execFileSync(
      "ffmpeg",
      ["-v", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    const targets = [
      [141, 183, 255],
      [255, 159, 189],
    ];
    let colored = 0;
    for (let i = 0; i < pixels.length; i += 3)
      if (
        targets.some((c) => c.every((n, k) => Math.abs(pixels[i + k] - n) < 30))
      )
        colored++;
    expect(colored).toBeGreaterThan(100);
    expect((await readFile(path)).subarray(4, 8).toString()).toBe("ftyp");
  });

test("readable storage with denied writes still shares the current color choice", async ({
  page,
}) => {
  const { chooseNotebook } = await import("./helpers");
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error("write denied");
    };
  });
  await page.goto("/");
  await chooseColorScheme(page, "forest");
  await chooseNotebook(page, "3d");
  await expect(
    page
      .locator(".app:visible")
      .getByRole("button", { name: "Color scheme", exact: true }),
  ).toHaveAttribute("data-scheme", "forest");
});

for (const width of [320, 768, 1024, 1440])
  for (const colorScheme of ["light", "dark"] as const)
    test(`system theme stays visible and selected without moving the header at ${width}px in ${colorScheme}`, async ({
      page,
    }, info) => {
      const { chooseNotebook } = await import("./helpers");
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme });
      await page.goto("/");
      for (const dimension of ["2d", "3d", "4d"] as const) {
        if (dimension !== "2d") await chooseNotebook(page, dimension);
        const header = page.locator(".app:visible header");
        await header.scrollIntoViewIfNeeded();
        const system = header.getByRole("button", {
          name: "Follow system",
          exact: true,
        });
        await expect(system).toBeVisible();
        await expect(system).toHaveAttribute("aria-pressed", "true");
        await expect(system.locator("svg")).toBeVisible();
        const selected = await system.evaluate(
          (e) => getComputedStyle(e).backgroundColor,
        );
        expect(selected).not.toBe("rgba(0, 0, 0, 0)");
        const size = (await system.boundingBox())!;
        expect(size.width).toBe(size.height);
        const positions = () =>
          header
            .locator(".appearance-controls button, .study-actions > *, a.brand")
            .evaluateAll((elements) =>
              elements.map((e) => {
                const r = e.getBoundingClientRect();
                return [r.x, r.y, r.width, r.height];
              }),
            );
        const before = await positions();
        await header
          .getByRole("button", { name: /Use (light|dark) background/ })
          .click();
        await expect(system).toHaveAttribute("aria-pressed", "false");
        expect(
          await system.evaluate((e) => getComputedStyle(e).backgroundColor),
        ).not.toBe(selected);
        expect(await positions()).toEqual(before);
        await system.click();
        await expect(system).toHaveAttribute("aria-pressed", "true");
        expect(await positions()).toEqual(before);
        expect(
          await system.evaluate((e) => getComputedStyle(e).backgroundColor),
        ).toBe(selected);
        await page.mouse.move(0, 0);
        await page.screenshot({
          path: info.outputPath(
            `${dimension}-${width}-${colorScheme}-system.png`,
          ),
        });
        // System mode keeps responding to the device after the icon is clicked.
        await page.emulateMedia({
          colorScheme: colorScheme === "light" ? "dark" : "light",
        });
        await expect(
          header.getByRole("button", {
            name:
              colorScheme === "light"
                ? "Use light background"
                : "Use dark background",
          }),
        ).toBeVisible();
        await expect(system).toHaveAttribute("aria-pressed", "true");
        await page.emulateMedia({ colorScheme });
      }
    });

test("3D probe legend swatches follow the selected color scheme", async ({
  page,
}) => {
  const { choosePreset } = await import("./helpers");
  const { lineColor, hex } = await import("../web/spatial/palette");
  const { surfaceInk } = await import("../web/spatial/probe");
  await page.goto("/?study=3d");
  await choosePreset(page, {
    label: "A spheroid's evolute, spun about its axis",
  });
  await chooseColorScheme(page, "forest");
  const legend = page.locator(".spatial-probe .probe-legend .probe-dot");
  const rgb = (h: string) =>
    `rgb(${h
      .match(/[a-f\d]{2}/gi)!
      .map((x) => parseInt(x, 16))
      .join(", ")})`;
  for (const b of [0, 1])
    await expect(legend.nth(1 + b)).toHaveCSS(
      "background-color",
      rgb(hex(lineColor(surfaceInk[b], 0, false, "forest"))),
    );
});

test("the totally reflected rays' note names the selected scheme's color", async () => {
  const { raysNote } = await import("../web/spatial/rays");
  const sheets = [1, 2].flatMap((branch) =>
    [false, true].map((virtual) => ({ branch, virtual, shape: "none" })),
  );
  const r = { caustics: sheets, clipped: [0, 0], total: 3 } as any;
  const light = { interaction: "refract" } as any;
  const note = (scheme?: "cobalt") => raysNote(r, light, scheme).join(" ");
  expect(note()).toContain("drawn totally reflected, in gray.");
  expect(note("cobalt")).toContain("drawn totally reflected, in blue-gray.");
});

// iOS Safari shows a ring for focus moved by script after a tap, which no
// local engine reproduces, so the menus mark such focus quiet themselves.
test("menus opened by a tap move focus quietly, and by keyboard with a ring", async ({
  page,
}) => {
  const { imageButton } = await import("./helpers");
  await page.goto("/");
  await expect(imageButton(page)).toBeEnabled();
  const outline = (name: string) =>
    page
      .getByRole("menu", { name, exact: true })
      .locator(":focus")
      .evaluate((e) => getComputedStyle(e).outlineStyle);
  for (const [trigger, name, wrap] of [
    [
      page.getByRole("button", { name: "Color scheme", exact: true }),
      "Color scheme",
      ".scheme-picker",
    ],
    [imageButton(page), "Export image", ".export-menu"],
  ] as const) {
    const wrapper = page.locator(wrap).filter({ has: trigger });
    await trigger.click();
    await expect(wrapper).toHaveAttribute("data-quiet", "");
    expect(await outline(name)).toBe("none");
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await trigger.press("Enter");
    await expect(wrapper).not.toHaveAttribute("data-quiet");
    expect(await outline(name)).not.toBe("none");
    await page.keyboard.press("Escape");
  }
});
