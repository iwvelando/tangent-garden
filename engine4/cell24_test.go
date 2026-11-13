package engine4

import (
	"encoding/json"
	"errors"
	"math"
	"math/big"
	"slices"
	"sort"
	"testing"
)

func cell24Request(selected int, view string, angles [6]float64) Request {
	return Request{Object: "cell24", Mode: "orthographic", Angles: angles, Cell24: &Cell24Parameters{Selected: selected, View: view}}
}

func cell24Result(t *testing.T, q Request) (Result, *Cell24Diagnostics) {
	t.Helper()
	r := compute(t, q)
	if r.Polytope == nil {
		t.Fatal("no polytope diagnostics")
	}
	return r, r.Polytope
}

// The declared coordinates, written out independently of the engine: the
// primal's are the permutations of (±1, ±1, 0, 0), the polar's ±eᵢ and
// (±½, ±½, ±½, ±½).
func declaredPrimal() map[[4]float64]bool {
	set := map[[4]float64]bool{}
	for i := 0; i < 4; i++ {
		for j := i + 1; j < 4; j++ {
			for _, a := range []float64{-1, 1} {
				for _, b := range []float64{-1, 1} {
					var v [4]float64
					v[i], v[j] = a, b
					set[v] = true
				}
			}
		}
	}
	return set
}
func declaredDual() map[[4]float64]bool {
	set := map[[4]float64]bool{}
	for i := 0; i < 4; i++ {
		for _, s := range []float64{-1, 1} {
			var v [4]float64
			v[i] = s
			set[v] = true
		}
	}
	for m := 0; m < 16; m++ {
		var v [4]float64
		for i := range v {
			v[i] = .5
			if m&(1<<i) != 0 {
				v[i] = -.5
			}
		}
		set[v] = true
	}
	return set
}
func dot4(a, b Vec4) float64 { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3] }
func sub4(a, b Vec4) Vec4    { return Vec4{a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]} }

// The vertices of the polar {y : y·x ≤ 1 for every x in X}, found
// independently of the engine's incidence: every hyperplane y·x = 1
// through four affinely independent points of X that keeps all of X on
// its side is a facet, and the polar's vertices are those facet normals.
// Exact rational arithmetic, so equality is equality.
func polarVertices(t *testing.T, xs []Vec4) map[[4]float64]bool {
	t.Helper()
	rat := func(x float64) *big.Rat { r := new(big.Rat); r.SetFloat64(x); return r }
	found := map[string][4]*big.Rat{}
	n := len(xs)
	for a := 0; a < n; a++ {
		for b := a + 1; b < n; b++ {
			for c := b + 1; c < n; c++ {
				for d := c + 1; d < n; d++ {
					// Solve [x_a; x_b; x_c; x_d] y = 1 by Gauss-Jordan elimination.
					var m [4][5]*big.Rat
					for r, k := range []int{a, b, c, d} {
						for i := 0; i < 4; i++ {
							m[r][i] = rat(xs[k][i])
						}
						m[r][4] = big.NewRat(1, 1)
					}
					singular := false
					for col := 0; col < 4 && !singular; col++ {
						p := -1
						for r := col; r < 4; r++ {
							if m[r][col].Sign() != 0 {
								p = r
								break
							}
						}
						if p < 0 {
							singular = true
							break
						}
						m[col], m[p] = m[p], m[col]
						for r := 0; r < 4; r++ {
							if r == col || m[r][col].Sign() == 0 {
								continue
							}
							f := new(big.Rat).Quo(m[r][col], m[col][col])
							for i := col; i < 5; i++ {
								m[r][i] = new(big.Rat).Sub(m[r][i], new(big.Rat).Mul(f, m[col][i]))
							}
						}
					}
					if singular {
						continue
					}
					var y [4]*big.Rat
					for i := range y {
						y[i] = new(big.Rat).Quo(m[i][4], m[i][i])
					}
					valid := true
					for _, x := range xs {
						s := new(big.Rat)
						for i := range y {
							s.Add(s, new(big.Rat).Mul(y[i], rat(x[i])))
						}
						if s.Cmp(big.NewRat(1, 1)) > 0 {
							valid = false
							break
						}
					}
					if valid {
						key := y[0].RatString() + "," + y[1].RatString() + "," + y[2].RatString() + "," + y[3].RatString()
						found[key] = y
					}
				}
			}
		}
	}
	out := map[[4]float64]bool{}
	for _, y := range found {
		var v [4]float64
		for i := range v {
			v[i], _ = y[i].Float64()
		}
		out[v] = true
	}
	return out
}
func sameSet(t *testing.T, name string, got []Vec4, want map[[4]float64]bool) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("%s: %d vertices, want %d", name, len(got), len(want))
	}
	seen := map[[4]float64]bool{}
	for _, v := range got {
		if !want[v] || seen[v] {
			t.Fatalf("%s: unexpected or repeated vertex %v", name, v)
		}
		seen[v] = true
	}
}

// Both configurations have the declared coordinates and scales.
func TestCell24DeclaredCoordinates(t *testing.T) {
	_, p := cell24Result(t, cell24Request(0, "cell", [6]float64{}))
	sameSet(t, "primal", p.Primal.Source, declaredPrimal())
	sameSet(t, "dual", p.Dual.Source, declaredDual())
	near(t, p.Primal.Circumradius, math.Sqrt2)
	near(t, p.Dual.Circumradius, 1)
	near(t, p.Primal.EdgeLength, math.Sqrt2)
	near(t, p.Dual.EdgeLength, 1)
	for _, v := range p.Primal.Source {
		near(t, math.Sqrt(dot4(v, v)), math.Sqrt2)
	}
	for _, v := range p.Dual.Source {
		near(t, math.Sqrt(dot4(v, v)), 1)
	}
	// IDs follow descending lexicographic order of the coordinates.
	for _, c := range [][]Vec4{p.Primal.Source, p.Dual.Source} {
		for i := 1; i < len(c); i++ {
			a, b := c[i-1], c[i]
			k := 0
			for k < 3 && a[k] == b[k] {
				k++
			}
			if a[k] <= b[k] {
				t.Fatalf("vertex %d %v does not precede %v", i-1, a, b)
			}
		}
	}
	if p.Primal.Source[0] != (Vec4{1, 1, 0, 0}) || p.Dual.Source[0] != (Vec4{1, 0, 0, 0}) {
		t.Fatal(p.Primal.Source[0], p.Dual.Source[0])
	}
}

