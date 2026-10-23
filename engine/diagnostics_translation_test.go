package engine

import (
	"encoding/json"
	"math"
	"testing"
)

// The tiny ellipse is 10⁴ to 10⁷ of its diameters from the origin. Expectations
// are its analytic curvature, unit tangent, and astroid of curvature centers.
func TestTranslatedDiagnosticEllipse(t *testing.T) {
	for _, scale := range []float64{1.0 / 8, 1.0 / 64, 1.0 / 1024, 1.0 / 4096} {
		q := request("inversion", "5000+"+num(2*scale)+"*cos(t)", "-3000+"+num(scale)+"*sin(t)", 0, 2*math.Pi)
		q.Inversion = Inversion{Center: Vec{5000, -3000}, Radius: scale}
		q.Samples, q.Lines, q.Diagnostics = 65, 8, true
		at := 0.731
		q.Probe = &ProbeQuery{T: &at}
		r := compute(t, q)
		check := func(u float64, k *float64, center, tangent *Vec) {
			t.Helper()
			if k == nil || center == nil || tangent == nil {
				t.Fatalf("scale %g, t=%g: missing curvature, center or tangent: %v %v %v", scale, u, k, center, tangent)
			}
			s, c := math.Sincos(u)
			want := 2 / math.Pow(4*s*s+c*c, 1.5)
			if math.Abs(*k*scale-want) > 2e-7*want {
				t.Fatalf("t=%g: curvature*scale=%g, want %g", u, *k*scale, want)
			}
			closeVec(t, center, Vec{5000 + 1.5*scale*c*c*c, -3000 - 3*scale*s*s*s}, 2e-9)
			closeVec(t, tangent, Vec{-2 * s, c}.Unit(), 2e-9)
		}
		for i := range r.Base {
			check(sampleT(q, i), r.Diagnostics.Curvature[i], r.Diagnostics.Center[i], r.Diagnostics.Tangent[i])
		}
		check(at, r.Probe.Curvature, r.Probe.Center, r.Probe.Tangent)
		// Probe-only requests exercise the cached study and both positioning modes.
		for _, u := range []float64{0, 1.23, 2 * math.Pi} {
			q.Probe = &ProbeQuery{T: &u}
			p, err := ProbeOnly(q)
			if err != nil {
				t.Fatal(err)
			}
			check(u, p.Curvature, p.Center, p.Tangent)
		}
		share := 0.5
		q.Probe = &ProbeQuery{Share: &share}
		p, err := ProbeOnly(q)
		if err != nil {
			t.Fatal(err)
		}
		if math.Abs(p.T-math.Pi) > 1e-9 {
			t.Fatalf("half arc at %g, want pi", p.T)
		}
		check(p.T, p.Curvature, p.Center, p.Tangent)
		// Readouts must not change the numerical drawing.
		q.Diagnostics, q.Probe = false, nil
		plain := compute(t, q)
		r.Diagnostics, r.Probe = nil, nil
		a := diagnosticJSON(t, r)
		b := diagnosticJSON(t, plain)
		if string(a) != string(b) {
			t.Fatal("diagnostics changed geometry")
		}
	}
}

// Nearby studies, constant points, nonseparable cancellations, and curves
// supplied by another notebook must keep the original evaluator's readouts.
func TestDiagnosticTranslationCompatibility(t *testing.T) {
	cases := []Request{}
	for _, p := range loadPresets(t) {
		if p.Config.Curve.Format == "parametric" || p.Config.Curve.Format == "cartesian" {
			cases = append(cases, p.Config)
		}
	}
	for _, xy := range [][2]string{{"20+2*cos(t)", "-8+sin(t)"}, {"5000+1e-20*cos(t)", "-3000+1e-20*sin(t)"}, {"5000+(cos(t)-5000)", "-3000+(sin(t)+3000)"}} {
		cases = append(cases, request("evolute", xy[0], xy[1], 0, 2*math.Pi))
	}
	cancellation := request("inversion", "5000+1e8*cos(t)-1e8", "-3000+t/1024", 0, 1e-6)
	cancellation.Inversion = Inversion{Radius: 1}
	cases = append(cases, cancellation)
	for _, q := range cases {
		q.Diagnostics = true
		at := q.Curve.Min + 0.314*(q.Curve.Max-q.Curve.Min)
		q.Probe = &ProbeQuery{T: &at}
		a := compute(t, q)
		f, err := compile(q.Curve)
		if err != nil {
			t.Fatal(err)
		}
		q.given = f
		b := compute(t, q)
		x := diagnosticJSON(t, a)
		y := diagnosticJSON(t, b)
		if string(x) != string(y) {
			t.Fatalf("changed existing arithmetic for %s,%s", q.Curve.X, q.Curve.Y)
		}
	}
}

