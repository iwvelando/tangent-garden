import { test, expect, type Page } from "@playwright/test";
import { deflateRawSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { choosePreset, exportImage, openAnimation } from "./helpers";
import { engines, watchEngines } from "./engines";
import { wireStudy } from "./study-link-wire";
import { planarBracket as bracket } from "../web/planar-story";
import {
  describeClass,
  observedClass,
  planarStateReading,
  planarStories,
  planarStoryContext,
  planarStoryNote,
  type PlanarStoryId,
} from "../web/planar-story";
import { eventStates } from "../web/event-story";
import { presets } from "../web/presets";
import { presetStudy } from "../web/planar-link";
import type { Config, ContourResult, LevelTopology } from "../web/types";

// The planar topology events (web/planar-story.ts): Cassini's two loops
// joining at the lemniscate, four wells' loops joining into a ring whose
// hollow then closes, and three loops meeting at a monkey saddle. Their
// critical levels and the loops on either side are derived analytically
// (docs/mathematics.md, Planar events); engine/contour_events_test.go
// checks the engine's classification of them on several grids. The trace
// is a finite observation compared against the analysis, never the proof.

// The fields, written here independently of the app, and the classes the
// analysis gives each side, in ascending order of level.
const fields: Record<PlanarStoryId, (x: number, y: number) => number> = {
  "two-pools": (x, y) => ((x - 1) ** 2 + y ** 2) * ((x + 1) ** 2 + y ** 2),
  "four-pools": (x, y) => x ** 4 - 4 * x ** 2 + y ** 4 - 4 * y ** 2,
  "three-pools": (x, y) =>
    (x ** 3 - 3 * x * y ** 2 - 1) ** 2 + (3 * x ** 2 * y - y ** 3) ** 2,
};
const analysis: Record<
  PlanarStoryId,
  { critical: number[]; classes: string[] }
> = {
  "two-pools": { critical: [1], classes: ["-()-()", "-()"] },
  "four-pools": {
    critical: [-4, 0],
    classes: ["-()-()-()-()", "-(+())", "-()"],
  },
  "three-pools": { critical: [1], classes: ["-()-()-()", "-()"] },
};
const ids = Object.keys(fields) as PlanarStoryId[];
const storyPreset = (id: PlanarStoryId) =>
  presets.findIndex((p) => p.story === id);
const storyConfig = (id: PlanarStoryId): Config =>
  structuredClone(presets[storyPreset(id)].config);

// A complete trace of closed loops with the given code.
function trace(
  code: string,
  change: Partial<ContourResult> = {},
  topology: Partial<LevelTopology> = {},
): ContourResult {
  return {
    window: { xMin: -2, xMax: 2, yMin: -2, yMax: 2 },
    columns: 160,
    rows: 160,
    curve: {
      level: 0,
      contours: [
        {
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 0, y: 1 },
          ],
          closed: true,
        },
      ],
    },
    family: [],
    normals: [],
    discontinuities: [],
    nonfinite: 0,
    usesA: false,
    topology: { loops: [], open: 0, rejected: 0, class: code, ...topology },
    ...change,
  };
}

test("each story's sides lie between its critical levels, with the analysis' classes", () => {
  for (const id of ids) {
    const s = planarStories[id],
      a = analysis[id];
    expect(s.f).toBe(presets[storyPreset(id)].config.curve.implicit.f);
    expect(s.events.map((e) => e.critical)).toEqual(a.critical);
    expect(s.sides.map((side) => side.class)).toEqual(a.classes);
    const bounds = [s.range[0], ...a.critical, s.range[1]];
    s.sides.forEach((side, i) => {
      expect(side.level).toBeGreaterThan(bounds[i]);
      expect(side.level).toBeLessThan(bounds[i + 1]);
    });
    // The preset opens at its first event's before state.
    const opening = presets[storyPreset(id)].config.curve.implicit.level;
    expect(opening).toBe(bracket(s, 0).levels.before);
  }
});