// The incidence the engine returns has the 24-cell's counts, degrees and
// cell structure, in both configurations, and its edges are exactly the
// pairs at the declared edge length.
func TestCell24Incidence(t *testing.T) {
	for _, c := range []struct {
		name   string
		cx     *complex24
		length float64
	}{{"primal", primal24(), 2}, {"dual", dual24(), 1}} {
		t.Run(c.name, func(t *testing.T) {
			x := c.cx
			if len(x.edges) != 96 || len(x.faces) != 96 || len(x.cells) != 24 {
				t.Fatalf("counts %d %d %d", len(x.edges), len(x.faces), len(x.cells))
			}
			// Edges are exactly the pairs at squared length 2 (primal) or 1 (dual).
			edge := map[[2]int]bool{}
			degree := [24]int{}
			for _, e := range x.edges {
				if e[0] >= e[1] || edge[e] {
					t.Fatalf("edge %v not ordered or repeated", e)
				}
				edge[e] = true
				degree[e[0]]++
				degree[e[1]]++
			}
			for i := 0; i < 24; i++ {
				for j := i + 1; j < 24; j++ {
					d := sub4(x.source(i), x.source(j))
					if (dot4(d, d) == c.length) != edge[[2]int{i, j}] {
						t.Fatalf("pair %d %d at squared length %g", i, j, dot4(d, d))
					}
				}
				if degree[i] != 8 {
					t.Fatalf("vertex %d degree %d", i, degree[i])
				}
			}
			// Every face is a triangle of edges in exactly two cells.
			faceCells := make([]int, len(x.faces))
			edgeCells := make([]int, len(x.edges))
			for _, f := range x.faces {
				if !(f[0] < f[1] && f[1] < f[2]) {
					t.Fatalf("face %v not ordered", f)
				}
				for _, e := range [][2]int{{f[0], f[1]}, {f[0], f[2]}, {f[1], f[2]}} {
					if !edge[e] {
						t.Fatalf("face %v side %v is not an edge", f, e)
					}
				}
			}
			normal := c.cx.other
			for k, cell := range x.cells {
				members := map[int]bool{}
				for _, v := range cell {
					members[v] = true
				}
				if len(members) != 6 {
					t.Fatalf("cell %d %v", k, cell)
				}
				// The cell is the equality set of its inequality n·x ≤ 1, and
				// every vertex satisfies every inequality.
				n := normal(k)
				for i := 0; i < 24; i++ {
					s := dot4(n, x.source(i))
					if s > 1 || (s == 1) != members[i] {
						t.Fatalf("cell %d vertex %d: n·x = %g", k, i, s)
					}
				}
				// Three opposite pairs, each pair's midpoint the cell's center
				// n/|n|², joined by no edge.
				center := n
				for i := range center {
					center[i] /= dot4(n, n)
				}
				for p := 0; p < 6; p += 2 {
					a, b := cell[p], cell[p+1]
					if edge[[2]int{min(a, b), max(a, b)}] {
						t.Fatalf("cell %d diagonal %d %d is an edge", k, a, b)
					}
					mid := sub4(x.source(a), sub4(Vec4{}, x.source(b)))
					for i := range mid {
						mid[i] /= 2
					}
					if mid != center {
						t.Fatalf("cell %d diagonal midpoint %v, center %v", k, mid, center)
					}
				}
				for _, e := range x.cellEdges[k] {
					ends := x.edges[e]
					if !members[ends[0]] || !members[ends[1]] {
						t.Fatalf("cell %d edge %v", k, ends)
					}
					edgeCells[e]++
				}
				for _, f := range x.cellFaces[k] {
					for _, v := range x.faces[f] {
						if !members[v] {
							t.Fatalf("cell %d face %v", k, x.faces[f])
						}
					}
					faceCells[f]++
				}
				if len(x.cellEdges[k]) != 12 || len(x.cellFaces[k]) != 8 {
					t.Fatalf("cell %d has %d edges and %d faces", k, len(x.cellEdges[k]), len(x.cellFaces[k]))
				}
			}
			for f, n := range faceCells {
				if n != 2 {
					t.Fatalf("face %v in %d cells", x.faces[f], n)
				}
			}
			for e, n := range edgeCells {
				if n != 3 {
					t.Fatalf("edge %v in %d cells", x.edges[e], n)
				}
			}
		})
	}
}

// Polarity, derived independently by exact facet enumeration: the polar of
// the primal is the dual configuration, and the polar of that is the
// primal again, with no rescaling.
func TestCell24DoublePolar(t *testing.T) {
	_, p := cell24Result(t, cell24Request(0, "cell", [6]float64{}))
	sameSet(t, "polar of primal", p.Dual.Source, polarVertices(t, p.Primal.Source))
	sameSet(t, "polar of polar", p.Primal.Source, polarVertices(t, p.Dual.Source))
}

