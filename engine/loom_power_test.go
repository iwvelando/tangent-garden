package engine

import (
	"encoding/json"
	"errors"
	"math"
	"math/cmplx"
	"reflect"
	"testing"
)

// The power request is built through JSON, as the worker sends it, so these
// tests fail behaviorally rather than by compilation before the map exists.
func powerLoom(source string, degree any) LoomRequest {
	q := loomExample(source)
	b, _ := json.Marshal(q)
	var fields map[string]any
	_ = json.Unmarshal(b, &fields)
	fields["map"] = "power"
	if degree != nil {
		fields["degree"] = degree
	}
	b, _ = json.Marshal(fields)
	_ = json.Unmarshal(b, &q)
	return q
}

// Independent polar form |z|^n exp(i n arg z), not repeated multiplication.
func polarPower(p Vec, n int) complex128 {
	return cmplx.Rect(math.Pow(math.Hypot(p.X, p.Y), float64(n)), float64(n)*math.Atan2(p.Y, p.X))
}

func near(w Vec, want complex128, scale float64) bool {
	return math.Hypot(w.X-real(want), w.Y-imag(want)) <= 1e-12*math.Max(scale, math.SmallestNonzeroFloat64)
}

func TestLoomPowerReturnedGeometryMatchesPolarForm(t *testing.T) {
	for n := 2; n <= 6; n++ {
		for _, kind := range []string{"grid", "concentric", "rosette", "curve"} {
			q := powerLoom(kind, n)
			r, err := ComputeLoom(q)
			if err != nil {
				t.Fatalf("degree %d %s: %v", n, kind, err)
			}
			drawn := 0
			for _, m := range r.Members {
				if len(m.Intervals) != 0 {
					t.Fatalf("degree %d %s: unexpected gaps %+v", n, kind, m.Intervals)
				}
				for j, p := range m.Source {
					w := m.Image[j]
					if p == nil || w == nil {
						t.Fatalf("degree %d %s: broken analytic path", n, kind)
					}
					drawn++
					scale := math.Pow(p.Norm(), float64(n))
					if !near(*w, polarPower(*p, n), scale) {
						t.Fatalf("degree %d %s: %v -> %v, want %v", n, kind, p, w, polarPower(*p, n))
					}
				}
			}
			if drawn < 16 {
				t.Fatal("fixture drew too little")
			}
		}
	}
}

// Small explicit polynomials on the line z = t + i, independently expanded.
func TestLoomPowerExplicitPolynomials(t *testing.T) {
	expanded := map[int]func(x float64) complex128{
		3: func(x float64) complex128 { return complex(x*x*x-3*x, 3*x*x-1) },
		4: func(x float64) complex128 { return complex(x*x*x*x-6*x*x+1, 4*x*x*x-4*x) },
		5: func(x float64) complex128 {
			return complex(x*x*x*x*x-10*x*x*x+5*x, 5*x*x*x*x-10*x*x+1)
		},
	}
	for n, want := range expanded {
		q := powerLoom("curve", n)
		for _, at := range []float64{-2, -.5, 0, 1, 1.75} {
			q.Parameter = at
			p, err := LoomPoint(q)
			if err != nil || p.Image == nil {
				t.Fatalf("degree %d at %g: %v %+v", n, at, err, p)
			}
			if !near(*p.Image, want(at), math.Pow(math.Hypot(at, 1), float64(n))) {
				t.Fatalf("degree %d at %g: %v, want %v", n, at, *p.Image, want(at))
			}
		}
	}
	// A real negative source keeps the sign of its odd powers exactly.
	q := powerLoom("curve", 5)
	q.Source.Curve.Y = "0"
	q.Parameter = -2
	p, _ := LoomPoint(q)
	if *p.Image != (Vec{-32, 0}) {
		t.Fatalf("(-2)^5 = %v", *p.Image)
	}
}

