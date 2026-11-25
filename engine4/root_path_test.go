package engine4

import (
	"errors"
	"fmt"
	"math"
	"math/cmplx"
	"strings"
	"testing"
)

// Noncircular source paths for the root journey (#413 research): the
// ripple s = e^{it} + a e^{imt} and Fourier loops s = Σ ρ e^{i(f t + ψ)},
// placed as the circle is, z(t) = r e^{iφ}(k + s(t)). Every check reads
// returned geometry and compares it with references computed here: the
// path evaluated from its formula, the winding from an argument-principle
// quadrature, and w from a dense nearest-root continuation. None uses the
// engine's certified argument continuation.

type pathCase struct {
	name      string
	p         RootParameters
	samples   int
	winding   int // independently known, checked against the quadrature
	unvisited []int
}

// The example leaf's 8-term fit, drawn clockwise.
var leafTerms = []RootTerm{
	{Frequency: 0, Radius: 0.07380196413782487, Phase: 2.0118362730533916},
	{Frequency: -1, Radius: 1.419723912035244, Phase: -2.54812186120912},
	{Frequency: 1, Radius: 0.44569943540349205, Phase: -2.5979464811593407},
	{Frequency: 3, Radius: 0.11405156588444013, Phase: -2.118376046160493},
	{Frequency: -3, Radius: 0.10770905363261428, Phase: -2.3105380227028074},
	{Frequency: 2, Radius: 0.0539559922425223, Phase: -2.915645709915259},
	{Frequency: 5, Radius: 0.05395375123749766, Phase: -1.8127548668539546},
	{Frequency: -5, Radius: 0.04547927263327711, Phase: -2.284355839723539},
}

func ripple(r, k, phi, a float64, m, n int, sheet string, branch int) RootParameters {
	return RootParameters{Path: "ripple", Radius: r, Offset: k, Direction: phi, Ripple: a, Frequency: float64(m),
		Degree: float64(n), Branch: float64(branch), Sheet: sheet}
}

func fourier(r, k, phi float64, terms []RootTerm, n int, sheet string, branch int) RootParameters {
	return RootParameters{Path: "fourier", Radius: r, Offset: k, Direction: phi, Terms: terms,
		Degree: float64(n), Branch: float64(branch), Sheet: sheet}
}

var pathCases = []pathCase{
	// z = e^{it}(1 + e^{it}/2): once about 0, a cardioid-like loop.
	{"ripple m=2 a=0.5", ripple(1, 0, 0, 0.5, 2, 2, "plus", 0), 1024, 1, nil},
	// z = e^{it}(1 + 2e^{it}): twice about 0. At degree 4 the sheets pair
	// up, w is home after two circuits and sheets 1 and 3 are unvisited.
	{"ripple m=2 a=2 twice", ripple(0.8, 0, 0.7, 2, 2, 4, "plus", 1), 1024, 2, []int{1, 3}},
	// z = e^{it} + 1.5 e^{−it}: a clockwise ellipse, winding −1.
	{"ripple m=-1 reversed", ripple(1.2, 0, -1, 1.5, -1, 3, "plus", 2), 777, -1, nil},
	// High curvature: twelve ripples on an enclosing circle.
	{"ripple m=12", ripple(1, 0.3, 0.4, 0.3, 12, 5, "plus", 3), 2048, 1, nil},
	// Three times about 0, at degree 6: three sheet pairs, w home after
	// two circuits.
	{"ripple m=3 thrice", ripple(0.5, 0.2, 2.5, 1.6, 3, 6, "minus", 0), 1500, 3, []int{1, 2, 4, 5}},
	// A ripple that misses 0: winding 0 at degree 3.
	{"ripple misses", ripple(1, 2.2, 1, 0.4, 4, 3, "plus", 1), 512, 0, []int{1, 2}},
	// The example leaf about 0, clockwise: winding −1.
	{"leaf", fourier(1.1, 0, 0.3, leafTerms, 3, "plus", 0), 1024, -1, nil},
	// The leaf moved past 0.
	{"leaf misses", fourier(0.9, 2.6, -2, leafTerms, 2, "minus", 0), 1024, 0, []int{1}},
	// Frequencies up to 64.
	{"fourier high", fourier(1, 0.4, 0, []RootTerm{{1, 1, 0}, {64, 0.004, 0.3}, {-7, 0.05, 1}}, 2, "plus", 0), 1024, 1, nil},
	// Near the clearance on both sides, as Fourier circles.
	{"near inside", fourier(2, 0.94, 0.2, []RootTerm{{1, 1, 0.5}}, 6, "plus", 5), 4096, 1, nil},
	{"near outside", fourier(0.3, 1.06, -0.2, []RootTerm{{1, 1, -0.5}}, 2, "plus", 1), 64, 0, []int{1}},
}

