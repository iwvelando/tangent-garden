package engine3

import (
	"fmt"
	"math"
	"sort"
	"tangentgarden/engine/expr"
)

type Curve struct {
	X   string  `json:"x"`
	Y   string  `json:"y"`
	Z   string  `json:"z"`
	Min float64 `json:"min"`
	Max float64 `json:"max"`
	A   float64 `json:"a"`
}
type Bounds struct {
	Center Vec3    `json:"center"`
	Radius float64 `json:"radius"`
}

func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }
func (v Vec3) valid() bool {
	return finite(v.X) && finite(v.Y) && finite(v.Z) && math.Max(math.Abs(v.X), math.Max(math.Abs(v.Y), math.Abs(v.Z))) < 1e12
}

type evaluation func(float64) (Vec3, Vec3, Vec3, bool)

// domain checks a parameter or time interval.
func domain(lo, hi float64) error {
	span := hi - lo
	if !finite(lo) || !finite(hi) || math.Abs(lo) > 1e6 || math.Abs(hi) > 1e6 || span < 1e-6 || span > 1e5 {
		return fmt.Errorf("domain start must be below end, within ±1000000, with width 0.000001–100000")
	}
	return nil
}

// compile returns the base curve's evaluator. A vector field's base is its
// first trajectory, from flow, which Compute integrates beforehand.
func compile(c Request, flow *flowCurve) (evaluation, float64, float64, bool, error) {
	if c.Format == "" || c.Format == "torus" {
		gcd := func(a, b int) int {
			for b != 0 {
				a, b = b, a%b
			}
			return a
		}
		if !finite(c.Radius) || !finite(c.Tube) || c.Radius < 0.1 || c.Radius > 20 || c.Tube < 0.01 || c.Tube >= c.Radius {
			return nil, 0, 0, false, fmt.Errorf("require 0.1 ≤ radius ≤ 20 and 0.01 ≤ tube < radius")
		}
		if c.P < 1 || c.P > 8 || c.Q < 1 || c.Q > 9 || gcd(c.P, c.Q) != 1 {
			return nil, 0, 0, false, fmt.Errorf("windings must be coprime integers (p: 1–8, q: 1–9)")
		}
		return func(t float64) (Vec3, Vec3, Vec3, bool) { r, v, a := knot(c, t); return r, v, a, true }, 0, 2 * math.Pi, true, nil
	}
	if c.Format == "harmonic" {
		h := c.Harmonic
		if err := domain(h.Min, h.Max); err != nil {
			return nil, 0, 0, false, err
		}
		if err := h.validate(); err != nil {
			return nil, 0, 0, false, err
		}
		_, _, closed := h.closure()
		return h.evaluate, h.Min, h.Max, closed, nil
	}
	if c.Format == "field" {
		v := c.Field
		return flow.flows[0].evaluation(flow.f, v.Max-v.Min), v.Min, v.Max, false, nil
	}
	if c.Format != "parametric" {
		return nil, 0, 0, false, fmt.Errorf("unknown spatial curve definition")
	}
	q := c.Curve
	span := q.Max - q.Min
	if err := domain(q.Min, q.Max); err != nil {
		return nil, 0, 0, false, err
	}
	expressions := make([]expr.Expr, 3)
	for i, s := range []string{q.X, q.Y, q.Z} {
		e, err := expr.ParseWithParameter(s, q.A)
		if err != nil {
			return nil, 0, 0, false, fmt.Errorf("%s(t): %w", []string{"x", "y", "z"}[i], err)
		}
		expressions[i] = e
	}
	f := func(t float64) Vec3 { return Vec3{expressions[0](t), expressions[1](t), expressions[2](t)} }
	return sampled(f, q.Min, q.Max, span), q.Min, q.Max, false, nil
}

