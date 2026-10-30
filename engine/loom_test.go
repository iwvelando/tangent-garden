package engine

import (
	"encoding/json"
	"errors"
	"math"
	"testing"
)

// Go's public JSON entry fields are exercised before the new fields exist,
// so the initial failure is a behavioral refusal rather than a build failure.
func rationalLoom(kind string, value, radius float64, source string) LoomRequest {
	q := loomExample(source)
	b, _ := json.Marshal(q)
	var fields map[string]any
	_ = json.Unmarshal(b, &fields)
	fields["map"], fields["mapParameter"], fields["exclusionRadius"] = kind, value, radius
	b, _ = json.Marshal(fields)
	_ = json.Unmarshal(b, &q)
	return q
}

func TestLoomRationalReturnedGeometry(t *testing.T) {
	for _, kind := range []string{"mobius", "joukowski"} {
		values := []float64{-.9, 0, .9}
		if kind == "joukowski" {
			values = []float64{0, .25, 1}
		}
		for _, value := range values {
			q := rationalLoom(kind, value, .02, "concentric")
			q.Source.Count, q.Source.Radius = 1, 2
			r, err := ComputeLoom(q)
			if err != nil {
				t.Fatal(err)
			}
			drawn := 0
			for i, p := range r.Members[0].Source {
				w := r.Members[0].Image[i]
				if p == nil || w == nil {
					continue
				}
				drawn++
				z := complex(p.X, p.Y)
				want := (z - complex(value, 0)) / (1 - complex(value, 0)*z)
				if kind == "joukowski" {
					want = z + complex(value, 0)/z
				}
				if math.Hypot(w.X-real(want), w.Y-imag(want)) > 1e-10 {
					t.Fatalf("%s(%v) = %v, want %v", kind, p, w, want)
				}
				if kind == "mobius" {
					u := complex(w.X, w.Y)
					inverse := (u + complex(value, 0)) / (1 + complex(value, 0)*u)
					if math.Hypot(real(inverse)-p.X, imag(inverse)-p.Y) > 1e-10 {
						t.Fatal("inverse sign")
					}
					// |w+b|² = R² |1+bw|², independently of map evaluation.
					circle := (1-4*value*value)*(w.X*w.X+w.Y*w.Y) + 2*value*(1-4)*w.X + value*value - 4
					if math.Abs(circle) > 1e-9 {
						t.Fatal("generalized circle equation", circle)
					}
				}
			}
			if drawn < 16 {
				t.Fatal("empty geometry")
			}
		}
	}
	// The circle |z|=2 passes through the pole of M_0.5: image x=-1.25.
	q := rationalLoom("mobius", .5, .03, "concentric")
	q.Source.Count, q.Source.Radius = 1, 2
	r, err := ComputeLoom(q)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Members[0].Intervals) == 0 {
		t.Fatal("through-pole circle closed")
	}
	for _, p := range r.Members[0].Image {
		if p != nil && math.Abs(p.X+1.25) > 1e-9 {
			t.Fatal("circle through pole is not a line", p)
		}
	}
}

func TestLoomRationalIdentityCriticalAndAngles(t *testing.T) {
	for _, kind := range []string{"mobius", "joukowski"} {
		q := rationalLoom(kind, 0, .02, "curve")
		q.Source.Curve.X, q.Source.Curve.Y = "t", "0"
		p, err := LoomPoint(q)
		if err != nil || p.Image == nil || *p.Image != (Vec{}) || p.Critical {
			t.Fatalf("removable identity zero: %+v %v", p, err)
		}
		q = rationalLoom(kind, .25, .02, "curve")
		q.Source.Curve.X, q.Source.Curve.Y = "t", "0"
		for _, at := range []float64{-.5, .5} {
			q.Parameter = at
			p, err = LoomPoint(q)
			if err != nil || p.Image == nil || p.Critical != (kind == "joukowski") {
				t.Fatalf("critical classification: %+v %v", p, err)
			}
		}
		q.Source.Curve.X, q.Source.Curve.Y, q.Parameter = "t", "1", .3
		base, _ := LoomPoint(q)
		q.Source.Curve.X = "t+0.000001"
		x, _ := LoomPoint(q)
		q.Source.Curve.X, q.Source.Curve.Y = "t", "1.000001"
		y, _ := LoomPoint(q)
		u, v := x.Image.Sub(*base.Image), y.Image.Sub(*base.Image)
		if math.Abs(u.Dot(v))/(u.Norm()*v.Norm()) > 1e-5 || u.Cross(v) <= 0 {
			t.Fatal("local angle/orientation")
		}
	}
}

