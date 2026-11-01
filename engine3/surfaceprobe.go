package engine3

import "math"

// SurfaceDiagnostics describes a surface at the points the surface probe can
// visit, on a grid of rows and columns: Points[r][k] is at parameters U[r]
// and V[k]. Kind is "patch" for an analytic patch, whose grid is its own
// (row r is u sample r), or "canal" for a canal surface, whose row r is base
// sample Along[r] and whose column k is the turn V[k] = 2πk/K from θ₀ around
// the contact circle, measured in the frame that carries the meridians;
// Periodic is then set, and the columns do not repeat the first. Kind is
// "developable", "framed" or "ruled" for those surfaces built on a curve,
// whose row r is also base sample Along[r] and whose column k is the point
// u = V[k] along the ruling through it (see ruledProbe).
//
// With the normal n and A = −dn, as for the patch's focal sheets, each
// sample has two principal curvatures with unit principal directions and
// focal points X + n/κ. A patch, framed ribbon and ruled surface number
// them κ₁ ≥ κ₂. A canal numbers them by line of curvature: branch 0 runs
// around the contact circle, where κ = −1/R and the focal point is the
// sphere's center on the base; branch 1 runs across it. A developable's
// branch 0 runs along the ruling, where κ = 0, and branch 1 across it.
//
// A point is nil where the surface has none (no real contact circle, no
// partner, no frame). A normal is nil where the surface is singular there,
// counted by Singular: a patch's chart singularity, a canal's collapsed
// circle or its cuspidal edge, where the surface turns back, a ruling where
// the threads meet, or a developable's ruling where the curve straightens.
// A curvature is nil where it cannot be found from stable derivatives,
// counted by Unknown; so is a ruled surface's normal where even its tangent
// plane cannot be, marked in UnknownPlane. Directions are nil at
// an umbilic, counted by Umbilics, where every direction is principal (a
// canal has none at a regular point; see canalProbe). A
// focal point is nil at infinity, beyond 100 radii, counted per branch by
// Clipped. A closed surface's last row repeats its first and is not
// counted.
type SurfaceDiagnostics struct {
	Kind      string          `json:"kind"`
	Along     []int           `json:"along"`
	U         []float64       `json:"u"`
	V         []float64       `json:"v"`
	Periodic  bool            `json:"periodic"`
	Points    [][]*Vec3       `json:"points"`
	Normals   [][]*Vec3       `json:"normals"`
	Curvature [2][][]*float64 `json:"curvature"`
	Direction [2][][]*Vec3    `json:"direction"`
	Focal     [2][][]*Vec3    `json:"focal"`
	Singular  int             `json:"singular"`
	Umbilics  int             `json:"umbilics"`
	Unknown   int             `json:"unknown"`
	Clipped   [2]int          `json:"clipped"`
	// UnknownPlane is present only where some sample has a point whose
	// tangent plane cannot be found from stable derivatives, marking those
	// samples: they have no normal, as a singular sample has none, but are
	// counted by Unknown rather than Singular, and also by UnknownPlanes.
	UnknownPlane  [][]bool `json:"unknownPlane,omitempty"`
	UnknownPlanes int      `json:"unknownPlanes,omitempty"`
	// Light is present only for the outgoing wavefront of a ray study.
	Light *LightDiagnostics `json:"light,omitempty"`
	// Distance and Folds are present only for a patch's offset: its signed
	// distance d from the patch along n, and where it has folded, lying
	// beyond one focal sheet.
	Distance float64  `json:"distance,omitempty"`
	Folds    [][]bool `json:"folds,omitempty"`
	// Sheet and Feet are present only for a patch's focal sheet: its
	// number, 1 or 2, and the patch's point X whose center each point is.
	Sheet int       `json:"sheet,omitempty"`
	Feet  [][]*Vec3 `json:"feet,omitempty"`
	// Through is present only for one point of a surface built on a curve
	// (see curvePoint): the line the probe draws through it, which a grid
	// draws from its own row: a canal's contact circle, closed, or a
	// ruling from end to end.
	Through []Vec3 `json:"through,omitempty"`
	// Crossing is present only for one point of a patch whose kind draws
	// its correspondence (see SurfaceRequest.correspondence): the u-curve
	// through it, at the grid's u samples and the point's v, then the
	// v-curve, at its u and the grid's v samples.
	Crossing [][]Vec3 `json:"crossing,omitempty"`
	closed   bool
}

