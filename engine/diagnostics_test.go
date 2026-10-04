package engine

import (
	"math"
	"testing"
)

// The probe's diagnostics of the base curve, against closed forms evaluated
// here.

func diagnosed(t *testing.T, q Request) *Diagnostics {
	t.Helper()
	q.Diagnostics = true
	r := compute(t, q)
	if r.Diagnostics == nil {
		t.Fatal("no diagnostics")
	}
	d := r.Diagnostics
	n := len(r.Base)
	for name, l := range map[string]int{"curvature": len(d.Curvature), "tangent": len(d.Tangent), "normal": len(d.Normal), "center": len(d.Center), "length": len(d.Length)} {
		if l != n {
			t.Fatalf("%s has %d entries for %d samples", name, l, n)
		}
	}
	if d.Min != q.Curve.Min || d.Max != q.Curve.Max {
		t.Fatalf("domain [%g, %g], want [%g, %g]", d.Min, d.Max, q.Curve.Min, q.Curve.Max)
	}
	return d
}

func TestDiagnosticsAreAbsentUnlessAsked(t *testing.T) {
	if compute(t, request("evolute", "cos(t)", "sin(t)", 0, 1)).Diagnostics != nil {
		t.Fatal("diagnostics without the probe")
	}
	for _, q := range []Request{implicitRequest("x^2+y^2", 1, square(2), 40), attractorRequest(clifford())} {
		q.Diagnostics = true
		if compute(t, q).Diagnostics != nil {
			t.Fatalf("%s has no parameter to probe", q.Curve.Format)
		}
	}
}

// An ellipse (a cos t, b sin t), counterclockwise: κ = ab/(a² sin² t +
// b² cos² t)^{3/2} > 0, the unit tangent along r′, the normal to its left,
// and the center of curvature on the evolute ((a²−b²)/a cos³ t,
// (b²−a²)/b sin³ t).
func TestDiagnosticsOfAnEllipse(t *testing.T) {
	const a, b = 2.0, 1.0
	q := request("evolute", "2*cos(t)", "sin(t)", 0, 2*math.Pi)
	d := diagnosed(t, q)
	if d.Flat != 0 || d.Unknown != 0 || d.Clipped != 0 {
		t.Fatalf("flat %d, unknown %d, clipped %d", d.Flat, d.Unknown, d.Clipped)
	}
	for i := range d.Curvature {
		s := sampleT(q, i)
		sn, cs := math.Sin(s), math.Cos(s)
		kappa := a * b / math.Pow(a*a*sn*sn+b*b*cs*cs, 1.5)
		if d.Curvature[i] == nil || math.Abs(*d.Curvature[i]-kappa) > 1e-7*kappa {
			t.Fatalf("κ at t = %g is %v, want %g", s, d.Curvature[i], kappa)
		}
		T := Vec{-a * sn, b * cs}.Unit()
		closeVec(t, d.Tangent[i], T, 1e-9)
		closeVec(t, d.Normal[i], T.Perp(), 1e-9)
		closeVec(t, d.Center[i], Vec{(a*a - b*b) / a * cs * cs * cs, (b*b - a*a) / b * sn * sn * sn}, 1e-6)
	}
}

// Clockwise, a circle's curvature is negative and its center the same.
func TestDiagnosticsSignTurningRight(t *testing.T) {
	q := request("evolute", "1 + 3*cos(t)", "-2 - 3*sin(t)", 0, 2*math.Pi)
	d := diagnosed(t, q)
	for i, k := range d.Curvature {
		if k == nil || math.Abs(*k+1.0/3) > 1e-8 {
			t.Fatalf("κ at %d is %v, want −1/3", i, k)
		}
		closeVec(t, d.Center[i], Vec{1, -2}, 1e-7)
	}
}

