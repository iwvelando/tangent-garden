package engine3

import (
	"encoding/json"
	"math"
	"tangentgarden/engine"
	"testing"
)

func projected(t *testing.T, c Request) Result {
	t.Helper()
	r, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	if r.Projection == nil {
		t.Fatal("missing projection")
	}
	if _, err := json.Marshal(r); err != nil {
		t.Fatal(err)
	}
	if len(r.Mesh)+len(r.Rulings)+len(r.Minus)+len(r.Plus) != 0 || r.Involute != nil {
		t.Fatal("unrelated construction geometry")
	}
	return r
}

func TestSpatialProjectionIdentities(t *testing.T) {
	for _, kind := range []string{"tangent-foot", "orthotomic"} {
		c := study()
		c.Construction = kind
		c.Pole = Vec3{1.2, -0.7, 2.1}
		r := projected(t, c)
		q := r.Projection
		if len(q.Points) != c.Samples+1 || len(q.Constructions) != c.Lines || q.Invalid != 0 || q.Collapsed {
			t.Fatal("projection shape")
		}
		near(t, q.Points[0], *q.Points[c.Samples], 0)
		for i, h := range q.Feet {
			base, v, _ := knot(c, 2*math.Pi*float64(i)/float64(c.Samples))
			tangent := v.unit()
			if h.sub(base).cross(tangent).norm() > 1e-11 || math.Abs(c.Pole.sub(*h).dot(tangent)) > 1e-11 {
				t.Fatal("foot is not a perpendicular tangent projection")
			}
			if kind == "tangent-foot" {
				near(t, q.Points[i], *h, 0)
				continue
			}
			image := q.Points[i]
			near(t, h, image.add(c.Pole).mul(0.5), 1e-12)
			if math.Abs(image.sub(base).norm()-c.Pole.sub(base).norm()) > 1e-11 {
				t.Fatal("half-turn changed distance to contact")
			}
			// Rotate P-r by pi around the analytic tangent using Rodrigues' formula.
			d := c.Pole.sub(base)
			near(t, image, base.add(tangent.mul(2*d.dot(tangent))).sub(d), 1e-11)
		}
		for _, s := range q.Constructions {
			near(t, &s.Contact, *r.Base[s.SampleIndex], 0)
			near(t, &s.Foot, *q.Feet[s.SampleIndex], 0)
			near(t, &s.Image, *q.Points[s.SampleIndex], 0)
		}
	}
}

func TestSpatialProjectionPlanarReductionAndCircle(t *testing.T) {
	for _, kind := range []string{"tangent-foot", "orthotomic"} {
		for _, pole := range []Vec3{{}, {1, 0, 0}, {0.3, -0.7, 0}} {
			c := custom("cos(t)", "sin(t)", "0", 0, 2*math.Pi)
			c.Construction = kind
			c.Pole = pole
			c.Samples = 500
			r := projected(t, c)
			planarKind := kind
			if kind == "tangent-foot" {
				planarKind = "pedal"
			}
			want, err := engine.Compute(engine.Request{Kind: planarKind, Curve: engine.Curve{Format: "parametric", X: "cos(t)", Y: "sin(t)", Min: 0, Max: 2 * math.Pi}, Pole: engine.Vec{X: pole.X, Y: pole.Y}, Samples: 501, Lines: 25})
			if err != nil {
				t.Fatal(err)
			}
			for i, p := range r.Projection.Points {
				near(t, p, Vec3{want.Derived[i].X, want.Derived[i].Y, 0}, 1e-9)
				if pole == (Vec3{}) {
					radius := 1.0
					if kind == "orthotomic" {
						radius = 2
					}
					if math.Abs(p.norm()-radius) > 1e-10 {
						t.Fatal("centered circle image")
					}
				}
			}
			if pole.X == 1 {
				near(t, r.Projection.Points[0], pole, 1e-10)
			} // A pole on the curve stays, including the image cusp.
		}
	}
}

