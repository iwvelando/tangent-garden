# Re-stitching implicit crossings into an immersion

This is a plan for a future branch, not a description of the code. It picks up where #165 (**Mesh implicit surfaces through their self-crossings**) stopped. Read `AGENTS.md`, then **Spatial implicit surfaces and sections** in [mathematics.md](mathematics.md), especially its **Crossings** part, and `engine3/crossing.go` before starting. When this lands, move the durable definitions into `mathematics.md`, record the verification in the pull request, and delete this file and its entry in [remaining-refinements.md](remaining-refinements.md).

## Why

#165 meshes a level set that crosses itself as two sheets meeting along shared **crossing edges**. Each crossing edge carries four triangles, two from each sheet, and the two sheets share each **node** vertex on the crossing curve. The Klein bottle preset is now closed with Euler characteristic 0, and the slits are gone. Checked on desktop and mobile, some jaggedness is still visible along the crossing when zoomed in and looking for it.

Two things that mesh cannot do motivate this work:

1. **Shading.** A node vertex has no normal (`∇F` vanishes on the crossing). The renderer gives each corner without a normal its triangle's own face normal, as a copy of the vertex (`implicitMesh` in `web/spatial/scene.ts`). So every triangle touching the crossing is shaded flat, which is a faceted band along the seam. This is the most likely cause of the remaining jaggedness, but measure before assuming it (see **Measure first**).
2. **Topology.** The mesh is a 2-complex in which the sheets are glued along the crossing, not the surface that is immersed. Its `V − E + F` is the surface's χ less the crossing curves' own χ. The note can say "meeting itself along N edges" but cannot say what surface it is. The immersed Klein bottle should read as closed, non-orientable, with two cross-caps (χ = 0).

**Re-stitching** gives each sheet its own copy of every crossing vertex. Each sheet is then a manifold through the crossing, the mesh is an honest immersion of an abstract surface, and each copy can carry its own sheet's normal.

## Measure first

