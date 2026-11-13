package engine

import (
	"encoding/json"
	"errors"
	"math"
	"math/cmplx"
	"reflect"
	"testing"
)

// foldLoom is the power map of degree n at map parameter s, built through
// JSON as the worker sends it; a nil s leaves the field out.
func foldLoom(source string, n int, s any) LoomRequest {
	q := powerLoom(source, n)
	b, _ := json.Marshal(q)
	var fields map[string]any
	_ = json.Unmarshal(b, &fields)
	if s != nil {
		fields["fold"] = s
	}
	b, _ = json.Marshal(fields)
	q = LoomRequest{}
	_ = json.Unmarshal(b, &q)
	return q
}

// foldOf is H_s(z) = (1 − s)z + s zⁿ, with zⁿ in independent polar form.
func foldOf(p Vec, n int, s float64) complex128 {
	return complex(1-s, 0)*complex(p.X, p.Y) + complex(s, 0)*polarPower(p, n)
}

// foldScale bounds the size of H_s(z)'s two terms, the scale of its rounding.
func foldScale(p Vec, n int, s float64) float64 {
	r := p.Norm()
	return (1-s)*r + s*math.Pow(r, float64(n))
}

// foldDerivative is H_s′(z) = 1 − s + s n zⁿ⁻¹.
func foldDerivative(z complex128, n int, s float64) complex128 {
	return complex(1-s, 0) + complex(s*float64(n), 0)*cmplx.Pow(z, complex(float64(n-1), 0))
}

var foldParameters = []float64{5e-324, 1e-300, 1e-12, 1e-3, .2, .5, .9, 1 - 1e-12}

// The family's ends are the delivered maps: with s left out and at s = 1,
// the power, bit for bit, while another map's retained parameter and
// exclusion ride along unread, as in links made before s existed; at s = 0
// the identity, every drawn image exactly its source, with nothing clipped
// and no point critical, even far beyond the power's overflow guard.
func TestLoomFoldEndsAreTheDeliveredMaps(t *testing.T) {
	for n := 2; n <= 6; n++ {
		for _, kind := range []string{"grid", "concentric", "rosette", "curve"} {
			absent := foldLoom(kind, n, nil)
			absent.MapParameter, absent.ExclusionRadius = .5, .1
			want, err := ComputeLoom(absent)
			if err != nil {
				t.Fatal(err)
			}
			one := foldLoom(kind, n, 1)
			one.MapParameter, one.ExclusionRadius = .5, .1
			got, err := ComputeLoom(one)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("n=%d %s: s = 1 is not the power", n, kind)
			}
			// The delivered power's own arithmetic, bit for bit.
			exact := 0
			for _, m := range got.Members {
				for j, p := range m.Source {
					if p == nil || m.Image[j] == nil {
						continue
					}
					if *m.Image[j] != *loomPower(*p, n) {
						t.Fatalf("n=%d %s: %v -> %v is not the delivered zⁿ", n, kind, p, m.Image[j])
					}
					exact++
				}
			}
			if exact < 16 {
				t.Fatalf("n=%d %s: fixture drew too little", n, kind)
			}
			zero := foldLoom(kind, n, 0)
			zero.Source.Radius, zero.Source.XMin, zero.Source.XMax = 4e5, 9e5, 1e6
			if kind == "curve" {
				// Far beyond every degree's overflow guard, 2·10^{100/n}.
				zero.Source.Curve.X, zero.Source.Curve.Y = "1e60*(2+t)", "1e59*t"
			}
			r, err := ComputeLoom(zero)
			if err != nil {
				t.Fatal(err)
			}
			drawn := 0
			for _, m := range r.Members {
				if len(m.Intervals) != 0 {
					t.Fatalf("n=%d %s: the identity clipped %+v", n, kind, m.Intervals)
				}
				for j, p := range m.Source {
					if p == nil || m.Image[j] == nil || *m.Image[j] != *p || m.Critical[j] {
						t.Fatalf("n=%d %s: identity maps %v to %v", n, kind, p, m.Image[j])
					}
					drawn++
				}
			}
			if drawn < 16 {
				t.Fatalf("n=%d %s: fixture drew too little", n, kind)
			}
			if m := r.Marker; m.Image == nil || *m.Image != *m.Source || m.Critical || len(m.Translates) != 0 || m.Intermediate != nil {
				t.Fatalf("n=%d %s: identity marker %+v", n, kind, m)
			}
		}
	}
}

