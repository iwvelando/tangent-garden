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

// expMotionLoom is the exponential at map parameter s, built through JSON as
// the worker sends it; a nil s leaves the field out.
func expMotionLoom(source string, s any) LoomRequest {
	q := expLoom(source)
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

// tinyParameters reach the subnormal range, where s·z itself loses precision.
var tinyParameters = []float64{5e-324, 1e-320, 1e-300, 1e-12, 1e-6, 1e-3, .01, .2, .5, .9, 1 - 1e-12}

// The family's ends are the delivered maps: with s left out and at s = 1,
// the exponential, bit for bit, while another map's retained parameter and
// exclusion ride along unread, as in links made before s existed; at s = 0
// the identity, every drawn image exactly its source, with nothing clipped
// and no point sharing an image.
func TestLoomExpMotionEndsAreTheDeliveredMaps(t *testing.T) {
	for _, kind := range []string{"grid", "concentric", "rosette", "curve"} {
		absent := expMotionLoom(kind, nil)
		absent.MapParameter, absent.ExclusionRadius = .5, .1
		want, err := ComputeLoom(absent)
		if err != nil {
			t.Fatal(err)
		}
		one := expMotionLoom(kind, 1)
		one.MapParameter, one.ExclusionRadius = .5, .1
		got, err := ComputeLoom(one)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("%s: s = 1 is not the exponential", kind)
		}
		// Both draw the delivered map's own arithmetic, e^x (cos y, sin y),
		// bit for bit, not the family's evaluation at s = 1.
		exact := 0
		for _, m := range got.Members {
			for j, p := range m.Source {
				if p == nil || m.Image[j] == nil {
					continue
				}
				r := math.Exp(p.X)
				if *m.Image[j] != (Vec{r * math.Cos(p.Y), r * math.Sin(p.Y)}) {
					t.Fatalf("%s: %v -> %v is not the delivered eᶻ", kind, p, m.Image[j])
				}
				exact++
			}
		}
		if exact < 16 {
			t.Fatalf("%s: fixture drew too little", kind)
		}
		zero := expMotionLoom(kind, 0)
		zero.Source.Radius, zero.Source.XMin, zero.Source.XMax = 4e5, 9e5, 1e6
		r, err := ComputeLoom(zero)
		if err != nil {
			t.Fatal(err)
		}
		drawn := 0
		for _, m := range r.Members {
			if len(m.Intervals) != 0 {
				t.Fatalf("%s: the identity clipped %+v", kind, m.Intervals)
			}
			for j, p := range m.Source {
				if p == nil || m.Image[j] == nil || *m.Image[j] != *p || m.Critical[j] {
					t.Fatalf("%s: identity maps %v to %v", kind, p, m.Image[j])
				}
				drawn++
			}
		}
		if drawn < 16 {
			t.Fatalf("%s: fixture drew too little", kind)
		}
		if m := r.Marker; m.Image == nil || *m.Image != *m.Source || len(m.Translates) != 0 || m.Intermediate != nil {
			t.Fatalf("%s: identity marker %+v", kind, m)
		}
	}
}

