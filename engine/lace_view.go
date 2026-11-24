package engine

import (
	"math"
	"math/cmplx"
)

// Detail for a view (docs/mathematics.md, Hyperbolic lace, Detail for a
// view): with a window, the patch holds the tiles of the patch the cutoffs
// make that meet the window, and with them every tile drawn in the window
// at least a minimum size, however deep, each with the address and
// transformation the unlimited breadth-first patch gives it. Beyond the
// cutoffs' patch, the depth and the tile limit are ignored; the candidate
// limit, the window's own tile limit and the precision policy apply.

// LaceWindow is a rectangle of the drawing in model units, its sides
// parallel to the axes, in the frame the lace is drawn in: after its
// isometry.
type LaceWindow struct {
	XMin float64 `json:"xMin"`
	XMax float64 `json:"xMax"`
	YMin float64 `json:"yMin"`
	YMax float64 `json:"yMax"`
}

const (
	// LaceMaxWindow bounds a window's sides in model units, far beyond
	// any view the 0.1–100 zoom range shows of the unit disk.
	LaceMaxWindow = 1000
	// LaceMinRadius is the least minimum radius a window may ask for, in
	// model units: at the 100× zoom limit, about a third of a page unit.
	LaceMinRadius = 1e-5
	// LaceMaxViewTiles bounds a window's patch: the cutoffs' patch, at
	// most LaceMaxTiles, and the view's tiles beyond it.
	LaceMaxViewTiles = 2000
)

// A tile is in view when its circumscribed circle, the hyperbolic circle
// of radius R about its center, meets the window as drawn and its
// Euclidean radius there is at least the minimum radius.

func (w LaceWindow) validate() error {
	for _, c := range []struct {
		name string
		v    float64
	}{{"xMin", w.XMin}, {"xMax", w.XMax}, {"yMin", w.YMin}, {"yMax", w.YMax}} {
		if !finite(c.v) || math.Abs(c.v) > LaceMaxWindow {
			return fieldErr("window."+c.name, "window sides must be finite, within ±%d", LaceMaxWindow)
		}
	}
	if w.XMax <= w.XMin {
		return fieldErr("window.xMax", "the window's right side must exceed its left side")
	}
	if w.YMax <= w.YMin {
		return fieldErr("window.yMax", "the window's top must exceed its bottom")
	}
	return nil
}

func (q LaceRequest) validateWindow() error {
	if q.Window == nil {
		if q.MinRadius != 0 {
			return fieldErr("minRadius", "a minimum radius needs a window")
		}
		return nil
	}
	if err := q.Window.validate(); err != nil {
		return err
	}
	if !finite(q.MinRadius) || q.MinRadius < LaceMinRadius || q.MinRadius > 1 {
		return fieldErr("minRadius", "minimum radius must be %v–1", LaceMinRadius)
	}
	return nil
}

// laceKey is what decides a frozen patch's tiles: the generation
// settings, and under a window the window, its minimum radius and the
// static isometry, which places the window over the tiling. Without a
// window the isometry only moves the tiles, so one patch serves every
// start.
type laceKey struct {
	q      LaceRequest
	window LaceWindow
	iso    LaceIsometry
}

func (q LaceRequest) key() laceKey {
	k := laceKey{q: q}
	k.q.Isometry, k.q.Window = nil, nil
	if q.Window != nil {
		k.window = *q.Window
		if q.Isometry != nil {
			k.iso = *q.Isometry
		}
	}
	return k
}

// Matches reports whether the source's tiles are the request's: whether
// its frames may be drawn for it.
func (s *LaceSource) Matches(q LaceRequest) bool { return q.key() == s.q.key() }

