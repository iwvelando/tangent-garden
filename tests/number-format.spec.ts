import { test, expect } from "@playwright/test";
import { deflateRawSync } from "node:zlib";
import { count, distinctReadouts, plural, readout } from "../web/number-format";
import { presetStudy } from "../web/spatial/link";

test("a readout drops floating-point tails and padding without inventing digits", () => {
  // Expected strings are written out by hand, not derived from the module.
  const cases: [number, number | undefined, string][] = [
    [0, undefined, "0"],
    [-0, undefined, "0"],
    [0.1 + 0.2, undefined, "0.3"],
    [1.15 - 1, undefined, "0.15"],
    [2.9999999999, undefined, "3"],
    [1, undefined, "1"],
    [2.5, undefined, "2.5"],
    [-0.5, undefined, "−0.5"],
    [Math.PI, undefined, "3.14159"],
    [Math.PI, 4, "3.142"],
    [-Math.PI, 4, "−3.142"],
    [123456, undefined, "123456"],
    // Never pad a rounded integer with zeros that look exact.
    [1234567, undefined, "1.23457e6"],
    [123456789, 4, "1.235e8"],
    [999999.7, undefined, "1e6"],
    [0.0001, undefined, "0.0001"],
    [0.00012345678, undefined, "0.000123457"],
    [0.000012345, undefined, "1.2345e−5"],
    [-1e-7, undefined, "−1e−7"],
    [5e-324, undefined, "5e−324"],
    [1e21, undefined, "1e21"],
    [Number.MAX_VALUE, 3, "1.8e308"],
  ];
  for (const [v, digits, want] of cases)
    expect(readout(v, digits), `${v} at ${digits ?? "default"} digits`).toBe(
      want,
    );
});

test("a readout names nonfinite values instead of printing them as numbers", () => {
  expect(readout(NaN)).toBe("undefined");
  expect(readout(Infinity)).toBe("∞");
  expect(readout(-Infinity)).toBe("−∞");
});

test("distinct readouts keep neighboring values apart with the fewest digits", () => {
  const sixteenths = Array.from({ length: 16 }, (_, i) => i / 15);
  const labels = distinctReadouts(sixteenths);
  expect(labels.slice(0, 5)).toEqual([
    "0",
    "0.06667",
    "0.1333",
    "0.2",
    "0.2667",
  ]);
  expect(labels.at(-2)).toBe("0.9333");
  expect(labels.at(-1)).toBe("1");
  expect(new Set(labels).size).toBe(16);
  // Four digits would merge these; the labels grow only as far as needed.
  expect(distinctReadouts([1, 1.0000005, 1.000001])).toEqual([
    "1",
    "1.0000005",
    "1.000001",
  ]);
  // Neighbors closer than 16 digits still part, at a double's full precision.
  const next = 1 + Number.EPSILON;
  const close = distinctReadouts([1, next]);
  expect(close[0]).not.toBe(close[1]);
  expect(Number(close[1])).toBe(next);
  // Equal values, as in a family whose endpoints coincide, share a label;
  // 0 and −0 are the same value.
  expect(distinctReadouts([2, 2, 2])).toEqual(["2", "2", "2"]);
  expect(distinctReadouts([-0, 0, 1])).toEqual(["0", "0", "1"]);
  // Order does not matter, and a family may run downward.
  expect(distinctReadouts([1, 0.5, 0.25, 0])).toEqual([
    "1",
    "0.5",
    "0.25",
    "0",
  ]);
  expect(distinctReadouts([-Math.PI, Math.PI], 2)).toEqual(["−3.1", "3.1"]);
  expect(distinctReadouts([0.3, NaN])).toEqual(["0.3", "undefined"]);
  expect(distinctReadouts([])).toEqual([]);
});

test("counts use en-US grouping and a true minus, whatever the default locale", () => {
  const original = Number.prototype.toLocaleString;
  // Stand in for a German browser: a bare toLocaleString() would group with
  // periods.
  Number.prototype.toLocaleString = function (
    this: number,
    locales?: Intl.LocalesArgument,
    options?: Intl.NumberFormatOptions,
  ) {
    return original.call(this, locales ?? "de-DE", options);
  };
  try {
    expect(count(0)).toBe("0");
    expect(count(-0)).toBe("0");
    expect(count(1234567)).toBe("1,234,567");
    expect(count(-2)).toBe("−2");
    expect(count(-1234)).toBe("−1,234");
    expect(plural(1, "piece", "pieces")).toBe("1 piece");
    expect(plural(0, "piece", "pieces")).toBe("0 pieces");
    expect(plural(1500, "cell", "cells")).toBe("1,500 cells");
  } finally {
    Number.prototype.toLocaleString = original;
  }
  // A count is a whole number; anything else falls back to a readout.
  expect(count(2.5)).toBe("2.5");
  expect(count(NaN)).toBe("undefined");
});

