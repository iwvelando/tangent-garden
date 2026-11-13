package engine

import (
	"encoding/json"
	"errors"
	"math"
	"math/cmplx"
	"strconv"
	"testing"
)

// The composite request is built through JSON, as the worker sends it, so
// these tests fail behaviorally rather than by compilation before the map
// exists.
func compositeLoom(source string, degree any) LoomRequest {
	q := loomExample(source)
	b, _ := json.Marshal(q)
	var fields map[string]any
	_ = json.Unmarshal(b, &fields)
	fields["map"] = "exp-power"
	if degree != nil {
		fields["degree"] = degree
	}
	b, _ = json.Marshal(fields)
	_ = json.Unmarshal(b, &q)
	return q
}

// Independent composite: math/cmplx's polar power and exponential, not the
// engine's repeated multiplication and e^x(cos y, sin y).
func compositeOf(p Vec, n int) (u, w complex128) {
	u = cmplx.Pow(complex(p.X, p.Y), complex(float64(n), 0))
	return u, cmplx.Exp(u)
}

// inWindow is the exponential's window written independently (expReal,
// expImag), with a relative allowance for rounding of the intermediate.
func inWindow(u complex128, slack float64) bool {
	return math.Abs(real(u)) <= expReal+slack && math.Abs(imag(u)) <= expImag+slack
}

func nearComplex(w Vec, want complex128, relative float64) bool {
	return cmplx.Abs(complex(w.X, w.Y)-want) <= relative*math.Max(cmplx.Abs(want), 1)
}

// Every drawn point is exp(zⁿ) of its source point and its intermediate zⁿ
// lies in the window; every point left undrawn has zⁿ outside it. Rational
// settings and coefficients ride along, ignored.
func TestLoomCompositeReturnedGeometryIsExpOfThePower(t *testing.T) {
	for _, kind := range []string{"grid", "concentric", "rosette", "curve", "offset"} {
		for n := 2; n <= 6; n++ {
			q := compositeLoom(kind, n)
			if kind == "offset" {
				q = compositeLoom("curve", n)
				q.Source.Input, q.Source.Distance = "offset", .25
				q.Source.Curve = Curve{Format: "polar", R: "1+0.3*cos(5*t)", Min: 0, Max: 2 * math.Pi}
				q.Parameter = 0
			}
			q.MapParameter, q.ExclusionRadius = .5, .1
			q.Coefficients = &LoomCoefficients{A: Vec{1, 2}, B: Vec{1, -2}, C: Vec{1, -2}, D: Vec{1, 2}}
			r, err := ComputeLoom(q)
			if err != nil {
				t.Fatalf("%s n=%d: %v", kind, n, err)
			}
			if r.Pole != nil {
				t.Fatalf("%s n=%d: the composite has no pole", kind, n)
			}
			drawn := 0
			for _, m := range r.Members {
				for j, p := range m.Source {
					w := m.Image[j]
					if p == nil {
						continue
					}
					u, want := compositeOf(*p, n)
					if w == nil {
						if inWindow(u, -1e-9*math.Max(cmplx.Abs(u), 1)) {
							t.Fatalf("%s n=%d: %v undrawn though z^n = %v is inside the window", kind, n, p, u)
						}
						continue
					}
					drawn++
					if !inWindow(u, 1e-12*math.Max(cmplx.Abs(u), 1)) {
						t.Fatalf("%s n=%d: %v drawn with z^n = %v outside the window", kind, n, p, u)
					}
					if !nearComplex(*w, want, 1e-12) {
						t.Fatalf("%s n=%d: %v -> %v, want %v", kind, n, p, w, want)
					}
				}
			}
			if drawn < 16 {
				t.Fatalf("%s n=%d: fixture drew too little (%d)", kind, n, drawn)
			}
		}
	}
}