// newSurfaceDiagnostics allocates a grid of rows × columns.
func newSurfaceDiagnostics(kind string, rows, columns int) *SurfaceDiagnostics {
	d := &SurfaceDiagnostics{Kind: kind, Along: make([]int, rows), U: make([]float64, rows), V: make([]float64, columns),
		Points: grid2[*Vec3](rows, columns), Normals: grid2[*Vec3](rows, columns)}
	for k := 0; k < 2; k++ {
		d.Curvature[k] = grid2[*float64](rows, columns)
		d.Direction[k] = grid2[*Vec3](rows, columns)
		d.Focal[k] = grid2[*Vec3](rows, columns)
	}
	return d
}

// markUnknownPlane marks sample (r, k) as having a point whose tangent
// plane cannot be found, allocating the grid on the first.
func (d *SurfaceDiagnostics) markUnknownPlane(r, k int) {
	if d.UnknownPlane == nil {
		d.UnknownPlane = grid2[bool](len(d.U), len(d.V))
	}
	d.UnknownPlane[r][k] = true
}

// counted reports whether row r is counted: a closed canal's last row
// repeats its first.
func (d *SurfaceDiagnostics) counted(r int) bool { return !d.closed || r < len(d.U)-1 }

// clip places each known curvature's focal point X + n/κ, or leaves it at
// infinity where 1/|κ| exceeds focalReach radii.
func (d *SurfaceDiagnostics) clip(radius float64) {
	reach := focalReach * radius
	for r := range d.Points {
		for j := range d.Points[r] {
			for k := 0; k < 2; k++ {
				kappa := d.Curvature[k][r][j]
				if kappa == nil {
					continue
				}
				if !(math.Abs(*kappa)*reach > 1) {
					d.Focal[k][r][j] = nil
					if d.counted(r) {
						d.Clipped[k]++
					}
					continue
				}
				f := d.Points[r][j].add(d.Normals[r][j].mul(1 / *kappa))
				d.Focal[k][r][j] = &f
			}
		}
	}
}

// patchGrid allocates a patch's diagnostics of kind on its own grid: row
// i is u sample i, column j is v sample j.
func patchGrid(q SurfaceRequest, kind string) *SurfaceDiagnostics {
	nu, nv := q.USamples, q.VSamples
	d := newSurfaceDiagnostics(kind, nu+1, nv+1)
	for i := 0; i <= nu; i++ {
		d.Along[i], d.U[i] = i, lerp(q.UMin, q.UMax, i, nu)
	}
	for j := 0; j <= nv; j++ {
		d.V[j] = lerp(q.VMin, q.VMax, j, nv)
	}
	return d
}

// patchProbe describes the patch at its own samples, from the same
// evaluations as its focal sheets.
func patchProbe(q SurfaceRequest, samples [][]surfacePoint, scale float64) *SurfaceDiagnostics {
	d := patchGrid(q, "patch")
	for i, row := range samples {
		for j, s := range row {
			d.patchAt(i, j, s)
		}
	}
	d.clip(scale)
	return d
}

// patchAt describes the patch at sample (i, j), whose geometry is s.
func (d *SurfaceDiagnostics) patchAt(i, j int, s surfacePoint) {
	x, n := s.X, s.N
	d.Points[i][j] = &x
	if !s.Normal {
		d.Singular++
		return
	}
	d.Normals[i][j] = &n
	if s.Umbilic {
		d.Umbilics++
	}
	for k := 0; k < 2; k++ {
		kappa, e := s.Kappa[k], s.Dir[k]
		d.Curvature[k][i][j] = &kappa
		if !s.Umbilic {
			d.Direction[k][i][j] = &e
		}
	}
}

// offsetProbe describes the offset X_d = X + d·n at the patch's own
// samples, from the same evaluations. It shares the patch's normal n, as
// it is drawn, and since dX_d = (I − dA) dX with A = −dn, its shape
// operator is A(I − dA)⁻¹: the same principal directions, with curvatures
// κᵢ/(1 − dκᵢ). Branches keep the patch's numbers, so each center
// X_d + n(1 − dκᵢ)/κᵢ = X + n/κᵢ is the patch's focal point of the same
// number: parallel surfaces share their focal sheets. Where 1 − dκᵢ
// vanishes the offset meets that focal sheet in a cuspidal edge and is
// singular; where (1 − dκ₁)(1 − dκ₂) < 0 it lies beyond one focal sheet
// and has folded, and κ₁ < κ₂ is possible there.
func offsetProbe(q SurfaceRequest, samples [][]surfacePoint, scale float64) *SurfaceDiagnostics {
	d := patchGrid(q, "offset")
	d.Distance, d.Folds = q.Offset, grid2[bool](len(d.U), len(d.V))
	for i, row := range samples {
		for j, s := range row {
			d.offsetAt(i, j, s)
		}
	}
	d.clip(scale)
	return d
}