// z(s) and dz/ds from the formula.
func pathZ(p RootParameters, s float64) (complex128, complex128) {
	var v, dv complex128
	switch p.Path {
	case "ripple":
		e, em := cmplx.Exp(complex(0, s)), cmplx.Exp(complex(0, p.Frequency*s))
		v = e + complex(p.Ripple, 0)*em
		dv = complex(0, 1)*e + complex(0, p.Ripple*p.Frequency)*em
	case "fourier":
		for _, term := range p.Terms {
			e := cmplx.Exp(complex(0, term.Frequency*s+term.Phase))
			v += complex(term.Radius, 0) * e
			dv += complex(0, term.Frequency*term.Radius) * e
		}
	default:
		v = cmplx.Exp(complex(0, s))
		dv = complex(0, 1) * v
	}
	rot := complex(p.Radius, 0) * cmplx.Exp(complex(0, p.Direction))
	return rot * (complex(p.Offset, 0) + v), rot * dv
}

// The winding of z about 0 over one circuit, from (1/2π)∮ Im(z'/z) ds by
// the trapezoid rule, which converges spectrally for a periodic integrand.
func quadratureWinding(p RootParameters) (int, float64) {
	const m = 1 << 17
	var sum float64
	for j := 0; j < m; j++ {
		z, dz := pathZ(p, 2*math.Pi*float64(j)/m)
		sum += imag(dz / z)
	}
	w := sum / m
	return int(math.Round(w)), math.Abs(w - math.Round(w))
}

func degreeOf(p RootParameters) int {
	if p.Degree == 0 {
		return 2
	}
	return int(p.Degree)
}

// A dense nearest-root continuation of w over the whole journey, from the
// named root of z(0).
type continuation struct {
	p RootParameters
	n int
	h float64
	w []complex128
}

func (c *continuation) nearest(z, prev complex128) complex128 {
	base := cmplx.Pow(z, complex(1/float64(c.n), 0))
	best, bestD := base, math.Inf(1)
	for j := 0; j < c.n; j++ {
		cand := base * omegaTo(c.n, j)
		if d := cmplx.Abs(cand - prev); d < bestD {
			best, bestD = cand, d
		}
	}
	return best
}

func continueRoot(p RootParameters) *continuation {
	n := degreeOf(p)
	const perCircuit = 1 << 16
	c := &continuation{p: p, n: n, h: 2 * math.Pi / perCircuit, w: make([]complex128, n*perCircuit+1)}
	z0, _ := pathZ(p, 0)
	sigma := complex(1, 0)
	if p.Sheet == "minus" {
		sigma = -1
	}
	c.w[0] = sigma * omegaTo(n, int(p.Branch)) * cmplx.Pow(z0, complex(1/float64(n), 0))
	for i := 1; i < len(c.w); i++ {
		// Eight substeps keep consecutive roots unambiguous near 0.
		w := c.w[i-1]
		for j := 1; j <= 8; j++ {
			z, _ := pathZ(p, (float64(i-1)+float64(j)/8)*c.h)
			w = c.nearest(z, w)
		}
		c.w[i] = w
	}
	return c
}

