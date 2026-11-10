package engine

import (
	"encoding/json"
	"math"
	"math/cmplx"
	"slices"
	"testing"
)

// The exponential request is built through JSON, as the worker sends it, so
// these tests fail behaviorally rather than by compilation before the map
// exists. Rational and degree settings ride along to show they are ignored.
func expLoom(source string) LoomRequest {
	q := loomExample(source)
	b, _ := json.Marshal(q)
	var fields map[string]any
	_ = json.Unmarshal(b, &fields)
	fields["map"] = "exp"
	b, _ = json.Marshal(fields)
	_ = json.Unmarshal(b, &q)
	return q
}

// The declared window, written independently of the engine's constants:
// |Re z| ≤ ln 10⁸ and |Im z| ≤ 8π.
var expReal, expImag = 8 * math.Log(10), 8 * math.Pi

// Independent exponential: math/cmplx, not the engine's e^x(cos y, sin y).
func nearExp(w, p Vec) bool {
	want := cmplx.Exp(complex(p.X, p.Y))
	return math.Hypot(w.X-real(want), w.Y-imag(want)) <= 1e-13*math.Max(cmplx.Abs(want), 1)
}

func TestLoomExpReturnedGeometryMatchesTheExponential(t *testing.T) {
	for _, kind := range []string{"grid", "concentric", "rosette", "curve"} {
		q := expLoom(kind)
		q.Degree, q.MapParameter, q.ExclusionRadius = 9, .5, .1
		r, err := ComputeLoom(q)
		if err != nil {
			t.Fatalf("%s: %v", kind, err)
		}
		drawn := 0
		for _, m := range r.Members {
			if len(m.Intervals) != 0 {
				t.Fatalf("%s: unexpected gaps %+v", kind, m.Intervals)
			}
			for j, p := range m.Source {
				w := m.Image[j]
				if p == nil || w == nil {
					t.Fatalf("%s: broken path inside the window", kind)
				}
				drawn++
				if !nearExp(*w, *p) {
					t.Fatalf("%s: %v -> %v, want %v", kind, p, w, cmplx.Exp(complex(p.X, p.Y)))
				}
				// exp′ = exp never vanishes: no critical point, even at zero.
				if m.Critical[j] {
					t.Fatalf("%s: exp has no critical point, but %v is marked", kind, p)
				}
			}
		}
		if drawn < 16 {
			t.Fatal("fixture drew too little")
		}
	}
}

// Vertical lines map to circles of radius e^x and horizontal lines to rays
// at angle y; the derivative exp′ = exp appears as w′(t) = i w for a vertical
// line z = x + it, measured from returned neighbors.
func TestLoomExpLinesBecomeRingsAndSpokesWithDerivativeExp(t *testing.T) {
	q := expLoom("grid")
	q.Source.XCount, q.Source.YCount = 5, 7
	q.Source.XMin, q.Source.XMax, q.Source.YMin, q.Source.YMax = -1, 1.5, -math.Pi, math.Pi
	q.Tolerance = 1e-5
	r, err := ComputeLoom(q)
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range r.Members[:5] {
		x := m.Source[0].X
		for j, w := range m.Image {
			if math.Abs(w.Norm()-math.Exp(x)) > 1e-13*math.Exp(x) {
				t.Fatalf("%s: radius %g, want e^%g", m.Name, w.Norm(), x)
			}
			if d := math.Remainder(math.Atan2(w.Y, w.X)-m.At[j], 2*math.Pi); math.Abs(d) > 1e-12 {
				t.Fatalf("%s: angle off by %g at y = %g", m.Name, d, m.At[j])
			}
		}
		worst := 0.0
		for j := 1; j < len(m.At); j++ {
			h := m.At[j] - m.At[j-1]
			mid := cmplx.Exp(complex(x, (m.At[j]+m.At[j-1])/2))
			slope := complex((m.Image[j].X-m.Image[j-1].X)/h, (m.Image[j].Y-m.Image[j-1].Y)/h)
			// A central difference of e^{x+it} is i·e^{x+it}·sinc(h/2).
			worst = math.Max(worst, cmplx.Abs(slope-1i*mid)/cmplx.Abs(mid))
		}
		if worst > 1e-3 {
			t.Fatalf("%s: dw/dt differs from i·exp(z) by %g", m.Name, worst)
		}
	}
	for _, m := range r.Members[5:] {
		y := m.Source[0].Y
		for j, w := range m.Image {
			if math.Abs(w.Norm()-math.Exp(m.At[j])) > 1e-13*math.Exp(m.At[j]) ||
				math.Abs(w.X*math.Sin(y)-w.Y*math.Cos(y)) > 1e-13*w.Norm() {
				t.Fatalf("%s: %v is not on the ray at angle %g", m.Name, w, y)
			}
		}
	}
}

