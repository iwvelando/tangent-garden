import { test, expect, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import { wireStudy } from "./study-link-wire";

// Make physical: the lace's plaque workshop. Entry and exact return,
// preparing, the report, invalidation, cancellation, field errors, the
// saved 3MF read back independently, links, storage denial and phone
// layouts. The solid's mathematics are physical/*_test.go's.

const stars = "Seven-pointed stars receding to the rim";

async function openLace(page: Page, title = stars) {
  await page.getByRole("button", { name: "Browse notebook examples" }).click();
  const gallery = page.getByRole("dialog", { name: "Notebook examples" });
  await gallery
    .locator(`[data-lace-example][data-example-title="${title}"]`)
    .click();
  await gallery.waitFor({ state: "hidden" });
  const d = page.getByRole("dialog", { name: "Hyperbolic lace" });
  await ready(d);
  return d;
}
const ready = (d: Locator) =>
  expect(d.locator("#lace-artwork")).toHaveAttribute("aria-busy", "false");
// The workshop's controls; its entry in the lace's sidebar bears the
// same name, and only one of them is ever shown.
const workshop = (d: Locator) => d.locator("section.lace-workshop-controls");
async function enter(d: Locator) {
  await d.getByRole("button", { name: "Make physical…" }).click();
  const w = workshop(d);
  await expect(w).toBeVisible();
  return w;
}
// Prepares the solid and waits for its report.
async function prepare(d: Locator) {
  const w = workshop(d);
  await w.getByRole("button", { name: /^Prepare (solid|again)$/ }).click();
  await expect(d.locator(".lace-workshop-view")).toHaveAttribute(
    "aria-busy",
    "false",
    { timeout: 60_000 },
  );
  await expect(w.getByRole("status")).toContainText("Prepared");
  return d.getByRole("region", { name: "Solid report" });
}
const field = (w: Locator, label: string) =>
  w.getByLabel(label, { exact: true });

// A zip's entries by name, read with Node's inflate alone: the central
// directory gives each entry's method, sizes and offset.
function unzip(data: Buffer) {
  let end = data.length - 22;
  while (end >= 0 && data.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("no end of central directory");
  const entries = data.readUInt16LE(end + 10);
  let at = data.readUInt32LE(end + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < entries; i++) {
    if (data.readUInt32LE(at) !== 0x02014b50) throw new Error("bad entry");
    const method = data.readUInt16LE(at + 10);
    const size = data.readUInt32LE(at + 20);
    const nameLength = data.readUInt16LE(at + 28);
    const extra = data.readUInt16LE(at + 30);
    const comment = data.readUInt16LE(at + 32);
    const local = data.readUInt32LE(at + 42);
    const name = data.toString("utf8", at + 46, at + 46 + nameLength);
    const start =
      local +
      30 +
      data.readUInt16LE(local + 26) +
      data.readUInt16LE(local + 28);
    const raw = data.subarray(start, start + size);
    out.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
    at += 46 + nameLength + extra + comment;
  }
  return out;
}
const entity = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
// The 3MF's model read with regular expressions: its unit, metadata,
// vertices, triangles, bounds and bodies (components through shared
// vertices).
function readModel(file: Buffer) {
  const parts = unzip(file);
  expect([...parts.keys()].sort()).toEqual([
    "3D/3dmodel.model",
    "[Content_Types].xml",
    "_rels/.rels",
  ]);
  const xml = parts.get("3D/3dmodel.model")!.toString("utf8");
  // Named entities only, which strict readers require.
  expect(xml).not.toMatch(/&#/);
  const meta = (name: string) => {
    const m = xml.match(new RegExp(`<metadata name="${name}">([^<]*)<`));
    return m ? entity(m[1]) : undefined;
  };
  const v = [
    ...xml.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/g),
  ].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
  const t = [
    ...xml.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g),
  ].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
  const lo = [0, 1, 2].map((i) => Math.min(...v.map((p) => p[i])));
  const hi = [0, 1, 2].map((i) => Math.max(...v.map((p) => p[i])));
  const parent = v.map((_, i) => i);
  const find = (x: number): number =>
    parent[x] === x ? x : (parent[x] = find(parent[x]));
  for (const [a, b, c] of t) {
    parent[find(a)] = find(b);
    parent[find(b)] = find(c);
  }
  const bodies = new Set(v.map((_, i) => find(i))).size;
  return {
    xml,
    unit: xml.match(/<model unit="([^"]+)"/)?.[1],
    settings: JSON.parse(meta("tg:settings")!),
    title: meta("Title"),
    vertices: v.length,
    triangles: t.length,
    size: [0, 1, 2].map((i) => hi[i] - lo[i]),
    bodies,
    transform: xml.match(/<item objectid="1" transform="([^"]+)"/)?.[1],
  };
}
const grouped = (s: string) => Number(s.replace(/,/g, ""));

