package engine

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

func rouletteRequest(g Roulette, lo, hi float64) Request {
	q := request("offset", "", "", lo, hi)
	q.Curve = Curve{Format: "roulette", Roulette: g, Min: lo, Max: hi}
	return q
}

func traced(t *testing.T, g Roulette) curveFunc {
	t.Helper()
	f, err := compile(Curve{Format: "roulette", Roulette: g, Min: 0, Max: 1})
	if err != nil {
		t.Fatal(err)
	}
	return f
}

// The rolling circle turns about its center, and the material point at the
// contact is momentarily at rest: no slipping, inside, outside, or on a line.
func TestRouletteRollsWithoutSlipping(t *testing.T) {
	for _, g := range []Roulette{
		{Roll: "inside", FixedRadius: 5, Radius: 2, Arm: 3, Phase: .4},
		{Roll: "outside", FixedRadius: 3, Radius: 1.3, Arm: .7, Phase: -1},
		{Roll: "line", Radius: 1.5, Arm: 2.5, Phase: 2},
	} {
		const h = 1e-5
		for _, u := range []float64{-2.1, 0, .3, 1.7, 5} {
			s, a, b := g.state(u), g.state(u-h), g.state(u+h)
			// Spin from the tracing point's motion about the center alone.
			arm, center := s.Point.Sub(s.Center), b.Center.Sub(a.Center).Mul(1/(2*h))
			velocity := b.Point.Sub(a.Point).Mul(1 / (2 * h))
			spin := arm.Cross(velocity.Sub(center)) / arm.Dot(arm)
			contact := center.Add(s.Contact.Sub(s.Center).Perp().Mul(spin))
			if contact.Norm() > 1e-8*math.Max(1, center.Norm()) {
				t.Fatalf("%s at t=%g: contact velocity %v", g.Roll, u, contact)
			}
			if e := math.Abs(s.Contact.Sub(s.Center).Norm() - g.Radius); e > 1e-12 {
				t.Fatalf("%s: contact is %g off the rolling circle", g.Roll, e)
			}
			if e := math.Abs(arm.Norm() - g.Arm); e > 1e-12 {
				t.Fatalf("%s: tracing arm off by %g", g.Roll, e)
			}
			// The contact lies on the fixed circle or line, where the two
			// circles are tangent.
			switch g.Roll {
			case "line":
				if s.Contact.Y != 0 || s.Center.Y != g.Radius {
					t.Fatalf("line contact %v center %v", s.Contact, s.Center)
				}
			default:
				if e := math.Abs(s.Contact.Norm() - g.FixedRadius); e > 1e-12 {
					t.Fatalf("%s: contact off the fixed circle by %g", g.Roll, e)
				}
				if e := math.Abs(s.Center.Norm() - g.FixedRadius - map[string]float64{"inside": -1, "outside": 1}[g.Roll]*g.Radius); e > 1e-12 {
					t.Fatalf("%s: circles not tangent, %g", g.Roll, e)
				}
			}
		}
		// Phase zero starts the tracing arm toward the contact point.
		g.Phase = 0
		s := g.state(0)
		want := s.Center.Add(s.Contact.Sub(s.Center).Mul(g.Arm / g.Radius))
		closeVec(t, &s.Point, want, 1e-12)
		// A phase turns the arm counterclockwise by that angle at t=0.
		g.Phase = math.Pi / 2
		turned := g.state(0).Point.Sub(s.Center)
		closeVec(t, &turned, s.Contact.Sub(s.Center).Perp().Mul(g.Arm/g.Radius), 1e-12)
	}
}

