package engine

import (
	"math"
	"math/bits"
)

// Issue #385's research catalog of enclosing seeds. Not yet a public
// contract: see the issue for the evidence and the proposed definitions.
//
// Every value is exact in ℤ[√3]: p + q√3 with integer p and q. Integral
// seeds keep q = 0. A circle stores its signed curvature b and the
// numerators X, Y of its curvature-weighted center, (X, Y)/denominator.
// The Descartes replacement 2(a + b + c) − old is linear with integer
// coefficients, so each coefficient follows it separately and every
// circle stays exact.

// qr is p + q√3.
type qr struct{ p, q int64 }

const sqrt3 = 1.7320508075688772

func (a qr) add(b qr) qr { return qr{a.p + b.p, a.q + b.q} }
func (a qr) sub(b qr) qr { return qr{a.p - b.p, a.q - b.q} }

// mul and half are for building seeds from small values only.
func (a qr) mul(b qr) qr { return qr{a.p*b.p + 3*a.q*b.q, a.p*b.q + a.q*b.p} }
func (a qr) half() qr {
	if a.p%2 != 0 || a.q%2 != 0 {
		panic("odd value halved while building a garden seed")
	}
	return qr{a.p / 2, a.q / 2}
}

// replaceQR is 2(a + b + c) − old on each coefficient, or false beyond
// ±2^53, where float64 transport of the identity stops being exact.
func replaceQR(a, b, c, old qr) (qr, bool) {
	p, ok1 := descartes(a.p, b.p, c.p, old.p)
	q, ok2 := descartes(a.q, b.q, c.q, old.q)
	return qr{p, q}, ok1 && ok2
}

func abs64(v int64) uint64 {
	if v < 0 {
		return uint64(-v)
	}
	return uint64(v)
}

// norm128 is the field norm p² − 3q², exactly, as a sign and 128-bit
// magnitude. |p| and |q| stay below 2^56, so it fits.
func norm128(a qr) (neg bool, hi, lo uint64) {
	ph, pl := bits.Mul64(abs64(a.p), abs64(a.p))
	qh, ql := bits.Mul64(abs64(a.q), abs64(a.q))
	carry, tl := bits.Mul64(ql, 3)
	th := qh*3 + carry
	if ph > th || (ph == th && pl >= tl) {
		lo, b := bits.Sub64(pl, tl, 0)
		hi, _ = bits.Sub64(ph, th, b)
		return false, hi, lo
	}
	lo, b := bits.Sub64(tl, pl, 0)
	hi, _ = bits.Sub64(th, ph, b)
	return true, hi, lo
}

// sign is the exact sign of p + q√3.
func (a qr) sign() int {
	sp, sq := sgn64(a.p), sgn64(a.q)
	switch {
	case sq == 0:
		return sp
	case sp == 0 || sp == sq:
		return sq
	}
	// Opposite signs: p dominates exactly when p² > 3q². They are never
	// equal, since √3 is irrational.
	if neg, _, _ := norm128(a); neg {
		return sq
	}
	return sp
}

func sgn64(v int64) int {
	switch {
	case v > 0:
		return 1
	case v < 0:
		return -1
	}
	return 0
}

// float converts with a few units of relative error, even when p and q√3
// nearly cancel. With p and q of the same sign the sum has no cancellation;
// otherwise the value is the exact norm over its conjugate, p − q√3, whose
// terms share a sign. Explicit conversions keep the compiler from fusing a
// multiply and add, which would round differently between architectures.
func (a qr) float() float64 {
	if a.q == 0 {
		return float64(a.p)
	}
	r := float64(float64(a.q) * sqrt3)
	if a.p == 0 || (a.p > 0) == (a.q > 0) {
		return float64(a.p) + r
	}
	neg, hi, lo := norm128(a)
	n := float64(hi)*0x1p64 + float64(lo)
	if neg {
		n = -n
	}
	return n / (float64(a.p) - r)
}

func z(p int64) qr { return qr{p, 0} }

