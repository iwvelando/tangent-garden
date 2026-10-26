package engine4

import (
	"fmt"
	"math"
	"reflect"
	"testing"
)

// Scale and translation budget (docs/tesseracts.md, "Scale and translation").
//
// A power-of-two scale multiplies every length exactly, so any difference from
// the original comes only from a tolerance that did not scale with it; such
// scales must reproduce every number exactly. Other scales agree within
// scaleBudget of the framing radius, and dimensionless route or source
// parameters within scaleBudget. A study more than thresholdApart (relative to
// its own scale) from a threshold keeps its outcome at every supported scale;
// one within thresholdTogether is coalesced at every supported scale.
const scaleBudget = 1e-12
const thresholdApart, thresholdTogether = 1e-8, 1e-13

func powerOfTwo(x float64) bool { f, _ := math.Frexp(x); return f == .5 }

// within compares a returned length with its expected scaled value: exactly for
// a power-of-two scale, otherwise within the budget of the framing radius.
func within(t *testing.T, label string, got, want, lambda, radius float64) {
	t.Helper()
	if powerOfTwo(lambda) {
		if got != want {
			t.Fatalf("%s at scale %g: %v, want exactly %v", label, lambda, got, want)
		}
	} else if math.Abs(got-want) > scaleBudget*radius {
		t.Fatalf("%s at scale %g: %v, want %v within %g", label, lambda, got, want, scaleBudget*radius)
	}
}

// sameScaled checks that every returned length of got is lambda times the
// matching length of base, every parameter and identity is unchanged, and the
// work counts agree.
func sameScaled(t *testing.T, label string, base, got Result, lambda float64) {
	t.Helper()
	label = fmt.Sprintf("%s ×%g", label, lambda)
	radius := got.Radius
	within(t, label+" framing radius", got.Radius, lambda*base.Radius, lambda, radius)
	if got.Object != base.Object || got.Operation != base.Operation || got.EmittedPoints != base.EmittedPoints ||
		got.Evaluations != base.Evaluations || got.Clipped != base.Clipped {
		t.Fatalf("%s: counts or identity changed: %+v vs %+v", label,
			[]any{got.Object, got.Operation, got.EmittedPoints, got.Evaluations, got.Clipped},
			[]any{base.Object, base.Operation, base.EmittedPoints, base.Evaluations, base.Clipped})
	}
	vec3 := func(what string, a, b Vec3) {
		for i := range a {
			within(t, what, b[i], lambda*a[i], lambda, radius)
		}
	}
	vec4 := func(what string, a, b Vec4) {
		for i := range a {
			within(t, what, b[i], lambda*a[i], lambda, radius)
		}
	}
	if len(got.Paths) != len(base.Paths) || len(got.Points) != len(base.Points) || len(got.Markers) != len(base.Markers) ||
		len(got.Sections) != len(base.Sections) || len(got.Faces) != len(base.Faces) {
		t.Fatalf("%s: element counts changed", label)
	}
	for i, p := range base.Paths {
		g := got.Paths[i]
		what := fmt.Sprintf("%s path %s/%s/%s", label, p.Source, p.SectionID, p.Branch)
		if g.Source != p.Source || g.SectionID != p.SectionID || g.Branch != p.Branch || g.Role != p.Role ||
			g.Family != p.Family || g.Guide != p.Guide || g.Dashed != p.Dashed ||
			len(g.Points) != len(p.Points) || len(g.FourPoints) != len(p.FourPoints) || len(g.Parameters) != len(p.Parameters) {
			t.Fatalf("%s: identity or length changed", what)
		}
		for j := range p.Points {
			vec3(what, p.Points[j], g.Points[j])
		}
		for j := range p.FourPoints {
			vec4(what, p.FourPoints[j], g.FourPoints[j])
		}
		for j := range p.Parameters {
			within(t, what+" parameter", g.Parameters[j], p.Parameters[j], lambda, 1)
		}
	}
	for i := range base.Points {
		vec3(label+" point", base.Points[i], got.Points[i])
	}
	for i, m := range base.Markers {
		g := got.Markers[i]
		if g.ID != m.ID || g.Role != m.Role || g.Family != m.Family {
			t.Fatalf("%s: marker identity changed", label)
		}
		vec3(label+" marker", m.Point, g.Point)
		vec4(label+" marker", m.FourPoint, g.FourPoint)
	}
	for i, s := range base.Sections {
		g := got.Sections[i]
		if g.ID != s.ID || g.Kind != s.Kind || g.Dimension != s.Dimension || g.Vertices != s.Vertices || g.Edges != s.Edges || g.Faces != s.Faces {
			t.Fatalf("%s: section %s changed from %+v to %+v", label, s.ID, s, g)
		}
		within(t, label+" section level", g.Level, lambda*s.Level, lambda, radius)
		within(t, label+" section radius", g.Radius, lambda*s.Radius, lambda, radius)
	}
	if (base.Bypass == nil) != (got.Bypass == nil) || (base.Companion == nil) != (got.Companion == nil) {
		t.Fatalf("%s: diagnostics or companion appeared or vanished", label)
	}
	if b := base.Bypass; b != nil {
		g := got.Bypass
		if g.State != b.State || g.Position != b.Position || len(g.Hits) != len(b.Hits) {
			t.Fatalf("%s: bypass outcome changed: %+v vs %+v", label, g, b)
		}
		for i, h := range b.Hits {
			within(t, label+" hit", g.Hits[i].From, h.From, lambda, 1)
			within(t, label+" hit", g.Hits[i].To, h.To, lambda, 1)
		}
		within(t, label+" clearance", g.Clearance, lambda*b.Clearance, lambda, radius)
		within(t, label+" distance", g.Distance, lambda*b.Distance, lambda, radius)
		within(t, label+" shadow distance", g.ShadowDistance, lambda*b.ShadowDistance, lambda, radius)
		vec4(label+" current", b.Current, g.Current)
	}
	if base.Companion != nil {
		sameScaled(t, label+" companion", *base.Companion, *got.Companion, lambda)
	}
}

