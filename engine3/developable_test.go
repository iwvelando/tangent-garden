package engine3

import (
	"encoding/json"
	"math"
	"testing"
)

func study() Request {
	return Request{Radius: 2.4, Tube: 0.85, Length: 2.3, P: 2, Q: 3, Samples: 480, Lines: 96}
}
func near(t *testing.T, a, b any, tol float64) {
	value := func(v any) Vec3 {
		switch p := v.(type) {
		case Vec3:
			return p
		case *Vec3:
			return *p
		}
		panic("not a vector")
	}
	got, want := value(a), value(b)
	t.Helper()
	if got.sub(want).norm() > tol {
		t.Fatalf("got %+v want %+v (tolerance %g)", got, want, tol)
	}
}
func TestAnalyticDerivatives(t *testing.T) {
	c := study()
	for _, u := range []float64{0, 0.37, 1.9, math.Pi, 2 * math.Pi} {
		r, v, a := knot(c, u)
		h := 1e-5
		left, _, _ := knot(c, u-h)
		right, _, _ := knot(c, u+h)
		near(t, v, right.sub(left).mul(1/(2*h)), 2e-8)
		near(t, a, right.add(left).sub(r.mul(2)).mul(1/(h*h)), 5e-5)
		// Independent torus equation and speed formula.
		radial := math.Hypot(r.X, r.Y) - c.Radius
		if math.Abs(radial*radial+r.Z*r.Z-c.Tube*c.Tube) > 1e-12 {
			t.Fatal("point off torus")
		}
		speed2 := float64(c.P*c.P)*math.Pow(c.Radius+c.Tube*math.Cos(float64(c.Q)*u), 2) + c.Tube*c.Tube*float64(c.Q*c.Q)
		if math.Abs(v.dot(v)-speed2) > 1e-10 {
			t.Fatal("incorrect speed")
		}
	}
}
func TestDevelopableGeometry(t *testing.T) {
	c := study()
	r, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Base) != c.Samples+1 || len(corners(r.Mesh)) != 12*c.Samples || len(r.Rulings) != c.Lines || r.Omitted != 0 {
		t.Fatal("unexpected counts")
	}
	near(t, r.Base[0], r.Base[c.Samples], 0)
	near(t, r.Minus[0], r.Minus[c.Samples], 0)
	near(t, r.Plus[0], r.Plus[c.Samples], 0)
	mesh := corners(r.Mesh)
	for i := 0; i < c.Samples; i++ {
		u := float64(i) * 2 * math.Pi / float64(c.Samples)
		point, v, a := knot(c, u)
		left, right := r.Minus[i].sub(point), r.Plus[i].sub(point)
		near(t, left.add(right), Vec3{}, 1e-12)
		if math.Abs(right.norm()-c.Length) > 1e-12 || right.cross(v).norm() > 1e-11 {
			t.Fatal("ruling is not a tangent of fixed length")
		}
		// N is constant along each ruling and perpendicular to both derivatives:
		// S_u=T; S_t=v+u T′. Thus these are developable sheets, not a tube.
		normal := mesh[i*12].Normal
		if math.Abs(normal.dot(v)) > 1e-11 || math.Abs(normal.dot(a)) > 1e-11 || math.Abs(normal.norm()-1) > 1e-12 {
			t.Fatal("wrong sheet normal")
		}
		near(t, mesh[i*12+6].Normal, normal.mul(-1), 1e-12)
		for _, vertex := range mesh[i*12 : i*12+12] {
			if vertex.Position.sub(r.Bounds.Center).norm() > r.Radius {
				t.Fatal("bounding sphere missed geometry")
			}
		}
	}
	if _, err := json.Marshal(r); err != nil {
		t.Fatal("nonfinite transport", err)
	}
}
func TestMeshConvergence(t *testing.T) {
	c := study()
	deviation := func(n int) float64 {
		c.Samples = n
		r, err := Compute(c)
		if err != nil {
			t.Fatal(err)
		}
		max := 0.0
		for i := 0; i < n; i++ {
			point, v, _ := knot(c, (float64(i)+0.5)*2*math.Pi/float64(n))
			exact := point.add(v.unit().mul(c.Length))
			linear := r.Plus[i].add(*r.Plus[i+1]).mul(0.5)
			max = math.Max(max, linear.sub(exact).norm())
		}
		return max
	}
	coarse, fine := deviation(240), deviation(960)
	if fine >= coarse/12 {
		t.Fatalf("expected quadratic chord convergence: %g -> %g", coarse, fine)
	}
}
func TestInvalidAndBounded(t *testing.T) {
	cases := []func(*Request){
		func(c *Request) { c.Radius = math.NaN() }, func(c *Request) { c.Tube = math.Inf(1) }, func(c *Request) { c.Length = math.Inf(-1) },
		func(c *Request) { c.Radius = 0 }, func(c *Request) { c.Radius = 21 }, func(c *Request) { c.Tube = c.Radius }, func(c *Request) { c.Tube = 0 },
		func(c *Request) { c.Length = 0 }, func(c *Request) { c.Length = 21 }, func(c *Request) { c.P = 0 }, func(c *Request) { c.Q = 10 },
		func(c *Request) { c.P = 4; c.Q = 6 }, func(c *Request) { c.Samples = 239 }, func(c *Request) { c.Samples = 2401 }, func(c *Request) { c.Lines = 11 }, func(c *Request) { c.Lines = 241 },
	}
	for i, change := range cases {
		c := study()
		change(&c)
		if _, err := Compute(c); err == nil {
			t.Errorf("case %d accepted", i)
		}
	}
	for _, pair := range [][2]int{{2, 3}, {2, 5}, {3, 4}, {8, 9}} {
		c := study()
		c.P = pair[0]
		c.Q = pair[1]
		c.Samples = 2400
		c.Lines = 240
		r, err := Compute(c)
		if err != nil {
			t.Fatal(err)
		}
		if len(corners(r.Mesh)) > 28800 {
			t.Fatal("unbounded mesh")
		}
		if _, err = json.Marshal(r); err != nil {
			t.Fatal(err)
		}
	}
}
func TestZeroCurvatureGap(t *testing.T) {
	c := study()
	c.Radius = 2
	c.Tube = 0.8
	c.P = 2
	c.Q = 3
	// At qt=pi, curvature vanishes when r=R*p²/(p²+q²).
	c.Tube = c.Radius * float64(c.P*c.P) / float64(c.P*c.P+c.Q*c.Q)
	r, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	if r.Omitted == 0 || len(corners(r.Mesh)) >= 12*c.Samples {
		t.Fatal("undefined normal did not leave a mesh gap")
	}
	if _, err = json.Marshal(r); err != nil {
		t.Fatal(err)
	}
}

func TestBetweenSampleInflection(t *testing.T) {
	c := study()
	c.Samples = 241
	c.Tube = c.Radius * float64(c.P*c.P) / float64(c.P*c.P+c.Q*c.Q)
	r, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	if r.Omitted == 0 {
		t.Fatal("joined across an unresolved normal reversal")
	}
}
