package engine

import (
	"fmt"
	"math"
	"sort"
)

// MovingCurve is a curve rolling without slipping along the base curve,
// defined parametrically in its own frame by X(t), Y(t) for t from Min to Max.
// The contact starts at t = Start, and arc length is matched: after the base
// has rolled an arc length s from its domain start, the contact lies at arc
// length s from Start along the moving curve, where the two are tangent.
//
// On the left, the contact runs forward (toward Max), and the moving curve's
// own left side lies on the base's left. On the right, it runs backward, and
// the moving curve's left side lies on the base's right. A counterclockwise
// closed curve has its interior on its left, so these are the sides of a
// rolling circle. A closed moving curve, whose ends meet with a common
// tangent, wraps around indefinitely; an open one stops at its domain's end.
type MovingCurve struct {
	X     string  `json:"x"`
	Y     string  `json:"y"`
	Min   float64 `json:"min"`
	Max   float64 `json:"max"`
	Start float64 `json:"start"`
}

// Placement is the rigid motion carrying the moving curve's frame to the
// drawing at base sample SampleIndex: a frame point v lands at
// Origin + rot(Angle)v. Contact and Point are the contact and tracing point.
type Placement struct {
	SampleIndex int     `json:"sampleIndex"`
	Origin      Vec     `json:"origin"`
	Angle       float64 `json:"angle"`
	Contact     Vec     `json:"contact"`
	Point       Vec     `json:"point"`
}

// MovingResult is the rolling curve in its own frame, sampled over its domain
// with gaps where it is undefined, and its placements at representative
// samples.
type MovingResult struct {
	Path      []*Vec      `json:"path"`
	Closed    bool        `json:"closed"`
	Positions []Placement `json:"positions"`
}

// Why a rolling curve could not be placed.
type stop int

const (
	placedOK stop = iota
	// The contact reached the end of an open curve's domain.
	exhausted
	// The contact reached a cusp, corner, or undefined point.
	irregular
)

// mover matches arc length on the moving curve. It samples the curve on a
// uniform grid, accumulates Simpson arc length per interval, and inverts it
// within an interval by Newton's method on the same rule, so the contact is
// as accurate as the base's own arc length.
type mover struct {
	f       curveFunc
	lo, hi  float64
	h       float64
	arc     []float64 // arc length from lo to each grid point
	speed   []float64 // |m'| at each grid point
	ok      []bool    // whether each interval is regular
	first   int       // the reachable intervals on an open curve
	last    int
	closed  bool
	sign    float64 // +1 rolling forward (left), −1 backward (right)
	start   float64 // arc coordinate of the first contact
	tracing Vec
}

func newMover(c Roller, a float64, samples int) (*mover, *MovingResult, error) {
	m := c.Curve
	f, err := compile(Curve{Format: "parametric", X: m.X, Y: m.Y, Min: m.Min, Max: m.Max, A: a})
	if err != nil {
		return nil, nil, within("curve", fmt.Errorf("rolling curve %w", err))
	}
	if !finite(m.Start) || m.Start < m.Min || m.Start > m.Max {
		return nil, nil, fieldErr("curve.start", "the rolling curve's contact starts at t = %g, outside its domain %g to %g", m.Start, m.Min, m.Max)
	}
	n := samples - 1
	v := &mover{f: f, lo: m.Min, hi: m.Max, h: (m.Max - m.Min) / float64(n), tracing: c.Point}
	v.arc, v.speed, v.ok = make([]float64, n+1), make([]float64, n+1), make([]bool, n)
	out := &MovingResult{Path: make([]*Vec, n+1), Positions: []Placement{}}
	regular := make([]bool, n+1)
	d := make([]Vec, n+1)
	for k := range regular {
		u := v.grid(k)
		p := f(u)
		d[k], _ = derivatives(f, u, v.lo, v.hi)
		v.speed[k] = d[k].Norm()
		out.Path[k] = point(p)
		regular[k] = p.Valid() && stableTangent(f, u, v.lo, v.hi, d[k]) && v.speed[k] > 0
	}
	all := true
	for k := 0; k < n; k++ {
		b, _ := derivatives(f, v.grid(k)+v.h/2, v.lo, v.hi)
		inc := v.h / 6 * (v.speed[k] + 4*b.Norm() + v.speed[k+1])
		// A tangent reversing within one interval marks a cusp or corner.
		v.ok[k] = regular[k] && regular[k+1] && d[k].Dot(b) > 0 && b.Dot(d[k+1]) > 0 && finite(inc)
		v.arc[k+1] = v.arc[k]
		if v.ok[k] {
			v.arc[k+1] += inc
		}
		all = all && v.ok[k]
	}
	if all {
		gap := f(v.hi).Sub(f(v.lo)).Norm()
		size := 0.0
		for _, p := range out.Path {
			size = math.Max(size, p.Sub(*out.Path[0]).Norm())
		}
		v.closed = gap <= 1e-9*(1+size) && d[n].Unit().Sub(d[0].Unit()).Norm() <= 1e-6
	}
	out.Closed = v.closed
	v.sign = 1
	k := int(math.Floor((m.Start - v.lo) / v.h))
	if c.Side == "right" {
		v.sign = -1
		k = int(math.Ceil((m.Start-v.lo)/v.h)) - 1
	}
	k = max(0, min(n-1, k))
	v.start = v.arc[k] + v.simpson(k, m.Start)
	// An open curve rolls only across the regular intervals next to the start.
	v.first, v.last = k, k
	if !v.ok[k] {
		return v, out, nil
	}
	for v.first > 0 && v.ok[v.first-1] {
		v.first--
	}
	for v.last < n-1 && v.ok[v.last+1] {
		v.last++
	}
	return v, out, nil
}

