package engine4

import (
	"fmt"
	"math"
	"math/cmplx"
	"sort"
	"strconv"
	"strings"
)

// Noncircular source paths for the root journey. A path is
// placed as the circle is, z(t) = r e^{iφ}(k + s(t)), with the shape
//
//	ripple:  s(t) = e^{it} + a e^{imt}, 0 ≤ a ≤ 3, m whole within ±12;
//	fourier: s(t) = Σ ρⱼ e^{i(fⱼ t + ψⱼ)}, 1–16 terms, fⱼ whole within ±64.
//
// The lift of wⁿ = z is w = |z|^{1/n} e^{iθ/n} for a continuous argument θ
// of z, so continuing w is continuing θ. With L ≥ |z'| and M ≥ |z''|, the
// arc over [a, b] stays within M(b − a)²/8 of its chord. Where the chord's
// distance from 0 exceeds that, the convex tube around the chord holds the
// arc and excludes 0, so the argument's change along the arc is exactly
// Arg(z(b)/z(a)), and |z| on the arc is at least the difference. Intervals
// are bisected until that bound reaches the clearance r/20 (admitted), a
// sample falls inside it (refused, with the sample as witness), or the
// depth or work cap is reached (refused as unresolved). No quadrature is
// involved: θ at every returned point is a sum of exact principal
// arguments, up to rounding.

const (
	rootMaxRipple          = 3
	rootMaxRippleFrequency = 12
	rootMaxTerms           = 16
	rootMaxTermFrequency   = 64
	rootMaxTermRadius      = 1000
	// The drawing's tolerance, as a share of the scale max(R, R^{1/n}),
	// R = r(k + Σρ): both planes' polylines stay within it of their curves.
	rootPathTolerance = 2e-4
	// Bisections of a base interval, and z evaluations, before a path whose
	// clearance cannot be decided is refused as unresolved.
	rootCertifyDepth  = 12
	rootCertifyBudget = 1 << 20
)

// RootTerm is one term ρ e^{i(f t + ψ)} of a Fourier source path, in the
// format Draw a loop produces.
type RootTerm struct {
	Frequency float64 `json:"frequency"`
	Radius    float64 `json:"radius"`
	Phase     float64 `json:"phase"`
}

// certifyCounter, when set by a test, receives the number of z evaluations
// certification made.
var certifyCounter func(int)

// rootLoop is a noncircular source path and its continuously followed n-th
// root over one circuit, 0 ≤ s ≤ 2π; circuit c is ω^{W(c−1)} times it.
type rootLoop struct {
	r, k   float64
	n      int
	rot    complex128 // r e^{iφ}
	terms  []RootTerm
	l, m   float64 // bounds on |z'| and |z''|
	reach  float64 // r(k + Σρ) ≥ max |z|
	tol    float64
	start  complex128 // σ ω^b: w(0) = start · ⁿ√z(0)
	leafS  []float64  // certified intervals' starts, ascending from 0
	leafZ  []complex128
	leafTh []float64 // the continuous argument θ at each start
	grid   []float64 // one circuit's parameters, ascending from 0
	// The winding of z about 0 over one circuit.
	winding int
	// min |z| over the samples, refined near the least (an upper bound on
	// the true minimum), and the certified lower bound.
	closest, closestBound float64
	evaluations           int
}

// newRootPath validates the shape's fields by name and returns its terms.
func rootShape(p RootParameters) ([]RootTerm, error) {
	switch p.Path {
	case "ripple":
		if !finite(p.Ripple) || p.Ripple < 0 || p.Ripple > rootMaxRipple {
			return nil, fieldErr("root.ripple", "Ripple a must be between 0 and 3")
		}
		if !finite(p.Frequency) || p.Frequency != math.Trunc(p.Frequency) || math.Abs(p.Frequency) > rootMaxRippleFrequency {
			return nil, fieldErr("root.frequency", "Frequency m must be a whole number from −12 to 12")
		}
		return []RootTerm{{Frequency: 1, Radius: 1}, {Frequency: p.Frequency, Radius: p.Ripple}}, nil
	case "fourier":
		if len(p.Terms) == 0 || len(p.Terms) > rootMaxTerms {
			return nil, fieldErr("root.terms", "A Fourier path needs 1 to 16 terms")
		}
		moves := false
		for i, t := range p.Terms {
			if !finite(t.Frequency) || t.Frequency != math.Trunc(t.Frequency) || math.Abs(t.Frequency) > rootMaxTermFrequency {
				return nil, fieldErr(fmt.Sprintf("root.terms.%d.frequency", i), "Term %d's frequency must be a whole number from −64 to 64", i+1)
			}
			if !finite(t.Radius) || t.Radius < 0 || t.Radius > rootMaxTermRadius {
				return nil, fieldErr(fmt.Sprintf("root.terms.%d.radius", i), "Term %d's radius must be between 0 and 1,000", i+1)
			}
			if !finite(t.Phase) || math.Abs(t.Phase) > 1e6 {
				return nil, fieldErr(fmt.Sprintf("root.terms.%d.phase", i), "Term %d's phase must be finite, within ±1,000,000 radians", i+1)
			}
			moves = moves || t.Frequency != 0 && t.Radius > 0
		}
		if !moves {
			return nil, fieldErr("root.terms", "A Fourier path must move: give a term of nonzero frequency a positive radius")
		}
		return append([]RootTerm(nil), p.Terms...), nil
	}
	return nil, fieldErr("root.path", "Source path must be a circle, a ripple or a Fourier loop")
}

