package engine

import (
	"encoding/json"
	"errors"
	"math"
	"math/cmplx"
	"reflect"
	"strconv"
	"testing"
)

// wrapLoom is the composite exp(zⁿ) at map parameter s, built through JSON
// as the worker sends it; a nil s leaves the field out.
func wrapLoom(source string, degree int, s any) LoomRequest {
	q := compositeLoom(source, degree)
	b, _ := json.Marshal(q)
	var fields map[string]any
	_ = json.Unmarshal(b, &fields)
	if s != nil {
		fields["wrap"] = s
	}
	b, _ = json.Marshal(fields)
	q = LoomRequest{}
	_ = json.Unmarshal(b, &q)
	return q
}

// wrapOf is G_s(u) = s + (e^{su} − 1)/s written independently: the series
// of (e^v − 1)/v summed to convergence for |v| ≤ 1, and math/cmplx's
// exponential beyond, with G_0(u) = u.
func wrapOf(u complex128, s float64) complex128 {
	if s == 0 {
		return u
	}
	v := complex(s, 0) * u
	var phi complex128
	if cmplx.Abs(v) <= 1 {
		term := complex(1, 0)
		for k := 1; k < 40; k++ {
			phi += term
			term *= v / complex(float64(k+1), 0)
		}
	} else {
		phi = (cmplx.Exp(v) - 1) / v
	}
	return complex(s, 0) + u*phi
}

// members compares the drawn geometry and breaks of two results exactly.
func sameMembers(a, b LoomResult) bool {
	x, _ := json.Marshal(a.Members)
	y, _ := json.Marshal(b.Members)
	return string(x) == string(y)
}

// The family's ends are the delivered maps, bit for bit: at s = 1, and with
// s left out, the composite exp(zⁿ); at s = 0 the power map zⁿ, with the same
// geometry, breaks and work. Rational settings ride along, ignored.
func TestLoomWrapEndsAreTheDeliveredMaps(t *testing.T) {
	for _, kind := range []string{"grid", "concentric", "rosette", "curve"} {
		for n := 2; n <= 6; n++ {
			absent := wrapLoom(kind, n, nil)
			absent.MapParameter, absent.ExclusionRadius = .5, .1
			want, err := ComputeLoom(absent)
			if err != nil {
				t.Fatal(err)
			}
			one := wrapLoom(kind, n, 1)
			one.MapParameter, one.ExclusionRadius = .5, .1
			got, err := ComputeLoom(one)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("%s n=%d: s = 1 is not the composite", kind, n)
			}
			zero := wrapLoom(kind, n, 0)
			got, err = ComputeLoom(zero)
			if err != nil {
				t.Fatal(err)
			}
			power := zero
			power.Map, power.Wrap = "power", nil
			want, err = ComputeLoom(power)
			if err != nil {
				t.Fatal(err)
			}
			if !sameMembers(got, want) || got.Points != want.Points || got.Evaluations != want.Evaluations || got.Exhausted != want.Exhausted {
				t.Fatalf("%s n=%d: s = 0 is not the power map (%d/%d evaluations)", kind, n, got.Evaluations, want.Evaluations)
			}
			if *got.Marker.Image != *want.Marker.Image || *got.Marker.Intermediate != *want.Marker.Image {
				t.Fatalf("%s n=%d: s = 0 marker %+v, power %+v", kind, n, got.Marker, want.Marker)
			}
		}
	}
}

