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

// compile returns the base curve's evaluator. The base of a vector field or
// a pursuit is its first path, which Compute integrates beforehand and
// passes as integrated.
func compile(c Request, integrated evaluation) (evaluation, float64, float64, bool, error) {
	if c.Format == "" || c.Format == "torus" {
		gcd := func(a, b int) int {
			for b != 0 {
				a, b = b, a%b
			}
			return a
		}
		if !finite(c.Radius) || c.Radius < 0.1 || c.Radius > 20 {
			return nil, 0, 0, false, fieldErr("radius", "require 0.1 ≤ radius ≤ 20 and 0.01 ≤ tube < radius")
		}
		if !finite(c.Tube) || c.Tube < 0.01 || c.Tube >= c.Radius {
			return nil, 0, 0, false, fieldErr("tube", "require 0.1 ≤ radius ≤ 20 and 0.01 ≤ tube < radius")
		}
		if c.P < 1 || c.P > 8 {
			return nil, 0, 0, false, fieldErr("p", "windings must be coprime integers (p: 1–8, q: 1–9)")
		}
		if c.Q < 1 || c.Q > 9 || gcd(c.P, c.Q) != 1 {
			return nil, 0, 0, false, fieldErr("q", "windings must be coprime integers (p: 1–8, q: 1–9)")
		}
		return func(t float64) (Vec3, Vec3, Vec3, bool) { r, v, a := knot(c, t); return r, v, a, true }, 0, 2 * math.Pi, true, nil
	}
	if c.Format == "harmonic" {
		h := c.Harmonic
		if err := domain(h.Min, h.Max); err != nil {
			return nil, 0, 0, false, named(ends("harmonic.min", "harmonic.max", h.Min), err)
		}
		if err := h.validate(); err != nil {
			return nil, 0, 0, false, err
		}
		_, _, closed := h.closure()
		return h.evaluate, h.Min, h.Max, closed, nil
	}
	if c.Format == "field" {
		return integrated, c.Field.Min, c.Field.Max, false, nil
	}
	if c.Format == "pursuit" {
		return integrated, c.Pursuit.Min, c.Pursuit.Max, false, nil
	}
	if c.Format != "parametric" {
		return nil, 0, 0, false, fieldErr("format", "unknown spatial curve definition")
	}
	q := c.Curve
	span := q.Max - q.Min
	if err := domain(q.Min, q.Max); err != nil {
		return nil, 0, 0, false, named(ends("curve.min", "curve.max", q.Min), err)
	}
	expressions := make([]expr.Expr, 3)
	for i, s := range []string{q.X, q.Y, q.Z} {
		e, err := expr.ParseWithParameter(s, q.A)
		if err != nil {
			return nil, 0, 0, false, named("curve."+[]string{"x", "y", "z"}[i], fmt.Errorf("%s(t): %w", []string{"x", "y", "z"}[i], err))
		}
		expressions[i] = e
	}
	f := func(t float64) Vec3 { return Vec3{expressions[0](t), expressions[1](t), expressions[2](t)} }
	size := extent(f, q.Min, q.Max)
	u := sized(size, span, absolute)
	evaluate := sampled(f, q.Min, q.Max, span, u)
	// A large constant translation rounds away the tiny displacements that
	// determine a tangent near a cusp. Differentiate the moving expression
	// before that translation is added, keeping positions exactly as entered.
	// Ordinary studies keep their original numerical path bit for bit.
	if size > 0 && f((q.Min+q.Max)/2).norm() > 8*size {
		var local [3]expr.Expr
		var shifts [3]float64
		parsed := true
		for i, s := range []string{q.X, q.Y, q.Z} {
			// The same expressions and parameter were validated above; an
			// error here keeps the entered expressions' stencil.
			var err error
			local[i], shifts[i], err = expr.ParseLocalWithParameter(s, q.A)
			parsed = parsed && err == nil
		}
		origin := Vec3{shifts[0], shifts[1], shifts[2]}
		if parsed && origin.valid() && origin.norm() > 8*size {
			moving := sampled(func(t float64) Vec3 { return Vec3{local[0](t), local[1](t), local[2](t)} }, q.Min, q.Max, span, u)
			evaluate = func(t float64) (Vec3, Vec3, Vec3, bool) {
				r := f(t)
				_, v, a, ok := moving(t)
				return r, v, a, ok && r.valid()
			}
		}
	}
	return evaluate, q.Min, q.Max, false, nil
}

