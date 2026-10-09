package engine3

import (
	"fmt"
	"math"
)

// RaysRequest lights a surface patch for a single interaction: Interaction
// "reflect" makes it a mirror, and "refract" an interface between a medium
// of refractive index N1, on the normal's side, and N2 beyond, with the
// ratio η = N1/N2. Light "parallel" travels along (cos β cos α, cos β sin α,
// sin β), with azimuth α and elevation β in degrees; light "point" leaves
// Source. The patch's normal declares the side the light arrives from: a
// sample is lit only when the light arrives against the normal, I·n < 0.
// Nothing else is inferred: every lit sample reflects or refracts, whether
// or not another part of the surface stands in the way of its incident or
// outgoing ray, and a transmitted ray never meets the surface again. Each
// representative ray is drawn Length along the outgoing direction, and as
// far back behind the surface; parallel light arrives from Length away.
// Receiver optionally collects the outgoing rays on a plane.
type RaysRequest struct {
	Interaction string          `json:"interaction"`
	N1          float64         `json:"n1"`
	N2          float64         `json:"n2"`
	Light       string          `json:"light"`
	Azimuth     float64         `json:"azimuth"`
	Elevation   float64         `json:"elevation"`
	Source      Vec3            `json:"source"`
	Length      float64         `json:"length"`
	Receiver    ReceiverRequest `json:"receiver"`
}

// Ray is a representative ray at sample (I, J): incident from Start to
// Point, reflected or transmitted from Point to End, and its virtual
// extension from Point back to Back. Virtual says whether either of its
// caustic points lies behind the surface, where the extension leads. Total
// marks light beyond the critical angle: nothing is transmitted, End is
// along the totally reflected ray, and Back is Point.
type Ray struct {
	I       int  `json:"i"`
	J       int  `json:"j"`
	Start   Vec3 `json:"start"`
	Point   Vec3 `json:"point"`
	End     Vec3 `json:"end"`
	Back    Vec3 `json:"back"`
	Virtual bool `json:"virtual"`
	Total   bool `json:"total"`
}

// CausticSheet is the real or virtual part of caustic branch Branch (1 or
// 2): the points X + R/μ where μ, the outgoing wavefront's principal
// curvature, is positive (real, ahead of the surface) or negative (virtual,
// behind it). Its normal is the wavefront's principal direction, and Shape
// is classified as a focal sheet's is.
type CausticSheet struct {
	SurfaceSheet
	Branch  int    `json:"branch"`
	Virtual bool   `json:"virtual"`
	Shape   string `json:"shape"`
}

// RaysResult holds the surface, the four caustic parts (branch 1 real and
// virtual, then branch 2), and representative rays where the parameter
// curves cross. Source is the point source, or nil. Singular counts chart
// singularities, AtSource samples at the source, Unlit samples where the
// light grazes the surface or arrives behind it, Total lit samples beyond
// the critical angle, and Stigmatic samples where μ₁ = μ₂ and the two
// branches meet. Clipped[k] counts traced samples whose branch k+1 caustic
// point is beyond focalReach surface radii, at infinity. Receiver is the
// receiver plane's study, or nil.
type RaysResult struct {
	Surface   SurfaceSheet   `json:"surface"`
	Caustics  []CausticSheet `json:"caustics"`
	Lines     []Ray          `json:"lines"`
	UCurves   []int          `json:"uCurves"`
	VCurves   []int          `json:"vCurves"`
	Source    *Vec3          `json:"source"`
	Singular  int            `json:"singular"`
	Unlit     int            `json:"unlit"`
	AtSource  int            `json:"atSource"`
	Stigmatic int            `json:"stigmatic"`
	Total     int            `json:"total"`
	Clipped   []int          `json:"clipped"`
	Receiver  *Receiver      `json:"receiver"`
}

