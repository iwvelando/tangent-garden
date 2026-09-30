package engine3

import (
	"math"
	"math/rand"
	"slices"
	"testing"
)

// volume6 is six times the signed volume of a tetrahedron on the lattice.
func (r *refiner) volume6(t int32) int64 {
	v := r.tets[t].v
	var d [3][3]int64
	for k := range 3 {
		for c := range 3 {
			d[k][c] = int64(v[k+1][c] - v[0][c])
		}
	}
	return d[0][0]*(d[1][1]*d[2][2]-d[1][2]*d[2][1]) - d[0][1]*(d[1][0]*d[2][2]-d[1][2]*d[2][0]) + d[0][2]*(d[1][0]*d[2][1]-d[1][1]*d[2][0])
}

// Three generations of bisection split a cube's six Kuhn tetrahedra into
// 48 tetrahedra, six in each of its eight half cubes: each a path from a
// corner of its half cube to the opposite one, a step along each axis in
// turn (the Kuhn split, reflected), bisected next along that diagonal.
func TestBisectionOctree(t *testing.T) {
	r := newRefiner([3]int{1, 1, 1}, 1)
	for k := range 6 {
		r.root(0, k)
	}
	for g := range 3 {
		for _, l := range r.leaves() {
			if int(r.tets[l].gen) == g && r.leaf(l) {
				if err := r.split(l); err != nil {
					t.Fatal(err)
				}
			}
		}
	}
	leaves := r.leaves()
	if len(leaves) != 48 {
		t.Fatalf("%d leaves", len(leaves))
	}
	h := r.scale / 2
	corners := map[point]int{}
	for _, l := range leaves {
		x := r.tets[l]
		if x.gen != 3 || x.tag != 3 {
			t.Fatalf("leaf %d: generation %d, tag %d", l, x.gen, x.tag)
		}
		axes := 0
		for k := range 3 {
			step := point{x.v[k+1][0] - x.v[k][0], x.v[k+1][1] - x.v[k][1], x.v[k+1][2] - x.v[k][2]}
			n := 0
			for c := range 3 {
				switch step[c] {
				case 0:
				case h, -h:
					n++
					axes |= 1 << c
				default:
					n = 2
				}
			}
			if n != 1 {
				t.Fatalf("leaf %d is not a Kuhn path of the half cube: %v", l, x.v)
			}
		}
		if axes != 7 || x.v[0][0]%h != 0 || x.v[0][1]%h != 0 || x.v[0][2]%h != 0 {
			t.Fatalf("leaf %d is not a Kuhn path of the half cube: %v", l, x.v)
		}
		corners[point{min(x.v[0][0], x.v[3][0]), min(x.v[0][1], x.v[3][1]), min(x.v[0][2], x.v[3][2])}]++
	}
	// Six in every half cube.
	if len(corners) != 8 {
		t.Fatalf("half cubes %v", corners)
	}
	for c, n := range corners {
		if n != 6 {
			t.Fatalf("half cube at %v holds %d leaves", c, n)
		}
	}
}

// faces counts the leaves on each triangle, by its sorted corners.
func (r *refiner) faces() map[[3]point]int {
	out := map[[3]point]int{}
	for _, l := range r.leaves() {
		v := r.tets[l].v
		for skip := range 4 {
			var f [3]point
			k := 0
			for c := range 4 {
				if c != skip {
					f[k] = v[c]
					k++
				}
			}
			s := f[:]
			slices.SortFunc(s, func(a, b point) int { return slices.Compare(a[:], b[:]) })
			out[f]++
		}
	}
	return out
}