// exp(z + 2πik) = exp(z). Source members a period apart keep their own IDs
// and names while their images coincide, and the marker reports every other
// source point of the window with the same image.
func TestLoomExpPeriodicCorrespondenceKeepsSourceIdentities(t *testing.T) {
	q := expLoom("grid")
	q.Source.XCount, q.Source.YCount = 3, 5
	q.Source.XMin, q.Source.XMax, q.Source.YMin, q.Source.YMax = -1, 1, -2*math.Pi, 2*math.Pi
	q.Samples = 64
	q.Selected, q.Parameter = 1, .3
	r, err := ComputeLoom(q)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Members) != 8 {
		t.Fatalf("members were merged: %d", len(r.Members))
	}
	// Horizontals at y = −2π, 0 and 2π are members 3, 5 and 7.
	low, mid, high := r.Members[3], r.Members[5], r.Members[7]
	if low.Name == mid.Name || mid.Name == high.Name || low.ID == high.ID {
		t.Fatal("coincident images lost their source identities")
	}
	for _, m := range []LoomMember{low, high} {
		if len(m.At) != len(mid.At) {
			t.Fatalf("%s refined differently from its translate", m.Name)
		}
		for j := range m.At {
			if m.At[j] != mid.At[j] || math.Abs(m.Source[j].Y-mid.Source[j].Y) < 6 {
				t.Fatalf("%s: source parameter or position merged", m.Name)
			}
			if d := m.Image[j].Sub(*mid.Image[j]).Norm(); d > 1e-13*math.Max(1, mid.Image[j].Norm()) {
				t.Fatalf("%s: periodic image differs by %g", m.Name, d)
			}
		}
	}
	// The marker at z = 0.3i (vertical line x = 0) and its translates.
	z := r.Marker.Source
	if z == nil || r.Marker.Image == nil || z.X != 0 || z.Y != .3 {
		t.Fatalf("unexpected marker %+v", r.Marker)
	}
	var want []float64
	for k := -10; k <= 10; k++ {
		if y := .3 + 2*math.Pi*float64(k); k != 0 && math.Abs(y) <= expImag {
			want = append(want, y)
		}
	}
	if len(want) != 7 || len(r.Marker.Translates) != len(want) {
		t.Fatalf("translates %v, want imaginary parts %v", r.Marker.Translates, want)
	}
	for i, p := range r.Marker.Translates {
		if p.X != 0 || math.Abs(p.Y-want[i]) > 1e-14*math.Abs(want[i]) || !nearExp(*r.Marker.Image, p) {
			t.Fatalf("translate %d: %v, want 0 + %gi with the marker's image", i, p, want[i])
		}
	}
	point, err := LoomPoint(q)
	if err != nil || !slices.Equal(point.Translates, r.Marker.Translates) {
		t.Fatalf("point-only marker disagrees: %v %+v", err, point)
	}
	// Other maps carry no translates.
	q.Map = "square"
	if p, _ := LoomPoint(q); p.Translates != nil {
		t.Fatal("squaring reported periodic translates")
	}
}

