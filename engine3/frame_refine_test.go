package engine3

import (
	"math"
	"reflect"
	"testing"
)

// refinedStrands computes a refined framed study and checks each strand's
// refined path against its samples and the frame's breaks.
func refinedStrands(t *testing.T, c Request) (Result, []*RefinedPath) {
	t.Helper()
	r := refinedStudy(t, c)
	paths := r.Adaptive.Strands
	if len(paths) != c.Frame.Strands {
		t.Fatalf("%d refined strands, want %d", len(paths), c.Frame.Strands)
	}
	for k, path := range paths {
		checkPath(t, path, r.Frame.Strands[k], r.Frame.Breaks)
	}
	return r, paths
}

// A unit circle is planar, so its transported normal is the axis e_z and
// each strand is r + d(cos θ e_z + sin θ (T × e_z)) with θ = θ₀ + 2πk/m +
// 2πN s/L exactly (as in TestPrescribedTwist). Twisted 30 times round 240
// samples, the strands coil faster than the samples follow; refined, every
// point lies on its coil and every chord within tolerance of it.
func TestRefinedStrandsOnACircle(t *testing.T) {
	c := framedHarmonic(HarmonicTerm{Frequency: 1, Cosine: Vec3{1, 0, 0}, Sine: Vec3{0, 1, 0}})
	c.Samples = 240
	c.Frame.Angle, c.Frame.Twist, c.Frame.Offset, c.Frame.Width, c.Frame.Strands = 0.4, 30, 0.5, 0.2, 3
	uniform := framed(t, c)
	r, paths := refinedStrands(t, c)
	refined := r.Adaptive
	r.Adaptive = nil
	if !reflect.DeepEqual(r, uniform) {
		t.Fatal("refining the strands changed the study")
	}
	if refined.Base == nil {
		t.Fatal("the circle itself is refined too")
	}
	coil := func(k int) func(float64) Vec3 {
		return func(u float64) Vec3 {
			tangent := Vec3{-math.Sin(u), math.Cos(u), 0}
			axis := Vec3{0, 0, 1}
			theta := 0.4 + 2*math.Pi*float64(k)/3 + 30*u
			d := axis.mul(math.Cos(theta)).add(tangent.cross(axis).mul(math.Sin(theta)))
			return Vec3{math.Cos(u), math.Sin(u), 0}.add(d.mul(0.5))
		}
	}
	for k, path := range paths {
		curve := coil(k)
		for j, p := range path.Points {
			near(t, p, curve(2*math.Pi*path.At[j]/float64(c.Samples)), 1e-9)
		}
		coarse := chordError(r.Frame.Strands[k], uniformAt(c.Samples), curve, 0, 2*math.Pi, c.Samples)
		fine := chordError(path.Points, path.At, curve, 0, 2*math.Pi, c.Samples)
		if coarse < 4*path.Tolerance || fine > 1.5*path.Tolerance || path.Unresolved != 0 || path.Breaks != 0 || path.Inserted == 0 {
			t.Fatalf("strand %d: uniform error %g, refined %g, tolerance %g, %+v", k, coarse, fine, path.Tolerance, *path)
		}
	}
}

// Against the same study sampled eight times as finely, a point between
// samples is no farther from the finer study's sample at its parameter than
// the coarse samples are from theirs: the frame between samples is the
// transport step the samples take, with arc length carried on by the same
// Simpson step, over part of an interval. This holds for a
// rotation-minimizing frame with its seam shown or its correction
// distributed, and for a Frenet frame, on a closed knot whose frame does
// not return.
func TestRefinedStrandsFollowAFinerFrame(t *testing.T) {
	for _, setting := range []struct{ kind, closure string }{
		{"rotation-minimizing", "seam"},
		{"rotation-minimizing", "distribute"},
		{"frenet", "seam"},
	} {
		c := study()
		c.Construction = "framed"
		c.Frame = frameRequest()
		c.Frame.Kind, c.Frame.Closure = setting.kind, setting.closure
		c.Frame.Strands, c.Frame.Twist, c.Frame.Offset, c.Frame.Width = 2, 12, 0.4, 0
		c.Samples = 240
		fine := c
		fine.Samples = 8 * c.Samples
		reference := framed(t, fine)
		r, paths := refinedStrands(t, c)
		if setting.kind == "rotation-minimizing" && math.Abs(r.Frame.Holonomy) < 0.05 {
			t.Fatalf("holonomy %g cannot test the seam", r.Frame.Holonomy)
		}
		if (setting.closure == "distribute") != (r.Frame.Correction != 0) {
			t.Fatalf("%v: correction %g", setting, r.Frame.Correction)
		}
		for k, path := range paths {
			sampled := 0.0
			for i, p := range r.Frame.Strands[k] {
				sampled = math.Max(sampled, p.sub(*reference.Frame.Strands[k][8*i]).norm())
			}
			between, compared := 0.0, 0
			for j, p := range path.Points {
				u := 8 * path.At[j]
				if path.At[j] == math.Trunc(path.At[j]) || u != math.Trunc(u) {
					continue
				}
				between = math.Max(between, p.sub(*reference.Frame.Strands[k][int(u)]).norm())
				compared++
			}
			if path.Inserted == 0 || compared == 0 || sampled > 1e-3 || between > 2*sampled+1e-12 {
				t.Fatalf("%v strand %d: %d inserted, %d compared; between samples %g from the finer frame, samples %g", setting, k, path.Inserted, compared, between, sampled)
			}
			if path.Unresolved != 0 || path.Breaks != 0 {
				t.Fatalf("%v strand %d: %+v", setting, k, *path)
			}
		}
	}
}

