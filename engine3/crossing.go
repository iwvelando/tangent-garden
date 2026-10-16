package engine3

import (
	"math"
)

// Crossings. Marching tetrahedra meshes the boundary of the region where
// F − c ≥ 0, which never meets itself. Where the level set does, along a
// curve where two sheets cross (near it F − c is a product g·h, four
// wedges of alternating sign around the curve) or at an isolated point
// where ∇F vanishes on the level (a cone's apex, two drops touching), each
// tetrahedron would instead join two opposite wedges, turning from one
// sheet to the other in a zigzag of slits.
//
// Grid tetrahedra whose corners' gradients, by differences of the grid's
// samples, point apart and across one another are candidates. A candidate
// is confirmed when one of its faces holds a node, a point inside the
// face where F restricted to the face has a saddle on the level, which is
// where a crossing curve passes through the face; or when it holds an
// apex. Confirmed tetrahedra, and every tetrahedron around an edge that
// crosses the level other than as marching assumes (as twice, where its
// ends lie on one side), are meshed as crossing tetrahedra: each face's
// crossings are joined into paths on the face, through its node where it
// has one, the arms opposite each other continuing one sheet; the four
// faces' paths are joined into loops, one for each piece of a sheet in
// the tetrahedron, and each loop is fanned. A loop through two nodes is
// split there into the two halves of its sheet, both fanned from the
// first node, so the edge between the nodes is shared by both halves of
// both sheets: four triangles. Without nodes, two or more loops around an
// apex are fanned to it. Every face is decided once, for both tetrahedra
// on it, so the mesh stays conforming.
//
// A crossing often lies in a grid plane, or meets a grid line, as where a
// symmetric surface crosses itself on its plane of symmetry in a symmetric
// box; there nodes lie on edges rather than inside faces. So crossing
// tetrahedra are decided on F at points moved by δ, 10⁻⁴ of the lattice's
// step in a fixed direction along no grid plane or line, which puts the
// crossing in general position: a simulation of simplicity. An edge that
// changes sign once both with δ and without uses the same vertex as the
// tetrahedra beside it, exactly on F; its other roots are moved back onto
// F where F changes sign near them (see snap), and otherwise, like nodes
// and apices, stay within |δ| of the level set.
// Every tetrahedron around a corner whose side of the level δ changes is
// meshed as a crossing, so tetrahedra beside one another always agree.

// maxCrossingTetrahedra bounds the tetrahedra meshed as crossings.
var maxCrossingTetrahedra = 50000

type tet = [4]point

// A crossing tetrahedron's points: root i along an edge from its first
// lattice point, a face's node, or a tetrahedron's apex.
const (
	onEdge = iota
	atNode
	atApex
)

type pid struct {
	kind int8
	i    int8
	v    [4]point
}

// roots are the crossings of an edge from its first lattice point, at
// fractions t along it. ok is false where the edge cannot be meshed (an
// end exactly on the level or not finite, or a discontinuity); unusual is
// set where it crosses other than as marching assumes, once where its
// ends lie on opposite sides and otherwise not at all.
type roots struct {
	ok      bool
	unusual bool
	t       []float64
	x       []Vec3
}

// face is a face's paths, each a list of points running from one edge
// crossing to another, through the node where the face has one. ok is
// false where the face cannot be meshed.
type face struct {
	ok    bool
	node  bool
	x     Vec3
	paths [][]pid
}

// plan is how a crossing tetrahedron is meshed: its triangles, the edges
// where sheets cross, and whether it holds an apex. ok is false where it
// cannot be meshed and is left out.
type plan struct {
	// merged are roots that become this tetrahedron's apex.
	merged    []pid
	ok        bool
	unusual   [][2]point
	triangles [][3]pid
	crossings [][2]pid
	apex      Vec3
	cone      bool
}

// crossings meshes the crossing tetrahedra of a grid or an adaptive mesh,
// through lattice points: grid points themselves (scale 1), or points of
// the refiner's lattice.
type crossings struct {
	s     *field
	n     [3]int
	scale int32
	// exact is F − c at a lattice point, as marching samples it; value
	// is F − c there moved by shift.
	exact  func(point) float64
	shift  Vec3
	values map[point]float64
	at     func(point) Vec3
	single func(p, q point) (int32, bool)
	// leaves lists a cube's tetrahedra in mesh order, and of those within
	// its Kuhn tetrahedron t.
	leaves func(cube int) []tet
	of     func(cube, t int) []tet

	edges map[[2]point]*roots
	faces map[[3]point]*face
	plans map[tet]*plan
	own   map[[2]point][]int32
	nodes map[[3]point]int32
	// merge sends a root to the tetrahedron whose apex it becomes.
	merge map[pid]tet
	// apexes holds each tetrahedron's apex vertex, and made the indices
	// of the triangles crossing tetrahedra made.
	apexes map[tet]int32
	made   []int

	unresolved int
	cones      int
	exhausted  bool
	pairs      []int32
}

func newCrossings(s *field, scale int32, exact func(point) float64, at func(point) Vec3, single func(p, q point) (int32, bool), leaves func(int) []tet, of func(int, int) []tet) *crossings {
	step := math.Min(s.h[0], math.Min(s.h[1], s.h[2])) / float64(scale)
	// 1/π, Euler's γ and ln 2: no grid plane or line, and no simple
	// surface through the origin (unlike (1, √2, √3), on the cone
	// x² + y² = z²), contains it.
	direction := Vec3{1 / math.Pi, 0.5772156649015329, math.Ln2}
	shift := direction.mul(1e-4 * step / direction.norm())
	return &crossings{s: s, n: s.n, scale: scale, exact: exact, shift: shift, values: map[point]float64{}, at: at, single: single, leaves: leaves, of: of,
		edges: map[[2]point]*roots{}, faces: map[[3]point]*face{}}
}

