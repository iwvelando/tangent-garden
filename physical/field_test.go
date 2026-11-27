package physical

import (
	"math"
	"math/cmplx"
	"testing"
)

// The fixtures' exact areas: an annulus from a whole circle's band, a
// stadium from a segment's and a frame alone.
func TestContourAreasMatchExactFixtures(t *testing.T) {
	const h = 0.2
	cases := []struct {
		name  string
		plan  Plan
		area  float64
		loops int
		// The boundary's curved length over its radius, Σ ℓ/ρ, and its
		// whole length.
		bend, length float64
	}{
		{"annulus", Plan{Strokes: Circle(0, 20, 1), Outer: 30}, 4 * math.Pi * 20 * 1, 2,
			4 * math.Pi, 2 * math.Pi * 40},
		{"stadium", Plan{Strokes: []Stroke{{A: -15, B: 10 + 5i, Straight: true, Half: 1.5}}, Outer: 30},
			2*1.5*cmplx.Abs(25+5i) + math.Pi*1.5*1.5, 1, 2 * math.Pi, 2*cmplx.Abs(25+5i) + 3*math.Pi},
		{"frame", Plan{Clip: 25, Frame: 3, Outer: 28}, math.Pi * (28*28 - 25*25), 2,
			4 * math.Pi, 2 * math.Pi * 53},
	}
	for _, c := range cases {
		g, err := Sample(c.plan, h, 5, DefaultLimits)
		if err != nil {
			t.Fatal(err)
		}
		cs, err := g.Contour(DefaultLimits)
		if err != nil {
			t.Fatal(err)
		}
		if len(cs.Loops) != c.loops {
			t.Fatalf("%s: %d loops, want %d", c.name, len(cs.Loops), c.loops)
		}
		area := 0.0
		for _, l := range cs.Loops {
			area += Area(cs.Points, l)
		}
		// Chords at most √2·h long inscribed in a curve of radius ρ lose
		// at most h²/(6ρ) of area per unit length, and the snap moves the
		// boundary by at most snap·h.
		bound := c.bend*h*h/6 + c.length*snap*h
		if d := math.Abs(area - c.area); d > bound {
			t.Errorf("%s: area %.6f, want %.6f within %.4f", c.name, area, c.area, bound)
		}
		t.Logf("%s: area %.6f exact %.6f, %d vertices", c.name, area, c.area, len(cs.Points))
	}
}

// Every contour vertex lies on the exact boundary within the stated
// approximation error, measured in millimeters with the exact field.
func TestContourVerticesLieOnTheBoundary(t *testing.T) {
	const h = 0.2
	strokes := append(Circle(3, 12, 0.8), Stroke{A: -20 - 4i, B: 18 + 9i, Straight: true, Half: 1},
		Stroke{A: -10i, B: 10i, C: -12, R: math.Sqrt(244), Half: 1.2})
	p := Plan{Strokes: strokes, Clip: 22, Frame: 2, Outer: 24}
	g, err := Sample(p, h, 5, DefaultLimits)
	if err != nil {
		t.Fatal(err)
	}
	cs, err := g.Contour(DefaultLimits)
	if err != nil {
		t.Fatal(err)
	}
	worst := 0.0
	for _, x := range cs.Points {
		worst = math.Max(worst, math.Abs(exactField(p, x)))
	}
	t.Logf("worst boundary error %.5f mm at grid %.2f mm over %d vertices", worst, h, len(cs.Points))
	// Smooth pieces are far closer; the bound is set by the creases where
	// bands cross, which a chord cuts by at most about h/2.
	if worst > h/2 {
		t.Errorf("a vertex lies %.4f mm from the boundary", worst)
	}
	if n := crossings(cs); n != 0 {
		t.Errorf("%d pairs of contour edges cross", n)
	}
}

// The field at the snap: a node value within snap·h of zero is pushed out
// keeping its sign, so no vertex sits on a node.
func TestContourKeepsVerticesOffNodes(t *testing.T) {
	const h = 0.25
	// A circle of radius exactly 10 has nodes on its band's edge.
	p := Plan{Strokes: Circle(0, 10, 1), Outer: 20}
	g, err := Sample(p, h, 5, DefaultLimits)
	if err != nil {
		t.Fatal(err)
	}
	for k, v := range g.F {
		if math.Abs(v) < snap*h*(1-1e-12) {
			t.Fatalf("node %d holds %g", k, v)
		}
	}
	cs, _ := g.Contour(DefaultLimits)
	for _, x := range cs.Points {
		i, j := (real(x)-g.X0)/h, (imag(x)-g.Y0)/h
		di, dj := math.Abs(i-math.Round(i)), math.Abs(j-math.Round(j))
		if di < snap/2 && dj < snap/2 {
			t.Fatalf("vertex %v on a node", x)
		}
	}
}

