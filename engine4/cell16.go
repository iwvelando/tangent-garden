package engine4

import (
	"fmt"
	"math"
	"math/bits"
	"slices"
	"sort"
	"sync"
)

// The tesseract and its polar 16-cell, a dual pair that is not self-dual,
// with exact incidence.
//
// The primal C = [−1, 1]⁴ is the tesseract of the notebook's own object:
// its 16 vertices v are (±1, ±1, ±1, ±1), with circumradius 2, edge length
// 2 and inradius 1. Its polar C° = {x : x·v ≤ 1 for every v} = {x : Σ|xᵢ| ≤
// 1} is the 16-cell, the convex hull of the 8 points u = ±eᵢ, with
// circumradius 1, edge length √2 and inradius ½. Conversely C = {x : u·x ≤
// 1 for every u}. Each u is a facet normal of C: the cube C ∩ {u·x = 1} is
// centered on u itself. Each v is a facet normal of C°: the tetrahedron
// C° ∩ {v·x = 1} is centered on v/4, not on v. No scaling makes both
// directions coincide, so only the cube's center is a vertex of the other.
//
// Every coordinate is an integer, so incidence is exact: a vertex lies in a
// cell when its product with the cell's normal is 1. Faces are closures,
// read from that incidence rather than from counts or lengths: the face a
// set of vertices spans holds every vertex lying in all the cells that
// hold the set. Edges are pairs that are their own closure; 2-faces are
// closures of affine rank 2. Vertices are numbered in descending
// lexicographic order of their coordinates, edges and 2-faces are
// ascending ID tuples in lexicographic order, and cell k of either
// configuration is the cell whose normal is vertex k of the other.

// lattice4 is one configuration of a dual pair with integer coordinates:
// its vertices, each cell's normal (the cell is {x : normal·x = 1}), and
// the incidence derived from them.
type lattice4 struct {
	coords    [][4]int
	normals   [][4]int
	edges     [][2]int
	faces     [][]int // 2-faces, ascending vertex IDs
	cells     [][]int // ascending vertex IDs
	cellEdges [][]int
	cellFaces [][]int
}

func (x *lattice4) source(i int) Vec4 { return whole(x.coords[i]) }

func whole(c [4]int) Vec4 {
	return Vec4{float64(c[0]), float64(c[1]), float64(c[2]), float64(c[3])}
}

func (x *lattice4) edgeList() [][2]int        { return x.edges }
func (x *lattice4) cellCount() int            { return len(x.cells) }
func (x *lattice4) cellVertexIDs(k int) []int { return x.cells[k] }
func (x *lattice4) cellEdgeIDs(k int) []int   { return x.cellEdges[k] }
func (x *lattice4) affineRank(ids []int) int  { return affineRank(x.coords, ids) }
func (x *lattice4) facetNormal(k int) Vec4    { return whole(x.normals[k]) }

// newLattice derives a configuration's incidence from its vertices and its
// cells' normals. Every vertex must satisfy every inequality normal·x ≤ 1.
func newLattice(coords, normals [][4]int) *lattice4 {
	if len(coords) > 64 || len(normals) > 64 {
		panic("lattice4 holds at most 64 vertices and cells")
	}
	x := &lattice4{coords: coords, normals: normals}
	in := make([]uint64, len(coords)) // the cells holding each vertex
	for k, n := range normals {
		for i, v := range coords {
			switch d := idot(n, v); {
			case d == 1:
				in[i] |= 1 << k
			case d > 1:
				panic("vertex outside a cell's inequality")
			}
		}
	}
	// The vertices in every cell of the set, as a bit set.
	closure := func(cells uint64) (out uint64) {
		for j := range coords {
			if in[j]&cells == cells {
				out |= 1 << j
			}
		}
		return
	}
	ids := func(set uint64) (out []int) {
		for set != 0 {
			out = append(out, bits.TrailingZeros64(set))
			set &= set - 1
		}
		return
	}
	n := len(coords)
	seen := map[uint64]bool{}
	for i := 0; i < n; i++ {
		for j := i + 1; j < n; j++ {
			if m := in[i] & in[j]; m != 0 && closure(m) == 1<<i|1<<j {
				x.edges = append(x.edges, [2]int{i, j})
			}
			for l := j + 1; l < n; l++ {
				m := in[i] & in[j] & in[l]
				if m == 0 {
					continue
				}
				face := closure(m)
				if !seen[face] && affineRank(coords, ids(face)) == 2 {
					seen[face] = true
					x.faces = append(x.faces, ids(face))
				}
			}
		}
	}
	sort.Slice(x.faces, func(a, b int) bool { return slices.Compare(x.faces[a], x.faces[b]) < 0 })
	for k := range normals {
		x.cells = append(x.cells, ids(closure(1<<k)))
		var edges, faces []int
		for e, ends := range x.edges {
			if in[ends[0]]&in[ends[1]]&(1<<k) != 0 {
				edges = append(edges, e)
			}
		}
		for f, vs := range x.faces {
			all := true
			for _, v := range vs {
				all = all && in[v]&(1<<k) != 0
			}
			if all {
				faces = append(faces, f)
			}
		}
		x.cellEdges = append(x.cellEdges, edges)
		x.cellFaces = append(x.cellFaces, faces)
	}
	return x
}

