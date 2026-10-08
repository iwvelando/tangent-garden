package engine3

import "math"

// StrandRequest is the offset strand a construction is built on when its
// input is "strand": g(t) = r(t) + d D(t), with D = cos θ U + sin θ V in the
// base's rotation-minimizing frame (U from e_z where each unbroken stretch
// begins, V = T × U) and θ(s) = θ₀ + 2πN s/L, s the arc length and L its
// total. Offset is d, Angle θ₀ in radians and Twist N in turns. On an
// unbroken closed loop the frame's holonomy is always distributed along it,
// so the strand closes when N is whole. It is read only for that input, and
// is independent of the framed construction's frame, so a ribbon, a tube's
// meridians or strands can turn about a strand on their own terms.
type StrandRequest struct {
	Offset float64 `json:"offset"`
	Angle  float64 `json:"angle"`
	Twist  float64 `json:"twist"`
}

// strandReference is N₀ for the strand input: the frame starts from e_z.
var strandReference = Vec3{0, 0, 1}

func (q StrandRequest) validate() error {
	switch {
	case !finite(q.Offset) || q.Offset < 0 || q.Offset > 1e5:
		return fieldErr("strand.offset", "the strand's distance d must be finite, from 0 to 100000")
	case !finite(q.Angle) || math.Abs(q.Angle) > 1000:
		return fieldErr("strand.angle", "the strand's angle θ₀ must be finite and within ±1000 radians")
	case !finite(q.Twist) || math.Abs(q.Twist) > 100:
		return fieldErr("strand.twist", "the strand's twist must be finite and within ±100 turns")
	}
	return nil
}

// strander holds the strand input's frame and arc length at the base's
// samples, from which it is evaluated at any t.
type strander struct {
	StrandRequest
	base      evaluation
	lo, hi, h float64
	n         int
	curve     []*Vec3
	tangents  []Vec3
	speeds    []float64
	arc       []float64
	us        []Vec3
	open      []bool
	length    float64
	// correction is the holonomy distributed along a closed loop.
	correction float64
}

// evaluation returns the strand's evaluator from the base's, together with
// its position alone, which refinement evaluates between samples, and
// whether the strand closes. The frame is tabulated at the base's samples
// as the framed construction tabulates it: transported by double reflection
// along the samples, started from e_z after every break, with Simpson arc
// length per interval. At any t it is completed by one transport step from
// the sample at or before t, with the arc length carried on by the Simpson
// step over part of the interval, as the framed construction's strands are
// refined (see carried.along), so the strand passes through its samples.
//
// The derivatives are written from the base's own and the frame's
// transport law, never by differencing g. With σ = |r′|, T′ = (r″ −
// (r″·T)T)/σ and ω = (2πN + C)/L, C the distributed correction:
// U′ = −(U·T′)T and V′ = −(V·T′)T, so D′ = ωσ T×D − (D·T′)T and
// D″ = ω(r″·T) T×D + ωσ T′×D − (ωσ)²D − (ωσ (T×D)·T′ + D·T″)T − (D·T′)T′,
// with only T″ differenced from T; g′ = r′ + dD′ and g″ = r″ + dD″.
func (q StrandRequest) evaluation(base evaluation, lo, hi float64, curve []*Vec3, tangents []Vec3, breaks []bool, closed bool) (evaluation, func(float64) Vec3, bool, error) {
	n := len(curve) - 1
	u := &strander{StrandRequest: q, base: base, lo: lo, hi: hi, h: (hi - lo) / float64(n), n: n, curve: curve, tangents: tangents,
		speeds: make([]float64, n+1), arc: make([]float64, n+1), us: make([]Vec3, n+1), open: make([]bool, n)}
	for i := range curve {
		if _, v, _, ok := base(u.knot(i)); ok && v.valid() {
			u.speeds[i] = v.norm()
		}
	}
	if closed {
		u.speeds[n] = u.speeds[0]
	}
	pieces := 0
	for i := 0; i < n; i++ {
		u.arc[i+1] = u.arc[i]
		_, middle, _, ok := base(lo + (hi-lo)*(float64(i)+0.5)/float64(n))
		u.open[i] = curve[i] != nil && curve[i+1] != nil && !breaks[i+1] && ok && middle.valid()
		if u.open[i] {
			u.arc[i+1] += u.h / 6 * (u.speeds[i] + 4*middle.norm() + u.speeds[i+1])
		}
	}
	u.length = u.arc[n]
	for i := 0; i <= n; i++ {
		switch {
		case curve[i] == nil:
		case i == 0 || curve[i-1] == nil || breaks[i]:
			u.us[i], _ = start(strandReference, tangents[i])
			pieces++
		default:
			u.us[i] = transport(u.us[i-1], *curve[i-1], tangents[i-1], *curve[i], tangents[i])
		}
	}
	loop := closed && pieces == 1 && curve[0] != nil && curve[n] != nil
	if loop {
		holonomy := math.Atan2(u.us[0].cross(u.us[n]).dot(tangents[0]), u.us[0].dot(u.us[n]))
		u.correction = -holonomy
		for i := range u.us {
			if curve[i] != nil && u.correction != 0 {
				psi := u.correction * u.arc[i] / u.length
				v := tangents[i].cross(u.us[i])
				u.us[i] = u.us[i].mul(math.Cos(psi)).add(v.mul(math.Sin(psi)))
			}
		}
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
		g, ok := u.place(t)
		if !ok {
			return invalid, invalid, invalid, false
		}
		T, D, sigma, a := g.tangent, g.direction, g.speed, g.acceleration
		dT := a.sub(T.mul(a.dot(T))).mul(1 / sigma)
		side := T.cross(D)
		w := u.spin() * sigma
		dD := side.mul(w).sub(T.mul(D.dot(dT)))
		velocity := g.velocity.add(dD.mul(q.Offset))
		ddT := g.ddT(tangent, t, lo, hi, span)
		acceleration := invalid
		if ddT.valid() {
			ddD := side.mul(u.spin() * a.dot(T)).add(dT.cross(D).mul(w)).sub(D.mul(w * w)).
				sub(T.mul(w*side.dot(dT) + D.dot(ddT))).sub(dT.mul(D.dot(dT)))
			acceleration = a.add(ddD.mul(q.Offset))
		}
		return g.point, velocity, acceleration, true
	}
	position := func(t float64) Vec3 {
		g, ok := u.place(t)
		if !ok {
			return invalid
		}
		return g.point
	}
	// A whole number of turns brings D back where the distributed frame
	// returns.
	closes := loop && q.Twist == math.Round(q.Twist)
	return evaluate, position, closes, nil
}