// The tesseract and the spherical weave are fixed objects: the unit tesseract
// and the unit 3-sphere, centered at the origin. The request carries no size or
// center for them, so neither can be scaled or translated, and their fixed
// tolerances are set for that one scale. The shared size fields are ignored.
func TestFixedScaleObjectsHaveNoSizeOrCenter(t *testing.T) {
	studies := map[string]Request{}
	for _, mode := range []string{"perspective", "orthographic", "stereo", "section"} {
		q := Request{Mode: mode, Angles: [6]float64{.3, -.2, .5, .7, -.4, .25}, Distance: 4, Slice: .3, Spread: 1.5, Count: 5, Grid: 3, Samples: 32, Clip: 4}
		studies["tesseract "+mode] = q
	}
	for _, family := range []string{"tori", "fibers"} {
		q := weaveRequest(family, 3, 4, .7, .6)
		q.Angles = [6]float64{.2, 0, .4, .9, -.3, .1}
		studies["weave "+family] = q
	}
	for name, q := range studies {
		base, err := Compute(q)
		if err != nil {
			t.Fatal(name, err)
		}
		q.Radius, q.Tube = 37, 5
		sized, err := Compute(q)
		if err != nil {
			t.Fatal(name, err)
		}
		if !reflect.DeepEqual(base, sized) {
			t.Fatalf("%s: a size field changed a fixed-scale object", name)
		}
	}
}

func scaledCurved(object string, lambda float64) Request {
	spread := 1.6 // the tube's support is 0.4
	if object == "ball" {
		spread = 2.4
	}
	return Request{Object: object, Mode: "section", Radius: lambda, Tube: .4 * lambda, Slice: .1 * lambda, Spread: spread * lambda,
		Count: 9, Curves: 5, Samples: 32}
}

// Curved sections have no center but scale with their radii: the slice, its
// spread and every returned point and diagnostic scale with them.
func TestCurvedSectionsScaleWithTheirRadii(t *testing.T) {
	scales := map[string][]float64{"ball": {.001, 1. / 256, .3, 3, 64, 100}, "tube": {.003, 1. / 256, .3, 3, 64, 100}}
	for object, lambdas := range scales {
		base := liftResult(t, scaledCurved(object, 1))
		kinds := map[string]bool{}
		for _, s := range base.Sections {
			kinds[s.Kind] = true
		}
		if !kinds["empty"] || !kinds["solid"] {
			t.Fatal(object, "the family must include empty and solid sections", base.Sections)
		}
		for _, lambda := range lambdas {
			sameScaled(t, object, base, liftResult(t, scaledCurved(object, lambda)), lambda)
		}
	}
}

