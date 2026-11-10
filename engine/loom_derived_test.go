package engine

import (
	"encoding/json"
	"errors"
	"math"
	"testing"
)

// The derived-source fields and results are read through JSON, as a page
// sends and receives them, so a missing field fails as behavior.
type derivedView struct {
	Members []struct {
		Name      string         `json:"name"`
		Min       float64        `json:"min"`
		Max       float64        `json:"max"`
		At        []float64      `json:"at"`
		Source    []*Vec         `json:"source"`
		Image     []*Vec         `json:"image"`
		Intervals []LoomInterval `json:"intervals"`
	} `json:"members"`
	Base *struct {
		At     []float64 `json:"at"`
		Points []*Vec    `json:"points"`
	} `json:"base"`
	Marker      derivedMarker `json:"marker"`
	Points      int           `json:"points"`
	Evaluations int           `json:"evaluations"`
	Exhausted   bool          `json:"exhausted"`
}
type derivedMarker struct {
	Parameter float64 `json:"parameter"`
	Source    *Vec    `json:"source"`
	Image     *Vec    `json:"image"`
	Base      *Vec    `json:"base"`
}

func derivedLoom(input string, c Curve, pole Vec, distance float64) LoomRequest {
	q := loomExample("curve")
	q.Source.Curve, q.Parameter, q.Samples, q.Tolerance = c, c.Min, 32, 5e-4
	b, _ := json.Marshal(q)
	var fields map[string]any
	_ = json.Unmarshal(b, &fields)
	source := fields["source"].(map[string]any)
	source["input"], source["pole"], source["distance"] = input, map[string]float64{"x": pole.X, "y": pole.Y}, distance
	b, _ = json.Marshal(fields)
	var out LoomRequest
	_ = json.Unmarshal(b, &out)
	return out
}
func derivedCompute(t *testing.T, q LoomRequest) derivedView {
	t.Helper()
	r, err := ComputeLoom(q)
	if err != nil {
		t.Fatal(err)
	}
	b, err := json.Marshal(r)
	if err != nil {
		t.Fatal(err)
	}
	var v derivedView
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	return v
}
func derivedPoint(t *testing.T, q LoomRequest) derivedMarker {
	t.Helper()
	m, err := LoomPoint(q)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(m)
	var v derivedMarker
	_ = json.Unmarshal(b, &v)
	return v
}

var derivedInputs = []string{"evolute", "pedal", "contrapedal", "orthotomic", "offset"}

// At every uniform sample of an ordinary request, the loom's derived source
// is that request's derived input bit for bit, and undefined exactly where
// it is null: one declared evaluator, never a resampled polyline. The
// translated parametric curve takes the evolute's translated path.
func TestLoomDerivedSourceIsTheOrdinaryInput(t *testing.T) {
	curves := []Curve{
		{Format: "parametric", X: "2*cos(t)", Y: "1.1*sin(t)", Min: 0.2, Max: 6},
		{Format: "parametric", X: "40+2*cos(t)", Y: "-30+sin(t)", Min: 0, Max: 6},
		{Format: "cartesian", Y: "t^3-t", Min: -1.5, Max: 1.3},
		{Format: "polar", R: "1+0.5*cos(3*t)", Min: 0, Max: 2 * math.Pi},
		{Format: "roulette", Min: 0, Max: 2 * math.Pi, Roulette: Roulette{Roll: "inside", FixedRadius: 3, Radius: 1, Arm: 1}},
		{Format: "lissajous", Min: 0, Max: 2 * math.Pi, Lissajous: Lissajous{AmplitudeX: 1, AmplitudeY: 1, FrequencyX: 3, FrequencyY: 2, Phase: 0.5}},
		{Format: "fourier", Min: 0, Max: 2 * math.Pi, Terms: []Term{{Frequency: 1, Radius: 1}, {Frequency: -3, Radius: .3}}},
		// A corner 1.5 base stencil steps from the sample t = 0, inside the
		// full step's reach but not the half step's: the base derivative is
		// unstable there and the ordinary input null, although the derived
		// stencil alone would give a point.
		{Format: "cartesian", Y: "abs(t-0.0003)+t^2", Min: -1, Max: 1},
		// The same reach for a C¹ curve, whose second derivative alone is
		// unbounded there: only the evolute needs it stable.
		{Format: "cartesian", Y: "abs(t-0.0003)^1.5+t^2", Min: -1, Max: 1},
	}
	pole, distance := Vec{0.4, -0.3}, 0.25
	for _, c := range curves {
		for _, input := range derivedInputs {
			o := request("pedal", "", "", 0, 0)
			o.Curve, o.Input, o.Pole, o.Distance, o.Samples, o.Lines = c, input, pole, distance, 65, 2
			if input == "evolute" {
				o.Kind = "pedal"
			}
			ordinary := compute(t, o)
			q := derivedLoom(input, c, pole, distance)
			defined := 0
			// The ordinary sample loop's own parameter arithmetic: the
			// evolute's stencil amplifies a unit of rounding in t.
			step := (c.Max - c.Min) / float64(o.Samples-1)
			for j, want := range ordinary.Input {
				q.Parameter = c.Min + float64(j)*step
				got := derivedPoint(t, q)
				if (got.Source == nil) != (want == nil) || got.Source != nil && *got.Source != *want {
					t.Fatalf("%s %s at t=%v: loom %v, ordinary %v", c.Format, input, q.Parameter, got.Source, want)
				}
				if want != nil {
					defined++
				}
			}
			if defined < 40 {
				t.Fatalf("%s %s: only %d defined samples", c.Format, input, defined)
			}
		}
	}
}