func TestLoomPowerConjugationAndRotationCovariance(t *testing.T) {
	phi := 2 * math.Pi / 7
	for n := 2; n <= 6; n++ {
		base := powerLoom("curve", n)
		base.Source.Curve.X, base.Source.Curve.Y = "cos(t)+0.3*t", "0.7*sin(2*t)-0.2"
		conj, turned := base, base
		conj.Source.Curve.Y = "-(0.7*sin(2*t)-0.2)"
		c, s := math.Cos(phi), math.Sin(phi)
		turned.Source.Curve.X = "(cos(t)+0.3*t)*" + ftoa(c) + "-(0.7*sin(2*t)-0.2)*" + ftoa(s)
		turned.Source.Curve.Y = "(cos(t)+0.3*t)*" + ftoa(s) + "+(0.7*sin(2*t)-0.2)*" + ftoa(c)
		for _, at := range []float64{-2, -1.1, 0, .4, 2} {
			base.Parameter, conj.Parameter, turned.Parameter = at, at, at
			w, err1 := LoomPoint(base)
			v, err2 := LoomPoint(conj)
			u, err3 := LoomPoint(turned)
			if err := errors.Join(err1, err2, err3); err != nil {
				t.Fatal(err)
			}
			scale := math.Pow(w.Source.Norm(), float64(n))
			if !near(*v.Image, cmplx.Conj(complex(w.Image.X, w.Image.Y)), scale) {
				t.Fatalf("degree %d: conjugate source does not give conjugate image", n)
			}
			// Rotating z by phi rotates z^n by n phi, about the same fixed zero.
			want := complex(w.Image.X, w.Image.Y) * cmplx.Rect(1, float64(n)*phi)
			if math.Hypot(u.Image.X-real(want), u.Image.Y-imag(want)) > 1e-11*math.Max(scale, 1) {
				t.Fatalf("degree %d: rotation covariance %v vs %v", n, *u.Image, want)
			}
		}
	}
}

func ftoa(v float64) string {
	b, _ := json.Marshal(v)
	return "(" + string(b) + ")"
}

// Zero is a finite critical point, not a pole: it is drawn, maps to zero and
// is the only critical point. The rosette's exact closing and critical
// parameters return exactly.
func TestLoomPowerCriticalZeroAndRosetteClosure(t *testing.T) {
	for n := 2; n <= 6; n++ {
		q := powerLoom("rosette", n)
		q.Source.Count, q.Source.Radius = 5, .8
		q.Selected, q.Parameter = 3, math.Pi
		r, err := ComputeLoom(q)
		if err != nil {
			t.Fatal(err)
		}
		if r.Marker.Source == nil || *r.Marker.Source != (Vec{}) || r.Marker.Image == nil || *r.Marker.Image != (Vec{}) || !r.Marker.Critical {
			t.Fatalf("degree %d: zero must be a drawable critical point: %+v", n, r.Marker)
		}
		critical := 0
		for id, m := range r.Members {
			alpha := 2 * math.Pi * float64(id) / 5
			first, last := m.Image[0], m.Image[len(m.Image)-1]
			// The uniform pilot's last parameter is 2π to rounding, as for squaring.
			if m.At[0] != 0 || math.Abs(m.At[len(m.At)-1]-2*math.Pi) > 1e-15 || first == nil || last == nil || first.Sub(*last).Norm() > 1e-13*math.Pow(1.6, float64(n)) {
				t.Fatalf("degree %d member %d does not close", n, id)
			}
			for j, theta := range m.At {
				w := m.Image[j]
				if m.Critical[j] != (*m.Source[j] == Vec{}) {
					t.Fatalf("degree %d: critical flag at %v", n, *m.Source[j])
				}
				if m.Critical[j] {
					critical++
					if *w != (Vec{}) || theta != math.Pi {
						t.Fatal("critical point is not exactly zero at θ = π")
					}
				}
				// z = 2r cos(θ/2) exp(i(α + θ/2)), so z^n is a rotated sinusoidal spiral.
				want := cmplx.Rect(math.Pow(2*.8*math.Cos(theta/2), float64(n)), float64(n)*(alpha+theta/2))
				if !near(*w, want, math.Pow(1.6, float64(n))) {
					t.Fatalf("degree %d member %d θ=%g: %v want %v", n, id, theta, *w, want)
				}
			}
		}
		if critical != 5 {
			t.Fatalf("degree %d: %d critical samples, want one per circle", n, critical)
		}
		q.Parameter = 1
		p, _ := LoomPoint(q)
		if p.Critical {
			t.Fatal("regular point classified critical")
		}
	}
}

