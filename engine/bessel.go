package engine

import (
	"math"
	"sort"
)

// Bessel functions of the first kind for the disk membrane's modes (#415
// research). Orders are whole numbers 0…maxBesselOrder and arguments lie
// in [0, maxBesselArg], the range the disk modes evaluate and the tests
// verify against an independent arbitrary-precision series.
const (
	maxBesselOrder = maxDiskOrder + 1
	maxBesselArg   = 64
)

// besselJ returns J_m(x) for a whole order 0 ≤ m ≤ maxBesselOrder and
// 0 ≤ x ≤ maxBesselArg, or NaN outside that range. Below x = 1 it sums the
// power series, whose terms fall by at least a factor 4 each, so the sum
// is accurate relative to J itself, however small. Above it, Miller's
// backward recurrence from an order well beyond both m and x, normalized
// by 1 = J₀ + 2(J₂ + J₄ + …), gives J to a few units of 10⁻¹⁶ absolute.
func besselJ(m int, x float64) float64 {
	if m < 0 || m > maxBesselOrder || !(x >= 0 && x <= maxBesselArg) {
		return math.NaN()
	}
	if x <= 1 {
		return besselSeries(m, x)
	}
	return besselMiller(m, x)
}

func besselSeries(m int, x float64) float64 {
	h := x / 2
	term := 1.0
	for i := 1; i <= m; i++ {
		term *= h / float64(i)
	}
	sum := term
	q := h * h
	for s := 1; s < 40; s++ {
		term *= -q / float64(s*(s+m))
		sum += term
		if math.Abs(term) <= 1e-18*math.Abs(sum) {
			break
		}
	}
	return sum
}

func besselMiller(m int, x float64) float64 {
	top := max(float64(m), x)
	start := 2 * ((int(top+20+4*math.Sqrt(top)) + 1) / 2)
	// J_{k−1} = (2k/x) J_k − J_{k+1}, from J_{start+1} = 0, J_start = tiny.
	next, cur := 0.0, 1e-300
	var want, norm float64
	for k := start; k >= 1; k-- {
		prev := 2*float64(k)/x*cur - next
		next, cur = cur, prev
		// cur is now J_{k−1}.
		if k-1 == m {
			want = cur
		}
		if (k-1)%2 == 0 && k-1 > 0 {
			norm += 2 * cur
		}
		if math.Abs(cur) > 1e250 {
			next, cur, want, norm = next*1e-250, cur*1e-250, want*1e-250, norm*1e-250
		}
	}
	norm += cur // J₀
	return want / norm
}

// besselJPrime returns J_m′(x) = (J_{m−1}(x) − J_{m+1}(x))/2, with
// J_{−1} = −J₁, for 0 ≤ m < maxBesselOrder.
func besselJPrime(m int, x float64) float64 {
	if m == 0 {
		return -besselJ(1, x)
	}
	return (besselJ(m-1, x) - besselJ(m+1, x)) / 2
}

// bisect finds the zero of f between a and b, where f changes sign, to
// adjacent floating-point numbers.
func bisect(f func(float64) float64, a, b float64) float64 {
	fa := f(a)
	for {
		mid := a + (b-a)/2
		if mid <= a || mid >= b {
			break
		}
		fm := f(mid)
		if fm == 0 {
			return mid
		}
		if (fm > 0) == (fa > 0) {
			a, fa = mid, fm
		} else {
			b = mid
		}
	}
	if math.Abs(f(b)) < math.Abs(fa) {
		return b
	}
	return a
}

// signChanges returns the first n zeros of f on (lo, hi], each bracketed by
// a sign change over a step of width step and then bisected.
func signChanges(f func(float64) float64, lo, hi, step float64, n int) []float64 {
	var out []float64
	a, fa := lo, f(lo)
	for a < hi && len(out) < n {
		b := math.Min(a+step, hi)
		fb := f(b)
		if fa != 0 && fb != 0 && (fa > 0) != (fb > 0) {
			out = append(out, bisect(f, a, b))
		} else if fb == 0 {
			out = append(out, b)
		}
		a, fa = b, fb
	}
	return out
}

// Admitted disk-mode indices: angular order m and radial index k.
const (
	maxDiskOrder = 12
	maxDiskRing  = 10
)

var (
	// besselZeros[m][k−1] is j_{m,k}, the k-th positive zero of J_m.
	besselZeros [maxDiskOrder + 1][maxDiskRing]float64
	// besselPeaks[m] is max |J_m| on [0, ∞): J_m at its first stationary
	// point j′_{m,1} for m ≥ 1, and J₀(0) = 1.
	besselPeaks [maxDiskOrder + 1]float64
)

func init() {
	for m := 0; m <= maxDiskOrder; m++ {
		// Consecutive zeros of J_m lie more than π apart and the first
		// beyond m, so steps of a quarter never hold two.
		f := func(x float64) float64 { return besselJ(m, x) }
		z := signChanges(f, math.Max(float64(m), 1e-3), maxBesselArg, 0.25, maxDiskRing)
		copy(besselZeros[m][:], z)
		if m == 0 {
			besselPeaks[m] = 1
			continue
		}
		d := func(x float64) float64 { return besselJPrime(m, x) }
		p := signChanges(d, math.Max(float64(m)-1, 1e-3)/2, besselZeros[m][0], 0.25, 1)
		besselPeaks[m] = besselJ(m, p[0])
	}
}

// diskRadii returns the radii, as fractions of R, of the interior nodal
// circles of mode (m, k): j_{m,l}/j_{m,k} for l = 1…k−1, increasing.
func diskRadii(m, k int) []float64 {
	out := make([]float64, k-1)
	for l := 1; l < k; l++ {
		out[l-1] = besselZeros[m][l-1] / besselZeros[m][k-1]
	}
	sort.Float64s(out)
	return out
}
