package engine

import (
	"math"
	"math/cmplx"
)

// LaceTiling names the one regular tiling: Schläfli symbol {7,3}, seven-sided
// tiles meeting three at each vertex. See docs/mathematics.md, Hyperbolic lace.
const LaceTiling = "7,3"

const (
	LaceMaxDepth      = 8
	LaceMaxTiles      = 1000
	LaceMaxCandidates = 10000
	// LaceStrokes is the motif's geodesic segments in each tile.
	LaceStrokes = 14
)

// LaceRequest asks for a finite patch of the {7,3} tiling of the Poincaré
// disk, grown from the centered tile by reflection across its edges.
// StarPoint places the motif's turning points, as a fraction of the
// hyperbolic distance from a tile's center to its corners.
type LaceRequest struct {
	Tiling    string  `json:"tiling"`
	Depth     int     `json:"depth"`
	MaxTiles  int     `json:"maxTiles"`
	StarPoint float64 `json:"starPoint"`
}

// LaceOmitted counts distinct candidate tiles left out: beyond the depth, or
// unresolved near the rim (see lacePrecision).
type LaceOmitted struct {
	Depth     int `json:"depth"`
	Precision int `json:"precision"`
}

// LaceResult holds a finite patch in breadth-first order as parallel arrays,
// in model units where the disk's rim is the unit circle.
//
// Tile i is T_i(seed) for its transformation T_i(z) = (a·w + b)/(b̄·w + ā),
// where w is z, or its conjugate when Reversed: Transform holds
// [Re a, Im a, Re b, Im b] with |a|² − |b|² = 1. Tile 0 is the seed, the
// identity. Parent and Via give the tile that was reflected and the edge of
// it that was crossed, −1 for the seed; following them back to the seed
// gives the tile's address. Corner k of a tile is the image of the seed's
// vertex k, so a reversed tile's corners run clockwise; Corners and Sides
// hold seven vertex and edge indices per tile, side k joining corners k and
// k + 1.
//
// Each vertex and edge is stored once. VertexTiles and EdgeTiles count the
// patch's tiles around them: three and two in the interior, fewer on the
// patch's boundary. An edge lies on the circle orthogonal to the rim with
// EdgeCenter and EdgeRadius, or on a diameter when EdgeStraight (center and
// radius zero). Motif arcs are geodesic segments, LaceStrokes per tile in
// tile order, stored the same way between ArcStart and ArcEnd; on a circle
// each is its minor arc.
type LaceResult struct {
	Tiling       string       `json:"tiling"`
	Center       []Vec        `json:"center"`
	Depth        []float64    `json:"depth"`
	Parent       []float64    `json:"parent"`
	Via          []float64    `json:"via"`
	Reversed     []bool       `json:"reversed"`
	Transform    [][4]float64 `json:"transform"`
	Corners      []float64    `json:"corners"`
	Sides        []float64    `json:"sides"`
	Vertex       []Vec        `json:"vertex"`
	VertexTiles  []float64    `json:"vertexTiles"`
	EdgeA        []float64    `json:"edgeA"`
	EdgeB        []float64    `json:"edgeB"`
	EdgeTiles    []float64    `json:"edgeTiles"`
	EdgeCenter   []Vec        `json:"edgeCenter"`
	EdgeRadius   []float64    `json:"edgeRadius"`
	EdgeStraight []bool       `json:"edgeStraight"`
	ArcStart     []Vec        `json:"arcStart"`
	ArcEnd       []Vec        `json:"arcEnd"`
	ArcCenter    []Vec        `json:"arcCenter"`
	ArcRadius    []float64    `json:"arcRadius"`
	ArcStraight  []bool       `json:"arcStraight"`
	Omitted      LaceOmitted  `json:"omitted"`
	// Stopped is "count" or "candidates" when that ceiling ended generation
	// with Pending tiles not fully expanded, else "".
	Stopped string `json:"stopped"`
	Pending int    `json:"pending"`
	// Processed counts candidate tiles examined; Duplicates those that were
	// already in the patch.
	Processed  int `json:"processed"`
	Duplicates int `json:"duplicates"`
	// The seed's measures: Euclidean corner radius, and the hyperbolic
	// circumradius, apothem and side length every tile shares.
	VertexRadius float64 `json:"vertexRadius"`
	Circumradius float64 `json:"circumradius"`
	Apothem      float64 `json:"apothem"`
	SideLength   float64 `json:"sideLength"`
}

