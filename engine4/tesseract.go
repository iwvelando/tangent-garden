// Package engine4 constructs projections and sections of the four-dimensional solids.
// It is independent of the curve engines and of any rendering or UI library.
package engine4

import (
	"fmt"
	"math"
	"sort"
)

type Vec4 [4]float64
type Vec3 [3]float64
type Request struct {
	Object   string          `json:"object"` // empty retains the legacy tesseract contract
	Radius   float64         `json:"radius"`
	Tube     float64         `json:"tube"`
	Curves   int             `json:"curves"`
	Mode     string          `json:"mode"`
	Angles   [6]float64      `json:"angles"` // xy, xz, yz, xw, yw, zw, radians, in this order
	Distance float64         `json:"distance"`
	Slice    float64         `json:"slice"`
	Spread   float64         `json:"spread"`
	Count    int             `json:"count"`
	Grid     int             `json:"grid"`
	Samples  int             `json:"samples"`
	Clip     float64         `json:"clip"`
	Lift     *LiftParameters `json:"lift,omitempty"`
}
type Path struct {
	Source     string    `json:"source,omitempty"`
	SectionID  string    `json:"sectionId,omitempty"`
	Branch     string    `json:"branch,omitempty"`
	Role       string    `json:"role,omitempty"`
	Points     []Vec3    `json:"points"`
	Family     int       `json:"family"` // original edge direction, or cell axis for a section
	Guide      bool      `json:"guide"`
	Parameters []float64 `json:"parameters,omitempty"`
	FourPoints []Vec4    `json:"fourPoints,omitempty"`
}
type Face struct {
	Points []Vec3 `json:"points"`
	Family int    `json:"family"`
}
type Section struct {
	ID        string  `json:"id,omitempty"`
	Kind      string  `json:"kind,omitempty"`
	Radius    float64 `json:"radius,omitempty"`
	Level     float64 `json:"level"`
	Vertices  int     `json:"vertices,omitempty"`
	Edges     int     `json:"edges,omitempty"`
	Faces     int     `json:"faces,omitempty"`
	Dimension int     `json:"dimension"` // -1 empty; 0 point; 1 segment; 2 polygon; 3 solid
}
type Result struct {
	Object        string           `json:"object"`
	Operation     string           `json:"operation"`
	EmittedPoints int              `json:"emittedPoints"`
	Evaluations   int              `json:"evaluations"`
	Paths         []Path           `json:"paths"`
	Faces         []Face           `json:"faces"`
	Points        []Vec3           `json:"points"`
	Sections      []Section        `json:"sections"`
	Clipped       int              `json:"clipped"` // source curves cut by the stereographic window
	Radius        float64          `json:"radius"`  // fixed, rotation-independent framing sphere
	Lift          *LiftDiagnostics `json:"lift,omitempty"`
}

var planes = [6][2]int{{0, 1}, {0, 2}, {1, 2}, {0, 3}, {1, 3}, {2, 3}}