func TestSpatialProjectionLinesAndMotion(t *testing.T) {
	for _, kind := range []string{"tangent-foot", "orthotomic"} {
		c := custom("t", "2*t+4", "-3*t+8", -1, 1)
		c.Construction = kind
		c.Pole = Vec3{1, -2, 3}
		c.Length = math.NaN()
		r := projected(t, c)
		if !r.Projection.Collapsed {
			t.Fatal("line image not reported as a point")
		}
		h := Vec3{0, 4, 8}.add(Vec3{1, 2, -3}.mul(4.0 / 14))
		want := h
		if kind == "orthotomic" {
			want = h.mul(2).sub(c.Pole)
		}
		for _, p := range r.Projection.Points {
			near(t, p, want, 1e-8)
		}
		c = custom("2*cos(t)", "sin(t)", "t/2", 0, 5)
		c.Construction = kind
		c.Pole = Vec3{1, -2, 0.4}
		a := projected(t, c)
		motion := func(v Vec3) Vec3 { return Vec3{-v.Y + 3, v.X - 1, v.Z + 2} }
		c.Curve.X = "-sin(t)+3"
		c.Curve.Y = "2*cos(t)-1"
		c.Curve.Z = "t/2+2"
		c.Pole = motion(c.Pole)
		b := projected(t, c)
		for i, p := range a.Projection.Points {
			near(t, b.Projection.Points[i], motion(*p), 1e-8)
		}
		// Reversing the parameter reverses T but must preserve its tangent line.
		c.Curve.X = "-sin(5-t)+3"
		c.Curve.Y = "2*cos(5-t)-1"
		c.Curve.Z = "(5-t)/2+2"
		reverse := projected(t, c)
		for i, p := range b.Projection.Points {
			near(t, reverse.Projection.Points[c.Samples-i], *p, 1e-8)
		}
	}
}

func TestSpatialProjectionGapsAndBounds(t *testing.T) {
	for _, kind := range []string{"tangent-foot", "orthotomic"} {
		for _, x := range []string{"1/t", "1/(t-0.00317)", "t^2"} {
			c := custom(x, "t^3", "t^2", -1, 1)
			c.Construction = kind
			c.Pole = Vec3{1, 2, 3}
			c.Samples = 480
			r := projected(t, c)
			broken := false
			for i, p := range r.Base {
				if p == nil && r.Projection.Points[i] != nil {
					t.Fatal("invalid tangent gained image")
				}
				broken = broken || r.Breaks[i]
			}
			if !broken {
				t.Fatal("singularity not broken")
			}
			if r.Projection.Points[0] == nil || r.Projection.Points[c.Samples] == nil {
				t.Fatal("projection failed to resume after gap")
			}
		}
		c := custom("t", "0", "0", 0, 0.001)
		c.Construction = kind
		c.Pole = Vec3{100, 50, -30}
		r := projected(t, c)
		if r.Bounds.Radius < 50 {
			t.Fatal("short base hid distant pole/image")
		}
		// Base can remain finite while the reflected image exceeds the coordinate guard.
		c = custom("999999999999+t", "999999999999+t", "t", 0, 0.1)
		c.Construction = kind
		r = projected(t, c)
		if kind == "orthotomic" && r.Projection.Invalid == 0 {
			t.Fatal("oversized images not counted")
		}
	}
}

func TestSpatialProjectionValidation(t *testing.T) {
	for _, pole := range []Vec3{{math.NaN(), 0, 0}, {0, math.Inf(1), 0}, {0, 0, math.Inf(-1)}, {100001, 0, 0}, {0, -100001, 0}, {0, 0, 100001}} {
		c := study()
		c.Construction = "tangent-foot"
		c.Pole = pole
		if _, err := Compute(c); err == nil {
			t.Fatal("invalid pole accepted", pole)
		}
	}
	c := study()
	c.Construction = "orthotomic"
	c.Pole = Vec3{1e5, -1e5, 1e5}
	projected(t, c)
}
