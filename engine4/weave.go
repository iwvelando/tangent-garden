package engine4

import (
	"fmt"
	"math"
)

// Clifford tori and Hopf fibers on the unit 3-sphere, projected
// stereographically from (0,0,0,1) through a fixed window |P| ≤ C.
//
// Every source curve is a circle q(t) = c + a cos t + b sin t in R⁴, so after
// the linear 4D rotation q_w(t) = c_w + ρ cos(t − φ) and the window q_w ≤ k,
// k = (C²−1)/(C²+1), is decided analytically before sampling.

// Window crossings within weaveTolerance in q_w of a tangency coalesce into
// it, and latitudes within it of 0 or π/2 snap to the collapsed endpoint.
// The source is the unit sphere, where coordinate rounding is about 10⁻¹⁶.
const weaveTolerance = 1e-12

type WeaveParameters struct {
	Family    string  `json:"family"` // "tori" or "fibers"
	Alpha     float64 `json:"alpha"`
	Spread    float64 `json:"spread"`
	AlphaFrom float64 `json:"alphaFrom"`
	AlphaTo   float64 `json:"alphaTo"`
	// Base sphere and fibers (mode "paired") only: the selected sample and
	// the moving point's offset from it, in turns.
	Selected int     `json:"selected,omitempty"`
	Trace    float64 `json:"trace,omitempty"`
}
type WeaveDiagnostics struct {
	Family          string  `json:"family"`
	Sources         int     `json:"sources"`
	CompleteCircles int     `json:"completeCircles"`
	RetainedArcs    int     `json:"retainedArcs"`
	Contacts        int     `json:"contacts"`
	AbsentSources   int     `json:"absentSources"`
	Collapsed       int     `json:"collapsed"`
	Window          float64 `json:"window"` // retained part: q_w ≤ Window
	Projection      string  `json:"projection"`
	// Present only for Base sphere and fibers.
	Correspondence *CorrespondenceDiagnostics `json:"correspondence,omitempty"`
}
type CorrespondenceDiagnostics struct {
	Fibers       int     `json:"fibers"`
	Selected     int     `json:"selected"`
	MovingSample int     `json:"movingSample"`
	Parameter    float64 `json:"parameter"`
	Base         Vec3    `json:"base"`
	Chart        string  `json:"chart"`
	Coincident   bool    `json:"coincident"`
}
type sphereCircle struct {
	id, role string
	family   int
	c, a, b  Vec4
}

func (s sphereCircle) at(t float64) Vec4 {
	sn, cs := math.Sincos(t)
	var v Vec4
	for i := range v {
		v[i] = s.c[i] + s.a[i]*cs + s.b[i]*sn
	}
	return v
}

// weaveLatitudes returns the ordered latitudes, snapping rounding-distance
// neighbors of the endpoints onto 0 and π/2.
func weaveLatitudes(alpha, spread float64, n int) []float64 {
	out := make([]float64, n)
	for k := range out {
		a := alpha
		if n > 1 {
			a += spread * (float64(k)/float64(n-1) - .5)
		}
		if a <= weaveTolerance {
			a = 0
		} else if a >= math.Pi/2-weaveTolerance {
			a = math.Pi / 2
		}
		out[k] = a
	}
	return out
}