// The composite is the exponential applied to the power map's own value:
// the marker's intermediate point is, bit for bit, the power map's image of
// the same source point, and its image is, bit for bit, the exponential's
// image of that intermediate point entered as a source.
func TestLoomCompositeComposesTheDeliveredStages(t *testing.T) {
	format := func(v float64) string { return strconv.FormatFloat(v, 'g', -1, 64) }
	for n := 2; n <= 6; n++ {
		for _, at := range []float64{.4, 1.1, 2.9, 4.4} {
			q := compositeLoom("rosette", n)
			q.Source.Radius = .6
			q.Selected, q.Parameter = 3, at
			composite, err := LoomPoint(q)
			if err != nil {
				t.Fatal(err)
			}
			q.Map = "power"
			power, err := LoomPoint(q)
			if err != nil {
				t.Fatal(err)
			}
			if composite.Intermediate == nil || *composite.Intermediate != *power.Image {
				t.Fatalf("n=%d θ=%g: intermediate %v, power image %v", n, at, composite.Intermediate, power.Image)
			}
			if *composite.Source != *power.Source {
				t.Fatal("the stages read different source points")
			}
			e := expLoom("curve")
			e.Source.Curve = Curve{Format: "parametric", X: format(power.Image.X), Y: format(power.Image.Y), Min: 0, Max: 1}
			e.Parameter = 0
			exp, err := LoomPoint(e)
			if err != nil {
				t.Fatal(err)
			}
			if *exp.Source != *power.Image {
				t.Fatal("intermediate did not round trip as a source")
			}
			if composite.Image == nil || *composite.Image != *exp.Image {
				t.Fatalf("n=%d θ=%g: composite %v, exp of the power %v", n, at, composite.Image, exp.Image)
			}
		}
	}
}

// C′(z) = n zⁿ⁻¹ exp(zⁿ). The quotient of returned neighbors is the mean of
// C′ along their chord, here by Simpson's rule on the independent formula.
func TestLoomCompositeDerivativeFromReturnedNeighbors(t *testing.T) {
	for _, kind := range []string{"concentric", "grid", "rosette"} {
		for _, n := range []int{2, 3, 5} {
			q := compositeLoom(kind, n)
			q.Source.Radius, q.Source.Count = .8, 3
			q.Source.XMin, q.Source.XMax, q.Source.YMin, q.Source.YMax = -1, 1, -1, 1
			q.Tolerance = 1e-6
			r, err := ComputeLoom(q)
			if err != nil {
				t.Fatal(err)
			}
			worst, checked := 0.0, 0
			for _, m := range r.Members {
				for j := 1; j < len(m.At); j++ {
					a, b := m.Source[j-1], m.Source[j]
					wa, wb := m.Image[j-1], m.Image[j]
					if a == nil || b == nil || wa == nil || wb == nil {
						continue
					}
					// A straight image, as on the real axis, keeps long
					// chords whose Simpson error, of order h⁴, dominates.
					dz := complex(b.X-a.X, b.Y-a.Y)
					if cmplx.Abs(dz) == 0 || cmplx.Abs(dz) > .02 {
						continue
					}
					quotient := complex(wb.X-wa.X, wb.Y-wa.Y) / dz
					derivative := func(z complex128) complex128 {
						return complex(float64(n), 0) * cmplx.Pow(z, complex(float64(n-1), 0)) * cmplx.Exp(cmplx.Pow(z, complex(float64(n), 0)))
					}
					za, zb := complex(a.X, a.Y), complex(b.X, b.Y)
					want := (derivative(za) + 4*derivative((za+zb)/2) + derivative(zb)) / 6
					scale := math.Max(cmplx.Abs(want), 1)
					worst = math.Max(worst, cmplx.Abs(quotient-want)/scale)
					checked++
				}
			}
			if checked < 50 || worst > 1e-6 {
				t.Fatalf("%s n=%d: derivative differs by %g over %d chords", kind, n, worst, checked)
			}
		}
	}
}