// The tangency band on h is 10⁻¹² + 10⁻¹⁰ s for support s, so a slice within
// 10⁻¹³ s of the support is tangent and one 10⁻⁸ s away is not, at every
// supported support from 0.001 to 100.
func TestCurvedTangencyThresholdIsScaleRelative(t *testing.T) {
	type study struct {
		object        string
		radius, tube  float64
		support       float64
		tangent, near string
	}
	studies := []study{}
	for _, s := range []float64{.001, .03, 1, 7, 100} {
		studies = append(studies, study{"ball", s, 0, s, "point", "solid"})
	}
	for _, s := range []float64{.001, .03, 1, 7, 99} {
		studies = append(studies, study{"tube", 100, s, s, "core-circle", "solid"})
	}
	studies = append(studies, study{"tube", .002, .001, .001, "core-circle", "solid"})
	for _, c := range studies {
		kind := func(delta float64) string {
			q := Request{Object: c.object, Mode: "section", Radius: c.radius, Tube: c.tube, Slice: c.support * (1 + delta), Count: 1, Curves: 3, Samples: 8}
			r := liftResult(t, q)
			return r.Sections[0].Kind
		}
		for _, delta := range []float64{thresholdTogether, -thresholdTogether, 0} {
			if got := kind(delta); got != c.tangent {
				t.Fatalf("%s support %g, slice (1%+g)s: %s, want %s", c.object, c.support, delta, got, c.tangent)
			}
		}
		if got := kind(-thresholdApart); got != c.near {
			t.Fatalf("%s support %g just inside: %s, want %s", c.object, c.support, got, c.near)
		}
		if got := kind(thresholdApart); got != "empty" {
			t.Fatalf("%s support %g just outside: %s", c.object, c.support, got)
		}
	}
}

func scaledBypass(mode, obstacle string, lambda, height float64) Request {
	return Request{Object: "bypass", Mode: mode, Samples: 24, Bypass: &BypassParameters{
		Inner: lambda, Outer: 1.6 * lambda, Extent: .4 * lambda, Outside: Vec3{2.4 * lambda, 1.2 * lambda, .8 * lambda},
		Height: height * lambda, Position: .55, Obstacle: obstacle, W1: -.5 * lambda, W2: .7 * lambda}}
}

// The bypass obstacle is centered at the origin with no center parameter, but
// every length of the study (radii, extent, outside point, route height and
// comparison levels) scales together. Route parameters, hits and states are
// unchanged; lengths scale.
func TestBypassScalesWithEveryLength(t *testing.T) {
	for _, obstacle := range []string{"embedded", "radial"} {
		for _, mode := range []string{"shadow", "diagram", "paired"} {
			for _, height := range []float64{1.1, .4, .2} { // clear, contact, crossing when embedded
				base := liftResult(t, scaledBypass(mode, obstacle, 1, height))
				for _, lambda := range []float64{1. / 16, .3, 3, 8} {
					sameScaled(t, fmt.Sprintf("%s %s H=%g", obstacle, mode, height), base, liftResult(t, scaledBypass(mode, obstacle, lambda, height)), lambda)
				}
			}
		}
	}
	states := map[string]bool{}
	for _, height := range []float64{1.1, .4, .2} {
		states[liftResult(t, scaledBypass("shadow", "embedded", 1, height)).Bypass.State] = true
	}
	if !states["clear"] || !states["contact"] || !states["crossing"] {
		t.Fatal("the scaled studies must cover every route state", states)
	}
}

