package engine3

import (
	"math"
	"sort"
	"testing"
)

// edgeTriangles counts the triangles on each edge of the mesh.
func edgeTriangles(m *ImplicitResult) map[[2]int32]int {
	out := map[[2]int32]int{}
	for k := 0; k < len(m.Triangles); k += 3 {
		for e := range 3 {
			a, b := m.Triangles[k+e], m.Triangles[k+(e+1)%3]
			out[[2]int32{min(a, b), max(a, b)}]++
		}
	}
	return out
}

// crossingLoops checks that the crossing edges are edges of the mesh, each
// shared by four triangles, and that they join into closed loops, every
// crossing vertex on exactly two of them; it returns the number of loops.
func crossingLoops(t *testing.T, m *ImplicitResult) int {
	t.Helper()
	triangles := edgeTriangles(m)
	next := map[int32][]int32{}
	for k := 0; k < len(m.Crossings); k += 2 {
		a, b := m.Crossings[k], m.Crossings[k+1]
		if n := triangles[[2]int32{min(a, b), max(a, b)}]; n != 4 {
			t.Fatalf("crossing edge %d–%d has %d triangles, not 4", a, b, n)
		}
		next[a] = append(next[a], b)
		next[b] = append(next[b], a)
	}
	for v, ns := range next {
		if len(ns) != 2 {
			t.Fatalf("crossing vertex %d at %v is on %d crossing edges", v, m.vertex(v), len(ns))
		}
	}
	seen := map[int32]bool{}
	loops := 0
	for v := range next {
		if seen[v] {
			continue
		}
		loops++
		for stack := []int32{v}; len(stack) > 0; {
			u := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			if seen[u] {
				continue
			}
			seen[u] = true
			stack = append(stack, next[u]...)
		}
	}
	return loops
}

// crossingVertices lists the vertices on crossing edges.
func crossingVertices(m *ImplicitResult) map[int32]bool {
	out := map[int32]bool{}
	for _, v := range m.Crossings {
		out[v] = true
	}
	return out
}

// A sphere crossed by a plane: two sheets meeting along the unit circle,
// which lies on no grid plane. Crossing vertices lie on the level set
// moved by the crossings' shift, 10⁻⁴ of a cell. The crossing is a closed loop of edges on
// the circle, each shared by both sheets on both sides, and the mesh's
// area, the sphere's 4π and the box's square section of the plane,
// converges at second order: a mesh that turns from one sheet to the
// other across the crossing cuts its corners and converges at first.
func TestCrossingSpherePlane(t *testing.T) {
	box := Box{-1.53, 1.47, -1.51, 1.49, -1.17, 1.23}
	exact := 4*math.Pi + 3*3
	var errs []float64
	for _, cells := range []int{24, 48} {
		m := levelSet(t, implicitStudy("(x^2 + y^2 + z^2 - 1)*z", 0, box, cells))
		if len(m.Open) != 0 || m.CrossingsUnresolved != 0 || m.CrossingsExhausted {
			t.Fatalf("%d cells: %d open edges, %d unresolved, exhausted %v", cells, len(m.Open)/2, m.CrossingsUnresolved, m.CrossingsExhausted)
		}
		if len(m.Crossings) == 0 || crossingLoops(t, m) != 1 {
			t.Fatalf("%d cells: %d crossing edges, not one loop", cells, len(m.Crossings)/2)
		}
		for v := range crossingVertices(m) {
			p := m.vertex(v)
			if math.Abs(p.Z) > 1e-5 || math.Abs(math.Hypot(p.X, p.Y)-1) > 1e-5 {
				t.Fatalf("%d cells: crossing vertex %v is not on the unit circle", cells, p)
			}
			if m.normal(v) != (Vec3{}) {
				t.Fatalf("%d cells: crossing vertex %v has normal %v", cells, p, m.normal(v))
			}
		}
		if len(m.Components) != 1 || m.Components[0].Crossings != len(m.Crossings)/2 {
			t.Fatalf("%d cells: components %+v with %d crossing edges", cells, m.Components, len(m.Crossings)/2)
		}
		// Every other vertex, its crossing in general position, lies on F
		// to rounding, the shift undone.
		for v := int32(0); v < int32(len(m.Positions)/3); v++ {
			if p := m.vertex(v); m.normal(v) != (Vec3{}) && math.Abs((p.dot(p)-1)*p.Z) > 1e-12 {
				t.Fatalf("%d cells: vertex %v is off the level by %g", cells, p, (p.dot(p)-1)*p.Z)
			}
		}
		errs = append(errs, math.Abs(m.area()-exact))
	}
	if !(errs[1] < errs[0]/3) {
		t.Fatalf("area errors %v do not converge at second order", errs)
	}
}

