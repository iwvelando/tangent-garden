package engine

import (
	"errors"
	"math"
	"testing"
)

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
