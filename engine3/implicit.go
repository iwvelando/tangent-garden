package engine3

import (
	"fmt"
	"math"
	"sort"
	"tangentgarden/engine"
	"tangentgarden/engine/expr"
)

// Box is the region an implicit surface is sought in.
type Box struct {
	XMin float64 `json:"xMin"`
	XMax float64 `json:"xMax"`
	YMin float64 `json:"yMin"`
	YMax float64 `json:"yMax"`
	ZMin float64 `json:"zMin"`
	ZMax float64 `json:"zMax"`
}

// SectionRequest is a family of Count parallel planes n̂·p = d, where n̂ is
// Normal made a unit vector and d runs evenly from From to To, both
// included; one plane stands at From, and Count 0 asks for none.
type SectionRequest struct {
	Normal Vec3    `json:"normal"`
	From   float64 `json:"from"`
	To     float64 `json:"to"`
	Count  int     `json:"count"`
}

// ImplicitRequest is the level set F(x, y, z) = Level within Box, sought on
// a grid of Cells cells along the box's longest side and as many along the
// others as keeps them nearest to cubes, refined up to Refine octree
// levels where samples of F disagree with the grid (see adaptive.go). F
// may use a, but not t.
type ImplicitRequest struct {
	F        string         `json:"f"`
	A        float64        `json:"a"`
	Level    float64        `json:"level"`
	Box      Box            `json:"box"`
	Cells    int            `json:"cells"`
	Refine   int            `json:"refine"`
	Sections SectionRequest `json:"sections"`
}

// SectionPath is one connected piece of a section, running with larger F
// on its left seen from the side the plane's normal points to. An open
// path ends where it leaves the box or meets cells where F is not finite or
// not continuous.
type SectionPath struct {
	Points []Vec3 `json:"points"`
	Closed bool   `json:"closed"`
}

// ImplicitSection is the level set on one plane: the polygon where the
// plane meets the box (empty when it misses), and the paths. Skipped is set
// when the section budget ran out before this plane.
type ImplicitSection struct {
	Offset  float64       `json:"offset"`
	Polygon []Vec3        `json:"polygon"`
	Paths   []SectionPath `json:"paths"`
	Skipped bool          `json:"skipped"`
}

// ImplicitComponent is one connected piece of the mesh: its triangles, its
// Euler characteristic V − E + F, and whether it has no boundary edge.
type ImplicitComponent struct {
	Triangles int  `json:"triangles"`
	Euler     int  `json:"euler"`
	Closed    bool `json:"closed"`
}

// ImplicitResult is the level set as an indexed mesh. Positions and Normals
// hold three coordinates per vertex; a normal is ∇F/|∇F|, pointing toward
// larger F, or zero where ∇F vanishes or is not finite (counted in
// Singular). Triangles hold three vertex indices each, counterclockwise
// seen from larger F. Cut and Open hold pairs of vertex indices: the edges
// of a single triangle, where the box's faces cut the level set, and
// elsewhere, beside cells left out. Marks are the first of the grid edges
// where F changes sign without crossing the level (a pole or a jump), in
// edge order; Discontinuities counts them all. Nonfinite counts the grid
// points where F is not a finite number, and Ambiguous the grid faces
// whose corners alternate in sign; with refinement, Nonfinite also counts
// the points sampled between grid points.
type ImplicitResult struct {
	Box                    Box                 `json:"box"`
	Grid                   [3]int              `json:"grid"`
	Positions              []float64           `json:"positions"`
	Normals                []float64           `json:"normals"`
	Triangles              []int32             `json:"triangles"`
	Cut                    []int32             `json:"cut"`
	Open                   []int32             `json:"open"`
	Components             []ImplicitComponent `json:"components"`
	Sections               []ImplicitSection   `json:"sections"`
	Marks                  []Vec3              `json:"marks"`
	Nonfinite              int                 `json:"nonfinite"`
	Discontinuities        int                 `json:"discontinuities"`
	Ambiguous              int                 `json:"ambiguous"`
	Singular               int                 `json:"singular"`
	SectionDiscontinuities int                 `json:"sectionDiscontinuities"`
	SectionsSkipped        int                 `json:"sectionsSkipped"`
	Truncated              bool                `json:"truncated"`
	Refinement             ImplicitRefinement  `json:"refinement"`
}