// Every drawn point is G_s(zⁿ) of its source point with s·zⁿ in the
// exponential's window, including small s, where (e^{su} − 1)/s cancels.
func TestLoomWrapReturnedGeometryIsTheFamily(t *testing.T) {
	for _, s := range []float64{1e-300, 1e-12, 1e-6, 1e-3, .01, .2, .5, .9, 1 - 1e-12} {
		for _, kind := range []string{"grid", "concentric", "rosette", "curve"} {
			for _, n := range []int{2, 3, 5} {
				q := wrapLoom(kind, n, s)
				q.Source.Radius = .9
				r, err := ComputeLoom(q)
				if err != nil {
					t.Fatalf("s=%g %s n=%d: %v", s, kind, n, err)
				}
				drawn := 0
				for _, m := range r.Members {
					for j, p := range m.Source {
						if p == nil || m.Image[j] == nil {
							continue
						}
						drawn++
						u, _ := compositeOf(*p, n)
						if !inWindow(complex(s, 0)*u, 1e-12*math.Max(s*cmplx.Abs(u), 1)) {
							t.Fatalf("s=%g %s n=%d: drawn with s·zⁿ = %v outside the window", s, kind, n, complex(s, 0)*u)
						}
						if want := wrapOf(u, s); !nearComplex(*m.Image[j], want, 1e-12) {
							t.Fatalf("s=%g %s n=%d: %v -> %v, want %v", s, kind, n, p, m.Image[j], want)
						}
					}
				}
				if drawn < 16 {
					t.Fatalf("s=%g %s n=%d: fixture drew too little", s, kind, n)
				}
				if r.Marker.Intermediate == nil {
					t.Fatalf("s=%g: no intermediate", s)
				}
				if u, _ := compositeOf(*r.Marker.Source, n); !nearComplex(*r.Marker.Intermediate, u, 1e-14) {
					t.Fatalf("s=%g: the intermediate is %v, want zⁿ = %v", s, r.Marker.Intermediate, u)
				}
			}
		}
	}
	// Near zero the family leaves the power linearly: |G_s(u) − u| ≈ s|1 + u²/2|.
	q := wrapLoom("curve", 3, nil)
	q.Source.Curve = Curve{Format: "parametric", X: "0.9", Y: "0.4", Min: 0, Max: 1}
	q.Parameter = 0
	for _, s := range []float64{1e-4, 1e-6, 1e-8} {
		v := s
		q.Wrap = &v
		m, err := LoomPoint(q)
		if err != nil {
			t.Fatal(err)
		}
		u := complex(m.Intermediate.X, m.Intermediate.Y)
		lead := complex(s, 0) * (1 + u*u/2)
		if d := complex(m.Image.X, m.Image.Y) - u; cmplx.Abs(d-lead) > 2*s*s*cmplx.Abs(u*u*u) {
			t.Fatalf("s=%g: G_s(u) − u = %v, want %v + O(s²)", s, d, lead)
		}
	}
}

// G_s′(z) = n zⁿ⁻¹ e^{s zⁿ}: the quotient of returned neighbors is its mean
// along their chord, by Simpson's rule on the independent formula.
func TestLoomWrapDerivativeFromReturnedNeighbors(t *testing.T) {
	for _, s := range []float64{.001, .3, .75} {
		for _, kind := range []string{"concentric", "grid", "rosette"} {
			n := 3
			q := wrapLoom(kind, n, s)
			q.Source.Radius, q.Source.Count = .8, 3
			q.Source.XMin, q.Source.XMax, q.Source.YMin, q.Source.YMax = -1, 1, -1, 1
			q.Tolerance = 1e-6
			r, err := ComputeLoom(q)
			if err != nil {
				t.Fatal(err)
			}
			derivative := func(z complex128) complex128 {
				return complex(float64(n), 0) * cmplx.Pow(z, complex(float64(n-1), 0)) * cmplx.Exp(complex(s, 0)*cmplx.Pow(z, complex(float64(n), 0)))
			}
			worst, checked := 0.0, 0
			for _, m := range r.Members {
				for j := 1; j < len(m.At); j++ {
					a, b, wa, wb := m.Source[j-1], m.Source[j], m.Image[j-1], m.Image[j]
					if a == nil || b == nil || wa == nil || wb == nil {
						continue
					}
					dz := complex(b.X-a.X, b.Y-a.Y)
					if cmplx.Abs(dz) == 0 || cmplx.Abs(dz) > .02 {
						continue
					}
					za, zb := complex(a.X, a.Y), complex(b.X, b.Y)
					want := (derivative(za) + 4*derivative((za+zb)/2) + derivative(zb)) / 6
					got := complex(wb.X-wa.X, wb.Y-wa.Y) / dz
					worst = math.Max(worst, cmplx.Abs(got-want)/math.Max(cmplx.Abs(want), 1))
					checked++
				}
			}
			if checked < 50 || worst > 1e-6 {
				t.Fatalf("s=%g %s: derivative differs by %g over %d chords", s, kind, worst, checked)
			}
		}
	}
}