// Every drawn point is F_s(z) = s + (e^{sz} − 1)/s of its source point with
// s·z in the exponential's window, down to subnormal s, where the product s·z
// is itself inexact. Grids and circles here cross the scaled window, so the
// exact crossing nodes are checked too.
func TestLoomExpMotionReturnedGeometryIsTheFamily(t *testing.T) {
	for _, s := range tinyParameters {
		for _, kind := range []string{"grid", "concentric", "rosette", "curve"} {
			q := expMotionLoom(kind, s)
			// Sized so that the frames from s = 0.01 up leave the window.
			q.Source.Radius = 30 / max(s, .01)
			q.Source.XMin, q.Source.XMax, q.Source.YMin, q.Source.YMax = -25/max(s, .01), 25/max(s, .01), -30/max(s, .01), 30/max(s, .01)
			q.Tolerance = .01
			r, err := ComputeLoom(q)
			if err != nil {
				t.Fatalf("s=%g %s: %v", s, kind, err)
			}
			drawn := 0
			for _, m := range r.Members {
				for j, p := range m.Source {
					if p == nil || m.Image[j] == nil {
						continue
					}
					drawn++
					z := complex(p.X, p.Y)
					if !inWindow(complex(s, 0)*z, 1e-12*math.Max(s*cmplx.Abs(z), 1)) {
						t.Fatalf("s=%g %s: drawn with s·z = %v outside the window", s, kind, complex(s, 0)*z)
					}
					if want := wrapOf(z, s); !nearComplex(*m.Image[j], want, 1e-12) {
						t.Fatalf("s=%g %s: %v -> %v, want %v", s, kind, p, m.Image[j], want)
					}
				}
			}
			if drawn < 16 {
				t.Fatalf("s=%g %s: fixture drew too little", s, kind)
			}
			if p, w := r.Marker.Source, r.Marker.Image; w != nil && !nearComplex(*w, wrapOf(complex(p.X, p.Y), s), 1e-12) {
				t.Fatalf("s=%g %s: marker %v -> %v", s, kind, p, w)
			}
		}
	}
	// Near zero the family leaves the identity linearly:
	// F_s(z) − z = s(1 + z²/2) + O(s² z³), up to the rounding of F_s(z).
	q := expMotionLoom("curve", nil)
	q.Source.Curve = Curve{Format: "parametric", X: "0.9", Y: "0.4", Min: 0, Max: 1}
	q.Parameter = 0
	for _, s := range []float64{1e-4, 1e-6, 1e-8} {
		v := s
		q.Wrap = &v
		m, err := LoomPoint(q)
		if err != nil {
			t.Fatal(err)
		}
		z := complex(m.Source.X, m.Source.Y)
		lead := complex(s, 0) * (1 + z*z/2)
		if d := complex(m.Image.X, m.Image.Y) - z; cmplx.Abs(d-lead) > 2*s*s*cmplx.Abs(z*z*z)+4*0x1p-53*cmplx.Abs(z) {
			t.Fatalf("s=%g: F_s(z) − z = %v, want %v + O(s²)", s, d, lead)
		}
	}
}

