package physical

import (
	"cmp"
	"math"
	"slices"
	"sort"
)

// Mesh is indexed triangles: V holds x, y, z per vertex in millimeters,
// T three vertex indices per triangle, counterclockwise seen from outside.
type Mesh struct {
	V []float64
	T []int32
}

// Report is what Check finds. It knows nothing of how the mesh was made.
//
//   - Closed: every edge has exactly two triangles (Boundary counts edges
//     with one, Nonmanifold edges with more or with two in one direction).
//   - Oriented: every directed edge's reverse is in the mesh once, and
//     every component encloses positive volume.
//   - NonmanifoldVertices: vertices whose triangles form more than one fan.
//   - Degenerate: triangles with a repeated vertex or area under 10⁻¹²
//     mm².
//   - Components: pieces joined through edges; Nested counts those inside
//     another.
//   - SelfIntersections: triangle pairs whose interiors cross, or coplanar
//     triangles facing the same way that overlap. Touching: pairs that
//     meet where they share no vertex, as faces pressed together or a
//     vertex on another triangle.
//   - Unresolved: a ceiling stopped a check before it finished.
//   - Up: the area of upward horizontal triangles at each height.
type Report struct {
	Closed              bool                `json:"closed"`
	Oriented            bool                `json:"oriented"`
	Boundary            int                 `json:"boundary"`
	Nonmanifold         int                 `json:"nonmanifold"`
	NonmanifoldVertices int                 `json:"nonmanifoldVertices"`
	Degenerate          int                 `json:"degenerate"`
	Components          int                 `json:"components"`
	Nested              int                 `json:"nested"`
	Volume              float64             `json:"volume"`
	Area                float64             `json:"area"`
	Min                 [3]float64          `json:"min"`
	Max                 [3]float64          `json:"max"`
	Up                  map[float64]float64 `json:"-"`
	SelfIntersections   int                 `json:"selfIntersections"`
	Touching            int                 `json:"touching"`
	PairTests           int                 `json:"pairTests"`
	Unresolved          bool                `json:"unresolved"`
}

// Valid is a closed, outward, manifold solid with no crossing, touching
// or nested pieces, every check having finished.
func (r Report) Valid() bool {
	return r.Closed && r.Oriented && r.Nonmanifold == 0 && r.NonmanifoldVertices == 0 && r.Degenerate == 0 &&
		r.SelfIntersections == 0 && r.Touching == 0 && r.Nested == 0 && !r.Unresolved && r.Volume > 0
}

type vec3 [3]float64

func (a vec3) sub(b vec3) vec3 { return vec3{a[0] - b[0], a[1] - b[1], a[2] - b[2]} }
func (a vec3) dot(b vec3) float64 {
	return float64(a[0]*b[0]) + float64(a[1]*b[1]) + float64(a[2]*b[2])
}
func (a vec3) cross(b vec3) vec3 {
	return vec3{float64(a[1]*b[2]) - float64(a[2]*b[1]), float64(a[2]*b[0]) - float64(a[0]*b[2]), float64(a[0]*b[1]) - float64(a[1]*b[0])}
}
func (a vec3) norm() float64 { return math.Sqrt(a.dot(a)) }

func (m *Mesh) vertex(i int32) vec3 { return vec3{m.V[3*i], m.V[3*i+1], m.V[3*i+2]} }

