package engine

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"testing"
)

func rollingRequest(x, y string, lo, hi float64, c Roller) Request {
	q := request("rolling", x, y, lo, hi)
	q.Rolling = c
	return q
}

// On a circle or a line, the rolling construction is the circular roulette of
// 3a: rolling inside is the left of a counterclockwise circle, outside its
// right, and the upper side of the x-axis is the left of rightward travel.
func TestRollingReducesToCircularRoulettes(t *testing.T) {
	for _, tc := range []struct {
		x, y string
		c    Roller
		g    Roulette
	}{
		{"5*cos(t)", "5*sin(t)", Roller{Side: "left", Radius: 2, Arm: 3, Phase: .4}, Roulette{Roll: "inside", FixedRadius: 5, Radius: 2, Arm: 3, Phase: .4}},
		{"3*cos(t)", "3*sin(t)", Roller{Side: "right", Radius: 1.3, Arm: .7, Phase: -1}, Roulette{Roll: "outside", FixedRadius: 3, Radius: 1.3, Arm: .7, Phase: -1}},
		{"1.5*t", "0", Roller{Side: "left", Radius: 1.5, Arm: 2.5, Phase: 2}, Roulette{Roll: "line", Radius: 1.5, Arm: 2.5, Phase: 2}},
	} {
		q := rollingRequest(tc.x, tc.y, 0, 4*math.Pi, tc.c)
		q.Samples = 2001
		r := compute(t, q)
		if r.Invalid != 0 || len(r.Warnings) != 0 {
			t.Fatalf("%s: %d invalid, %v", tc.g.Roll, r.Invalid, r.Warnings)
		}
		for j := range r.Derived {
			closeVec(t, r.Derived[j], tc.g.state(sampleT(q, j)).Point, 1e-9)
		}
		if len(r.Rolling) != q.Lines {
			t.Fatalf("%s: %d rolling positions", tc.g.Roll, len(r.Rolling))
		}
		for _, s := range r.Rolling {
			want := tc.g.state(sampleT(q, s.SampleIndex))
			closeVec(t, &s.Center, want.Center, 1e-9)
			closeVec(t, &s.Contact, want.Contact, 1e-9)
			closeVec(t, &s.Point, want.Point, 1e-9)
		}
	}
}

// The contact point is the instantaneous center of rotation, so every point
// fixed to the circle moves at right angles to its segment from the contact.
// Holding for two perpendicular arms, it is the no-slip condition itself.
func TestRollingWithoutSlipping(t *testing.T) {
	for _, base := range [][2]string{{"2*cos(t)", "1.2*sin(t)"}, {"t", "sin(t)"}, {"t", "t^3/3-t"}} {
		for _, side := range []string{"left", "right"} {
			for _, phase := range []float64{.3, .3 + math.Pi/2} {
				c := Roller{Side: side, Radius: .45, Arm: .8, Phase: phase}
				q := rollingRequest(base[0], base[1], -2, 3, c)
				q.Samples = 8001
				r := compute(t, q)
				if r.Invalid != 0 {
					t.Fatalf("%v %s: %d invalid", base, side, r.Invalid)
				}
				for j := 1; j < q.Samples-1; j += 7 {
					arm := r.Derived[j].Sub(*r.Base[j])
					v := r.Derived[j+1].Sub(*r.Derived[j-1])
					if e := math.Abs(v.Dot(arm)) / (v.Norm() * arm.Norm()); e > 1e-4 {
						t.Fatalf("%v %s φ=%g at %d: trace not normal to contact arm, cosine %g", base, side, phase, j, e)
					}
				}
				// Tangency, radius, and arm length at each rolling position.
				for _, s := range r.Rolling {
					p := *r.Base[s.SampleIndex]
					closeVec(t, &s.Contact, p, 0)
					radial := s.Center.Sub(p)
					if e := math.Abs(radial.Norm() - c.Radius); e > 1e-12 {
						t.Fatalf("center %g off the radius", e)
					}
					dp, _ := derivatives(mustCompile(t, q.Curve), sampleT(q, s.SampleIndex), q.Curve.Min, q.Curve.Max)
					if e := math.Abs(radial.Dot(dp.Unit())); e > 1e-12 {
						t.Fatalf("circle not tangent: %g", e)
					}
					if want := map[string]float64{"left": 1, "right": -1}[side]; radial.Dot(dp.Perp())*want <= 0 {
						t.Fatalf("circle on the wrong side for %s", side)
					}
					if e := math.Abs(s.Point.Sub(s.Center).Norm() - c.Arm); e > 1e-12 {
						t.Fatalf("arm off by %g", e)
					}
				}
			}
		}
	}
}