// The near-rim precision policy (docs/mathematics.md, Hyperbolic lace). A
// candidate tile is unresolved, and left out and never expanded,
// when a corner has 1 − |z|² below floor, or when a corner it shares with
// tiles already admitted disagrees with them by more than agreement in
// hyperbolic distance.
type lacePrecision struct{ floor, agreement float64 }

var lacePolicy = lacePrecision{floor: 1e-7, agreement: 1e-9}

type laceLimits struct {
	depth, candidates int
	precision         lacePrecision
}

func ComputeLace(q LaceRequest) (LaceResult, error) {
	if err := q.validate(); err != nil {
		return LaceResult{}, err
	}
	return computeLace(q, laceLimits{q.Depth, LaceMaxCandidates, lacePolicy}), nil
}

func (q LaceRequest) validate() error {
	if q.Tiling != LaceTiling {
		return fieldErr("tiling", "choose the {7,3} tiling")
	}
	if q.Depth < 0 || q.Depth > LaceMaxDepth {
		return fieldErr("depth", "depth must be 0–%d reflections", LaceMaxDepth)
	}
	if q.MaxTiles < 1 || q.MaxTiles > LaceMaxTiles {
		return fieldErr("maxTiles", "tile count must be 1–%d", LaceMaxTiles)
	}
	if !finite(q.StarPoint) || q.StarPoint < 0 || q.StarPoint > 1 {
		return fieldErr("starPoint", "star point must be 0–1")
	}
	return nil
}

// mobius is a disk automorphism z ↦ (a·w + b)/(b̄·w + ā), with w = z̄ when
// odd, normalized so that |a|² − |b|² = 1.
type mobius struct {
	a, b complex128
	odd  bool
}

func (m mobius) apply(z complex128) complex128 {
	if m.odd {
		z = cmplx.Conj(z)
	}
	return (m.a*z + m.b) / (cmplx.Conj(m.b)*z + cmplx.Conj(m.a))
}

// then is m∘s. Conjugation passes through s's matrix by conjugating it.
func (m mobius) then(s mobius) mobius {
	a, b := s.a, s.b
	if m.odd {
		a, b = cmplx.Conj(a), cmplx.Conj(b)
	}
	return mobius{
		a:   m.a*a + m.b*cmplx.Conj(b),
		b:   m.a*b + m.b*cmplx.Conj(a),
		odd: m.odd != s.odd,
	}
}

// inverse is m⁻¹. An even map's inverse matrix is (ā, −b); an odd map's
// inverse conjugates that, (a, −b̄), and stays odd.
func (m mobius) inverse() mobius {
	if m.odd {
		return mobius{a: m.a, b: -cmplx.Conj(m.b), odd: true}
	}
	return mobius{a: cmplx.Conj(m.a), b: -m.b}
}

// inversion is reflection in the circle with center c orthogonal to the
// rim, of radius ρ = √(|c|² − 1): z ↦ c + ρ²/(z̄ − c̄) = (c·z̄ − 1)/(z̄ − c̄),
// scaled by i/ρ into the normalized form.
func inversion(c complex128) mobius {
	rho := math.Sqrt(real(c)*real(c) + imag(c)*imag(c) - 1)
	return mobius{a: complex(0, 1/rho) * c, b: complex(0, -1/rho), odd: true}
}

// The seed tile: the regular heptagon centered at the origin with interior
// angles 2π/3, a corner straight up and corners counterclockwise.
type laceSeed struct {
	vertex  [7]complex128
	reflect [7]mobius
	// Edge midpoints and the motif's turning points, and the reflection in
	// each motif stroke's geodesic.
	mid, star                     [7]complex128
	strokes                       [LaceStrokes]mobius
	vertexRadius                  float64
	circumradius, apothem, length float64
}

