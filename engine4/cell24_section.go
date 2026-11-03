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

// Section24 stores coordinates in lifted arrays and finite incidence as
// indices. Origins is a source vertex [i,i] or a source edge [i,j]. Every
// vertex retains all containing source cells; facets retain all cells
// contributing the same polygon, including lower-dimensional contacts.
type Section24 struct {
	ID          string    `json:"id"`
	Object      string    `json:"object"`
	Level       float64   `json:"level"`
	Dimension   int       `json:"dimension"`
	Points      []Vec3    `json:"points"`
	FourPoints  []Vec4    `json:"fourPoints"`
	Origins     [][2]int  `json:"origins"`
	VertexCells [][]int   `json:"vertexCells"`
	Edges       [][2]int  `json:"edges"`
	Facets      []Facet24 `json:"facets"`
}
type Facet24 struct {
	Vertices []int `json:"vertices"`
	Cells    []int `json:"cells"`
}

// affine24 measures distances in source length units, even for a tiny
// near-contact polygon: cross products are normalized before comparison.
func affine24(points []Vec3, ids []int) (int, Vec3) {
	if len(ids) == 0 {
		return -1, Vec3{}
	}
	a := points[ids[0]]
	far, length := Vec3{}, 0.
	for _, i := range ids {
		v := sub(points[i], a)
		d := math.Sqrt(dot(v, v))
		if d > length {
			far, length = v, d
		}
	}
	if length <= cell24Contact {
		return 0, Vec3{}
	}
	u := mul3(far, 1/length)
	normal, area := Vec3{}, 0.
	for _, i := range ids {
		v := cross(u, sub(points[i], a))
		d := math.Sqrt(dot(v, v))
		if d > area {
			normal, area = v, d
		}
	}
	if area <= cell24Contact {
		return 1, Vec3{}
	}
	normal = mul3(normal, 1/area)
	for _, i := range ids {
		if math.Abs(dot(normal, sub(points[i], a))) > cell24Contact {
			return 3, normal
		}
	}
	return 2, normal
}
func mul3(v Vec3, s float64) Vec3 { return Vec3{v[0] * s, v[1] * s, v[2] * s} }

// Convex polygon in the declared outward orientation. The cell-edge
// intersection vertices are already extreme, except collinear contacts.
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
	// Remove collinear intermediate vertices without using an area floor
	// that would erase a small, resolved section.
	for changed := true; changed && len(out) > 3; {
		changed = false
		for i, b := range out {
			a, c := out[(i+len(out)-1)%len(out)], out[(i+1)%len(out)]
			ab, ac := sub(points[b], points[a]), sub(points[c], points[a])
			l := math.Sqrt(dot(ac, ac))
			if l > 0 && math.Sqrt(dot(cross(ab, ac), cross(ab, ac)))/l <= cell24Contact {
				out = append(out[:i], out[i+1:]...)
				changed = true
				break
			}
		}
	}
	// Canonical first vertex, independent of traversal and atan2's seam.
	first := 0
	for i := range out {
		if out[i] < out[first] {
			first = i
		}
	}
	return append(out[first:], out[:first]...)
}

func (x *complex24) section24(rotated []Vec4, angles [6]float64, h float64, object, id string) Section24 {
	s := Section24{ID: id, Object: object, Level: h, Dimension: -1, Points: []Vec3{}, FourPoints: []Vec4{}, Origins: [][2]int{}, VertexCells: [][]int{}, Edges: [][2]int{}, Facets: []Facet24{}}
	// Topological deduplication: a contact at a source vertex has the same
	// key on every incident edge; an interior crossing belongs to one edge.
	// Distinct source roles are never merged by projected proximity.
	found := map[[2]int]Vec4{}
	on := func(w float64) bool { return math.Abs(w-h) <= cell24Contact }
	for _, e := range x.edges {
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
	cellVertices := [24][]int{}
	// Read each octahedron's true incidence. At most two endpoint
	// contacts or one interior crossing come from each of its 12 edges.
	for k, edges := range x.cellEdges {
		ids := map[int]bool{}
		for _, e := range edges {
			ends := x.edges[e]
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
	dimension, normal := affine24(s.Points, all)
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
		for k, ids := range cellVertices {
			if d, _ := affine24(s.Points, ids); d == 2 {
				cells = append(cells, k)
			}
		}
		s.Facets = append(s.Facets, Facet24{Vertices: polygon24(s.Points, all, normal), Cells: cells})
	} else {
		facets := map[string]int{}
		for k, ids := range cellVertices {
			if d, _ := affine24(s.Points, ids); d != 2 {
				continue
			} // a whole cell is a region, never a face
			n := rotate(x.other(k), angles)
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
				s.Facets = append(s.Facets, Facet24{Vertices: vertices, Cells: []int{k}})
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
	if !finite(q.Slice) || math.Abs(q.Slice) > cell24SectionOffset {
		return r, fieldErr("slice", "slice offset must be within ±2.025√2 (about 2.864)")
	}
	if !finite(q.Spread) || q.Spread < 0 || q.Spread > cell24SectionSpread {
		return r, fieldErr("spread", "section spread must be between 0 and 2√2")
	}
	if q.Count < 1 || q.Count > 25 {
		return r, fieldErr("count", "use 1–25 sections")
	}
	vertices, indices, work := 0, 0, 0
	for i := 0; i < q.Count; i++ {
		h := q.Slice
		if q.Count > 1 {
			h += q.Spread * (float64(i)/float64(q.Count-1) - .5)
		}
		for j, x := range []*complex24{primal, dual} {
			object, p := "primal", r.Polytope.Primal
			if j == 1 {
				object, p = "dual", r.Polytope.Dual
			}
			s := x.section24(p.Rotated, q.Angles, h, object, fmt.Sprintf("cell24/%s/section/%d", object, i))
			vertices += len(s.Points)
			work += len(x.edges) + 24*12
			for _, f := range s.Facets {
				indices += len(f.Vertices)
			}
			if work > cell24SectionWork || vertices > cell24SectionVertices || indices > cell24SectionFaceIndices {
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