// w at t, continued from the nearest node at or below it.
func (c *continuation) at(t float64) complex128 {
	i := int(math.Floor(t / c.h))
	i = max(0, min(i, len(c.w)-1))
	z, _ := pathZ(c.p, t)
	return c.nearest(z, c.w[i])
}

func pathRequest(c pathCase, from, to, trace float64) Request {
	p := c.p
	p.From, p.To, p.Trace = from, to, trace
	return Request{Object: "root", Mode: "paired", Samples: c.samples,
		Angles: [6]float64{0.2, 0.35, 0.1, 0.6, 0.45, 0.3}, Root: &p}
}

func (c pathCase) period() float64 { return 2 * math.Pi * float64(degreeOf(c.p)) }

// The bound r(k + Σρ) on |z|, from the formula.
func (c pathCase) reach() float64 {
	sum := 1.0
	switch c.p.Path {
	case "ripple":
		sum += c.p.Ripple
	case "fourier":
		sum = 0
		for _, term := range c.p.Terms {
			sum += term.Radius
		}
	}
	return c.p.Radius * (c.p.Offset + sum)
}

// The returned geometry satisfies wⁿ = z, its z lies on the formula's path
// at its own parameter, the projection is rotate-then-drop, every point is
// within the framing radius, and w is the continuously followed root: it
// matches an independent nearest-root continuation at every returned
// parameter.
func TestRootPathRelationSourceAndContinuation(t *testing.T) {
	for _, c := range pathCases {
		t.Run(c.name, func(t *testing.T) {
			n := degreeOf(c.p)
			ref := continueRoot(c.p)
			q := pathRequest(c, 0, c.period(), 0.37)
			res := rootCompute(t, q)
			scale := math.Max(c.reach(), math.Pow(c.reach(), 1/float64(n)))
			seen := 0
			for _, path := range res.Paths {
				if path.Role == "other-sheet" {
					continue
				}
				if len(path.Parameters) != len(path.FourPoints) {
					t.Fatalf("%s: %d parameters for %d points", path.Source, len(path.Parameters), len(path.FourPoints))
				}
				for i, s := range path.FourPoints {
					z, w := zw(s)
					tt := path.Parameters[i]
					if d := cmplx.Abs(power(w, n) - z); d > 1e-13*scale {
						t.Fatalf("%s[%d]: |wⁿ − z| = %v", path.Source, i, d)
					}
					want, _ := pathZ(c.p, math.Mod(tt, 2*math.Pi))
					if d := cmplx.Abs(z - want); d > 1e-12*scale {
						t.Fatalf("%s[%d] at t = %v: z = %v, the formula gives %v", path.Source, i, tt, z, want)
					}
					if d := cmplx.Abs(w - ref.at(tt)); d > 1e-9*scale {
						t.Fatalf("%s[%d] at t = %v: w = %v, the continuation gives %v", path.Source, i, tt, w, ref.at(tt))
					}
					want3 := dropAfterRotation(s, q.Angles)
					if d := math.Sqrt(dot(sub(path.Points[i], want3), sub(path.Points[i], want3))); d > 1e-13*res.Radius {
						t.Fatalf("%s[%d]: projected %v, want %v", path.Source, i, path.Points[i], want3)
					}
					if v := norm4(s); v > res.Radius*(1+1e-13) {
						t.Fatalf("%s[%d]: |q| = %v exceeds the framing radius %v", path.Source, i, v, res.Radius)
					}
					seen++
				}
			}
			if seen < c.samples {
				t.Fatalf("only %d source points", seen)
			}
			if res.Root.Residual > 1e-13*scale {
				t.Fatalf("residual readout %v", res.Root.Residual)
			}
			// The framing is √(R² + R^{2/n}) with R = r(k + Σρ).
			big := c.reach()
			if want := math.Sqrt(big*big + math.Pow(big, 2/float64(n))); math.Abs(res.Radius-want) > 1e-14*want {
				t.Fatalf("framing %v, want %v", res.Radius, want)
			}
		})
	}
}