test.describe("under a German browser locale", () => {
  test.use({ locale: "de-DE" });
  test("the notebook's counts keep en-US grouping", async ({ page }) => {
    const s = presetStudy(0);
    s.config.samples = 1200;
    await page.goto(
      `/#s=${deflateRawSync(JSON.stringify({ v: 1, notebook: "3d", study: s })).toString("base64url")}`,
    );
    expect(await page.evaluate(() => (1234.5).toLocaleString())).toBe(
      "1.234,5",
    );
    await expect(page.getByText(/^1,200 samples · /)).toBeVisible();
  });
});

test("live values use one range format through zero and notation boundaries", async () => {
  const { liveReadout } = await import("../web/number-format");
  expect(liveReadout(0, [0, 1])).toBe("0.00000");
  expect(liveReadout(0.1 + 0.2, [0, 1])).toBe("0.30000");
  expect(liveReadout(1, [0, 1])).toBe("1.00000");
  expect(liveReadout(-0, [-1, 1])).toBe("\u20070.00000");
  expect(liveReadout(-0.5, [-1, 1])).toBe("−0.50000");
  expect(liveReadout(1, [1, 1.000001])).toBe("1.00000000");
  expect(liveReadout(1.000001, [1, 1.000001])).toBe("1.00000100");
  expect(liveReadout(1e-7, [0, 1e-7])).toBe("1.00000e−7");
  expect(liveReadout(5e-324, [0, 5e-324])).toBe("5.00000e−324");
  expect(liveReadout(NaN, [0, 1])).toBe("undefined");
  expect(liveReadout(Infinity, [0, 1])).toBe("∞");
  expect(liveReadout(-Infinity, [0, 1])).toBe("−∞");
  for (const range of [
    [-1, 1],
    [0, 100],
    [999999, 1000001],
    [1e-8, 1e-7],
    [1.15, 1],
  ] as const) {
    const labels = Array.from({ length: 101 }, (_, i) =>
      liveReadout(range[0] * (1 - i / 100) + (range[1] * i) / 100, range),
    );
    expect(new Set(labels.map((s) => s.length)).size, String(range)).toBe(1);
    expect(new Set(labels).size, String(range)).toBe(101);
  }
});

test("shared percentages, elapsed seconds and file sizes stay honest", async () => {
  const { percent, elapsed, mebibytes } = await import("../web/number-format");
  expect(percent(0)).toBe("0%");
  expect(percent(1)).toBe("100%");
  expect(percent(1e-8)).toBe("1e−6%");
  expect(percent(0.999999)).toBe("over 99.9%");
  expect(percent(NaN)).toBe("undefined");
  expect(elapsed(0.3, 10)).toBe("\u20070.3 / 10 s");
  expect(elapsed(10, 10)).toBe("10.0 / 10 s");
  expect(mebibytes(1024 * 1024)).toBe("1 MiB");
  expect(mebibytes(1)).toBe("9.53674e−7 MiB");
});

