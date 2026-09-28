package engine

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

func inputRequest(kind, input, x, y string, lo, hi float64) Request {
	q := request(kind, x, y, lo, hi)
	q.Input = input
	return q
}

// Parallel curves share their normals, and so their evolute: the evolute of
// an offset is the curve's own, away from the ellipse's vertices, where the
// offset's curvature changes sign. It needs the base's third derivative,
// through a stencil on a stencil.
func TestInputEvoluteOfOffset(t *testing.T) {
	for _, hi := range []float64{1.3, 6, 0.2 + 16*math.Pi} {
		want := compute(t, request("evolute", "2*cos(t)", "1.1*sin(t)", 0.2, hi))
		q := inputRequest("evolute", "offset", "2*cos(t)", "1.1*sin(t)", 0.2, hi)
		q.Distance, q.Samples, want.Warnings = 0.3, 501, nil
		r := compute(t, q)
		for j := range r.Base {
			s := sampleT(q, j)
			sameVec(t, r.Base[j], want.Base[j], 0, "base")
			sameVec(t, r.Input[j], Offset(Vec{2 * math.Cos(s), 1.1 * math.Sin(s)}, Vec{-2 * math.Sin(s), 1.1 * math.Cos(s)}, 0.3), 1e-9, "offset")
			if math.Abs(math.Sin(2*s)) > 0.2 {
				sameVec(t, r.Derived[j], want.Derived[j], 1e-5, "evolute")
			}
		}
	}
}

// Unwinding a string from an evolute retraces the curve: with the initial
// length equal to the radius of curvature at the domain start, the involute
// of an ellipse's evolute is the ellipse.
func TestInputInvoluteOfEvolute(t *testing.T) {
	lo := 0.1
	q := inputRequest("involute", "evolute", "2*cos(t)", "sin(t)", lo, 1.4)
	q.Samples = 2001
	q.Offset = math.Pow(4*math.Pow(math.Sin(lo), 2)+math.Pow(math.Cos(lo), 2), 1.5) / 2
	r := compute(t, q)
	if r.Invalid != 0 {
		t.Fatalf("%d invalid, %v", r.Invalid, r.Warnings)
	}
	for j := range r.Derived {
		s := sampleT(q, j)
		closeVec(t, r.Derived[j], Vec{2 * math.Cos(s), math.Sin(s)}, 1e-6)
	}
}

// The normals are the evolute's tangents, so the contrapedal is the pedal of
// the evolute, away from the evolute's cusps at the vertices. Segments start
// on the evolute.
func TestInputPedalOfEvolute(t *testing.T) {
	pole := Vec{0.4, 0.3}
	contrapedal := request("contrapedal", "2*cos(t)", "1.1*sin(t)", 0, 2*math.Pi)
	contrapedal.Pole = pole
	want := compute(t, contrapedal)
	q := inputRequest("pedal", "evolute", "2*cos(t)", "1.1*sin(t)", 0, 2*math.Pi)
	q.Pole = pole
	r := compute(t, q)
	for j := range r.Derived {
		sameVec(t, r.Base[j], want.Base[j], 0, "base")
		if math.Abs(math.Sin(2*sampleT(q, j))) > 0.1 {
			closeVec(t, r.Derived[j], *want.Derived[j], 1e-7)
		}
	}
	// The 25 lines include five vertices.
	if len(r.Rays) != q.Lines-5 {
		t.Fatalf("%d segments", len(r.Rays))
	}
	for _, ray := range r.Rays {
		closeVec(t, &ray.Origin, *r.Input[ray.SampleIndex], 0)
	}
}