// Refinement at random leaves, each with its closure, leaves a conforming
// mesh: every triangle inside the box lies on exactly two leaves, so no
// leaf has a corner inside another's face or edge, and the leaves fill the
// box without overlap. No leaf is refined past the deepest generation that
// was asked for.
func TestBisectionConforming(t *testing.T) {
	for _, seed := range []int64{1, 2, 3, 4} {
		random := rand.New(rand.NewSource(seed))
		n := [3]int{3, 2, 2}
		r := newRefiner(n, 2)
		deepest, grown := 0, 0
		for range 400 {
			cube := random.Intn(n[0] * n[1] * n[2])
			l := r.root(cube, random.Intn(6))
			for !r.leaf(l) {
				l = r.tets[l].kids[random.Intn(2)]
			}
			if r.tets[l].gen >= 6 {
				continue
			}
			deepest = max(deepest, int(r.tets[l].gen)+1)
			before := len(r.tets)
			if err := r.split(l); err != nil {
				t.Fatal(err)
			}
			grown = max(grown, len(r.tets)-before)
		}
		// One split and its closure stay well within the reserve the
		// budget keeps for them.
		if grown > refineReserve/4 {
			t.Fatalf("seed %d: a split added %d tetrahedra", seed, grown)
		}
		var volume int64
		for _, l := range r.leaves() {
			if int(r.tets[l].gen) > deepest {
				t.Fatalf("seed %d: leaf of generation %d beyond %d", seed, r.tets[l].gen, deepest)
			}
			v := r.volume6(l)
			if v == 0 {
				t.Fatalf("seed %d: flat leaf %v", seed, r.tets[l].v)
			}
			volume += max(v, -v)
		}
		// Only materialized cubes hold leaves.
		// Six times the volume of a cube in lattice steps, per cube.
		if want := 6 * int64(len(r.roots)) * int64(r.scale*r.scale*r.scale); volume != want {
			t.Fatalf("seed %d: leaves fill %d of %d", seed, volume, want)
		}
		bound := point{int32(n[0]) * r.scale, int32(n[1]) * r.scale, int32(n[2]) * r.scale}
		for f, count := range r.faces() {
			if count == 2 {
				continue
			}
			// A face on one leaf lies on the box, or between a materialized
			// cube and one that is not, where it is a face of a coarse
			// tetrahedron.
			onBox := false
			for c := range 3 {
				for _, side := range []int32{0, bound[c]} {
					onBox = onBox || (f[0][c] == side && f[1][c] == side && f[2][c] == side)
				}
			}
			if count != 1 || (!onBox && !coarseFace(f, r.scale)) {
				t.Fatalf("seed %d: triangle %v lies on %d leaves", seed, f, count)
			}
		}
	}
}

// coarseFace reports whether a triangle's corners are all grid points.
func coarseFace(f [3]point, scale int32) bool {
	for _, p := range f {
		for c := range 3 {
			if p[c]%scale != 0 {
				return false
			}
		}
	}
	return true
}

func cassiniStudy(level float64, cells int, shift float64, refine int) ImplicitRequest {
	q := implicitStudy("((x-a)^2+y^2+z^2)*((x+a)^2+y^2+z^2)", level, Box{-1.8 + shift, 1.8 + shift, -1.2 + shift/2, 1.2 + shift/2, -1.2 + shift/3, 1.2 + shift/3}, cells)
	q.A = 1
	q.Refine = refine
	return q
}

func cassini(p Vec3) float64 {
	return (math.Pow(p.X-1, 2) + p.Y*p.Y + p.Z*p.Z) * (math.Pow(p.X+1, 2) + p.Y*p.Y + p.Z*p.Z)
}

// Where no sample disagrees with the grid's tetrahedra, as for a linear
// field, refinement changes nothing, bit for bit.
func TestAdaptiveIdentity(t *testing.T) {
	for _, f := range []string{"x + 2*y + 3*z", "x^2 + y^2 + z^2", "x + 2*y + 3*z + 0*sqrt(0.5 - x + y + z)"} {
		q := implicitStudy(f, 0.3, Box{-1, 1.1, -0.9, 1, -1.2, 1}, 12)
		plain := levelSet(t, q)
		q.Refine = 2
		refined := levelSet(t, q)
		if f != "x^2 + y^2 + z^2" && refined.Refinement.Bisected != 0 {
			t.Fatalf("%s: %+v", f, refined.Refinement)
		}
		if refined.Refinement.Bisected == 0 && (!slices.Equal(plain.Positions, refined.Positions) || !slices.Equal(plain.Normals, refined.Normals) ||
			!slices.Equal(plain.Triangles, refined.Triangles) || !slices.Equal(plain.Cut, refined.Cut) || !slices.Equal(plain.Open, refined.Open)) {
			t.Fatalf("%s: refinement without a bisection changed the mesh", f)
		}
		if refined.Refinement.Levels != 2 || plain.Refinement.Levels != 0 {
			t.Fatalf("%s: %+v %+v", f, plain.Refinement, refined.Refinement)
		}
	}
}