// units are a curve's own size, and the speed, acceleration and third
// derivative it gives it over a parameter span, in which the floors below
// which a derivative is lost in rounding, a chord is rounding, or a curve
// stands still, are measured. They move with the curve's size and not with its position, so
// a scaled or moved copy of a study keeps its decisions.
type units struct{ size, speed, acceleration, jerk float64 }

// absolute are the units of a curve with no size of its own, or of a pure
// number, in which the floors are absolute.
var absolute = units{1, 1, 1, 1}

// sized returns the units of a curve of the given size over span, or
// fallback when it has no size.
func sized(size, span float64, fallback units) units {
	if size > 0 {
		return units{size, size / span, size / (span * span), size / (span * span * span)}
	}
	return fallback
}

// still reports a velocity too small, beside the curve's units, to give
// it a direction.
func (u units) still(v Vec3) bool { return v.norm() < 1e-9*u.speed }

// units are an evaluation's own units on [lo, hi], from its positions, or
// fallback when it has no size.
func (e evaluation) units(lo, hi float64, fallback units) units {
	return sized(extent(func(t float64) Vec3 { r, _, _, _ := e(t); return r }, lo, hi), hi-lo, fallback)
}

// extent is a curve's size: twice the robustly fitted radius of its points at
// 65 evenly spaced parameters and 64 staggered probes on [lo, hi], unchanged
// by a translation and scaled with the curve. The second set avoids treating
// a regular curve that aliases the uniform grid as a stationary point.
// It is 0 for a curve with no size of its own: one
// whose points there are apart by no more than rounding, or are fewer
// than two.
func extent(f func(float64) Vec3, lo, hi float64) float64 {
	low := Vec3{math.Inf(1), math.Inf(1), math.Inf(1)}
	high := low.mul(-1)
	points := make([]*Vec3, 0, 129)
	include := func(t float64) {
		if p := f(t); p.valid() {
			points = append(points, &p)
			low = Vec3{math.Min(low.X, p.X), math.Min(low.Y, p.Y), math.Min(low.Z, p.Z)}
			high = Vec3{math.Max(high.X, p.X), math.Max(high.Y, p.Y), math.Max(high.Z, p.Z)}
		}
	}
	for k := 0; k <= 64; k++ {
		include(lo + (hi-lo)*float64(k)/64)
	}
	// Irrationally staggered parameters do not share the uniform grid's
	// period. This remains a bounded estimate, not a feature certificate.
	const goldenFraction = 0.6180339887498949
	for k := 1; k <= 64; k++ {
		include(lo + (hi-lo)*math.Mod(float64(k)*goldenFraction, 1))
	}
	size := high.sub(low).norm()
	magnitude := math.Max(low.norm(), high.norm())
	if !finite(size) || size <= 1e-12*magnitude {
		return 0
	}
	// A rounded value at a pole can enter the coordinate guard after
	// scaling, without belonging to a regular branch. The same robust fit
	// used for framing prevents it from setting every branch's floors.
	return 2 * fit(points).Radius
}

// sampled differentiates expressions numerically on [lo, hi] (which may be
// unbounded) with steps scaled to span, reporting whether the velocity is
// stable under a halved step and discarding an unstable acceleration. Each
// test has a floor in the curve's units u, below which a difference is
// rounding.
func sampled(f func(float64) Vec3, lo, hi, span float64, u units) evaluation {
	return func(t float64) (Vec3, Vec3, Vec3, bool) {
		r := f(t)
		v, a := derivatives(f, r, t, lo, hi, span*1e-4)
		v2, a2 := derivatives(f, r, t, lo, hi, span*5e-5)
		stable := r.valid() && v.valid() && v2.valid() && v.sub(v2).norm() <= 1e-3*math.Max(v.norm(), v2.norm())+1e-8*u.speed
		if !a.valid() || !a2.valid() || a.sub(a2).norm() > 1e-2*math.Max(a.norm(), a2.norm())+1e-4*math.Max(u.acceleration, v.norm()/span) {
			a = Vec3{math.NaN(), 0, 0}
		}
		return r, v, a, stable
	}
}