test("display sites delegate formatting; exclusions are exact machine-output or numeric-default lines", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  // These are serialization or numeric calculations, never UI strings.
  // Exact lines, rather than entire files, keep mixed renderer/UI files guarded.
  const excluded: Record<string, string[]> = {
    "Plot.tsx": [
      "const f = (v: number) => v.toFixed(3);",
      ".map((q) => `${xy(q).x.toFixed(3)},${xy(q).y.toFixed(3)}`)",
      's += `${gap ? "M" : "L"}${a.x.toFixed(3)},${a.y.toFixed(3)} `;',
      "s += `M${kept.x.toFixed(3)},${kept.y.toFixed(3)} `;",
      "s += `L${a.x.toFixed(3)},${a.y.toFixed(3)} `;",
    ],
    "spatial/PlaneViews.tsx": [
      'd += `${open ? "L" : "M"}${q.x.toFixed(2)},${q.y.toFixed(2)}`;',
    ],
    "tesseract/Drawing.tsx": [
      '.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(3)},${p[1].toFixed(3)}`)',
    ],
    "lace/Drawing.tsx": ["const fixed = (v: number) => String(+v.toFixed(3));"],
    "shorten/Drawing.tsx": ["const fixed = (v: number) => v.toFixed(2);"],
    "spatial/palette.ts": [
      '`vec3(${c.map((n) => (Number.isInteger(n) ? n.toFixed(1) : String(n))).join(",")})`;',
    ],
    "spatial/renderer.ts": [
      "T = taper.z * clamp(taper.y / vec2(a.w, b.w), ${taperRange[0].toFixed(4)}, ${taperRange[1].toFixed(4)});",
      "return pow(fadeStep, clamp(n, 1.0, ${fadeLayers.toFixed(1)}) - 1.0);",
      "shade = bin.b < 0.5 ? -1.0 : bin.r * ${((255 * 256) / 65535).toFixed(8)} + bin.g * ${(255 / 65535).toFixed(8)};",
      "if (fract(pageDashes > 0.0 ? Q.x / Q.y : D) >= ${dashOn.toFixed(4)}) discard;",
      "gl_FragColor = vec4(color,${dashedOpacity.toFixed(4)}*layerFade());",
      "} else if (behind > 0.5) gl_FragColor = vec4(color,${faintOpacity.toFixed(4)}*layerFade());",
      "if (fract(pageDashes > 0.0 ? D + pageDashes * s.x : D) >= ${dashOn.toFixed(4)}) discard;",
      "gl_FragColor = vec4(color,${dashedOpacity.toFixed(4)}*layerFade()*cover);",
      "} else if (behind > 0.5) gl_FragColor = vec4(color,${faintOpacity.toFixed(4)}*layerFade()*cover);",
    ],
    "atlas-queue.ts": ["const short = Number(value.toPrecision(digits));"],
    "fourier-fit.ts": [
      "return Math.min(fittedOffset, Number((across / 16).toPrecision(2)));",
    ],
    "spatial/shadow.ts": ["return Number(at.toPrecision(2));"],
    "spatial/geodesics.tsx": [
      "(Number.isFinite(turn) && turn > 0 ? turn : 1).toPrecision(3),",
      "size: Number((Number.isFinite(r) && r > 0 ? r : 0.3).toPrecision(2)),",
    ],
    "spatial/presets.ts": [
      "x: Number((1 / Math.sqrt(0.55 - 0.04 * k)).toFixed(4)),",
    ],
    "phrase.ts": [
      "Number(phrase.phases.reduce((sum, p) => sum + p.duration, 0).toPrecision(12));",
    ],
  };
  const failures: string[] = [];
  function scan(dir: string) {
    for (const entry of readdirSync(`web/${dir}`, { withFileTypes: true })) {
      const file = dir + entry.name;
      if (entry.isDirectory()) {
        scan(`${file}/`);
        continue;
      }
      if (!/\.tsx?$/.test(file) || file === "number-format.ts") continue;
      const source = readFileSync(`web/${file}`, "utf8");
      // Scan the whole source so a line break before '(' cannot bypass it.
      for (const match of source.matchAll(
        /\.\s*(?:toPrecision|toFixed|toExponential|toLocaleString)\s*\(/g,
      )) {
        const start = source.lastIndexOf("\n", match.index) + 1;
        const end = source.indexOf("\n", match.index);
        const line = source.slice(start, end < 0 ? source.length : end).trim();
        if (!excluded[file]?.includes(line))
          failures.push(
            `${file}:${source.slice(0, start).split("\n").length}: ${line}`,
          );
      }
    }
  }
  scan("");
  expect(failures).toEqual([]);
});

test("probe domains and standalone circle values use clean shared readouts", async () => {
  const { outsideFrame } = await import("../web/probe");
  const { describeCircle } = await import("../web/garden/model");
  expect(outsideFrame(-0.5, 0.1 + 0.2, 123456789)).toBe(
    "t = −0.5 lies outside this frame's domain, [0.3, 1.23457e8].",
  );
  expect(describeCircle({ curvature: [0.1 + 0.2] } as any, 0)).toBe(
    "Circle 1 · curvature 0.3",
  );
  expect(describeCircle({ curvature: [-0.5] } as any, 0)).toBe(
    "Circle 1 · curvature −0.5",
  );
});