func TestRouletteAnalyticReductions(t *testing.T) {
	check := func(name string, g Roulette, want func(u float64, p Vec) float64) {
		t.Helper()
		f := traced(t, g)
		for u := -7.0; u < 7; u += .013 {
			if e := want(u, f(u)); e > 1e-9 {
				t.Fatalf("%s at t=%g: residual %g", name, u, e)
			}
		}
	}
	// A center point rides on a circle of radius R∓r, or a line at height r.
	check("inside center", Roulette{Roll: "inside", FixedRadius: 5, Radius: 2}, func(_ float64, p Vec) float64 { return math.Abs(p.Norm() - 3) })
	check("outside center", Roulette{Roll: "outside", FixedRadius: 5, Radius: 2}, func(_ float64, p Vec) float64 { return math.Abs(p.Norm() - 7) })
	check("line center", Roulette{Roll: "line", Radius: 2}, func(_ float64, p Vec) float64 { return math.Abs(p.Y - 2) })
	// Tusi couple: a rim point of a circle rolling inside one twice its size
	// runs along a diameter; other points trace ellipses.
	check("Tusi", Roulette{Roll: "inside", FixedRadius: 2, Radius: 1, Arm: 1}, func(_ float64, p Vec) float64 { return math.Abs(p.Y) + math.Max(0, math.Abs(p.X)-2) })
	check("ellipse", Roulette{Roll: "inside", FixedRadius: 2, Radius: 1, Arm: .4}, func(_ float64, p Vec) float64 {
		return math.Abs(math.Pow(p.X/1.4, 2) + math.Pow(p.Y/.6, 2) - 1)
	})
	// Astroid |x|^(2/3)+|y|^(2/3)=R^(2/3) for R=4r, d=r.
	check("astroid", Roulette{Roll: "inside", FixedRadius: 4, Radius: 1, Arm: 1}, func(_ float64, p Vec) float64 {
		return math.Abs(math.Cbrt(p.X*p.X) + math.Cbrt(p.Y*p.Y) - math.Cbrt(16))
	})
	// Cardioid ρ = 2r(1 − cos θ) about its cusp at (R,0) for R=r=d.
	check("cardioid", Roulette{Roll: "outside", FixedRadius: 1.5, Radius: 1.5, Arm: 1.5}, func(_ float64, p Vec) float64 {
		v := p.Sub(Vec{1.5, 0})
		return math.Abs(v.Norm() - 3*(1-math.Cos(math.Atan2(v.Y, v.X))))
	})
	// Cycloid: x = r(θ − sin θ), y = r(1 − cos θ) where θ is its own turn,
	// recovered from the height alone.
	check("cycloid", Roulette{Roll: "line", Radius: 1.5, Arm: 1.5}, func(u float64, p Vec) float64 {
		return math.Abs(p.X-1.5*(u-math.Sin(u))) + math.Abs(p.Y-1.5*(1-math.Cos(u)))
	})
}

func TestRouletteClosure(t *testing.T) {
	for _, tc := range []struct {
		g            Roulette
		turns, lobes int
	}{
		{Roulette{Roll: "inside", FixedRadius: 5, Radius: 2, Arm: 3}, 2, 5},
		{Roulette{Roll: "outside", FixedRadius: 3, Radius: 1, Arm: .5}, 1, 3},
		{Roulette{Roll: "inside", FixedRadius: 1, Radius: .3, Arm: .3}, 3, 10},
		{Roulette{Roll: "outside", FixedRadius: 2.4, Radius: 3.6, Arm: 1}, 3, 2},
		{Roulette{Roll: "outside", FixedRadius: 201, Radius: 200, Arm: 1}, 200, 201},
		// Beyond 200 turns, and irrational ratios, never report closure.
		{Roulette{Roll: "outside", FixedRadius: 200, Radius: 201, Arm: 1}, 0, 0},
		{Roulette{Roll: "inside", FixedRadius: math.Phi, Radius: 1, Arm: 1}, 0, 0},
		{Roulette{Roll: "inside", FixedRadius: math.Sqrt2, Radius: 1, Arm: .2}, 0, 0},
		{Roulette{Roll: "line", Radius: 1, Arm: 1}, 0, 0},
	} {
		turns, lobes := tc.g.closure()
		if turns != tc.turns || lobes != tc.lobes {
			t.Fatalf("%+v: turns %d lobes %d, want %d %d", tc.g, turns, lobes, tc.turns, tc.lobes)
		}
		if turns == 0 {
			continue
		}
		// The trace returns exactly after the reported turns, not earlier.
		f, period := traced(t, tc.g), 2*math.Pi*float64(turns)
		for _, u := range []float64{0, .7, -2} {
			closeVec(t, point(f(u+period)), f(u), 1e-9*tc.g.FixedRadius)
			if turns > 1 && f(u+2*math.Pi).Sub(f(u)).Norm() < 1e-6 {
				t.Fatalf("%+v closed after one turn", tc.g)
			}
		}
	}
}