// The winding is the argument principle's, w(2πc) = ω^{Wc} w(0) at every
// circuit's end, circuits meet exactly, and w is home after n/gcd(n, W)
// circuits, and not before.
func TestRootPathWindingAndMonodromy(t *testing.T) {
	for _, c := range pathCases {
		t.Run(c.name, func(t *testing.T) {
			n := degreeOf(c.p)
			wind, off := quadratureWinding(c.p)
			if off > 1e-6 || wind != c.winding {
				t.Fatalf("quadrature winding %v (off by %v), the case says %d", wind, off, c.winding)
			}
			res := rootCompute(t, pathRequest(c, 0, c.period(), 0))
			if res.Root.Winding != wind {
				t.Fatalf("winding readout %d, want %d", res.Root.Winding, wind)
			}
			g := gcd(n, abs(wind))
			if res.Root.Period != n/g {
				t.Fatalf("home after %d circuits, want %d", res.Root.Period, n/g)
			}
			start := rootPath(t, res, "root/lifted/circuit/1").FourPoints[0]
			_, w0 := zw(start)
			for k := 1; k <= n; k++ {
				circuit := rootPath(t, res, fmt.Sprintf("root/lifted/circuit/%d", k))
				last := circuit.FourPoints[len(circuit.FourPoints)-1]
				if circuit.Parameters[len(circuit.Parameters)-1] != 2*math.Pi*float64(k) {
					t.Fatalf("circuit %d ends at %v", k, circuit.Parameters[len(circuit.Parameters)-1])
				}
				_, wk := zw(last)
				want := omegaTo(n, ((wind*k)%n+n)%n) * w0
				if d := cmplx.Abs(wk - want); d > 1e-12*cmplx.Abs(w0) {
					t.Fatalf("w(2π·%d) = %v, want ω^{%d·%d} w(0) = %v", k, wk, wind, k, want)
				}
				home := cmplx.Abs(wk-w0) < 1e-9*cmplx.Abs(w0)
				if home != (k%(n/g) == 0) {
					t.Fatalf("after %d circuits home = %v, period %d", k, home, n/g)
				}
				if k < n {
					next := rootPath(t, res, fmt.Sprintf("root/lifted/circuit/%d", k+1))
					if next.FourPoints[0] != last {
						t.Fatalf("circuits %d and %d meet at %v and %v", k, k+1, last, next.FourPoints[0])
					}
				}
			}
		})
	}
}

func abs(a int) int {
	if a < 0 {
		return -a
	}
	return a
}

// The moving point and the trace's ends follow the continuation at grid
// and off-grid parameters, forward, reversed and partial; t = 2πn draws
// t = 0; the trace is one circuit of t behind the point.
func TestRootPathMovingPointTraceAndReversal(t *testing.T) {
	for _, c := range pathCases {
		t.Run(c.name, func(t *testing.T) {
			ref := continueRoot(c.p)
			period := c.period()
			for _, ends := range [][2]float64{{0, period}, {period, 0}, {0.7, period - 1.3}, {period - 0.2, 1.1}} {
				for _, p := range []float64{0, 0.123, 0.5, 0.987654, 1} {
					res := rootCompute(t, pathRequest(c, ends[0], ends[1], p))
					now := ends[0]*(1-p) + ends[1]*p
					m := rootMarker(t, res, "root/lifted/current")
					_, w := zw(m.FourPoint)
					want := ref.at(math.Mod(now, period))
					if d := cmplx.Abs(w - want); d > 1e-9*math.Max(1, cmplx.Abs(want)) {
						t.Fatalf("ends %v p %v: w = %v, want %v", ends, p, w, want)
					}
					// The trace pieces cover one circuit and end at the point.
					var length float64
					touches := false
					for _, path := range res.Paths {
						if path.Role != "trace" {
							continue
						}
						length += path.Parameters[len(path.Parameters)-1] - path.Parameters[0]
						for _, v := range []Vec4{path.FourPoints[0], path.FourPoints[len(path.FourPoints)-1]} {
							if v == m.FourPoint {
								touches = true
							}
						}
					}
					if math.Abs(length-2*math.Pi) > 1e-9 || !touches {
						t.Fatalf("ends %v p %v: trace of length %v, touching the point %v", ends, p, length, touches)
					}
				}
			}
			whole := rootCompute(t, pathRequest(c, 0, period, 1))
			first := rootCompute(t, pathRequest(c, 0, period, 0))
			if !sameDrawing(whole, first) {
				t.Fatal("t = 2πn does not draw t = 0")
			}
		})
	}
}

