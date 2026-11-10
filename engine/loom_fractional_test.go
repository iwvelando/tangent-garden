package engine

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/cmplx"
	"math/rand/v2"
	"testing"
)

// The general Möbius map w = (az + b)/(cz + d) and its flow Mˢ. Requests
// are built through JSON, as the worker sends them, so these tests fail
// behaviorally rather than by compilation before the map exists. The
// expectations use math/cmplx and closed forms, never the engine's flow.

// A loxodromic map with fixed points ±1 and multiplier 1 + i:
// (w − 1)/(w + 1) = (1 + i)(z − 1)/(z + 1), so a = d = 2 + i, b = c = −i.
// Its pole is −d/c = 1 − 2i.
var loxodromic = [4]complex128{2 + 1i, -1i, -1i, 2 + 1i}

func fractionalLoom(source string, coefficients [4]complex128, s, radius float64) LoomRequest {
	q := loomExample(source)
	b, _ := json.Marshal(q)
	var fields map[string]any
	_ = json.Unmarshal(b, &fields)
	c := map[string]any{}
	for i, name := range []string{"a", "b", "c", "d"} {
		c[name] = map[string]float64{"x": real(coefficients[i]), "y": imag(coefficients[i])}
	}
	fields["map"], fields["coefficients"], fields["mapParameter"], fields["exclusionRadius"] = "fractional", c, s, radius
	b, _ = json.Marshal(fields)
	_ = json.Unmarshal(b, &q)
	return q
}

func mobiusAt(m [4]complex128, z complex128) complex128 {
	return (m[0]*z + m[1]) / (m[2]*z + m[3])
}

// A frozen constant curve: the single point z, at every parameter.
func pointLoom(q LoomRequest, z complex128) LoomRequest {
	q.Source = LoomSource{Kind: "curve", Input: "curve", Curve: Curve{Format: "parametric", X: fmt.Sprintf("%.17g", real(z)), Y: fmt.Sprintf("%.17g", imag(z)), Min: 0, Max: 1}}
	q.Selected, q.Parameter = 0, 0
	return q
}

func fractionalImage(t *testing.T, q LoomRequest, z complex128) complex128 {
	t.Helper()
	m, err := LoomPoint(pointLoom(q, z))
	if err != nil {
		t.Fatal(err)
	}
	if m.Image == nil {
		t.Fatalf("no image at %v", z)
	}
	return complex(m.Image.X, m.Image.Y)
}

func nearC(a, b complex128, tolerance float64) bool {
	return cmplx.Abs(a-b) <= tolerance*math.Max(1, cmplx.Abs(b))
}

func TestLoomFractionalReturnedGeometry(t *testing.T) {
	for _, kind := range []string{"grid", "concentric", "rosette", "curve"} {
		q := fractionalLoom(kind, loxodromic, 1, .02)
		// Settings of other maps ride along and are ignored.
		q.Degree = 9
		r, err := ComputeLoom(q)
		if err != nil {
			t.Fatalf("%s: %v", kind, err)
		}
		drawn := 0
		for _, m := range r.Members {
			for j, p := range m.Source {
				w := m.Image[j]
				if p == nil || w == nil {
					continue
				}
				drawn++
				want := mobiusAt(loxodromic, complex(p.X, p.Y))
				if !nearC(complex(w.X, w.Y), want, 1e-12) {
					t.Fatalf("%s: %v -> %v, want %v", kind, p, w, want)
				}
				if m.Critical[j] {
					t.Fatalf("%s: a Möbius map has no critical point, but %v is marked", kind, p)
				}
			}
		}
		if drawn < 16 {
			t.Fatalf("%s: empty geometry", kind)
		}
		if r.Pole == nil || !nearC(complex(r.Pole.X, r.Pole.Y), 1-2i, 1e-15) {
			t.Fatalf("%s: pole %v, want 1 − 2i", kind, r.Pole)
		}
	}
}