func weaveSources(k int, alpha float64, family string, m int) []sphereCircle {
	id := fmt.Sprintf("weave/latitude/%d", k)
	// Every constant-u curve shrinks to a point and every constant-v curve or
	// fiber coincides with one circle: keep that circle once.
	if alpha == 0 {
		return []sphereCircle{{id: id + "/core", role: "collapsed", family: 2, a: Vec4{1, 0, 0, 0}, b: Vec4{0, 1, 0, 0}}}
	}
	if alpha == math.Pi/2 {
		return []sphereCircle{{id: id + "/core", role: "collapsed", family: 2, a: Vec4{0, 0, 1, 0}, b: Vec4{0, 0, 0, 1}}}
	}
	sa, ca := math.Sincos(alpha)
	out := []sphereCircle{}
	if family == "fibers" {
		// (e^{it} z1, e^{it} z2) with z1 = cos α e^{iδ}, z2 = sin α.
		for j := 0; j < m; j++ {
			s, c := math.Sincos(2 * math.Pi * float64(j) / float64(m))
			out = append(out, sphereCircle{id: fmt.Sprintf("%s/fiber/%d", id, j), role: "fiber",
				a: Vec4{ca * c, ca * s, sa, 0}, b: Vec4{-ca * s, ca * c, 0, sa}})
		}
		return out
	}
	// q(u,v,α) = (cos α cos u, cos α sin u, sin α cos v, sin α sin v).
	for j := 0; j < m; j++ {
		s, c := math.Sincos(2 * math.Pi * float64(j) / float64(m))
		out = append(out, sphereCircle{id: fmt.Sprintf("%s/fixed-u/%d", id, j), role: "fixed-u",
			c: Vec4{ca * c, ca * s, 0, 0}, a: Vec4{0, 0, sa, 0}, b: Vec4{0, 0, 0, sa}})
	}
	for j := 0; j < m; j++ {
		s, c := math.Sincos(2 * math.Pi * float64(j) / float64(m))
		out = append(out, sphereCircle{id: fmt.Sprintf("%s/fixed-v/%d", id, j), role: "fixed-v", family: 1,
			c: Vec4{0, 0, sa * c, sa * s}, a: Vec4{ca, 0, 0, 0}, b: Vec4{0, ca, 0, 0}})
	}
	return out
}

func weave(q Request, r Result) (Result, error) {
	if q.Mode == "paired" {
		return pairedWeave(q, r)
	}
	if q.Mode != "stereo" {
		return r, fieldErr("mode", "choose Stereographic loom or Base sphere and fibers for the spherical ring weave")
	}
	if q.Weave == nil {
		return r, fmt.Errorf("spherical weave parameters are required")
	}
	w := *q.Weave
	if w.Family != "tori" && w.Family != "fibers" {
		return r, fieldErr("weave.family", "Weave family must be Clifford tori or Hopf fibers")
	}
	for i, a := range q.Angles {
		if !finite(a) || math.Abs(a) > 1e6 {
			return r, fieldErr(fmt.Sprintf("angles.%d", i), "rotation angles must be finite and within ±1000000 radians")
		}
	}
	if q.Count < 1 || q.Count > 9 {
		return r, fieldErr("count", "use 1–9 latitudes")
	}
	if q.Curves < 1 || q.Curves > 16 {
		if w.Family == "fibers" {
			return r, fieldErr("curves", "use 1–16 fibers per latitude")
		}
		return r, fieldErr("curves", "use 1–16 curves per direction")
	}
	if q.Samples < 8 || q.Samples > 256 {
		return r, fieldErr("samples", "use 8–256 arc samples")
	}
	if !finite(q.Clip) || q.Clip < 2 || q.Clip > 12 {
		return r, fieldErr("clip", "stereographic window radius must be between 2 and 12")
	}
	half := 0. // A single latitude ignores spread.
	if q.Count > 1 {
		if !finite(w.Spread) || w.Spread < 0 || w.Spread > math.Pi/2+weaveTolerance {
			return r, fieldErr("weave.spread", "Latitude spread must be between 0 and π/2")
		}
		if w.Spread == 0 {
			return r, fieldErr("weave.spread", "Latitude spread must be positive when drawing more than one latitude")
		}
		half = w.Spread / 2
	}
	for _, field := range []struct {
		name, key string
		v         float64
	}{{"Central latitude α", "alpha", w.Alpha}, {"Latitude start", "alphaFrom", w.AlphaFrom}, {"Latitude end", "alphaTo", w.AlphaTo}} {
		if !finite(field.v) || field.v-half < -weaveTolerance || field.v+half > math.Pi/2+weaveTolerance {
			if q.Count > 1 {
				return r, fieldErr("weave."+field.key, "%s must keep every latitude within 0 and π/2 (α ± spread/2)", field.name)
			}
			return r, fieldErr("weave."+field.key, "%s must be between 0 and π/2", field.name)
		}
	}
	perLatitude := q.Curves
	if w.Family == "tori" {
		perLatitude *= 2
	}
	// Decided from the counts alone, so rotation and animation never change
	// whether a study is accepted.
	if q.Count*perLatitude*(q.Samples+2)+3*(q.Samples+1) > maxPoints {
		return r, fmt.Errorf("spherical weave exceeds budget: at most 65,536 points; reduce latitudes, curves or samples")
	}

	b := newWeaveBuilder(q, &r, w.Family)
	for i, alpha := range weaveLatitudes(w.Alpha, w.Spread, q.Count) {
		section := Section{ID: fmt.Sprintf("weave/latitude/%d", i), Kind: "torus", Level: alpha, Dimension: 2}
		if alpha == 0 || alpha == math.Pi/2 {
			section.Kind, section.Dimension = "circle", 1
			b.diag.Collapsed++
		}
		r.Sections = append(r.Sections, section)
		for _, s := range weaveSources(i, alpha, w.Family, q.Curves) {
			b.source(s, section.ID)
		}
	}
	b.window()
	return r, nil
}

