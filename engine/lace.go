package engine

import (
	"math"
	"math/cmplx"
)

// LaceTiling names the default regular tiling: Schläfli symbol {7,3},
// seven-sided tiles meeting three at each vertex. LaceRequest.Tiling names
// one of laceTilings; see docs/mathematics.md, Hyperbolic lace.
const LaceTiling = "7,3"

// laceTiling is a regular tiling {p,q}: p-sided tiles meeting q at each
// vertex, hyperbolic when (p − 2)(q − 2) > 4. The angles π/p and π/q are
// constants folded exactly by the compiler, as the {7,3} seed always used
// them, so its tiles are unchanged to the last bit. maxDepth is the
// deepest patch a request may ask for. gallery bounds how far a tile's
// address path strays from the straight line to it, in hyperbolic
// distance, with headroom over the most measured (TestLaceAddressPathsHugTheirLine):
// 1.07, 1.71, 1.13 and 0.80 on unlimited patches to depth 10, 10, 11 and 16.
type laceTiling struct {
	p, q             int
	piOverP, piOverQ float64
	maxDepth         int
	gallery          float64
}

// laceTilings is the catalog: {7,3}, {5,4}, and their duals {3,7} and
// {4,5}. Arbitrary {p,q} stays closed though the generator would accept
// it. {3,7}'s rings grow so slowly that depth 8 stops it at 298 tiles, so
// it has its own bound: at depth 11 the tile limit, not the depth, ends
// its patch, as it does for the others by depth 8.
var laceTilings = map[string]laceTiling{
	"7,3": {7, 3, math.Pi / 7, math.Pi / 3, LaceMaxDepth, 1.3},
	"5,4": {5, 4, math.Pi / 5, math.Pi / 4, LaceMaxDepth, 2},
	"4,5": {4, 5, math.Pi / 4, math.Pi / 5, LaceMaxDepth, 1.4},
	"3,7": {3, 7, math.Pi / 3, math.Pi / 7, LaceMaxDepthTriangles, 1},
}

const (
	// LaceMaxDepth bounds every tiling's depth but {3,7}'s, which
	// LaceMaxDepthTriangles bounds.
	LaceMaxDepth          = 8
	LaceMaxDepthTriangles = 11
	LaceMaxTiles          = 1000
	LaceMaxCandidates     = 10000
	// LaceStrokes is the motif's geodesic segments in each {7,3} tile;
	// a {p,q} tile has 2p.
	LaceStrokes = 14
	// LaceMaxOffset bounds the isometry's |a|, the Euclidean distance from
	// the disk's center of the point it brings there; LaceMaxAngle bounds
	// its direction and rotation in radians, and LaceMaxTurns the motion's
	// whole orbits and turns either way.
	LaceMaxOffset = 0.8
	LaceMaxAngle  = 100
	LaceMaxTurns  = 3
	// LaceMaxLoopStrokes caps the loop motif's strokes in one reply.
	LaceMaxLoopStrokes = 160000
)

// laceLoopStrokes is the cap in force, lowered only by tests.
var laceLoopStrokes = LaceMaxLoopStrokes

// LaceRequest asks for a finite patch of a regular tiling of the Poincaré
// disk, grown from the centered tile by reflection across its edges.
// Motif names one of laceMotifs, the star when empty. StarPoint places
// the star's turning points, as a fraction of the hyperbolic distance
// from a tile's center to its corners; Size is the other motifs' size,
// which the star ignores.
type LaceRequest struct {
	Tiling    string  `json:"tiling"`
	Depth     int     `json:"depth"`
	MaxTiles  int     `json:"maxTiles"`
	StarPoint float64 `json:"starPoint"`
	Motif     string  `json:"motif,omitempty"`
	Size      float64 `json:"size,omitempty"`
	// Loop is the loop motif's closed curve, Fourier terms with whole
	// frequencies; the other motifs ignore it.
	Loop []Term `json:"loop,omitempty"`
	// Isometry moves the generated patch; absent, it stays in place.
	Isometry *LaceIsometry `json:"isometry,omitempty"`
	// Window, when present, asks for the tiles drawn in this rectangle
	// with circumscribed circles at least MinRadius in Euclidean radius,
	// at any depth: detail for a view (lace_view.go). The depth is then
	// ignored. Both are in model units, as drawn under the isometry.
	Window    *LaceWindow `json:"window,omitempty"`
	MinRadius float64     `json:"minRadius,omitempty"`
}