// Every image of a source circle lies on one generalized circle: the circle
// through three independently mapped points, or a line when the source
// circle passes through the pole.
func TestLoomFractionalCirclesStayCircles(t *testing.T) {
	for _, radius := range []float64{.5, 1.5, math.Sqrt(5), 3} {
		q := fractionalLoom("concentric", loxodromic, 1, .01)
		q.Source.Count, q.Source.Radius, q.Tolerance = 1, radius, 1e-4
		r, err := ComputeLoom(q)
		if err != nil {
			t.Fatal(err)
		}
		at := func(theta float64) complex128 { return mobiusAt(loxodromic, cmplx.Rect(radius, theta)) }
		p1, p2, p3 := at(.3), at(2.2), at(4.1)
		through := math.Abs(radius-math.Sqrt(5)) < 1e-15
		// Circumcenter of p1, p2, p3, written out independently.
		ax, ay, bx, by, cx, cy := real(p1), imag(p1), real(p2), imag(p2), real(p3), imag(p3)
		d := 2 * (ax*(by-cy) + bx*(cy-ay) + cx*(ay-by))
		center := complex(
			((ax*ax+ay*ay)*(by-cy)+(bx*bx+by*by)*(cy-ay)+(cx*cx+cy*cy)*(ay-by))/d,
			((ax*ax+ay*ay)*(cx-bx)+(bx*bx+by*by)*(ax-cx)+(cx*cx+cy*cy)*(bx-ax))/d,
		)
		rho := cmplx.Abs(p1 - center)
		drawn := 0
		for j, w := range r.Members[0].Image {
			if w == nil {
				continue
			}
			drawn++
			u := complex(w.X, w.Y)
			if through {
				// Collinear with p1 and p2, relative to the image's size.
				cross := real(p2-p1)*imag(u-p1) - imag(p2-p1)*real(u-p1)
				if math.Abs(cross) > 1e-9*cmplx.Abs(p2-p1)*math.Max(1, cmplx.Abs(u-p1)) {
					t.Fatalf("radius √5: %v at %v is off the image line", u, r.Members[0].At[j])
				}
				continue
			}
			if math.Abs(cmplx.Abs(u-center)-rho) > 1e-10*math.Max(1, rho) {
				t.Fatalf("radius %v: %v is off the image circle (%v, %v)", radius, u, center, rho)
			}
		}
		if drawn < 32 {
			t.Fatalf("radius %v: empty geometry", radius)
		}
		excluded := false
		for _, g := range r.Members[0].Intervals {
			excluded = excluded || g.Reason == "excluded"
		}
		if excluded != through {
			t.Fatalf("radius %v: excluded interval %v, want %v", radius, excluded, through)
		}
	}
}

func TestLoomFractionalIdentityLimits(t *testing.T) {
	for _, c := range []struct {
		name         string
		coefficients [4]complex128
		s            float64
	}{
		{"zero flow", loxodromic, 0},
		{"scalar matrix", [4]complex128{3 - 1i, 0, 0, 3 - 1i}, .37},
		{"scalar matrix at one", [4]complex128{3 - 1i, 0, 0, 3 - 1i}, 1},
	} {
		for _, kind := range []string{"grid", "rosette", "curve"} {
			r, err := ComputeLoom(fractionalLoom(kind, c.coefficients, c.s, .02))
			if err != nil {
				t.Fatalf("%s %s: %v", c.name, kind, err)
			}
			if r.Pole != nil {
				t.Fatalf("%s %s: identity has no pole, got %v", c.name, kind, r.Pole)
			}
			for _, m := range r.Members {
				if len(m.Intervals) != 0 {
					t.Fatalf("%s %s: identity has no exclusion, got %+v", c.name, kind, m.Intervals)
				}
				for j, p := range m.Source {
					if w := m.Image[j]; p != nil && (w == nil || *w != *p) {
						t.Fatalf("%s %s: identity moved %v to %v", c.name, kind, p, w)
					}
				}
			}
		}
	}
}