test("the workshop prepares a plaque, saves the 3MF it draws, and returns to the lace exactly", async ({
  page,
}) => {
  await page.goto("/");
  const d = await openLace(page);
  // A view of the lace's own, and raw text in one of its fields.
  await field(d, "Star point").fill("1/2");
  await ready(d);
  const art = d.locator("#lace-artwork");
  await art.focus();
  await page.keyboard.press("+");
  await page.keyboard.press("ArrowLeft");
  const view = {
    zoom: await art.getAttribute("data-zoom"),
    pan: await art.getAttribute("data-pan"),
  };
  // The image export belongs to the lace; the workshop saves its file.
  await expect(d.getByRole("button", { name: /Export image/ })).toBeVisible();
  const w = await enter(d);
  await expect(d.locator(".garden-layout:not(.lace-workshop)")).toBeHidden();
  await expect(d.getByRole("button", { name: /Export image/ })).toHaveCount(0);
  await expect(
    w.getByRole("button", { name: "Back to the lace" }),
  ).toBeFocused();
  // Lines start as the study draws them: the motif and the tile sides.
  await expect(field(w, "Lines")).toHaveValue("both");
  await field(w, "Lines").selectOption("motif");
  await field(w, "Diameter (mm)").fill("80");
  await expect(w.getByRole("button", { name: "Save 3MF ↓" })).toBeDisabled();
  const report = await prepare(d);
  await expect(report.locator(".lace-workshop-verdict")).toHaveText(
    "Validated: every required check passes.",
  );
  // Passing, failing and unresolved checks read differently, in groups:
  // the solid as a mesh apart from the printer's checks and notes.
  const groups = report.getByRole("list");
  await expect(groups).toHaveCount(3);
  await expect(report.getByRole("list", { name: "The solid" })).toContainText(
    "Closed two-manifold",
  );
  await expect(
    report.getByRole("list", { name: "Against the printer" }),
  ).toContainText("Gaps between raised lines");
  await expect(
    report.locator('li[data-status="fail"], li[data-status="unresolved"]'),
  ).toHaveCount(0);
  const text = (await report.textContent())!;
  const [, w0, d0, h0] = text.match(
    /(\d+(?:\.\d+)?) × (\d+(?:\.\d+)?) × (\d+(?:\.\d+)?) mm, 1 body\./,
  )!;
  const [, kept, of] = text.match(/([\d,]+) of ([\d,]+) tiles kept/)!;
  expect(grouped(kept)).toBeGreaterThan(0);
  expect(grouped(kept)).toBeLessThanOrEqual(grouped(of));
  await report.getByText("Construction and work").click();
  const work = (await report.textContent())!;
  const vertices = grouped(work.match(/([\d,]+) vertices/)![1]);
  const triangles = grouped(work.match(/([\d,]+) triangles/)![1]);
  // The drawing is the solid's own triangles.
  const canvas = d.locator(".lace-workshop-canvas");
  await expect(canvas).toHaveAttribute("data-triangles", String(triangles));

  const download = page.waitForEvent("download");
  await w.getByRole("button", { name: "Save 3MF ↓" }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe("hyperbolic-lace-7-3-raised-80mm.3mf");
  const model = readModel(await readFile((await saved.path())!));
  expect(model.unit).toBe("millimeter");
  expect(model.vertices).toBe(vertices);
  expect(model.triangles).toBe(triangles);
  expect(model.bodies).toBe(1);
  // The report's dimensions are the file's, to the digits shown.
  for (const [i, shown] of [w0, d0, h0].entries())
    expect(Math.abs(model.size[i] - Number(shown))).toBeLessThan(
      Number(shown) * 1e-4,
    );
  expect(Number(h0)).toBeCloseTo(2.8, 10);
  // Placed at the first printer's bed center.
  expect(model.transform).toBe("1 0 0 0 1 0 0 0 1 128 128 0");
  // The settings it records rebuild it: version, source and design.
  expect(model.settings).toMatchObject({
    version: 1,
    diameter: 80,
    rim: "motif",
    lines: "motif",
    design: { treatment: "raised", line: 2, floor: 1.6, relief: 1.2 },
    lace: { tiling: "7,3", depth: 5, maxTiles: 1000, starPoint: 0.5 },
    profile: { version: 1, id: "bambu-x1c-0.4", wall: 2 },
  });
  expect(model.settings.lace.window).toBeUndefined();
  expect(model.settings.grid).toBe(0.2);

  await w.getByRole("button", { name: "Back to the lace" }).click();
  await expect(workshop(d)).toHaveCount(0);
  await expect(d.getByRole("button", { name: "Make physical…" })).toBeFocused();
  await expect(art).toHaveAttribute("data-zoom", view.zoom!);
  await expect(art).toHaveAttribute("data-pan", view.pan!);
  await expect(field(d, "Star point")).toHaveValue("1/2");
  await expect(d.getByRole("button", { name: /Export image/ })).toBeVisible();
  // Reopening keeps the settings, and a preparation is never kept.
  const again = await enter(d);
  await expect(field(again, "Diameter (mm)")).toHaveValue("80");
  await expect(field(again, "Lines")).toHaveValue("motif");
  await expect(
    again.getByRole("button", { name: "Save 3MF ↓" }),
  ).toBeDisabled();
  // Escape returns to the lace, then to the study.
  await page.keyboard.press("Escape");
  await expect(workshop(d)).toHaveCount(0);
  await expect(d).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(d).toBeHidden();
});

test("edits invalidate a prepared plaque, and canceled or superseded jobs never apply", async ({
  page,
}) => {
  await page.goto("/");
  const d = await openLace(page);
  const w = await enter(d);
  await field(w, "Lines").selectOption("motif");
  await field(w, "Diameter (mm)").fill("80");
  const report = await prepare(d);
  const save = w.getByRole("button", { name: /^Save 3MF/ });
  await expect(save).toBeEnabled();
  const verdict = report.locator(".lace-workshop-verdict");
  // Size, profile, treatment and rim each invalidate it; undoing the
  // edit makes it current again.
  for (const [edit, undo] of [
    [
      () => field(w, "Diameter (mm)").fill("81"),
      () => field(w, "Diameter (mm)").fill("80"),
    ],
    [
      () =>
        field(w, "Printer").selectOption({
          label: "Original Prusa i3 MK3S+",
        }),
      () =>
        field(w, "Printer").selectOption({
          label: "Bambu Lab X1-Carbon",
        }),
    ],
    [
      async () => {
        await w.getByText("Minimums the checks use", { exact: true }).click();
        await field(w, "Minimum gap (mm)").fill("1.1");
      },
      () => field(w, "Minimum gap (mm)").fill("1"),
    ],
    [
      () => field(w, "Treatment").selectOption("recessed"),
      () => field(w, "Treatment").selectOption("raised"),
    ],
    [
      () => field(w, "Rim").selectOption("rim"),
      () => field(w, "Rim").selectOption("motif"),
    ],
  ] as const) {
    await edit();
    await expect(save).toBeDisabled();
    await expect(verdict).toContainText("Settings changed since");
    await expect(d.locator(".lace-workshop-canvas")).toHaveAttribute(
      "data-stale",
      "true",
    );
    await expect(w.getByRole("status")).toContainText(
      "prepare again before saving",
    );
    await undo();
    await expect(save).toBeEnabled();
  }
  // Cancel ends the job: the earlier preparation stays, unchanged.
  const summary = report.locator(".note").first();
  const before = await summary.textContent();
  await field(w, "Diameter (mm)").fill("200");
  await w.getByRole("button", { name: "Prepare solid" }).click();
  await w.getByRole("button", { name: "Cancel" }).click();
  await expect(w.getByRole("status")).toHaveText(
    "Canceled; nothing was prepared. Settings changed: prepare again before saving.",
  );
  await expect(w.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await page.waitForTimeout(500);
  await expect(summary).toHaveText(before!);
  // A job whose settings change while it runs answers the old settings:
  // its plaque is shown as stale, and cannot be saved.
  await w.getByRole("button", { name: "Prepare solid" }).click();
  await field(w, "Diameter (mm)").fill("90");
  await expect(w.getByRole("status")).toContainText("Prepared", {
    timeout: 60_000,
  });
  await expect(save).toBeDisabled();
  await expect(verdict).toContainText("Settings changed since");
  // The lace behind it was never touched.
  await w.getByRole("button", { name: "Back to the lace" }).click();
  await ready(d);
  await expect(d.getByRole("alert")).toHaveCount(0);
});

test("refusals show under their own controls, and a plaque that fails is saved only as not validated", async ({
  page,
}) => {
  await page.goto("/");
  const d = await openLace(page);
  const w = await enter(d);
  const prepareButton = w.getByRole("button", { name: "Prepare solid" });
  const errorOf = (label: string) =>
    w
      .locator(".field")
      .filter({ has: page.getByLabel(label, { exact: true }) })
      .locator(".field-error");
  // Empty: found at once, and nothing can be prepared.
  await field(w, "Diameter (mm)").fill("");
  await expect(errorOf("Diameter (mm)")).toHaveText(
    "Enter a length in millimeters.",
  );
  await expect(prepareButton).toBeDisabled();
  // Not a constant: the parser's message.
  await field(w, "Diameter (mm)").fill("2*");
  await expect(errorOf("Diameter (mm)")).not.toBeEmpty();
  await expect(prepareButton).toBeDisabled();
  // Out of range: Go's refusal, under its field.
  await field(w, "Diameter (mm)").fill("400");
  await expect(prepareButton).toBeEnabled();
  await prepareButton.click();
  await expect(errorOf("Diameter (mm)")).toHaveText(
    "Diameter must be 10–300 mm.",
  );
  await field(w, "Diameter (mm)").fill("80");
  await expect(errorOf("Diameter (mm)")).toHaveCount(0);
  // A profile field's refusal opens its folded section.
  await field(w, "Lines").selectOption("motif");
  const folded = w.locator("details", { hasText: "Printer bed and slicing" });
  await expect(folded).not.toHaveAttribute("open", "");
  await folded.getByText("Printer bed and slicing").click();
  await field(w, "Nozzle (mm)").fill("6");
  await folded.getByText("Printer bed and slicing").click();
  await prepareButton.click();
  await expect(errorOf("Nozzle (mm)")).toHaveText(
    "Nozzle must be above 0 and at most 5 mm.",
  );
  await expect(folded).toHaveAttribute("open", "");
  await field(w, "Nozzle (mm)").fill("0.4");
  // A plaque wider than the bed is never shrunk: it fails its check, and
  // saves only under a name that says so.
  await field(w, "Diameter (mm)").fill("260");
  await field(w, "Grid step (mm)").fill("0.4");
  const report = await prepare(d);
  await expect(report.locator(".lace-workshop-verdict")).toHaveText(
    /^Not validated: 1 required check fails/,
  );
  const envelope = report.locator("li", { hasText: "Fits the build envelope" });
  await expect(envelope).toHaveAttribute("data-status", "fail");
  await expect(envelope).toContainText("260 mm, at most 256 mm");
  await expect(envelope).toContainText("Choose a smaller plaque");
  const [, width] = (await report.textContent())!.match(/(\d+(?:\.\d+)?) ×/)!;
  expect(Number(width)).toBeGreaterThan(259.9);
  const download = page.waitForEvent("download");
  await w.getByRole("button", { name: "Save 3MF (not validated) ↓" }).click();
  expect((await download).suggestedFilename()).toBe(
    "hyperbolic-lace-7-3-raised-260mm-not-validated.3mf",
  );

  // Left empty when returning to the lace, a field still holds the link,
  // and the lace says which and where, until the workshop fills it.
  const share = d.getByRole("button", { name: "Copy link", exact: true });
  await field(w, "Floor (mm)").fill("");
  await expect(errorOf("Floor (mm)")).toHaveText(
    "Enter a length in millimeters.",
  );
  await w.getByRole("button", { name: "Back to the lace" }).click();
  await ready(d);
  const held = d.locator(".study-error");
  await expect(held).toHaveText(
    "Floor (mm) in Make physical: Enter a length in millimeters.",
  );
  await expect(share).toBeDisabled();
  const reopened = await enter(d);
  await expect(field(reopened, "Floor (mm)")).toHaveValue("");
  await expect(errorOf("Floor (mm)")).toHaveText(
    "Enter a length in millimeters.",
  );
  await field(reopened, "Floor (mm)").fill("1.6");
  await reopened.getByRole("button", { name: "Back to the lace" }).click();
  await ready(d);
  await expect(held).toHaveCount(0);
  await expect(share).toBeEnabled();
});

test("a link saves the plaque's settings and reopens the workshop; older and damaged links keep the reader's work", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as any).copied = value;
        },
      },
    }),
  );
  await page.goto("/");
  const d = await openLace(page);
  const w = await enter(d);
  await field(w, "Treatment").selectOption("recessed");
  await field(w, "Diameter (mm)").fill("2*50");
  await field(w, "Rim").selectOption("crop");
  await expect(field(w, "Crop radius (of the disk)")).toHaveValue("0.8");
  await field(w, "Crop radius (of the disk)").fill("0.7");
  await w.getByRole("checkbox", { name: "Face down" }).check();
  // A requested minimum belongs to the object: choosing another printer
  // keeps it and takes the rest of that printer's values.
  await w.getByText("Minimums the checks use", { exact: true }).click();
  await field(w, "Minimum gap (mm)").fill("1.2");
  // Settled first, so the switch itself must keep it.
  await expect(w.getByRole("button", { name: "Prepare solid" })).toBeEnabled();
  await field(w, "Printer").selectOption({
    label: "Original Prusa i3 MK3S+",
  });
  await expect(field(w, "Minimum gap (mm)")).toHaveValue("1.2");
  await expect(field(w, "Finest wall (mm)")).toHaveValue("0.9");
  await expect(w.getByText(/values edited/)).toBeVisible();
  const share = d.getByRole("button", { name: "Copy link", exact: true });
  await expect(share).toBeEnabled();
  await share.click();
  await expect(d.getByText("Link copied", { exact: true })).toBeVisible();
  const link: string = await page.evaluate(() => (window as any).copied);
  const { defaultProfiles, profileValues } =
    await import("../web/lace/physical");
  const physical = {
    version: 1,
    open: true,
    treatment: "recessed",
    diameter: 100,
    line: 2,
    floor: 1.6,
    relief: 1.2,
    lines: "both",
    rim: "crop",
    clip: 0.7,
    faceDown: true,
    profile: { ...profileValues(defaultProfiles[1]), gap: 1.2 },
  };
  expect(wireStudy(new URL(link).hash.slice(3)).lace.physical).toEqual(
    physical,
  );
  // An empty required field makes no link.
  await field(w, "Floor (mm)").fill("");
  await expect(share).toBeDisabled();
  await field(w, "Floor (mm)").fill("1.6");
  await expect(share).toBeEnabled();
  // Closed, the settings stay in the study without opening it.
  await w.getByRole("button", { name: "Back to the lace" }).click();
  await page.evaluate(() => delete (window as any).copied);
  await share.click();
  await expect
    .poll(() => page.evaluate(() => (window as any).copied))
    .toBeTruthy();
  const closed: string = await page.evaluate(() => (window as any).copied);
  expect(wireStudy(new URL(closed).hash.slice(3)).lace.physical).toEqual({
    ...physical,
    open: undefined,
  });

  await page.goto("/");
  await page.goto(link);
  const reopened = page.getByRole("dialog", { name: "Hyperbolic lace" });
  const rw = workshop(reopened);
  await expect(rw).toBeVisible();
  await expect(field(rw, "Treatment")).toHaveValue("recessed");
  await expect(field(rw, "Diameter (mm)")).toHaveValue("100");
  await expect(field(rw, "Crop radius (of the disk)")).toHaveValue("0.7");
  await expect(rw.getByRole("checkbox", { name: "Face down" })).toBeChecked();
  await expect(field(rw, "Printer")).toHaveValue("1");
  const report = await prepare(reopened);
  await expect(report).toContainText("turned face down for printing");
  await rw.getByRole("button", { name: "Back to the lace" }).click();
  await ready(reopened);

  // A link from a newer version is refused, leaving the study as it was.
  await page.goto("/");
  const x = page.getByLabel("x(t)", { exact: true });
  await x.fill("cos(t) + 0.25");
  const { deflateRawSync } = await import("node:zlib");
  const { presetStudy } = await import("../web/planar-link");
  const { presetLace } = await import("../web/lace/model");
  const token = (physical: object) =>
    deflateRawSync(
      JSON.stringify({
        v: 1,
        notebook: "2d",
        study: { ...presetStudy(0), lace: { ...presetLace(0), physical } },
      }),
    ).toString("base64url");
  await page.goto(`/#s=${token({ ...defaultLink(), version: 2 })}`);
  await expect(
    page.getByText(/newer than this version of Tangent Garden reads/),
  ).toBeVisible();
  await expect(x).toHaveValue("cos(t) + 0.25");
  await expect(
    page.getByRole("dialog", { name: "Hyperbolic lace" }),
  ).toBeHidden();
});
const defaultLink = () => ({
  version: 1,
  treatment: "raised",
  diameter: 120,
  line: 2,
  floor: 1.6,
  relief: 1.2,
  lines: "motif",
  rim: "motif",
  profile: {
    version: 1,
    id: "bambu-x1c-0.4",
    name: "Bambu Lab X1-Carbon, 0.4 mm nozzle, 0.20 mm Standard",
    envelope: [256, 256, 250],
    nozzle: 0.4,
    extrusionWidth: 0.42,
    layerHeight: 0.2,
    firstLayer: 0.2,
    xyDetail: 0.84,
    xyGap: 0.4,
    zDetail: 0.2,
    calibrated: false,
    wall: 2,
    strut: 2,
    floor: 1.2,
    gap: 1,
  },
});