// offsetAt describes the offset at sample (i, j), whose patch geometry is
// s.
func (d *SurfaceDiagnostics) offsetAt(i, j int, s surfacePoint) {
	if !s.Normal {
		// The chart has no normal here, so the offset has no point.
		d.Singular++
		return
	}
	dist := d.Distance
	x, n := s.X.add(s.N.mul(dist)), s.N
	d.Points[i][j] = &x
	stretch := [2]float64{1 - dist*s.Kappa[0], 1 - dist*s.Kappa[1]}
	d.Folds[i][j] = stretch[0]*stretch[1] < 0
	if !(math.Abs(stretch[0]) > 1e-9*(1+math.Abs(dist*s.Kappa[0]))) || !(math.Abs(stretch[1]) > 1e-9*(1+math.Abs(dist*s.Kappa[1]))) {
		d.Singular++
		return
	}
	d.Normals[i][j] = &n
	if s.Umbilic {
		d.Umbilics++
	}
	for k := 0; k < 2; k++ {
		kappa, e := s.Kappa[k]/stretch[k], s.Dir[k]
		d.Curvature[k][i][j] = &kappa
		if !s.Umbilic {
			d.Direction[k][i][j] = &e
		}
	}
}

// focalProbe describes focal sheet number sheet, F = X + n/κ with κ the
// patch's κ₁ or κ₂, at the patch's own samples. Its normal is the patch's
// principal direction e of that number: along e the sheet moves only along
// n, as dF = d(1/κ) n there, and across it along n and the other
// direction, so the patch's normal line touches the sheet at F. The normal
// is oriented continuously along u, from the sample before it at the same
// v, or else along v on the first row, so that the readout's plots along u
// run on; no orientation suits a whole grid around an umbilic, where the
// principal directions turn by half a turn. The sheet's curvatures, numbered
// κ₁ ≥ κ₂, are taken with it, A = −dm. Its second fundamental form,
// −dF·dm, needs how κ and e change, so the patch's third derivatives (see
// focalFrame).
//
// A sample has no point where the patch has no normal or its center lies
// beyond focalReach radii, at infinity. It is singular where the patch is
// umbilic, so that e is undefined and the two sheets meet, and where the
// sheet has no tangent plane: where κ is stationary along e, a ridge of
// the patch, whose image is a cuspidal edge of the sheet, or where the
// whole sheet is a curve or a point, as a surface of revolution's
// parallels' sheet is its axis.
func focalProbe(q SurfaceRequest, sheet int, samples [][]surfacePoint, scale float64) *SurfaceDiagnostics {
	d := patchGrid(q, "focal")
	d.Sheet, d.Feet = sheet, grid2[*Vec3](len(d.U), len(d.V))
	for i, row := range samples {
		for j, s := range row {
			// The sample before it at the same v, or else along v.
			var before *Vec3
			if i > 0 {
				before = d.Normals[i-1][j]
			}
			if before == nil && j > 0 {
				before = d.Normals[i][j-1]
			}
			d.focalAt(q, i, j, s, before, scale)
		}
	}
	d.clip(scale)
	return d
}

// focalAt describes the focal sheet at sample (i, j), whose patch geometry
// is s, with its normal oriented as before, where that is known.
func (d *SurfaceDiagnostics) focalAt(q SurfaceRequest, i, j int, s surfacePoint, before *Vec3, scale float64) {
	f, ok := s.focal(d.Sheet-1, focalReach*scale)
	if !ok {
		return
	}
	x := s.X
	d.Feet[i][j], d.Points[i][j] = &x, &f
	if s.Umbilic {
		d.Singular++
		return
	}
	fu, fv, m, mu, mv := q.focalFrame(d.U[i], d.V[j], s, d.Sheet-1)
	area := fu.cross(fv).norm()
	big := math.Max(fu.norm(), fv.norm())
	if !(area > 1e-9*big*big) {
		d.Singular++
		return
	}
	if before != nil && before.dot(m) < 0 {
		m, mu, mv = m.mul(-1), mu.mul(-1), mv.mul(-1)
	}
	p := principal(f, fu, fv, m, -fu.dot(mu), -(fu.dot(mv)+fv.dot(mu))/2, -fv.dot(mv), area, scale)
	if !finite(p.Kappa[0]) || !finite(p.Kappa[1]) {
		d.Unknown++
		return
	}
	d.Normals[i][j] = &m
	if p.Umbilic {
		d.Umbilics++
	}
	for b := 0; b < 2; b++ {
		kappa, e := p.Kappa[b], p.Dir[b]
		d.Curvature[b][i][j] = &kappa
		if !p.Umbilic {
			d.Direction[b][i][j] = &e
		}
	}
}