Before writing the re-stitch, confirm what the remaining jaggedness is. Zoom on the Klein preset seen through, at about the zoom of the slits in the original report (twelve wheel steps of −300 on the drawing's center at 1440 × 900 reproduces it; see the temporary `zz-look` spec technique in **Verification**). Then compare:

- the drawing as it is;
- the drawing with node corners given a plausible normal (a hack in `implicitMesh`: average the face normals of the vertex's triangles, sign-aligned), to see whether flat shading is the cause;
- the wireframe, or the triangles near the crossing listed from Go, to see whether the cause is instead geometry: fans of poor aspect in crossing tetrahedra, the crossing polyline's resolution (one node per face crossed), or vertices left within the shift of F.

If shading is not the main cause, re-scope: the topology readout still stands on its own, and the geometric fixes are listed under **Related work**.

## What exists after #165

All of this is in `engine3/crossing.go`, wired in from `engine3/implicit.go` (grid path) and `engine3/adaptive.go` (refined path).

- **Finding.** `find` scans the grid's Kuhn tetrahedra. `meets` confirms candidates: a face **node** (a saddle of F on the level inside a face) or an **apex**. The search then spreads around edges that cross the level unusually (`roots.unusual`) and around corners the shift flips (`flipped`). The result is `plans`, keyed by a tetrahedron's sorted corners.
- **Shift.** Every crossing decision uses `f`, which is F at points moved by `shift`: 10⁻⁴ of a lattice step along (1/π, γ, ln 2). This puts crossings that lie in grid planes in general position, as the Klein bottle's does in its symmetric box. The direction (1, √2, √3) was tried first and is wrong: it lies on the cone x² + y² = z².
- **Faces.** `face` decides each face once for both tetrahedra on it. In a face with a node, `face.paths[0]` and `face.paths[1]` are the two arms through the node, `{m_i, N, m_k}` and `{m_j, N, m_l}`, opposite arms on one sheet (built in the node branch of `face`). **That index is a sheet identity at the node, shared by both tetrahedra on the face.** This is the key to re-stitching.
- **Tetrahedra.** `analyze` chains the faces' paths into loops, one per sheet piece in the tetrahedron. A loop through two nodes `n1`, `n2` is split into halves `n1 … n2` and `n2 … n1`. Each half is fanned from `n1`, and the pair `{n1, n2}` is recorded in `plan.crossings`. The two loops through the same nodes are the two sheets.
- **Vertices.** `pid` names a point abstractly: an edge root `(onEdge, i, edge)`, a node `(atNode, face)` or an apex `(atApex, tet)`. `emit` turns pids into vertex indices in grid order:
  - Nodes go through `x.nodes`, keyed by face, and are made with `singularVertex`, which gives no normal and counts them in `Singular`.
  - Single roots that the shift leaves alone reuse marching's vertex through `single`.
  - All other roots are own vertices, moved back onto F by `snap`.
- **Clean-up.** Two passes run after meshing:
  - `fold` removes pairs of crossing triangles on the same three vertices (a cap folded flat).
  - `meet` counts an apex only where two or more fans of triangles meet at it.

  A nappe that only grazes an edge beside its apex has its nearer root merged into the apex (`plan.merged`, `x.merge`).
- **Result.** `ImplicitResult.Crossings` holds the pairs of vertex indices of crossing edges; it travels typed, as `cut` and `open` do (`cmd/wasm/mesh.go`, `web/engine.worker.ts`, `web/spatial/types.ts`). `ImplicitComponent.Crossings` counts them per piece. `Cones`, `CrossingsUnresolved` and `CrossingsExhausted` are counts and flags. `topology()` in `implicit.go` groups pieces by shared vertices and computes `V − E + F`.
- **Note.** `piece()` in `web/spatial/implicit.ts` reads a piece with crossings as "closed, meeting itself along N edges (Euler characteristic χ)" and gives no genus.

## Design

### 1. Sheet identity at each node

Give each node pid the index of the face path its loop passes through: `pid{kind: atNode, i: 0 or 1, v: face}`.

- In `analyze`, paths are collected from the four faces into one list and chained at their ends. Keep, for each path, which face and which index in `face.paths` it came from. When a loop passes through a node inside a path, set the node pid's `i` to that path's index.
- Both tetrahedra on a node face read the same `face.paths`, so they agree on which copy each sheet uses. No new search is needed.
- Within one tetrahedron, the two loops through `n1` and `n2` must use matching indices: sheet A passes path p at `n1`'s face and path q at `n2`'s face, and sheet B the others. That falls out of the chaining, since a loop is one sheet.

### 2. Copies

In `emit`, key node vertices by `(face, i)` instead of `face`, giving two vertices at the same position per node.

- A crossing edge then becomes two coincident edges, `{n1A, n2A}` and `{n1B, n2B}`, each with two triangles. Each sheet is a manifold through the crossing.
- Record the correspondence as a new result array, `Twins` (pairs of vertex indices at the same point on different sheets). Change `Crossings` to list both sheets' edges, or keep it as sheet A's edges with `Twins` to find B's; decide which the note and any later drawing need.
- Apices stay single vertices: a cone point is a genuine singular point of the surface, not a crossing of two sheets.
- `fold`, `meet` and the merge must still run on the copies. Check that `fold` never finds a pair across two sheets (the copies differ, so it should not).

### 3. Normals for the copies

A copy's normal is its own sheet's. Near the crossing `F ≈ g·h`, and at the node the Hessian is rank 2 and indefinite: `H = λ₁ u₁u₁ᵀ + λ₂ u₂u₂ᵀ` with `λ₁ > 0 > λ₂`, null along the crossing curve. The two sheets are the planes `√λ₁ (u₁·d) = ±√|λ₂| (u₂·d)`, with normals `√λ₁ u₁ ∓ √|λ₂| u₂`.

- Compute H at the node with the 3D stencil already in `critical`: factor it out into a function that returns the Hessian at a point.
- Assign each copy the plane normal nearer parallel to the normals at its sheet's neighboring vertices. Classify by line (absolute cosine), not by sign.
- **Sign.** Along one sheet, `∇F` flips across the crossing, because the other factor changes sign there. So the two halves of sheet A have opposite vertex normals, and one copy's normal is right in sign for one half and wrong for the other. The key light is two-sided (`abs(dot(n, ·))` after flipping for back faces, `web/spatial/renderer.ts`), but interpolating between opposite normals within one triangle passes through zero and shades a dark band.
  - **Fix in the renderer:** in `implicitMesh`, give a corner whose normal points against its triangle's face normal a flipped copy of the vertex, as corners without a normal already get one. Hash-check that no existing preset's drawing changes; few if any have such corners.
  - **Fix in the engine:** make four copies per node (sheet × side). This is not recommended: it breaks the topology the copies exist for.
- `Singular` should then stop counting nodes, or count them separately; the note's "N vertices have no normal" sentence changes accordingly.

### 4. Topology readout

With copies in place, `topology()` sees the abstract surface:

- **Pieces.** Pieces are connected through shared vertices. Copies are distinct vertices, so a piece is a connected abstract surface. The Klein bottle remains one piece.
- **Euler characteristic.** `V − E + F` is now the surface's own: 0 for the Klein bottle, and 4 for a sphere crossed by a plane in a box.
- **Orientability.** The stored winding faces larger F, which flips across each crossing on each sheet, so it cannot be used. Instead, propagate an orientation over manifold edges by breadth-first search, ignoring the stored winding. A conflict means the piece is non-orientable.
- **Classification.** A closed orientable piece has genus `(2 − χ)/2`. A closed non-orientable piece has `2 − χ` cross-caps: 1 is a projective plane, 2 a Klein bottle. An open piece reports χ and its boundary loops.
- **Note wording,** following the help-text rules in `AGENTS.md` (short, plain, no algorithm): for example, "The mesh is one piece, closed and one-sided, a Klein bottle (Euler characteristic 0), meeting itself along N edges." Add cases to the `implicitNote` unit test in `tests/spatial-implicit.spec.ts`, and update the Klein preset's note test there, which today matches "closed, meeting itself along … edges (Euler characteristic 0)".

### 5. Transport

A new array (`twins`) goes in the typed mesh reply like `crossings`:

- `cmd/wasm/mesh.go`: append it to the `ints` list and nil it.
- `web/engine.worker.ts`: add it to the name union.
- `web/spatial/types.ts`: add the field.
- `scripts/test-wasm.mjs`: add it to `implicitArrays`, and assert it in the sphere × plane case.

Keep Go and TS fields synchronized.

## Pitfalls already paid for

- **Grid planes.** A crossing in a grid plane puts nodes on edges. The shift handles it; do not decide anything on the unshifted F inside crossing tetrahedra.
- **Copies of grid points.** `snap` must not move a root onto a grid point exactly on the level: the bracket guard `ga == 0 || gb == 0` prevents that. Without it, the symmetric cone gets a second normal-less vertex beside its apex. Plain marching itself copies grid points where F is zero (as on a 3-4-5 triangle in the cone's box), which is pre-existing, so assert vertex uniqueness only near crossings.
- **Grazing caps.** A sheet grazing an edge makes a loop of two roots. Fanning it to an apex makes a fin, and drawing its two face arcs as one chord folds it. `fold` and the apex merge handle this; a face-arc midpoint vertex was tried and made things worse (χ changed on the Klein bottle and the Roman surface).
- **Cost.** Ordinary studies must stay bit-for-bit identical, and nearly as fast. Every non-crossing preset's mesh is identical to `main` today. Candidates are filtered by gradients pointing apart and across, with an eight-step Newton search in `meets`, which keeps nested sheets (the three tori) cheap.
- **Similarity.** `TestSimilarPresets` holds crossing vertices to a separate `crossing` budget of 10⁻⁴ cells, and skips vertices without a normal. Copies with normals will fall under the `crossing` class if they are within two cells of a vertex without a normal; with nodes now carrying normals, revisit how that class is found.
- **Architectures.** Run `GOARCH=amd64 go test ./engine3` on an arm64 machine: a tolerance equal to the shift once failed only on amd64.

## Tests to write first

In `engine3/implicit_crossing_test.go`, each seen failing first:

- **Sphere × plane:** every crossing vertex has exactly one twin at the same position; each sheet's crossing edges carry two triangles; no edge carries more than two; the surface is two pieces (sphere and plane disc) whose χ are 2 and 1 in the shifted box. The current test asserts four triangles per crossing edge and one piece; update it on purpose.
- **Klein preset** at 0 and 1 levels: one piece, closed, χ = 0, non-orientable, two cross-caps.
- **A closed orientable self-crossing surface**, for contrast: two spheres crossing, `(x² + y² + z² − 1)((x − 1)² + y² + z² − 1) = 0`, which should read as two pieces, each orientable genus 0.
- **Normals:** every copy has a unit normal, parallel (in line) to its sheet's limiting normal; for the sphere × plane, sheet A's copies are along the radius and B's along z.
- **Unchanged:** cones, Cassini's drops touching, the Whitney umbrella, Steiner's Roman surface (edges on one, two or four triangles become one or two), the budget fallback, and every non-crossing preset (`TestCrossingPresetsUnchanged`).

Then run the targeted mutation pass described in `AGENTS.md`:

- swap the two path indices on one side of a node face;
- key copies by face only;
- drop the twin record;
- trust the stored winding for orientability;
- choose the copy normal by sign.

## Verification

- `gofmt`, `make check`, and `GOARCH=amd64 go test ./engine3`.
- `make preset-hashes ARGS="--compare https://tangent-garden.isaacvelando.com/"`, with `--refine on` and `--refine off`. A new result field changes every implicit hash. Confirm that only the two Klein presets' meshes differ by hashing positions, normals, triangles, cut, open, sections, marks, counts and components in both trees. A throwaway Go test in a `main` worktree did this for #165.
- `make thumbnails`: expect the Klein preset's pair to change, and nothing else.
- Browser specs:
  - `tests/spatial-implicit.spec.ts`, for the note;
  - `tests/spatial-sight.spec.ts`, for the Klein bottle seen through;
  - export equivalence and gallery.
- **Before and after.** A temporary Playwright spec, deleted afterwards, that opens the preset on the local build and on the live site through a base URL, zooms with the wheel, and screenshots `#spatial-artwork`. Look at both themes and a phone width, then ask for an on-device check.

## Related work, if measuring shows geometry rather than shading

- **Refine along the crossing.** Refinement already flags tetrahedra the crossing passes through, but only up to the levels asked for. A crossing-specific refinement could follow the curve more finely without refining the whole surface. It would have to keep refinement's conformity and budget rules.
- **Better fans.** Each half-sheet in a crossing tetrahedron is fanned from `n1`. Its polygon is convex in exact arithmetic but can carry slivers; a minimum-angle triangulation of the loop may look smoother.
- **Exact nodes.** Nodes and apices sit within the shift (10⁻⁴ of a step) of the true crossing. Projecting them back onto F = 0, ∇F = 0 by a Gauss–Newton step with a minimum-norm solve would remove that, which matters only at high zoom.