// Tangency thresholds are decided in the same place at every scale. For K₄ the
// second leg meets the sphere |q| = b tangentially at its end when H = b; for K
// the second leg runs along the slab boundary when H = ε.
func TestBypassThresholdsAreScaleRelative(t *testing.T) {
	const b, eps = 1.6, .4
	outside := math.Sqrt(2.4*2.4 + 1.2*1.2 + .8*.8)
	for _, lambda := range []float64{1. / 16, .3, 1, 3, 8} {
		hits := func(obstacle string, height float64) *BypassDiagnostics {
			return liftResult(t, scaledBypass("shadow", obstacle, lambda, height)).Bypass
		}
		// Radial: H = b(1+δ).
		for _, delta := range []float64{thresholdTogether / 10, -thresholdTogether / 10} {
			d := hits("radial", b*(1+delta))
			if len(d.Hits) != 2 || d.Hits[0].From != d.Hits[0].To || math.Abs(d.Hits[0].From-2./3) > 1e-15 {
				t.Fatalf("scale %g δ %g: tangent contact at the second vertex, got %+v", lambda, delta, d.Hits)
			}
		}
		d := hits("radial", b*(1+thresholdApart))
		if len(d.Hits) != 1 || math.Abs(d.Hits[0].From-(3-1/(1+thresholdApart))/3) > 1e-12 {
			t.Fatalf("scale %g: a route just above b meets the shell on its last leg only, got %+v", lambda, d.Hits)
		}
		d = hits("radial", b*(1-thresholdApart))
		h := b * (1 - thresholdApart)
		chord := math.Sqrt(b*b-h*h) / outside / 3 // route length of the second leg inside |q| ≤ b
		if len(d.Hits) != 2 || math.Abs((d.Hits[0].To-d.Hits[0].From)/chord-1) > 1e-6 || d.Hits[0].To != 2./3 {
			t.Fatalf("scale %g: a route just below b crosses the ball before the vertex, got %+v want length %g", lambda, d.Hits, chord)
		}
		// Embedded: H = ε + δ b.
		for _, c := range []struct {
			delta float64
			state string
		}{{thresholdApart, "clear"}, {thresholdTogether, "contact"}, {0, "contact"}, {-thresholdApart, "crossing"}} {
			if got := hits("embedded", eps+c.delta*b); got.State != c.state {
				t.Fatalf("scale %g: H = ε%+g b is %s, want %s", lambda, c.delta, got.State, c.state)
			}
		}
	}
}

func shiftedLift(mode string, x float64, samples int) Request {
	return Request{Object: "lift", Mode: mode, Samples: samples, Lift: &LiftParameters{Center: Vec3{x, .25, 0}, Support: 1.2, Height: 1.5,
		Angle: .6, From: Vec3{-5, 0, 0}, To: Vec3{5, 0, 0}, RadiusFrom: .5, RadiusTo: 1.5}}
}

// The lift's sources are fixed analytic curves; only the lift moves. The
// threads are straight, so moving the lift center by τ along x moves every
// interior cut, sample and lifted point along the threads by τ (a parameter
// shift of τ/6), while the diagnostics stay the same.
func TestLiftTranslationAlongTheThreads(t *testing.T) {
	const tau, samples = 1., 60
	shift := tau / 6
	for _, mode := range []string{"reference", "lifted"} {
		base := liftResult(t, shiftedLift(mode, -.5, samples))
		moved := liftResult(t, shiftedLift(mode, -.5+tau, samples))
		if *base.Lift != *moved.Lift || base.Radius != moved.Radius {
			t.Fatalf("%s: translated diagnostics or framing changed: %+v vs %+v", mode, base.Lift, moved.Lift)
		}
		matched := 0
		for i := 0; i < 5; i++ {
			id := fmt.Sprintf("lift/thread/%d", i)
			from, to := sourcePaths(base, id), sourcePaths(moved, id)
			if len(from) != len(to) {
				t.Fatalf("%s %s: %d pieces became %d", mode, id, len(from), len(to))
			}
			for k, p := range from {
				q := to[k]
				for j, s := range p.Parameters {
					if mode == "reference" && (j == 0 && s == 0 || j == len(p.Parameters)-1 && s == 1) {
						continue // the thread's own ends do not move
					}
					found := false
					for m, u := range q.Parameters {
						if math.Abs(u-(s+shift)) > scaleBudget {
							continue
						}
						found = true
						want := p.FourPoints[j]
						want[0] += tau
						for c := range want {
							if math.Abs(q.FourPoints[m][c]-want[c]) > scaleBudget*base.Radius {
								t.Fatalf("%s %s at %g: %v, want %v", mode, id, s, q.FourPoints[m], want)
							}
						}
						matched++
						break
					}
					if !found && s+shift < 1-scaleBudget && (mode == "reference" || p.FourPoints[j][3] != 0) {
						t.Fatalf("%s %s: no translated point for parameter %g", mode, id, s)
					}
				}
			}
		}
		if matched < 100 {
			t.Fatalf("%s: only %d translated points compared", mode, matched)
		}
	}
}