// f is F − c at p moved by the shift.
func (x *crossings) f(p Vec3) float64 { return x.s.f(p.add(x.shift)) - x.s.c }

// value is F − c at a lattice point moved by the shift, or not a number
// where F is not finite there or at the point itself.
func (x *crossings) value(p point) float64 {
	g, ok := x.values[p]
	if !ok {
		g = x.f(x.at(p))
		if !finite(g) || math.IsNaN(x.exact(p)) {
			g = math.NaN()
		}
		x.values[p] = g
	}
	return g
}

// flipped reports whether the shift moves a lattice point across the
// level, as marching decides sides: F − c ≥ 0 above.
func (x *crossings) flipped(p point) bool { return (x.value(p) >= 0) != (x.exact(p) >= 0) }

// kuhnTet is a cube's Kuhn tetrahedron t on a lattice of the given scale.
func kuhnTet(n [3]int, scale int32, cube, t int) tet {
	i, j, k := cube%n[0], cube/n[0]%n[1], cube/(n[0]*n[1])
	var v tet
	for c, bits := range tetrahedra[t] {
		v[c] = point{(int32(i) + int32(bits&1)) * scale, (int32(j) + int32(bits>>1&1)) * scale, (int32(k) + int32(bits>>2&1)) * scale}
	}
	return v
}

// sorted is a tetrahedron's key: its corners in lattice order.
func sorted(v tet) tet {
	for i := 1; i < 4; i++ {
		for j := i; j > 0 && less(v[j], v[j-1]); j-- {
			v[j], v[j-1] = v[j-1], v[j]
		}
	}
	return v
}

func faceKey(a, b, c point) [3]point {
	v := [3]point{a, b, c}
	for i := 1; i < 3; i++ {
		for j := i; j > 0 && less(v[j], v[j-1]); j-- {
			v[j], v[j-1] = v[j-1], v[j]
		}
	}
	return v
}

// slope is ∇F at a grid point by central differences of the grid's own
// samples, one-sided at the box, or false beside a point where F is not
// finite: a sign of where F turns, at no cost in evaluations.
func (x *crossings) slope(i, j, k int) (Vec3, bool) {
	s := x.s
	at := [3]int{i, j, k}
	var g [3]float64
	for c := range 3 {
		lo, hi := at, at
		lo[c], hi[c] = max(at[c]-1, 0), min(at[c]+1, s.n[c])
		a, b := s.values[s.index(lo[0], lo[1], lo[2])], s.values[s.index(hi[0], hi[1], hi[2])]
		if math.IsNaN(a) || math.IsNaN(b) {
			return Vec3{}, false
		}
		g[c] = (b - a) / (float64(hi[c]-lo[c]) * s.h[c])
	}
	return Vec3{g[0], g[1], g[2]}, true
}

// find decides which tetrahedra are meshed as crossings, before any is
// meshed, so that ordinary studies are meshed exactly as before. A grid
// tetrahedron whose corners change sign and whose corners' slopes point
// apart (two with cosine below −½) and across (two whose lines differ by
// more than 45°, as h∇g + g∇h does with the signs of the wedges around a
// crossing, but not where nested sheets only turn F back) is a candidate; its leaves that change sign are planned, and a
// leaf with a node or an apex seeds the crossings.
func (x *crossings) find() {
	var seeds []tet
	s := x.s
	for k := 0; k < s.n[2]; k++ {
		for j := 0; j < s.n[1]; j++ {
			for i := 0; i < s.n[0]; i++ {
				cube := i + s.n[0]*(j+s.n[1]*k)
				positive := 0
				for c := range 8 {
					if s.values[s.index(i+c&1, j+c>>1&1, k+c>>2&1)] >= 0 {
						positive++
					}
				}
				if positive == 0 || positive == 8 {
					continue
				}
				for t, path := range tetrahedra {
					var corners [4][3]int
					positive := 0
					usable := true
					for c, bits := range path {
						corners[c] = [3]int{i + bits&1, j + bits>>1&1, k + bits>>2&1}
						g := s.values[s.index(corners[c][0], corners[c][1], corners[c][2])]
						usable = usable && !math.IsNaN(g)
						if g >= 0 {
							positive++
						}
					}
					if !usable || positive == 0 || positive == 4 {
						continue
					}
					var d [4]Vec3
					for c, p := range corners {
						var ok bool
						if d[c], ok = x.slope(p[0], p[1], p[2]); !ok {
							usable = false
						}
					}
					if !usable {
						continue
					}
					// Apart, and not along one line, as between two nested
					// sheets where F only turns back.
					apart, across := false, false
					for _, e := range tetEdges {
						a, b := d[e[0]], d[e[1]]
						if a.dot(b) < -0.5*a.norm()*b.norm() {
							apart = true
						}
						if a.cross(b).norm() > math.Sqrt2/2*a.norm()*b.norm() {
							across = true
						}
					}
					if !apart || !across {
						continue
					}
					// The grid tetrahedron first, then, where it holds a
					// crossing, those of its leaves that do.
					if !x.meets(kuhnTet(s.n, x.scale, cube, t), &d) {
						continue
					}
					for _, v := range x.of(cube, t) {
						if x.meets(v, nil) {
							seeds = append(seeds, v)
						}
					}
				}
			}
		}
	}
	if len(seeds) == 0 {
		return
	}
	x.plans = map[tet]*plan{}
	queue := seeds
	for len(queue) > 0 {
		v := queue[0]
		queue = queue[1:]
		key := sorted(v)
		if _, ok := x.plans[key]; ok {
			continue
		}
		if len(x.plans) >= maxCrossingTetrahedra {
			x.plans, x.exhausted = nil, true
			x.unresolved = 0
			return
		}
		p := x.analyze(v)
		x.plans[key] = p
		for _, e := range p.unusual {
			queue = append(queue, x.around(e[:])...)
		}
		for _, c := range v {
			if x.flipped(c) {
				queue = append(queue, x.around([]point{c})...)
			}
		}
	}
	x.merge = map[pid]tet{}
	for key, p := range x.plans {
		if !p.ok {
			x.unresolved++
		}
		for _, id := range p.merged {
			if q, ok := x.merge[id]; !ok || less4(key, q) {
				x.merge[id] = key
			}
		}
	}
}

