package engine3

import (
	"encoding/json"
	"math"
	"strings"
	"testing"

	"tangentgarden/engine"
)

func involuteStudy(x, y, z string, lo, hi, anchor, offset float64) Request {
	c := custom(x, y, z, lo, hi)
	c.Construction = "involute"
	c.Involute = InvoluteRequest{Anchor: anchor, Offset: offset}
	return c
}
func involute(t *testing.T, c Request) Result {
	t.Helper()
	r, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	if r.Involute == nil {
		t.Fatal("no involute result")
	}
	if _, err := json.Marshal(r); err != nil {
		t.Fatal(err)
	}
	return r
}

// The helix r=(2cos t, 2sin t, a t/3) has speed k=√(4+a²/9), so s=k(t−t₀).
// Each involute lies in the plane z = a t₀/3 + c a/(3k): an unwound circle.
func TestHelixInvoluteArcLengthAndSegments(t *testing.T) {
	c := involuteStudy("2*cos(t)", "2*sin(t)", "a*t/3", -2*math.Pi, 2*math.Pi, 0.7, 1.3)
	r := involute(t, c)
	k := math.Sqrt(4 + 1.0/9)
	member := r.Involute.Members[0]
	if len(member.Points) != c.Samples+1 || member.Offset != 1.3 || r.Involute.Unreached != 0 {
		t.Fatalf("unexpected member %d %g %d", len(member.Points), member.Offset, r.Involute.Unreached)
	}
	for i, p := range member.Points {
		u := c.Curve.Min + (c.Curve.Max-c.Curve.Min)*float64(i)/float64(c.Samples)
		s := k * (u - 0.7)
		base := Vec3{2 * math.Cos(u), 2 * math.Sin(u), u / 3}
		tangent := Vec3{-2 * math.Sin(u), 2 * math.Cos(u), 1.0 / 3}.unit()
		near(t, p, base.add(tangent.mul(1.3-s)), 1e-8)
		if math.Abs(p.sub(base).norm()-math.Abs(1.3-s)) > 1e-8 {
			t.Fatal("string length is not |c−s|")
		}
		if math.Abs(p.Z-(0.7/3+1.3/(3*k))) > 1e-8 {
			t.Fatal("helix involute left its plane")
		}
	}
}

// dI/ds = (c−s) dT/ds, so the filament's tangent is perpendicular to T. A
// central chord's component along T falls at second order.
func TestInvoluteTangentOrthogonal(t *testing.T) {
	c := study()
	c.Construction = "involute"
	c.Involute = InvoluteRequest{Anchor: 1, Offset: 2}
	worst := func(n int) float64 {
		c.Samples = n
		r := involute(t, c)
		points := r.Involute.Members[0].Points
		max := 0.0
		for i := 1; i < n; i++ {
			if points[i].sub(*r.Base[i]).norm() < 0.2 {
				continue // near the cusp s = c the filament is nearly stationary
			}
			_, v, _ := knot(c, 2*math.Pi*float64(i)/float64(n))
			max = math.Max(max, math.Abs(points[i+1].sub(*points[i-1]).unit().dot(v.unit())))
		}
		return max
	}
	coarse, fine := worst(480), worst(1920)
	if fine > coarse/12 || fine > 2e-3 {
		t.Fatalf("filament tangent not normal to T: %g -> %g", coarse, fine)
	}
}

// The cusp s=c touches the base curve and stays in the filament.
func TestInvoluteKeepsCusp(t *testing.T) {
	c := involuteStudy("2*cos(t)", "2*sin(t)", "t/3", 0, 2, 0, 0)
	c.Samples = 480
	k := math.Sqrt(4 + 1.0/9)
	c.Involute.Offset = k * 1 // s = c at t = 1, sample 240
	r := involute(t, c)
	p := r.Involute.Members[0].Points[240]
	if p == nil {
		t.Fatal("cusp removed")
	}
	near(t, p, *r.Base[240], 1e-9)
}