func (r RaysRequest) validate() error {
	switch r.Interaction {
	case "reflect":
	case "refract":
		if !index(r.N1) || !index(r.N2) {
			return fieldErr(map[bool]string{true: "rays.n2", false: "rays.n1"}[index(r.N1)], "the refractive indices n₁ and n₂ must be finite, positive and at most 100")
		}
	default:
		return fieldErr("rays.interaction", "the interaction must be reflect or refract")
	}
	switch r.Light {
	case "parallel":
		if !bounded(r.Azimuth) || !bounded(r.Elevation) {
			return fieldErr(map[bool]string{true: "rays.elevation", false: "rays.azimuth"}[bounded(r.Azimuth)], "the azimuth α and elevation β must be finite and within ±100000 degrees")
		}
	case "point":
		if !bounded(r.Source.X) || !bounded(r.Source.Y) || !bounded(r.Source.Z) {
			return fieldErr(axis("rays.source", r.Source, bounded), "the source must be finite and within ±100000 on each axis")
		}
	default:
		return fieldErr("rays.light", "the light must be parallel or a point source")
	}
	if !finite(r.Length) || r.Length < 0 || r.Length > 1e5 {
		return fieldErr("rays.length", "the ray length ℓ must be finite and within 0–100000")
	}
	return r.Receiver.validate()
}

func index(n float64) bool { return finite(n) && n > 0 && n <= 100 }

// sincosDegrees is exact at multiples of a right angle.
func sincosDegrees(d float64) (float64, float64) {
	r := math.Mod(d, 360)
	if r < 0 {
		r += 360
	}
	switch r {
	case 0:
		return 0, 1
	case 90:
		return 1, 0
	case 180:
		return 0, -1
	case 270:
		return -1, 0
	}
	return math.Sincos(r * math.Pi / 180)
}

// direction is parallel light's direction of travel.
func (r RaysRequest) direction() Vec3 {
	sa, ca := sincosDegrees(r.Azimuth)
	se, ce := sincosDegrees(r.Elevation)
	return Vec3{ce * ca, ce * sa, se}
}

// mirrorPoint is the reflection at one parameter point. Without a normal
// (a chart singularity) or at the source nothing but X is defined; unlit, X,
// N and I are.
type mirrorPoint struct {
	X, N      Vec3
	Normal    bool
	AtSource  bool
	Lit       bool
	Total     bool
	I, R      Vec3
	Mu        [2]float64
	Dir       [2]Vec3
	Stigmatic bool
	// Twist is the antisymmetric part of the wavefront's shape operator,
	// zero for the normal congruence a reflection makes.
	Twist float64
}