// Self-duality is a congruence up to scale, not only matching counts:
// M = Q/√2 with Q orthogonal carries every primal vertex to a dual vertex,
// and edges, triangles and cells to edges, triangles and cells.
func TestCell24SelfDualCongruence(t *testing.T) {
	m := [4][4]float64{{.5, .5, 0, 0}, {.5, -.5, 0, 0}, {0, 0, .5, .5}, {0, 0, .5, -.5}}
	// M Mᵀ = I/2, exactly in binary arithmetic.
	for i := 0; i < 4; i++ {
		for j := 0; j < 4; j++ {
			s := 0.
			for k := 0; k < 4; k++ {
				s += m[i][k] * m[j][k]
			}
			want := 0.
			if i == j {
				want = .5
			}
			if s != want {
				t.Fatalf("M Mᵀ[%d][%d] = %g", i, j, s)
			}
		}
	}
	p, d := primal24(), dual24()
	index := map[Vec4]int{}
	for i := 0; i < 24; i++ {
		index[d.source(i)] = i
	}
	image := [24]int{}
	used := map[int]bool{}
	for i := 0; i < 24; i++ {
		v, w := p.source(i), Vec4{}
		for r := 0; r < 4; r++ {
			for k := 0; k < 4; k++ {
				w[r] += m[r][k] * v[k]
			}
		}
		j, ok := index[w]
		if !ok || used[j] {
			t.Fatalf("M v%d = %v is not a new dual vertex", i, w)
		}
		image[i], used[j] = j, true
	}
	edges := map[[2]int]bool{}
	for _, e := range d.edges {
		edges[e] = true
	}
	for _, e := range p.edges {
		a, b := image[e[0]], image[e[1]]
		if !edges[[2]int{min(a, b), max(a, b)}] {
			t.Fatalf("edge %v maps to %d %d", e, a, b)
		}
	}
	faces := map[[3]int]bool{}
	for _, f := range d.faces {
		faces[f] = true
	}
	for _, f := range p.faces {
		g := []int{image[f[0]], image[f[1]], image[f[2]]}
		sort.Ints(g)
		if !faces[[3]int{g[0], g[1], g[2]}] {
			t.Fatalf("face %v maps to %v", f, g)
		}
	}
	cells := map[[6]int]bool{}
	for _, c := range d.cells {
		s := c
		sort.Ints(s[:])
		cells[s] = true
	}
	for _, c := range p.cells {
		var g [6]int
		for i, v := range c {
			g[i] = image[v]
		}
		sort.Ints(g[:])
		if !cells[g] {
			t.Fatalf("cell %v maps to %v", c, g)
		}
	}
}

// Dual edges correspond to primal triangles: the cells centered on the two
// ends of a dual edge share exactly one triangle, and each triangle is
// shared once. Likewise primal edges and dual triangles.
func TestCell24EdgesAndTrianglesCorrespond(t *testing.T) {
	for _, c := range []struct {
		name        string
		edges, of   *complex24
		triangleSet *complex24
	}{{"dual edge to primal face", dual24(), primal24(), primal24()}, {"primal edge to dual face", primal24(), dual24(), dual24()}} {
		faces := map[[3]int]int{}
		for _, f := range c.of.faces {
			faces[f] = 0
		}
		for _, e := range c.edges.edges {
			shared := []int{}
			for _, a := range c.of.cells[e[0]] {
				for _, b := range c.of.cells[e[1]] {
					if a == b {
						shared = append(shared, a)
					}
				}
			}
			sort.Ints(shared)
			if len(shared) != 3 {
				t.Fatalf("%s: edge %v cells share %v", c.name, e, shared)
			}
			f := [3]int{shared[0], shared[1], shared[2]}
			n, ok := faces[f]
			if !ok || n != 0 {
				t.Fatalf("%s: %v is not a new face", c.name, f)
			}
			faces[f] = 1
		}
	}
}

// Rotation is rigid on both configurations, the shadow drops w, and each
// cell's center remains the midpoint of its three projected diagonals.
func TestCell24RotatedShadow(t *testing.T) {
	angles := [6]float64{.31, .54, -.13, .81, .75, -.23}
	r, p := cell24Result(t, cell24Request(5, "crystal", angles))
	near(t, r.Radius, math.Sqrt2)
	if r.Object != "cell24" || r.Operation != "orthographic" {
		t.Fatal(r.Object, r.Operation)
	}
	for _, c := range []struct {
		name string
		p    Polytope24
	}{{"primal", p.Primal}, {"dual", p.Dual}} {
		// The Gram matrix is preserved: every distance and angle, so edges
		// keep their length however the shadow foreshortens them.
		for i := range c.p.Source {
			for j := range c.p.Source {
				if math.Abs(dot4(c.p.Rotated[i], c.p.Rotated[j])-dot4(c.p.Source[i], c.p.Source[j])) > 1e-12 {
					t.Fatalf("%s: rotated Gram entry %d %d", c.name, i, j)
				}
			}
			v := c.p.Rotated[i]
			if c.p.Points[i] != (Vec3{v[0], v[1], v[2]}) {
				t.Fatalf("%s: shadow of %d", c.name, i)
			}
		}
		for _, e := range c.p.Edges {
			d := sub4(c.p.Rotated[e[0]], c.p.Rotated[e[1]])
			near(t, math.Sqrt(dot4(d, d)), c.p.EdgeLength)
		}
	}
	for k := 0; k < 24; k++ {
		cell := primal24().cells[k]
		center := p.Dual.Points[k]
		for i := 0; i < 6; i += 2 {
			a, b := p.Primal.Points[cell[i]], p.Primal.Points[cell[i+1]]
			for j := range center {
				near(t, (a[j]+b[j])/2, center[j])
			}
		}
	}
	if r.EmittedPoints != 48 || r.Evaluations != 48 {
		t.Fatal(r.EmittedPoints, r.Evaluations)
	}
}