test("the window's half-widths hold every point with F ≤ c up to the story's reach, and no more than needed", () => {
  for (const id of ids) {
    const s = planarStories[id],
      f = fields[id],
      top = s.range[1],
      e = s.extent(top);
    let reachX = 0,
      reachY = 0,
      outside = 0;
    const n = 600,
      span = 2 * Math.max(e.x, e.y);
    for (let i = 0; i <= n; i++)
      for (let j = 0; j <= n; j++) {
        const x = -span + (2 * span * i) / n,
          y = -span + (2 * span * j) / n;
        if (f(x, y) <= top) {
          if (Math.abs(x) > e.x || Math.abs(y) > e.y) outside++;
          reachX = Math.max(reachX, Math.abs(x));
          reachY = Math.max(reachY, Math.abs(y));
        }
      }
    expect(outside).toBe(0);
    // Cassini's and the wells' bounds are attained; the petals' disk is a
    // bound on |z| that the curve reaches along the roots' directions.
    expect(reachX).toBeGreaterThan(0.97 * e.x);
    if (id !== "three-pools") expect(reachY).toBeGreaterThan(0.97 * e.y);
    // The preset's window holds them strictly.
    const w = storyConfig(id).curve.implicit.window;
    expect(w.xMin < -e.x && w.xMax > e.x && w.yMin < -e.y && w.yMax > e.y).toBe(
      true,
    );
  }
});

test("a story applies while its recipe and a window holding its curve remain", () => {
  const id = "four-pools",
    base = storyConfig(id),
    s = planarStories[id];
  const context = (change: (c: Config) => void, shown?: number) => {
    const c = structuredClone(base);
    change(c);
    return planarStoryContext(c, id, shown);
  };
  expect(context(() => {})).toMatchObject({
    eligible: true,
    event: 0,
    state: "before",
  });
  // The level, grid, family, normals and a keep it.
  for (const change of [
    (c: Config) => (c.curve.implicit.level = 1.5),
    (c: Config) => (c.curve.implicit.cells = 40),
    (c: Config) => (c.curve.implicit.family.enabled = false),
    (c: Config) => (c.lines = 12),
    (c: Config) => (c.curve.a = 7),
    (c: Config) => (c.curve.implicit.window.xMax = 40),
  ])
    expect(context(change)?.eligible).toBe(true);
  // A level on a side between the events opens the event it leads to.
  expect(context((c) => (c.curve.implicit.level = -2))).toMatchObject({
    event: 1,
    state: "before",
  });
  expect(context((c) => (c.curve.implicit.level = -2), 0)).toMatchObject({
    event: 0,
    state: "after",
  });
  // Another expression, even one drawing the same curve, is not the
  // story's.
  const other = context((c) => (c.curve.implicit.f = "x^4+y^4-4*x^2-4*y^2"));
  expect(other).toMatchObject({ eligible: false });
  expect(other && !other.eligible && other.reason).toContain("expression");
  // A window that could cut the curve at the top of the range, or a
  // missing bound.
  const e = s.extent(s.range[1]);
  for (const change of [
    (c: Config) => (c.curve.implicit.window.xMax = e.x),
    (c: Config) => (c.curve.implicit.window.xMin = -e.x),
    (c: Config) => (c.curve.implicit.window.yMin = -2),
    (c: Config) => (c.curve.implicit.window.yMax = NaN),
  ]) {
    const cut = context(change);
    expect(cut).toMatchObject({ eligible: false });
    expect(cut && !cut.eligible && cut.reason).toContain(
      "window no longer holds the curve at every level up to 4",
    );
  }
  // No story, or not an implicit curve.
  expect(planarStoryContext(base, undefined)).toBeNull();
  expect(
    planarStoryContext(
      { ...base, curve: { ...base.curve, format: "parametric" } },
      id,
    ),
  ).toBeNull();
});

test("the trace is compared only when it is complete", () => {
  expect(observedClass(trace("-()-()"))).toEqual({
    complete: true,
    class: "-()-()",
  });
  for (const [r, why] of [
    [trace("", { topology: undefined }), "was not classified"],
    [trace("", { curve: { level: 0, contours: [] } }), "has no curve"],
    [trace("-()", {}, { rejected: 2 }), "changes sign across a pole or a jump"],
    [
      trace("-()", { nonfinite: 3 }, { open: 1 }),
      "is open beside cells left out",
    ],
    [trace("", {}, { open: 2 }), "is cut by the window's edge"],
    [
      trace("-()", { nonfinite: 3 }),
      "leaves out cells where F is not a number",
    ],
    [
      trace("", {}, { unclassified: true }),
      "has more loops than are classified",
    ],
  ] as const)
    expect(observedClass(r)).toEqual({ complete: false, why });
});

test("classes read in words", () => {
  expect(describeClass("")).toBe("0 loops");
  expect(describeClass("-()")).toBe("1 loop");
  expect(describeClass("-()-()-()")).toBe("3 loops");
  expect(describeClass("-(+())")).toBe("2 loops, 1 loop inside another");
  expect(describeClass("-()-(+(-()))")).toBe("4 loops, 2 loops inside another");
});