// opposite pairs each vertex of a centrally symmetric cell with the vertex
// across its center, v + v′ = 2c, in exact arithmetic: the cell's
// diagonals, lower ID first, in order of that ID. A cell without central
// symmetry (a tetrahedron) has none.
func (x *lattice4) opposite(k int) [][2]int {
	cell := x.cells[k]
	var sum [4]int
	for _, v := range cell {
		for i := range sum {
			sum[i] += x.coords[v][i]
		}
	}
	var out [][2]int
	for _, a := range cell {
		for _, b := range cell {
			if b <= a {
				continue
			}
			ok := true
			for i := range sum {
				ok = ok && len(cell)*(x.coords[a][i]+x.coords[b][i]) == 2*sum[i]
			}
			if ok {
				out = append(out, [2]int{a, b})
			}
		}
	}
	if 2*len(out) != len(cell) {
		return nil
	}
	return out
}

// descendingCoords orders integer points in descending lexicographic order.
func descendingCoords(c [][4]int) [][4]int {
	sort.Slice(c, func(i, j int) bool {
		for k := 0; k < 4; k++ {
			if c[i][k] != c[j][k] {
				return c[i][k] > c[j][k]
			}
		}
		return false
	})
	return c
}

var pairs16 = sync.OnceValues(func() (*lattice4, *lattice4) {
	var tesseract, cross [][4]int
	for m := 0; m < 16; m++ {
		var v [4]int
		for i := range v {
			v[i] = 1 - 2*(m>>i&1)
		}
		tesseract = append(tesseract, v)
	}
	for i := 0; i < 4; i++ {
		for _, s := range []int{-1, 1} {
			var v [4]int
			v[i] = s
			cross = append(cross, v)
		}
	}
	tesseract, cross = descendingCoords(tesseract), descendingCoords(cross)
	return newLattice(tesseract, cross), newLattice(cross, tesseract)
})

// pair16 is the tesseract and its polar 16-cell.
func pair16() (primal, dual *lattice4) { return pairs16() }

// Fixed bounds of the finite study: 24 vertex shadows and 56 edges. The
// page draws at most both edge sets and the selected cube's 4 diagonals
// (an edge drawn in a selected role is not drawn again), and 8 centers.
const (
	cell16Vertices   = 16 + 8
	cell16Edges      = 32 + 24
	cell16DrawnPaths = 32 + 24 + 4
)

// Both configurations lie in the ball of radius 2, the tesseract's own:
// its source radius, perspective limits and framing apply unchanged.
const cell16Radius = 2

// Sections: a contact band for the fixed radius 2 (see cell24Contact), the
// tesseract's offset and spread limits, and caps over both configurations
// and 25 planes. Per plane the tesseract tests 32 edges and visits its 8
// cubes' 12 edges, the 16-cell 24 edges and its 16 tetrahedra's 6; each
// tested edge emits at most two endpoints, and each cell at most two per
// cell edge.
const (
	cell16Contact            = 64 * 0x1p-52 * cell16Radius
	cell16SectionWork        = 25 * (32 + 8*12 + 24 + 16*6)
	cell16SectionVertices    = 25 * 2 * (32 + 24)
	cell16SectionFaceIndices = 25 * (8*2*12 + 16*2*6)
)