// windowLace generates a window's patch in three passes. The cutoffs'
// patch is generated as without a window. The search grows a patch within
// laceSearch's region, which reaches every tile in view by its address.
// Then the patch is grown again, keeping only the cutoffs' tiles that meet
// the window, the search's tiles in view, and the tiles on their
// addresses. Those reach each other by their own addresses, so the last
// pass gives each the address, depth and transformation of the unlimited
// patch, in its breadth-first order, while tiles near the region's edge
// that the search reached another way are left out. Left-out candidates
// are counted as outside the view, or as too small when their circle meets
// the window, and the precision policy's omissions are the search's. The
// candidate limit bounds the search, and LaceMaxViewTiles the patch.
func windowLace(q LaceRequest, limits laceLimits) *LaceSource {
	seed := newLaceSeed(q)
	plain := q
	plain.Window, plain.MinRadius = nil, 0
	cut := growLace(plain, limits, nil)
	search := newLaceSearch(q, seed, laceTilings[q.Tiling])
	wide := q
	// Every admitted tile is a candidate examined, so the candidate limit
	// bounds the search's tiles.
	wide.MaxTiles = limits.candidates + 1
	first := growLace(wide, laceLimits{math.MaxInt, limits.candidates, limits.precision}, func(c complex128) laceLeft {
		if !search.near(c) {
			return laceOutside
		}
		if !search.large(c) {
			return laceSmall
		}
		return laceAdmit
	})
	var iso LaceIsometry
	if q.Isometry != nil {
		iso = *q.Isometry
	}
	m := isometry(iso)
	w, least, R := *q.Window, q.MinRadius, seed.circumradius
	// inView is whether a tile centered at c, as generated, is drawn in
	// the window at least the minimum radius.
	inView := func(c complex128) (meets, large bool) {
		at, rho := hyperbolicDisk(m.apply(c), R)
		dx := math.Max(w.XMin-real(at), math.Max(0, real(at)-w.XMax))
		dy := math.Max(w.YMin-imag(at), math.Max(0, imag(at)-w.YMax))
		return math.Hypot(dx, dy) <= rho, rho >= least
	}
	kept := newDiskGrid()
	centers := []complex128{}
	at := func(i int) complex128 { return centers[i] }
	// Parents precede their children, so one pass from the last tile
	// marks every address path.
	mark := func(s *LaceSource, wanted func(meets, large bool) bool) {
		keep := make([]bool, len(s.place))
		for i := len(s.place) - 1; i >= 0; i-- {
			c := s.place[i].apply(0)
			if keep[i] || wanted(inView(c)) {
				keep[i] = true
				kept.add(c, len(centers))
				centers = append(centers, c)
				if p := int(s.topology.Parent[i]); p >= 0 {
					keep[p] = true
				}
			}
		}
	}
	mark(cut, func(meets, _ bool) bool { return meets })
	mark(first, func(meets, large bool) bool { return meets && large })
	t := &first.topology
	wide.MaxTiles = LaceMaxViewTiles
	src := growLace(wide, laceLimits{math.MaxInt, math.MaxInt, limits.precision}, func(c complex128) laceLeft {
		if i, _ := kept.near(c, seed.apothem, at); i >= 0 {
			return laceAdmit
		}
		if meets, _ := inView(c); meets {
			return laceSmall
		}
		return laceOutside
	})
	src.q = q
	r := &src.topology
	r.Omitted.Precision = t.Omitted.Precision
	r.Processed, r.Duplicates = t.Processed, t.Duplicates
	if t.Stopped != "" {
		r.Stopped, r.Pending = t.Stopped, t.Pending
	}
	return src
}

// laceSearch is the region a window's breadth-first search keeps to, in
// the frame tiles are generated in, before the isometry.
//
// A tile's address is its first gallery from the center, and every tile on
// it lies within the tiling's gallery reach of the segment from the center
// to the tile's center, and no farther from the center than the tile
// (TestLaceAddressPathsHugTheirLine). A tile in view meets the window's
// circumscribed disk, which the inverse isometry carries to a Euclidean
// disk B; so its center lies within R of a point P of B. Geodesics from
// the center are Euclidean segments, and two from one point stay within
// the distance of their ends, so the segment to the tile's center lies
// within R of the segment to P, which lies in H, the Euclidean convex hull
// of the center and B. And the tile is drawn at least the minimum radius,
// so its center is within the distance D of the drawing's center at which
// a tile's circle is drawn that size, and within D plus the isometry's
// offset distance of the generated center.
//
// A candidate is therefore kept when it lies within the gallery reach
// plus R of H, and within that distance of the center: every tile on the
// address of every tile in view passes both. A tile is reached in the
// search by its first gallery within the region, so each of those is
// reached by its address. (A tile near the region's edge may not be:
// windowLace leaves those out.)
type laceSearch struct {
	// full is true when the window's disk holds the inverse isometry's
	// pole, and its image is no disk: the search keeps to distance alone.
	full bool
	// B, and the tangent points from the center that bound H; tangent is
	// false when B holds the center, and H is B.
	disk        complex128
	radius      float64
	tangent     bool
	left, right complex128
	margin      float64
	// reach is tanh of half the farthest distance from the center kept,
	// a Euclidean radius; −1 keeps nothing but the seed.
	reach float64
}

