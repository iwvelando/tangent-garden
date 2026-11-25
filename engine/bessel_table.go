package engine

import (
	"math"
	"sync"
)

// A besselTable's pieces are 1/besselPerUnit wide, with besselTerms
// Chebyshev coefficients each. Every derivative of J_m is at most 1 in
// magnitude, so on a piece of half-width ¼ the coefficient after the last
// is below 2·8⁻ⁿ/n! < 6·10⁻¹⁸.
const (
	besselPerUnit = 2
	besselPieces  = besselPerUnit * maxBesselArg
	besselTerms   = 11
)

// besselTable holds g_m(x) = J_m(x)/x^m, an even entire function with
// g_m(0) = 1/(2^m m!), on [0, maxBesselArg] as Chebyshev series on pieces
// [i, i + 1]/besselPerUnit, and the series of its derivative. Dividing out x^m
// keeps J_m's relative accuracy below the order, where J_m is tiny but its
// sign decides the drawing near a disk mode's center; the disk modes
// multiply x^m back in as the complex power that also carries their angle.
type besselTable struct {
	g, prime [besselPieces][besselTerms]float64
}

var besselTables [maxDiskOrder + 1]struct {
	once  sync.Once
	table *besselTable
}

// besselTableOf returns order m's table, built on first use from besselJ
// at each piece's Chebyshev nodes.
func besselTableOf(m int) *besselTable {
	b := &besselTables[m]
	b.once.Do(func() { b.table = newBesselTable(m) })
	return b.table
}

func newBesselTable(m int) *besselTable {
	t := &besselTable{}
	const n = besselTerms
	var values [n]float64
	for i := range besselPieces {
		for k := range n {
			x := (float64(i) + (1+math.Cos(math.Pi*(float64(k)+.5)/n))/2) / besselPerUnit
			values[k] = besselG(m, x)
		}
		c := &t.g[i]
		for j := range n {
			sum := 0.0
			for k := range n {
				sum += values[k] * cosHalfTurns(j*(2*k+1), 2*n)
			}
			c[j] = 2 * sum / n
		}
		c[0] /= 2
		// The derivative's series, d/dx = 2·besselPerUnit d/dt:
		// d_{j−1} = d_{j+1} + 2j c_j, with d₀ halved.
		d := &t.prime[i]
		var next, cur float64 // d_{j+1}, d_j
		for j := n - 1; j >= 1; j-- {
			prev := next + 2*float64(j)*c[j]
			next, cur = cur, prev
			d[j-1] = 2 * besselPerUnit * prev
		}
		d[0] /= 2
	}
	return t
}

// cosHalfTurns returns cos(πl/d) for whole l ≥ 0 and d > 0, reduced
// exactly to an angle of at most π/2 first, so its rounding stays near an
// ulp, where cos of the unreduced angle, up to 4π here, would carry its
// argument's.
func cosHalfTurns(l, d int) float64 {
	l %= 2 * d
	if l > d {
		l = 2*d - l
	}
	sign := 1.0
	if 2*l > d {
		l, sign = d-l, -1
	}
	return sign * math.Cos(math.Pi*float64(l)/float64(d))
}

// besselG returns J_m(x)/x^m for 0 < x ≤ maxBesselArg: below 1 by its own
// power series, whose terms fall by at least a factor 4 each, and above it
// from besselJ.
func besselG(m int, x float64) float64 {
	if x > 1 {
		return besselJ(m, x) / math.Pow(x, float64(m))
	}
	term := 1.0
	for i := 1; i <= m; i++ {
		term /= 2 * float64(i)
	}
	sum, q := term, x*x/4
	for s := 1; s < 40; s++ {
		term *= -q / float64(s*(s+m))
		sum += term
		if math.Abs(term) <= 1e-18*math.Abs(sum) {
			break
		}
	}
	return sum
}

// piece returns the piece holding x, 0 ≤ x ≤ maxBesselArg, and x's place
// on it, in [−1, 1].
func piece(x float64) (int, float64) {
	y := besselPerUnit * x
	i := min(int(y), besselPieces-1)
	return i, 2*(y-float64(i)) - 1
}

// value returns g_m(x) by Clenshaw's recurrence.
func (t *besselTable) value(x float64) float64 {
	i, u := piece(x)
	return clenshaw(&t.g[i], u)
}

// at returns g_m(x) and g_m′(x).
func (t *besselTable) at(x float64) (float64, float64) {
	i, u := piece(x)
	return clenshaw(&t.g[i], u), clenshaw(&t.prime[i], u)
}

func clenshaw(c *[besselTerms]float64, u float64) float64 {
	var b1, b2 float64
	u2 := 2 * u
	for j := besselTerms - 1; j >= 1; j-- {
		b1, b2 = u2*b1-b2+c[j], b1
	}
	return u*b1 - b2 + c[0]
}