// Known arc lengths: an astroid 6R/4·4 = 24 for R=4, a cardioid 16r, a
// cycloid arch 8r. The chord polygon converges at second order.
func TestRouletteArclengthConverges(t *testing.T) {
	for _, tc := range []struct {
		g    Roulette
		want float64
	}{
		{Roulette{Roll: "inside", FixedRadius: 4, Radius: 1, Arm: 1}, 24},
		{Roulette{Roll: "outside", FixedRadius: 1, Radius: 1, Arm: 1}, 16},
		{Roulette{Roll: "line", Radius: 1, Arm: 1}, 8},
		// A hypocycloid with R/r = 5/2 has five arches of length 8r(R−r)/R.
		{Roulette{Roll: "inside", FixedRadius: 5, Radius: 2, Arm: 2}, 5 * 8 * 2 * 3 / 5.0},
	} {
		turns, _ := tc.g.closure()
		if turns == 0 {
			turns = 1
		}
		f, period := traced(t, tc.g), 2*math.Pi*float64(turns)
		length := func(n int) float64 {
			sum := 0.0
			for i := 0; i < n; i++ {
				sum += f(period * float64(i+1) / float64(n)).Sub(f(period * float64(i) / float64(n))).Norm()
			}
			return sum
		}
		coarse, fine := math.Abs(length(1000)-tc.want), math.Abs(length(8000)-tc.want)
		if fine > 2e-5*tc.want || coarse/fine < 50 {
			t.Fatalf("%+v: errors %g → %g", tc.g, coarse, fine)
		}
	}
}

func TestRouletteResult(t *testing.T) {
	g := Roulette{Roll: "inside", FixedRadius: 5, Radius: 2, Arm: 3}
	q := rouletteRequest(g, 0, 4*math.Pi)
	r := compute(t, q)
	if r.Roulette == nil || r.Roulette.Roll != "inside" || r.Roulette.FixedRadius != 5 || r.Roulette.Turns != 2 || r.Roulette.Lobes != 5 {
		t.Fatalf("roulette summary %+v", r.Roulette)
	}
	// One rolling position per construction line, on the base curve.
	if len(r.Roulette.Positions) != q.Lines {
		t.Fatalf("positions %d", len(r.Roulette.Positions))
	}
	for k, s := range r.Roulette.Positions {
		want := g.state(sampleT(q, s.SampleIndex))
		closeVec(t, &s.Center, want.Center, 1e-12)
		closeVec(t, &s.Contact, want.Contact, 1e-12)
		if s.Radius != 2 {
			t.Fatalf("position %d radius %g", k, s.Radius)
		}
		closeVec(t, r.Base[s.SampleIndex], s.Point, 0)
		if k > 0 && s.SampleIndex <= r.Roulette.Positions[k-1].SampleIndex {
			t.Fatal("positions out of order")
		}
	}
	if r.Roulette.Positions[0].SampleIndex != 0 || r.Roulette.Positions[q.Lines-1].SampleIndex != q.Samples-1 {
		t.Fatal("positions must span the whole domain")
	}
	// The closed trace starts and ends at the same point.
	closeVec(t, r.Base[q.Samples-1], *r.Base[0], 1e-9)
	// Rolling positions persist across construction gaps: a hypocycloid
	// traced by a rim point has cusps, where the evolute is undefined.
	g.Arm = 2
	q = rouletteRequest(g, 0, 4*math.Pi)
	q.Kind, q.Lines = "evolute", 21
	r = compute(t, q)
	if len(r.Roulette.Positions) != 21 || len(r.Rays) >= 21 {
		t.Fatalf("positions %d rays %d", len(r.Roulette.Positions), len(r.Rays))
	}
	// Constructions act on the roulette like any other curve: the evolute of a
	// center-traced circle is its center.
	q = rouletteRequest(Roulette{Roll: "outside", FixedRadius: 2, Radius: 1, Phase: 1}, 0, 2*math.Pi)
	q.Kind = "evolute"
	for _, p := range compute(t, q).Derived[5:495] {
		closeVec(t, p, Vec{}, 1e-6)
	}
	// Along a line, the fixed radius is irrelevant and there is no closure.
	r = compute(t, rouletteRequest(Roulette{Roll: "line", FixedRadius: -9, Radius: 1, Arm: 1.5}, -3, 9))
	if r.Roulette.Roll != "line" || r.Roulette.Turns != 0 || r.Roulette.FixedRadius != 0 {
		t.Fatalf("line summary %+v", r.Roulette)
	}
	for _, s := range r.Roulette.Positions {
		if s.Contact.Y != 0 || s.Center.Y != 1 {
			t.Fatalf("line position %+v", s)
		}
	}
	// Other formats carry no roulette.
	b, _ := json.Marshal(compute(t, offsetRequest("t", "t^2", -1, 1, .2)))
	if strings.Contains(string(b), "roulette") {
		t.Fatalf("non-roulette result mentions a roulette: %.200s", b)
	}
	var decoded Request
	if err := json.Unmarshal([]byte(`{"curve":{"format":"roulette","roulette":{"roll":"outside","fixedRadius":3,"radius":1,"arm":0.5,"phase":0.25}}}`), &decoded); err != nil || decoded.Curve.Roulette != (Roulette{"outside", 3, 1, .5, .25}) {
		t.Fatalf("roulette JSON fields: %+v %v", decoded.Curve, err)
	}
}