// Check examines the mesh as a solid.
func Check(m *Mesh, lim Limits) Report {
	r := Report{Up: map[float64]float64{}}
	nt := len(m.T) / 3
	nv := len(m.V) / 3
	if nv > 0 {
		r.Min = [3]float64{math.Inf(1), math.Inf(1), math.Inf(1)}
		r.Max = [3]float64{math.Inf(-1), math.Inf(-1), math.Inf(-1)}
		for i := range nv {
			for k := range 3 {
				r.Min[k] = math.Min(r.Min[k], m.V[3*i+k])
				r.Max[k] = math.Max(r.Max[k], m.V[3*i+k])
			}
		}
	}
	// Edge incidence, from the directed edges sorted as integers: each
	// must occur once, with its reverse once. Sorted arrays rather than
	// maps keep the check's memory to a few words per triangle.
	key := func(a, b int32) uint64 { return uint64(uint32(a))<<32 | uint64(uint32(b)) }
	edges := make([]uint64, 0, 3*nt)
	for t := range nt {
		a, b, c := m.T[3*t], m.T[3*t+1], m.T[3*t+2]
		if a == b || b == c || a == c {
			r.Degenerate++
			continue
		}
		edges = append(edges, key(a, b), key(b, c), key(c, a))
	}
	slices.Sort(edges)
	occurs := func(k uint64) int {
		i, found := slices.BinarySearch(edges, k)
		if !found {
			return 0
		}
		n := 0
		for ; i < len(edges) && edges[i] == k; i++ {
			n++
		}
		return n
	}
	pairedOK := true
	for i := 0; i < len(edges); {
		j := i
		for j < len(edges) && edges[j] == edges[i] {
			j++
		}
		n := j - i
		a, b := int32(edges[i]>>32), int32(uint32(edges[i]))
		rev := occurs(key(b, a))
		switch {
		case n == 1 && rev == 1:
		case n == 1 && rev == 0:
			r.Boundary++
			pairedOK = false
		default:
			if a < b || rev == 0 {
				r.Nonmanifold++
			}
			pairedOK = false
		}
		i = j
	}
	r.Closed = r.Boundary == 0 && r.Nonmanifold == 0 && nt > 0
	// Components through shared edges: triangles listed by undirected
	// edge, neighbors in the sorted list joined.
	parent := make([]int32, nt)
	for i := range parent {
		parent[i] = int32(i)
	}
	var find func(int32) int32
	find = func(x int32) int32 {
		for parent[x] != x {
			parent[x] = parent[parent[x]]
			x = parent[x]
		}
		return x
	}
	type side struct {
		k uint64
		t int32
	}
	sides := make([]side, 0, 3*nt)
	for t := range nt {
		for k := range 3 {
			a, b := m.T[3*t+k], m.T[3*t+(k+1)%3]
			if a > b {
				a, b = b, a
			}
			sides = append(sides, side{key(a, b), int32(t)})
		}
	}
	slices.SortFunc(sides, func(x, y side) int { return cmp.Compare(x.k, y.k) })
	for i := 1; i < len(sides); i++ {
		if sides[i].k == sides[i-1].k {
			if ra, rb := find(sides[i].t), find(sides[i-1].t); ra != rb {
				parent[ra] = rb
			}
		}
	}
	sides = nil
	comp := map[int32]int{}
	compOf := make([]int, nt)
	for t := range nt {
		root := find(int32(t))
		if _, ok := comp[root]; !ok {
			comp[root] = len(comp)
		}
		compOf[t] = comp[root]
	}
	r.Components = len(comp)
	// Volume, area and upward faces, per component.
	vols := make([]float64, r.Components)
	for t := range nt {
		a, b, c := m.vertex(m.T[3*t]), m.vertex(m.T[3*t+1]), m.vertex(m.T[3*t+2])
		n := b.sub(a).cross(c.sub(a))
		area := n.norm() / 2
		if area < 1e-12 && m.T[3*t] != m.T[3*t+1] && m.T[3*t+1] != m.T[3*t+2] && m.T[3*t] != m.T[3*t+2] {
			r.Degenerate++
		}
		r.Area += area
		v := a.dot(b.cross(c)) / 6
		vols[compOf[t]] += v
		r.Volume += v
		if a[2] == b[2] && b[2] == c[2] && n[2] > 0 {
			r.Up[a[2]] += area
		}
	}
	r.Oriented = pairedOK && nt > 0
	for _, v := range vols {
		if !(v > 0) {
			r.Oriented = false
		}
	}
	r.NonmanifoldVertices = fans(m)
	r.Nested = nested(m, compOf, r.Components)
	r.SelfIntersections, r.Touching, r.PairTests, r.Unresolved = intersections(m, lim)
	return r
}

