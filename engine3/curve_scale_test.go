package engine3

import (
	"math"
	"tangentgarden/engine/cyclic"
	"testing"
)

// A regular curve must not inherit the absolute fallback merely because
// its frequency aliases the points used to estimate its scale.
func TestAliasedScaleSurvivesSimilarity(t *testing.T) {
	h := unitCircle(960)
	h.Format = "harmonic"
	h.Harmonic = HarmonicCurve{Min: 0, Max: 2 * math.Pi, Terms: []HarmonicTerm{
		{Frequency: 64, Cosine: Vec3{1, 0, 0}, Sine: Vec3{0, 1, 0}},
	}}
	for name, c := range map[string]Request{
		"harmonic":   h,
		"expression": custom("cos(64*t)", "sin(64*t)", "0", 0, 2*math.Pi),
	} {
		t.Run(name, func(t *testing.T) {
			want, err := Compute(c)
			if err != nil || want.Invalid != 0 {
				t.Fatalf("regular circle: invalid %d, error %v", want.Invalid, err)
			}
			_, tiny, _ := similar(c, similarities[1])
			got, err := Compute(tiny)
			if err != nil {
				t.Fatal(err)
			}
			if got.Invalid != 0 {
				t.Fatalf("scaled regular circle loses %d of %d samples", got.Invalid, len(got.Base))
			}
			if len(got.Base) != len(want.Base) {
				t.Fatal("scaling changes the sample count")
			}
			for i, p := range got.Base {
				angle := 64 * (2 * math.Pi * float64(i) / float64(c.Samples))
				expected := Vec3{math.Cos(angle), math.Sin(angle), 0}.mul(similarities[1].scale)
				if p == nil || p.sub(expected).norm() > 1e-13*similarities[1].scale {
					t.Fatalf("scaled point %d does not lie on the prescribed circle", i)
				}
				if got.Breaks[i] != want.Breaks[i] {
					t.Fatalf("scaled break %d differs", i)
				}
			}
		})
	}
}

func TestSimilarityCaptureTieRequiresBothActualGaps(t *testing.T) {
	q := spatialPresets(t)["Four pursuers on a tetrahedron"]
	want := chased(t, q).Pursuit
	_, copy, _ := similar(q, similarities[3])
	got := chased(t, copy).Pursuit
	// Choose another adjacent pair in the symmetric chase, regardless of
	// which pair this platform's rounding selected.
	alternate := *got
	pair := *got.Capture
	pair.Pursuer = (want.Capture.Pursuer + 1) % len(want.Final)
	pair.Target = (pair.Pursuer + 1) % len(want.Final)
	alternate.Capture = &pair
	if !captureTie(want, &alternate, q.Pursuit.Capture, 1) {
		t.Fatal("simultaneous adjacent captures are rejected")
	}
	pair.Target = pair.Pursuer
	if captureTie(want, &alternate, q.Pursuit.Capture, 1) {
		t.Fatal("a non-adjacent capture is accepted")
	}
	pair.Target = (pair.Pursuer + 1) % len(want.Final)
	alternate.Final = append([]Vec3{}, got.Final...)
	alternate.Final[pair.Pursuer].Z += 0.1 * q.Pursuit.Capture
	if captureTie(want, &alternate, q.Pursuit.Capture, 1) {
		t.Fatal("a pair away from the capture distance is accepted")
	}
	unique := chased(t, pursuitStudy(unequal3, .02, 0, 3)).Pursuit
	wrong := *unique
	i := (unique.Capture.Pursuer + 1) % len(unique.Final)
	wrong.Capture = &cyclic.Capture{Time: unique.Capture.Time, Pursuer: i, Target: (i + 1) % len(unique.Final)}
	if captureTie(unique, &wrong, .02, 1) {
		t.Fatal("a unique capture's identity is ignored")
	}
}

// The enormous rounded value of tan at a pole must not set the units of
// every regular branch when scaling brings that value below the coordinate
// guard. The known poles remain gaps at each scale.
func TestPoleExtentSurvivesSimilarity(t *testing.T) {
	c := custom("tan(t)", "0", "0", -math.Pi, math.Pi)
	c.Samples = 480
	want := scaleCurveResult(t, c)
	if want.Base[120] != nil || want.Base[360] != nil {
		t.Fatal("the poles are drawn in the reference study")
	}
	for _, m := range append(append([]similarity{}, similarities...), extremes...) {
		t.Run(m.name, func(t *testing.T) {
			_, copy, _ := similar(c, m)
			got := scaleCurveResult(t, copy)
			for i, p := range want.Base {
				if (p == nil) != (got.Base[i] == nil) || want.Breaks[i] != got.Breaks[i] {
					t.Fatalf("sample %d changes its gap or break under scaling", i)
				}
			}
		})
	}
}

func scaleCurveResult(t *testing.T, c Request) Result {
	t.Helper()
	out, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	return out
}