// The only critical point is zero, inherited from the power: it is drawn,
// maps to exactly 1 and is reported at the rosette's θ = π. The exponential
// introduces none.
func TestLoomCompositeCriticalOnlyAtZero(t *testing.T) {
	for n := 2; n <= 6; n++ {
		q := compositeLoom("rosette", n)
		q.Source.Radius = .5
		r, err := ComputeLoom(q)
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range r.Members {
			found := false
			for j, p := range m.Source {
				zero := p != nil && p.X == 0 && p.Y == 0
				if m.Critical[j] != zero {
					t.Fatalf("n=%d %s: critical %v at %v", n, m.Name, m.Critical[j], p)
				}
				if zero {
					found = true
					if *m.Image[j] != (Vec{1, 0}) {
						t.Fatalf("n=%d: zero maps to %v, want exactly 1", n, m.Image[j])
					}
				}
			}
			if !found {
				t.Fatalf("n=%d %s: the critical zero was not drawn", n, m.Name)
			}
		}
		q.Selected, q.Parameter = 2, math.Pi
		marker, err := LoomPoint(q)
		if err != nil {
			t.Fatal(err)
		}
		if !marker.Critical || *marker.Image != (Vec{1, 0}) || *marker.Intermediate != (Vec{}) {
			t.Fatalf("n=%d: marker at zero %+v", n, marker)
		}
		q.Parameter = 3
		if marker, _ = LoomPoint(q); marker.Critical {
			t.Fatalf("n=%d: a nonzero point is marked critical", n)
		}
	}
}

// A line leaves the domain D = {z : zⁿ in the window} where its intermediate
// leaves the window: for z = ½ + iy squared, Re z² = ¼ − y² = −ln 10⁸ at
// |y| = √(¼ + ln 10⁸). The crossing is a clipped gap located by bisection to
// the depth limit; nothing is drawn beyond it.
func TestLoomCompositeDomainBoundaryIsLocatedAndClipped(t *testing.T) {
	q := compositeLoom("grid", 2)
	q.Source.XCount, q.Source.YCount = 1, 1
	q.Source.XMin, q.Source.XMax, q.Source.YMin, q.Source.YMax = 0, 1, -10, 10
	q.Samples = 16
	q.Parameter = -10
	r, err := ComputeLoom(q)
	if err != nil {
		t.Fatal(err)
	}
	m := r.Members[0]
	edge := math.Sqrt(.25 + expReal)
	resolution := 20.0 / 15 / math.Exp2(LoomMaxDepth)
	if len(m.Intervals) != 2 {
		t.Fatalf("intervals %+v", m.Intervals)
	}
	low, high := m.Intervals[0], m.Intervals[1]
	if low.Reason != "clipped" || high.Reason != "clipped" || low.From != -10 || high.To != 10 {
		t.Fatalf("intervals %+v", m.Intervals)
	}
	if math.Abs(low.To+edge) > resolution || math.Abs(high.From-edge) > resolution {
		t.Fatalf("boundary at %g and %g, want ±%g within %g", low.To, high.From, edge, resolution)
	}
	for j, w := range m.Image {
		if w != nil && math.Abs(m.At[j]) > edge {
			t.Fatalf("drawn beyond the domain at y = %g", m.At[j])
		}
	}
	if r.Exhausted {
		t.Fatal("locating the boundary exhausted the budget")
	}
}