// Curvature is a property of the curve: unchanged by rigid motion and by a
// regular reparameterization.
func TestDiagnosticsAreInvariant(t *testing.T) {
	q := request("evolute", "2*cos(t)", "sin(t)", 0, 2*math.Pi)
	moved := request("evolute", "2*cos(t)*cos(0.7) - sin(t)*sin(0.7) + 5", "2*cos(t)*sin(0.7) + sin(t)*cos(0.7) - 3", 0, 2*math.Pi)
	slow := request("evolute", "2*cos(2*t)", "sin(2*t)", 0, math.Pi)
	a, b, c := diagnosed(t, q), diagnosed(t, moved), diagnosed(t, slow)
	rot := func(p Vec) Vec {
		return Vec{p.X*math.Cos(0.7) - p.Y*math.Sin(0.7) + 5, p.X*math.Sin(0.7) + p.Y*math.Cos(0.7) - 3}
	}
	for i := range a.Curvature {
		k := *a.Curvature[i]
		if math.Abs(*b.Curvature[i]-k) > 1e-7*k || math.Abs(*c.Curvature[i]-k) > 1e-7*k {
			t.Fatalf("κ at %d: %g, moved %g, reparameterized %g", i, k, *b.Curvature[i], *c.Curvature[i])
		}
		closeVec(t, b.Center[i], rot(*a.Center[i]), 1e-6)
		if math.Abs(*c.Length[i]-*a.Length[i]) > 1e-6 {
			t.Fatalf("length at %d: %g, reparameterized %g", i, *a.Length[i], *c.Length[i])
		}
	}
}

// A line is flat at every sample: κ = 0, no center.
func TestDiagnosticsOfALineAreFlat(t *testing.T) {
	q := request("evolute", "1 + 2*t", "3 - t", -1, 1)
	d := diagnosed(t, q)
	if d.Flat != q.Samples {
		t.Fatalf("%d of %d samples flat", d.Flat, q.Samples)
	}
	for i := range d.Curvature {
		if d.Curvature[i] == nil || *d.Curvature[i] != 0 || d.Center[i] != nil {
			t.Fatalf("sample %d: κ %v, center %v", i, d.Curvature[i], d.Center[i])
		}
		closeVec(t, d.Tangent[i], Vec{2, -1}.Unit(), 1e-9)
	}
}

// The cubic y = x³ turns left for x > 0 and right for x < 0; at its
// inflection κ = 0, and near it the center lies beyond 100 radii of the
// study, at infinity.
func TestDiagnosticsAcrossAnInflection(t *testing.T) {
	q := request("pedal", "t", "t^3", -1, 1)
	q.Samples = 4001
	d := diagnosed(t, q)
	middle := q.Samples / 2
	if sampleT(q, middle) != 0 || d.Curvature[middle] == nil || *d.Curvature[middle] != 0 || d.Flat != 1 {
		t.Fatalf("inflection at t = %g: κ %v, %d flat", sampleT(q, middle), d.Curvature[middle], d.Flat)
	}
	if d.Clipped == 0 {
		t.Fatal("no center at infinity near the inflection")
	}
	for i, k := range d.Curvature {
		s := sampleT(q, i)
		want := 6 * s / math.Pow(1+9*s*s*s*s, 1.5)
		if k == nil || math.Abs(*k-want) > 1e-6*math.Max(1, math.Abs(want)) {
			t.Fatalf("κ at t = %g is %v, want %g", s, k, want)
		}
		if i != middle && (d.Center[i] == nil) != (math.Abs(1/want) > 100*d.radius) {
			t.Fatalf("center at t = %g: %v, radius %g against %g", s, d.Center[i], 1/want, d.radius)
		}
	}
}

