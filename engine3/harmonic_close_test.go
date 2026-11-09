package engine3

import (
	"errors"
	"fmt"
	"math"
	"reflect"
	"strings"
	"testing"
)

func closedUp(t *testing.T, c Request, parameter string) *HarmonicFit {
	t.Helper()
	f, err := CloseHarmonicSource(c, parameter)
	if err != nil {
		t.Fatalf("close: %v", err)
	}
	return f
}

// halfCircle runs once from (1,0,0) to (−1,0,0) at unit speed in a tilted
// plane; closing it adds the diameter, of length 2. warped traverses the same
// arc with t² as its angle, so only its own parameter differs.
var (
	halfCircle = expressionStudy("cos(t)", "0.6*sin(t)", "0.8*sin(t)", 0, math.Pi)
	warped     = expressionStudy("cos(t^2)", "0.6*sin(t^2)", "0.8*sin(t^2)", 0, math.Sqrt(math.Pi))
)

// The closed-up half circle as a function of the fit's parameter θ ∈ [0, 2π):
// the arc at angle φ(u) for u ≤ 1 and the diameter back to the start beyond,
// where u = (1 + 2/π)θ/2π gives the diameter the arc's mean pace.
func closedHalfCircle(theta float64, angle func(u float64) float64) Vec3 {
	u := (1 + 2/math.Pi) * theta / (2 * math.Pi)
	if u <= 1 {
		a := angle(u)
		return Vec3{math.Cos(a), 0.6 * math.Sin(a), 0.8 * math.Sin(a)}
	}
	return Vec3{-1 + 2*(u-1)/(2/math.Pi), 0, 0}
}

// fourierByQuadrature integrates a closed curve's coefficients by Simpson's
// rule on each smooth piece, split at its corners: c₀ and A_k, B_k for k ≤ n.
func fourierByQuadrature(curve func(float64) Vec3, corners []float64, n int) (Vec3, []Vec3, []Vec3) {
	cuts := append(append([]float64{0}, corners...), 2*math.Pi)
	integrate := func(f func(float64) Vec3) Vec3 {
		var sum Vec3
		for i := 1; i < len(cuts); i++ {
			a, b := cuts[i-1], cuts[i]
			const m = 20000
			h := (b - a) / m
			for j := 0; j <= m; j++ {
				w := 2.0
				if j == 0 || j == m {
					w = 1
				} else if j%2 == 1 {
					w = 4
				}
				sum = sum.add(f(a + h*float64(j)).mul(w * h / 3))
			}
		}
		return sum
	}
	center := integrate(curve).mul(1 / (2 * math.Pi))
	as, bs := make([]Vec3, n+1), make([]Vec3, n+1)
	for k := 1; k <= n; k++ {
		as[k] = integrate(func(th float64) Vec3 { return curve(th).mul(math.Cos(float64(k) * th)) }).mul(1 / math.Pi)
		bs[k] = integrate(func(th float64) Vec3 { return curve(th).mul(math.Sin(float64(k) * th)) }).mul(1 / math.Pi)
	}
	return center, as, bs
}