func rotate(v Vec4, angles [6]float64) Vec4 {
	for k, ij := range planes {
		s, c := math.Sincos(angles[k])
		i, j := ij[0], ij[1]
		v[i], v[j] = c*v[i]-s*v[j], s*v[i]+c*v[j]
	}
	return v
}
func vertex(i int) (v Vec4) {
	for k := range v {
		v[k] = -1
		if i&(1<<k) != 0 {
			v[k] = 1
		}
	}
	return
}
func mix(a, b Vec4, t float64) (v Vec4) {
	for k := range v {
		v[k] = a[k] + t*(b[k]-a[k])
	}
	return
}
func norm(v Vec4) float64 {
	s := 0.
	for _, x := range v {
		s += x * x
	}
	return math.Sqrt(s)
}
func finite(x float64) bool { return !math.IsNaN(x) && !math.IsInf(x, 0) }
func Compute(q Request) (r Result, err error) {
	r = Result{Paths: []Path{}, Faces: []Face{}, Points: []Vec3{}, Sections: []Section{}, Radius: 2}
	if q.Object == "" {
		q.Object = "tesseract"
	}
	r.Object, r.Operation = q.Object, q.Mode
	defer func() {
		for i := range r.Paths {
			p := &r.Paths[i]
			if p.Source == "" {
				p.Source = fmt.Sprintf("tesseract/curve/%d", i)
				p.Branch = "0"
				p.Role = "base"
				if q.Mode == "section" {
					p.Role = "section"
				} else if p.Guide {
					p.Role = "guide"
				}
			}
			r.EmittedPoints += len(p.Points)
		}
		r.EmittedPoints += len(r.Points)
	}()
	if q.Object == "lift" {
		return lifted(q, r)
	}
	if q.Object == "ball" || q.Object == "tube" {
		return curved(q, r)
	}
	if q.Object != "tesseract" {
		return r, fmt.Errorf("choose tesseract, ball, tube, or lift")
	}
	if q.Mode != "perspective" && q.Mode != "orthographic" && q.Mode != "stereo" && q.Mode != "section" {
		return r, fmt.Errorf("choose a tesseract projection or section")
	}
	for _, a := range q.Angles {
		if !finite(a) || math.Abs(a) > 1e6 {
			return r, fmt.Errorf("rotation angles must be finite and within ±1000000 radians")
		}
	}
	// Validate the active construction only. An unfinished field in another
	// mode remains editable there without blocking this independent view.
	if q.Mode == "perspective" && (!finite(q.Distance) || q.Distance < 2.05 || q.Distance > 20) {
		return r, fmt.Errorf("4D eye distance must be between 2.05 and 20")
	}
	if q.Mode == "section" {
		if !finite(q.Slice) || math.Abs(q.Slice) > 3 || !finite(q.Spread) || q.Spread < 0 || q.Spread > 4 {
			return r, fmt.Errorf("slice offset must be within ±3 and spread between 0 and 4")
		}
		if q.Count < 1 || q.Count > 25 {
			return r, fmt.Errorf("use 1–25 sections")
		}
	} else if q.Grid < 0 || q.Grid > 12 {
		return r, fmt.Errorf("use 0–12 face grid lines")
	}
	if q.Mode == "stereo" {
		if q.Samples < 8 || q.Samples > 256 {
			return r, fmt.Errorf("use 8–256 arc samples")
		}
		if !finite(q.Clip) || q.Clip < 2 || q.Clip > 12 {
			return r, fmt.Errorf("stereographic window radius must be between 2 and 12")
		}
	}
	var vs [16]Vec4
	for i := range vs {
		vs[i] = rotate(vertex(i), q.Angles)
	}
	if q.Mode == "section" {
		for i := 0; i < q.Count; i++ {
			level := q.Slice
			if q.Count > 1 {
				level += q.Spread * (float64(i)/float64(q.Count-1) - .5)
			}
			start := len(r.Paths)
			section(&r, vs, level, q.Count == 1)
			id := fmt.Sprintf("section/%d", i)
			r.Sections[len(r.Sections)-1].ID = id
			for j := start; j < len(r.Paths); j++ {
				r.Paths[j].SectionID = id
			}
		}
		return r, nil
	}
	if q.Mode == "perspective" {
		r.Radius = 2 * q.Distance / math.Sqrt(q.Distance*q.Distance-4)
	}
	if q.Mode == "stereo" {
		r.Radius = q.Clip
	}
	add := func(a, b Vec4, family int, guide bool) {
		if q.Mode == "stereo" {
			paths, clipped := stereo(a, b, q.Clip, q.Samples)
			if clipped {
				r.Clipped++
			}
			for _, points := range paths {
				r.Paths = append(r.Paths, Path{Points: points, Family: family, Guide: guide})
			}
		} else {
			project := func(v Vec4) Vec3 {
				s := 1.
				if q.Mode == "perspective" {
					s = q.Distance / (q.Distance - v[3])
				}
				return Vec3{s * v[0], s * v[1], s * v[2]}
			}
			r.Paths = append(r.Paths, Path{Points: []Vec3{project(a), project(b)}, Family: family, Guide: guide})
		}
	}
	for i, a := range vs {
		for k := 0; k < 4; k++ {
			if i&(1<<k) == 0 {
				add(a, vs[i|(1<<k)], k, false)
			}
		}
	}
	// Each square has two free coordinates and two fixed signs: 6 × 4 faces.
	// Its two families of parallel lines become spherical arcs after normalization.
	for u := 0; u < 4; u++ {
		for v := u + 1; v < 4; v++ {
			for i := 0; i < 16; i++ {
				if i&(1<<u) != 0 || i&(1<<v) != 0 {
					continue
				}
				for j := 1; j <= q.Grid; j++ {
					t := -1 + 2*float64(j)/float64(q.Grid+1)
					for _, ab := range [][2]int{{u, v}, {v, u}} {
						a, b := vertex(i), vertex(i)
						a[ab[0]], b[ab[0]] = -1, 1
						a[ab[1]], b[ab[1]] = t, t
						add(rotate(a, q.Angles), rotate(b, q.Angles), ab[0], true)
					}
				}
			}
		}
	}
	return r, nil
}