// Embedded in z=0, the involute agrees with the planar engine, whose
// convention I = r − (s + c_planar)T means c = −c_planar here.
func TestPlanarCircleInvoluteAgrees(t *testing.T) {
	c := involuteStudy("cos(t)", "sin(t)", "0", 0, 2*math.Pi, 0, -0.7)
	c.Samples = 500
	r := involute(t, c)
	q := engine.Request{Kind: "involute", Curve: engine.Curve{Format: "parametric", X: "cos(t)", Y: "sin(t)", Min: 0, Max: 2 * math.Pi}, Offset: 0.7, NIncident: 1, NTransmitted: 1.5, Samples: 501, Lines: 25}
	want, err := engine.Compute(q)
	if err != nil {
		t.Fatal(err)
	}
	for i, p := range r.Involute.Members[0].Points {
		w := want.Derived[i]
		near(t, p, Vec3{w.X, w.Y, 0}, 1e-9)
	}
}

// A rigid motion of the curve moves its involute the same way.
func TestInvoluteRigidMotion(t *testing.T) {
	a := involute(t, involuteStudy("2*cos(t)", "sin(t)", "t/2", 0, 5, 1, 0.4))
	// Rotate by 90° about z, then translate by (3, −1, 2).
	b := involute(t, involuteStudy("-sin(t)+3", "2*cos(t)-1", "t/2+2", 0, 5, 1, 0.4))
	for i, p := range a.Involute.Members[0].Points {
		near(t, b.Involute.Members[0].Points[i], Vec3{-p.Y + 3, p.X - 1, p.Z + 2}, 1e-8)
	}
}

// A regular reparameterization with a corresponding anchor gives the same
// filament points at corresponding parameters.
func TestInvoluteReparameterization(t *testing.T) {
	a := involute(t, involuteStudy("2*cos(t)", "2*sin(t)", "t/3", 0, 2, 0, 0.5))
	b := involute(t, involuteStudy("2*cos(t+t^3)", "2*sin(t+t^3)", "(t+t^3)/3", 0, 1, 0, 0.5))
	ends := func(r Result) (Vec3, Vec3) {
		p := r.Involute.Members[0].Points
		return *p[0], *p[len(p)-1]
	}
	a0, a1 := ends(a)
	b0, b1 := ends(b)
	near(t, a0, b0, 1e-9)
	near(t, a1, b1, 1e-7)
}

// Simpson arc length converges at fourth order on a knot with varying speed.
func TestInvoluteConvergence(t *testing.T) {
	c := study()
	c.Construction = "involute"
	c.Involute = InvoluteRequest{Anchor: 0.3, Offset: 0}
	// Reference arc length from the analytic speed at a very fine Simpson grid.
	exact := func(a, b float64) float64 {
		n := 200000
		h := (b - a) / float64(n)
		sum := 0.0
		for i := 0; i < n; i++ {
			_, v0, _ := knot(c, a+float64(i)*h)
			_, v1, _ := knot(c, a+(float64(i)+0.5)*h)
			_, v2, _ := knot(c, a+float64(i+1)*h)
			sum += h / 6 * (v0.norm() + 4*v1.norm() + v2.norm())
		}
		return sum
	}
	s := exact(0.3, 2*math.Pi)
	end, v, _ := knot(c, 2*math.Pi)
	want := end.add(v.unit().mul(-s))
	errorAt := func(n int) float64 {
		c.Samples = n
		r := involute(t, c)
		return r.Involute.Members[0].Points[n].sub(want).norm()
	}
	coarse, fine := errorAt(240), errorAt(480)
	if fine > coarse/12 || fine > 1e-4 {
		t.Fatalf("expected fourth-order arc length: %g -> %g", coarse, fine)
	}
}

// A straight line's involutes collapse to single points.
func TestLineInvoluteCollapses(t *testing.T) {
	r := involute(t, involuteStudy("t", "2*t+4", "-3*t+8", -1, 1, 0, 0.5))
	member := r.Involute.Members[0]
	if !member.Collapsed {
		t.Fatal("collapsed involute not reported")
	}
	want := Vec3{0, 4, 8}.add(Vec3{1, 2, -3}.unit().mul(0.5))
	for _, p := range member.Points {
		near(t, p, want, 1e-9)
	}
	if r.Involute.Members[0].Points[0] == nil || len(r.Mesh) != 0 {
		t.Fatal("line involute")
	}
}