// Closed forms and the constructions' own identities, on returned geometry:
// an ellipse's evolute, a circle's offset, the rectangle r, H, P, K of the
// pedal and contrapedal, and the orthotomic's |Q − r| = |P − r|. Each image
// is the square of its source point, computed independently, and each
// member's parameters stay on the base curve's interval.
func TestLoomDerivedClosedFormsAndImages(t *testing.T) {
	a, b := 2.0, 1.1
	ellipse := Curve{Format: "parametric", X: "2*cos(t)", Y: "1.1*sin(t)", Min: 0.1, Max: 6.2}
	r := derivedCompute(t, derivedLoom("evolute", ellipse, Vec{}, 0))
	m := r.Members[0]
	if m.Name != "Evolute" || m.Min != ellipse.Min || m.Max != ellipse.Max {
		t.Fatalf("member %q on [%v, %v]", m.Name, m.Min, m.Max)
	}
	drawn := 0
	for i, p := range m.Source {
		if p == nil {
			continue
		}
		s := m.At[i]
		want := Vec{(a*a - b*b) / a * math.Pow(math.Cos(s), 3), (b*b - a*a) / b * math.Pow(math.Sin(s), 3)}
		if p.Sub(want).Norm() > 1e-6 {
			t.Fatalf("evolute at %v: %v, want %v", s, p, want)
		}
		z := complex(p.X, p.Y) * complex(p.X, p.Y)
		if w := m.Image[i]; w == nil || math.Hypot(w.X-real(z), w.Y-imag(z)) > 1e-12*(1+cmplxAbs(z)) {
			t.Fatalf("image of %v: %v", p, w)
		}
		drawn++
	}
	if drawn < 64 || len(m.Intervals) != 0 {
		t.Fatalf("evolute drew %d points with gaps %+v", drawn, m.Intervals)
	}
	// Refined to the source tolerance, cusps included: every chord's
	// midpoint parameter lies near its chord.
	radius := 0.0
	for _, p := range m.Source {
		radius = math.Max(radius, p.Norm())
	}
	for i := 1; i < len(m.At); i++ {
		u := (m.At[i-1] + m.At[i]) / 2
		want := Vec{(a*a - b*b) / a * math.Pow(math.Cos(u), 3), (b*b - a*a) / b * math.Pow(math.Sin(u), 3)}
		if d := plane.Distance(want, *m.Source[i-1], *m.Source[i]); d > 2*5e-4*radius {
			t.Fatalf("evolute chord at %v strays %v", u, d)
		}
	}

	circle := Curve{Format: "parametric", X: "2*cos(t)", Y: "2*sin(t)", Min: 0, Max: 2 * math.Pi}
	r = derivedCompute(t, derivedLoom("offset", circle, Vec{}, 0.5))
	for _, p := range r.Members[0].Source {
		if p == nil || math.Abs(p.Norm()-1.5) > 1e-9 {
			t.Fatalf("inward offset of a counterclockwise circle: %v", p)
		}
	}

	pole := Vec{0.7, 0.2}
	for _, s := range []float64{0.3, 1.7, 2.9, 4.4} {
		at := func(input string) derivedMarker {
			q := derivedLoom(input, ellipse, pole, 0)
			q.Parameter = s
			return derivedPoint(t, q)
		}
		h, k, o := at("pedal"), at("contrapedal"), at("orthotomic")
		base := Vec{a * math.Cos(s), b * math.Sin(s)}
		for _, m := range []derivedMarker{h, k, o} {
			if m.Base == nil || m.Base.Sub(base).Norm() > 1e-12 || m.Parameter != s {
				t.Fatalf("marker provenance at %v: %+v", s, m)
			}
		}
		if h.Source.Add(*k.Source).Sub(base.Add(pole)).Norm() > 1e-9 {
			t.Fatal("H + K = r + P")
		}
		if math.Abs(o.Source.Sub(base).Norm()-pole.Sub(base).Norm()) > 1e-9 {
			t.Fatal("|Q − r| = |P − r|")
		}
	}
}
func cmplxAbs(z complex128) float64 { return math.Hypot(real(z), imag(z)) }

