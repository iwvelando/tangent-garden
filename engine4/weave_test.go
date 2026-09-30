package engine4

import (
	"math"
	"strings"
	"testing"
)

func weaveRequest(family string, count, curves int, alpha, spread float64) Request {
	return Request{Object: "weave", Mode: "stereo", Count: count, Curves: curves, Samples: 64, Clip: 12,
		Weave: &WeaveParameters{Family: family, Alpha: alpha, Spread: spread, AlphaFrom: alpha, AlphaTo: alpha}}
}

func weaveCompute(t *testing.T, q Request) Result {
	t.Helper()
	r, err := Compute(q)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

// Independent observations: these helpers use the definitions in the
// roadmap and elementary geometry, never the engine's circle vectors.
func norm4(q Vec4) float64 { return math.Sqrt(q[0]*q[0] + q[1]*q[1] + q[2]*q[2] + q[3]*q[3]) }
func inverseStereo(p Vec3) Vec4 {
	s := p[0]*p[0] + p[1]*p[1] + p[2]*p[2]
	return Vec4{2 * p[0] / (s + 1), 2 * p[1] / (s + 1), 2 * p[2] / (s + 1), (s - 1) / (s + 1)}
}
func hopfMap(q Vec4) Vec3 {
	// z1 = x+iy, z2 = z+iw: H = (2 Re z1 z̄2, 2 Im z1 z̄2, |z1|²−|z2|²).
	return Vec3{2 * (q[0]*q[2] + q[1]*q[3]), 2 * (q[1]*q[2] - q[0]*q[3]), q[0]*q[0] + q[1]*q[1] - q[2]*q[2] - q[3]*q[3]}
}
func undoRotation(v Vec4, angles [6]float64) Vec4 {
	pairs := [6][2]int{{0, 1}, {0, 2}, {1, 2}, {0, 3}, {1, 3}, {2, 3}}
	for k := 5; k >= 0; k-- {
		i, j := pairs[k][0], pairs[k][1]
		c, s := math.Cos(angles[k]), math.Sin(angles[k])
		v[i], v[j] = c*v[i]+s*v[j], -s*v[i]+c*v[j]
	}
	return v
}
func windowLevel(c float64) float64 { return (c*c - 1) / (c*c + 1) }
func weaveLevel(q Request, k int) float64 {
	if q.Count == 1 {
		return q.Weave.Alpha
	}
	return q.Weave.Alpha + q.Weave.Spread*(float64(k)/float64(q.Count-1)-.5)
}
func closedPath(p Path) bool { return len(p.Points) > 2 && p.Points[0] == p.Points[len(p.Points)-1] }

// circle4 returns the circumcircle of three points of R⁴ as a centre, radius
// and orthonormal plane basis starting at a.
func circle4(a, b, c Vec4) (Vec4, float64, Vec4, Vec4) {
	var u, v Vec4
	for i := range u {
		u[i], v[i] = b[i]-a[i], c[i]-a[i]
	}
	d4 := func(x, y Vec4) float64 { return x[0]*y[0] + x[1]*y[1] + x[2]*y[2] + x[3]*y[3] }
	uu, uv, vv := d4(u, u), d4(u, v), d4(v, v)
	det := uu*vv - uv*uv
	s := (uu*vv - uv*vv) / (2 * det)
	t := (vv*uu - uv*uu) / (2 * det)
	var center, e1, e2 Vec4
	for i := range center {
		center[i] = a[i] + s*u[i] + t*v[i]
		e1[i] = a[i] - center[i]
	}
	radius := norm4(e1)
	for i := range e1 {
		e1[i] /= radius
		e2[i] = b[i] - center[i]
	}
	k := d4(e2, e1)
	for i := range e2 {
		e2[i] -= k * e1[i]
	}
	l := norm4(e2)
	for i := range e2 {
		e2[i] /= l
	}
	return center, radius, e1, e2
}

// circle3 returns the circumcentre and radius of three points of R³.
func circle3(a, b, c Vec3) (Vec3, float64) {
	u, v := sub(b, a), sub(c, a)
	uu, uv, vv := dot(u, u), dot(u, v), dot(v, v)
	det := uu*vv - uv*uv
	s := (uu*vv - uv*vv) / (2 * det)
	t := (vv*uu - uv*uu) / (2 * det)
	center := Vec3{a[0] + s*u[0] + t*v[0], a[1] + s*u[1] + t*v[1], a[2] + s*u[2] + t*v[2]}
	d := sub(a, center)
	return center, math.Sqrt(dot(d, d))
}

// A midpoint double sum of the Gauss integral for two closed polylines.
func linkingNumber(a, b []Vec3) float64 {
	sum := 0.
	for i := 0; i+1 < len(a); i++ {
		da := sub(a[i+1], a[i])
		ma := Vec3{(a[i][0] + a[i+1][0]) / 2, (a[i][1] + a[i+1][1]) / 2, (a[i][2] + a[i+1][2]) / 2}
		for j := 0; j+1 < len(b); j++ {
			db := sub(b[j+1], b[j])
			mb := Vec3{(b[j][0] + b[j+1][0]) / 2, (b[j][1] + b[j+1][1]) / 2, (b[j][2] + b[j+1][2]) / 2}
			r := sub(ma, mb)
			l := math.Sqrt(dot(r, r))
			sum += dot(r, cross(da, db)) / (l * l * l)
		}
	}
	return sum / (4 * math.Pi)
}

func weavePaths(r Result, role string) []Path {
	out := []Path{}
	for _, p := range r.Paths {
		if p.Role == role {
			out = append(out, p)
		}
	}
	return out
}

func TestWeaveCliffordTorusIdentities(t *testing.T) {
	q := weaveRequest("tori", 3, 4, math.Pi/4, .6)
	r := weaveCompute(t, q)
	if r.Object != "weave" || r.Operation != "stereo" || r.Radius != 12 {
		t.Fatalf("object %q operation %q framing %v", r.Object, r.Operation, r.Radius)
	}
	if len(r.Sections) != 3 || r.Weave == nil || r.Weave.Sources != 24 || r.Weave.CompleteCircles != 24 || r.Clipped != 0 {
		t.Fatalf("sections %+v diagnostics %+v clipped %d", r.Sections, r.Weave, r.Clipped)
	}
	seen := map[string]bool{}
	for k := 0; k < 3; k++ {
		alpha := weaveLevel(q, k)
		s := r.Sections[k]
		if s.ID != "weave/latitude/"+string(rune('0'+k)) || s.Kind != "torus" || s.Dimension != 2 || math.Abs(s.Level-alpha) > 1e-15 {
			t.Fatalf("latitude %d: %+v, want α %v", k, s, alpha)
		}
	}
	for _, role := range []string{"fixed-u", "fixed-v"} {
		paths := weavePaths(r, role)
		if len(paths) != 12 {
			t.Fatalf("%s: %d paths", role, len(paths))
		}
		for _, p := range paths {
			if seen[p.Source] || p.Branch != "0" || !closedPath(p) || len(p.Points) != 65 || len(p.FourPoints) != 65 || len(p.Parameters) != 65 {
				t.Fatalf("%s: duplicate, open or wrongly sampled path %+v", p.Source, p.Points[:2])
			}
			seen[p.Source] = true
			k := int(p.SectionID[len(p.SectionID)-1] - '0')
			alpha := weaveLevel(q, k)
			j := int(p.Source[len(p.Source)-1] - '0')
			fixed := 2 * math.Pi * float64(j) / 4
			for i, v := range p.FourPoints {
				if math.Abs(norm4(v)-1) > 1e-14 {
					t.Fatalf("%s point %d is off S³: |q| = %.17g", p.Source, i, norm4(v))
				}
				// Clifford torus: |(x,y)| = cos α, |(z,w)| = sin α.
				if math.Abs(math.Hypot(v[0], v[1])-math.Cos(alpha)) > 1e-14 || math.Abs(math.Hypot(v[2], v[3])-math.Sin(alpha)) > 1e-14 {
					t.Fatalf("%s point %d is off the torus α = %v: %v", p.Source, i, alpha, v)
				}
				// The fixed angle is fixed along the whole circle.
				a, b := v[0], v[1]
				if role == "fixed-v" {
					a, b = v[2], v[3]
				}
				if d := math.Abs(math.Remainder(math.Atan2(b, a)-fixed, 2*math.Pi)); d > 1e-13 {
					t.Fatalf("%s point %d: fixed angle %v, want %v", p.Source, i, math.Atan2(b, a), fixed)
				}
				w := inverseStereo(p.Points[i])
				for c := range w {
					if math.Abs(w[c]-v[c]) > 1e-13 {
						t.Fatalf("%s point %d: inverse stereographic %v, want %v", p.Source, i, w, v)
					}
				}
			}
		}
	}
	window := weavePaths(r, "window")
	if len(window) != 3 {
		t.Fatalf("%d window guides", len(window))
	}
	for _, p := range window {
		if !p.Guide || p.SectionID != "" || !closedPath(p) {
			t.Fatalf("window guide %s: %+v", p.Source, p)
		}
		for _, v := range p.Points {
			if math.Abs(math.Sqrt(dot(v, v))-12) > 1e-12 {
				t.Fatalf("window guide %s leaves |P| = C: %v", p.Source, v)
			}
		}
	}
}

func TestWeaveHopfFibers(t *testing.T) {
	q := weaveRequest("fibers", 3, 5, math.Pi/4, 1)
	r := weaveCompute(t, q)
	fibers := weavePaths(r, "fiber")
	if len(fibers) != 15 || r.Weave.Family != "fibers" || r.Weave.Sources != 15 {
		t.Fatalf("%d fibers, diagnostics %+v", len(fibers), r.Weave)
	}
	for _, p := range fibers {
		k := int(p.SectionID[len(p.SectionID)-1] - '0')
		j := int(p.Source[len(p.Source)-1] - '0')
		alpha, delta := weaveLevel(q, k), 2*math.Pi*float64(j)/5
		want := Vec3{math.Sin(2*alpha) * math.Cos(delta), math.Sin(2*alpha) * math.Sin(delta), math.Cos(2 * alpha)}
		for i, v := range p.FourPoints {
			if math.Abs(norm4(v)-1) > 1e-14 {
				t.Fatalf("%s point %d is off S³", p.Source, i)
			}
			h := hopfMap(v)
			if math.Abs(math.Sqrt(dot(h, h))-1) > 1e-14 {
				t.Fatalf("%s point %d: |H| = %v", p.Source, i, math.Sqrt(dot(h, h)))
			}
			if d := sub(h, want); math.Sqrt(dot(d, d)) > 1e-14 {
				t.Fatalf("%s point %d: H = %v, want the fiber's base point %v", p.Source, i, h, want)
			}
		}
	}
}

func TestWeaveRotationActsOnTheWholeSphere(t *testing.T) {
	q := weaveRequest("fibers", 2, 3, .6, .5)
	q.Angles = [6]float64{.3, -.2, .7, 1.1, -.4, .9}
	q.Clip = 3
	r := weaveCompute(t, q)
	k := windowLevel(q.Clip)
	for _, p := range weavePaths(r, "fiber") {
		var base Vec3
		for i, v := range p.FourPoints {
			if math.Abs(norm4(v)-1) > 1e-14 {
				t.Fatalf("%s point %d is off S³ after rotation", p.Source, i)
			}
			if v[3] > k+1e-12 {
				t.Fatalf("%s point %d lies beyond the window: w = %v > %v", p.Source, i, v[3], k)
			}
			w := inverseStereo(p.Points[i])
			for c := range w {
				if math.Abs(w[c]-v[c]) > 1e-12 {
					t.Fatalf("%s point %d: inverse stereographic %v, want %v", p.Source, i, w, v)
				}
			}
			// Undoing the declared rotation recovers one Hopf fiber.
			h := hopfMap(undoRotation(v, q.Angles))
			if i == 0 {
				base = h
			} else if d := sub(h, base); math.Sqrt(dot(d, d)) > 1e-13 {
				t.Fatalf("%s point %d leaves its unrotated fiber: %v vs %v", p.Source, i, h, base)
			}
		}
	}
}

// The window keeps q_w ≤ k. Reconstruct each source circle from three returned
// points and check that the omitted arc lies beyond the window, while every
// retained point lies within it and open ends lie on the window sphere.
func TestWeaveClipsExactlyAtTheWindow(t *testing.T) {
	for _, family := range []string{"tori", "fibers"} {
		for _, angles := range [][6]float64{{}, {.2, .5, -.3, .8, .6, -.7}, {0, 0, 0, 1.3, 0, 0}, {1, 2, 3, 4, 5, 6}} {
			q := weaveRequest(family, 4, 3, .8, 1.2)
			q.Angles, q.Clip = angles, 2.5
			r := weaveCompute(t, q)
			k := windowLevel(q.Clip)
			sources := map[string]bool{}
			open := 0
			for _, p := range r.Paths {
				if p.Guide {
					continue
				}
				if sources[p.Source] {
					t.Fatalf("%s: a source circle has more than one retained arc", p.Source)
				}
				sources[p.Source] = true
				for i, v := range p.Points {
					if l := math.Sqrt(dot(v, v)); l > q.Clip*(1+1e-12) {
						t.Fatalf("%s point %d: |P| = %v beyond window %v", p.Source, i, l, q.Clip)
					}
				}
				if closedPath(p) || p.Points[0] == p.Points[1] {
					continue
				}
				open++
				for _, v := range []Vec3{p.Points[0], p.Points[len(p.Points)-1]} {
					if math.Abs(math.Sqrt(dot(v, v))-q.Clip) > 1e-10 {
						t.Fatalf("%s: open end at |P| = %v, not on the window %v", p.Source, math.Sqrt(dot(v, v)), q.Clip)
					}
				}
				n := len(p.FourPoints)
				center, radius, e1, e2 := circle4(p.FourPoints[0], p.FourPoints[n/2], p.FourPoints[n-1])
				angle := func(v Vec4) float64 {
					var d Vec4
					for i := range d {
						d[i] = v[i] - center[i]
					}
					return math.Atan2(d[0]*e2[0]+d[1]*e2[1]+d[2]*e2[2]+d[3]*e2[3], d[0]*e1[0]+d[1]*e1[1]+d[2]*e1[2]+d[3]*e1[3])
				}
				// Unwrap the retained arc's angle through its samples.
				span := 0.
				for i := 1; i < n; i++ {
					span += math.Remainder(angle(p.FourPoints[i])-angle(p.FourPoints[i-1]), 2*math.Pi)
				}
				gap := 2*math.Pi - math.Abs(span)
				if gap <= 0 {
					t.Fatalf("%s: open arc spans the whole circle", p.Source)
				}
				for j := 1; j < 64; j++ {
					theta := span + math.Copysign(gap*float64(j)/64, span)
					w := center[3] + radius*(math.Cos(theta)*e1[3]+math.Sin(theta)*e2[3])
					if w < k-1e-9 {
						t.Fatalf("%s: omitted point at w = %v lies inside the window w ≤ %v", p.Source, w, k)
					}
				}
			}
			if r.Weave.Sources != len(sources)+r.Weave.AbsentSources || r.Clipped != open+r.Weave.AbsentSources+r.Weave.Contacts || r.Weave.RetainedArcs != open {
				t.Fatalf("%s %v: diagnostics %+v clipped %d, observed %d sources and %d open arcs", family, angles, r.Weave, r.Clipped, len(sources), open)
			}
		}
	}
}

// The zw circle passes through the pole at t = π/2. With nine subdivisions
// both neighbouring samples lie inside a radius-12 window, so a sampled chord
// would bridge the pole. The clipped image is a segment of the z-axis.
func TestWeavePoleBetweenSamples(t *testing.T) {
	q := weaveRequest("fibers", 1, 4, math.Pi/2, 0)
	q.Samples = 9
	r := weaveCompute(t, q)
	k := windowLevel(q.Clip)
	if math.Sin(2*math.Pi*2/9) > k || math.Sin(2*math.Pi*3/9) > k {
		t.Fatal("fixture no longer puts both neighbouring samples inside the window")
	}
	var arcs []Path
	for _, p := range r.Paths {
		if !p.Guide {
			arcs = append(arcs, p)
		}
	}
	if len(arcs) != 1 || arcs[0].Role != "collapsed" || r.Sections[0].Kind != "circle" || r.Weave.Collapsed != 1 {
		t.Fatalf("four duplicate endpoint fibers must merge to one collapsed circle: %d paths, %+v", len(arcs), r.Sections)
	}
	p := arcs[0]
	lo, hi := p.Parameters[0], p.Parameters[len(p.Parameters)-1]
	if !(lo > math.Pi/2 && hi < math.Pi/2+2*math.Pi) {
		t.Fatalf("retained parameters [%v, %v] include the pole", lo, hi)
	}
	for i, v := range p.Points {
		if math.Abs(v[0]) > 1e-15 || math.Abs(v[1]) > 1e-15 || math.Abs(v[2]) > 12*(1+1e-12) {
			t.Fatalf("point %d: %v is not on the z-axis segment within the window", i, v)
		}
	}
	for _, v := range []Vec3{p.Points[0], p.Points[len(p.Points)-1]} {
		if math.Abs(math.Abs(v[2])-12) > 1e-10 {
			t.Fatalf("open end %v is not on the window", v)
		}
	}
	if p.Points[0][2]*p.Points[len(p.Points)-1][2] >= 0 {
		t.Fatal("the segment must run between both window crossings, through the origin")
	}
	if r.Clipped != 1 || r.Weave.RetainedArcs != 1 {
		t.Fatalf("clipped %d diagnostics %+v", r.Clipped, r.Weave)
	}
}

func TestWeaveCollapsedEndpoints(t *testing.T) {
	for _, family := range []string{"tori", "fibers"} {
		q := weaveRequest(family, 3, 5, math.Pi/4, math.Pi/2)
		r := weaveCompute(t, q)
		kinds := []string{r.Sections[0].Kind, r.Sections[1].Kind, r.Sections[2].Kind}
		if kinds[0] != "circle" || kinds[1] != "torus" || kinds[2] != "circle" || r.Sections[0].Level != 0 || r.Sections[2].Level != math.Pi/2 {
			t.Fatalf("%s: sections %+v", family, r.Sections)
		}
		if r.Sections[0].Dimension != 1 || r.Weave.Collapsed != 2 {
			t.Fatalf("%s: collapsed dimension %d count %d", family, r.Sections[0].Dimension, r.Weave.Collapsed)
		}
		perLatitude := map[string]int{}
		for _, p := range r.Paths {
			perLatitude[p.SectionID]++
		}
		middle := 5
		if family == "tori" {
			middle = 10
		}
		if perLatitude["weave/latitude/0"] != 1 || perLatitude["weave/latitude/2"] != 1 || perLatitude["weave/latitude/1"] != middle {
			t.Fatalf("%s: paths per latitude %v", family, perLatitude)
		}
		if r.Weave.Sources != middle+2 {
			t.Fatalf("%s: sources %d", family, r.Weave.Sources)
		}
		for _, p := range weavePaths(r, "collapsed") {
			for _, v := range p.FourPoints {
				if math.Abs(norm4(v)-1) > 1e-14 {
					t.Fatalf("%s: collapsed point %v off S³", p.Source, v)
				}
				if p.SectionID == "weave/latitude/0" && (v[2] != 0 || v[3] != 0) {
					t.Fatalf("α = 0 circle leaves the xy plane: %v", v)
				}
				if p.SectionID == "weave/latitude/2" && (v[0] != 0 || v[1] != 0) {
					t.Fatalf("α = π/2 circle leaves the zw plane: %v", v)
				}
			}
		}
		// α = 0 lies in w = 0 and is complete; α = π/2 passes the pole.
		for _, p := range weavePaths(r, "collapsed") {
			if (p.SectionID == "weave/latitude/0") != closedPath(p) {
				t.Fatalf("%s: closed %v", p.Source, closedPath(p))
			}
		}
	}
	// A rounding distance from the endpoint snaps; a small positive α does not.
	q := weaveRequest("tori", 2, 3, .5-2.5e-14, 1+5e-14)
	r := weaveCompute(t, q)
	if r.Sections[0].Kind != "circle" || r.Sections[0].Level != 0 || r.Sections[1].Kind != "torus" {
		t.Fatalf("near-endpoint latitude: %+v", r.Sections)
	}
	// Positive rounding distances snap too, at both endpoints.
	q = weaveRequest("fibers", 2, 3, .5+2.5e-14, 1-5e-14)
	if r = weaveCompute(t, q); r.Sections[0].Kind != "circle" || r.Sections[0].Level != 0 {
		t.Fatalf("latitude 5·10⁻¹⁴ above 0: %+v", r.Sections)
	}
	q = weaveRequest("fibers", 1, 3, math.Pi/2-5e-14, 0)
	if r = weaveCompute(t, q); r.Sections[0].Kind != "circle" || r.Sections[0].Level != math.Pi/2 || len(weavePaths(r, "collapsed")) != 1 {
		t.Fatalf("latitude 5·10⁻¹⁴ below π/2: %+v", r.Sections)
	}
	q = weaveRequest("tori", 1, 3, 1e-6, 0)
	r = weaveCompute(t, q)
	if r.Sections[0].Kind != "torus" || len(weavePaths(r, "fixed-u")) != 3 {
		t.Fatalf("α = 10⁻⁶ must remain a thin torus: %+v", r.Sections)
	}
}

// fixtureCircle reconstructs the w range of the first returned source circle.
// ok is false when even the largest window clips the circle.
func fixtureCircle(t *testing.T, q Request, role string) (lo, hi float64, ok bool) {
	t.Helper()
	q.Clip = 12
	r := weaveCompute(t, q)
	p := weavePaths(r, role)[0]
	if !closedPath(p) {
		return 0, 0, false
	}
	n := len(p.FourPoints)
	center, radius, e1, e2 := circle4(p.FourPoints[0], p.FourPoints[n/3], p.FourPoints[2*n/3])
	rho := radius * math.Hypot(e1[3], e2[3])
	return center[3] - rho, center[3] + rho, true
}

// Sweeps rotations so that window tangency meets rounding in q_w and C.
func TestWeaveWindowTangencySurvivesRounding(t *testing.T) {
	tested := 0
	for i := 0; i < 400; i++ {
		f := float64(i)
		angles := [6]float64{.37 * f, .11 * f, .23 * f, .05 + .013*f, .3 + .007*f, .17 * f}
		alpha := .35 + .002*float64(i%150)
		q := weaveRequest("fibers", 1, 1, alpha, 0)
		q.Angles = angles
		_, hi, ok := fixtureCircle(t, q, "fiber")
		if !ok || hi < .61 || hi > .985 {
			continue
		}
		tested++
		// Internal tangency: max w = k. The circle stays complete.
		q.Clip = math.Sqrt((1 + hi) / (1 - hi))
		r := weaveCompute(t, q)
		p := weavePaths(r, "fiber")
		if len(p) != 1 || !closedPath(p[0]) || r.Clipped != 0 {
			t.Fatalf("rotation %d: internally tangent circle split (clipped %d, %d paths)", i, r.Clipped, len(p))
		}
		// A crossing 10⁻⁹ deep is still cut.
		deep := hi - 1e-9
		q.Clip = math.Sqrt((1 + deep) / (1 - deep))
		r = weaveCompute(t, q)
		p = weavePaths(r, "fiber")
		if len(p) != 1 || closedPath(p[0]) || r.Clipped != 1 || r.Weave.RetainedArcs != 1 {
			t.Fatalf("rotation %d: shallow crossing not cut (clipped %d)", i, r.Clipped)
		}
	}
	// External tangency: a small circle whose lowest point touches the window
	// retains exactly that contact point.
	contacts := 0
	for i := 0; i < 1200; i++ {
		f := float64(i)
		q := weaveRequest("tori", 1, 1, 1.25+.0002*f, 0)
		q.Angles = [6]float64{.29 * f, .41 * f, .13 * f, .02 * f, .015 * f, .31 + .011*f}
		lo, hi, ok := fixtureCircle(t, q, "fixed-v")
		if !ok || lo < .61 || hi > .985 || hi-lo < 1e-3 {
			continue
		}
		contacts++
		q.Clip = math.Sqrt((1 + lo) / (1 - lo))
		r := weaveCompute(t, q)
		p := weavePaths(r, "fixed-v")
		if len(p) != 1 || len(p[0].Points) != 2 || p[0].Points[0] != p[0].Points[1] || r.Weave.Contacts != 1 {
			t.Fatalf("rotation %d: external tangency returned %d paths, diagnostics %+v", i, len(p), r.Weave)
		}
		if l := math.Sqrt(dot(p[0].Points[0], p[0].Points[0])); math.Abs(l-q.Clip) > 1e-9*q.Clip {
			t.Fatalf("rotation %d: contact at |P| = %v, window %v", i, l, q.Clip)
		}
		// The contact's circle is clipped, as is the fixed-u circle if open.
		clipped := 1
		if u := weavePaths(r, "fixed-u"); len(u) == 0 || !closedPath(u[0]) {
			clipped++
		}
		if r.Clipped != clipped {
			t.Fatalf("rotation %d: clipped %d, want %d", i, r.Clipped, clipped)
		}
		// A crossing 10⁻⁶ inside the lowest point leaves an arc shorter than
		// one subdivision. It still has an interior sample inside the window.
		inside := lo + 1e-6
		q.Clip = math.Sqrt((1 + inside) / (1 - inside))
		r = weaveCompute(t, q)
		p = weavePaths(r, "fixed-v")
		if len(p) != 1 || len(p[0].Points) != 3 || r.Weave.Contacts != 0 {
			t.Fatalf("rotation %d: short arc returned %d paths, %d points", i, len(p), len(p[0].Points))
		}
		if m := p[0].Points[1]; math.Sqrt(dot(m, m)) >= q.Clip {
			t.Fatalf("rotation %d: short arc midpoint lies outside the window", i)
		}
	}
	if tested < 100 || contacts < 50 {
		t.Fatalf("fixtures exercised only %d internal and %d external tangencies", tested, contacts)
	}
}

// A clipped arc's projection is an exact circle. Its polyline chords converge
// quadratically to that circle, measured against a circumcircle of samples.
func TestWeaveProjectedCirclesAndChordConvergence(t *testing.T) {
	var previous, first float64
	for _, samples := range []int{16, 32, 64, 128, 256} {
		q := weaveRequest("tori", 1, 1, .9, 0)
		q.Angles = [6]float64{.2, 0, .4, .3, .5, 0}
		q.Clip, q.Samples = 2.2, samples
		r := weaveCompute(t, q)
		p := weavePaths(r, "fixed-u")[0]
		if closedPath(p) || len(p.Points) < 8 {
			t.Fatal("fixture must be an open retained arc")
		}
		n := len(p.Points)
		center, radius := circle3(p.Points[0], p.Points[n/2], p.Points[n-1])
		plane := unit(cross(sub(p.Points[0], center), sub(p.Points[n/2], center)))
		worst := 0.
		for i, v := range p.Points {
			d := sub(v, center)
			if math.Abs(math.Sqrt(dot(d, d))-radius) > 1e-11*radius || math.Abs(dot(d, plane)) > 1e-11*radius {
				t.Fatalf("samples %d point %d leaves the projected circle", samples, i)
			}
			if i > 0 {
				m := Vec3{(v[0] + p.Points[i-1][0]) / 2, (v[1] + p.Points[i-1][1]) / 2, (v[2] + p.Points[i-1][2]) / 2}
				dm := sub(m, center)
				worst = math.Max(worst, radius-math.Sqrt(dot(dm, dm)))
			}
		}
		// Near an open end the longest projected chord is a partial step whose
		// length depends on the grid offset, so the rate is asymptotic only.
		if previous > 0 && samples >= 128 && (worst > previous/3.5 || worst < previous/4.5) {
			t.Fatalf("samples %d: chord error %v, previous %v, want second-order convergence", samples, worst, previous)
		}
		if samples == 16 {
			first = worst
		}
		previous = worst
	}
	if previous > first/100 {
		t.Fatalf("chord error fell only from %v to %v over a 16-fold refinement", first, previous)
	}
}

func TestWeaveLinking(t *testing.T) {
	var previous float64
	for _, samples := range []int{32, 64, 256} {
		q := weaveRequest("fibers", 1, 2, math.Pi/4, 0)
		q.Samples = samples
		q.Angles = [6]float64{.3, .1, 0, .2, 0, .4}
		r := weaveCompute(t, q)
		f := weavePaths(r, "fiber")
		if len(f) != 2 || !closedPath(f[0]) || !closedPath(f[1]) {
			t.Fatal("linking needs two complete projected fibers")
		}
		lk := linkingNumber(f[0].Points, f[1].Points)
		err := math.Abs(math.Abs(lk) - 1)
		if previous > 0 && err > previous {
			t.Fatalf("samples %d: linking error %v did not decrease from %v", samples, err, previous)
		}
		previous = err
		if samples == 256 && err > 1e-3 {
			t.Fatalf("Hopf fibers link once: Lk = %v", lk)
		}
	}
	// Parallel fixed-v circles on one Clifford torus do not link.
	q := weaveRequest("tori", 1, 2, math.Pi/4, 0)
	q.Samples = 256
	r := weaveCompute(t, q)
	v := weavePaths(r, "fixed-v")
	if lk := linkingNumber(v[0].Points, v[1].Points); math.Abs(lk) > 1e-3 {
		t.Fatalf("parallel torus circles: Lk = %v", lk)
	}
}

func TestWeaveValidationNamesFields(t *testing.T) {
	ok := weaveRequest("tori", 3, 4, math.Pi/4, .6)
	cases := []struct {
		name   string
		change func(*Request)
		want   string
	}{
		{"mode", func(q *Request) { q.Mode = "section" }, "Stereographic loom"},
		{"missing", func(q *Request) { q.Weave = nil }, "parameters are required"},
		{"family", func(q *Request) { q.Weave.Family = "knots" }, "Weave family"},
		{"angle", func(q *Request) { q.Angles[3] = math.Inf(1) }, "rotation angles"},
		{"spread", func(q *Request) { q.Weave.Spread = 2 }, "Latitude spread"},
		{"spread nan", func(q *Request) { q.Weave.Spread = math.NaN() }, "Latitude spread"},
		{"coincident", func(q *Request) { q.Weave.Spread = 0 }, "Latitude spread"},
		{"alpha", func(q *Request) { q.Weave.Alpha = 1.4 }, "Central latitude α"},
		{"alpha nan", func(q *Request) { q.Weave.Alpha = math.NaN() }, "Central latitude α"},
		{"start", func(q *Request) { q.Weave.AlphaFrom = -.1 }, "Latitude start"},
		{"end", func(q *Request) { q.Weave.AlphaTo = 1.5 }, "Latitude end"},
		{"count", func(q *Request) { q.Count = 10 }, "1–9 latitudes"},
		{"curves", func(q *Request) { q.Curves = 0 }, "1–16 curves per direction"},
		{"fibers", func(q *Request) { q.Weave.Family = "fibers"; q.Curves = 17 }, "1–16 fibers per latitude"},
		{"samples", func(q *Request) { q.Samples = 7 }, "8–256 arc samples"},
		{"clip", func(q *Request) { q.Clip = 1.5 }, "window radius"},
		{"budget", func(q *Request) { q.Count, q.Curves, q.Samples, q.Weave.Spread = 9, 16, 256, 1 }, "65,536 points"},
	}
	for _, c := range cases {
		q := ok
		p := *ok.Weave
		q.Weave = &p
		c.change(&q)
		if _, err := Compute(q); err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: error %v, want %q", c.name, err, c.want)
		}
	}
	// A single latitude ignores spread.
	q := weaveRequest("tori", 1, 4, math.Pi/2, 0)
	if _, err := Compute(q); err != nil {
		t.Fatal(err)
	}
	// Rotation angles and other objects' inputs do not block a valid weave.
	q.Distance, q.Grid, q.Slice = 0, 99, 1e9
	if _, err := Compute(q); err != nil {
		t.Fatal(err)
	}
}