// A circle |z| = R reaches its largest image e^R at θ = 0 and its smallest
// e^−R at θ = π; a rotated circle through zero passes through exp(0) = 1.
func TestLoomExpExtremaAndRosetteThroughOne(t *testing.T) {
	q := expLoom("concentric")
	q.Source.Count, q.Source.Radius, q.Samples = 4, 3, 33
	r, err := ComputeLoom(q)
	if err != nil {
		t.Fatal(err)
	}
	for i, m := range r.Members {
		R := 3 * float64(i+1) / 4
		lo, hi := math.Inf(1), 0.
		for _, w := range m.Image {
			lo, hi = math.Min(lo, w.Norm()), math.Max(hi, w.Norm())
		}
		if math.Abs(hi-math.Exp(R)) > 1e-13*math.Exp(R) || math.Abs(lo-math.Exp(-R)) > 1e-13*math.Exp(-R) {
			t.Fatalf("%s: image radii %g–%g, want e^∓%g", m.Name, lo, hi, R)
		}
		if w := m.Image[0]; w.Y != 0 || w != m.Image[len(m.Image)-1] && w.Sub(*m.Image[len(m.Image)-1]).Norm() > 1e-12*hi {
			t.Fatalf("%s: does not close at e^R", m.Name)
		}
	}
	q = expLoom("rosette")
	q.Parameter = math.Pi
	r, err = ComputeLoom(q)
	if err != nil {
		t.Fatal(err)
	}
	if w := r.Marker.Image; w == nil || *w != (Vec{1, 0}) || r.Marker.Critical {
		t.Fatalf("zero should map to exactly 1, regular: %+v", r.Marker)
	}
}

// The declared window is closed: |Re z| ≤ ln 10⁸ and |Im z| ≤ 8π. Points
// beyond it are clipped, so images stay in 10⁻⁸ ≤ |w| ≤ 10⁸; analytic lines
// and circles break at their exact crossings, with nothing joined across.
func TestLoomExpWindowBoundariesOnAnalyticFamilies(t *testing.T) {
	check := func(name string, r LoomResult, cuts map[int][]float64) {
		t.Helper()
		for _, m := range r.Members {
			for j, p := range m.Source {
				w := m.Image[j]
				if w == nil {
					continue
				}
				// An exact crossing is drawn even when its rounded source
				// lies a rounding error outside the closed window.
				if math.Abs(p.X) > expReal*(1+1e-14) || math.Abs(p.Y) > expImag*(1+1e-14) {
					t.Fatalf("%s %s: %v beyond the window drawn", name, m.Name, p)
				}
				if w.Norm() > 1e8*(1+1e-12) || w.Norm() < 1e-8*(1-1e-12) {
					t.Fatalf("%s %s: image radius %g outside the annulus", name, m.Name, w.Norm())
				}
			}
			want := cuts[m.ID]
			var got []float64
			for _, g := range m.Intervals {
				if g.Reason != "clipped" {
					t.Fatalf("%s %s: unexpected %s gap", name, m.Name, g.Reason)
				}
				for _, v := range []float64{g.From, g.To} {
					if v != m.Min && v != m.Max {
						got = append(got, v)
					}
				}
			}
			if len(got) != len(want) {
				t.Fatalf("%s %s: gap ends %v, want crossings %v", name, m.Name, got, want)
			}
			// Each crossing is a pilot node: drawn when it rounds inside
			// the window, otherwise bracketed by bisection from it.
			for i := range got {
				if math.Abs(got[i]-want[i]) > 1e-9*math.Max(1, math.Abs(want[i])) {
					t.Fatalf("%s %s: gap end %g, want crossing %g", name, m.Name, got[i], want[i])
				}
			}
		}
	}
	q := expLoom("grid")
	q.Source.XCount, q.Source.YCount = 3, 3
	q.Source.XMin, q.Source.XMax, q.Source.YMin, q.Source.YMax = -30, 30, -40, 40
	r, err := ComputeLoom(q)
	if err != nil {
		t.Fatal(err)
	}
	// Verticals at x = −30, 0, 30 and horizontals at y = −40, 0, 40: only
	// x = 0 and y = 0 enter, crossing at ±8π and ±ln 10⁸.
	check("grid", r, map[int][]float64{1: {-expImag, expImag}, 4: {-expReal, expReal}})
	for _, id := range []int{0, 2, 3, 5} {
		m := r.Members[id]
		if len(m.Intervals) != 1 || m.Intervals[0].From != m.Min || m.Intervals[0].To != m.Max {
			t.Fatalf("%s outside the window is not one clipped interval: %+v", m.Name, m.Intervals)
		}
	}
	// A concentric circle of radius 20 leaves through x = ±ln 10⁸ only. Its
	// images span sixteen orders of magnitude, so a coarse study-relative
	// tolerance keeps it within budget.
	q = expLoom("concentric")
	q.Source.Count, q.Source.Radius, q.Samples, q.Tolerance = 1, 20, 32, .05
	r, err = ComputeLoom(q)
	if err != nil {
		t.Fatal(err)
	}
	a := math.Acos(expReal / 20)
	check("circle", r, map[int][]float64{0: {a, math.Pi - a, math.Pi + a, 2*math.Pi - a}})
	// A circle of radius 26 is inside only on four narrow arcs, between
	// |x| = ln 10⁸ and |y| = 8π; its four pilots (θ = 0, 2π/3, 4π/3, 2π) miss
	// the first and last of them, which the crossings still find.
	q.Source.Radius, q.Samples = 26, 4
	r, err = ComputeLoom(q)
	if err != nil {
		t.Fatal(err)
	}
	a, b := math.Acos(expReal/26), math.Asin(expImag/26)
	check("narrow arcs", r, map[int][]float64{0: {a, b, math.Pi - b, math.Pi - a, math.Pi + a, math.Pi + b, 2*math.Pi - b, 2*math.Pi - a}})
	drawn := 0
	for _, w := range r.Members[0].Image {
		if w != nil {
			drawn++
		}
	}
	if drawn < 16 {
		t.Fatalf("narrow arcs drew only %d points", drawn)
	}
}