// The pedal of a circle about a point on it is a cardioid, and the cardioid's
// pedal about its cusp is Cayley's sextic, 4(x² + y² − x/2)³ = 27(x² + y²)²/4
// for the circle of radius 1 through the origin.
func TestInputSecondPedal(t *testing.T) {
	q := inputRequest("pedal", "pedal", "1+cos(t)", "sin(t)", -math.Pi+0.2, math.Pi-0.2)
	q.Samples = 2001
	r := compute(t, q)
	if r.Invalid != 0 {
		t.Fatalf("%d invalid, %v", r.Invalid, r.Warnings)
	}
	for j, p := range r.Derived {
		c := r.Input[j]
		// The cardioid r = 1 + cos θ, as (x² + y² − x)² = x² + y².
		if res := math.Pow(c.Dot(*c)-c.X, 2) - c.Dot(*c); math.Abs(res) > 1e-9 {
			t.Fatalf("input %v at %d is off the cardioid by %g", *c, j, res)
		}
		rr := p.Dot(*p)
		if res := 4*math.Pow(rr-p.X/2, 3) - 27*rr*rr/4; math.Abs(res) > 1e-7 {
			t.Fatalf("second pedal %v at %d is off Cayley's sextic by %g", *p, j, res)
		}
	}
}

// Parallel curves share their normals, so offsetting twice by d where both
// stay regular offsets by 2d.
func TestInputOffsetOfOffset(t *testing.T) {
	once := request("offset", "2*cos(t)", "1.1*sin(t)", 0, 2*math.Pi)
	once.Distance = 0.4
	want := compute(t, once)
	q := inputRequest("offset", "offset", "2*cos(t)", "1.1*sin(t)", 0, 2*math.Pi)
	q.Distance = 0.2
	r := compute(t, q)
	for j := range r.Derived {
		closeVec(t, r.Derived[j], *want.Derived[j], 1e-9)
	}
}

// The offset of a circle is a smaller circle traversed with it, so a circle
// rolling on it is a circular roulette of the smaller radius.
func TestInputRollingOnOffset(t *testing.T) {
	q := inputRequest("rolling", "offset", "7*cos(t)", "7*sin(t)", 0, 4*math.Pi)
	q.Distance, q.Samples = 2, 2001
	q.Rolling = Roller{Side: "left", Radius: 2, Arm: 3, Phase: .4}
	g := Roulette{Roll: "inside", FixedRadius: 5, Radius: 2, Arm: 3, Phase: .4}
	r := compute(t, q)
	if r.Invalid != 0 || len(r.Warnings) != 0 || len(r.Rolling) != q.Lines {
		t.Fatalf("%d invalid, %v, %d positions", r.Invalid, r.Warnings, len(r.Rolling))
	}
	for j := range r.Derived {
		closeVec(t, r.Derived[j], g.state(sampleT(q, j)).Point, 1e-8)
	}
	for _, s := range r.Rolling {
		closeVec(t, &s.Contact, g.state(sampleT(q, s.SampleIndex)).Contact, 1e-8)
	}
}

// Chords and caustics on an offset circle match those on the circle itself.
func TestInputFamiliesOnOffset(t *testing.T) {
	chords := func(x, y string, input string) Request {
		q := inputRequest("envelope", input, x, y, 0, 2*math.Pi)
		q.Distance = 1
		q.Envelope = EnvelopeFamily{Mode: "chord", X: "cos(2*t)", Y: "sin(2*t)"}
		return q
	}
	caustic := func(x, y string, input string) Request {
		q := inputRequest("catacaustic", input, x, y, 0, 2*math.Pi)
		q.Distance, q.Source = 1, Source{Kind: "parallel"}
		return q
	}
	for name, build := range map[string]func(x, y, input string) Request{"chords": chords, "caustic": caustic} {
		want := compute(t, build("cos(t)", "sin(t)", "curve"))
		r := compute(t, build("2*cos(t)", "2*sin(t)", "offset"))
		if r.Invalid != want.Invalid || len(r.Rays) != len(want.Rays) {
			t.Fatalf("%s: %d invalid, %d rays, want %d, %d", name, r.Invalid, len(r.Rays), want.Invalid, len(want.Rays))
		}
		for j := range r.Derived {
			sameVec(t, r.Derived[j], want.Derived[j], 1e-6, name)
		}
		for j := range r.Second {
			sameVec(t, r.Second[j], want.Second[j], 0, "second endpoint")
		}
		for k, ray := range r.Rays {
			closeVec(t, &ray.Origin, want.Rays[k].Origin, 1e-9)
		}
	}
}