// gardenSpec is one seed: its circles in index order (0 encloses), the
// virtual opposite circles its first gaps need when the seed is not a
// single Descartes quadruple, and the quadruples generation starts from.
type gardenSpec struct {
	id string
	// legacy marks the original seed, which keeps its shipped pruning test
	// and reply, bit for bit.
	legacy  bool
	root    int // 1: integers; 3: ℤ[√3]
	denom   int64
	circles []gardenCircle
	virtual []gardenCircle
	starts  []gardenStart
	// scale is |b₀|, the enclosing circle's curvature, and factor
	// scale/denom: the normalization to an enclosing radius of 1.
	scale, factor float64
}

// A starting quadruple: circle indices, a negative id −1−k naming virtual
// circle k, and which index to replace (−1 for all four).
type gardenStart struct {
	id   [4]int
	only int
}

func newSpec(id string, root int, denom int64, circles []gardenCircle) *gardenSpec {
	s := &gardenSpec{id: id, root: root, denom: denom, circles: circles}
	if len(circles) == 4 {
		s.starts = []gardenStart{{id: [4]int{0, 1, 2, 3}, only: -1}}
	}
	s.normalize()
	return s
}

func (s *gardenSpec) normalize() {
	s.scale = math.Abs(s.circles[0].b.float())
	s.factor = s.scale / float64(s.denom)
}

// scaled multiplies every curvature by λ, leaving weighted centers alone:
// the same packing drawn 1/λ as large. For tests of scale covariance.
func (s *gardenSpec) scaled(l qr) *gardenSpec {
	t := *s
	t.legacy = false
	scale := func(cs []gardenCircle) []gardenCircle {
		out := make([]gardenCircle, len(cs))
		for i, c := range cs {
			out[i] = gardenCircle{c.b.mul(l), c.x, c.y}
		}
		return out
	}
	t.circles, t.virtual = scale(s.circles), scale(s.virtual)
	t.normalize()
	return &t
}

// The catalog, in the order offered. Each places the enclosing circle at the
// origin; a seed with a mirror has it across the vertical axis. Centers,
// worked by hand from the tangencies, are listed in units where the
// enclosing circle has curvature b₀.
var gardenCatalog = func() []*gardenSpec {
	c := func(b, x, y qr) gardenCircle { return gardenCircle{b, x, y} }
	original := newSpec(GardenSeed, 1, 1, gardenSeed[:])
	original.legacy = true
	// Radius 1/2 around radius 1/3 at (0, −1/6) and 1/6 at (0, 1/3), all
	// on one diameter, with 1/7 at (2/7, 3/14); its mirror image is
	// generation 1. Weighted centers are halves: denominator 2.
	twoMirror := newSpec("-2,3,6,7", 1, 2, []gardenCircle{
		c(z(-2), z(0), z(0)), c(z(3), z(0), z(-1)), c(z(6), z(0), z(4)), c(z(7), z(4), z(3)),
	})
	// Radius 1/3 around 1/5 at (0, −2/15) and 1/8 at (∓1/8, 1/6).
	fiveEights := newSpec("-3,5,8,8", 1, 3, []gardenCircle{
		c(z(-3), z(0), z(0)), c(z(5), z(0), z(-2)), c(z(8), z(-3), z(4)), c(z(8), z(3), z(4)),
	})
	// Radius 1/6 around 1/11 at (0, −5/66), 1/14 at (2/35, 8/105) and 1/15
	// at (−2/25, 3/50). It has no symmetry; this is one of its two mirror
	// images, the 14 to the right.
	asymmetric := newSpec("-6,11,14,15", 1, 30, []gardenCircle{
		c(z(-6), z(0), z(0)), c(z(11), z(0), z(-25)), c(z(14), z(24), z(32)), c(z(15), z(-36), z(27)),
	})
	// Three unit circles centered 2/√3 from the origin, one at the top,
	// inside the circle of curvature 3 − 2√3. Weighted centers carry 1/√3:
	// denominator 3.
	threeFold := newSpec("3-2r3,1,1,1", 3, 3, []gardenCircle{
		c(qr{3, -2}, z(0), z(0)),
		c(z(1), z(0), qr{0, 2}),
		c(z(1), z(-3), qr{0, -1}),
		c(z(1), z(3), qr{0, -1}),
	})
	return []*gardenSpec{original, twoMirror, fiveEights, asymmetric, threeFold, sixAroundOne()}
}()

