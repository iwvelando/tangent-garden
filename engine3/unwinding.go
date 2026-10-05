package engine3

import "math"

// UnwindingRequest is the involute a construction is built on when its
// input is "involute": I(t) = r(t) + (c − s(t)) T(t), with arc length s
// measured from the anchor t₀ and signed string length c (Offset), as for
// one member of the involute construction. It is read only for that input,
// and is independent of the involute construction's own anchor and length,
// so an involute can be unwound from an involute.
type UnwindingRequest struct {
	Anchor float64 `json:"anchor"`
	Offset float64 `json:"offset"`
}

func (q UnwindingRequest) validate() error {
	if !finite(q.Offset) || math.Abs(q.Offset) > 1e5 {
		return fieldErr("unwinding.offset", "the input's string length c must be finite and within ±100000")
	}
	if !finite(q.Anchor) {
		return fieldErr("unwinding.anchor", "the input's anchor t₀ must be a finite parameter value")
	}
	return nil
}

// The positive Gauss–Legendre nodes and weights on [−1, 1], with eight
// points for whole intervals and four for the half interval to a point.
var (
	gauss8 = [2][4]float64{{0.1834346424956498, 0.5255324099163290, 0.7966664774136267, 0.9602898564975363}, {0.3626837833783620, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763}}
	gauss4 = [2][2]float64{{0.3399810435848563, 0.8611363115940526}, {0.6521451548625461, 0.3478548451374538}}
)

// evaluation returns the involute's evaluator from the base's, together
// with its position alone, which refinement evaluates between samples, and
// the base samples its arc length reaches. Arc length is tabulated at
// the sample parameters outward from the anchor, stopping at the first
// missing sample or break on either side as the involute construction
// does, with eight-point Gauss–Legendre quadrature of the speed on each
// interval, and completed at any t by four-point quadrature from the nearer
// knot; it is never summed along a drawn polyline. Both evaluate the point
// with one compiled function (place), so the position passes exactly
// through the samples.
//
// The derivatives are written from the base's own, with s′ = |r′|:
// I′ = (c − s)T′ and I″ = −|r′|T′ + (c − s)T″, where
// T′ = (r″ − (r″·T)T)/|r′| and T″ is differenced from T. I′ is along the
// base's principal normal, so an involute stops where the base is straight
// (T′ = 0) as well as where the string runs out (s = c).
func (q UnwindingRequest) evaluation(base evaluation, lo, hi float64, curve []*Vec3, breaks []bool) (evaluation, func(float64) Vec3, []bool, error) {
	n := len(curve) - 1
	t0 := q.Anchor
	if t0 < lo || t0 > hi {
		return nil, nil, nil, fieldErr("unwinding.anchor", "the input's anchor t₀ must lie within the domain [%.6g, %.6g]", lo, hi)
	}
	u := &unwinder{offset: q.Offset, base: base, lo: lo, hi: hi, n: n, h: (hi - lo) / float64(n), s: make([]float64, n+1), reach: make([]bool, n)}
	// open reports whether interval i joins two regular samples.
	open := func(i int) bool { return curve[i] != nil && curve[i+1] != nil && !breaks[i+1] }
	k := min(n-1, int(math.Floor((t0-lo)/u.h)))
	s, reach := u.s, u.reach
	if open(k) {
		s[k], s[k+1] = -u.whole(u.knot(k), t0), u.whole(t0, u.knot(k+1))
		reach[k] = finite(s[k]) && finite(s[k+1])
	}
	if !reach[k] {
		return nil, nil, nil, fieldErr("unwinding.anchor", "the input's anchor t₀ must lie on a regular, continuous stretch of the base curve")
	}
	for i := k + 1; i < n && open(i); i++ {
		if s[i+1] = s[i] + u.whole(u.knot(i), u.knot(i+1)); !finite(s[i+1]) {
			break
		}
		reach[i] = true
	}
	for i := k - 1; i >= 0 && open(i); i-- {
		if s[i] = s[i+1] - u.whole(u.knot(i), u.knot(i+1)); !finite(s[i]) {
			break
		}
		reach[i] = true
	}
	reached := make([]bool, n+1)
	for i := range reached {
		reached[i] = i > 0 && reach[i-1] || i < n && reach[i]
	}
	span := hi - lo
	tangent := func(t float64) Vec3 {
		_, v, _, ok := base(t)
		if !ok || !v.valid() || v.norm() < 1e-9 {
			return Vec3{math.NaN(), 0, 0}
		}
		return v.unit()
	}
	invalid := Vec3{math.NaN(), 0, 0}
	evaluate := func(t float64) (Vec3, Vec3, Vec3, bool) {
		point, dT, speed, length, ok := u.place(t)
		if !ok {
			return invalid, invalid, invalid, false
		}
		_, ddT := derivatives(tangent, t, lo, hi, span*1e-4)
		_, ddT2 := derivatives(tangent, t, lo, hi, span*5e-5)
		acceleration := dT.mul(-speed).add(ddT.mul(length))
		if !ddT.valid() || !ddT2.valid() || ddT.sub(ddT2).norm() > 1e-2*math.Max(ddT.norm(), ddT2.norm())+1e-4*math.Max(1, dT.norm()/span) {
			acceleration = invalid
		}
		return point, dT.mul(length), acceleration, true
	}
	position := func(t float64) Vec3 {
		point, _, _, _, ok := u.place(t)
		if !ok {
			return invalid
		}
		return point
	}
	return evaluate, position, reached, nil
}

