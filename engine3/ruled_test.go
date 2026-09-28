package engine3

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

// ring is the unit circle at height z as a closed harmonic curve.
func ring(z float64) Request {
	return harmonicStudy(0, 2*math.Pi, Vec3{0, 0, z}, HarmonicTerm{1, Vec3{1, 0, 0}, Vec3{0, 1, 0}})
}

func threaded(c Request, x, y, z string, rate, shift float64) Request {
	c.Construction = "ruled"
	c.Ruled = RuledRequest{Partner: "thread", Thread: Thread{x, y, z}, Rate: rate, Shift: shift}
	return c
}

func chords(c Request, rate, shift float64) Request {
	c.Construction = "ruled"
	c.Ruled = RuledRequest{Partner: "chord", Rate: rate, Shift: shift}
	return c
}

func ruled(t *testing.T, c Request) Result {
	t.Helper()
	r, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	if r.Ruled == nil {
		t.Fatal("missing ruled result")
	}
	if _, err := json.Marshal(r); err != nil {
		t.Fatal(err)
	}
	return r
}

// onSegment reports the distance from p to the segment ab.
func onSegment(p, a, b Vec3) float64 {
	d := b.sub(a)
	u := 0.0
	if l := d.dot(d); l > 0 {
		u = math.Max(0, math.Min(1, p.sub(a).dot(d)/l))
	}
	return p.sub(a.add(d.mul(u))).norm()
}

// Two unit rings a(t) at z = −1 and b(t + δ) at z = 1 span the hyperboloid
// x² + y² = cos²(δ/2) + z² sin²(δ/2), whose normal is (x, y, −z sin²(δ/2)).
func TestHyperboloidBetweenRings(t *testing.T) {
	delta := 1.3
	r := ruled(t, threaded(ring(-1), "cos(t)", "sin(t)", "1", 1, delta))
	q := r.Ruled
	if !q.Closed || q.Gap > 1e-12 || q.Developable || q.Deviation < 0.1 || q.Singular != 0 || q.Coincident != 0 || r.Omitted != 0 {
		t.Fatalf("summary %+v omitted %d", q, r.Omitted)
	}
	if len(r.Mesh) != 480*ruledStrips*6 || len(r.Rulings) != 24 {
		t.Fatalf("%d vertices, %d rulings", len(r.Mesh), len(r.Rulings))
	}
	k := math.Pow(math.Sin(delta/2), 2)
	for _, v := range r.Mesh {
		p := v.Position
		if math.Abs(p.X*p.X+p.Y*p.Y-math.Pow(math.Cos(delta/2), 2)-p.Z*p.Z*k) > 1e-12 {
			t.Fatalf("vertex %+v off the hyperboloid", p)
		}
		want := Vec3{p.X, p.Y, -p.Z * k}.unit()
		if math.Abs(v.Normal.norm()-1) > 1e-12 || v.Normal.cross(want).norm() > 1e-6 {
			t.Fatalf("normal %+v, want ±%+v at %+v", v.Normal, want, p)
		}
	}
	// Boundary interpolation: the rings are the two threads.
	for i, p := range r.Plus {
		s := 2*math.Pi*float64(i)/480 + delta
		near(t, p, Vec3{math.Cos(s), math.Sin(s), 1}, 1e-12)
	}
	if len(r.Minus) != 0 {
		t.Fatalf("minus %d", len(r.Minus))
	}
	// The normal turns along each ruling: this surface is not developable.
	first := r.Mesh[0]
	var along []Vertex
	for _, v := range r.Mesh {
		if v.SampleIndex == first.SampleIndex {
			along = append(along, v)
		}
	}
	turned := 0.0
	for _, v := range along {
		turned = math.Max(turned, v.Normal.cross(first.Normal).norm())
	}
	if turned < 0.3 {
		t.Fatalf("normal turns only %g along a ruling", turned)
	}
}

func TestCylinderIsDevelopable(t *testing.T) {
	r := ruled(t, threaded(ring(-1), "cos(t)", "sin(t)", "1", 1, 0))
	if !r.Ruled.Developable || r.Ruled.Deviation > 1e-6 {
		t.Fatalf("cylinder %+v", r.Ruled)
	}
	for _, v := range r.Mesh {
		want := Vec3{v.Position.X, v.Position.Y, 0}
		if v.Normal.cross(want).norm() > 1e-6 {
			t.Fatalf("normal %+v at %+v", v.Normal, v.Position)
		}
	}
}

