package physical

import (
	"math"
	"math/cmplx"
	"testing"
)

// planArea is the area of the contoured plan, from its loops.
func planArea(c *Contours) float64 {
	a := 0.0
	for _, l := range c.Loops {
		a += Area(c.Points, l)
	}
	return a
}

func contourOf(t *testing.T, p Plan) *Contours {
	t.Helper()
	g, err := Sample(p, 0.2, 5, DefaultLimits)
	if err != nil {
		t.Fatal(err)
	}
	c, err := g.Contour(DefaultLimits)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

// A raised annulus on a plain plaque and a recessed one in a framed
// plaque: closed outward solids whose volume and upward faces are the
// plan's areas times the heights, and, against the exact fixture, within
// the contour's stated error.
func TestSolidifyRaisedAndRecessedFixtures(t *testing.T) {
	const R, segments = 30.0, 720
	plaque := float64(segments) / 2 * R * R * math.Sin(2*math.Pi/segments)
	ring := Plan{Strokes: Circle(0, 20, 1), Outer: R - 1}
	c := contourOf(t, ring)
	L := planArea(c)
	if math.Abs(L-4*math.Pi*20) > 0.01 {
		t.Fatalf("plan area %g", L)
	}
	raised, err := Solidify(c, Base{Radius: R, Segments: segments}, Levels{Plan: 3.5, Rest: 2})
	if err != nil {
		t.Fatal(err)
	}
	r := Check(raised, DefaultLimits)
	if !r.Valid() || r.Components != 1 {
		t.Fatalf("raised: %+v", r)
	}
	if want := plaque*2 + L*1.5; math.Abs(r.Volume-want) > 1e-9*want {
		t.Errorf("raised volume %.9f, want %.9f", r.Volume, want)
	}
	if math.Abs(r.Up[2]-(plaque-L)) > 1e-9*plaque || math.Abs(r.Up[3.5]-L) > 1e-9*L {
		t.Errorf("upward faces %v", r.Up)
	}
	if r.Max[2] != 3.5 || r.Min[2] != 0 || math.Abs(r.Max[0]-R) > 1e-12 {
		t.Errorf("bounds %v %v", r.Min, r.Max)
	}
	// Recessed, with the frame as the plaque's edge.
	framed := Plan{Strokes: Circle(0, 20, 1), Clip: 27, Frame: 3, Outer: 30}
	c = contourOf(t, framed)
	L = planArea(c)
	recessed, err := Solidify(c, Base{Radius: 30, Framed: true}, Levels{Plan: 2.5, Rest: 4})
	if err != nil {
		t.Fatal(err)
	}
	r = Check(recessed, DefaultLimits)
	if !r.Valid() || r.Components != 1 {
		t.Fatalf("recessed: %+v", r)
	}
	// The framed plaque's outline is the contour's outer loop.
	outer := 0.0
	for _, l := range c.Loops {
		outer = math.Max(outer, Area(c.Points, l))
	}
	if want := outer*4 - L*1.5; math.Abs(r.Volume-want) > 1e-9*want {
		t.Errorf("recessed volume %.9f, want %.9f", r.Volume, want)
	}
	exact := math.Pi*30*30*4 - (4*math.Pi*20+math.Pi*(30*30-27*27))*1.5
	if math.Abs(r.Volume-exact)/exact > 1e-3 {
		t.Errorf("recessed volume %.6f against the exact %.6f", r.Volume, exact)
	}
}

// Separate islands on a raised plaque are one body through the floor;
// recessed, each groove is a cavity of the one slab.
func TestSolidifyIslandsAndHoles(t *testing.T) {
	var strokes []Stroke
	for k := range 6 {
		c := cmplx.Rect(14, math.Pi*float64(k)/3)
		strokes = append(strokes, Circle(c, 3, 0.7)...)
		strokes = append(strokes, Stroke{A: c, B: c * 0.4, Straight: true, Half: 0.5})
	}
	c := contourOf(t, Plan{Strokes: strokes, Outer: 24})
	for _, lv := range []Levels{{Plan: 3, Rest: 1.6}, {Plan: 1.6, Rest: 3}} {
		m, err := Solidify(c, Base{Radius: 25, Segments: 400}, lv)
		if err != nil {
			t.Fatal(err)
		}
		r := Check(m, DefaultLimits)
		if !r.Valid() || r.Components != 1 {
			t.Errorf("%+v: %+v", lv, r)
		}
	}
}

func TestSolidifyRefusesTriangleCeiling(t *testing.T) {
	c := contourOf(t, Plan{Strokes: Circle(0, 20, 1), Outer: 29})
	lim := DefaultLimits
	lim.Triangles = 100
	if _, err := SolidifyWithin(c, Base{Radius: 30, Segments: 400}, Levels{Plan: 3, Rest: 2}, lim); err == nil {
		t.Error("triangle ceiling not enforced")
	}
}
