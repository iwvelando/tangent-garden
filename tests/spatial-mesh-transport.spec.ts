import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
import { test, expect, type Page } from "@playwright/test";
import { reveal } from "../web/spatial/animation";
import { spatialPresets } from "../web/spatial/presets";
import { restore } from "../web/lifted";
import { buildScene } from "../web/spatial/scene";
import type { Batch } from "../web/spatial/scene";
import { meshStride, type SpatialResult } from "../web/spatial/types";
import { choosePreset } from "./helpers";
import { meshCorners, type MeshVertex } from "./curve-mesh";

// A curve study's mesh leaves the engine as indexed typed arrays
// (engine3.CurveMesh, cmd/wasm/mesh.go), its triangles sharing vertices.
// The drawing must be every triangle the engine listed, corner by corner,
// in its order: Go's tests check the triangles, and these check the scene
// drawn from them, whole and revealed.

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

// The result as the page receives it: the JSON with the meshes and the
// lifted arrays put back.
function computed(config: object): SpatialResult {
  const reply = spatial(JSON.stringify(config));
  expect(typeof reply).toBe("object");
  const result = restore(JSON.parse(reply.json), reply.lifted);
  result.mesh = reply.mesh;
  if (result.implicit) Object.assign(result.implicit, reply.implicit);
  return result;
}
// The scene's mesh batch as drawn, corner by corner.
function drawn({ data, indices }: Batch) {
  if (!indices) return data;
  const out = new Float32Array(meshStride * indices.length);
  indices.forEach((v, k) =>
    out.set(
      data.subarray(meshStride * v, meshStride * v + meshStride),
      meshStride * k,
    ),
  );
  return out;
}
// The batch the corners make, as buildScene laid out an unindexed mesh.
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

test("every preset draws each triangle the engine listed, whole and revealed", () => {
  test.slow();
  let meshes = 0,
    vertices = 0,
    corners = 0;
  for (const p of spatialPresets) {
    const result = computed(p.config);
    const listed = meshCorners(result.mesh);
    if (listed.length > 0) meshes++;
    vertices += result.mesh.vertices.length / meshStride;
    corners += listed.length;
    const scene = buildScene(result);
    expect(
      bytes(drawn(scene.mesh)).equals(bytes(flattened(listed))),
      p.name,
    ).toBe(true);
    // The batch is drawn by index whenever there is a mesh.
    expect(scene.mesh.indices !== undefined, p.name).toBe(listed.length > 0);
    // A reveal keeps the triangles up to its sample, in order.
    for (const q of [0, 0.37, 0.8, 1]) {
      const shown = reveal(result, q);
      // The study's own result is left as it was.
      expect(meshCorners(result.mesh).length).toBe(listed.length);
      if (result.implicit || result.surface || result.rays) continue;
      const last = shown.base.length - 1;
      const kept = listed.filter((v) => v.sampleIndex <= last);
      const batch = buildScene(shown).mesh;
      expect(
        bytes(drawn(batch)).equals(bytes(flattened(kept))),
        `${p.name} at ${q}`,
      ).toBe(true);
      // Nothing revealed is nothing drawn, so the legend leaves it out.
      if (kept.length === 0) expect(batch.data.length).toBe(0);
    }
  }
  // Tubes, ribbons, developables and ruled surfaces among them, with each
  // vertex shared by several triangles.
  expect(meshes).toBeGreaterThan(30);
  expect(corners).toBeGreaterThan(4 * vertices);
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
