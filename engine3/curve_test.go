package engine3

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

func custom(x, y, z string, lo, hi float64) Request {
	c := study()
	c.Format = "parametric"
	c.Curve = Curve{X: x, Y: y, Z: z, Min: lo, Max: hi, A: 1}
	return c
}
func TestCustomHelix(t *testing.T) {
	c := custom("2*cos(t)", "2*sin(t)", "a*t/3", -2*math.Pi, 2*math.Pi)
	out, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	if out.Invalid != 0 || out.Omitted != 0 {
		t.Fatalf("unexpected gaps %+v", out.Bounds)
	}
	for _, i := range []int{0, 53, 240, 479} {
		u := c.Curve.Min + (c.Curve.Max-c.Curve.Min)*float64(i)/float64(c.Samples)
		r := Vec3{2 * math.Cos(u), 2 * math.Sin(u), u / 3}
		tangent := Vec3{-2 * math.Sin(u), 2 * math.Cos(u), 1.0 / 3}.unit()
		b := Vec3{math.Sin(u) / 3, -math.Cos(u) / 3, 2}.unit()
		near(t, out.Base[i], r, 1e-12)
		near(t, out.Plus[i], r.add(tangent.mul(c.Length)), 1e-8)
		near(t, out.Mesh[12*i].Normal, b.mul(-1), 1e-6)
	}
	// The user-specified domain is not assumed closed.
	if out.Base[0].sub(*out.Base[c.Samples]).norm() < 1 {
		t.Fatal("helix falsely closed")
	}
}
func TestCustomTorusAgreesWithGenerator(t *testing.T) {
	c := study()
	want, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	c.Format = "parametric"
	c.Curve = Curve{X: "(2.4+0.85*cos(3*t))*cos(2*t)", Y: "(2.4+0.85*cos(3*t))*sin(2*t)", Z: "0.85*sin(3*t)", Min: 0, Max: 2 * math.Pi}
	got, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	if got.Omitted != 0 || got.Invalid != 0 {
		t.Fatal("regular knot lost samples")
	}
	for i := range got.Base {
		near(t, got.Base[i], want.Base[i], 1e-12)
		near(t, got.Plus[i], want.Plus[i], 1e-7)
	}
}
func TestCustomLineHasTangentsWithoutInventedSurface(t *testing.T) {
	out, err := Compute(custom("t", "2*t+4", "-3*t+8", -1, 1))
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Mesh) != 0 || len(out.Rulings) != 96 || out.Invalid != 0 {
		t.Fatalf("line: faces %d, rulings %d, invalid %d", len(out.Mesh), len(out.Rulings), out.Invalid)
	}
}
func TestCustomBreaks(t *testing.T) {
	for _, x := range []string{"1/t", "1/(t-0.00317)", "tan(t)"} {
		c := custom(x, "t", "sin(t)", -2, 2)
		c.Samples = 481
		out, err := Compute(c)
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, gap := range out.Breaks {
			found = found || gap
		}
		if !found {
			t.Errorf("joined singularity of %s", x)
		}
		if _, err := json.Marshal(out); err != nil {
			t.Fatal(err)
		}
	}
	out, err := Compute(custom("t^2", "t^3", "0", -1, 1))
	if err != nil {
		t.Fatal(err)
	}
	if out.Base[240] != nil || out.Invalid == 0 {
		t.Fatal("stationary point was not omitted")
	}
	out, err = Compute(custom("sqrt(t)", "t", "t", 0, 1))
	if err != nil {
		t.Fatal(err)
	}
	if out.Base[0] != nil {
		t.Fatal("singular endpoint was given a finite tangent")
	}
}
func TestCustomValidation(t *testing.T) {
	cases := []Request{custom("0", "0", "0", 0, 1), custom("bad(t)", "t", "t", 0, 1), custom("t", "t", "t", 1, 0), custom(strings.Repeat("(", 70)+"t"+strings.Repeat(")", 70), "t", "t", 0, 1), custom("1/0", "t", "t", 0, 1)}
	c := custom("t", "t", "t", 0, 1)
	c.Curve.A = math.NaN()
	cases = append(cases, c)
	c = custom("t", "t", "t", 0, 1)
	c.Format = "wrong"
	cases = append(cases, c)
	for i, c := range cases {
		if _, err := Compute(c); err == nil {
			t.Errorf("invalid case %d accepted", i)
		}
	}
}
func TestCustomReparameterization(t *testing.T) {
	first := custom("2*cos(t)", "2*sin(t)", "t/3", 0, 2)
	second := custom("2*cos(t+t^3)", "2*sin(t+t^3)", "(t+t^3)/3", 0, 1)
	a, _ := Compute(first)
	b, _ := Compute(second)
	near(t, a.Plus[0], b.Plus[0], 1e-6)
	near(t, a.Plus[len(a.Plus)-1], b.Plus[len(b.Plus)-1], 1e-6)
}
func TestIndependentBoundsKeepTangentEdges(t *testing.T) {
	c := custom("t", "t^2", "t^3", 0, 0.01)
	c.Length = 20
	r, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	if r.Bounds.Radius < 19 {
		t.Fatal("short base hid long tangents")
	}
}
