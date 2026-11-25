package engine

import (
	"math"
	"math/big"
	"testing"
)

// refBessel sums J_m(x) = Σ (−1)^s (x/2)^{2s+m}/(s!(s+m)!) in 320-bit
// arithmetic: a reference independent of the engine's series and Miller
// recurrence, exact to double precision for the admitted range, where the
// largest term is below 10²⁵.
func refBessel(m int, x float64) float64 {
	const prec = 320
	num := func(v float64) *big.Float { return new(big.Float).SetPrec(prec).SetFloat64(v) }
	h := num(x / 2)
	q := new(big.Float).SetPrec(prec).Mul(h, h)
	term := num(1)
	for i := 1; i <= m; i++ {
		term.Mul(term, h)
		term.Quo(term, num(float64(i)))
	}
	sum := new(big.Float).SetPrec(prec).Set(term)
	for s := 1; s < 400; s++ {
		term.Mul(term, q)
		term.Quo(term, num(float64(s*(s+m))))
		term.Neg(term)
		sum.Add(sum, term)
	}
	v, _ := sum.Float64()
	return v
}

// refZero bisects the reference series between a and b for a zero.
func refZero(m int, a, b float64) float64 {
	fa := refBessel(m, a)
	for range 60 {
		mid := (a + b) / 2
		if fm := refBessel(m, mid); (fm > 0) == (fa > 0) {
			a, fa = mid, fm
		} else {
			b = mid
		}
	}
	return (a + b) / 2
}

func TestBesselMatchesAnIndependentSeries(t *testing.T) {
	worst := 0.0
	for m := 0; m <= maxBesselOrder; m++ {
		xs := []float64{0, 1e-12, 1e-6, 1e-3, 0.5, 0.999999, 1, 1.000001, float64(m), maxBesselArg}
		for i := 0; i <= 512; i++ {
			xs = append(xs, maxBesselArg*float64(i)/512+0.0137)
		}
		for _, x := range xs {
			if x > maxBesselArg {
				continue
			}
			got, want := besselJ(m, x), refBessel(m, x)
			err := math.Abs(got - want)
			worst = math.Max(worst, err)
			if err > 1e-15 {
				t.Fatalf("J_%d(%g) = %.17g, want %.17g (error %.2g)", m, x, got, want, err)
			}
			// Below the order, J is small but its relative accuracy is
			// kept, so the sign near the center of a disk mode is right.
			if x <= float64(m) && want != 0 && math.Abs(got-want) > 1e-13*math.Abs(want) {
				t.Fatalf("J_%d(%g) = %.17g, want %.17g: relative error %.2g", m, x, got, want, math.Abs(got-want)/math.Abs(want))
			}
		}
	}
	t.Logf("largest absolute error %.2g", worst)
}

func TestBesselRefusesOutsideItsRange(t *testing.T) {
	for _, c := range []struct {
		m int
		x float64
	}{{-1, 1}, {maxBesselOrder + 1, 1}, {0, -1e-9}, {0, maxBesselArg * (1 + 1e-15)}, {2, math.NaN()}, {2, math.Inf(1)}} {
		if v := besselJ(c.m, c.x); !math.IsNaN(v) {
			t.Errorf("J_%d(%g) = %g outside the admitted range, want NaN", c.m, c.x, v)
		}
	}
}

// Tabulated zeros j_{m,k} (DLMF Table 10.21.1; Abramowitz & Stegun Table 9.5).
var tabulatedZeros = []struct {
	m, k int
	j    float64
}{
	{0, 1, 2.404825557695773}, {0, 2, 5.520078110286311}, {0, 3, 8.653727912911012},
	{0, 4, 11.79153443901428}, {0, 5, 14.93091770848779},
	{1, 1, 3.831705970207512}, {1, 2, 7.015586669815619}, {1, 3, 10.17346813506272},
	{1, 4, 13.32369193631422},
	{2, 1, 5.135622301840683}, {2, 2, 8.417244140399865}, {2, 3, 11.61984117214906},
	{3, 1, 6.380161895923984}, {3, 2, 9.761023129981670},
	{4, 1, 7.588342434503805}, {5, 1, 8.771483815959954},
}

func TestBesselZerosMatchTables(t *testing.T) {
	for _, c := range tabulatedZeros {
		if got := besselZeros[c.m][c.k-1]; math.Abs(got-c.j) > 1e-13*c.j {
			t.Errorf("j_{%d,%d} = %.16g, tabulated %.16g", c.m, c.k, got, c.j)
		}
	}
}

func TestBesselZerosAreEveryZeroInOrder(t *testing.T) {
	for m := 0; m <= maxDiskOrder; m++ {
		// Scan the reference series for its own sign changes: exactly the
		// engine's zeros, in order, none skipped.
		var own []float64
		step := 0.05
		prev := refBessel(m, step)
		for x := 2 * step; len(own) < maxDiskRing; x += step {
			v := refBessel(m, x)
			if (v > 0) != (prev > 0) {
				own = append(own, refZero(m, x-step, x))
			}
			prev = v
		}
		for k, j := range besselZeros[m] {
			if math.Abs(j-own[k]) > 4e-15*j {
				t.Errorf("j_{%d,%d} = %.17g, the reference series changes sign at %.17g", m, k+1, j, own[k])
			}
			// A zero: the reference changes sign within 10⁻¹² of it.
			d := 1e-12 * j
			if lo, hi := refBessel(m, j-d), refBessel(m, j+d); (lo > 0) == (hi > 0) {
				t.Errorf("J_%d does not change sign across j_{%d,%d} = %.17g", m, m, k+1, j)
			}
		}
	}
	// Interlacing, DLMF 10.21.3: j_{m,k} < j_{m+1,k} < j_{m,k+1}.
	for m := 0; m < maxDiskOrder; m++ {
		for k := 0; k < maxDiskRing; k++ {
			if !(besselZeros[m][k] < besselZeros[m+1][k]) || k+1 < maxDiskRing && !(besselZeros[m+1][k] < besselZeros[m][k+1]) {
				t.Errorf("zeros of J_%d and J_%d do not interlace at k = %d", m, m+1, k+1)
			}
		}
	}
}

func TestBesselPeaksBoundEveryValue(t *testing.T) {
	for m := 0; m <= maxDiskOrder; m++ {
		// math.Jn, another independent evaluation, is within 3·10⁻¹³ of
		// J over this range (measured against refBessel).
		peak, seen := besselPeaks[m], 0.0
		for i := 0; i <= 64000; i++ {
			v := math.Abs(math.Jn(m, maxBesselArg*float64(i)/64000))
			if v > peak+3e-13 {
				t.Fatalf("|J_%d| reaches %.17g above its peak %.17g", m, v, peak)
			}
			seen = math.Max(seen, v)
		}
		// Steps of 0.001 come within 10⁻⁶ of the peak, so it is reached.
		if seen < peak*(1-1e-6) {
			t.Errorf("|J_%d| peaks at %.17g on the grid, below %.17g", m, seen, peak)
		}
	}
}