// Scaling all four coefficients together changes nothing: exactly for a
// power of two, to rounding otherwise.
func TestLoomFractionalScaleInvariance(t *testing.T) {
	base, err := ComputeLoom(fractionalLoom("grid", loxodromic, .6, .02))
	if err != nil {
		t.Fatal(err)
	}
	want, _ := json.Marshal(base)
	for _, k := range []complex128{1 << 18, 1.0 / 1024} {
		var scaled [4]complex128
		for i, v := range loxodromic {
			scaled[i] = k * v
		}
		r, err := ComputeLoom(fractionalLoom("grid", scaled, .6, .02))
		if err != nil {
			t.Fatal(err)
		}
		if got, _ := json.Marshal(r); string(got) != string(want) {
			t.Fatalf("scaling by %v changed the result", k)
		}
	}
	for _, k := range []complex128{3 - 2i, 1e-3i, 4e5} {
		var scaled [4]complex128
		for i, v := range loxodromic {
			scaled[i] = k * v
		}
		for _, s := range []float64{1, .6, -.3} {
			for _, z := range []complex128{0, .3 + .4i, -2 + 1i} {
				a := fractionalImage(t, fractionalLoom("curve", loxodromic, s, .02), z)
				b := fractionalImage(t, fractionalLoom("curve", scaled, s, .02), z)
				if !nearC(a, b, 1e-12) {
					t.Fatalf("scale %v, s = %v: %v vs %v", k, s, a, b)
				}
			}
		}
	}
}

// An affine map (c = 0) has no pole or exclusion, and its flow stays affine.
func TestLoomFractionalAffineLimit(t *testing.T) {
	affine := [4]complex128{1 + 1i, 2, 0, 1}
	for _, s := range []float64{1, .5, -1} {
		for _, kind := range []string{"grid", "concentric", "curve"} {
			r, err := ComputeLoom(fractionalLoom(kind, affine, s, .02))
			if err != nil {
				t.Fatal(err)
			}
			if r.Pole != nil {
				t.Fatalf("s = %v: affine flow gained a pole %v", s, r.Pole)
			}
			for _, m := range r.Members {
				if len(m.Intervals) != 0 {
					t.Fatalf("s = %v %s: affine map has no gaps, got %+v", s, kind, m.Intervals)
				}
			}
		}
	}
	// z ↦ (1 + i)z + 2 is a spiral similarity about its fixed point
	// p = 2/(1 − (1 + i)) = 2i. Its flow is z ↦ p + (1 + i)ˢ(z − p), with
	// the principal power.
	p := 2i
	for _, s := range []float64{1, .5, -.25, -1} {
		for _, z := range []complex128{0, 1 - 1i, 3 + 2i} {
			want := p + cmplx.Pow(1+1i, complex(s, 0))*(z-p)
			if got := fractionalImage(t, fractionalLoom("curve", affine, s, .02), z); !nearC(got, want, 1e-13) {
				t.Fatalf("affine flow s = %v at %v: %v, want %v", s, z, got, want)
			}
		}
	}
	// A pure translation flows uniformly: z ↦ z + 3s.
	translation := [4]complex128{1, 3, 0, 1}
	for _, s := range []float64{.25, -.5} {
		if got := fractionalImage(t, fractionalLoom("curve", translation, s, .02), 1+1i); !nearC(got, 1+1i+complex(3*s, 0), 1e-14) {
			t.Fatalf("translation flow s = %v: %v", s, got)
		}
	}
}

