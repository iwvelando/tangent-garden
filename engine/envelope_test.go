package engine

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

func linesRequest(x, y string, lo, hi float64, l EnvelopeFamily) Request {
	q := request("envelope", x, y, lo, hi)
	q.Envelope = l
	return q
}

func chords(x, y string) EnvelopeFamily { return EnvelopeFamily{Mode: "chord", X: x, Y: y} }

// Chords from angle t to angle mt on the unit circle touch their envelope,
// the epicycloid (m e^{it} + e^{imt})/(m+1), dividing each chord 1 : m.
func TestChordEnvelopeEpicycloids(t *testing.T) {
	// Swapped, the chords run from angle mt back to t: for m < 0 the point
	// lies behind the chord one way round and beyond it the other.
	for _, tc := range []struct {
		m    float64
		swap bool
	}{{2, false}, {3, false}, {4, false}, {-1.5, false}, {2, true}, {-1.5, true}} {
		m := tc.m
		q := linesRequest("cos(t)", "sin(t)", 0, 2*math.Pi, chords("cos(a*t)", "sin(a*t)"))
		if tc.swap {
			q = linesRequest("cos(a*t)", "sin(a*t)", 0, 2*math.Pi, chords("cos(t)", "sin(t)"))
		}
		q.Curve.A = m
		r := compute(t, q)
		coincident := 0
		for j, e := range r.Derived {
			u := sampleT(q, j)
			p := Vec{math.Cos(u), math.Sin(u)}
			c := Vec{math.Cos(m * u), math.Sin(m * u)}
			if tc.swap {
				closeVec(t, r.Second[j], p, 1e-12)
			} else {
				closeVec(t, r.Second[j], c, 1e-12)
			}
			if c.Sub(p).Norm() < 1e-9 {
				coincident++
				if e != nil {
					t.Fatalf("m=%g: coincident endpoints at %d gave %v", m, j, e)
				}
				continue
			}
			closeVec(t, e, p.Mul(m).Add(c).Mul(1/(m+1)), 1e-7)
			if r.Virtual[j] != (m < 0) {
				t.Fatalf("m=%g: touching point at %d virtual=%v", m, j, r.Virtual[j])
			}
		}
		if coincident == 0 || r.Invalid != coincident {
			t.Fatalf("m=%g: %d coincident, %d invalid", m, coincident, r.Invalid)
		}
		if !strings.Contains(strings.Join(r.Warnings, " "), "endpoints coincide") {
			t.Fatalf("m=%g: no coincidence warning in %v", m, r.Warnings)
		}
		for _, ray := range r.Rays {
			j := ray.SampleIndex
			closeVec(t, &ray.Origin, *r.Base[j], 0)
			closeVec(t, ray.End, *r.Second[j], 0)
			closeVec(t, &ray.Direction, r.Second[j].Sub(*r.Base[j]).Unit(), 1e-12)
			if ray.Target != r.Derived[j] && (ray.Target == nil || *ray.Target != *r.Derived[j]) {
				t.Fatalf("m=%g: ray %d target %v, derived %v", m, j, ray.Target, r.Derived[j])
			}
		}
	}
}

// The reference study's 200 evenly spaced phases on t → 4t: every chord is
// drawn, and only the coincident one at t = 0 (and 2π) has no touching point.
func TestChordReferenceStudy(t *testing.T) {
	q := linesRequest("cos(t)", "sin(t)", 0, 2*math.Pi, chords("cos(4*t)", "sin(4*t)"))
	q.Samples, q.Lines = 2001, 201
	r := compute(t, q)
	if len(r.Rays) != 199 {
		t.Fatalf("%d chords, want the 199 with distinct endpoints", len(r.Rays))
	}
	for _, ray := range r.Rays {
		if ray.SampleIndex%10 != 0 || ray.Target == nil || ray.Virtual {
			t.Fatalf("chord %d: target %v virtual %v", ray.SampleIndex, ray.Target, ray.Virtual)
		}
	}
}

