# Spatial mesh transport: moving curve surfaces off JSON

Status: step 1 done (see [Step 1, as built](#step-1-as-built)); step 2 and the secondary candidates are open. This is the detailed framing for the canal bullet of item 8 ("Transport and efficiency, when profiled") in [remaining-refinements.md](remaining-refinements.md). Read `AGENTS.md` first, then the parts of [architecture.md](architecture.md) on the WASM bridge and the implicit mesh.

## The symptom

Parameter animations of tube (canal) studies play at a few frames a second, because every frame is a full engine result. **A coiled cord round a trefoil** shows it most, and **Beads running around a trefoil** and **A cord twisted round a spring** are the same in kind. A "draw along the curve" reveal makes no engine requests and does not have this problem.

## Where a frame's time goes

Each animation frame of a curve study goes through these steps:

1. The worker (`web/engine.worker.ts`) sends the request JSON to `tangentGardenSpatial` (`cmd/wasm/main.go`).
2. Go runs `engine3.Compute`, then `json.Marshal(result)`, and returns the result to JS as one string.
3. The worker runs `JSON.parse`, then `postMessage` structured-clones the object to the main thread.
4. `buildScene` (`web/spatial/scene.ts`) flattens `result.mesh` into a `batch` of seven numbers per vertex (position, normal, phase), and the renderer uploads it.

`Result.Mesh` is a `[]Vertex`, each vertex being `{sampleIndex, position{x,y,z}, normal{x,y,z}, phase}`. It is not indexed: every quad between two rings is six vertices, so each ring vertex is written about six times. A canal mesh is capped at `canalRings = 480` rings of `canalSegments = 24` (`engine3/canal.go`). The cap means 480 × 24 × 6 = 69,120 vertices, about 215 bytes each in JSON, or **14–15 MB per frame**. Any canal with 480 or more samples reaches the cap. Fewer samples give fewer rings, so lowering the sample count does not shrink the mesh until it drops below 480.

These measurements were taken on 2026-10-07 on an Apple-silicon Mac. They are medians of a few runs, so read them as proportions:

| Study (one frame)                                            | Native compute | Native `json.Marshal` | WASM total, compute + marshal | JS `JSON.parse` | JSON    |
| ------------------------------------------------------------ | -------------- | --------------------- | ----------------------------- | --------------- | ------- |
| Coiled cord, 960 samples                                     | 15–20 ms       | 85–110 ms             | 352 ms                        | ~100 ms         | 14.9 MB |
| Coiled cord, 2400 samples                                    | 35 ms          | 110 ms                | 468 ms                        | ~110 ms         | 15.2 MB |
| Beads running around a trefoil, 720 samples                  | 14 ms          | 57 ms                 | 233 ms                        | ~67 ms          | 11.5 MB |
| Threads twisted round a coiled helix (no mesh), 1200 samples | 48 ms          | 2 ms                  | 210 ms                        | ~3 ms           | 0.5 MB  |

For tubes, **writing and reading the mesh as JSON is 75–90% of a frame**. The engine's own work is small. After the parse, structured clone and `buildScene`'s flatten add more on top.

### How these numbers were taken (reuse this harness)

- **WASM:** load `public/wasm_exec.js` and `public/engine.wasm` in Node, then call `globalThis.tangentGardenSpatial(JSON.stringify(request))` in a loop and time it, plus `JSON.parse` of the reply. Get real requests by wrapping `Worker.prototype.postMessage` in a Playwright `addInitScript` and saving the `spatial` payload while a preset plays. Request JSON unmarshals straight into `engine3.Request`.
- **Native:** in a scratch `_test.go` in `engine3`, unmarshal the same JSON into `Request`, then time `Compute` and `json.Marshal` separately. `go test -cpuprofile` with `go tool pprof -top -cum` gives the breakdown. Delete the scratch files afterwards.
- **Do not judge smoothness by headless Chromium.** Its frame rate varied four- to five-fold between identical runs, with or without `--use-angle=metal`, and a backgrounded Chrome tab pauses `requestAnimationFrame`. Use the deterministic timings above, then ask for an on-device check.
- `make bench` (`scripts/bench-implicit.mjs`) benchmarks only implicit studies. Adding a canal study to it is the natural first step.

### Already tried, and ruled out

- **A hand-written `MarshalJSON` for the mesh** produced the same bytes, but it was no faster. Formatting floats to their shortest form (`strconv.AppendFloat`) dominates, not reflection. Also, `json.Marshal` re-scans and compacts every `Marshaler`'s output, which cancelled the saving: 46 ms direct against 92 ms through `json.Marshal` and 76 ms by reflection. Any JSON-based encoding keeps the formatting and parsing costs.
- **Fewer samples** shrink only the per-sample arrays (`base`, `composition`, `canal.circles`). The coiled cord's preset already uses 960 samples, the fewest that still give 480 rings.

## The precedent to follow

Implicit level sets already skip JSON for their mesh, and that path is the template for this work:

- `cmd/wasm/mesh.go` (`meshReply`) copies `positions` and `normals` (`[]float64`) and `triangles`, `cut` and `open` (`[]int32`) into one `ArrayBuffer`. It returns `{ json, positions, normals, triangles, cut, open }` as typed views on that buffer, with `null` in place of each array inside the JSON. The float64 arrays come first so that every view is aligned. WASM and browsers are little-endian, so the bytes are copied as they lie in memory.
- The worker (`web/engine.worker.ts`, the `typeof reply !== "string"` branch) parses the remaining JSON, puts the views back with `Object.assign`, and transfers `positions.buffer` rather than cloning it. `scripts/test-dev-worker.mjs` mirrors this branch for the dev worker.
- The renderer draws that mesh by index.
- See [architecture.md](architecture.md) (the paragraph beginning "The mesh's five arrays do not go through JSON") and "Follow-up completed: implicit mesh efficiency" in [spatial-expansion-roadmap.md](spatial-expansion-roadmap.md). That follow-up was measured with the same method and required every preset to reassemble bit for bit identical.

## Proposed change

The change can land in two steps. Each step stands on its own and can be verified separately.

### Step 1: move `Result.Mesh` out of JSON (bridge and worker only)

- In `cmd/wasm`, generalize `meshReply` so that a curve result's `Mesh` also goes out as typed arrays. For example, return one `Float64Array` of 7 values per vertex (position, normal, phase) and one `Int32Array` of `sampleIndex`. Set `result.Mesh = nil` before encoding the rest. Keep float64 so that the values the renderer receives are exactly the values JSON delivered: JSON's shortest float64 form parses back to the same float64.
- The engine is untouched. This step removes most of the marshal and parse time and the clone, since the buffer is transferred.
- On the TypeScript side, `SpatialResult.mesh` (`web/spatial/types.ts`) changes from `Vertex[]` to the typed form. Every consumer has to follow:
  - `scene.ts` (`result.mesh.flatMap(...)`, about line 483) can take the float array almost directly.
  - The reveal in `animation.ts` (about line 978) filters `result.mesh` by `sampleIndex <= last`. It must keep doing so on the typed arrays, and must not assume any particular vertex order.
  - `web/spatial/ruled.ts` (`result.mesh.length > 0`).
  - The mesh assertions in `scripts/test-wasm.mjs`, which index `mesh[i].sampleIndex`, `.position` and so on.
  - Any export, cut or probe path that reads the result's mesh rather than the scene. Find them with `rg "\.mesh\b" web` and exclude the `implicit.` hits.
- Keep the Go and TS fields synchronized (`AGENTS.md`). `cmd/wasm` remains transport only.

### Step 2 (optional, larger): an indexed curve mesh

- `canal.go`, `developable.go` and `ruled.go` would emit shared vertices and an `int32` triangle list, as `implicit.go` does, cutting the data about six-fold. The renderer already has an indexed path for implicit meshes.
- This step changes engine output types and touches more than two modules, so plan it before starting, per the user's planning policy. The reveal filter needs a per-triangle sample index, or triangles kept in sample order.

### Secondary candidates, same pattern

These are smaller, and each could follow once step 1 exists:

- `canal.circles`: about 270 KB at 72 lines.
- `composition` and `base`: each about 170–200 KB at 2400 samples.
- From item 8: the surface grid (about 10 MB), the surface-probe grids (5–7 MB) and the largest 4D weave (9.6 MB).

## Step 1, as built

- `engine3.FlatMesh` lays `Result.Mesh` out as `vertices` (seven float64 per vertex) and `sampleIndex` (int32); the engine's types and output are unchanged. `cmd/wasm/mesh.go` sends every spatial result as `{ json, mesh, implicit }`, typed views on one buffer, with the implicit arrays nested under `implicit` rather than beside `json`. The worker transfers the buffer; `SpatialResult.mesh` is a `CurveMesh`.
- `buildScene` copies `vertices` into its batch; the reveal keeps the vertices whose sample is at most the last revealed, in their order (`revealMesh`); the ruled note counts `sampleIndex`. Hand-built test results use `tests/curve-mesh.ts`.
- `make bench` is now `scripts/bench-spatial.mjs`, with six curve presets beside the implicit studies and a column for the scene's batch. It reads every reply shape, so `--compare` against the deployed site works.
- Checks: `engine3/flat_test.go` (the arrays equal the JSON bit for bit, including a canal with gaps and an empty ribbon); `scripts/test-wasm.mjs` reads every spatial reply through the typed views and checks a developable's, ribbon's and torus's vertices, an empty mesh and a mesh broken where the envelope is lost; `scripts/test-dev-worker.mjs` checks the worker's reassembly and transfer; `tests/spatial-mesh-transport.spec.ts` compares, for every preset, the scene drawn from the typed mesh with the scene drawn the old way, whole and at four reveals, and plays the coiled cord's track to both endpoints.
- A one-off comparison against the previous engine and frontend hashed every 3D preset's whole scene at rest, at two reveals, and at each parameter track's start, middle and end: 363 scenes, all identical. A deliberate fault in the reveal changed 78 of them.
- Timing with `make bench ARGS="--compare <previous build>"`, in Node on the cloud container (median of 5; call + decode + post + scene):

  | Study                                     | Before | After  | Transfer         |
  | ----------------------------------------- | ------ | ------ | ---------------- |
  | Coiled cord, 960 samples                  | 794 ms | 59 ms  | 14.9 MB → 4.6 MB |
  | Coiled cord, 2400 samples                 | 618 ms | 87 ms  | 15.2 MB → 4.9 MB |
  | Beads running around a trefoil            | 471 ms | 55 ms  | 11.5 MB → 3.6 MB |
  | A cord twisted round a spring (refined)   | 496 ms | 253 ms | 8.3 MB → 3.1 MB  |
  | A band around the trefoil (framed ribbon) | 63 ms  | 23 ms  | 1.6 MB → 0.7 MB  |
  | Trefoil · (2, 3) (tangent developable)    | 101 ms | 13 ms  | 2.6 MB → 0.9 MB  |

  Implicit studies are unchanged within noise. The spring's remaining time is its refinement in Go. Most of what remains of a tube's transfer is the mesh's own buffer (about 4 MB at the 480-ring cap), which step 2 would cut about six-fold.

## Verification the change must carry

- **Bit-identical drawings.** For every 3D preset, the scene batches built from the new transport must equal the old ones exactly. Build both in a test from the same engine result: one through JSON, one through the typed path. This is item 8's rule.
- **The real bridge:** extend `scripts/test-wasm.mjs` with a canal and a developable result read through the typed views, including an empty mesh (a framed ribbon of width 0) and a mesh with breaks.
- **Reveal, cut, probe, SVG/PNG export and animation export** of a tube preset must be unchanged, under the existing browser specs plus one that plays a canal parameter track to its endpoints.
- **Timing:** report before and after timings from the Node harness above for the cord, the beads and a developable, not a screenshot or an fps reading.
- **No new resource kind,** so `deploy/content-security-policy.txt` should not need to change. Confirm this rather than assume it.