// Every drawn point is H_s(z) = (1 − s)z + s zⁿ of its source point, down to
// subnormal s, with the power in independent polar form.
func TestLoomFoldReturnedGeometryIsTheHomotopy(t *testing.T) {
	for _, s := range foldParameters {
		for n := 2; n <= 6; n++ {
			for _, kind := range []string{"grid", "concentric", "rosette", "curve"} {
				q := foldLoom(kind, n, s)
				r, err := ComputeLoom(q)
				if err != nil {
					t.Fatalf("s=%g n=%d %s: %v", s, n, kind, err)
				}
				drawn := 0
				for _, m := range r.Members {
					if len(m.Intervals) != 0 {
						t.Fatalf("s=%g n=%d %s: unexpected gaps %+v", s, n, kind, m.Intervals)
					}
					for j, p := range m.Source {
						w := m.Image[j]
						if p == nil || w == nil {
							t.Fatalf("s=%g n=%d %s: broken analytic path", s, n, kind)
						}
						drawn++
						if !near(*w, foldOf(*p, n, s), foldScale(*p, n, s)) {
							t.Fatalf("s=%g n=%d %s: %v -> %v, want %v", s, n, kind, p, w, foldOf(*p, n, s))
						}
					}
				}
				if drawn < 16 {
					t.Fatalf("s=%g n=%d %s: fixture drew too little", s, n, kind)
				}
				if p, w := r.Marker.Source, r.Marker.Image; w == nil || !near(*w, foldOf(*p, n, s), foldScale(*p, n, s)) {
					t.Fatalf("s=%g n=%d %s: marker %v -> %v", s, n, kind, p, w)
				}
			}
		}
	}
	// 0 and 1 are fixed exactly for every s, and the frame leaves the
	// identity linearly: H_s(z) − z = s(zⁿ − z).
	q := foldLoom("curve", 4, nil)
	q.Source.Curve = Curve{Format: "parametric", X: "t", Y: "0.5*t*(t-1)", Min: 0, Max: 2}
	for _, s := range foldParameters {
		v := s
		q.Fold = &v
		for _, at := range []float64{0, 1} {
			q.Parameter = at
			m, err := LoomPoint(q)
			if err != nil || m.Image == nil || *m.Image != *m.Source {
				t.Fatalf("s=%g: fixed point %v -> %v %v", s, m.Source, m.Image, err)
			}
		}
		q.Parameter = 1.5
		m, err := LoomPoint(q)
		if err != nil {
			t.Fatal(err)
		}
		z := complex(m.Source.X, m.Source.Y)
		lead := complex(s, 0) * (z*z*z*z - z)
		if d := complex(m.Image.X, m.Image.Y) - z; cmplx.Abs(d-lead) > 8*0x1p-53*(cmplx.Abs(z)+s*cmplx.Abs(z*z*z*z)) {
			t.Fatalf("s=%g: H_s(z) − z = %v, want %v", s, d, lead)
		}
	}
}

// H_s′(z) = 1 − s + s n zⁿ⁻¹: the quotient of returned neighbors is its mean
// along their chord, by Simpson's rule on the independent formula.
func TestLoomFoldDerivativeFromReturnedNeighbors(t *testing.T) {
	for _, s := range []float64{.001, .3, .75} {
		for n := 2; n <= 6; n++ {
			for _, kind := range []string{"concentric", "grid", "rosette"} {
				q := foldLoom(kind, n, s)
				q.Source.Radius, q.Source.Count = 1.3, 3
				// Grid lines barely bend near the identity; dense pilots
				// still give short chords.
				q.Samples, q.Tolerance = 256, 1e-6
				r, err := ComputeLoom(q)
				if err != nil {
					t.Fatal(err)
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
						want := (foldDerivative(za, n, s) + 4*foldDerivative((za+zb)/2, n, s) + foldDerivative(zb, n, s)) / 6
						got := complex(wb.X-wa.X, wb.Y-wa.Y) / dz
						worst = math.Max(worst, cmplx.Abs(got-want)/math.Max(cmplx.Abs(want), 1))
						checked++
					}
				}
				if checked < 50 || worst > 1e-6 {
					t.Fatalf("s=%g n=%d %s: derivative differs by %g over %d chords", s, n, kind, worst, checked)
				}
			}
		}
	}
}

