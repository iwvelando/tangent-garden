package engine

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

func inversionRequest(x, y string, lo, hi float64, center Vec, radius float64) Request {
	q := request("inversion", x, y, lo, hi)
	q.Inversion = Inversion{Center: center, Radius: radius, Of: "curve"}
	return q
}

// sameVec reports whether two optional points agree, gaps included.
func sameVec(t *testing.T, got, want *Vec, tol float64, what string) {
	t.Helper()
	if (got == nil) != (want == nil) || got != nil && got.Sub(*want).Norm() > tol*math.Max(1, want.Norm()) {
		t.Fatalf("%s: got %v, want %v", what, got, want)
	}
}

func TestInvertIdentities(t *testing.T) {
	o, R := Vec{0.3, -1.1}, 1.7
	for _, p := range []Vec{{2, 3}, {-0.4, 0.1}, {0.3, -1.2}, {1e6, -2e6}, {0.3 + 1e-9, -1.1}} {
		i := Invert(p, o, R)
		if i == nil {
			t.Fatalf("no image of %v", p)
		}
		// |I(p) − O||p − O| = R², on the same ray from O. A far point's image
		// is near O, so its offset from O keeps fewer digits.
		if got := i.Sub(o).Norm() * p.Sub(o).Norm(); math.Abs(got-R*R) > 1e-12*R*R*math.Max(1, p.Sub(o).Norm()) {
			t.Fatalf("%v: |I−O||p−O| = %g, want %g", p, got, R*R)
		}
		a, b := p.Sub(o), i.Sub(o)
		if math.Abs(a.Cross(b)) > 1e-12*a.Norm()*b.Norm()*math.Max(1, a.Norm()) || a.Dot(b) <= 0 {
			t.Fatalf("%v and its image %v are not on one ray from O", p, *i)
		}
		// An involution: inverting twice returns the point. The far point's
		// image lost digits beside O, about ε|p||O|/R² of its size.
		sameVec(t, Invert(*i, o, R), &p, 1e-10, "I(I(p))")
	}
	// The circle of inversion is fixed pointwise.
	on := o.Add(Vec{math.Cos(1), math.Sin(1)}.Mul(R))
	sameVec(t, Invert(on, o, R), &on, 1e-15, "a point on the circle")
	// The center goes to infinity, which is no point.
	for _, p := range []Vec{o, {math.NaN(), 0}, {math.Inf(1), 0}} {
		if i := Invert(p, o, R); i != nil {
			t.Fatalf("image of %v is %v", p, *i)
		}
	}
}

// A line at distance d from O maps to a circle through O of diameter R²/d,
// traversed in the opposite sense of rotation about its center. Each
// correspondence segment runs from a point to its image, along a ray from O.
func TestInversionLineToCircle(t *testing.T) {
	q := inversionRequest("0.5", "t", -3, 3, Vec{}, 2)
	r := compute(t, q)
	if r.Invalid != 0 || len(r.Warnings) != 0 || len(breaksOf(r)) != 0 {
		t.Fatalf("%d invalid, breaks %v, %v", r.Invalid, breaksOf(r), r.Warnings)
	}
	center, radius := Vec{4, 0}, 4.0 // R²/(2d)
	for j, p := range r.Derived {
		if p == nil || math.Abs(p.Sub(center).Norm()-radius) > 1e-12*radius {
			t.Fatalf("image %v at %d is off the circle", p, j)
		}
	}
	if r.Inversion == nil || r.Inversion.Center != (Vec{}) || r.Inversion.Radius != 2 || r.Inversion.Source != nil {
		t.Fatalf("inversion %+v", r.Inversion)
	}
	if len(r.Rays) != q.Lines {
		t.Fatalf("%d correspondence segments, want %d", len(r.Rays), q.Lines)
	}
	for _, ray := range r.Rays {
		closeVec(t, &ray.Origin, *r.Base[ray.SampleIndex], 0)
		closeVec(t, ray.Target, *r.Derived[ray.SampleIndex], 0)
		if ray.Origin.Cross(*ray.Target) > 1e-9*ray.Target.Norm() {
			t.Fatalf("segment %d is not on a ray from O", ray.SampleIndex)
		}
	}
}