// G_s′ never vanishes away from zero, which stays the only critical point
// and maps to exactly s, sliding from the power's 0 to the composite's 1.
func TestLoomWrapCriticalOnlyAtZero(t *testing.T) {
	for _, s := range []float64{0, 1e-9, .25, .5, 1} {
		for n := 2; n <= 6; n++ {
			q := wrapLoom("rosette", n, s)
			q.Source.Radius = .5
			r, err := ComputeLoom(q)
			if err != nil {
				t.Fatal(err)
			}
			for _, m := range r.Members {
				found := false
				for j, p := range m.Source {
					zero := p != nil && p.X == 0 && p.Y == 0
					if m.Critical[j] != zero {
						t.Fatalf("s=%g n=%d: critical %v at %v", s, n, m.Critical[j], p)
					}
					if zero {
						found = true
						if *m.Image[j] != (Vec{s, 0}) {
							t.Fatalf("s=%g n=%d: zero maps to %v, want exactly s", s, n, m.Image[j])
						}
					}
				}
				if !found {
					t.Fatalf("s=%g n=%d: the critical zero was not drawn", s, n)
				}
			}
		}
	}
}

// The domain is D = {z : s zⁿ in the window}: for z = ½ + iy squared at
// s = ¼, Re s z² = (¼ − y²)/4 = −ln 10⁸ at |y| = √(¼ + 4 ln 10⁸), past the
// composite's own edge. The crossing is a clipped gap located to the depth
// limit, and the domain grows as s falls.
func TestLoomWrapDomainGrowsAsTheParameterFalls(t *testing.T) {
	q := wrapLoom("grid", 2, .25)
	q.Source.XCount, q.Source.YCount = 1, 1
	q.Source.XMin, q.Source.XMax, q.Source.YMin, q.Source.YMax = 0, 1, -12, 12
	q.Samples = 16
	q.Parameter = -12
	r, err := ComputeLoom(q)
	if err != nil {
		t.Fatal(err)
	}
	m := r.Members[0]
	edge := math.Sqrt(.25 + 4*expReal)
	resolution := 24.0 / 15 / math.Exp2(LoomMaxDepth)
	if len(m.Intervals) != 2 || m.Intervals[0].Reason != "clipped" || m.Intervals[1].Reason != "clipped" {
		t.Fatalf("intervals %+v", m.Intervals)
	}
	if math.Abs(m.Intervals[0].To+edge) > resolution || math.Abs(m.Intervals[1].From-edge) > resolution {
		t.Fatalf("boundary at %g and %g, want ±%g", m.Intervals[0].To, m.Intervals[1].From, edge)
	}
	for j, w := range m.Image {
		if w != nil && math.Abs(m.At[j]) > edge {
			t.Fatalf("drawn beyond the domain at y = %g", m.At[j])
		}
	}
	// Below the scale where |y|² stays under ln 10⁸/s, nothing is clipped.
	small := .05
	q.Wrap = &small
	if r, _ = ComputeLoom(q); len(r.Members[0].Intervals) != 0 {
		t.Fatalf("s=%g clipped %+v", small, r.Members[0].Intervals)
	}
}