// Each sampling closes the half circle with its diameter at its own pace, and
// both are checked against the analytic closed-up curve, never the sampler:
// by its own parameter the warped arc keeps its t² timing, while even pace
// forgets it and agrees with the unit-speed arc.
func TestCloseHarmonicSourceMatchesTheAnalyticClosedUpCurve(t *testing.T) {
	seam := 2 * math.Pi / (1 + 2/math.Pi)
	even := func(u float64) float64 { return math.Pi * u }
	squared := func(u float64) float64 { return math.Pi * u * u }
	for _, c := range []struct {
		name      string
		source    Request
		parameter string
		angle     func(float64) float64
	}{
		{"half circle, own parameter", halfCircle, HarmonicFitSource, even},
		{"half circle, even pace", halfCircle, HarmonicFitArcLength, even},
		{"warped, own parameter", warped, HarmonicFitSource, squared},
		{"warped, even pace", warped, HarmonicFitArcLength, even},
	} {
		f := closedUp(t, c.source, c.parameter)
		center, as, bs := fourierByQuadrature(func(th float64) Vec3 { return closedHalfCircle(th, c.angle) }, []float64{seam}, 8)
		// Aliasing from frequencies near 1024 decays like 1/k²; even pace also
		// reads the outline polygon, within its tolerance of the arc.
		allowance := 2e-5
		if c.parameter == HarmonicFitArcLength {
			allowance += 2 * f.outline.Tolerance
		}
		if !fitNear(f.center, center, allowance) {
			t.Errorf("%s: center %+v, want %+v", c.name, f.center, center)
		}
		got := map[float64]HarmonicTerm{}
		for _, term := range f.terms {
			got[term.Frequency] = term
		}
		for k := 1; k <= 8; k++ {
			g := got[float64(k)]
			if !fitNear(g.Cosine, as[k], allowance) || !fitNear(g.Sine, bs[k], allowance) {
				t.Errorf("%s: frequency %d = %+v, want A %+v, B %+v", c.name, k, g, as[k], bs[k])
			}
		}
	}
}

// A unit-speed source is already at even pace, and the closing segment takes
// the same share of samples either way, so the two samplings agree.
func TestCloseHarmonicSourceSamplingsAgreeOnAUnitSpeedSource(t *testing.T) {
	helix := expressionStudy("2*cos(t)", "2*sin(t)", "t/3", -3*math.Pi, 3*math.Pi)
	own := selected(t, closedUp(t, helix, HarmonicFitSource), 8)
	arc := closedUp(t, helix, HarmonicFitArcLength)
	even := selected(t, arc, 8)
	tolerance := 4 * arc.outline.Tolerance
	for _, term := range own.Curve.Terms {
		e, ok := termAt(even, term.Frequency)
		if !ok || !fitNear(term.Cosine, e.Cosine, tolerance) || !fitNear(term.Sine, e.Sine, tolerance) {
			t.Errorf("frequency %g: own %+v, even %+v", term.Frequency, term, e)
		}
	}
}

// residuals are the fit's distances from its own samples.
func residuals(f *HarmonicFit, r HarmonicFitResult) []float64 {
	out := make([]float64, len(f.samples))
	for j, p := range f.samples {
		q, _, _, _ := r.Curve.evaluate(2 * math.Pi * float64(j) / float64(len(f.samples)))
		out[j] = q.sub(p).norm()
	}
	return out
}

// Closure makes two corners, not a jump: the error falls steadily with the
// terms, with no overshoot that stays, and is largest beside a corner.
func TestCloseHarmonicSourceErrorConcentratesAtTheCorners(t *testing.T) {
	f := closedUp(t, halfCircle, HarmonicFitSource)
	seam := 1024 / (1 + 2/math.Pi)
	previous := math.Inf(1)
	for _, count := range []int{2, 4, 8} {
		r := selected(t, f, count)
		if r.MaxResidual > previous*0.67 {
			t.Errorf("%d terms: largest error %g after %g; a corner's error should fall like 1/N", count, r.MaxResidual, previous)
		}
		previous = r.MaxResidual
		worst := 0
		for j, e := range residuals(f, r) {
			if e > residuals(f, r)[worst] {
				worst = j
			}
		}
		near := func(at float64) bool {
			d := math.Abs(float64(worst) - at)
			return math.Min(d, 1024-d) <= 8
		}
		if !near(0) && !near(seam) {
			t.Errorf("%d terms: largest error at sample %d, away from the corners at 0 and %.0f", count, worst, seam)
		}
	}
}