// For 0 < s < 1 the critical points are the n − 1 roots of
// zⁿ⁻¹ = −(1 − s)/(s n), on the circle of radius ((1 − s)/(s n))^{1/(n−1)}
// at angles (2k + 1)π/(n − 1). The source reaches them through
// trigonometry, so they are classified within rounding; zero, critical for
// the power, is regular. Each maps to (1 − 1/n)(1 − s) times itself.
func TestLoomFoldCriticalPointsMoveInFromInfinity(t *testing.T) {
	for _, s := range []float64{1e-6, .05, .3, .75, 1 - 1e-9} {
		for n := 2; n <= 6; n++ {
			q := foldLoom("concentric", n, s)
			radius := math.Pow((1-s)/(s*float64(n)), 1/float64(n-1))
			// Pilot nodes fall on every critical angle.
			q.Source.Count, q.Source.Radius, q.Samples = 1, radius, 8*(n-1)+1
			var angles []float64
			for k := 0; k < n-1; k++ {
				angles = append(angles, float64(2*k+1)*math.Pi/float64(n-1))
			}
			for _, theta := range angles {
				for _, c := range []struct {
					at       float64
					critical bool
				}{{theta, true}, {theta + 1e-6, false}, {theta - 1e-6, false}} {
					q.Parameter = c.at
					m, err := LoomPoint(q)
					if err != nil || m.Image == nil || m.Critical != c.critical {
						t.Fatalf("s=%g n=%d θ=%v: %+v %v, want critical %v", s, n, c.at, m, err, c.critical)
					}
					if !c.critical {
						continue
					}
					// An independent critical-point identity on the returned point.
					z := complex(m.Source.X, m.Source.Y)
					if d := foldDerivative(z, n, s); cmplx.Abs(d) > 1e-12*(1-s+s*float64(n)*math.Pow(radius, float64(n-1))) {
						t.Fatalf("s=%g n=%d: H′ = %v at a critical point", s, n, d)
					}
					value := complex((1-1/float64(n))*(1-s), 0) * z
					if !nearComplex(*m.Image, value, 1e-12) {
						t.Fatalf("s=%g n=%d: critical value %v, want %v", s, n, m.Image, value)
					}
				}
			}
			r, err := ComputeLoom(q)
			if err != nil {
				t.Fatal(err)
			}
			var at []float64
			for i, critical := range r.Members[0].Critical {
				if critical {
					at = append(at, r.Members[0].At[i])
				}
			}
			if len(at) != n-1 {
				t.Fatalf("s=%g n=%d: critical nodes at %v, want %v", s, n, at, angles)
			}
			for k, a := range at {
				if math.Abs(a-angles[k]) > 1e-12 {
					t.Fatalf("s=%g n=%d: critical nodes at %v, want %v", s, n, at, angles)
				}
			}
			// The circle just inside or outside the critical one has none,
			// even 10⁻¹³ away, where |H′| is still dozens of times the
			// classification's few rounding units.
			for _, scale := range []float64{1 - 1e-9, 1 + 1e-9, 1 - 1e-13, 1 + 1e-13} {
				q.Source.Radius = radius * scale
				r, err := ComputeLoom(q)
				if err != nil {
					t.Fatal(err)
				}
				for i, critical := range r.Members[0].Critical {
					if critical {
						t.Fatalf("s=%g n=%d: radius ×%v critical at %v", s, n, scale, r.Members[0].At[i])
					}
				}
			}
		}
	}
	// At the power only exact zero is critical, as before the family: a
	// point whose zⁿ⁻¹ underflows to zero is regular.
	for _, fold := range []any{nil, 1} {
		q := foldLoom("curve", 6, fold)
		q.Source.Curve = Curve{Format: "parametric", X: "1e-100*(1+t)", Y: "0", Min: 0, Max: 1}
		q.Parameter = .5
		m, err := LoomPoint(q)
		if err != nil || m.Source == nil || m.Source.X == 0 || m.Image == nil || m.Critical {
			t.Fatalf("s=%v: tiny z %+v %v is critical", fold, m, err)
		}
	}
	// Zero is regular between the ends and critical at the power.
	for _, c := range []struct {
		s        any
		critical bool
	}{{.5, false}, {1e-300, false}, {1 - 1e-16, false}, {1, true}, {nil, true}, {0, false}} {
		q := foldLoom("rosette", 3, c.s)
		q.Parameter = math.Pi
		m, err := LoomPoint(q)
		if err != nil || m.Source == nil || *m.Source != (Vec{}) || m.Image == nil || *m.Image != (Vec{}) || m.Critical != c.critical {
			t.Fatalf("s=%v: zero %+v %v, want critical %v", c.s, m, err, c.critical)
		}
	}
}