func TestSampleRefusesPastCeilings(t *testing.T) {
	p := Plan{Strokes: Circle(0, 10, 1), Outer: 20}
	lim := DefaultLimits
	lim.Nodes = 1000
	if _, err := Sample(p, 0.2, 5, lim); err == nil {
		t.Error("node ceiling not enforced")
	}
	lim = DefaultLimits
	lim.Evaluations = 100
	if _, err := Sample(p, 0.2, 5, lim); err == nil {
		t.Error("evaluation ceiling not enforced")
	}
	lim = DefaultLimits
	lim.Strokes = 2
	if _, err := Sample(p, 0.2, 5, lim); err == nil {
		t.Error("stroke ceiling not enforced")
	}
}

// Distances to arcs against dense samples of the arc.
func TestStrokeDistanceAgainstSamples(t *testing.T) {
	arcs := []Stroke{
		{A: 5, B: 5i, C: 0, R: 5},
		{A: 5i, B: 5, C: 0, R: 5},
		{A: -3 + 1i, B: 4 - 2i, C: 1 + 6i, R: cmplx.Abs(-4 - 5i)},
		{A: 1, B: 2 + 3i, Straight: true},
	}
	arcs[2].B = arcs[2].C + cmplx.Rect(arcs[2].R, cmplx.Phase(4-2i-arcs[2].C))
	for n, s := range arcs {
		pts := sampleStroke(s, 20000)
		for k := range 400 {
			x := complex(math.Sin(float64(k)*1.7)*9, math.Cos(float64(k)*2.3)*9)
			want := math.Inf(1)
			for _, p := range pts {
				want = math.Min(want, cmplx.Abs(x-p))
			}
			if d := s.Distance(x); math.Abs(d-want) > 2e-3 || d > want+1e-12 {
				t.Fatalf("stroke %d at %v: %g, sampled %g", n, x, d, want)
			}
		}
	}
}

func sampleStroke(s Stroke, n int) []complex128 {
	out := make([]complex128, n+1)
	if s.Straight {
		for k := range out {
			out[k] = s.A + complex(float64(k)/float64(n), 0)*(s.B-s.A)
		}
		return out
	}
	turn := cmplx.Phase((s.B - s.C) / (s.A - s.C))
	for k := range out {
		out[k] = s.C + (s.A-s.C)*cmplx.Rect(1, turn*float64(k)/float64(n))
	}
	return out
}

// exactField is the plan's field without cap or snap, for checks.
func exactField(p Plan, x complex128) float64 {
	v := math.Inf(1)
	for _, s := range p.Strokes {
		v = math.Min(v, s.Distance(x)-s.Half)
	}
	r := cmplx.Abs(x)
	if p.Clip > 0 {
		v = math.Max(v, r-p.Clip)
	}
	if p.Frame > 0 {
		v = math.Min(v, math.Abs(r-p.Clip-p.Frame/2)-p.Frame/2)
	}
	return math.Max(v, r-p.Outer)
}

// crossings counts pairs of contour edges that cross away from shared ends.
func crossings(cs *Contours) int {
	type edge struct{ a, b int32 }
	var es []edge
	for _, l := range cs.Loops {
		for k := range l {
			es = append(es, edge{l[k], l[(k+1)%len(l)]})
		}
	}
	n := 0
	for i := range es {
		for j := i + 1; j < len(es); j++ {
			e, f := es[i], es[j]
			if e.a == f.a || e.a == f.b || e.b == f.a || e.b == f.b {
				continue
			}
			if segmentsCross(cs.Points[e.a], cs.Points[e.b], cs.Points[f.a], cs.Points[f.b]) {
				n++
			}
		}
	}
	return n
}

func segmentsCross(a, b, c, d complex128) bool {
	d1, d2 := cross(b-a, c-a), cross(b-a, d-a)
	d3, d4 := cross(d-c, a-c), cross(d-c, b-c)
	return d1*d2 < 0 && d3*d4 < 0
}