// Just above c = 1 the Cassini drops join by a waist of radius
// √(√c − 1) ≈ 0.07 here, which no point of a coarse grid meets: the grid
// sees two drops. Refinement finds the waist, and the mesh is one closed
// sphere-like piece, without a crack where cells of different sizes meet.
func TestAdaptiveNeck(t *testing.T) {
	for _, cells := range []int{13, 16, 17, 20} {
		for _, shift := range []float64{0, 0.0371, 0.061} {
			if m := levelSet(t, cassiniStudy(1.01, cells, shift, 0)); len(m.Components) != 2 {
				t.Fatalf("%d cells, shift %v: the grid alone finds %d pieces", cells, shift, len(m.Components))
			}
			m := levelSet(t, cassiniStudy(1.01, cells, shift, 3))
			m.residual(t, cassini, 1.01, 1e-12)
			r := m.Refinement
			if !closed(m) || len(m.Components) != 1 || m.Components[0].Euler != 2 {
				t.Fatalf("%d cells, shift %v: components %+v, %d cut, %d open, %+v", cells, shift, m.Components, len(m.Cut), len(m.Open), r)
			}
			if r.Levels != 3 || r.Bisected == 0 || r.Reached < 1 || r.Reached > 3 || r.Exhausted {
				t.Fatalf("%d cells, shift %v: %+v", cells, shift, r)
			}
		}
	}
}

// Just below c = 1 the drops are 0.1 apart, and a coarse grid's cells
// bridge the gap; refinement separates them.
func TestAdaptiveGap(t *testing.T) {
	for _, shift := range []float64{0, 0.0371, 0.061} {
		if m := levelSet(t, cassiniStudy(0.995, 9, shift, 0)); len(m.Components) != 1 {
			t.Fatalf("shift %v: the grid alone finds %d pieces", shift, len(m.Components))
		}
		m := levelSet(t, cassiniStudy(0.995, 9, shift, 3))
		m.residual(t, cassini, 0.995, 1e-12)
		if !closed(m) || len(m.Components) != 2 || m.Components[0].Euler != 2 || m.Components[1].Euler != 2 {
			t.Fatalf("shift %v: components %+v, %+v", shift, m.Components, m.Refinement)
		}
	}
}

// Across the saddle of xy = 0.001 the grid face's corners alternate, and
// the grid's diagonal joins the positive corners, so the mesh's pieces
// cross from x < 0 to x > 0. The face's centre, the diagonal's midpoint,
// is on the negative side; refinement there separates the hyperbola's two
// branches. The alternating face is still counted.
func TestAdaptiveAmbiguous(t *testing.T) {
	crosses := func(m *ImplicitResult) bool {
		for k := 0; k < len(m.Triangles); k += 3 {
			a, b, c := m.vertex(m.Triangles[k]).X, m.vertex(m.Triangles[k+1]).X, m.vertex(m.Triangles[k+2]).X
			if min(a, b, c) < 0 && max(a, b, c) > 0 {
				return true
			}
		}
		return false
	}
	// The same saddle in each orientation, whose faces are split by
	// diagonals in different tetrahedra of the cube.
	for _, c := range []struct {
		f    string
		box  Box
		flat int
		xy   func(Vec3) (float64, float64)
	}{
		{"x*y", Box{-1, 1, -1, 1, -0.5, 0.5}, 2, func(p Vec3) (float64, float64) { return p.X, p.Y }},
		{"y*z", Box{-0.5, 0.5, -1, 1, -1, 1}, 0, func(p Vec3) (float64, float64) { return p.Y, p.Z }},
		{"z*x", Box{-1, 1, -0.5, 0.5, -1, 1}, 1, func(p Vec3) (float64, float64) { return p.Z, p.X }},
	} {
		// The branches are told apart by the sign of their first coordinate.
		first := func(m *ImplicitResult) *ImplicitResult {
			out := *m
			out.Positions = slices.Clone(m.Positions)
			for k := int32(0); k < int32(len(m.Positions)/3); k++ {
				u, _ := c.xy(m.vertex(k))
				out.Positions[3*k] = u
			}
			return &out
		}
		q := implicitStudy(c.f, 0.001, c.box, 9)
		if !crosses(first(levelSet(t, q))) {
			t.Fatalf("%s: the grid alone separates the branches", c.f)
		}
		q.Refine = 1
		m := levelSet(t, q)
		m.residual(t, func(p Vec3) float64 { u, v := c.xy(p); return u * v }, 0.001, 1e-15)
		if crosses(first(m)) || len(m.Components) != 2 || m.Ambiguous != m.Grid[c.flat]+1 || m.Refinement.Bisected == 0 {
			t.Fatalf("%s: components %+v, %d ambiguous, %+v", c.f, m.Components, m.Ambiguous, m.Refinement)
		}
	}
}