// A circle not through O maps to a circle; inversion reverses orientation,
// so a counterclockwise circle's image turns clockwise.
func TestInversionCircleToCircle(t *testing.T) {
	q := inversionRequest("3+cos(t)", "sin(t)", 0, 2*math.Pi, Vec{}, 2)
	r := compute(t, q)
	// Distances 2 and 4 from O map to 2 and 1.
	center, radius := Vec{1.5, 0}, 0.5
	for j, p := range r.Derived {
		if p == nil || math.Abs(p.Sub(center).Norm()-radius) > 1e-12 {
			t.Fatalf("image %v at %d is off the circle", p, j)
		}
	}
	area := func(points []*Vec) float64 {
		s := 0.0
		for j := 1; j < len(points); j++ {
			s += points[j-1].Cross(*points[j])
		}
		return s / 2
	}
	if a, b := area(r.Base), area(r.Derived); a <= 0 || b >= 0 {
		t.Fatalf("signed areas %g and %g: orientation not reversed", a, b)
	}
	if len(breaksOf(r)) != 0 || r.Invalid != 0 {
		t.Fatalf("breaks %v, %d invalid", breaksOf(r), r.Invalid)
	}
}

// A circle through O maps to a line. Near O its image runs off to infinity in
// one direction and returns from the other; the two ends are left open, never
// joined across infinity, although no sample lies exactly on O.
func TestInversionCircleThroughCenter(t *testing.T) {
	q := inversionRequest("1+cos(t)", "sin(t)", 0, 2*math.Pi, Vec{}, 2)
	r := compute(t, q)
	breaks := breaksOf(r)
	if len(breaks) != 1 || breaks[0] < 249 || breaks[0] > 251 || !warned(r, "left open") {
		t.Fatalf("breaks %v, %v", breaks, r.Warnings)
	}
	for j, p := range r.Derived {
		if p == nil {
			continue
		}
		// The line x = R²/2, to rounding in the point's own size.
		if math.Abs(p.X-2) > 1e-9*math.Max(1, p.Norm()) {
			t.Fatalf("image %v at %d is off the line x = 2", p, j)
		}
		// Joined images climb the line, t increasing.
		if j > 0 && r.Derived[j-1] != nil && j != breaks[0] && p.Y <= r.Derived[j-1].Y {
			t.Fatalf("joined images descend at %d: %v then %v", j, *r.Derived[j-1], *p)
		}
	}
}

// Between two samples a line passing close to O has an image that reaches
// far beyond both of theirs; it is left open, not cut short by a chord. A line
// passing at a resolved distance is joined, and a line through O is mapped
// onto itself, open where it crosses O.
func TestInversionNearMissBetweenSamples(t *testing.T) {
	// Samples 249 and 250 are at t = −0.003004 and 0.001.
	for _, tc := range []struct {
		delta float64
		open  bool
	}{{0, true}, {1e-12, true}, {1e-9, true}, {4e-4, true}, {0.01, false}, {0.5, false}} {
		q := inversionRequest("t", "a", -1, 1.002, Vec{}, 1)
		q.Curve.A = tc.delta
		r := compute(t, q)
		breaks := breaksOf(r)
		if tc.open != (len(breaks) == 1 && breaks[0] == 250) || !tc.open && len(breaks) != 0 {
			t.Fatalf("δ = %g: breaks %v", tc.delta, breaks)
		}
		for j, p := range r.Derived {
			if p == nil {
				t.Fatalf("δ = %g: gap at %d", tc.delta, j)
			}
			u := sampleT(q, j)
			sameVec(t, p, &Vec{u / (u*u + tc.delta*tc.delta), tc.delta / (u*u + tc.delta*tc.delta)}, 1e-12, "image")
		}
	}
}