// sampled differentiates expressions numerically on [lo, hi] (which may be
// unbounded) with steps scaled to span, reporting whether the velocity is
// stable under a halved step and discarding an unstable acceleration.
func sampled(f func(float64) Vec3, lo, hi, span float64) evaluation {
	return func(t float64) (Vec3, Vec3, Vec3, bool) {
		r := f(t)
		v, a := derivatives(f, t, lo, hi, span*1e-4)
		v2, a2 := derivatives(f, t, lo, hi, span*5e-5)
		stable := r.valid() && v.valid() && v2.valid() && v.sub(v2).norm() <= 1e-3*math.Max(v.norm(), v2.norm())+1e-8
		if !a.valid() || !a2.valid() || a.sub(a2).norm() > 1e-2*math.Max(a.norm(), a2.norm())+1e-4*math.Max(1, v.norm()/span) {
			a = Vec3{math.NaN(), 0, 0}
		}
		return r, v, a, stable
	}
}

// Bounded five-point Lagrange stencils, including one-sided endpoints. Subtract
// the central position before differentiating to reduce translation roundoff.
func derivatives(f func(float64) Vec3, t, lo, hi, h float64) (Vec3, Vec3) {
	start := math.Max(lo, math.Min(t-2*h, hi-4*h))
	a := (t - start) / h
	origin := f(t)
	var d, dd Vec3
	for j := 0; j < 5; j++ {
		coeff := []float64{1}
		den := 1.0
		for k := 0; k < 5; k++ {
			if k == j {
				continue
			}
			b := a - float64(k)
			next := make([]float64, len(coeff)+1)
			for n, c := range coeff {
				next[n] += c * b
				next[n+1] += c
			}
			coeff = next
			den *= float64(j - k)
		}
		v := f(start + float64(j)*h).sub(origin)
		d = d.add(v.mul(coeff[1] / den / h))
		dd = dd.add(v.mul(2 * coeff[2] / den / h / h))
	}
	return d, dd
}

// Robust bounds are fitted independently per point family before unioning.
// Outer Tukey fences trim isolated asymptotic tails, never a whole distant edge.
func fit(families ...[]*Vec3) Bounds {
	low := Vec3{math.Inf(1), math.Inf(1), math.Inf(1)}
	high := low.mul(-1)
	found := false
	for _, family := range families {
		values := [3][]float64{}
		for _, p := range family {
			if p != nil {
				values[0] = append(values[0], p.X)
				values[1] = append(values[1], p.Y)
				values[2] = append(values[2], p.Z)
			}
		}
		if len(values[0]) == 0 {
			continue
		}
		found = true
		for axis, vs := range values {
			sort.Float64s(vs)
			l, h := vs[0], vs[len(vs)-1]
			if len(vs) >= 8 {
				q1, q3 := vs[len(vs)/4], vs[3*len(vs)/4]
				spread := q3 - q1
				if spread > 1e-12 {
					a, b := q1-3*spread, q3+3*spread
					for _, v := range vs {
						if v >= a {
							l = v
							break
						}
					}
					for j := len(vs) - 1; j >= 0; j-- {
						if vs[j] <= b {
							h = vs[j]
							break
						}
					}
				}
			}
			switch axis {
			case 0:
				low.X = math.Min(low.X, l)
				high.X = math.Max(high.X, h)
			case 1:
				low.Y = math.Min(low.Y, l)
				high.Y = math.Max(high.Y, h)
			case 2:
				low.Z = math.Min(low.Z, l)
				high.Z = math.Max(high.Z, h)
			}
		}
	}
	if !found {
		return Bounds{Vec3{}, 1}
	}
	center := low.add(high).mul(0.5)
	radius := 1e-4
	for _, family := range families {
		for _, p := range family {
			if p != nil && p.X >= low.X && p.X <= high.X && p.Y >= low.Y && p.Y <= high.Y && p.Z >= low.Z && p.Z <= high.Z {
				radius = math.Max(radius, p.sub(center).norm())
			}
		}
	}
	return Bounds{center, radius}
}