func newLaceSearch(q LaceRequest, seed laceSeed, tl laceTiling) *laceSearch {
	if q.Window == nil {
		return nil
	}
	w := *q.Window
	var iso LaceIsometry
	if q.Isometry != nil {
		iso = *q.Isometry
	}
	s := &laceSearch{margin: tl.gallery + seed.circumradius, reach: -1}
	// D: the Euclidean circle of a hyperbolic circle of radius R about a
	// point at Euclidean radius t has radius (1 − t²)τ/(1 − t²τ²), with
	// τ = tanh(R/2), largest at the center. It is L when
	// t² = (τ − L)/(τ(1 − Lτ)).
	tau, least := seed.vertexRadius, q.MinRadius
	if least < tau {
		t := math.Sqrt((tau - least) / (tau * (1 - least*tau)))
		far := 2*math.Atanh(t) + 2*math.Atanh(iso.Offset)
		// A slack far above rounding: admitting a tile just smaller only
		// adds one drawn below the minimum.
		s.reach = math.Tanh((far + 1e-9) / 2)
	}
	center := complex((w.XMin+w.XMax)/2, (w.YMin+w.YMax)/2)
	radius := math.Hypot(w.XMax-w.XMin, w.YMax-w.YMin) / 2
	back := isometry(iso).inverse()
	// The inverse's pole, where its denominator b̄z + ā vanishes, lies
	// outside the closed disk.
	if back.b != 0 {
		if pole := -cmplx.Conj(back.a) / cmplx.Conj(back.b); cmplx.Abs(pole-center) <= radius {
			s.full = true
			return s
		}
	}
	// A Möbius map carries the window's circle to the circle through the
	// images of three of its points, and, the pole outside, its disk to
	// the disk inside.
	var z [3]complex128
	for k := range z {
		z[k] = back.apply(center + cmplx.Rect(radius, 2*math.Pi*float64(k)/3))
	}
	c, rho, ok := circleThrough(z[0], z[1], z[2])
	if !ok {
		s.full = true
		return s
	}
	s.disk, s.radius = c, rho
	if d := cmplx.Abs(c); d > rho {
		// The tangents from the center touch B at distance √(d² − ρ²),
		// turned asin(ρ/d) either side of the direction to its center.
		s.tangent = true
		l, a := math.Sqrt((d-rho)*(d+rho)), math.Asin(rho/d)
		s.left = cmplx.Rect(l, cmplx.Phase(c)+a)
		s.right = cmplx.Rect(l, cmplx.Phase(c)-a)
	}
	return s
}

// circleThrough is the circle through three points, false when they are
// collinear.
func circleThrough(a, b, c complex128) (complex128, float64, bool) {
	b, c = b-a, c-a
	det := 2 * (real(b)*imag(c) - imag(b)*real(c))
	if det == 0 {
		return 0, 0, false
	}
	bb, cc := real(b)*real(b)+imag(b)*imag(b), real(c)*real(c)+imag(c)*imag(c)
	o := complex((imag(c)*bb-imag(b)*cc)/det, (real(b)*cc-real(c)*bb)/det)
	return a + o, cmplx.Abs(o), true
}

// near reports whether a candidate's center lies within the margin of H.
// The points within hyperbolic distance m of c form a Euclidean disk, so
// it does exactly when that disk meets H.
func (s *laceSearch) near(c complex128) bool {
	if s.full {
		return true
	}
	at, rho := hyperbolicDisk(c, s.margin)
	return s.hull(at) <= rho
}

// hull is the Euclidean distance from z to H: to B, or to the triangle of
// the center and the tangent points, whichever is nearer.
func (s *laceSearch) hull(z complex128) float64 {
	d := math.Max(0, cmplx.Abs(z-s.disk)-s.radius)
	if !s.tangent || d == 0 {
		return d
	}
	a, b := s.left, s.right
	cross := func(u, v complex128) float64 { return real(u)*imag(v) - imag(u)*real(v) }
	// Inside the triangle (0, a, b) when on the same side of each edge.
	if s1, s2, s3 := cross(a, z), cross(b-a, z-a), cross(-b, z-b); (s1 >= 0) == (s2 >= 0) && (s2 >= 0) == (s3 >= 0) {
		return 0
	}
	return math.Min(d, math.Min(toSegment(z, 0, a), math.Min(toSegment(z, a, b), toSegment(z, b, 0))))
}

func toSegment(z, a, b complex128) float64 {
	ab := b - a
	t := (real(z-a)*real(ab) + imag(z-a)*imag(ab)) / (real(ab)*real(ab) + imag(ab)*imag(ab))
	return cmplx.Abs(z - (a + ab*complex(math.Max(0, math.Min(1, t)), 0)))
}

// hyperbolicDisk is the Euclidean disk of the points within hyperbolic
// distance d of z: with τ = tanh(d/2), center z(1 − τ²)/(1 − |z|²τ²) and
// radius (1 − |z|²)τ/(1 − |z|²τ²).
func hyperbolicDisk(z complex128, d float64) (complex128, float64) {
	tau := math.Tanh(d / 2)
	z2 := real(z)*real(z) + imag(z)*imag(z)
	den := 1 - z2*tau*tau
	return z * complex((1-tau*tau)/den, 0), rimGap(z) * tau / den
}

// large reports whether a candidate's center lies close enough to the
// center for a tile in view to pass through it.
func (s *laceSearch) large(c complex128) bool { return cmplx.Abs(c) <= s.reach }