// weaveBuilder rotates, classifies and samples source circles into one
// result, against the window k = (C²−1)/(C²+1).
type weaveBuilder struct {
	q    Request
	r    *Result
	diag *WeaveDiagnostics
	k    float64
	step float64
}

func newWeaveBuilder(q Request, r *Result, family string) *weaveBuilder {
	k := (q.Clip*q.Clip - 1) / (q.Clip*q.Clip + 1)
	r.Radius = q.Clip
	diag := &WeaveDiagnostics{Family: family, Window: k,
		Projection: "declared 4D rotation, then stereographic P(q) = q_xyz / (1 − q_w) within |P| ≤ C"}
	r.Weave = diag
	return &weaveBuilder{q: q, r: r, diag: diag, k: k, step: 2 * math.Pi / float64(q.Samples)}
}

func (b *weaveBuilder) emit(s sphereCircle, section string, ts []float64, closed bool) {
	path := Path{Source: s.id, SectionID: section, Branch: "0", Role: s.role, Family: s.family,
		Parameters: make([]float64, 0, len(ts)), FourPoints: make([]Vec4, 0, len(ts)), Points: make([]Vec3, 0, len(ts))}
	for i, t := range ts {
		v := s.at(t)
		b.r.Evaluations++
		if closed && i == len(ts)-1 {
			v = path.FourPoints[0] // identical endpoints close the circle exactly
		}
		den := 1 - v[3]
		path.Parameters = append(path.Parameters, t)
		path.FourPoints = append(path.FourPoints, v)
		path.Points = append(path.Points, Vec3{v[0] / den, v[1] / den, v[2] / den})
	}
	b.r.Paths = append(b.r.Paths, path)
}

