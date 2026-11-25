import { test, expect, type Page, type Locator } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { chooseNotebook, choosePreset, openShapeExport } from "./helpers";
import { fitDialog, leafFit } from "./fourier-fit-checks";
import { wireStudy } from "./study-link-wire";
import { decodeVideo, frameDifference, probe } from "./video";

// The root journey's noncircular source paths (engine4/root_path.go): a
// ripple z = r e^{iφ}(k + e^{it} + a e^{imt}) or a Fourier loop
// z = r e^{iφ}(k + Σ ρ e^{i(f t + ψ)}), as Draw a loop writes it. Each
// winding below is the argument principle's count, worked out by hand
// from the formula; the engine counts it from certified arguments.
const stage = (p: Page) => p.locator(".tesseract-stage");
const settle = (p: Page) =>
  expect(stage(p)).toHaveAttribute("aria-busy", "false");
const panel = (p: Page, mode: "diagram" | "orthographic") =>
  p.locator(`svg[data-representation="${mode}"]`);
const desc = async (p: Page, mode: "diagram" | "orthographic") =>
  JSON.parse(
    (await panel(p, mode).locator(":scope > desc").textContent()) ?? "{}",
  );
const meta = async (p: Page) =>
  JSON.parse((await p.locator("#tesseract-artwork > desc").textContent())!);
const open = async (p: Page, label: string) => {
  await p.goto("/?study=4d");
  await settle(p);
  await choosePreset(p, { label });
  await settle(p);
};
const readout = (p: Page, label: string) =>
  p
    .locator(".lift-readout span")
    .filter({
      hasText: new RegExp(`^${label.replace(/[|()[\]\\.*+?^$]/g, "\\$&")}:`),
    })
    .locator("b");
const drawing = (p: Page) =>
  p
    .locator("#tesseract-artwork")
    .evaluate((e) =>
      e.outerHTML
        .replace(/<(title|desc)\b[^>]*>[\s\S]*?<\/\1>/g, "")
        .replace(/\s(?:data|aria)-[\w-]+="[^"]*"/g, ""),
    );
const source = (p: Page) =>
  p.getByRole("combobox", { name: "Source path", exact: true });
const textbox = (p: Page, name: string) =>
  p.getByRole("textbox", { name, exact: true });
const spin = (p: Page, name: string) =>
  p.getByRole("spinbutton", { name, exact: true });
const loopNote = (p: Page) => p.locator(".loop-entry");
const slider = (p: Page) =>
  p.getByRole("slider", { name: "Animation progress" });
const scrub = async (p: Page, s: number) => {
  await slider(p).fill(String(s));
  await settle(p);
};
const playThenPause = async (p: Page) => {
  await p.getByRole("button", { name: "Play animation", exact: true }).click();
  await p.getByRole("button", { name: "Pause", exact: true }).click();
};
const copyLinks = (page: Page) =>
  page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as any).copied = value;
        },
      },
    }),
  );
async function copied(scope: Locator | Page, page: Page) {
  await page.evaluate(() => ((window as any).copied = undefined));
  await scope.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => typeof (window as any).copied))
    .toBe("string");
  const link: string = await page.evaluate(() => (window as any).copied);
  return { link, study: wireStudy(new URL(link).hash.slice(3)) };
}
// A 4D study opened from a link written for it.
async function openLink(page: Page, change: (config: any) => void) {
  const { presetStudy } = await import("../web/tesseract/link");
  const { studyHref, writeStudyLink } = await import("../web/study-link");
  const study = presetStudy(
    (await import("../web/tesseract/presets")).tesseractPresets.findIndex(
      (p) => p.name === "Twice around zero",
    ),
  );
  change(study.config);
  const token = await writeStudyLink("4d", study);
  await page.goto("/");
  await page.goto(
    studyHref("http://localhost/", "4d", token).replace("http://localhost", ""),
  );
  await settle(page);
}
// z(0) = r e^{iφ}(k + Σ ρ e^{iψ}), from a study's own fields.
const startOf = (root: any) => {
  let [x, y] = [root.offset ?? 0, 0];
  for (const t of root.terms) {
    x += t.radius * Math.cos(t.phase);
    y += t.radius * Math.sin(t.phase);
  }
  const phi = root.direction ?? 0;
  return [
    root.radius * (x * Math.cos(phi) - y * Math.sin(phi)),
    root.radius * (x * Math.sin(phi) + y * Math.cos(phi)),
  ];
};