// ray reflects the light at (u, v); scale is the surface's size, against
// which μ₁ = μ₂ is judged.
//
// The reflected rays Y = X + λR have caustic points where det(Y_u, Y_v, R) =
// 0. Across R, in an orthonormal basis f₁, f₂ of R's normal plane, a step
// (du, dv) moves the ray's foot by Ā(du, dv) and turns it by B̄(du, dv),
// with Ā = [f·X_u, f·X_v] and B̄ = [f·R_u, f·R_v]. The determinant vanishes
// where det(Ā + λB̄) does, λ = 1/μ for the eigenvalues μ of W = −B̄Ā⁻¹, the
// reflected wavefront's shape operator (dR = −W dP), in the focal sheets'
// sign convention: the caustic is X + R/μ, real when μ > 0. Ā is invertible
// wherever the light is not grazing. W is symmetric by the theorem of Malus
// and Dupin; its eigenvalues are taken from its symmetric part as κ's are.
// R_u and R_v are exact, from n_u = (c_u − n(n·c_u))/|c|, c = ±X_u × X_v,
// and I_u = (X_u − I(I·X_u))/|X − S| for a point source.
func (q SurfaceRequest) ray(r RaysRequest, u, v, scale float64) mirrorPoint {
	x, xu, xv, xuu, xuv, xvv := q.patch(u, v)
	p := mirrorPoint{X: x}
	c := xu.cross(xv)
	area := c.norm()
	big := math.Max(xu.norm(), xv.norm())
	if !(area > 1e-9*big*big) {
		return p
	}
	sign := 1.0
	if q.Reverse {
		sign = -1
	}
	n := c.mul(sign / area)
	p.N, p.Normal = n, true
	cu := xuu.cross(xv).add(xu.cross(xuv))
	cv := xuv.cross(xv).add(xu.cross(xvv))
	nu := cu.sub(n.mul(n.dot(cu))).mul(sign / area)
	nv := cv.sub(n.mul(n.dot(cv))).mul(sign / area)
	in, iu, iv := r.direction(), Vec3{}, Vec3{}
	if r.Light == "point" {
		w := x.sub(r.Source)
		d := w.norm()
		if !(d > 1e-9*scale) {
			p.AtSource = true
			return p
		}
		in = w.mul(1 / d)
		iu = xu.sub(in.mul(in.dot(xu))).mul(1 / d)
		iv = xv.sub(in.mul(in.dot(xv))).mul(1 / d)
	}
	p.I = in
	cos := in.dot(n)
	if !(cos < -1e-9) {
		return p
	}
	p.Lit = true
	// Reflection is R = I + 2c n and refraction T = ηI + (ηc − √k) n, with
	// c = −I·n and k = 1 − η²(1 − c²); so D = aI + b n, with derivatives
	// D_u = a I_u + b_u n + b n_u, c_u = −(I_u·n + I·n_u), and (√k)_u =
	// η²c c_u/√k. √k is the transmitted ray's cosine: at or below 10⁻⁹ the
	// light is at or beyond the critical angle, totally reflected.
	c0 := -cos
	cu0, cv0 := -(iu.dot(n) + in.dot(nu)), -(iv.dot(n) + in.dot(nv))
	a, b, bu, bv := 1.0, 2*c0, 2*cu0, 2*cv0
	if r.Interaction == "refract" {
		eta := r.N1 / r.N2
		root := math.Sqrt(math.Max(0, 1-eta*eta*(1-c0*c0)))
		if !(root > 1e-9) {
			p.Total = true
			return p
		}
		a, b = eta, eta*c0-root
		bu, bv = eta*cu0*(1-eta*c0/root), eta*cv0*(1-eta*c0/root)
	}
	d := in.mul(a).add(n.mul(b))
	du := iu.mul(a).add(n.mul(bu)).add(nu.mul(b))
	dv := iv.mul(a).add(n.mul(bv)).add(nv.mul(b))
	p.R = d
	f1 := xu.sub(d.mul(d.dot(xu)))
	if g := xv.sub(d.mul(d.dot(xv))); g.norm() > f1.norm() {
		f1 = g
	}
	f1 = f1.unit()
	f2 := d.cross(f1)
	a11, a12, a21, a22 := f1.dot(xu), f1.dot(xv), f2.dot(xu), f2.dot(xv)
	b11, b12, b21, b22 := f1.dot(du), f1.dot(dv), f2.dot(du), f2.dot(dv)
	det := a11*a22 - a12*a21
	w11 := (b12*a21 - b11*a22) / det
	w12 := (b11*a12 - b12*a11) / det
	w21 := (b22*a21 - b21*a22) / det
	w22 := (b21*a12 - b22*a11) / det
	sym := (w12 + w21) / 2
	p.Twist = (w12 - w21) / 2
	mean, spread := (w11+w22)/2, math.Hypot((w11-w22)/2, sym)
	theta := math.Atan2(2*sym, w11-w22) / 2
	e1 := f1.mul(math.Cos(theta)).add(f2.mul(math.Sin(theta)))
	p.Mu = [2]float64{mean + spread, mean - spread}
	p.Dir = [2]Vec3{e1, d.cross(e1)}
	p.Stigmatic = spread <= 1e-9*(math.Abs(mean)+1/scale)
	return p
}

// caustic returns branch k's caustic point, which is at infinity unless
// |μ_k| exceeds 1/reach (see finite).
func (p mirrorPoint) caustic(k int) Vec3 { return p.X.add(p.R.mul(1 / p.Mu[k])) }

func (p mirrorPoint) finite(k int, reach float64) bool {
	return p.traced() && math.Abs(p.Mu[k])*reach > 1
}

// traced says whether the light leaves the sample along R: it is lit and,
// refracting, not totally reflected.
func (p mirrorPoint) traced() bool { return p.Lit && !p.Total }