func (u *strander) knot(i int) float64 {
	return u.lo*(1-float64(i)/float64(u.n)) + u.hi*float64(i)/float64(u.n)
}

// spin is ω, the rate in arc length at which D turns about T within the
// rotation-minimizing frame.
func (u *strander) spin() float64 {
	if u.length > 0 {
		return (2*math.Pi*u.Twist + u.correction) / u.length
	}
	return 0
}

// strandAt is the strand at one parameter: its point, the base's speed,
// velocity, acceleration and unit tangent, and the offset direction.
type strandAt struct {
	point, velocity, acceleration, tangent, direction Vec3
	speed                                             float64
}

// ddT differences the base's unit tangent twice at two steps, and is
// nonfinite where they disagree, as for an expression curve.
func (g strandAt) ddT(tangent func(float64) Vec3, t, lo, hi, span float64) Vec3 {
	_, a := derivatives(tangent, t, lo, hi, span*1e-4)
	_, b := derivatives(tangent, t, lo, hi, span*5e-5)
	if !a.valid() || !b.valid() || a.sub(b).norm() > 1e-2*math.Max(a.norm(), b.norm())+1e-4*math.Max(1, g.speed/span) {
		return Vec3{math.NaN(), 0, 0}
	}
	return a
}

// place is the strand at t; not ok where t lies in no interval the frame
// joins, or the base there is undefined or stationary.
//
//go:noinline
func (u *strander) place(t float64) (strandAt, bool) {
	x := (t - u.lo) / u.h
	i := max(0, min(u.n-1, int(math.Floor(x))))
	switch {
	case u.open[i]:
	case i > 0 && u.open[i-1] && x-float64(i) < 1e-9:
		i--
	case i < u.n-1 && u.open[i+1] && float64(i+1)-x < 1e-9:
		i++
	default:
		return strandAt{}, false
	}
	r, v, a, ok := u.base(t)
	speed := v.norm()
	if !ok || !r.valid() || !v.valid() || !a.valid() || speed < 1e-9 {
		return strandAt{}, false
	}
	T := v.mul(1 / speed)
	start := u.knot(i)
	U, arc := u.us[i], u.arc[i]
	if t != start {
		_, middle, _, _ := u.base((start + t) / 2)
		arc += (t - start) / 6 * (u.speeds[i] + 4*middle.norm() + speed)
		U = transport(U, *u.curve[i], u.tangents[i], r, T)
		if u.correction != 0 {
			psi := u.correction * (arc - u.arc[i]) / u.length
			U = U.mul(math.Cos(psi)).add(T.cross(U).mul(math.Sin(psi)))
		}
	}
	theta := u.Angle
	if u.length > 0 {
		theta += 2 * math.Pi * u.Twist * arc / u.length
	}
	D := U.mul(math.Cos(theta)).add(T.cross(U).mul(math.Sin(theta)))
	return strandAt{r.add(D.mul(u.Offset)), v, a, T, D, speed}, true
}