test("Source path needs no research parameter; a ripple's fields set its winding, and the circle returns unchanged", async ({
  page,
}) => {
  await open(page, "The second time around");
  const circle = await drawing(page);
  const circleRequest = (await desc(page, "orthographic")).root;
  await expect(source(page)).toHaveValue("circle");
  await expect(textbox(page, "Ripple a")).toHaveCount(0);
  await source(page).selectOption("ripple");
  await settle(page);
  await expect(textbox(page, "Ripple a")).toHaveValue("0.5");
  await expect(spin(page, "Frequency m")).toHaveValue("3");
  // e^{it} + ½e^{3it}: the ripple is smaller than the circle, so z winds
  // once, and the square root needs two circuits.
  await expect(readout(page, "Winding about 0")).toHaveText(
    "1: w turns by ω each circuit",
  );
  await expect(readout(page, "w home after")).toHaveText("2 circuits");
  await expect(readout(page, "Closest |z|")).toContainText("certified ≥");
  // a = 2 > 1: the third harmonic dominates, three turns per circuit.
  await textbox(page, "Ripple a").fill("2");
  await settle(page);
  await expect(readout(page, "Winding about 0")).toHaveText(
    "3: w turns by ω³ each circuit",
  );
  // e^{it} + 2e^{−2it}: two turns backward, so the square root is home
  // after one circuit and its other sheet is never visited.
  await spin(page, "Frequency m").fill("-2");
  await settle(page);
  await expect(readout(page, "Winding about 0")).toHaveText(
    "−2: w turns by ω⁻² each circuit",
  );
  await expect(readout(page, "w home after")).toHaveText("1 circuit");
  await expect(
    page.locator('[data-source^="root/value/other-sheet"]'),
  ).toHaveCount(1);
  const ripple = await drawing(page);
  // The circle again draws exactly what it drew, and keeps the ripple's
  // fields in the study for when the ripple is chosen again.
  await source(page).selectOption("circle");
  await settle(page);
  expect(await drawing(page)).toBe(circle);
  expect((await desc(page, "orthographic")).root).toEqual(circleRequest);
  expect((await meta(page)).config.root).toMatchObject({
    ripple: 2,
    frequency: -2,
  });
  await expect(readout(page, "w home after")).toHaveCount(0);
  await source(page).selectOption("ripple");
  await settle(page);
  await expect(textbox(page, "Ripple a")).toHaveValue("2");
  expect(await drawing(page)).toBe(ripple);
});

test("a path through zero, a range error and a fractional frequency are refused by field and recover", async ({
  page,
}) => {
  await open(page, "The second time around");
  await source(page).selectOption("ripple");
  await spin(page, "Frequency m").fill("2");
  await settle(page);
  const offset = textbox(page, "Center offset");
  // e^{it}(1 + e^{it}) passes through 0 at t = π.
  await textbox(page, "Ripple a").fill("1");
  await settle(page);
  await expect(page.locator(".stale-study")).toBeVisible();
  await expect(offset).toHaveAccessibleDescription(
    /^Center offset: the path passes within r\/20 of the branch point z = 0 \(\|z\| = [\d.]+ at t = [\d.]+\); move it farther from 0 or across it/,
  );
  // Readout numbers: no floating-point tail, hyphen or e-05.
  const message = await page.locator(".field-error").first().textContent();
  expect(message).toMatch(/\|z\| = 0\.\d{1,4} at t = \d\.\d{1,2}\)/);
  await textbox(page, "Ripple a").fill("0.9");
  await settle(page);
  await expect(page.locator(".stale-study")).toHaveCount(0);
  await expect(readout(page, "Winding about 0")).toHaveText(
    "1: w turns by ω each circuit",
  );
  for (const [field, value, says, valid] of [
    [
      textbox(page, "Ripple a"),
      "3.5",
      "Ripple a must be between 0 and 3",
      "1/2",
    ],
    [
      spin(page, "Frequency m"),
      "2.5",
      "Frequency m must be a whole number from −12 to 12",
      "4",
    ],
  ] as const) {
    await field.fill(value);
    await settle(page);
    await expect(page.locator(".stale-study")).toBeVisible();
    await expect(field).toHaveAccessibleDescription(new RegExp(says));
    await field.fill(valid);
    await settle(page);
    await expect(page.locator(".stale-study")).toHaveCount(0);
  }
  expect((await meta(page)).config.root).toMatchObject({
    path: "ripple",
    ripple: 0.5,
    frequency: 4,
  });
});