func mustCompile(t *testing.T, c Curve) curveFunc {
	t.Helper()
	f, err := compile(c)
	if err != nil {
		t.Fatal(err)
	}
	return f
}

// At the domain start the arm points at the contact, turned by the phase.
func TestRollingPhaseConvention(t *testing.T) {
	for _, side := range []string{"left", "right"} {
		c := Roller{Side: side, Radius: .6, Arm: 1.1}
		q := rollingRequest("2*cos(t)", "sin(t)", .7, 3, c)
		s := compute(t, q).Rolling[0]
		toContact := s.Contact.Sub(s.Center).Mul(c.Arm / c.Radius)
		closeVec(t, &s.Point, s.Center.Add(toContact), 1e-12)
		q.Rolling.Phase = math.Pi / 2
		turned := compute(t, q).Rolling[0].Point.Sub(s.Center)
		closeVec(t, &turned, toContact.Perp(), 1e-12)
	}
}

// Simpson arc length makes the arm angle ψ − σs/ρ converge to the exact arc
// length √2(e⁴ − 1) of a logarithmic spiral, recovered from the final arm.
func TestRollingArclengthConverges(t *testing.T) {
	want := math.Sqrt2 * (math.Exp(4) - 1)
	arc := func(samples int, side string) float64 {
		q := rollingRequest("exp(t)*cos(t)", "exp(t)*sin(t)", 0, 4, Roller{Side: side, Radius: 30, Arm: 1})
		q.Samples = samples
		r := compute(t, q)
		s := r.Rolling[len(r.Rolling)-1]
		if s.SampleIndex != samples-1 {
			t.Fatalf("last position at %d", s.SampleIndex)
		}
		w, u := s.Contact.Sub(s.Center), s.Point.Sub(s.Center)
		turn := math.Atan2(w.Cross(u), w.Dot(u))
		return -map[string]float64{"left": 1, "right": -1}[side] * 30 * turn
	}
	for _, side := range []string{"left", "right"} {
		e64, e256 := math.Abs(arc(64, side)-want), math.Abs(arc(256, side)-want)
		e2001 := math.Abs(arc(2001, side) - want)
		t.Logf("%s: %g %g %g", side, e64, e256, e2001)
		// Fourth order: four times the samples, about 256 times less error.
		if e256 > e64/100 || e2001 > 1e-9*want {
			t.Fatalf("%s: arc length did not converge: %g, %g, %g", side, e64, e256, e2001)
		}
	}
}

// A center point (ℓ = 0) rides on the offset at distance σρ.
func TestRollingCenterIsOffset(t *testing.T) {
	for _, side := range []string{"left", "right"} {
		q := rollingRequest("2*cos(t)", "1.2*sin(t)", 0, 6, Roller{Side: side, Radius: .3, Phase: 1})
		o := offsetRequest("2*cos(t)", "1.2*sin(t)", 0, 6, map[string]float64{"left": .3, "right": -.3}[side])
		r, want := compute(t, q), compute(t, o)
		for j := range r.Derived {
			closeVec(t, r.Derived[j], *want.Derived[j], 1e-12)
		}
	}
}

// Rotating and translating the base curve moves the trace rigidly.
func TestRollingRigidMotion(t *testing.T) {
	c := Roller{Side: "right", Radius: .4, Arm: .9, Phase: .2}
	q := rollingRequest("2*cos(t)", "1.2*sin(t)", 0, 5, c)
	b := .7
	cb, sb := math.Cos(b), math.Sin(b)
	moved := rollingRequest(
		fmt.Sprintf("1.5+%v*2*cos(t)-%v*1.2*sin(t)", cb, sb),
		fmt.Sprintf("-0.5+%v*2*cos(t)+%v*1.2*sin(t)", sb, cb), 0, 5, c)
	r, m := compute(t, q), compute(t, moved)
	for j := range r.Derived {
		p := *r.Derived[j]
		closeVec(t, m.Derived[j], Vec{1.5 + cb*p.X - sb*p.Y, -.5 + sb*p.X + cb*p.Y}, 1e-9)
	}
}