func TestLoomPoleIntervalsSplitBeforeMapping(t *testing.T) {
	for _, source := range []string{"grid", "concentric", "rosette", "curve"} {
		q := rationalLoom("mobius", .9, .001, source)
		q.Samples, q.Tolerance = 4, .05
		q.Source.XCount, q.Source.YCount = 1, 1
		q.Source.Count, q.Source.Radius = 1, 1/.9
		q.Source.Curve.X, q.Source.Curve.Y = "t", "0"
		if source == "rosette" {
			q.Source.Radius = 1 / (2 * .9)
		}
		r, err := ComputeLoom(q)
		if err != nil {
			t.Fatal(err)
		}
		m := r.Members[0]
		if source == "grid" {
			m = r.Members[1]
		}
		pole := Vec{1 / .9, 0}
		gaps, sides := 0, [2]bool{}
		for _, g := range m.Intervals {
			if g.Reason == "excluded" {
				gaps++
			}
		}
		if gaps == 0 {
			t.Fatalf("%s: no explicit excluded interval: %+v", source, m.Intervals)
		}
		for i, w := range m.Image {
			p := m.Source[i]
			if w == nil || p == nil {
				continue
			}
			if source == "grid" || source == "curve" {
				if p.X < pole.X {
					sides[0] = true
				} else {
					sides[1] = true
				}
			}
			if p.Sub(pole).Norm() < .001*(1-1e-10) {
				t.Fatal("excluded point mapped")
			}
			if i > 0 && m.Image[i-1] != nil && m.Source[i-1] != nil && plane.Distance(pole, *m.Source[i-1], *p) < .001*(1-1e-8) {
				t.Fatalf("%s: joined across pole exclusion at %g..%g", source, m.At[i-1], m.At[i])
			}
		}
		if (source == "grid" || source == "curve") && (!sides[0] || !sides[1]) {
			t.Fatal("lost finite branch", source)
		}
	}
	// Exact tangency is a break too, despite finite endpoints and collinear
	// quarter probes. The excluded set includes its boundary.
	q := rationalLoom("joukowski", 1, .125, "grid")
	q.Samples = 4
	q.Source.XCount, q.Source.YCount = 1, 1
	q.Source.YMin, q.Source.YMax = -.875, 1.125
	q.Parameter = -.875
	r, err := ComputeLoom(q)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Members[1].Intervals) == 0 {
		t.Fatal("tangential contact joined")
	}
	// Identity maps have no actual pole, so no exclusion anywhere.
	for _, kind := range []string{"mobius", "joukowski"} {
		q = rationalLoom(kind, 0, 10, "grid")
		r, err = ComputeLoom(q)
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range r.Members {
			if len(m.Intervals) != 0 {
				t.Fatal("identity exclusion")
			}
		}
	}
}

func TestLoomRationalRefinementValidationAndBounds(t *testing.T) {
	for _, kind := range []string{"mobius", "joukowski"} {
		for _, radius := range []float64{0, -1, 1e-7, 1e7, math.NaN(), math.Inf(1)} {
			q := rationalLoom(kind, .5, .01, "curve")
			q.ExclusionRadius = radius
			_, err := ComputeLoom(q)
			var field *FieldError
			if !errors.As(err, &field) || field.Field != "exclusionRadius" {
				t.Fatalf("radius %g accepted: %v", radius, err)
			}
		}
		q := rationalLoom(kind, .5, .01, "curve")
		q.Samples = 4
		q.Source.Curve.X, q.Source.Curve.Y = "t", ".4"
		errAt := func(r LoomResult) float64 {
			worst := 0.0
			m := r.Members[0]
			for i := 1; i < len(m.At); i++ {
				if m.Image[i] == nil || m.Image[i-1] == nil {
					continue
				}
				z := complex((m.At[i]+m.At[i-1])/2, .4)
				w := (z - .5) / (1 - .5*z)
				if kind == "joukowski" {
					w = z + .5/z
				}
				worst = math.Max(worst, plane.Distance(Vec{real(w), imag(w)}, *m.Image[i-1], *m.Image[i]))
			}
			return worst
		}
		q.Tolerance = .02
		coarse, err := ComputeLoom(q)
		if err != nil {
			t.Fatal(err)
		}
		q.Tolerance = .0002
		fine, err := ComputeLoom(q)
		if err != nil {
			t.Fatal(err)
		}
		if errAt(fine) >= errAt(coarse)/4 {
			t.Fatal("mapped error did not converge", kind, errAt(coarse), errAt(fine))
		}
		q.Source.Curve.Y = "sin(100*t)"
		r, err := computeLoom(q, loomLimits{points: 150, evaluations: 25, depth: 2})
		if err != nil || !r.Exhausted || r.Points > 150 || r.Evaluations > 25 {
			t.Fatalf("unbounded pole work: %v %+v", err, r)
		}
	}
}