test("story notes compare the trace and claim no class at a critical level", () => {
  const two = planarStories["two-pools"],
    wells = planarStories["four-pools"];
  expect(planarStoryNote(two, 0.81, trace("-()-()"))).toBe(
    "Below the critical level c = 1 the curve is two separate loops, one about each focus, and the trace agrees.",
  );
  expect(planarStoryNote(wells, -2, trace("-(+())"))).toBe(
    "Between the critical levels c = −4 and c = 0 the curve is a ring: one loop inside another, about the hill at the origin, and the trace agrees.",
  );
  // Too close to the hollow's closing for the grid.
  expect(planarStoryNote(wells, -0.001, trace("-()"))).toBe(
    "Between the critical levels c = −4 and c = 0 the curve is a ring: one loop inside another, about the hill at the origin, but the trace reads 1 loop: its hollow is finer than this grid resolves at this level. Use more cells, or a level farther from 0.",
  );
  expect(planarStoryNote(wells, -3.99, trace("-()-()-()-()"))).toContain(
    "its necks are finer than this grid resolves at this level. Use more cells, or a level farther from −4.",
  );
  expect(planarStoryNote(wells, 2, trace("-()-()"))).toBe(
    "Above the critical level c = 0 the curve is one loop, but the trace reads 2 loops. Use more cells.",
  );
  expect(planarStoryNote(two, 1.21, trace("", {}, { open: 2 }))).toBe(
    "Above the critical level c = 1 the curve is one loop about both foci, but this trace is cut by the window's edge, so it cannot confirm that.",
  );
  // The range's ends are covered.
  expect(planarStoryNote(two, 1.69, trace("-()"))).toContain(
    "and the trace agrees",
  );
  expect(planarStoryNote(two, 3, trace("-()"))).toBe(
    "The story's analysis covers levels from 0.49 to 1.69; at c = 3 the note describes the trace alone.",
  );
  for (const [s, level] of [
    [two, 1],
    [wells, -4],
    [wells, 0],
    [planarStories["three-pools"], 1],
  ] as const) {
    const n = planarStoryNote(s, level, trace("-()-()"));
    expect(n).toContain(
      "The curve is singular there, so no count of loops is claimed",
    );
    expect(n).not.toMatch(/trace (agrees|reads)/);
  }
  expect(planarStateReading(two, 0, "critical", trace("-()-()"))).toBe(
    "singular",
  );
  expect(planarStateReading(two, 0, "before", trace("-()-()"))).toBe("agrees");
  expect(planarStateReading(two, 0, "after", trace("-()-()"))).toBe("differs");
  expect(planarStateReading(two, 0, "after", trace("", {}, { open: 1 }))).toBe(
    "incomplete",
  );
});

// In the notebook.

const strip = (page: Page) => page.locator(".event-strip");
const state = (page: Page, s: string) =>
  page.locator(`.event-state[data-state="${s}"]`);
const note = (page: Page) => page.getByTestId("contour-note");
const input = (page: Page, name: string) =>
  page.getByLabel(name, { exact: true });
