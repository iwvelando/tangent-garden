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
// neighbours of the endpoints onto 0 and π/2.
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
	if q.Mode != "stereo" {
		return r, fieldErr("mode", "choose Stereographic loom for the spherical ring weave")
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

	k := (q.Clip*q.Clip - 1) / (q.Clip*q.Clip + 1)
	r.Radius = q.Clip
	diag := &WeaveDiagnostics{Family: w.Family, Window: k,
		Projection: "declared 4D rotation, then stereographic P(q) = q_xyz / (1 − q_w) within |P| ≤ C"}
	r.Weave = diag
	step := 2 * math.Pi / float64(q.Samples)
	emit := func(s sphereCircle, section string, ts []float64, closed bool) {
		path := Path{Source: s.id, SectionID: section, Branch: "0", Role: s.role, Family: s.family,
			Parameters: make([]float64, 0, len(ts)), FourPoints: make([]Vec4, 0, len(ts)), Points: make([]Vec3, 0, len(ts))}
		for i, t := range ts {
			v := s.at(t)
			r.Evaluations++
			if closed && i == len(ts)-1 {
				v = path.FourPoints[0] // identical endpoints close the circle exactly
			}
			den := 1 - v[3]
			path.Parameters = append(path.Parameters, t)
			path.FourPoints = append(path.FourPoints, v)
			path.Points = append(path.Points, Vec3{v[0] / den, v[1] / den, v[2] / den})
		}
		r.Paths = append(r.Paths, path)
	}
	for i, alpha := range weaveLatitudes(w.Alpha, w.Spread, q.Count) {
		section := Section{ID: fmt.Sprintf("weave/latitude/%d", i), Kind: "torus", Level: alpha, Dimension: 2}
		if alpha == 0 || alpha == math.Pi/2 {
			section.Kind, section.Dimension = "circle", 1
			diag.Collapsed++
		}
		r.Sections = append(r.Sections, section)
		for _, s := range weaveSources(i, alpha, w.Family, q.Curves) {
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
				emit(s, section.ID, ts, true)
				diag.CompleteCircles++
				continue
			case lo > k+weaveTolerance:
				diag.AbsentSources++
			case lo >= k-weaveTolerance:
				// External tangency: only the lowest point meets the window.
				// A round-capped zero-length path keeps it visible.
				emit(s, section.ID, []float64{phi + math.Pi, phi + math.Pi}, false)
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
				emit(s, section.ID, append(ts, t1), false)
				diag.RetainedArcs++
			}
			r.Clipped++
		}
	}
	// Three great circles of the window sphere |P| = C.
	for _, plane := range [][2]int{{0, 1}, {1, 2}, {2, 0}} {
		path := Path{Source: "weave/window/" + string("xyz"[plane[0]]) + string("xyz"[plane[1]]), Branch: "0", Role: "window", Guide: true, Family: 3,
			Points: make([]Vec3, 0, q.Samples+1)}
		for j := 0; j <= q.Samples; j++ {
			s, c := math.Sincos(float64(j%q.Samples) * step)
			var v Vec3
			v[plane[0]], v[plane[1]] = q.Clip*c, q.Clip*s
			path.Points = append(path.Points, v)
			r.Evaluations++
		}
		r.Paths = append(r.Paths, path)
	}
	return r, nil
}