// fans counts vertices whose triangles do not form a single fan: around
// a manifold vertex, each triangle's outgoing edge from it is another's
// incoming one, in one cycle. The corners are sorted by vertex, then by
// the corner's next vertex, so each fan is walked by binary search.
func fans(m *Mesh) int {
	nt := len(m.T) / 3
	type corner struct{ v, from, to int32 }
	cs := make([]corner, 0, 3*nt)
	for t := range nt {
		for k := range 3 {
			cs = append(cs, corner{m.T[3*t+k], m.T[3*t+(k+1)%3], m.T[3*t+(k+2)%3]})
		}
	}
	slices.SortFunc(cs, func(x, y corner) int {
		if c := cmp.Compare(x.v, y.v); c != 0 {
			return c
		}
		if c := cmp.Compare(x.from, y.from); c != 0 {
			return c
		}
		return cmp.Compare(x.to, y.to)
	})
	bad := 0
	for i := 0; i < len(cs); {
		j := i
		for j < len(cs) && cs[j].v == cs[i].v {
			j++
		}
		fan := cs[i:j]
		n := 0
		for x := fan[0].from; ; {
			k, found := slices.BinarySearchFunc(fan, x, func(c corner, from int32) int { return cmp.Compare(c.from, from) })
			n++
			if !found || n > len(fan) {
				break
			}
			if k+1 < len(fan) && fan[k+1].from == x {
				n = -1 // two corners leave by one edge
				break
			}
			x = fan[k].to
			if x == fan[0].from {
				break
			}
		}
		if n != len(fan) {
			bad++
		}
		i = j
	}
	return bad
}

// nested counts components with a vertex inside another component's
// closed surface, by crossings of a skew ray. Above 64 components it
// checks none and reports every one beyond the first as nested, for the
// caller to refuse.
func nested(m *Mesh, compOf []int, n int) int {
	if n <= 1 {
		return 0
	}
	if n > 64 {
		return n - 1
	}
	first := make([]int32, n)
	for i := range first {
		first[i] = -1
	}
	for t, c := range compOf {
		if first[c] < 0 {
			first[c] = m.T[3*t]
		}
	}
	dir := vec3{1, math.Sqrt2 * 1e-3, math.Sqrt(3) * 1e-3}
	count := 0
	for c := range n {
		p := m.vertex(first[c])
		for d := range n {
			if d == c {
				continue
			}
			hits := 0
			for t, o := range compOf {
				if o != d {
					continue
				}
				if rayHits(p, dir, m.vertex(m.T[3*t]), m.vertex(m.T[3*t+1]), m.vertex(m.T[3*t+2])) {
					hits++
				}
			}
			if hits%2 == 1 {
				count++
				break
			}
		}
	}
	return count
}

// rayHits is the Möller–Trumbore test of the ray p + s·d, s > 0.
func rayHits(p, d, a, b, c vec3) bool {
	e1, e2 := b.sub(a), c.sub(a)
	h := d.cross(e2)
	det := e1.dot(h)
	if math.Abs(det) < 1e-18 {
		return false
	}
	s := p.sub(a)
	u := s.dot(h) / det
	if u < 0 || u > 1 {
		return false
	}
	q := s.cross(e1)
	v := d.dot(q) / det
	if v < 0 || u+v > 1 {
		return false
	}
	return e2.dot(q)/det > 0
}

// orient is the signed volume (times six) of the tetrahedron a, b, c, d,
// zero when it is within a relative 10⁻¹² of its edges' scale.
func orient(a, b, c, d vec3) float64 {
	u, v, w := b.sub(a), c.sub(a), d.sub(a)
	o := u.cross(v).dot(w)
	// |o| ≤ 10⁻¹²|u||v||w|, squared: no square roots.
	if float64(o*o) <= 1e-24*float64(u.dot(u)*v.dot(v))*w.dot(w) {
		return 0
	}
	return o
}

// level reports whether the points all lie at one height: horizontal
// faces of a height field, which are coplanar exactly.
func level(ps ...vec3) bool {
	for _, p := range ps[1:] {
		if p[2] != ps[0][2] {
			return false
		}
	}
	return true
}

