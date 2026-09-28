package closure

import (
	"math"
	"testing"
)

func TestRatio(t *testing.T) {
	for _, tc := range []struct {
		x    float64
		p, q int
		ok   bool
	}{{0.75, 3, 4, true}, {3, 3, 1, true}, {5.0 / 7, 5, 7, true}, {math.Sqrt2, 0, 0, false}, {1.0 / 1001, 0, 0, false}, {1 + 1e-9, 0, 0, false}} {
		p, q, ok := Ratio(tc.x, 1000)
		if p != tc.p || q != tc.q || ok != tc.ok {
			t.Errorf("%g: %d/%d %v, want %d/%d %v", tc.x, p, q, ok, tc.p, tc.q, tc.ok)
		}
	}
}

func TestPeriod(t *testing.T) {
	for _, tc := range []struct {
		name            string
		frequencies     []float64
		period          float64
		whole, constant bool
	}{
		{"whole numbers close after 2π/gcd", []float64{2, -4, 6}, math.Pi, true, false},
		{"coprime whole numbers", []float64{1, 3}, 2 * math.Pi, true, false},
		{"zero frequencies are fixed", []float64{0, 3}, 2 * math.Pi / 3, true, false},
		{"nothing turns", []float64{0, 0}, 0, false, true},
		{"no frequencies", nil, 0, false, true},
		{"commensurate irrationals", []float64{math.Sqrt2, 3 * math.Sqrt2}, 2 * math.Pi / math.Sqrt2, false, false},
		{"rational ratios", []float64{0.5, 1.5}, 4 * math.Pi, false, false},
		{"incommensurate", []float64{1, math.Sqrt2}, 0, false, false},
		{"too long", []float64{1e-5, 2e-5}, 0, false, false},
		{"denominators past 1000", []float64{1, 1.0 / 999, 1.0 / 998}, 0, false, false},
	} {
		period, whole, constant := Period(tc.frequencies)
		if math.Abs(period-tc.period) > 1e-12*tc.period || whole != tc.whole || constant != tc.constant {
			t.Errorf("%s: %g %v %v", tc.name, period, whole, constant)
		}
	}
}

func TestGCD(t *testing.T) {
	if GCD(12, 18) != 6 || GCD(0, 5) != 5 || GCD(7, 0) != 7 {
		t.Error("gcd")
	}
}
