package engine4

import (
	"encoding/json"
	"errors"
	"math"
	"slices"
	"sort"
	"testing"
)

// The tesseract C = [−1, 1]⁴ and its polar 16-cell C° = {x : Σ|xᵢ| ≤ 1},
// a dual pair that is not self-dual. Expectations are written from the
// declared coordinates and inequalities, independently of the engine's
// incidence.

func cell16Request(selected int, view string, angles [6]float64) Request {
	return Request{Object: "cell16", Mode: "orthographic", Angles: angles, Cell16: &PairParameters{Selected: selected, View: view}}
}

func cell16Result(t *testing.T, q Request) (Result, *PairDiagnostics) {
	t.Helper()
	r := compute(t, q)
	if r.Polytope == nil {
		t.Fatal("no polytope diagnostics")
	}
	return r, r.Polytope
}

// The tesseract's 16 vertices (±1, ±1, ±1, ±1).
func declaredTesseract() map[[4]float64]bool {
	set := map[[4]float64]bool{}
	for m := 0; m < 16; m++ {
		var v [4]float64
		for i := range v {
			v[i] = 1
			if m&(1<<i) != 0 {
				v[i] = -1
			}
		}
		set[v] = true
	}
	return set
}

// The 16-cell's 8 vertices ±eᵢ.
func declaredCross() map[[4]float64]bool {
	set := map[[4]float64]bool{}
	for i := 0; i < 4; i++ {
		for _, s := range []float64{-1, 1} {
			var v [4]float64
			v[i] = s
			set[v] = true
		}
	}
	return set
}

// descending sorts points in descending lexicographic order, the declared
// ID order.
func descending(set map[[4]float64]bool) []Vec4 {
	out := make([]Vec4, 0, len(set))
	for v := range set {
		out = append(out, v)
	}
	sort.Slice(out, func(i, j int) bool {
		for k := 0; k < 4; k++ {
			if out[i][k] != out[j][k] {
				return out[i][k] > out[j][k]
			}
		}
		return false
	})
	return out
}

// An independent forward rotation in the declared plane order.
func rotated16(v Vec4, angles [6]float64) Vec4 {
	pairs := [6][2]int{{0, 1}, {0, 2}, {1, 2}, {0, 3}, {1, 3}, {2, 3}}
	for i, ab := range pairs {
		c, s := math.Cos(angles[i]), math.Sin(angles[i])
		a, b := ab[0], ab[1]
		v[a], v[b] = c*v[a]-s*v[b], s*v[a]+c*v[b]
	}
	return v
}

func TestCell16DeclaredCoordinates(t *testing.T) {
	r, p := cell16Result(t, cell16Request(0, "cell", [6]float64{}))
	if r.Object != "cell16" || r.Operation != "orthographic" {
		t.Fatal(r.Object, r.Operation)
	}
	sameSet(t, "tesseract", p.Primal.Source, declaredTesseract())
	sameSet(t, "16-cell", p.Dual.Source, declaredCross())
	if !slices.Equal(p.Primal.Source, descending(declaredTesseract())) || !slices.Equal(p.Dual.Source, descending(declaredCross())) {
		t.Fatal("IDs are not in descending lexicographic order")
	}
	if p.Primal.Source[0] != (Vec4{1, 1, 1, 1}) || p.Dual.Source[0] != (Vec4{1, 0, 0, 0}) || p.Dual.Source[7] != (Vec4{-1, 0, 0, 0}) {
		t.Fatal(p.Primal.Source[0], p.Dual.Source[0], p.Dual.Source[7])
	}
	near(t, p.Primal.Circumradius, 2)
	near(t, p.Primal.EdgeLength, 2)
	near(t, p.Dual.Circumradius, 1)
	near(t, p.Dual.EdgeLength, math.Sqrt2)
	if p.Primal.Faces != 24 || p.Primal.Cells != 8 || p.Dual.Faces != 32 || p.Dual.Cells != 16 {
		t.Fatal(p.Primal.Faces, p.Primal.Cells, p.Dual.Faces, p.Dual.Cells)
	}
	near(t, r.Radius, 2)
}

// Polarity by exact facet enumeration: the polar of the tesseract is the
// 16-cell, and the polar of that is the tesseract, with no rescaling.
func TestCell16DoublePolar(t *testing.T) {
	_, p := cell16Result(t, cell16Request(0, "cell", [6]float64{}))
	sameSet(t, "polar of the tesseract", p.Dual.Source, polarVertices(t, p.Primal.Source))
	sameSet(t, "polar of the 16-cell", p.Primal.Source, polarVertices(t, p.Dual.Source))
}

