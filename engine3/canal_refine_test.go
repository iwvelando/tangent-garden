package engine3

import (
	"math"
	"reflect"
	"testing"
)

// refinedMeridians computes a canal study uniformly and refined, checks
// that refining leaves the study's samples in place, and checks each
// meridian's refined path against its samples and the uniform study's
// breaks.
func refinedMeridians(t *testing.T, c Request) (Result, Result, []*RefinedPath) {
	t.Helper()
	uniform := canal(t, c)
	r := refinedStudy(t, c)
	paths := r.Adaptive.Meridians
	if len(paths) != c.Canal.Meridians {
		t.Fatalf("%d refined meridians, want %d", len(paths), c.Canal.Meridians)
	}
	if !reflect.DeepEqual(r.Canal.Meridians, uniform.Canal.Meridians) {
		t.Fatal("refining moved the meridians' samples")
	}
	for k, path := range paths {
		checkPath(t, path, r.Canal.Meridians[k], uniform.Canal.Breaks)
	}
	return uniform, r, paths
}

// A tube of radius 0.5 round the circle of radius 2 is a torus. The circle
// is planar, so its transported normal is e_z and meridian k is
// c + 0.5(cos θ e_z + sin θ (T × e_z)) with θ = θ₀ + 2πk/m + 2πN s/L,
// exactly as an offset strand. Twisted 30 times round 240 samples, the
// meridians wind faster than the samples follow; refined, every point lies
// on its winding and every chord within tolerance of it, and the study is
// otherwise unchanged.
func TestRefinedMeridiansOnATorus(t *testing.T) {
	c := canalled(circle(), 0.5, "1", 3)
	c.Samples = 240
	c.Frame.Angle, c.Frame.Twist = 0.4, 30
	uniform, r, paths := refinedMeridians(t, c)
	refined := r.Adaptive
	r.Adaptive = nil
	if !reflect.DeepEqual(r, uniform) {
		t.Fatal("refining the meridians changed the study")
	}
	if refined.Base == nil {
		t.Fatal("the circle itself is refined too")
	}
	winding := func(k int) func(float64) Vec3 {
		return func(u float64) Vec3 {
			tangent := Vec3{-math.Sin(u), math.Cos(u), 0}
			axis := Vec3{0, 0, 1}
			theta := 0.4 + 2*math.Pi*float64(k)/3 + 30*u
			d := axis.mul(math.Cos(theta)).add(tangent.cross(axis).mul(math.Sin(theta)))
			return Vec3{2 * math.Cos(u), 2 * math.Sin(u), 0}.add(d.mul(0.5))
		}
	}
	for k, path := range paths {
		curve := winding(k)
		for j, p := range path.Points {
			near(t, p, curve(2*math.Pi*path.At[j]/float64(c.Samples)), 1e-9)
		}
		coarse := chordError(r.Canal.Meridians[k], uniformAt(c.Samples), curve, 0, 2*math.Pi, c.Samples)
		fine := chordError(path.Points, path.At, curve, 0, 2*math.Pi, c.Samples)
		if coarse < 4*path.Tolerance || fine > 1.5*path.Tolerance || path.Unresolved != 0 || path.Breaks != 0 || path.Inserted == 0 {
			t.Fatalf("meridian %d: uniform error %g, refined %g, tolerance %g, %+v", k, coarse, fine, path.Tolerance, *path)
		}
	}
}

// Along the unit-speed z axis the transported frame is constant, so a
// canal of radius R(t) = 0.5 + 0.2 sin t is a surface of revolution whose
// contact circle at t is centred at t − RR′ on the axis, with radius
// R√(1 − R′²). Meridian k turns about the axis at θ = θ₀ + 2πk/m +
// 2πN(t − t₀)/L. Between samples the circle follows the profile's own
// radius and slope, not an interpolation of the samples', so refined points
// lie on the closed form as closely as the samples do.
func TestRefinedMeridiansFollowAVaryingRadius(t *testing.T) {
	c := canalled(custom("0", "0", "t", 0, 6), 1, "0.5+0.2*sin(t)", 2)
	c.Frame.Reference = Vec3{1, 0, 0}
	c.Samples = 240
	c.Frame.Angle, c.Frame.Twist = 0.3, 20
	_, r, paths := refinedMeridians(t, c)
	if r.Canal.Constant || r.Canal.Imaginary != 0 || r.Canal.Folded != 0 {
		t.Fatalf("summary %+v", r.Canal)
	}
	meridian := func(k int, s float64) Vec3 {
		R, slope := 0.5+0.2*math.Sin(s), 0.2*math.Cos(s)
		theta := 0.3 + math.Pi*float64(k) + 2*math.Pi*20*s/6
		rho := R * math.Sqrt(1-slope*slope)
		return Vec3{rho * math.Cos(theta), rho * math.Sin(theta), s - R*slope}
	}
	for k, path := range paths {
		between := 0
		for j, p := range path.Points {
			if path.At[j] != math.Trunc(path.At[j]) {
				between++
			}
			near(t, p, meridian(k, 6*path.At[j]/float64(c.Samples)), 1e-7)
		}
		if between == 0 || path.Unresolved != 0 || path.Breaks != 0 {
			t.Fatalf("meridian %d: %d points between samples, %+v", k, between, *path)
		}
	}
}

