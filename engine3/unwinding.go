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
// with the base samples its arc length reaches. Arc length is tabulated at
// the sample parameters outward from the anchor, stopping at the first
// missing sample or break on either side as the involute construction
// does, with eight-point Gauss–Legendre quadrature of the speed on each
// interval, and completed at any t by four-point quadrature from the nearer
// knot; it is never summed along a drawn polyline.
//
// The derivatives are written from the base's own, with s′ = |r′|:
// I′ = (c − s)T′ and I″ = −|r′|T′ + (c − s)T″, where
// T′ = (r″ − (r″·T)T)/|r′| and T″ is differenced from T. I′ is along the
// base's principal normal, so an involute stops where the base is straight
// (T′ = 0) as well as where the string runs out (s = c).
func (q UnwindingRequest) evaluation(base evaluation, lo, hi float64, curve []*Vec3, breaks []bool) (evaluation, []bool, error) {
	n := len(curve) - 1
	t0 := q.Anchor
	if t0 < lo || t0 > hi {
		return nil, nil, fieldErr("unwinding.anchor", "the input's anchor t₀ must lie within the domain [%.6g, %.6g]", lo, hi)
	}
	span := hi - lo
	h := span / float64(n)
	knot := func(i int) float64 { return lo*(1-float64(i)/float64(n)) + hi*float64(i)/float64(n) }
	arc := func(a, b float64, nodes, weights []float64) float64 {
		middle, half, sum := (a+b)/2, (b-a)/2, 0.0
		for k, x := range nodes {
			for _, side := range []float64{-1, 1} {
				_, v, _, ok := base(middle + side*half*x)
				if !ok || !v.valid() || v.norm() < 1e-9 {
					return math.NaN()
				}
				sum += weights[k] * v.norm()
			}
		}
		return sum * half
	}
	whole := func(a, b float64) float64 { return arc(a, b, gauss8[0][:], gauss8[1][:]) }
	// open reports whether interval i joins two regular samples.
	open := func(i int) bool { return curve[i] != nil && curve[i+1] != nil && !breaks[i+1] }
	k := min(n-1, int(math.Floor((t0-lo)/h)))
	s := make([]float64, n+1)
	reach := make([]bool, n)
	if open(k) {
		s[k], s[k+1] = -whole(knot(k), t0), whole(t0, knot(k+1))
		reach[k] = finite(s[k]) && finite(s[k+1])
	}
	if !reach[k] {
		return nil, nil, fieldErr("unwinding.anchor", "the input's anchor t₀ must lie on a regular, continuous stretch of the base curve")
	}
	for i := k + 1; i < n && open(i); i++ {
		if s[i+1] = s[i] + whole(knot(i), knot(i+1)); !finite(s[i+1]) {
			break
		}
		reach[i] = true
	}
	for i := k - 1; i >= 0 && open(i); i-- {
		if s[i] = s[i+1] - whole(knot(i), knot(i+1)); !finite(s[i]) {
			break
		}
		reach[i] = true
	}
	reached := make([]bool, n+1)
	for i := range reached {
		reached[i] = i > 0 && reach[i-1] || i < n && reach[i]
	}
	tangent := func(t float64) Vec3 {
		_, v, _, ok := base(t)
		if !ok || !v.valid() || v.norm() < 1e-9 {
			return Vec3{math.NaN(), 0, 0}
		}
		return v.unit()
	}
	invalid := Vec3{math.NaN(), 0, 0}
	return func(t float64) (Vec3, Vec3, Vec3, bool) {
		x := (t - lo) / h
		i := max(0, min(n-1, int(math.Floor(x))))
		switch {
		case reach[i]:
		case i > 0 && reach[i-1] && x-float64(i) < 1e-9:
			i--
		case i < n-1 && reach[i+1] && float64(i+1)-x < 1e-9:
			i++
		default:
			return invalid, invalid, invalid, false
		}
		// From the nearer end of the interval, at most half of it away.
		j := i
		if x-float64(i) > 0.5 {
			j = i + 1
		}
		length := q.Offset - s[j] - arc(knot(j), t, gauss4[0][:], gauss4[1][:])
		r, v, a, ok := base(t)
		speed := v.norm()
		if !ok || !finite(length) || !r.valid() || !v.valid() || !a.valid() || speed < 1e-9 {
			return invalid, invalid, invalid, false
		}
		T := v.mul(1 / speed)
		bend := a.sub(T.mul(a.dot(T)))
		// A straight stretch of the base has no principal normal.
		if bend.norm() <= 1e-6*math.Max(a.norm(), speed/span) {
			return invalid, invalid, invalid, false
		}
		dT := bend.mul(1 / speed)
		_, ddT := derivatives(tangent, t, lo, hi, span*1e-4)
		_, ddT2 := derivatives(tangent, t, lo, hi, span*5e-5)
		acceleration := dT.mul(-speed).add(ddT.mul(length))
		if !ddT.valid() || !ddT2.valid() || ddT.sub(ddT2).norm() > 1e-2*math.Max(ddT.norm(), ddT2.norm())+1e-4*math.Max(1, dT.norm()/span) {
			acceleration = invalid
		}
		return r.add(T.mul(length)), dT.mul(length), acceleration, true
	}, reached, nil
}
