package engine3

import (
	"fmt"
	"math"
	"slices"
	"tangentgarden/engine/expr"
)

// CanalRequest describes the envelope of the spheres centred on the curve
// c(t) with radius R(t) = Radius·ρ(t), where Profile is ρ, written in t
// without a. A profile of 1 gives the tube of constant radius. The angle
// around each contact circle is carried by the rotation-minimizing frame of
// the Request's Frame (N₀, θ₀, twist and closure; its kind, ribbon and
// strands do not apply), and Meridians curves θ = θ₀ + 2πk/Meridians are
// drawn on the surface.
type CanalRequest struct {
	Radius    float64 `json:"radius"`
	Profile   string  `json:"profile"`
	Meridians int     `json:"meridians"`
}

// CanalCircle is the contact circle at a representative sample: the circle
// where the sphere of radius Sphere touches the envelope, with its Center on
// the tangent line and its Radius. Real is false where the sphere has no real
// contact circle (|R′| > v); Center is then the sphere's centre, Radius is 0
// and Points is empty. Points close on themselves.
type CanalCircle struct {
	SampleIndex int     `json:"sampleIndex"`
	Real        bool    `json:"real"`
	Sphere      float64 `json:"sphere"`
	Center      Vec3    `json:"center"`
	Radius      float64 `json:"radius"`
	Points      []Vec3  `json:"points"`
}

// CanalResult shares the base's parameter indices. Meridians are null where
// there is no real circle. Breaks add to the base's every interval with a
// sample or midpoint without a real circle. Constant is set when R does not
// vary (a tube). Closed is set when the curve is closed and the profile
// returns to its start with the same slope; otherwise, on a closed curve,
// Gap is the distance between the first and last contact circles, which
// share an axis. Steepest is the largest |R′|/v. Undefined counts samples
// with a regular centre but without a positive, finite radius and slope;
// Imaginary counts samples where |R′| > v, and Between intervals whose own
// samples have circles but whose midpoint has none; Collapsed counts samples
// where |R′| = v and the circle is a point; Folded where the surface turns back on itself, as a
// tube does where R exceeds the radius of curvature.
type CanalResult struct {
	Circles   []CanalCircle `json:"circles"`
	Meridians [][]*Vec3     `json:"meridians"`
	Breaks    []bool        `json:"breaks"`
	Constant  bool          `json:"constant"`
	Closed    bool          `json:"closed"`
	Gap       float64       `json:"gap"`
	Steepest  float64       `json:"steepest"`
	Undefined int           `json:"undefined"`
	Imaginary int           `json:"imaginary"`
	Between   int           `json:"between"`
	Collapsed int           `json:"collapsed"`
	Folded    int           `json:"folded"`
}

// canalSegments divides each contact circle of the mesh, and canalRings caps
// the circles joined into it; a circle beside a gap is always included.
const (
	canalSegments = 24
	canalRings    = 480
	maxMeridians  = 12
)

func (q CanalRequest) validate() error {
	if !finite(q.Radius) || q.Radius <= 0 || q.Radius > 1e5 {
		return fieldErr("canal.radius", "the radius R must be finite, above 0, and at most 100000")
	}
	if q.Meridians < 0 || q.Meridians > maxMeridians {
		return fieldErr("canal.meridians", "use 0–12 meridians")
	}
	return nil
}

// frame is the Request's frame as the canal uses it: always transported,
// with no ribbon or strands of its own.
func (q CanalRequest) frame(f FrameRequest) FrameRequest {
	f.Kind, f.Width, f.Offset, f.Strands = "rotation-minimizing", 0, 0, 0
	return f
}

// radius returns R, R′ and R″ at t, and whether the slope is stable; R″ is
// NaN where it is unknown.
func (q CanalRequest) radius(span float64) (func(float64) (float64, float64, float64, bool), error) {
	e, err := expr.Parse(q.Profile)
	if err != nil {
		return nil, named("canal.profile", fmt.Errorf("ρ(t): %w", err))
	}
	profile := sampled(func(s float64) Vec3 { return Vec3{e(s), 0, 0} }, math.Inf(-1), math.Inf(1), span)
	return func(s float64) (float64, float64, float64, bool) {
		r, v, a, ok := profile(s)
		return q.Radius * r.X, q.Radius * v.X, q.Radius * a.X, ok
	}, nil
}

