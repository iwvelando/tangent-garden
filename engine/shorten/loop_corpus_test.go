package shorten

import (
	"math"
	"math/cmplx"
	"sort"
	"testing"

	"tangentgarden/engine"
)

// #409's corpus of user loops: Fourier terms and outlines.

var exampleLeaf = []engine.Vec{
	{X: -1.9, Y: -1.35}, {X: -1.65, Y: -0.65}, {X: -1.7, Y: -0.3}, {X: -1.35, Y: -0.18},
	{X: -1.4, Y: 0.2}, {X: -0.98, Y: 0.27}, {X: -1.02, Y: 0.65}, {X: -0.57, Y: 0.66},
	{X: -0.55, Y: 1.02}, {X: -0.12, Y: 0.97}, {X: 0.05, Y: 1.34}, {X: 0.4, Y: 1.19},
	{X: 0.74, Y: 1.49}, {X: 1, Y: 1.3}, {X: 1.8, Y: 1.55}, {X: 1.55, Y: 0.8},
	{X: 1.69, Y: 0.5}, {X: 1.37, Y: 0.26}, {X: 1.5, Y: -0.05}, {X: 1.12, Y: -0.18},
	{X: 1.16, Y: -0.53}, {X: 0.74, Y: -0.53}, {X: 0.65, Y: -0.87}, {X: 0.22, Y: -0.71},
	{X: 0.03, Y: -1.03}, {X: -0.4, Y: -0.81}, {X: -0.62, Y: -1.07}, {X: -1.1, Y: -0.85},
	{X: -1.64, Y: -1.48},
}

// terms turns complex coefficients by frequency into Fourier terms.
func terms(c map[int]complex128) []engine.Term {
	fs := []int{}
	for f := range c {
		fs = append(fs, f)
	}
	sort.Ints(fs)
	out := []engine.Term{}
	for _, f := range fs {
		out = append(out, engine.Term{Frequency: float64(f), Radius: cmplx.Abs(c[f]), Phase: cmplx.Phase(c[f])})
	}
	return out
}

func leafTerms(t testing.TB, count int) []engine.Term {
	t.Helper()
	fit, err := engine.FitFourier(exampleLeaf, true)
	if err != nil {
		t.Fatal(err)
	}
	r, err := fit.Select(count)
	if err != nil {
		t.Fatal(err)
	}
	return r.Terms
}

func circleTerms(r float64, c complex128) []engine.Term {
	return terms(map[int]complex128{0: c, 1: complex(r, 0)})
}

func ellipseTerms(a, b float64) []engine.Term {
	return terms(map[int]complex128{1: complex((a+b)/2, 0), -1: complex((a-b)/2, 0)})
}

func rippleTerms(f int, eps float64) []engine.Term {
	return terms(map[int]complex128{1: 1, f + 1: complex(eps, 0)})
}

// nearCusp is e^{iu} + a e^{−2iu}: a deltoid's three cusps at a = 1/2.
func nearCusp(a float64) []engine.Term {
	return terms(map[int]complex128{1: 1, -2: complex(a, 0)})
}

// limacon is r = 1 + b cos u about the origin: an inner loop for b > 1.
func limacon(b float64) []engine.Term {
	return terms(map[int]complex128{0: complex(b/2, 0), 1: 1, 2: complex(b/2, 0)})
}

// cShape is a horseshoe outline: a tube of width w about the unit circle,
// open by a gap between its rounded ends, sampled every ds.
func cShape(gap, w, ds float64) []engine.Vec {
	g := math.Asin((gap + w) / 2)
	out := []engine.Vec{}
	arc := func(cx, cy, r, a0, a1 float64) {
		k := int(math.Ceil(math.Abs(a1-a0) * r / ds))
		for i := range k {
			a := a0 + (a1-a0)*float64(i)/float64(k)
			out = append(out, engine.Vec{X: cx + r*math.Cos(a), Y: cy + r*math.Sin(a)})
		}
	}
	arc(0, 0, 1+w/2, g, 2*math.Pi-g)
	arc(math.Cos(g), -math.Sin(g), w/2, -g, -g+math.Pi)
	arc(0, 0, 1-w/2, 2*math.Pi-g, g)
	arc(math.Cos(g), math.Sin(g), w/2, g+math.Pi, g+2*math.Pi)
	return out
}