test("phrase captions share a steady range format in the UI and exported SVG", async () => {
  const { phraseCaptionText, SvgPhraseCaption } =
    await import("../web/PhraseCaption");
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { plotPalette } = await import("../web/palette");
  const phrase = {
    phase: "Cross zero",
    target: "sourceX",
    value: -0.5,
    range: [-1, 1],
  } as any;
  expect(phraseCaptionText(phrase).parameter).toBe("Source x = −0.50000");
  const markup = renderToStaticMarkup(
    createElement(SvgPhraseCaption, {
      phrase,
      palette: plotPalette(false),
      dark: false,
    }),
  );
  expect(markup).toContain("Source x = −0.50000");
  phrase.value = 0;
  expect(phraseCaptionText(phrase).parameter).toBe("Source x = \u20070.00000");
  expect(
    renderToStaticMarkup(
      createElement(SvgPhraseCaption, {
        phrase,
        palette: plotPalette(false),
        dark: false,
      }),
    ),
  ).toContain("Source x = \u20070.00000");
});

test("4D section levels share live formatting and narrow families stay distinct", async () => {
  const { objects, curvedSectionDetail } =
    await import("../web/tesseract/objects");
  const section = { level: -0.5, dimension: -1 } as any;
  expect(curvedSectionDetail(section, [-2, 2])).toBe(
    "h = −0.50000 · Empty section",
  );
  section.level = -0;
  expect(curvedSectionDetail(section, [-2, 2])).toBe(
    "h = \u20070.00000 · Empty section",
  );
  const labels = distinctReadouts([1, 1.0000005, 1.000001], 6);
  expect(
    labels.map(
      (label, i) =>
        objects.ball.sectionKey!(
          { level: 1 + i * 0.0000005 } as any,
          i,
          label,
        )[1],
    ),
  ).toEqual(["1", "1.0000005", "1.000001"]);
});

for (const notebook of ["2d", "3d"] as const)
  test(`${notebook} reveal readouts retain their width while seeking through zero`, async ({
    page,
  }) => {
    const { presetStudy: planarPreset } = await import("../web/planar-link");
    const study = notebook === "2d" ? planarPreset(0) : presetStudy(0);
    if (notebook === "3d") study.config.format = "parametric";
    study.config.curve.min = -1;
    study.config.curve.max = 1;
    if (notebook === "2d") study.bounds = { min: "-1", max: "1" };
    study.animation = {
      ...study.animation,
      mode: "reveal",
      duration: 30,
      repeat: "once",
    };
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(
      `/${notebook === "3d" ? "?study=3d" : ""}#s=${deflateRawSync(JSON.stringify({ v: 1, notebook, study })).toString("base64url")}`,
    );
    const stage = page.locator(
      notebook === "2d" ? ".plot-wrap" : ".spatial-stage",
    );
    await expect(stage).toHaveAttribute("aria-busy", "false");
    if (notebook === "3d")
      expect(
        JSON.parse((await stage.getAttribute("data-config"))!).curve.min,
      ).toBe(-1);
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const output = page.locator(".animation-values").filter({ visible: true });
    const widths: number[] = [];
    for (const [progress, value] of [
      ["0", "−1.00000"],
      ["0.5", "\u20070.00000"],
      ["1", "\u20071.00000"],
    ]) {
      await page
        .getByRole("slider", { name: "Animation progress", exact: true })
        .fill(progress);
      await expect(output).toHaveText(`t = ${value}`);
      widths.push(
        await output.evaluate((e) => {
          const range = document.createRange();
          range.selectNodeContents(e);
          return range.getBoundingClientRect().width;
        }),
      );
      expect(
        await output.evaluate((e) => getComputedStyle(e).fontVariantNumeric),
      ).toBe("tabular-nums");
    }
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1);
    await page
      .getByRole("button", { name: /Back to study|Stop/, exact: true })
      .first()
      .click();
    await expect(stage).toHaveAttribute("aria-busy", "false");
  });