// The flow fixes the map's fixed points, composes as a one-parameter group,
// and reaches the inverse at s = −1.
func TestLoomFractionalFlowGroupInverseAndFixedPoints(t *testing.T) {
	maps := map[string][4]complex128{
		"loxodromic": loxodromic,
		// Elliptic: fixed points ±i, rotation by 2π/3 about them.
		"elliptic": {complex(math.Cos(math.Pi/3), 0), complex(math.Sin(math.Pi/3), 0), complex(-math.Sin(math.Pi/3), 0), complex(math.Cos(math.Pi/3), 0)},
		// Hyperbolic: z ↦ 2z/(z + 1), fixed points 0 and 1, multiplier 2 at 0.
		"hyperbolic": {2, 0, 1, 1},
		// Parabolic and not affine: z ↦ z/(z + 1), fixed point 0.
		"parabolic": {1, 0, 1, 1},
	}
	fixed := map[string][]complex128{
		"loxodromic": {1, -1},
		"elliptic":   {1i, -1i},
		"hyperbolic": {0, 1},
		"parabolic":  {0},
	}
	for name, m := range maps {
		at := func(s float64, z complex128) complex128 {
			return fractionalImage(t, fractionalLoom("curve", m, s, 1e-6), z)
		}
		for _, f := range fixed[name] {
			for _, s := range []float64{1, .3, -.7} {
				if got := at(s, f); !nearC(got, f, 1e-12) {
					t.Fatalf("%s s = %v moved fixed point %v to %v", name, s, f, got)
				}
			}
		}
		for _, z := range []complex128{.2 + .5i, -3 + .25i} {
			if got := at(1, z); !nearC(got, mobiusAt(m, z), 1e-13) {
				t.Fatalf("%s at s = 1: %v, want the entered map %v", name, got, mobiusAt(m, z))
			}
			// Mˢ(Mᵗ(z)) = Mˢ⁺ᵗ(z).
			for _, st := range [][2]float64{{.25, .5}, {.6, -.2}, {-.5, -.5}, {.5, .5}} {
				if got, want := at(st[0], at(st[1], z)), at(st[0]+st[1], z); !nearC(got, want, 1e-11) {
					t.Fatalf("%s: M^%v ∘ M^%v at %v = %v, want %v", name, st[0], st[1], z, got, want)
				}
			}
			// The inverse undoes the map, and equals swapped coefficients.
			w := mobiusAt(m, z)
			if got := at(-1, w); !nearC(got, z, 1e-11) {
				t.Fatalf("%s: M⁻¹(M(%v)) = %v", name, z, got)
			}
			inverse := [4]complex128{m[3], -m[1], -m[2], m[0]}
			if got, want := at(-1, z), fractionalImage(t, fractionalLoom("curve", inverse, 1, 1e-6), z); !nearC(got, want, 1e-12) {
				t.Fatalf("%s: M at −1 is %v, the swapped inverse %v", name, got, want)
			}
		}
	}
}

// The flow near a parabolic map continues into it, and a half-turn flows
// counterclockwise, the direction of the principal square root.
func TestLoomFractionalFlowNearParabolicAndHalfTurn(t *testing.T) {
	z := .4 - .3i
	parabolic := [4]complex128{1, 0, 1, 1}
	for _, eps := range []float64{1e-6, 1e-9, 1e-13} {
		nearby := [4]complex128{1 + complex(eps, 0), 0, 1, 1}
		for _, s := range []float64{.5, -.5} {
			a := fractionalImage(t, fractionalLoom("curve", parabolic, s, 1e-6), z)
			b := fractionalImage(t, fractionalLoom("curve", nearby, s, 1e-6), z)
			// The flow depends smoothly on the coefficients: within a few
			// times the perturbation.
			if cmplx.Abs(a-b) > 4*eps+1e-13 {
				t.Fatalf("eps %v, s = %v: %v vs parabolic %v", eps, s, b, a)
			}
		}
	}
	// z/(sz + 1), the parabolic flow in closed form.
	for _, s := range []float64{.5, -.75} {
		if got := fractionalImage(t, fractionalLoom("curve", parabolic, s, 1e-6), z); !nearC(got, z/(complex(s, 0)*z+1), 1e-14) {
			t.Fatalf("parabolic flow s = %v: %v", s, got)
		}
	}
	// A turn by θ about 0 flows the shorter way: by sθ for |θ| < π.
	for _, theta := range []float64{math.Pi - .01, -(math.Pi - .01), math.Pi + .01} {
		turn := [4]complex128{cmplx.Rect(1, theta/2), 0, 0, cmplx.Rect(1, -theta/2)}
		short := math.Remainder(theta, 2*math.Pi)
		if got := fractionalImage(t, fractionalLoom("curve", turn, .5, 1e-6), z); !nearC(got, cmplx.Rect(1, short/2)*z, 1e-14) {
			t.Fatalf("turn by %v at s = 1/2: %v, want a turn by %v", theta, got, short/2)
		}
	}
	// A half-turn lies on the branch cut. Its flow is one of the two
	// quarter-turns at s = 1/2, the same however its coefficients are
	// scaled, including by −1 and with signed zeros.
	half := fractionalImage(t, fractionalLoom("curve", [4]complex128{1i, 0, 0, -1i}, .5, 1e-6), z)
	if !nearC(half, 1i*z, 1e-15) && !nearC(half, -1i*z, 1e-15) {
		t.Fatalf("half-turn at s = 1/2: %v, want ±iz", half)
	}
	negZero := complex(math.Copysign(0, -1), math.Copysign(0, -1))
	for _, m := range [][4]complex128{
		{-1i, 0, 0, 1i},
		{-4i, 0, 0, 4i},
		{2i, negZero, negZero, -2i},
		{complex(math.Copysign(0, -1), 1), 0, 0, complex(math.Copysign(0, -1), -1)},
		{1, 0, 0, -1},
		{-1, negZero, negZero, 1},
		{1, 0, negZero, complex(-1, math.Copysign(0, -1))},
	} {
		// z ↦ −z with real coefficients is the same map, so the same flow.
		if got := fractionalImage(t, fractionalLoom("curve", m, .5, 1e-6), z); !nearC(got, half, 1e-15) {
			t.Fatalf("half-turn %v at s = 1/2: %v, want %v", m, got, half)
		}
	}
}

