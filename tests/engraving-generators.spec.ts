import { test, expect, type Page } from "@playwright/test";
import { deflateRawSync } from "node:zlib";
import { presetStudy, planarStudy } from "../web/planar-link";
import {
  familyBudget,
  familyDefaults,
  familyTargets,
  familyValues,
} from "../web/planar-family";
import { observeAtlasWorkers, settled, copiedStudy } from "./gallery-helpers";
import { openAnimation, choosePreset, chooseColorScheme } from "./helpers";

const source = (format: "roulette" | "lissajous" | "implicit") => {
  const s = presetStudy(0);
  s.config.curve.format = format;
  s.config.samples = 300;
  s.config.lines = 12;
  s.config.curve.implicit.family.enabled = false;
  s.config.curve.implicit.cells = 48;
  return s;
};
const link = (study: unknown) =>
  `/#s=${deflateRawSync(JSON.stringify({ v: 1, notebook: "2d", study })).toString("base64url")}`;
async function load(page: Page, study: unknown) {
  await page.goto(link(study));
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
  await settled(page);
}

test("generator engraving admission has active continuous targets and separate contour ceilings", () => {
  const r = source("roulette");
  expect(familyTargets(r.config).map((t) => t.target)).toEqual([
    "rollArm",
    "rollPhase",
    "rollRadius",
    "rollFixed",
  ]);
  r.config.curve.roulette.roll = "line";
  expect(familyTargets(r.config).map((t) => t.target)).not.toContain(
    "rollFixed",
  );
  r.config.curve.roulette.arm = 0;
  expect(familyTargets(r.config).map((t) => t.target)).not.toContain(
    "rollPhase",
  );
  const l = source("lissajous");
  expect(familyTargets(l.config).map((t) => t.target)).toEqual([
    "lissajousA",
    "lissajousB",
    "lissajousPhase",
  ]);
  l.config.curve.lissajous.amplitudeX = 0;
  expect(familyTargets(l.config).map((t) => t.target)).not.toContain(
    "lissajousPhase",
  );
  l.config.curve.lissajous.frequencyY = 0;
  expect(familyTargets(l.config).map((t) => t.target)).not.toContain(
    "lissajousB",
  );
  l.config.curve.lissajous.frequencyX = 0;
  l.config.curve.lissajous.phase = 0;
  expect(familyTargets(l.config).map((t) => t.target)).not.toContain(
    "lissajousA",
  );
  const s = source("implicit");
  expect(familyTargets(s.config).map((t) => t.target)).toEqual([
    "contourLevel",
  ]);
  const f = { ...familyDefaults(s.config), enabled: true };
  expect(f.count).toBe(8);
  const budget = familyBudget(s.config, f);
  expect(budget).toMatchObject({
    grid: 8 * 49 ** 2,
    points: 8 * 131072,
    error: undefined,
  });
  expect(
    familyBudget(
      { ...s.config, samples: 32768, adaptive: true, adaptiveFrame: true },
      f,
    ),
  ).toEqual(budget);
  // The per-member contour ceiling admits exactly eight members; more is a
  // members error, not an aggregate refusal that fewer cells could fix.
  expect(familyBudget(s.config, { ...f, count: 9 })).toMatchObject({
    field: "Family members",
    error: "Family members must be a whole number from 2 to 8 for contours.",
  });
  expect(
    familyBudget(r.config, { ...familyDefaults(r.config), count: 9 }).error,
  ).toBeUndefined();
  s.config.curve.implicit.cells = 1024;
  expect(familyBudget(s.config, { ...f, count: 2 }).error).toMatch(/limit/);
  s.config.curve.implicit.family.enabled = true;
  expect(familyTargets(s.config)).toEqual([]);
  expect(
    familyTargets({
      ...r.config,
      kind: "offset",
      stack: { ...r.config.stack, enabled: true },
    }),
  ).toEqual([]);
  for (const format of ["field", "pursuit", "attractor"] as const)
    expect(
      familyTargets({ ...r.config, curve: { ...r.config.curve, format } }),
    ).toEqual([]);
});