// A tube of radius 2 round the unit segment of the z axis is a cylinder,
// and meridian k twisted 20 times is the helix (2 cos θ, 2 sin θ, t),
// θ = πk + 40πt. Its tolerance follows its own size, about four times the
// segment's, not the base's.
func TestRefinedMeridiansFollowTheirOwnSize(t *testing.T) {
	c := canalled(custom("0", "0", "t", 0, 1), 2, "1", 2)
	c.Frame.Reference = Vec3{1, 0, 0}
	c.Samples = 240
	c.Frame.Twist = 20
	_, r, paths := refinedMeridians(t, c)
	helix := func(k int) func(float64) Vec3 {
		return func(s float64) Vec3 {
			theta := math.Pi*float64(k) + 40*math.Pi*s
			return Vec3{2 * math.Cos(theta), 2 * math.Sin(theta), s}
		}
	}
	for k, path := range paths {
		curve := helix(k)
		if path.Tolerance < 3*r.Adaptive.Base.Tolerance {
			t.Fatalf("meridian %d: tolerance %g round a base of tolerance %g", k, path.Tolerance, r.Adaptive.Base.Tolerance)
		}
		for j, p := range path.Points {
			near(t, p, curve(path.At[j]/float64(c.Samples)), 1e-9)
		}
		coarse := chordError(r.Canal.Meridians[k], uniformAt(c.Samples), curve, 0, 1, c.Samples)
		fine := chordError(path.Points, path.At, curve, 0, 1, c.Samples)
		if coarse < 4*path.Tolerance || fine > 1.5*path.Tolerance || path.Unresolved != 0 || path.Inserted == 0 {
			t.Fatalf("meridian %d: uniform error %g, refined %g, tolerance %g, %+v", k, coarse, fine, path.Tolerance, *path)
		}
	}
}

// Against the same knot's tube sampled eight times as finely, a meridian's
// point between samples is no farther from the finer study's sample at its
// parameter than the coarse samples are from theirs, with the frame's seam
// shown or its correction distributed.
func TestRefinedMeridiansFollowAFinerStudy(t *testing.T) {
	for _, closure := range []string{"seam", "distribute"} {
		c := canalled(study(), 0.3, "1+0.4*sin(3*t)", 4)
		c.Frame.Closure, c.Frame.Twist = closure, 12
		c.Samples = 240
		fine := c
		fine.Samples = 8 * c.Samples
		reference := canal(t, fine)
		_, r, paths := refinedMeridians(t, c)
		if math.Abs(r.Frame.Holonomy) < 0.01 || (closure == "distribute") != (r.Frame.Correction != 0) {
			t.Fatalf("%s: frame %+v", closure, r.Frame)
		}
		for k, path := range paths {
			sampled := 0.0
			for i, p := range r.Canal.Meridians[k] {
				sampled = math.Max(sampled, p.sub(*reference.Canal.Meridians[k][8*i]).norm())
			}
			between, compared := 0.0, 0
			for j, p := range path.Points {
				u := 8 * path.At[j]
				if path.At[j] == math.Trunc(path.At[j]) || u != math.Trunc(u) {
					continue
				}
				between = math.Max(between, p.sub(*reference.Canal.Meridians[k][int(u)]).norm())
				compared++
			}
			if path.Inserted == 0 || compared == 0 || sampled > 1e-3 || between > 2*sampled+1e-12 {
				t.Fatalf("%s meridian %d: %d inserted, %d compared; between samples %g from the finer study, samples %g", closure, k, path.Inserted, compared, between, sampled)
			}
			if path.Unresolved != 0 || path.Breaks != 0 {
				t.Fatalf("%s meridian %d: %+v", closure, k, *path)
			}
		}
	}
}