async function settled(page: Page) {
  await expect(page.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
}
async function shown(page: Page): Promise<Config> {
  return JSON.parse((await page.locator("#artwork desc").textContent())!);
}
async function openStory(page: Page, id: PlanarStoryId) {
  await page.goto("/");
  await expect(page.locator("#artwork")).toBeVisible();
  await choosePreset(page, String(storyPreset(id)));
  await settled(page);
  await expect(strip(page)).toHaveAttribute("data-previews", "3");
}
// The study as its link carries it.
async function linked(page: Page) {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const copied = page.getByText("Link copied", { exact: true });
  await expect(copied).toHaveCount(0);
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(copied).toBeVisible();
  const href = await page.evaluate(() => navigator.clipboard.readText());
  await page.mouse.click(1, 1);
  return { href, study: wireStudy(/#s=(.*)$/.exec(href)![1]) };
}
const token = (study: unknown) =>
  deflateRawSync(
    Buffer.from(JSON.stringify({ v: 1, notebook: "2d", study })),
  ).toString("base64url");
async function seek(page: Page, time: string) {
  await page
    .getByRole("slider", { name: "Animation progress", exact: true })
    .fill(time);
  await expect(page.locator("#artwork")).toHaveAttribute(
    "data-animation-time",
    time,
  );
}

for (const id of ids)
  test(`${id}: the strip reads each state and chooses it, changing only the level`, async ({
    page,
  }) => {
    await openStory(page, id);
    const s = planarStories[id];
    await expect(state(page, "before")).toHaveAttribute("aria-pressed", "true");
    await expect(state(page, "before")).toContainText("Trace agrees");
    await expect(state(page, "after")).toContainText("Trace agrees");
    await expect(state(page, "critical")).toContainText("Singular");
    // Each preview is geometry alone: one path per traced contour.
    await expect(strip(page).locator("svg text")).toHaveCount(0);
    await expect(state(page, "before").locator("svg path")).toHaveCount(
      analysis[id].classes[0].split("(").length - 1,
    );
    await expect(note(page)).toContainText("and the trace agrees");
    // The reader's own drawing settings, which every state keeps.
    await page
      .getByRole("checkbox", { name: "Other levels", exact: true })
      .uncheck();
    const start = (await linked(page)).study;
    expect(start.story).toBe(id);
    for (const next of ["critical", "after", "critical", "before"] as const) {
      await state(page, next).click();
      await settled(page);
      await expect(state(page, next)).toHaveAttribute("aria-pressed", "true");
      const level = bracket(s, 0).levels[next];
      expect((await shown(page)).curve.implicit.level).toBe(level);
      await expect(input(page, "Level c")).toHaveValue(String(level));
      await expect(note(page)).toContainText(
        next === "critical"
          ? "no count of loops is claimed"
          : "and the trace agrees",
      );
      const now = (await linked(page)).study;
      expect(now).toEqual({
        ...start,
        config: {
          ...start.config,
          curve: {
            ...start.config.curve,
            implicit: { ...start.config.curve.implicit, level },
          },
        },
      });
    }
    // The keyboard reaches and presses a state.
    await state(page, "after").focus();
    await page.keyboard.press("Enter");
    await settled(page);
    expect((await shown(page)).curve.implicit.level).toBe(
      bracket(s, 0).levels.after,
    );
  });

test("with two events the chooser shows each one's states, and the level leads it", async ({
  page,
}) => {
  await openStory(page, "four-pools");
  const choice = (i: number) =>
    page.locator(`.event-choice[data-event="${i}"]`);
  await expect(choice(0)).toHaveAttribute("aria-pressed", "true");
  await expect(state(page, "critical")).toContainText("c = −4");
  // After the first event is the ring, before the second.
  await state(page, "after").click();
  await settled(page);
  expect((await shown(page)).curve.implicit.level).toBe(-2);
  await expect(choice(0)).toHaveAttribute("aria-pressed", "true");
  await expect(state(page, "after")).toHaveAttribute("aria-pressed", "true");
  // Choosing the next event changes only what the strip shows.
  await choice(1).click();
  await expect(strip(page)).toHaveAttribute("data-previews", "3");
  expect((await shown(page)).curve.implicit.level).toBe(-2);
  await expect(state(page, "before")).toHaveAttribute("aria-pressed", "true");
  await expect(state(page, "critical")).toContainText("A point inside");
  await expect(state(page, "after")).toContainText("Trace agrees");
  await state(page, "critical").click();
  await settled(page);
  expect((await shown(page)).curve.implicit.level).toBe(0);
  await expect(note(page)).toContainText("shrinks to a point at the origin");
  // A level typed onto the first event's state moves the strip there.
  await input(page, "Level c").fill("-6");
  await settled(page);
  await expect(choice(0)).toHaveAttribute("aria-pressed", "true");
  await expect(state(page, "before")).toHaveAttribute("aria-pressed", "true");
});

test("an edit that leaves the recipe or its window sets the story aside until restored", async ({
  page,
}) => {
  await openStory(page, "two-pools");
  const f = input(page, "F(x, y)");
  await f.fill("((x-1)^2+y^2)*((x+1)^2+y^2)+0");
  await settled(page);
  await expect(strip(page).locator(".event-refusal")).toContainText(
    "F is no longer the story's expression",
  );
  for (const s of eventStates) await expect(state(page, s)).toBeDisabled();
  await expect(note(page)).not.toContainText("critical level");
  await f.fill(planarStories["two-pools"].f);
  await settled(page);
  await expect(strip(page).locator(".event-refusal")).toHaveCount(0);
  await expect(strip(page)).toHaveAttribute("data-previews", "3");
  await expect(note(page)).toContainText("and the trace agrees");
  // A window too narrow for the top of the range: the curve at this level
  // still fits, but the story can no longer vouch for every level.
  const xTo = input(page, "Window x to");
  await xTo.fill("1.5");
  await settled(page);
  await expect(strip(page).locator(".event-refusal")).toContainText(
    "window no longer holds the curve",
  );
  // At a level the narrow window cuts, the plain note says so, and no
  // topology is claimed.
  await input(page, "Level c").fill("1.69");
  await settled(page);
  await expect(note(page)).toContainText("open contour");
  await expect(note(page)).not.toContainText("trace agrees");
  await xTo.fill("1.7");
  await input(page, "Level c").fill("0.81");
  await settled(page);
  await expect(state(page, "before")).toHaveAttribute("aria-pressed", "true");
  await expect(state(page, "before")).toContainText("Trace agrees");
});

test("a level still being evaluated settles before a state applies; a study chosen meanwhile wins", async ({
  page,
}) => {
  await watchEngines(page, 8, { scalars: 600 });
  await openStory(page, "two-pools");
  const level = input(page, "Level c");
  await level.fill("0.9");
  await state(page, "after").click();
  await settled(page);
  await expect
    .poll(async () => (await shown(page)).curve.implicit.level)
    .toBe(1.21);
  await expect(level).toHaveValue("1.21");
  await expect(state(page, "after")).toHaveAttribute("aria-pressed", "true");
  await level.fill("0.95");
  await state(page, "before").click();
  await choosePreset(page, String(storyPreset("three-pools")));
  await settled(page);
  await expect
    .poll(async () => (await shown(page)).curve.implicit.f)
    .toBe(planarStories["three-pools"].f);
  await page.waitForTimeout(800);
  expect((await shown(page)).curve.implicit.level).toBe(0.64);
});

test("previews are bounded and classified: three per refresh, none for a level or a theme", async ({
  page,
}) => {
  await watchEngines(page, 8);
  const computes = async () =>
    (await engines(page)).reduce((n, e) => n + (e.sent.compute ?? 0), 0);
  await page.goto("/");
  await settled(page);
  const opened = await computes();
  await choosePreset(page, String(storyPreset("two-pools")));
  await settled(page);
  await expect(strip(page)).toHaveAttribute("data-previews", "3");
  // The study, then its three previews.
  await expect.poll(async () => (await computes()) - opened).toBe(4);
  await expect(strip(page).locator("svg")).toHaveCount(3);
  // A state changes the level alone.
  await state(page, "after").click();
  await settled(page);
  await expect.poll(async () => (await computes()) - opened).toBe(5);
  // The theme redraws the previews without a calculation, in its ink.
  const ink = () =>
    state(page, "before").locator("path").first().getAttribute("stroke");
  const light = await ink();
  await page.getByRole("button", { name: "Use dark background" }).click();
  await expect.poll(ink).not.toBe(light);
  await page.waitForTimeout(300);
  expect((await computes()) - opened).toBe(5);
  // Rapid edits replace one another: previews wait for the study to
  // settle, and a refresh in flight finishes at most one calculation.
  const cells = input(page, "Grid cells");
  const before = await computes();
  await cells.fill("120");
  await expect(strip(page).locator("svg")).toHaveCount(0);
  for (const n of ["130", "140"]) await cells.fill(n);
  await settled(page);
  await expect(strip(page)).toHaveAttribute("data-previews", "3");
  await expect(strip(page).locator("svg")).toHaveCount(3);
  const added = (await computes()) - before;
  expect(added).toBeGreaterThanOrEqual(4);
  expect(added).toBeLessThanOrEqual(7);
});

test("a story travels in its link; older links and other studies have none", async ({
  page,
}) => {
  await openStory(page, "three-pools");
  await state(page, "critical").click();
  await settled(page);
  const { href, study } = await linked(page);
  expect(study.story).toBe("three-pools");
  const other = await page.context().newPage();
  await other.goto(href);
  await expect(other.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(
    other.locator('.event-state[data-state="critical"]'),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(other.getByTestId("contour-note")).toContainText(
    "no count of loops is claimed",
  );
  // The same study without its story: an ordinary implicit study.
  const { story: _, ...plain } = study;
  await other.goto(`/#s=${token(plain)}`);
  await expect(other).not.toHaveURL(/#s=/);
  await expect(other.locator(".plot-wrap")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(other.locator(".event-strip")).toHaveCount(0);
  await expect(other.getByTestId("contour-note")).not.toContainText(
    "critical level",
  );
  // An unknown story is refused by name, never replaced by a known one.
  await other.goto(`/#s=${token({ ...study, story: "five-pools" })}`);
  await expect(
    other.getByText(
      "story must be one of two-pools, four-pools, three-pools.",
      { exact: false },
    ),
  ).toBeVisible();
  await expect(other.locator(".event-strip")).toHaveCount(0);
  await other.close();
  // Every other example opens without a story.
  for (let i = 0; i < presets.length; i++)
    if (!presets[i].story) expect(presetStudy(i).story).toBeUndefined();
});

test("the film rests at every state, its notes follow it, and a held frame exports as the direct study", async ({
  page,
}) => {
  test.slow();
  await openStory(page, "two-pools");
  // The direct study at the critical level, exported.
  await state(page, "critical").click();
  await settled(page);
  const exported = async () => {
    const download = page.waitForEvent("download");
    await exportImage(page, "SVG");
    const svg = await readFile((await (await download).path())!, "utf8");
    return page.evaluate((s) => {
      const doc = new DOMParser().parseFromString(s, "image/svg+xml");
      return {
        config: JSON.parse(doc.querySelector("desc")!.textContent!),
        paths: [...doc.querySelectorAll("path")].map((p) =>
          p.getAttribute("d"),
        ),
      };
    }, svg);
  };
  const direct = await exported();
  expect(direct.paths.length).toBeGreaterThan(0);
  // The film, from the example's own opening: 10.5 s, resting 1.5 s at
  // 0.81, moving to 1, resting there 1.5 s, moving to 1.21 and resting.
  await choosePreset(page, String(storyPreset("two-pools")));
  await settled(page);
  await openAnimation(page);
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  for (const [time, level] of [
    ["0", 0.81],
    ["0.1", 0.81],
    ["0.43", 1],
    ["0.5", 1],
    ["0.57", 1],
    ["0.95", 1.21],
    ["1", 1.21],
  ] as const) {
    await seek(page, time);
    expect((await shown(page)).curve.implicit.level).toBe(level);
    await expect(note(page)).toContainText(
      level === 1 ? "no count of loops is claimed" : "and the trace agrees",
    );
  }
  // Between rests the level moves, and the note follows the frame.
  await seek(page, "0.3");
  const moving = (await shown(page)).curve.implicit.level;
  expect(moving).toBeGreaterThan(0.81);
  expect(moving).toBeLessThan(1);
  await expect(note(page)).toContainText("Below the critical level c = 1");
  // A held critical frame exports as the direct study at that level.
  await seek(page, "0.5");
  const held = await exported();
  expect(held.paths).toEqual(direct.paths);
  // Its record adds the phrase's stage and value to the same study.
  const { animation, ...study } = held.config;
  expect(study).toEqual(direct.config);
  expect(animation.phrase).toMatchObject({
    phase: "Crossing at the origin",
    target: "contourLevel",
    value: 1,
  });
  // Choosing a state ends the film and stands the study there.
  await state(page, "before").click();
  await expect(page.locator("#artwork")).not.toHaveAttribute(
    "data-animation-progress",
  );
  expect((await shown(page)).curve.implicit.level).toBe(0.81);
});

test("every engine playing a story's film classifies its frames", async ({
  page,
}) => {
  // Eight cores: playback adds a helper engine beside the app's.
  await watchEngines(page, 8);
  await page.addInitScript(() => {
    const seen = { classified: 0, plain: 0, engines: new Set<number>() };
    (window as any).implicitComputes = seen;
    const Base = window.Worker;
    let next = 0;
    window.Worker = class extends Base {
      private n = next++;
      postMessage(message: any, ...rest: any[]) {
        if (
          message?.action === "compute" &&
          message.config?.curve?.format === "implicit"
        ) {
          seen.engines.add(this.n);
          if (message.topology) seen.classified++;
          else seen.plain++;
        }
        (super.postMessage as any)(message, ...rest);
      }
    };
  });
  await openStory(page, "four-pools");
  await openAnimation(page);
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        Number(
          await page
            .locator("#artwork")
            .getAttribute("data-animation-progress"),
        ),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0.3);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const seen = await page.evaluate(() => {
    const s = (window as any).implicitComputes;
    return {
      classified: s.classified,
      plain: s.plain,
      engines: s.engines.size,
    };
  });
  expect(seen.engines).toBeGreaterThan(1);
  expect(seen.classified).toBeGreaterThan(4);
  expect(seen.plain).toBe(0);
  await expect(note(page)).not.toContainText("was not classified");
});