// The missing radius is a fixed fraction of the support for a fixed height,
// because the slab half-thickness is compared with the height, not with the
// support. Scaling L scales the missing radius and its guides about the center.
// Scaling the height A scales every lifted fourth coordinate.
func TestLiftScalesWithSupportAndHeight(t *testing.T) {
	center := Vec3{} // a center that does not scale would round the guide offsets
	q := func(mode string, support, height float64) Request {
		return Request{Object: "lift", Mode: mode, Samples: 16, Lift: &LiftParameters{Center: center, Support: support, Height: height,
			From: Vec3{}, To: Vec3{}, RadiusFrom: .5, RadiusTo: .5}}
	}
	base := liftResult(t, q("reference", 1, 1.5))
	for _, lambda := range []float64{.0625, .3, 3, 16} {
		got := liftResult(t, q("reference", lambda, 1.5))
		within(t, "missing radius", got.Lift.MissingRadius, lambda*base.Lift.MissingRadius, lambda, got.Radius)
		for k := 0; k < 3; k++ {
			id := fmt.Sprintf("lift/missing-guide/%d", k)
			var from, to Path
			for _, p := range base.Paths {
				if p.Source == id {
					from = p
				}
			}
			for _, p := range got.Paths {
				if p.Source == id {
					to = p
				}
			}
			if len(from.Points) == 0 || len(from.Points) != len(to.Points) {
				t.Fatal(id, "missing or resampled")
			}
			for j := range from.Points {
				for c := 0; c < 3; c++ {
					within(t, id, to.Points[j][c]-center[c], lambda*(from.Points[j][c]-center[c]), lambda, got.Radius)
				}
			}
		}
	}
	base = liftResult(t, q("lifted", 1.2, 2))
	for _, lambda := range []float64{.25, .3, 4, 5} {
		got := liftResult(t, q("lifted", 1.2, 2*lambda))
		compared := 0
		for _, p := range base.Paths {
			if p.Role != "lifted" && p.Role != "displacement" {
				continue
			}
			for _, g := range got.Paths {
				if g.Source != p.Source || g.Role != p.Role || (p.Role == "displacement" && g.Branch != p.Branch) {
					continue
				}
				for j, s := range p.Parameters {
					for m, u := range g.Parameters {
						if u != s || (p.Role == "displacement" && m != j) {
							continue
						}
						for c := 0; c < 3; c++ {
							if g.FourPoints[m][c] != p.FourPoints[j][c] {
								t.Fatalf("height scale %g moved %s in xyz", lambda, p.Source)
							}
						}
						within(t, p.Source+" lifted w", g.FourPoints[m][3], lambda*p.FourPoints[j][3], lambda, got.Radius)
						compared++
						break
					}
				}
			}
		}
		if compared < 100 {
			t.Fatalf("height scale %g: only %d lifted points compared", lambda, compared)
		}
	}
}

// A thread tangent to the missing ball from outside stays one present interval
// and a thread 10⁻⁸ inside it splits in two, for missing radii from 0.06 to 7.5
// and wherever the lift sits along the thread.
func TestLiftTangencyThresholdIsScaleRelative(t *testing.T) {
	for _, support := range []float64{.06, .5, 2, 8} {
		for _, x := range []float64{-1.7, .4, 2.2} {
			hole := 0.
			pieces := func(delta float64) []Path {
				q := Request{Object: "lift", Mode: "reference", Samples: 16, Lift: &LiftParameters{Support: support, Height: 1.5,
					RadiusFrom: .5, RadiusTo: .5}}
				hole = liftResult(t, q).Lift.MissingRadius
				q.Lift.Center = Vec3{x, -1 - hole*(1+delta), 0} // below thread 0 at y = -1, away from the others
				return sourcePaths(liftResult(t, q), "lift/thread/0")
			}
			for _, delta := range []float64{thresholdTogether, -thresholdTogether, 0, thresholdApart} {
				if p := pieces(delta); len(p) != 1 || p[0].Parameters[0] != 0 || p[0].Parameters[len(p[0].Parameters)-1] != 1 {
					t.Fatalf("support %g at x %g, distance (1%+g) × %g: the whole thread must stay present, got %d pieces", support, x, delta, hole, len(p))
				}
			}
			p := pieces(-thresholdApart)
			if len(p) != 2 {
				t.Fatalf("support %g at x %g: a thread just inside the missing ball must split, got %d pieces", support, x, len(p))
			}
			gap := p[1].FourPoints[0][0] - p[0].FourPoints[len(p[0].FourPoints)-1][0]
			if want := 2 * hole * math.Sqrt(1-(1-thresholdApart)*(1-thresholdApart)); math.Abs(gap/want-1) > 1e-6 {
				t.Fatalf("support %g at x %g: missing chord %g, want %g", support, x, gap, want)
			}
		}
	}
}
