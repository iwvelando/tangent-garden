import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
import { test, expect, type Page } from "@playwright/test";
import { reveal } from "../web/spatial/animation";
import { spatialPresets } from "../web/spatial/presets";
import { buildScene } from "../web/spatial/scene";
import type { SpatialResult } from "../web/spatial/types";
import { choosePreset } from "./helpers";
import type { MeshVertex } from "./curve-mesh";

// A curve study's mesh leaves the engine as typed arrays, not JSON
// (engine3.FlatMesh, cmd/wasm/mesh.go). The drawing must be the one JSON
// delivered: Go's test compares the arrays with the JSON bit for bit, and
// these compare the scene drawn from them with the scene drawn the old way.

// The real engine, run here as the worker runs it (built by `make build`).
let spatial: (json: string) => any;
test.beforeAll(async () => {
  runInThisContext(readFileSync("public/wasm_exec.js", "utf8"));
  const go = new (globalThis as any).Go();
  const { instance } = await WebAssembly.instantiate(
    readFileSync("public/engine.wasm"),
    go.importObject,
  );
  void go.run(instance);
  spatial = (globalThis as any).tangentGardenSpatial;
});

// The result as the worker posts it: the JSON with the meshes put back.
function computed(config: object): SpatialResult {
  const reply = spatial(JSON.stringify(config));
  expect(typeof reply).toBe("object");
  const result = JSON.parse(reply.json);
  result.mesh = reply.mesh;
  if (result.implicit) Object.assign(result.implicit, reply.implicit);
  return result;
}
// The mesh as JSON carried it, vertex by vertex. (Go's JSON keeps −0,
// which JSON.stringify would write as 0, so the list is not re-encoded.)
function asJSON({ vertices, sampleIndex }: SpatialResult["mesh"]) {
  return Array.from(sampleIndex, (i, k): MeshVertex => {
    const [x, y, z, nx, ny, nz, phase] = vertices.subarray(7 * k, 7 * k + 7);
    return {
      position: { x, y, z },
      normal: { x: nx, y: ny, z: nz },
      phase,
      sampleIndex: i,
    };
  });
}
// The scene's mesh batch as buildScene laid out a JSON mesh.
const flattened = (mesh: MeshVertex[]) =>
  new Float32Array(
    mesh.flatMap((v) => [
      v.position.x,
      v.position.y,
      v.position.z,
      v.normal.x,
      v.normal.y,
      v.normal.z,
      v.phase,
    ]),
  );
const bytes = (a: Float32Array) =>
  Buffer.from(a.buffer, a.byteOffset, a.byteLength);

test("every preset draws the mesh JSON delivered, whole and revealed", () => {
  test.slow();
  let meshes = 0;
  for (const p of spatialPresets) {
    const result = computed(p.config);
    const json = asJSON(result.mesh);
    if (json.length > 0) meshes++;
    const drawn = buildScene(result).mesh.data;
    expect(bytes(drawn).equals(bytes(flattened(json))), p.name).toBe(true);
    // A reveal keeps the vertices up to its sample, as the JSON's did.
    for (const q of [0, 0.37, 0.8, 1]) {
      const shown = reveal(result, q);
      // The study's own result is left as it was.
      expect(shown.mesh.vertices.length <= result.mesh.vertices.length).toBe(
        true,
      );
      if (result.implicit || result.surface || result.rays) continue;
      const last = shown.base.length - 1;
      const kept = json.filter((v) => v.sampleIndex <= last);
      expect(
        bytes(buildScene(shown).mesh.data).equals(bytes(flattened(kept))),
        `${p.name} at ${q}`,
      ).toBe(true);
    }
  }
  // Tubes, ribbons, developables and ruled surfaces among them.
  expect(meshes).toBeGreaterThan(30);
});

const stage = (page: Page) => page.locator(".spatial-stage");
async function settled(page: Page) {
  await expect(stage(page)).toHaveAttribute("aria-busy", "false");
}
async function config(page: Page) {
  return JSON.parse((await stage(page).getAttribute("data-config"))!);
}
const pixels = (page: Page) =>
  page
    .locator("#spatial-artwork")
    .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());

test("the coiled cord plays its turns to both endpoints, the last drawn as the still is", async ({
  page,
}) => {
  test.slow();
  await page.goto("/?study=3d");
  await expect(page.locator("#spatial-artwork")).toBeVisible();
  await settled(page);
  await choosePreset(page, { label: "A coiled cord round a trefoil" });
  await settled(page);
  const wound = await pixels(page);
  const original = await config(page);
  expect(original.coil.turns).toBe(36);
  const panel = page.locator("#spatial-animation-section");
  if ((await panel.getAttribute("open")) === null)
    await panel.locator(":scope > summary").click();
  await page.getByLabel("Repeat", { exact: true }).selectOption("once");
  await page.getByLabel("Pace", { exact: true }).selectOption("steady");
  // The current camera keeps the still's own framing (the preset holds a
  // view drawn at zoom 1).
  await page
    .getByLabel("Animation camera", { exact: true })
    .selectOption("current");
  await page
    .getByRole("button", { name: "Play animation", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const slider = page.getByRole("slider", { name: "Animation progress" });
  await slider.fill("1");
  await expect(stage(page)).toHaveAttribute("data-progress", "1");
  await settled(page);
  expect((await config(page)).coil.turns).toBe(36);
  expect(await pixels(page)).toBe(wound);
  await slider.fill("0");
  await expect(stage(page)).toHaveAttribute("data-progress", "0");
  await settled(page);
  expect((await config(page)).coil.turns).toBe(0);
  const straight = await pixels(page);
  expect(straight).not.toBe(wound);
  await slider.fill("0.5");
  await expect(stage(page)).toHaveAttribute("data-progress", "0.5");
  await settled(page);
  const between = await pixels(page);
  expect(between).not.toBe(straight);
  expect(between).not.toBe(wound);
  // Scrubbed back, each endpoint is drawn again exactly as before.
  for (const [at, frame] of [
    ["1", wound],
    ["0", straight],
  ]) {
    await slider.fill(at);
    await expect(stage(page)).toHaveAttribute("data-progress", at);
    await settled(page);
    expect(await pixels(page)).toBe(frame);
  }
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(stage(page)).not.toHaveAttribute("data-progress");
  expect(await config(page)).toEqual(original);
  expect(await pixels(page)).toBe(wound);
});