// The sheets the permutation never visits, ω^m w for m not a multiple of
// gcd(n, W), are drawn as closed guides; the visited ones are not.
func TestRootPathDrawsOnlyTheUnvisitedSheets(t *testing.T) {
	for _, c := range pathCases {
		t.Run(c.name, func(t *testing.T) {
			n := degreeOf(c.p)
			res := rootCompute(t, pathRequest(c, 0, c.period(), 0))
			var got []int
			first := rootPath(t, res, "root/lifted/circuit/1")
			for _, path := range res.Paths {
				if path.Role != "other-sheet" {
					continue
				}
				var m int
				if n == 2 {
					m = 1
				} else if _, err := fmt.Sscanf(path.Source, "root/lifted/other-sheet/%d", &m); err != nil {
					t.Fatalf("guide %s", path.Source)
				}
				got = append(got, m)
				if len(path.FourPoints) != len(first.FourPoints) {
					t.Fatalf("guide %d has %d points, the first circuit %d", m, len(path.FourPoints), len(first.FourPoints))
				}
				for i, v := range path.FourPoints {
					z, w := zw(v)
					z1, w1 := zw(first.FourPoints[i])
					if z != z1 || cmplx.Abs(w-omegaTo(n, m)*w1) > 1e-13*math.Max(1, cmplx.Abs(w1)) {
						t.Fatalf("guide %d[%d] is not (z, ω^m w)", m, i)
					}
				}
			}
			if fmt.Sprint(got) != fmt.Sprint(c.unvisited) && !(len(got) == 0 && len(c.unvisited) == 0) {
				t.Fatalf("guides %v, want %v", got, c.unvisited)
			}
		})
	}
}

// The closest approach is bracketed: the certified bound at least the
// clearance r/20 and at most the true minimum, the readout at least the
// true minimum and within the drawing's tolerance of it.
func TestRootPathClosestApproachIsCertified(t *testing.T) {
	for _, c := range pathCases {
		t.Run(c.name, func(t *testing.T) {
			res := rootCompute(t, pathRequest(c, 0, c.period(), 0))
			least := trueClosest(c.p)
			d := res.Root
			if d.ClosestBound < c.p.Radius/20 || d.ClosestBound > least*(1+1e-12) {
				t.Fatalf("certified bound %v, clearance %v, true minimum about %v", d.ClosestBound, c.p.Radius/20, least)
			}
			if d.Closest < least*(1-1e-12) || d.Closest > least+d.Tolerance {
				t.Fatalf("closest %v, true minimum about %v, tolerance %v", d.Closest, least, d.Tolerance)
			}
		})
	}
}

// min |z| over the path: dense samples, then a ternary search beside the
// least of them.
func trueClosest(p RootParameters) float64 {
	const m = 1 << 16
	h := 2 * math.Pi / m
	best, at := math.Inf(1), 0.
	for j := 0; j < m; j++ {
		z, _ := pathZ(p, float64(j)*h)
		if a := cmplx.Abs(z); a < best {
			best, at = a, float64(j)*h
		}
	}
	f := func(s float64) float64 { z, _ := pathZ(p, s); return cmplx.Abs(z) }
	lo, hi := at-h, at+h
	for i := 0; i < 200; i++ {
		a, b := lo+(hi-lo)/3, hi-(hi-lo)/3
		if f(a) < f(b) {
			hi = b
		} else {
			lo = a
		}
	}
	return math.Min(best, f((lo+hi)/2))
}