// A circle meets the lines through the window's edges beyond its corners
// too. Those crossings are outside the closed window: nothing there is drawn,
// so no image leaves the annulus and a circle wholly outside stays one
// clipped interval.
func TestLoomExpCrossingsBeyondTheCornersAreClipped(t *testing.T) {
	for _, c := range []struct {
		kind   string
		radius float64
		count  int
	}{
		// |z| = 40 exceeds the corner distance, about 31.16, everywhere,
		// yet the circle meets x = ±ln 10⁸ and y = ±8π.
		{"concentric", 40, 1},
		// The circle centered at 20i meets y = 8π at |x| ≈ 19.33 and
		// x = ±ln 10⁸ at y ≈ 27.79, both beyond the corner.
		{"rosette", 20, 4},
	} {
		q := expLoom(c.kind)
		q.Source.Count, q.Source.Radius, q.Samples, q.Tolerance = c.count, c.radius, 32, .05
		r, err := ComputeLoom(q)
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range r.Members {
			for j, p := range m.Source {
				w := m.Image[j]
				if p == nil || w == nil {
					continue
				}
				if math.Abs(p.X) > expReal*(1+1e-14) || math.Abs(p.Y) > expImag*(1+1e-14) {
					t.Fatalf("%s %s: %v beyond the window drawn as %v", c.kind, m.Name, *p, *w)
				}
				if w.Norm() > 1e8*(1+1e-12) || w.Norm() < 1e-8*(1-1e-12) {
					t.Fatalf("%s %s: image radius %g outside the annulus", c.kind, m.Name, w.Norm())
				}
			}
		}
		if c.kind == "concentric" {
			m := r.Members[0]
			if len(m.Intervals) != 1 || m.Intervals[0].From != m.Min || m.Intervals[0].To != m.Max || m.Intervals[0].Reason != "clipped" {
				t.Fatalf("circle wholly outside the window is not one clipped interval: %+v", m.Intervals)
			}
		}
	}
}

// The window is closed: lines on its edges are drawn whole.
func TestLoomExpWindowIsClosed(t *testing.T) {
	q := expLoom("grid")
	q.Source.XCount, q.Source.YCount = 2, 2
	q.Source.XMin, q.Source.XMax = LoomExpRealLimit-1, LoomExpRealLimit
	q.Source.YMin, q.Source.YMax = LoomExpImagLimit-1, LoomExpImagLimit
	q.Parameter = q.Source.YMin
	r, err := ComputeLoom(q)
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range r.Members {
		if len(m.Intervals) != 0 {
			t.Fatalf("%s on the window's edge was clipped: %+v", m.Name, m.Intervals)
		}
	}
	if p, _ := LoomPoint(q); p.Image == nil {
		t.Fatal("marker on the edge was clipped")
	}
}

