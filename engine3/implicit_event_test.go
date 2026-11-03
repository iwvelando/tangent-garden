package engine3

import (
	"math"
	"slices"
	"testing"

	"tangentgarden/engine/expr"
)

// The topology theater's curated events (web/spatial/story.ts and
// docs/mathematics.md, "Curated events"): two drops that join at c = 1,
// and a sphere whose dimples meet at c = 1 and open into a torus below it.
// The critical level and the surface on each side are derived
// analytically; these tests check the derivation's facts on F itself,
// then what the mesher actually returns at regular levels beside the
// event, as resolution, refinement and the grid's placement change, and
// where finite resolution stops supporting the class.

type eventRecipe struct {
	preset string
	// Euler characteristics of the closed pieces below and above c = 1,
	// ascending.
	below, above []int
	// Half-widths of the box about the origin holding F ≤ c.
	extent func(c float64) Vec3
	// The width of the feature that narrows toward the event at level c:
	// the gap between drops or dimples, or the neck or hole's diameter.
	feature func(c float64) float64
	// Where each extent is reached on F = c.
	extremes func(c float64) []Vec3
	// F's Hessian at the origin.
	hessian [3]float64
}

var eventRecipes = []eventRecipe{
	{
		preset: "Two drops become one",
		below:  []int{2, 2},
		above:  []int{2},
		extent: func(c float64) Vec3 {
			return Vec3{math.Sqrt(1 + math.Sqrt(c)), math.Sqrt(c) / 2, math.Sqrt(c) / 2}
		},
		feature: func(c float64) float64 {
			if c < 1 {
				return 2 * math.Sqrt(1-math.Sqrt(c)) // between the drops along x
			}
			return 2 * math.Sqrt(math.Sqrt(c)-1) // the neck at x = 0
		},
		extremes: func(c float64) []Vec3 {
			return []Vec3{{math.Sqrt(1 + math.Sqrt(c)), 0, 0}, {math.Sqrt(1 - c/4), math.Sqrt(c) / 2, 0}}
		},
		// F = r⁴ + 2r² + 1 − 4x²: a saddle of index 1.
		hessian: [3]float64{-4, 4, 4},
	},
	{
		preset: "The instant a handle appears",
		below:  []int{0},
		above:  []int{2},
		extent: func(c float64) Vec3 {
			r := math.Sqrt(1 + math.Sqrt(c))
			return Vec3{r, r, math.Sqrt(c)}
		},
		feature: func(c float64) float64 {
			if c > 1 {
				return 2 * math.Sqrt(c-1) // between the dimples along z
			}
			return 2 * math.Sqrt(1-math.Sqrt(c)) // the hole at z = 0
		},
		extremes: func(c float64) []Vec3 {
			return []Vec3{{math.Sqrt(1 + math.Sqrt(c)), 0, 0}, {1, 0, math.Sqrt(c)}}
		},
		// F = 1 − 2ρ² + ρ⁴ + z²: index 2.
		hessian: [3]float64{-4, -4, 2},
	},
}

// The preset's own study, as the app sends it.
func eventStudy(t *testing.T, r eventRecipe) ImplicitRequest {
	t.Helper()
	q := spatialPresets(t)[r.preset].Implicit
	if q.F == "" {
		t.Fatalf("no preset %q", r.preset)
	}
	return q
}

// The study's mesh without levelSet's checks of each triangle's facing,
// which beside a singular point, where the normals at a triangle's corners
// turn sharply, need not hold.
func eventMesh(t *testing.T, q ImplicitRequest) *ImplicitResult {
	t.Helper()
	r, err := Compute(Request{Format: "implicit", Implicit: q})
	if err != nil {
		t.Fatal(err)
	}
	return r.Implicit
}

// The Euler characteristics of the mesh's pieces, ascending, when the mesh
// is complete enough to compare: closed, two-sided, nothing left out and
// refinement within its budget.
func eventPieces(m *ImplicitResult) ([]int, bool) {
	whole := closed(m) && m.Nonfinite == 0 && m.Discontinuities == 0 && !m.Refinement.Exhausted &&
		m.CrossingsUnresolved == 0 && !m.CrossingsExhausted && len(m.Triangles) > 0
	var out []int
	for _, c := range m.Components {
		whole = whole && c.Orientable
		out = append(out, c.Euler)
	}
	slices.Sort(out)
	return out, whole
}

func (r eventRecipe) class(c float64) []int {
	if c < 1 {
		return r.below
	}
	return r.above
}

var (
	eventCube = Box{-2, 2, -2, 2, -2, 2}
	// Off every lattice point the symmetric grids share with the origin,
	// and still holding the surface up to c = 1.44.
	eventShifted = Box{-2 + 0.0371, 2 + 0.0371, -2 + 0.0213, 2 + 0.0213, -2 - 0.0157, 2 - 0.0157}
)