// A source wholly outside the domain is an honest empty image: one clipped
// interval, no drawn point, a clipped marker with no shared-image points.
// The domain is bounded, |z| ≤ (ln²10⁸ + 64π²)^{1/(2n)}.
func TestLoomCompositeEmptyDomains(t *testing.T) {
	for n := 2; n <= 6; n++ {
		limit := math.Pow(expReal*expReal+expImag*expImag, 1/(2*float64(n)))
		for _, kind := range []string{"concentric", "curve"} {
			q := compositeLoom(kind, n)
			q.Source.Count, q.Source.Radius = 1, 1.01*limit
			q.Source.Curve = Curve{Format: "parametric", X: strconv.FormatFloat(1.01*limit, 'g', -1, 64) + "*cos(t)", Y: strconv.FormatFloat(1.01*limit, 'g', -1, 64) + "*sin(t)", Min: 0, Max: 2 * math.Pi}
			q.Parameter = 0
			r, err := ComputeLoom(q)
			if err != nil {
				t.Fatal(err)
			}
			m := r.Members[0]
			// The last pilot is 2π·(N − 1)/(N − 1), within an ulp of 2π.
			if len(m.Intervals) != 1 || m.Intervals[0].From != 0 || math.Abs(m.Intervals[0].To-2*math.Pi) > 1e-15 || m.Intervals[0].Reason != "clipped" {
				t.Fatalf("%s n=%d: intervals %+v", kind, n, m.Intervals)
			}
			for _, w := range m.Image {
				if w != nil {
					t.Fatalf("%s n=%d: drew outside the domain", kind, n)
				}
			}
			if r.Marker.Image != nil || len(r.Marker.Translates) != 0 || r.Marker.Source == nil {
				t.Fatalf("%s n=%d: marker %+v", kind, n, r.Marker)
			}
			// The intermediate still says where the point went.
			if u, _ := compositeOf(*r.Marker.Source, n); r.Marker.Intermediate == nil || !nearComplex(*r.Marker.Intermediate, u, 1e-12) {
				t.Fatalf("%s n=%d: intermediate %v, want %v", kind, n, r.Marker.Intermediate, u)
			}
		}
	}
	// Powers beyond float64 range clip without NaN.
	q := compositeLoom("curve", 6)
	q.Source.Curve = Curve{Format: "parametric", X: "1e30", Y: "t", Min: 0, Max: 1}
	q.Parameter = 0
	r, err := ComputeLoom(q)
	if err != nil {
		t.Fatal(err)
	}
	if r.Marker.Image != nil || r.Marker.Intermediate != nil || r.Members[0].Intervals[0].Reason != "clipped" {
		t.Fatalf("overflowing power: %+v", r.Marker)
	}
}

// Grids and circles near the domain's edge meet it in narrow arcs, which
// coarse pilots straddle while clipped at both ends. Every stretch inside the
// domain that a dense independent scan finds contains a drawn point, and
// every drawn point is inside. Members: a circle just inside the corners'
// radius, rosettes reaching just past it, and grid lines y = c near the
// largest c the domain admits for n = 2, c⁴ − c² ln 10⁸ = (4π)².
func TestLoomCompositeFindsNarrowArcsOfAnalyticFamilies(t *testing.T) {
	type study struct {
		name string
		n    int
		q    LoomRequest
		at   func(id int, t float64) complex128
	}
	var studies []study
	for n := 2; n <= 6; n++ {
		limit := math.Pow(expReal*expReal+expImag*expImag, 1/(2*float64(n)))
		q := compositeLoom("concentric", n)
		q.Source.Count, q.Source.Radius = 3, .9995*limit
		studies = append(studies, study{"concentric", n, q, func(id int, t float64) complex128 {
			return cmplx.Rect(q.Source.Radius*float64(id+1)/3, t)
		}})
		// One circle: images out to e^18 make a family's refinement
		// costly, as for the exponential, whatever the search adds.
		r := compositeLoom("rosette", n)
		r.Source.Count, r.Source.Radius = 1, .52*limit
		studies = append(studies, study{"rosette", n, r, func(id int, t float64) complex128 {
			return complex(r.Source.Radius, 0) * (1 + cmplx.Rect(1, t))
		}})
	}
	edge := math.Sqrt((expReal + math.Hypot(expReal, expImag)) / 2)
	g := compositeLoom("grid", 2)
	g.Source.XCount, g.Source.YCount = 1, 3
	g.Source.XMin, g.Source.XMax, g.Source.YMin, g.Source.YMax = -5, 5, .997*edge, .999*edge
	g.Parameter = g.Source.YMin
	studies = append(studies, study{"grid", 2, g, func(id int, t float64) complex128 {
		if id == 0 {
			return complex(0, t)
		}
		return complex(t, g.Source.YMin+(g.Source.YMax-g.Source.YMin)*float64(id-1)/2)
	}})
	for _, s := range studies {
		s.q.Samples, s.q.Tolerance = 4, .05
		r, err := ComputeLoom(s.q)
		if err != nil {
			t.Fatal(err)
		}
		arcs := 0
		for _, m := range r.Members {
			for j, w := range m.Image {
				if w != nil {
					if u, _ := compositeOf(*m.Source[j], s.n); !inWindow(u, 1e-9*cmplx.Abs(u)) {
						t.Fatalf("%s n=%d: drawn outside at %g", s.name, s.n, m.At[j])
					}
				}
			}
			// Inside stretches of a dense scan, each wider than the
			// depth-limited localization.
			const steps = 200000
			inside, from := false, 0.0
			for k := 0; k <= steps; k++ {
				t0 := m.Min + (m.Max-m.Min)*float64(k)/steps
				u := cmplx.Pow(s.at(m.ID, t0), complex(float64(s.n), 0))
				now := inWindow(u, 0)
				if now && !inside {
					from = t0
				}
				if !now && inside || now && k == steps {
					arcs++
					found := false
					for j, w := range m.Image {
						found = found || w != nil && m.At[j] >= from-1e-6 && m.At[j] <= t0+1e-6
					}
					if !found {
						t.Fatalf("%s n=%d %s: inside arc %g–%g not drawn", s.name, s.n, m.Name, from, t0)
					}
				}
				inside = now
			}
		}
		if arcs == 0 {
			t.Fatalf("%s n=%d: the fixture has no inside arc", s.name, s.n)
		}
		// A rosette reaching the window's real edge has images out to 10⁸,
		// whose study-relative refinement may exhaust the budget (n = 3),
		// with or without the search; the arcs are still found.
		if r.Exhausted && s.name != "rosette" {
			t.Fatalf("%s n=%d: exhausted", s.name, s.n)
		}
	}
}

