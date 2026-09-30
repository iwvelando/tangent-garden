package expr

import (
	"math"
	"math/rand/v2"
	"testing"
)

// powerSamples are values of x where a power must equal math.Pow bit for
// bit: random magnitudes over the whole exponent range, both signs, the
// special values, and each side of every exponent's fast-path limits.
func powerSamples(r *rand.Rand, count int) []float64 {
	xs := []float64{0, math.Copysign(0, -1), 1, -1, 2, -2, 0.5, math.Inf(1), math.Inf(-1), math.NaN(),
		math.SmallestNonzeroFloat64, -math.SmallestNonzeroFloat64, math.MaxFloat64, -math.MaxFloat64, 0x1p-1022, 0x1p-1023}
	for n := 2; n <= 64; n++ {
		for _, e := range []int{1000 / n, -1000 / n, 1000/n + 1, -1000/n - 1} {
			v := math.Ldexp(1, e)
			xs = append(xs, v, -v, math.Nextafter(v, 0), math.Nextafter(v, math.Inf(1)), -math.Nextafter(v, 0))
		}
	}
	for range count {
		xs = append(xs, math.Float64frombits(r.Uint64()))
		// Ordinary magnitudes, where studies live.
		xs = append(xs, (r.Float64()*2-1)*math.Pow(10, r.Float64()*12-6))
	}
	return xs
}

func sameBits(a, b float64) bool {
	return math.Float64bits(a) == math.Float64bits(b) || (math.IsNaN(a) && math.IsNaN(b))
}

func TestIntegerPowerMatchesPow(t *testing.T) {
	r := rand.New(rand.NewPCG(1, 2))
	xs := powerSamples(r, 20000)
	for n := 2; n <= 64; n++ {
		p := integerPower(n)
		for _, x := range xs {
			if got, want := p(x), math.Pow(x, float64(n)); !sameBits(got, want) {
				t.Fatalf("%v^%d = %v (%#x), math.Pow gives %v (%#x)", x, n, got, math.Float64bits(got), want, math.Float64bits(want))
			}
		}
	}
}

// Expressions route constant whole exponents from 2 to 64 to the fast path
// and every other exponent to math.Pow; either way the value is Pow's.
func TestPowerExpressionsMatchPow(t *testing.T) {
	r := rand.New(rand.NewPCG(3, 4))
	xs := powerSamples(r, 2000)
	for _, tc := range []struct {
		s   string
		pow func(x float64) float64
	}{
		{"x^2", func(x float64) float64 { return math.Pow(x, 2) }},
		{"x^4", func(x float64) float64 { return math.Pow(x, 4) }},
		{"x^(1+2)", func(x float64) float64 { return math.Pow(x, 3) }},
		{"x^a", func(x float64) float64 { return math.Pow(x, 5) }},
		{"x^2^3", func(x float64) float64 { return math.Pow(x, 8) }},
		{"x^64", func(x float64) float64 { return math.Pow(x, 64) }},
		{"x^65", func(x float64) float64 { return math.Pow(x, 65) }},
		{"x^1", func(x float64) float64 { return math.Pow(x, 1) }},
		{"x^0", func(x float64) float64 { return math.Pow(x, 0) }},
		{"x^-2", func(x float64) float64 { return math.Pow(x, -2) }},
		{"x^2.5", func(x float64) float64 { return math.Pow(x, 2.5) }},
		{"x^0.5", func(x float64) float64 { return math.Pow(x, 0.5) }},
		{"(-x)^3", func(x float64) float64 { return math.Pow(-x, 3) }},
		{"-x^2", func(x float64) float64 { return -math.Pow(x, 2) }},
		{"2^x", func(x float64) float64 { return math.Pow(2, x) }},
		{"x^x", func(x float64) float64 { return math.Pow(x, x) }},
		// An exponent that reads x is not constant, even where it is 2 at 0.
		{"x^(x+2)", func(x float64) float64 { return math.Pow(x, x+2) }},
		{"(x^2 + 1)^2", func(x float64) float64 { return math.Pow(math.Pow(x, 2)+1, 2) }},
	} {
		t.Run(tc.s, func(t *testing.T) {
			e, err := ParseWithParameter(tc.s, 5)
			if err != nil {
				t.Fatal(err)
			}
			for _, x := range xs {
				if got, want := e(x), tc.pow(x); !sameBits(got, want) {
					t.Fatalf("x = %v: %v, math.Pow gives %v", x, got, want)
				}
			}
		})
	}
}

func FuzzIntegerPower(f *testing.F) {
	f.Add(1.5, uint8(2))
	f.Add(-0x1p-250, uint8(4))
	f.Add(0x1p500, uint8(2))
	f.Fuzz(func(t *testing.T, x float64, n uint8) {
		k := 2 + int(n)%63
		if got, want := integerPower(k)(x), math.Pow(x, float64(k)); !sameBits(got, want) {
			t.Fatalf("%v^%d = %v, math.Pow gives %v", x, k, got, want)
		}
	})
}

func BenchmarkPolynomialField(b *testing.B) {
	f, _, err := ParseSpatialField("x^4 - 5*x^2 + y^4 - 5*y^2 + z^4 - 5*z^2", 1)
	if err != nil {
		b.Fatal(err)
	}
	s := 0.0
	for i := 0; b.Loop(); i++ {
		v := float64(i%1000) / 400
		s += f(v, -v, v/2, 0)
	}
	_ = s
}