// contact gives the contact circle of the sphere of radius R whose centre
// moves at speed v while R changes at R′: its signed offset along T, its
// radius, and whether it is real and whether it has collapsed.
func contact(R, slope, speed float64) (axial, radius float64, ok, collapsed bool) {
	k := slope / speed
	switch {
	case math.Abs(k) > 1+1e-9:
		return 0, 0, false, false
	case math.Abs(k) >= 1-1e-9:
		return -R * math.Copysign(1, k), 0, true, true
	}
	return -R * k, R * math.Sqrt(1-k*k), true, false
}

func canalSurface(c Request, out *Result, evaluate evaluation, radius func(float64) (float64, float64, float64, bool), frame carried, tangents, accelerations []Vec3, speeds, middles []float64, lo, hi float64, closed bool) error {
	n := c.Samples
	at := func(i float64) float64 { return lo*(1-i/float64(n)) + hi*i/float64(n) }
	base := out.Base
	q := &CanalResult{Breaks: make([]bool, n+1), Constant: true}
	last := n
	if closed {
		last = n - 1
	}
	R, slope := make([]float64, n+1), make([]float64, n+1)
	sphere := make([]bool, n+1)
	first := -1
	for i := 0; i <= n; i++ {
		if base[i] == nil {
			continue
		}
		r, d, _, ok := radius(at(float64(i)))
		if !ok || !finite(r) || !finite(d) || r <= 0 {
			if i <= last {
				q.Undefined++
			}
			continue
		}
		R[i], slope[i], sphere[i] = r, d, true
		if first < 0 {
			first = i
		}
		if math.Abs(r-R[first]) > 1e-12*R[first] || math.Abs(d)*(hi-lo) > 1e-12*R[first] {
			q.Constant = false
		}
	}
	if first < 0 {
		return fieldErr("canal.profile", "the sphere radius R·ρ(t) is never positive where the curve is regular; check ρ(t)")
	}
	size := 0.0
	for i := range base {
		if base[i] != nil {
			size = math.Max(size, base[i].sub(*base[first]).norm()+R[i])
		}
	}
	if closed && sphere[0] && sphere[n] {
		a0, r0, _, _ := contact(R[0], slope[0], speeds[0])
		an, rn, _, _ := contact(R[n], slope[n], speeds[n])
		if q.Gap = math.Hypot(an-a0, rn-r0); q.Gap <= 1e-9*size && math.Abs(R[n]-R[0]) <= 1e-9*size {
			q.Closed, q.Gap = true, 0
			R[n], slope[n] = R[0], slope[0]
		}
	}
	// Contact circles: centre on the tangent line, radius, and the mesh frame,
	// which spreads any holonomy along a closed loop so the rings match up.
	centers, radii := make([]Vec3, n+1), make([]float64, n+1)
	circled := make([]bool, n+1)
	us, vs := make([]Vec3, n+1), make([]Vec3, n+1)
	f := out.Frame
	turn := 0.0
	if f.Closed && f.Length > 0 {
		turn = -(f.Holonomy + f.Correction) / f.Length
	}
	for i := 0; i <= n; i++ {
		if !sphere[i] || !frame.ok[i] {
			continue
		}
		axial, rho, ok, collapsed := contact(R[i], slope[i], speeds[i])
		if i <= last {
			q.Steepest = math.Max(q.Steepest, math.Abs(slope[i])/speeds[i])
			if !ok {
				q.Imaginary++
			} else if collapsed {
				q.Collapsed++
			}
		}
		if !ok {
			continue
		}
		circled[i], centers[i], radii[i] = true, base[i].add(tangents[i].mul(axial)), rho
		psi := turn * frame.arc[i]
		us[i] = frame.us[i].mul(math.Cos(psi)).add(frame.vs[i].mul(math.Sin(psi)))
		vs[i] = frame.vs[i].mul(math.Cos(psi)).sub(frame.us[i].mul(math.Sin(psi)))
	}
	for i := 0; i < n; i++ {
		broken := out.Breaks[i+1] || !circled[i] || !circled[i+1]
		if !broken {
			r, d, _, ok := radius(at(float64(i) + 0.5))
			broken = !ok || !finite(r) || !finite(d) || r <= 0 || !(math.Abs(d) <= (1+1e-9)*middles[i])
			if broken {
				q.Between++
			}
		}
		q.Breaks[i+1] = broken
		if broken {
			out.Omitted++
		}
	}
	q.Meridians = make([][]*Vec3, c.Canal.Meridians)
	for k := range q.Meridians {
		q.Meridians[k] = make([]*Vec3, n+1)
		for i := range base {
			if circled[i] {
				p := centers[i].add(frame.direction(i, 2*math.Pi*float64(k)/float64(c.Canal.Meridians)).mul(radii[i]))
				q.Meridians[k][i] = &p
			}
		}
	}
	if out.Adaptive != nil {
		refineMeridians(c, out, q, radius, frame, evaluate, lo, hi)
	}
	// The mesh angles' cosines and sines, each computed once.
	var cosines, sines [canalSegments + 1]float64
	for k := range cosines {
		theta := 2 * math.Pi * float64(k) / canalSegments
		cosines[k], sines[k] = math.Cos(theta), math.Sin(theta)
	}
	grid := func(i, k int) Vec3 {
		return centers[i].add(us[i].mul(radii[i] * cosines[k]).add(vs[i].mul(radii[i] * sines[k])))
	}
	normal := func(i int, p Vec3) Vec3 { return p.sub(*base[i]).mul(1 / R[i]) }
	// Folds: X_θ × X_t turns against the outward normal q/R. X_t is a
	// second-order difference along each mesh angle within an unbroken run.
	joined := func(i, j int) bool {
		if j < i {
			i, j = j, i
		}
		return i >= 0 && j <= n && circled[i] && circled[j] && !q.Breaks[j]
	}
	for i := 0; i <= last; i++ {
		if !circled[i] || radii[i] <= 1e-9*R[i] {
			continue
		}
		// On a closed surface the ring before the first is the last but one.
		prev := i - 1
		if i == 0 && q.Closed {
			prev = n - 1
		}
		behind := prev >= 0 && circled[prev] && !q.Breaks[prev+1]
		ahead := joined(i, i+1)
		for k := 0; k < canalSegments; k++ {
			var along Vec3
			switch {
			case behind && ahead:
				along = grid(i+1, k).sub(grid(prev, k))
			case ahead && joined(i+1, i+2):
				along = grid(i+1, k).mul(4).sub(grid(i, k).mul(3)).sub(grid(i+2, k))
			case behind && joined(i-2, i-1):
				along = grid(i, k).mul(3).sub(grid(i-1, k).mul(4)).add(grid(i-2, k))
			default:
				continue
			}
			around := vs[i].mul(cosines[k]).sub(us[i].mul(sines[k]))
			if around.cross(along).dot(normal(i, grid(i, k))) < -1e-6*along.norm() {
				q.Folded++
				break
			}
		}
	}
	// Mesh rings: every stride-th circle and every circle beside a gap.
	stride := (n + canalRings - 1) / canalRings
	rings := []int{}
	for i := 0; i <= n; i++ {
		edge := i == 0 || i == n || !circled[i-1] || !circled[i+1] || q.Breaks[i] || q.Breaks[i+1]
		if circled[i] && (i%stride == 0 || edge) {
			rings = append(rings, i)
		}
	}
	// Each ring's vertices are listed once, when a strip first uses them,
	// and shared by the strips on both sides of it.
	listed := make([]int32, n+1)
	for i := range listed {
		listed[i] = -1
	}
	strips := max(len(rings)-1, 0)
	out.Mesh.Vertices = slices.Grow(out.Mesh.Vertices, 7*(canalSegments+1)*len(rings))
	out.Mesh.Triangles = slices.Grow(out.Mesh.Triangles, 3*2*canalSegments*strips)
	out.Mesh.SampleIndex = slices.Grow(out.Mesh.SampleIndex, 2*canalSegments*strips)
	vertex := func(i, k int) int32 {
		first := listed[i]
		if first < 0 {
			first = int32(len(out.Mesh.Vertices) / 7)
			listed[i] = first
			for m := 0; m <= canalSegments; m++ {
				p := grid(i, m)
				out.Mesh.vertex(p, normal(i, p), float64(i)/float64(n))
			}
		}
		return first + int32(k)
	}
	for j := 1; j < len(rings); j++ {
		a, b := rings[j-1], rings[j]
		connected := true
		for i := a + 1; i <= b; i++ {
			connected = connected && !q.Breaks[i]
		}
		if !connected {
			continue
		}
		for k := 0; k < canalSegments; k++ {
			out.Mesh.triangle(b, vertex(a, k), vertex(b, k), vertex(a, k+1))
			out.Mesh.triangle(b, vertex(b, k), vertex(b, k+1), vertex(a, k+1))
		}
	}
	for line := 0; line < c.Lines; line++ {
		i := line * n / (c.Lines - 1)
		if !sphere[i] || !frame.ok[i] {
			continue
		}
		g := CanalCircle{SampleIndex: i, Real: circled[i], Sphere: R[i], Center: *base[i], Points: []Vec3{}}
		if circled[i] {
			g.Center, g.Radius = centers[i], radii[i]
			for m := 0; m <= 2*canalSegments; m++ {
				g.Points = append(g.Points, centers[i].add(frame.direction(i, math.Pi*float64(m)/canalSegments).mul(radii[i])))
			}
		}
		q.Circles = append(q.Circles, g)
	}
	out.Canal = q
	if c.SurfaceDiagnostics {
		out.Probe = canalProbe(n, closed && q.Closed, lo, hi, at, radius, base, R, slope, sphere, circled, frame, tangents, accelerations, speeds)
	}
	return nil
}