// The drawing's error is controlled: between consecutive returned points,
// the true z and w curves stay within the stated tolerance of the chord,
// and the tolerance is a fixed share of the scale.
func TestRootPathPolylinesStayWithinTolerance(t *testing.T) {
	for _, c := range pathCases {
		t.Run(c.name, func(t *testing.T) {
			n := degreeOf(c.p)
			ref := continueRoot(c.p)
			res := rootCompute(t, pathRequest(c, 0, c.period(), 0))
			tol := res.Root.Tolerance
			scale := math.Max(c.reach(), math.Pow(c.reach(), 1/float64(n)))
			if math.Abs(tol-2e-4*scale) > 1e-15*scale {
				t.Fatalf("tolerance %v, want 2e-4 of %v", tol, scale)
			}
			var worst [2]float64
			worst[0], worst[1] = polylineDeviation(c, res, ref)
			if worst[0] > tol || worst[1] > tol {
				t.Fatalf("polylines stray %v (z) and %v (w) from their curves, tolerance %v", worst[0], worst[1], tol)
			}
		})
	}
}

// The largest distance of the true z and w curves from the returned
// circuits' chords, sampled between consecutive points.
func polylineDeviation(c pathCase, res Result, ref *continuation) (float64, float64) {
	var dz, dw float64
	for _, path := range res.Paths {
		if path.Role != "circuit" {
			continue
		}
		for i := 0; i+1 < len(path.FourPoints); i++ {
			za, wa := zw(path.FourPoints[i])
			zb, wb := zw(path.FourPoints[i+1])
			ta, tb := path.Parameters[i], path.Parameters[i+1]
			for j := 1; j < 8; j++ {
				s := ta + (tb-ta)*float64(j)/8
				z, _ := pathZ(c.p, math.Mod(s, 2*math.Pi))
				dz = math.Max(dz, segmentDistance(z, za, zb))
				dw = math.Max(dw, segmentDistance(ref.at(s), wa, wb))
			}
		}
	}
	return dz, dw
}

func segmentDistance(p, a, b complex128) float64 {
	d := b - a
	if d == 0 {
		return cmplx.Abs(p - a)
	}
	u := real((p-a)*cmplx.Conj(d)) / real(d*cmplx.Conj(d))
	u = math.Max(0, math.Min(1, u))
	return cmplx.Abs(p - (a + complex(u, 0)*d))
}

// w turns about 0 by at most 2π/N per returned segment, as on the circle,
// so motion near the branch point is resolved.
func TestRootPathTurnPerSegment(t *testing.T) {
	for _, c := range pathCases {
		t.Run(c.name, func(t *testing.T) {
			res := rootCompute(t, pathRequest(c, 0, c.period(), 0))
			for _, path := range res.Paths {
				if path.Role != "circuit" {
					continue
				}
				for i := 0; i+1 < len(path.FourPoints); i++ {
					_, wa := zw(path.FourPoints[i])
					_, wb := zw(path.FourPoints[i+1])
					if turn := math.Abs(cmplx.Phase(wb / wa)); turn > 2*math.Pi/float64(c.samples)*(1+1e-9) {
						t.Fatalf("%s[%d]: w turns %v, more than 2π/N", path.Source, i, turn)
					}
				}
			}
		})
	}
}