// In a box symmetric about the origin the circle lies in the grid plane
// z = 0 and passes through grid points, (±1, 0, 0), (0, ±1, 0) and
// (±0.6, ±0.8, 0) among them, where F is zero to rounding and the
// crossings' shift can move a point across the level: the crossing is
// still one closed loop, with nothing left out or open.
func TestCrossingSymmetric(t *testing.T) {
	m := levelSet(t, implicitStudy("(x^2 + y^2 + z^2 - 1)*z", 0, cube(1.5), 30))
	if len(m.Open) != 0 || m.CrossingsUnresolved != 0 || m.CrossingsExhausted || len(m.Components) != 1 {
		t.Fatalf("%d open edges, %d unresolved, exhausted %v, components %+v", len(m.Open)/2, m.CrossingsUnresolved, m.CrossingsExhausted, m.Components)
	}
	if len(m.Crossings) == 0 || crossingLoops(t, m) != 1 {
		t.Fatalf("%d crossing edges, not one loop", len(m.Crossings)/2)
	}
	for e, n := range edgeTriangles(m) {
		if n != 1 && n != 2 && n != 4 {
			t.Fatalf("edge %v has %d triangles", e, n)
		}
	}
}

// The usual immersion of the Klein bottle meets itself along a closed
// curve, which lies in the grid plane z = 0 of the preset's symmetric box
// and touches a sheet tangent to that plane at (0, ±1, 0). Meshed through
// its crossing, it is closed, with the Euler characteristic of a Klein
// bottle less that of the circle where its two sheets are joined: 0 − 0.
// Meshed as the boundary of F ≥ 0 it would be an orientable surface of
// genus 2. Crossing vertices lie within the crossings' shift of the double
// curve, where F and ∇F vanish: there F is of the order of the shift
// squared, and ∇F of the order of the shift, both far below the median
// |∇F| at the mesh's other vertices.
func TestCrossingKlein(t *testing.T) {
	f := "(x^2 + y^2 + z^2 + 2*x - 1)*((x^2 + y^2 + z^2 - 2*x - 1)^2 - 8*z^2) + 16*y*z*(x^2 + y^2 + z^2 - 2*x - 1)"
	klein := func(p Vec3) float64 {
		r := p.dot(p)
		return (r+2*p.X-1)*((r-2*p.X-1)*(r-2*p.X-1)-8*p.Z*p.Z) + 16*p.Y*p.Z*(r-2*p.X-1)
	}
	slope := func(p Vec3) float64 {
		const h = 1e-6
		var g Vec3
		for k, e := range [3]Vec3{{h, 0, 0}, {0, h, 0}, {0, 0, h}} {
			d := (klein(p.add(e)) - klein(p.sub(e))) / (2 * h)
			g = g.add([3]Vec3{{d, 0, 0}, {0, d, 0}, {0, 0, d}}[k])
		}
		return g.norm()
	}
	for _, refine := range []int{0, 1} {
		q := implicitStudy(f, 0, Box{-2.7, 3.3, -3.1, 3.1, -3.9, 3.9}, 48)
		q.Refine = refine
		m := levelSet(t, q)
		if !closed(m) || len(m.Components) != 1 || m.Components[0].Euler != 0 {
			t.Fatalf("refine %d: components %+v, %d open edges", refine, m.Components, len(m.Open)/2)
		}
		if m.CrossingsUnresolved != 0 || m.CrossingsExhausted || len(m.Crossings) == 0 || crossingLoops(t, m) != 1 {
			t.Fatalf("refine %d: %d crossing edges, %d unresolved, exhausted %v", refine, len(m.Crossings)/2, m.CrossingsUnresolved, m.CrossingsExhausted)
		}
		crossing := crossingVertices(m)
		var slopes []float64
		for v := int32(0); v < int32(len(m.Positions)/3); v++ {
			if !crossing[v] {
				slopes = append(slopes, slope(m.vertex(v)))
			}
		}
		sort.Float64s(slopes)
		typical := slopes[len(slopes)/2]
		for v := range crossing {
			p := m.vertex(v)
			if d, g := math.Abs(klein(p))/typical, slope(p)/typical; d > 1e-7 || g > 1e-3 {
				t.Fatalf("refine %d: crossing vertex %v has F = %g and |∇F| = %g of the typical |∇F|", refine, p, d, g)
			}
		}
	}
}