// Light from a point reflects off a derived input as off the same curve
// given directly: the pedal of a circle about a point on it is the cardioid
// (1 + cos t)(cos t, sin t), with the same parameter.
func TestInputCausticOfPedal(t *testing.T) {
	want := compute(t, request("catacaustic", "(1+cos(t))*cos(t)", "(1+cos(t))*sin(t)", -2.5, 2.5))
	q := inputRequest("catacaustic", "pedal", "1+cos(t)", "sin(t)", -2.5, 2.5)
	r := compute(t, q)
	if r.Invalid != want.Invalid || len(r.Rays) != len(want.Rays) {
		t.Fatalf("%d invalid, %d rays, want %d, %d", r.Invalid, len(r.Rays), want.Invalid, len(want.Rays))
	}
	for j := range r.Derived {
		sameVec(t, r.Derived[j], want.Derived[j], 1e-6, "caustic")
	}
	for k, ray := range r.Rays {
		closeVec(t, &ray.Direction, want.Rays[k].Direction, 1e-9)
	}
}

// The base is drawn wherever it is defined; where its derived input is not,
// as the evolute at an inflection, only the construction has a gap.
func TestInputGaps(t *testing.T) {
	q := inputRequest("pedal", "evolute", "t", "sin(t)", -1, 1)
	r := compute(t, q)
	if r.Base[250] == nil || r.Input[250] != nil || r.Derived[250] != nil || r.Derived[100] == nil {
		t.Fatalf("at the inflection: base %v, input %v, pedal %v", r.Base[250], r.Input[250], r.Derived[250])
	}
	if r.Invalid == 0 || !warned(r, "no finite construction") {
		t.Fatalf("%d invalid, %v", r.Invalid, r.Warnings)
	}
	// An undefined input is a gap, not a point on the center of inversion,
	// and the involute's string stops there.
	q = inputRequest("inversion", "evolute", "t", "sin(t)", -1, 1)
	q.Inversion = Inversion{Center: Vec{0, 3}, Radius: 1}
	if r = compute(t, q); r.Derived[250] != nil || warned(r, "center of inversion") {
		t.Fatalf("inverted evolute at the inflection: %v, %v", r.Derived[250], r.Warnings)
	}
	q = inputRequest("involute", "evolute", "t", "sin(t)", -1, 1)
	r = compute(t, q)
	if r.Derived[249] == nil || r.Derived[251] != nil || r.Derived[500] != nil || !warned(r, "involute stopped") {
		t.Fatalf("involute past the inflection: %v, %v, %v", r.Derived[249], r.Derived[251], r.Warnings)
	}
	// The offset of |t|^1.5 has unbounded curvature at 0 like the curve, so
	// its evolute's second derivative is ill-conditioned there: a gap.
	q = inputRequest("evolute", "offset", "t", "abs(t)^1.5", -1, 1)
	q.Distance = 0.1
	if r = compute(t, q); r.Derived[250] != nil || r.Derived[100] == nil {
		t.Fatalf("evolute of the offset at 0: %v, at 100: %v", r.Derived[250], r.Derived[100])
	}
	// A generator's own construction is kept at every representative sample.
	q = inputRequest("pedal", "evolute", "", "", 0, 2*math.Pi)
	q.Curve.Format, q.Curve.Roulette = "roulette", Roulette{Roll: "inside", FixedRadius: 3, Radius: 1, Arm: 1}
	r = compute(t, q)
	if len(r.Roulette.Positions) != q.Lines {
		t.Fatalf("%d roulette positions", len(r.Roulette.Positions))
	}
}