test("the grazing ripple is refused while it passes too near zero, and winds twice once it has crossed", async ({
  page,
}) => {
  await open(page, "A ripple that grazes zero");
  await expect(readout(page, "Winding about 0")).toHaveText(
    "1: w turns by ω each circuit",
  );
  const a = textbox(page, "Ripple a");
  await a.fill("0.7");
  await settle(page);
  await expect(textbox(page, "Center offset")).toHaveAccessibleDescription(
    /passes within r\/20 of the branch point/,
  );
  await a.fill("0.76");
  await settle(page);
  await expect(page.locator(".stale-study")).toHaveCount(0);
  await expect(readout(page, "Winding about 0")).toHaveText(
    "2: w turns by ω² each circuit",
  );
  await expect(readout(page, "w home after")).toHaveText("3 circuits");
});

test("a path needing more than 65,536 points is refused under Path intervals, and fewer intervals recover it", async ({
  page,
}) => {
  // A tenth-size ripple of frequency 64 at 4,096 intervals: refinement to
  // the tolerance passes the budget, which 1,024 intervals keep within.
  await openLink(page, (c) => {
    c.samples = 4096;
    c.root = {
      ...c.root,
      path: "fourier",
      terms: [
        { frequency: 1, radius: 1, phase: 0 },
        { frequency: 64, radius: 0.1, phase: 0 },
      ],
      degree: 2,
      to: 4 * Math.PI,
    };
  });
  const intervals = spin(page, "Path intervals");
  // Refused as it opens: there is no earlier drawing to keep.
  await expect(intervals).toHaveAccessibleDescription(
    "This path needs more than 65,536 points to be drawn within 0.02% of its size: use fewer path intervals, a lower degree or a smoother path",
  );
  await intervals.fill("1024");
  await settle(page);
  await expect(intervals).not.toHaveAccessibleDescription(/65,536/);
  // |0.1 e^{64it}| < |e^{it}|: by Rouché, z winds once.
  await expect(readout(page, "Winding about 0")).toHaveText(
    "1: w turns by ω each circuit",
  );
  await expect(readout(page, "w home after")).toHaveText("2 circuits");
});