// Distinct vertices whose shadows coincide keep their own IDs, and an edge
// whose shadow collapses keeps its 4D length.
func TestCell24CoincidentShadows(t *testing.T) {
	_, p := cell24Result(t, cell24Request(0, "crystal", [6]float64{}))
	// Unrotated, ±e_w and the dual's (x, y, z, ±½) share their shadows.
	shadows := map[Vec3][]int{}
	for i, q := range p.Dual.Points {
		shadows[q] = append(shadows[q], i)
	}
	// ±e_x, ±e_y and ±e_z have six shadows of their own; ±e_w share the
	// origin, and the sixteen halves pair up in eight.
	pairs := 0
	for q, ids := range shadows {
		if len(ids) == 2 {
			pairs++
			if ids[0] == ids[1] || p.Dual.Source[ids[0]] == p.Dual.Source[ids[1]] {
				t.Fatalf("shadow %v: %v", q, ids)
			}
		} else if len(ids) != 1 {
			t.Fatalf("shadow %v: %v", q, ids)
		}
	}
	if len(p.Dual.Points) != 24 || len(shadows) != 15 || pairs != 9 {
		t.Fatalf("%d dual shadows, %d shared, from %d vertices", len(shadows), pairs, len(p.Dual.Points))
	}
	// A quarter turn of −π/4 in xw sends the edge direction (1, 0, 0, −1)
	// onto the w axis.
	_, p = cell24Result(t, cell24Request(0, "crystal", [6]float64{0, 0, 0, -math.Pi / 4, 0, 0}))
	collapsed := 0
	for _, e := range p.Primal.Edges {
		a, b := p.Primal.Points[e[0]], p.Primal.Points[e[1]]
		d := sub(a, b)
		if math.Sqrt(dot(d, d)) < 1e-12 {
			collapsed++
			d4 := sub4(p.Primal.Rotated[e[0]], p.Primal.Rotated[e[1]])
			near(t, math.Sqrt(dot4(d4, d4)), math.Sqrt2)
		}
	}
	if collapsed == 0 {
		t.Fatal("no edge collapsed in the shadow")
	}
	if len(p.Primal.Edges) != 96 {
		t.Fatal(len(p.Primal.Edges))
	}
}

// The selected cell, its center and its neighbors, for every selection.
func TestCell24Selection(t *testing.T) {
	angles := [6]float64{.3, .2, .1, .7, .5, .3}
	for k := 0; k < 24; k++ {
		_, p := cell24Result(t, cell24Request(k, "cell", angles))
		if p.Selected != k || p.View != "cell" {
			t.Fatal(p.Selected, p.View)
		}
		d := p.Dual.Source[k]
		members := map[int]bool{}
		for _, v := range p.CellVertices {
			members[v] = true
			near(t, dot4(d, p.Primal.Source[v]), 1)
		}
		if len(members) != 6 || len(p.CellEdges) != 12 {
			t.Fatal(p.CellVertices, p.CellEdges)
		}
		short, long := math.Inf(1), 0.
		for _, e := range p.CellEdges {
			ends := p.Primal.Edges[e]
			if !members[ends[0]] || !members[ends[1]] {
				t.Fatal("cell edge", ends)
			}
			l := sub(p.Primal.Points[ends[0]], p.Primal.Points[ends[1]])
			short, long = math.Min(short, math.Sqrt(dot(l, l))), math.Max(long, math.Sqrt(dot(l, l)))
		}
		near(t, p.ShadowEdges[0], short)
		near(t, p.ShadowEdges[1], long)
		if len(p.Neighbors) != 8 || len(p.NeighborEdges) != 8 || len(p.SharedFaces) != 8 {
			t.Fatal(p.Neighbors, p.NeighborEdges, p.SharedFaces)
		}
		for i, n := range p.Neighbors {
			e := p.Dual.Edges[p.NeighborEdges[i]]
			if !(e == [2]int{min(k, n), max(k, n)}) {
				t.Fatalf("neighbor %d edge %v", n, e)
			}
			// The triangle the two cells share lies on both cells' hyperplanes.
			for _, v := range p.SharedFaces[i] {
				near(t, dot4(p.Dual.Source[n], p.Primal.Source[v]), 1)
				if !members[v] {
					t.Fatalf("shared face %v outside the cell", p.SharedFaces[i])
				}
			}
		}
	}
}

// Incidence and IDs do not depend on the rotation, and the result is
// deterministic.
func TestCell24StableIdentities(t *testing.T) {
	a, pa := cell24Result(t, cell24Request(7, "crystal", [6]float64{}))
	b, pb := cell24Result(t, cell24Request(7, "crystal", [6]float64{1, 2, 3, 4, 5, 6}))
	if len(pa.Primal.Edges) != len(pb.Primal.Edges) {
		t.Fatal("edge counts")
	}
	for i := range pa.Primal.Edges {
		if pa.Primal.Edges[i] != pb.Primal.Edges[i] {
			t.Fatal("primal edge order changed with rotation")
		}
	}
	for i := range pa.Dual.Edges {
		if pa.Dual.Edges[i] != pb.Dual.Edges[i] {
			t.Fatal("dual edge order changed with rotation")
		}
	}
	if pa.CellVertices[0] != pb.CellVertices[0] || pa.Neighbors[3] != pb.Neighbors[3] {
		t.Fatal("selection changed with rotation")
	}
	again, _ := cell24Result(t, cell24Request(7, "crystal", [6]float64{1, 2, 3, 4, 5, 6}))
	_ = a
	x, _ := json.Marshal(b)
	y, _ := json.Marshal(again)
	if string(x) != string(y) {
		t.Fatal("not deterministic")
	}
}