// F_s′(z) = e^{sz}: the quotient of returned neighbors is its mean along
// their chord, by Simpson's rule on the independent formula. It never
// vanishes, so no point is critical, and zero maps to exactly s.
func TestLoomExpMotionDerivativeAndNoCriticalPoint(t *testing.T) {
	for _, s := range []float64{.001, .3, .75} {
		for _, kind := range []string{"concentric", "grid", "rosette"} {
			q := expMotionLoom(kind, s)
			q.Source.Radius, q.Source.Count = 1.5, 3
			q.Tolerance = 1e-6
			r, err := ComputeLoom(q)
			if err != nil {
				t.Fatal(err)
			}
			derivative := func(z complex128) complex128 { return cmplx.Exp(complex(s, 0) * z) }
			worst, checked, zero := 0.0, 0, false
			for _, m := range r.Members {
				for j, p := range m.Source {
					if m.Critical[j] {
						t.Fatalf("s=%g %s: %v marked critical", s, kind, p)
					}
					if p != nil && p.X == 0 && p.Y == 0 {
						zero = true
						if *m.Image[j] != (Vec{s, 0}) {
							t.Fatalf("s=%g %s: zero maps to %v, want exactly s", s, kind, m.Image[j])
						}
					}
				}
				for j := 1; j < len(m.At); j++ {
					a, b, wa, wb := m.Source[j-1], m.Source[j], m.Image[j-1], m.Image[j]
					if a == nil || b == nil || wa == nil || wb == nil {
						continue
					}
					dz := complex(b.X-a.X, b.Y-a.Y)
					// Short in s·z, where Simpson's error lies.
					if cmplx.Abs(dz) == 0 || s*cmplx.Abs(dz) > .02 {
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
			if kind != "concentric" && !zero {
				t.Fatalf("s=%g %s: the fixture never reaches zero", s, kind)
			}
		}
	}
}

// expMotionGaps are a member's clipped gap ends, other than its own ends.
func expMotionGaps(t *testing.T, m LoomMember) []float64 {
	t.Helper()
	var out []float64
	for _, g := range m.Intervals {
		if g.Reason != "clipped" {
			t.Fatalf("%s: unexpected %s gap", m.Name, g.Reason)
		}
		for _, v := range []float64{g.From, g.To} {
			if v != m.Min && v != m.Max {
				out = append(out, v)
			}
		}
	}
	return out
}

// The frame's domain is the window scaled by 1/s, |Re z| ≤ ln 10⁸/s and
// |Im z| ≤ 8π/s: grid lines and circles break at its exact crossings, drawn
// with the frame's own map, and a circle meeting it only on narrow arcs that
// its four pilots straddle still draws them.
func TestLoomExpMotionScaledWindowCrossings(t *testing.T) {
	for _, s := range []float64{.5, .05, 1e-3} {
		X, Y := expReal/s, expImag/s
		q := expMotionLoom("grid", s)
		q.Source.XCount, q.Source.YCount = 3, 3
		q.Source.XMin, q.Source.XMax, q.Source.YMin, q.Source.YMax = -30/s, 30/s, -40/s, 40/s
		q.Tolerance = .01
		r, err := ComputeLoom(q)
		if err != nil {
			t.Fatal(err)
		}
		cuts := map[int][]float64{1: {-Y, Y}, 4: {-X, X}}
		for _, m := range r.Members {
			got, want := expMotionGaps(t, m), cuts[m.ID]
			if len(got) != len(want) {
				t.Fatalf("s=%g %s: gap ends %v, want %v", s, m.Name, got, want)
			}
			for i := range got {
				if math.Abs(got[i]-want[i]) > 1e-12*math.Abs(want[i]) {
					t.Fatalf("s=%g %s: gap end %g, want crossing %g", s, m.Name, got[i], want[i])
				}
			}
			if want == nil && (len(m.Intervals) != 1 || m.Intervals[0].From != m.Min || m.Intervals[0].To != m.Max) {
				t.Fatalf("s=%g %s outside the domain is not one clipped interval: %+v", s, m.Name, m.Intervals)
			}
		}
		// The crossing nodes themselves are drawn with the frame's map.
		edges := 0
		for _, m := range r.Members {
			for j, p := range m.Source {
				if p == nil || m.Image[j] == nil {
					continue
				}
				z := complex(p.X, p.Y)
				if math.Abs(p.X) == X || math.Abs(p.Y) == Y {
					edges++
				}
				if !nearComplex(*m.Image[j], wrapOf(z, s), 1e-12) {
					t.Fatalf("s=%g %s: %v -> %v, want %v", s, m.Name, p, m.Image[j], wrapOf(z, s))
				}
			}
		}
		if edges == 0 {
			t.Fatalf("s=%g: no crossing node was drawn", s)
		}
		c := expMotionLoom("concentric", s)
		c.Source.Count, c.Source.Radius, c.Samples, c.Tolerance = 1, 26/s, 4, .05
		r, err = ComputeLoom(c)
		if err != nil {
			t.Fatal(err)
		}
		a, b := math.Acos(expReal/26), math.Asin(expImag/26)
		want := []float64{a, b, math.Pi - b, math.Pi - a, math.Pi + a, math.Pi + b, 2*math.Pi - b, 2*math.Pi - a}
		got := expMotionGaps(t, r.Members[0])
		if len(got) != len(want) {
			t.Fatalf("s=%g narrow arcs: gap ends %v, want %v", s, got, want)
		}
		for i := range got {
			if math.Abs(got[i]-want[i]) > 1e-9 {
				t.Fatalf("s=%g narrow arcs: gap end %g, want %g", s, got[i], want[i])
			}
		}
	}
}

// F_s(z/s) = (e^z − 1 + s²)/s is the exponential's own image, scaled and
// shifted. A circle family scaled by 1/s therefore refines exactly as the
// exponential refines the unscaled one: the same parameters, gaps and work,
// whether it lies inside the window, crosses it or meets it in narrow arcs.
// The aliasing guards and crossings measure s·z, not z.
func TestLoomExpMotionIsScaleInvariant(t *testing.T) {
	for _, radius := range []float64{3, 20, 26, 40} {
		for _, kind := range []string{"concentric", "rosette"} {
			run := func(s float64) LoomResult {
				q := expMotionLoom(kind, s)
				q.Source.Count, q.Source.Radius, q.Samples, q.Tolerance = 3, radius/s, 8, .01
				r, err := ComputeLoom(q)
				if err != nil {
					t.Fatal(err)
				}
				return r
			}
			want := run(1)
			for _, s := range []float64{.5, .05, 1e-3} {
				got := run(s)
				if math.Abs(float64(got.Evaluations-want.Evaluations)) > float64(want.Evaluations)/50 {
					t.Fatalf("%s radius %g: %d evaluations at s=%g, %d at s=1", kind, radius, got.Evaluations, s, want.Evaluations)
				}
				for i, m := range got.Members {
					w := want.Members[i]
					if len(m.Intervals) != len(w.Intervals) {
						t.Fatalf("%s radius %g s=%g %s: gaps %+v, want %+v", kind, radius, s, m.Name, m.Intervals, w.Intervals)
					}
					for k := range m.Intervals {
						if math.Abs(m.Intervals[k].From-w.Intervals[k].From) > 1e-6 || math.Abs(m.Intervals[k].To-w.Intervals[k].To) > 1e-6 {
							t.Fatalf("%s radius %g s=%g %s: gaps %+v, want %+v", kind, radius, s, m.Name, m.Intervals, w.Intervals)
						}
					}
				}
			}
		}
	}
}

// F_s(z′) = F_s(z) exactly when z′ = z + 2πik/s. The marker lists those with
// s·z′ in the window, at most eight, and none at s = 0, the identity, or
// where the period passes the fence at 10¹⁰⁰.
func TestLoomExpMotionSharedImagePoints(t *testing.T) {
	for _, s := range []float64{0, 1e-110, 1e-6, .1, .5, 1} {
		for _, y := range []float64{0, .3, -2, 7} {
			q := expMotionLoom("curve", s)
			q.Source.Curve = Curve{Format: "parametric", X: "0.4", Y: "t", Min: -10, Max: 10}
			q.Parameter = y
			m, err := LoomPoint(q)
			if err != nil {
				t.Fatal(err)
			}
			want := 0
			if s > 0 && 2*math.Pi/s < 1e100 {
				for k := -100; k <= 100; k++ {
					if k != 0 && math.Abs(s*y+2*math.Pi*float64(k)) <= expImag {
						want++
					}
				}
			}
			if len(m.Translates) != want || want > 8 {
				t.Fatalf("s=%g y=%g: %d shared-image points, want %d", s, y, len(m.Translates), want)
			}
			seen := []Vec{*m.Source}
			for _, z := range m.Translates {
				k := math.Round((z.Y - y) * s / (2 * math.Pi))
				if z.X != .4 || k == 0 || math.Abs(z.Y-(y+2*math.Pi*k/s)) > 1e-15*math.Abs(z.Y) {
					t.Fatalf("s=%g y=%g: %v is not z + 2πik/s", s, y, z)
				}
				// z′ itself is rounded, by up to half an ulp of its modulus,
				// which F_s′ = e^{sz′} carries into its image.
				zz := complex(z.X, z.Y)
				slack := 1e-12*math.Max(cmplx.Abs(wrapOf(zz, s)), 1) + 0x1p-52*cmplx.Abs(zz)*math.Exp(s*z.X)
				if !inWindow(complex(s*z.X, s*z.Y), 1e-12) || cmplx.Abs(complex(m.Image.X, m.Image.Y)-wrapOf(zz, s)) > slack {
					t.Fatalf("s=%g y=%g: %v maps to %v, want %v", s, y, z, wrapOf(complex(z.X, z.Y), s), *m.Image)
				}
				for _, other := range seen {
					if z == other {
						t.Fatalf("s=%g y=%g: %v listed twice", s, y, z)
					}
				}
				seen = append(seen, z)
			}
			// The whole-loom marker agrees with the point-only one.
			r, err := ComputeLoom(q)
			if err != nil || !reflect.DeepEqual(r.Marker, m) {
				t.Fatalf("s=%g y=%g: markers disagree: %v", s, y, err)
			}
		}
	}
}

// The period 2πi/s acts on s·z, so the aliasing guards measure it there. On
// the line z = (½ + it)/s, pilots a whole period of s·z apart share one
// image; the image still winds eight times around its circle, center
// s − 1/s and radius e^{½}/s, and no drawn chord spans more than a quarter
// period of s·z.
func TestLoomExpMotionAliasingGuardsUseTheScaledSource(t *testing.T) {
	for _, s := range []float64{.5, .01} {
		q := expMotionLoom("curve", s)
		q.Source.Curve = Curve{Format: "parametric", X: "0.5*" + strconv.FormatFloat(1/s, 'g', -1, 64), Y: "t*" + strconv.FormatFloat(1/s, 'g', -1, 64), Min: -expImag, Max: expImag}
		q.Samples = 5
		q.Parameter = q.Source.Curve.Min
		r, err := ComputeLoom(q)
		if err != nil {
			t.Fatal(err)
		}
		m := r.Members[0]
		center, radius := complex(s-1/s, 0), math.Exp(.5)/s
		for j := range m.At {
			if m.Image[j] == nil {
				t.Fatalf("s=%g: broken inside the domain at %g", s, m.At[j])
			}
			if d := cmplx.Abs(complex(m.Image[j].X, m.Image[j].Y) - center); math.Abs(d-radius) > 1e-12*radius {
				t.Fatalf("s=%g: off the circle at %g: %g", s, m.At[j], d)
			}
			if j > 0 && s*m.Source[j].Sub(*m.Source[j-1]).Norm() > math.Pi/2 {
				t.Fatalf("s=%g: chord spans %g of s·z", s, s*m.Source[j].Sub(*m.Source[j-1]).Norm())
			}
		}
		if len(m.At) < 8*8 || r.Exhausted {
			t.Fatalf("s=%g: aliased or exhausted: %d points", s, len(m.At))
		}
	}
}

func TestLoomExpMotionValidation(t *testing.T) {
	for _, s := range []float64{-1e-9, 1 + 1e-9, math.NaN(), math.Inf(1)} {
		q := expMotionLoom("grid", nil)
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
}

// Every frame stays inside the shared budgets, even a dense grid reaching
// the corners of its scaled window. Near s = 0 the window no longer bounds
// the image, so the power's fence at 10¹⁰⁰ does, as at the identity; grids
// and circles, within ±10⁶, never reach it.
func TestLoomExpMotionWorkAndFence(t *testing.T) {
	for _, s := range []float64{1e-6, .1, .6} {
		dense := expMotionLoom("grid", s)
		dense.Source.XCount, dense.Source.YCount = 32, 32
		dense.Source.XMin, dense.Source.XMax = -min(expReal/s, 5e4), min(expReal/s, 5e4)
		dense.Source.YMin, dense.Source.YMax = -min(expImag/s, 5e4), min(expImag/s, 5e4)
		dense.Samples, dense.Tolerance = 1024, 1e-6
		r, err := ComputeLoom(dense)
		if err != nil {
			t.Fatal(err)
		}
		if r.Points > LoomMaxPoints || r.Evaluations > LoomMaxEvaluations || r.NumericEntries > LoomMaxNumericEntries {
			t.Fatalf("s=%g: escaped its budgets", s)
		}
	}
	// z = 10¹⁰¹ t passes the fence at t = 1/10, at the identity and at a
	// frame whose window still admits it.
	for _, s := range []float64{0, 1e-110} {
		q := expMotionLoom("curve", s)
		q.Source.Curve = Curve{Format: "parametric", X: "1e101*t", Y: "0", Min: 0, Max: 1}
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
		if r.Marker.Image != nil || len(r.Marker.Translates) != 0 {
			t.Fatalf("s=%g: marker beyond the fence %+v", s, r.Marker)
		}
	}
	// A grid at the corner of the admitted extents, at a tiny parameter, is
	// drawn whole.
	q := expMotionLoom("grid", 1e-9)
	q.Source.XMin, q.Source.XMax, q.Source.YMin, q.Source.YMax = 9e5, 1e6, -1e6, -9e5
	q.Parameter = q.Source.YMin
	r, err := ComputeLoom(q)
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range r.Members {
		if len(m.Intervals) != 0 {
			t.Fatalf("%s clipped %+v", m.Name, m.Intervals)
		}
	}
}