func newRootPath(p RootParameters, terms []RootTerm, n int, sigma float64) *rootLoop {
	sp, cp := math.Sincos(p.Direction)
	c := &rootLoop{r: p.Radius, k: p.Offset, n: n, rot: complex(p.Radius*cp, p.Radius*sp), terms: terms}
	sum := 0.
	for _, t := range terms {
		sum += t.Radius
		c.l += t.Radius * math.Abs(t.Frequency)
		c.m += t.Radius * t.Frequency * t.Frequency
	}
	c.l *= p.Radius
	c.m *= p.Radius
	c.reach = p.Radius * (p.Offset + sum)
	c.tol = rootPathTolerance * math.Max(c.reach, math.Pow(c.reach, 1/float64(n)))
	c.start = complex(sigma, 0) * unity(n, int(p.Branch))
	return c
}

// z(s) for 0 ≤ s ≤ 2π.
func (c *rootLoop) z(s float64) complex128 {
	v := complex(c.k, 0)
	for _, t := range c.terms {
		sn, cs := math.Sincos(t.Frequency*s + t.Phase)
		v += complex(t.Radius*cs, t.Radius*sn)
	}
	return c.rot * v
}

// dz/ds.
func (c *rootLoop) dz(s float64) complex128 {
	var v complex128
	for _, t := range c.terms {
		sn, cs := math.Sincos(t.Frequency*s + t.Phase)
		v += complex(-t.Frequency*t.Radius*sn, t.Frequency*t.Radius*cs)
	}
	return c.rot * v
}

// The distance from 0 to the segment [a, b].
func originToSegment(a, b complex128) float64 {
	d := b - a
	dd := real(d)*real(d) + imag(d)*imag(d)
	if dd == 0 {
		return cmplx.Abs(a)
	}
	u := -(real(a)*real(d) + imag(a)*imag(d)) / dd
	u = math.Max(0, math.Min(1, u))
	return cmplx.Abs(a + complex(u, 0)*d)
}

type rootLeaf struct {
	a, b   float64
	za, zb complex128
	lower  float64
}

