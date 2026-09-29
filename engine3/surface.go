package engine3

import (
	"fmt"
	"math"
)

// SurfaceRequest is an analytic patch X(u, v) over [UMin, UMax] × [VMin,
// VMax], sampled on a USamples × VSamples grid of cells. A, B and C are the
// shape: an ellipsoid's semi-axes along x, y and z (a sphere when equal);
// a torus's major radius R = A ≥ 0 and minor radius r = B > 0 (a spindle
// torus when R < r); an elliptic cylinder's semi-axes A and B; a
// paraboloid z = (A x² + B y²)/2, whose principal curvatures at the vertex
// are A and B; and a monkey saddle z = A(x³ − 3xy²).
//
// The normal is n = X_u × X_v / |X_u × X_v|, or its opposite when Reverse
// is set. The shape operator is A = −dn, so κ > 0 where the surface bends
// towards n; a sphere with its outward normal has κ = −1/R. The offset is
// X + Offset·n, and each normal line runs from X to X + Reach·n.
type SurfaceRequest struct {
	Kind     string  `json:"kind"`
	A        float64 `json:"a"`
	B        float64 `json:"b"`
	C        float64 `json:"c"`
	UMin     float64 `json:"uMin"`
	UMax     float64 `json:"uMax"`
	VMin     float64 `json:"vMin"`
	VMax     float64 `json:"vMax"`
	USamples int     `json:"uSamples"`
	VSamples int     `json:"vSamples"`
	Curves   int     `json:"curves"`
	Reverse  bool    `json:"reverse"`
	Offset   float64 `json:"offset"`
	Reach    float64 `json:"reach"`
}

// SurfaceSheet is a surface sampled on the parameter grid. Points[i][j] is
// at u_i, v_j, nil where it is undefined, and Normals likewise; a normal is
// also nil where the sheet has none, as at a chart singularity, an umbilic
// of a focal sheet, or a focal sheet's cuspidal edge, and is then shaded by
// its faces. AlongU[i][j] joins (i, j) to (i+1, j), AlongV[i][j] joins
// (i, j) to (i, j+1), and Faces[i][j] says whether the cell between (i, j)
// and (i+1, j+1) is a face: its four edges are joined and it has area.
type SurfaceSheet struct {
	Points  [][]*Vec3 `json:"points"`
	Normals [][]*Vec3 `json:"normals"`
	AlongU  [][]bool  `json:"alongU"`
	AlongV  [][]bool  `json:"alongV"`
	Faces   [][]bool  `json:"faces"`
}

// FocalSheet is the branch X + n/κᵢ of the focal set, κ₁ ≥ κ₂. Shape is
// "surface" when it has a face, "point" when every focal point is one
// point, "curve" otherwise, and "none" when every focal point is at
// infinity. Clipped counts samples with a normal whose focal point is more
// than focalReach surface radii away, which are treated as at infinity.
// Its normal is the principal direction eᵢ.
type FocalSheet struct {
	SurfaceSheet
	Shape   string `json:"shape"`
	Clipped int    `json:"clipped"`
}

// SurfaceNormal is a representative normal line at sample (I, J), from
// Point to End = Point + Reach·n.
type SurfaceNormal struct {
	I     int  `json:"i"`
	J     int  `json:"j"`
	Point Vec3 `json:"point"`
	End   Vec3 `json:"end"`
}

// SurfaceResult holds the surface, its offset (nil when the offset is 0),
// and the two focal sheets, all on the same grid, with representative
// parameter curves: UCurves are the v indices of the curves along which u
// runs, and VCurves the u indices of those along which v runs. Normal lines
// stand where they cross. Singular counts samples where X_u × X_v vanishes,
// with no normal; Umbilics those where κ₁ = κ₂; Folded those where the
// offset lies beyond one focal sheet, (1 − dκ₁)(1 − dκ₂) < 0.
type SurfaceResult struct {
	Surface  SurfaceSheet    `json:"surface"`
	Offset   *SurfaceSheet   `json:"offset"`
	Focal    []FocalSheet    `json:"focal"`
	Lines    []SurfaceNormal `json:"lines"`
	UCurves  []int           `json:"uCurves"`
	VCurves  []int           `json:"vCurves"`
	Singular int             `json:"singular"`
	Umbilics int             `json:"umbilics"`
	Folded   int             `json:"folded"`
}

