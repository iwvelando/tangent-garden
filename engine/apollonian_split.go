package engine

// The split-diameter family: the garden's one editable seed
// (docs/mathematics.md, Apollonian garden; web/garden/seeds.ts).
//
// Two circles of radii r and 1 − r fill the enclosing unit circle's
// horizontal diameter, the left one of radius r, and the third seed circle
// is the one above them both. For r = m/n in lowest terms every value is an
// integer in units where the enclosing circle has curvature −m(n − m): the
// curvatures are
//
//	−m(n − m), n(n − m), nm, n² − m(n − m)
//
// and, over the denominator D = m(n − m), the weighted centers' numerators
// are (0, 0), (−(n − m)², 0), (m², 0) and (m² − (n − m)², 2D). At r = 1/2
// this is the original seed exactly. The quadruple is primitive, and it is
// mirror symmetric across the horizontal axis; r and 1 − r are mirror
// images across the vertical one.

// GardenSplitSeed names the family; its member is the request's Split.
const GardenSplitSeed = "split"

// GardenMaxSplitDenominator bounds the split's denominator n, keeping the
// seed's integers small: |b₀| = m(n − m) is at most 2,500.
const GardenMaxSplitDenominator = 100

func gcd64(a, b int64) int64 {
	for b != 0 {
		a, b = b, a%b
	}
	if a < 0 {
		return -a
	}
	return a
}

// validSplit reports whether m/n, in lowest terms with 2 ≤ n ≤ 100, is
// admitted: 1/20 ≤ m/n ≤ 19/20. Nearer 0 or 1 the packing is a crescent
// too thin for the depth limit to fill, and at either end a circle
// vanishes or becomes the enclosing one.
func validSplit(m, n int64) bool {
	return 20*m >= n && 20*(n-m) >= n
}

// splitSpec is the family's seed for r = m/n, which must be valid.
func splitSpec(m, n int64) *gardenSpec {
	k := n - m
	d := m * k
	return newSpec(GardenSplitSeed, 1, d, []gardenCircle{
		{z(-d), z(0), z(0)},
		{z(n * k), z(-k * k), z(0)},
		{z(n * m), z(m * m), z(0)},
		{z(n*n - d), z(m*m - k*k), z(2 * d)},
	})
}