const (
	minImplicitCells, maxImplicitCells = 4, 128
	maxImplicitGrid                    = 262144
	maxSections                        = 24
	maxSectionCells                    = 256
	maxImplicitMarks                   = 4096
	maxImplicitRefine                  = 3
)

// Work bounds: the triangles of the mesh, and the grid edges searched for a
// crossing, crossed or not.
var (
	maxImplicitTriangles = 200000
	maxImplicitCrossings = 400000
)

// grouped writes n with thousands separators.
func grouped(n int) string {
	s := fmt.Sprint(n)
	for k := len(s) - 3; k > 0; k -= 3 {
		s = s[:k] + "," + s[k:]
	}
	return s
}

func (b Box) validate() error {
	for _, v := range []float64{b.XMin, b.XMax, b.YMin, b.YMax, b.ZMin, b.ZMax} {
		if !bounded(v) {
			return fmt.Errorf("the box must be finite and within ±100000")
		}
	}
	if !(b.XMax-b.XMin >= 1e-6) || !(b.YMax-b.YMin >= 1e-6) || !(b.ZMax-b.ZMin >= 1e-6) {
		return fmt.Errorf("the box needs x, y and z ranges at least 0.000001 wide, each from below to above")
	}
	return nil
}

func (b Box) sides() [3]float64 {
	return [3]float64{b.XMax - b.XMin, b.YMax - b.YMin, b.ZMax - b.ZMin}
}

// shape divides the box into cells along its longest side and as many
// along the others as keeps them nearest to cubes, at least one.
func (b Box) shape(cells int) [3]int {
	sides := b.sides()
	h := math.Max(sides[0], math.Max(sides[1], sides[2])) / float64(cells)
	var n [3]int
	for k, s := range sides {
		n[k] = max(1, int(math.Round(s/h)))
	}
	return n
}

func (q ImplicitRequest) validate() error {
	if !finite(q.A) {
		return fmt.Errorf("the shape parameter a must be finite")
	}
	if !finite(q.Level) {
		return fmt.Errorf("the level c must be finite")
	}
	if err := q.Box.validate(); err != nil {
		return err
	}
	cellsError := fmt.Errorf("use %d–%d cells along the box's longest side, with at most %s cells in all", minImplicitCells, maxImplicitCells, grouped(maxImplicitGrid))
	if q.Cells < minImplicitCells || q.Cells > maxImplicitCells {
		return cellsError
	}
	if n := q.Box.shape(q.Cells); n[0]*n[1]*n[2] > maxImplicitGrid {
		return cellsError
	}
	if q.Refine < 0 || q.Refine > maxImplicitRefine {
		return fmt.Errorf("use 0–%d refinement levels", maxImplicitRefine)
	}
	s := q.Sections
	if s.Count < 0 || s.Count > maxSections {
		return fmt.Errorf("use 0–%d section planes", maxSections)
	}
	if s.Count > 0 {
		if !bounded(s.Normal.X) || !bounded(s.Normal.Y) || !bounded(s.Normal.Z) || !(s.Normal.norm() > 1e-9) {
			return fmt.Errorf("the section normal must be finite, nonzero, and within ±100000")
		}
		if !bounded(s.From) || !bounded(s.To) {
			return fmt.Errorf("the section offsets must be finite and within ±100000")
		}
	}
	return nil
}

// field is F − c sampled on the box's grid.
type field struct {
	f          func(Vec3) float64
	c          float64
	box        Box
	n          [3]int
	h          [3]float64
	values     []float64
	nonfinite  int
	vertices   map[int]int32
	rejected   map[int]Vec3
	positions  []float64
	normals    []float64
	singular   int
	triangles  []int32
	overflowed bool
}

func (s *field) index(i, j, k int) int { return i + (s.n[0]+1)*(j+(s.n[1]+1)*k) }

func (s *field) node(i, j, k int) Vec3 {
	b := s.box
	return Vec3{lerp(b.XMin, b.XMax, i, s.n[0]), lerp(b.YMin, b.YMax, j, s.n[1]), lerp(b.ZMin, b.ZMax, k, s.n[2])}
}