// The result is bounded by the fixed finite data: 48 vertex shadows, 192
// edges, and a selection of 6 vertices, 12 edges and 8 neighbors.
func TestCell24ResultBound(t *testing.T) {
	r, p := cell24Result(t, cell24Request(23, "crystal", [6]float64{.1, .2, .3, .4, .5, .6}))
	if len(r.Paths) != 0 || len(r.Faces) != 0 || len(r.Points) != 0 || len(r.Markers) != 0 {
		t.Fatal("4D geometry travels in the polytope arrays only")
	}
	if len(p.Primal.Points)+len(p.Dual.Points) != cell24Vertices ||
		len(p.Primal.Edges)+len(p.Dual.Edges) != cell24Edges ||
		cell24DrawnPaths != 96+96+12+3+8 {
		t.Fatal("bound")
	}
	b, _ := json.Marshal(r)
	if len(b) > 40000 {
		t.Fatalf("%d JSON bytes before lifting", len(b))
	}
}

func TestCell24Validation(t *testing.T) {
	for _, c := range []struct {
		name  string
		field string
		q     func() Request
	}{
		{"below", "cell24.selected", func() Request { return cell24Request(-1, "cell", [6]float64{}) }},
		{"above", "cell24.selected", func() Request { return cell24Request(24, "cell", [6]float64{}) }},
		{"view", "cell24.view", func() Request { return cell24Request(0, "wireframe", [6]float64{}) }},
		{"stereo", "mode", func() Request { q := cell24Request(0, "cell", [6]float64{}); q.Mode = "stereo"; return q }},
		// Perspective is admitted; its eye distance is then validated.
		{"perspective", "distance", func() Request { q := cell24Request(0, "cell", [6]float64{}); q.Mode = "perspective"; return q }},
		{"reference", "mode", func() Request { q := cell24Request(0, "cell", [6]float64{}); q.Mode = "reference"; return q }},
		{"angle", "angles.2", func() Request { q := cell24Request(0, "cell", [6]float64{}); q.Angles[2] = math.NaN(); return q }},
		{"large angle", "angles.5", func() Request { q := cell24Request(0, "cell", [6]float64{}); q.Angles[5] = 2e6; return q }},
	} {
		_, err := Compute(c.q())
		var f *FieldError
		if !errors.As(err, &f) || f.Field != c.field {
			t.Fatalf("%s: %v", c.name, err)
		}
	}
	q := cell24Request(0, "cell", [6]float64{})
	q.Cell24 = nil
	if _, err := Compute(q); err == nil {
		t.Fatal("missing parameters accepted")
	}
}

// The 24-cell leaves every other object's result unchanged: the tesseract
// shadow still draws its 32 edges with no polytope diagnostics.
func TestCell24LeavesTesseractUnchanged(t *testing.T) {
	r := compute(t, request())
	if r.Polytope != nil || len(r.Paths) != 32 || r.Radius != 2 {
		t.Fatal(r.Polytope, len(r.Paths), r.Radius)
	}
}

func BenchmarkCell24(b *testing.B) {
	q := cell24Request(3, "crystal", [6]float64{.3, .2, .1, .7, .5, .3})
	for i := 0; i < b.N; i++ {
		if _, err := Compute(q); err != nil {
			b.Fatal(err)
		}
	}
}

// This independent view of the wire contract lets the first red test run
// against the pre-section engine rather than fail to compile.
type section24Wire struct {
	ID          string   `json:"id"`
	Object      string   `json:"object"`
	Level       float64  `json:"level"`
	Dimension   int      `json:"dimension"`
	Points      []Vec3   `json:"points"`
	FourPoints  []Vec4   `json:"fourPoints"`
	Origins     [][2]int `json:"origins"`
	VertexCells [][]int  `json:"vertexCells"`
	Edges       [][2]int `json:"edges"`
	Facets      []struct {
		Vertices []int `json:"vertices"`
		Cells    []int `json:"cells"`
	} `json:"facets"`
}