func (x *lattice4) polytope(angles [6]float64, distance, circumradius, edge float64) PairPolytope {
	p := PairPolytope{
		Circumradius: circumradius,
		EdgeLength:   edge,
		Source:       make([]Vec4, len(x.coords)),
		Rotated:      make([]Vec4, len(x.coords)),
		Points:       make([]Vec3, len(x.coords)),
		Edges:        append([][2]int(nil), x.edges...),
		Faces:        len(x.faces),
		Cells:        len(x.cells),
	}
	for i := range p.Source {
		p.Source[i] = x.source(i)
		p.Rotated[i] = rotate(p.Source[i], angles)
		p.Points[i] = project24(p.Rotated[i], distance)
	}
	return p
}

func cell16(q Request, r Result) (Result, error) {
	if q.Mode != "orthographic" && q.Mode != "perspective" && q.Mode != "section" {
		return r, fieldErr("mode", "choose the orthogonal or perspective shadow of the tesseract and 16-cell, or parallel sections")
	}
	for i, a := range q.Angles {
		if !finite(a) || math.Abs(a) > 1e6 {
			return r, fieldErr(fmt.Sprintf("angles.%d", i), "rotation angles must be finite and within ±1000000 radians")
		}
	}
	// Validate the active construction only, as for the 24-cell.
	distance := 0.
	if q.Mode == "perspective" {
		if !finite(q.Distance) || q.Distance < 2.05 || q.Distance > 20 {
			return r, fieldErr("distance", "4D eye distance must be between 2.05 and 20")
		}
		distance = q.Distance
	}
	c := q.Cell16
	if c == nil {
		return r, fmt.Errorf("enter the tesseract's selected cell and view")
	}
	if c.Selected < 0 || c.Selected > 7 {
		return r, fieldErr("cell16.selected", "Selected cube must be from 1 to 8")
	}
	if c.View != "cell" && c.View != "crystal" {
		return r, fieldErr("cell16.view", "show the selected cell or both whole polytopes")
	}
	primal, dual := pair16()
	k := c.Selected
	d := &PairDiagnostics{
		View:        c.View,
		Selected:    k,
		Primal:      primal.polytope(q.Angles, distance, 2, 2),
		Dual:        dual.polytope(q.Angles, distance, 1, math.Sqrt2),
		CellEdges:   append([]int(nil), primal.cellEdges[k]...),
		ShadowEdges: [2]float64{math.Inf(1), 0},
	}
	for _, pair := range primal.opposite(k) {
		d.CellVertices = append(d.CellVertices, pair[0], pair[1])
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
		// The square the two cubes share: their cells' common vertices.
		shared := []int{}
		for _, a := range primal.cells[k] {
			if slices.Contains(primal.cells[n], a) {
				shared = append(shared, a)
			}
		}
		d.Neighbors = append(d.Neighbors, n)
		d.NeighborEdges = append(d.NeighborEdges, e)
		d.SharedFaces = append(d.SharedFaces, shared)
	}
	for _, e := range d.CellEdges {
		ends := primal.edges[e]
		s := sub(d.Primal.Points[ends[0]], d.Primal.Points[ends[1]])
		l := math.Sqrt(dot(s, s))
		d.ShadowEdges[0] = math.Min(d.ShadowEdges[0], l)
		d.ShadowEdges[1] = math.Max(d.ShadowEdges[1], l)
	}
	r.Polytope = d
	r.Radius = cell16Radius
	if distance != 0 {
		// The tesseract's bound: R d/√(d² − R²) with R = 2.
		r.Radius = cell16Radius * distance / math.Sqrt(distance*distance-cell16Radius*cell16Radius)
	}
	r.Evaluations = cell16Vertices
	r.EmittedPoints = cell16Vertices
	if q.Mode == "section" {
		return pairSections(q, r, "cell16", [2]cellComplex{primal, dual}, sectionLimits{
			band:          cell16Contact,
			offset:        maxSlice,
			spread:        4,
			offsetMessage: "slice offset must be within ±4.05",
			spreadMessage: "section spread must be between 0 and 4",
			work:          cell16SectionWork,
			vertices:      cell16SectionVertices,
			faceIndices:   cell16SectionFaceIndices,
		})
	}
	return r, nil
}