const (
	maxSurfaceSamples = 240
	maxSurfaceCells   = 14400
	maxSurfaceCurves  = 48
	// Focal points farther than this many surface radii are at infinity.
	focalReach = 100
)

func lerp(lo, hi float64, i, n int) float64 {
	return lo*(1-float64(i)/float64(n)) + hi*float64(i)/float64(n)
}

func (q SurfaceRequest) validate() error {
	if err := q.validatePatch(); err != nil {
		return err
	}
	if !bounded(q.Offset) {
		return fmt.Errorf("the offset distance d must be finite and within ±100000")
	}
	if !bounded(q.Reach) {
		return fmt.Errorf("the normal reach ℓ must be finite and within ±100000")
	}
	return nil
}

func bounded(v float64) bool { return finite(v) && math.Abs(v) <= 1e5 }

// validatePatch checks the patch, its domain, and its grid, which a ray
// study shares.
func (q SurfaceRequest) validatePatch() error {
	shape := func(v float64) bool { return finite(v) && v > 0 && v <= 1e5 }
	switch q.Kind {
	case "ellipsoid":
		if !shape(q.A) || !shape(q.B) || !shape(q.C) {
			return fmt.Errorf("the semi-axes a, b and c must be finite, positive, and at most 100000")
		}
	case "torus":
		if !finite(q.A) || q.A < 0 || q.A > 1e5 {
			return fmt.Errorf("the major radius R must be finite and within 0–100000")
		}
		if !shape(q.B) {
			return fmt.Errorf("the minor radius r must be finite, positive, and at most 100000")
		}
	case "cylinder":
		if !shape(q.A) || !shape(q.B) {
			return fmt.Errorf("the semi-axes a and b must be finite, positive, and at most 100000")
		}
	case "paraboloid":
		if !bounded(q.A) || !bounded(q.B) {
			return fmt.Errorf("the curvatures k₁ and k₂ must be finite and within ±100000")
		}
	case "monkey":
		if !bounded(q.A) {
			return fmt.Errorf("the height k must be finite and within ±100000")
		}
	default:
		return fmt.Errorf("unknown surface")
	}
	if domain(q.UMin, q.UMax) != nil {
		return fmt.Errorf("u domain: the start must be below the end, within ±1000000, with width 0.000001–100000")
	}
	if domain(q.VMin, q.VMax) != nil {
		return fmt.Errorf("v domain: the start must be below the end, within ±1000000, with width 0.000001–100000")
	}
	if q.USamples < 12 || q.VSamples < 12 || q.USamples > maxSurfaceSamples || q.VSamples > maxSurfaceSamples || q.USamples*q.VSamples > maxSurfaceCells {
		return fmt.Errorf("use 12–240 samples in each direction, with at most 14,400 cells")
	}
	if q.Curves < 2 || q.Curves > maxSurfaceCurves {
		return fmt.Errorf("use 2–48 parameter curves in each direction")
	}
	return nil
}

