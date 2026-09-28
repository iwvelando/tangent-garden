package engine3

import (
	"encoding/json"
	"math"
	"testing"
)

func inverted(t *testing.T, c Request) Result {
	t.Helper()
	r, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	q := r.Inversion
	if q == nil {
		t.Fatal("missing inversion")
	}
	if _, err := json.Marshal(r); err != nil {
		t.Fatal(err)
	}
	if len(r.Mesh)+len(r.Rulings)+len(r.Minus)+len(r.Plus) != 0 || r.Involute != nil || r.Projection != nil {
		t.Fatal("unrelated construction geometry")
	}
	if len(q.Points) != c.Samples+1 || len(q.Source) != c.Samples+1 || len(q.Breaks) != c.Samples+1 {
		t.Fatal("inversion shape")
	}
	for i, p := range q.Points {
		if p != nil && q.Source[i] == nil {
			t.Fatal("image without a source point")
		}
		if r.Breaks[i] && !q.Breaks[i] {
			t.Fatal("base break lost in the image")
		}
	}
	return r
}

func inversionStudy(x, y, z string, lo, hi float64, center Vec3, radius float64) Request {
	c := custom(x, y, z, lo, hi)
	c.Construction = "inversion"
	c.Inversion = InversionRequest{Center: center, Radius: radius, Input: "base"}
	return c
}

func breaks(b []bool) (out []int) {
	for i, v := range b {
		if v {
			out = append(out, i)
		}
	}
	return out
}

func TestInvertIsAnInvolution(t *testing.T) {
	o := Vec3{0.3, -1.2, 2}
	for _, p := range []Vec3{{1, 2, 3}, {-4, 0.5, 2.2}, {0.30001, -1.2, 2}, {1e4, -3e3, 7}} {
		near(t, invert(o, 1.7, invert(o, 1.7, p)), p, 1e-9*(1+p.norm()))
	}
	near(t, invert(o, 1.7, o.add(Vec3{0, 1.7, 0})), o.add(Vec3{0, 1.7, 0}), 1e-15)
}

func TestSphereInversionIdentities(t *testing.T) {
	c := study()
	c.Construction = "inversion"
	c.Inversion = InversionRequest{Center: Vec3{0.3, -0.2, 0.5}, Radius: 1.7, Input: "base"}
	r := inverted(t, c)
	q := r.Inversion
	if q.Invalid != 0 || q.Crossings != 0 || q.Collapsed || len(q.Correspondences) != c.Lines || len(breaks(q.Breaks)) != 0 {
		t.Fatalf("regular knot inversion: %+v", q.Crossings)
	}
	near(t, q.Center, c.Inversion.Center, 0)
	if q.Radius != 1.7 || q.Input != "base" || q.Pole != nil {
		t.Fatal("inversion sphere not echoed")
	}
	near(t, q.Points[0], *q.Points[c.Samples], 0)
	o := c.Inversion.Center
	for i, j := range q.Points {
		x, _, _ := knot(c, 2*math.Pi*float64(i)/float64(c.Samples))
		near(t, q.Source[i], x, 1e-12)
		a, b := x.sub(o), j.sub(o)
		// J lies on the ray from O through X, with |OJ||OX| = R².
		if a.cross(b).norm() > 1e-12*a.norm()*b.norm() || a.dot(b) <= 0 || math.Abs(a.norm()*b.norm()-1.7*1.7) > 1e-12 {
			t.Fatal("image off the inversion ray")
		}
	}
	for _, s := range q.Correspondences {
		near(t, s.Source, *q.Source[s.SampleIndex], 0)
		near(t, s.Image, *q.Points[s.SampleIndex], 0)
	}
}