// The circle written as a path reproduces the closed-form circle's lift,
// for enclosing and missing circles at several degrees and sheets.
func TestRootPathCircleMatchesTheClosedForm(t *testing.T) {
	for _, c := range []degreeCase{
		{2, 1.6, 0, 0, "plus", 0, 1024},
		{2, 1.2, 0.7, 2.8, "minus", 0, 512},
		{3, 1, 0.6, 0.4, "plus", 2, 1000},
		{5, 0.6, 1.4, -1, "plus", 4, 2048},
	} {
		circle := RootParameters{Path: "fourier", Radius: c.r, Offset: c.k, Direction: c.phi,
			Terms: []RootTerm{{Frequency: 1, Radius: 1}}, Degree: float64(c.n), Branch: float64(c.branch), Sheet: c.sheet}
		ripple0 := RootParameters{Path: "ripple", Radius: c.r, Offset: c.k, Direction: c.phi,
			Frequency: 5, Degree: float64(c.n), Branch: float64(c.branch), Sheet: c.sheet}
		for _, p := range []float64{0, 0.2, 0.5, 0.77, 1} {
			want := c.compute(t, 0, c.period(), p)
			_, ww := zw(rootMarker(t, want, "root/lifted/current").FourPoint)
			for _, src := range []RootParameters{circle, ripple0} {
				got := rootCompute(t, pathRequest(pathCase{p: src, samples: c.samples}, 0, c.period(), p))
				_, wg := zw(rootMarker(t, got, "root/lifted/current").FourPoint)
				if d := cmplx.Abs(wg - ww); d > 1e-12*math.Max(1, cmplx.Abs(ww)) {
					t.Fatalf("%+v %s p %v: w = %v, the circle's closed form %v", c, src.Path, p, wg, ww)
				}
				if got.Root.Winding != c.winding() {
					t.Fatalf("%+v %s: winding %d", c, src.Path, got.Root.Winding)
				}
			}
		}
	}
}

// Refusals name their field. A path through or within r/20 of the branch
// point is refused under the center offset, with a witness; a grazing path
// that can be neither certified nor refused is refused as unresolved.
func TestRootPathRefusesByField(t *testing.T) {
	base := pathCases[0]
	for _, tc := range []struct {
		edit  func(*RootParameters)
		field string
		says  string
	}{
		{func(p *RootParameters) { p.Path = "spiral" }, "root.path", ""},
		{func(p *RootParameters) { p.Ripple = -0.1 }, "root.ripple", ""},
		{func(p *RootParameters) { p.Ripple = 3.5 }, "root.ripple", ""},
		{func(p *RootParameters) { p.Ripple = math.NaN() }, "root.ripple", ""},
		{func(p *RootParameters) { p.Frequency = 2.5 }, "root.frequency", ""},
		{func(p *RootParameters) { p.Frequency = 13 }, "root.frequency", ""},
		{func(p *RootParameters) { p.Frequency = math.Inf(-1) }, "root.frequency", ""},
		// Through the branch point at t = π: z = e^{it}(1 + e^{it}).
		{func(p *RootParameters) { p.Ripple = 1 }, "root.offset", "r/20"},
		{func(p *RootParameters) { *p = fourier(1, 0, 0, nil, 2, "plus", 0) }, "root.terms", ""},
		{func(p *RootParameters) { *p = fourier(1, 0, 0, make([]RootTerm, 17), 2, "plus", 0) }, "root.terms", ""},
		{func(p *RootParameters) {
			*p = fourier(1, 0, 0, []RootTerm{{1, 1, 0}, {0.5, 0.1, 0}}, 2, "plus", 0)
		}, "root.terms.1.frequency", ""},
		{func(p *RootParameters) {
			*p = fourier(1, 0, 0, []RootTerm{{1, 1, 0}, {65, 0.1, 0}}, 2, "plus", 0)
		}, "root.terms.1.frequency", ""},
		{func(p *RootParameters) {
			*p = fourier(1, 0, 0, []RootTerm{{1, -1, 0}}, 2, "plus", 0)
		}, "root.terms.0.radius", ""},
		{func(p *RootParameters) {
			*p = fourier(1, 0, 0, []RootTerm{{1, 1, math.NaN()}}, 2, "plus", 0)
		}, "root.terms.0.phase", ""},
		// A path that does not move.
		{func(p *RootParameters) {
			*p = fourier(1, 0.5, 0, []RootTerm{{0, 1, 0}, {3, 0, 0}}, 2, "plus", 0)
		}, "root.terms", ""},
		// Within the clearance: a circle at k = 1.04 comes within 0.04 r.
		{func(p *RootParameters) {
			*p = fourier(1, 1.04, 0, []RootTerm{{1, 1, 0.3}}, 2, "plus", 0)
		}, "root.offset", "r/20"},
		// Exactly at the clearance, nearest off the sampled grid: never
		// certified, never witnessed.
		{func(p *RootParameters) {
			*p = fourier(1, 1.05, 0, []RootTerm{{1, 1, 0.3}}, 2, "plus", 0)
		}, "root.offset", "certif"},
		// Too many points: a frequency-64 ripple of large amplitude at
		// degree 6 and the largest count.
		{func(p *RootParameters) {
			*p = fourier(1, 0, 0, []RootTerm{{1, 1, 0}, {64, 0.5, 0}}, 6, "plus", 0)
		}, "samples", ""},
	} {
		q := pathRequest(base, 0, base.period(), 0)
		tc.edit(q.Root)
		q.Root.To = 2 * math.Pi * float64(degreeOf(*q.Root))
		if tc.field == "samples" {
			q.Samples = 4096
		}
		_, err := Compute(q)
		var fe *FieldError
		if !errors.As(err, &fe) || fe.Field != tc.field {
			t.Fatalf("%+v: error %v, want a field error on %s", *q.Root, err, tc.field)
		}
		if tc.says != "" && !strings.Contains(fe.Error(), tc.says) {
			t.Fatalf("%+v: %q does not say %q", *q.Root, fe.Error(), tc.says)
		}
	}
}