func TestLoomRationalClippedMarkerMatchesPaths(t *testing.T) {
	q := rationalLoom("joukowski", 0, .01, "curve")
	q.Source.Curve.X, q.Source.Curve.Y = "1000000000+t", "0"
	r, err := ComputeLoom(q)
	if err != nil {
		t.Fatal(err)
	}
	p, err := LoomPoint(q)
	if err != nil || p.Image != nil || r.Marker.Image != nil {
		t.Fatalf("clipped marker disagrees: %+v %+v %v", p, r.Marker, err)
	}
	if len(r.Members[0].Intervals) != 1 || r.Members[0].Intervals[0].Reason != "clipped" {
		t.Fatal("clipping gap missing")
	}
	for _, p := range r.Members[0].Image {
		if p != nil {
			t.Fatal("outlying point delivered")
		}
	}
}

func TestLoomJoukowskiCrossingAndApproach(t *testing.T) {
	for _, y := range []string{"0", ".02"} {
		q := rationalLoom("joukowski", 1, .01, "curve")
		q.Source.Curve.X, q.Source.Curve.Y = "t", y
		q.Samples = 4
		r, err := ComputeLoom(q)
		if err != nil {
			t.Fatal(err)
		}
		gaps := r.Members[0].Intervals
		if y == "0" {
			if len(gaps) == 0 || r.Marker.Image != nil {
				t.Fatal("crossing has no exclusion")
			}
			for i, p := range r.Members[0].Image {
				if p == nil || i == 0 || r.Members[0].Image[i-1] == nil {
					continue
				}
				a, b := r.Members[0].Source[i-1], r.Members[0].Source[i]
				if a.X*b.X < 0 {
					t.Fatal("finite endpoints joined across zero")
				}
			}
		} else if len(gaps) != 0 || r.Marker.Image == nil {
			t.Fatal("safe near-pole curve omitted", gaps)
		}
	}
}

func TestLoomCurveDomainCheckFindsPoleBetweenFiniteCollinearProbes(t *testing.T) {
	q := rationalLoom("joukowski", 1, .01, "curve")
	q.Source.Curve.X, q.Source.Curve.Y = "t", "0"
	q.Source.Curve.Min, q.Source.Curve.Max = -197, 203
	q.Samples, q.Tolerance = 4, .05
	// The middle pilot interval straddles zero, but its quarter probes are
	// -30 1/3, 3 and 36 1/3. All mapped probes lie inside the finite image
	// chord: ordinary source/image chord error alone accepts this crossing.
	r, err := ComputeLoom(q)
	if err != nil {
		t.Fatal(err)
	}
	m := r.Members[0]
	excluded, sides := false, [2]bool{}
	for _, gap := range m.Intervals {
		excluded = excluded || gap.Reason == "excluded"
	}
	for i, w := range m.Image {
		if w == nil {
			continue
		}
		p := m.Source[i]
		if p.X < 0 {
			sides[0] = true
		} else {
			sides[1] = true
		}
		if i > 0 && m.Image[i-1] != nil && m.Source[i-1].X*p.X < 0 {
			t.Fatal("finite collinear probes joined across the pole disk")
		}
	}
	if !excluded || !sides[0] || !sides[1] {
		t.Fatal("expected an excluded interval between two finite branches", m.Intervals, sides)
	}
}