test("the workshop works when storage is denied", async ({ page }) => {
  await page.addInitScript(() => {
    for (const k of ["getItem", "setItem", "removeItem"] as const)
      Storage.prototype[k] = () => {
        throw new DOMException("denied", "SecurityError");
      };
  });
  await page.goto("/");
  const d = await openLace(page);
  const w = await enter(d);
  await field(w, "Lines").selectOption("motif");
  await field(w, "Diameter (mm)").fill("60");
  await prepare(d);
  const download = page.waitForEvent("download");
  await w.getByRole("button", { name: /^Save 3MF/ }).click();
  expect((await download).suggestedFilename()).toMatch(/60mm/);
});

for (const [name, viewport] of [
  ["phone portrait", { width: 390, height: 844 }],
  ["phone landscape", { width: 844, height: 390 }],
] as const)
  test(`the workshop fits a ${name} with every action reachable`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const d = await openLace(page);
    await d
      .getByRole("button", { name: "Make physical…" })
      .scrollIntoViewIfNeeded();
    const w = await enter(d);
    await field(w, "Lines").selectOption("motif");
    await field(w, "Diameter (mm)").fill("60");
    const report = await prepare(d);
    // Nothing scrolls sideways: the page, the dialog, its columns.
    const overflow = await page.evaluate(() =>
      [
        document.documentElement,
        ...document.querySelectorAll(
          "dialog[open], dialog[open] .garden-content, .lace-workshop, .lace-workshop > *, .lace-workshop-report",
        ),
      ]
        .filter((e) => e.scrollWidth > e.clientWidth + 1)
        .map((e) => e.className || e.tagName),
    );
    expect(overflow).toEqual([]);
    for (const target of [
      d.locator(".lace-workshop-canvas"),
      report.locator(".lace-workshop-verdict"),
      w.getByRole("button", { name: "Back to the lace" }),
      w.getByRole("button", { name: /^Prepare/ }),
      w.getByRole("button", { name: /^Save 3MF/ }),
    ]) {
      await target.scrollIntoViewIfNeeded();
      await expect(target).toBeInViewport();
    }
    const box = (await d.locator(".lace-workshop-canvas").boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.height).toBeLessThanOrEqual(viewport.height);
  });

