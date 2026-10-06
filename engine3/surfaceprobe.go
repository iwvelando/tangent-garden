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
// sphere's centre on the base; branch 1 runs across it. A developable's
// branch 0 runs along the ruling, where κ = 0, and branch 1 across it.
//
// A point is nil where the surface has none (no real contact circle, no
// partner, no frame). A normal is nil where the surface is singular there,
// counted by Singular: a patch's chart singularity, a canal's collapsed
// circle or its cuspidal edge, where the surface turns back, a ruling where
// the threads meet, or a developable's ruling where the curve straightens.
// A curvature is nil where it cannot be found from stable derivatives,
// counted by Unknown; so is a ruled surface's normal where even its tangent
// plane cannot be. Directions are nil at
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
	// Light is present only for the outgoing wavefront of a ray study.
	Light *LightDiagnostics `json:"light,omitempty"`
	// Distance and Folds are present only for a patch's offset: its signed
	// distance d from the patch along n, and where it has folded, lying
	// beyond one focal sheet.
	Distance float64  `json:"distance,omitempty"`
	Folds    [][]bool `json:"folds,omitempty"`
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

// patchProbe describes the patch at its own samples, from the same
// evaluations as its focal sheets.
func patchProbe(q SurfaceRequest, samples [][]surfacePoint, scale float64) *SurfaceDiagnostics {
	nu, nv := q.USamples, q.VSamples
	d := newSurfaceDiagnostics("patch", nu+1, nv+1)
	for i := 0; i <= nu; i++ {
		d.Along[i], d.U[i] = i, lerp(q.UMin, q.UMax, i, nu)
	}
	for j := 0; j <= nv; j++ {
		d.V[j] = lerp(q.VMin, q.VMax, j, nv)
	}
	for i, row := range samples {
		for j, s := range row {
			x, n := s.X, s.N
			d.Points[i][j] = &x
			if !s.Normal {
				d.Singular++
				continue
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
	}
	d.clip(scale)
	return d
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
	nu, nv := q.USamples, q.VSamples
	d := newSurfaceDiagnostics("offset", nu+1, nv+1)
	d.Distance, d.Folds = q.Offset, grid2[bool](nu+1, nv+1)
	for i := 0; i <= nu; i++ {
		d.Along[i], d.U[i] = i, lerp(q.UMin, q.UMax, i, nu)
	}
	for j := 0; j <= nv; j++ {
		d.V[j] = lerp(q.VMin, q.VMax, j, nv)
	}
	for i, row := range samples {
		for j, s := range row {
			if !s.Normal {
				// The chart has no normal here, so the offset has no point.
				d.Singular++
				continue
			}
			x, n := s.X.add(s.N.mul(q.Offset)), s.N
			d.Points[i][j] = &x
			stretch := [2]float64{1 - q.Offset*s.Kappa[0], 1 - q.Offset*s.Kappa[1]}
			d.Folds[i][j] = stretch[0]*stretch[1] < 0
			if !(math.Abs(stretch[0]) > 1e-9*(1+math.Abs(q.Offset*s.Kappa[0]))) || !(math.Abs(stretch[1]) > 1e-9*(1+math.Abs(q.Offset*s.Kappa[1]))) {
				d.Singular++
				continue
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
	}
	d.clip(scale)
	return d
}

// canalAcross returns the principal curvature of the canal X = c + Rq
// across its contact circle, and that direction, at the point where
// q = −Ṙ T + σ e with σ = √(1 − Ṙ²) and e a unit vector normal to T. Dots
// are derivatives in the arc length s of the centre c, whose curvature
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

// canalProbe describes the canal at canalSegments turns around each row's
// contact circle, measured from θ₀ in the frame that carries the
// meridians. R and slope are R and dR/dt at each sample, sphere and circled
// say where the sphere and its real contact circle exist.
// A closed canal's last row is its first.
//
// A canal has no umbilic at a regular point. With n = (X − c)/R,
// dn(X_s) = (X_s − T − Ṙq)/R and dn(T × e) = (T × e)/R, so
// dn(w) = (w − T − Ṙq)/R, which is w/R only where T = −Ṙq: where the
// circle has collapsed.
func canalProbe(n int, closed bool, lo, hi float64, at func(float64) float64, radius func(float64) (float64, float64, float64, bool), base []*Vec3, R, slope []float64, sphere, circled []bool, frame carried, tangents, accelerations []Vec3, speeds []float64) *SurfaceDiagnostics {
	rows := probeRows(n)
	d := newSurfaceDiagnostics("canal", len(rows), canalSegments)
	d.Periodic, d.closed = true, closed
	for k := range d.V {
		d.V[k] = 2 * math.Pi * float64(k) / canalSegments
	}
	for r, i := range rows {
		// t as the curve probe reports it, so a symmetric domain's middle
		// is exactly 0.
		f := float64(i) / float64(n)
		d.Along[r], d.U[r] = i, lo*(1-f)+hi*f
		if closed && i == n {
			copy(d.Points[r], d.Points[0])
			copy(d.Normals[r], d.Normals[0])
			for k := 0; k < 2; k++ {
				copy(d.Curvature[k][r], d.Curvature[k][0])
				copy(d.Direction[k][r], d.Direction[k][0])
			}
			continue
		}
		if !sphere[i] || !circled[i] || !frame.ok[i] {
			continue
		}
		T, v, a := tangents[i], speeds[i], accelerations[i]
		dR := slope[i] / v
		var bent Vec3
		ddR := math.NaN()
		if a.valid() {
			along := T.dot(a)
			bent = a.sub(T.mul(along)).mul(1 / (v * v))
			_, _, second, _ := radius(at(float64(i)))
			ddR = (second - dR*along) / (v * v)
		}
		collapsed := math.Abs(dR) >= 1-1e-9
		around := -1 / R[i]
		for k := range d.V {
			e := frame.direction(i, d.V[k])
			sigma := math.Sqrt(math.Max(0, 1-dR*dR))
			nrm := T.mul(-dR).add(e.mul(sigma))
			x := base[i].add(nrm.mul(R[i]))
			if collapsed {
				x = base[i].add(T.mul(-R[i] * math.Copysign(1, dR)))
			}
			d.Points[r][k] = &x
			if collapsed {
				d.Singular++
				continue
			}
			circle := T.cross(e).unit()
			if !finite(ddR) {
				d.Normals[r][k] = &nrm
				d.Curvature[0][r][k] = &around
				across := nrm.cross(circle)
				d.Direction[0][r][k], d.Direction[1][r][k] = &circle, &across
				d.Unknown++
				continue
			}
			kappa, across, ok := canalAcross(T, bent, e, R[i], dR, ddR)
			if !ok || !finite(kappa) {
				d.Singular++
				continue
			}
			d.Normals[r][k] = &nrm
			d.Curvature[0][r][k], d.Curvature[1][r][k] = &around, &kappa
			d.Direction[0][r][k], d.Direction[1][r][k] = &circle, &across
		}
	}
	return d
}
