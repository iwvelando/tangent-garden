package engine

import (
	"math"
	"testing"
)

// This existing preset's unit-scale caustic is the nephroid, independently
// of the stencil used by the production engine. Keep it before sharing the
// tangent checks with very small copies.
func TestPlanarLightExistingPreset(t *testing.T) {
	for _, p := range loadPresets(t) {
		if p.Title != "Parallel light & a circle" {
			continue
		}
		q := p.Config
		r := compute(t, q)
		for j, point := range r.Derived {
			closeVec(t, point, nephroid(sampleT(q, j)), 2e-6)
		}
		if len(r.Rays) != q.Lines || r.Invalid != 0 {
			t.Fatalf("rays %d, invalid %d", len(r.Rays), r.Invalid)
		}
		return
	}
	t.Fatal("missing existing optical preset")
}

// Length units change neither optical directions nor which caustic points,
// virtual branches, reflected TIR rays or refined points exist. Exercise
// actual Compute results, including a between-sample probe.
func TestPlanarLightAtTinyScales(t *testing.T) {
	reflected := nephroidRequest()
	refracted := reflected
	refracted.Kind, refracted.NIncident, refracted.NTransmitted = "diacaustic", 1, 1.5
	point := request("catacaustic", "t", "0", -3, 3)
	point.Samples = 65
	tir := point
	tir.Kind, tir.NIncident, tir.NTransmitted = "diacaustic", 1.5, 1
	for name, q := range map[string]Request{"reflection": reflected, "refraction": refracted, "point source": point, "total internal reflection": tir} {
		for _, refined := range []bool{false, true} {
			q.Adaptive, q.Diagnostics = refined, true
			at := 0.731
			q.Probe = &ProbeQuery{T: &at}
			want := compute(t, q)
			if len(want.Rays) != q.Lines {
				t.Fatalf("%s: no unit-scale rays", name)
			}
			for _, scale := range []float64{0x1p-35, 0x1p-40, 0x1p-100} {
				t.Run(name+num(scale)+map[bool]string{false: " sampled", true: " refined"}[refined], func(t *testing.T) {
					m := similarity{"tiny", scale, Vec{}}
					copy, _ := m.copyOf(q)
					got := compute(t, copy)
					newCopies(t, want, m).result(q, want, got)
					if len(got.Rays) != len(want.Rays) {
						t.Fatal("lost optical rays")
					}
					for j, ray := range got.Rays {
						original := want.Rays[j]
						if ray.Direction != original.Direction || ray.Incident != original.Incident || ray.Origin != original.Origin.Mul(scale) {
							t.Fatalf("ray %d changed direction or origin under scaling", j)
						}
						if original.Target != nil {
							closeVec(t, pointScaled(ray.Target, scale), *original.Target, 0)
						}
					}
					if (want.Probe.Derived == nil) != (got.Probe.Derived == nil) {
						t.Fatal("probe lost its caustic")
					}
					if want.Probe.Derived != nil {
						closeVec(t, pointScaled(got.Probe.Derived, scale), *want.Probe.Derived, 0)
					}
				})
			}
		}
	}
}

func pointScaled(p *Vec, scale float64) *Vec {
	if p == nil {
		return nil
	}
	return point(p.Mul(1 / scale))
}

// Focus and Snell's law are independent checks on the returned geometry,
// beyond comparing copies. Parallel rays still have no finite envelope.
func TestTinyPlanarLightOpticalIdentities(t *testing.T) {
	for _, scale := range []float64{1, 0x1p-40, 0x1p-100} {
		q := request("catacaustic", num(scale)+"*t", num(scale)+"*t^2/4", -3, 3)
		q.Source = Source{Kind: "parallel", Angle: -90}
		q.Samples, q.Lines = 65, 9
		r := compute(t, q)
		for _, p := range r.Derived {
			closeVec(t, pointScaled(p, scale), Vec{0, 1}, 2e-5)
		}
		if len(r.Rays) != q.Lines {
			t.Fatalf("scale %g: no reflected rays", scale)
		}
		q.Kind, q.NIncident, q.NTransmitted = "diacaustic", 1, 1.5
		refracted := compute(t, q)
		if len(refracted.Rays) != q.Lines {
			t.Fatalf("scale %g: no refracted rays", scale)
		}
		for _, ray := range refracted.Rays {
			u := sampleT(q, ray.SampleIndex)
			tangent := Vec{1, u / 2}.Unit()
			if math.Abs(ray.Incident.Dot(tangent)-1.5*ray.Direction.Dot(tangent)) > 1e-9 || math.Abs(ray.Direction.Norm()-1) > 1e-12 {
				t.Fatalf("scale %g: Snell's law failed at %g", scale, u)
			}
		}
		q.Kind, q.Curve.Y = "catacaustic", "0"
		r = compute(t, q)
		if r.Invalid != q.Samples || len(r.Rays) != q.Lines {
			t.Fatalf("scale %g: parallel rays lost or acquired an envelope", scale)
		}
	}
}

// A stationary point, a cusp at the origin and a source exactly on the
// curve never invent an outgoing ray or a TIR classification. Neighbors
// of an isolated singularity still carry rays at every scale.
func TestPlanarLightDegeneraciesAtAnyScale(t *testing.T) {
	for _, scale := range []float64{1, 0x1p-40, 0x1p-100} {
		for _, kind := range []string{"catacaustic", "diacaustic"} {
			for name, xy := range map[string][2]string{"point": {"0", "0"}, "cusp": {"1-cos(20*t)", "20*t-sin(20*t)"}, "source": {"t", "t^2"}} {
				q := request(kind, num(scale)+"*("+xy[0]+")", num(scale)+"*("+xy[1]+")", -1, 1)
				q.Samples, q.Lines = 65, 65
				q.Source = Source{Kind: "point", Position: Vec{0, 2 * scale}}
				if name == "source" {
					q.Source.Position = Vec{}
				}
				r := compute(t, q)
				if r.Derived[32] != nil {
					t.Fatalf("%s %s %g: caustic at singularity", kind, name, scale)
				}
				for _, ray := range r.Rays {
					if ray.SampleIndex == 32 {
						t.Fatalf("%s %s %g: ray at singularity", kind, name, scale)
					}
				}
				if name != "point" && len(r.Rays) < 60 {
					t.Fatalf("%s %s %g: lost regular neighbors (%d rays)", kind, name, scale, len(r.Rays))
				}
			}
		}
	}
}

// Only a separation resolved relative to the coordinates can name an
// incident direction. Removing the near-coincidence guard must not turn
// coordinate rounding into an arbitrarily directed ray.
func TestPlanarLightSourceCoincidenceIsRelative(t *testing.T) {
	for _, scale := range []float64{1, 0x1p-40, 0x1p-100} {
		for _, separation := range []float64{0, 1e-10, 1e-5} {
			q := nephroidRequest()
			q.Source = Source{Kind: "point", Position: Vec{scale * (1 + separation), 0}}
			q.Curve.X, q.Curve.Y = num(scale)+"*cos(t)", num(scale)+"*sin(t)"
			r := compute(t, q)
			found := false
			for _, ray := range r.Rays {
				found = found || ray.SampleIndex == 0
			}
			if want := separation == 1e-5; found != want {
				t.Fatalf("scale %g, separation %g: outgoing ray present %v, want %v", scale, separation, found, want)
			}
		}
	}
}