// A double cone's two nappes meet at its apex, which lies on no grid
// plane: they are joined at one vertex there, without a normal, where the
// crossings' shift moves the apex, 10⁻⁴ of the 0.1 cell from it. So they
// are in a box symmetric about the apex, which lies on a grid point.
func TestCrossingCone(t *testing.T) {
	for _, cells := range []int{20, 48} {
		m := levelSet(t, implicitStudy("x^2 + y^2 - z^2", 0, cube(1.3), cells))
		if m.Cones != 1 || m.Singular != 1 || len(m.Open) != 0 || len(m.Components) != 1 || m.Components[0].Euler != 1 {
			t.Fatalf("symmetric, %d cells: %d cones, %d singular, %d open edges, components %+v", cells, m.Cones, m.Singular, len(m.Open)/2, m.Components)
		}
		// F is zero at the grid point at the apex: no two vertices within
		// a cell of it are copies of it, or of any other point. (Marching
		// itself copies some grid points where F is zero, as at
		// (−0.78, −1.04, −1.3), on a 3-4-5 triangle.)
		at := map[Vec3]int32{}
		for v := int32(0); v < int32(len(m.Positions)/3); v++ {
			if m.vertex(v).norm() > 2.6/float64(cells) {
				continue
			}
			if u, ok := at[m.vertex(v)]; ok {
				t.Fatalf("symmetric, %d cells: vertices %d and %d both at %v", cells, u, v, m.vertex(v))
			}
			at[m.vertex(v)] = v
		}
	}
	m := levelSet(t, implicitStudy("x^2 + y^2 - z^2", 0, Box{-1.03, 0.97, -1.01, 0.99, -1.02, 0.98}, 20))
	if m.Cones != 1 || len(m.Open) != 0 || len(m.Components) != 1 || m.Singular != 1 {
		t.Fatalf("%d cones, %d open edges, %d singular, components %+v", m.Cones, len(m.Open)/2, m.Singular, m.Components)
	}
	apex := 0
	for v := int32(0); v < int32(len(m.Positions)/3); v++ {
		if m.vertex(v).norm() < 2e-5 && m.normal(v) == (Vec3{}) {
			apex++
		}
	}
	if apex != 1 {
		t.Fatalf("%d vertices at the apex", apex)
	}
	// In the box of the sphere and its latitudes moved off x = 0 and
	// y = 0, the apex lies on a cell's diagonal edge, where a nappe beside
	// the shifted apex only grazes that edge in a cap smaller than the
	// shift. The cap is not folded flat into a pair of triangles: each
	// nappe is a disc in the box, Euler characteristic 1, every edge on
	// one triangle (cut by the box) or two, nothing left open; joined at
	// the apex, and counted as meeting there, or apart beside it, and not.
	for _, cells := range []int{20, 48} {
		m := levelSet(t, implicitStudy("x^2 + y^2 - z^2", 0, Box{-1.2, 1.3, -1.2, 1.3, -1.3, 1.3}, cells))
		joined := len(m.Components) == 1 && m.Components[0].Euler == 1
		apart := len(m.Components) == 2 && m.Components[0].Euler == 1 && m.Components[1].Euler == 1
		if !joined && !apart || len(m.Open) != 0 || joined != (m.Cones == 1) {
			t.Fatalf("%d cells: components %+v, %d cones, %d open edges", cells, m.Components, m.Cones, len(m.Open)/2)
		}
		for e, n := range edgeTriangles(m) {
			if n > 2 {
				t.Fatalf("%d cells: edge %v has %d triangles", cells, e, n)
			}
		}
	}
}

// Cassini's drops touch at c = 1 at the saddle between them. Inside a
// cell, as on a grid point, they are one piece joined at one vertex: two
// spheres sharing a point, of Euler characteristic 2 + 2 − 1.
func TestCrossingCassiniTouch(t *testing.T) {
	q := implicitStudy("((x-a)^2+y^2+z^2)*((x+a)^2+y^2+z^2)", 1, Box{-1.8 + 0.0371, 1.8 + 0.0371, -1.2, 1.2, -1.2, 1.2}, 48)
	q.A = 1
	m := levelSet(t, q)
	if !closed(m) || len(m.Components) != 1 || m.Components[0].Euler != 3 || m.Cones != 1 || m.Singular != 1 {
		t.Fatalf("components %+v, %d cones, %d singular", m.Components, m.Cones, m.Singular)
	}
}