// Work is bounded: the returned points fit the budget, counted before the
// lift is evaluated, and certification evaluates z a bounded number of
// times even when it cannot decide.
func TestRootPathWorkIsBounded(t *testing.T) {
	for _, c := range pathCases {
		res := rootCompute(t, pathRequest(c, 0, c.period(), 0.5))
		if res.EmittedPoints > maxPoints {
			t.Fatalf("%s: %d points", c.name, res.EmittedPoints)
		}
		t.Logf("%s: %d intervals refined to %d per journey, %d points, %d evaluations", c.name, c.samples, res.Root.Refined, res.EmittedPoints, res.Evaluations)
	}
	q := pathRequest(pathCase{p: fourier(1, 1.05, 0, []RootTerm{{1, 1, 0.3}}, 2, "plus", 0), samples: 4096}, 0, 4*math.Pi, 0)
	var evaluations int
	certifyCounter = func(n int) { evaluations = n }
	defer func() { certifyCounter = nil }()
	if _, err := Compute(q); err == nil {
		t.Fatal("the grazing circle is admitted")
	}
	if evaluations == 0 || evaluations > rootCertifyBudget {
		t.Fatalf("certification evaluated z %d times, budget %d", evaluations, rootCertifyBudget)
	}
}

// Refinement converges: as N grows, the returned polylines' measured
// deviation from the true z and w curves falls, and the closest-approach
// readout approaches the true minimum.
func TestRootPathConvergesWithIntervals(t *testing.T) {
	c := pathCases[3]
	ref := continueRoot(c.p)
	least := trueClosest(c.p)
	var deviation, gap []float64
	for _, samples := range []int{256, 768, 2048} {
		c.samples = samples
		res := rootCompute(t, pathRequest(c, 0, c.period(), 0))
		z, w := polylineDeviation(c, res, ref)
		deviation = append(deviation, math.Max(z, w))
		gap = append(gap, res.Root.Closest-least)
	}
	t.Logf("deviation %v, closest gap %v", deviation, gap)
	if !(deviation[2] < deviation[1] && deviation[1] < deviation[0]) || gap[2] > gap[0] {
		t.Fatalf("deviation %v and closest gap %v do not fall with N", deviation, gap)
	}
}