// Narrow arcs of the scaled domain on grids and circles are still found:
// the speed bound s n Mⁿ⁻¹ |z′| scales with the parameter. Circles just
// inside the corners' radius (31.16/s)^{1/n} meet the window in arcs that
// coarse pilots straddle while clipped at both ends.
func TestLoomWrapFindsNarrowArcsOfTheScaledDomain(t *testing.T) {
	for _, s := range []float64{.5, .05} {
		for n := 2; n <= 6; n++ {
			limit := math.Pow(math.Hypot(expReal, expImag)/s, 1/float64(n))
			q := wrapLoom("concentric", n, s)
			q.Source.Count, q.Source.Radius = 3, .9995*limit
			q.Samples, q.Tolerance = 4, .05
			r, err := ComputeLoom(q)
			if err != nil {
				t.Fatal(err)
			}
			arcs := 0
			for _, m := range r.Members {
				radius := q.Source.Radius * float64(m.ID+1) / 3
				const steps = 200000
				inside, from := false, 0.0
				for k := 0; k <= steps; k++ {
					t0 := 2 * math.Pi * float64(k) / steps
					u := complex(s, 0) * cmplx.Pow(cmplx.Rect(radius, t0), complex(float64(n), 0))
					now := inWindow(u, 0)
					if now && !inside {
						from = t0
					}
					if !now && inside || now && k == steps {
						arcs++
						found := false
						for j, w := range m.Image {
							found = found || w != nil && m.At[j] >= from-1e-6 && m.At[j] <= t0+1e-6
						}
						if !found {
							t.Fatalf("s=%g n=%d %s: inside arc %g–%g not drawn", s, n, m.Name, from, t0)
						}
					}
					inside = now
				}
			}
			if arcs == 0 {
				t.Fatalf("s=%g n=%d: the fixture has no inside arc", s, n)
			}
		}
	}
}

// G_s(z′) = G_s(z) exactly when z′ⁿ = zⁿ + 2πik/s. The marker lists the
// turns of z and the n-th roots of zⁿ + 2πik/s whose s·z′ⁿ lies in the
// window; at s = 0 only the turns share the power's image.
func TestLoomWrapSharedImagePoints(t *testing.T) {
	for _, s := range []float64{0, .1, .5, 1} {
		drawn := 0
		for n := 2; n <= 5; n++ {
			for _, at := range []float64{.7, math.Pi, 5.1} {
				q := wrapLoom("rosette", n, s)
				q.Source.Radius = 1.2
				q.Selected, q.Parameter = 1, at
				marker, err := LoomPoint(q)
				if err != nil {
					t.Fatal(err)
				}
				if marker.Image == nil {
					// Outside the domain: nothing shares an undrawn image.
					if len(marker.Translates) != 0 {
						t.Fatalf("s=%g n=%d θ=%g: clipped marker lists shared points", s, n, at)
					}
					continue
				}
				drawn++
				u, _ := compositeOf(*marker.Source, n)
				w := wrapOf(u, s)
				periods := 1
				if s > 0 {
					periods = 0
					for k := -100; k <= 100; k++ {
						if math.Abs(s*imag(u)+2*math.Pi*float64(k)) <= expImag {
							periods++
						}
					}
				}
				want := periods*n - 1
				zero := marker.Source.X == 0 && marker.Source.Y == 0
				if zero {
					want = (periods - 1) * n
				}
				if len(marker.Translates) != want {
					t.Fatalf("s=%g n=%d θ=%g: %d shared-image points, want %d", s, n, at, len(marker.Translates), want)
				}
				seen := append([]Vec{*marker.Source}, marker.Translates...)
				for i, z := range marker.Translates {
					v, _ := compositeOf(z, n)
					if !nearComplex(Vec{real(wrapOf(v, s)), imag(wrapOf(v, s))}, w, 1e-10) || !inWindow(complex(s, 0)*v, 1e-9) {
						t.Fatalf("s=%g n=%d θ=%g: %v maps to %v, want %v", s, n, at, z, wrapOf(v, s), w)
					}
					for _, other := range seen[:i+1] {
						if z.Sub(other).Norm() < 1e-9 {
							t.Fatalf("s=%g n=%d θ=%g: %v listed twice or equals the point itself", s, n, at, z)
						}
					}
				}
			}
		}
		if drawn < 6 {
			t.Fatalf("s=%g: only %d drawn markers", s, drawn)
		}
	}
}