// focalFrame returns the partial derivatives F_u and F_v of focal sheet k,
// F = X + n/κ, at the patch's regular, non-umbilic sample s at (u, v), and
// the sheet's normal, the principal direction e, with its own partial
// derivatives (see pencil).
func (q SurfaceRequest) focalFrame(u, v float64, s surfacePoint, k int) (fu, fv, m, mu, mv Vec3) {
	p := q.pencil(u, v, s)
	other, kappa := 1-k, s.Kappa[k]
	var df, de [2]Vec3
	for l := 0; l < 2; l++ {
		dk, c, half := p.change(l, k)
		dw := [2]float64{c*p.w[other][0] - half*p.w[k][0], c*p.w[other][1] - half*p.w[k][1]}
		de[l] = p.second[0][l].mul(p.w[k][0]).add(p.second[1][l].mul(p.w[k][1])).add(p.first[0].mul(dw[0])).add(p.first[1].mul(dw[1]))
		df[l] = p.first[l].add(p.dn[l].mul(1 / kappa)).sub(p.n.mul(dk / (kappa * kappa)))
	}
	return df[0], df[1], s.Dir[k], de[0], de[1]
}

// extremality returns dκ(e), how branch k's principal curvature changes
// along its own principal direction e = s.Dir[k] at the patch's regular,
// non-umbilic sample s at (u, v), per unit length. It is odd in e, so its
// sign means something only with e oriented. Where it vanishes the patch
// has a ridge, and focal sheet k a cuspidal edge (see ridges).
func (q SurfaceRequest) extremality(u, v float64, s surfacePoint, k int) float64 {
	p := q.pencil(u, v, s)
	du, _, _ := p.change(0, k)
	dv, _, _ := p.change(1, k)
	return du*p.w[k][0] + dv*p.w[k][1]
}

// pencilFrame is the patch's first derivatives, second derivatives and
// normal at a regular sample, its principal directions w in the parameters,
// the normal's derivatives, and the derivatives along each parameter of the
// pencil b − κg of its fundamental forms (see pencil).
type pencilFrame struct {
	first  [2]Vec3
	second [2][2]Vec3
	n      Vec3
	kappa  [2]float64
	w      [2][2]float64
	dn     [2]Vec3
	dg, db [2][2][2]float64
}

// pencil differentiates the patch's principal curvatures and directions at
// its regular sample s at (u, v), from its third derivatives.
//
// In the parameters, with first and second fundamental forms g and b,
// e = X_u w¹ + X_v w² where b w = κ g w and wᵀg w = 1. Along each
// parameter, for the pencil's derivatives b′ = X_ij′·n + X_ij·n′ and g′, the
// eigenvalue changes by κ′ = wᵀ(b′ − κg′)w and the eigenvector by
// w′ = c w̄ − ½(wᵀg′w) w, where w̄ is the other branch's and
// c = w̄ᵀ(b′ − κg′)w/(κ − κ̄). Then e′ = X_u′w¹ + X_v′w² + X_u w¹′ + X_v w²′,
// n′ = −dX(g⁻¹b), and F′ = X′ + n′/κ − κ′n/κ².
func (q SurfaceRequest) pencil(u, v float64, s surfacePoint) pencilFrame {
	_, xu, xv, xuu, xuv, xvv := q.patch(u, v)
	xuuu, xuuv, xuvv, xvvv := q.third(u, v)
	p := pencilFrame{first: [2]Vec3{xu, xv}, second: [2][2]Vec3{{xuu, xuv}, {xuv, xvv}}, n: s.N, kappa: s.Kappa}
	n, first, second := p.n, p.first, p.second
	// third[i][j][l] = X_ijl, symmetric in its indices.
	third := [2][2][2]Vec3{{{xuuu, xuuv}, {xuuv, xuvv}}, {{xuuv, xuvv}, {xuvv, xvvv}}}
	var g, b [2][2]float64
	for i := 0; i < 2; i++ {
		for j := 0; j < 2; j++ {
			g[i][j], b[i][j] = first[i].dot(first[j]), second[i][j].dot(n)
		}
	}
	det := g[0][0]*g[1][1] - g[0][1]*g[1][0]
	inverse := [2][2]float64{{g[1][1] / det, -g[0][1] / det}, {-g[1][0] / det, g[0][0] / det}}
	// The principal directions in the parameters.
	for c := 0; c < 2; c++ {
		p.w[c] = apply2(inverse, [2]float64{xu.dot(s.Dir[c]), xv.dot(s.Dir[c])})
	}
	for l := 0; l < 2; l++ {
		// Column l of g⁻¹b.
		shape := apply2(inverse, [2]float64{b[0][l], b[1][l]})
		p.dn[l] = xu.mul(-shape[0]).sub(xv.mul(shape[1]))
	}
	for l := 0; l < 2; l++ {
		for i := 0; i < 2; i++ {
			for j := 0; j < 2; j++ {
				p.dg[l][i][j] = second[i][l].dot(first[j]) + first[i].dot(second[j][l])
				p.db[l][i][j] = third[i][j][l].dot(n) + second[i][j].dot(p.dn[l])
			}
		}
	}
	return p
}