// meets reports whether a crossing passes through a tetrahedron: a node
// in one of its faces, sought from the face's centre, or an apex inside
// it, sought from its own, each within eight Newton steps. It looks no
// further, and samples no edge, so candidates far from any crossing cost
// little; a crossing it misses here is found from another tetrahedron on
// it. Given its corners'
// slopes, it seeks a node only in a face with two corners whose slopes
// point apart: a node's face surrounds it, so has corners in three of the
// four wedges around it, two of them opposite.
func (x *crossings) meets(v tet, slopes *[4]Vec3) bool {
	var g [4]float64
	for c := range 4 {
		if g[c] = x.value(v[c]); math.IsNaN(g[c]) || g[c] == 0 {
			return false
		}
	}
	corner := [4]Vec3{x.at(v[0]), x.at(v[1]), x.at(v[2]), x.at(v[3])}
	const slack = 1e-9
	for _, fc := range [4][3]int{{0, 1, 2}, {0, 1, 3}, {0, 2, 3}, {1, 2, 3}} {
		if slopes != nil {
			apart := false
			for _, e := range [3][2]int{{fc[0], fc[1]}, {fc[0], fc[2]}, {fc[1], fc[2]}} {
				a, b := slopes[e[0]], slopes[e[1]]
				if a.dot(b) < -0.5*a.norm()*b.norm() {
					apart = true
				}
			}
			if !apart {
				continue
			}
		}
		o := corner[fc[0]]
		dirs := []Vec3{corner[fc[1]].sub(o), corner[fc[2]].sub(o)}
		u, converged, saddle := x.critical(o, dirs, []float64{1.0 / 3, 1.0 / 3}, mean([]float64{g[fc[0]], g[fc[1]], g[fc[2]]}), 8)
		if converged && saddle && u[0] >= -slack && u[1] >= -slack && u[0]+u[1] <= 1+slack &&
			x.onLevel(o.add(dirs[0].mul(u[0])).add(dirs[1].mul(u[1])), []float64{g[fc[0]], g[fc[1]], g[fc[2]]}) {
			return true
		}
	}
	o := corner[0]
	dirs := []Vec3{corner[1].sub(o), corner[2].sub(o), corner[3].sub(o)}
	u, converged, saddle := x.critical(o, dirs, []float64{0.25, 0.25, 0.25}, mean(g[:]), 8)
	return converged && saddle && u[0] >= -slack && u[1] >= -slack && u[2] >= -slack && u[0]+u[1]+u[2] <= 1+slack &&
		x.onLevel(o.add(dirs[0].mul(u[0])).add(dirs[1].mul(u[1])).add(dirs[2].mul(u[2])), g[:])
}

// around lists the tetrahedra with all the given lattice points as
// corners, from the cubes containing them.
func (x *crossings) around(points []point) []tet {
	var cubes [3][]int
	m := x.scale
	for c := range 3 {
		lo, hi := points[0][c], points[0][c]
		for _, p := range points[1:] {
			lo, hi = min(lo, p[c]), max(hi, p[c])
		}
		i := int(lo / m)
		if lo%m == 0 && hi == lo {
			cubes[c] = []int{i - 1, i}
		} else {
			cubes[c] = []int{i}
		}
	}
	var out []tet
	for _, k := range cubes[2] {
		for _, j := range cubes[1] {
			for _, i := range cubes[0] {
				if i < 0 || j < 0 || k < 0 || i >= x.n[0] || j >= x.n[1] || k >= x.n[2] {
					continue
				}
				for _, v := range x.leaves(i + x.n[0]*(j+x.n[1]*k)) {
					all := true
					for _, p := range points {
						if p != v[0] && p != v[1] && p != v[2] && p != v[3] {
							all = false
						}
					}
					if all {
						out = append(out, v)
					}
				}
			}
		}
	}
	return out
}

// edgeSamples is the samples of F along a crossing tetrahedron's edge
// between its ends: near a crossing a sheet can meet an edge several
// times within a small share of it.
const edgeSamples = 256