// Across a pole the frame restarts, and a Frenet frame stops where the
// curvature vanishes: nothing is drawn across either, and each stretch is
// still refined.
func TestRefinedStrandsStopAtBreaks(t *testing.T) {
	for _, kind := range []string{"rotation-minimizing", "frenet"} {
		c := framedCustom("t", "1/(t-0.3)", "t^3", -1, 1)
		c.Samples = 240
		c.Frame.Kind = kind
		c.Frame.Reference = Vec3{0, 1, 1}
		c.Frame.Strands, c.Frame.Twist = 2, 8
		r, paths := refinedStrands(t, c)
		if r.Frame.Pieces < 2 {
			t.Fatalf("%s: %d pieces", kind, r.Frame.Pieces)
		}
		for k, path := range paths {
			for j, p := range path.Points {
				i := int(math.Floor(path.At[j]))
				if p != nil && path.At[j] != math.Trunc(path.At[j]) && (r.Frame.Strands[k][i] == nil || r.Frame.Strands[k][i+1] == nil || r.Frame.Breaks[i+1]) {
					t.Fatalf("%s strand %d: point drawn at %g across a break", kind, k, path.At[j])
				}
			}
			if path.Inserted == 0 {
				t.Fatalf("%s strand %d: nothing refined", kind, k)
			}
		}
	}
}

// A Frenet frame's binormal reverses through an inflection, so the frame
// breaks between the two samples beside it while the curve does not: the
// strands are not joined across it, and a transported frame's are.
// Refinement is told of the flip, rather than finding the strand's jump.
func TestRefinedStrandsStopAtAFrenetFlip(t *testing.T) {
	c := framedCustom("t", "t^3", "t^4", -1, 1)
	c.Samples = 241
	c.Frame.Strands, c.Frame.Twist = 1, 6
	flip := c.Samples/2 + 1
	r, paths := refinedStrands(t, c)
	if r.Breaks[flip] || r.Frame.Breaks[flip] {
		t.Fatal("a transported frame breaks at the inflection")
	}
	c.Frame.Kind = "frenet"
	f, flipped := refinedStrands(t, c)
	if f.Frame.Flips != 1 || f.Breaks[flip] || !f.Frame.Breaks[flip] {
		t.Fatalf("no Frenet flip apart from the curve's breaks: %+v", f.Frame)
	}
	across := func(path *RefinedPath) int {
		drawn := 0
		for j, p := range path.Points {
			if p != nil && path.At[j] > float64(flip-1) && path.At[j] < float64(flip) {
				drawn++
			}
		}
		return drawn
	}
	// The flip is the frame's own break, not one refinement has to find.
	if flipped[0].Breaks != 0 || across(flipped[0]) != 0 || across(paths[0]) == 0 {
		t.Fatalf("points across the flip: Frenet %d, transported %d", across(flipped[0]), across(paths[0]))
	}
}

// Refinement draws strands only when asked, and only the framed
// construction's: a canal's frame has none.
func TestStrandsRefinedOnlyWhenAsked(t *testing.T) {
	c := study()
	c.Construction = "framed"
	c.Frame = frameRequest()
	c.Frame.Strands = 3
	if r := framed(t, c); r.Adaptive != nil {
		t.Fatal("refined without being asked")
	}
	c.Frame.Strands = 0
	if r := refinedStudy(t, c); r.Adaptive.Strands != nil {
		t.Fatal("no strands, yet refined ones")
	}
}