// change returns, along parameter l, branch k's κ′, its direction's turn
// toward the other branch c, and the half ½wᵀg′w of its rescaling (see
// pencil). c is infinite at an umbilic.
func (p pencilFrame) change(l, k int) (dk, c, half float64) {
	form := func(m [2][2]float64, a, c [2]float64) float64 {
		w := apply2(m, c)
		return a[0]*w[0] + a[1]*w[1]
	}
	other, kappa := 1-k, p.kappa[k]
	var a [2][2]float64
	for i := 0; i < 2; i++ {
		for j := 0; j < 2; j++ {
			a[i][j] = p.db[l][i][j] - kappa*p.dg[l][i][j]
		}
	}
	dk = form(a, p.w[k], p.w[k])
	c = form(a, p.w[other], p.w[k]) / (kappa - p.kappa[other])
	half = form(p.dg[l], p.w[k], p.w[k]) / 2
	return dk, c, half
}

func apply2(m [2][2]float64, w [2]float64) [2]float64 {
	return [2]float64{m[0][0]*w[0] + m[0][1]*w[1], m[1][0]*w[0] + m[1][1]*w[1]}
}

// canalAcross returns the principal curvature of the canal X = c + Rq
// across its contact circle, and that direction, at the point where
// q = −Ṙ T + σ e with σ = √(1 − Ṙ²) and e a unit vector normal to T. Dots
// are derivatives in the arc length s of the center c, whose curvature
// vector is bent = κN. The contact circle is a line of curvature, so the
// other principal direction is w, the part of X_s normal to the circle's
// tangent T × e, and κ = −q_s·w/w·w with A = −dn and n = q. The frame's own
// turning about T moves e along T × e, which w leaves out, so
// ė = −(bent·e)T. ok is false where w vanishes: the surface has a cuspidal
// edge there.
func canalAcross(T, bent, e Vec3, R, dR, ddR float64) (kappa float64, dir Vec3, ok bool) {
	sigma := math.Sqrt(1 - dR*dR)
	q := T.mul(-dR).add(e.mul(sigma))
	qs := T.mul(-ddR - sigma*bent.dot(e)).sub(bent.mul(dR)).add(e.mul(-dR * ddR / sigma))
	xs := T.add(q.mul(dR)).add(qs.mul(R))
	circle := T.cross(e)
	w := xs.sub(circle.mul(xs.dot(circle)))
	if !(w.norm() > 1e-9) {
		return 0, Vec3{}, false
	}
	return -qs.dot(w) / w.dot(w), w.unit(), true
}

// probeRows returns the base samples the canal probe visits: every
// stride-th, as the mesh's rings, and the last.
func probeRows(n int) []int {
	stride := (n + canalRings - 1) / canalRings
	rows := []int{}
	for i := 0; i < n; i += stride {
		rows = append(rows, i)
	}
	return append(rows, n)
}