const cases = [
  ["roulette", "rollArm", "arm"],
  ["roulette", "rollPhase", "phase"],
  ["roulette", "rollRadius", "radius"],
  ["roulette", "rollFixed", "fixedRadius"],
  ["lissajous", "lissajousA", "amplitudeX"],
  ["lissajous", "lissajousB", "amplitudeY"],
  ["lissajous", "lissajousPhase", "phase"],
  ["implicit", "contourLevel", "level"],
] as const;
for (const [format, target, field] of cases)
  test(`engraving ${target} matches independently assigned ordinary WASM requests`, async ({
    page,
  }, info) => {
    const s = source(format);
    if (target === "rollFixed") s.config.curve.roulette.radius = 0.1;
    s.family = {
      ...familyDefaults(s.config, target),
      enabled: true,
      count: 3,
      from: 0.25,
      to: 0.75,
      selected: 1,
    };
    // The schema must admit the target before a link can reach computation.
    expect(planarStudy(s).family).toEqual(s.family);
    await observeAtlasWorkers(page);
    await load(page, s);
    await expect(page.locator("#artwork [data-family-member]")).toHaveCount(3);
    const checks = await page.evaluate(
      async ({ s, format, field }) => {
        const log = (window as any).atlasWorkers.find(
          (l: any) => l.requests.length === 3,
        );
        const worker = new Worker(log.url);
        const out = [];
        for (let i = 0; i < 3; i++) {
          const config = structuredClone(s.config);
          (config.curve[format] as any)[field] = [0.25, 0.5, 0.75][i];
          const reply: any = await new Promise((resolve) => {
            worker.onmessage = (e) => resolve(e.data);
            worker.postMessage({
              ...log.requests[i].data,
              config,
              id: 100 + i,
            });
          });
          out.push({
            same:
              JSON.stringify(reply.result) ===
              JSON.stringify(log.replies[i].data.result),
            config: reply.config,
            actualConfig: log.replies[i].data.config,
            contours: reply.result.contours?.curve.contours.map((c: any) => ({
              closed: c.closed,
              n: c.points.length,
            })),
            normals: reply.result.contours?.normals.length,
            finite: reply.result.derived.filter(Boolean).length,
            took: log.replies[i].took,
          });
        }
        worker.terminate();
        return { out, maximum: log.maximum };
      },
      { s, format, field },
    );
    expect(checks.maximum).toBe(1);
    for (const c of checks.out) {
      expect(c.same).toBe(true);
      expect(c.actualConfig).toEqual(c.config);
    }
    if (format === "implicit") {
      for (const c of checks.out) {
        expect(c.contours).toHaveLength(2);
        expect(c.contours!.every((p: any) => p.closed && p.n > 20)).toBe(true);
        expect(c.normals).toBeGreaterThan(8);
      }
      await expect(
        page.locator("#artwork [data-testid=contour-path]"),
      ).toHaveCount(6);
      await page
        .getByLabel("Family presentation", { exact: true })
        .selectOption("selected");
      await expect(
        page.locator("#artwork [data-testid=contour-path]"),
      ).toHaveCount(2);
    } else expect(checks.out.every((c) => c.finite > 200)).toBe(true);
    await info.attach("worker-observations", {
      body: JSON.stringify(checks),
      contentType: "application/json",
    });
  });

test("contour engraving retains empty slots, source drafts, links and frozen reveal/window membership", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const s = source("implicit");
  s.config.curve.implicit.f = "x^2+y^2";
  s.family = {
    ...familyDefaults(s.config),
    enabled: true,
    count: 3,
    from: -1,
    to: 1,
    selected: 2,
  };
  await observeAtlasWorkers(page);
  await load(page, s);
  await expect(page.locator("#artwork [data-family-member]")).toHaveAttribute(
    "data-family-member",
    "2",
  );
  const meta = JSON.parse(
    (await page.locator("#artwork > desc").textContent())!,
  );
  expect(meta.family.partial).toBe(true);
  expect(
    meta.family.members.map((m: any) => [m.id, m.value, !!m.error]),
  ).toEqual([
    [0, -1, true],
    [1, 0, true],
    [2, 1, false],
  ]);
  const copied = await copiedStudy(page);
  expect(copied.study.family.target).toBe("contourLevel");
  await openAnimation(page);
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page
    .getByRole("slider", { name: "Animation progress", exact: true })
    .fill("1");
  await expect(page.locator("#artwork [data-family-member]")).toHaveCount(1);
  const calls = await page.evaluate(() =>
    (window as any).atlasWorkers.reduce(
      (n: number, l: any) => n + l.requests.length,
      0,
    ),
  );
  await page
    .getByRole("slider", { name: "Animation progress", exact: true })
    .fill("0");
  await expect(page.locator("#artwork [data-family-member]")).toHaveCount(0);
  await expect(page.locator("#artwork [data-testid=contour-path]")).toHaveCount(
    0,
  );
  expect(
    await page.evaluate(() =>
      (window as any).atlasWorkers.reduce(
        (n: number, l: any) => n + l.requests.length,
        0,
      ),
    ),
  ).toBe(calls);
});