// A tube of radius 0.3 of a cell along the cells' centres joins two
// spheres. No grid point lies in it, and F is the same at every corner of
// the cells it passes through, but the centres of their faces lie on its
// axis; refinement finds it along its whole length.
func TestAdaptiveTube(t *testing.T) {
	// min(u, v) = (u + v − |u − v|)/2.
	spheres := "(((x-1.2)^2+y^2+z^2-0.36) + ((x+1.2)^2+y^2+z^2-0.36) - abs(((x-1.2)^2+y^2+z^2-0.36) - ((x+1.2)^2+y^2+z^2-0.36)))/2"
	f := "((" + spheres + ") + (y^2+z^2-0.075^2) - abs((" + spheres + ") - (y^2+z^2-0.075^2)))/2"
	q := implicitStudy(f, 0, Box{-2, 2, -1.125, 0.875, -1.125, 0.875}, 16)
	if m := levelSet(t, q); len(m.Components) != 2 {
		t.Fatalf("the grid alone finds %d pieces", len(m.Components))
	}
	q.Refine = 1
	m := levelSet(t, q)
	if len(m.Components) != 1 || m.Refinement.Exhausted {
		t.Fatalf("components %+v, %+v", m.Components, m.Refinement)
	}
	// Alone, attached to nothing the grid sees, the thread is still found.
	q.F = "y^2+z^2-0.075^2"
	q.Refine = 0
	if m := levelSet(t, q); len(m.Triangles) != 0 {
		t.Fatalf("the grid alone finds %d triangles", len(m.Triangles)/3)
	}
	q.Refine = 1
	if thread := levelSet(t, q); len(thread.Components) != 1 || thread.Components[0].Closed {
		t.Fatalf("components %+v", thread.Components)
	}
	// The tube reaches both faces of the box it runs to.
	ends := map[bool]bool{}
	for k := int32(0); k < int32(len(m.Positions)/3); k++ {
		if p := m.vertex(k); math.Abs(math.Abs(p.X)-2) < 1e-12 {
			ends[p.X > 0] = true
		}
	}
	if len(ends) != 2 {
		t.Fatalf("the tube reaches %v", ends)
	}
}

// Refinement goes exactly as deep as asked when the surface is finer than
// that, and counts what it could not resolve; a bisection turns one leaf
// into two, whatever closure did.
func TestAdaptiveDepth(t *testing.T) {
	for levels := 1; levels <= 3; levels++ {
		q := cassiniStudy(1.0001, 16, 0.0371, levels)
		m := levelSet(t, q)
		r := m.Refinement
		if r.Reached != levels || r.Unresolved == 0 || r.Exhausted {
			t.Fatalf("%d levels: %+v", levels, r)
		}
		s, err := sample(q)
		if err != nil {
			t.Fatal(err)
		}
		a := newAdaptive(s, levels)
		if _, err := a.refine(); err != nil {
			t.Fatal(err)
		}
		deepest := 0
		for _, x := range a.r.tets {
			deepest = max(deepest, int(x.gen))
		}
		if deepest != 3*levels {
			t.Fatalf("%d levels: deepest generation %d", levels, deepest)
		}
		// Every edge's midpoint is a lattice point.
		for _, x := range a.r.tets {
			for _, e := range tetEdges {
				p, q := x.v[e[0]], x.v[e[1]]
				if (p[0]+q[0])%2 != 0 || (p[1]+q[1])%2 != 0 || (p[2]+q[2])%2 != 0 {
					t.Fatalf("%d levels: the midpoint of %v and %v is off the lattice", levels, p, q)
				}
			}
		}
		if leaves := len(a.r.leaves()); leaves != 6*len(a.r.roots)+r.Bisected {
			t.Fatalf("%d levels: %d leaves in %d cubes after %d bisections", levels, leaves, len(a.r.roots), r.Bisected)
		}
	}
}