test("a link carries a path's fields, older links open the circle, and a term's fractional frequency is refused by name", async ({
  page,
}) => {
  await copyLinks(page);
  await open(page, "Roots in star order");
  await textbox(page, "Ripple a").fill("1.5");
  await settle(page);
  const live = await meta(page);
  const markup = await drawing(page);
  const { link, study } = await copied(page, page);
  expect(study.config.root).toMatchObject({
    path: "ripple",
    ripple: 1.5,
    frequency: -2,
    degree: 5,
  });
  await page.goto("about:blank");
  await page.goto(link.replace(/^https?:\/\/[^/]+/, ""));
  await settle(page);
  expect((await meta(page)).config).toEqual(live.config);
  expect(await drawing(page)).toBe(markup);
  await expect(source(page)).toHaveValue("ripple");
  // Fourier terms travel exactly.
  await open(page, "A drawn leaf around zero");
  const leaf = await meta(page);
  const terms = (await copied(page, page)).study.config.root.terms;
  expect(terms).toEqual(leaf.config.root.terms);
  // A study without a path is a circle, as every older link is.
  await openLink(page, (c) => {
    const { path, ripple, frequency, terms, ...circle } = c.root;
    c.root = { ...circle, degree: 3, to: 6 * Math.PI };
  });
  await expect(source(page)).toHaveValue("circle");
  await expect(page.locator(".stale-study")).toHaveCount(0);
  // A ripple whose link leaves out its fields draws what its controls
  // show, as the same link with those values written in does.
  await openLink(page, (c) => {
    const { ripple, frequency, terms, ...rest } = c.root;
    c.root = { ...rest, path: "ripple" };
  });
  await expect(textbox(page, "Ripple a")).toHaveValue("0.5");
  await expect(spin(page, "Frequency m")).toHaveValue("3");
  await expect(readout(page, "Winding about 0")).toHaveText(
    "1: w turns by ω each circuit",
  );
  const sparse = await drawing(page);
  await openLink(page, (c) => {
    const { terms, ...rest } = c.root;
    c.root = { ...rest, path: "ripple", ripple: 0.5, frequency: 3 };
  });
  expect(sparse).toBe(await drawing(page));
  await openLink(page, (c) => {
    c.root = {
      ...c.root,
      path: "fourier",
      terms: [
        { frequency: 1, radius: 1, phase: 0 },
        { frequency: 2.5, radius: 0.2, phase: 0 },
      ],
    };
  });
  await expect(source(page)).toHaveAccessibleDescription(
    /Term 2's frequency must be a whole number from −64 to 64/,
  );
});

test("a degree change keeps a path's winding, scales its endpoints and dashes exactly the unvisited sheets", async ({
  page,
}) => {
  await open(page, "Twice around zero");
  const degree = page.getByRole("combobox", { name: "Degree n", exact: true });
  // Winding 2 at degree 3: every sheet is visited.
  await expect(readout(page, "w home after")).toHaveText("3 circuits");
  await expect(
    page.locator('[data-source^="root/value/other-sheet"]'),
  ).toHaveCount(0);
  await degree.selectOption("4");
  await settle(page);
  expect((await meta(page)).config.root).toMatchObject({
    degree: 4,
    to: 8 * Math.PI,
  });
  // gcd(4, 2) = 2: home after two circuits; sheets 1 and 3 never visited.
  await expect(readout(page, "w home after")).toHaveText("2 circuits");
  for (const m of [1, 3])
    await expect(
      page.locator(`[data-source="root/value/other-sheet/${m}"]`),
    ).toHaveAttribute("stroke-dasharray", /\d/);
  for (const m of [0, 2])
    await expect(
      page.locator(`[data-source="root/value/other-sheet/${m}"]`),
    ).toHaveCount(0);
  // Starting on sheet ω, the visited pair is ω and ω³: the guides are 0 and 2.
  await page
    .getByRole("combobox", { name: "Initial sheet", exact: true })
    .selectOption("1");
  await settle(page);
  await expect(
    page.locator('[data-source^="root/value/other-sheet"]'),
  ).toHaveCount(2);
  await degree.selectOption("5");
  await settle(page);
  await expect(readout(page, "w home after")).toHaveText("5 circuits");
  await expect(
    page.locator('[data-source^="root/value/other-sheet"]'),
  ).toHaveCount(0);
});

