// Package physical turns frozen planar geometry into printable solids:
// a two-level height field over a plaque, checked as a closed mesh and
// against a printer profile, and written as core 3MF.
//
// #543 research: nothing here is a public contract yet. Lengths are in
// millimeters.
package physical

import (
	"math"
	"math/cmplx"
)

// Stroke is a centerline piece: the segment from A to B, or, unless
// Straight, the minor arc from A to B of the circle with center C and
// radius R (shorter than half the circle). Its band is every point within
// Half of it. Tile names the source tile, −1 for a frame or a fixture.
type Stroke struct {
	A, B, C  complex128
	R        float64
	Straight bool
	Half     float64
	Tile     int
}

// Distance is the Euclidean distance from x to the stroke's centerline.
func (s Stroke) Distance(x complex128) float64 {
	if s.Straight {
		return segmentDistance(x, s.A, s.B)
	}
	u, ua, ub := x-s.C, s.A-s.C, s.B-s.C
	// The arc is minor, so x's direction lies within it exactly when it is
	// turned from A's direction toward B's no more than B's is.
	turn := cross(ua, ub)
	if cross(ua, u)*turn >= 0 && cross(u, ub)*turn >= 0 && dot(u, ua+ub) > 0 {
		return math.Abs(cmplx.Abs(u) - s.R)
	}
	return math.Min(cmplx.Abs(x-s.A), cmplx.Abs(x-s.B))
}

// Bounds is the stroke's centerline box, before its band.
func (s Stroke) Bounds() (lo, hi complex128) {
	lo = complex(math.Min(real(s.A), real(s.B)), math.Min(imag(s.A), imag(s.B)))
	hi = complex(math.Max(real(s.A), real(s.B)), math.Max(imag(s.A), imag(s.B)))
	if s.Straight {
		return lo, hi
	}
	// An axis direction inside the arc's span adds its extreme.
	for _, d := range []complex128{1, 1i, -1, -1i} {
		p := s.C + complex(s.R, 0)*d
		if s.Distance(p) < 1e-12*(1+s.R) {
			lo = complex(math.Min(real(lo), real(p)), math.Min(imag(lo), imag(p)))
			hi = complex(math.Max(real(hi), real(p)), math.Max(imag(hi), imag(p)))
		}
	}
	return lo, hi
}

// Length is the centerline's length.
func (s Stroke) Length() float64 {
	if s.Straight {
		return cmplx.Abs(s.B - s.A)
	}
	return s.R * math.Abs(cmplx.Phase((s.B-s.C)/(s.A-s.C)))
}

func segmentDistance(x, a, b complex128) float64 {
	d := b - a
	l := real(d)*real(d) + imag(d)*imag(d)
	if l == 0 {
		return cmplx.Abs(x - a)
	}
	t := math.Max(0, math.Min(1, dot(x-a, d)/l))
	return cmplx.Abs(x - (a + complex(t, 0)*d))
}

// cross and dot round each product before combining them: the explicit
// conversions forbid fusing them into one multiply-add, which arm64 would
// otherwise do, so that cross(v, v) is exactly zero and every
// architecture computes the same signs.
func cross(a, b complex128) float64 {
	return float64(real(a)*imag(b)) - float64(imag(a)*real(b))
}
func dot(a, b complex128) float64 { return float64(real(a)*real(b)) + float64(imag(a)*imag(b)) }

// Circle is a whole circle as three minor arcs, for frames and fixtures.
func Circle(c complex128, r, half float64) []Stroke {
	out := make([]Stroke, 3)
	for k := range 3 {
		a := c + cmplx.Rect(r, 2*math.Pi*float64(k)/3)
		b := c + cmplx.Rect(r, 2*math.Pi*float64(k+1)/3)
		out[k] = Stroke{A: a, B: b, C: c, R: r, Half: half, Tile: -1}
	}
	return out
}