func section24Result(t *testing.T, angles [6]float64, h float64, count int, spread float64) (Result, []section24Wire) {
	t.Helper()
	q := cell24Request(0, "crystal", angles)
	q.Mode, q.Slice, q.Count, q.Spread = "section", h, count, spread
	r := compute(t, q)
	b, err := json.Marshal(r)
	if err != nil {
		t.Fatal(err)
	}
	var wire struct {
		Polytope struct {
			Sections []section24Wire `json:"sections"`
		} `json:"polytope"`
	}
	if err := json.Unmarshal(b, &wire); err != nil {
		t.Fatal(err)
	}
	if len(wire.Polytope.Sections) != 2*count {
		t.Fatalf("%d sections for %d planes", len(wire.Polytope.Sections), count)
	}
	return r, wire.Polytope.Sections
}
func checkSection24(t *testing.T, s section24Wire, angles [6]float64) {
	t.Helper()
	if len(s.Points) != len(s.FourPoints) || len(s.Points) != len(s.Origins) || len(s.Points) != len(s.VertexCells) {
		t.Fatal("vertex provenance lengths")
	}
	normals := declaredDual()
	if s.Object == "dual" {
		normals = declaredPrimal()
	}
	// Inverse the declared ordered rotations, independently of rotate().
	inverse := func(v Vec4) Vec4 {
		pairs := [6][2]int{{0, 1}, {0, 2}, {1, 2}, {0, 3}, {1, 3}, {2, 3}}
		for i := 5; i >= 0; i-- {
			a, b := pairs[i][0], pairs[i][1]
			c, sn := math.Cos(angles[i]), math.Sin(angles[i])
			v[a], v[b] = c*v[a]+sn*v[b], -sn*v[a]+c*v[b]
		}
		return v
	}

	sourceSet := declaredPrimal()
	if s.Object == "dual" {
		sourceSet = declaredDual()
	}
	source := make([]Vec4, 0, 24)
	for v := range sourceSet {
		source = append(source, v)
	}
	normalIDs := make([]Vec4, 0, 24)
	for v := range normals {
		normalIDs = append(normalIDs, v)
	}
	order := func(v []Vec4) {
		sort.Slice(v, func(i, j int) bool {
			for k := 0; k < 4; k++ {
				if v[i][k] != v[j][k] {
					return v[i][k] > v[j][k]
				}
			}
			return false
		})
	}
	order(source)
	order(normalIDs)
	seenOrigins := map[[2]int]bool{}
	for i, v := range s.FourPoints {
		if v[3] != s.Level || s.Points[i] != (Vec3{v[0], v[1], v[2]}) {
			t.Fatalf("not on source plane: %v at %g", v, s.Level)
		}
		u := inverse(v)

		origin := s.Origins[i]
		if origin[0] < 0 || origin[0] > origin[1] || origin[1] >= 24 || seenOrigins[origin] {
			t.Fatal("invalid or duplicate source origin", origin)
		}
		seenOrigins[origin] = true
		a, b := source[origin[0]], source[origin[1]]
		direction := sub4(b, a)
		den := dot4(direction, direction)
		parameter := 0.
		if den > 0 {
			parameter = dot4(sub4(u, a), direction) / den
		}
		if parameter < -2e-12 || parameter > 1+2e-12 {
			t.Fatal("intersection outside source edge")
		}
		for axis := range a {
			if math.Abs(u[axis]-(a[axis]+parameter*direction[axis])) > 2e-12 {
				t.Fatal("not on declared source edge")
			}
		}
		expectedCells := []int{}
		for k, n := range normalIDs {
			if dot4(n, a) == 1 && dot4(n, b) == 1 {
				expectedCells = append(expectedCells, k)
			}
		}
		if !slices.Equal(expectedCells, s.VertexCells[i]) {
			t.Fatalf("lost distinct containing cells: %v want %v", s.VertexCells[i], expectedCells)
		}
		for n := range normals {
			if dot4(n, u) > 1+2e-12 {
				t.Fatalf("%s outside inequality %v: %v", s.Object, n, u)
			}
		}
		if len(s.VertexCells[i]) < 1 {
			t.Fatal("lost cell provenance")
		}
	}
	if s.Dimension < 0 {
		if len(s.Points)+len(s.Edges)+len(s.Facets) != 0 {
			t.Fatal("empty retains geometry")
		}
		return
	}
	if s.Dimension == 0 {
		if len(s.Points) != 1 || len(s.Edges)+len(s.Facets) != 0 {
			t.Fatal("point contact")
		}
		return
	}
	if s.Dimension == 1 {
		if len(s.Points) != 2 || len(s.Edges) != 1 || len(s.Facets) != 0 {
			t.Fatal("segment contact")
		}
		return
	}
	edgeFaces := map[[2]int]int{}
	directed := map[[2]int]int{}
	center := Vec3{}
	for _, p := range s.Points {
		for j := range center {
			center[j] += p[j] / float64(len(s.Points))
		}
	}
	for _, f := range s.Facets {
		if len(f.Vertices) < 3 || len(f.Cells) == 0 {
			t.Fatal("degenerate face or erased provenance")
		}
		a := s.Points[f.Vertices[0]]
		// A contact can truncate a corner by 1e-10, making the first three
		// vertices ill-conditioned. The whole polygon area is resolved.
		n := Vec3{}
		for i, b := range f.Vertices {
			c := f.Vertices[(i+1)%len(f.Vertices)]
			v := cross(sub(s.Points[b], a), sub(s.Points[c], a))
			for j := range n {
				n[j] += v[j]
			}
		}
		if dot(n, n) == 0 {
			t.Fatal("zero-area face")
		}
		if s.Dimension == 3 {
			// Thin facets require the well-conditioned declared inequality
			// rather than a normal estimated from nearly collinear points.
			ns := make([]Vec4, 0, len(normals))
			for v := range normals {
				ns = append(ns, v)
			}
			sort.Slice(ns, func(i, j int) bool {
				for k := 0; k < 4; k++ {
					if ns[i][k] != ns[j][k] {
						return ns[i][k] > ns[j][k]
					}
				}
				return false
			})
			v := ns[f.Cells[0]]
			pairs := [6][2]int{{0, 1}, {0, 2}, {1, 2}, {0, 3}, {1, 3}, {2, 3}}
			for i, ab := range pairs {
				c, sn := math.Cos(angles[i]), math.Sin(angles[i])
				x, y := ab[0], ab[1]
				v[x], v[y] = c*v[x]-sn*v[y], sn*v[x]+c*v[y]
			}
			outward := Vec3{v[0], v[1], v[2]}
			for _, p := range s.Points {
				if dot(outward, sub(p, a)) > 2e-12 {
					t.Fatal("nonconvex boundary")
				}
			}
			if dot(n, outward) <= 0 || dot(n, sub(a, center)) <= 0 {
				t.Fatal("inward face")
			}
		}
		for i, v := range f.Vertices {
			w := f.Vertices[(i+1)%len(f.Vertices)]
			edgeFaces[[2]int{min(v, w), max(v, w)}]++
			directed[[2]int{v, w}]++
		}
	}
	if len(edgeFaces) != len(s.Edges) {
		t.Fatalf("face/edge mismatch %d / %d", len(edgeFaces), len(s.Edges))
	}
	adj := make([][]int, len(s.Points))
	for _, e := range s.Edges {
		adj[e[0]] = append(adj[e[0]], e[1])
		adj[e[1]] = append(adj[e[1]], e[0])
		want := 1
		if s.Dimension == 3 {
			want = 2
		}
		if edgeFaces[e] != want {
			t.Fatalf("edge %v in %d faces", e, edgeFaces[e])
		}
		if want == 2 && (directed[e] != 1 || directed[[2]int{e[1], e[0]}] != 1) {
			t.Fatal("inconsistent orientation")
		}
	}
	seen := map[int]bool{}
	var visit func(int)
	visit = func(i int) {
		if seen[i] {
			return
		}
		seen[i] = true
		for _, j := range adj[i] {
			visit(j)
		}
	}
	visit(0)
	if len(seen) != len(s.Points) {
		t.Fatal("disconnected boundary")
	}
	if s.Dimension == 3 && len(s.Points)-len(s.Edges)+len(s.Facets) != 2 {
		t.Fatal("Euler characteristic")
	}
}
func TestCell24SectionsCentralAndExtreme(t *testing.T) {
	_, ss := section24Result(t, [6]float64{}, 0, 1, 0)
	// P at w=0: |x|,|y|,|z|≤1 and |x|+|y|+|z|≤2, a cuboctahedron.
	// P° at w=0: |x|+|y|≤1 etc., a rhombic dodecahedron, derived without assuming 3D duality.
	for i, want := range [][3]int{{12, 24, 14}, {14, 24, 12}} {
		s := ss[i]
		checkSection24(t, s, [6]float64{})
		if s.Dimension != 3 || len(s.Points) != want[0] || len(s.Edges) != want[1] || len(s.Facets) != want[2] {
			t.Fatalf("%s counts %d/%d/%d dim %d", s.Object, len(s.Points), len(s.Edges), len(s.Facets), s.Dimension)
		}
		expected := map[Vec3]bool{}
		if i == 0 {
			for v := range declaredPrimal() {
				if v[3] == 0 {
					expected[Vec3{v[0], v[1], v[2]}] = true
				}
			}
		} else {
			for a := 0; a < 3; a++ {
				for _, sign := range []float64{-1, 1} {
					v := Vec3{}
					v[a] = sign
					expected[v] = true
				}
			}
			for mask := 0; mask < 8; mask++ {
				v := Vec3{}
				for a := range v {
					v[a] = .5
					if mask&(1<<a) != 0 {
						v[a] = -.5
					}
				}
				expected[v] = true
			}
		}
		for _, p := range s.Points {
			if !expected[p] {
				t.Fatalf("unexpected central vertex %v", p)
			}
			delete(expected, p)
		}
		if len(expected) != 0 {
			t.Fatal("missing central vertices", expected)
		}
	}
	_, ss = section24Result(t, [6]float64{}, 1, 1, 0)
	if ss[0].Dimension != 3 || len(ss[0].Points) != 6 || len(ss[0].Edges) != 12 || len(ss[0].Facets) != 8 {
		t.Fatal("whole octahedron in slice is a solid", ss[0])
	}
	if ss[1].Dimension != 0 {
		t.Fatal("dual extreme is a point")
	}
	for _, s := range ss {
		checkSection24(t, s, [6]float64{})
	}
}
func TestCell24SectionContactsAndPerturbations(t *testing.T) {
	// Support normal along a primal vertex, edge midpoint, triangle center,
	// and cell normal exposes contacts of dimensions 0,1,2,3 respectively.
	cases := []struct {
		a   [6]float64
		h   float64
		dim int
	}{
		{[6]float64{0, 0, 0, math.Pi / 2, math.Pi / 4, 0}, math.Sqrt2, 0},
		{[6]float64{0, 0, 0, math.Pi / 2, math.Asin(1 / math.Sqrt(5)), math.Asin(1 / math.Sqrt(6))}, 3 / math.Sqrt(6), 1},
		{[6]float64{0, 0, 0, math.Pi / 2, math.Pi / 4, math.Asin(1 / math.Sqrt(5))}, math.Sqrt(10) / 3, 2},
		{[6]float64{}, 1, 3},
	}
	// Triangle normal chosen from v=(1,1,0,0),(1,0,1,0),(1,0,0,1): (3,1,1,1)/sqrt12.
	cases[2].a = [6]float64{0, 0, 0, math.Atan(3), math.Asin(1 / math.Sqrt(11)), math.Asin(1 / math.Sqrt(12))}
	cases[2].h = 2 / math.Sqrt(3)
	for _, c := range cases {
		_, ss := section24Result(t, c.a, c.h, 1, 0)
		if ss[0].Dimension != c.dim {
			t.Fatalf("angles %v support %g: dim %d want %d", c.a, c.h, ss[0].Dimension, c.dim)
		}
		for _, s := range ss {
			checkSection24(t, s, c.a)
		}
		for _, delta := range []float64{-1e-10, 1e-10} {
			_, ss := section24Result(t, c.a, c.h+delta, 1, 0)
			if delta > 0 && ss[0].Dimension != -1 {
				t.Fatal("outside support not empty")
			}
			if delta < 0 && ss[0].Dimension != 3 {
				t.Fatal("inside support not solid")
			}
			for _, s := range ss {
				checkSection24(t, s, c.a)
			}
		}
	}
}
func TestCell24SectionGenericFamily(t *testing.T) {
	angles := [6]float64{.31, .54, -.13, .81, .75, -.23}
	r, ss := section24Result(t, angles, 0, 25, 2.8)
	if r.Radius != math.Sqrt2 {
		t.Fatal("scale changed")
	}
	for _, s := range ss {
		checkSection24(t, s, angles)
	}
	// Repeated requests are immutable; selection does not change section geometry.
	saved, _ := json.Marshal(r)
	section24Result(t, [6]float64{}, 1, 1, 0)
	again, _ := json.Marshal(r)
	if string(saved) != string(again) {
		t.Fatal("retained storage overwritten")
	}
	q := cell24Request(0, "crystal", angles)
	q.Mode = "section"
	q.Count = 25
	q.Spread = 2.8
	for _, c := range []struct {
		field  string
		mutate func(*Request)
	}{
		{"count", func(q *Request) { q.Count = 26 }}, {"spread", func(q *Request) { q.Spread = 2*math.Sqrt2 + 1e-8 }}, {"slice", func(q *Request) { q.Slice = 2.025*math.Sqrt2 + 1e-8 }},
	} {
		bad := q
		c.mutate(&bad)
		_, err := Compute(bad)
		var f *FieldError
		if !errors.As(err, &f) || f.Field != c.field {
			t.Fatalf("%s: %v", c.field, err)
		}
	}
}