// C(z′) = C(z) exactly when z′ⁿ = zⁿ + 2πik. The marker lists every other
// such source point whose intermediate lies in the window: the turns
// z e^{2πij/n} and the n-th roots of zⁿ + 2πik, k ≠ 0.
func TestLoomCompositeSharedImagePoints(t *testing.T) {
	for n := 2; n <= 6; n++ {
		for _, at := range []float64{0, .7, math.Pi, 5.1} {
			q := compositeLoom("rosette", n)
			q.Source.Radius = .6
			q.Selected, q.Parameter = 1, at
			marker, err := LoomPoint(q)
			if err != nil {
				t.Fatal(err)
			}
			u, w := compositeOf(*marker.Source, n)
			periods := 0
			for k := -10; k <= 10; k++ {
				if math.Abs(imag(u)+2*math.Pi*float64(k)) <= expImag {
					periods++
				}
			}
			want := periods*n - 1
			zero := marker.Source.X == 0 && marker.Source.Y == 0
			if zero {
				// z = 0 is its own turns: only the other periods' roots.
				want = (periods - 1) * n
			}
			if len(marker.Translates) != want {
				t.Fatalf("n=%d θ=%g: %d shared-image points, want %d", n, at, len(marker.Translates), want)
			}
			seen := append([]Vec{*marker.Source}, marker.Translates...)
			for i, z := range marker.Translates {
				v, image := compositeOf(z, n)
				if !nearComplex(Vec{real(image), imag(image)}, w, 1e-11) || !inWindow(v, 1e-9) {
					t.Fatalf("n=%d θ=%g: %v maps to %v, want %v", n, at, z, image, w)
				}
				for _, other := range seen[:i+1] {
					if z.Sub(other).Norm() < 1e-9 {
						t.Fatalf("n=%d θ=%g: %v listed twice or equals the point itself", n, at, z)
					}
				}
			}
			// The turns are listed first, exactly.
			if !zero {
				for j := 1; j < n; j++ {
					turn := complex(marker.Source.X, marker.Source.Y) * cmplx.Rect(1, 2*math.Pi*float64(j)/float64(n))
					if !nearComplex(marker.Translates[j-1], turn, 1e-15) {
						t.Fatalf("n=%d: turn %d is %v, want %v", n, j, marker.Translates[j-1], turn)
					}
				}
			}
		}
	}
	// The periods are counted about zⁿ, not z: at z = 3 + 3i, z² = 18i, so
	// k = −6 … 1 keep 18 + 2πk inside |Im| ≤ 8π, while about Im z = 3 the
	// range would be k = −4 … 3.
	q := compositeLoom("curve", 2)
	q.Source.Curve = Curve{Format: "parametric", X: "3", Y: "3", Min: 0, Max: 1}
	q.Parameter = 0
	marker, err := LoomPoint(q)
	if err != nil {
		t.Fatal(err)
	}
	if *marker.Intermediate != (Vec{0, 18}) || len(marker.Translates) != 8*2-1 {
		t.Fatalf("z = 3 + 3i: intermediate %v, %d shared-image points", marker.Intermediate, len(marker.Translates))
	}
	for _, z := range marker.Translates {
		if v, _ := compositeOf(z, 2); !inWindow(v, 1e-9) || math.Abs(math.Remainder(imag(v)-18, 2*math.Pi)) > 1e-12 {
			t.Fatalf("z = 3 + 3i: %v squares to %v", z, v)
		}
	}
	// Under the exponential alone, the translates are still z + 2πik.
	q = expLoom("grid")
	q.Selected, q.Parameter = 1, .3
	marker, _ = LoomPoint(q)
	for _, z := range marker.Translates {
		if z.X != marker.Source.X || math.Abs(math.Remainder(z.Y-marker.Source.Y, 2*math.Pi)) > 1e-12 {
			t.Fatalf("exp translates changed: %v", marker.Translates)
		}
	}
}

