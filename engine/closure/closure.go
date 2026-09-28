// Package closure finds when sums of uniform rotations repeat. It is shared
// by the planar and spatial engines and has no geometric types of its own.
package closure

import "math"

const (
	// Frequency ratios with larger denominators are treated as not closing:
	// every period needs its own share of the samples.
	MaxDenominator = 1000
	// Periods longer than the widest domain are not closure.
	MaxPeriod = 1e5
)

// Ratio finds x = p/q in lowest terms with q ≤ limit, by continued-fraction
// convergents. Values that are merely close are not rounded into a ratio.
func Ratio(x float64, limit int) (p, q int, ok bool) {
	v := x
	p0, q0, p1, q1 := 0.0, 1.0, 1.0, 0.0
	for range 64 {
		a := math.Floor(v)
		p0, q0, p1, q1 = p1, q1, a*p1+p0, a*q1+q0
		if q1 > float64(limit) || p1 > 1e9 {
			return 0, 0, false
		}
		if math.Abs(x-p1/q1) <= 1e-12*x {
			return int(p1), int(q1), true
		}
		if v == a {
			break
		}
		v = 1 / (v - a)
	}
	return 0, 0, false
}

func GCD(a, b int) int {
	for b != 0 {
		a, b = b, a%b
	}
	return a
}

// Period returns the smallest period of a sum of rotations at the given
// frequencies; the caller passes only those of rotations that move (nonzero
// radius or amplitude). A rotation repeats after 2π/|k|, so the sum repeats
// after 2π/ω, where every |k| is a whole multiple of ω: exactly 2π/gcd for
// whole numbers, and otherwise found from each frequency's ratio to the
// first. Zero frequencies are fixed translations; when nothing turns the sum
// is constant. A period of 0 otherwise means the sum never repeats exactly.
func Period(frequencies []float64) (period float64, whole, constant bool) {
	var moving []float64
	whole = true
	for _, k := range frequencies {
		if k != 0 {
			moving = append(moving, math.Abs(k))
			whole = whole && k == math.Trunc(k)
		}
	}
	if len(moving) == 0 {
		return 0, false, true
	}
	if whole {
		g := 0
		for _, k := range moving {
			g = GCD(g, int(k))
		}
		return 2 * math.Pi / float64(g), true, false
	}
	// Each frequency is (p/q)·ref; all are whole multiples of ref/lcm(q),
	// and of nothing larger, since ref itself is one of them.
	ref, common := moving[0], 1
	for _, k := range moving {
		_, q, ok := Ratio(k/ref, MaxDenominator)
		if !ok {
			return 0, false, false
		}
		if common = common / GCD(common, q) * q; common > MaxDenominator {
			return 0, false, false
		}
	}
	period = 2 * math.Pi * float64(common) / ref
	if period > MaxPeriod {
		return 0, false, false
	}
	return period, false, false
}
