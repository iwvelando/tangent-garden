package engine4

import (
	"fmt"
	"math"
	"math/bits"
	"sort"
	"sync"
)

// The self-dual 24-cell and its polar, with exact incidence.
//
// The primal P has the 24 vertices v, all permutations of (±1, ±1, 0, 0):
// circumradius √2 and edge length √2. Its polar P° = {x : x·v ≤ 1 for
// every v} is the convex hull of the 24 points d, ±eᵢ and (±½, ±½, ±½, ±½):
// circumradius 1 and edge length 1. Each d is a facet normal of P: the
// octahedral cell d·x = 1 of P, whose center is d itself. Each v is a facet
// normal of P°: the cell v·x = 1 of P°, centered on v/2. Neither
// configuration is rescaled to the other's size.
//
// Incidence is derived from these inequalities in exact integer arithmetic
// on doubled coordinates: a vertex lies in a cell when the doubled dot
// product is 4, edges are vertex pairs shared by at least three cells, and
// triangles are vertex triples shared by at least two. Vertices are
// numbered in descending lexicographic order of their coordinates; edges
// and triangles are ascending tuples of vertex IDs, in lexicographic
// order. Cell k of either configuration is the cell centered on vertex k of
// the other, so primal cell k and dual vertex k share an ID.

// Cell24Parameters choose one cell and how much of the crystal to draw.
type Cell24Parameters struct {
	// The selected primal cell, the cell centered on dual vertex Selected.
	Selected int `json:"selected"`
	// "cell" draws the selected cell and its center's neighborhood;
	// "crystal" draws both whole configurations. The engine returns the
	// same incidence for either.
	View string `json:"view"`
}

// Polytope24 is one configuration: its declared coordinates, the rotated
// 4D vertices and their orthogonal xyz shadow, by vertex ID, and its edges
// as ordered vertex-ID pairs.
type Polytope24 struct {
	Circumradius float64  `json:"circumradius"`
	EdgeLength   float64  `json:"edgeLength"`
	Source       []Vec4   `json:"source"`
	Rotated      []Vec4   `json:"rotated"`
	Points       []Vec3   `json:"points"`
	Edges        [][2]int `json:"edges"`
	Faces        int      `json:"faces"`
	Cells        int      `json:"cells"`
}

// Cell24Diagnostics is the whole 24-cell study: both configurations and
// the selected cell's incidence.
type Cell24Diagnostics struct {
	Sections []Section24 `json:"sections,omitempty"`
	View     string      `json:"view"`
	Selected int         `json:"selected"`
	Primal   Polytope24  `json:"primal"`
	Dual     Polytope24  `json:"dual"`
	// The selected cell's six primal vertices as three opposite pairs,
	// whose midpoints are all dual vertex Selected, and its 12 edge IDs.
	CellVertices []int `json:"cellVertices"`
	CellEdges    []int `json:"cellEdges"`
	// The eight dual vertices joined to Selected by a dual edge, ascending,
	// with that edge's ID and the primal triangle their two cells share.
	Neighbors     []int    `json:"neighbors"`
	NeighborEdges []int    `json:"neighborEdges"`
	SharedFaces   [][3]int `json:"sharedFaces"`
	// The shortest and longest shadow of the selected cell's edges, each √2
	// long in four dimensions.
	ShadowEdges [2]float64 `json:"shadowEdges"`
}

// Fixed bounds of the finite study: vertex shadows and edges of both
// configurations, and every path the page draws from them (both edge sets,
// the selected cell's 12 edges and 3 diagonals, and 8 dual edges from its
// center).
const (
	cell24Vertices   = 48
	cell24Edges      = 192
	cell24DrawnPaths = 96 + 96 + 12 + 3 + 8
)

type complex24 struct {
	coords [24][4]int // doubled coordinates
	normal [24][4]int // the other configuration's doubled coordinates
	edges  [][2]int
	faces  [][3]int
	// Each cell's vertices as three opposite pairs, the lower ID first.
	cells     [24][6]int
	cellEdges [24][]int
	cellFaces [24][]int
}

func (x *complex24) source(i int) Vec4 { return half(x.coords[i]) }

// The facet normal of cell k: vertex k of the other configuration.
func (x *complex24) other(k int) Vec4 { return half(x.normal[k]) }

func half(c [4]int) Vec4 {
	return Vec4{float64(c[0]) / 2, float64(c[1]) / 2, float64(c[2]) / 2, float64(c[3]) / 2}
}

func idot(a, b [4]int) int { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3] }

// The doubled coordinates of each configuration, in ID order.
func primalCoords() [24][4]int {
	var out [24][4]int
	n := 0
	for i := 0; i < 4; i++ {
		for j := i + 1; j < 4; j++ {
			for _, a := range []int{-2, 2} {
				for _, b := range []int{-2, 2} {
					out[n][i], out[n][j] = a, b
					n++
				}
			}
		}
	}
	return ordered(out)
}
func dualCoords() [24][4]int {
	var out [24][4]int
	n := 0
	for i := 0; i < 4; i++ {
		for _, s := range []int{-2, 2} {
			out[n][i] = s
			n++
		}
	}
	for m := 0; m < 16; m++ {
		for i := 0; i < 4; i++ {
			out[n][i] = 1 - 2*(m>>i&1)
		}
		n++
	}
	return ordered(out)
}
func ordered(c [24][4]int) [24][4]int {
	sort.Slice(c[:], func(i, j int) bool {
		for k := 0; k < 4; k++ {
			if c[i][k] != c[j][k] {
				return c[i][k] > c[j][k]
			}
		}
		return false
	})
	return c
}