// beside reports whether the points lie strictly on one side of the
// plane through a, b, c.
func beside(a, b, c vec3, ps ...vec3) bool {
	first := sign(orient(a, b, c, ps[0]))
	if first == 0 {
		return false
	}
	for _, p := range ps[1:] {
		if sign(orient(a, b, c, p)) != first {
			return false
		}
	}
	return true
}

func sign(x float64) int {
	switch {
	case x > 0:
		return 1
	case x < 0:
		return -1
	}
	return 0
}

// drop projects a point onto the coordinate plane most nearly parallel
// to a triangle with normal n.
func drop(n, p vec3) complex128 {
	ax, ay, az := math.Abs(n[0]), math.Abs(n[1]), math.Abs(n[2])
	switch {
	case az >= ax && az >= ay:
		return complex(p[0], p[1])
	case ay >= ax:
		return complex(p[2], p[0])
	}
	return complex(p[1], p[2])
}

func orient2(a, b, c complex128) int { return sign(cross(b-a, c-a)) }

// segmentMeet classifies closed segments pq and ab: 2 crossing at a point
// interior to both, 1 meeting otherwise (an end on the other, or
// collinear overlap), 0 apart.
func segmentMeet(p, q, a, b complex128) int {
	d1, d2 := orient2(p, q, a), orient2(p, q, b)
	d3, d4 := orient2(a, b, p), orient2(a, b, q)
	if d1*d2 < 0 && d3*d4 < 0 {
		return 2
	}
	within := func(p, q, x complex128) bool {
		return math.Min(real(p), real(q)) <= real(x) && real(x) <= math.Max(real(p), real(q)) &&
			math.Min(imag(p), imag(q)) <= imag(x) && imag(x) <= math.Max(imag(p), imag(q))
	}
	if d1 == 0 && within(p, q, a) || d2 == 0 && within(p, q, b) || d3 == 0 && within(a, b, p) || d4 == 0 && within(a, b, q) {
		return 1
	}
	return 0
}

// inside2 classifies x against triangle a, b, c in the plane: 1 strictly
// inside, 0 on its boundary, −1 outside.
func inside2(a, b, c, x complex128) int {
	o := orient2(a, b, c)
	s1, s2, s3 := orient2(a, b, x)*o, orient2(b, c, x)*o, orient2(c, a, x)*o
	if s1 < 0 || s2 < 0 || s3 < 0 {
		return -1
	}
	if s1 == 0 || s2 == 0 || s3 == 0 {
		return 0
	}
	return 1
}

// contact classifies how segment p, q meets triangle a, b, c: 2 through
// its interior, 1 touching it, 0 not at all. Coplanar contact is reported
// as coplanar.
func contact(p, q, a, b, c vec3) (kind int, coplanar bool) {
	var sp, sq int
	if !level(p, q, a, b, c) {
		sp, sq = sign(orient(a, b, c, p)), sign(orient(a, b, c, q))
	}
	if sp*sq > 0 {
		return 0, false
	}
	n := b.sub(a).cross(c.sub(a))
	if sp == 0 && sq == 0 {
		A, B, C, P, Q := drop(n, a), drop(n, b), drop(n, c), drop(n, p), drop(n, q)
		ip, iq := inside2(A, B, C, P), inside2(A, B, C, Q)
		if ip > 0 || iq > 0 {
			return 2, true
		}
		touch := ip == 0 || iq == 0
		for _, e := range [][2]complex128{{A, B}, {B, C}, {C, A}} {
			switch segmentMeet(P, Q, e[0], e[1]) {
			case 2:
				return 2, true
			case 1:
				touch = true
			}
		}
		// A segment through the triangle's interior from one edge to
		// another crosses two edges' lines at points of both.
		if touch {
			mid := (P + Q) / 2
			if inside2(A, B, C, mid) > 0 {
				return 2, true
			}
			return 1, true
		}
		return 0, true
	}
	if sp == 0 || sq == 0 {
		x := p
		if sq == 0 {
			x = q
		}
		if inside2(drop(n, a), drop(n, b), drop(n, c), drop(n, x)) >= 0 {
			return 1, false
		}
		return 0, false
	}
	s1, s2, s3 := sign(orient(p, q, a, b)), sign(orient(p, q, b, c)), sign(orient(p, q, c, a))
	if s1 == s2 && s2 == s3 && s1 != 0 {
		return 2, false
	}
	if (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0) {
		return 1, false
	}
	return 0, false
}