// A curve that dips to O and back between two samples, which both lie well
// away from it, is still found: every interval is bisected at least once.
func TestInversionSpikeBetweenSamples(t *testing.T) {
	q := inversionRequest("t", "1-exp(-((t+0.001)/0.0005)^2)", -1, 1.002, Vec{-0.001, 0}, 1)
	if breaks := breaksOf(compute(t, q)); len(breaks) != 1 || breaks[0] != 250 {
		t.Fatalf("breaks %v", breaks)
	}
}

// Where the curve is undefined between two samples, its image is not joined
// across the gap.
func TestInversionUndefinedBetweenSamples(t *testing.T) {
	q := inversionRequest("t", "sqrt((t+0.001)^2-0.0000001)", -1, 1.002, Vec{5, 5}, 1)
	r := compute(t, q)
	if breaks := breaksOf(r); len(breaks) != 1 || breaks[0] != 250 || r.Invalid != 0 {
		t.Fatalf("breaks %v, %d invalid", breaks, r.Invalid)
	}
}

// The hyperbola x² − y² = 1 inverts about its center into Bernoulli's
// lemniscate. The hyperbola runs off to infinity; its image passes through O
// continuously there and is joined.
func TestInversionCrossingInfinity(t *testing.T) {
	q := inversionRequest("1/cos(t)", "tan(t)", 0, 2*math.Pi, Vec{}, 1)
	q.Samples = 1201
	r := compute(t, q)
	if len(breaksOf(r)) != 0 {
		t.Fatalf("breaks %v", breaksOf(r))
	}
	for j, p := range r.Derived {
		if p == nil {
			t.Fatalf("gap at %d", j)
		}
		s := p.Dot(*p)
		if residual := s*s - (p.X*p.X - p.Y*p.Y); math.Abs(residual) > 1e-12 {
			t.Fatalf("image %v at %d is off the lemniscate by %g", *p, j, residual)
		}
	}
	// Near the asymptote the image is within rounding of O.
	if p := r.Derived[300]; p.Norm() > 1e-15 {
		t.Fatalf("image at t = π/2 is %v", *p)
	}
}

// A sample exactly on O has its image at infinity: a gap, which already
// separates its neighbours' images, so no break is added across it.
func TestInversionSampleOnCenter(t *testing.T) {
	q := inversionRequest("t", "t^2", -2, 2, Vec{}, 1)
	q.Samples = 65
	r := compute(t, q)
	if r.Derived[32] != nil || r.Derived[31] == nil || r.Invalid != 1 || !warned(r, "exactly on the center") || len(breaksOf(r)) != 0 {
		t.Fatalf("image %v, %d invalid, breaks %v, %v", r.Derived[32], r.Invalid, breaksOf(r), r.Warnings)
	}
}

// Breaks follow the inverted curve, not the base: the x-axis passes through
// O, but its offset y = 1 does not, and inverts into a whole circle.
func TestInversionUsesTheSourceNotTheBase(t *testing.T) {
	q := inversionRequest("t", "0", -1, 1.002, Vec{}, 1)
	q.Inversion.Of, q.Distance = "offset", 1
	r := compute(t, q)
	if len(breaksOf(r)) != 0 || r.Invalid != 0 {
		t.Fatalf("breaks %v, %d invalid", breaksOf(r), r.Invalid)
	}
	for j, p := range r.Derived {
		if math.Abs(p.Sub(Vec{0, 0.5}).Norm()-0.5) > 1e-12 {
			t.Fatalf("image %v at %d is off the circle", *p, j)
		}
	}
}