// Squaring is frozen: it ignores fold, as every map other than the power
// does, and keeps its unfenced result bit for bit.
func TestLoomFoldOnlyThePowerReadsIt(t *testing.T) {
	for _, kind := range []string{"grid", "rosette"} {
		q := loomExample(kind)
		want, err := ComputeLoom(q)
		if err != nil {
			t.Fatal(err)
		}
		for _, v := range []float64{0, .5, 7} {
			s := v
			q.Fold = &s
			got, err := ComputeLoom(q)
			if err != nil || !reflect.DeepEqual(got, want) {
				t.Fatalf("square %s with fold %g changed: %v", kind, v, err)
			}
		}
	}
	for _, m := range []string{"exp", "exp-power", "mobius", "joukowski"} {
		q := rationalLoom("joukowski", .5, .1, "grid")
		q.Map, q.Degree = m, 2
		want, err := ComputeLoom(q)
		if err != nil {
			t.Fatal(err)
		}
		s := .25
		q.Fold = &s
		got, err := ComputeLoom(q)
		if err != nil || !reflect.DeepEqual(got, want) {
			t.Fatalf("%s read fold: %v", m, err)
		}
	}
}

func TestLoomFoldValidation(t *testing.T) {
	for _, s := range []float64{-1e-9, 1 + 1e-9, math.NaN(), math.Inf(1)} {
		q := foldLoom("grid", 3, nil)
		q.Fold = &s
		for _, compute := range []func(LoomRequest) error{
			func(q LoomRequest) error { _, err := ComputeLoom(q); return err },
			func(q LoomRequest) error { _, err := LoomPoint(q); return err },
		} {
			var field *FieldError
			if err := compute(q); !errors.As(err, &field) || field.Field != "fold" {
				t.Fatalf("s=%g: %v", s, err)
			}
		}
	}
}

// Every frame keeps the power's 10¹⁰⁰ image fence; between the ends a
// source whose zⁿ passes the power's overflow guard is clipped, as at s = 1,
// and nothing nonfinite is delivered. Dense grids stay within the budgets.
func TestLoomFoldFenceGuardAndWork(t *testing.T) {
	for _, s := range []float64{1e-60, .5} {
		for n := 2; n <= 6; n++ {
			// z = t·10^{100/n}·4, beyond the guard for t > 1/2.
			edge := 4 * math.Pow(10, 100/float64(n))
			q := foldLoom("curve", n, s)
			q.Source.Curve = Curve{Format: "parametric", X: "t*" + ftoa(edge), Y: "0", Min: 0, Max: 1}
			q.Parameter = .9
			r, err := ComputeLoom(q)
			if err != nil {
				t.Fatal(err)
			}
			m := r.Members[0]
			if len(m.Intervals) != 1 || m.Intervals[0].Reason != "clipped" || m.Intervals[0].To != 1 {
				t.Fatalf("s=%g n=%d: intervals %+v", s, n, m.Intervals)
			}
			drawn := 0
			for j, w := range m.Image {
				if w == nil {
					continue
				}
				drawn++
				if !finite(w.X) || !finite(w.Y) || w.Norm() > LoomPowerImageLimit {
					t.Fatalf("s=%g n=%d: delivered %v", s, n, w)
				}
				if p := m.Source[j]; !near(*w, foldOf(*p, n, s), foldScale(*p, n, s)) {
					t.Fatalf("s=%g n=%d: %v -> %v", s, n, p, w)
				}
			}
			if drawn < 4 || r.Marker.Image != nil {
				t.Fatalf("s=%g n=%d: retained side lost or clipped marker drawn", s, n)
			}
		}
	}
	for _, s := range []float64{.02, .5} {
		dense := foldLoom("grid", 6, s)
		dense.Source.XCount, dense.Source.YCount = 32, 32
		dense.Source.XMin, dense.Source.XMax, dense.Source.YMin, dense.Source.YMax = -5e4, 5e4, -5e4, 5e4
		dense.Samples, dense.Tolerance = 1024, 1e-6
		r, err := ComputeLoom(dense)
		if err != nil {
			t.Fatal(err)
		}
		if r.Points > LoomMaxPoints || r.Evaluations > LoomMaxEvaluations || r.NumericEntries > LoomMaxNumericEntries {
			t.Fatalf("s=%g: escaped its budgets", s)
		}
	}
}