// rays samples the mirror, its caustic parts, and representative rays.
// With surfaceProbe it also returns the mirror's own surface probe, as a
// surface study of the patch would; with lightProbe, the outgoing
// wavefront's (see lightProbe).
func rays(q SurfaceRequest, r RaysRequest, surfaceProbe, light bool) (Result, error) {
	if err := q.validatePatch(); err != nil {
		return Result{}, err
	}
	if err := r.validate(); err != nil {
		return Result{}, err
	}
	if surfaceProbe && light {
		return Result{}, fmt.Errorf("probe the mirror (surfaceDiagnostics) or the light (lightDiagnostics), not both")
	}
	positions, scale, err := q.positions()
	if err != nil {
		return Result{}, err
	}
	reach := focalReach * scale
	nu, nv := q.USamples, q.VSamples
	out := &RaysResult{UCurves: representatives(nv, q.Curves), VCurves: representatives(nu, q.Curves), Lines: []Ray{}, Clipped: []int{0, 0}}
	if r.Light == "point" {
		s := r.Source
		out.Source = &s
	}
	samples := grid2[mirrorPoint](nu+1, nv+1)
	points, normals := grid2[*Vec3](nu+1, nv+1), grid2[*Vec3](nu+1, nv+1)
	// parts[k][virtual] holds branch k's points and normals.
	parts := [2][2][2][][]*Vec3{}
	for k := range parts {
		for part := range parts[k] {
			parts[k][part] = [2][][]*Vec3{grid2[*Vec3](nu+1, nv+1), grid2[*Vec3](nu+1, nv+1)}
		}
	}
	for i := 0; i <= nu; i++ {
		for j := 0; j <= nv; j++ {
			u, v := q.at(i, j)
			s := q.ray(r, u, v, scale)
			samples[i][j] = s
			x, n := s.X, s.N
			points[i][j] = &x
			switch {
			case !s.Normal:
				out.Singular++
				continue
			case s.AtSource:
				out.AtSource++
			case !s.Lit:
				out.Unlit++
			}
			normals[i][j] = &n
			if s.Total {
				out.Total++
			}
			if !s.traced() {
				continue
			}
			if s.Stigmatic {
				out.Stigmatic++
			}
			for k := range parts {
				if !s.finite(k, reach) {
					out.Clipped[k]++
					continue
				}
				part := 0
				if s.Mu[k] < 0 {
					part = 1
				}
				c := s.caustic(k)
				parts[k][part][0][i][j] = &c
				if !s.Stigmatic {
					e := s.Dir[k]
					parts[k][part][1][i][j] = &e
				}
			}
		}
	}
	always := func(i, j, di, dj int) bool { return true }
	out.Surface = sheet(points, normals, always, scale)
	families := [][]*Vec3{positions}
	for k := range parts {
		for part := range parts[k] {
			pts := parts[k][part][0]
			join := func(i, j, di, dj int) bool {
				u0, v0 := q.at(i, j)
				u1, v1 := q.at(i+di, j+dj)
				var middle *Vec3
				if m := q.ray(r, (u0+u1)/2, (v0+v1)/2, scale); m.finite(k, reach) {
					c := m.caustic(k)
					middle = &c
				}
				return continues(samples[i][j].Mu[k], samples[i+di][j+dj].Mu[k], *pts[i][j], *pts[i+di][j+dj], middle, scale)
			}
			s := sheet(pts, parts[k][part][1], join, scale)
			out.Caustics = append(out.Caustics, CausticSheet{SurfaceSheet: s, Branch: k + 1, Virtual: part == 1, Shape: spans(s, scale)})
			families = append(families, flatten(pts))
		}
	}
	if r.Length > 0 {
		for _, i := range out.VCurves {
			for _, j := range out.UCurves {
				s := samples[i][j]
				if !s.Lit {
					continue
				}
				start := s.X.sub(s.I.mul(r.Length))
				if out.Source != nil {
					start = *out.Source
				}
				if s.Total {
					reflected := s.I.sub(s.N.mul(2 * s.I.dot(s.N)))
					out.Lines = append(out.Lines, Ray{i, j, start, s.X, s.X.add(reflected.mul(r.Length)), s.X, false, true})
					continue
				}
				virtual := false
				for k := range s.Mu {
					virtual = virtual || s.Mu[k] < 0 && s.finite(k, reach)
				}
				out.Lines = append(out.Lines, Ray{i, j, start, s.X, s.X.add(s.R.mul(r.Length)), s.X.sub(s.R.mul(r.Length)), virtual, false})
			}
		}
	}
	// The rays and the source fit with the surface; each caustic part fits
	// on its own, so the fences trim only its asymptotic tails, and the
	// receiver's four corners are never trimmed.
	for k := range out.Lines {
		l := &out.Lines[k]
		families[0] = append(families[0], &l.Start, &l.End, &l.Back)
	}
	if out.Source != nil {
		families[0] = append(families[0], out.Source)
	}
	if r.Receiver.Plane != "none" {
		out.Receiver = q.receive(r, samples, scale)
		corners := []*Vec3{}
		for k := range out.Receiver.Corners {
			corners = append(corners, &out.Receiver.Corners[k])
		}
		families = append(families, corners)
	}
	bounds := fit(families...)
	result := Result{Bounds: bounds, Radius: bounds.Radius, Breaks: []bool{}, Base: []*Vec3{}, Minus: []*Vec3{}, Plus: []*Vec3{}, Mesh: emptyMesh(), Rulings: []Ruling{}, Rays: out}
	switch {
	case light:
		result.Probe = lightProbe(q, r, samples, reach)
	case surfaceProbe:
		patch := grid2[surfacePoint](nu+1, nv+1)
		for i := range patch {
			for j := range patch[i] {
				u, v := q.at(i, j)
				patch[i][j] = q.point(u, v, scale)
			}
		}
		result.Probe = patchProbe(q, patch, scale)
	}
	return result, nil
}