test("a copied negative scalar and exponent evaluate through the worker without altering the draft", async ({
  page,
}) => {
  const { presetStudy: planarPreset } = await import("../web/planar-link");
  const s = planarPreset(0);
  s.config.kind = "offset";
  s.config.stack.enabled = false;
  await page.goto(
    `/#s=${deflateRawSync(JSON.stringify({ v: 1, notebook: "2d", study: s })).toString("base64url")}`,
  );
  const field = page.getByRole("textbox", {
    name: "Offset distance d",
    exact: true,
  });
  for (const [text, value] of [
    ["−0.5", -0.5],
    ["−1e−7", -1e-7],
    ["\u20070.30000", 0.3],
    ["−\u2007\u20071.00000", -1],
  ] as const) {
    await field.fill(text);
    await expect
      .poll(async () => {
        const metadata = JSON.parse(
          (await page.locator("#artwork desc").textContent())!,
        );
        return metadata.distance;
      })
      .toBe(value);
    await expect(field).toHaveValue(text);
    await expect(field).not.toHaveAttribute("aria-invalid", "true");
  }
});

test("live values below a range's decimal resolution keep their sign without becoming zero or changing width", async () => {
  const { liveReadout } = await import("../web/number-format");
  expect(liveReadout(1e-12, [-1, 1])).toBe("\u2007\u2007\u2007<1e−5");
  expect(liveReadout(-1e-12, [-1, 1])).toBe("\u2007\u2007>−1e−5");
  expect(liveReadout(1e-12, [-1, 1]).length).toBe(
    liveReadout(0, [-1, 1]).length,
  );
  expect(liveReadout(-1e-12, [-1, 1]).length).toBe(
    liveReadout(-1, [-1, 1]).length,
  );
});

test("live notation thresholds are range-based and include both finite extremes", async () => {
  const { liveReadout } = await import("../web/number-format");
  expect(liveReadout(0.0001, [0, 0.0001])).toBe("0.000100000");
  expect(liveReadout(0.0000999999, [0, 0.0000999999])).toBe("9.99999e−5");
  expect(liveReadout(999999, [0, 999999])).toBe("999999");
  expect(liveReadout(1e6, [0, 1e6])).toBe("1.00000e6");
  expect(liveReadout(Number.MAX_VALUE, [0, Number.MAX_VALUE])).toBe(
    "1.79769e308",
  );
  expect(liveReadout(-Number.MIN_VALUE, [-Number.MIN_VALUE, 0])).toBe(
    "−5.00000e−324",
  );
});

test("atlas labels and inspection keep a narrowly spaced axis distinct", async ({
  page,
}) => {
  const { presetStudy } = await import("../web/planar-link");
  const { presets } = await import("../web/presets");
  const { openAtlas } = await import("./gallery-helpers");
  const source = presetStudy(
    presets.findIndex((p) => p.title === "Epicycles, turned inside out"),
  );
  await page.goto(
    `/#s=${deflateRawSync(JSON.stringify({ v: 1, notebook: "2d", study: source })).toString("base64url")}`,
  );
  const atlas = await openAtlas(page);
  await atlas
    .getByLabel("Parameter pair", { exact: true })
    .selectOption("term-2");
  await atlas.getByLabel("Grid size", { exact: true }).selectOption("3");
  await atlas.getByLabel("Radius r₂ to", { exact: true }).fill("1.000001");
  await atlas.getByLabel("Radius r₂ from", { exact: true }).fill("1");
  await atlas
    .getByRole("button", { name: "Generate atlas", exact: true })
    .click();
  await expect(atlas.locator('.atlas-cell[data-state="valid"]')).toHaveCount(9);
  const labels = (await atlas.locator(".atlas-values").allTextContents()).map(
    (s) => s.split("r₂ = ").at(-1)!,
  );
  expect([...new Set(labels)].sort((a, b) => Number(a) - Number(b))).toEqual([
    "1",
    "1.0000005",
    "1.000001",
  ]);
  await atlas.locator(".atlas-cell button").nth(4).click();
  await expect(atlas.locator(".atlas-inspection-header")).toContainText(
    "r₂ = 1.0000005",
  );
});

test("timeline percentages share whole-number labels without pretending a partial step is complete", async () => {
  const { progressPercent } = await import("../web/number-format");
  expect(progressPercent(0)).toBe("0%");
  expect(progressPercent(-0)).toBe("0%");
  expect(progressPercent(0.1 + 0.2)).toBe("30%");
  expect(progressPercent(1 / 3)).toBe("33%");
  expect(progressPercent(1)).toBe("100%");
  expect(progressPercent(1e-8)).toBe("under 1%");
  expect(progressPercent(0.999999)).toBe("over 99%");
  expect(progressPercent(NaN)).toBe("undefined");
});