// unwinder holds the involute input's arc length s at the samples, s[i]
// at sample i, and reach[i] for each interval it was carried across.
type unwinder struct {
	offset    float64
	base      evaluation
	lo, hi, h float64
	n         int
	s         []float64
	reach     []bool
}

func (u *unwinder) knot(i int) float64 {
	return u.lo*(1-float64(i)/float64(u.n)) + u.hi*float64(i)/float64(u.n)
}

// arc is the base's arc length from a to b by Gauss–Legendre quadrature
// with the given positive nodes and weights, NaN where the base stops.
func (u *unwinder) arc(a, b float64, nodes, weights []float64) float64 {
	middle, half, sum := (a+b)/2, (b-a)/2, 0.0
	for k, x := range nodes {
		for _, side := range []float64{-1, 1} {
			_, v, _, ok := u.base(middle + side*half*x)
			if !ok || !v.valid() || v.norm() < 1e-9 {
				return math.NaN()
			}
			sum += weights[k] * v.norm()
		}
	}
	return sum * half
}

func (u *unwinder) whole(a, b float64) float64 { return u.arc(a, b, gauss8[0][:], gauss8[1][:]) }

// place is the involute at t, with the base's T′, its speed and the
// string's length there; not ok where t is unreached, the base is
// undefined, or the base is straight (it has no principal normal).
//
//go:noinline
func (u *unwinder) place(t float64) (point, dT Vec3, speed, length float64, ok bool) {
	x := (t - u.lo) / u.h
	i := max(0, min(u.n-1, int(math.Floor(x))))
	switch {
	case u.reach[i]:
	case i > 0 && u.reach[i-1] && x-float64(i) < 1e-9:
		i--
	case i < u.n-1 && u.reach[i+1] && float64(i+1)-x < 1e-9:
		i++
	default:
		return
	}
	// From the nearer end of the interval, at most half of it away.
	j := i
	if x-float64(i) > 0.5 {
		j = i + 1
	}
	length = u.offset - u.s[j] - u.arc(u.knot(j), t, gauss4[0][:], gauss4[1][:])
	r, v, a, defined := u.base(t)
	speed = v.norm()
	if !defined || !finite(length) || !r.valid() || !v.valid() || !a.valid() || speed < 1e-9 {
		return
	}
	T := v.mul(1 / speed)
	bend := a.sub(T.mul(a.dot(T)))
	// A straight stretch of the base has no principal normal.
	if bend.norm() <= 1e-6*math.Max(a.norm(), speed/(u.hi-u.lo)) {
		return
	}
	return r.add(T.mul(length)), bend.mul(1 / speed), speed, length, true
}