// newLaceSeed derives the heptagon from its right triangle (center, edge
// midpoint, corner), with angles π/7 at the center and π/3 at the corner:
// cosh R = cot(π/7)·cot(π/3) for the circumradius, cosh h =
// cos(π/3)/sin(π/7) for the apothem and cosh(s/2) = cos(π/7)/sin(π/3) for
// the side. A point at hyperbolic distance d from the origin lies at
// Euclidean radius tanh(d/2) in the metric 4|dz|²/(1 − |z|²)².
func newLaceSeed(starPoint float64) laceSeed {
	const p, q = 7.0, 3.0
	var s laceSeed
	s.circumradius = math.Acosh(1 / (math.Tan(math.Pi/p) * math.Tan(math.Pi/q)))
	s.apothem = math.Acosh(math.Cos(math.Pi/q) / math.Sin(math.Pi/p))
	s.length = 2 * math.Acosh(math.Cos(math.Pi/p)/math.Sin(math.Pi/q))
	s.vertexRadius = math.Tanh(s.circumradius / 2)
	m := math.Tanh(s.apothem / 2)
	t := math.Tanh(starPoint * s.circumradius / 2)
	for k := range 7 {
		angle := math.Pi/2 + 2*math.Pi*float64(k)/p
		s.vertex[k] = cmplx.Rect(s.vertexRadius, angle)
		s.mid[k] = cmplx.Rect(m, angle+math.Pi/p)
		// Side k's turning point lies toward corner k + 1.
		s.star[k] = cmplx.Rect(t, angle+2*math.Pi/p)
		// Side k's geodesic, orthogonal to the rim through corners k and
		// k + 1, has its center on the bisector at D with D² = 1 + ρ² and
		// |D − corner|² = ρ²: D = (1 + r²)/(2r·cos(π/7)).
		r := s.vertexRadius
		s.reflect[k] = inversion(cmplx.Rect((1+r*r)/(2*r*math.Cos(math.Pi/p)), angle+math.Pi/p))
	}
	for k := range 7 {
		s.strokes[2*k] = mirror(s.mid[k], s.star[k])
		s.strokes[2*k+1] = mirror(s.star[k], s.mid[(k+1)%7])
	}
	return s
}

// mirror is the reflection in the geodesic through two points of the seed
// tile, where the formula of geodesic is well conditioned: inversion in its
// circle, or for a diameter at angle φ, z ↦ e^{2iφ}·z̄.
func mirror(z, w complex128) mobius {
	c, _, straight := geodesic(z, w)
	if !straight {
		return inversion(c)
	}
	if cmplx.Abs(w) > cmplx.Abs(z) {
		z = w
	}
	return mobius{a: cmplx.Rect(1, cmplx.Phase(z)), odd: true}
}

// line is the geodesic of the reflection g·m·g⁻¹, the image under g of the
// geodesic m reflects in, drawn between z and w. A normalized reflection
// (A, B) is inversion in the circle of center −A/B and radius 1/|B|
// (see inversion), and a diameter's has B = 0. This reads the circle off
// the transformations that place the tiles, rather than solving for it
// from two nearby points, which loses accuracy near the rim. It is called
// straight when the circle would differ from the chord by less than 10⁻¹²,
// its sagitta |z − w|²·|B|/8.
func line(g, m mobius, z, w complex128) (c complex128, radius float64, straight bool) {
	h := g.then(m).then(g.inverse())
	chord := cmplx.Abs(z - w)
	if chord*chord*cmplx.Abs(h.b) <= 8e-12 {
		return 0, 0, true
	}
	return -h.a / h.b, 1 / cmplx.Abs(h.b), false
}

// hyperbolic is the distance between z and w in the disk's metric,
// 2 asinh(|z − w| / √((1 − |z|²)(1 − |w|²))), accurate for near points.
func hyperbolic(z, w complex128) float64 {
	return 2 * math.Asinh(cmplx.Abs(z-w)/math.Sqrt(rimGap(z)*rimGap(w)))
}

// rimGap is 1 − |z|², computed as (1 − |z|)(1 + |z|).
func rimGap(z complex128) float64 {
	r := cmplx.Abs(z)
	return (1 - r) * (1 + r)
}

// geodesic is the line of the disk through z and w: the circle orthogonal
// to the rim through them, whose center c has 2c·z = 1 + |z|² and
// 2c·w = 1 + |w|², or a diameter when z, w and the origin are collinear.
// It is called straight when the circle would differ from the chord by
// less than 10⁻¹², its sagitta |z − w|²/(8ρ), far below a drawn unit at
// any zoom.
func geodesic(z, w complex128) (c complex128, radius float64, straight bool) {
	det := real(z)*imag(w) - imag(z)*real(w)
	u := (1 + real(z)*real(z) + imag(z)*imag(z)) / 2
	v := (1 + real(w)*real(w) + imag(w)*imag(w)) / 2
	nx := u*imag(w) - v*imag(z)
	ny := v*real(z) - u*real(w)
	chord := cmplx.Abs(z - w)
	if chord*chord*math.Abs(det) <= 8e-12*math.Hypot(nx, ny) {
		return 0, 0, true
	}
	c = complex(nx/det, ny/det)
	return c, math.Sqrt(real(c)*real(c) + imag(c)*imag(c) - 1), false
}

// diskGrid finds stored points near a point, by cells of a square grid.
type diskGrid struct {
	cell  float64
	cells map[[2]int32][]int
}

func newDiskGrid() diskGrid { return diskGrid{1.0 / 16, map[[2]int32][]int{}} }

