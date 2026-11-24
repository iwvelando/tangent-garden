package shorten

import (
	"math"
	"math/cmplx"
	"testing"
)

// Kassam and Trefethen's contour integrals, the arclength solver's
// original coefficients, as an independent check of the closed forms and
// series that replaced them. The integrands are entire, so any circle about
// z0 gives the mean; its radius keeps every point at least 1 from z = 0,
// where they cancel (the original unit circle about z0 = −1 passes through
// 0 and loses 2e-14).
func contourCoefficients(h, l float64) [6]float64 {
	z0 := h * l
	r := 1.0
	if math.Abs(z0) < 2 {
		r = 3
	}
	var q, a1, a2, a3 complex128
	const points = 128
	for j := range points {
		z := complex(z0, 0) + cmplx.Rect(r, 2*math.Pi*(float64(j)+0.5)/points)
		ez, ez2 := cmplx.Exp(z), cmplx.Exp(z/2)
		z3 := z * z * z
		q += (ez2 - 1) / z
		a1 += (-4 - z + ez*(4-3*z+z*z)) / z3
		a2 += (2 + z + ez*(z-2)) / z3
		a3 += (-4 - 3*z - z*z + ez*(4-z)) / z3
	}
	return [6]float64{math.Exp(z0), math.Exp(z0 / 2), h * real(q) / points,
		h * real(a1) / points, h * real(a2) / points, h * real(a3) / points}
}

func TestETDCoefficientsMatchContourIntegrals(t *testing.T) {
	for _, z := range []float64{0, -1e-12, -1e-6, -0.01, -0.3, -0.4999, -0.5, -1, -1.9999, -2, -2.0001, -3, -30, -400, -1e5} {
		got, want := etdCoefficients(1, z), contourCoefficients(1, z)
		for k := range got {
			if d := math.Abs(got[k] - want[k]); d > 1e-14*math.Max(1, math.Abs(want[k])) {
				t.Errorf("z=%g coefficient %d: %.17g, contour %.17g", z, k, got[k], want[k])
			}
		}
	}
}
