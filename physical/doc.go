// Package physical turns frozen planar geometry into printable solids: a
// two-level height field over a round plaque, checked as a closed mesh and
// against a printer profile, and written as a core 3MF package. Lengths
// are millimeters; nothing here reads the interface or the camera.
//
// # The pipeline
//
// A consumer with planar centerlines (arcs and segments of a width) builds
// a solid in these steps, each bounded by a Limits value:
//
//  1. Plan: the strokes, each a Stroke with its half width, an optional
//     clip circle and frame band, and the plaque's radius. Its signed
//     field F is negative inside the plan region L.
//  2. Sample(plan, h, cap, lim) evaluates F exactly on a grid of step h
//     (ErrLimit past lim.Nodes, lim.Evaluations or lim.Strokes).
//  3. (*Grid).Clean fills sub-step specks; (*Grid).Simplify optionally
//     removes material below a wall and fills gaps below a gap, by two
//     sampled morphological openings, and reports what changed.
//  4. (*Grid).Contour traces F < 0 by marching squares: simple, disjoint
//     loops, outer boundaries counterclockwise (lim.Vertices).
//  5. SolidifyWithin(contours, base, levels, lim) extrudes the plan to
//     levels.Plan and the rest of the plaque to levels.Rest from a flat
//     bottom at zero (lim.Triangles). (*Mesh).TurnOver rotates it face
//     down.
//  6. Check(mesh, lim) validates the mesh alone: closed two-manifold,
//     outward orientation, components and nesting, degenerate, crossing
//     and touching triangles, with volume and bounds. lim.PairTests bounds
//     the triangle-pair tests; a check stopped by it is Unresolved, and
//     Report.Valid is false.
//  7. Write3MF(w, mesh, info, lim) writes one object in millimeters, its
//     coordinates in the shortest decimal that reads back as the same
//     float64, with the reproducible settings as tg:settings metadata,
//     deterministically (lim.Package). Read3MF reads such a package back.
//
// AnalyzeCells checks a sampled plan's complement against a minimum
// inscribed diameter; Profile, Design and CheckItem state what a printer
// is asked. BuildLaceSolid is the lace's complete use of these steps, with
// its rim policies and checks, and the model for other sources.
//
// # Validation semantics
//
// A solid is validated when every required CheckItem passes. A required
// check that fails or is unresolved means "not validated": the package
// is still written, and the interface names it so. Evidence says how a
// check knows: exact (from the numbers asked), conservative (a bound that
// holds by construction), sampled (on the grid, with its allowance) or
// measured (from the mesh). The printer profile never changes a solid's
// shape: it only sets what the checks require and where the package
// places the object on the bed.
//
// # Determinism
//
// Equal inputs give bit-identical meshes and packages on one architecture.
// WebAssembly, as the browser runs it, matches amd64; arm64 fuses
// multiply-adds, so its last digits differ. Fixtures are pinned for each
// (contract_test.go).
package physical