// Surfaces whose crossings end or meet: the Whitney umbrella's double line
// ends at its pinch point, and Steiner's Roman surface has three double
// lines meeting at a triple point, each ending at two pinch points. Near a
// pinch point the sheets meet at a vanishing angle and may be meshed by
// marching, as before; what cannot be meshed is left out and counted,
// never joined across: every edge has one triangle (cut by the box or
// beside what was left out), two, or, along a crossing, four.
func TestCrossingEnds(t *testing.T) {
	for _, c := range []struct {
		f   string
		box Box
	}{
		{"x^2 - y^2*z", Box{-1.03, 0.97, -1.01, 0.99, -1.02, 0.98}},
		{"x^2*y^2 + y^2*z^2 + z^2*x^2 - x*y*z", Box{-0.61, 0.59, -0.62, 0.58, -0.6, 0.6}},
	} {
		r, err := Compute(Request{Format: "implicit", Implicit: implicitStudy(c.f, 0, c.box, 24)})
		if err != nil {
			t.Fatal(c.f, err)
		}
		m := r.Implicit
		for e, n := range edgeTriangles(m) {
			if n != 1 && n != 2 && n != 4 {
				t.Fatalf("%s: edge %v has %d triangles", c.f, e, n)
			}
		}
		if len(m.Crossings) == 0 {
			t.Fatalf("%s: no crossing found", c.f)
		}
		if len(m.Open) != 0 && m.CrossingsUnresolved == 0 {
			t.Fatalf("%s: %d open edges with nothing left out", c.f, len(m.Open)/2)
		}
	}
}

// Every other implicit preset is a level set that never meets itself, and
// is meshed as before: without crossings or cones.
func TestCrossingPresetsUnchanged(t *testing.T) {
	for name, q := range spatialPresets(t) {
		if q.Format != "implicit" {
			continue
		}
		r, err := Compute(q)
		if err != nil {
			t.Fatal(name, err)
		}
		m := r.Implicit
		klein := name == "A Klein bottle passing through itself" || name == "A Klein bottle in twenty-four slices"
		if !klein && (len(m.Crossings) != 0 || m.Cones != 0 || m.CrossingsUnresolved != 0 || m.CrossingsExhausted) {
			t.Fatalf("%s: %d crossing edges, %d cones, %d unresolved", name, len(m.Crossings)/2, m.Cones, m.CrossingsUnresolved)
		}
		if klein && len(m.Crossings) == 0 {
			t.Fatalf("%s: no crossings", name)
		}
	}
}

// Past their budget of tetrahedra, crossings are not meshed at all: the
// Klein bottle is meshed as before, as the boundary of F ≥ 0, an
// orientable surface of genus 2, and refinement counts the leaves along
// its crossing as unresolved again, which crossing tetrahedra otherwise
// mesh.
func TestCrossingBudget(t *testing.T) {
	q := spatialPresets(t)["A Klein bottle passing through itself"]
	r, err := Compute(q)
	if err != nil {
		t.Fatal(err)
	}
	meshed := r.Implicit
	defer func(n int) { maxCrossingTetrahedra = n }(maxCrossingTetrahedra)
	maxCrossingTetrahedra = 10
	r, err = Compute(q)
	if err != nil {
		t.Fatal(err)
	}
	m := r.Implicit
	if !m.CrossingsExhausted || len(m.Crossings) != 0 || m.Cones != 0 || m.CrossingsUnresolved != 0 {
		t.Fatalf("exhausted %v with %d crossing edges, %d cones, %d unresolved", m.CrossingsExhausted, len(m.Crossings)/2, m.Cones, m.CrossingsUnresolved)
	}
	if !closed(m) || len(m.Components) != 1 || m.Components[0].Euler != -2 || m.Components[0].Crossings != 0 {
		t.Fatalf("components %+v", m.Components)
	}
	if !(meshed.Refinement.Unresolved < m.Refinement.Unresolved) || meshed.Refinement.Bisected != m.Refinement.Bisected {
		t.Fatalf("refinement %+v meshed through crossings, %+v without", meshed.Refinement, m.Refinement)
	}
}