// The offset of an astroid jumps by 2d at each cusp, where the base tangent
// reverses, and its evolute (the astroid's) is continuous there; the evolute
// of a cubic runs through infinity at its inflection. Each is a singular
// break localized around the true parameter, and no drawn chord in either
// pane crosses it.
func TestLoomDerivedSingularBreaks(t *testing.T) {
	astroid := Curve{Format: "parametric", X: "cos(t)^3", Y: "sin(t)^3", Min: 0.05, Max: 6.3}
	cubic := Curve{Format: "cartesian", Y: "t^3", Min: -1, Max: 1.1}
	cases := []struct {
		input    string
		curve    Curve
		distance float64
		at       []float64
	}{
		{"offset", astroid, 0.3, []float64{math.Pi / 2, math.Pi, 3 * math.Pi / 2, 2 * math.Pi}},
		{"pedal", astroid, 0, []float64{math.Pi / 2, math.Pi, 3 * math.Pi / 2, 2 * math.Pi}},
		{"evolute", cubic, 0, []float64{0}},
	}
	for _, c := range cases {
		for _, m := range []string{"square", "fractional"} {
			q := derivedLoom(c.input, c.curve, Vec{0.2, 0.1}, c.distance)
			q.Map = m
			if m == "fractional" {
				q.MapParameter, q.ExclusionRadius = 1, .01
				q.Coefficients = &LoomCoefficients{Vec{1, 0}, Vec{0, 0}, Vec{1, 0}, Vec{3, 0}}
			}
			r := derivedCompute(t, q)
			mem := r.Members[0]
			for _, s := range c.at {
				found := false
				for _, g := range mem.Intervals {
					if g.Reason == "singular" && g.From <= s && s <= g.To {
						found = g.To-g.From < 1e-4
					}
				}
				if !found {
					t.Fatalf("%s %s: no narrow singular break at %v: %+v", c.input, m, s, mem.Intervals)
				}
				for i := 1; i < len(mem.At); i++ {
					if mem.At[i-1] < s && s < mem.At[i] {
						for _, pane := range [][]*Vec{mem.Source, mem.Image} {
							if pane[i-1] != nil && pane[i] != nil {
								t.Fatalf("%s %s: chord drawn across %v", c.input, m, s)
							}
						}
					}
				}
			}
		}
	}
}

