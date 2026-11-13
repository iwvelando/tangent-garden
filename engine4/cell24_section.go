package engine4

import (
	"fmt"
	"math"
	"sort"
	"strings"
)

// Coordinates have fixed scale, radius ≤ sqrt(2). Six plane rotations,
// a level subtraction and edge interpolation round in binary64. 64ε
// times that radius (about 2.01e-14 source units) cover their accumulated
// rounding. This is a contact band, not a grid or a sampling tolerance.
const cell24Contact = 64 * 0x1p-52 * math.Sqrt2
const cell24SectionSpread = 2 * math.Sqrt2
const cell24SectionOffset = 2.025 * math.Sqrt2

// Per object/plane: 96 source edges tested once and 24 cells with 12
// edges each. Each tested edge emits at most two endpoints. This loose
// combined cap includes both objects, contact provenance and families.
const cell24SectionWork = 2 * 25 * (96 + 24*12)
const cell24SectionVertices = 2 * 25 * 192
const cell24SectionFaceIndices = 2 * 25 * 24 * 24

// PairSection stores coordinates in lifted arrays and finite incidence as
// indices. Origins is a source vertex [i,i] or a source edge [i,j]. Every
// vertex retains all containing source cells; facets retain all cells
// contributing the same polygon, including lower-dimensional contacts.
type PairSection struct {
	ID          string      `json:"id"`
	Object      string      `json:"object"`
	Level       float64     `json:"level"`
	Dimension   int         `json:"dimension"`
	Points      []Vec3      `json:"points"`
	FourPoints  []Vec4      `json:"fourPoints"`
	Origins     [][2]int    `json:"origins"`
	VertexCells [][]int     `json:"vertexCells"`
	Edges       [][2]int    `json:"edges"`
	Facets      []PairFacet `json:"facets"`
}
type PairFacet struct {
	Vertices []int `json:"vertices"`
	Cells    []int `json:"cells"`
}

// rank24 is the affine dimension of source vertices, computed exactly on
// doubled integer coordinates: -1 for none, then 0 (vertex) to 3 (cell).
// Rotation preserves it, so contacts are classified by incidence rather
// than by remeasuring rotated, band-snapped points.
func (x *complex24) rank24(ids []int) int { return affineRank(x.coords[:], ids) }

// affineRank is the affine dimension of the integer points coords[ids],
// by exact integer elimination: -1 for none, then 0 to 3.
func affineRank(coords [][4]int, ids []int) int {
	if len(ids) == 0 {
		return -1
	}
	rows := make([][4]int, 0, len(ids)-1)
	for _, i := range ids[1:] {
		var r [4]int
		for j := range r {
			r[j] = coords[i][j] - coords[ids[0]][j]
		}
		rows = append(rows, r)
	}
	rank := 0
	for col := 0; col < 4 && rank < len(rows); col++ {
		p := -1
		for i := rank; i < len(rows); i++ {
			if rows[i][col] != 0 {
				p = i
				break
			}
		}
		if p < 0 {
			continue
		}
		rows[rank], rows[p] = rows[p], rows[rank]
		for i := rank + 1; i < len(rows); i++ {
			f, g := rows[i][col], rows[rank][col]
			for j := range rows[i] {
				rows[i][j] = rows[i][j]*g - rows[rank][j]*f
			}
		}
		rank++
	}
	return rank
}

// cellComplex is the finite incidence a shared-plane section reads from
// either configuration of a dual pair: its edges, each cell's vertices and
// edges, exact affine ranks of source vertices, and each cell's outward
// facet normal (any positive multiple).
type cellComplex interface {
	edgeList() [][2]int
	cellCount() int
	cellVertexIDs(k int) []int
	cellEdgeIDs(k int) []int
	affineRank(ids []int) int
	facetNormal(k int) Vec4
}

