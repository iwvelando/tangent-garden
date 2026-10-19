package engine3

import (
	"math"
	"reflect"
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
// on two triangles of its own sheet, that every crossing vertex has exactly
// one twin, another vertex at the same point on the other sheet (as does a
// lattice point where a crossing passes through it), and that
// the crossing edges of each sheet join into closed loops, every crossing
// vertex on exactly two of them; it returns the number of loops, counting
// each sheet's.
func crossingLoops(t *testing.T, m *ImplicitResult) int {
	t.Helper()
	triangles := edgeTriangles(m)
	next := map[int32][]int32{}
	for k := 0; k < len(m.Crossings); k += 2 {
		a, b := m.Crossings[k], m.Crossings[k+1]
		if n := triangles[[2]int32{min(a, b), max(a, b)}]; n != 2 {
			t.Fatalf("crossing edge %d–%d has %d triangles, not 2", a, b, n)
		}
		next[a] = append(next[a], b)
		next[b] = append(next[b], a)
	}
	for v, ns := range next {
		if len(ns) != 2 {
			t.Fatalf("crossing vertex %d at %v is on %d crossing edges", v, m.vertex(v), len(ns))
		}
	}
	twin := map[int32]int32{}
	for k := 0; k < len(m.Twins); k += 2 {
		a, b := m.Twins[k], m.Twins[k+1]
		if a == b || m.vertex(a) != m.vertex(b) {
			t.Fatalf("twins %d at %v and %d at %v", a, m.vertex(a), b, m.vertex(b))
		}
		for _, v := range [2]int32{a, b} {
			if _, ok := twin[v]; ok {
				t.Fatalf("vertex %d has two twins", v)
			}
		}
		twin[a], twin[b] = b, a
	}
	for v := range next {
		if _, ok := twin[v]; !ok {
			t.Fatalf("crossing vertex %d at %v has no twin", v, m.vertex(v))
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

// manifold checks that no edge of the mesh is on more than two triangles.
func manifold(t *testing.T, m *ImplicitResult) {
	t.Helper()
	for e, n := range edgeTriangles(m) {
		if n > 2 {
			t.Fatalf("edge %v at %v–%v has %d triangles", e, m.vertex(e[0]), m.vertex(e[1]), n)
		}
	}
}

// sided checks that every triangle corner on a crossing (within 10⁻³ of a
// cell of a crossing vertex) whose normal points against the triangle is
// listed in OnCrossing, where the drawing turns it to the triangle's side:
// along a sheet, larger F lies on the other side of a crossing, so a
// vertex there serves triangles facing both ways. (Elsewhere a sliver's
// corner can point against it too, as in marching.)
func sided(t *testing.T, m *ImplicitResult) {
	t.Helper()
	listed := map[int32]bool{}
	for _, v := range m.OnCrossing {
		listed[v] = true
	}
	cell := (m.Box.XMax - m.Box.XMin) / float64(m.Grid[0])
	crossing := crossingVertices(m)
	near := func(v int32) bool {
		for u := range crossing {
			if m.vertex(u).sub(m.vertex(v)).norm() < 1e-3*cell {
				return true
			}
		}
		return false
	}
	for k := 0; k < len(m.Triangles); k += 3 {
		a, b, c := m.vertex(m.Triangles[k]), m.vertex(m.Triangles[k+1]), m.vertex(m.Triangles[k+2])
		face := b.sub(a).cross(c.sub(a))
		for _, v := range m.Triangles[k : k+3] {
			if m.normal(v).dot(face) < 0 && !listed[v] && near(v) {
				t.Fatalf("vertex %d at %v has normal %v against its triangle %d, and is not listed", v, m.vertex(v), m.normal(v), k/3)
			}
		}
	}
}

// inLine is the angle in degrees between two lines.
func inLine(a, b Vec3) float64 {
	return math.Acos(math.Min(1, math.Abs(a.dot(b))/(a.norm()*b.norm()))) * 180 / math.Pi
}

// crossingVertices lists the vertices on crossing edges.
func crossingVertices(m *ImplicitResult) map[int32]bool {
	out := map[int32]bool{}
	for _, v := range m.Crossings {
		out[v] = true
	}
	return out
}

// sheetNormal is the unit normal of the sheet of the sphere × plane that
// vertex v lies on: radial on the unit sphere, along z on the plane z = 0.
// On the crossing, on both, the sheet is the one its triangles lie on,
// given by their summed normals.
func sheetNormal(m *ImplicitResult, v int32, faces Vec3) Vec3 {
	p := m.vertex(v)
	radial, up := p.mul(1/p.norm()), Vec3{0, 0, 1}
	sphere, plane := math.Abs(p.norm()-1) < math.Abs(p.Z), math.Abs(p.Z) < math.Abs(p.norm()-1)
	if math.Abs(p.norm()-1) < 1e-5 && math.Abs(p.Z) < 1e-5 {
		sphere, plane = true, true
	}
	if sphere && !plane || sphere && plane && inLine(faces, radial) < inLine(faces, up) {
		return radial
	}
	return up
}

// faceNormals is the sum of the unit normals of each vertex's triangles,
// each turned to the side of the first.
func faceNormals(m *ImplicitResult) map[int32]Vec3 {
	out := map[int32]Vec3{}
	for k := 0; k < len(m.Triangles); k += 3 {
		a, b, c := m.vertex(m.Triangles[k]), m.vertex(m.Triangles[k+1]), m.vertex(m.Triangles[k+2])
		n := b.sub(a).cross(c.sub(a))
		if n.norm() == 0 {
			continue
		}
		n = n.mul(1 / n.norm())
		for _, v := range m.Triangles[k : k+3] {
			if out[v].dot(n) < 0 {
				out[v] = out[v].sub(n)
			} else {
				out[v] = out[v].add(n)
			}
		}
	}
	return out
}

// A sphere crossed by a plane: two sheets meeting along the unit circle,
// which lies on no grid plane. Each sheet has its own copy of every vertex
// on the crossing, the two copies twins at one point, within the
// crossings' shift (10⁻⁴ of a cell) of the circle, so each sheet is a
// manifold through the crossing: the sphere a closed piece (Euler
// characteristic 2) and the plane a disc cut by the box (1). Each copy
// has its own sheet's normal, radial on the sphere and along z on the
// plane, and so does every other vertex. The mesh's area, the sphere's
// 4π and the box's square section of the plane, converges at second
// order: a mesh that turns from one sheet to the other across the
// crossing cuts its corners and converges at first.
func TestCrossingSpherePlane(t *testing.T) {
	box := Box{-1.53, 1.47, -1.51, 1.49, -1.17, 1.23}
	exact := 4*math.Pi + 3*3
	var errs []float64
	for _, cells := range []int{24, 48} {
		m := levelSet(t, implicitStudy("(x^2 + y^2 + z^2 - 1)*z", 0, box, cells))
		if len(m.Open) != 0 || m.CrossingsUnresolved != 0 || m.CrossingsExhausted || m.Singular != 0 {
			t.Fatalf("%d cells: %d open edges, %d unresolved, exhausted %v, %d singular", cells, len(m.Open)/2, m.CrossingsUnresolved, m.CrossingsExhausted, m.Singular)
		}
		manifold(t, m)
		sided(t, m)
		if len(m.Crossings) == 0 || crossingLoops(t, m) != 2 {
			t.Fatalf("%d cells: %d crossing edges, not one loop on each sheet", cells, len(m.Crossings)/2)
		}
		for v := range crossingVertices(m) {
			if p := m.vertex(v); math.Abs(p.Z) > 1e-5 || math.Abs(math.Hypot(p.X, p.Y)-1) > 1e-5 {
				t.Fatalf("%d cells: crossing vertex %v is not on the unit circle", cells, p)
			}
		}
		if len(m.Components) != 2 {
			t.Fatalf("%d cells: components %+v", cells, m.Components)
		}
		for _, c := range m.Components {
			sphere := c.Closed && c.Euler == 2
			plane := !c.Closed && c.Euler == 1
			if !sphere && !plane || !c.Orientable || c.Crossings != len(m.Crossings)/4 {
				t.Fatalf("%d cells: components %+v with %d crossing edges", cells, m.Components, len(m.Crossings)/2)
			}
		}
		faces := faceNormals(m)
		for v := int32(0); v < int32(len(m.Positions)/3); v++ {
			n := m.normal(v)
			if want := sheetNormal(m, v, faces[v]); math.Abs(n.norm()-1) > 1e-12 || inLine(n, want) > 1e-2 {
				t.Fatalf("%d cells: vertex %v has normal %v, not along %v", cells, m.vertex(v), n, want)
			}
		}
		// Every vertex but the copies, its crossing in general position,
		// lies on F to rounding, the shift undone.
		crossing := crossingVertices(m)
		for v := int32(0); v < int32(len(m.Positions)/3); v++ {
			if p := m.vertex(v); !crossing[v] && math.Abs((p.dot(p)-1)*p.Z) > 1e-12 {
				t.Fatalf("%d cells: vertex %v is off the level by %g", cells, p, (p.dot(p)-1)*p.Z)
			}
		}
		errs = append(errs, math.Abs(m.area()-exact))
	}
	if !(errs[1] < errs[0]/3) {
		t.Fatalf("area errors %v do not converge at second order", errs)
	}
}

// A plane lying along a grid plane, as z = 0 does in a box symmetric in z,
// puts every grid point of it exactly on the level, and marching puts the
// vertex of every edge leaving such a point at the point itself. Beside
// the crossing an edge from the plane also crosses the sphere, and its
// vertex belongs there, not on the plane: each sheet is still whole, the
// sphere closed (Euler characteristic 2) and the plane a disc cut by the
// box (1), with every vertex its own sheet's normal. The second box is
// "A Klein bottle passing through itself"'s, at its refinement.
func TestCrossingSheetInGridPlane(t *testing.T) {
	for _, c := range []struct {
		box           Box
		cells, refine int
	}{
		{Box{-1.53, 1.47, -1.51, 1.49, -1.5, 1.5}, 24, 0},
		{Box{-1.53, 1.47, -1.51, 1.49, -1.5, 1.5}, 48, 1},
		{Box{-2.7, 3.3, -3.1, 3.1, -3.9, 3.9}, 48, 1},
	} {
		q := implicitStudy("(x^2 + y^2 + z^2 - 1)*z", 0, c.box, c.cells)
		q.Refine = c.refine
		m := levelSet(t, q)
		manifold(t, m)
		sided(t, m)
		if len(m.Components) != 2 || m.CrossingsUnresolved != 0 || m.Singular != 0 || len(m.Open) != 0 {
			t.Fatalf("%v, %d cells, refine %d: components %+v, %d unresolved, %d singular, %d open", c.box, c.cells, c.refine, m.Components, m.CrossingsUnresolved, m.Singular, len(m.Open)/2)
		}
		for _, p := range m.Components {
			if !p.Orientable || !(p.Closed && p.Euler == 2 || !p.Closed && p.Euler == 1) {
				t.Fatalf("%v, %d cells, refine %d: components %+v", c.box, c.cells, c.refine, m.Components)
			}
		}
		faces := faceNormals(m)
		for v := int32(0); v < int32(len(m.Positions)/3); v++ {
			if n, want := m.normal(v), sheetNormal(m, v, faces[v]); inLine(n, want) > 0.5 {
				t.Fatalf("%v, %d cells, refine %d: vertex %v has normal %v, not along %v", c.box, c.cells, c.refine, m.vertex(v), n, want)
			}
		}
	}
}

// A sphere and the paraboloid πz = x² + y² − 1 cross along the unit
// circle, in the grid plane z = 0 of a box symmetric about the origin,
// where neither sheet lies along it, as the Klein bottle's crossing lies in
// its preset's box, and which the paraboloid meets at no other grid point
// (where marching itself would join sheets). The circle passes through
// grid points, (±1, 0, 0),
// (0, ±1, 0) and (±0.6, ±0.8, 0) among them, where F is zero to rounding,
// marching has one vertex for every edge that finds it, and the crossings'
// shift can move a point across the level; and every grid edge in that
// plane that the circle crosses has a root on it, within the shift of the
// crossing, where ∇F all but vanishes and its line, a mix of both sheets',
// is no sheet's. Each sheet is still whole and its own: the sphere closed
// (Euler characteristic 2), the paraboloid a disc cut by the box (1), the
// crossing one closed loop on each, with nothing left out or open, and
// every vertex, those roots among them, has its own sheet's normal: within
// half a degree, since where a grid line through the circle is tangent to
// the sphere, as at (0, ±1, 0), F has a triple root, the shift spreads it
// a few hundredths of a cell along the edge, and a root left there within
// the shift of the level has ∇F's line a tenth of a degree off.
func TestCrossingSymmetric(t *testing.T) {
	m := levelSet(t, implicitStudy("(x^2 + y^2 + z^2 - 1)*(x^2 + y^2 - 1 - pi*z)", 0, cube(1.5), 30))
	if len(m.Open) != 0 || m.CrossingsUnresolved != 0 || m.CrossingsExhausted || len(m.Components) != 2 || m.Singular != 0 {
		t.Fatalf("%d open edges, %d unresolved, exhausted %v, components %+v, %d singular", len(m.Open)/2, m.CrossingsUnresolved, m.CrossingsExhausted, m.Components, m.Singular)
	}
	for _, c := range m.Components {
		if (c.Closed && c.Euler != 2 || !c.Closed && c.Euler != 1) || !c.Orientable {
			t.Fatalf("components %+v", m.Components)
		}
	}
	manifold(t, m)
	sided(t, m)
	if len(m.Crossings) == 0 || crossingLoops(t, m) != 2 {
		t.Fatalf("%d crossing edges, not one loop on each sheet", len(m.Crossings)/2)
	}
	faces := faceNormals(m)
	near := 0
	for v := int32(0); v < int32(len(m.Positions)/3); v++ {
		p, n := m.vertex(v), m.normal(v)
		if math.Hypot(math.Hypot(p.X, p.Y)-1, p.Z) < 1e-3*3.0/30 {
			near++
		}
		// The sphere's normal is radial, the paraboloid's along
		// (2x, 2y, −π); on the crossing, the one in line with its
		// triangles.
		sphere, bowl := p.mul(1/p.norm()), Vec3{2 * p.X, 2 * p.Y, -math.Pi}
		bowl = bowl.mul(1 / bowl.norm())
		ds, db := math.Abs(p.norm()-1), math.Abs(p.X*p.X+p.Y*p.Y-1-math.Pi*p.Z)/math.Hypot(2*math.Hypot(p.X, p.Y), math.Pi)
		want := sphere
		if ds < 1e-5 && db < 1e-5 && inLine(faces[v], bowl) < inLine(faces[v], sphere) || ds >= 1e-5 && db < ds {
			want = bowl
		}
		if math.Abs(n.norm()-1) > 1e-12 || inLine(n, want) > 0.5 {
			t.Fatalf("vertex %v has normal %v, not along %v", p, n, want)
		}
	}
	// The roots on the crossing, beside the copies.
	if near <= len(m.Twins) {
		t.Fatalf("%d vertices within 10⁻³ of a cell of the circle, %d of them copies", near, len(m.Twins))
	}
}

// The usual immersion of the Klein bottle meets itself along a closed
// curve, which lies in the grid plane z = 0 of the preset's symmetric box
// and touches a sheet tangent to that plane at (0, ±1, 0). Meshed through
// its crossing, each sheet with its own copies of the crossing's vertices,
// it is one closed piece, one-sided, of Euler characteristic 0: a Klein
// bottle. Meshed as the boundary of F ≥ 0 it would be an orientable
// surface of genus 2. Crossing vertices lie within the crossings' shift of
// the double curve, where F and ∇F vanish: there F is of the order of the
// shift squared, and ∇F of the order of the shift, both far below the
// median |∇F| at the mesh's other vertices. Every vertex there, and every
// root within 10⁻³ of a cell of one, has its own sheet's normal, the one
// its triangles lie nearer, within 1°, where a normal of ∇F, mixing both
// sheets', misses it by up to 87°.
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
		if !closed(m) || len(m.Components) != 1 || m.Components[0].Euler != 0 || m.Components[0].Orientable || m.Singular != 0 {
			t.Fatalf("refine %d: components %+v, %d open edges, %d singular", refine, m.Components, len(m.Open)/2, m.Singular)
		}
		manifold(t, m)
		sided(t, m)
		if m.CrossingsUnresolved != 0 || m.CrossingsExhausted || len(m.Crossings) == 0 || crossingLoops(t, m) != 2 {
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
		// The two sheets' normals there, from the test's own differences
		// of F's Hessian.
		sheets := func(p Vec3) (Vec3, Vec3) {
			const h = 1e-4
			var m [3][3]float64
			e := [3]Vec3{{h, 0, 0}, {0, h, 0}, {0, 0, h}}
			for i := range 3 {
				for j := range 3 {
					m[i][j] = (klein(p.add(e[i]).add(e[j])) - klein(p.add(e[i]).sub(e[j])) - klein(p.sub(e[i]).add(e[j])) + klein(p.sub(e[i]).sub(e[j]))) / (4 * h * h)
				}
			}
			values, vectors := eigen3(m)
			a, b := vectors[2].mul(math.Sqrt(values[2])), vectors[0].mul(math.Sqrt(-values[0]))
			return a.add(b), a.sub(b)
		}
		faces := faceNormals(m)
		cell := 7.8 / 48
		for v := int32(0); v < int32(len(m.Positions)/3); v++ {
			p := m.vertex(v)
			near := crossing[v]
			for u := range crossing {
				near = near || m.vertex(u).sub(p).norm() < 1e-3*cell
			}
			if !near {
				continue
			}
			n := m.normal(v)
			if math.Abs(n.norm()-1) > 1e-12 {
				t.Fatalf("refine %d: vertex %v beside the crossing has normal %v", refine, p, n)
			}
			a, b := sheets(p)
			if inLine(faces[v], b) < inLine(faces[v], a) {
				a, b = b, a
			}
			if inLine(n, a) > 1 {
				t.Fatalf("refine %d: vertex %v beside the crossing has normal %v, %.3g° from its sheet's, %.3g° from the other's", refine, p, n, inLine(n, a), inLine(n, b))
			}
		}
	}
}

// Two unit spheres through each other meet along a circle in x = ½. Each
// is meshed whole through it: two closed pieces, each orientable, of genus
// 0, though the mesh is one piece of Euler characteristic 2 + 2 − 0 where
// they share the circle's vertices.
func TestCrossingTwoSpheres(t *testing.T) {
	m := levelSet(t, implicitStudy("(x^2 + y^2 + z^2 - 1)*((x - 1)^2 + y^2 + z^2 - 1)", 0, Box{-1.33, 2.27, -1.31, 1.29, -1.27, 1.32}, 36))
	if !closed(m) || m.CrossingsUnresolved != 0 || m.Singular != 0 || len(m.Components) != 2 {
		t.Fatalf("components %+v, %d unresolved, %d singular", m.Components, m.CrossingsUnresolved, m.Singular)
	}
	manifold(t, m)
	sided(t, m)
	if crossingLoops(t, m) != 2 {
		t.Fatalf("%d crossing edges, not one loop on each sphere", len(m.Crossings)/2)
	}
	for _, c := range m.Components {
		if c.Euler != 2 || !c.Orientable || c.Crossings == 0 {
			t.Fatalf("components %+v", m.Components)
		}
	}
}

// A sphere of radius 1 about a point of a ring's core circle, wider than
// its tube of 0.7, crosses the tube at a shallow angle in two loops, and
// beside them the two run within a cell of each other through tetrahedra
// with no crossing in them, where an edge crosses both and marching would
// join them. Those are meshed as crossings too: two closed orientable
// pieces, of genus 0 and 1. (Where the two come within a cell without
// crossing, nearer the core than either loop, they can still be joined,
// as at one refinement level of these grids.)
func TestCrossingShallow(t *testing.T) {
	f := "((x^2 + y^2 + z^2 + 3.51)^2 - 16*(x^2 + y^2))*((x - 2)^2 + y^2 + z^2 - 1)"
	for _, c := range []struct{ cells, refine int }{{32, 0}, {32, 1}, {48, 0}, {64, 0}, {48, 2}} {
		q := implicitStudy(f, 0, Box{-2.93, 3.27, -2.91, 2.89, -1.23, 1.17}, c.cells)
		q.Refine = c.refine
		m := levelSet(t, q)
		manifold(t, m)
		if len(m.Components) != 2 || m.CrossingsUnresolved != 0 || m.Singular != 0 {
			t.Fatalf("%d cells, refine %d: components %+v, %d unresolved, %d singular", c.cells, c.refine, m.Components, m.CrossingsUnresolved, m.Singular)
		}
		for _, p := range m.Components {
			if !p.Closed || !p.Orientable || p.Euler != 0 && p.Euler != 2 {
				t.Fatalf("%d cells, refine %d: components %+v", c.cells, c.refine, m.Components)
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
// beside what was left out) or two, each sheet its own through a crossing.
// Where a crossing ends at a pinch point, one sheet passes through both of
// a node's copies, which are then one vertex: no triangle has two corners
// at one point.
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
			if n != 1 && n != 2 {
				t.Fatalf("%s: edge %v has %d triangles", c.f, e, n)
			}
		}
		for k := 0; k < len(m.Triangles); k += 3 {
			a, b, c3 := m.vertex(m.Triangles[k]), m.vertex(m.Triangles[k+1]), m.vertex(m.Triangles[k+2])
			if a == b || b == c3 || a == c3 {
				t.Fatalf("%s: triangle %d has two corners at one point: %v %v %v", c.f, k/3, a, b, c3)
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
// is meshed as before: without crossings or cones. Those that cross
// themselves are read whole through their crossings: the Klein bottles as
// one closed, one-sided piece of Euler characteristic 0, and the ring
// through a sphere as two closed orientable pieces, of genus 1 and 0,
// with refinement on and off.
func TestCrossingPresetsUnchanged(t *testing.T) {
	klein := []ImplicitComponent{{Euler: 0, Closed: true, Orientable: false}}
	ring := []ImplicitComponent{{Euler: 0, Closed: true, Orientable: true}, {Euler: 2, Closed: true, Orientable: true}}
	crossing := map[string][]ImplicitComponent{
		"A Klein bottle passing through itself":               klein,
		"A Klein bottle in twenty-four slices":                klein,
		"Where a Klein bottle's neck passes through its wall": klein,
		"A ring through a sphere":                             ring,
	}
	for name, q := range spatialPresets(t) {
		if q.Format != "implicit" {
			continue
		}
		want, crosses := crossing[name]
		for _, refine := range []int{-1, 0, 2} {
			if refine >= 0 && !crosses {
				continue
			}
			if refine >= 0 {
				q.Implicit.Refine = refine
			}
			r, err := Compute(q)
			if err != nil {
				t.Fatal(name, err)
			}
			m := r.Implicit
			if !crosses && (len(m.Crossings) != 0 || m.Cones != 0 || m.CrossingsUnresolved != 0 || m.CrossingsExhausted) {
				t.Fatalf("%s: %d crossing edges, %d cones, %d unresolved", name, len(m.Crossings)/2, m.Cones, m.CrossingsUnresolved)
			}
			if !crosses {
				continue
			}
			var got []ImplicitComponent
			for _, c := range m.Components {
				got = append(got, ImplicitComponent{Euler: c.Euler, Closed: c.Closed, Orientable: c.Orientable})
			}
			sort.Slice(got, func(i, j int) bool { return got[i].Euler < got[j].Euler })
			if len(m.Crossings) == 0 || m.CrossingsUnresolved != 0 || m.Singular != 0 || !reflect.DeepEqual(got, want) {
				t.Fatalf("%s, refine %d: %d crossing edges, %d unresolved, %d singular, pieces %+v", name, refine, len(m.Crossings)/2, m.CrossingsUnresolved, m.Singular, got)
			}
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

// eigen3 finds a symmetric matrix's eigenvalues in increasing order, with
// unit eigenvectors: A v = λ v for each, one of them repeated.
func TestEigen3(t *testing.T) {
	for _, a := range [][3][3]float64{
		{{2, 1, 0}, {1, 2, 0}, {0, 0, -3}},
		{{0, 1, 1}, {1, 0, 1}, {1, 1, 0}},
		{{4, 0, 0}, {0, -1, 0}, {0, 0, 2}},
		{{1e-3, 7, -2}, {7, -5, 0.5}, {-2, 0.5, 9}},
	} {
		values, vectors := eigen3(a)
		if !(values[0] <= values[1] && values[1] <= values[2]) {
			t.Fatalf("%v: eigenvalues %v out of order", a, values)
		}
		trace := a[0][0] + a[1][1] + a[2][2]
		if math.Abs(values[0]+values[1]+values[2]-trace) > 1e-12*math.Abs(trace)+1e-12 {
			t.Fatalf("%v: eigenvalues %v sum to %g, not the trace %g", a, values, values[0]+values[1]+values[2], trace)
		}
		for k, v := range vectors {
			av := Vec3{a[0][0]*v.X + a[0][1]*v.Y + a[0][2]*v.Z, a[1][0]*v.X + a[1][1]*v.Y + a[1][2]*v.Z, a[2][0]*v.X + a[2][1]*v.Y + a[2][2]*v.Z}
			if math.Abs(v.norm()-1) > 1e-12 || av.sub(v.mul(values[k])).norm() > 1e-12*10 {
				t.Fatalf("%v: A v − λ v = %v for λ = %g, v = %v", a, av.sub(v.mul(values[k])), values[k], v)
			}
		}
	}
	values, _ := eigen3([3][3]float64{{0, 1, 1}, {1, 0, 1}, {1, 1, 0}})
	if math.Abs(values[0]+1) > 1e-12 || math.Abs(values[1]+1) > 1e-12 || math.Abs(values[2]-2) > 1e-12 {
		t.Fatalf("eigenvalues %v, not −1, −1, 2", values)
	}
}
