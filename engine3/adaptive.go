package engine3

import (
	"fmt"
	"math"
	"sort"
)

// Adaptive refinement bisects the grid's Kuhn tetrahedra where samples of
// F disagree with them. Each tetrahedron keeps its corners in the order of
// Maubach's bisection, with a tag k: it is split at the midpoint z of the
// edge from its first corner x0 to xk, into (x0, …, xk−1, z, xk+1, …) and
// (x1, …, xk, z, xk+1, …), both tagged k − 1, or 3 after 1. A cube's six
// tetrahedra, paths from its first corner to its last along the three
// axes, start with tag 3, and three generations split them into the Kuhn
// tetrahedra of the eight half cubes. Splitting every tetrahedron on an
// edge together keeps the mesh conforming (see split).

// ImplicitRefinement reports refinement: the levels asked for and the
// deepest reached, in octree levels of three generations each, the
// tetrahedra bisected, those still flagged but left unsplit, at the
// deepest level or when the budget ran out, and whether it did.
type ImplicitRefinement struct {
	Levels     int  `json:"levels"`
	Reached    int  `json:"reached"`
	Bisected   int  `json:"bisected"`
	Unresolved int  `json:"unresolved"`
	Exhausted  bool `json:"exhausted"`
}

// maxRefinedTetrahedra bounds the tetrahedra refinement holds, every
// generation counted: about 40 MB at most.
var maxRefinedTetrahedra = 100000

// point is a lattice point: coordinates in steps of a grid cell divided by
// the refiner's scale.
type point = [3]int32

type tetra struct {
	v    [4]point
	tag  int8
	gen  int8
	kids [2]int32
}

// refiner holds the tetrahedra of the cubes that have been refined, or
// that share an edge with one, as binary trees under the cubes' six roots.
type refiner struct {
	n      [3]int
	scale  int32
	tets   []tetra
	roots  map[int]int32
	around map[[2]point][]int32
	// born lists the tetrahedra made by splitting, in order.
	born []int32
}

// newRefiner divides each of the n grid cells into 2^(levels+1) lattice
// steps. After 3m generations a tetrahedron's corners are corners of a
// cube 2^(levels+1−m) steps wide, and the next two generations add its
// centre and face centres; so up to 3·levels generations every corner
// lies on a lattice of even steps, and the midpoint of every edge, which
// refinement samples, lies on the lattice.
func newRefiner(n [3]int, levels int) *refiner {
	return &refiner{n: n, scale: 1 << (levels + 1), roots: map[int]int32{}, around: map[[2]point][]int32{}}
}

func (r *refiner) cube(i, j, k int) int { return i + r.n[0]*(j+r.n[1]*k) }

func (r *refiner) leaf(t int32) bool { return r.tets[t].kids[0] < 0 }

func edgeOf(a, b point) [2]point {
	if less(b, a) {
		a, b = b, a
	}
	return [2]point{a, b}
}

// less orders points by z, then y, then x, as the grid numbers its points.
func less(a, b point) bool {
	if a[2] != b[2] {
		return a[2] < b[2]
	}
	if a[1] != b[1] {
		return a[1] < b[1]
	}
	return a[0] < b[0]
}

var tetEdges = [6][2]int{{0, 1}, {0, 2}, {0, 3}, {1, 2}, {1, 3}, {2, 3}}

func (r *refiner) add(x tetra) int32 {
	t := int32(len(r.tets))
	x.kids = [2]int32{-1, -1}
	r.tets = append(r.tets, x)
	for _, e := range tetEdges {
		key := edgeOf(x.v[e[0]], x.v[e[1]])
		r.around[key] = append(r.around[key], t)
	}
	return t
}

// root returns tetrahedron t of the six of a cube, adding the cube's six
// when it has none yet.
func (r *refiner) root(cube, t int) int32 {
	first, ok := r.roots[cube]
	if !ok {
		first = int32(len(r.tets))
		r.roots[cube] = first
		i, j, k := cube%r.n[0], cube/r.n[0]%r.n[1], cube/(r.n[0]*r.n[1])
		for _, tet := range tetrahedra {
			var x tetra
			for c, bits := range tet {
				x.v[c] = point{(int32(i) + int32(bits&1)) * r.scale, (int32(j) + int32(bits>>1&1)) * r.scale, (int32(k) + int32(bits>>2&1)) * r.scale}
			}
			x.tag = 3
			r.add(x)
		}
	}
	return first + int32(t)
}

func (r *refiner) refinementEdge(t int32) [2]point {
	x := &r.tets[t]
	return edgeOf(x.v[0], x.v[x.tag])
}