// Bounded five-point Lagrange stencils, including one-sided endpoints. Subtract
// the central position, origin = f(t), which the caller has already
// evaluated, before differentiating to reduce translation roundoff.
func derivatives(f func(float64) Vec3, origin Vec3, t, lo, hi, h float64) (Vec3, Vec3) {
	start := math.Max(lo, math.Min(t-2*h, hi-4*h))
	a := (t - start) / h
	var d, dd Vec3
	for j := 0; j < 5; j++ {
		// The basis polynomial's coefficients, lowest first, built in place
		// without allocating: m of them are in use.
		coeff := [5]float64{1}
		m := 1
		den := 1.0
		for k := 0; k < 5; k++ {
			if k == j {
				continue
			}
			b := a - float64(k)
			var next [5]float64
			for n, c := range coeff[:m] {
				next[n] += c * b
				next[n+1] += c
			}
			coeff = next
			m++
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
func fit(families ...[]*Vec3) Bounds { return fitReach(families, nil) }

// fitReach is fit with each family's reach between samples, reach[k] for
// families[k] (none past the end of reach; see RefinedPath). A point of a
// reach joins its family's extent when it lies within the fences its
// family's samples set on every axis, so an excursion toward an asymptote
// is left out as an outlying sample is.
func fitReach(families [][]*Vec3, reach [][]Vec3) Bounds {
	low := Vec3{math.Inf(1), math.Inf(1), math.Inf(1)}
	high := low.mul(-1)
	found := false
	var reached []Vec3
	for k, family := range families {
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
		// The family's core magnitude, its largest quartile on any axis,
		// sets the rounding its coordinates carry: quartiles apart by no
		// more than that have no spread to fence outliers with.
		core := 0.0
		for _, vs := range values {
			sort.Float64s(vs)
			core = math.Max(core, math.Max(math.Abs(vs[len(vs)/4]), math.Abs(vs[3*len(vs)/4])))
		}
		var lows, highs, fenceLow, fenceHigh [3]float64
		for axis, vs := range values {
			l, h := vs[0], vs[len(vs)-1]
			fenceLow[axis], fenceHigh[axis] = math.Inf(-1), math.Inf(1)
			if len(vs) >= 8 {
				q1, q3 := vs[len(vs)/4], vs[3*len(vs)/4]
				spread := q3 - q1
				if spread > 1e-12*core {
					a, b := q1-3*spread, q3+3*spread
					fenceLow[axis], fenceHigh[axis] = a, b
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
			lows[axis], highs[axis] = l, h
		}
		if k < len(reach) {
			for _, p := range reach[k] {
				c := [3]float64{p.X, p.Y, p.Z}
				inside := true
				for axis, v := range c {
					inside = inside && v >= fenceLow[axis] && v <= fenceHigh[axis]
				}
				if !inside {
					continue
				}
				reached = append(reached, p)
				for axis, v := range c {
					lows[axis], highs[axis] = math.Min(lows[axis], v), math.Max(highs[axis], v)
				}
			}
		}
		low = Vec3{math.Min(low.X, lows[0]), math.Min(low.Y, lows[1]), math.Min(low.Z, lows[2])}
		high = Vec3{math.Max(high.X, highs[0]), math.Max(high.Y, highs[1]), math.Max(high.Z, highs[2])}
	}
	if !found {
		return Bounds{Vec3{}, 1}
	}
	center := low.add(high).mul(0.5)
	radius := 0.0
	inside := func(p Vec3) bool {
		return p.X >= low.X && p.X <= high.X && p.Y >= low.Y && p.Y <= high.Y && p.Z >= low.Z && p.Z <= high.Z
	}
	for _, family := range families {
		for _, p := range family {
			if p != nil && inside(*p) {
				radius = math.Max(radius, p.sub(center).norm())
			}
		}
	}
	for _, p := range reached {
		radius = math.Max(radius, p.sub(center).norm())
	}
	// Points apart by no more than rounding have no size of their own, so a
	// lone point keeps a radius to be framed by; any other study's radius
	// is its own, however small.
	if radius <= 1e-12*center.norm() {
		radius = math.Max(radius, 1e-4)
	}
	return Bounds{center, radius}
}