func TestSphereInversionCirclesAndLines(t *testing.T) {
	type sphere struct {
		center Vec3
		radius float64
		plane  Vec3 // unit normal, offset measured from the origin
		offset float64
	}
	for _, k := range []struct {
		name      string
		x, y, z   string
		lo, hi    float64
		center    Vec3
		radius    float64
		want      sphere
		crossings int
	}{
		// A line missing O becomes a circle through O.
		{"line", "t", "1", "0", -3, 3, Vec3{}, 1, sphere{Vec3{0, 0.5, 0}, 0.5, Vec3{0, 0, 1}, 0}, 0},
		// A circle missing O becomes a circle in the same plane.
		{"circle", "3+cos(t)", "sin(t)", "0", 0, 2 * math.Pi, Vec3{}, 2, sphere{Vec3{1.5, 0, 0}, 0.5, Vec3{0, 0, 1}, 0}, 0},
		// A circle off O's plane still becomes a circle.
		{"lifted circle", "cos(t)", "sin(t)", "1", 0, 2 * math.Pi, Vec3{}, 1, sphere{Vec3{0, 0, 0.5}, 0.5, Vec3{0, 0, 1}, 0.5}, 0},
	} {
		c := inversionStudy(k.x, k.y, k.z, k.lo, k.hi, k.center, k.radius)
		r := inverted(t, c)
		q := r.Inversion
		if q.Crossings != k.crossings || q.Invalid != 0 {
			t.Fatal(k.name, "crossings", q.Crossings, "invalid", q.Invalid)
		}
		for _, p := range q.Points {
			if math.Abs(p.sub(k.want.center).norm()-k.want.radius) > 1e-10 || math.Abs(p.dot(k.want.plane)-k.want.offset) > 1e-10 {
				t.Fatal(k.name, "image off its analytic circle", p)
			}
		}
	}
	// A circle through O becomes a line; O falls between samples, so the two
	// ends running to infinity must not be joined.
	c := inversionStudy("1+cos(t)", "sin(t)", "0", 0, 2*math.Pi+0.01, Vec3{}, 1)
	q := inverted(t, c).Inversion
	if q.Crossings != 1 || q.Invalid != 0 {
		t.Fatal("circle through the center", q.Crossings, q.Invalid)
	}
	if b := breaks(q.Breaks); len(b) != 1 || b[0] != 240 {
		t.Fatal("expected one break at the center passage", b)
	}
	for _, p := range q.Points {
		if math.Abs(p.X-0.5) > 1e-9 || p.Z != 0 {
			t.Fatal("image of a circle through O is not the line x = R²/2", p)
		}
	}
	// A line through O between samples inverts to itself, split at infinity.
	c = inversionStudy("t", "2*t", "-t", -1, 1.1, Vec3{}, 1)
	q = inverted(t, c).Inversion
	if b := breaks(q.Breaks); len(b) != 1 || b[0] != 229 || q.Crossings != 1 {
		t.Fatal("line through the center", b, q.Crossings)
	}
	for _, p := range q.Points {
		if p.cross(Vec3{1, 2, -1}).norm() > 1e-9*p.norm() {
			t.Fatal("line through O left its line")
		}
	}
	// A sample exactly at O has no image; one just beside it exceeds the guard.
	for _, x := range []string{"t", "t+1e-13"} {
		c = inversionStudy(x, "0", "0", -1, 1, Vec3{}, 1)
		q = inverted(t, c).Inversion
		if q.Points[240] != nil || q.Points[239] == nil || q.Points[241] == nil || q.Invalid != 1 {
			t.Fatal("center sample must be a gap", x, q.Invalid)
		}
	}
}

func TestSphereInversionRecoversItsSource(t *testing.T) {
	// The image of (cos t, sin t, 1) in the unit sphere is half of it; inverting
	// that image again must recover the original circle.
	c := inversionStudy("cos(t)/2", "sin(t)/2", "1/2", 0, 2*math.Pi, Vec3{}, 1)
	q := inverted(t, c).Inversion
	for i, p := range q.Points {
		u := 2 * math.Pi * float64(i) / float64(c.Samples)
		near(t, p, Vec3{math.Cos(u), math.Sin(u), 1}, 1e-12)
	}
}

func TestSphereInversionMotionScaleAndReparameterization(t *testing.T) {
	c := inversionStudy("2*cos(t)", "sin(t)", "t/2", 0, 5, Vec3{1, -2, 0.4}, 1.3)
	a := inverted(t, c).Inversion
	motion := func(v Vec3) Vec3 { return Vec3{-v.Y + 3, v.X - 1, v.Z + 2} }
	c.Curve.X, c.Curve.Y, c.Curve.Z = "-sin(t)+3", "2*cos(t)-1", "t/2+2"
	c.Inversion.Center = motion(c.Inversion.Center)
	b := inverted(t, c).Inversion
	for i, p := range a.Points {
		near(t, b.Points[i], motion(*p), 1e-9)
	}
	c.Curve.X, c.Curve.Y, c.Curve.Z = "-sin(5-t)+3", "2*cos(5-t)-1", "(5-t)/2+2"
	reverse := inverted(t, c).Inversion
	for i, p := range b.Points {
		near(t, reverse.Points[c.Samples-i], *p, 1e-9)
	}
	// Scaling the curve, center, and radius together scales the image.
	c = inversionStudy("4*cos(t)", "2*sin(t)", "t", 0, 5, Vec3{2, -4, 0.8}, 2.6)
	scaled := inverted(t, c).Inversion
	for i, p := range a.Points {
		near(t, scaled.Points[i], p.mul(2), 1e-9)
	}
}