// edge finds the crossings of the edge from a to b, in lattice order:
// every sign change between samples, solved on F, or where there is none,
// both roots of a dip found by golden sections toward the extremum.
func (x *crossings) edge(a, b point) *roots {
	e := edgeOf(a, b)
	if r, ok := x.edges[e]; ok {
		return r
	}
	r := &roots{}
	x.edges[e] = r
	ga, gb := x.value(e[0]), x.value(e[1])
	if math.IsNaN(ga) || math.IsNaN(gb) || ga == 0 || gb == 0 {
		return r
	}
	p, q := x.at(e[0]), x.at(e[1])
	along := func(t float64) Vec3 { return p.add(q.sub(p).mul(t)) }
	add := func(t0, t1, g0, g1 float64) bool {
		u, ok := x.s.root(along(t0).add(x.shift), along(t1).add(x.shift), g0, g1)
		if !ok {
			return false
		}
		t := t0 + (t1-t0)*u
		r.t = append(r.t, t)
		r.x = append(r.x, along(t))
		return true
	}
	prev, gprev := 0.0, ga
	for k := 1; k <= edgeSamples; k++ {
		t, g := float64(k)/edgeSamples, gb
		if k < edgeSamples {
			g = x.f(along(t))
		}
		if !finite(g) {
			return r
		}
		if (g >= 0) != (gprev >= 0) && !add(prev, t, gprev, g) {
			return r
		}
		prev, gprev = t, g
	}
	if len(r.t) == 0 {
		sign := 1.0
		if ga < 0 {
			sign = -1
		}
		g := func(t float64) float64 { return sign * x.f(along(t)) }
		best, at := math.Inf(1), 0.0
		const coarse = 8
		for k := 1; k < coarse; k++ {
			t := float64(k) / coarse
			if v := g(t); v < best {
				best, at = v, t
			}
		}
		lo, hi := at-1.0/coarse, at+1.0/coarse
		const ratio = 0.6180339887498949
		t1, t2 := hi-ratio*(hi-lo), lo+ratio*(hi-lo)
		g1, g2 := g(t1), g(t2)
		for best >= 0 && hi-lo > 1e-12 {
			if g1 < g2 {
				hi, t2, g2 = t2, t1, g1
				t1 = hi - ratio*(hi-lo)
				g1 = g(t1)
			} else {
				lo, t1, g1 = t1, t2, g2
				t2 = lo + ratio*(hi-lo)
				g2 = g(t2)
			}
			if g1 < best {
				best, at = g1, t1
			}
			if g2 < best {
				best, at = g2, t2
			}
		}
		if !finite(best) {
			return r
		}
		if best < 0 && (!add(0, at, ga, sign*best) || !add(at, 1, sign*best, gb)) {
			return r
		}
	}
	r.ok = true
	expected := 0
	if (ga >= 0) != (gb >= 0) {
		expected = 1
	}
	r.unusual = len(r.t) != expected
	return r
}

// critical runs Newton's method on ∇F restricted to the affine span of
// the given directions from o, from the coefficients u, with the gradient
// and Hessian by central differences of F (moved by the shift) a 10⁻⁴
// step wide in the coefficients: 9 evaluations a step in a face, 19 in a
// tetrahedron. It converges when a step is below 10⁻¹⁰, or below 10⁻⁷ and
// no longer shrinking fourfold, at the differences' rounding, within
// steps. Given a scale above zero, it gives up once a step is below 10⁻⁴
// with F − c still beyond 10⁻⁶ of that scale: a critical point off the
// level. It returns the critical point's coefficients, whether it
// converged, and whether the Hessian there is indefinite.
func (x *crossings) critical(o Vec3, dirs []Vec3, u []float64, scale float64, steps int) ([]float64, bool, bool) {
	n := len(dirs)
	const step = 1e-4
	at := func(u []float64, off ...[2]int) float64 {
		p := o
		for k := range n {
			c := u[k]
			for _, d := range off {
				if d[0] == k {
					c += float64(d[1]) * step
				}
			}
			p = p.add(dirs[k].mul(c))
		}
		return x.f(p)
	}
	u = append([]float64(nil), u...)
	g := make([]float64, n)
	h := make([][]float64, n)
	for k := range h {
		h[k] = make([]float64, n)
	}
	last := math.Inf(1)
	for range steps {
		f0 := at(u)
		for k := range n {
			plus, minus := at(u, [2]int{k, 1}), at(u, [2]int{k, -1})
			g[k] = (plus - minus) / (2 * step)
			h[k][k] = (plus - 2*f0 + minus) / (step * step)
			for j := k + 1; j < n; j++ {
				pp, pm := at(u, [2]int{k, 1}, [2]int{j, 1}), at(u, [2]int{k, 1}, [2]int{j, -1})
				mp, mm := at(u, [2]int{k, -1}, [2]int{j, 1}), at(u, [2]int{k, -1}, [2]int{j, -1})
				h[k][j] = (pp - pm - mp + mm) / (4 * step * step)
				h[j][k] = h[k][j]
			}
		}
		s, ok := solve(h, g)
		if !ok {
			return u, false, false
		}
		size := 0.0
		for k := range n {
			u[k] -= s[k]
			size = math.Max(size, math.Abs(s[k]))
		}
		// Far outside the face or tetrahedron, it finds nothing there.
		total := 0.0
		for k := range n {
			total += u[k]
			if !(u[k] > -1 && u[k] < 2) {
				return u, false, false
			}
		}
		if !(total < 2) {
			return u, false, false
		}
		if size < 1e-10 || size < 1e-7 && size > last/4 {
			return u, true, indefinite(h)
		}
		if scale > 0 && size < 1e-4 && math.Abs(f0) > 1e-6*scale {
			return u, false, false
		}
		last = size
	}
	return u, false, false
}

// solve solves h s = g for a symmetric 2 × 2 or 3 × 3 h by Cramer's rule.
func solve(h [][]float64, g []float64) ([]float64, bool) {
	det := func(m [][]float64) float64 {
		if len(m) == 2 {
			return m[0][0]*m[1][1] - m[0][1]*m[1][0]
		}
		return m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1]) - m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0]) + m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0])
	}
	d := det(h)
	if !(math.Abs(d) > 0) || !finite(d) {
		return nil, false
	}
	n := len(g)
	out := make([]float64, n)
	for c := range n {
		m := make([][]float64, n)
		for r := range n {
			m[r] = append([]float64(nil), h[r]...)
			m[r][c] = g[r]
		}
		out[c] = det(m) / d
	}
	return out, true
}