// Degree two is the legacy square on the common retained domain: identical
// returned geometry, counters and marker for every family, bit for bit.
func TestLoomPowerDegreeTwoIsLegacySquare(t *testing.T) {
	for _, kind := range []string{"grid", "concentric", "rosette", "curve"} {
		for _, scale := range []float64{1e-6, 1, 1e6} {
			square := loomExample(kind)
			square.Source.Radius *= scale
			square.Source.XMin, square.Source.XMax = -.9*scale, scale
			square.Source.YMin, square.Source.YMax = -scale, .7*scale
			if scale == 1e6 {
				// Spans are bounded; a large grid sits off center.
				square.Source.XMin, square.Source.YMin = .95*scale, .63*scale
			}
			square.Source.Curve.X = "t*" + ftoa(scale)
			square.Source.Curve.Y = "sin(3*t)*" + ftoa(scale)
			square.Parameter = .3
			if kind == "grid" || kind == "curve" {
				square.Parameter = square.Source.YMin
			}
			if kind == "curve" {
				square.Parameter = .3
			}
			power := powerLoom(kind, 2)
			power.Source, power.Parameter = square.Source, square.Parameter
			a, err := ComputeLoom(square)
			if err != nil {
				t.Fatal(err)
			}
			b, err := ComputeLoom(power)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(a, b) {
				t.Fatalf("%s at scale %g: degree two differs from squaring", kind, scale)
			}
		}
	}
}

// The power map has no pole and no identity limit: rational settings left on
// the study must neither exclude a disk nor turn z^n into z.
func TestLoomPowerIgnoresRationalSettings(t *testing.T) {
	plain := powerLoom("concentric", 3)
	want, err := ComputeLoom(plain)
	if err != nil {
		t.Fatal(err)
	}
	for _, settings := range [][2]float64{{0, 0}, {0, .05}, {.5, .05}, {.9, 1e7}} {
		q := plain
		q.MapParameter, q.ExclusionRadius = settings[0], settings[1]
		got, err := ComputeLoom(q)
		if err != nil || !reflect.DeepEqual(got, want) {
			t.Fatalf("rational settings %v changed the power map: %v", settings, err)
		}
	}
	q := plain
	q.Source.Kind, q.Parameter = "rosette", 0
	p, _ := LoomPoint(q)
	if *p.Image != (Vec{8, 0}) {
		t.Fatalf("2^3 = %v; an identity fast path leaked in", *p.Image)
	}
}

func TestLoomPowerDegreeValidation(t *testing.T) {
	for _, degree := range []any{nil, 0, 1, 7, -2, 100} {
		_, err := ComputeLoom(powerLoom("rosette", degree))
		var field *FieldError
		if !errors.As(err, &field) || field.Field != "degree" {
			t.Fatalf("degree %v accepted: %v", degree, err)
		}
		_, err = LoomPoint(powerLoom("rosette", degree))
		if !errors.As(err, &field) || field.Field != "degree" {
			t.Fatalf("point degree %v accepted: %v", degree, err)
		}
	}
	for _, degree := range []int{2, 6} {
		if _, err := ComputeLoom(powerLoom("rosette", degree)); err != nil {
			t.Fatalf("degree endpoint %d refused: %v", degree, err)
		}
	}
	// The squaring request keeps ignoring an absent degree.
	if _, err := ComputeLoom(loomExample("rosette")); err != nil {
		t.Fatal(err)
	}
}

// Every admitted analytic family lies inside the fence, even at the largest
// and smallest admitted scales and the highest degree.
func TestLoomPowerAdmittedAnalyticScales(t *testing.T) {
	for _, radius := range []float64{1e-6, 1e6} {
		for _, kind := range []string{"rosette", "concentric", "grid"} {
			q := powerLoom(kind, 6)
			q.Source.Radius = radius
			if kind == "grid" {
				q.Source.XMin, q.Source.XMax, q.Source.YMin, q.Source.YMax = -radius, radius, -radius, radius
				if radius == 1e6 {
					q.Source.XMin, q.Source.XMax, q.Source.YMin, q.Source.YMax = 9e5, 1e6, 9e5, 1e6
				}
				q.Parameter = q.Source.YMin
			}
			r, err := ComputeLoom(q)
			if err != nil {
				t.Fatal(err)
			}
			for _, m := range r.Members {
				if len(m.Intervals) != 0 {
					t.Fatalf("%s radius %g: admitted family was clipped: %+v", kind, radius, m.Intervals)
				}
				for j, p := range m.Source {
					if w := m.Image[j]; !near(*w, polarPower(*p, 6), math.Pow(p.Norm(), 6)) {
						t.Fatalf("%s radius %g: %v -> %v", kind, radius, p, w)
					}
				}
			}
		}
	}
}