// source rotates one unrotated source circle and keeps the part of it
// inside the window, decided analytically before sampling.
func (b *weaveBuilder) source(s sphereCircle, section string) {
	q, diag, k, step := b.q, b.diag, b.k, b.step
	s.c, s.a, s.b = rotate(s.c, q.Angles), rotate(s.a, q.Angles), rotate(s.b, q.Angles)
	diag.Sources++
	rho := math.Hypot(s.a[3], s.b[3])
	lo, hi := s.c[3]-rho, s.c[3]+rho
	phi := math.Atan2(s.b[3], s.a[3]) // q_w is largest at t = φ
	switch {
	case hi <= k+weaveTolerance:
		// The whole circle is retained, including an internal tangency.
		ts := make([]float64, q.Samples+1)
		for j := range ts {
			ts[j] = float64(j) * step
		}
		b.emit(s, section, ts, true)
		diag.CompleteCircles++
		return
	case lo > k+weaveTolerance:
		diag.AbsentSources++
	case lo >= k-weaveTolerance:
		// External tangency: only the lowest point meets the window.
		// A round-capped zero-length path keeps it visible.
		b.emit(s, section, []float64{phi + math.Pi, phi + math.Pi}, false)
		diag.Contacts++
	default:
		// Both crossings are at least √(2·10⁻¹²/ρ) from the maximum, so
		// acos is well conditioned here and no sliver arc remains.
		h := math.Acos(math.Max(-1, math.Min(1, (k-s.c[3])/rho)))
		t0, t1 := phi+h, phi+2*math.Pi-h
		ts := []float64{t0}
		for j := math.Floor(t0/step) + 1; j*step < t1-1e-12; j++ {
			if j*step-t0 > 1e-12 {
				ts = append(ts, j*step)
			}
		}
		if len(ts) == 1 {
			ts = append(ts, (t0+t1)/2)
		}
		b.emit(s, section, append(ts, t1), false)
		diag.RetainedArcs++
	}
	b.r.Clipped++
}

// window draws three great circles of the window sphere |P| = C.
func (b *weaveBuilder) window() {
	q, r := b.q, b.r
	for _, plane := range [][2]int{{0, 1}, {1, 2}, {2, 0}} {
		path := Path{Source: "weave/window/" + string("xyz"[plane[0]]) + string("xyz"[plane[1]]), Branch: "0", Role: "window", Guide: true, Family: 3,
			Points: make([]Vec3, 0, q.Samples+1)}
		for j := 0; j <= q.Samples; j++ {
			s, c := math.Sincos(float64(j%q.Samples) * b.step)
			var v Vec3
			v[plane[0]], v[plane[1]] = q.Clip*c, q.Clip*s
			path.Points = append(path.Points, v)
			r.Evaluations++
		}
		r.Paths = append(r.Paths, path)
	}
}

// The base sphere's framing radius: the unit sphere with a margin.
const baseFraming = 1.3

// hopfChart returns the fiber representative over p ∈ S² in one of two
// overlapping charts. North (p_z > −1) takes z₁ real and positive:
// z₁ = √((1+p_z)/2), z₂ = (p_x − i p_y)/(2z₁). South (p_z < 1) takes z₂
// real and positive: z₂ = √((1−p_z)/2), z₁ = (p_x + i p_y)/(2z₂). Either
// way z₁z̄₂ = (p_x + i p_y)/2 and |z₁|² − |z₂|² = p_z, so H(q) = p. Where
// both are defined, q_S = e^{iδ} q_N with δ = arg(p_x + i p_y): the same
// fiber, with its parameter t shifted by δ.
func hopfChart(p Vec3, north bool) Vec4 {
	if north {
		z1 := math.Sqrt((1 + p[2]) / 2)
		return Vec4{z1, 0, p[0] / (2 * z1), -p[1] / (2 * z1)}
	}
	z2 := math.Sqrt((1 - p[2]) / 2)
	return Vec4{p[0] / (2 * z2), p[1] / (2 * z2), z2, 0}
}

// hopfFiber returns the unit representative q of the Hopf fiber over p,
// whose fiber is e^{it}q = q cos t + iq sin t. It uses the north chart for
// p_z ≥ 0 and the south chart otherwise, so the chart's real coordinate is
// at least 1/√2 and neither pole divides by a small number.
func hopfFiber(p Vec3) (Vec4, string) {
	north := p[2] >= 0
	q := hopfChart(p, north)
	n := norm(q)
	for i := range q {
		q[i] /= n
	}
	if north {
		return q, "north"
	}
	return q, "south"
}

// fiberCircle is the great circle e^{it}q of S³ as a source circle.
func fiberCircle(id, role string, family int, q Vec4) sphereCircle {
	return sphereCircle{id: id, role: role, family: family, a: q, b: Vec4{-q[1], q[0], -q[3], q[2]}}
}