// canalRing is the canal at one parameter, as its probe describes it: the
// sphere's center c on the curve, its radius R, the curve's unit tangent T
// and curvature vector bent, the slope Ṙ = dR/ds and Ṙ̈ (NaN where it is
// unknown, and bent then too), and the direction from c at a turn from θ₀
// in the frame that carries the meridians.
type canalRing struct {
	center, T, bent Vec3
	R, dR, ddR      float64
	direction       func(turn float64) Vec3
}

// canalRingAt is the canal's ring where the curve has its center c, unit
// tangent T, speed and acceleration a, and the sphere's radius R and its
// slope dR/dt; second gives d²R/dt², needed only where a is known.
func canalRingAt(center, T Vec3, speed float64, a Vec3, R, slope float64, second func() float64, direction func(float64) Vec3) canalRing {
	g := canalRing{center: center, T: T, R: R, dR: slope / speed, ddR: math.NaN(), direction: direction}
	if a.valid() {
		along := T.dot(a)
		g.bent = a.sub(T.mul(along)).mul(1 / (speed * speed))
		g.ddR = (second() - g.dR*along) / (speed * speed)
	}
	return g
}

// canalAt describes the canal at grid point (r, k), the turn from θ₀
// around the contact circle of ring g.
func (d *SurfaceDiagnostics) canalAt(r, k int, g canalRing, turn float64) {
	collapsed := math.Abs(g.dR) >= 1-1e-9
	around := -1 / g.R
	T := g.T
	e := g.direction(turn)
	sigma := math.Sqrt(math.Max(0, 1-g.dR*g.dR))
	nrm := T.mul(-g.dR).add(e.mul(sigma))
	x := g.center.add(nrm.mul(g.R))
	if collapsed {
		x = g.center.add(T.mul(-g.R * math.Copysign(1, g.dR)))
	}
	d.Points[r][k] = &x
	if collapsed {
		d.Singular++
		return
	}
	circle := T.cross(e).unit()
	if !finite(g.ddR) {
		d.Normals[r][k] = &nrm
		d.Curvature[0][r][k] = &around
		across := nrm.cross(circle)
		d.Direction[0][r][k], d.Direction[1][r][k] = &circle, &across
		d.Unknown++
		return
	}
	kappa, across, ok := canalAcross(T, g.bent, e, g.R, g.dR, g.ddR)
	if !ok || !finite(kappa) {
		d.Singular++
		return
	}
	d.Normals[r][k] = &nrm
	d.Curvature[0][r][k], d.Curvature[1][r][k] = &around, &kappa
	d.Direction[0][r][k], d.Direction[1][r][k] = &circle, &across
}

// circle is the ring's contact circle, closed, at 2·canalSegments turns
// from θ₀, or nil where it has collapsed to a point.
func (g canalRing) circle() []Vec3 {
	if math.Abs(g.dR) >= 1-1e-9 {
		return nil
	}
	sigma := math.Sqrt(1 - g.dR*g.dR)
	points := make([]Vec3, 2*canalSegments+1)
	for m := range points {
		e := g.direction(math.Pi * float64(m) / canalSegments)
		points[m] = g.center.add(g.T.mul(-g.dR).add(e.mul(sigma)).mul(g.R))
	}
	return points
}

// canalProbe describes the canal at canalSegments turns around each row's
// contact circle, measured from θ₀ in the frame that carries the
// meridians. ring gives sample i's ring, false where the sphere, its real
// contact circle or the frame is missing. A closed canal's last row is its
// first.
//
// A canal has no umbilic at a regular point. With n = (X − c)/R,
// dn(X_s) = (X_s − T − Ṙq)/R and dn(T × e) = (T × e)/R, so
// dn(w) = (w − T − Ṙq)/R, which is w/R only where T = −Ṙq: where the
// circle has collapsed.
func canalProbe(n int, closed bool, lo, hi float64, ring func(i int) (canalRing, bool)) *SurfaceDiagnostics {
	rows := probeRows(n)
	d := newSurfaceDiagnostics("canal", len(rows), canalSegments)
	d.Periodic, d.closed = true, closed
	for k := range d.V {
		d.V[k] = 2 * math.Pi * float64(k) / canalSegments
	}
	for r, i := range rows {
		// t as the curve probe reports it, so a symmetric domain's middle
		// is exactly 0.
		d.Along[r], d.U[r] = i, sampleAt(lo, hi, i, n)
		if closed && i == n {
			d.repeatFirst(r)
			continue
		}
		g, ok := ring(i)
		if !ok {
			continue
		}
		for k := range d.V {
			d.canalAt(r, k, g, d.V[k])
		}
	}
	return d
}