// onDiameter counts the samples on the closing diameter, which alone have
// y = z = 0, apart from the start itself.
func onDiameter(samples []Vec3) int {
	n := 0
	for j, p := range samples {
		if j > 0 && math.Abs(p.Y) <= 1e-12 && math.Abs(p.Z) <= 1e-12 {
			n++
		}
	}
	return n
}

// Both samplings start at the source's start, run in its direction and give
// the segment its share of the closed length.
func TestCloseHarmonicSourceKeepsStartDirectionAndShare(t *testing.T) {
	for _, parameter := range []string{HarmonicFitSource, HarmonicFitArcLength} {
		f := closedUp(t, warped, parameter)
		if !fitNear(f.samples[0], Vec3{1, 0, 0}, 1e-15) {
			t.Errorf("%s: starts at %+v", parameter, f.samples[0])
		}
		if f.samples[1].Y <= 0 || f.samples[1].X >= 1 {
			t.Errorf("%s: runs from the start toward %+v, against the source", parameter, f.samples[1])
		}
		share := 1024 * 2 / (math.Pi + 2)
		if got := float64(onDiameter(f.samples)); math.Abs(got-share) > 1 {
			t.Errorf("%s: %g samples on the segment, want its share %.2f", parameter, got, share)
		}
		r := selected(t, f, 8)
		if math.Abs(r.Joined-2) > 1e-12 {
			t.Errorf("%s: joined by %g, want the diameter 2", parameter, r.Joined)
		}
	}
}

// Closing a closed source changes nothing, and an open source waits for it,
// refused with the outline it will be closed from.
func TestCloseHarmonicSourceOnlyEverAddsTheSegment(t *testing.T) {
	for _, parameter := range []string{HarmonicFitSource, HarmonicFitArcLength} {
		knot := torusStudy(2, 3, 2, 0.75)
		a, b := fitted(t, knot, parameter), closedUp(t, knot, parameter)
		if !reflect.DeepEqual(selected(t, a, 8), selected(t, b, 8)) || !reflect.DeepEqual(a.outline, b.outline) {
			t.Errorf("%s: closing a closed source changed its fit", parameter)
		}
		if b.outline.Open || b.outline.Closing != 0 || selected(t, b, 8).Joined != 0 {
			t.Errorf("%s: a closed source reports a closure", parameter)
		}

		helix := expressionStudy("2*cos(t)", "2*sin(t)", "t/3", -3*math.Pi, 3*math.Pi)
		_, err := FitHarmonicSource(helix, parameter)
		var open *HarmonicOpenError
		if !errors.As(err, &open) || !strings.Contains(err.Error(), "open") {
			t.Fatalf("%s: an open source returned %v", parameter, err)
		}
		if !open.Outline.Open || open.Outline.Closing != 0 {
			t.Errorf("%s: the open outline reads %+v", parameter, open.Outline)
		}
		first, last := open.Outline.Points[0], open.Outline.Points[len(open.Outline.Points)-1]
		if !fitNear(first, Vec3{-2, 0, -math.Pi}, 1e-12) || !fitNear(last, Vec3{-2, 0, math.Pi}, 1e-12) {
			t.Errorf("%s: open outline runs %+v to %+v", parameter, first, last)
		}
		f := closedUp(t, helix, parameter)
		points := f.outline.Points
		if !f.outline.Open || f.outline.Closing != len(points)-2 {
			t.Errorf("%s: closing at %d of %d points", parameter, f.outline.Closing, len(points))
		}
		if !reflect.DeepEqual(points[:len(points)-1], open.Outline.Points) || points[len(points)-1] != points[0] {
			t.Errorf("%s: the closed-up outline is not the open one plus its first point", parameter)
		}
		r := selected(t, f, 8)
		if math.Abs(r.Joined-2*math.Pi) > 1e-12 || math.Abs(r.Length-open.Outline.Length-r.Joined) > 1e-9 {
			t.Errorf("%s: joined %g, length %g from %g", parameter, r.Joined, r.Length, open.Outline.Length)
		}
	}
}

