package engine

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"math"
	"runtime"
	"testing"
)

// A nearly flat parabolic mirror y = a*x² under horizontal light has
// caustic (3x/2 − 2a²x³, 3ax²). It remains finite as the ray turning
// becomes small, and passes continuously through the grazing vertex.
func TestResolvedSlowOpticalTurning(t *testing.T) {
	const a = 0x1p-33
	for _, span := range []float64{2e-5, 2, 1e5} {
		t.Run(fmt.Sprint(span), func(t *testing.T) {
			q := request("catacaustic", fmt.Sprintf("2*t/%.17g", span), fmt.Sprintf("2^-33*(2*t/%.17g)^2", span), -span/2, span/2)
			q.Source = Source{Kind: "parallel", Angle: 0}
			q.Samples = 65
			u := 0.137 * span
			q.Probe = &ProbeQuery{T: &u}
			want := func(s float64) Vec {
				x := 2 * s / span
				return Vec{1.5*x - 2*a*a*x*x*x, 3 * a * x * x}
			}
			for _, refined := range []bool{false, true} {
				q.Adaptive = refined
				r := compute(t, q)
				if r.Invalid != 0 {
					t.Fatalf("refined=%v: %d omitted caustic points", refined, r.Invalid)
				}
				for j, p := range r.Derived {
					closeVec(t, p, want(sampleT(q, j)), 2e-6)
					if math.Abs(sampleT(q, j)) > span*1e-6 && r.Virtual[j] != (sampleT(q, j) < 0) {
						t.Fatalf("sample %d: virtual=%v", j, r.Virtual[j])
					}
				}
				for _, ray := range r.Rays {
					closeVec(t, ray.Target, want(sampleT(q, ray.SampleIndex)), 2e-6)
				}
				closeVec(t, r.Probe.Derived, want(u), 2e-6)
				if refined {
					path := r.Adaptive.Derived
					if path == nil || path.Breaks != 0 || path.Exhausted {
						t.Fatalf("unexpected refined caustic: %+v", path)
					}
					for j, p := range path.Points {
						closeVec(t, p, want(param(q, path.At[j])), 2e-6)
					}
				}
			}
		})
	}
}

// At normal incidence on y = a*x², Snell's law gives the paraxial image
// distance 1/(2a(1−eta)). This checks the actual diacaustic output rather
// than a second implementation of the envelope determinant.
func TestResolvedSlowRefractedTurning(t *testing.T) {
	for _, span := range []float64{2e-5, 2, 1e5} {
		q := request("diacaustic", fmt.Sprintf("2*t/%.17g", span), fmt.Sprintf("2^-33*(2*t/%.17g)^2", span), -span/2, span/2)
		q.Source = Source{Kind: "parallel", Angle: -90}
		q.Samples = 65
		r := compute(t, q)
		focus := 1 / (2 * 0x1p-33 * (1 - q.NIncident/q.NTransmitted))
		if r.Invalid != 0 {
			t.Fatalf("%d omitted refracted caustic points", r.Invalid)
		}
		for _, p := range r.Derived {
			if p == nil || math.Abs(p.Y/focus-1) > 2e-6 {
				t.Fatalf("got %v, want paraxial focus y=%g", p, focus)
			}
		}
	}
}

func TestUnresolvedOpticalTurningHasNoFiniteCaustic(t *testing.T) {
	for _, kind := range []string{"catacaustic", "diacaustic"} {
		for _, angle := range []float64{-90, -37, 0, 21} {
			for _, y := range []string{"0", "2^-60*t^2"} {
				q := request(kind, "t", y, -1, 1)
				q.Source = Source{Kind: "parallel", Angle: angle}
				q.Samples = 65
				r := compute(t, q)
				if r.Invalid != q.Samples {
					t.Fatalf("%s/%g/%s: %d omitted, want %d", kind, angle, y, r.Invalid, q.Samples)
				}
			}
		}
	}
}

// A distant lamp's rays are almost parallel, but still have an image.
// A plane mirror images it at −R; a plane interface's paraxial virtual
// image is at R/eta in the incident half-plane.
func TestSlowPointSourceKeepsItsVirtualImage(t *testing.T) {
	const radius = 0x1p32
	for _, kind := range []string{"catacaustic", "diacaustic"} {
		q := request(kind, "t", "0", -1, 1)
		q.Source = Source{Kind: "point", Position: Vec{0, radius}}
		q.Samples = 65
		r := compute(t, q)
		y := -radius
		if kind == "diacaustic" {
			y = radius * q.NTransmitted / q.NIncident
		}
		for j, p := range r.Derived {
			if p == nil || math.Abs(p.Y/y-1) > 2e-6 || math.Abs(p.X) > 2e-6 || !r.Virtual[j] {
				t.Fatalf("%s sample %d: got %v (virtual %v), want image at (0, %g)", kind, j, p, r.Virtual[j], y)
			}
		}
	}
}

// Guard complete existing optical results, including diagnostics and refinement.
// Digests are recorded from the original implementation on both native targets.
func TestOrdinaryOpticalTurningUnchanged(t *testing.T) {
	for _, q := range []Request{nephroidRequest(), ellipseRequest("diacaustic")} {
		q.Adaptive, q.Diagnostics = true, true
		r := compute(t, q)
		b, _ := json.Marshal(r)
		got := fmt.Sprintf("%x", sha256.Sum256(b))
		want := map[string]map[string]string{
			"arm64": {"catacaustic": "0a72aaeacdc122dee1457eddd8ebd037634cd022d606db346a5d931348245d49", "diacaustic": "b8a0513a8b3155eb495566912d8e17599218a1c070bb5c3e4dff620134f71d18"},
			"amd64": {"catacaustic": "66d14f78643c56e7802ab88c9b7faf19c59a3faa922c9fed96c8602f8e5603d4", "diacaustic": "e0cf9386694c283b19e3aa4e5eb13ecb5880f603d97284fd55c96d312a31482e"},
		}
		if expected, ok := want[runtime.GOARCH]; ok && got != expected[q.Kind] {
			t.Errorf("%s/%s digest %s", runtime.GOARCH, q.Kind, got)
		}
	}
}
