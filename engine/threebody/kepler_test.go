package threebody

import (
	"math"
	"testing"
)

// kepler is the analytic two-body orbit with masses m1, m2 (total M), semi-
// major axis a and eccentricity e, at pericenter at time tp, its center of
// mass moving from c0 with velocity w. It is the solver's independent
// oracle: positions come from Kepler's equation, not from integration.
type kepler struct {
	m1, m2, a, e, tp float64
	c0, w            [2]float64
}

func (k kepler) period() float64 { return 2 * math.Pi * math.Sqrt(k.a*k.a*k.a/(k.m1+k.m2)) }

// eccentric solves E − e sin E = M by Newton's method.
func eccentric(mean, e float64) float64 {
	mean = math.Remainder(mean, 2*math.Pi)
	E := mean
	if e > 0.8 {
		E = math.Copysign(math.Pi, mean)
	}
	for i := 0; i < 100; i++ {
		d := (E - e*math.Sin(E) - mean) / (1 - e*math.Cos(E))
		E -= d
		if math.Abs(d) < 1e-16 {
			break
		}
	}
	return E
}

// at is the state, positions then velocities, at time t.
func (k kepler) at(t float64) []float64 {
	M := k.m1 + k.m2
	n := math.Sqrt(M / (k.a * k.a * k.a))
	E := eccentric(n*(t-k.tp), k.e)
	c, s := math.Cos(E), math.Sin(E)
	b := math.Sqrt(1 - k.e*k.e)
	rx, ry := k.a*(c-k.e), k.a*b*s
	den := 1 - k.e*c
	vx, vy := -k.a*n*s/den, k.a*n*b*c/den
	cx, cy := k.c0[0]+k.w[0]*t, k.c0[1]+k.w[1]*t
	f1, f2 := k.m2/M, k.m1/M
	return []float64{
		cx - f1*rx, cy - f1*ry, cx + f2*rx, cy + f2*ry,
		k.w[0] - f1*vx, k.w[1] - f1*vy, k.w[0] + f2*vx, k.w[1] + f2*vy,
	}
}

// refit returns the orbit that the rounded float64 state at its pericenter
// (tp = 0) actually starts: a and e from that state's energy and distance.
// At e = 0.9 the rounding of the pericenter speed alone moves the period by
// about 7·10⁻¹⁵ of itself, which ten periods turn into 2·10⁻¹² in position.
func (k kepler) refit() kepler {
	y := k.at(0)
	// In double-double, from the bodies' own coordinates: the energy is
	// −0.5 as the difference of 9.5 and 10 at e = 0.9.
	d := func(i, j int) dd { return ddFrom(y[j]).Sub(ddFrom(y[i])) }
	rx, ry, vx, vy := d(0, 2), d(1, 3), d(4, 6), d(5, 7)
	M := ddFrom(k.m1).Add(ddFrom(k.m2))
	r := rx.Mul(rx).Add(ry.Mul(ry)).Sqrt()
	v2 := vx.Mul(vx).Add(vy.Mul(vy))
	energy := v2.Scale(.5).Sub(M.Div(r))
	a := M.Div(energy.Scale(-2))
	k.a, k.e = a.Float(), ddFrom(1).Sub(r.Div(a)).Float()
	return k
}

func maxDiff(a, b []float64, lo, hi int) float64 {
	d := 0.0
	for q := lo; q < hi; q++ {
		d = math.Max(d, math.Abs(a[q]-b[q]))
	}
	return d
}