// Counts, degrees and cell structure of both configurations, with edges
// exactly the pairs at the declared edge length and every cell exactly the
// equality set of its inequality.
func TestCell16Incidence(t *testing.T) {
	primal, dual := pair16()
	for _, c := range []struct {
		name                            string
		x                               *lattice4
		normals                         []Vec4
		vertices, edges, faces, cells   int
		length2                         int
		degree, cellSize, cellEdges     int
		cellFaces, faceSize, edgeInCell int
	}{
		{"tesseract", primal, descending(declaredCross()), 16, 32, 24, 8, 4, 4, 8, 12, 6, 4, 3},
		{"16-cell", dual, descending(declaredTesseract()), 8, 24, 32, 16, 2, 6, 4, 6, 4, 3, 4},
	} {
		t.Run(c.name, func(t *testing.T) {
			x := c.x
			if len(x.coords) != c.vertices || len(x.edges) != c.edges || len(x.faces) != c.faces || len(x.cells) != c.cells {
				t.Fatalf("counts %d %d %d %d", len(x.coords), len(x.edges), len(x.faces), len(x.cells))
			}
			edge := map[[2]int]bool{}
			degree := make([]int, c.vertices)
			for i, e := range x.edges {
				if e[0] >= e[1] || edge[e] || (i > 0 && !lessPair(x.edges[i-1], e)) {
					t.Fatalf("edge %v not ordered or repeated", e)
				}
				edge[e] = true
				degree[e[0]]++
				degree[e[1]]++
			}
			for i := 0; i < c.vertices; i++ {
				for j := i + 1; j < c.vertices; j++ {
					d := sub4(x.source(i), x.source(j))
					if (dot4(d, d) == float64(c.length2)) != edge[[2]int{i, j}] {
						t.Fatalf("pair %d %d at squared length %g", i, j, dot4(d, d))
					}
				}
				if degree[i] != c.degree {
					t.Fatalf("vertex %d degree %d", i, degree[i])
				}
			}
			// 2-faces: polygons whose consecutive... every pair of their
			// vertices at edge length is an edge, and each has faceSize
			// vertices on one plane.
			faceCells := make([]int, len(x.faces))
			edgeCells := make([]int, len(x.edges))
			for i, f := range x.faces {
				if len(f) != c.faceSize || !sort.IntsAreSorted(f) || (i > 0 && slices.Compare(x.faces[i-1], f) >= 0) {
					t.Fatalf("face %v", f)
				}
				sides := 0
				for a := range f {
					for b := a + 1; b < len(f); b++ {
						if edge[[2]int{f[a], f[b]}] {
							sides++
						}
					}
				}
				if sides != c.faceSize {
					t.Fatalf("face %v has %d sides", f, sides)
				}
			}
			for k, cell := range x.cells {
				n := c.normals[k]
				if (Vec4{float64(x.normals[k][0]), float64(x.normals[k][1]), float64(x.normals[k][2]), float64(x.normals[k][3])}) != n {
					t.Fatalf("cell %d normal %v, want the other configuration's vertex %v", k, x.normals[k], n)
				}
				members := map[int]bool{}
				for _, v := range cell {
					members[v] = true
				}
				if len(members) != c.cellSize {
					t.Fatalf("cell %d %v", k, cell)
				}
				for i := 0; i < c.vertices; i++ {
					s := dot4(n, x.source(i))
					if s > 1 || (s == 1) != members[i] {
						t.Fatalf("cell %d vertex %d: n·x = %g", k, i, s)
					}
				}
				if len(x.cellEdges[k]) != c.cellEdges || len(x.cellFaces[k]) != c.cellFaces {
					t.Fatalf("cell %d has %d edges and %d faces", k, len(x.cellEdges[k]), len(x.cellFaces[k]))
				}
				for _, e := range x.cellEdges[k] {
					if !members[x.edges[e][0]] || !members[x.edges[e][1]] {
						t.Fatalf("cell %d edge %v", k, x.edges[e])
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
			}
			for f, n := range faceCells {
				if n != 2 {
					t.Fatalf("face %v in %d cells", x.faces[f], n)
				}
			}
			for e, n := range edgeCells {
				if n != c.edgeInCell {
					t.Fatalf("edge %v in %d cells", x.edges[e], n)
				}
			}
			// Euler: V − E + F − C = 0 for a 4-polytope's boundary.
			if c.vertices-c.edges+c.faces-c.cells != 0 {
				t.Fatal("Euler characteristic")
			}
		})
	}
}

func lessPair(a, b [2]int) bool { return a[0] < b[0] || (a[0] == b[0] && a[1] < b[1]) }

// Polar duality reverses inclusion: a k-face F of the tesseract maps to the
// face F* = {u : u · v = 1 for every v in F} of the 16-cell, of dimension
// 3 − k, one to one, and F** = F. Faces are written as vertex sets of the
// declared coordinates; the engine's lists must be exactly these.
func TestCell16DualityReversesInclusion(t *testing.T) {
	primal, dual := pair16()
	star := func(f []int, from, to *lattice4) []int {
		out := []int{}
		for j := range to.coords {
			all := true
			for _, i := range f {
				if dot4(from.source(i), to.source(j)) != 1 {
					all = false
					break
				}
			}
			if all {
				out = append(out, j)
			}
		}
		return out
	}
	faces := func(x *lattice4) [4][][]int {
		var out [4][][]int
		for i := range x.coords {
			out[0] = append(out[0], []int{i})
		}
		for _, e := range x.edges {
			out[1] = append(out[1], []int{e[0], e[1]})
		}
		out[2] = x.faces
		for _, c := range x.cells {
			s := append([]int(nil), c...)
			sort.Ints(s)
			out[3] = append(out[3], s)
		}
		return out
	}
	key := func(f []int) string { b, _ := json.Marshal(f); return string(b) }
	for _, c := range []struct {
		name     string
		from, to *lattice4
	}{{"tesseract to 16-cell", primal, dual}, {"16-cell to tesseract", dual, primal}} {
		fromFaces, toFaces := faces(c.from), faces(c.to)
		for k := 0; k < 4; k++ {
			want := map[string]bool{}
			for _, f := range toFaces[3-k] {
				want[key(f)] = true
			}
			seen := map[string]bool{}
			for _, f := range fromFaces[k] {
				g := star(f, c.from, c.to)
				if !want[key(g)] || seen[key(g)] {
					t.Fatalf("%s: %d-face %v maps to %v, not a new %d-face", c.name, k, f, g, 3-k)
				}
				seen[key(g)] = true
				if back := star(g, c.to, c.from); !slices.Equal(back, f) {
					t.Fatalf("%s: F** of %v is %v", c.name, f, back)
				}
			}
			if len(seen) != len(want) {
				t.Fatalf("%s: %d of %d %d-faces reached", c.name, len(seen), len(want), 3-k)
			}
		}
	}
	// Cell k of each configuration is centered on its own normal's
	// direction: exactly on dual vertex k for a cube (the tesseract's
	// inradius is 1), and on v/4 for the tetrahedron of primal vertex v.
	for k, cell := range primal.cells {
		center := Vec4{}
		for _, v := range cell {
			for i := range center {
				center[i] += primal.source(v)[i] / 8
			}
		}
		if center != dual.source(k) {
			t.Fatalf("cube %d centered at %v", k, center)
		}
	}
	for j, cell := range dual.cells {
		center := Vec4{}
		for _, v := range cell {
			for i := range center {
				center[i] += dual.source(v)[i] / 4
			}
		}
		want := primal.source(j)
		for i := range want {
			want[i] /= 4
		}
		if center != want {
			t.Fatalf("tetrahedron %d centered at %v", j, center)
		}
	}
}

// The rotation is rigid on both configurations, the orthogonal shadow drops
// w, and every cube's four diagonals cross at its center, a 16-cell
// vertex.
func TestCell16RotatedShadow(t *testing.T) {
	angles := [6]float64{.31, .54, -.13, .81, .75, -.23}
	r, p := cell16Result(t, cell16Request(5, "crystal", angles))
	near(t, r.Radius, 2)
	for _, c := range []struct {
		name string
		p    PairPolytope
	}{{"tesseract", p.Primal}, {"16-cell", p.Dual}} {
		for i := range c.p.Source {
			want := rotated16(c.p.Source[i], angles)
			for k := range want {
				if math.Abs(c.p.Rotated[i][k]-want[k]) > 1e-12 {
					t.Fatalf("%s: rotated %d", c.name, i)
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
	primal, _ := pair16()
	for k := 0; k < 8; k++ {
		pairs := primal.opposite(k)
		if len(pairs) != 4 {
			t.Fatalf("cube %d has %d diagonals", k, len(pairs))
		}
		for _, d := range pairs {
			a, b := p.Primal.Points[d[0]], p.Primal.Points[d[1]]
			for j := range a {
				near(t, (a[j]+b[j])/2, p.Dual.Points[k][j])
			}
		}
	}
	if r.EmittedPoints != 24 || r.Evaluations != 24 {
		t.Fatal(r.EmittedPoints, r.Evaluations)
	}
	if len(r.Paths) != 0 || len(r.Markers) != 0 || len(r.Faces) != 0 {
		t.Fatal("geometry travels in the polytope arrays only")
	}
}

// Perspective: P = d(x, y, z)/(d − w) after the same rotation, framed by
// 2d/√(d² − 4), the tesseract's own bound, for every admitted rotation.
func TestCell16Perspective(t *testing.T) {
	for _, angles := range perspectiveAngles {
		for _, d := range []float64{2.05, 2.4, 4, 20} {
			q := cell16Request(3, "crystal", angles)
			q.Mode, q.Distance = "perspective", d
			r, p := cell16Result(t, q)
			bound := sampledFramingRadius(2, d)
			if math.Abs(r.Radius-bound) > 1e-6*bound || math.Abs(r.Radius-2*d/math.Sqrt(d*d-4)) > 1e-12*r.Radius {
				t.Fatalf("d %g: radius %g, sampled %g", d, r.Radius, bound)
			}
			for _, c := range []PairPolytope{p.Primal, p.Dual} {
				for i, v := range c.Rotated {
					if d-v[3] < d-2-1e-12 {
						t.Fatalf("denominator %g", d-v[3])
					}
					s := d / (d - v[3])
					want := Vec3{s * v[0], s * v[1], s * v[2]}
					for k := range want {
						if math.Abs(c.Points[i][k]-want[k]) > 1e-12*math.Max(1, math.Abs(want[k])) {
							t.Fatalf("d %g: point %d %v want %v", d, i, c.Points[i], want)
						}
					}
					if math.Sqrt(dot(c.Points[i], c.Points[i])) > r.Radius*(1+1e-12) {
						t.Fatal("outside the framing radius")
					}
				}
			}
			// Lines stay lines: each diagonal passes through the center.
			primal, _ := pair16()
			center := p.Dual.Points[3]
			for _, dg := range primal.opposite(3) {
				a, b := p.Primal.Points[dg[0]], p.Primal.Points[dg[1]]
				ab, ac := sub(b, a), sub(center, a)
				x := cross(ab, ac)
				if math.Sqrt(dot(x, x)) > 1e-9*dot(ab, ab) {
					t.Fatalf("d %g: center off diagonal", d)
				}
				if f := dot(ac, ab) / dot(ab, ab); f < 0 || f > 1 {
					t.Fatal("center outside its diagonal")
				}
			}
		}
	}
}

// One cube of the tesseract, its center and the six cubes beside it.
func TestCell16Selection(t *testing.T) {
	angles := [6]float64{.3, .2, .1, .7, .5, .3}
	for k := 0; k < 8; k++ {
		_, p := cell16Result(t, cell16Request(k, "cell", angles))
		if p.Selected != k || p.View != "cell" {
			t.Fatal(p.Selected, p.View)
		}
		u := p.Dual.Source[k]
		if len(p.CellVertices) != 8 {
			t.Fatal(p.CellVertices)
		}
		members := map[int]bool{}
		for i := 0; i < 8; i += 2 {
			a, b := p.Primal.Source[p.CellVertices[i]], p.Primal.Source[p.CellVertices[i+1]]
			// Opposite vertices: their sum is twice the center.
			if (Vec4{a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]}) != (Vec4{2 * u[0], 2 * u[1], 2 * u[2], 2 * u[3]}) {
				t.Fatalf("cube %d diagonal %v %v", k, a, b)
			}
			members[p.CellVertices[i]], members[p.CellVertices[i+1]] = true, true
		}
		for i, v := range p.Primal.Source {
			if (dot4(u, v) == 1) != members[i] {
				t.Fatalf("cube %d membership of %v", k, v)
			}
		}
		short, long := math.Inf(1), 0.
		if len(p.CellEdges) != 12 {
			t.Fatal(p.CellEdges)
		}
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
		// Neighbors: the six 16-cell vertices orthogonal to u, never −u.
		want := []int{}
		for j, v := range p.Dual.Source {
			if dot4(u, v) == 0 {
				want = append(want, j)
			}
		}
		if !slices.Equal(p.Neighbors, want) || len(p.NeighborEdges) != 6 || len(p.SharedFaces) != 6 {
			t.Fatal(p.Neighbors, want, p.NeighborEdges, p.SharedFaces)
		}
		for i, n := range p.Neighbors {
			if e := p.Dual.Edges[p.NeighborEdges[i]]; e != [2]int{min(k, n), max(k, n)} {
				t.Fatalf("neighbor %d edge %v", n, e)
			}
			// The square the two cubes share lies on both hyperplanes.
			sq := p.SharedFaces[i]
			if len(sq) != 4 || !sort.IntsAreSorted(sq) {
				t.Fatal(sq)
			}
			count := 0
			for j, v := range p.Primal.Source {
				on := dot4(u, v) == 1 && dot4(p.Dual.Source[n], v) == 1
				if on {
					count++
				}
				if on != slices.Contains(sq, j) {
					t.Fatalf("shared square %v", sq)
				}
			}
			if count != 4 {
				t.Fatal(count)
			}
		}
	}
}

// Distinct vertices whose shadows coincide keep their own IDs.
func TestCell16CoincidentShadows(t *testing.T) {
	_, p := cell16Result(t, cell16Request(0, "crystal", [6]float64{}))
	shadows := map[Vec3][]int{}
	for i, q := range p.Dual.Points {
		shadows[q] = append(shadows[q], i)
	}
	// ±e_w share the origin; the other six have their own shadows.
	if len(shadows) != 7 || len(shadows[Vec3{}]) != 2 {
		t.Fatal(shadows)
	}
	ids := shadows[Vec3{}]
	if p.Dual.Source[ids[0]] != (Vec4{0, 0, 0, 1}) || p.Dual.Source[ids[1]] != (Vec4{0, 0, 0, -1}) {
		t.Fatal(ids)
	}
	shadows = map[Vec3][]int{}
	for i, q := range p.Primal.Points {
		shadows[q] = append(shadows[q], i)
	}
	if len(shadows) != 8 {
		t.Fatal("the tesseract's (x, y, z, ±1) pair up", len(shadows))
	}
}

func TestCell16Validation(t *testing.T) {
	for _, c := range []struct {
		name  string
		field string
		q     func() Request
	}{
		{"below", "cell16.selected", func() Request { return cell16Request(-1, "cell", [6]float64{}) }},
		{"above", "cell16.selected", func() Request { return cell16Request(8, "cell", [6]float64{}) }},
		{"view", "cell16.view", func() Request { return cell16Request(0, "wireframe", [6]float64{}) }},
		{"stereo", "mode", func() Request { q := cell16Request(0, "cell", [6]float64{}); q.Mode = "stereo"; return q }},
		{"perspective", "distance", func() Request { q := cell16Request(0, "cell", [6]float64{}); q.Mode = "perspective"; return q }},
		{"far", "distance", func() Request {
			q := cell16Request(0, "cell", [6]float64{})
			q.Mode, q.Distance = "perspective", 20.0001
			return q
		}},
		{"angle", "angles.2", func() Request { q := cell16Request(0, "cell", [6]float64{}); q.Angles[2] = math.NaN(); return q }},
		{"large angle", "angles.5", func() Request { q := cell16Request(0, "cell", [6]float64{}); q.Angles[5] = 2e6; return q }},
		{"slice", "slice", func() Request { q := section16Request([6]float64{}, 4.05+1e-9, 1, 0); return q }},
		{"spread", "spread", func() Request { q := section16Request([6]float64{}, 0, 3, 4+1e-9); return q }},
		{"count", "count", func() Request { q := section16Request([6]float64{}, 0, 26, 1); return q }},
	} {
		_, err := Compute(c.q())
		var f *FieldError
		if !errors.As(err, &f) || f.Field != c.field {
			t.Fatalf("%s: %v", c.name, err)
		}
	}
	q := cell16Request(0, "cell", [6]float64{})
	q.Cell16 = nil
	if _, err := Compute(q); err == nil {
		t.Fatal("missing parameters accepted")
	}
	// Inactive fields do not block the shadows: no distance outside
	// perspective, no slice outside sections.
	q = cell16Request(0, "cell", [6]float64{})
	q.Distance, q.Slice, q.Spread, q.Count = -1, 99, -1, 0
	compute(t, q)
	q.Mode, q.Distance = "perspective", 2.05
	compute(t, q)
	// Extremes are admitted.
	compute(t, section16Request([6]float64{}, -4.05, 25, 4))
}

func section16Request(angles [6]float64, h float64, count int, spread float64) Request {
	q := cell16Request(0, "crystal", angles)
	q.Mode, q.Slice, q.Count, q.Spread = "section", h, count, spread
	return q
}

func section16Result(t *testing.T, angles [6]float64, h float64, count int, spread float64) (Result, []section24Wire) {
	t.Helper()
	r := compute(t, section16Request(angles, h, count, spread))
	b, _ := json.Marshal(r)
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
	for _, s := range wire.Polytope.Sections {
		if s.ID[:7] != "cell16/" {
			t.Fatal(s.ID)
		}
		checkPairSection(t, s, angles, declaredTesseract(), declaredCross())
	}
	return r, wire.Polytope.Sections
}

func pointSet(points []Vec3) map[Vec3]bool {
	set := map[Vec3]bool{}
	for _, p := range points {
		set[p] = true
	}
	return set
}

// polar3 is the 3D polar {y : y · x ≤ 1 for every x} of a centrally
// symmetric box or octahedron through the origin, found by exact
// enumeration of the vertex triples' facet planes.
func polar3(points []Vec3) map[Vec3]bool {
	out := map[Vec3]bool{}
	for a := range points {
		for b := a + 1; b < len(points); b++ {
			for c := b + 1; c < len(points); c++ {
				p, q, r := points[a], points[b], points[c]
				det := dot(p, cross(q, r))
				if det == 0 {
					continue
				}
				// y solves p·y = q·y = r·y = 1: y = (q×r + r×p + p×q)/det.
				y := Vec3{}
				for _, v := range []Vec3{cross(q, r), cross(r, p), cross(p, q)} {
					for i := range y {
						y[i] += v[i] / det
					}
				}
				ok := true
				for _, x := range points {
					if dot(x, y) > 1+1e-12 {
						ok = false
					}
				}
				if ok {
					out[y] = true
				}
			}
		}
	}
	return out
}

// Unrotated sections from the declared inequalities: w = 0 cuts the cube
// [−1, 1]³ and the octahedron |x| + |y| + |z| ≤ 1, which happen to be 3D
// polars; at w = ½ the cube is unchanged but the octahedron has radius ½,
// so the section of the polar is no longer the polar of the section; at
// w = 1 the tesseract's section is a whole cube cell and the 16-cell's one
// point.
func TestCell16SectionsUnrotated(t *testing.T) {
	cube := map[Vec3]bool{}
	for m := 0; m < 8; m++ {
		v := Vec3{}
		for i := range v {
			v[i] = 1
			if m&(1<<i) != 0 {
				v[i] = -1
			}
		}
		cube[v] = true
	}
	octahedron := func(r float64) map[Vec3]bool {
		set := map[Vec3]bool{}
		for i := 0; i < 3; i++ {
			for _, s := range []float64{-r, r} {
				v := Vec3{}
				v[i] = s
				set[v] = true
			}
		}
		return set
	}
	for _, c := range []struct {
		h          float64
		dual       map[Vec3]bool
		polarMatch bool
	}{{0, octahedron(1), true}, {.5, octahedron(.5), false}, {-.25, octahedron(.75), false}} {
		_, ss := section16Result(t, [6]float64{}, c.h, 1, 0)
		p, d := ss[0], ss[1]
		if p.Dimension != 3 || len(p.Points) != 8 || len(p.Edges) != 12 || len(p.Facets) != 6 {
			t.Fatalf("h %g: tesseract section %d/%d/%d dim %d", c.h, len(p.Points), len(p.Edges), len(p.Facets), p.Dimension)
		}
		if d.Dimension != 3 || len(d.Points) != 6 || len(d.Edges) != 12 || len(d.Facets) != 8 {
			t.Fatalf("h %g: 16-cell section %d/%d/%d dim %d", c.h, len(d.Points), len(d.Edges), len(d.Facets), d.Dimension)
		}
		if !mapsEqual(pointSet(p.Points), cube) || !mapsEqual(pointSet(d.Points), c.dual) {
			t.Fatalf("h %g: %v %v", c.h, p.Points, d.Points)
		}
		if mapsEqual(polar3(p.Points), pointSet(d.Points)) != c.polarMatch {
			t.Fatalf("h %g: polar of the cube section %v against the dual section %v", c.h, polar3(p.Points), d.Points)
		}
	}
	_, ss := section16Result(t, [6]float64{}, 1, 1, 0)
	if ss[0].Dimension != 3 || len(ss[0].Points) != 8 || len(ss[0].Edges) != 12 || len(ss[0].Facets) != 6 {
		t.Fatal("a whole cube cell in the plane is a solid", ss[0])
	}
	if ss[1].Dimension != 0 || ss[1].Points[0] != (Vec3{}) || ss[1].Origins[0] != [2]int{3, 3} {
		t.Fatal("the 16-cell meets w = 1 at e_w, vertex 3", ss[1])
	}
	// Beyond both, empty with no geometry.
	_, ss = section16Result(t, [6]float64{}, 1.5, 1, 0)
	if ss[0].Dimension != -1 || ss[1].Dimension != -1 {
		t.Fatal("beyond the tesseract")
	}
}

func mapsEqual(a, b map[Vec3]bool) bool {
	if len(a) != len(b) {
		return false
	}
	for k := range a {
		if !b[k] {
			return false
		}
	}
	return true
}

// Rotations putting the w axis along a chosen direction n: with only xw,
// yw and zw turned, rotated w = n · x for n = (sin a cos b cos c,
// sin b cos c, sin c, cos a cos b cos c). The tesseract's support in
// direction n is Σ|nᵢ|, met in a face of dimension equal to the number of
// zero components; the 16-cell's is max|nᵢ|, met in a face of dimension
// one less than the number of maximal components.
func TestCell16SectionContacts(t *testing.T) {
	type contact struct {
		angles  [6]float64
		h       float64
		object  int
		dim     int
		comment string
	}
	third := math.Asin(1 / math.Sqrt(3))
	cases := []contact{
		{[6]float64{}, 1, 0, 3, "tesseract cube"},
		{[6]float64{0, 0, 0, math.Pi / 4, 0, 0}, math.Sqrt2, 0, 2, "tesseract square"},
		{[6]float64{0, 0, 0, math.Pi / 4, third, 0}, math.Sqrt(3), 0, 1, "tesseract edge"},
		{[6]float64{0, 0, 0, math.Pi / 4, third, math.Pi / 6}, 2, 0, 0, "tesseract vertex"},
		{[6]float64{}, 1, 1, 0, "16-cell vertex"},
		{[6]float64{0, 0, 0, math.Pi / 4, 0, 0}, 1 / math.Sqrt2, 1, 1, "16-cell edge"},
		{[6]float64{0, 0, 0, math.Pi / 4, third, 0}, 1 / math.Sqrt(3), 1, 2, "16-cell triangle"},
		{[6]float64{0, 0, 0, math.Pi / 4, third, math.Pi / 6}, .5, 1, 3, "16-cell tetrahedron"},
	}
	for _, c := range cases {
		_, ss := section16Result(t, c.angles, c.h, 1, 0)
		if ss[c.object].Dimension != c.dim {
			t.Fatalf("%s: dimension %d", c.comment, ss[c.object].Dimension)
		}
		for _, delta := range []float64{-1e-10, 1e-10} {
			_, ss := section16Result(t, c.angles, c.h+delta, 1, 0)
			want := 3
			if delta > 0 {
				want = -1
			}
			if ss[c.object].Dimension != want {
				t.Fatalf("%s %+g: dimension %d", c.comment, delta, ss[c.object].Dimension)
			}
		}
		// Within the contact band, a plane rounded off the support
		// coalesces onto the contact.
		for _, delta := range []float64{-1e-15, 1e-15} {
			_, ss := section16Result(t, c.angles, c.h+delta, 1, 0)
			if ss[c.object].Dimension != c.dim {
				t.Fatalf("%s %+g: dimension %d in the band", c.comment, delta, ss[c.object].Dimension)
			}
		}
	}
}

// A generic rotated family, sweeping every rotated vertex level and just
// either side of it, and the combined bound.
func TestCell16SectionFamilyAndBound(t *testing.T) {
	for _, angles := range [][6]float64{
		{.31, .54, -.13, .81, .75, -.23},
		{1.7, -2.2, .4, 3.1, -.6, 2.5},
	} {
		base := compute(t, cell16Request(0, "crystal", angles)).Polytope
		for _, levels := range [][]Vec4{base.Primal.Rotated, base.Dual.Rotated} {
			for _, v := range levels {
				for _, k := range []float64{-30, -5, 0, 5, 30} {
					section16Result(t, angles, v[3]+k*1e-15, 1, 0)
				}
			}
		}
		r, ss := section16Result(t, angles, 0, 25, 4)
		vertices, indices := 0, 0
		for _, s := range ss {
			vertices += len(s.Points)
			for _, f := range s.Facets {
				indices += len(f.Vertices)
			}
		}
		if r.Evaluations != 24+25*(32+8*12+24+16*6) || r.EmittedPoints != vertices || vertices > 2800 || indices > 9600 {
			t.Fatal("combined bound", r.Evaluations, r.EmittedPoints, vertices, indices)
		}
		near(t, r.Radius, 2)
		if len(r.Sections) != 50 || r.Sections[0].Kind != "primal" || r.Sections[1].Kind != "dual" {
			t.Fatal(len(r.Sections))
		}
	}
}

// The new object leaves the tesseract and the 24-cell alone.
func TestCell16LeavesOtherObjects(t *testing.T) {
	r := compute(t, request())
	if r.Polytope != nil || len(r.Paths) != 32 || r.Radius != 2 {
		t.Fatal(r.Polytope, len(r.Paths), r.Radius)
	}
	_, p := cell24Result(t, cell24Request(0, "cell", [6]float64{}))
	if len(p.Dual.Source) != 24 || len(p.CellVertices) != 6 {
		t.Fatal("24-cell changed")
	}
	// A cell16 parameter on another object is ignored.
	q := cell24Request(0, "cell", [6]float64{})
	q.Cell16 = &PairParameters{Selected: 99, View: "x"}
	compute(t, q)
}

func TestCell16ResultBound(t *testing.T) {
	r, p := cell16Result(t, cell16Request(7, "crystal", [6]float64{.1, .2, .3, .4, .5, .6}))
	if len(p.Primal.Points)+len(p.Dual.Points) != 24 || len(p.Primal.Edges)+len(p.Dual.Edges) != 56 {
		t.Fatal("bound")
	}
	b, _ := json.Marshal(r)
	if len(b) > 20000 {
		t.Fatalf("%d JSON bytes before lifting", len(b))
	}
}

func BenchmarkCell16(b *testing.B) {
	q := cell16Request(3, "crystal", [6]float64{.3, .2, .1, .7, .5, .3})
	for i := 0; i < b.N; i++ {
		if _, err := Compute(q); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkCell16Sections(b *testing.B) {
	q := section16Request([6]float64{.31, .54, -.13, .81, .75, -.23}, 0, 25, 0)
	for i := 0; i < b.N; i++ {
		if _, err := Compute(q); err != nil {
			b.Fatal(err)
		}
	}
}

// Corner first through the center (the w axis along the tesseract's
// diagonal (½, ½, ½, ½)): the tesseract's section is the octahedron of its
// six vertices with two coordinates +1 and two −1, and the 16-cell's is
// the cuboctahedron of the twelve midpoints of its edges from eᵢ to −eⱼ.
// The octahedron's 3D dual would be a cube: sectioning does not commute
// with polarity.
func TestCell16CornerFirstSection(t *testing.T) {
	angles := [6]float64{0, 0, 0, math.Pi / 4, math.Asin(1 / math.Sqrt(3)), math.Pi / 6}
	_, ss := section16Result(t, angles, 0, 1, 0)
	p, d := ss[0], ss[1]
	if p.Dimension != 3 || len(p.Points) != 6 || len(p.Edges) != 12 || len(p.Facets) != 8 {
		t.Fatalf("tesseract %d/%d/%d", len(p.Points), len(p.Edges), len(p.Facets))
	}
	if d.Dimension != 3 || len(d.Points) != 12 || len(d.Edges) != 24 || len(d.Facets) != 14 {
		t.Fatalf("16-cell %d/%d/%d", len(d.Points), len(d.Edges), len(d.Facets))
	}
	tesseract, cross := descending(declaredTesseract()), descending(declaredCross())
	for i, o := range p.Origins {
		v := tesseract[o[0]]
		if o[0] != o[1] || v[0]+v[1]+v[2]+v[3] != 0 {
			t.Fatalf("octahedron vertex %d from %v", i, o)
		}
	}
	for i, o := range d.Origins {
		a, b := cross[o[0]], cross[o[1]]
		if o[0] == o[1] || a[0]+a[1]+a[2]+a[3]+b[0]+b[1]+b[2]+b[3] != 0 {
			t.Fatalf("cuboctahedron vertex %d from %v", i, o)
		}
		// The midpoint of its source edge, |x| = 1/√2.
		near(t, math.Sqrt(dot(d.Points[i], d.Points[i])), 1/math.Sqrt2)
	}
	sides := map[int]int{}
	for _, f := range d.Facets {
		sides[len(f.Vertices)]++
	}
	if sides[3] != 8 || sides[4] != 6 {
		t.Fatal("not a cuboctahedron", sides)
	}
}