// Arc length by Simpson's rule: exact on a circle, and fourth order.
func TestDiagnosticsArcLength(t *testing.T) {
	q := request("evolute", "3*cos(t)", "3*sin(t)", 0, 2*math.Pi)
	d := diagnosed(t, q)
	for i, s := range d.Length {
		if want := 3 * sampleT(q, i); s == nil || math.Abs(*s-want) > 1e-9*math.Max(1, want) {
			t.Fatalf("length at %d is %v, want %g", i, s, want)
		}
	}
	// (t, sin 3t) on [0, 10], against a fine Simpson sum of its speed
	// √(1 + 9 cos² 3t).
	speed := func(x float64) float64 { return math.Sqrt(1 + 9*math.Cos(3*x)*math.Cos(3*x)) }
	exact, m := 0.0, 200000
	for k := 0; k < m; k++ {
		a, h := 10*float64(k)/float64(m), 10/float64(m)
		exact += h / 6 * (speed(a) + 4*speed(a+h/2) + speed(a+h))
	}
	var errs []float64
	for _, n := range []int{128, 256, 512} {
		p := request("evolute", "t", "sin(3*t)", 0, 10)
		p.Samples, p.Lines = n, 8
		got := *diagnosed(t, p).Length[n-1]
		errs = append(errs, math.Abs(got-exact))
	}
	for k := 1; k < len(errs); k++ {
		if ratio := errs[k-1] / errs[k]; ratio < 12 || ratio > 20 {
			t.Fatalf("errors %v: halving the step divides the error by %g, want about 16", errs, ratio)
		}
	}
}

// Undefined samples have no diagnostics, and the length adds nothing across
// them: it measures the drawn pieces only.
func TestDiagnosticsAcrossAGap(t *testing.T) {
	q := request("evolute", "t", "sqrt(t^2 - 0.25)", -1, 1)
	q.Samples = 65
	d := diagnosed(t, q)
	r := compute(t, q)
	var before float64
	gap := false
	for i, p := range r.Base {
		if p == nil {
			gap = true
			if d.Curvature[i] != nil || d.Tangent[i] != nil || d.Length[i] != nil {
				t.Fatalf("diagnostics at undefined sample %d", i)
			}
			continue
		}
		if d.Length[i] == nil {
			t.Fatalf("no length at drawn sample %d", i)
		}
		if gap {
			// The first sample after the gap continues from the last before.
			if *d.Length[i] != before {
				t.Fatalf("length jumps across the gap: %g after %g", *d.Length[i], before)
			}
			gap = false
		}
		before = *d.Length[i]
	}
	if !(before > 0) {
		t.Fatalf("drawn length %g", before)
	}
}

// A sample the base leaves out where the curve itself stays defined also
// adds nothing to the length: the evolute needs r″, which |t|^1.5 lacks at
// t = 0.
func TestDiagnosticsLengthSkipsALeftOutSample(t *testing.T) {
	q := request("evolute", "t", "abs(t)^1.5", -1, 1)
	d := diagnosed(t, q)
	middle := q.Samples / 2
	if sampleT(q, middle) != 0 || compute(t, q).Base[middle] != nil {
		t.Fatal("the base keeps t = 0")
	}
	if *d.Length[middle+1] != *d.Length[middle-1] {
		t.Fatalf("length crosses the cusp: %g after %g", *d.Length[middle+1], *d.Length[middle-1])
	}
}

// Where r″ is ill-conditioned on a drawn sample, curvature is unknown, not
// a number made of rounding: |t|^1.5 at 0 under a pedal curve, which needs
// only the tangent.
func TestDiagnosticsLeaveAnIllConditionedCurvatureUnknown(t *testing.T) {
	q := request("pedal", "t", "abs(t)^1.5", -1, 1)
	d := diagnosed(t, q)
	middle := q.Samples / 2
	if compute(t, q).Base[middle] == nil {
		t.Fatal("the curve is not drawn at t = 0")
	}
	if d.Curvature[middle] != nil || d.Unknown == 0 || d.Tangent[middle] == nil {
		t.Fatalf("κ at t = 0 is %v with %d unknown", d.Curvature[middle], d.Unknown)
	}
}