// Translation must not supply a tangent at a cusp, turn a straight line
// into bending, or hide the loss of a second derivative at a singularity.
func TestTranslatedDiagnosticDegeneracies(t *testing.T) {
	for _, c := range []struct {
		x, y                string
		stationary, unknown bool
	}{
		{"t/1024", "t/2048", false, false},
		{"t^2/1024", "t^3/1024", true, false},
		{"t/1024", "abs(t)^1.5/1024", false, true},
		{"t/1024", "t^3/1024", false, false},
	} {
		q := request("inversion", "5000+("+c.x+")", "-3000+("+c.y+")", -1, 1)
		q.Inversion = Inversion{Radius: 1}
		q.Samples, q.Lines, q.Diagnostics = 65, 8, true
		at := 0.0
		q.Probe = &ProbeQuery{T: &at}
		r := compute(t, q)
		for _, p := range []*ProbePoint{r.Probe, {T: 0, Tangent: r.Diagnostics.Tangent[32], Curvature: r.Diagnostics.Curvature[32], Center: r.Diagnostics.Center[32]}} {
			if (p.Tangent == nil) != c.stationary {
				t.Fatalf("%s: tangent %v", c.y, p.Tangent)
			}
			if p.Center != nil {
				t.Fatalf("%s: invented center %v", c.y, p.Center)
			}
			if c.unknown || c.stationary {
				if p.Curvature != nil {
					t.Fatalf("%s: invented curvature %v", c.y, *p.Curvature)
				}
			} else if p.Curvature == nil || *p.Curvature != 0 {
				t.Fatalf("%s: expected flat curvature", c.y)
			}
		}
	}
	q := request("inversion", "5000+t/1024", "-3000+1/(1024*t)", -1, 1)
	q.Inversion = Inversion{Radius: 1}
	q.Samples = 65
	q.Diagnostics = true
	at := 0.0
	q.Probe = &ProbeQuery{T: &at}
	r := compute(t, q)
	if r.Base[32] != nil || r.Probe.Point != nil || r.Diagnostics.Center[32] != nil {
		t.Fatal("pole acquired a point or center")
	}
}

func TestTranslatedCartesianDiagnostics(t *testing.T) {
	q := request("inversion", "ignored", "5000+1024*t^2", 0, 0.001)
	q.Curve.Format = "cartesian"
	q.Inversion = Inversion{Radius: 1}
	q.Samples, q.Lines, q.Diagnostics = 65, 8, true
	at := 0.0003712
	q.Probe = &ProbeQuery{T: &at}
	r := compute(t, q)
	check := func(u float64, k *float64, center *Vec) {
		t.Helper()
		v := 2048 * u
		want := 2048 / math.Pow(1+v*v, 1.5)
		if k == nil || math.Abs(*k-want) > 2e-7*want {
			t.Fatalf("t=%g: curvature %v, want %g", u, k, want)
		}
		closeVec(t, center, Vec{u - v*(1+v*v)/2048, 5000 + 1024*u*u + (1+v*v)/2048}, 2e-9)
	}
	for i := range r.Base {
		check(sampleT(q, i), r.Diagnostics.Curvature[i], r.Diagnostics.Center[i])
	}
	check(at, r.Probe.Curvature, r.Probe.Center)
	// A probe asked without the sampled readouts takes the same local path.
	q.Diagnostics = false
	p := compute(t, q).Probe
	check(at, p.Curvature, p.Center)
}

func diagnosticJSON(t *testing.T, r Result) []byte {
	t.Helper()
	data, err := json.Marshal(r)
	if err != nil {
		t.Fatal(err)
	}
	return data
}