// The seven grid edges leaving a grid point toward larger coordinates: the
// three axes, the three face diagonals and the body diagonal, numbered by
// their bits x + 2y + 4z less one.
func (s *field) point(p int) (int, int, int) {
	row := s.n[0] + 1
	plane := row * (s.n[1] + 1)
	return p % row, p / row % (s.n[1] + 1), p / plane
}

// gradient differentiates F with a five-point stencil a thousandth of the
// smallest cell side wide.
func (s *field) gradient(p Vec3) Vec3 {
	h := 1e-3 * math.Min(s.h[0], math.Min(s.h[1], s.h[2]))
	d := func(e Vec3) float64 {
		return (s.f(p.sub(e.mul(2*h))) - 8*s.f(p.sub(e.mul(h))) + 8*s.f(p.add(e.mul(h))) - s.f(p.add(e.mul(2*h)))) / (12 * h)
	}
	return Vec3{d(Vec3{1, 0, 0}), d(Vec3{0, 1, 0}), d(Vec3{0, 0, 1})}
}

// root finds F = c on the segment from a to b, whose ends' values ga and gb
// of F − c lie on opposite sides (≥ 0 and < 0), as the fraction t of the
// way along it. Illinois steps of false position, each followed by a
// bisection when it has not halved the bracket, shrink the bracket below
// 10⁻¹² of the segment. It reports false where F is not continuous there:
// F − c at the bracket exceeds a million times the segment's mean slope
// times the bracket's width, as at a pole or a jump, or F is not a number.
// t is then where that happens.
func (s *field) root(a, b Vec3, ga, gb float64) (float64, bool) {
	if ga == 0 {
		return 0, true
	}
	if gb == 0 {
		return 1, true
	}
	d := b.sub(a)
	lo, hi, glo, ghi := 0.0, 1.0, ga, gb
	wlo, whi := glo, ghi
	side := 0
	// step replaces the end on t's side; Illinois halves the weight of an
	// end kept twice in a row.
	step := func(t float64, illinois bool) (bool, bool) {
		g := s.f(a.add(d.mul(t))) - s.c
		if !finite(g) {
			lo = t
			return true, false
		}
		if g == 0 {
			lo, hi, glo, ghi = t, t, 0, 0
			return true, true
		}
		if (g >= 0) == (glo >= 0) {
			lo, glo, wlo = t, g, g
			if illinois && side < 0 {
				whi /= 2
			}
			side = -1
		} else {
			hi, ghi, whi = t, g, g
			if illinois && side > 0 {
				wlo /= 2
			}
			side = 1
		}
		if !illinois {
			wlo, whi, side = glo, ghi, 0
		}
		return false, true
	}
	for hi-lo > 1e-12 {
		width := hi - lo
		t := (lo*whi - hi*wlo) / (whi - wlo)
		if !(t > lo && t < hi) {
			t = lo + width/2
		}
		if done, ok := step(t, true); done {
			return lo, ok
		}
		// Above 10⁻¹², a midpoint of [0, 1] always lies strictly inside.
		if hi-lo > width/2 {
			if done, ok := step(lo+(hi-lo)/2, false); done {
				return lo, ok
			}
		}
	}
	if math.Min(math.Abs(glo), math.Abs(ghi)) > 1e6*(math.Abs(ga)+math.Abs(gb))*(hi-lo) {
		return lo, false
	}
	if math.Abs(glo) <= math.Abs(ghi) {
		return lo, true
	}
	return hi, true
}