func (x *complex24) edgeList() [][2]int        { return x.edges }
func (x *complex24) cellCount() int            { return len(x.cells) }
func (x *complex24) cellVertexIDs(k int) []int { return x.cells[k][:] }
func (x *complex24) cellEdgeIDs(k int) []int   { return x.cellEdges[k] }
func (x *complex24) affineRank(ids []int) int  { return x.rank24(ids) }
func (x *complex24) facetNormal(k int) Vec4    { return x.other(k) }

// normal24 is the unit normal of a polygon contact, from its widest
// cross product; the contact is a resolved source triangle.
func normal24(points []Vec3, ids []int) Vec3 {
	a, best, area := points[ids[0]], Vec3{}, 0.
	for _, i := range ids {
		for _, j := range ids {
			v := cross(sub(points[i], a), sub(points[j], a))
			if d := math.Sqrt(dot(v, v)); d > area {
				best, area = v, d
			}
		}
	}
	return mul3(best, 1/area)
}
func mul3(v Vec3, s float64) Vec3 { return Vec3{v[0] * s, v[1] * s, v[2] * s} }

// Convex polygon in the declared outward orientation. Every point is a
// source vertex in the plane or the crossing of an edge that is not, so
// each is already extreme: none is pruned, however small the polygon, and
// neighboring facets keep the same shared vertices.
func polygon24(points []Vec3, ids []int, normal Vec3) []int {
	center := Vec3{}
	for _, i := range ids {
		for j := range center {
			center[j] += points[i][j] / float64(len(ids))
		}
	}
	u := sub(points[ids[0]], center)
	u = mul3(u, 1/math.Sqrt(dot(u, u)))
	v := cross(normal, u)
	out := append([]int(nil), ids...)
	angle := func(i int) float64 { p := sub(points[i], center); return math.Atan2(dot(p, v), dot(p, u)) }
	sort.Slice(out, func(i, j int) bool { return angle(out[i]) < angle(out[j]) })
	// Canonical first vertex, independent of traversal and atan2's seam.
	first := 0
	for i := range out {
		if out[i] < out[first] {
			first = i
		}
	}
	return append(out[first:], out[:first]...)
}

func (x *complex24) section24(rotated []Vec4, angles [6]float64, h float64, object, id string) PairSection {
	return sectionOf(x, cell24Contact, rotated, angles, h, object, id)
}

