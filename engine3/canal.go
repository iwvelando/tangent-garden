package engine3

import (
	"fmt"
	"math"
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
		return fmt.Errorf("the radius R must be finite, above 0, and at most 100000")
	}
	if q.Meridians < 0 || q.Meridians > maxMeridians {
		return fmt.Errorf("use 0–12 meridians")
	}
	return nil
}

// frame is the Request's frame as the canal uses it: always transported,
// with no ribbon or strands of its own.
func (q CanalRequest) frame(f FrameRequest) FrameRequest {
	f.Kind, f.Width, f.Offset, f.Strands = "rotation-minimizing", 0, 0, 0
	return f
}

// radius returns R and R′ at t, and whether the slope is stable.
func (q CanalRequest) radius(span float64) (func(float64) (float64, float64, bool), error) {
	e, err := expr.Parse(q.Profile)
	if err != nil {
		return nil, fmt.Errorf("ρ(t): %w", err)
	}
	profile := sampled(func(s float64) Vec3 { return Vec3{e(s), 0, 0} }, math.Inf(-1), math.Inf(1), span)
	return func(s float64) (float64, float64, bool) {
		r, v, _, ok := profile(s)
		return q.Radius * r.X, q.Radius * v.X, ok
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

func canalSurface(c Request, out *Result, radius func(float64) (float64, float64, bool), frame carried, tangents []Vec3, speeds, middles []float64, lo, hi float64, closed bool) error {
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
		r, d, ok := radius(at(float64(i)))
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
		return fmt.Errorf("the sphere radius R·ρ(t) is never positive where the curve is regular; check ρ(t)")
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
			r, d, ok := radius(at(float64(i) + 0.5))
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
	point := func(i int, u, v Vec3, theta float64) Vec3 {
		return centers[i].add(u.mul(radii[i] * math.Cos(theta)).add(v.mul(radii[i] * math.Sin(theta))))
	}
	grid := func(i, k int) Vec3 {
		return point(i, us[i], vs[i], 2*math.Pi*float64(k)/canalSegments)
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
			theta := 2 * math.Pi * float64(k) / canalSegments
			around := vs[i].mul(math.Cos(theta)).sub(us[i].mul(math.Sin(theta)))
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
	for j := 1; j < len(rings); j++ {
		a, b := rings[j-1], rings[j]
		connected := true
		for i := a + 1; i <= b; i++ {
			connected = connected && !q.Breaks[i]
		}
		if !connected {
			continue
		}
		vertex := func(i, k int) Vertex {
			p := grid(i, k)
			return Vertex{b, p, normal(i, p), float64(i) / float64(n)}
		}
		for k := 0; k < canalSegments; k++ {
			out.Mesh = append(out.Mesh, vertex(a, k), vertex(b, k), vertex(a, k+1), vertex(b, k), vertex(b, k+1), vertex(a, k+1))
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
	return nil
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