func (g diskGrid) key(z complex128) [2]int32 {
	return [2]int32{int32(math.Floor(real(z) / g.cell)), int32(math.Floor(imag(z) / g.cell))}
}

func (g diskGrid) add(z complex128, i int) {
	k := g.key(z)
	g.cells[k] = append(g.cells[k], i)
}

// near returns the stored point within hyperbolic distance d of z that is
// nearest, or −1. A hyperbolic disk of radius d about z, with τ = tanh(d/2),
// is a Euclidean disk of radius (1 − |z|²)τ/(1 − |z|²τ²) whose center lies
// |z|τ²(1 − |z|²)/(1 − |z|²τ²) nearer the origin, so none of it is farther
// from z than their sum, (1 − |z|²)τ/(1 − |z|τ): the cells to search.
func (g diskGrid) near(z complex128, d float64, at func(int) complex128) (int, float64) {
	tau := math.Tanh(d / 2)
	r2 := real(z)*real(z) + imag(z)*imag(z)
	reach := (1 - r2) * tau / (1 - math.Sqrt(r2)*tau)
	lo := g.key(z - complex(reach, reach))
	hi := g.key(z + complex(reach, reach))
	best, bestD := -1, d
	for x := lo[0]; x <= hi[0]; x++ {
		for y := lo[1]; y <= hi[1]; y++ {
			for _, i := range g.cells[[2]int32{x, y}] {
				if e := hyperbolic(z, at(i)); e <= bestD {
					best, bestD = i, e
				}
			}
		}
	}
	return best, bestD
}

