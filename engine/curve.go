package engine

import (
	"math"
	"tangentgarden/engine/expr"
)

type Curve struct {
	Format string  `json:"format"`
	X      string  `json:"x"`
	Y      string  `json:"y"`
	R      string  `json:"r"`
	Min    float64 `json:"min"`
	Max    float64 `json:"max"`
	A      float64 `json:"a"`
	// Roulette defines the curve when Format is "roulette"; t is its rolling
	// parameter and the expressions are ignored.
	Roulette Roulette `json:"roulette"`
	// Lissajous and Terms define the curve when Format is "lissajous" or
	// "fourier"; t is their time parameter.
	Lissajous Lissajous `json:"lissajous"`
	Terms     []Term    `json:"terms"`
	Pursuit   Pursuit   `json:"pursuit"`
	// Field defines the curve when Format is "field": the first seed's
	// trajectory, with t as time.
	Field VectorField `json:"field"`
	// Implicit defines the curve when Format is "implicit": the level set
	// F(x, y) = c, which has no parameter, so the domain plays no part.
	Implicit Implicit `json:"implicit"`
	// Attractor defines the drawing when Format is "attractor": the visit
	// density of an iterated map's orbit, which has no parameter either.
	Attractor Attractor `json:"attractor"`
}
type curveFunc func(float64) Vec

func compile(c Curve) (curveFunc, error) {
	if !finite(c.Min) {
		return nil, fieldErr("min", "domain bounds must be finite numbers")
	}
	if !finite(c.Max) {
		return nil, fieldErr("max", "domain bounds must be finite numbers")
	}
	if c.Min == c.Max {
		return nil, fieldErr("max", "domain start and end are equal (%g): the interval has zero width; keep the start below the end", c.Min)
	}
	if c.Min > c.Max {
		return nil, fieldErr("max", "domain start (%g) is greater than domain end (%g); keep the start below the end", c.Min, c.Max)
	}
	if math.Abs(c.Min) > 1e6 {
		return nil, fieldErr("min", "domain bounds must stay within ±1000000")
	}
	if math.Abs(c.Max) > 1e6 {
		return nil, fieldErr("max", "domain bounds must stay within ±1000000")
	}
	if span := c.Max - c.Min; span < 1e-6 || span > 1e5 {
		return nil, fieldErr("max", "domain width is %g; supported widths are 0.000001–100000", span)
	}
	if c.Format == "roulette" {
		if err := c.Roulette.validate(); err != nil {
			return nil, within("roulette", err)
		}
		return c.Roulette.curve(), nil
	}
	if c.Format == "lissajous" {
		if err := c.Lissajous.validate(); err != nil {
			return nil, within("lissajous", err)
		}
		return c.Lissajous.at, nil
	}
	if c.Format == "fourier" {
		if err := validateTerms(c.Terms); err != nil {
			return nil, err
		}
		terms := append([]Term{}, c.Terms...)
		return func(t float64) Vec { return fourierAt(terms, t) }, nil
	}
	if c.Format == "pursuit" {
		if err := c.Pursuit.validate(); err != nil {
			return nil, within("pursuit", err)
		}
		return newChase(c.Pursuit, c.Min, c.Max, chaseTolerance).pursuer(0), nil
	}
	if c.Format == "field" {
		if err := c.Field.validate(); err != nil {
			return nil, within("field", err)
		}
		f, _, err := c.Field.system(c.A)
		if err != nil {
			return nil, within("field", err)
		}
		return newTrajectory(f, c.Field.Seeds[0], c.Min, c.Max, c.Field.Escape, fieldTolerance).curve(), nil
	}
	if c.Format == "polar" {
		r, e := expr.ParseWithParameter(c.R, c.A)
		if e != nil {
			return nil, &FieldError{"r", e.Error()}
		}
		return func(t float64) Vec { return Vec{r(t) * math.Cos(t), r(t) * math.Sin(t)} }, nil
	}
	if c.Format == "cartesian" {
		c.X = "t"
	} else if c.Format != "parametric" {
		return nil, fieldErr("format", "unknown curve format")
	}
	x, e := expr.ParseWithParameter(c.X, c.A)
	if e != nil {
		return nil, fieldErr("x", "x: %v", e)
	}
	y, e := expr.ParseWithParameter(c.Y, c.A)
	if e != nil {
		return nil, fieldErr("y", "y: %v", e)
	}
	return func(t float64) Vec { return Vec{x(t), y(t)} }, nil
}

// Five-point Lagrange differentiation. The stencil stays inside the declared
// domain, including at endpoints; it never assumes the curve is periodic.
func derivatives(f curveFunc, t, lo, hi float64) (Vec, Vec) {
	return baseStencil(lo, hi).derivatives(f, t)
}

// stencil differentiates curves on a domain at spacing h, and checks the
// result against spacing h/2, to a relative tolerance plus an absolute floor
// on the first derivative.
type stencil struct{ lo, hi, h, floor float64 }

// baseStencil is the spacing for curves evaluated directly.
func baseStencil(lo, hi float64) stencil { return stencil{lo, hi, (hi - lo) * 1e-4, 1e-8} }

// inputStencil checks a derived input, whose rounding is far above a curve's
// own: its first derivative must agree relatively, with no absolute floor,
// so a derivative made of rounding, as at a cusp, is never accepted.
func inputStencil(lo, hi float64) stencil { return stencil{lo, hi, (hi - lo) * 1e-4, 0} }

func (s stencil) derivatives(f curveFunc, t float64) (Vec, Vec) {
	return derivativesAtStep(f, t, s.lo, s.hi, s.h)
}

func derivativesAtStep(f curveFunc, t, lo, hi, h float64) (Vec, Vec) {
	start := math.Max(lo, math.Min(t-2*h, hi-4*h))
	a := (t - start) / h
	var d, dd Vec
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
		v := f(start + float64(j)*h)
		d = d.Add(v.Mul(coeff[1] / den / h))
		dd = dd.Add(v.Mul(2 * coeff[2] / den / h / h))
	}
	return d, dd
}

// Agreement at two step sizes rejects ill-conditioned samples, including poles
// that floating-point arithmetic lands extremely close to rather than exactly on.
func stableTangent(f curveFunc, t, lo, hi float64, d Vec) bool {
	return baseStencil(lo, hi).stableTangent(f, t, d)
}

func stable(f curveFunc, t, lo, hi float64, d, dd Vec) bool {
	return baseStencil(lo, hi).stable(f, t, d, dd)
}

func (s stencil) stableTangent(f curveFunc, t float64, d Vec) bool {
	a, _ := derivativesAtStep(f, t, s.lo, s.hi, s.h/2)
	return a.Valid() && d.Valid() &&
		a.Sub(d).Norm() <= 1e-3*math.Max(a.Norm(), d.Norm())+s.floor
}

func (s stencil) stable(f curveFunc, t float64, d, dd Vec) bool {
	a, b := derivativesAtStep(f, t, s.lo, s.hi, s.h/2)
	return a.Valid() && b.Valid() && d.Valid() && dd.Valid() &&
		a.Sub(d).Norm() <= 1e-3*math.Max(a.Norm(), d.Norm())+s.floor &&
		b.Sub(dd).Norm() <= 1e-2*math.Max(b.Norm(), dd.Norm())+1e-4*math.Max(1, d.Norm()/(s.hi-s.lo))
}