// The derivation's facts, on F as the engine parses it: the origin is a
// critical point at the critical level with the derived Hessian, and the
// box bound is reached on the level set, so it is tight.
func TestEventAnalytic(t *testing.T) {
	for _, r := range eventRecipes {
		q := eventStudy(t, r)
		f, _, err := expr.ParseSpatialField(q.F, q.A)
		if err != nil {
			t.Fatal(err)
		}
		F := func(p Vec3) float64 { return f(p.X, p.Y, p.Z, 0) }
		if F(Vec3{}) != 1 {
			t.Fatalf("%s: F(0) = %v", r.preset, F(Vec3{}))
		}
		const h = 1e-4
		axes := []Vec3{{1, 0, 0}, {0, 1, 0}, {0, 0, 1}}
		for i, e := range axes {
			if g := (F(e.mul(h)) - F(e.mul(-h))) / (2 * h); math.Abs(g) > 1e-9 {
				t.Fatalf("%s: ∂F/∂%c = %v at the origin", r.preset, "xyz"[i], g)
			}
			for j, d := range axes {
				second := (F(e.add(d).mul(h)) - F(e.sub(d).mul(h)) - F(d.sub(e).mul(h)) + F(e.add(d).mul(-h))) / (4 * h * h)
				want := 0.0
				if i == j {
					want = r.hessian[i]
				}
				if math.Abs(second-want) > 1e-5 {
					t.Fatalf("%s: H[%d][%d] = %v, want %v", r.preset, i, j, second, want)
				}
			}
		}
		for _, c := range []float64{0.64, 1, 1.44} {
			e := r.extent(c)
			for _, p := range r.extremes(c) {
				if math.Abs(F(p)-c) > 1e-12 {
					t.Fatalf("%s: F%v = %v at c = %v", r.preset, p, F(p), c)
				}
				if math.Abs(p.X) > e.X+1e-15 || math.Abs(p.Y) > e.Y+1e-15 || math.Abs(p.Z) > e.Z+1e-15 {
					t.Fatalf("%s: %v beyond the extent %v", r.preset, p, e)
				}
			}
		}
		e := r.extent(1.44)
		if !(q.Box.XMin < -e.X && q.Box.XMax > e.X && q.Box.YMin < -e.Y && q.Box.YMax > e.Y && q.Box.ZMin < -e.Z && q.Box.ZMax > e.Z) {
			t.Fatalf("%s: box %+v does not hold %v", r.preset, q.Box, e)
		}
	}
}

// At the bracket's regular levels, 1 ± 0.16, and at the ends of the levels
// the story covers, the mesh is the analytic class on every grid tried:
// 24, 40, 56 and 60 cells, refined to 0, 1 or 2 levels, in the symmetric
// box and in one moved off its lattice, and never cut by the box.
func TestEventRegularNeighbors(t *testing.T) {
	for _, r := range eventRecipes {
		base := eventStudy(t, r)
		for _, box := range []Box{eventCube, eventShifted} {
			for _, cells := range []int{24, 40, 56, 60} {
				for _, refine := range []int{0, 1, 2} {
					for _, c := range []float64{0.64, 0.84, 1.16, 1.44} {
						if refine > 0 && (c == 0.64 || c == 1.44) {
							continue
						}
						q := base
						q.Box, q.Cells, q.Refine, q.Level = box, cells, refine, c
						m := levelSet(t, q)
						got, whole := eventPieces(m)
						if !whole || !slices.Equal(got, r.class(c)) || m.Singular != 0 {
							t.Fatalf("%s at c = %v, %d cells, %d levels, box %v: pieces %v (whole %v), %d singular, %d cut",
								r.preset, c, cells, refine, box, got, whole, m.Singular, len(m.Cut)/2)
						}
					}
				}
			}
		}
	}
}

// Narrowing the bracket toward 1 narrows the feature that changes: the
// gap, neck or hole. Off the lattice, the class holds wherever that
// feature spans at least two cells; nearer the event a grid can misread
// it, and the tests do not assert it there. Two such misreads at a
// quarter of a cell, which the story's note reports rather than relabels:
// at c = 0.999 on 24 cells the drops' gap is bridged into one piece,
// refined or not, and the handle's hole is missed, a sphere, though two
// levels of refinement find it.
func TestEventResolution(t *testing.T) {
	asserted := 0
	for _, r := range eventRecipes {
		base := eventStudy(t, r)
		for _, cells := range []int{24, 60} {
			h := (eventShifted.XMax - eventShifted.XMin) / float64(cells)
			for _, d := range []float64{0.16, 0.04, 0.01, 0.003, 0.001} {
				for _, c := range []float64{1 - d, 1 + d} {
					for _, refine := range []int{0, 2} {
						q := base
						q.Box, q.Cells, q.Refine, q.Level = eventShifted, cells, refine, c
						w := r.feature(c)
						m := eventMesh(t, q)
						if w >= 2*h {
							m = levelSet(t, q)
						}
						got, whole := eventPieces(m)
						if w >= 2*h {
							asserted++
							if !whole || !slices.Equal(got, r.class(c)) {
								t.Fatalf("%s at c = %v, %d cells, %d levels: feature %.3g of cell %.3g, pieces %v (whole %v)",
									r.preset, c, cells, refine, w, h, got, whole)
							}
						} else if !slices.Equal(got, r.class(c)) {
							t.Logf("%s at c = %v, %d cells, %d levels: feature %.3g, %.2g cells, reads %v",
								r.preset, c, cells, refine, w, w/h, got)
						}
					}
				}
			}
		}
	}
	if asserted < 30 {
		t.Fatalf("only %d resolved cases asserted", asserted)
	}
	misread := func(r eventRecipe, refine int) []int {
		q := eventStudy(t, r)
		q.Box, q.Cells, q.Refine, q.Level = eventShifted, 24, refine, 0.999
		got, whole := eventPieces(eventMesh(t, q))
		if !whole {
			t.Fatalf("%s: incomplete at c = 0.999", r.preset)
		}
		return got
	}
	drops, handle := eventRecipes[0], eventRecipes[1]
	for _, refine := range []int{0, 2} {
		if got := misread(drops, refine); !slices.Equal(got, []int{2}) {
			t.Fatalf("the drops 0.045 apart on 24 cells, %d levels: %v", refine, got)
		}
	}
	if got := misread(handle, 0); !slices.Equal(got, []int{2}) {
		t.Fatalf("the handle's hole 0.045 wide on 24 cells: %v", got)
	}
	if got := misread(handle, 2); !slices.Equal(got, []int{0}) {
		t.Fatalf("the handle's hole refined twice: %v", got)
	}
}

