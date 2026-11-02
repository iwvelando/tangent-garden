package engine4

import (
	"encoding/json"
	"errors"
	"math"
	"math/big"
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
		{"section", "mode", func() Request { q := cell24Request(0, "cell", [6]float64{}); q.Mode = "section"; return q }},
		{"perspective", "mode", func() Request { q := cell24Request(0, "cell", [6]float64{}); q.Mode = "perspective"; return q }},
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