test("Follow its roots opens the 4D root journey with the fitted loop, keeping the 2D study", async ({
  page,
}) => {
  await copyLinks(page);
  await page.goto("/");
  const before = (await copied(page, page)).study;
  const f = await leafFit(page, 12);
  await expect(
    f.getByRole("button", { name: "Adopt fitted study", exact: true }),
  ).toBeEnabled();
  await f
    .getByRole("button", { name: "Follow its roots", exact: true })
    .click();
  await expect(fitDialog(page)).toHaveCount(0);
  await expect(page).toHaveURL(/study=4d/);
  await settle(page);
  await expect(source(page)).toHaveValue("fourier");
  await expect(loopNote(page)).toHaveText(/^Your loop, 12 terms\./);
  const root = (await meta(page)).config.root;
  expect(root.terms).toHaveLength(12);
  // The drawn start is z(0) of the fitted terms, placed by the defaults.
  const d = (await desc(page, "orthographic")).root;
  const z0 = startOf(root);
  expect(Math.hypot(d.z[0] - z0[0], d.z[1] - z0[1])).toBeLessThan(1e-9);
  // The 2D study is as it was.
  await chooseNotebook(page, "2d");
  expect((await copied(page, page)).study).toEqual(before);
});

test("Follow its roots from another 4D object opens the root journey it remembers", async ({
  page,
}) => {
  await open(page, "Twice around zero");
  await textbox(page, "Radius r").fill("0.6");
  await settle(page);
  await choosePreset(page, { label: "A cube beyond a cube" });
  await settle(page);
  await chooseNotebook(page, "2d");
  const f = await leafFit(page, 6);
  await f
    .getByRole("button", { name: "Follow its roots", exact: true })
    .click();
  // The 4D stage read settled before the loop arrived: wait for its study.
  await expect.poll(async () => (await meta(page)).config.object).toBe("root");
  await settle(page);
  // The remembered journey's radius and degree, with the drawn loop.
  expect((await meta(page)).config.root).toMatchObject({
    radius: 0.6,
    degree: 3,
    path: "fourier",
  });
  await expect(loopNote(page)).toHaveText(/^Your loop, 6 terms\./);
});

test("Draw a new loop goes to Draw a loop and back: canceling keeps the journey, following replaces only its path", async ({
  page,
}) => {
  await open(page, "A drawn leaf around zero");
  await expect(loopNote(page)).toHaveText(
    /^The example leaf, 8 terms, until you draw a loop\./,
  );
  await page
    .getByRole("combobox", { name: "Degree n", exact: true })
    .selectOption("4");
  await textbox(page, "Radius r").fill("0.8");
  await settle(page);
  const kept = await meta(page);
  const markup = await drawing(page);
  const entry = page.getByRole("button", { name: "Draw a new loop…" });
  await entry.click();
  let f = fitDialog(page);
  await expect(f).toBeVisible();
  // From the journey, its loop is all Draw a loop gives back.
  for (const name of [
    "Adopt fitted study",
    "Weave into lace",
    "Smooth into a circle",
  ])
    await expect(f.getByRole("button", { name, exact: true })).toHaveCount(0);
  await f.getByRole("button", { name: "Cancel drawing" }).click();
  await expect(fitDialog(page)).toHaveCount(0);
  await expect(entry).toBeFocused();
  await settle(page);
  expect((await meta(page)).config).toEqual(kept.config);
  expect(await drawing(page)).toBe(markup);
  // Use the journey's loop, refit it with four terms and follow its roots.
  await entry.click();
  f = fitDialog(page);
  await f
    .getByRole("button", { name: "Use current loop", exact: true })
    .click();
  await f.getByLabel("Total terms", { exact: true }).selectOption("4");
  const follow = f.getByRole("button", {
    name: "Follow its roots",
    exact: true,
  });
  await expect(follow).toBeEnabled();
  await follow.click();
  await expect
    .poll(async () => (await meta(page)).config.root.terms.length)
    .toBe(4);
  await settle(page);
  await expect(entry).toBeFocused();
  await expect(loopNote(page)).toHaveText(/^Your loop, 4 terms\./);
  const { terms, ...rest } = (await meta(page)).config.root;
  const { terms: _, ...before } = kept.config.root;
  expect(rest).toEqual(before);
  expect(terms).toHaveLength(4);
  expect(await drawing(page)).not.toBe(markup);
});