func (v *mover) grid(k int) float64 {
	if k == len(v.arc)-1 {
		return v.hi
	}
	return v.lo + float64(k)*v.h
}

// simpson is the arc length from grid point k to u within its interval.
func (v *mover) simpson(k int, u float64) float64 {
	a := v.grid(k)
	mid, _ := derivatives(v.f, (a+u)/2, v.lo, v.hi)
	end, _ := derivatives(v.f, u, v.lo, v.hi)
	return (u - a) / 6 * (v.speed[k] + 4*mid.Norm() + end.Norm())
}

// contact finds the moving curve's parameter after rolling an arc length s.
func (v *mover) contact(s float64) (float64, stop) {
	target := v.start + v.sign*s
	length := v.arc[len(v.arc)-1]
	first, last := v.first, v.last
	if v.closed {
		target = math.Mod(target, length)
		if target < 0 {
			target += length
		}
		first, last = 0, len(v.ok)-1
	} else if slack := 1e-12 * (1 + length); !v.ok[first] {
		return 0, irregular
	} else if past, before := target > v.arc[last+1]+slack, target < v.arc[first]-slack; past || before {
		// Rolling back out of a base cusp, the contact can run off either
		// end of the regular stretch around the start.
		if past && last == len(v.ok)-1 || before && first == 0 {
			return 0, exhausted
		}
		return 0, irregular
	}
	target = math.Max(v.arc[first], math.Min(v.arc[last+1], target))
	k := first + sort.Search(last-first, func(i int) bool { return v.arc[first+i+1] >= target })
	k = min(k, last)
	a, b := v.grid(k), v.grid(k+1)
	u := a
	if span := v.arc[k+1] - v.arc[k]; span > 0 {
		u = a + (b-a)*(target-v.arc[k])/span
	}
	for i := 0; i < 20; i++ {
		residual := v.arc[k] + v.simpson(k, u) - target
		if math.Abs(residual) <= 1e-15*(1+length) {
			break
		}
		d, _ := derivatives(v.f, u, v.lo, v.hi)
		u = math.Max(a, math.Min(b, u-residual/d.Norm()))
	}
	return u, placedOK
}

// place sets the moving curve on the base point p with derivative d after
// rolling an arc length s: the contact point goes to p, and its tangent, in
// the direction of rolling, along the base's.
func (v *mover) place(p, d Vec, s float64) (Placement, stop) {
	u, why := v.contact(s)
	if why != placedOK {
		return Placement{}, why
	}
	m := v.f(u)
	dm, _ := derivatives(v.f, u, v.lo, v.hi)
	tm := dm.Mul(v.sign)
	angle := math.Remainder(math.Atan2(d.Y, d.X)-math.Atan2(tm.Y, tm.X), 2*math.Pi)
	sin, cos := math.Sincos(angle)
	rot := func(w Vec) Vec { return Vec{cos*w.X - sin*w.Y, sin*w.X + cos*w.Y} }
	out := Placement{Origin: p.Sub(rot(m)), Angle: angle, Contact: p, Point: p.Add(rot(v.tracing.Sub(m)))}
	if !out.Point.Valid() || !out.Origin.Valid() || dm.Norm() == 0 {
		return Placement{}, irregular
	}
	return out, placedOK
}