// Near the parabolic and identity limits the flow uses a series for
// sinh(sμ)/sinh μ. A scaling z ↦ kz, k = e^{2μ}, flows exactly as kˢz,
// both inside the series (μ < 10⁻⁴) and beyond it.
func TestLoomFractionalFlowSeriesAndExactEntry(t *testing.T) {
	z := .7 - .2i
	for _, mu := range []float64{9e-5, 2e-4, .05, 1} {
		for _, rotate := range []bool{false, true} {
			e := complex(mu, 0)
			if rotate {
				e = complex(0, mu)
			}
			m := [4]complex128{cmplx.Exp(e), 0, 0, cmplx.Exp(-e)}
			k := m[0] / m[3]
			for _, s := range []float64{.5, -.3, .9} {
				want := cmplx.Exp(complex(s, 0)*cmplx.Log(k)) * z
				if got := fractionalImage(t, fractionalLoom("curve", m, s, 1e-6), z); !nearC(got, want, 2e-15) {
					t.Fatalf("μ = %v rotate %v, s = %v: %v, want %v", mu, rotate, s, got, want)
				}
			}
		}
	}
	// At s = 1 the entered coefficients are used directly, so maps that are
	// exact in floating point stay exact: 2z, z + 3 and 1/z.
	for _, c := range []struct {
		m    [4]complex128
		want func(complex128) complex128
	}{
		{[4]complex128{2, 0, 0, 1}, func(z complex128) complex128 { return 2 * z }},
		{[4]complex128{1, 3, 0, 1}, func(z complex128) complex128 { return z + 3 }},
		{[4]complex128{0, 1, 1, 0}, func(z complex128) complex128 { return 1 / z }},
	} {
		for _, z := range []complex128{.5 + .25i, -3 + 2i} {
			if got := fractionalImage(t, fractionalLoom("curve", c.m, 1, 1e-6), z); got != c.want(z) {
				t.Fatalf("%v at %v: %v, want exactly %v", c.m, z, got, c.want(z))
			}
		}
	}
}