// At c = 1 the surface is singular at the origin and no mesh certifies it.
// It is always closed in these boxes. With the origin a grid point, as in
// the presets' 56-cell cube, the pinch is one vertex without a normal:
// two spheres sharing it (χ = 3) and a sphere with two points made one
// (χ = 1). With the origin inside a cell (57 cells) the mesh reads as a
// regular neighbor, two drops or a sphere, with no singular vertex: a
// finite mesh can look smooth there.
func TestEventSingular(t *testing.T) {
	for i, r := range eventRecipes {
		base := eventStudy(t, r)
		base.Level = 1
		for _, box := range []Box{eventCube, eventShifted} {
			for _, cells := range []int{24, 40, 56, 57, 60} {
				for _, refine := range []int{0, 1} {
					q := base
					q.Box, q.Cells, q.Refine = box, cells, refine
					m := eventMesh(t, q)
					got, whole := eventPieces(m)
					if len(m.Cut) != 0 || len(m.Open) != 0 || !whole && m.Refinement.Exhausted {
						t.Fatalf("%s at c = 1, %d cells: %d cut, %d open", r.preset, cells, len(m.Cut)/2, len(m.Open)/2)
					}
					if m.Singular == 0 && m.Cones == 0 && !slices.Equal(got, r.below) && !slices.Equal(got, r.above) {
						t.Fatalf("%s at c = 1, %d cells, box %v: %v with no singular vertex", r.preset, cells, box, got)
					}
				}
			}
		}
		q := base
		m := eventMesh(t, q)
		got, _ := eventPieces(m)
		if want := [][]int{{3}, {1}}[i]; !slices.Equal(got, want) || m.Singular != 1 {
			t.Fatalf("%s's own grid at c = 1: %v, %d singular", r.preset, got, m.Singular)
		}
		q.Cells = 57
		m = eventMesh(t, q)
		got, _ = eventPieces(m)
		if want := [][]int{{2, 2}, {2}}[i]; !slices.Equal(got, want) || m.Singular != 0 || m.Cones != 0 {
			t.Fatalf("%s on 57 cells at c = 1: %v, %d singular, %d cones", r.preset, got, m.Singular, m.Cones)
		}
	}
}

// A box too small for the surface cuts it open, which is never read as a
// closed class; refinement that disagrees at its deepest level, or runs out
// of its budget, is reported as such.
func TestEventIncomplete(t *testing.T) {
	for _, r := range eventRecipes {
		q := eventStudy(t, r)
		q.Box, q.Cells, q.Level = Box{-1.2, 1.2, -1.2, 1.2, -1.2, 1.2}, 40, 1.16
		m := eventMesh(t, q)
		if _, whole := eventPieces(m); whole || len(m.Cut) == 0 {
			t.Fatalf("%s clipped: %d cut edges, components %+v", r.preset, len(m.Cut)/2, m.Components)
		}
	}
	q := eventStudy(t, eventRecipes[0])
	q.Box, q.Cells, q.Refine, q.Level = eventShifted, 40, 2, 1.001
	m := eventMesh(t, q)
	if m.Refinement.Unresolved == 0 || m.Refinement.Exhausted {
		t.Fatalf("the drops' thread at c = 1.001: %+v", m.Refinement)
	}
	defer func(n int) { maxRefinedTetrahedra = n }(maxRefinedTetrahedra)
	maxRefinedTetrahedra = refineReserve + 500
	m = eventMesh(t, q)
	if _, whole := eventPieces(m); whole || !m.Refinement.Exhausted {
		t.Fatalf("exhausted refinement read whole: %+v", m.Refinement)
	}
}