// patch returns X and its exact first and second partial derivatives.
func (q SurfaceRequest) patch(u, v float64) (x, xu, xv, xuu, xuv, xvv Vec3) {
	a, b, c := q.A, q.B, q.C
	cu, su, cv, sv := math.Cos(u), math.Sin(u), math.Cos(v), math.Sin(v)
	switch q.Kind {
	case "ellipsoid":
		return Vec3{a * cv * cu, b * cv * su, c * sv},
			Vec3{-a * cv * su, b * cv * cu, 0},
			Vec3{-a * sv * cu, -b * sv * su, c * cv},
			Vec3{-a * cv * cu, -b * cv * su, 0},
			Vec3{a * sv * su, -b * sv * cu, 0},
			Vec3{-a * cv * cu, -b * cv * su, -c * sv}
	case "torus":
		h := a + b*cv
		return Vec3{h * cu, h * su, b * sv},
			Vec3{-h * su, h * cu, 0},
			Vec3{-b * sv * cu, -b * sv * su, b * cv},
			Vec3{-h * cu, -h * su, 0},
			Vec3{b * sv * su, -b * sv * cu, 0},
			Vec3{-b * cv * cu, -b * cv * su, -b * sv}
	case "cylinder":
		return Vec3{a * cu, b * su, v}, Vec3{-a * su, b * cu, 0}, Vec3{0, 0, 1},
			Vec3{-a * cu, -b * su, 0}, Vec3{}, Vec3{}
	case "paraboloid":
		return Vec3{u, v, (a*u*u + b*v*v) / 2}, Vec3{1, 0, a * u}, Vec3{0, 1, b * v},
			Vec3{0, 0, a}, Vec3{}, Vec3{0, 0, b}
	default: // monkey saddle
		return Vec3{u, v, a * (u*u*u - 3*u*v*v)}, Vec3{1, 0, 3 * a * (u*u - v*v)}, Vec3{0, 1, -6 * a * u * v},
			Vec3{0, 0, 6 * a * u}, Vec3{0, 0, -6 * a * v}, Vec3{0, 0, -6 * a * u}
	}
}

// surfacePoint is the local geometry at one parameter point. Without a
// normal (a chart singularity), nothing but X is defined. Dir holds the
// principal directions e₁, e₂ with n = e₁ × e₂; at an umbilic they are an
// arbitrary orthonormal pair.
type surfacePoint struct {
	X, N    Vec3
	Normal  bool
	Kappa   [2]float64
	Dir     [2]Vec3
	Umbilic bool
	Area    float64
}

// point evaluates the patch at (u, v); scale is the surface's size, against
// which κ₁ = κ₂ is judged.
//
// The shape operator is written in the orthonormal tangent frame e_a =
// X_u/|X_u|, e_b = n × e_a as the symmetric matrix [[p, q], [q, s]] of the
// second fundamental form, so its eigenvalues κ = (p + s)/2 ± √(((p − s)/2)²
// + q²) come without the cancellation in H² − K, and a sphere's are equal
// to rounding.
func (q SurfaceRequest) point(u, v, scale float64) surfacePoint {
	x, xu, xv, xuu, xuv, xvv := q.patch(u, v)
	cross := xu.cross(xv)
	area := cross.norm()
	big := math.Max(xu.norm(), xv.norm())
	if !(area > 1e-9*big*big) {
		return surfacePoint{X: x}
	}
	n := cross.mul(1 / area)
	if q.Reverse {
		n = n.mul(-1)
	}
	L, M, N := xuu.dot(n), xuv.dot(n), xvv.dot(n)
	length := xu.norm()
	ea := xu.mul(1 / length)
	eb := n.cross(ea)
	// e_b = αX_u + βX_v.
	beta := 1 / xv.dot(eb)
	alpha := -xv.dot(ea) / length * beta
	p := L / (length * length)
	r := (alpha*L + beta*M) / length
	s := alpha*alpha*L + 2*alpha*beta*M + beta*beta*N
	mean, spread := (p+s)/2, math.Hypot((p-s)/2, r)
	theta := math.Atan2(2*r, p-s) / 2
	e1 := ea.mul(math.Cos(theta)).add(eb.mul(math.Sin(theta)))
	return surfacePoint{
		X: x, N: n, Normal: true,
		Kappa:   [2]float64{mean + spread, mean - spread},
		Dir:     [2]Vec3{e1, n.cross(e1)},
		Umbilic: spread <= 1e-9*(math.Abs(mean)+1/scale),
		Area:    area,
	}
}

// focal returns branch k's focal point, or false at infinity.
func (p surfacePoint) focal(k int, reach float64) (Vec3, bool) {
	if !p.Normal || !(math.Abs(p.Kappa[k])*reach > 1) {
		return Vec3{}, false
	}
	return p.X.add(p.N.mul(1 / p.Kappa[k])), true
}

// representatives returns count evenly spaced indices in 0…n, without
// repeats.
func representatives(n, count int) []int {
	out := []int{}
	for k := 0; k < count; k++ {
		if i := k * n / (count - 1); len(out) == 0 || out[len(out)-1] != i {
			out = append(out, i)
		}
	}
	return out
}