// bisect splits one leaf at its refinement edge.
func (r *refiner) bisect(t int32) {
	x := r.tets[t]
	for _, e := range tetEdges {
		key := edgeOf(x.v[e[0]], x.v[e[1]])
		list := r.around[key]
		for k, u := range list {
			if u == t {
				list = append(list[:k], list[k+1:]...)
				break
			}
		}
		if len(list) == 0 {
			delete(r.around, key)
		} else {
			r.around[key] = list
		}
	}
	k := x.tag
	a, b := x.v[0], x.v[k]
	z := point{(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2}
	tag := k - 1
	if tag == 0 {
		tag = 3
	}
	var one, two tetra
	one.v, two.v = x.v, x.v
	copy(two.v[:k], x.v[1:k+1])
	one.v[k], two.v[k] = z, z
	one.tag, two.tag = tag, tag
	one.gen, two.gen = x.gen+1, x.gen+1
	c1 := r.add(one)
	c2 := r.add(two)
	r.tets[t].kids = [2]int32{c1, c2}
	r.born = append(r.born, c1, c2)
}

// split bisects leaf t and, to keep the mesh conforming, every leaf on its
// refinement edge. A leaf on that edge whose own refinement edge differs
// is split first, recursively, until the edge is the refinement edge of
// every leaf on it; for the Kuhn tetrahedra this closure ends, and splits
// only leaves of earlier generations than t (Maubach 1995, Stevenson
// 2008). Cubes that share the edge while it is a grid edge are added
// first, since conforming leaves meet such cubes only along grid edges
// and faces.
func (r *refiner) split(t int32) error {
	return r.splitEdge(r.refinementEdge(t), 0)
}

func (r *refiner) splitEdge(e [2]point, depth int) error {
	if depth > 64 {
		return fmt.Errorf("refinement did not close")
	}
	r.touch(e)
	for {
		other := int32(-1)
		for _, u := range r.around[e] {
			if r.refinementEdge(u) != e {
				other = u
				break
			}
		}
		if other < 0 {
			break
		}
		if err := r.splitEdge(r.refinementEdge(other), depth+1); err != nil {
			return err
		}
	}
	for _, u := range append([]int32(nil), r.around[e]...) {
		r.bisect(u)
	}
	return nil
}

// touch adds the cubes containing a grid edge.
func (r *refiner) touch(e [2]point) {
	a, b := e[0], e[1]
	var lo [3][]int
	for c := range 3 {
		if a[c]%r.scale != 0 || b[c]%r.scale != 0 {
			return
		}
		i, d := int(a[c]/r.scale), b[c]-a[c]
		switch {
		case d == 0:
			lo[c] = []int{i - 1, i}
		case d == r.scale:
			lo[c] = []int{i}
		case d == -r.scale:
			lo[c] = []int{i - 1}
		default:
			return
		}
	}
	for _, k := range lo[2] {
		for _, j := range lo[1] {
			for _, i := range lo[0] {
				if i >= 0 && j >= 0 && k >= 0 && i < r.n[0] && j < r.n[1] && k < r.n[2] {
					r.root(r.cube(i, j, k), 0)
				}
			}
		}
	}
}

// leaves lists the leaves of the refined cubes, cube by cube in grid order
// and depth first from each of the six roots.
func (r *refiner) leaves() []int32 {
	var out []int32
	for c := range r.n[0] * r.n[1] * r.n[2] {
		first, ok := r.roots[c]
		if !ok {
			continue
		}
		for k := range int32(6) {
			out = r.walk(first+k, out)
		}
	}
	return out
}

func (r *refiner) walk(t int32, out []int32) []int32 {
	if r.leaf(t) {
		return append(out, t)
	}
	out = r.walk(r.tets[t].kids[0], out)
	return r.walk(r.tets[t].kids[1], out)
}

// unsampled marks a midpoint of a grid edge not yet evaluated; a value
// that is not a number is stored as math.NaN(), whose bits differ.
var unsampled = math.Float64frombits(0x7ff8_dead_beef_0001)

// adaptive meshes the level set on the grid's tetrahedra, bisecting those
// whose samples disagree with them.
type adaptive struct {
	*field
	r      *refiner
	maxGen int
	// half holds F − c at the midpoints of the seven grid edges leaving
	// each grid point toward larger coordinates, which are also the
	// centres of its faces and cube; fine holds F − c at other points.
	half      []float64
	fine      map[point]float64
	edges     map[[2]point]int32
	points    map[point]int32
	rejected  map[[2]point]Vec3
	exhausted bool
}

func newAdaptive(s *field, levels int) *adaptive {
	a := &adaptive{field: s, r: newRefiner(s.n, levels), maxGen: 3 * levels, half: make([]float64, 7*len(s.values)),
		fine: map[point]float64{}, edges: map[[2]point]int32{}, points: map[point]int32{}, rejected: map[[2]point]Vec3{}}
	for k := range a.half {
		a.half[k] = unsampled
	}
	return a
}

func (a *adaptive) at(p point) Vec3 {
	b, m := a.box, a.r.scale
	return Vec3{lerp(b.XMin, b.XMax, int(p[0]), a.n[0]*int(m)), lerp(b.YMin, b.YMax, int(p[1]), a.n[1]*int(m)), lerp(b.ZMin, b.ZMax, int(p[2]), a.n[2]*int(m))}
}

func (a *adaptive) sample(p point) float64 {
	g := a.f(a.at(p)) - a.c
	if !finite(g) {
		a.nonfinite++
		return math.NaN()
	}
	return g
}

// value is F − c at a lattice point, evaluated once.
func (a *adaptive) value(p point) float64 {
	m, h := a.r.scale, a.r.scale/2
	var lo [3]int
	bits := 0
	for c := range 3 {
		switch p[c] % m {
		case 0:
		case h:
			bits |= 1 << c
		default:
			g, ok := a.fine[p]
			if !ok {
				g = a.sample(p)
				a.fine[p] = g
			}
			return g
		}
		lo[c] = int(p[c] / m)
	}
	q := a.index(lo[0], lo[1], lo[2])
	if bits == 0 {
		return a.values[q]
	}
	g := &a.half[7*q+bits-1]
	if math.Float64bits(*g) == math.Float64bits(unsampled) {
		*g = a.sample(p)
	}
	return *g
}

func mid(p, q point) point { return point{(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2} }

// flagged reports whether a tetrahedron has an edge whose ends lie on one
// side of the level and whose midpoint lies on the other: the edge crosses
// the level set twice or more, unseen, as where a neck, a gap or a piece
// is thinner than the tetrahedron, or a grid face's diagonal joins corners
// the face's centre separates. Every tetrahedron is tested, however far
// from the surface the grid places it, since a piece the grid misses
// leaves no trace at its corners. A tetrahedron with a corner where F is
// not finite is not flagged, nor is an edge whose midpoint is.
func (a *adaptive) flagged(v [4]point) bool {
	var g [4]float64
	for c := range 4 {
		g[c] = a.value(v[c])
		if math.IsNaN(g[c]) {
			return false
		}
	}
	for _, e := range tetEdges {
		u, w := g[e[0]], g[e[1]]
		if (u >= 0) != (w >= 0) {
			continue
		}
		if m := a.value(mid(v[e[0]], v[e[1]])); !math.IsNaN(m) && (m >= 0) != (u >= 0) {
			return true
		}
	}
	return false
}

// kuhn returns the corners of a cube's tetrahedron t.
func (a *adaptive) kuhn(cube, t int) [4]point {
	i, j, k := cube%a.n[0], cube/a.n[0]%a.n[1], cube/(a.n[0]*a.n[1])
	m := a.r.scale
	var v [4]point
	for c, bits := range tetrahedra[t] {
		v[c] = point{(int32(i) + int32(bits&1)) * m, (int32(j) + int32(bits>>1&1)) * m, (int32(k) + int32(bits>>2&1)) * m}
	}
	return v
}

// defined reports whether F is finite at every corner of a cube.
func (a *adaptive) defined(cube int) bool {
	i, j, k := cube%a.n[0], cube/a.n[0]%a.n[1], cube/(a.n[0]*a.n[1])
	for c := range 8 {
		if math.IsNaN(a.values[a.index(i+c&1, j+c>>1&1, k+c>>2&1)]) {
			return false
		}
	}
	return true
}

// refineReserve bounds the tetrahedra one split and its closure can add.
const refineReserve = 1024

// refine bisects flagged tetrahedra generation by generation, testing the
// grid's tetrahedra first and then each bisection's children, until none
// is flagged, all flagged are at the deepest generation, or the budget of
// maxRefinedTetrahedra would be exceeded. It returns the flagged
// tetrahedra left unsplit.
func (a *adaptive) refine() (int, error) {
	cubes := a.n[0] * a.n[1] * a.n[2]
	type coarse struct{ cube, t int }
	var first []coarse
	for c := range cubes {
		if !a.defined(c) {
			continue
		}
		for t := range 6 {
			if a.flagged(a.kuhn(c, t)) {
				first = append(first, coarse{c, t})
			}
		}
	}
	unresolved := 0
	room := func() bool {
		if len(a.r.tets)+refineReserve > maxRefinedTetrahedra {
			a.exhausted = true
		}
		return !a.exhausted
	}
	for k, f := range first {
		if a.maxGen == 0 || !room() {
			unresolved += len(first) - k
			break
		}
		if t := a.r.root(f.cube, f.t); a.r.leaf(t) {
			if err := a.r.split(t); err != nil {
				return 0, err
			}
		}
	}
	for len(a.r.born) > 0 {
		born := a.r.born
		a.r.born = nil
		var flags []int32
		for _, t := range born {
			if a.r.leaf(t) && a.flagged(a.r.tets[t].v) {
				flags = append(flags, t)
			}
		}
		for k, t := range flags {
			if !a.r.leaf(t) {
				continue
			}
			if int(a.r.tets[t].gen) >= a.maxGen {
				unresolved++
				continue
			}
			if !room() {
				// Every flagged leaf left.
				for _, u := range flags[k:] {
					if a.r.leaf(u) {
						unresolved++
					}
				}
				break
			}
			if err := a.r.split(t); err != nil {
				return 0, err
			}
		}
		if a.exhausted {
			break
		}
	}
	return unresolved, nil
}

// vertex returns the mesh vertex where the edge from p to q crosses the
// level, as field.vertex does for a grid edge.
func (a *adaptive) vertex(p, q point) (int32, bool) {
	e := edgeOf(p, q)
	if v, ok := a.edges[e]; ok {
		return v, true
	}
	if _, ok := a.rejected[e]; ok {
		return 0, false
	}
	if len(a.edges)+len(a.points)+len(a.rejected) >= maxImplicitCrossings {
		a.overflowed = true
		return 0, false
	}
	ga, gb := a.value(e[0]), a.value(e[1])
	x0, x1 := a.at(e[0]), a.at(e[1])
	t, ok := a.root(x0, x1, ga, gb)
	x := x0.add(x1.sub(x0).mul(t))
	if !ok {
		a.rejected[e] = x
		return 0, false
	}
	v, found := int32(0), false
	switch t {
	case 0:
		x = x0
		v, found = a.points[e[0]]
	case 1:
		x = x1
		v, found = a.points[e[1]]
	}
	if !found {
		v = a.newVertex(x, (math.Abs(ga)+math.Abs(gb))/x1.sub(x0).norm())
		switch t {
		case 0:
			a.points[e[0]] = v
		case 1:
			a.points[e[1]] = v
		}
	}
	a.edges[e] = v
	return v, true
}

func (a *adaptive) march(v [4]point) {
	var g [4]float64
	for c := range 4 {
		g[c] = a.value(v[c])
		if math.IsNaN(g[c]) {
			return
		}
	}
	if (g[0] >= 0) == (g[1] >= 0) && (g[1] >= 0) == (g[2] >= 0) && (g[2] >= 0) == (g[3] >= 0) {
		return
	}
	var at [4]Vec3
	for c := range 4 {
		at[c] = a.at(v[c])
	}
	a.marchTet(g, at, func(u, w int) (int32, bool) { return a.vertex(v[u], v[w]) })
}

// mesh marches the cubes in grid order: a cube never refined as its six
// tetrahedra, like the uniform grid, and a refined one leaf by leaf.
func (a *adaptive) mesh(fail func() error) error {
	for c := range a.n[0] * a.n[1] * a.n[2] {
		first, refined := a.r.roots[c]
		if !refined && !a.defined(c) {
			continue
		}
		for t := range 6 {
			if refined {
				for _, l := range a.r.walk(first+int32(t), nil) {
					a.march(a.r.tets[l].v)
				}
			} else {
				a.march(a.kuhn(c, t))
			}
			if err := fail(); err != nil {
				return err
			}
		}
	}
	return nil
}

// marks lists the rejected edges' points in edge order, and their number.
func (a *adaptive) marks() ([]Vec3, int) {
	edges := make([][2]point, 0, len(a.rejected))
	for e := range a.rejected {
		edges = append(edges, e)
	}
	sort.Slice(edges, func(i, j int) bool {
		if edges[i][0] != edges[j][0] {
			return less(edges[i][0], edges[j][0])
		}
		return less(edges[i][1], edges[j][1])
	})
	out := []Vec3{}
	for _, e := range edges[:min(len(edges), maxImplicitMarks)] {
		out = append(out, a.rejected[e])
	}
	return out, len(edges)
}

// reached is the deepest refinement, in octree levels.
func (a *adaptive) reached() int {
	deepest := 0
	for _, x := range a.r.tets {
		deepest = max(deepest, int(x.gen))
	}
	return (deepest + 2) / 3
}
