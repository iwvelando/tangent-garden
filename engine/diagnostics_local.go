package engine

import (
	"math"
	"tangentgarden/engine/expr"
)

// diagnosticCurve retains a local evaluator, with its separable constant
// translation removed (expr.ParseLocalWithParameter), only for translations
// large enough to consume the second derivative's precision. Geometry keeps
// its original evaluator; this affects only the base curve's probe readouts.
type diagnosticCurve struct {
	at    curveFunc
	shift Vec
}

func (q Request) localDiagnostics(base []*Vec) *diagnosticCurve {
	c := q.Curve
	if q.given != nil || (c.Format != "parametric" && c.Format != "cartesian") {
		return nil
	}
	radius := studyRadius(base)
	if len(base) == 0 || !(radius > 0) {
		return nil
	}
	largest := 0.0
	for _, p := range base {
		if p != nil {
			largest = math.Max(largest, p.Norm())
		}
	}
	// Past 10⁴ study radii the stencil's rounding of world coordinates
	// approaches the readouts' four significant digits (3·10⁻⁵ at 10⁴ on
	// an ellipse, 4·10⁻⁴ at 10⁵). Nearer studies, including every preset,
	// keep their arithmetic exactly as it was.
	if !(largest > 1e4*radius) {
		return nil
	}
	if c.Format == "cartesian" {
		c.X = "t"
	}
	x, a, err := expr.ParseLocalWithParameter(c.X, c.A)
	if err != nil {
		return nil
	}
	y, b, err := expr.ParseLocalWithParameter(c.Y, c.A)
	if err != nil {
		return nil
	}
	shift := Vec{a, b}
	if !shift.Valid() || shift == (Vec{}) {
		return nil
	}
	local := func(t float64) Vec { return Vec{x(t), y(t)} }
	// There must be measurable motion in the world samples. Subtracting
	// nonlinear cancellations must not increase the values differentiated.
	var first *Vec
	moved := false
	for i, p := range base {
		if p == nil {
			continue
		}
		if first == nil {
			first = p
		} else if *p != *first {
			moved = true
		}
		v := local(sampleTAt(c.Min, c.Max, len(base), i))
		if !v.Valid() || v.Norm() > largest {
			return nil
		}
	}
	if !moved {
		return nil
	}
	return &diagnosticCurve{local, shift}
}

func sampleTAt(lo, hi float64, n, i int) float64 { return lo + float64(i)*((hi-lo)/float64(n-1)) }

func (r *Result) diagnose(f curveFunc, lo, hi float64) *Diagnostics {
	if r.diagnostic == nil {
		return diagnose(f, r.Base, lo, hi)
	}
	local := make([]*Vec, len(r.Base))
	for i, p := range r.Base {
		if p != nil {
			local[i] = point(r.diagnostic.at(sampleTAt(lo, hi, len(local), i)))
		}
	}
	d := diagnose(r.diagnostic.at, local, lo, hi)
	for i, p := range d.Center {
		if p != nil {
			d.Center[i] = point(p.Add(r.diagnostic.shift))
		}
	}
	return d
}