// Rolling needs only a regular tangent: a C¹ curve whose second derivative
// is unbounded at the origin is rolled over without gaps.
func TestRollingFirstOrder(t *testing.T) {
	r := compute(t, rollingRequest("t", "abs(t)^1.5", -1, 1, Roller{Side: "left", Radius: .2, Arm: .1}))
	if r.Invalid != 0 {
		t.Fatalf("%d invalid samples on a C¹ curve", r.Invalid)
	}
}

// The circle cannot roll across an invalid sample; it stops explicitly
// instead of jumping.
func TestRollingStops(t *testing.T) {
	q := rollingRequest("t", "1/t", -1, 1, Roller{Side: "left", Radius: .1, Arm: .1})
	r := compute(t, q)
	for j, p := range r.Derived {
		if u := sampleT(q, j); u < -.01 && p == nil || u > 0 && p != nil {
			t.Fatalf("at t=%g: %v", u, p)
		}
	}
	if !warned(r, "invalid interval") {
		t.Fatalf("warnings %v", r.Warnings)
	}
	for _, s := range r.Rolling {
		if sampleT(q, s.SampleIndex) > 0 {
			t.Fatalf("rolling position after the stop at %d", s.SampleIndex)
		}
	}
}

// At a cusp the direction of travel reverses. The circle stays on its side
// of the curve, touches the cusp, and rolls back out, turning the other way.
// On (t², 0), which runs into the cusp at t = 0 and back along the same
// line, it retraces its path: the trace at −t is the trace at t.
func TestRollingBackOutOfCusps(t *testing.T) {
	q := rollingRequest("t^2", "0", -1, 1, Roller{Side: "left", Radius: .2, Arm: .15, Phase: .3})
	r := compute(t, q)
	n := q.Samples - 1
	for j := 0; j < n/2; j++ {
		if r.Derived[j] == nil {
			t.Fatalf("gap at %d", j)
		}
		closeVec(t, r.Derived[n-j], *r.Derived[j], 1e-9)
	}
	// Before the cusp, travel is toward −x, so the left is below the line.
	s := q.Rolling.at(Vec{1, 0}, Vec{-2, 0}, 0)
	closeVec(t, r.Derived[0], s.Point, 1e-12)
	if len(r.Rolling) != q.Lines-1 || !warned(r, "rolls back out of 1 cusp") {
		t.Fatalf("%d positions, %v", len(r.Rolling), r.Warnings)
	}
	for _, s := range r.Rolling {
		if s.Center.Y > -.2+1e-12 || s.Center.Y < -.2-1e-12 {
			t.Fatalf("center %v left the lower side", s.Center)
		}
	}

	// Around an astroid the circle passes all four cusps without a jump, and
	// never slips: the trace moves at right angles to the arm from the
	// contact, except next to a cusp, where both stop.
	q = rollingRequest("cos(t)^3", "sin(t)^3", .3, .3+2*math.Pi, Roller{Side: "right", Radius: .1, Arm: .07})
	q.Samples = 4001
	r = compute(t, q)
	if r.Invalid != 0 || len(r.Rolling) != q.Lines || !warned(r, "rolls back out of 4 cusps") {
		t.Fatalf("%d invalid, %d positions, %v", r.Invalid, len(r.Rolling), r.Warnings)
	}
	for j := 1; j < len(r.Derived)-1; j++ {
		u := sampleT(q, j)
		v := r.Derived[j+1].Sub(*r.Derived[j-1])
		arm := r.Derived[j].Sub(*r.Base[j])
		if math.Abs(v.Dot(arm)) > 2e-3*v.Norm()*arm.Norm()+1e-9 && math.Abs(math.Sin(2*u)) > .05 {
			t.Fatalf("slipping at t=%g: %g", u, v.Dot(arm)/(v.Norm()*arm.Norm()))
		}
		if j > 1 && v.Norm() > 10*r.Derived[j].Sub(*r.Derived[j-2]).Norm()+1e-3 {
			t.Fatalf("jump at %d", j)
		}
	}
}