// The light probe's state at a sample: traced along its outgoing ray, unlit
// (the light grazes it or arrives behind it), beyond the critical angle
// (totally reflected), at the point source, or a chart singularity.
const (
	lightTraced = iota
	lightUnlit
	lightTotal
	lightAtSource
	lightSingular
)

// LightDiagnostics is what the light probe adds to the outgoing wavefront's
// SurfaceDiagnostics, on the same grid: the incident direction I (nil at a
// singularity or the source), the surface's declared normal n (nil at a
// singularity), the outgoing direction (the ray R where traced, the totally
// reflected ray beyond the critical angle, otherwise nil), and each
// sample's state (lightTraced … lightSingular). Length is the ray length ℓ
// the representative rays are drawn with. Unlit, Total and AtSource count
// samples as RaysResult does.
type LightDiagnostics struct {
	Length   float64   `json:"length"`
	Incident [][]*Vec3 `json:"incident"`
	Surface  [][]*Vec3 `json:"surface"`
	Outgoing [][]*Vec3 `json:"outgoing"`
	State    [][]int   `json:"state"`
	Unlit    int       `json:"unlit"`
	Total    int       `json:"total"`
	AtSource int       `json:"atSource"`
}

// lightProbe describes the outgoing wavefront at the mirror's own samples,
// as the surface probe describes a surface: its normal is the ray R, its
// principal curvatures μ₁ ≥ μ₂ and directions are W's (see ray), and its
// focal points X + R/μ are the caustic points, at infinity beyond reach as
// the caustic sheets' are. A stigmatic sample has no principal directions
// and is counted as an umbilic. Where nothing leaves along R the sample has
// a point but no wavefront.
func lightProbe(q SurfaceRequest, r RaysRequest, samples [][]mirrorPoint, reach float64) *SurfaceDiagnostics {
	nu, nv := q.USamples, q.VSamples
	d := newSurfaceDiagnostics("wavefront", nu+1, nv+1)
	for i := 0; i <= nu; i++ {
		d.Along[i], d.U[i] = i, lerp(q.UMin, q.UMax, i, nu)
	}
	for j := 0; j <= nv; j++ {
		d.V[j] = lerp(q.VMin, q.VMax, j, nv)
	}
	l := &LightDiagnostics{Length: r.Length, Incident: grid2[*Vec3](nu+1, nv+1), Surface: grid2[*Vec3](nu+1, nv+1), Outgoing: grid2[*Vec3](nu+1, nv+1), State: grid2[int](nu+1, nv+1)}
	d.Light = l
	for i, row := range samples {
		for j, s := range row {
			x := s.X
			d.Points[i][j] = &x
			if !s.Normal {
				l.State[i][j] = lightSingular
				d.Singular++
				continue
			}
			n := s.N
			l.Surface[i][j] = &n
			if s.AtSource {
				l.State[i][j] = lightAtSource
				l.AtSource++
				continue
			}
			in := s.I
			l.Incident[i][j] = &in
			if !s.Lit {
				l.State[i][j] = lightUnlit
				l.Unlit++
				continue
			}
			if s.Total {
				reflected := in.sub(n.mul(2 * in.dot(n)))
				l.Outgoing[i][j] = &reflected
				l.State[i][j] = lightTotal
				l.Total++
				continue
			}
			ray := s.R
			d.Normals[i][j], l.Outgoing[i][j] = &ray, &ray
			if s.Stigmatic {
				d.Umbilics++
			}
			for k := 0; k < 2; k++ {
				mu := s.Mu[k]
				d.Curvature[k][i][j] = &mu
				if !s.Stigmatic {
					e := s.Dir[k]
					d.Direction[k][i][j] = &e
				}
				if !s.finite(k, reach) {
					d.Clipped[k]++
					continue
				}
				c := s.caustic(k)
				d.Focal[k][i][j] = &c
			}
		}
	}
	return d
}