// sectionOf intersects one rotated configuration with the plane w = h,
// reading only its incidence. band is the contact band in source units.
func sectionOf(x cellComplex, band float64, rotated []Vec4, angles [6]float64, h float64, object, id string) PairSection {
	s := PairSection{ID: id, Object: object, Level: h, Dimension: -1, Points: []Vec3{}, FourPoints: []Vec4{}, Origins: [][2]int{}, VertexCells: [][]int{}, Edges: [][2]int{}, Facets: []PairFacet{}}
	// Topological deduplication: a contact at a source vertex has the same
	// key on every incident edge; an interior crossing belongs to one edge.
	// Distinct source roles are never merged by projected proximity.
	found := map[[2]int]Vec4{}
	on := func(w float64) bool { return math.Abs(w-h) <= band }
	for _, e := range x.edgeList() {
		a, b := rotated[e[0]], rotated[e[1]]
		if on(a[3]) {
			a[3] = h
			found[[2]int{e[0], e[0]}] = a
		}
		if on(b[3]) {
			b[3] = h
			found[[2]int{e[1], e[1]}] = b
		}
		if !on(a[3]) && !on(b[3]) && (a[3] < h) != (b[3] < h) {
			v := mix(a, b, (h-a[3])/(b[3]-a[3]))
			v[3] = h
			found[e] = v
		}
	}
	origins := make([][2]int, 0, len(found))
	for key := range found {
		origins = append(origins, key)
	}
	sort.Slice(origins, func(i, j int) bool {
		if origins[i][0] != origins[j][0] {
			return origins[i][0] < origins[j][0]
		}
		return origins[i][1] < origins[j][1]
	})

	index := make(map[[2]int]int, len(origins))
	for i, key := range origins {
		p := found[key]
		index[key] = i
		s.Points = append(s.Points, Vec3{p[0], p[1], p[2]})
		s.FourPoints = append(s.FourPoints, p)
		s.Origins = append(s.Origins, key)
		s.VertexCells = append(s.VertexCells, []int{})
	}
	cellVertices := make([][]int, x.cellCount())
	// Read each cell's true incidence. At most two endpoint contacts or
	// one interior crossing come from each of its edges.
	edgeList := x.edgeList()
	for k := range cellVertices {
		ids := map[int]bool{}
		for _, e := range x.cellEdgeIDs(k) {
			ends := edgeList[e]
			for _, key := range [][2]int{{ends[0], ends[0]}, {ends[1], ends[1]}, ends} {
				if i, ok := index[key]; ok {
					ids[i] = true
				}
			}
		}
		for i := range ids {
			cellVertices[k] = append(cellVertices[k], i)
		}
		sort.Ints(cellVertices[k])
		for _, i := range cellVertices[k] {
			s.VertexCells[i] = append(s.VertexCells[i], k)
		}
	}
	all := make([]int, len(s.Points))
	for i := range all {
		all[i] = i
	}
	// A set of source vertices meets the plane across its interior when it
	// has vertices strictly on both sides (beyond the band). Otherwise the
	// contact is exactly the face spanned by its vertices in the band. The
	// same band decided which vertices were snapped, so the two agree.
	contact := func(vertices []int, crossed int) int {
		above, below, in := false, false, []int{}
		for _, i := range vertices {
			switch w := rotated[i][3]; {
			case on(w):
				in = append(in, i)
			case w > h:
				above = true
			default:
				below = true
			}
		}
		if above && below {
			return crossed
		}
		return x.affineRank(in)
	}
	every := make([]int, len(rotated))
	for i := range every {
		every[i] = i
	}
	dimension := contact(every, 3)
	s.Dimension = dimension
	if dimension < 1 {
		return s
	}
	if dimension == 1 {
		// Keep only the two ends and their complete source provenance.
		a, b, d := 0, 0, 0.
		for i, p := range s.Points {
			for j, q := range s.Points {
				v := sub(p, q)
				if dot(v, v) > d {
					a, b, d = i, j, dot(v, v)
				}
			}
		}
		if a > b {
			a, b = b, a
		}
		s.Points = []Vec3{s.Points[a], s.Points[b]}
		s.FourPoints = []Vec4{s.FourPoints[a], s.FourPoints[b]}
		s.Origins = [][2]int{s.Origins[a], s.Origins[b]}
		s.VertexCells = [][]int{s.VertexCells[a], s.VertexCells[b]}
		s.Edges = append(s.Edges, [2]int{0, 1})
		return s
	}
	if dimension == 2 {
		cells := []int{}
		for k := range cellVertices {
			if contact(x.cellVertexIDs(k), 2) == 2 {
				cells = append(cells, k)
			}
		}
		s.Facets = append(s.Facets, PairFacet{Vertices: polygon24(s.Points, all, normal24(s.Points, all)), Cells: cells})
	} else {
		facets := map[string]int{}
		for k, ids := range cellVertices {
			if contact(x.cellVertexIDs(k), 2) != 2 {
				continue
			} // a whole cell is a region, never a face
			n := rotate(x.facetNormal(k), angles)
			outward := Vec3{n[0], n[1], n[2]}
			outward = mul3(outward, 1/math.Sqrt(dot(outward, outward)))
			vertices := polygon24(s.Points, ids, outward)
			keyIDs := append([]int(nil), vertices...)
			sort.Ints(keyIDs)
			key := strings.Trim(fmt.Sprint(keyIDs), "[]")
			if i, ok := facets[key]; ok {
				s.Facets[i].Cells = append(s.Facets[i].Cells, k)
			} else {
				facets[key] = len(s.Facets)
				s.Facets = append(s.Facets, PairFacet{Vertices: vertices, Cells: []int{k}})
			}
		}
	}
	edges := map[[2]int]bool{}
	for _, f := range s.Facets {
		for i, a := range f.Vertices {
			b := f.Vertices[(i+1)%len(f.Vertices)]
			edges[[2]int{min(a, b), max(a, b)}] = true
		}
	}
	for e := range edges {
		s.Edges = append(s.Edges, e)
	}
	sort.Slice(s.Edges, func(i, j int) bool {
		a, b := s.Edges[i], s.Edges[j]
		if a[0] != b[0] {
			return a[0] < b[0]
		}
		return a[1] < b[1]
	})
	return s
}
func cell24Sections(q Request, r Result, primal, dual *complex24) (Result, error) {
	return pairSections(q, r, "cell24", [2]cellComplex{primal, dual}, sectionLimits{
		band:          cell24Contact,
		offset:        cell24SectionOffset,
		spread:        cell24SectionSpread,
		offsetMessage: "slice offset must be within ±2.025√2 (about 2.864)",
		spreadMessage: "section spread must be between 0 and 2√2",
		work:          cell24SectionWork,
		vertices:      cell24SectionVertices,
		faceIndices:   cell24SectionFaceIndices,
	})
}