func TestRouletteInvalid(t *testing.T) {
	for _, tc := range []struct {
		g    Roulette
		want string
	}{
		{Roulette{Roll: "inside", FixedRadius: 2, Radius: 2, Arm: 1}, "smaller than the fixed radius"},
		{Roulette{Roll: "inside", FixedRadius: 2, Radius: 3, Arm: 1}, "smaller than the fixed radius"},
		{Roulette{Roll: "outside", FixedRadius: 0, Radius: 1, Arm: 1}, "fixed radius"},
		{Roulette{Roll: "outside", FixedRadius: 1, Radius: 0, Arm: 1}, "rolling radius"},
		{Roulette{Roll: "line", Radius: -1, Arm: 1}, "rolling radius"},
		{Roulette{Roll: "outside", FixedRadius: 1e5 + 1, Radius: 1, Arm: 1}, "fixed radius"},
		{Roulette{Roll: "outside", FixedRadius: math.NaN(), Radius: 1, Arm: 1}, "fixed radius"},
		{Roulette{Roll: "line", Radius: math.Inf(1), Arm: 1}, "rolling radius"},
		{Roulette{Roll: "line", Radius: 1, Arm: -.1}, "tracing distance"},
		{Roulette{Roll: "line", Radius: 1, Arm: math.NaN()}, "tracing distance"},
		{Roulette{Roll: "line", Radius: 1, Arm: 1e5 + 1}, "tracing distance"},
		{Roulette{Roll: "line", Radius: 1, Arm: 1, Phase: math.Inf(-1)}, "phase"},
		{Roulette{Roll: "line", Radius: 1, Arm: 1, Phase: 1e6 + 1}, "phase"},
		{Roulette{Roll: "sideways", Radius: 1, Arm: 1}, "inside, outside, or along a line"},
	} {
		if _, err := Compute(rouletteRequest(tc.g, 0, 1)); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("accepted %+v: %v", tc.g, err)
		}
	}
	// A line ignores an invalid fixed radius; the domain is still checked.
	if _, err := Compute(rouletteRequest(Roulette{Roll: "line", FixedRadius: math.NaN(), Radius: 1}, 1, 0)); err == nil || !strings.Contains(err.Error(), "greater than") {
		t.Fatalf("roulette skipped domain checks: %v", err)
	}
}