// indefinite reports whether a symmetric 2 × 2 or 3 × 3 matrix has
// eigenvalues of both signs, by the signs of its leading minors.
func indefinite(h [][]float64) bool {
	if len(h) == 2 {
		return h[0][0]*h[1][1]-h[0][1]*h[1][0] < 0
	}
	d1 := h[0][0]
	d2 := h[0][0]*h[1][1] - h[0][1]*h[1][0]
	d3 := h[0][0]*(h[1][1]*h[2][2]-h[1][2]*h[2][1]) - h[0][1]*(h[1][0]*h[2][2]-h[1][2]*h[2][0]) + h[0][2]*(h[1][0]*h[2][1]-h[1][1]*h[2][0])
	positive := d1 > 0 && d2 > 0 && d3 > 0
	negative := d1 < 0 && d2 > 0 && d3 < 0
	return !positive && !negative && d3 != 0
}

// mean is the mean magnitude of the values g.
func mean(g []float64) float64 {
	m := 0.0
	for _, v := range g {
		m += math.Abs(v)
	}
	return m / float64(len(g))
}

// onLevel reports whether F − c at p, moved by the shift, is within
// 10⁻¹¹ of the mean of the magnitudes g at the corners around it: well
// above rounding at a crossing, and well below F − c at a saddle that
// misses the level only because the shift moved it off a face, about
// 10⁻⁸ of that mean.
func (x *crossings) onLevel(p Vec3, g []float64) bool {
	v := x.f(p)
	return finite(v) && math.Abs(v) <= 1e-11*mean(g)
}

// face decides a face's paths, once for both tetrahedra on it.
func (x *crossings) face(a, b, c point) *face {
	key := faceKey(a, b, c)
	if f, ok := x.faces[key]; ok {
		return f
	}
	f := &face{}
	x.faces[key] = f
	v := key
	g := []float64{x.value(v[0]), x.value(v[1]), x.value(v[2])}
	corner := [3]Vec3{x.at(v[0]), x.at(v[1]), x.at(v[2])}
	// The crossings around the face, from v0 to v1 to v2 and back, each
	// with its coefficients (u, w) on v0 + u(v1 − v0) + w(v2 − v0), and
	// the sign of F − c along the boundary just after it.
	type mark struct {
		id   pid
		u, w float64
	}
	var marks []mark
	var after []bool
	coefficients := [3][2]float64{{0, 0}, {1, 0}, {0, 1}}
	for k := range 3 {
		p, q := v[k], v[(k+1)%3]
		r := x.edge(p, q)
		if !r.ok {
			return f
		}
		e := edgeOf(p, q)
		forward := e[0] == p
		sign := g[k] >= 0
		for j := range r.t {
			i := j
			if !forward {
				i = len(r.t) - 1 - j
			}
			t := r.t[i]
			if !forward {
				t = 1 - t
			}
			cu, cq := coefficients[k], coefficients[(k+1)%3]
			marks = append(marks, mark{pid{kind: onEdge, i: int8(i), v: [4]point{e[0], e[1]}}, cu[0] + t*(cq[0]-cu[0]), cu[1] + t*(cq[1]-cu[1])})
			sign = !sign
			after = append(after, sign)
		}
	}
	n := len(marks)
	switch {
	case n == 0:
		f.ok = true
		return f
	case n == 2:
		f.ok = true
		f.paths = [][]pid{{marks[0].id, marks[1].id}}
		return f
	case n > 8:
		return f
	}
	// The gradient's line at each crossing: along a sheet it keeps its
	// line, so paths pair crossings whose lines are nearest parallel.
	d := make([]Vec3, n)
	for k, m := range marks {
		r := x.edges[[2]point{m.id.v[0], m.id.v[1]}]
		d[k] = x.s.gradient(r.x[m.id.i].add(x.shift))
		d[k] = d[k].mul(1 / d[k].norm())
	}
	alike := func(i, j int) float64 { return math.Abs(d[i].dot(d[j])) }
	// best pairs the crossings listed, in order around the face, without
	// crossing paths, with the most alike ends.
	best := func(list []int) ([][2]int, float64) {
		var out [][2]int
		top := -1.0
		for _, pairs := range nonCrossing(len(list)) {
			score := 0.0
			for _, q := range pairs {
				score += alike(list[q[0]], list[q[1]])
			}
			if score > top {
				top = score
				out = out[:0]
				for _, q := range pairs {
					out = append(out, [2]int{list[q[0]], list[q[1]]})
				}
			}
		}
		return out, top
	}
	// Seek a node from the centre (where the chords between opposite
	// crossings cross, for four) and from each crossing.
	dirs := []Vec3{corner[1].sub(corner[0]), corner[2].sub(corner[0])}
	starts := [][]float64{{1.0 / 3, 1.0 / 3}}
	if n == 4 {
		d1u, d1w := marks[2].u-marks[0].u, marks[2].w-marks[0].w
		d2u, d2w := marks[3].u-marks[1].u, marks[3].w-marks[1].w
		ru, rw := marks[1].u-marks[0].u, marks[1].w-marks[0].w
		if den := d1u*d2w - d1w*d2u; den != 0 {
			s := (ru*d2w - rw*d2u) / den
			starts[0] = []float64{marks[0].u + s*d1u, marks[0].w + s*d1w}
		}
	}
	for _, m := range marks {
		starts = append(starts, []float64{m.u, m.w})
	}
	const slack = 1e-9
	var nodes []Vec3
	saddle, centre := false, corner[0].add(dirs[0].mul(starts[0][0])).add(dirs[1].mul(starts[0][1]))
	for k, start := range starts {
		u, converged, indefinite := x.critical(corner[0], dirs, start, 0, 20)
		if !converged || !indefinite || u[0] < -slack || u[1] < -slack || u[0]+u[1] > 1+slack {
			continue
		}
		at := corner[0].add(dirs[0].mul(u[0])).add(dirs[1].mul(u[1]))
		if !x.onLevel(at, g) {
			if k == 0 {
				saddle, centre = true, at
			}
			continue
		}
		known := false
		for _, y := range nodes {
			if y.sub(at).norm() <= 1e-6*dirs[0].norm() {
				known = true
			}
		}
		if !known {
			nodes = append(nodes, at)
		}
	}
	f.ok = true
	switch {
	case len(nodes) > 1:
		f.ok = false
	case len(nodes) == 1:
		// Four arms meet at the node, opposite arms on one sheet; the
		// other crossings pair within the sectors between the arms.
		f.node, f.x = true, nodes[0]
		node := pid{kind: atNode, v: [4]point{key[0], key[1], key[2]}}
		top := -1.0
		for i := 0; i < n; i++ {
			for j := i + 1; j < n; j += 2 {
				for k := j + 1; k < n; k += 2 {
					for l := k + 1; l < n; l += 2 {
						if (i+n-l)%2 == 0 {
							continue
						}
						score := alike(i, k) + alike(j, l)
						var paths [][]pid
						for _, sector := range [4][2]int{{i, j}, {j, k}, {k, l}, {l, i + n}} {
							var list []int
							for m := sector[0] + 1; m < sector[1]; m++ {
								list = append(list, m%n)
							}
							pairs, s := best(list)
							score += s
							for _, q := range pairs {
								paths = append(paths, []pid{marks[q[0]].id, marks[q[1]].id})
							}
						}
						if score > top {
							top = score
							f.paths = append([][]pid{{marks[i].id, node, marks[k].id}, {marks[j].id, node, marks[l].id}}, paths...)
						}
					}
				}
			}
		}
	case n == 4 && saddle:
		// A saddle of F − c off the level, as across a neck: the boundary
		// from the second crossing to the third has the sign after the
		// second, and where the saddle has that sign it joins that
		// boundary to the one from the fourth crossing to the first.
		if (x.f(centre) >= 0) == after[1] {
			f.paths = [][]pid{{marks[0].id, marks[1].id}, {marks[2].id, marks[3].id}}
		} else {
			f.paths = [][]pid{{marks[1].id, marks[2].id}, {marks[3].id, marks[0].id}}
		}
	default:
		pairs, _ := best([]int{0, 1, 2, 3, 4, 5, 6, 7}[:n])
		for _, q := range pairs {
			f.paths = append(f.paths, []pid{marks[q[0]].id, marks[q[1]].id})
		}
	}
	return f
}