func TestCell24SectionTraversalAndBound(t *testing.T) {
	angles := [6]float64{.31, .54, -.13, .81, .75, -.23}
	for _, x := range []*complex24{primal24(), dual24()} {
		p := x.polytope(angles, 0, math.Sqrt2, 1)
		reversed := *x
		reversed.edges = append([][2]int(nil), x.edges...)
		slices.Reverse(reversed.edges)
		// Keep edge IDs consistent while reversing both visit orders.
		for k, ids := range x.cellEdges {
			reversed.cellEdges[k] = append([]int(nil), ids...)
			for i, e := range ids {
				reversed.cellEdges[k][i] = len(x.edges) - 1 - e
			}
			slices.Reverse(reversed.cellEdges[k])
		}
		for _, h := range []float64{-1, -.2, 0, .7, 1} {
			a := x.section24(p.Rotated, angles, h, "test", "s")
			b := reversed.section24(p.Rotated, angles, h, "test", "s")
			aa, _ := json.Marshal(a)
			bb, _ := json.Marshal(b)
			if string(aa) != string(bb) {
				t.Fatal("edge traversal changes geometry or provenance")
			}
		}
	}
	r, ss := section24Result(t, angles, 0, 25, 0)
	vertices, indices := 0, 0
	for _, s := range ss {
		vertices += len(s.Points)
		for _, f := range s.Facets {
			indices += len(f.Vertices)
		}
	}
	if r.Evaluations != 48+2*25*(96+24*12) || r.Evaluations > 48+cell24SectionWork || vertices > cell24SectionVertices || indices > cell24SectionFaceIndices {
		t.Fatal("combined bounds", r.Evaluations, vertices, indices)
	}
	if r.EmittedPoints != vertices {
		t.Fatal("emitted geometry count")
	}
	// Shared plane families are overlays; changing their density adds no
	// artificial xyz spacing. An identical plane returns identical geometry.
	for i := 2; i < len(ss); i++ {
		a, b := ss[i], ss[i%2]
		a.ID = b.ID
		aa, _ := json.Marshal(a)
		bb, _ := json.Marshal(b)
		if string(aa) != string(bb) {
			t.Fatal("family moved section")
		}
	}
}