// vertex returns the mesh vertex where the grid edge from point p to point
// p + bits crosses the level, or false where it is not a crossing.
func (s *field) vertex(p, bits int) (int32, bool) {
	e := 7*p + bits - 1
	if v, ok := s.vertices[e]; ok {
		return v, true
	}
	if _, ok := s.rejected[e]; ok {
		return 0, false
	}
	i, j, k := s.point(p)
	di, dj, dk := bits&1, bits>>1&1, bits>>2&1
	q := s.index(i+di, j+dj, k+dk)
	a, b := s.node(i, j, k), s.node(i+di, j+dj, k+dk)
	ga, gb := s.values[p], s.values[q]
	if len(s.vertices)+len(s.rejected) >= maxImplicitCrossings {
		s.overflowed = true
		return 0, false
	}
	t, ok := s.root(a, b, ga, gb)
	x := a.add(b.sub(a).mul(t))
	if !ok {
		s.rejected[e] = x
		return 0, false
	}
	// A crossing at a grid point is one vertex, whichever edge finds it;
	// grid points are keyed after every edge.
	key := e
	switch t {
	case 0:
		key, x = 7*len(s.values)+p, a
	case 1:
		key, x = 7*len(s.values)+q, b
	}
	v, ok := s.vertices[key]
	if !ok {
		v = int32(len(s.positions) / 3)
		s.positions = append(s.positions, x.X, x.Y, x.Z)
		n := s.gradient(x)
		slope := (math.Abs(ga) + math.Abs(gb)) / b.sub(a).norm()
		if l := n.norm(); finite(l) && l > 1e-9*slope {
			n = n.mul(1 / l)
		} else {
			n = Vec3{}
			s.singular++
		}
		s.normals = append(s.normals, n.X, n.Y, n.Z)
		s.vertices[key] = v
	}
	s.vertices[e] = v
	return v, true
}

// newVertex adds a vertex at x with its normal, ∇F/|∇F|, or none where
// |∇F| is below 10⁻⁹ of the slope of F along the edge it was found on.
// field.vertex keeps its own copy of these steps: calling this instead
// changes how the compiler fuses their multiplications and additions,
// and with it the last bit of some normals of existing studies.
func (s *field) newVertex(x Vec3, slope float64) int32 {
	v := int32(len(s.positions) / 3)
	s.positions = append(s.positions, x.X, x.Y, x.Z)
	n := s.gradient(x)
	if l := n.norm(); finite(l) && l > 1e-9*slope {
		n = n.mul(1 / l)
	} else {
		n = Vec3{}
		s.singular++
	}
	s.normals = append(s.normals, n.X, n.Y, n.Z)
	return v
}

// The six tetrahedra of a cube, each a path from corner 0 to corner 7 along
// the cube's edges, in the bits x + 2y + 4z of its corners. Neighbouring
// cubes split each shared face along the same diagonal.
var tetrahedra = [6][4]int{{0, 1, 3, 7}, {0, 1, 5, 7}, {0, 2, 3, 7}, {0, 2, 6, 7}, {0, 4, 5, 7}, {0, 4, 6, 7}}

// march adds the triangles of one tetrahedron, whose corners are grid
// points in the cube whose first corner is point p.
func (s *field) march(p int, corners [8]int, tet [4]int) {
	var g [4]float64
	for c, bits := range tet {
		g[c] = s.values[corners[bits]]
	}
	if (g[0] >= 0) == (g[1] >= 0) && (g[1] >= 0) == (g[2] >= 0) && (g[2] >= 0) == (g[3] >= 0) {
		return
	}
	var at [4]Vec3
	for c, bits := range tet {
		i, j, k := s.point(corners[bits])
		at[c] = s.node(i, j, k)
	}
	s.marchTet(g, at, func(u, w int) (int32, bool) {
		return s.vertex(corners[tet[u]], tet[w]-tet[u])
	})
}

// marchTet adds the triangles of a tetrahedron with values g of F − c at
// its corners, oriented to face the corners on the larger side. crossing
// returns the vertex on its edge from corner u to corner w > u, or false
// where it is not a crossing; a tetrahedron with such an edge is left out.
func (s *field) marchTet(g [4]float64, at [4]Vec3, crossing func(u, w int) (int32, bool)) {
	var positive, negative []int
	for c := range 4 {
		if g[c] >= 0 {
			positive = append(positive, c)
		} else {
			negative = append(negative, c)
		}
	}
	if len(positive) == 0 || len(negative) == 0 {
		return
	}
	var ring []int32
	ok := true
	// Every sign-changing edge is sought, so each discontinuity is counted.
	add := func(u, w int) {
		if u > w {
			u, w = w, u
		}
		v, found := crossing(u, w)
		ok = ok && found
		ring = append(ring, v)
	}
	switch len(positive) {
	case 1:
		for _, n := range negative {
			add(positive[0], n)
		}
	case 3:
		for _, q := range positive {
			add(q, negative[0])
		}
	default:
		add(positive[0], negative[0])
		add(positive[0], negative[1])
		add(positive[1], negative[1])
		add(positive[1], negative[0])
	}
	if !ok {
		return
	}
	centroid := func(cs []int) Vec3 {
		var sum Vec3
		for _, c := range cs {
			sum = sum.add(at[c])
		}
		return sum.mul(1 / float64(len(cs)))
	}
	up := centroid(positive).sub(centroid(negative))
	emit := func(a, b, c int32) {
		if a == b || b == c || a == c {
			return
		}
		pa, pb, pc := s.at(a), s.at(b), s.at(c)
		if pb.sub(pa).cross(pc.sub(pa)).dot(up) < 0 {
			b, c = c, b
		}
		s.triangles = append(s.triangles, a, b, c)
	}
	emit(ring[0], ring[1], ring[2])
	if len(ring) == 4 {
		emit(ring[0], ring[2], ring[3])
	}
}