// sectionLimits are one dual pair's admitted section inputs and its
// combined caps over both configurations and every plane.
type sectionLimits struct {
	band, offset, spread         float64
	offsetMessage, spreadMessage string
	work, vertices, faceIndices  int
}

// pairSections intersects both rotated configurations of a dual pair with
// each plane of the family, under one combined budget.
func pairSections(q Request, r Result, name string, x [2]cellComplex, lim sectionLimits) (Result, error) {
	if !finite(q.Slice) || math.Abs(q.Slice) > lim.offset {
		return r, fieldErr("slice", "%s", lim.offsetMessage)
	}
	if !finite(q.Spread) || q.Spread < 0 || q.Spread > lim.spread {
		return r, fieldErr("spread", "%s", lim.spreadMessage)
	}
	if q.Count < 1 || q.Count > 25 {
		return r, fieldErr("count", "use 1–25 sections")
	}
	visits := [2]int{}
	for j, c := range x {
		visits[j] = len(c.edgeList())
		for k := 0; k < c.cellCount(); k++ {
			visits[j] += len(c.cellEdgeIDs(k))
		}
	}
	vertices, indices, work := 0, 0, 0
	for i := 0; i < q.Count; i++ {
		h := q.Slice
		if q.Count > 1 {
			h += q.Spread * (float64(i)/float64(q.Count-1) - .5)
		}
		for j, c := range x {
			object, p := "primal", r.Polytope.Primal
			if j == 1 {
				object, p = "dual", r.Polytope.Dual
			}
			s := sectionOf(c, lim.band, p.Rotated, q.Angles, h, object, fmt.Sprintf("%s/%s/section/%d", name, object, i))
			vertices += len(s.Points)
			work += visits[j]
			for _, f := range s.Facets {
				indices += len(f.Vertices)
			}
			if work > lim.work || vertices > lim.vertices || indices > lim.faceIndices {
				return r, fieldErr("count", "both section families exceed the combined geometry budget")
			}
			r.Polytope.Sections = append(r.Polytope.Sections, s)
			r.Sections = append(r.Sections, Section{ID: s.ID, Kind: object, Level: h, Dimension: s.Dimension, Vertices: len(s.Points), Edges: len(s.Edges), Faces: len(s.Facets)})
		}
	}
	r.Evaluations += work
	// Geometry lives in the lifted polytope arrays, expanded on the page.
	r.EmittedPoints = vertices
	return r, nil
}