// Clip exactly in the unnormalized line parameter before sampling. On S³,
// |stereo(p)| ≤ R iff p.w ≤ (R²−1)/(R²+1). Quadratic roots split a line even
// when both sampled endpoints lie inside and an intervening pole lies outside.
func stereo(a, b Vec4, radius float64, samples int) ([][]Vec3, bool) {
	k := (radius*radius - 1) / (radius*radius + 1)
	d := b
	for i := range d {
		d[i] -= a[i]
	}
	aa, bb, cc := d[3]*d[3], 2*a[3]*d[3], a[3]*a[3]
	for i := range a {
		aa -= k * k * d[i] * d[i]
		bb -= 2 * k * k * a[i] * d[i]
		cc -= k * k * a[i] * a[i]
	}
	cuts := []float64{0, 1}
	root := func(t float64) {
		if t > 0 && t < 1 && mix(a, b, t)[3] >= 0 {
			cuts = append(cuts, t)
		}
	}
	if math.Abs(aa) < 1e-14 {
		if math.Abs(bb) > 1e-14 {
			root(-cc / bb)
		}
	} else {
		disc := bb*bb - 4*aa*cc
		if disc > 0 {
			s := math.Sqrt(disc)
			h := -.5 * (bb + math.Copysign(s, bb))
			root(h / aa)
			if h != 0 {
				root(cc / h)
			}
		}
	}
	sort.Float64s(cuts)
	out := [][]Vec3{}
	clipped := false
	for i := 1; i < len(cuts); i++ {
		lo, hi := cuts[i-1], cuts[i]
		if hi-lo < 1e-14 {
			continue
		}
		m := mix(a, b, (lo+hi)/2)
		if m[3] > k*norm(m) {
			clipped = true
			continue
		}
		n := int(math.Ceil(float64(samples) * (hi - lo)))
		if n < 2 {
			n = 2
		}
		points := make([]Vec3, n+1)
		for j := range points {
			p := mix(a, b, lo+(hi-lo)*float64(j)/float64(n))
			den := norm(p) - p[3]
			points[j] = Vec3{p[0] / den, p[1] / den, p[2] / den}
		}
		out = append(out, points)
	}
	return out, clipped
}
func sub(a, b Vec3) Vec3    { return Vec3{a[0] - b[0], a[1] - b[1], a[2] - b[2]} }
func dot(a, b Vec3) float64 { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2] }
func cross(a, b Vec3) Vec3 {
	return Vec3{a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]}
}
func unit(a Vec3) Vec3 { l := math.Sqrt(dot(a, a)); return Vec3{a[0] / l, a[1] / l, a[2] / l} }
func samePoint(a, b Vec3) bool {
	d := sub(a, b)
	return dot(d, d) < 1e-18
}
func contains(points []Vec3, p Vec3) bool {
	for _, v := range points {
		if samePoint(v, p) {
			return true
		}
	}
	return false
}
func unique(points []Vec3, p Vec3) []Vec3 {
	for _, v := range points {
		if samePoint(v, p) {
			return points
		}
	}
	return append(points, p)
}
func dimension(points []Vec3) int {
	if len(points) == 0 {
		return -1
	}
	if len(points) == 1 {
		return 0
	}
	u := unit(sub(points[1], points[0]))
	var n Vec3
	for _, p := range points[2:] {
		n = cross(u, sub(p, points[0]))
		if dot(n, n) > 1e-18 {
			break
		}
	}
	if dot(n, n) <= 1e-18 {
		return 1
	}
	n = unit(n)
	for _, p := range points {
		if math.Abs(dot(n, sub(p, points[0]))) > 1e-9 {
			return 3
		}
	}
	return 2
}
func order(points []Vec3) []Vec3 {
	c := Vec3{}
	for _, p := range points {
		for i := range c {
			c[i] += p[i] / float64(len(points))
		}
	}
	u := unit(sub(points[0], c))
	var n Vec3
	for _, p := range points[1:] {
		n = cross(u, sub(p, c))
		if dot(n, n) > 1e-18 {
			break
		}
	}
	v := cross(unit(n), u)
	sort.Slice(points, func(i, j int) bool {
		a, b := sub(points[i], c), sub(points[j], c)
		return math.Atan2(dot(a, v), dot(a, u)) < math.Atan2(dot(b, v), dot(b, u))
	})
	return points
}
func section(r *Result, vs [16]Vec4, level float64, fill bool) {
	all := []Vec3{}
	faces := [][]Vec3{}
	edges := [][2]Vec3{}
	for axis := 0; axis < 4; axis++ {
		for sign := 0; sign < 2; sign++ {
			points := []Vec3{}
			for i, a := range vs {
				if (i>>axis)&1 != sign {
					continue
				}
				for k := 0; k < 4; k++ {
					if k == axis || i&(1<<k) != 0 {
						continue
					}
					b := vs[i|(1<<k)]
					da, db := a[3]-level, b[3]-level
					if math.Abs(da) < 1e-10 {
						points = unique(points, Vec3{a[0], a[1], a[2]})
					}
					if math.Abs(db) < 1e-10 {
						points = unique(points, Vec3{b[0], b[1], b[2]})
					}
					if (da < -1e-10 && db > 1e-10) || (db < -1e-10 && da > 1e-10) {
						p := mix(a, b, da/(da-db))
						points = unique(points, Vec3{p[0], p[1], p[2]})
					}
				}
			}
			for _, p := range points {
				all = unique(all, p)
			}
			if dimension(points) != 2 {
				continue
			} // A cell coincident with the plane is a solid, not a face.
			duplicate := false
			for _, f := range faces {
				if len(f) != len(points) {
					continue
				}
				same := true
				for _, p := range points {
					if !contains(f, p) {
						same = false
						break
					}
				}
				if same {
					duplicate = true
					break
				}
			}
			if duplicate {
				continue
			}
			points = order(points)
			faces = append(faces, points)
			if fill {
				r.Faces = append(r.Faces, Face{points, axis})
			}
			for i, a := range points {
				b := points[(i+1)%len(points)]
				found := false
				for _, e := range edges {
					if (samePoint(e[0], a) && samePoint(e[1], b)) || (samePoint(e[0], b) && samePoint(e[1], a)) {
						found = true
						break
					}
				}
				if !found {
					edges = append(edges, [2]Vec3{a, b})
					r.Paths = append(r.Paths, Path{Points: []Vec3{a, b}, Family: axis})
				}
			}
		}
	}
	dim := dimension(all)
	if dim == 0 {
		r.Points = append(r.Points, all...)
	}
	if dim == 1 { // Tangential section: keep the segment even without any faces.
		a, b := all[0], all[1]
		best := 0.
		for _, p := range all {
			for _, q := range all {
				d := sub(p, q)
				if dot(d, d) > best {
					a, b, best = p, q, dot(d, d)
				}
			}
		}
		r.Paths = append(r.Paths, Path{Points: []Vec3{a, b}})
		edges = append(edges, [2]Vec3{a, b})
	}
	r.Sections = append(r.Sections, Section{Level: level, Vertices: len(all), Edges: len(edges), Faces: len(faces), Dimension: dim})
}