for (const title of ["A roulette's woven petals", "Contours around two foci"])
  test(`authored engraving ${title} opens and plays its own motion`, async ({
    page,
  }) => {
    const { presets } = await import("../web/presets");
    const index = presets.findIndex((p) => p.title === title);
    expect(index).toBeGreaterThanOrEqual(0);
    const s = presetStudy(index);
    if (s.config.curve.format === "roulette")
      expect(s.config.kind).toBe("pedal");
    if (s.config.curve.format === "roulette")
      expect(s.config.samples).toBe(9600);
    await observeAtlasWorkers(page);
    await load(page, s);
    await expect(page.locator("#artwork [data-family-member]")).toHaveCount(
      s.family!.count,
    );
    await expect(page.getByText("Tracing…", { exact: true })).toHaveCount(0);
    await expect(
      page.getByText("Checking whether the trace closes…", { exact: true }),
    ).toHaveCount(0);
    if (s.config.curve.format === "implicit") {
      expect(s.config.curve.a).toBe(1.25);
      expect(s.family!.animation).toMatchObject({
        mode: "window",
        width: 4,
        duration: 3,
        pace: "ease",
        repeat: "back-and-forth",
      });
      await page.getByText("Members and limits", { exact: true }).click();
      await expect(page.locator(".family-panel details")).toContainText(
        "1,048,576",
      );
    }
    await openAnimation(page);
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await expect(page.locator("#artwork")).toHaveAttribute(
      "data-animation-time",
      /0\./,
    );
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(page.locator("#artwork [data-family-member]")).toHaveCount(
      s.family!.count,
    );
  });