func TestLoomAnalyticCutsDoNotDoubleTheUniformPilot(t *testing.T) {
	q := rationalLoom("joukowski", .5, 1, "grid")
	q.Source.XCount, q.Source.YCount = 4, 4
	q.Samples, q.Tolerance = 16, .05
	r, err := computeLoom(q, loomLimits{points: 800, evaluations: 10000, depth: 16})
	if err != nil {
		t.Fatal(err)
	}
	if r.Exhausted {
		t.Fatalf("cuts consumed the ordinary pilot budget: %d points, %d evaluations", r.Points, r.Evaluations)
	}
	if r.Points > 800 {
		t.Fatal("point cap exceeded")
	}
}

func TestLoomAnalyticSmallDiskOnLargeCircle(t *testing.T) {
	q := rationalLoom("joukowski", 1, 1e-6, "rosette")
	q.Source.Count, q.Source.Radius, q.Samples = 1, 1e6, 4
	r, err := ComputeLoom(q)
	if err != nil {
		t.Fatal(err)
	}
	// Both actual boundary points must survive in the aligned source entries,
	// even though their images are excluded. acos(1-r²/(2R²)) rounds to zero
	// here and loses the two distinct crossings entirely.
	near := [2]bool{}
	for i, p := range r.Members[0].Source {
		if p != nil && r.Members[0].Image[i] == nil && math.Abs(p.Norm()-1e-6) < 1e-9 {
			if p.Y < 0 {
				near[0] = true
			} else {
				near[1] = true
			}
		}
	}
	if !near[0] || !near[1] {
		t.Fatal("analytic crossings lost at large source/radius ratio", near)
	}
}