// contacts evaluates the contact circle at any t between two samples the
// frame joins, as the samples have it but from the profile's own radius
// and slope at t, with the frame round it (see along); ok is false where
// the sphere or its circle is not real. Meridians are judged at the same
// parameters, so each circle is evaluated once for all of them.
func contacts(c Request, frame carried, evaluate evaluation, radius func(float64) (float64, float64, float64, bool), lo, hi float64) func(float64) (contactCircle, bool) {
	at := frame.along(c, evaluate, lo, hi)
	type known struct {
		circle contactCircle
		ok     bool
	}
	seen := map[float64]known{}
	return func(t float64) (contactCircle, bool) {
		if k, ok := seen[t]; ok {
			return k.circle, k.ok
		}
		g, ok := at(t)
		var circle contactCircle
		if ok {
			R, slope, _, defined := radius(t)
			ok = defined && finite(R) && finite(slope) && R > 0
			if ok {
				var axial float64
				axial, circle.radius, ok, _ = contact(R, slope, g.v.norm())
				circle.frameAt, circle.center = g, g.r.add(g.v.unit().mul(axial))
			}
		}
		seen[t] = known{circle, ok}
		return circle, ok
	}
}

// contactCircle is a contact circle between samples: its centre and radius,
// and the frame that measures the angle round it.
type contactCircle struct {
	frameAt
	center Vec3
	radius float64
}