func TestRollingResult(t *testing.T) {
	q := rollingRequest("2*cos(t)", "1.2*sin(t)", 0, 6, Roller{Side: "right", Radius: .3, Arm: .5})
	r := compute(t, q)
	if len(r.Rolling) != q.Lines || len(r.Rays) != q.Lines {
		t.Fatalf("%d positions, %d rays", len(r.Rolling), len(r.Rays))
	}
	for k, s := range r.Rolling {
		ray := r.Rays[k]
		if ray.SampleIndex != s.SampleIndex || s.Radius != .3 {
			t.Fatalf("position %d: %+v ray %+v", k, s, ray)
		}
		// Construction lines join the contact to the tracing point.
		closeVec(t, &ray.Origin, s.Contact, 0)
		closeVec(t, ray.Target, s.Point, 0)
		closeVec(t, r.Derived[s.SampleIndex], s.Point, 0)
		closeVec(t, r.Base[s.SampleIndex], s.Contact, 0)
	}
	b, _ := json.Marshal(r)
	if !strings.Contains(string(b), `"rolling":[{"sampleIndex":0,"center":`) {
		t.Fatalf("JSON %s", b[:200])
	}
	// Other constructions return an empty list and ignore rolling settings.
	o := offsetRequest("2*cos(t)", "1.2*sin(t)", 0, 6, .2)
	o.Rolling = Roller{Side: "up", Radius: -1}
	if other := compute(t, o); other.Rolling == nil || len(other.Rolling) != 0 {
		t.Fatalf("offset rolling %v", other.Rolling)
	}
	// A rolling circle can roll on a roulette, keeping both circles.
	g := rouletteRequest(Roulette{Roll: "inside", FixedRadius: 5, Radius: 2, Arm: 1}, 0, 4*math.Pi)
	g.Kind, g.Rolling = "rolling", Roller{Side: "right", Radius: .5, Arm: .5}
	both := compute(t, g)
	if len(both.Rolling) != g.Lines || len(both.Roulette.Positions) != g.Lines || both.Invalid != 0 {
		t.Fatalf("%d rolling, %d roulette positions, %d invalid", len(both.Rolling), len(both.Roulette.Positions), both.Invalid)
	}
}

func TestRollingInvalid(t *testing.T) {
	ok := Roller{Side: "left", Radius: 1, Arm: 1}
	for _, tc := range []struct {
		change func(*Roller)
		want   string
	}{
		{func(c *Roller) { c.Side = "" }, "left or right"},
		{func(c *Roller) { c.Side = "up" }, "left or right"},
		{func(c *Roller) { c.Radius = 0 }, "radius ρ"},
		{func(c *Roller) { c.Radius = -1 }, "radius ρ"},
		{func(c *Roller) { c.Radius = math.NaN() }, "radius ρ"},
		{func(c *Roller) { c.Radius = 2e5 }, "radius ρ"},
		{func(c *Roller) { c.Arm = -.1 }, "tracing distance ℓ"},
		{func(c *Roller) { c.Arm = math.Inf(1) }, "tracing distance ℓ"},
		{func(c *Roller) { c.Phase = math.NaN() }, "phase ψ"},
		{func(c *Roller) { c.Phase = 2e6 }, "phase ψ"},
	} {
		c := ok
		tc.change(&c)
		_, err := Compute(rollingRequest("cos(t)", "sin(t)", 0, 1, c))
		if err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("%+v: %v", c, err)
		}
	}
	// Boundary values are accepted.
	for _, c := range []Roller{{Side: "right", Radius: 1e5, Arm: 0, Phase: -1e6}, {Side: "left", Radius: 1e-9, Arm: 1e5, Phase: 1e6}} {
		if _, err := Compute(rollingRequest("cos(t)", "sin(t)", 0, 1, c)); err != nil {
			t.Fatal(err)
		}
	}
}