func grid2[T any](nu, nv int) [][]T {
	out := make([][]T, nu)
	for i := range out {
		out[i] = make([]T, nv)
	}
	return out
}

// sheet joins the grid's points: an edge wherever join allows it, and a
// face wherever its four edges are joined and it is not degenerate, with an
// area above 10⁻⁹ of the surface's size times its diagonal.
func sheet(points, normals [][]*Vec3, join func(i, j, di, dj int) bool, scale float64) SurfaceSheet {
	nu, nv := len(points)-1, len(points[0])-1
	s := SurfaceSheet{Points: points, Normals: normals, AlongU: grid2[bool](nu, nv+1), AlongV: grid2[bool](nu+1, nv), Faces: grid2[bool](nu, nv)}
	for i := 0; i <= nu; i++ {
		for j := 0; j <= nv; j++ {
			if i < nu {
				s.AlongU[i][j] = points[i][j] != nil && points[i+1][j] != nil && join(i, j, 1, 0)
			}
			if j < nv {
				s.AlongV[i][j] = points[i][j] != nil && points[i][j+1] != nil && join(i, j, 0, 1)
			}
		}
	}
	for i := 0; i < nu; i++ {
		for j := 0; j < nv; j++ {
			if !s.AlongU[i][j] || !s.AlongU[i][j+1] || !s.AlongV[i][j] || !s.AlongV[i+1][j] {
				continue
			}
			d1, d2 := points[i+1][j+1].sub(*points[i][j]), points[i][j+1].sub(*points[i+1][j])
			s.Faces[i][j] = d1.cross(d2).norm()/2 > 1e-9*scale*math.Max(d1.norm(), d2.norm())
		}
	}
	return s
}

// at returns the parameters of sample (i, j).
func (q SurfaceRequest) at(i, j int) (float64, float64) {
	return lerp(q.UMin, q.UMax, i, q.USamples), lerp(q.VMin, q.VMax, j, q.VSamples)
}

// positions samples the patch's points and returns them with the surface's
// size, which sets the tolerances.
func (q SurfaceRequest) positions() ([]*Vec3, float64, error) {
	positions := make([]*Vec3, 0, (q.USamples+1)*(q.VSamples+1))
	for i := 0; i <= q.USamples; i++ {
		for j := 0; j <= q.VSamples; j++ {
			x, _, _, _, _, _ := q.patch(q.at(i, j))
			if !x.valid() {
				return nil, 0, fmt.Errorf("the surface has no finite point at sample (%d, %d)", i, j)
			}
			positions = append(positions, &x)
		}
	}
	return positions, fit(positions).Radius, nil
}