func loomExample(kind string) LoomRequest {
	return LoomRequest{Map: "square", Source: LoomSource{Kind: kind, Count: 8, XCount: 5, YCount: 5, XMin: -2, XMax: 2, YMin: -2, YMax: 2, Radius: 1, Input: "curve", Curve: Curve{Format: "parametric", X: "t", Y: "1", Min: -2, Max: 2}}, Samples: 16, Tolerance: 1e-3, Selected: 0, Parameter: 0}
}
func TestLoomReturnedSquaresAndIdentities(t *testing.T) {
	for _, kind := range []string{"grid", "concentric", "rosette", "curve"} {
		q := loomExample(kind)
		r, err := ComputeLoom(q)
		if err != nil {
			t.Fatal(err)
		}
		if len(r.Members) == 0 {
			t.Fatal("empty loom")
		}
		for i, m := range r.Members {
			if m.ID != i || len(m.At) < 16 || len(m.Source) != len(m.Image) || len(m.At) != len(m.Source) {
				t.Fatal("lost member or parameter correspondence")
			}
			for j, p := range m.Source {
				if p == nil {
					continue
				}
				w := m.Image[j]
				// Independent complex multiplication, including negative quadrants.
				z := complex(p.X, p.Y)
				want := z * z
				if w == nil || math.Abs(w.X-real(want)) > 1e-12 || math.Abs(w.Y-imag(want)) > 1e-12 {
					t.Fatalf("%s %d/%d: %v -> %v", kind, i, j, p, w)
				}
				if kind == "curve" && math.Abs(w.X-(p.X*p.X-1)) > 1e-12 {
					t.Fatal("grid line is not its analytic parabola")
				}
			}
		}
	}
}
func TestLoomCardioidCriticalAndUniformParameter(t *testing.T) {
	q := loomExample("rosette")
	q.Source.Count = 1
	q.Parameter = math.Pi
	r, err := ComputeLoom(q)
	if err != nil {
		t.Fatal(err)
	}
	if r.Marker.Source == nil || *r.Marker.Source != (Vec{}) || r.Marker.Image == nil || *r.Marker.Image != (Vec{}) || !r.Marker.Critical {
		t.Fatalf("critical point is drawable, not conformal: %+v", r.Marker)
	}
	for i, p := range r.Members[0].Image {
		if p == nil {
			continue
		}
		a := r.Members[0].At[i]
		radius := 2 * (1 + math.Cos(a))
		if p.Sub(Vec{radius * math.Cos(a), radius * math.Sin(a)}).Norm() > 1e-11 {
			t.Fatal("not the independently expected cardioid")
		}
	}
	q = loomExample("curve")
	q.Source.Curve.X = "3+t"
	q.Source.Curve.Y = "-2*t"
	q.Parameter = -0.5
	p, err := LoomPoint(q)
	if err != nil {
		t.Fatal(err)
	}
	if p.Source == nil || *p.Source != (Vec{2.5, 1}) || *p.Image != (Vec{5.25, 5}) || p.Parameter != -0.5 {
		t.Fatalf("absolute source parameter lost: %+v", p)
	}
	// The real Jacobian at the returned regular point preserves oriented angles.
	h := 1e-5
	base := *p.Image
	q.Source.Curve.X = "3+t+0.00001"
	x, _ := LoomPoint(q)
	q.Source.Curve.X = "3+t"
	q.Source.Curve.Y = "-2*t+0.00001"
	y, _ := LoomPoint(q)
	u, v := x.Image.Sub(base).Mul(1/h), y.Image.Sub(base).Mul(1/h)
	if math.Abs(u.Dot(v))/(u.Norm()*v.Norm()) > 1e-5 || u.Cross(v) <= 0 {
		t.Fatal("regular local angles/orientation changed")
	}
}
func TestLoomMappedRefinementConverges(t *testing.T) {
	q := loomExample("curve")
	q.Samples = 4
	errorAt := func(r LoomResult) float64 {
		m := r.Members[0]
		worst := 0.0
		for i := 1; i < len(m.At); i++ {
			if m.Image[i] == nil || m.Image[i-1] == nil {
				continue
			}
			a := (m.At[i] + m.At[i-1]) / 2
			exact := Vec{a*a - 1, 2 * a}
			worst = math.Max(worst, plane.Distance(exact, *m.Image[i-1], *m.Image[i]))
		}
		return worst
	}
	q.Tolerance = .02
	coarse, err := ComputeLoom(q)
	if err != nil {
		t.Fatal(err)
	}
	q.Tolerance = .0002
	fine, err := ComputeLoom(q)
	if err != nil {
		t.Fatal(err)
	}
	if errorAt(fine) >= errorAt(coarse)/4 || len(fine.Members[0].At) <= len(coarse.Members[0].At) {
		t.Fatal("image-space refinement did not converge")
	}
}
func TestLoomInvalidExhaustionAndBounds(t *testing.T) {
	q := loomExample("curve")
	q.Source.Curve.X = "1/t"
	q.Source.Curve.Y = "sqrt(t)"
	r, err := ComputeLoom(q)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Members[0].Intervals) == 0 {
		t.Fatal("undefined intervals silently joined")
	}
	for _, change := range []func(*LoomRequest){
		func(q *LoomRequest) { q.Source.Kind = "unsupported" },
		func(q *LoomRequest) { q.Source.Input = "evolute" },
		func(q *LoomRequest) { q.Source.Curve.Format = "implicit" },
		func(q *LoomRequest) { q.Source.Radius = 0; q.Source.Kind = "rosette" },
		func(q *LoomRequest) { q.Source.XCount = 33; q.Source.Kind = "grid" },
		func(q *LoomRequest) { q.Map = "unknown" },
	} {
		bad := loomExample("curve")
		change(&bad)
		_, err := ComputeLoom(bad)
		var field *FieldError
		if !errors.As(err, &field) || field.Field == "" {
			t.Fatalf("missing field error: %v", err)
		}
	}
	q = loomExample("curve")
	q.Source.Curve.X = "t"
	q.Source.Curve.Y = "sin(300*t)"
	q.Tolerance = 1e-6
	r, err = computeLoom(q, loomLimits{points: 120, evaluations: 100, depth: 1})
	if err != nil {
		t.Fatal(err)
	}
	if !r.Exhausted || r.Points > 120 || r.Evaluations > 100 || r.NumericEntries > 4000000 || len(r.Members[0].Intervals) == 0 {
		t.Fatalf("unbounded or silent exhaustion: %+v", r)
	}
}

func TestLoomAnalyticFamiliesIgnoreUnsupportedFrozenCurve(t *testing.T) {
	q := loomExample("rosette")
	q.Source.Input = "evolute"
	q.Source.Curve.Format = "implicit"
	r, err := ComputeLoom(q)
	if err != nil || len(r.Members) != 8 {
		t.Fatalf("analytic family depends on unused editor source: %v", err)
	}
	q.Source.Kind = "curve"
	if _, err := ComputeLoom(q); err == nil {
		t.Fatal("unsupported source was silently converted")
	}
}