func (s *field) at(v int32) Vec3 {
	return Vec3{s.positions[3*v], s.positions[3*v+1], s.positions[3*v+2]}
}

func (m *ImplicitResult) vertex(v int32) Vec3 {
	return Vec3{m.Positions[3*v], m.Positions[3*v+1], m.Positions[3*v+2]}
}

func (m *ImplicitResult) normal(v int32) Vec3 {
	return Vec3{m.Normals[3*v], m.Normals[3*v+1], m.Normals[3*v+2]}
}

// ambiguous counts the grid faces whose four corners are finite and
// alternate in sign.
func (s *field) ambiguous() int {
	count := 0
	for k := 0; k <= s.n[2]; k++ {
		for j := 0; j <= s.n[1]; j++ {
			for i := 0; i <= s.n[0]; i++ {
				p := s.index(i, j, k)
				// Faces spanned by two of the axes from this point.
				for _, axes := range [3][2][3]int{{{1, 0, 0}, {0, 1, 0}}, {{0, 1, 0}, {0, 0, 1}}, {{0, 0, 1}, {1, 0, 0}}} {
					u, w := axes[0], axes[1]
					if i+u[0]+w[0] > s.n[0] || j+u[1]+w[1] > s.n[1] || k+u[2]+w[2] > s.n[2] {
						continue
					}
					g := [4]float64{s.values[p], s.values[s.index(i+u[0], j+u[1], k+u[2])],
						s.values[s.index(i+u[0]+w[0], j+u[1]+w[1], k+u[2]+w[2])], s.values[s.index(i+w[0], j+w[1], k+w[2])]}
					if math.IsNaN(g[0]) || math.IsNaN(g[1]) || math.IsNaN(g[2]) || math.IsNaN(g[3]) {
						continue
					}
					if (g[0] >= 0) == (g[2] >= 0) && (g[1] >= 0) == (g[3] >= 0) && (g[0] >= 0) != (g[1] >= 0) {
						count++
					}
				}
			}
		}
	}
	return count
}