test("the gallery's 3D printable filter finds the laces, and Make physical sits beside Export image with its legend under the drawing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Browse notebook examples" }).click();
  const gallery = page.getByRole("dialog", { name: "Notebook examples" });
  const cards = gallery.locator("[data-example-title]");
  const all = await cards.count();
  const filter = gallery.getByRole("button", { name: /^3D printable/ });
  const { lacePresets } = await import("../web/lace/model");
  await expect(filter).toHaveText(`3D printable ${lacePresets.length}`);
  await filter.click();
  await expect(filter).toHaveAttribute("aria-pressed", "true");
  await expect(cards).toHaveCount(lacePresets.length);
  expect(
    await cards.evaluateAll((c) =>
      c.every((e) => e.hasAttribute("data-lace-example")),
    ),
  ).toBe(true);
  // It combines with search, and turns off again.
  await gallery
    .getByRole("searchbox", { name: "Search examples" })
    .fill("receding");
  await expect(cards).toHaveCount(1);
  await expect(cards).toHaveAttribute("data-example-title", stars);
  await gallery.getByRole("searchbox", { name: "Search examples" }).fill("");
  await filter.click();
  await expect(cards).toHaveCount(all);
  await gallery
    .locator(`[data-lace-example][data-example-title="${stars}"]`)
    .click();
  const d = page.getByRole("dialog", { name: "Hyperbolic lace" });
  await ready(d);
  // The entry is in the header, beside Export image.
  const header = d.getByRole("banner");
  await expect(
    header.getByRole("button", { name: /Export image/ }),
  ).toBeVisible();
  const entry = header.getByRole("button", { name: "Make physical…" });
  await expect(entry).toBeInViewport();
  const w = await enter(d);
  await field(w, "Lines").selectOption("motif");
  await field(w, "Diameter (mm)").fill("60");
  await prepare(d);
  // The legend sits right under the drawing, the report beside both.
  const canvas = (await d.locator(".lace-workshop-canvas").boundingBox())!;
  const legend = (await d
    .locator(".lace-workshop-figure .garden-legend")
    .boundingBox())!;
  const report = (await d
    .getByRole("region", { name: "Solid report" })
    .boundingBox())!;
  expect(legend.y).toBeGreaterThanOrEqual(canvas.y + canvas.height - 1);
  expect(legend.y).toBeLessThan(canvas.y + canvas.height + 40);
  expect(legend.x + legend.width).toBeLessThanOrEqual(
    canvas.x + canvas.width + 1,
  );
  expect(report.x).toBeGreaterThanOrEqual(canvas.x + canvas.width);
});

test("the snowflake ornament opens Make physical ready to print, and validates as one openwork body", async ({
  page,
}) => {
  await page.goto("/");
  const d = await openLace(
    page,
    "Seven-armed snowflakes, an ornament to print",
  );
  const w = await enter(d);
  await expect(field(w, "Floor (mm)")).toHaveValue("0");
  await expect(field(w, "Diameter (mm)")).toHaveValue("120");
  await expect(field(w, "Lines")).toHaveValue("motif");
  await expect(field(w, "Rim")).toHaveValue("motif");
  const report = await prepare(d);
  await expect(report.locator(".lace-workshop-verdict")).toHaveText(
    "Validated: every required check passes.",
  );
  await expect(report).toContainText("1 body");
  await expect(report).toContainText("Openwork: no floor");
  // The central flake, its seven neighbors and seven beyond.
  await expect(report).toContainText("15 of 617 tiles kept");
});