func TestLineEnvelopeByAngle(t *testing.T) {
	for _, tc := range []struct {
		name, x, y, angle string
		lo, hi            float64
		want              func(float64) Vec
	}{
		// Tangent lines envelope the curve itself.
		{"tangents", "cos(t)", "sin(t)", "t+pi/2", 0, 2 * math.Pi, func(u float64) Vec { return Vec{math.Cos(u), math.Sin(u)} }},
		// Folding the focus (0, 1) onto the axis: the creases envelope the
		// parabola 4y = x².
		{"folded parabola", "t", "0", "atan(t)", -2, 2, func(u float64) Vec { return Vec{2 * u, u * u} }},
		// Lines through a fixed point envelope that point.
		{"pencil", "1", "2", "t", 0, 3, func(float64) Vec { return Vec{1, 2} }},
		// A chord t → 3t on the unit circle has direction angle 2t + π/2.
		{"chord angle", "cos(t)", "sin(t)", "2*t+pi/2", 0.1, 3, func(u float64) Vec {
			return Vec{3*math.Cos(u) + math.Cos(3*u), 3*math.Sin(u) + math.Sin(3*u)}.Mul(.25)
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			q := linesRequest(tc.x, tc.y, tc.lo, tc.hi, EnvelopeFamily{Mode: "angle", Angle: tc.angle})
			r := compute(t, q)
			if r.Invalid != 0 || len(r.Rays) != q.Lines || r.Second != nil {
				t.Fatalf("%d invalid, %d lines, second %v", r.Invalid, len(r.Rays), r.Second != nil)
			}
			for j, e := range r.Derived {
				closeVec(t, e, tc.want(sampleT(q, j)), 1e-7)
				if r.Virtual[j] {
					t.Fatalf("an unbounded line is never virtual (%d)", j)
				}
			}
			for _, ray := range r.Rays {
				if ray.End != nil {
					t.Fatal("an angle line has no far endpoint")
				}
				th := ray.Direction
				if math.Abs(th.Norm()-1) > 1e-12 {
					t.Fatalf("direction %v is not a unit vector", th)
				}
			}
		})
	}
}

// Every touching point lies on its own line, and the envelope is tangent to
// the line there, in any parameterization.
func TestLineEnvelopeTangency(t *testing.T) {
	for _, l := range []EnvelopeFamily{
		{Mode: "angle", Angle: "0.3*t^2+1"},
		chords("2*cos(2*t)+0.5", "sin(3*t)"),
	} {
		q := linesRequest("1.5*cos(t)+0.2*t", "sin(t)", 0.2, 2.8, l)
		q.Samples = 4001
		r := compute(t, q)
		checked := 0
		for j := 2; j < len(r.Derived)-2; j++ {
			e, a, b := r.Derived[j], r.Derived[j-1], r.Derived[j+1]
			if e == nil || a == nil || b == nil {
				continue
			}
			u := Vec{}
			for _, ray := range r.Rays {
				if ray.SampleIndex == j {
					u = ray.Direction
				}
			}
			if u == (Vec{}) {
				continue
			}
			if math.Abs(e.Sub(*r.Base[j]).Cross(u)) > 1e-9 {
				t.Fatalf("%v: point %d is off its line", l, j)
			}
			if d := b.Sub(*a); d.Norm() > 1e-9 && math.Abs(d.Unit().Cross(u)) > 1e-4 {
				t.Fatalf("%v: envelope at %d crosses its line at %g", l, j, d.Unit().Cross(u))
			}
			checked++
		}
		if checked < 10 {
			t.Fatalf("%v: only %d samples checked", l, checked)
		}
	}
}

// Chords from an ellipse to a concentric circle along each outward normal are
// the ellipse's normals: their envelope is the evolute, behind the chords.
func TestChordNormalsEnvelopeTheEvolute(t *testing.T) {
	for _, extend := range []bool{false, true} {
		l := chords("3*cos(t)", "3*sin(t)")
		l.Extend = extend
		q := linesRequest("2*cos(t)", "sin(t)", 0, 2*math.Pi, l)
		r := compute(t, q)
		e := compute(t, request("evolute", "2*cos(t)", "sin(t)", 0, 2*math.Pi))
		for j := range r.Derived {
			closeVec(t, r.Derived[j], *e.Derived[j], 1e-6)
			if r.Virtual[j] == extend {
				t.Fatalf("extend=%v: virtual=%v at %d", extend, r.Virtual[j], j)
			}
		}
	}
}