func BenchmarkCell24Sections(b *testing.B) {
	q := cell24Request(0, "crystal", [6]float64{.31, .54, -.13, .81, .75, -.23})
	q.Mode = "section"
	q.Count = 25
	q.Spread = 0
	for i := 0; i < b.N; i++ {
		if _, err := Compute(q); err != nil {
			b.Fatal(err)
		}
	}
}

func TestCell24SectionNearContactBandAndOwnership(t *testing.T) {
	a := [6]float64{0, 0, 0, math.Pi / 2, math.Pi / 4, 0}
	for _, distance := range []float64{1e-10, 1e-12, 1e-13} {
		for _, sign := range []float64{-1, 1} {
			_, ss := section24Result(t, a, math.Sqrt2+sign*distance, 1, 0)
			want := 3
			if sign > 0 {
				want = -1
			}
			if ss[0].Dimension != want {
				t.Fatalf("h-support=%g: dimension %d want %d", sign*distance, ss[0].Dimension, want)
			}
			for _, s := range ss {
				checkSection24(t, s, a)
			}
		}
	}
	for _, delta := range []float64{-1e-15, 0, 1e-15} {
		_, ss := section24Result(t, a, math.Sqrt2+delta, 1, 0)
		if ss[0].Dimension != 0 {
			t.Fatal("within rounding band did not coalesce to contact")
		}
	}
	q := cell24Request(2, "crystal", a)
	q.Mode = "section"
	q.Count = 1
	before := compute(t, q)
	want, _ := json.Marshal(before)
	before.Polytope.Sections[0].Points[0][0] = 99
	before.Polytope.Sections[0].VertexCells[0][0] = 99
	before.Polytope.Sections[0].Origins[0][0] = 99
	before.Polytope.Sections[0].Facets[0].Cells[0] = 99
	again := compute(t, q)
	got, _ := json.Marshal(again)
	if string(got) != string(want) {
		t.Fatal("reply mutation leaked into future requests")
	}
	for _, grid := range []int{0, 1, 12} {
		q.Grid = grid
		r := compute(t, q)
		b, _ := json.Marshal(r)
		if string(b) != string(want) {
			t.Fatal("section incidence depends on shadow grid")
		}
	}
}

// Slices within and just beyond the contact band of every rotated vertex
// level. Snapping a vertex onto the plane must not make one octahedral cell
// look nonplanar (and so a whole cell), nor may a tiny corner just outside
// the band lose a facet: every solid stays a closed, paired boundary.
func TestCell24SectionAcrossContactBand(t *testing.T) {
	for _, angles := range [][6]float64{
		{0, .9188070704038833, 0, math.Pi / 2, math.Pi / 4, 0},
		{.31, .54, -.13, .81, .75, -.23},
		{1.7, -2.2, .4, 3.1, -.6, 2.5},
	} {
		base := compute(t, cell24Request(0, "crystal", angles)).Polytope
		for j, levels := range [][]Vec4{base.Primal.Rotated, base.Dual.Rotated} {
			for _, v := range levels {
				for _, k := range []float64{-30, -23, -21, -19, -15, -10, -5, -1, 0, 1, 5, 10, 15, 19, 21, 23, 30} {
					_, ss := section24Result(t, angles, v[3]+k*1e-15, 1, 0)
					checkSection24(t, ss[j], angles)
				}
			}
		}
	}
}