// Every mesh vertex and ruling lies on the straight segment joining
// corresponding points of the two threads.
func TestRulingsAreStraight(t *testing.T) {
	r := ruled(t, threaded(custom("cos(t)", "sin(2*t)", "0.3*t", 0, 5), "2*cos(t)", "t", "sin(t)^2+1", 0.7, 0.4))
	for _, v := range r.Mesh {
		d := math.Inf(1)
		for _, j := range []int{v.SampleIndex - 1, v.SampleIndex} {
			if j >= 0 && r.Base[j] != nil && r.Plus[j] != nil {
				d = math.Min(d, onSegment(v.Position, *r.Base[j], *r.Plus[j]))
			}
		}
		if d > 1e-12 {
			t.Fatalf("vertex %+v is %g off its rulings", v.Position, d)
		}
	}
	for _, g := range r.Rulings {
		if g.From != *r.Base[g.SampleIndex] || g.To != *r.Plus[g.SampleIndex] {
			t.Fatalf("ruling %+v", g)
		}
	}
	// The partner is b(m t + δ).
	for i, p := range r.Plus {
		s := 0.7*5*float64(i)/480 + 0.4
		near(t, p, Vec3{2 * math.Cos(s), s, math.Pow(math.Sin(s), 2) + 1}, 1e-12)
	}
	if r.Ruled.Closed || r.Ruled.Gap != 0 {
		t.Fatalf("open study %+v", r.Ruled)
	}
}

func TestChordFamilies(t *testing.T) {
	for _, tc := range []struct {
		rate, shift float64
		closed      bool
	}{{1, 2 * math.Pi / 3, true}, {2, 0, true}, {-3, 0.5, true}, {1.5, 0, false}} {
		r := ruled(t, chords(study(), tc.rate, tc.shift))
		c := study()
		for i, p := range r.Plus {
			s := tc.rate*2*math.Pi*float64(i)/480 + tc.shift
			want, _, _ := knot(c, s)
			near(t, p, want, 1e-11)
		}
		if r.Ruled.Closed != tc.closed || (tc.closed && r.Ruled.Gap > 1e-9) || (!tc.closed && r.Ruled.Gap < 0.1) {
			t.Fatalf("rate %g: %+v", tc.rate, r.Ruled)
		}
		for i, b := range r.Ruled.Breaks {
			if b {
				t.Fatalf("rate %g: wrapping broke at %d", tc.rate, i)
			}
		}
	}
}

// On an open curve the partner exists only while m t + δ stays inside the
// domain; outside it the rulings and surface stop, with no invented chord.
func TestChordsStopOutsideOpenDomain(t *testing.T) {
	c := chords(custom("cos(t)", "sin(t)", "0.2*t", 0, 4*math.Pi), 1, math.Pi)
	r := ruled(t, c)
	q := r.Ruled
	if q.Outside != 120 {
		t.Fatalf("outside %d", q.Outside)
	}
	for i, p := range r.Plus {
		if (i > 360) != (p == nil) {
			t.Fatalf("sample %d partner %v", i, p)
		}
	}
	for _, v := range r.Mesh {
		if v.SampleIndex > 360 {
			t.Fatalf("surface past the domain at %d", v.SampleIndex)
		}
	}
	for _, g := range r.Rulings {
		if g.SampleIndex > 360 {
			t.Fatalf("ruling past the domain at %d", g.SampleIndex)
		}
	}
	if !q.Breaks[361] || r.Breaks[361] {
		t.Fatal("the surface must stop where the partner leaves the domain")
	}
	if r.Omitted != 120 {
		t.Fatalf("omitted %d", r.Omitted)
	}
}

// A zero shift makes every chord a point: nothing to draw, reported.
// A constant thread gives a cone, singular at its apex but still shaded.
func TestCoincidentChordsAndCone(t *testing.T) {
	r := ruled(t, chords(study(), 1, 0))
	if r.Ruled.Coincident != 480 || len(r.Mesh) != 0 {
		t.Fatalf("coincident %d mesh %d", r.Ruled.Coincident, len(r.Mesh))
	}
	r = ruled(t, threaded(ring(0), "0", "0", "2", 1, 0))
	q := r.Ruled
	if q.Singular != 480 || q.Coincident != 0 || !q.Developable || len(r.Mesh) == 0 {
		t.Fatalf("cone %+v mesh %d", q, len(r.Mesh))
	}
	for _, v := range r.Mesh {
		if math.Abs(v.Normal.norm()-1) > 1e-12 {
			t.Fatalf("normal %+v at %+v", v.Normal, v.Position)
		}
		// The cone x² + y² = (1 − z/2)² has normal (x, y, (1 − z/2)/2).
		want := Vec3{v.Position.X, v.Position.Y, (1 - v.Position.Z/2) / 2}
		if v.Position.Z < 1.9 && v.Normal.cross(want.unit()).norm() > 1e-6 {
			t.Fatalf("normal %+v at %+v", v.Normal, v.Position)
		}
	}
	// A partner that meets the base at one sample pinches the surface there.
	r = ruled(t, threaded(ring(0), "cos(t)", "sin(t)", "cos(t/2)^2", 1, 0))
	if r.Ruled.Coincident != 1 {
		t.Fatalf("pinch %+v", r.Ruled)
	}
}