// Selected curves locate their window exits by one-sided bisection, and a
// curve wholly outside is an honest empty image.
func TestLoomExpWindowOnCurvesAndEmptyImages(t *testing.T) {
	q := expLoom("curve")
	q.Source.Curve.X, q.Source.Curve.Y = "t", "t/4"
	q.Source.Curve.Min, q.Source.Curve.Max = 0, 30
	q.Samples, q.Parameter = 16, 29
	r, err := ComputeLoom(q)
	if err != nil {
		t.Fatal(err)
	}
	m := r.Members[0]
	if len(m.Intervals) != 1 || m.Intervals[0].Reason != "clipped" || m.Intervals[0].To != 30 {
		t.Fatalf("missing clipped tail: %+v", m.Intervals)
	}
	if from := m.Intervals[0].From; from > expReal || expReal-from > 2./65536 {
		t.Fatalf("exit at %g not localized near %g", from, expReal)
	}
	if r.Marker.Image != nil || r.Marker.Translates != nil {
		t.Fatalf("clipped marker drawn: %+v", r.Marker)
	}
	for _, x := range []string{"40+t", "t", "1e300*t"} {
		q := expLoom("curve")
		q.Source.Curve.X, q.Source.Curve.Y = x, "100"
		r, err := ComputeLoom(q)
		if err != nil {
			t.Fatal(err)
		}
		m := r.Members[0]
		for _, w := range m.Image {
			if w != nil {
				t.Fatal("image beyond the window delivered")
			}
		}
		if len(m.Intervals) != 1 || m.Intervals[0].Reason != "clipped" || m.Intervals[0].From != m.Min || m.Intervals[0].To != m.Max {
			t.Fatalf("empty image is not one clipped interval: %+v", m.Intervals)
		}
		if r.Exhausted || r.Evaluations > 2*q.Samples {
			t.Fatalf("an empty image should settle without refinement: %+v", r)
		}
	}
}

// Pilot samples a whole number of periods apart all map to one point, and so
// do their quarter probes. The loom must not accept that as a drawn point:
// the image must go around its circle, at the tolerance of a real turn.
func TestLoomExpAliasedSamplesStillWindAround(t *testing.T) {
	for _, kind := range []string{"curve", "grid", "clipped"} {
		q := expLoom(kind)
		q.Samples = 5
		if kind == "clipped" {
			// Pilots at −25π, −9π, 7π and 23π: −9π and 23π are outside the
			// window, so bisection toward them, not pilot subdivision, makes
			// the chord from −π to 7π, whose probes are all at angle π.
			q = expLoom("curve")
			q.Samples = 4
			q.Source.Curve.X, q.Source.Curve.Y = ".5", "t"
			q.Source.Curve.Min, q.Source.Curve.Max = -25*math.Pi, 23*math.Pi
		} else if kind == "curve" {
			// Pilots at t = −8π, −4π, 0, 4π, 8π, quarter probes 2π apart.
			q.Source.Curve.X, q.Source.Curve.Y = ".5", "t"
			q.Source.Curve.Min, q.Source.Curve.Max = -expImag, expImag
		} else {
			q.Source.XCount, q.Source.YCount = 1, 1
			q.Source.XMin, q.Source.XMax, q.Source.YMin, q.Source.YMax = 0, 1, -expImag, expImag
		}
		q.Parameter = 0
		if kind != "grid" {
			q.Parameter = q.Source.Curve.Min
		} else {
			q.Parameter = q.Source.YMin
		}
		r, err := ComputeLoom(q)
		if err != nil {
			t.Fatal(err)
		}
		m := r.Members[0]
		radius := math.Exp(.5)
		gap, drawn := 0.0, 0
		for j := range m.At {
			if m.Image[j] == nil {
				// A bisected exit breaks near the edge, not inside.
				if kind != "clipped" || math.Abs(m.At[j]) < expImag-.01 {
					t.Fatalf("%s: broken inside the window at %g", kind, m.At[j])
				}
				continue
			}
			drawn++
			if math.Abs(m.Image[j].Norm()-radius) > 1e-12*radius {
				t.Fatalf("%s: off the circle at %g", kind, m.At[j])
			}
			if j > 0 && m.Image[j-1] != nil {
				gap = math.Max(gap, m.At[j]-m.At[j-1])
			}
		}
		// Sixteen turns at 0.0005 of the radius need more than 8·16 chords;
		// the angular step bounds the sagitta, 1 − cos(step/2) ≤ 0.0005.
		if gap > 2*math.Acos(1-q.Tolerance)*1.0001 || drawn < 8*16 {
			t.Fatalf("%s: aliased chords accepted (%d points, step %g)", kind, drawn, gap)
		}
		if r.Exhausted || len(m.At) > 20000 {
			t.Fatalf("%s: aliasing inflated the work: %d points", kind, len(m.At))
		}
	}
}