// nonCrossing lists the ways to pair n points in order around a loop
// without crossing chords, each pair in increasing order.
func nonCrossing(n int) [][][2]int {
	var pairs func(lo, hi int) [][][2]int
	pairs = func(lo, hi int) [][][2]int {
		if lo > hi {
			return [][][2]int{nil}
		}
		var out [][][2]int
		for j := lo + 1; j <= hi; j += 2 {
			for _, inner := range pairs(lo+1, j-1) {
				for _, outer := range pairs(j+1, hi) {
					m := append([][2]int{{lo, j}}, inner...)
					out = append(out, append(m, outer...))
				}
			}
		}
		return out
	}
	return pairs(0, n-1)
}

// analyze plans a crossing tetrahedron.
func (x *crossings) analyze(v tet) *plan {
	p := &plan{}
	var g [4]float64
	for c := range 4 {
		g[c] = x.value(v[c])
		if math.IsNaN(g[c]) || g[c] == 0 {
			return p
		}
	}
	for _, e := range tetEdges {
		r := x.edge(v[e[0]], v[e[1]])
		if !r.ok {
			return p
		}
		if r.unusual {
			p.unusual = append(p.unusual, edgeOf(v[e[0]], v[e[1]]))
		}
	}
	var paths [][]pid
	nodes := 0
	for _, fc := range [4][3]int{{0, 1, 2}, {0, 1, 3}, {0, 2, 3}, {1, 2, 3}} {
		f := x.face(v[fc[0]], v[fc[1]], v[fc[2]])
		if !f.ok {
			return p
		}
		if f.node {
			nodes++
		}
		paths = append(paths, f.paths...)
	}
	// Join the paths into loops at their ends, each an edge crossing on
	// exactly two faces of the tetrahedron.
	ends := map[pid][]int{}
	for k, path := range paths {
		ends[path[0]] = append(ends[path[0]], k)
		ends[path[len(path)-1]] = append(ends[path[len(path)-1]], k)
	}
	for _, ks := range ends {
		if len(ks) != 2 {
			return p
		}
	}
	used := make([]bool, len(paths))
	var loops [][]pid
	for k := range paths {
		if used[k] {
			continue
		}
		var loop []pid
		first := paths[k][0]
		at, end := k, first
		for {
			used[at] = true
			path := paths[at]
			if path[0] != end {
				rev := make([]pid, len(path))
				for i := range path {
					rev[i] = path[len(path)-1-i]
				}
				path = rev
			}
			loop = append(loop, path[:len(path)-1]...)
			end = path[len(path)-1]
			if end == first {
				break
			}
			ks := ends[end]
			next := ks[0]
			if next == at {
				next = ks[1]
			}
			if used[next] {
				return p
			}
			at = next
		}
		loops = append(loops, loop)
	}
	if nodes == 0 && len(loops) >= 2 {
		// An apex: a critical point of F on the level inside the
		// tetrahedron, where its nappes meet.
		corner := [4]Vec3{x.at(v[0]), x.at(v[1]), x.at(v[2]), x.at(v[3])}
		dirs := []Vec3{corner[1].sub(corner[0]), corner[2].sub(corner[0]), corner[3].sub(corner[0])}
		u, converged, saddle := x.critical(corner[0], dirs, []float64{0.25, 0.25, 0.25}, mean(g[:]), 20)
		const slack = 1e-9
		if converged && saddle && u[0] >= -slack && u[1] >= -slack && u[2] >= -slack && u[0]+u[1]+u[2] <= 1+slack {
			at := corner[0].add(dirs[0].mul(u[0])).add(dirs[1].mul(u[1])).add(dirs[2].mul(u[2]))
			if x.onLevel(at, g[:]) {
				p.cone, p.apex = true, at
			}
		}
	}
	apex := pid{kind: atApex, v: sorted(v)}
	fan := func(seq []pid) {
		for k := 1; k+1 < len(seq); k++ {
			p.triangles = append(p.triangles, [3]pid{seq[0], seq[k], seq[k+1]})
		}
	}
	for _, loop := range loops {
		var at []int
		for k, id := range loop {
			if id.kind == atNode {
				at = append(at, k)
			}
		}
		if len(at) > 2 {
			return p
		}
		if len(at) > 0 {
			loop = append(append([]pid(nil), loop[at[0]:]...), loop[:at[0]]...)
		}
		switch {
		case len(at) == 2 && loop[0] != loop[at[1]-at[0]]:
			// A sheet through two nodes: its halves on either side of the
			// edge between them, n1 … n2 and n2 … n1, each closed by that
			// edge and fanned from n1.
			split := at[1] - at[0]
			n1, n2 := loop[0], loop[split]
			first := loop[:split+1]
			second := append([]pid{n1}, loop[split:]...)
			if len(first) < 3 || len(second) < 3 {
				return p
			}
			fan(first)
			fan(second)
			pair := [2]pid{n1, n2}
			if len(p.crossings) == 0 || p.crossings[0] != pair && p.crossings[0] != [2]pid{n2, n1} {
				p.crossings = append(p.crossings, pair)
			}
		case len(at) == 0 && p.cone:
			// A nappe that only grazes an edge beside its apex closes in
			// a cap whose two arcs are both drawn as the chord between
			// the edge's roots (see fold). Its root nearer the apex
			// becomes the apex, so the nappe meets the apex through the
			// tetrahedra beside.
			if len(loop) < 3 {
				near, d := loop[0], math.Inf(1)
				for _, id := range loop {
					r := x.edges[[2]point{id.v[0], id.v[1]}]
					if l := r.x[id.i].sub(p.apex).norm(); l < d {
						near, d = id, l
					}
				}
				p.merged = append(p.merged, near)
				continue
			}
			for k := range loop {
				p.triangles = append(p.triangles, [3]pid{apex, loop[k], loop[(k+1)%len(loop)]})
			}
		default:
			// No node, or a loop through one node (once, or twice where
			// sheets join, as at a pinch point): fanned from its start.
			fan(loop)
		}
	}
	if len(p.crossings) > 1 {
		return p
	}
	p.ok = true
	return p
}