func TestLoomOrdinarySourceFormatsAndFrozenOwnership(t *testing.T) {
	q := loomExample("curve")
	q.Parameter = .3
	cases := []struct {
		curve Curve
		want  Vec
	}{
		{Curve{Format: "roulette", Min: -2, Max: 2, Roulette: Roulette{Roll: "line", Radius: 1, Arm: 0}}, Vec{.3, 1}},
		{Curve{Format: "parametric", X: "t+3", Y: "-2", Min: -2, Max: 2}, Vec{3.3, -2}},
		{Curve{Format: "cartesian", Y: "2*t+1", Min: -2, Max: 2}, Vec{.3, 1.6}},
		{Curve{Format: "polar", R: "2", Min: 0, Max: 2 * math.Pi}, Vec{2 * math.Cos(.3), 2 * math.Sin(.3)}},
		{Curve{Format: "lissajous", Min: 0, Max: 2 * math.Pi, Lissajous: Lissajous{AmplitudeX: 2, AmplitudeY: 3, FrequencyX: 1, FrequencyY: 1, Phase: math.Pi / 2}}, Vec{2 * math.Cos(.3), 3 * math.Sin(.3)}},
		{Curve{Format: "fourier", Min: 0, Max: 2 * math.Pi, Terms: []Term{{Frequency: 0, Radius: 3}, {Frequency: 1, Radius: 2}}}, Vec{3 + 2*math.Cos(.3), 2 * math.Sin(.3)}},
	}
	for _, c := range cases {
		q.Source.Curve = c.curve
		p, err := LoomPoint(q)
		if err != nil {
			t.Fatal(err)
		}
		if p.Source == nil || p.Source.Sub(c.want).Norm() > 1e-12 {
			t.Fatalf("%s source: %+v, want %+v", c.curve.Format, p, c.want)
		}
		want := complex(c.want.X, c.want.Y) * complex(c.want.X, c.want.Y)
		if p.Image == nil || math.Hypot(p.Image.X-real(want), p.Image.Y-imag(want)) > 1e-11 {
			t.Fatal("source format not squared")
		}
	}
	q.Source.Curve = cases[len(cases)-1].curve
	first, err := ComputeLoom(q)
	if err != nil {
		t.Fatal(err)
	}
	original := *first.Members[0].Source[0]
	q.Source.Curve.Terms[0].Radius = 19
	second, err := ComputeLoom(q)
	if err != nil {
		t.Fatal(err)
	}
	if *first.Members[0].Source[0] != original || *second.Members[0].Source[0] == original {
		t.Fatal("returned geometry aliases a mutable source")
	}
}

// A curve's undefined stretch is a gap found at the uniform samples and
// localized only toward each defined end, as in the shared refiner. It is
// neither subdivided throughout nor reported as exhausted work.
func TestLoomUndefinedStretchesSettleCheaply(t *testing.T) {
	for _, c := range []struct {
		curve     Curve
		gaps      int
		edges     []float64
		onCircle  bool
		circleRad float64
	}{
		// Defined only for t in [2, 4]: a semicircle of radius 1 about 3.
		{Curve{Format: "parametric", X: "t-3", Y: "sqrt(1-(t-3)^2)", Min: 0, Max: 2 * math.Pi}, 2, []float64{2, 4}, true, 1},
		// A lemniscate is undefined on (π/4, 3π/4) and (5π/4, 7π/4).
		{Curve{Format: "polar", R: "sqrt(cos(2*t))", Min: 0, Max: 2 * math.Pi}, 2, []float64{math.Pi / 4, 3 * math.Pi / 4, 5 * math.Pi / 4, 7 * math.Pi / 4}, false, 0},
	} {
		q := loomExample("curve")
		q.Source.Curve = c.curve
		q.Samples, q.Tolerance, q.Parameter = 32, 5e-4, c.curve.Min
		r, err := ComputeLoom(q)
		if err != nil {
			t.Fatal(err)
		}
		m := r.Members[0]
		if r.Exhausted || r.Points > 20000 || r.Evaluations > 20000 {
			t.Fatalf("%s: undefined stretch spent the budget: %d points, %d evaluations, exhausted %v", c.curve.Format, r.Points, r.Evaluations, r.Exhausted)
		}
		if len(m.Intervals) != c.gaps {
			t.Fatalf("%s: want %d merged gaps, got %+v", c.curve.Format, c.gaps, m.Intervals)
		}
		for _, g := range m.Intervals {
			if g.Reason != "invalid" {
				t.Fatalf("%s: undefined stretch reported as %q", c.curve.Format, g.Reason)
			}
		}
		defined := 0
		for i, p := range m.Source {
			if p == nil {
				continue
			}
			defined++
			w := complex(p.X, p.Y) * complex(p.X, p.Y)
			if m.Image[i] == nil || math.Hypot(m.Image[i].X-real(w), m.Image[i].Y-imag(w)) > 1e-12 {
				t.Fatal("defined source point lost its square")
			}
			if c.onCircle && math.Abs(math.Hypot(p.X, p.Y)-c.circleRad) > 1e-9 {
				t.Fatalf("source point %v is off the semicircle", p)
			}
		}
		if defined < 32 {
			t.Fatalf("%s: only %d defined points drawn", c.curve.Format, defined)
		}
		// Each defined stretch reaches within a localization step of its edges.
		for _, edge := range c.edges {
			nearest := math.Inf(1)
			for i, p := range m.Source {
				if p != nil {
					nearest = math.Min(nearest, math.Abs(m.At[i]-edge))
				}
			}
			if nearest > 1e-4 {
				t.Fatalf("%s: edge %g localized only to %g", c.curve.Format, edge, nearest)
			}
		}
	}
	// Contrast: a curve defined throughout reports no gap.
	q := loomExample("curve")
	r, err := ComputeLoom(q)
	if err != nil || r.Exhausted || len(r.Members[0].Intervals) != 0 {
		t.Fatalf("defined curve reported gaps: %v %+v", err, r.Members[0].Intervals)
	}
}

