package engine

import (
	"fmt"
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
}
type curveFunc func(float64) Vec

func compile(c Curve) (curveFunc, error) {
	if !finite(c.Min) || !finite(c.Max) {
		return nil, fmt.Errorf("domain bounds must be finite numbers")
	}
	if c.Min == c.Max {
		return nil, fmt.Errorf("domain start and end are equal (%g): the interval has zero width; keep the start below the end", c.Min)
	}
	if c.Min > c.Max {
		return nil, fmt.Errorf("domain start (%g) is greater than domain end (%g); keep the start below the end", c.Min, c.Max)
	}
	if math.Abs(c.Min) > 1e6 || math.Abs(c.Max) > 1e6 {
		return nil, fmt.Errorf("domain bounds must stay within ±1000000")
	}
	if span := c.Max - c.Min; span < 1e-6 || span > 1e5 {
		return nil, fmt.Errorf("domain width is %g; supported widths are 0.000001–100000", span)
	}
	if c.Format == "polar" {
		r, e := expr.ParseWithParameter(c.R, c.A)
		if e != nil {
			return nil, e
		}
		return func(t float64) Vec { return Vec{r(t) * math.Cos(t), r(t) * math.Sin(t)} }, nil
	}
	if c.Format == "cartesian" {
		c.X = "t"
	} else if c.Format != "parametric" {
		return nil, fmt.Errorf("unknown curve format")
	}
	x, e := expr.ParseWithParameter(c.X, c.A)
	if e != nil {
		return nil, fmt.Errorf("x: %w", e)
	}
	y, e := expr.ParseWithParameter(c.Y, c.A)
	if e != nil {
		return nil, fmt.Errorf("y: %w", e)
	}
	return func(t float64) Vec { return Vec{x(t), y(t)} }, nil
}

// Five-point Lagrange differentiation. The stencil stays inside the declared
// domain, including at endpoints; it never assumes the curve is periodic.
func derivatives(f curveFunc, t, lo, hi float64) (Vec, Vec) {
	return derivativesAtStep(f, t, lo, hi, (hi-lo)*1e-4)
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
func stable(f curveFunc, t, lo, hi float64, d, dd Vec) bool {
	a, b := derivativesAtStep(f, t, lo, hi, (hi-lo)*5e-5)
	return a.Valid() && b.Valid() && d.Valid() && dd.Valid() &&
		a.Sub(d).Norm() <= 1e-3*math.Max(a.Norm(), d.Norm())+1e-8 &&
		b.Sub(dd).Norm() <= 1e-2*math.Max(b.Norm(), dd.Norm())+1e-4*math.Max(1, d.Norm()/(hi-lo))
}