// snap moves an edge's root i, found with the shift, onto F itself where
// F − c changes sign between halfway to the edge's neighbouring roots on
// either side (or its ends), as it does wherever the shift only moved a
// crossing rather than made it. Elsewhere, as where a sheet only touches
// the edge without the shift, the root stays within the shift of F.
func (x *crossings) snap(e [2]point, r *roots, i int) Vec3 {
	p, q := x.at(e[0]), x.at(e[1])
	lo, hi := 0.0, 1.0
	if i > 0 {
		lo = (r.t[i-1] + r.t[i]) / 2
	}
	if i+1 < len(r.t) {
		hi = (r.t[i] + r.t[i+1]) / 2
	}
	a, b := p.add(q.sub(p).mul(lo)), p.add(q.sub(p).mul(hi))
	ga, gb := x.s.f(a)-x.s.c, x.s.f(b)-x.s.c
	// A bracket ending exactly on the level would put the root at a
	// lattice point, as at an apex on one, beside the apex's own vertex.
	if !finite(ga) || !finite(gb) || ga == 0 || gb == 0 || (ga >= 0) == (gb >= 0) {
		return r.x[i]
	}
	t, ok := x.s.root(a, b, ga, gb)
	if !ok {
		return r.x[i]
	}
	return a.add(b.sub(a).mul(t))
}

// less4 orders tetrahedra by their corners in lattice order.
func less4(a, b tet) bool {
	for k := range 4 {
		if a[k] != b[k] {
			return less(a[k], b[k])
		}
	}
	return false
}