// The pole of each frame is excluded exactly, including off the real axis,
// and images grow like 1/δ as a source approaches it.
func TestLoomFractionalPoleCutsAndApproach(t *testing.T) {
	for _, s := range []float64{1, .5, -.6} {
		q := fractionalLoom("grid", loxodromic, s, .4)
		q.Source.XCount, q.Source.YCount, q.Source.XMin, q.Source.XMax, q.Source.YMin, q.Source.YMax = 17, 17, -6, 6, -6, 6
		r, err := ComputeLoom(q)
		if err != nil {
			t.Fatal(err)
		}
		if r.Pole == nil {
			t.Fatalf("s = %v: no pole", s)
		}
		pole := complex(r.Pole.X, r.Pole.Y)
		// Independently: the pole of Mˢ is where Mˢ blows up, so Mˢ near it
		// grows like 1/δ.
		big := func(delta float64) float64 {
			q := fractionalLoom("curve", loxodromic, s, 1e-6)
			return cmplx.Abs(fractionalImage(t, q, pole+complex(delta, delta)))
		}
		if ratio := big(1e-5) / big(1e-4); math.Abs(ratio-10) > .01 {
			t.Fatalf("s = %v: growth toward the reported pole %v is ×%v, want ×10", s, pole, ratio)
		}
		cuts := 0
		for id, m := range r.Members {
			for _, g := range m.Intervals {
				if g.Reason != "excluded" {
					continue
				}
				for _, at := range []float64{g.From, g.To} {
					var z complex128
					if id < 17 {
						z = complex(-6+.75*float64(id), at)
					} else {
						z = complex(at, -6+.75*float64(id-17))
					}
					// The gap ends at drawn nodes outside the closed disk,
					// bisected to within 2⁻¹⁶ of a pilot interval (6/15) of
					// its boundary; lines .75 apart always meet a disk of
					// radius .4. A gap reaching the member's end is not a cut.
					if at == m.Min || at == m.Max {
						continue
					}
					cuts++
					if d := cmplx.Abs(z - pole); d <= .4 || d-.4 > .4/65536 {
						t.Fatalf("s = %v: gap ends at %v, %v from the pole", s, z, d)
					}
				}
			}
			for j, p := range m.Source {
				if p != nil && m.Image[j] != nil && cmplx.Abs(complex(p.X, p.Y)-pole) <= .4 {
					t.Fatalf("s = %v: %v inside the excluded disk was drawn", s, p)
				}
			}
		}
		if cuts == 0 {
			t.Fatalf("s = %v: no line crosses the exclusion disk at %v", s, pole)
		}
	}
	// The excluded disk is closed: a marker inside it, or exactly on its
	// boundary (1.5 − 2i is exactly 0.5 from the pole), has no image.
	for _, c := range []struct {
		z      complex128
		radius float64
	}{{1 - 2i + .04, .05}, {1.5 - 2i, .5}} {
		q := pointLoom(fractionalLoom("curve", loxodromic, 1, c.radius), c.z)
		if m, err := LoomPoint(q); err != nil || m.Image != nil {
			t.Fatalf("marker at %v in the closed disk: %+v %v", c.z, m, err)
		}
	}
}

