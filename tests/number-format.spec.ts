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