// Oscillation that refinement cannot resolve by its depth limit is an
// unresolved break, not exhaustion of the work budget.
func TestLoomDepthLimitIsUnresolvedNotExhausted(t *testing.T) {
	q := loomExample("curve")
	// sin(1/t) oscillates without limit near 0; the samples never land on 0.
	q.Source.Curve = Curve{Format: "parametric", X: "t", Y: "sin(1/t)", Min: -1, Max: 1.5}
	q.Samples, q.Tolerance, q.Parameter = 5, 5e-4, -1
	r, err := ComputeLoom(q)
	if err != nil {
		t.Fatal(err)
	}
	g := r.Members[0].Intervals
	if r.Exhausted || len(g) == 0 {
		t.Fatalf("unresolved oscillation: exhausted %v, %d gaps", r.Exhausted, len(g))
	}
	near := false
	for _, i := range g {
		if i.Reason != "unresolved" || math.Abs(i.From) > .05 || math.Abs(i.To) > .05 {
			t.Fatalf("gap away from the oscillation or misreported: %+v", i)
		}
		near = near || (i.From <= 0 && i.To >= 0) || math.Abs(i.From) < 1e-3
	}
	if !near {
		t.Fatalf("no unresolved break at the accumulation point: %+v", g)
	}
}

// A budget that runs out is spread evenly, level by level, across every
// member and interval: no member or tail is left undrawn while another is
// refined deeply.
func TestLoomExhaustedBudgetSpreadsAcrossMembers(t *testing.T) {
	q := loomExample("grid")
	// Single lines at x = 2 and y = 2 square to parabolas, not segments.
	q.Source.XCount, q.Source.YCount = 1, 1
	q.Source.XMin, q.Source.XMax, q.Source.YMin, q.Source.YMax = 1, 3, 1, 3
	q.Parameter = 1
	q.Samples, q.Tolerance = 16, 1e-6
	r, err := computeLoom(q, loomLimits{points: 400, evaluations: LoomMaxEvaluations, depth: LoomMaxDepth})
	if err != nil {
		t.Fatal(err)
	}
	if !r.Exhausted || r.Points > 400 {
		t.Fatalf("budget not enforced: exhausted %v, %d points", r.Exhausted, r.Points)
	}
	for _, m := range r.Members {
		drawn := map[float64]bool{}
		for i, p := range m.Image {
			if p != nil {
				drawn[m.At[i]] = true
			}
		}
		for i := 0; i < q.Samples; i++ {
			at := m.Min + (m.Max-m.Min)*float64(i)/float64(q.Samples-1)
			if !drawn[at] {
				t.Fatalf("%s: uniform sample %g left undrawn by exhaustion", m.Name, at)
			}
		}
		exhausted := 0
		for _, g := range m.Intervals {
			if g.Reason == "exhausted" {
				exhausted++
			}
		}
		if exhausted == 0 {
			t.Fatalf("%s: exhaustion not reported on the member", m.Name)
		}
	}
}