// Sample points of the exponential's period all share one image, so the
// period's guards apply to the intermediate point. On the curve whose
// square is ½ + it, the source moves far less than its intermediate: pilots
// at t = −8π, −4π, 0, 4π and 8π have intermediate quarter probes 2π apart,
// all with one image, but only π/2–3.5 apart in the source. Subdividing by
// intermediate distance, the image still winds sixteen times around the
// circle of radius e^½, and no drawn chord spans more than a quarter period
// of the intermediate.
func TestLoomCompositeAliasingGuardsUseTheIntermediate(t *testing.T) {
	q := compositeLoom("curve", 2)
	x := "sqrt((sqrt(0.25+t^2)+0.5)/2)"
	q.Source.Curve = Curve{Format: "parametric", X: x, Y: "t/(2*" + x + ")", Min: -expImag, Max: expImag}
	q.Samples = 5
	q.Parameter = q.Source.Curve.Min
	r, err := ComputeLoom(q)
	if err != nil {
		t.Fatal(err)
	}
	m := r.Members[0]
	radius := math.Exp(.5)
	gap, drawn := 0.0, 0
	for j := range m.At {
		if m.Image[j] == nil {
			t.Fatalf("broken inside the domain at %g", m.At[j])
		}
		drawn++
		if math.Abs(m.Image[j].Norm()-radius) > 1e-12*radius {
			t.Fatalf("off the circle at %g", m.At[j])
		}
		if j > 0 {
			gap = math.Max(gap, m.At[j]-m.At[j-1])
			a, _ := compositeOf(*m.Source[j-1], 2)
			b, _ := compositeOf(*m.Source[j], 2)
			if cmplx.Abs(b-a) > math.Pi/2 {
				t.Fatalf("chord spans %g of the intermediate", cmplx.Abs(b-a))
			}
		}
	}
	if gap > 2*math.Acos(1-q.Tolerance)*1.0001 || drawn < 8*16 {
		t.Fatalf("aliased chords accepted (%d points, step %g)", drawn, gap)
	}
	if r.Exhausted || len(m.At) > 20000 {
		t.Fatalf("aliasing inflated the work: %d points", len(m.At))
	}
}

// A pilot interval reaching far beyond the domain is divided into at most as
// many pieces as one across the window; here each piece is 8π of the
// intermediate, a whole number of periods with probes 2π apart, all with one
// image. The curve's square is ½ + it from t = −8π. Whatever is drawn, the
// chord guard keeps every drawn chord within a quarter period of the
// intermediate.
func TestLoomCompositeChordGuardUsesTheIntermediate(t *testing.T) {
	q := compositeLoom("curve", 2)
	x := "sqrt((sqrt(0.25+t^2)+0.5)/2)"
	pieces := math.Ceil(2 * math.Hypot(expReal, expImag) / (math.Pi / 4))
	q.Source.Curve = Curve{Format: "parametric", X: x, Y: "t/(2*" + x + ")", Min: -expImag, Max: -expImag + 3*pieces*8*math.Pi}
	q.Samples, q.Tolerance = 4, .05
	q.Parameter = q.Source.Curve.Min
	r, err := ComputeLoom(q)
	if err != nil {
		t.Fatal(err)
	}
	m := r.Members[0]
	drawn := 0
	for j := 1; j < len(m.At); j++ {
		if m.Image[j-1] == nil || m.Image[j] == nil {
			continue
		}
		drawn++
		a, _ := compositeOf(*m.Source[j-1], 2)
		b, _ := compositeOf(*m.Source[j], 2)
		if cmplx.Abs(b-a) > math.Pi/2 {
			t.Fatalf("chord spans %g of the intermediate from %g to %g", cmplx.Abs(b-a), m.At[j-1], m.At[j])
		}
	}
	if drawn == 0 {
		t.Fatal("nothing drawn inside the domain")
	}
}