func TestKeplerOrbitsMatchTheAnalyticOracle(t *testing.T) {
	for _, c := range []struct {
		name         string
		e            float64
		maxPos, maxV float64
	}{
		// Global errors after ten periods at tolerance 10⁻¹² were measured
		// at 1.7·10⁻⁹ (circular), 2.3·10⁻⁹ and 7.2·10⁻⁹ (e = 0.6), and 10⁻⁸
		// and 2.3·10⁻⁷ (e = 0.9): a phase error growing secularly. The bounds
		// allow twice that.
		{"circular", 0, 4e-9, 4e-9},
		{"e=0.6", 0.6, 5e-9, 1.5e-8},
		{"e=0.9", 0.9, 2e-8, 5e-7},
	} {
		t.Run(c.name, func(t *testing.T) {
			k := kepler{m1: 0.7, m2: 0.3, a: 1, e: c.e, c0: [2]float64{0.25, -0.5}, w: [2]float64{0.05, 0.02}}
			T := k.period()
			h := integrate(newSystem([]float64{0.7, 0.3}), 0, k.at(0), 10*T, DefaultSettings())
			if h.Terminal.Reason != "end" {
				t.Fatalf("terminal %+v", h.Terminal)
			}
			worstR, worstV := 0.0, 0.0
			check := func(when float64) {
				got, ok := h.State(when)
				if !ok {
					t.Fatalf("no state at %g", when)
				}
				want := k.at(when)
				worstR = math.Max(worstR, maxDiff(got, want, 0, 4))
				worstV = math.Max(worstV, maxDiff(got, want, 4, 8))
			}
			// At accepted steps, between them, and either side of a step
			// boundary, where the dense solution starts from a new step.
			for i := 0; i+1 < len(h.ts); i++ {
				a, b := h.ts[i], h.ts[i+1]
				check(a)
				check((a + b) / 2)
				if i > 0 {
					check(math.Nextafter(a, math.Inf(-1)))
					check(math.Nextafter(a, math.Inf(1)))
				}
			}
			check(10 * T)
			if worstR > c.maxPos || worstV > c.maxV {
				t.Errorf("worst position error %.3g (max %g), velocity %.3g (max %g)", worstR, c.maxPos, worstV, c.maxV)
			}
			t.Logf("%d steps, %d rejected; position error %.3g, velocity %.3g", h.Accepted, h.Rejected, worstR, worstV)

			// Phase: the relative orbit returns to pericenter, its x axis, after
			// each period; the crossing of y = 0 upward is found on the dense
			// solution and compared with the analytic period.
			rel := func(when float64) (float64, float64) {
				y, _ := h.State(when)
				return y[2] - y[0], y[3] - y[1]
			}
			for p := 1; p <= 10; p++ {
				lo, hi := float64(p)*T-0.01, float64(p)*T+0.01
				if p == 10 {
					hi = 10 * T
				}
				for i := 0; i < 80; i++ {
					mid := (lo + hi) / 2
					if _, ry := rel(mid); ry < 0 {
						lo = mid
					} else {
						hi = mid
					}
				}
				if p < 10 {
					near(t, "return time", (lo+hi)/2, float64(p)*T, 1e-8)
				}
			}
		})
	}
}

// The center of mass moves on its inertial straight line, not at the origin.
func TestCenterOfMassMovesInAStraightLine(t *testing.T) {
	k := kepler{m1: 0.7, m2: 0.3, a: 1, e: 0.6, c0: [2]float64{0.25, -0.5}, w: [2]float64{0.05, 0.02}}
	s := newSystem([]float64{0.7, 0.3})
	h := integrate(s, 0, k.at(0), 30, DefaultSettings())
	for _, when := range []float64{0, 3.3, 17.1, 30} {
		y, _ := h.State(when)
		c := s.center(y)
		near(t, "c.x", c[0], 0.25+0.05*when, 1e-13)
		near(t, "c.y", c[1], -0.5+0.02*when, 1e-13)
	}
}

// A history owns its states: states returned to callers are copies, and
// retained steps never alias the stepper's scratch.
func TestHistoryOwnsItsStates(t *testing.T) {
	k := kepler{m1: 0.7, m2: 0.3, a: 1, e: 0.3}
	h := integrate(newSystem([]float64{0.7, 0.3}), 0, k.at(0), 5, DefaultSettings())
	a, _ := h.State(1.25)
	keep := append([]float64{}, a...)
	b, _ := h.State(3.5)
	for q := range keep {
		if a[q] != keep[q] {
			t.Fatal("a later State call changed an earlier result")
		}
	}
	b[0] = 99
	if c, _ := h.State(3.5); c[0] == 99 {
		t.Fatal("editing a returned state changed the history")
	}
	for i := 1; i < len(h.ys); i++ {
		if &h.ys[i][0] == &h.ys[i-1][0] {
			t.Fatal("two retained steps share storage")
		}
	}
	if _, ok := h.State(5.0001); ok {
		t.Fatal("a state past the end was returned")
	}
	if _, ok := h.State(-1e-9); ok {
		t.Fatal("a state before the start was returned")
	}
}

// The global error falls in proportion to the tolerance: tenfold per decade
// from 10⁻⁸ to 10⁻¹³ (measured), well above rounding.
func TestKeplerErrorConvergesWithTolerance(t *testing.T) {
	for _, e := range []float64{0, 0.6, 0.9} {
		k := kepler{m1: 0.7, m2: 0.3, a: 1, e: e}
		T := k.period()
		worst := func(tol float64) float64 {
			set := DefaultSettings()
			set.Tolerance = tol
			h := integrate(newSystem([]float64{0.7, 0.3}), 0, k.at(0), 10*T, set)
			w := 0.0
			for i := 0; i <= 1000; i++ {
				at := 10 * T * float64(i) / 1000
				y, _ := h.State(at)
				w = math.Max(w, maxDiff(y, k.at(at), 0, 8))
			}
			return w
		}
		coarse, fine := worst(1e-10), worst(1e-12)
		if r := coarse / fine; r < 50 || r > 200 {
			t.Errorf("e=%g: error %.3g at 10⁻¹⁰ and %.3g at 10⁻¹², ratio %.3g, want about 100", e, coarse, fine, r)
		}
	}
}