func TestInputInvalid(t *testing.T) {
	for _, tc := range []struct {
		change func(*Request)
		want   string
	}{
		{func(q *Request) { q.Input = "involute" }, "construct on"},
		{func(q *Request) { q.Input = "rolling" }, "construct on"},
		{func(q *Request) { q.Input, q.Pole.X = "orthotomic", math.NaN() }, "pole"},
		{func(q *Request) { q.Input = "evolute" }, "fourth derivative"},
		{func(q *Request) { q.Input, q.Kind = "evolute", "catacaustic" }, "fourth derivative"},
		{func(q *Request) { q.Input, q.Kind = "evolute", "diacaustic" }, "fourth derivative"},
	} {
		q := request("evolute", "cos(t)", "sin(t)", 0, 1)
		tc.change(&q)
		if _, err := Compute(q); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("want an error about %s, got %v", tc.want, err)
		}
	}
	// Formats with no parameter have nothing to derive; the input is ignored.
	q := attractorRequest(clifford())
	q.Input = "involute"
	compute(t, q)
}

func TestInputResult(t *testing.T) {
	for input, want := range map[string]bool{"": false, "curve": false, "offset": true} {
		b, _ := json.Marshal(compute(t, inputRequest("evolute", input, "cos(t)", "2*sin(t)", 0, 1)))
		if got := strings.Contains(string(b), `"input":[`); got != want {
			t.Fatalf("input %q: %.300s", input, b)
		}
	}
}

// Where the tangent reverses between samples, at a cusp, a construction
// oriented by the tangent jumps to the other side: offsets, the involute's
// unwinding direction, and a circle envelope's left and right. The jump is a
// gap, never joined. The evolute of an ellipse has cusps at the vertices,
// none of them on a sample here.
func TestInputCuspsBetweenSamples(t *testing.T) {
	for _, tc := range []struct {
		kind  string
		setup func(*Request)
	}{
		{"offset", func(q *Request) { q.Distance = 0.3 }},
		{"offset", func(q *Request) { q.Stack = Stack{Enabled: true, From: -0.3, To: 0.3, Count: 3} }},
		{"involute", func(q *Request) { q.Offset = 0.5 }},
		{"envelope", func(q *Request) { q.Envelope = EnvelopeFamily{Mode: "circle", Radius: "0.2"} }},
	} {
		q := inputRequest(tc.kind, "evolute", "2*cos(t)", "1.1*sin(t)", 0.3, 0.3+2*math.Pi)
		q.Samples = 1000
		tc.setup(&q)
		r := compute(t, q)
		paths := [][]*Vec{r.Derived}
		if len(r.Family) > 0 {
			paths = nil
			for _, m := range r.Family {
				paths = append(paths, m.Points)
			}
		}
		// A joined jump is a step far longer than both of its neighbours.
		step := func(path []*Vec, j int) float64 {
			if j < 1 || j >= len(path) || path[j-1] == nil || path[j] == nil {
				return math.NaN()
			}
			return path[j].Sub(*path[j-1]).Norm()
		}
		for _, path := range paths {
			for j := 1; j < len(path); j++ {
				if d := step(path, j); d > 10*step(path, j-1) && d > 10*step(path, j+1) {
					t.Fatalf("%s: joined across a jump at %d, %v to %v", tc.kind, j, *path[j-1], *path[j])
				}
			}
		}
		if !warned(r, "In 4 places the tangent reverses between samples") {
			t.Fatalf("%s: %v", tc.kind, r.Warnings)
		}
	}
	// The same holds for the curve itself: an astroid's four cusps.
	q := request("offset", "cos(t)^3", "sin(t)^3", 0.3, 0.3+2*math.Pi)
	q.Distance = 0.2
	if r := compute(t, q); !warned(r, "In 4 places the tangent reverses") {
		t.Fatalf("astroid offset: %v", r.Warnings)
	}
	// Constructions indifferent to the tangent's orientation, like the
	// pedal, pass through a cusp continuously.
	q = inputRequest("pedal", "evolute", "2*cos(t)", "1.1*sin(t)", 0.3, 0.3+2*math.Pi)
	q.Samples, q.Pole = 1000, Vec{0.4, 0.3}
	if r := compute(t, q); r.Invalid != 0 || warned(r, "tangent reverses") {
		t.Fatalf("pedal: %d invalid, %v", r.Invalid, r.Warnings)
	}
}