// surfaces samples the patch, its offset and focal sheets, and the
// representative parameter curves and normal lines.
func surfaces(q SurfaceRequest) (Result, error) {
	if err := q.validate(); err != nil {
		return Result{}, err
	}
	nu, nv := q.USamples, q.VSamples
	at := q.at
	positions, scale, err := q.positions()
	if err != nil {
		return Result{}, err
	}
	reach := focalReach * scale
	out := &SurfaceResult{UCurves: representatives(nv, q.Curves), VCurves: representatives(nu, q.Curves), Lines: []SurfaceNormal{}}
	samples := grid2[surfacePoint](nu+1, nv+1)
	points, normals := grid2[*Vec3](nu+1, nv+1), grid2[*Vec3](nu+1, nv+1)
	var offsets, offsetNormals [][]*Vec3
	if q.Offset != 0 {
		offsets, offsetNormals = grid2[*Vec3](nu+1, nv+1), grid2[*Vec3](nu+1, nv+1)
	}
	focal := [2][2][][]*Vec3{}
	for k := range focal {
		focal[k] = [2][][]*Vec3{grid2[*Vec3](nu+1, nv+1), grid2[*Vec3](nu+1, nv+1)}
	}
	clipped := [2]int{}
	for i := 0; i <= nu; i++ {
		for j := 0; j <= nv; j++ {
			u, v := at(i, j)
			s := q.point(u, v, scale)
			samples[i][j] = s
			x, n := s.X, s.N
			points[i][j] = &x
			if !s.Normal {
				out.Singular++
				continue
			}
			normals[i][j] = &n
			if s.Umbilic {
				out.Umbilics++
			}
			if offsets != nil {
				o := x.add(n.mul(q.Offset))
				offsets[i][j], offsetNormals[i][j] = &o, &n
				if (1-q.Offset*s.Kappa[0])*(1-q.Offset*s.Kappa[1]) < 0 {
					out.Folded++
				}
			}
			for k := range focal {
				f, ok := s.focal(k, reach)
				if !ok {
					clipped[k]++
					continue
				}
				focal[k][0][i][j] = &f
				if !s.Umbilic {
					e := s.Dir[k]
					focal[k][1][i][j] = &e
				}
			}
		}
	}
	always := func(i, j, di, dj int) bool { return true }
	out.Surface = sheet(points, normals, always, scale)
	if offsets != nil {
		s := sheet(offsets, offsetNormals, always, scale)
		out.Offset = &s
	}
	for k := range focal {
		join := func(i, j, di, dj int) bool {
			u0, v0 := at(i, j)
			u1, v1 := at(i+di, j+dj)
			m, ok := q.point((u0+u1)/2, (v0+v1)/2, scale).focal(k, reach)
			var middle *Vec3
			if ok {
				middle = &m
			}
			return continues(samples[i][j].Kappa[k], samples[i+di][j+dj].Kappa[k], *focal[k][0][i][j], *focal[k][0][i+di][j+dj], middle, scale)
		}
		f := FocalSheet{SurfaceSheet: sheet(focal[k][0], focal[k][1], join, scale), Clipped: clipped[k]}
		f.Shape = spans(f.SurfaceSheet, scale)
		out.Focal = append(out.Focal, f)
	}
	if q.Reach != 0 {
		for _, i := range out.VCurves {
			for _, j := range out.UCurves {
				if n := normals[i][j]; n != nil {
					x := *points[i][j]
					out.Lines = append(out.Lines, SurfaceNormal{i, j, x, x.add(n.mul(q.Reach))})
				}
			}
		}
	}
	// The sparse normal lines fit with the surface they stand on; the
	// offset and each focal sheet fit on their own, so the fences trim only
	// a focal sheet's asymptotic tails.
	families := [][]*Vec3{positions}
	for k := range out.Lines {
		families[0] = append(families[0], &out.Lines[k].End)
	}
	if out.Offset != nil {
		families = append(families, flatten(out.Offset.Points))
	}
	for _, f := range out.Focal {
		families = append(families, flatten(f.Points))
	}
	bounds := fit(families...)
	return Result{Bounds: bounds, Radius: bounds.Radius, Breaks: []bool{}, Base: []*Vec3{}, Minus: []*Vec3{}, Plus: []*Vec3{}, Mesh: []Vertex{}, Rulings: []Ruling{}, Surface: out}, nil
}

// continues reports whether a focal branch runs from p0 to p1 without
// passing through infinity: its curvatures k0 and k1 at the ends share a
// sign, and its focal point at the edge's midpoint is finite (not nil) and
// does not turn back. The midpoint catches κ touching zero between samples;
// the sign catches a crossing whose midpoint happens to lie between.
func continues(k0, k1 float64, p0, p1 Vec3, middle *Vec3, scale float64) bool {
	return k0*k1 > 0 && middle != nil && middle.sub(p0).dot(p1.sub(*middle)) >= -1e-18*scale*scale
}

func flatten(points [][]*Vec3) []*Vec3 {
	out := []*Vec3{}
	for _, column := range points {
		out = append(out, column...)
	}
	return out
}

// spans classifies a focal sheet by what its points actually span.
func spans(s SurfaceSheet, scale float64) string {
	var first *Vec3
	point := true
	for _, column := range s.Points {
		for _, p := range column {
			if p == nil {
				continue
			}
			if first == nil {
				first = p
			} else if p.sub(*first).norm() > 1e-9*scale {
				point = false
			}
		}
	}
	switch {
	case first == nil:
		return "none"
	case point:
		return "point"
	}
	for _, column := range s.Faces {
		for _, face := range column {
			if face {
				return "surface"
			}
		}
	}
	return "curve"
}