// Arc length is not accumulated through a stationary point or pole: the side
// of the curve beyond it from the anchor has no filament.
func TestInvoluteStopsAtDiscontinuities(t *testing.T) {
	for _, x := range []string{"t^2", "1/t", "tan(t+1.1)"} {
		c := involuteStudy(x, "t^3", "t^2", -1, 1, 0.5, 0)
		c.Samples = 481
		r := involute(t, c)
		p := r.Involute.Members[0].Points
		if p[len(p)-1] == nil || p[0] != nil || r.Involute.Unreached == 0 {
			t.Fatalf("%s: arc length crossed a discontinuity", x)
		}
	}
	// An anchor at a stationary point, or at an interval with a pole, is refused.
	for _, c := range []Request{involuteStudy("t^2", "t^3", "t^2", -1, 1, 0, 0), involuteStudy("1/t", "t", "t", -1, 1, 0.001, 0)} {
		if _, err := Compute(c); err == nil || !strings.Contains(err.Error(), "anchor") {
			t.Fatalf("irregular anchor accepted: %v", err)
		}
	}
}

func TestInvoluteFamily(t *testing.T) {
	c := study()
	c.Construction = "involute"
	c.Involute = InvoluteRequest{Anchor: 0, Offset: 99, Family: InvoluteFamily{Enabled: true, From: 3, To: -1, Count: 5}}
	r := involute(t, c)
	members := r.Involute.Members
	if len(members) != 5 || members[0].Offset != 3 || members[4].Offset != -1 || members[2].Offset != 1 {
		t.Fatalf("family offsets %+v", members)
	}
	for _, m := range members {
		single := c
		single.Involute = InvoluteRequest{Anchor: 0, Offset: m.Offset}
		want := involute(t, single).Involute.Members[0]
		for i, p := range m.Points {
			near(t, p, *want.Points[i], 0)
		}
	}
	// One string per representative sample crosses every member and reaches the curve.
	if len(r.Involute.Strings) != c.Lines {
		t.Fatalf("%d strings", len(r.Involute.Strings))
	}
	for _, s := range r.Involute.Strings {
		along := func(p Vec3) float64 {
			_, v, _ := knot(c, 2*math.Pi*float64(s.SampleIndex)/float64(c.Samples))
			return p.sub(*r.Base[s.SampleIndex]).dot(v.unit())
		}
		lo, hi := math.Min(along(s.From), along(s.To)), math.Max(along(s.From), along(s.To))
		if lo > 1e-12 || hi < -1e-12 {
			t.Fatal("string does not reach the curve")
		}
		for _, m := range members {
			if x := along(*m.Points[s.SampleIndex]); x < lo-1e-9 || x > hi+1e-9 {
				t.Fatal("string misses a member")
			}
		}
	}
}

// A short base with a distant filament still frames the filament.
func TestInvoluteIndependentBounds(t *testing.T) {
	r := involute(t, involuteStudy("t", "t^2", "t^3", 0, 0.01, 0, 20))
	if r.Bounds.Radius < 9 {
		t.Fatalf("short base hid a distant involute: %g", r.Bounds.Radius)
	}
}

func TestInvoluteValidation(t *testing.T) {
	cases := []func(*Request){
		func(c *Request) { c.Involute.Anchor = math.NaN() },
		func(c *Request) { c.Involute.Anchor = 3 }, // outside the domain
		func(c *Request) { c.Involute.Offset = math.Inf(1) },
		func(c *Request) { c.Involute.Offset = 1e5 + 1 },
		func(c *Request) { c.Involute.Family = InvoluteFamily{Enabled: true, From: 0, To: 1, Count: 1} },
		func(c *Request) { c.Involute.Family = InvoluteFamily{Enabled: true, From: 0, To: 1, Count: 25} },
		func(c *Request) { c.Involute.Family = InvoluteFamily{Enabled: true, From: 0, To: math.NaN(), Count: 4} },
		func(c *Request) {
			c.Samples = 2400
			c.Involute.Family = InvoluteFamily{Enabled: true, From: 0, To: 1, Count: 24}
		},
		func(c *Request) { c.Construction = "unknown" },
	}
	for i, change := range cases {
		c := involuteStudy("t", "t^2", "t", -2, 2, 0, 0)
		change(&c)
		if _, err := Compute(c); err == nil {
			t.Errorf("case %d accepted", i)
		}
	}
	// The developable's reach does not constrain the involute.
	c := involuteStudy("t", "t^2", "t", -2, 2, 0, 0)
	c.Length = 0
	involute(t, c)
	// Torus knots take anchors within their closed domain [0, 2π].
	k := study()
	k.Construction = "involute"
	k.Involute.Anchor = 7
	if _, err := Compute(k); err == nil {
		t.Error("anchor outside the knot's domain accepted")
	}
}