// pair classifies two triangles: 2 crossing or overlapping, 1 touching
// where they share no vertex, 0 apart.
func pair(m *Mesh, s, t int) int {
	ts, tt := m.T[3*s:3*s+3], m.T[3*t:3*t+3]
	// Fixed arrays: a pair test allocates nothing.
	var shared [3]int32
	n := 0
	for _, a := range ts {
		for _, b := range tt {
			if a == b {
				shared[n] = a
				n++
			}
		}
	}
	vs := [3]vec3{m.vertex(ts[0]), m.vertex(ts[1]), m.vertex(ts[2])}
	vt := [3]vec3{m.vertex(tt[0]), m.vertex(tt[1]), m.vertex(tt[2])}
	ns := vs[1].sub(vs[0]).cross(vs[2].sub(vs[0]))
	nt := vt[1].sub(vt[0]).cross(vt[2].sub(vt[0]))
	switch n {
	case 3:
		return 2
	case 2:
		// Folded: coplanar, with the third vertices on one side.
		var os, ot vec3
		for k := range 3 {
			if ts[k] != shared[0] && ts[k] != shared[1] {
				os = vs[k]
			}
			if tt[k] != shared[0] && tt[k] != shared[1] {
				ot = vt[k]
			}
		}
		if orient(vs[0], vs[1], vs[2], ot) != 0 {
			return 0
		}
		a, b := m.vertex(shared[0]), m.vertex(shared[1])
		if orient2(drop(ns, a), drop(ns, b), drop(ns, os)) == orient2(drop(ns, a), drop(ns, b), drop(ns, ot)) {
			return 2
		}
		return 0
	case 1:
		// Apart unless the other triangle's far edge reaches this one's
		// plane: one wholly beside the other's plane meets it only at the
		// shared vertex.
		var fs, ft [2]vec3
		i, j := 0, 0
		for k := range 3 {
			if ts[k] != shared[0] {
				fs[i] = vs[k]
				i++
			}
			if tt[k] != shared[0] {
				ft[j] = vt[k]
				j++
			}
		}
		if beside(vs[0], vs[1], vs[2], ft[:]...) || beside(vt[0], vt[1], vt[2], fs[:]...) {
			return 0
		}
		worst := 0
		opposite := func(ts []int32, v [3]vec3, w [3]vec3) {
			for k := range 3 {
				if ts[k] == shared[0] {
					kind, coplanar := contact(v[(k+1)%3], v[(k+2)%3], w[0], w[1], w[2])
					if coplanar && kind == 2 && ns.dot(nt) < 0 {
						kind = 1
					}
					worst = max(worst, kind)
				}
			}
		}
		opposite(ts, vs, vt)
		opposite(tt, vt, vs)
		return worst
	}
	// Apart when either lies wholly beside the other's plane.
	if beside(vs[0], vs[1], vs[2], vt[:]...) || beside(vt[0], vt[1], vt[2], vs[:]...) {
		return 0
	}
	worst := 0
	for k := range 3 {
		for _, e := range [][2]vec3{{vs[k], vs[(k+1)%3]}} {
			kind, coplanar := contact(e[0], e[1], vt[0], vt[1], vt[2])
			if coplanar && kind == 2 && ns.dot(nt) < 0 {
				kind = 1
			}
			worst = max(worst, kind)
		}
		for _, e := range [][2]vec3{{vt[k], vt[(k+1)%3]}} {
			kind, coplanar := contact(e[0], e[1], vs[0], vs[1], vs[2])
			if coplanar && kind == 2 && ns.dot(nt) < 0 {
				kind = 1
			}
			worst = max(worst, kind)
		}
	}
	return worst
}