// A profile undefined on a window narrower than a quarter interval, between
// a sample and the interval's midpoint, passes the uniform study's checks;
// refinement finds it, breaks every meridian and the surface there, and
// draws no face across it.
func TestRefinedMeridiansBreakTheSurface(t *testing.T) {
	c := canalled(custom("t", "0", "0", 0, 2), 0.3, "1+0*sqrt((t-1.00104)^2-0.00000009)", 3)
	uniform, r, paths := refinedMeridians(t, c)
	crack := 241
	if uniform.Canal.Breaks[crack] || uniform.Omitted != 0 {
		t.Fatalf("the uniform study already breaks: omitted %d", uniform.Omitted)
	}
	if !r.Canal.Breaks[crack] || r.Breaks[crack] || r.Omitted != 1 {
		t.Fatalf("canal break %v, base break %v, omitted %d", r.Canal.Breaks[crack], r.Breaks[crack], r.Omitted)
	}
	for k, path := range paths {
		if path.Breaks != 1 {
			t.Fatalf("meridian %d: %+v", k, *path)
		}
		// The window where ρ is undefined, |t − 1.00104| < 0.0003.
		for j, p := range path.Points {
			if s := 2 * path.At[j] / float64(c.Samples); p != nil && math.Abs(s-1.00104) < 0.0003 {
				t.Fatalf("meridian %d: point drawn at t = %g, inside the gap", k, s)
			}
		}
	}
	for _, v := range corners(r.Mesh) {
		if v.SampleIndex == crack {
			t.Fatalf("face across the gap at %+v", v.Position)
		}
	}
	if len(corners(r.Mesh)) != len(corners(uniform.Mesh))-canalSegments*6 {
		t.Fatalf("%d vertices, uniform %d", len(corners(r.Mesh)), len(corners(uniform.Mesh)))
	}
}

// R′ = 1.0000001 cos(t − 1.00104) exceeds the unit speed only within about
// 0.00045 of a quarter point: the uniform study's samples and midpoint all
// have real circles, but refinement finds the lost envelope and breaks the
// surface there.
func TestRefinedMeridiansFindALostEnvelope(t *testing.T) {
	c := canalled(custom("t", "0", "0", 0, 2), 1, "3+1.0000001*sin(t-1.00104)", 2)
	uniform, r, paths := refinedMeridians(t, c)
	crack := 241
	if uniform.Canal.Breaks[crack] || uniform.Canal.Imaginary != 0 || uniform.Omitted != 0 {
		t.Fatalf("the uniform study already breaks: %+v", uniform.Canal)
	}
	if !r.Canal.Breaks[crack] || r.Omitted != 1 {
		t.Fatalf("canal break %v, omitted %d", r.Canal.Breaks[crack], r.Omitted)
	}
	for k, path := range paths {
		if path.Breaks != 1 {
			t.Fatalf("meridian %d: %+v", k, *path)
		}
		for j, p := range path.Points {
			if s := 2 * path.At[j] / float64(c.Samples); p != nil && math.Abs(s-1.00104) < 0.0004 {
				t.Fatalf("meridian %d: point drawn at t = %g, where the envelope is lost", k, s)
			}
		}
	}
}

// Where the spheres have no real contact circle the uniform study already
// breaks; refinement inserts nothing there, keeps every circle it has, and
// finds no break of its own.
func TestRefinedMeridiansKeepImaginaryCircles(t *testing.T) {
	c := canalled(custom("0", "0", "t", -3, 3), 1, "1+0.8*sin(2*t)", 2)
	c.Frame.Reference = Vec3{1, 0, 0}
	c.Frame.Twist = 4
	uniform, r, paths := refinedMeridians(t, c)
	if uniform.Canal.Imaginary == 0 {
		t.Fatal("no imaginary circles")
	}
	if !reflect.DeepEqual(r.Canal.Breaks, uniform.Canal.Breaks) || r.Omitted != uniform.Omitted {
		t.Fatalf("breaks changed; omitted %d, uniform %d", r.Omitted, uniform.Omitted)
	}
	for k, path := range paths {
		if path.Breaks != 0 || path.Inserted == 0 {
			t.Fatalf("meridian %d: %+v", k, *path)
		}
	}
}

// Meridians are refined only when asked, and only when the canal draws
// some.
func TestMeridiansRefinedOnlyWhenAsked(t *testing.T) {
	c := canalled(circle(), 0.5, "1", 3)
	if r := canal(t, c); r.Adaptive != nil {
		t.Fatal("refined without being asked")
	}
	c.Canal.Meridians = 0
	if r := refinedStudy(t, c); r.Adaptive.Meridians != nil {
		t.Fatal("no meridians, yet refined ones")
	}
}