// The period 2πi/s acts on s·zⁿ, so the aliasing guards measure it there.
// On the curve whose square is (½ + it)/s, pilots a whole period of s·zⁿ
// apart share one image; subdividing by distance in s·zⁿ, the image still
// winds sixteen times around its circle, center s − 1/s and radius e^{½}/s,
// and no drawn chord spans more than a quarter period of s·zⁿ.
func TestLoomWrapAliasingGuardsUseTheScaledIntermediate(t *testing.T) {
	s := .5
	q := wrapLoom("curve", 2, s)
	// z² = (½ + it)/s = 1 + 2it.
	x := "sqrt((sqrt(1+4*t^2)+1)/2)"
	q.Source.Curve = Curve{Format: "parametric", X: x, Y: "t/" + x, Min: -expImag, Max: expImag}
	q.Samples = 5
	q.Parameter = q.Source.Curve.Min
	r, err := ComputeLoom(q)
	if err != nil {
		t.Fatal(err)
	}
	m := r.Members[0]
	center, radius := complex(s-1/s, 0), math.Exp(.5)/s
	drawn := 0
	for j := range m.At {
		if m.Image[j] == nil {
			t.Fatalf("broken inside the domain at %g", m.At[j])
		}
		drawn++
		if d := cmplx.Abs(complex(m.Image[j].X, m.Image[j].Y) - center); math.Abs(d-radius) > 1e-12*radius {
			t.Fatalf("off the circle at %g: %g", m.At[j], d)
		}
		if j > 0 {
			a, _ := compositeOf(*m.Source[j-1], 2)
			b, _ := compositeOf(*m.Source[j], 2)
			if s*cmplx.Abs(b-a) > math.Pi/2 {
				t.Fatalf("chord spans %g of s·zⁿ", s*cmplx.Abs(b-a))
			}
		}
	}
	if drawn < 8*16 || r.Exhausted {
		t.Fatalf("aliased or exhausted: %d points", drawn)
	}
}

func TestLoomWrapValidation(t *testing.T) {
	for _, s := range []float64{-1e-9, 1 + 1e-9, math.NaN(), math.Inf(1)} {
		q := wrapLoom("grid", 3, nil)
		q.Wrap = &s
		for _, compute := range []func(LoomRequest) error{
			func(q LoomRequest) error { _, err := ComputeLoom(q); return err },
			func(q LoomRequest) error { _, err := LoomPoint(q); return err },
		} {
			var field *FieldError
			if err := compute(q); !errors.As(err, &field) || field.Field != "wrap" {
				t.Fatalf("s=%g: %v", s, err)
			}
		}
	}
	// Every other map ignores it.
	for _, m := range []string{"square", "power", "exp", "mobius", "joukowski"} {
		q := wrapLoom("grid", 3, nil)
		q.Map, q.MapParameter, q.ExclusionRadius = m, .5, .1
		plain, err := ComputeLoom(q)
		if err != nil {
			t.Fatal(err)
		}
		bad := -4.0
		q.Wrap = &bad
		other, err := ComputeLoom(q)
		if err != nil || !reflect.DeepEqual(plain, other) {
			t.Fatalf("%s read the composite's parameter: %v", m, err)
		}
	}
}