// Six circles of radius 1/3 around a seventh, in the unit circle, ring
// circle k centered at angle 90° + 60k. Its twelve gaps are triangles of
// tangent circles, but no single quadruple holds them, so each starts from a
// virtual opposite: the other circle tangent to its three, which is not in
// the packing. The first circle in each gap is known by symmetry: centered
// on the gap's bisector u at angle 120° + 60k, weighted center (4 + 2√3)u,
// with curvature 9 + 6√3 beside the center and 5 + 2√3 beside the
// enclosing circle; the virtual circle is 2(a + b + c) minus it.
func sixAroundOne() *gardenSpec {
	ring := []gardenCircle{{z(-1), z(0), z(0)}, {z(3), z(0), z(0)}}
	// 2cos and 2sin of 90° + 60k, then of the bisectors 120° + 60k.
	at := [6][2]qr{{z(0), z(2)}, {qr{0, -1}, z(1)}, {qr{0, -1}, z(-1)}, {z(0), z(-2)}, {qr{0, 1}, z(-1)}, {qr{0, 1}, z(1)}}
	mid := [6][2]qr{{z(-1), qr{0, 1}}, {z(-2), z(0)}, {z(-1), qr{0, -1}}, {z(1), qr{0, -1}}, {z(2), z(0)}, {z(1), qr{0, 1}}}
	for k := 0; k < 6; k++ {
		// Weighted center 3·(2/3)(cos, sin) = 2(cos, sin).
		ring = append(ring, gardenCircle{z(3), at[k][0], at[k][1]})
	}
	s := newSpec("-1,3,3,3,3,3,3,3", 3, 1, ring)
	w := qr{4, 2}
	for _, inner := range []bool{true, false} {
		for k := 0; k < 6; k++ {
			first := 1
			fill := gardenCircle{qr{9, 6}, w.mul(mid[k][0]).half(), w.mul(mid[k][1]).half()}
			if !inner {
				first = 0
				fill.b = qr{5, 2}
			}
			ids := [3]int{first, 2 + k, 2 + (k+1)%6}
			a, b, c := s.circles[ids[0]], s.circles[ids[1]], s.circles[ids[2]]
			vb, _ := replaceQR(a.b, b.b, c.b, fill.b)
			vx, _ := replaceQR(a.x, b.x, c.x, fill.x)
			vy, _ := replaceQR(a.y, b.y, c.y, fill.y)
			s.virtual = append(s.virtual, gardenCircle{vb, vx, vy})
			s.starts = append(s.starts, gardenStart{id: [4]int{ids[0], ids[1], ids[2], -len(s.virtual)}, only: 3})
		}
	}
	return s
}

var gardenSpecs = func() map[string]*gardenSpec {
	m := map[string]*gardenSpec{}
	for _, s := range gardenCatalog {
		m[s.id] = s
	}
	return m
}()

// GardenSeedIDs lists the catalog in the order offered.
func GardenSeedIDs() []string {
	ids := make([]string, len(gardenCatalog))
	for i, s := range gardenCatalog {
		ids[i] = s.id
	}
	return ids
}

// center is a circle's center and radius in units of the enclosing radius.
func (s *gardenSpec) center(c gardenCircle) (x, y, radius, b float64) {
	b = c.b.float()
	// Adding zero turns the enclosing circle's −0 into 0.
	return c.x.float()/b*s.factor + 0, c.y.float()/b*s.factor + 0, s.scale / math.Abs(b), b
}

// linearView is the exact form of the dual-disk test. The dual circle of
// a gap, through its three contacts and oriented away from the opposite
// circle o, has curvature (b_j + b_k + b_l − b_o)/2 and weighted center
// (z_j + z_k + z_l − z_o)/2; the gap lies on its positive side. A sum of
// zero is a line, and its gap is always filled, as the original's
// collinear gap is.
func (s *gardenSpec) linearView(q GardenRequest, kept *[2]float64, a, b, c, o gardenCircle) bool {
	db := a.b.add(b.b).add(c.b).sub(o.b)
	if db.sign() <= 0 {
		return true
	}
	bf := db.float()
	x := a.x.add(b.x).add(c.x).sub(o.x).float() / bf * s.factor
	y := a.y.add(b.y).add(c.y).sub(o.y).float() / bf * s.factor
	r := 2 * s.scale / bf
	if q.Window.meets(x, y, r) {
		return true
	}
	return kept != nil && math.Hypot(kept[0]-x, kept[1]-y) < r
}
