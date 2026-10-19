package engine3

import (
	"math"
	"sort"
)

// Across a cusp of the base.
//
// Where the base's velocity has a simple zero, r′(t₀) = 0 with r″(t₀) ≠ 0,
// r′(t) = (t − t₀)d(t) with d continuous and d(t₀) = r″(t₀). The unit
// tangent reverses at t₀, but the tangent line, through r(t) along d(t),
// is continuous there. A tangent projection depends on the line alone
// (project is unchanged when T is reversed), so it is continuous across
// the cusp, and at the cusp it is taken on the line along r″(t₀).

// line is the direction of the tangent line from a velocity v and an
// acceleration a: the unit tangent where the curve moves and, where it
// stands still, a stable acceleration's direction, the line's limit at a
// simple zero of the velocity. ok is false where neither gives one.
func (u units) line(v, a Vec3) (Vec3, bool) {
	if !v.valid() {
		return Vec3{}, false
	}
	if !u.still(v) {
		return v.unit(), true
	}
	if a.valid() && a.norm() >= 1e-6*u.acceleration {
		return a.unit(), true
	}
	return Vec3{}, false
}

// crossing finds a cusp of the base in the interval from t0 to t1 across
// which its tangent line continues, and returns its parameter. It requires
// a zero t* of the velocity, located by bisection where an end does not
// already stand still, with a stable acceleration a* there, and checks
// that it is simple and the only one: at both ends and the middle, r′(t)
// lies within ½|t − t*||a*| of (t − t*)a*, so the line turns by less than
// 30° across the interval, and the chord lies within its bound of the
// integral of (t − t*)a*, so no pole lies between. ok is false for any
// other break, such as a corner, a regular turn too tight for the samples,
// or a gap.
func (u units) crossing(base evaluation, t0, t1 float64) (float64, bool) {
	type sample struct {
		t       float64
		r, v, a Vec3
	}
	at := func(t float64) (sample, bool) {
		r, v, a, ok := base(t)
		return sample{t, r, v, a}, ok && r.valid() && v.valid()
	}
	s0, ok0 := at(t0)
	s1, ok1 := at(t1)
	if !ok0 || !ok1 {
		return 0, false
	}
	cusp := s0
	switch {
	case u.still(s0.v):
	case u.still(s1.v):
		cusp = s1
	default:
		// The velocity's component along w, toward which the tangent turns,
		// changes sign at the zero.
		// Without a sign change the bisection ends at an end, which moves.
		w := s1.v.unit().sub(s0.v.unit())
		lo, hi := t0, t1
		for {
			m := lo + (hi-lo)/2
			s, ok := at(m)
			if !ok {
				return 0, false
			}
			cusp = s
			if u.still(s.v) || m <= lo || m >= hi {
				break
			}
			if s.v.dot(w) < 0 {
				lo = m
			} else {
				hi = m
			}
		}
	}
	a := cusp.a
	// A vanishing acceleration fails the bound below: the zero is not simple.
	if !u.still(cusp.v) || !a.valid() {
		return 0, false
	}
	middle, ok := at(t0 + (t1-t0)/2)
	if !ok {
		return 0, false
	}
	for _, s := range []sample{s0, middle, s1} {
		dt := s.t - cusp.t
		if s.v.sub(a.mul(dt)).norm() > 0.5*math.Abs(dt)*a.norm()+1e-9*u.speed {
			return 0, false
		}
	}
	d0, d1 := t0-cusp.t, t1-cusp.t
	chord := s1.r.sub(s0.r)
	if chord.sub(a.mul((d1*d1-d0*d0)/2)).norm() > 0.25*a.norm()*(d0*d0+d1*d1)+1e-9*u.size {
		return 0, false
	}
	return cusp.t, true
}

// crossings are the broken intervals of the base, among the n intervals
// of [lo, hi], that a cusp crosses, each with its cusp's place as a
// fraction of the domain (0 for a closed curve's cusp at hi, where its
// ends meet).
func (u units) crossings(base evaluation, breaks []bool, lo, hi float64, closed bool) map[int]float64 {
	n := len(breaks) - 1
	at := func(i int) float64 { return lo*(1-float64(i)/float64(n)) + hi*float64(i)/float64(n) }
	out := map[int]float64{}
	for i := 0; i < n; i++ {
		if !breaks[i+1] {
			continue
		}
		if t, ok := u.crossing(base, at(i), at(i+1)); ok {
			s := (t - lo) / (hi - lo)
			if closed && s > 1-1e-9 {
				s = 0
			}
			out[i] = s
		}
	}
	return out
}

// crossed counts the cusps of the intervals still joined among those
// crossings found. A cusp on a sample crosses both intervals beside it,
// and is counted once.
func crossed(crossing map[int]float64, breaks []bool) int {
	var places []float64
	for i, s := range crossing {
		if !breaks[i+1] {
			places = append(places, s)
		}
	}
	sort.Float64s(places)
	cusps := 0
	for k, s := range places {
		if k == 0 || s-places[k-1] > 1e-9 {
			cusps++
		}
	}
	return cusps
}
