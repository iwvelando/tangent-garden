package threebody

import (
	"math"
	"testing"
)

// state packs positions then velocities, body by body.
func state(r, v [][2]float64) []float64 {
	n := len(r)
	y := make([]float64, 4*n)
	for i := range r {
		y[2*i], y[2*i+1] = r[i][0], r[i][1]
		y[2*n+2*i], y[2*n+2*i+1] = v[i][0], v[i][1]
	}
	return y
}

func near(t *testing.T, what string, got, want, tol float64) {
	t.Helper()
	if !(math.Abs(got-want) <= tol) {
		t.Errorf("%s = %.17g, want %.17g (±%g)", what, got, want, tol)
	}
}

func TestPairsAreEachUnorderedPairOnce(t *testing.T) {
	for n := 2; n <= 3; n++ {
		s := newSystem(make([]float64, n))
		seen := map[[2]int]bool{}
		for _, p := range s.pairs {
			if p[0] >= p[1] || seen[p] {
				t.Fatalf("n=%d: pair %v repeated or unordered in %v", n, p, s.pairs)
			}
			seen[p] = true
		}
		if want := n * (n - 1) / 2; len(seen) != want {
			t.Fatalf("n=%d: %d pairs, want %d", n, len(seen), want)
		}
	}
	// The pair table names the bodies 1–3 in this order, which the encounter
	// terminal reports.
	s := newSystem([]float64{1, 1, 1})
	if len(s.pairs) != 3 || (s.pairs[0] != [2]int{0, 1} || s.pairs[1] != [2]int{0, 2} || s.pairs[2] != [2]int{1, 2}) {
		t.Fatalf("pairs %v, want (1,2), (1,3), (2,3)", s.pairs)
	}
}

// Independent pairwise cases: each acceleration written out by hand.
func TestAccelerationsMatchPairwiseCases(t *testing.T) {
	a := make([]float64, 6)
	// Two bodies on the x axis, distance 2, the third far up the y axis.
	s := newSystem([]float64{0.5, 0.3, 0.2})
	y := state([][2]float64{{0, 0}, {2, 0}, {0, 4}}, make([][2]float64, 3))
	if !s.accel(y, a) {
		t.Fatal("finite configuration reported nonfinite")
	}
	// Body 1: m2/2² toward +x, m3/4² toward +y.
	near(t, "a1.x", a[0], 0.3/4, 1e-16)
	near(t, "a1.y", a[1], 0.2/16, 1e-16)
	// Body 2: m1/4 toward −x; m3 at distance √20 along (−2, 4)/√20.
	d := math.Sqrt(20)
	near(t, "a2.x", a[2], -0.5/4+0.2*(-2)/(d*d*d), 1e-16)
	near(t, "a2.y", a[3], 0.2*4/(d*d*d), 1e-16)
	// Body 3: m1 at (0,−4), m2 along (2, −4).
	near(t, "a3.x", a[4], 0.3*2/(d*d*d), 1e-16)
	near(t, "a3.y", a[5], -0.5/16+0.3*(-4)/(d*d*d), 1e-16)

	// An equilateral triangle of side s and equal masses m: each body is
	// pulled toward the center with |a| = √3 m/s².
	m, side := 1.0/3, 1.7
	h := side / math.Sqrt(3) // circumradius
	var r [][2]float64
	for k := 0; k < 3; k++ {
		th := 0.3 + 2*math.Pi*float64(k)/3
		r = append(r, [2]float64{h * math.Cos(th), h * math.Sin(th)})
	}
	s = newSystem([]float64{m, m, m})
	s.accel(state(r, make([][2]float64, 3)), a)
	for k := 0; k < 3; k++ {
		near(t, "equilateral |a|", math.Hypot(a[2*k], a[2*k+1]), math.Sqrt(3)*m/(side*side), 1e-15)
		// Toward the center: a = −|a| r̂.
		near(t, "equilateral direction", a[2*k]*r[k][1]-a[2*k+1]*r[k][0], 0, 1e-15)
		if a[2*k]*r[k][0]+a[2*k+1]*r[k][1] >= 0 {
			t.Errorf("body %d pulled outward", k+1)
		}
	}
}

func TestAccelerationsObeyNewtonsThirdLaw(t *testing.T) {
	s := newSystem([]float64{0.61, 0.27, 0.12})
	y := state([][2]float64{{0.3, -1.1}, {-0.7, 0.4}, {1.9, 0.8}}, make([][2]float64, 3))
	a := make([]float64, 6)
	s.accel(y, a)
	var fx, fy, torque float64
	for i, m := range s.m {
		fx += m * a[2*i]
		fy += m * a[2*i+1]
		torque += m * (y[2*i]*a[2*i+1] - y[2*i+1]*a[2*i])
	}
	near(t, "Σ m a.x", fx, 0, 1e-16)
	near(t, "Σ m a.y", fy, 0, 1e-16)
	near(t, "Σ m r × a", torque, 0, 1e-16)
}

func TestCoincidentBodiesAreNotFinite(t *testing.T) {
	s := newSystem([]float64{0.4, 0.4, 0.2})
	a := make([]float64, 6)
	if s.accel(state([][2]float64{{1, 1}, {1, 1}, {0, 0}}, make([][2]float64, 3)), a) {
		t.Fatal("coincident bodies gave a finite acceleration")
	}
	if s.accel(state([][2]float64{{math.NaN(), 0}, {1, 1}, {0, 0}}, make([][2]float64, 3)), a) {
		t.Fatal("a NaN position gave a finite acceleration")
	}
}

func TestDerivativeIsVelocityThenAcceleration(t *testing.T) {
	s := newSystem([]float64{0.5, 0.3, 0.2})
	y := state([][2]float64{{0, 0}, {2, 0}, {0, 4}}, [][2]float64{{1, 2}, {3, 4}, {5, 6}})
	out := make([]float64, 12)
	s.deriv(0, y, out)
	a := make([]float64, 6)
	s.accel(y, a)
	for q := 0; q < 6; q++ {
		if out[q] != y[6+q] || out[6+q] != a[q] {
			t.Fatalf("component %d: derivative %v, want velocity then acceleration", q, out)
		}
	}
}

func TestInvariants(t *testing.T) {
	s := newSystem([]float64{0.5, 0.3, 0.2})
	y := state([][2]float64{{0, 0}, {2, 0}, {0, 4}}, [][2]float64{{1, 0}, {0, -1}, {0.5, 0.5}})
	kin := 0.5*0.5*1 + 0.5*0.3*1 + 0.5*0.2*0.5
	pot := -(0.5*0.3/2 + 0.5*0.2/4 + 0.3*0.2/math.Sqrt(20))
	near(t, "energy", s.energy(y), kin+pot, 1e-16)
	p := s.momentum(y)
	near(t, "P.x", p[0], 0.5+0.1, 1e-16)
	near(t, "P.y", p[1], -0.3+0.1, 1e-16)
	// L = Σ m (x vy − y vx).
	near(t, "L", s.angular(y), 0.3*(2*-1)+0.2*(0*0.5-4*0.5), 1e-16)
	c := s.center(y)
	near(t, "c.x", c[0], 0.3*2, 1e-16)
	near(t, "c.y", c[1], 0.2*4, 1e-16)
	d, pair := s.closest(y)
	near(t, "closest", d, 2, 0)
	if pair != 0 {
		t.Errorf("closest pair %d, want 0 (bodies 1, 2)", pair)
	}
}