// A pilot interval reaching far beyond the window is divided into at most as
// many pieces as one across it; here each piece is 8π, a whole number of
// periods with probes 2π apart. Whatever is delivered, no drawn chord spans
// more than a quarter period of source.
func TestLoomExpNoDrawnChordSpansAQuarterPeriod(t *testing.T) {
	q := expLoom("curve")
	q.Samples, q.Tolerance = 4, .05
	q.Source.Curve.X, q.Source.Curve.Y = ".5", "t"
	pieces := math.Ceil(2 * math.Hypot(expReal, expImag) / (math.Pi / 4))
	q.Source.Curve.Min = -expImag
	q.Source.Curve.Max = -expImag + 3*pieces*8*math.Pi
	q.Parameter = q.Source.Curve.Min
	r, err := ComputeLoom(q)
	if err != nil {
		t.Fatal(err)
	}
	m := r.Members[0]
	drawn := 0
	for j := 1; j < len(m.At); j++ {
		a, b := m.Source[j-1], m.Source[j]
		if a == nil || b == nil || m.Image[j-1] == nil || m.Image[j] == nil {
			continue
		}
		drawn++
		if d := b.Sub(*a).Norm(); d > math.Pi/2 {
			t.Fatalf("chord of source length %g drawn from %g to %g", d, m.At[j-1], m.At[j])
		}
	}
	if drawn == 0 {
		t.Fatal("nothing drawn inside the window")
	}
}

// Exp has no parameter, pole, exclusion, critical point or map motion; the
// rational and power settings it carries are ignored.
func TestLoomExpIgnoresOtherMapSettings(t *testing.T) {
	q := expLoom("rosette")
	plain, err := ComputeLoom(q)
	if err != nil {
		t.Fatal(err)
	}
	q.Degree, q.MapParameter, q.ExclusionRadius = 99, -7, 1e9
	other, err := ComputeLoom(q)
	if err != nil {
		t.Fatal(err)
	}
	a, _ := json.Marshal(plain)
	b, _ := json.Marshal(other)
	if string(a) != string(b) {
		t.Fatal("exp read another map's settings")
	}
}

func TestLoomExpRefinementConvergesWithinBudgets(t *testing.T) {
	q := expLoom("curve")
	q.Source.Curve.X, q.Source.Curve.Y = "2*cos(t)", "3*sin(t)"
	q.Source.Curve.Min, q.Source.Curve.Max = 0, 2*math.Pi
	q.Samples = 4
	errorAt := func(r LoomResult) float64 {
		m := r.Members[0]
		worst := 0.0
		for i := 1; i < len(m.At); i++ {
			s := (m.At[i] + m.At[i-1]) / 2
			w := cmplx.Exp(complex(2*math.Cos(s), 3*math.Sin(s)))
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
		t.Fatal("exp refinement did not converge", errorAt(coarse), errorAt(fine))
	}
	// The densest admitted grid, reaching across the whole window.
	dense := expLoom("grid")
	dense.Source.XCount, dense.Source.YCount = 32, 32
	dense.Source.XMin, dense.Source.XMax, dense.Source.YMin, dense.Source.YMax = -expReal, expReal, -expImag, expImag
	dense.Samples, dense.Tolerance = 1024, 1e-6
	r, err := ComputeLoom(dense)
	if err != nil {
		t.Fatal(err)
	}
	if r.Points > LoomMaxPoints || r.Evaluations > LoomMaxEvaluations || r.NumericEntries > LoomMaxNumericEntries {
		t.Fatalf("dense exp study escaped its budgets: %d %d %d", r.Points, r.Evaluations, r.NumericEntries)
	}
	r, err = computeLoom(dense, loomLimits{points: 300, evaluations: 200, depth: 3})
	if err != nil || !r.Exhausted || r.Points > 300 || r.Evaluations > 200 {
		t.Fatalf("small budget not honored: %v %+v", err, r.Exhausted)
	}
}