// refineMeridians refines each meridian between samples. A gap or jump one
// finds there breaks the surface, so every other meridian is refined again
// unless it found the same; each path's Breaks counts only its own finds.
func refineMeridians(c Request, out *Result, q *CanalResult, radius func(float64) (float64, float64, float64, bool), frame carried, evaluate evaluation, lo, hi float64) {
	m := len(q.Meridians)
	if m == 0 {
		return
	}
	circles := contacts(c, frame, evaluate, radius, lo, hi)
	meridian := func(k int) func(float64) Vec3 {
		turn := 2 * math.Pi * float64(k) / float64(m)
		return func(t float64) Vec3 {
			g, ok := circles(t)
			if !ok {
				return Vec3{math.NaN(), 0, 0}
			}
			return g.center.add(g.direction(c.Frame.Angle + turn).mul(g.radius))
		}
	}
	paths := make([]*RefinedPath, m)
	given, found := make([][]bool, m), make([][]int, m)
	// Whether meridian k was refined knowing every break in breaks.
	current := func(k int, breaks []bool) bool {
		if given[k] == nil {
			return false
		}
		own := append([]bool(nil), given[k]...)
		for _, i := range found[k] {
			own[i+1] = true
		}
		for i, broken := range breaks {
			if broken && !own[i] {
				return false
			}
		}
		return true
	}
	for {
		breaks := append([]bool(nil), q.Breaks...)
		refined := false
		for k, points := range q.Meridians {
			if current(k, breaks) {
				continue
			}
			paths[k], found[k] = refinePath(points, breaks, meridian(k), lo, hi, pathTolerance(points), refineBudget)
			given[k], refined = breaks, true
		}
		if !refined {
			break
		}
		for k := range found {
			for _, i := range found[k] {
				if !q.Breaks[i+1] {
					q.Breaks[i+1] = true
					out.Omitted++
				}
			}
		}
	}
	out.Adaptive.Meridians = paths
}

// drawn is what the canal draws beside the base, as fitted families: its
// meridians and, as one family, the points of its contact circles. Reveal
// fits the same families, so a fully revealed study frames identically.
func (q *CanalResult) drawn() [][]*Vec3 {
	points := []*Vec3{}
	for _, g := range q.Circles {
		for j := range g.Points {
			points = append(points, &g.Points[j])
		}
	}
	return append(append([][]*Vec3{}, q.Meridians...), points)
}