// LaceIsometry is the orientation-preserving disk automorphism
// T(z) = e^{iθ}(z − a)/(1 − āz) with a = Offset·e^{i·Direction} and
// θ = Rotation, angles in radians counterclockwise. It brings the point a
// of the lace to the disk's center, then turns the disk about its center.
// The zero value is the identity.
type LaceIsometry struct {
	Offset    float64 `json:"offset"`
	Direction float64 `json:"direction"`
	Rotation  float64 `json:"rotation"`
}

// LaceMotion is the authored closed path from a static isometry: the
// offset swells to Offset halfway and returns, while the direction makes
// Orbits whole turns about the center and the rotation Turns whole turns
// (see LacePathAt).
type LaceMotion struct {
	Offset float64 `json:"offset"`
	Orbits int     `json:"orbits"`
	Turns  int     `json:"turns"`
}

// LaceCoverage is how far from the disk's center the finite patch is
// complete: the radius of the largest disk about the center inside its
// tiles, in model units and as hyperbolic distance. Both are zero when
// the center lies outside the patch.
type LaceCoverage struct {
	Radius   float64 `json:"radius"`
	Distance float64 `json:"distance"`
}

// LaceOmitted counts distinct candidate tiles left out: beyond the depth, or
// unresolved near the rim (see lacePrecision); under a window, outside the
// view's search or too small to be drawn, instead of beyond the depth.
type LaceOmitted struct {
	Depth     int `json:"depth"`
	Precision int `json:"precision"`
	View      int `json:"view,omitempty"`
	Radius    int `json:"radius,omitempty"`
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
// hold p vertex and edge indices per tile (seven for {7,3}), side k joining
// corners k and k + 1.
//
// Each vertex and edge is stored once. VertexTiles and EdgeTiles count the
// patch's tiles around them: q and two in the interior of a {p,q} tiling,
// fewer on the patch's boundary. An edge
// lies on the circle orthogonal to the rim with EdgeCenter and EdgeRadius,
// or on a diameter when EdgeStraight (center and radius zero). Motif arcs
// are geodesic segments or circular arcs, 2p per tile in tile order,
// stored the same way between ArcStart and ArcEnd; on a circle each is its
// minor arc. The loop motif's tiles hold 2p closed copies of varying
// numbers of arcs, which ArcFirst delimits.
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
	// ArcFirst delimits each tile's strokes when their number varies, as
	// the loop's do: tile i's run from ArcFirst[i] to ArcFirst[i+1]. It is
	// absent for the other motifs, whose tiles hold 2p each.
	ArcFirst []float64   `json:"arcFirst,omitempty"`
	Omitted  LaceOmitted `json:"omitted"`
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
	// The isometry that placed the patch (the identity when unmoved) and
	// the patch's coverage about the disk's center under it.
	Isometry LaceIsometry `json:"isometry"`
	Coverage LaceCoverage `json:"coverage"`
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

// ComputeLace generates the patch and places it under the request's
// isometry, or in place when there is none.
func ComputeLace(q LaceRequest) (LaceResult, error) {
	src, err := NewLaceSource(q)
	if err != nil {
		return LaceResult{}, err
	}
	var iso LaceIsometry
	if q.Isometry != nil {
		iso = *q.Isometry
	}
	return src.result(iso)
}

// The motifs (docs/mathematics.md, Hyperbolic lace, Motifs): each is one
// stroke in the seed's fundamental triangle, and its size, here the
// least size admitted and the size's name in refusals; the most is 1.
// The star's size is the star point.
const (
	LaceStar = "star"
	LaceLoop = "loop"
)

var laceMotifs = map[string]struct {
	least float64
	name  string
}{
	LaceStar: {0, "star point"},
	"petals": {0, "fullness"},
	"leaves": {0, "fullness"},
	"rings":  {0.1, "ring radius"},
	LaceLoop: {0.1, "loop size"},
}

// motif is the request's motif, the star when it names none.
func (q LaceRequest) motif() string {
	if q.Motif == "" {
		return LaceStar
	}
	return q.Motif
}

func (q LaceRequest) validate() error {
	tl, ok := laceTilings[q.Tiling]
	if !ok {
		return fieldErr("tiling", "choose the {7,3}, {5,4}, {4,5} or {3,7} tiling")
	}
	if q.Depth < 0 || q.Depth > tl.maxDepth {
		return fieldErr("depth", "depth must be 0–%d reflections", tl.maxDepth)
	}
	if q.MaxTiles < 1 || q.MaxTiles > LaceMaxTiles {
		return fieldErr("maxTiles", "tile count must be 1–%d", LaceMaxTiles)
	}
	if !finite(q.StarPoint) || q.StarPoint < 0 || q.StarPoint > 1 {
		return fieldErr("starPoint", "star point must be 0–1")
	}
	m, ok := laceMotifs[q.motif()]
	if !ok {
		return fieldErr("motif", "choose the star, petals, leaves, rings or loop motif")
	}
	if q.motif() != LaceStar && (!finite(q.Size) || q.Size < m.least || q.Size > 1) {
		return fieldErr("size", "%s must be %v–1", m.name, m.least)
	}
	if q.motif() == LaceLoop {
		if err := validateLoop(q.Loop); err != nil {
			return err
		}
	}
	if q.Isometry != nil {
		if err := q.Isometry.validate(); err != nil {
			return err
		}
	}
	return q.validateWindow()
}

func (iso LaceIsometry) validate() error {
	if !finite(iso.Offset) || iso.Offset < 0 || iso.Offset > LaceMaxOffset {
		return fieldErr("isometry.offset", "offset must be 0–%v", LaceMaxOffset)
	}
	if !finite(iso.Direction) || math.Abs(iso.Direction) > LaceMaxAngle {
		return fieldErr("isometry.direction", "direction must be −%d–%d radians", LaceMaxAngle, LaceMaxAngle)
	}
	if !finite(iso.Rotation) || math.Abs(iso.Rotation) > LaceMaxAngle {
		return fieldErr("isometry.rotation", "rotation must be −%d–%d radians", LaceMaxAngle, LaceMaxAngle)
	}
	return nil
}

func (m LaceMotion) validate() error {
	if !finite(m.Offset) || m.Offset < 0 || m.Offset > LaceMaxOffset {
		return fieldErr("motion.offset", "farthest offset must be 0–%v", LaceMaxOffset)
	}
	if m.Orbits < -LaceMaxTurns || m.Orbits > LaceMaxTurns {
		return fieldErr("motion.orbits", "orbits must be −%d–%d", LaceMaxTurns, LaceMaxTurns)
	}
	if m.Turns < -LaceMaxTurns || m.Turns > LaceMaxTurns {
		return fieldErr("motion.turns", "turns must be −%d–%d", LaceMaxTurns, LaceMaxTurns)
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

// The seed tile: the regular p-gon centered at the origin with interior
// angles 2π/q, a corner straight up and corners counterclockwise.
type laceSeed struct {
	p, q    int
	vertex  []complex128
	reflect []mobius
	// Edge midpoints and the star's turning points, and the reflection in
	// each star stroke's geodesic, two per side.
	mid, star                     []complex128
	strokes                       []mobius
	vertexRadius                  float64
	circumradius, apothem, length float64
	// The other motifs: each stroke's ends in the seed and the inversion
	// in its circle, 2p of each; empty for the star.
	from, to []complex128
	circles  []laceCircle
	// The loop motif's strokes at every level of detail (lace_loop.go).
	loop *laceLoop
}

// laceCircle is the inversion in a circle, or reflection in a line,
// z ↦ (u·z̄ + w)/(k·z̄ − ū), normalized to determinant −|u|² − wk = −1.
// For the circle with center c and radius ρ, u = c/ρ, k = 1/ρ and
// w = (ρ² − |c|²)/ρ; a line through the origin has k = w = 0 and u a unit
// normal to it.
type laceCircle struct {
	u    complex128
	k, w float64
}

// turned is the circle turned by e about the origin, |e| = 1.
func (s laceCircle) turned(e complex128) laceCircle {
	return laceCircle{u: e * s.u, k: s.k, w: s.w}
}

// mirrored is the circle reflected in the line through the origin at
// angle φ, e = e^{2iφ}: its center c becomes e·c̄.
func (s laceCircle) mirrored(e complex128) laceCircle {
	return laceCircle{u: e * cmplx.Conj(s.u), k: s.k, w: s.w}
}

// through is the circle through the origin and z making angle α with the
// segment between them at both ends, on the side of the line through
// them where toward lies: center c = z/2 − n·(|z|/2)·cot α with n the unit
// normal toward that side, radius |z|/(2 sin α), so c/ρ = ẑ·sin α − n·cos α.
// At α = 0 it is the line through them.
func through(z, toward complex128, alpha float64) laceCircle {
	l := cmplx.Abs(z)
	dir := z / complex(l, 0)
	n := dir * complex(0, 1)
	if real(toward*cmplx.Conj(n)) < 0 {
		n = -n
	}
	sin, cos := math.Sincos(alpha)
	return laceCircle{u: dir*complex(sin, 0) - n*complex(cos, 0), k: 2 * sin / l}
}

// circleLine is the circle of g∘s∘g⁻¹, the image under g of the circle s
// inverts in, drawn between z and w. With G g's matrix, it is
// H = G·S·conj(G⁻¹) applied to z̄, S conjugated first when g reverses
// orientation; conj(G⁻¹) = [[a, −b̄], [−b, ā]]. H has S's determinant, −1,
// so its circle has center H₁₁/H₂₁ and radius 1/|H₂₁|, read off the
// transformations as line reads a geodesic. It is straight when the circle
// would differ from the chord by less than 10⁻¹², its sagitta
// |z − w|²·|H₂₁|/8.
func circleLine(g mobius, s laceCircle, z, w complex128) (c complex128, radius float64, straight bool) {
	u, ub := s.u, cmplx.Conj(s.u)
	if g.odd {
		u, ub = ub, u
	}
	a, b := g.a, g.b
	k, wv := complex(s.k, 0), complex(s.w, 0)
	h11 := a*a*u + a*b*(k-wv) + b*b*ub
	h21 := a*cmplx.Conj(b)*u + complex(real(a)*real(a)+imag(a)*imag(a), 0)*k -
		complex(real(b)*real(b)+imag(b)*imag(b), 0)*wv + cmplx.Conj(a)*b*ub
	chord := cmplx.Abs(z - w)
	if chord*chord*cmplx.Abs(h21) <= 8e-12 {
		return 0, 0, true
	}
	return h11 / h21, 1 / cmplx.Abs(h21), false
}

// newLaceSeed derives the p-gon from its right triangle (center, edge
// midpoint, corner), with angles π/p at the center and π/q at the corner:
// cosh R = cot(π/p)·cot(π/q) for the circumradius, cosh h =
// cos(π/q)/sin(π/p) for the apothem and cosh(s/2) = cos(π/p)/sin(π/q) for
// the side. A point at hyperbolic distance d from the origin lies at
// Euclidean radius tanh(d/2) in the metric 4|dz|²/(1 − |z|²)².
func newLaceSeed(q LaceRequest) laceSeed {
	starPoint := q.StarPoint
	tl := laceTilings[q.Tiling]
	n := tl.p
	p := float64(tl.p)
	s := laceSeed{
		p: tl.p, q: tl.q,
		vertex: make([]complex128, n), reflect: make([]mobius, n),
		mid: make([]complex128, n), star: make([]complex128, n),
		strokes: make([]mobius, 2*n),
	}
	s.circumradius = math.Acosh(1 / (math.Tan(tl.piOverP) * math.Tan(tl.piOverQ)))
	s.apothem = math.Acosh(math.Cos(tl.piOverQ) / math.Sin(tl.piOverP))
	s.length = 2 * math.Acosh(math.Cos(tl.piOverP)/math.Sin(tl.piOverQ))
	s.vertexRadius = math.Tanh(s.circumradius / 2)
	m := math.Tanh(s.apothem / 2)
	t := math.Tanh(starPoint * s.circumradius / 2)
	for k := range n {
		angle := math.Pi/2 + 2*math.Pi*float64(k)/p
		s.vertex[k] = cmplx.Rect(s.vertexRadius, angle)
		s.mid[k] = cmplx.Rect(m, angle+tl.piOverP)
		// Side k's turning point lies toward corner k + 1.
		s.star[k] = cmplx.Rect(t, angle+2*tl.piOverP)
		// Side k's geodesic, orthogonal to the rim through corners k and
		// k + 1, has its center on the bisector at D with D² = 1 + ρ² and
		// |D − corner|² = ρ²: D = (1 + r²)/(2r·cos(π/p)).
		r := s.vertexRadius
		s.reflect[k] = inversion(cmplx.Rect((1+r*r)/(2*r*math.Cos(tl.piOverP)), angle+tl.piOverP))
	}
	if q.motif() == LaceStar {
		for k := range n {
			s.strokes[2*k] = mirror(s.mid[k], s.star[k])
			s.strokes[2*k+1] = mirror(s.star[k], s.mid[(k+1)%n])
		}
		return s
	}
	if q.motif() == LaceLoop {
		s.loop = newLaceLoop(&s, q.Loop, q.Size, tl)
		return s
	}
	s.motif(q.motif(), q.Size, tl)
	return s
}

// motif builds the strokes of a motif other than the star from its stroke
// in the fundamental triangle (O, M_0, V_1) of the center O, side 0's
// midpoint and corner 1. Stroke 2k is that stroke turned by 2πk/p; stroke
// 2k + 1 is stroke 2k mirrored in the line O V_{k+1} and reversed, so it
// starts where stroke 2k ends, on that line. Named points take their
// seed values, so strokes that meet share their ends exactly.
func (s *laceSeed) motif(motif string, u float64, tl laceTiling) {
	n := s.p
	s.from, s.to = make([]complex128, 2*n), make([]complex128, 2*n)
	s.circles = make([]laceCircle, 2*n)
	var first laceCircle
	switch motif {
	case "petals":
		// From O to V_1, at α = u·min(π/p, π/q) to O V_1 toward M_0.
		first = through(s.vertex[1], s.mid[0], u*math.Min(tl.piOverP, tl.piOverQ))
	case "leaves":
		// From M_0 to O, at α = u·π/p to O M_0 toward V_1.
		first = through(s.mid[0], s.vertex[1], u*tl.piOverP)
	case "rings":
		// The circle about O of hyperbolic radius u·h: Euclidean radius
		// t = tanh(u·h/2), so u = 0, k = 1/t and w = t.
		t := math.Tanh(u * s.apothem / 2)
		first = laceCircle{k: 1 / t, w: t}
	}
	for k := range n {
		v := s.vertex[(k+1)%n]
		turn := cmplx.Rect(1, 2*math.Pi*float64(k)/float64(n))
		line := v / complex(cmplx.Abs(v), 0)
		s.circles[2*k] = first.turned(turn)
		s.circles[2*k+1] = s.circles[2*k].mirrored(line * line)
		switch motif {
		case "petals":
			s.from[2*k], s.to[2*k] = 0, v
		case "leaves":
			s.from[2*k], s.to[2*k] = s.mid[k], 0
			s.to[2*k+1] = s.mid[(k+1)%n]
		case "rings":
			t := math.Tanh(u * s.apothem / 2)
			s.from[2*k] = cmplx.Rect(t, cmplx.Phase(s.mid[k]))
			s.to[2*k] = cmplx.Rect(t, cmplx.Phase(v))
			s.to[2*k+1] = cmplx.Rect(t, cmplx.Phase(s.mid[(k+1)%n]))
		}
		s.from[2*k+1] = s.to[2*k]
		if motif == "petals" {
			s.to[2*k+1] = 0
		}
	}
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

// diskGrid finds stored points near a point, by cells of square grids
// graded toward the rim: a point with 2^−(ℓ+1) < 1 − |z|² ≤ 2^−ℓ is stored
// at level ℓ, in cells 2^−ℓ/2 wide, so a cell holds a bounded number of
// tiles however near the rim they lie.
type diskGrid map[[3]int32][]int

func newDiskGrid() diskGrid { return diskGrid{} }

func gridLevel(z complex128) int32 {
	return int32(max(0, math.Floor(-math.Log2(rimGap(z)))))
}

func gridCell(level int32) float64 { return math.Ldexp(0.5, -int(level)) }

func (g diskGrid) add(z complex128, i int) {
	l := gridLevel(z)
	c := gridCell(l)
	k := [3]int32{l, int32(math.Floor(real(z) / c)), int32(math.Floor(imag(z) / c))}
	g[k] = append(g[k], i)
}

// near returns the stored point within hyperbolic distance d of z that is
// nearest, or −1. A hyperbolic disk of radius d about z, with τ = tanh(d/2),
// is a Euclidean disk of radius (1 − |z|²)τ/(1 − |z|²τ²) whose center lies
// |z|τ²(1 − |z|²)/(1 − |z|²τ²) nearer the origin, so none of it is farther
// from z than their sum, (1 − |z|²)τ/(1 − |z|τ): the cells to search. The
// metric's factor 2/(1 − |w|²) changes by at most e^d within distance d,
// so the points sought lie within d/ln 2 + 1 levels of z's.
func (g diskGrid) near(z complex128, d float64, at func(int) complex128) (int, float64) {
	tau := math.Tanh(d / 2)
	r2 := real(z)*real(z) + imag(z)*imag(z)
	reach := (1 - r2) * tau / (1 - math.Sqrt(r2)*tau)
	l0, span := gridLevel(z), int32(math.Ceil(d/math.Ln2))+1
	best, bestD := -1, d
	for l := max(0, l0-span); l <= l0+span; l++ {
		c := gridCell(l)
		x0, x1 := int32(math.Floor((real(z)-reach)/c)), int32(math.Floor((real(z)+reach)/c))
		y0, y1 := int32(math.Floor((imag(z)-reach)/c)), int32(math.Floor((imag(z)+reach)/c))
		for x := x0; x <= x1; x++ {
			for y := y0; y <= y1; y++ {
				for _, i := range g[[3]int32{l, x, y}] {
					if e := hyperbolic(z, at(i)); e <= bestD {
						best, bestD = i, e
					}
				}
			}
		}
	}
	return best, bestD
}

func computeLace(q LaceRequest, limits laceLimits) LaceResult {
	r, err := generateLace(q, limits).result(LaceIsometry{})
	if err != nil {
		// The unmoved patch passed the precision policy as it grew.
		panic(err)
	}
	return r
}

// Breadth-first over tiles: each admitted tile's neighbor across side j is
// its transformation followed by the seed's reflection in side j. Sides
// are taken in index order, skipping the one crossed to reach the tile,
// whose reflection is the parent. The first transformation to reach a
// tile is kept; later ones are duplicates. Generation decides the tiles,
// their incidence and the transformations that place them; place then
// computes every position from those transformations.
//
// With a window, the patch is the tiles in view and their address paths
// (windowLace).
func generateLace(q LaceRequest, limits laceLimits) *LaceSource {
	if q.Window != nil {
		return windowLace(q, limits)
	}
	return growLace(q, limits, nil)
}

// laceLeft is why a window's filter leaves a candidate out: outside the
// view or too small to be drawn there; laceAdmit admits it.
type laceLeft int

const (
	laceAdmit laceLeft = iota
	laceOutside
	laceSmall
)

// growLace generates a patch breadth-first. A filter, when given, decides
// each new candidate in place of the depth.
func growLace(q LaceRequest, limits laceLimits, filter func(c complex128) laceLeft) *LaceSource {
	seed := newLaceSeed(q)
	n := seed.p
	src := &LaceSource{q: q, seed: seed}
	r := &src.topology
	*r = LaceResult{
		Tiling:       q.Tiling,
		VertexRadius: seed.vertexRadius,
		Circumradius: seed.circumradius,
		Apothem:      seed.apothem,
		SideLength:   seed.length,
	}
	type tile struct {
		g       mobius
		corners []int
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
	admit := func(g mobius, corners []int, depth, parent, via int) {
		i := len(tiles)
		tiles = append(tiles, tile{g, corners, depth, via})
		src.place = append(src.place, g)
		c := g.apply(0)
		centers = append(centers, c)
		tileGrid.add(c, i)
		r.Depth = append(r.Depth, float64(depth))
		r.Parent = append(r.Parent, float64(parent))
		r.Via = append(r.Via, float64(via))
		r.Reversed = append(r.Reversed, g.odd)
		for k := range n {
			v := corners[k]
			r.Corners = append(r.Corners, float64(v))
			r.VertexTiles[v]++
			a, b := v, corners[(k+1)%n]
			key := [2]int{min(a, b), max(a, b)}
			e, ok := edges[key]
			if !ok {
				// The tile that first has an edge places it, as side k.
				e = len(r.EdgeA)
				edges[key] = e
				src.edgeOwner = append(src.edgeOwner, n*i+k)
				r.EdgeA = append(r.EdgeA, float64(a))
				r.EdgeB = append(r.EdgeB, float64(b))
				r.EdgeTiles = append(r.EdgeTiles, 0)
			}
			r.EdgeTiles[e]++
			r.Sides = append(r.Sides, float64(e))
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
	seedCorners := make([]int, n)
	for k := range n {
		seedCorners[k] = len(vertices)
		vertexGrid.add(seed.vertex[k], len(vertices))
		vertices = append(vertices, seed.vertex[k])
		src.vertexOwner = append(src.vertexOwner, k)
		r.VertexTiles = append(r.VertexTiles, 0)
	}
	if q.MaxTiles > 0 {
		admit(identity, seedCorners, 0, -1, -1)
	}
grow:
	for head := 0; head < len(tiles); head++ {
		t := tiles[head]
		for j := range n {
			if j == t.via {
				continue
			}
			if r.Processed == limits.candidates {
				r.Stopped, r.Pending = "candidates", len(tiles)-head
				break grow
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
			if filter != nil {
				if why := filter(c); why != laceAdmit {
					if leftOnce(&left, leftGrid, leftAt, c, sameTile) {
						if why == laceOutside {
							r.Omitted.View++
						} else {
							r.Omitted.Radius++
						}
					}
					continue
				}
			} else if depth > limits.depth {
				if leftOnce(&left, leftGrid, leftAt, c, sameTile) {
					r.Omitted.Depth++
				}
				continue
			}
			corners := make([]int, n)
			placed := make([]complex128, n)
			resolved := true
			for k := range n {
				placed[k] = g.apply(seed.vertex[k])
				var ok bool
				corners[k], ok = vertex(placed[k])
				if !ok || rimGap(placed[k]) < limits.precision.floor {
					resolved = false
					break
				}
			}
			// The two corners on the crossed side are the parent's.
			if resolved && (corners[j] != t.corners[j] || corners[(j+1)%n] != t.corners[(j+1)%n]) {
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
				break grow
			}
			for k, v := range corners {
				if v < 0 {
					// The tile about to be admitted places its new
					// corners: its number is len(tiles).
					corners[k] = len(vertices)
					vertexGrid.add(placed[k], len(vertices))
					vertices = append(vertices, placed[k])
					src.vertexOwner = append(src.vertexOwner, n*len(tiles)+k)
					r.VertexTiles = append(r.VertexTiles, 0)
				}
			}
			admit(g, corners, depth, head, j)
		}
	}
	return src
}

// sameCorners reports whether g's corners are, as a set, the stored corners
// of a tile, each within agreement: a duplicate reached by another
// transformation, which may label its corners differently.
func sameCorners(g mobius, seed laceSeed, corners []int, vertices []complex128, agreement float64) bool {
	for k := range seed.p {
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