// Breadth-first over tiles: each admitted tile's neighbor across side j is
// its transformation followed by the seed's reflection in side j. Sides
// are taken in index order, skipping the one crossed to reach the tile,
// whose reflection is the parent. The first transformation to reach a
// tile is kept; later ones are duplicates.
func computeLace(q LaceRequest, limits laceLimits) LaceResult {
	seed := newLaceSeed(q.StarPoint)
	r := LaceResult{
		Tiling:       q.Tiling,
		VertexRadius: seed.vertexRadius,
		Circumradius: seed.circumradius,
		Apothem:      seed.apothem,
		SideLength:   seed.length,
	}
	type tile struct {
		g       mobius
		corners [7]int
		depth   int
		via     int
	}
	var tiles []tile
	vertices := []complex128{}
	at := func(i int) complex128 { return vertices[i] }
	centers := []complex128{}
	center := func(i int) complex128 { return centers[i] }
	vertexGrid, tileGrid := newDiskGrid(), newDiskGrid()
	// Candidates already left out, so that each counts once.
	left := []complex128{}
	leftAt := func(i int) complex128 { return left[i] }
	leftGrid := newDiskGrid()
	// Distinct tile centers are 2h apart, and distinct vertices s apart:
	// a point within half of that is the same one.
	sameTile, sameVertex := seed.apothem, seed.length/2
	edges := map[[2]int]int{}
	admit := func(g mobius, corners [7]int, depth, parent, via int) {
		i := len(tiles)
		tiles = append(tiles, tile{g, corners, depth, via})
		c := g.apply(0)
		centers = append(centers, c)
		tileGrid.add(c, i)
		r.Center = append(r.Center, Vec{real(c), imag(c)})
		r.Depth = append(r.Depth, float64(depth))
		r.Parent = append(r.Parent, float64(parent))
		r.Via = append(r.Via, float64(via))
		r.Reversed = append(r.Reversed, g.odd)
		r.Transform = append(r.Transform, [4]float64{real(g.a), imag(g.a), real(g.b), imag(g.b)})
		for k := range 7 {
			v := corners[k]
			r.Corners = append(r.Corners, float64(v))
			r.VertexTiles[v]++
			a, b := v, corners[(k+1)%7]
			key := [2]int{min(a, b), max(a, b)}
			e, ok := edges[key]
			if !ok {
				e = len(r.EdgeA)
				edges[key] = e
				c, radius, straight := line(g, seed.reflect[k], vertices[a], vertices[b])
				r.EdgeA = append(r.EdgeA, float64(a))
				r.EdgeB = append(r.EdgeB, float64(b))
				r.EdgeTiles = append(r.EdgeTiles, 0)
				r.EdgeCenter = append(r.EdgeCenter, Vec{real(c), imag(c)})
				r.EdgeRadius = append(r.EdgeRadius, radius)
				r.EdgeStraight = append(r.EdgeStraight, straight)
			}
			r.EdgeTiles[e]++
			r.Sides = append(r.Sides, float64(e))
		}
		for k := range 7 {
			m, s, next := g.apply(seed.mid[k]), g.apply(seed.star[k]), g.apply(seed.mid[(k+1)%7])
			for half, ends := range [2][2]complex128{{m, s}, {s, next}} {
				c, radius, straight := line(g, seed.strokes[2*k+half], ends[0], ends[1])
				r.ArcStart = append(r.ArcStart, Vec{real(ends[0]), imag(ends[0])})
				r.ArcEnd = append(r.ArcEnd, Vec{real(ends[1]), imag(ends[1])})
				r.ArcCenter = append(r.ArcCenter, Vec{real(c), imag(c)})
				r.ArcRadius = append(r.ArcRadius, radius)
				r.ArcStraight = append(r.ArcStraight, straight)
			}
		}
	}
	// vertex is the stored vertex at z, −1 for a new one, or false when z
	// is neither the same as a stored vertex nor clearly distinct from them.
	// A tile's own corners are s apart, so they never match each other.
	vertex := func(z complex128) (int, bool) {
		i, d := vertexGrid.near(z, sameVertex, at)
		return i, i < 0 || d <= limits.precision.agreement
	}
	identity := mobius{a: 1}
	var seedCorners [7]int
	for k := range 7 {
		seedCorners[k] = len(vertices)
		vertexGrid.add(seed.vertex[k], len(vertices))
		vertices = append(vertices, seed.vertex[k])
		r.Vertex = append(r.Vertex, Vec{real(seed.vertex[k]), imag(seed.vertex[k])})
		r.VertexTiles = append(r.VertexTiles, 0)
	}
	if q.MaxTiles > 0 {
		admit(identity, seedCorners, 0, -1, -1)
	}
	for head := 0; head < len(tiles); head++ {
		t := tiles[head]
		for j := range 7 {
			if j == t.via {
				continue
			}
			if r.Processed == limits.candidates {
				r.Stopped, r.Pending = "candidates", len(tiles)-head
				return r
			}
			r.Processed++
			g := t.g.then(seed.reflect[j])
			c := g.apply(0)
			if i, _ := tileGrid.near(c, sameTile, center); i >= 0 {
				if !sameCorners(g, seed, tiles[i].corners, vertices, limits.precision.agreement) {
					if leftOnce(&left, leftGrid, leftAt, c, sameTile) {
						r.Omitted.Precision++
					}
					continue
				}
				r.Duplicates++
				continue
			}
			depth := t.depth + 1
			if depth > limits.depth {
				if leftOnce(&left, leftGrid, leftAt, c, sameTile) {
					r.Omitted.Depth++
				}
				continue
			}
			var corners [7]int
			var placed [7]complex128
			resolved := true
			for k := range 7 {
				placed[k] = g.apply(seed.vertex[k])
				var ok bool
				corners[k], ok = vertex(placed[k])
				if !ok || rimGap(placed[k]) < limits.precision.floor {
					resolved = false
					break
				}
			}
			// The two corners on the crossed side are the parent's.
			if resolved && (corners[j] != t.corners[j] || corners[(j+1)%7] != t.corners[(j+1)%7]) {
				resolved = false
			}
			if !resolved {
				if leftOnce(&left, leftGrid, leftAt, c, sameTile) {
					r.Omitted.Precision++
				}
				continue
			}
			if len(tiles) == q.MaxTiles {
				r.Stopped, r.Pending = "count", len(tiles)-head
				return r
			}
			for k, v := range corners {
				if v < 0 {
					corners[k] = len(vertices)
					vertexGrid.add(placed[k], len(vertices))
					vertices = append(vertices, placed[k])
					r.Vertex = append(r.Vertex, Vec{real(placed[k]), imag(placed[k])})
					r.VertexTiles = append(r.VertexTiles, 0)
				}
			}
			admit(g, corners, depth, head, j)
		}
	}
	return r
}

// sameCorners reports whether g's corners are, as a set, the stored corners
// of a tile, each within agreement: a duplicate reached by another
// transformation, which may label its corners differently.
func sameCorners(g mobius, seed laceSeed, corners [7]int, vertices []complex128, agreement float64) bool {
	for k := range 7 {
		z := g.apply(seed.vertex[k])
		found := false
		for _, v := range corners {
			if hyperbolic(z, vertices[v]) <= agreement {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

// leftOnce records a left-out candidate's center, reporting whether it is
// new.
func leftOnce(left *[]complex128, grid diskGrid, at func(int) complex128, c complex128, same float64) bool {
	if i, _ := grid.near(c, same, at); i >= 0 {
		return false
	}
	grid.add(c, len(*left))
	*left = append(*left, c)
	return true
}