// intersections tests every pair of triangles whose boxes overlap, found
// through a bucket grid; each pair is tested once, in the first bucket
// both occupy. It stops at the pair ceiling and reports itself unresolved.
func intersections(m *Mesh, lim Limits) (crossing, touching, tests int, unresolved bool) {
	nt := len(m.T) / 3
	if nt == 0 {
		return
	}
	lo := make([]vec3, nt)
	hi := make([]vec3, nt)
	extent := make([]float64, nt)
	for t := range nt {
		a, b, c := m.vertex(m.T[3*t]), m.vertex(m.T[3*t+1]), m.vertex(m.T[3*t+2])
		for k := range 3 {
			lo[t][k] = math.Min(a[k], math.Min(b[k], c[k]))
			hi[t][k] = math.Max(a[k], math.Max(b[k], c[k]))
			extent[t] = math.Max(extent[t], hi[t][k]-lo[t][k])
		}
	}
	sorted := append([]float64(nil), extent...)
	sort.Float64s(sorted)
	cell := math.Max(2*sorted[len(sorted)/2], 1e-6)
	key := func(p vec3) [3]int64 {
		return [3]int64{int64(math.Floor(p[0] / cell)), int64(math.Floor(p[1] / cell)), int64(math.Floor(p[2] / cell))}
	}
	type entry struct {
		k [3]int64
		t int32
	}
	var entries []entry
	// Triangles whose boxes span more than 4,096 cells, as across a
	// plaque's plain regions, stay out of the buckets: each is tested
	// below against every triangle its box meets.
	var long []int32
	isLong := make([]bool, nt)
	for t := range nt {
		a, b := key(lo[t]), key(hi[t])
		cells := (b[0] - a[0] + 1) * (b[1] - a[1] + 1) * (b[2] - a[2] + 1)
		if cells > 4096 {
			long = append(long, int32(t))
			isLong[t] = true
			continue
		}
		if len(entries) > 8*lim.Triangles {
			return crossing, touching, tests, true
		}
		for x := a[0]; x <= b[0]; x++ {
			for y := a[1]; y <= b[1]; y++ {
				for z := a[2]; z <= b[2]; z++ {
					entries = append(entries, entry{[3]int64{x, y, z}, int32(t)})
				}
			}
		}
	}
	slices.SortFunc(entries, func(a, b entry) int {
		if c := cmp.Compare(a.k[0], b.k[0]); c != 0 {
			return c
		}
		if c := cmp.Compare(a.k[1], b.k[1]); c != 0 {
			return c
		}
		if c := cmp.Compare(a.k[2], b.k[2]); c != 0 {
			return c
		}
		return cmp.Compare(a.t, b.t)
	})
	for i := 0; i < len(entries); {
		j := i
		for j < len(entries) && entries[j].k == entries[i].k {
			j++
		}
		for x := i; x < j; x++ {
			for y := x + 1; y < j; y++ {
				s, t := entries[x].t, entries[y].t
				overlap := true
				var first [3]float64
				for k := range 3 {
					if lo[s][k] > hi[t][k] || lo[t][k] > hi[s][k] {
						overlap = false
					}
					first[k] = lo[s][k]
					if lo[t][k] > first[k] {
						first[k] = lo[t][k]
					}
				}
				if !overlap || key(vec3(first)) != entries[i].k {
					continue
				}
				tests++
				if tests > lim.PairTests {
					return crossing, touching, tests, true
				}
				switch pair(m, int(s), int(t)) {
				case 2:
					crossing++
				case 1:
					touching++
				}
			}
		}
		i = j
	}
	// Each long triangle against every triangle its box meets, a pair of
	// long ones once. Box checks are bounded with the pair tests.
	scanned := 0
	for _, s := range long {
		for t := range nt {
			if int32(t) == s || (isLong[t] && int32(t) < s) {
				continue
			}
			scanned++
			if scanned > 4*lim.PairTests {
				return crossing, touching, tests, true
			}
			overlap := true
			for k := range 3 {
				if lo[s][k] > hi[t][k] || lo[t][k] > hi[s][k] {
					overlap = false
				}
			}
			if !overlap {
				continue
			}
			tests++
			if tests > lim.PairTests {
				return crossing, touching, tests, true
			}
			switch pair(m, int(s), t) {
			case 2:
				crossing++
			case 1:
				touching++
			}
		}
	}
	return
}