// topology splits the mesh into connected pieces, each with its Euler
// characteristic, and its boundary edges into those on one face of the box
// and the rest.
func (m *ImplicitResult) topology() {
	n := len(m.Positions) / 3
	parent := make([]int32, n)
	for k := range parent {
		parent[k] = int32(k)
	}
	var find func(int32) int32
	find = func(v int32) int32 {
		for parent[v] != v {
			parent[v] = parent[parent[v]]
			v = parent[v]
		}
		return v
	}
	edges := map[[2]int32]int{}
	var order [][2]int32
	for k := 0; k < len(m.Triangles); k += 3 {
		t := m.Triangles[k : k+3]
		for e := range 3 {
			a, b := t[e], t[(e+1)%3]
			if a > b {
				a, b = b, a
			}
			if edges[[2]int32{a, b}] == 0 {
				order = append(order, [2]int32{a, b})
			}
			edges[[2]int32{a, b}]++
			if ra, rb := find(a), find(b); ra != rb {
				parent[max(ra, rb)] = min(ra, rb)
			}
		}
	}
	// Pieces in the order of their first triangle.
	piece := map[int32]int{}
	for k := 0; k < len(m.Triangles); k += 3 {
		r := find(m.Triangles[k])
		if _, ok := piece[r]; !ok {
			piece[r] = len(m.Components)
			m.Components = append(m.Components, ImplicitComponent{Closed: true})
		}
		m.Components[piece[r]].Triangles++
		m.Components[piece[r]].Euler++
	}
	seen := make([]bool, n)
	for k := 0; k < len(m.Triangles); k++ {
		if v := m.Triangles[k]; !seen[v] {
			seen[v] = true
			m.Components[piece[find(v)]].Euler++
		}
	}
	b := m.Box
	tol := 1e-12 * (math.Max(b.XMax-b.XMin, math.Max(b.YMax-b.YMin, b.ZMax-b.ZMin)) + math.Max(math.Abs(b.XMin), math.Max(math.Abs(b.XMax), math.Max(math.Max(math.Abs(b.YMin), math.Abs(b.YMax)), math.Max(math.Abs(b.ZMin), math.Abs(b.ZMax))))))
	onFace := func(p, q Vec3) bool {
		for _, f := range [6]func(Vec3) float64{
			func(v Vec3) float64 { return v.X - b.XMin }, func(v Vec3) float64 { return v.X - b.XMax },
			func(v Vec3) float64 { return v.Y - b.YMin }, func(v Vec3) float64 { return v.Y - b.YMax },
			func(v Vec3) float64 { return v.Z - b.ZMin }, func(v Vec3) float64 { return v.Z - b.ZMax },
		} {
			if math.Abs(f(p)) <= tol && math.Abs(f(q)) <= tol {
				return true
			}
		}
		return false
	}
	for _, e := range order {
		c := &m.Components[piece[find(e[0])]]
		c.Euler--
		if edges[e] != 1 {
			continue
		}
		c.Closed = false
		if onFace(m.vertex(e[0]), m.vertex(e[1])) {
			m.Cut = append(m.Cut, e[0], e[1])
		} else {
			m.Open = append(m.Open, e[0], e[1])
		}
	}
}

// frame returns the unit normal and an orthonormal pair e₁, e₂ in the
// plane with e₁ × e₂ = n̂: e₁ is the axis before n̂'s largest component,
// in the cycle x → y → z, crossed with n̂, so a plane normal to z has e₁ =
// x and e₂ = y, to x has y and z, and to y has z and x.
func (s SectionRequest) frame() (n, e1, e2 Vec3) {
	n = s.Normal.mul(1 / s.Normal.norm())
	axis := Vec3{0, 1, 0}
	if a := [3]float64{math.Abs(n.X), math.Abs(n.Y), math.Abs(n.Z)}; a[0] >= a[1] && a[0] >= a[2] {
		axis = Vec3{0, 0, 1}
	} else if a[1] >= a[2] {
		axis = Vec3{1, 0, 0}
	}
	e1 = axis.cross(n)
	e1 = e1.mul(1 / e1.norm())
	return n, e1, n.cross(e1)
}