func TestSphereInversionOfDerivedPaths(t *testing.T) {
	for _, kind := range []string{"tangent-foot", "orthotomic"} {
		c := custom("2*cos(t)", "2*sin(t)", "t/3", -math.Pi, math.Pi)
		c.Pole = Vec3{1, -2, 3}
		c.Construction = kind
		projection := projected(t, c)
		c.Construction = "inversion"
		c.Inversion = InversionRequest{Center: Vec3{0.2, 0.1, -0.4}, Radius: 2.2, Input: kind}
		q := inverted(t, c).Inversion
		if q.Pole == nil || *q.Pole != c.Pole {
			t.Fatal("derived inversion must report its pole")
		}
		for i, p := range q.Points {
			near(t, q.Source[i], *projection.Projection.Points[i], 0)
			near(t, p, invert(c.Inversion.Center, 2.2, *q.Source[i]), 0)
		}
		// A line's tangent feet are one point, so its image collapses too.
		c = custom("t", "2*t+4", "-3*t+8", -1, 1)
		c.Pole = Vec3{1, -2, 3}
		c.Construction = "inversion"
		c.Inversion = InversionRequest{Center: Vec3{0, 0, 1}, Radius: 2, Input: kind}
		q = inverted(t, c).Inversion
		if !q.Collapsed || q.Crossings != 0 || len(breaks(q.Breaks)) != 0 {
			t.Fatal("collapsed derived image", q.Collapsed, q.Crossings)
		}
	}
	// A finite base whose orthotomic exceeds the coordinate guard has no source
	// point there, and so no image.
	big := custom("999999999999+t", "999999999999+t", "t", 0, 0.1)
	big.Construction = "inversion"
	big.Inversion = InversionRequest{Radius: 1, Input: "orthotomic"}
	if q := inverted(t, big).Inversion; q.Invalid == 0 || q.Source[0] != nil || q.Points[0] != nil {
		t.Fatal("oversized derived source not counted", q.Invalid)
	}
	// Gaps in the base remain gaps in a derived image.
	c := custom("1/t", "t^3", "t^2", -1, 1)
	c.Pole = Vec3{1, 2, 3}
	c.Construction = "inversion"
	c.Inversion = InversionRequest{Center: Vec3{5, 5, 5}, Radius: 1, Input: "tangent-foot"}
	r := inverted(t, c)
	if len(breaks(r.Inversion.Breaks)) == 0 || r.Inversion.Points[0] == nil || r.Inversion.Points[c.Samples] == nil {
		t.Fatal("derived inversion lost or joined a base gap")
	}
}

func TestSphereInversionBounds(t *testing.T) {
	// A tiny curve around O becomes an enormous one; a distant curve collapses
	// toward O. Each must stay framed.
	r := inverted(t, inversionStudy("0.001*cos(t)", "0.001*sin(t)", "0", 0, 2*math.Pi, Vec3{}, 1))
	if r.Bounds.Radius < 500 {
		t.Fatal("short base hid a large image", r.Bounds.Radius)
	}
	r = inverted(t, inversionStudy("100+cos(t)", "sin(t)", "0", 0, 2*math.Pi, Vec3{}, 1))
	if r.Bounds.Center.sub(Vec3{}).norm() > r.Bounds.Radius {
		t.Fatal("center and image dropped from the frame")
	}
}

func TestSphereInversionValidation(t *testing.T) {
	for _, q := range []InversionRequest{
		{Radius: 0, Input: "base"},
		{Radius: -1, Input: "base"},
		{Radius: math.NaN(), Input: "base"},
		{Radius: math.Inf(1), Input: "base"},
		{Radius: 100001, Input: "base"},
		{Center: Vec3{math.NaN(), 0, 0}, Radius: 1, Input: "base"},
		{Center: Vec3{0, 0, -100001}, Radius: 1, Input: "base"},
		{Radius: 1, Input: "involute"},
		{Radius: 1, Input: ""},
	} {
		c := study()
		c.Construction = "inversion"
		c.Inversion = q
		if _, err := Compute(c); err == nil {
			t.Fatal("invalid inversion accepted", q)
		}
	}
	c := study()
	c.Construction = "inversion"
	c.Inversion = InversionRequest{Center: Vec3{1e5, -1e5, 1e5}, Radius: 1e5, Input: "base"}
	c.Pole = Vec3{math.NaN(), 0, 0} // unused for the base input
	inverted(t, c)
	c.Inversion.Input = "orthotomic"
	if _, err := Compute(c); err == nil {
		t.Fatal("derived input accepted an invalid pole")
	}
}