// Inverting a curve needs no tangent: a hypocycloid's cusps are inverted
// like every other point.
func TestInversionOfGeneratedCurve(t *testing.T) {
	q := rouletteRequest(Roulette{Roll: "inside", FixedRadius: 4, Radius: 1, Arm: 1}, 0, 2*math.Pi)
	q.Kind = "inversion"
	o := Vec{0.3, 0.2}
	q.Inversion = Inversion{Center: o, Radius: 1.5, Of: "curve"}
	r := compute(t, q)
	if r.Invalid != 0 || len(breaksOf(r)) != 0 {
		t.Fatalf("%d invalid, breaks %v, %v", r.Invalid, breaksOf(r), r.Warnings)
	}
	for j := range r.Base {
		sameVec(t, r.Derived[j], Invert(*r.Base[j], o, 1.5), 0, "image")
	}
	// The cusp at t = 0 is (4, 0).
	closeVec(t, r.Base[0], Vec{4, 0}, 1e-12)
}

// A derived curve is inverted from its own evaluator, point for point the
// same as the construction computed alone.
//
// Each needs the derivatives its construction needs, and no more: on a C¹
// curve whose second derivative is singular at t = 0, only the evolute and
// its image have gaps there.
func TestInversionOfDerivedCurves(t *testing.T) {
	for _, tc := range []struct {
		of, x, y string
		lo, hi   float64
	}{
		{"evolute", "2*cos(t)", "1.1*sin(t)", 0, 2 * math.Pi},
		{"pedal", "2*cos(t)", "1.1*sin(t)", 0, 2 * math.Pi},
		{"contrapedal", "2*cos(t)", "1.1*sin(t)", 0, 2 * math.Pi},
		{"orthotomic", "2*cos(t)", "1.1*sin(t)", 0, 2 * math.Pi},
		{"offset", "2*cos(t)", "1.1*sin(t)", 0, 2 * math.Pi},
		{"evolute", "t", "abs(t)^1.5", -1, 1},
		{"pedal", "t", "abs(t)^1.5", -1, 1},
		{"offset", "t", "abs(t)^1.5", -1, 1},
	} {
		of := tc.of
		alone := request(of, tc.x, tc.y, tc.lo, tc.hi)
		alone.Pole, alone.Distance = Vec{0.4, 0.3}, 0.25
		want := compute(t, alone)
		q := alone
		q.Kind = "inversion"
		o := Vec{0.5, -0.2}
		q.Inversion = Inversion{Center: o, Radius: 1.3, Of: of}
		r := compute(t, q)
		if r.Inversion == nil || len(r.Inversion.Source) != q.Samples {
			t.Fatalf("%s: no source curve in %+v", of, r.Inversion)
		}
		for j := range r.Base {
			sameVec(t, r.Base[j], want.Base[j], 0, of+" base")
			sameVec(t, r.Inversion.Source[j], want.Derived[j], 1e-12, of+" source")
			var image *Vec
			if s := r.Inversion.Source[j]; s != nil {
				image = Invert(*s, o, 1.3)
			}
			sameVec(t, r.Derived[j], image, 0, of+" image")
		}
		if gaps := r.Invalid > 0; gaps != (of == "evolute" && tc.x == "t") {
			t.Fatalf("%s of %s: %d invalid", of, tc.y, r.Invalid)
		}
		// Segments join each source point, not the base point, to its image.
		for _, ray := range r.Rays {
			closeVec(t, &ray.Origin, *r.Inversion.Source[ray.SampleIndex], 0)
			closeVec(t, ray.Target, *r.Derived[ray.SampleIndex], 0)
		}
	}
}

// The pedal of an ellipse about its center, inverted in the unit circle
// there, is its polar reciprocal: the ellipse a²x² + b²y² = 1.
func TestInversionPedalReciprocal(t *testing.T) {
	q := inversionRequest("2*cos(t)", "1.1*sin(t)", 0, 2*math.Pi, Vec{}, 1)
	q.Inversion.Of = "pedal"
	r := compute(t, q)
	for j, p := range r.Derived {
		if p == nil {
			t.Fatalf("gap at %d", j)
		}
		if residual := 4*p.X*p.X + 1.21*p.Y*p.Y - 1; math.Abs(residual) > 1e-9 {
			t.Fatalf("image %v at %d is off the reciprocal ellipse by %g", *p, j, residual)
		}
	}
}