// certify divides one circuit into N_c = ⌈N/n⌉ base intervals and bisects
// each until its clearance is certified, then refines every certified
// interval so that w turns at most 2π/N per part and both planes'
// polylines stay within the tolerance. It counts the journey's points
// against the budget before building the grid.
func (c *rootLoop) certify(intervals int) error {
	defer func() {
		if certifyCounter != nil {
			certifyCounter(c.evaluations)
		}
	}()
	nc := (intervals + c.n - 1) / c.n
	h := 2 * math.Pi / float64(nc)
	clearance := c.r / 20
	z0 := c.z(0)
	c.evaluations++
	witness := func(z complex128, s float64) error {
		return fieldErr("root.offset", "Center offset: the path passes within r/20 of the branch point z = 0 (|z| = %s at t = %s); move it farther from 0 or across it", rootReadout(cmplx.Abs(z), 3), rootReadout(s, 3))
	}
	if cmplx.Abs(z0) < clearance {
		return witness(z0, 0)
	}
	var leaves []rootLeaf
	var visit func(a, b float64, za, zb complex128, depth int) error
	visit = func(a, b float64, za, zb complex128, depth int) error {
		lower := originToSegment(za, zb) - c.m*(b-a)*(b-a)/8
		if lower >= clearance {
			leaves = append(leaves, rootLeaf{a, b, za, zb, lower})
			return nil
		}
		if depth >= rootCertifyDepth || c.evaluations >= rootCertifyBudget {
			return fieldErr("root.offset", "Center offset: the path comes so near the clearance r/20 from the branch point z = 0 that it can be neither certified nor refused; move it farther from 0 or across it")
		}
		mid := a + (b-a)/2
		zm := c.z(mid)
		c.evaluations++
		if cmplx.Abs(zm) < clearance {
			return witness(zm, mid)
		}
		if err := visit(a, mid, za, zm, depth+1); err != nil {
			return err
		}
		return visit(mid, b, zm, zb, depth+1)
	}
	za := z0
	for j := 0; j < nc; j++ {
		a, b := float64(j)*h, float64(j+1)*h
		zb := z0
		if j < nc-1 {
			zb = c.z(b)
			c.evaluations++
			if cmplx.Abs(zb) < clearance {
				return witness(zb, b)
			}
		} else {
			b = 2 * math.Pi
		}
		if err := visit(a, b, za, zb, 0); err != nil {
			return err
		}
		za = zb
	}

	// Parts per certified interval. On it |z| ≥ δ and |z'| ≤ L_l, so z
	// turns at most L_l/δ per unit t and w at most L_l/(nδ): ⌈L_l h_l/(δ h)⌉ parts keep w's
	// turn within h/n ≤ 2π/N, the circle's rule with L for r. The chords
	// stray at most h²|z''|/8 and h²|w''|/8, with
	// |w''| ≤ M/(n δ^{1−1/n}) + (n − 1)L_l²/(n² δ^{2−1/n}).
	nf := float64(c.n)
	parts := make([]int, len(leaves))
	total := 0
	for i, leaf := range leaves {
		hl, d := leaf.b-leaf.a, leaf.lower
		// |z'| on the interval is at most its value at the middle plus
		// M h_l/2, and never more than L.
		speed := math.Min(c.l, cmplx.Abs(c.dz(leaf.a+hl/2))+c.m*hl/2)
		c.evaluations++
		w2 := c.m/(nf*math.Pow(d, 1-1/nf)) + (nf-1)*speed*speed/(nf*nf*math.Pow(d, 2-1/nf))
		m := math.Max(1, math.Ceil(speed*hl/(d*h)-1e-9))
		m = math.Max(m, math.Ceil(hl*math.Sqrt(c.m/(8*c.tol))))
		m = math.Max(m, math.Ceil(hl*math.Sqrt(w2/(8*c.tol))))
		if m*float64(3*c.n) > maxPoints {
			return fieldErr("samples", "%s", rootBudgetMessage)
		}
		parts[i] = int(m)
		total += parts[i]
		if 3*c.n*total > maxPoints {
			return fieldErr("samples", "%s", rootBudgetMessage)
		}
	}

	// The continuous argument at each interval's start, and the winding.
	c.closestBound = math.Inf(1)
	theta := math.Atan2(imag(z0), real(z0))
	c.leafS = make([]float64, len(leaves))
	c.leafZ = make([]complex128, len(leaves))
	c.leafTh = make([]float64, len(leaves))
	c.grid = make([]float64, 0, total)
	least, leastS := math.Inf(1), 0.
	for i, leaf := range leaves {
		c.leafS[i], c.leafZ[i], c.leafTh[i] = leaf.a, leaf.za, theta
		c.closestBound = math.Min(c.closestBound, leaf.lower)
		for p := 0; p < parts[i]; p++ {
			s := leaf.a + (leaf.b-leaf.a)*float64(p)/float64(parts[i])
			c.grid = append(c.grid, s)
			v := leaf.za
			if p > 0 {
				v = c.z(s)
			}
			if a := cmplx.Abs(v); a < least {
				least, leastS = a, s
			}
		}
		theta += cmplx.Phase(leaf.zb / leaf.za)
	}
	turns := (theta - c.leafTh[0]) / (2 * math.Pi)
	c.winding = int(math.Round(turns))
	if math.Abs(turns-float64(c.winding)) > 1e-6 {
		return fmt.Errorf("root path: the argument's change %v is not a whole number of turns", turns)
	}
	c.closest = c.refineClosest(least, leastS)
	return nil
}