// With 480 samples the pole is so close to a midpoint that its velocity is
// unstable; with 240 the midpoint stays regular, so only the jump test sees it.
func TestPartnerPoleBreaksSurface(t *testing.T) {
	for _, tc := range []struct {
		pole           string
		samples, crack int
	}{{"1/(t-1.0021)", 480, 241}, {"1/(t-1.0021)", 240, 121}} {
		c := threaded(custom("t", "0", "0", 0, 2), "t", tc.pole, "1", 1, 0)
		c.Samples = tc.samples
		r := ruled(t, c)
		pole := tc.pole
		breaks := 0
		for i, b := range r.Ruled.Breaks {
			if b {
				breaks++
				if r.Breaks[i] {
					t.Fatal("the base itself does not break")
				}
			}
		}
		if breaks != 1 || r.Omitted != 1 || !r.Ruled.Breaks[tc.crack] {
			t.Fatalf("%s: %d breaks, %d omitted", pole, breaks, r.Omitted)
		}
		// Every face of interval i carries sample index i + 1.
		for _, v := range r.Mesh {
			if r.Ruled.Breaks[v.SampleIndex] {
				t.Fatalf("%s: face across the pole at %+v", pole, v.Position)
			}
		}
	}
}

func TestRuledRigidMotionAndReparameterization(t *testing.T) {
	a := ruled(t, threaded(custom("cos(t)", "sin(t)", "0.3*t", 0, 2*math.Pi), "2*cos(t)", "2*sin(t)", "0.3*t+1", 1, 0.8))
	b := ruled(t, threaded(custom("cos(2*t)+5", "sin(2*t)-2", "0.6*t+7", 0, math.Pi), "2*cos(t)+5", "2*sin(t)-2", "0.3*t+8", 2, 0.8))
	if math.Abs(a.Ruled.Deviation-b.Ruled.Deviation) > 1e-6 || len(a.Mesh) != len(b.Mesh) {
		t.Fatalf("deviation %g vs %g", a.Ruled.Deviation, b.Ruled.Deviation)
	}
	shift := Vec3{5, -2, 7}
	for i := range a.Mesh {
		near(t, b.Mesh[i].Position, a.Mesh[i].Position.add(shift), 1e-9)
		if math.Abs(math.Abs(b.Mesh[i].Normal.dot(a.Mesh[i].Normal))-1) > 1e-6 {
			t.Fatalf("normal %d changed", i)
		}
	}
}

func TestRuledBoundsHoldPartner(t *testing.T) {
	r := ruled(t, threaded(ring(0), "cos(t)", "sin(t)", "40", 1, 0))
	if r.Bounds.Center.Z < 19 || r.Bounds.Radius < 20 {
		t.Fatalf("bounds %+v", r.Bounds)
	}
}

func TestRuledValidation(t *testing.T) {
	good := threaded(ring(0), "cos(t)", "sin(t)", "1", 1, 0)
	for _, tc := range []struct {
		edit func(*Request)
		want string
	}{
		{func(c *Request) { c.Ruled.Partner = "mirror" }, "join the curve to itself or to a second thread"},
		{func(c *Request) { c.Ruled.Rate = math.NaN() }, "the rate m must be finite and within ±100"},
		{func(c *Request) { c.Ruled.Rate = 101 }, "the rate m must be finite and within ±100"},
		{func(c *Request) { c.Ruled.Shift = math.Inf(1) }, "the shift δ must be finite and within ±1000000"},
		{func(c *Request) { c.Ruled.Shift = -2e6 }, "the shift δ must be finite and within ±1000000"},
		{func(c *Request) { c.Ruled.Thread.Y = "sin(" }, "b y(t):"},
		{func(c *Request) { c.Ruled.Thread.Z = "a*t" }, "b z(t):"},
		{func(c *Request) { c.Ruled.Thread.X = "sqrt(-1-t^2)" }, "the second thread has no finite points"},
	} {
		c := good
		tc.edit(&c)
		if _, err := Compute(c); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("want %q, got %v", tc.want, err)
		}
	}
	// The chord partner ignores the thread, which is then not validated.
	c := chords(study(), 1, 1)
	c.Ruled.Thread.X = "sin("
	ruled(t, c)
}