// section traces F = c on the plane n̂·p = d within the box.
func (s *field) section(q ImplicitRequest, d float64, cells int, budget *engine.ContourBudget, out *ImplicitResult) (ImplicitSection, bool) {
	n, e1, e2 := q.Sections.frame()
	o := n.mul(d)
	at := func(u, v float64) Vec3 { return o.add(e1.mul(u)).add(e2.mul(v)) }
	b := s.box
	corner := func(c int) Vec3 {
		return Vec3{[2]float64{b.XMin, b.XMax}[c&1], [2]float64{b.YMin, b.YMax}[c>>1&1], [2]float64{b.ZMin, b.ZMax}[c>>2&1]}
	}
	// Where the plane meets the box's edges, in plane coordinates.
	var hits [][2]float64
	add := func(p Vec3) {
		h := [2]float64{p.sub(o).dot(e1), p.sub(o).dot(e2)}
		for _, g := range hits {
			if math.Hypot(g[0]-h[0], g[1]-h[1]) <= 1e-12*b.sides()[0]+1e-12*b.sides()[1]+1e-12*b.sides()[2] {
				return
			}
		}
		hits = append(hits, h)
	}
	for c := range 8 {
		for _, bit := range []int{1, 2, 4} {
			if c&bit != 0 {
				continue
			}
			p, r := corner(c), corner(c|bit)
			sp, sr := n.dot(p)-d, n.dot(r)-d
			if sp == 0 {
				add(p)
			}
			if sr == 0 {
				add(r)
			}
			if (sp < 0 && sr > 0) || (sp > 0 && sr < 0) {
				add(p.add(r.sub(p).mul(sp / (sp - sr))))
			}
		}
	}
	section := ImplicitSection{Offset: d, Polygon: []Vec3{}, Paths: []SectionPath{}}
	if len(hits) < 3 {
		return section, true
	}
	var mid [2]float64
	for _, h := range hits {
		mid[0], mid[1] = mid[0]+h[0]/float64(len(hits)), mid[1]+h[1]/float64(len(hits))
	}
	sort.Slice(hits, func(i, j int) bool {
		return math.Atan2(hits[i][1]-mid[1], hits[i][0]-mid[0]) < math.Atan2(hits[j][1]-mid[1], hits[j][0]-mid[0])
	})
	w := engine.Window{XMin: math.Inf(1), XMax: math.Inf(-1), YMin: math.Inf(1), YMax: math.Inf(-1)}
	for _, h := range hits {
		section.Polygon = append(section.Polygon, at(h[0], h[1]))
		w.XMin, w.XMax = math.Min(w.XMin, h[0]), math.Max(w.XMax, h[0])
		w.YMin, w.YMax = math.Min(w.YMin, h[1]), math.Max(w.YMax, h[1])
	}
	if !(w.XMax-w.XMin >= 1e-6) || !(w.YMax-w.YMin >= 1e-6) {
		return section, true
	}
	sides := b.sides()
	tol := 1e-9 * (sides[0] + sides[1] + sides[2])
	inside := func(p Vec3) bool {
		return p.X >= b.XMin-tol && p.X <= b.XMax+tol && p.Y >= b.YMin-tol && p.Y <= b.YMax+tol && p.Z >= b.ZMin-tol && p.Z <= b.ZMax+tol
	}
	set, marks, ok := engine.TraceLevel(func(u, v float64) float64 {
		if p := at(u, v); inside(p) {
			return s.f(p)
		}
		return math.NaN()
	}, w, cells, q.Level, budget)
	if !ok {
		section.Skipped = true
		return section, false
	}
	out.SectionDiscontinuities += len(marks)
	for _, c := range set.Contours {
		path := SectionPath{Closed: c.Closed}
		for _, p := range c.Points {
			path.Points = append(path.Points, at(p.X, p.Y))
		}
		section.Paths = append(section.Paths, path)
	}
	return section, true
}

// sample validates the request, parses F and samples F − c on the grid.
func sample(q ImplicitRequest) (*field, error) {
	if err := q.validate(); err != nil {
		return nil, err
	}
	f, timed, err := expr.ParseSpatialField(q.F, q.A)
	if err != nil {
		return nil, fmt.Errorf("F(x, y, z): %w", err)
	}
	if timed {
		return nil, fmt.Errorf("F(x, y, z) cannot use t; animate a or the level instead")
	}
	s := &field{f: func(p Vec3) float64 { return f(p.X, p.Y, p.Z, 0) }, c: q.Level, box: q.Box, n: q.Box.shape(q.Cells),
		vertices: map[int]int32{}, rejected: map[int]Vec3{}, positions: []float64{}, normals: []float64{}, triangles: []int32{}}
	sides := q.Box.sides()
	for k := range 3 {
		s.h[k] = sides[k] / float64(s.n[k])
	}
	s.values = make([]float64, (s.n[0]+1)*(s.n[1]+1)*(s.n[2]+1))
	for k := 0; k <= s.n[2]; k++ {
		for j := 0; j <= s.n[1]; j++ {
			for i := 0; i <= s.n[0]; i++ {
				g := s.f(s.node(i, j, k)) - s.c
				if !finite(g) {
					g = math.NaN()
					s.nonfinite++
				}
				s.values[s.index(i, j, k)] = g
			}
		}
	}
	return s, nil
}