// The segment costs no evaluation: by its own parameter only the samples on
// the source are evaluated, one each.
func TestCloseHarmonicSourceEvaluatesOnlyTheSource(t *testing.T) {
	arc := closedUp(t, halfCircle, HarmonicFitArcLength)
	own := closedUp(t, halfCircle, HarmonicFitSource)
	onSource := HarmonicFitSamples - onDiameter(own.samples)
	if got := own.outline.Evaluations - arc.outline.Evaluations; got != onSource {
		t.Errorf("source parameter evaluated %d samples, want the %d on the source", got, onSource)
	}
	if len(arc.outline.Points) > HarmonicFitMaxPoints || own.outline.Evaluations > HarmonicFitMaxEvaluations {
		t.Errorf("%d points, %d evaluations", len(arc.outline.Points), own.outline.Evaluations)
	}
}

// The closed-up outline keeps the 4,096-point limit with its added point: an
// open source's refinement leaves room for it. Bisecting a local wiggle's
// width finds the widest source still admitted, wherever rounding puts it,
// which is the one that fills the limit.
func TestCloseHarmonicSourceKeepsThePointLimit(t *testing.T) {
	coil := func(w float64) Request {
		return expressionStudy("2*cos(t)", "2*sin(t)", fmt.Sprintf("t/40+0.05*sin(90*t)*exp(-((t-30)/%v)^2)", w), 0, 60)
	}
	lo, hi := 2.0, 2.5
	if _, err := CloseHarmonicSource(coil(lo), HarmonicFitArcLength); err != nil {
		t.Fatalf("the narrow wiggle is refused: %v", err)
	}
	if _, err := CloseHarmonicSource(coil(hi), HarmonicFitArcLength); err == nil || !strings.Contains(err.Error(), "4096") {
		t.Fatalf("the wide wiggle is not refused at the limit: %v", err)
	}
	for range 40 {
		mid := (lo + hi) / 2
		if _, err := CloseHarmonicSource(coil(mid), HarmonicFitArcLength); err == nil {
			lo = mid
		} else {
			hi = mid
		}
	}
	f := closedUp(t, coil(lo), HarmonicFitArcLength)
	if n := len(f.outline.Points); n > HarmonicFitMaxPoints || n < HarmonicFitMaxPoints-8 {
		t.Errorf("the widest admitted wiggle closes up with %d points, want up to %d", n, HarmonicFitMaxPoints)
	}
}

// Even pace's bound holds against the closed-up polygon, segment included.
func TestCloseHarmonicSourceBetweenSampleBound(t *testing.T) {
	for _, source := range []Request{halfCircle, expressionStudy("2*cos(t)", "2*sin(t)", "t/3", -3*math.Pi, 3*math.Pi)} {
		f := closedUp(t, source, HarmonicFitArcLength)
		path := f.outline.Points
		lengths := make([]float64, len(path))
		for j := 1; j < len(path); j++ {
			lengths[j] = lengths[j-1] + path[j].sub(path[j-1]).norm()
		}
		total := lengths[len(path)-1]
		for _, count := range []int{1, 4, 8} {
			r := selected(t, f, count)
			worst, edge := 0.0, 0
			const dense = 65536
			for j := 0; j < dense; j++ {
				s := total * float64(j) / dense
				for edge+1 < len(path)-1 && lengths[edge+1] <= s {
					edge++
				}
				u := (s - lengths[edge]) / (lengths[edge+1] - lengths[edge])
				on := path[edge].add(path[edge+1].sub(path[edge]).mul(u))
				p, _, _, _ := r.Curve.evaluate(2 * math.Pi * float64(j) / dense)
				worst = math.Max(worst, p.sub(on).norm())
			}
			if worst > r.ContinuousBound || r.ContinuousBound == 0 {
				t.Errorf("count %d: dense error %g, bound %g", count, worst, r.ContinuousBound)
			}
		}
	}
}