// The base curve is returned for a derived source alone, refined in the
// source plane on the base's interval; direct curves and analytic families
// return neither it nor a marker base.
func TestLoomDerivedBaseReference(t *testing.T) {
	ellipse := Curve{Format: "parametric", X: "2*cos(t)", Y: "1.1*sin(t)", Min: 0, Max: 2 * math.Pi}
	r := derivedCompute(t, derivedLoom("pedal", ellipse, Vec{0.5, 0}, 0))
	if r.Base == nil || len(r.Base.At) < 64 || len(r.Base.At) != len(r.Base.Points) {
		t.Fatalf("base reference: %+v", r.Base)
	}
	for i, p := range r.Base.Points {
		s := r.Base.At[i]
		if p == nil || s < 0 || s > 2*math.Pi || p.Sub(Vec{2 * math.Cos(s), 1.1 * math.Sin(s)}).Norm() > 1e-12 {
			t.Fatalf("base at %v: %v", s, p)
		}
		// Each chord's midpoint parameter lies within tolerance of the curve.
		if i > 0 {
			u := (r.Base.At[i-1] + s) / 2
			mid := r.Base.Points[i-1].Add(*p).Mul(.5)
			if mid.Sub(Vec{2 * math.Cos(u), 1.1 * math.Sin(u)}).Norm() > 4*5e-4*2 {
				t.Fatalf("base chord at %v strays", u)
			}
		}
	}
	for _, kind := range []string{"curve", "grid", "concentric", "rosette"} {
		q := loomExample(kind)
		v := derivedCompute(t, q)
		if v.Base != nil || v.Marker.Base != nil || derivedPoint(t, q).Base != nil {
			t.Fatalf("%s carries a base", kind)
		}
	}
}

// Unsupported paths and their settings are refused under their own fields; a
// derived path with nowhere to be defined is an honest empty result.
func TestLoomDerivedValidationAndEmptyPaths(t *testing.T) {
	ellipse := Curve{Format: "parametric", X: "2*cos(t)", Y: "sin(t)", Min: 0, Max: 6}
	for _, c := range []struct {
		input    string
		pole     Vec
		distance float64
		field    string
	}{
		{"involute", Vec{}, 0, "source.input"},
		{"inversion", Vec{}, 0, "source.input"},
		{"pedal", Vec{math.NaN(), 0}, 0, "source.pole.x"},
		{"orthotomic", Vec{0, math.Inf(1)}, 0, "source.pole.y"},
		{"offset", Vec{}, 1e5 + 1, "source.distance"},
		{"offset", Vec{}, math.NaN(), "source.distance"},
	} {
		q := derivedLoom(c.input, ellipse, Vec{}, 0)
		// JSON cannot carry NaN; set the invalid settings directly.
		q.Source.Pole, q.Source.Distance = c.pole, c.distance
		_, err := ComputeLoom(q)
		var fe *FieldError
		if !errors.As(err, &fe) || fe.Field != c.field {
			t.Fatalf("%+v: %v", c, err)
		}
		if _, err := LoomPoint(q); !errors.As(err, &fe) || fe.Field != c.field {
			t.Fatalf("point %+v: %v", c, err)
		}
	}
	// A straight line has no finite evolute anywhere.
	line := Curve{Format: "parametric", X: "t", Y: "2*t+1", Min: -1, Max: 1}
	r := derivedCompute(t, derivedLoom("evolute", line, Vec{}, 0))
	m := r.Members[0]
	if len(m.Intervals) != 1 || m.Intervals[0].Reason != "invalid" || r.Exhausted || r.Marker.Source != nil || r.Marker.Base == nil {
		t.Fatalf("empty evolute: %+v, marker %+v", m.Intervals, r.Marker)
	}
	for _, p := range m.Source {
		if p != nil {
			t.Fatal("a line's evolute drew a point")
		}
	}
}