func TestLoomFractionalValidation(t *testing.T) {
	check := func(q LoomRequest, field string) {
		t.Helper()
		_, err := ComputeLoom(q)
		var named *FieldError
		if !errors.As(err, &named) || named.Field != field {
			t.Fatalf("want a %q error, got %v", field, err)
		}
		if _, err := LoomPoint(q); !errors.As(err, &named) || named.Field != field {
			t.Fatalf("point: want a %q error, got %v", field, err)
		}
	}
	accept := func(q LoomRequest) {
		t.Helper()
		if _, err := ComputeLoom(q); err != nil {
			t.Fatal(err)
		}
	}
	check(fractionalLoom("grid", [4]complex128{}, 1, .02), "coefficients")
	check(fractionalLoom("grid", [4]complex128{1, 1, 1, 1}, 1, .02), "coefficients")
	check(fractionalLoom("grid", [4]complex128{1 + 1i, 2 - 1i, 2 + 2i, 4 - 2i}, 1, .02), "coefficients")
	// A translation by t has ρ = (2 + t²)/2, which reaches 10⁶ at t ≈ 1414.21.
	accept(fractionalLoom("grid", [4]complex128{1, 1414.2, 0, 1}, 1, .02))
	check(fractionalLoom("grid", [4]complex128{1, 1414.3, 0, 1}, 1, .02), "coefficients")
	// Scaling by k has ρ = (|k|² + 1)/(2|k|): admitted to about 2·10⁶.
	accept(fractionalLoom("grid", [4]complex128{1e6, 0, 0, .6}, 1, .02))
	check(fractionalLoom("grid", [4]complex128{1e6, 0, 0, .4}, 1, .02), "coefficients")
	for i, name := range []string{"a.x", "a.y", "b.x", "b.y", "c.x", "c.y", "d.x", "d.y"} {
		m := loxodromic
		if i%2 == 0 {
			m[i/2] = complex(-1000000.5, imag(m[i/2]))
		} else {
			m[i/2] = complex(real(m[i/2]), 1000000.5)
		}
		check(fractionalLoom("grid", m, 1, .02), "coefficients."+name)
	}
	accept(fractionalLoom("grid", [4]complex128{1e6 + 1e6i, 0, 0, 1e6 - 1e6i}, 1, .02))
	check(fractionalLoom("grid", loxodromic, 1.01, .02), "mapParameter")
	check(fractionalLoom("grid", loxodromic, -1.01, .02), "mapParameter")
	accept(fractionalLoom("grid", loxodromic, -1, .02))
	check(fractionalLoom("grid", loxodromic, 1, 0), "exclusionRadius")
	// Every other map ignores coefficients, even degenerate ones.
	for _, name := range []string{"square", "mobius", "exp"} {
		q := fractionalLoom("grid", [4]complex128{}, .5, .02)
		q.Map = name
		plain := q
		plain.Coefficients = nil
		a, err := ComputeLoom(q)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		b, _ := ComputeLoom(plain)
		x, _ := json.Marshal(a)
		y, _ := json.Marshal(b)
		if string(x) != string(y) {
			t.Fatalf("%s: coefficients changed its result", name)
		}
		var fields map[string]any
		_ = json.Unmarshal(x, &fields)
		if _, ok := fields["pole"]; ok {
			t.Fatalf("%s: result gained a pole field", name)
		}
	}
}

// The flow never worsens conditioning, so a frame needs no refusal of its
// own: ρ(Mˢ) ≤ ρ(M) for |s| ≤ 1, on random admitted matrices, a fifth of
// them affine. ρ is computed here from the frame's coefficients.
func TestLoomFractionalFlowKeepsConditioning(t *testing.T) {
	rho := func(a, b, c, d complex128) float64 {
		size := 0.0
		for _, v := range []complex128{a, b, c, d} {
			size += real(v)*real(v) + imag(v)*imag(v)
		}
		return size / (2 * cmplx.Abs(a*d-b*c))
	}
	random := rand.New(rand.NewPCG(3, 82))
	gauss := func() complex128 { return complex(random.NormFloat64(), random.NormFloat64()) }
	tested := 0
	for range 4000 {
		c := &LoomCoefficients{}
		m := [4]complex128{gauss(), gauss(), gauss(), gauss()}
		if random.IntN(5) == 0 {
			m[2] = 0
		}
		c.A, c.B, c.C, c.D = Vec{real(m[0]), imag(m[0])}, Vec{real(m[1]), imag(m[1])}, Vec{real(m[2]), imag(m[2])}, Vec{real(m[3]), imag(m[3])}
		if c.validate() != nil {
			continue
		}
		tested++
		limit := rho(m[0], m[1], m[2], m[3]) * (1 + 1e-12)
		for k := -10; k <= 10; k++ {
			f := c.flow(float64(k) / 10)
			if f.identity {
				continue
			}
			if got := rho(f.a, f.b, f.c, f.d); got > limit {
				t.Fatalf("%v at s = %v: ρ %v exceeds the map's %v", m, float64(k)/10, got, limit)
			}
			if m[2] == 0 && f.c != 0 {
				t.Fatalf("%v: affine flow gained c = %v", m, f.c)
			}
		}
	}
	if tested < 3900 {
		t.Fatalf("only %d admitted matrices", tested)
	}
}