// latitudePoint is p(δ) = (sin 2α cos δ, sin 2α sin δ, cos 2α), with the
// exact pole at a collapsed latitude.
func latitudePoint(alpha, delta float64) Vec3 {
	if alpha == 0 {
		return Vec3{0, 0, 1}
	}
	if alpha == math.Pi/2 {
		return Vec3{0, 0, -1}
	}
	s2, c2 := math.Sincos(2 * alpha)
	s, c := math.Sincos(delta)
	return Vec3{s2 * c, s2 * s, c2}
}

// pairedWeavePoints counts a correspondence's points before evaluation:
// n sample fibers and the moving fiber, each at most samples + 2 points, the
// three window guides, then the base latitude, three globe guides and n + 1
// base markers.
func pairedWeavePoints(n, samples int) int {
	return (n+1)*(samples+2) + 3*(samples+1) + (samples + 1) + 3*(samples+1) + n + 1
}

// pairedWeave draws Base sphere and fibers: one latitude of S² with n
// evenly spaced base samples δ_j = 2πj/n, their Hopf fibers, and a moving
// point at δ = δ_selected + 2π·frac(trace) with its own fiber. One request
// produces both panes, so a frame never mixes a base point with another
// moment's fiber. The bouquet is the result; the base sphere its companion.
func pairedWeave(q Request, r Result) (Result, error) {
	if q.Weave == nil {
		return r, fmt.Errorf("spherical weave parameters are required")
	}
	w := *q.Weave
	for i, a := range q.Angles {
		if !finite(a) || math.Abs(a) > 1e6 {
			return r, fieldErr(fmt.Sprintf("angles.%d", i), "rotation angles must be finite and within ±1000000 radians")
		}
	}
	if q.Curves < 1 || q.Curves > 32 {
		return r, fieldErr("curves", "use 1–32 fibers on the latitude")
	}
	if q.Samples < 8 || q.Samples > 256 {
		return r, fieldErr("samples", "use 8–256 arc samples")
	}
	if !finite(q.Clip) || q.Clip < 2 || q.Clip > 12 {
		return r, fieldErr("clip", "stereographic window radius must be between 2 and 12")
	}
	for _, field := range []struct {
		name, key string
		v         float64
	}{{"Central latitude α", "alpha", w.Alpha}, {"Latitude start", "alphaFrom", w.AlphaFrom}, {"Latitude end", "alphaTo", w.AlphaTo}} {
		if !finite(field.v) || field.v < -weaveTolerance || field.v > math.Pi/2+weaveTolerance {
			return r, fieldErr("weave."+field.key, "%s must be between 0 and π/2", field.name)
		}
	}
	if w.Selected < 0 || w.Selected >= q.Curves {
		return r, fieldErr("weave.selected", "Selected fiber must be from 1 to %d, the number of fibers", q.Curves)
	}
	// Only playback sets the trace, so its error names no control.
	if !finite(w.Trace) || math.Abs(w.Trace) > 1e6 {
		return r, fmt.Errorf("the traced point's offset must be finite and within ±1000000 turns")
	}
	// The maximum counts stay well inside the ceiling; the check keeps it so
	// if they grow.
	if pairedWeavePoints(q.Curves, q.Samples) > maxPoints {
		return r, fmt.Errorf("base sphere and fibers exceeds budget: at most 65,536 points; reduce fibers or samples")
	}

	n, j := q.Curves, w.Selected
	alpha := weaveLatitudes(w.Alpha, 0, 1)[0]
	collapsed := alpha == 0 || alpha == math.Pi/2
	b := newWeaveBuilder(q, &r, "fibers")
	section := Section{ID: "weave/latitude/0", Kind: "torus", Level: alpha, Dimension: 2}
	if collapsed {
		section.Kind, section.Dimension = "circle", 1
		b.diag.Collapsed++
	}
	r.Sections = append(r.Sections, section)
	base := Result{Object: "weave", Operation: "base", Paths: []Path{}, Faces: []Face{}, Points: []Vec3{},
		Sections: []Section{section}, Radius: baseFraming}
	marker := func(id, role string, p Vec3) {
		rep, _ := hopfFiber(p)
		base.Markers = append(base.Markers, Marker{ID: id, Role: role, Point: p, FourPoint: rep})
		base.Evaluations++
	}

	// The moving point: frac(trace) of a turn past the selected sample. At
	// a whole number of turns it is that sample, drawn once.
	f := w.Trace - math.Floor(w.Trace)
	sampleDelta := func(i int) float64 { return 2 * math.Pi * float64(i) / float64(n) }
	delta := sampleDelta(j)
	if f != 0 {
		u := float64(j)/float64(n) + f
		if u >= 1 {
			u--
		}
		delta = 2 * math.Pi * u
	}
	moving := latitudePoint(alpha, delta)
	_, chart := hopfFiber(moving)
	c := &CorrespondenceDiagnostics{Fibers: n, Selected: j, MovingSample: -1, Parameter: delta, Base: moving,
		Chart: chart, Coincident: collapsed}
	if f == 0 || collapsed {
		c.MovingSample = j
	}
	b.diag.Correspondence = c
	// The base pane draws the same selection and moving point; its counts
	// belong to the bouquet.
	base.Weave = &WeaveDiagnostics{Family: "fibers", Correspondence: c,
		Projection: "the unit base sphere S², in an ordinary 3D view"}

	if collapsed {
		// Every fiber is one circle over the pole; the selection is kept in
		// the diagnostics.
		rep, _ := hopfFiber(moving)
		b.source(fiberCircle(section.ID+"/core", "collapsed", 2, rep), section.ID)
		marker(section.ID+"/base/core", "sample", moving)
	} else {
		for i := 0; i < n; i++ {
			p := latitudePoint(alpha, sampleDelta(i))
			rep, _ := hopfFiber(p)
			b.source(fiberCircle(fmt.Sprintf("%s/fiber/%d", section.ID, i), "fiber", 0, rep), section.ID)
			marker(fmt.Sprintf("%s/base/%d", section.ID, i), "sample", p)
		}
		if c.MovingSample < 0 {
			rep, _ := hopfFiber(moving)
			b.source(fiberCircle("weave/moving", "moving", 0, rep), section.ID)
			marker("weave/moving/base", "moving", moving)
		}
		// The latitude itself, closed exactly.
		curve := Path{Source: section.ID + "/base", SectionID: section.ID, Branch: "0", Role: "base-curve",
			Parameters: make([]float64, 0, q.Samples+1), Points: make([]Vec3, 0, q.Samples+1)}
		for i := 0; i <= q.Samples; i++ {
			t := float64(i) * b.step
			p := latitudePoint(alpha, t)
			if i == q.Samples {
				p = curve.Points[0]
			}
			curve.Parameters = append(curve.Parameters, t)
			curve.Points = append(curve.Points, p)
			base.Evaluations++
		}
		base.Paths = append(base.Paths, curve)
	}
	b.window()
	// Three great circles of the base sphere.
	for _, plane := range [][2]int{{0, 1}, {1, 2}, {2, 0}} {
		path := Path{Source: "weave/globe/" + string("xyz"[plane[0]]) + string("xyz"[plane[1]]), Branch: "0", Role: "globe", Guide: true, Family: 3,
			Points: make([]Vec3, 0, q.Samples+1)}
		for i := 0; i <= q.Samples; i++ {
			s, c := math.Sincos(float64(i%q.Samples) * b.step)
			var v Vec3
			v[plane[0]], v[plane[1]] = c, s
			path.Points = append(path.Points, v)
			base.Evaluations++
		}
		base.Paths = append(base.Paths, path)
	}
	r.Companion = &base
	return r, nil
}
