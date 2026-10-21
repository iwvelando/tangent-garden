package engine3

import "math"

// causticEdges traces the cuspidal edges of each caustic branch with a
// part that is a surface, where the sheet C = X + R/μ folds back (see
// fold), over the mirror's grid, whose reflections or refractions it is
// given (see contours). The fold is odd in the branch's direction e, which
// each cell orients alike, as a ridge's is. A sample that is not traced
// (unlit, totally reflected, at the source or singular) or is stigmatic,
// with no direction, has no value, so an edge stops beside it, and a
// point whose caustic is at infinity, beyond focalReach radii, has no
// place. An edge never joins the real part to the virtual one: each is
// wholly on one, marked Virtual when behind the surface. Each point's Feet
// is the surface point whose ray it lies on.
func (q SurfaceRequest) causticEdges(r RaysRequest, samples [][]mirrorPoint, caustics []CausticSheet, scale float64) []CuspidalEdge {
	reach := focalReach * scale
	out := []CuspidalEdge{}
	for branch := range 2 {
		surface := false
		for _, c := range caustics {
			surface = surface || c.Branch == branch+1 && c.Shape == "surface"
		}
		if !surface {
			continue
		}
		out = append(out, contours(q, samples, func(u, v float64) mirrorPoint { return q.ray(r, u, v, scale) },
			func(s mirrorPoint) Vec3 { return s.X }, scale, branch, level[mirrorPoint]{
				oriented: true,
				value: func(s mirrorPoint, u, v float64) (float64, Vec3) {
					if !s.traced() || s.Stigmatic {
						return math.NaN(), Vec3{}
					}
					// Over μ₁² + μ₂², in the same units, so that it is
					// unchanged by scale and finite where μ passes through
					// zero.
					return q.fold(r, u, v, s, branch) / (s.Mu[0]*s.Mu[0] + s.Mu[1]*s.Mu[1]), s.Dir[branch]
				},
				place: func(s mirrorPoint) (Vec3, bool) {
					return s.caustic(branch), s.finite(branch, reach)
				},
				virtual: func(s mirrorPoint) bool { return s.Mu[branch] < 0 },
				feet:    true,
			})...)
	}
	return out
}

