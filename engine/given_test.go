package engine

import (
	"encoding/json"
	"math"
	"testing"
)

// A construction on a curve given as a function is the construction on the
// same curve written as expressions, bit for bit, since the expressions
// compile to the same arithmetic.
func TestComputeOnMatchesExpressions(t *testing.T) {
	for _, kind := range []string{"evolute", "involute", "pedal", "orthotomic", "inversion"} {
		q := request(kind, "2*cos(t)", "sin(t)", 0, 2*math.Pi)
		q.Pole = Vec{0.3, -0.2}
		q.Offset = 0.7
		q.Inversion = Inversion{Center: Vec{0.4, 0.1}, Radius: 1.3}
		want := compute(t, q)
		got, err := ComputeOn(q, func(t float64) Vec { return Vec{2 * math.Cos(t), math.Sin(t)} })
		if err != nil {
			t.Fatal(err)
		}
		a, _ := json.Marshal(want)
		b, _ := json.Marshal(got)
		if string(a) != string(b) {
			t.Fatalf("%s: a given curve computed differently from its expressions", kind)
		}
	}
}

// The given curve replaces the formula, whatever the format says, and the
// domain is still checked.
func TestComputeOnChecksTheDomain(t *testing.T) {
	q := request("pedal", "t", "t", 1, 1)
	_, err := ComputeOn(q, func(t float64) Vec { return Vec{t, 0} })
	if fe, ok := err.(*FieldError); !ok || fe.Field != "curve.max" {
		t.Fatalf("got %v, want an error on the domain's end", err)
	}
	q = request("pedal", "unknown(t)", "t", 0, 1)
	q.Curve.Format = "roulette"
	if _, err := ComputeOn(q, func(t float64) Vec { return Vec{t, t * t} }); err != nil {
		t.Fatalf("the given curve should replace the formula: %v", err)
	}
}

// The involutes of a circle of radius a anchored at t₀ with string c are
// I(t) = a(cos t, sin t) + (c − a(t − t₀))(−sin t, cos t), before the
// anchor as after it, with the domain starting elsewhere.
func TestAnchoredInvolutesOfACircle(t *testing.T) {
	const a, t0 = 1.5, 1.1
	q := request("involute", "", "", -0.4, 2*math.Pi)
	q.Samples = 1201
	strings := []float64{-0.5, 0, 0.8}
	circle := func(t float64) Vec { return Vec{a * math.Cos(t), a * math.Sin(t)} }
	family, err := AnchoredInvolutes(q, circle, t0, strings)
	if err != nil {
		t.Fatal(err)
	}
	members := family.Members
	if len(members) != len(strings) {
		t.Fatalf("got %d members, want %d", len(members), len(strings))
	}
	for k, m := range members {
		for j, p := range m {
			u := q.Curve.Min + (q.Curve.Max-q.Curve.Min)*float64(j)/float64(q.Samples-1)
			s := strings[k] - a*(u-t0)
			closeVec(t, p, Vec{a*math.Cos(u) - s*math.Sin(u), a*math.Sin(u) + s*math.Cos(u)}, 1e-9)
		}
	}
}

// An anchor the arc length cannot reach, past a gap in the curve, has no
// involute: there is no length to measure from.
func TestAnchoredInvolutesPastAGap(t *testing.T) {
	q := request("involute", "", "", -1, 1)
	gap := func(t float64) Vec {
		if math.Abs(t+0.5) < 0.05 {
			return Vec{math.NaN(), math.NaN()}
		}
		return Vec{t, t * t}
	}
	if _, err := AnchoredInvolutes(q, gap, 0.5, []float64{0}); err != errUnanchored {
		t.Fatalf("got %v, want the anchor refused", err)
	}
	if _, err := AnchoredInvolutes(q, gap, -0.8, []float64{0}); err != nil {
		t.Fatalf("an anchor before the gap is reached: %v", err)
	}
}

// Each member unwound from the one computed involute is, bit for bit, the
// engine's involute computed with that member's own offset, on the curve
// and on a derived input, gaps and all.
func TestAnchoredInvolutesMatchTheirOwnComputations(t *testing.T) {
	for _, input := range []string{"curve", "pedal"} {
		q := request("involute", "", "", -2, 2.5)
		q.Input, q.Pole = input, Vec{0.3, -1.4}
		f := func(t float64) Vec {
			if math.Abs(t-1.3) < 0.02 {
				return Vec{math.NaN(), math.NaN()}
			}
			return Vec{1.5 * math.Cos(t), math.Sin(2*t) + 0.2*t}
		}
		strings := []float64{-1, 0.25, 2}
		family, err := AnchoredInvolutes(q, f, 0.4, strings)
		if err != nil {
			t.Fatal(err)
		}
		members := family.Members
		arc, err := family.Result.arcAt(q, 0.4)
		if err != nil {
			t.Fatal(err)
		}
		for k, c := range strings {
			own := q
			own.Offset = -c - arc
			want, err := ComputeOn(own, f)
			if err != nil {
				t.Fatal(err)
			}
			a, _ := json.Marshal(want.Derived)
			b, _ := json.Marshal(members[k])
			if string(a) != string(b) {
				t.Fatalf("%s: member %d differs from its own computation", input, k)
			}
		}
	}
}

// Refined, each member is the refinement of the involute computed with its
// own offset, bit for bit, broken where the curve and its input are; and
// without refinement there is none.
func TestAnchoredInvolutesRefineEachMember(t *testing.T) {
	for _, input := range []string{"curve", "pedal"} {
		q := request("involute", "", "", -2, 2.5)
		q.Samples = 64
		q.Input, q.Pole = input, Vec{0.3, -1.4}
		f := func(t float64) Vec { return Vec{1.5 * math.Cos(t), math.Sin(2*t) + 0.2*t} }
		strings := []float64{-1, 0.25, 2}
		plain, err := AnchoredInvolutes(q, f, 0.4, strings)
		if err != nil {
			t.Fatal(err)
		}
		if plain.Refined != nil {
			t.Fatal("refined without refinement")
		}
		q.Adaptive = true
		refined, err := AnchoredInvolutes(q, f, 0.4, strings)
		if err != nil {
			t.Fatal(err)
		}
		arc, err := refined.Result.arcAt(q, 0.4)
		if err != nil {
			t.Fatal(err)
		}
		if len(refined.Refined) != len(strings) {
			t.Fatalf("%s: %d refined members", input, len(refined.Refined))
		}
		for k, c := range strings {
			own := q
			own.Offset = -c - arc
			want, err := ComputeOn(own, f)
			if err != nil {
				t.Fatal(err)
			}
			a, _ := json.Marshal(want.Adaptive.Derived)
			b, _ := json.Marshal(refined.Refined[k])
			if string(a) != string(b) {
				t.Fatalf("%s: refined member %d differs from its own refinement", input, k)
			}
			if refined.Refined[k].Inserted == 0 {
				t.Fatalf("%s: 64 samples should leave member %d something to refine", input, k)
			}
		}
	}
}