// meet counts the apices where two or more nappes meet in the finished
// mesh: those whose triangles fall into two or more fans, joined only
// through edges at the apex.
func (x *crossings) meet() {
	if x == nil || len(x.apexes) == 0 {
		return
	}
	s := x.s
	around := map[int32][]int{}
	for _, v := range x.apexes {
		around[v] = nil
	}
	for t := 0; t < len(s.triangles)/3; t++ {
		for _, v := range s.triangles[3*t : 3*t+3] {
			if _, ok := around[v]; ok {
				around[v] = append(around[v], t)
			}
		}
	}
	for v, ts := range around {
		// Fans: triangles at the apex sharing another vertex.
		parent := make([]int, len(ts))
		for k := range parent {
			parent[k] = k
		}
		var find func(int) int
		find = func(k int) int {
			for parent[k] != k {
				k = parent[k]
			}
			return k
		}
		first := map[int32]int{}
		for k, t := range ts {
			for _, w := range s.triangles[3*t : 3*t+3] {
				if w == v {
					continue
				}
				if j, ok := first[w]; ok {
					parent[find(k)] = find(j)
				} else {
					first[w] = k
				}
			}
		}
		fans := 0
		for k := range parent {
			if find(k) == k {
				fans++
			}
		}
		if fans >= 2 {
			x.cones++
		}
	}
}

// fold removes the crossing tetrahedra's triangles that come in pairs on
// the same three vertices. Where a sheet grazes an edge in a cap smaller
// than the shift, as a cone's nappe beside an apex on a grid edge, its
// arcs on the edge's two faces are both drawn as the chord between the
// edge's roots, and the cap folds flat into such a pair, enclosing
// nothing; without it the sheet runs on along the chord.
func (x *crossings) fold() {
	if x == nil || len(x.made) == 0 {
		return
	}
	s := x.s
	key := func(t int) [3]int32 {
		v := [3]int32{s.triangles[3*t], s.triangles[3*t+1], s.triangles[3*t+2]}
		if v[0] > v[1] {
			v[0], v[1] = v[1], v[0]
		}
		if v[1] > v[2] {
			v[1], v[2] = v[2], v[1]
		}
		if v[0] > v[1] {
			v[0], v[1] = v[1], v[0]
		}
		return v
	}
	seen := map[[3]int32]int{}
	drop := map[int]bool{}
	for _, t := range x.made {
		k := key(t)
		if u, ok := seen[k]; ok {
			drop[u], drop[t] = true, true
			delete(seen, k)
		} else {
			seen[k] = t
		}
	}
	if len(drop) == 0 {
		return
	}
	kept := s.triangles[:0]
	for t := 0; t < len(s.triangles)/3; t++ {
		if !drop[t] {
			kept = append(kept, s.triangles[3*t:3*t+3]...)
		}
	}
	s.triangles = kept
}

// has reports whether a tetrahedron is meshed as a crossing.
func (x *crossings) has(v tet) bool {
	if x == nil || x.plans == nil {
		return false
	}
	_, ok := x.plans[sorted(v)]
	return ok
}

// singularVertex adds a vertex without a normal.
func (x *crossings) singularVertex(p Vec3) int32 {
	s := x.s
	v := int32(len(s.positions) / 3)
	s.positions = append(s.positions, p.X, p.Y, p.Z)
	s.normals = append(s.normals, 0, 0, 0)
	s.singular++
	return v
}

// emit meshes a crossing tetrahedron: its vertices, made in the order its
// triangles name them, and its triangles, each facing the sum of the
// normals at its corners that have one.
func (x *crossings) emit(v tet) {
	p := x.plans[sorted(v)]
	if !p.ok {
		return
	}
	if x.own == nil {
		x.own, x.nodes, x.apexes = map[[2]point][]int32{}, map[[3]point]int32{}, map[tet]int32{}
	}
	apexOf := func(key tet) int32 {
		n, ok := x.apexes[key]
		if !ok {
			n = x.singularVertex(x.plans[key].apex)
			x.apexes[key] = n
		}
		return n
	}
	vertex := func(id pid) int32 {
		if key, ok := x.merge[id]; ok && x.plans[key].ok {
			return apexOf(key)
		}
		switch id.kind {
		case atNode:
			key := [3]point{id.v[0], id.v[1], id.v[2]}
			n, ok := x.nodes[key]
			if !ok {
				n = x.singularVertex(x.faces[key].x)
				x.nodes[key] = n
			}
			return n
		case atApex:
			return apexOf(id.v)
		}
		e := [2]point{id.v[0], id.v[1]}
		r := x.edges[e]
		if len(r.t) == 1 && !r.unusual && !x.flipped(e[0]) && !x.flipped(e[1]) {
			if n, ok := x.single(e[0], e[1]); ok {
				return n
			}
		}
		own, ok := x.own[e]
		if !ok {
			ga, gb := x.value(e[0]), x.value(e[1])
			slope := (math.Abs(ga) + math.Abs(gb)) / x.at(e[1]).sub(x.at(e[0])).norm()
			for i := range r.t {
				own = append(own, x.s.newVertex(x.snap(e, r, i), slope))
			}
			x.own[e] = own
		}
		return own[id.i]
	}
	s := x.s
	for _, t := range p.triangles {
		a, b, c := vertex(t[0]), vertex(t[1]), vertex(t[2])
		if a == b || b == c || a == c {
			continue
		}
		pa, pb, pc := s.at(a), s.at(b), s.at(c)
		var along Vec3
		for _, w := range [3]int32{a, b, c} {
			along = along.add(Vec3{s.normals[3*w], s.normals[3*w+1], s.normals[3*w+2]})
		}
		if pb.sub(pa).cross(pc.sub(pa)).dot(along) < 0 {
			b, c = c, b
		}
		x.made = append(x.made, len(s.triangles)/3)
		s.triangles = append(s.triangles, a, b, c)
	}
	for _, e := range p.crossings {
		x.pairs = append(x.pairs, vertex(e[0]), vertex(e[1]))
	}
}