// newComplex derives a configuration's incidence from its vertices and its
// cells' facet normals, both doubled, where vertex v lies in cell k when
// v·n = 1, that is, when the doubled product is 4.
func newComplex(coords, normal [24][4]int) *complex24 {
	x := &complex24{coords: coords, normal: normal}
	var in [24]uint32 // the cells holding each vertex
	for k := range normal {
		for i := range coords {
			switch d := idot(normal[k], coords[i]); {
			case d == 4:
				in[i] |= 1 << k
			case d > 4:
				panic("24-cell vertex outside a cell's inequality")
			}
		}
	}
	adjacent := func(i, j int) bool { return bits.OnesCount32(in[i]&in[j]) >= 3 }
	for i := 0; i < 24; i++ {
		for j := i + 1; j < 24; j++ {
			if !adjacent(i, j) {
				continue
			}
			x.edges = append(x.edges, [2]int{i, j})
			for l := j + 1; l < 24; l++ {
				if bits.OnesCount32(in[i]&in[j]&in[l]) >= 2 {
					x.faces = append(x.faces, [3]int{i, j, l})
				}
			}
		}
	}
	for k := range normal {
		var members []int
		for i := range coords {
			if in[i]&(1<<k) != 0 {
				members = append(members, i)
			}
		}
		// Pair each vertex with the one vertex of its octahedron it is not
		// joined to.
		used := map[int]bool{}
		n := 0
		for _, a := range members {
			if used[a] {
				continue
			}
			for _, b := range members {
				if b != a && !used[b] && !adjacent(min(a, b), max(a, b)) {
					x.cells[k][n], x.cells[k][n+1] = a, b
					used[a], used[b] = true, true
					n += 2
					break
				}
			}
		}
		for e, ends := range x.edges {
			if in[ends[0]]&in[ends[1]]&(1<<k) != 0 {
				x.cellEdges[k] = append(x.cellEdges[k], e)
			}
		}
		for f, t := range x.faces {
			if in[t[0]]&in[t[1]]&in[t[2]]&(1<<k) != 0 {
				x.cellFaces[k] = append(x.cellFaces[k], f)
			}
		}
	}
	return x
}

var complexes = sync.OnceValues(func() (*complex24, *complex24) {
	p, d := primalCoords(), dualCoords()
	return newComplex(p, d), newComplex(d, p)
})

func primal24() *complex24 { p, _ := complexes(); return p }
func dual24() *complex24   { _, d := complexes(); return d }

func (x *complex24) polytope(angles [6]float64, circumradius, edge float64) Polytope24 {
	p := Polytope24{
		Circumradius: circumradius,
		EdgeLength:   edge,
		Source:       make([]Vec4, 24),
		Rotated:      make([]Vec4, 24),
		Points:       make([]Vec3, 24),
		Edges:        append([][2]int(nil), x.edges...),
		Faces:        len(x.faces),
		Cells:        len(x.cells),
	}
	for i := range p.Source {
		p.Source[i] = x.source(i)
		p.Rotated[i] = rotate(p.Source[i], angles)
		v := p.Rotated[i]
		p.Points[i] = Vec3{v[0], v[1], v[2]}
	}
	return p
}

func cell24(q Request, r Result) (Result, error) {
	if q.Mode != "orthographic" && q.Mode != "section" {
		return r, fieldErr("mode", "choose the 24-cell’s orthogonal shadow or parallel sections")
	}
	for i, a := range q.Angles {
		if !finite(a) || math.Abs(a) > 1e6 {
			return r, fieldErr(fmt.Sprintf("angles.%d", i), "rotation angles must be finite and within ±1000000 radians")
		}
	}
	c := q.Cell24
	if c == nil {
		return r, fmt.Errorf("enter the 24-cell's selected cell and view")
	}
	if c.Selected < 0 || c.Selected > 23 {
		return r, fieldErr("cell24.selected", "Selected cell must be from 1 to 24")
	}
	if c.View != "cell" && c.View != "crystal" {
		return r, fieldErr("cell24.view", "show the selected cell or the whole crystal")
	}
	primal, dual := complexes()
	k := c.Selected
	d := &Cell24Diagnostics{
		View:         c.View,
		Selected:     k,
		Primal:       primal.polytope(q.Angles, math.Sqrt2, math.Sqrt2),
		Dual:         dual.polytope(q.Angles, 1, 1),
		CellVertices: append([]int(nil), primal.cells[k][:]...),
		CellEdges:    append([]int(nil), primal.cellEdges[k]...),
		ShadowEdges:  [2]float64{math.Inf(1), 0},
	}
	for e, ends := range dual.edges {
		n := -1
		if ends[0] == k {
			n = ends[1]
		} else if ends[1] == k {
			n = ends[0]
		}
		if n < 0 {
			continue
		}
		var shared []int
		for _, a := range primal.cells[k] {
			for _, b := range primal.cells[n] {
				if a == b {
					shared = append(shared, a)
				}
			}
		}
		sort.Ints(shared)
		d.Neighbors = append(d.Neighbors, n)
		d.NeighborEdges = append(d.NeighborEdges, e)
		d.SharedFaces = append(d.SharedFaces, [3]int{shared[0], shared[1], shared[2]})
	}
	for _, e := range d.CellEdges {
		ends := primal.edges[e]
		s := sub(d.Primal.Points[ends[0]], d.Primal.Points[ends[1]])
		l := math.Sqrt(dot(s, s))
		d.ShadowEdges[0] = math.Min(d.ShadowEdges[0], l)
		d.ShadowEdges[1] = math.Max(d.ShadowEdges[1], l)
	}
	r.Polytope = d
	r.Radius = math.Sqrt2 // the primal's circumradius contains every rotation
	r.Evaluations = cell24Vertices
	r.EmittedPoints = cell24Vertices
	if q.Mode == "section" {
		return cell24Sections(q, r, primal, dual)
	}
	return r, nil
}