test("Draw a loop opened from the journey rings the branch point where the loop's own coordinates put z = 0", async ({
  page,
}) => {
  await open(page, "A drawn leaf around zero");
  await textbox(page, "Center offset").fill("0.4");
  await textbox(page, "Center direction").fill("1");
  await settle(page);
  await page.getByRole("button", { name: "Draw a new loop…" }).click();
  const f = fitDialog(page);
  await expect(f).toBeVisible();
  // z = r e^{iφ}(k + s) vanishes at s = −k, whatever r and φ: drawn y is
  // flipped, so the ring stands at (−0.4, 0) in both panes.
  const rings = f.locator("circle.fit-branch-point");
  await expect(rings).toHaveCount(1);
  await f
    .getByRole("button", { name: "Use current loop", exact: true })
    .click();
  await expect(rings).toHaveCount(2);
  for (const ring of await rings.all()) {
    expect(Number(await ring.getAttribute("cx"))).toBeCloseTo(-0.4, 12);
    expect(Number(await ring.getAttribute("cy"))).toBe(0);
  }
  await expect(f.getByText(/The ring marks z = 0/)).toBeVisible();
  // Draw a loop opened from the 2D notebook has no branch point to mark.
  await f.getByRole("button", { name: "Cancel drawing" }).click();
  await chooseNotebook(page, "2d");
  const plain = await leafFit(page, 8);
  await expect(plain.locator("circle.fit-branch-point")).toHaveCount(0);
});

// Each movie is 2 s at 15 fps: 30 frames, the repeated last left out. The
// whole journey closes: frame 0 stands for both t = 0 and its end.
for (const [study, seeks, frames] of [
  ["Twice around zero", [0, 0.5, 1], [0, 15, 0]],
  ["Roots in star order", [0, 0.4, 1], [0, 12, 0]],
] as const)
  test(`${study}: a decoded looping movie matches direct seeks and closes on its first frame`, async ({
    page,
  }) => {
    test.slow();
    await open(page, study);
    await page
      .getByRole("spinbutton", { name: "Duration (seconds)" })
      .fill("2");
    await playThenPause(page);
    const references: number[][] = [];
    for (const s of seeks) {
      await scrub(page, s);
      references.push(
        await page.evaluate(
          async ({ width, height }) => {
            const svg = document
              .getElementById("tesseract-artwork")!
              .cloneNode(true) as SVGSVGElement;
            svg.setAttribute("width", String(width));
            svg.setAttribute("height", String(height));
            const url = URL.createObjectURL(
              new Blob([new XMLSerializer().serializeToString(svg)], {
                type: "image/svg+xml",
              }),
            );
            try {
              const image = new Image();
              image.src = url;
              await image.decode();
              const c = document.createElement("canvas");
              c.width = width;
              c.height = height;
              const ctx = c.getContext("2d")!;
              ctx.drawImage(image, 0, 0);
              return Array.from(ctx.getImageData(0, 0, width, height).data);
            } finally {
              URL.revokeObjectURL(url);
            }
          },
          { width: 1000, height: 380 },
        ),
      );
    }
    await openShapeExport(page);
    await page
      .getByRole("combobox", { name: "Export format" })
      .selectOption("mp4");
    await page
      .getByRole("slider", { name: "Export resolution", exact: true })
      .fill("0.5");
    await page
      .getByRole("combobox", { name: "Export frame rate" })
      .selectOption("15");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /^Export MP4 video/ }).click();
    const path = (await (await download).path())!;
    const p = probe(path);
    if (p) {
      expect([p.width, p.height, p.frames]).toEqual([1000, 380, 30]);
      expect(p.durations.reduce((a, b) => a + b, 0)).toBe(2000);
    }
    expect(
      (await decodeVideo(page, await readFile(path))).duration,
    ).toBeCloseTo(2, 3);
    for (const [i, index] of frames.entries()) {
      const d = frameDifference(path, 1000, 380, index, references[i]);
      if (d) {
        expect(d.meanDifference).toBeLessThan(6);
        expect(d.unmatchedInk).toBeLessThan(0.02);
      }
    }
  });