func ellipseOutline(a, b float64, n int) []engine.Vec {
	out := make([]engine.Vec, n)
	for i := range n {
		u := 2 * math.Pi * float64(i) / float64(n)
		out[i] = engine.Vec{X: a * math.Cos(u), Y: b * math.Sin(u)}
	}
	return out
}

type corpusCase struct {
	name string
	loop Loop
}

func fourierCorpus(t testing.TB) []corpusCase {
	return []corpusCase{
		{"circle, off center", Loop{Terms: circleTerms(1, 3+2i)}},
		{"ellipse 2:1", Loop{Terms: ellipseTerms(2, 1)}},
		{"leaf, 4 terms", Loop{Terms: leafTerms(t, 4)}},
		{"leaf, 6 terms", Loop{Terms: leafTerms(t, 6)}},
		{"leaf, 8 terms", Loop{Terms: leafTerms(t, 8)}},
		{"leaf, 12 terms", Loop{Terms: leafTerms(t, 12)}},
		{"leaf, 16 terms", Loop{Terms: leafTerms(t, 16)}},
		{"ripple f=16 ε=0.02", Loop{Terms: rippleTerms(16, 0.02)}},
		{"ripple f=63 ε=0.001", Loop{Terms: rippleTerms(63, 0.001)}},
		{"ripple f=63 ε=0.004", Loop{Terms: rippleTerms(63, 0.004)}},
		{"near cusp a=0.3", Loop{Terms: nearCusp(0.3)}},
		{"near cusp a=0.45", Loop{Terms: nearCusp(0.45)}},
		{"near cusp a=0.49", Loop{Terms: nearCusp(0.49)}},
		{"near cusp a=0.499", Loop{Terms: nearCusp(0.499)}},
		{"cusp a=0.5", Loop{Terms: nearCusp(0.5)}},
		{"limaçon b=0.9", Loop{Terms: limacon(0.9)}},
		{"limaçon b=1.05 (tiny inner loop)", Loop{Terms: limacon(1.05)}},
		{"limaçon b=2 (inner loop)", Loop{Terms: limacon(2)}},
	}
}

func outlineCorpus() []corpusCase {
	square := []engine.Vec{{X: 0, Y: 0}, {X: 1, Y: 0}, {X: 1, Y: 1}, {X: 0, Y: 1}}
	collapsed := []engine.Vec{{X: 0, Y: 0}, {X: 1, Y: 0}, {X: 1, Y: 0}, {X: 1, Y: 1}, {X: 0, Y: 1}, {X: 0, Y: 0}}
	bowtie := []engine.Vec{{X: 0, Y: 0}, {X: 1, Y: 1}, {X: 1, Y: 0}, {X: 0, Y: 1}}
	// An open stroke, three quarters of a circle, closed by its straight
	// chord (Close outline's join).
	open := []engine.Vec{}
	for i := 0; i <= 96; i++ {
		a := 1.5 * math.Pi * float64(i) / 96
		open = append(open, engine.Vec{X: math.Cos(a), Y: math.Sin(a)})
	}
	return []corpusCase{
		{"outline: ellipse 2:1, 1,024 points", Loop{Points: ellipseOutline(2, 1, 1024)}},
		{"outline: ellipse 2:1, 64 points", Loop{Points: ellipseOutline(2, 1, 64)}},
		{"outline: example leaf (29 points)", Loop{Points: exampleLeaf}},
		{"outline: square", Loop{Points: square}},
		{"outline: square with a collapsed edge", Loop{Points: collapsed}},
		{"outline: bowtie", Loop{Points: bowtie}},
		{"outline: open stroke joined", Loop{Points: open}},
		{"outline: horseshoe, gap 0.05", Loop{Points: cShape(0.05, 0.3, 0.02)}},
		{"outline: horseshoe, gap 0.02", Loop{Points: cShape(0.02, 0.3, 0.02)}},
		{"outline: horseshoe, gap 0.01", Loop{Points: cShape(0.01, 0.3, 0.02)}},
		{"outline: horseshoe, gap 0.02, 1,289 points", Loop{Points: cShape(0.02, 0.3, 0.01)}},
	}
}