func TestLoomCompositeIgnoresOtherMapSettings(t *testing.T) {
	q := compositeLoom("grid", 3)
	plain, err := ComputeLoom(q)
	if err != nil {
		t.Fatal(err)
	}
	q.MapParameter, q.ExclusionRadius = -7, 1e9
	q.Coefficients = &LoomCoefficients{}
	other, err := ComputeLoom(q)
	if err != nil {
		t.Fatal(err)
	}
	a, _ := json.Marshal(plain)
	b, _ := json.Marshal(other)
	if string(a) != string(b) {
		t.Fatal("the composite read another map's settings")
	}
}

func TestLoomCompositeDegreeValidation(t *testing.T) {
	for _, degree := range []any{nil, 1, 7, -3} {
		for _, compute := range []func(LoomRequest) error{
			func(q LoomRequest) error { _, err := ComputeLoom(q); return err },
			func(q LoomRequest) error { _, err := LoomPoint(q); return err },
		} {
			var field *FieldError
			if err := compute(compositeLoom("grid", degree)); !errors.As(err, &field) || field.Field != "degree" {
				t.Fatalf("degree %v: %v", degree, err)
			}
		}
	}
	for _, degree := range []int{2, 6} {
		if _, err := ComputeLoom(compositeLoom("grid", degree)); err != nil {
			t.Fatalf("degree endpoint %d refused: %v", degree, err)
		}
	}
}

// Refinement converges with the tolerance, and the densest study across the
// whole domain stays inside the shared budgets; small budgets are honored.
func TestLoomCompositeRefinementConvergesWithinBudgets(t *testing.T) {
	q := compositeLoom("curve", 3)
	q.Source.Curve = Curve{Format: "parametric", X: "cos(t)", Y: "0.8*sin(t)", Min: 0, Max: 2 * math.Pi}
	q.Samples = 4
	errorAt := func(r LoomResult) float64 {
		m := r.Members[0]
		worst := 0.0
		for i := 1; i < len(m.At); i++ {
			s := (m.At[i] + m.At[i-1]) / 2
			_, w := compositeOf(Vec{math.Cos(s), .8 * math.Sin(s)}, 3)
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
	if errorAt(fine) >= errorAt(coarse)/4 {
		t.Fatal("composite refinement did not converge", errorAt(coarse), errorAt(fine))
	}
	for n := 2; n <= 6; n++ {
		limit := math.Pow(expReal*expReal+expImag*expImag, 1/(2*float64(n)))
		dense := compositeLoom("grid", n)
		dense.Source.XCount, dense.Source.YCount = 32, 32
		dense.Source.XMin, dense.Source.XMax, dense.Source.YMin, dense.Source.YMax = -limit, limit, -limit, limit
		dense.Samples, dense.Tolerance = 1024, 1e-6
		r, err := ComputeLoom(dense)
		if err != nil {
			t.Fatal(err)
		}
		if r.Points > LoomMaxPoints || r.Evaluations > LoomMaxEvaluations || r.NumericEntries > LoomMaxNumericEntries {
			t.Fatalf("n=%d: dense composite escaped its budgets: %d %d %d", n, r.Points, r.Evaluations, r.NumericEntries)
		}
		r, err = computeLoom(dense, loomLimits{points: 300, evaluations: 200, depth: 3})
		if err != nil || !r.Exhausted || r.Points > 300 || r.Evaluations > 200 {
			t.Fatalf("n=%d: small budget not honored: %v %+v", n, err, r.Exhausted)
		}
	}
}