// A selected curve crossing the image fence breaks there with a clipped gap;
// nothing beyond it, nonfinite or joined across it is delivered.
func TestLoomPowerFenceCrossingsAndEmptyImages(t *testing.T) {
	for n := 2; n <= 6; n++ {
		edge := math.Pow(LoomPowerImageLimit, 1/float64(n))
		q := powerLoom("curve", n)
		// Source parameters are bounded, so the scale enters the expression.
		q.Source.Curve.X, q.Source.Curve.Y = "t*"+ftoa(edge), "0.25*t*"+ftoa(edge)
		q.Source.Curve.Min, q.Source.Curve.Max = 0, 2
		q.Parameter = 1.9
		r, err := ComputeLoom(q)
		if err != nil {
			t.Fatal(err)
		}
		m := r.Members[0]
		if len(m.Intervals) != 1 || m.Intervals[0].Reason != "clipped" || m.Intervals[0].To != 2 {
			t.Fatalf("degree %d: missing clipped tail: %+v", n, m.Intervals)
		}
		// |z| = t·edge·√(1 + 1/16) reaches the fence at t = 1/√(17/16);
		// one-sided bisection from a pilot interval of 2/15 locates it
		// within 16 levels.
		crossing := 1 / math.Sqrt(17./16)
		if from := m.Intervals[0].From; from > crossing || crossing-from > 2./(15*65536) {
			t.Fatalf("degree %d: crossing at %g not localized near %g", n, from, crossing)
		}
		drawn := 0
		for j, w := range m.Image {
			if w == nil {
				continue
			}
			drawn++
			if !finite(w.X) || !finite(w.Y) || w.Norm() > LoomPowerImageLimit || m.At[j] > crossing {
				t.Fatalf("degree %d: point beyond fence %v at %g", n, w, m.At[j])
			}
		}
		if drawn < 8 || r.Marker.Image != nil {
			t.Fatalf("degree %d: retained side lost or fenced marker drawn", n)
		}
		p, err := LoomPoint(q)
		if err != nil || p.Image != nil || p.Source == nil {
			t.Fatalf("degree %d: point-only marker disagrees: %+v", n, p)
		}
	}
	// Far enough out that z^6 would overflow float64: the whole member is an
	// honest empty image, never NaN.
	for _, x := range []string{"1e60+t", "1e200*(2+cos(t))"} {
		q := powerLoom("curve", 6)
		q.Source.Curve.X, q.Source.Curve.Y = x, "t"
		r, err := ComputeLoom(q)
		if err != nil {
			t.Fatal(err)
		}
		m := r.Members[0]
		for _, w := range m.Image {
			if w != nil {
				t.Fatal("overflowing image delivered")
			}
		}
		if len(m.Intervals) != 1 || m.Intervals[0].Reason != "clipped" || m.Intervals[0].From != m.Min || m.Intervals[0].To != m.Max {
			t.Fatalf("empty image is not one clipped interval: %+v", m.Intervals)
		}
		if r.Exhausted || r.Evaluations > 2*q.Samples {
			t.Fatalf("an empty image should settle without refinement: %+v", r)
		}
	}
}

func TestLoomPowerRefinementConvergesWithinBudgets(t *testing.T) {
	q := powerLoom("curve", 5)
	q.Samples = 4
	errorAt := func(r LoomResult) float64 {
		m := r.Members[0]
		worst := 0.0
		for i := 1; i < len(m.At); i++ {
			z := complex((m.At[i]+m.At[i-1])/2, 1)
			w := z * z * z * z * z
			worst = math.Max(worst, plane.Distance(Vec{real(w), imag(w)}, *m.Image[i-1], *m.Image[i]))
		}
		return worst
	}
	q.Tolerance = .02
	coarse, err := ComputeLoom(q)
	if err != nil {
		t.Fatal(err)
	}
	q.Tolerance = .0002
	fine, err := ComputeLoom(q)
	if err != nil {
		t.Fatal(err)
	}
	if errorAt(fine) >= errorAt(coarse)/4 {
		t.Fatal("power refinement did not converge", errorAt(coarse), errorAt(fine))
	}
	// The densest admitted interaction stays within the shared ceilings.
	dense := powerLoom("grid", 6)
	dense.Source.XCount, dense.Source.YCount = 32, 32
	dense.Samples, dense.Tolerance = 1024, 1e-6
	r, err := ComputeLoom(dense)
	if err != nil {
		t.Fatal(err)
	}
	if r.Points > LoomMaxPoints || r.Evaluations > LoomMaxEvaluations || r.NumericEntries > LoomMaxNumericEntries {
		t.Fatalf("dense power study escaped its budgets: %d %d %d", r.Points, r.Evaluations, r.NumericEntries)
	}
	r, err = computeLoom(dense, loomLimits{points: 300, evaluations: 200, depth: 3})
	if err != nil || !r.Exhausted || r.Points > 300 || r.Evaluations > 200 {
		t.Fatalf("small budget not honored: %v %+v", err, r.Exhausted)
	}
}