// When the budget runs out, refinement stops with a conforming mesh and
// reports it, with the tetrahedra still flagged.
func TestAdaptiveBudget(t *testing.T) {
	defer func(n int) { maxRefinedTetrahedra = n }(maxRefinedTetrahedra)
	maxRefinedTetrahedra = refineReserve + 60
	m := levelSet(t, cassiniStudy(1.01, 16, 0.0371, 3))
	m.residual(t, cassini, 1.01, 1e-12)
	r := m.Refinement
	if !r.Exhausted || r.Unresolved == 0 || !closed(m) {
		t.Fatalf("%+v, components %+v", r, m.Components)
	}
}

// Refinement keeps rejecting poles and jumps, and leaves out tetrahedra
// with a corner where F is not finite; samples there flag nothing.
func TestAdaptiveSingular(t *testing.T) {
	q := implicitStudy("1/(x - 0.0501)", 0, cube(1), 20)
	q.Refine = 2
	m := levelSet(t, q)
	if len(m.Triangles) != 0 || m.Discontinuities == 0 || len(m.Marks) != m.Discontinuities {
		t.Fatalf("%d triangles, %d discontinuities, %d marks", len(m.Triangles)/3, m.Discontinuities, len(m.Marks))
	}
	for _, p := range m.Marks {
		if math.Abs(p.X-0.0501) > 1e-9 {
			t.Fatalf("mark at %v", p)
		}
	}
	// A jump across the plane y = 0.0371, beside a neck of the drops.
	q = cassiniStudy(1.01, 16, 0.0371, 3)
	q.F = "((x-a)^2+y^2+z^2)*((x+a)^2+y^2+z^2) + 3*(y - 0.0371)/abs(y - 0.0371)"
	m = levelSet(t, q)
	if m.Discontinuities == 0 {
		t.Fatal("no discontinuity")
	}
	// Where x < −0.2, F is undefined.
	q = cassiniStudy(1.01, 16, 0.0371, 3)
	q.F = "((x-a)^2+y^2+z^2)*((x+a)^2+y^2+z^2) + 0*sqrt(x + 0.2)"
	plain := q
	plain.Refine = 0
	m, p := levelSet(t, q), levelSet(t, plain)
	m.residual(t, cassini, 1.01, 1e-12)
	if m.Nonfinite < p.Nonfinite || len(m.Open) == 0 || len(m.Components) != 1 {
		t.Fatalf("%d nonfinite of %d, %d open edges, %+v", m.Nonfinite, p.Nonfinite, len(m.Open), m.Components)
	}
	// An undefined slab between grid points hides a midpoint; it flags
	// nothing, and is counted.
	q = implicitStudy("x + 2*y + 3*z + 0*sqrt((y + 1/12)^2 - 0.0001)", 0.1, cube(1), 12)
	plain = q
	q.Refine = 2
	m, p = levelSet(t, q), levelSet(t, plain)
	if m.Refinement.Bisected != 0 || m.Nonfinite <= p.Nonfinite || p.Nonfinite != 0 {
		t.Fatalf("%+v, %d nonfinite of %d", m.Refinement, m.Nonfinite, p.Nonfinite)
	}
	// With the drops' saddle on a grid point, they touch there at c = 1,
	// at a vertex without a normal, however far refined.
	q = implicitStudy("((x-a)^2+y^2+z^2)*((x+a)^2+y^2+z^2)", 1, Box{-1.8, 1.8, -1.2, 1.2, -1.2, 1.2}, 24)
	q.A, q.Refine = 1, 3
	m = levelSet(t, q)
	if len(m.Components) != 1 || m.Singular != 1 {
		t.Fatalf("components %+v, %d singular", m.Components, m.Singular)
	}
}
