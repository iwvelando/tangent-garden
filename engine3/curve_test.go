package engine3

import (
	"encoding/json"
	"fmt"
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
		near(t, corners(out.Mesh)[12*i].Normal, b.mul(-1), 1e-6)
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
	if len(corners(out.Mesh)) != 0 || len(out.Rulings) != 96 || out.Invalid != 0 {
		t.Fatalf("line: faces %d, rulings %d, invalid %d", len(corners(out.Mesh)), len(out.Rulings), out.Invalid)
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

// The full and half-step stencils share exact floating-point parameters.
// Each distinct parameter needs one expression evaluation, even at a
// one-sided endpoint. The budget is work, not wall-clock time.
func TestSampledReusesExactStencilPoints(t *testing.T) {
	for _, at := range []float64{0, 0.25, 3, 9.75, 10} {
		t.Run(fmt.Sprint(at), func(t *testing.T) {
			calls := map[uint64]int{}
			position := func(s float64) Vec3 {
				calls[math.Float64bits(s)]++
				return Vec3{s * s, 3 * s, 2}
			}
			evaluate := sampled(position, 0, 10, 10000, absolute)
			r, v, a, ok := evaluate(at)
			if !ok {
				t.Fatal("regular polynomial rejected")
			}
			near(t, &r, Vec3{at * at, 3 * at, 2}, 1e-12)
			near(t, &v, Vec3{2 * at, 3, 0}, 1e-10)
			near(t, &a, Vec3{2, 0, 0}, 1e-10)
			for bits, n := range calls {
				if n != 1 {
					t.Errorf("parameter %.17g evaluated %d times", math.Float64frombits(bits), n)
				}
			}
			// A later evaluation owns fresh scratch, even at the same parameter.
			clear(calls)
			evaluate(at)
			if len(calls) == 0 {
				t.Fatal("stencil values retained between evaluations")
			}
			for bits, n := range calls {
				if n != 1 {
					t.Errorf("second evaluation: parameter %.17g evaluated %d times", math.Float64frombits(bits), n)
				}
			}
		})
	}
}

// Guard the existing numerical decisions before sharing stencil values.
// referenceDerivatives retains the original arithmetic; analytic identities are
// covered above and by the curve, canal, frame and singularity tests.
func TestSampledKeepsStencilResults(t *testing.T) {
	same := func(a, b Vec3) bool {
		for _, p := range [][2]float64{{a.X, b.X}, {a.Y, b.Y}, {a.Z, b.Z}} {
			if math.Float64bits(p[0]) != math.Float64bits(p[1]) && !(math.IsNaN(p[0]) && math.IsNaN(p[1])) {
				return false
			}
		}
		return true
	}
	for _, span := range []float64{0.00023, 1, 2 * math.Pi, 10000} {
		for _, bounds := range [][2]float64{{0, span}, {-span, span}, {math.Inf(-1), math.Inf(1)}} {
			for _, position := range []func(float64) Vec3{
				func(s float64) Vec3 { return Vec3{math.Cos(s), math.Sin(3 * s), s / 3} },
				func(s float64) Vec3 { return Vec3{1 / s, math.Sqrt(s), math.Abs(s)} },
				func(s float64) Vec3 { return Vec3{s, math.Copysign(1, s), math.NaN()} },
			} {
				evaluate := sampled(position, bounds[0], bounds[1], span, absolute)
				for _, fraction := range []float64{math.Copysign(0, -1), 0.00001, 0.13, 0.5, 0.99999, 1} {
					at := span * fraction
					if !math.IsInf(bounds[0], 0) {
						at = bounds[0] + (bounds[1]-bounds[0])*fraction
					}
					if fraction == 0 && bounds[0] == 0 {
						at = fraction
					}
					r := position(at)
					v, a := referenceDerivatives(position, r, at, bounds[0], bounds[1], span*1e-4)
					v2, a2 := referenceDerivatives(position, r, at, bounds[0], bounds[1], span*5e-5)
					stable := r.valid() && v.valid() && v2.valid() && v.sub(v2).norm() <= 1e-3*math.Max(v.norm(), v2.norm())+1e-8*absolute.speed
					if !a.valid() || !a2.valid() || a.sub(a2).norm() > 1e-2*math.Max(a.norm(), a2.norm())+1e-4*math.Max(absolute.acceleration, v.norm()/span) {
						a = Vec3{math.NaN(), 0, 0}
					}
					gotR, gotV, gotA, gotStable := evaluate(at)
					if !same(gotR, r) || !same(gotV, v) || !same(gotA, a) || gotStable != stable {
						t.Fatalf("stencil changed at span %g, bounds %v, t %g", span, bounds, at)
					}
				}
			}
		}
	}
}

// Original stencil arithmetic retained as a bit-for-bit compatibility guard.
func referenceDerivatives(f func(float64) Vec3, origin Vec3, t, lo, hi, h float64) (Vec3, Vec3) {
	start := math.Max(lo, math.Min(t-2*h, hi-4*h))
	a := (t - start) / h
	var d, dd Vec3
	for j := 0; j < 5; j++ {
		// The basis polynomial's coefficients, lowest first, built in place
		// without allocating: m of them are in use.
		coeff := [5]float64{1}
		m := 1
		den := 1.0
		for k := 0; k < 5; k++ {
			if k == j {
				continue
			}
			b := a - float64(k)
			var next [5]float64
			for n, c := range coeff[:m] {
				next[n] += c * b
				next[n+1] += c
			}
			coeff = next
			m++
			den *= float64(j - k)
		}
		v := f(start + float64(j)*h).sub(origin)
		d = d.add(v.mul(coeff[1] / den / h))
		dd = dd.add(v.mul(2 * coeff[2] / den / h / h))
	}
	return d, dd
}

func BenchmarkSpringStencils(b *testing.B) {
	c := spatialPresets(b)["A cord twisted round a spring"]
	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		if _, err := Compute(c); err != nil {
			b.Fatal(err)
		}
	}
}