// Where the derived curve is undefined, so is its image; where it needs a
// tangent the curve lacks, the sample is a gap.
func TestInversionDerivedGaps(t *testing.T) {
	// The evolute of a sine has no point at its inflections.
	q := inversionRequest("t", "sin(t)", -1, 1, Vec{0, 3}, 1)
	q.Inversion.Of = "evolute"
	r := compute(t, q)
	if r.Inversion.Source[250] != nil || r.Derived[250] != nil || r.Derived[100] == nil {
		t.Fatalf("evolute at the inflection: %v, image %v", r.Inversion.Source[250], r.Derived[250])
	}
	// With no sample on the inflection the evolute runs through infinity
	// between samples, undefined at the inflection itself: the image, which
	// would pass through O, is left open there.
	q.Curve.Max = 1.002
	r = compute(t, q)
	if breaks := breaksOf(r); len(breaks) != 1 || breaks[0] != 250 || r.Invalid != 0 || !warned(r, "undefined between them") {
		t.Fatalf("breaks %v, %d invalid, %v", breaks, r.Invalid, r.Warnings)
	}
}

// A curve oscillating ever faster about O finishes in bounded work, with
// every image either a gap or on the ray of its point.
func TestInversionBoundedNearWildCurve(t *testing.T) {
	q := inversionRequest("t", "t*sin(1/t)", -1, 1.002, Vec{}, 1)
	q.Samples = 4001
	r := compute(t, q)
	for j, p := range r.Derived {
		if p != nil && r.Base[j].Cross(*p) > 1e-9*p.Norm() {
			t.Fatalf("image %v at %d", *p, j)
		}
	}
	if len(breaksOf(r)) == 0 {
		t.Fatal("no break where the curve crosses O")
	}
}

func TestInversionInvalid(t *testing.T) {
	for _, tc := range []struct {
		change func(*Request)
		want   string
	}{
		{func(q *Request) { q.Inversion.Radius = 0 }, "radius"},
		{func(q *Request) { q.Inversion.Radius = -1 }, "radius"},
		{func(q *Request) { q.Inversion.Radius = math.NaN() }, "radius"},
		{func(q *Request) { q.Inversion.Radius = 2e5 }, "radius"},
		{func(q *Request) { q.Inversion.Center.X = math.Inf(1) }, "center"},
		{func(q *Request) { q.Inversion.Of = "involute" }, "invert"},
		{func(q *Request) { q.Inversion.Of = "" }, "invert"},
		{func(q *Request) { q.Inversion.Of, q.Pole.X = "pedal", math.NaN() }, "pole"},
	} {
		q := inversionRequest("cos(t)", "sin(t)", 0, 1, Vec{}, 1)
		tc.change(&q)
		if _, err := Compute(q); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("want an error about %s, got %v", tc.want, err)
		}
	}
	// A pole the inverted curve does not use is ignored.
	q := inversionRequest("cos(t)", "sin(t)", 0, 1, Vec{3, 0}, 1)
	q.Pole.X = math.NaN()
	compute(t, q)
}

func TestInversionResult(t *testing.T) {
	b, _ := json.Marshal(compute(t, inversionRequest("cos(t)", "sin(t)", 0, 1, Vec{3, 0}, 1)))
	if !strings.Contains(string(b), `"inversion":{"center":{"x":3,"y":0},"radius":1,"breaks":[]}`) {
		t.Fatalf("inversion JSON: %.400s", b)
	}
	q := inversionRequest("cos(t)", "sin(t)", 0, 1, Vec{3, 0}, 1)
	q.Inversion.Of = "offset"
	b, _ = json.Marshal(compute(t, q))
	if !strings.Contains(string(b), `"source":[`) {
		t.Fatalf("derived source JSON: %.400s", b)
	}
	b, _ = json.Marshal(compute(t, request("evolute", "cos(t)", "sin(t)", 0, 1)))
	if strings.Contains(string(b), `"inversion"`) {
		t.Fatal("an evolute carries an inversion")
	}
}