// The largest accepted study: nine uncollapsed latitudes whose 234 source
// circles are all complete, so every circle emits samples+1 points.
func largestWeave() Request {
	q := weaveRequest("tori", 9, 13, math.Pi/4, 1.2)
	q.Samples = 256
	return q
}

func TestWeaveLargestStudyWithinBudget(t *testing.T) {
	r := weaveCompute(t, largestWeave())
	if r.Weave.CompleteCircles != 234 || r.Weave.Collapsed != 0 || r.EmittedPoints != 237*257 || r.Evaluations != 237*257 || len(r.Paths) != 237 {
		t.Fatalf("%d paths, %d points, %d evaluations, diagnostics %+v", len(r.Paths), r.EmittedPoints, r.Evaluations, r.Weave)
	}
	// The same counts at the fiber limit stay within budget.
	q := weaveRequest("fibers", 9, 16, math.Pi/4, 1.2)
	q.Samples = 256
	if r = weaveCompute(t, q); r.EmittedPoints > maxPoints || r.Evaluations > 262144 {
		t.Fatalf("fibers: %d points, %d evaluations", r.EmittedPoints, r.Evaluations)
	}
	// One more curve per direction is rejected before any evaluation.
	q = largestWeave()
	q.Curves = 14
	if _, err := Compute(q); err == nil {
		t.Fatal("14 curves per direction over nine latitudes must exceed the budget")
	}
}

func BenchmarkWeaveLargest(b *testing.B) {
	q := largestWeave()
	for i := 0; i < b.N; i++ {
		if _, err := Compute(q); err != nil {
			b.Fatal(err)
		}
	}
}