// fold returns μ² R·C_w for caustic branch k at the traced, non-stigmatic
// sample p at (u, v), where C = X + R/μ is the caustic point and w the
// parameter step that moves the ray's foot across R by the branch's unit
// direction e, Āw = e (see ray). It is odd in e. Across R, C_w = Āw +
// B̄w/μ = (I − W/μ)e vanishes, since e is W's eigenvector, so C_w is
// along R: the sheet folds back, in a cuspidal edge, where fold vanishes
// too. With ρ = 1/μ, R·C_w = R·X_w + dρ(w), so fold = μ² R·X_w − dμ(w).
//
// μ is found here as the eigenvalue of the pencil H w = μ G w in the
// parameters, with G_ij = X_i·X_j − (R·X_i)(R·X_j), the first fundamental
// form of the foot's motion across R, and H_ij = −X_i·R_j, symmetric for
// the normal congruence the outgoing rays make; wᵀG w = 1. Along each
// parameter, μ′ = wᵀ(H′ − μG′)w, which needs R's second derivatives, and
// so the patch's third: R = aI + bn, as ray writes it, and R_jl = aI_jl +
// b_jl n + b_j n_l + b_l n_j + b n_jl, of which H′ reads only the part
// across n.
func (q SurfaceRequest) fold(r RaysRequest, u, v float64, p mirrorPoint, k int) float64 {
	x, xu, xv, xuu, xuv, xvv := q.patch(u, v)
	xuuu, xuuv, xuvv, xvvv := q.third(u, v)
	first := [2]Vec3{xu, xv}
	second := [2][2]Vec3{{xuu, xuv}, {xuv, xvv}}
	third := [2][2][2]Vec3{{{xuuu, xuuv}, {xuuv, xuvv}}, {{xuuv, xuvv}, {xuvv, xvvv}}}
	sign := 1.0
	if q.Reverse {
		sign = -1
	}
	// The normal n = c/|c|, c = ±X_u × X_v: n_j|c| = c_j − n(n·c_j), and
	// differentiating again, n_jl|c| + n_j(n·c_l) = c_jl − n_l(n·c_j) −
	// n(n_l·c_j + n·c_jl).
	c := xu.cross(xv).mul(sign)
	area := c.norm()
	n := c.mul(1 / area)
	var cj, nj [2]Vec3
	var cjl, njl [2][2]Vec3
	for j := range 2 {
		cj[j] = second[0][j].cross(xv).add(xu.cross(second[1][j])).mul(sign)
		nj[j] = cj[j].sub(n.mul(n.dot(cj[j]))).mul(1 / area)
	}
	for j := range 2 {
		for l := range 2 {
			cjl[j][l] = third[0][j][l].cross(xv).add(second[0][j].cross(second[1][l])).add(second[0][l].cross(second[1][j])).add(xu.cross(third[1][j][l])).mul(sign)
			njl[j][l] = cjl[j][l].sub(nj[l].mul(n.dot(cj[j]))).sub(n.mul(nj[l].dot(cj[j]) + n.dot(cjl[j][l]))).sub(nj[j].mul(n.dot(cj[l]))).mul(1 / area)
		}
	}
	// The incident direction: for a point source, I = (X − S)/|X − S|,
	// I_j|X − S| = X_j − I(I·X_j), and I_jl|X − S| + I_j(I·X_l) = X_jl −
	// I_l(I·X_j) − I(I_l·X_j + I·X_jl).
	in := p.I
	var ij [2]Vec3
	var ijl [2][2]Vec3
	if r.Light == "point" {
		d := x.sub(r.Source).norm()
		for j := range 2 {
			ij[j] = first[j].sub(in.mul(in.dot(first[j]))).mul(1 / d)
		}
		for j := range 2 {
			for l := range 2 {
				ijl[j][l] = second[j][l].sub(ij[l].mul(in.dot(first[j]))).sub(in.mul(ij[l].dot(first[j]) + in.dot(second[j][l]))).sub(ij[j].mul(in.dot(first[l]))).mul(1 / d)
			}
		}
	}
	// The cosine c₀ = −I·n and the coefficients a and b of R = aI + bn.
	c0 := -in.dot(n)
	var c0j [2]float64
	for j := range 2 {
		c0j[j] = -(ij[j].dot(n) + in.dot(nj[j]))
	}
	a, b := 1.0, 2*c0
	bj := [2]float64{2 * c0j[0], 2 * c0j[1]}
	if r.Interaction == "refract" {
		// b = ηc₀ − √k, with k = 1 − η²(1 − c₀²).
		eta := r.N1 / r.N2
		root := math.Sqrt(math.Max(0, 1-eta*eta*(1-c0*c0)))
		a, b = eta, eta*c0-root
		for j := range 2 {
			bj[j] = eta * c0j[j] * (1 - eta*c0/root)
		}
	}
	// R_jl's part along n, b_jl n, is left out: only X_i·R_jl enters H′,
	// and X_i·n = 0.
	d := in.mul(a).add(n.mul(b))
	var dj [2]Vec3
	var djl [2][2]Vec3
	for j := range 2 {
		dj[j] = ij[j].mul(a).add(n.mul(bj[j])).add(nj[j].mul(b))
	}
	for j := range 2 {
		for l := range 2 {
			djl[j][l] = ijl[j][l].mul(a).add(nj[l].mul(bj[j])).add(nj[j].mul(bj[l])).add(njl[j][l].mul(b))
		}
	}
	// The pencil and its derivatives along each parameter.
	var g [2][2]float64
	var dg, dh [2][2][2]float64
	for i := range 2 {
		for j := range 2 {
			g[i][j] = first[i].dot(first[j]) - d.dot(first[i])*d.dot(first[j])
			for l := range 2 {
				dg[l][i][j] = second[i][l].dot(first[j]) + first[i].dot(second[j][l]) -
					(dj[l].dot(first[i])+d.dot(second[i][l]))*d.dot(first[j]) -
					d.dot(first[i])*(dj[l].dot(first[j])+d.dot(second[j][l]))
				dh[l][i][j] = -(second[i][l].dot(dj[j]) + first[i].dot(djl[j][l]))
			}
		}
	}
	det := g[0][0]*g[1][1] - g[0][1]*g[1][0]
	inverse := [2][2]float64{{g[1][1] / det, -g[0][1] / det}, {-g[1][0] / det, g[0][0] / det}}
	e := p.Dir[k]
	w := apply2(inverse, [2]float64{xu.dot(e), xv.dot(e)})
	mu := p.Mu[k]
	change := 0.0
	for l := range 2 {
		form := 0.0
		for i := range 2 {
			for j := range 2 {
				form += w[i] * (dh[l][i][j] - mu*dg[l][i][j]) * w[j]
			}
		}
		change += w[l] * form
	}
	return mu*mu*d.dot(xu.mul(w[0]).add(xv.mul(w[1]))) - change
}