func TestLineEnvelopeDegenerate(t *testing.T) {
	// Parallel lines have no finite envelope, but every line is drawn.
	q := linesRequest("t", "t^2", -1, 1, EnvelopeFamily{Mode: "angle", Angle: "1"})
	r := compute(t, q)
	if r.Invalid != q.Samples || len(r.Rays) != q.Lines {
		t.Fatalf("parallel: %d invalid, %d rays", r.Invalid, len(r.Rays))
	}
	for _, ray := range r.Rays {
		if ray.Target != nil {
			t.Fatal("parallel lines touched an envelope")
		}
	}
	// Lines are unoriented: a direction that jumps by π gives the same lines,
	// so their envelope continues across; any other jump is not joined.
	angle := func(a string) Result {
		return compute(t, linesRequest("t", "0", 0, math.Pi, EnvelopeFamily{Mode: "angle", Angle: a}))
	}
	smooth, flipped, broken := angle("t"), angle("atan(tan(t))"), angle("atan(tan(t))/2")
	for j := range smooth.Derived {
		closeVec(t, flipped.Derived[j], *smooth.Derived[j], 1e-7)
	}
	if broken.Derived[250] != nil || broken.Derived[240] == nil || broken.Derived[260] == nil {
		t.Fatalf("envelope across the direction's jump: %v", broken.Derived[250])
	}
	// Undefined directions and endpoints leave gaps rather than lines.
	for _, l := range []EnvelopeFamily{{Mode: "angle", Angle: "sqrt(t)"}, chords("t+1", "sqrt(t)")} {
		r = compute(t, linesRequest("t", "1", -1, 1, l))
		if r.Derived[100] != nil || r.Derived[400] == nil {
			t.Fatalf("%v: gap %v, point %v", l, r.Derived[100], r.Derived[400])
		}
		for _, ray := range r.Rays {
			if ray.SampleIndex < 250 {
				t.Fatalf("%v: line drawn where it is undefined (%d)", l, ray.SampleIndex)
			}
		}
		if l.Mode == "chord" && r.Second[100] != nil {
			t.Fatal("undefined far endpoint was drawn")
		}
	}
}

func TestLineEnvelopeResult(t *testing.T) {
	q := linesRequest("cos(t)", "sin(t)", 0, 2*math.Pi, chords("cos(2*t)", "sin(2*t)"))
	b, err := json.Marshal(compute(t, q))
	if err != nil || !strings.Contains(string(b), `"second":[`) || !strings.Contains(string(b), `"end":{`) {
		t.Fatalf("chord JSON lacks second endpoints: %.200s", b)
	}
	b, _ = json.Marshal(compute(t, request("pedal", "cos(t)", "sin(t)", 0, 1)))
	if strings.Contains(string(b), `"second"`) || strings.Contains(string(b), `"end"`) {
		t.Fatal("other constructions carry chord endpoints")
	}
	// The family is ignored by other constructions.
	q = request("evolute", "2*cos(t)", "sin(t)", 0, 1)
	q.Envelope = EnvelopeFamily{Mode: "nonsense"}
	compute(t, q)
}

func TestLineEnvelopeInvalid(t *testing.T) {
	for _, tc := range []struct {
		l    EnvelopeFamily
		want string
	}{
		{EnvelopeFamily{}, "direction angle, chords to a second endpoint, or circles"},
		{EnvelopeFamily{Mode: "angle", Angle: "s"}, "direction angle:"},
		{EnvelopeFamily{Mode: "angle", Angle: ""}, "direction angle:"},
		{chords("s", "1"), "second endpoint x:"},
		{chords("1", "(t"), "second endpoint y:"},
	} {
		_, err := Compute(linesRequest("cos(t)", "sin(t)", 0, 1, tc.l))
		if err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("%v: got %v, want %q", tc.l, err, tc.want)
		}
	}
}