// Every frame stays inside the shared budgets, and a tiny parameter, whose
// period 2π/s passes the power's fence, lists no point beyond it.
func TestLoomWrapWorkAndExtremes(t *testing.T) {
	for _, s := range []float64{1e-6, .1, .6} {
		for _, n := range []int{2, 6} {
			limit := math.Pow(math.Hypot(expReal, expImag)/s, 1/float64(n))
			dense := wrapLoom("grid", n, s)
			dense.Source.XCount, dense.Source.YCount = 32, 32
			dense.Source.XMin, dense.Source.XMax, dense.Source.YMin, dense.Source.YMax = -limit, limit, -limit, limit
			dense.Samples, dense.Tolerance = 1024, 1e-6
			r, err := ComputeLoom(dense)
			if err != nil {
				t.Fatal(err)
			}
			if r.Points > LoomMaxPoints || r.Evaluations > LoomMaxEvaluations || r.NumericEntries > LoomMaxNumericEntries {
				t.Fatalf("s=%g n=%d: escaped its budgets", s, n)
			}
		}
	}
	// The power's fence clips every frame's image near s = 0, where the
	// scaled window no longer bounds it: z = 10⁵¹ t squares past 10¹⁰⁰ at
	// t = 1/10. A marker beyond it, though short of the power's own
	// overflow guard at t = 1/5, lists no shared-image point.
	for _, s := range []float64{0, 1e-110} {
		q := wrapLoom("curve", 2, s)
		q.Source.Curve = Curve{Format: "parametric", X: "1e51*t", Y: "0", Min: 0, Max: 1}
		q.Parameter = .15
		r, err := ComputeLoom(q)
		if err != nil {
			t.Fatal(err)
		}
		m := r.Members[0]
		if len(m.Intervals) != 1 || m.Intervals[0].Reason != "clipped" || m.Intervals[0].To != 1 || math.Abs(m.Intervals[0].From-.1) > 1.0/15/math.Exp2(LoomMaxDepth) {
			t.Fatalf("s=%g: intervals %+v", s, m.Intervals)
		}
		for _, w := range m.Image {
			if w != nil && w.Norm() > LoomPowerImageLimit {
				t.Fatalf("s=%g: drawn beyond the fence", s)
			}
		}
		if r.Marker.Image != nil || r.Marker.Intermediate == nil || len(r.Marker.Translates) != 0 {
			t.Fatalf("s=%g: marker beyond the fence %+v", s, r.Marker)
		}
	}
	q := wrapLoom("curve", 2, 1e-100)
	q.Source.Curve = Curve{Format: "parametric", X: "1e40", Y: strconv.Itoa(0), Min: 0, Max: 1}
	q.Parameter = 0
	m, err := LoomPoint(q)
	if err != nil {
		t.Fatal(err)
	}
	if m.Image == nil || len(m.Translates) != 1 {
		t.Fatalf("tiny s: image %v, %d shared-image points (only the turn)", m.Image, len(m.Translates))
	}
}

// The search of stretches clipped at both ends is scale-invariant: the frame
// at s on circles of radius R s^{-1/n} is the composite on radius R, since
// s zⁿ is then the composite's own zⁿ, so it costs the same, whether the
// circles meet the domain in narrow arcs or lie wholly outside it.
func TestLoomWrapDomainSearchScalesWithTheParameter(t *testing.T) {
	for _, n := range []int{2, 5} {
		limit := math.Pow(math.Hypot(expReal, expImag), 1/float64(n))
		for _, radius := range []float64{.9995 * limit, 1.01 * limit} {
			cost := func(s float64) int {
				q := wrapLoom("concentric", n, s)
				q.Source.Count, q.Source.Radius = 3, radius*math.Pow(s, -1/float64(n))
				q.Samples, q.Tolerance = 4, .05
				r, err := ComputeLoom(q)
				if err != nil {
					t.Fatal(err)
				}
				return r.Evaluations
			}
			want := cost(1)
			for _, s := range []float64{.5, .05} {
				if got := cost(s); math.Abs(float64(got-want)) > float64(want)/50 {
					t.Fatalf("n=%d radius %g: %d evaluations at s=%g, %d at s=1", n, radius, got, s, want)
				}
			}
		}
	}
}