// A derived node is charged LoomDerivedCharge evaluations: an upper bound on
// the base-curve evaluations it actually makes, through the translated
// evolute's path too. The request's budget, shared with the base reference,
// therefore bounds base work, and its exhaustion is reported.
func TestLoomDerivedChargeBoundsBaseWork(t *testing.T) {
	curves := []Curve{
		{Format: "parametric", X: "2*cos(t)", Y: "1.1*sin(t)", Min: 0, Max: 6},
		{Format: "parametric", X: "40+2*cos(t)", Y: "-30+sin(t)", Min: 0, Max: 6},
		{Format: "parametric", X: "cos(t)^3", Y: "sin(t)^3", Min: 0, Max: 6.3},
	}
	most := 0
	for _, c := range curves {
		f, err := compile(c)
		if err != nil {
			t.Fatal(err)
		}
		calls := 0
		counted := func(t float64) Vec { calls++; return f(t) }
		for _, input := range derivedInputs {
			s := LoomSource{Kind: "curve", Input: input, Curve: c, Pole: Vec{.3, .2}, Distance: .4}
			d := s.derivedSource(counted)
			for i := 0; i <= 4000; i++ {
				calls = 0
				d.at(c.Min + (c.Max-c.Min)*float64(i)/4000)
				most = max(most, calls)
			}
		}
	}
	if most != LoomDerivedCharge {
		t.Fatalf("a derived node makes up to %d base evaluations; charged %d", most, LoomDerivedCharge)
	}
	q := derivedLoom("offset", Curve{Format: "parametric", X: "t", Y: "sin(300*t)", Min: -2, Max: 2}, Vec{}, .1)
	q.Tolerance = 1e-6
	r, err := computeLoom(q, loomLimits{points: 4000, evaluations: 20000, depth: LoomMaxDepth})
	if err != nil {
		t.Fatal(err)
	}
	if !r.Exhausted || r.Evaluations > 20000 || r.Points > 4000 || r.Base == nil {
		t.Fatalf("derived budget: exhausted %v, %d evaluations, %d points", r.Exhausted, r.Evaluations, r.Points)
	}
	delivered := 2 * len(r.Members[0].At)
	if r.Points != delivered+len(r.Base.At) {
		t.Fatalf("points %d count the member's %d and the base's %d entries", r.Points, delivered, len(r.Base.At))
	}
	// A budget too small for the marker and one pilot node is never
	// overspent, even before any segment is judged. The marker and each
	// derived pilot node take a whole charge; the base reference's pilot
	// nodes, one each, then spend what remains. So one charge is the marker
	// alone, and two the marker and the first derived sample, with nothing
	// left for the base.
	for _, limit := range []int{LoomDerivedCharge, 2*LoomDerivedCharge - 1, 2 * LoomDerivedCharge} {
		r, err = computeLoom(q, loomLimits{points: 4000, evaluations: limit, depth: LoomMaxDepth})
		if err != nil {
			t.Fatal(err)
		}
		count := func(points []*Vec) (n int) {
			for _, p := range points {
				if p != nil {
					n++
				}
			}
			return n
		}
		member, base := count(r.Members[0].Source), count(r.Base.Points)
		if !r.Exhausted || r.Evaluations != limit || member != limit/LoomDerivedCharge-1 || base != limit%LoomDerivedCharge {
			t.Fatalf("limit %d: exhausted %v after %d evaluations, %d derived and %d base points", limit, r.Exhausted, r.Evaluations, member, base)
		}
	}
}

// The base reference is refined in the source plane alone: the same under
// every map, including one whose pole sits beside the curve and one whose
// image needs far finer chords.
func TestLoomDerivedBaseIgnoresTheMap(t *testing.T) {
	// Pilot samples about 1.2 apart, where the exponential would subdivide
	// its own member's to π/4.
	ellipse := Curve{Format: "parametric", X: "6*cos(t)", Y: "3*sin(t)", Min: 0, Max: 2 * math.Pi}
	q := derivedLoom("offset", ellipse, Vec{}, 0.3)
	want := derivedCompute(t, q).Base
	for _, set := range []func(*LoomRequest){
		func(q *LoomRequest) { q.Map, q.Degree = "power", 6 },
		func(q *LoomRequest) { q.Map = "exp" },
		func(q *LoomRequest) {
			q.Map, q.MapParameter, q.ExclusionRadius = "fractional", 1, .05
			q.Coefficients = &LoomCoefficients{Vec{1, 0}, Vec{0, 0}, Vec{1, 0}, Vec{-6, 0}}
		},
	} {
		m := q
		set(&m)
		got := derivedCompute(t, m).Base
		b, _ := json.Marshal(got)
		w, _ := json.Marshal(want)
		if string(b) != string(w) {
			t.Fatalf("%s changed the base reference", m.Map)
		}
	}
}