// implicit meshes the level set by marching tetrahedra, refined where
// asked, and traces its sections.
func implicit(q ImplicitRequest) (Result, error) {
	s, err := sample(q)
	if err != nil {
		return Result{}, err
	}
	fewer := "use fewer cells"
	if q.Refine > 0 {
		fewer = "use fewer cells or refinement levels"
	}
	fail := func() error {
		if s.overflowed {
			return fmt.Errorf("the level set crosses more than %s grid edges; %s", grouped(maxImplicitCrossings), fewer)
		}
		if len(s.triangles) > 3*maxImplicitTriangles {
			return fmt.Errorf("the level set needs more than %s triangles; %s", grouped(maxImplicitTriangles), fewer)
		}
		return nil
	}
	refinement := ImplicitRefinement{Levels: q.Refine}
	var marks []Vec3
	discontinuities := 0
	if q.Refine > 0 {
		a := newAdaptive(s, q.Refine)
		unresolved, err := a.refine()
		if err != nil {
			return Result{}, err
		}
		if err := a.mesh(fail); err != nil {
			return Result{}, err
		}
		marks, discontinuities = a.marks()
		refinement.Reached, refinement.Unresolved, refinement.Exhausted = a.reached(), unresolved, a.exhausted
		for _, x := range a.r.tets {
			if x.kids[0] >= 0 {
				refinement.Bisected++
			}
		}
	} else {
		for k := 0; k < s.n[2]; k++ {
			for j := 0; j < s.n[1]; j++ {
				for i := 0; i < s.n[0]; i++ {
					var corners [8]int
					defined := true
					for c := range 8 {
						corners[c] = s.index(i+c&1, j+c>>1&1, k+c>>2&1)
						defined = defined && !math.IsNaN(s.values[corners[c]])
					}
					if !defined {
						continue
					}
					for _, tet := range tetrahedra {
						s.march(corners[0], corners, tet)
						if err := fail(); err != nil {
							return Result{}, err
						}
					}
				}
			}
		}
		edges := make([]int, 0, len(s.rejected))
		for e := range s.rejected {
			edges = append(edges, e)
		}
		sort.Ints(edges)
		marks = []Vec3{}
		for _, e := range edges[:min(len(edges), maxImplicitMarks)] {
			marks = append(marks, s.rejected[e])
		}
		discontinuities = len(edges)
	}
	out := &ImplicitResult{Box: q.Box, Grid: s.n, Positions: s.positions, Normals: s.normals, Triangles: s.triangles,
		Cut: []int32{}, Open: []int32{}, Components: []ImplicitComponent{}, Sections: []ImplicitSection{}, Marks: marks,
		Nonfinite: s.nonfinite, Discontinuities: discontinuities, Ambiguous: s.ambiguous(), Singular: s.singular, Refinement: refinement}
	out.topology()
	budget := &engine.ContourBudget{}
	cells := min(maxSectionCells, 4*q.Cells)
	going := true
	for k := range q.Sections.Count {
		d := q.Sections.From
		if q.Sections.Count > 1 {
			d = lerp(q.Sections.From, q.Sections.To, k, q.Sections.Count-1)
		}
		section := ImplicitSection{Offset: d, Polygon: []Vec3{}, Paths: []SectionPath{}, Skipped: true}
		if going {
			section, going = s.section(q, d, cells, budget, out)
		}
		if section.Skipped {
			out.SectionsSkipped++
		}
		out.Sections = append(out.Sections, section)
	}
	out.Truncated = budget.Truncated
	// The mesh, the sections and the box fit on their own.
	var positions, points []*Vec3
	for v := int32(0); v < int32(len(out.Positions)/3); v++ {
		p := out.vertex(v)
		positions = append(positions, &p)
	}
	for _, section := range out.Sections {
		for _, path := range section.Paths {
			for k := range path.Points {
				points = append(points, &path.Points[k])
			}
		}
	}
	var corners []*Vec3
	for c := range 8 {
		b := q.Box
		corners = append(corners, &Vec3{[2]float64{b.XMin, b.XMax}[c&1], [2]float64{b.YMin, b.YMax}[c>>1&1], [2]float64{b.ZMin, b.ZMax}[c>>2&1]})
	}
	bounds := fit(positions, points, corners)
	return Result{Bounds: bounds, Radius: bounds.Radius, Breaks: []bool{}, Base: []*Vec3{}, Minus: []*Vec3{}, Plus: []*Vec3{}, Mesh: []Vertex{}, Rulings: []Ruling{}, Implicit: out}, nil
}