for (const [width, height] of [
  [1440, 700],
  [390, 844],
  [844, 390],
])
  test(`contour engraving controls, refusals and return stay reachable at ${width} × ${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    const s = source("implicit");
    s.family = {
      ...familyDefaults(s.config),
      enabled: true,
      count: 3,
      from: 0.25,
      to: 0.75,
      selected: 1,
    };
    await load(page, s);
    const from = page.getByLabel("Family from", { exact: true });
    await from.fill("pi/10");
    await from.press("Tab");
    await settled(page);
    await expect(from).toHaveValue("pi/10");
    await page
      .getByLabel("Family presentation", { exact: true })
      .selectOption("selected");
    await page
      .getByRole("checkbox", { name: "Construction lines", exact: true })
      .check();
    await expect(
      page.locator(
        "#artwork [data-family-member='1'] [data-testid=contour-normal]",
      ),
    ).not.toHaveCount(0);
    await page
      .getByRole("checkbox", { name: "Family of levels", exact: true })
      .check();
    await expect(page.locator(".family-panel")).toContainText("not supported");
    await expect(
      page.getByRole("button", { name: "Export image", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("checkbox", { name: "Family of levels", exact: true })
      .uncheck();
    await settled(page);
    const members = page.getByLabel("Family members", { exact: true });
    await expect(members).toHaveAttribute("max", "8");
    await members.fill("9");
    // Fewer cells cannot admit a ninth contour, so the count itself is named.
    await expect(members).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator(".family-panel")).toContainText(
      "from 2 to 8 for contours",
    );
    await expect(page.locator(".family-panel")).not.toContainText(
      "Reduce members, grid cells or normals",
    );
    await members.fill("3");
    await settled(page);
    await expect(members).not.toHaveAttribute("aria-invalid", "true");
    const cells = page.getByLabel("Grid cells", { exact: true });
    await cells.fill("1024");
    await expect(page.locator(".family-panel")).toContainText(
      "Reduce members, grid cells or normals",
    );
    await cells.fill("48");
    await settled(page);
    await page.getByLabel("Level c", { exact: true }).fill("sqrt(2)");
    await page.getByLabel("Level c", { exact: true }).press("Tab");
    await settled(page);
    await page
      .getByRole("checkbox", { name: "Finite engraving", exact: true })
      .uncheck();
    await settled(page);
    await expect(page.getByLabel("Level c", { exact: true })).toHaveValue(
      "sqrt(2)",
    );
    await page
      .getByRole("checkbox", { name: "Finite engraving", exact: true })
      .check();
    await settled(page);
    await expect(from).toHaveValue("pi/10");
    // A source parameter that is dormant in the engraving remains intact.
    await expect(
      page.getByLabel("Family members", { exact: true }),
    ).toHaveValue("3");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });

for (const format of ["roulette", "implicit"] as const)
  test(`engraving ${format} frozen motion exports independently decoded endpoints`, async ({
    page,
  }) => {
    test.slow();
    const { presets } = await import("../web/presets");
    const { openExportSettings } = await import("./helpers");
    const { readFile } = await import("node:fs/promises");
    const { probe, frameDifference, decodeVideo } = await import("./video");
    const s = presetStudy(
      presets.findIndex(
        (p) =>
          p.title ===
          (format === "roulette"
            ? "A roulette's woven petals"
            : "Contours around two foci"),
      ),
    );
    await page.addInitScript(() => {
      Object.assign(window, { movieSVGs: [], recordMovie: false });
      const create = URL.createObjectURL;
      URL.createObjectURL = function (blob: Blob | MediaSource) {
        if (
          (window as any).recordMovie &&
          blob instanceof Blob &&
          blob.type === "image/svg+xml"
        )
          void blob.text().then((text) => (window as any).movieSVGs.push(text));
        return create.call(this, blob);
      };
    });
    s.family!.animation = {
      ...s.family!.animation!,
      duration: 0.4,
      repeat: "once",
    };
    await load(page, s);
    await openExportSettings(page);
    await page.getByLabel("Export resolution", { exact: true }).fill("1");
    await page.getByLabel("Export quality", { exact: true }).fill("80");
    await page
      .getByLabel("Export frame rate", { exact: true })
      .selectOption("15");
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    // Start with a longer motion for reliable pause, then export the short setup.
    await expect(
      page.getByRole("button", { name: "Back to study", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Back to study", exact: true })
      .click();
    await page.getByLabel("Duration (seconds)", { exact: true }).fill("8");
    await page
      .getByRole("button", { name: "Play animation", exact: true })
      .click();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const refs = [];
    const vectors: string[] = [];
    for (const time of [0, 1]) {
      await page
        .getByRole("slider", { name: "Animation progress", exact: true })
        .fill(String(time));
      await expect(page.locator("#artwork")).toHaveAttribute(
        "data-animation-time",
        String(time),
      );
      vectors.push(
        await page
          .locator("#artwork")
          .evaluate((svg) => new XMLSerializer().serializeToString(svg)),
      );
      refs.push(
        await page.locator("#artwork").evaluate(async (svg) => {
          const url = URL.createObjectURL(
            new Blob([new XMLSerializer().serializeToString(svg)], {
              type: "image/svg+xml",
            }),
          );
          try {
            const image = new Image();
            image.src = url;
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = 1000;
            canvas.height = 760;
            const ctx = canvas.getContext("2d")!;
            ctx.drawImage(image, 0, 0, 1000, 760);
            return Array.from(ctx.getImageData(0, 0, 1000, 760).data);
          } finally {
            URL.revokeObjectURL(url);
          }
        }),
      );
    }
    await page
      .getByRole("button", { name: "Back to study", exact: true })
      .click();
    await page.getByLabel("Duration (seconds)", { exact: true }).fill("0.4");
    await page.evaluate(() => {
      (window as any).recordMovie = true;
    });
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /Export MP4 video/ }).click();
    const file = await download,
      path = (await file.path())!;
    const exact = await page.evaluate(
      ({ vectors }) => {
        const signature = (text: string) => {
          const svg = new DOMParser().parseFromString(text, "image/svg+xml");
          return {
            paths: [...svg.querySelectorAll("path")].map((p) => [
              p.getAttribute("d"),
              p.getAttribute("stroke"),
            ]),
            scale: svg.documentElement.getAttribute("data-camera-scale"),
            center: svg.documentElement.getAttribute("data-camera-center"),
          };
        };
        const frames = (window as any).movieSVGs;
        return [0, 5].map((i, k) => ({
          got: signature(frames[i]),
          want: signature(vectors[k]),
        }));
      },
      { vectors },
    );
    for (const frame of exact) expect(frame.got).toEqual(frame.want);
    const decoded = probe(path);
    expect(decoded).not.toBeNull();
    expect(decoded!.frames).toBe(6);
    expect(decoded!.durations.reduce((a, b) => a + b, 0)).toBe(400);
    for (const [i, reference] of [
      [0, refs[0]],
      [5, refs[1]],
    ] as const) {
      const diff = frameDifference(path, 1000, 760, i, reference);
      expect(diff).not.toBeNull();
      // Exact vectors/camera above establish endpoint identity; this permits
      // MP4's lossy color quantization on the dense weave (observed 2.68/255).
      expect(diff!.meanDifference).toBeLessThan(4);
      expect(diff!.unmatchedInk).toBeLessThan(0.08);
    }
    const video = await decodeVideo(page, await readFile(path));
    expect(video.duration).toBeCloseTo(0.4, 3);
    expect(video.first.hash).not.toBe(video.last.hash);
  });

test("contour reversal preserves every component and discontinuity without cross-gap joins", async ({
  page,
}) => {
  const s = source("implicit");
  s.config.curve.implicit.f = "1/(x-.0501)-y";
  s.family = {
    ...familyDefaults(s.config),
    enabled: true,
    count: 3,
    from: -0.3,
    to: 0.3,
  };
  await observeAtlasWorkers(page);
  await load(page, s);
  const result = () =>
    page.evaluate(() => {
      const logs = (window as any).atlasWorkers;
      return logs
        .filter((l: any) => l.requests.length >= 3)
        .at(-1)
        ?.replies.slice(-3)
        .map((r: any) => r.data.result.contours);
    });
  // A fragment-only load can settle on the previous study before the new
  // family starts, so wait for the replies of the requested levels.
  const levels = async (expected: number[]) => {
    await expect
      .poll(async () => ((await result()) ?? []).map((r: any) => r.curve.level))
      .toEqual(expected);
    return result();
  };
  const forward = await levels([-0.3, 0, 0.3]);
  for (const r of forward) {
    expect(r.curve.contours).toHaveLength(2);
    expect(r.discontinuities.length).toBeGreaterThan(0);
    for (const c of r.curve.contours) {
      expect(c.closed).toBe(false);
      expect(c.points.length).toBeGreaterThan(10);
      expect(
        c.points.every(
          (p: any) => (p.x - 0.0501) * (c.points[0].x - 0.0501) > 0,
        ),
      ).toBe(true);
      expect(
        c.points.every(
          (p: any) => Math.abs(1 / (p.x - 0.0501) - p.y - r.curve.level) < 1e-6,
        ),
      ).toBe(true);
    }
  }
  await load(page, { ...s, family: { ...s.family, from: 0.3, to: -0.3 } });
  expect(await levels([0.3, 0, -0.3])).toEqual(forward.reverse());
});

for (const theme of ["light", "dark"] as const)
  test(`new engraving artwork and transport observations in ${theme}`, async ({
    page,
  }, info) => {
    const { presets } = await import("../web/presets");
    await page.emulateMedia({ colorScheme: theme });
    await observeAtlasWorkers(page);
    await page.goto("/");
    await chooseColorScheme(page, "cobalt");
    for (const title of [
      "A roulette's woven petals",
      "Contours around two foci",
    ]) {
      const s = presetStudy(presets.findIndex((p) => p.title === title));
      await choosePreset(page, { label: title });
      await settled(page);
      await expect(page.locator("#artwork [data-family-member]")).toHaveCount(
        s.family!.count,
      );
      await expect(page.locator("#artwork text")).toHaveCount(0);
      const observation = await page.evaluate((members) => {
        const l = (window as any).atlasWorkers
          .filter((l: any) => l.requests.length > 1)
          .at(-1);
        const replies = l.replies.slice(-members);
        const requests = l.requests.slice(-members);
        const results = replies.map((r: any) => r.data.result);
        const count = (v: any): number =>
          typeof v === "number"
            ? 1
            : v && typeof v === "object"
              ? Object.values(v).reduce<number>((a, v) => a + count(v), 0)
              : 0;
        return {
          members: results.length,
          maximum: l.maximum,
          wallMilliseconds:
            replies.at(-1).took + requests.at(-1).started - requests[0].started,
          memberMilliseconds: replies.map((r: any) => r.took),
          retainedNumbers: results.reduce(
            (a: number, v: any) => a + count(v),
            0,
          ),
          maxDerivedRadius: results.reduce(
            (largest: number, r: any) =>
              r.derived.reduce(
                (largest: number, p: any) =>
                  p ? Math.max(largest, Math.hypot(p.x, p.y)) : largest,
                largest,
              ),
            0,
          ),
        };
      }, s.family!.count);
      expect(observation.members).toBe(s.family!.count);
      expect(observation.maximum).toBe(1);
      expect(observation.retainedNumbers).toBeLessThan(4000000);
      if (s.config.curve.format === "roulette")
        expect(observation.maxDerivedRadius).toBeLessThan(4);
      const { writeFile } = await import("node:fs/promises");
      await writeFile(
        `/tmp/372-${s.config.curve.format}-${theme}-metrics.json`,
        JSON.stringify(observation, null, 2),
      );
      await info.attach(`${s.config.curve.format}-transport`, {
        body: JSON.stringify(observation),
        contentType: "application/json",
      });
      await page.screenshot({
        path: `/tmp/372-${s.config.curve.format}-${theme}.png`,
      });
    }
  });

test("generator target defaults stay valid beside edited radii and nonnegative distances", () => {
  const s = source("roulette");
  s.config.curve.roulette = {
    roll: "inside",
    fixedRadius: 0.21,
    radius: 0.2,
    arm: 0.01,
    phase: 0,
  };
  const radius = familyDefaults(s.config, "rollRadius");
  expect(radius.from).toBeGreaterThan(0);
  expect(radius.to).toBeLessThan(0.21);
  const fixed = familyDefaults(s.config, "rollFixed");
  expect(fixed.from).toBeGreaterThan(0.2);
  expect(fixed.to).toBeGreaterThanOrEqual(0.21);
  const arm = familyDefaults(s.config, "rollArm");
  expect(arm.from).toBeGreaterThanOrEqual(0);
});

test("expensive admitted contour engraving stays serial and disabling retires delayed work", async ({
  page,
}, info) => {
  const s = source("implicit");
  s.config.curve.implicit.cells = 496;
  s.family = {
    ...familyDefaults(s.config),
    enabled: true,
    from: 0.15,
    to: 2.6,
  };
  expect(familyBudget(s.config, s.family).error).toBeUndefined();
  await observeAtlasWorkers(page, 80);
  await load(page, s);
  const observation = await page.evaluate(() => {
    const l = (window as any).atlasWorkers.find(
      (l: any) => l.requests.length === 8,
    );
    return {
      maximum: l.maximum,
      requests: l.requests.length,
      memberMilliseconds: l.replies.map((r: any) => r.took),
      wallMilliseconds:
        l.replies.at(-1).took +
        l.requests.at(-1).started -
        l.requests[0].started,
      serializedBytes: l.replies.reduce(
        (a: number, r: any) => a + JSON.stringify(r.data.result).length,
        0,
      ),
    };
  });
  expect(observation.maximum).toBe(1);
  expect(observation.requests).toBe(8);
  await page.getByLabel("F(x, y)", { exact: true }).fill("x^2+y^2");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).atlasWorkers.some((l: any) => l.requests.length > 8),
      ),
    )
    .toBe(true);
  const started = Date.now();
  await page
    .getByRole("checkbox", { name: "Finite engraving", exact: true })
    .uncheck();
  await settled(page);
  await expect(page.locator("#artwork [data-family-member]")).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as any).atlasWorkers.find((l: any) => l.requests.length > 8)
          .terminated,
    ),
  ).toBe(true);
  const ordinary = await page.evaluate(() => {
    const l = (window as any).atlasWorkers
      .filter((l: any) => !l.terminated && l.replies.length)
      .at(-1);
    return l.replies.at(-1).data.result.contours.curve;
  });
  expect(ordinary.contours).toHaveLength(1);
  for (const p of ordinary.contours[0].points)
    expect(Math.abs(p.x * p.x + p.y * p.y - 1)).toBeLessThan(1e-8);
  const metrics = {
    ...observation,
    disableAndRestoreMilliseconds: Date.now() - started,
    artificialReplyDelayMilliseconds: 80,
  };
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    "/tmp/372-expensive-contour-metrics.json",
    JSON.stringify(metrics, null, 2),
  );
  await info.attach("expensive-contour", {
    body: JSON.stringify(metrics),
    contentType: "application/json",
  });
});