// refineClosest narrows the least sampled |z| by golden-section search on
// the grid intervals beside it; the result is still a value of |z|, so an
// upper bound on the minimum.
func (c *rootLoop) refineClosest(least, s float64) float64 {
	i := sort.SearchFloat64s(c.grid, s)
	lo, hi := s, s
	if i > 0 {
		lo = c.grid[i-1]
	}
	if i+1 < len(c.grid) {
		hi = c.grid[i+1]
	} else {
		hi = 2 * math.Pi
	}
	f := func(t float64) float64 { return cmplx.Abs(c.z(t)) }
	g := (math.Sqrt(5) - 1) / 2
	a, b := lo, hi
	x1, x2 := b-g*(b-a), a+g*(b-a)
	f1, f2 := f(x1), f(x2)
	for j := 0; j < 60; j++ {
		if f1 < f2 {
			b, x2, f2 = x2, x1, f1
			x1 = b - g*(b-a)
			f1 = f(x1)
		} else {
			a, x1, f1 = x1, x2, f2
			x2 = a + g*(b-a)
			f2 = f(x2)
		}
	}
	return math.Min(least, math.Min(f1, f2))
}

// first is w over the first circuit at 0 ≤ s < 2π: θ(s) is the argument
// at its certified interval's start plus Arg(z(s)/z(start)), exact because
// the interval's tube excludes 0.
func (c *rootLoop) first(s float64) (complex128, complex128) {
	i := sort.Search(len(c.leafS), func(i int) bool { return c.leafS[i] > s }) - 1
	i = max(i, 0)
	z := c.z(s)
	theta := c.leafTh[i]
	if s != c.leafS[i] {
		theta += cmplx.Phase(z / c.leafZ[i])
	}
	sn, cs := math.Sincos(theta / float64(c.n))
	m := math.Pow(cmplx.Abs(z), 1/float64(c.n))
	return z, c.start * complex(m*cs, m*sn)
}

// at evaluates q(t) for 0 ≤ t ≤ 2πn: circuit c (from 0) is ω^{Wc} times
// the first, so circuits meet exactly at each 2πc and t = 2πn draws t = 0.
func (c *rootLoop) at(t float64) Vec4 {
	k := 0
	for k < c.n && t >= 2*math.Pi*float64(k+1) {
		k++
	}
	s := t - 2*math.Pi*float64(k)
	if s >= 2*math.Pi {
		k, s = k+1, 0
	}
	z, w := c.first(s)
	w *= unity(c.n, ((c.winding*k)%c.n+c.n)%c.n)
	return Vec4{real(z), imag(z), real(w), imag(w)}
}

// journeyGrid is the circuit's grid repeated over the n circuits.
func (c *rootLoop) journeyGrid() []float64 {
	ts := make([]float64, 0, c.n*len(c.grid))
	for k := 0; k < c.n; k++ {
		base := 2 * math.Pi * float64(k)
		for _, s := range c.grid {
			ts = append(ts, base+s)
		}
	}
	return ts
}

func gcdInt(a, b int) int {
	if a < 0 {
		a = -a
	}
	if b < 0 {
		b = -b
	}
	for b != 0 {
		a, b = b, a%b
	}
	return a
}

// rootReadout writes v as the interface's readouts do (web/number-format.ts
// readout): digits significant digits without a floating-point tail or
// trailing zeros, plain from 1e-4 up to 10^digits and scientific (1.2e−5)
// elsewhere, with a true minus sign. v must be finite.
func rootReadout(v float64, digits int) string {
	if v == 0 {
		return "0"
	}
	rounded, _ := strconv.ParseFloat(strconv.FormatFloat(v, 'g', digits, 64), 64)
	a := math.Abs(rounded)
	var text string
	if a >= 1e-4 && a < math.Pow(10, float64(digits)) {
		text = strconv.FormatFloat(a, 'f', -1, 64)
	} else {
		mantissa, exponent, _ := strings.Cut(strconv.FormatFloat(a, 'e', -1, 64), "e")
		e, _ := strconv.Atoi(exponent)
		text = mantissa + "e" + strconv.Itoa(e)
	}
	if rounded < 0 {
		text = "-" + text
	}
	return strings.ReplaceAll(text, "-", "−")
}

// The refusal of a path over the point budget, from refinement or the
// returned journey: fewer intervals help where the interval count sets
// the points, a lower degree or a smoother path where the tolerance does.
const rootBudgetMessage = "This path needs more than 65,536 points to be drawn within 0.02% of its size: use fewer path intervals, a lower degree or a smoother path"
