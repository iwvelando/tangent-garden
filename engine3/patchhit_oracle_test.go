package engine3

import "math"

// The first-hit oracle for the helicoid–catenoid family's ray presets: where
// a line first meets the analytic patch, decided with certificates rather
// than from the sampled mesh alone. The engine draws every lit sample's
// single reflection or refraction, with nothing occluded (see ray); a
// preset is honest when this oracle finds nothing in its drawing shadowed,
// undecided or blocked (TestMinimalOpticsPresetsShadowFree). It is test
// code only: production has no intersection code.
//
// The patch over a parameter rectangle R lies within the bounding box of
// X at R's corners, inflated by M(Δu² + Δv²)/8: the bilinear interpolant
// of the corners stays in their convex hull, and differs from X by at most
// (Δu²/8) max|X_uu| + (Δv²/8) max|X_vv|. M bounds |X_uu|, |X_uv| and |X_vv|
// over R (secondBound). A line that misses the inflated box misses X over R.
//
// Where the box is met, Newton's method solves X(u, v) = o + t d in (u, v,
// t) from R's center, on the chart extended beyond the domain. A root it
// finds is the only one in H × ℝ, H the parameter hull of R and the root,
// when ‖J⁻¹‖ sup_H ‖J − J(root)‖ < 1 for J = [X_u, X_v, −λd], t measured
// in units of λ = |X_u| at the root: then I − J⁻¹J contracts over the
// convex set, so the map is injective there. X_u and X_v each change by at
// most M_H(ΔU + ΔV) across H and −λd not at all, so the test uses
// ‖J⁻¹‖_F √2 M_H (ΔU + ΔV). With uniqueness, R holds a hit exactly when the
// root lies in R; without it, or without convergence, R is split in four,
// to maxHitDepth levels below a sample cell. A rectangle still unresolved
// there makes the answer undecided from its entry along the line, as a
// grazing line does, where J is nearly singular. A root within 10⁻⁹ of the
// domain's width from its edge, inside or outside, is undecided too: the
// sheet's edge decides whether the line hits. Each query visits at most
// maxHitVisits rectangles, beyond which it is undecided.
const (
	hitNone = iota
	hitFound
	hitUndecided
)

const (
	maxHitDepth  = 12
	maxHitVisits = 4096
	// hitBand is the fraction of each domain's width, at its edge, in
	// which a root is undecided.
	hitBand = 1e-9
)

type lineHit struct {
	state   int
	t, u, v float64
}

type hitNode struct {
	lo, hi         Vec3
	i0, i1, j0, j1 int
	left, right    int
}

// patchTree bounds the patch over its sample cells, in a binary tree of
// index ranges whose leaves are the cells.
type patchTree struct {
	q      SurfaceRequest
	nodes  []hitNode
	scale  float64
	bound  func(v0, v1 float64) float64
	center Vec3
	radius float64
	// visits counts rectangles visited over every query, and queries the
	// queries, for measurement.
	visits, queries int
	// Scratch reused by every query, which runs one at a time.
	stack []hitEntry
	rects []rect
}

type hitEntry struct {
	node int
	t    float64
}

// secondBound bounds |X_uu|, |X_uv| and |X_vv| over v in [v0, v1], for any
// u, on a kind whose bound is known: on the helicoid–catenoid family X_vv =
// −X_uu = s(cos θ sinh v sin u + sin θ cosh v cos u, …, 0) and X_uv have
// norms s√(cos²θ sinh²v + sin²θ cosh²v) and s√(cos²θ cosh²v + sin²θ sinh²v),
// both at most s cosh v.
func secondBound(q SurfaceRequest) (func(v0, v1 float64) float64, bool) {
	if q.Kind != "helicoid-catenoid" {
		return nil, false
	}
	s := q.A
	return func(v0, v1 float64) float64 {
		return s * math.Cosh(math.Max(math.Abs(v0), math.Abs(v1)))
	}, true
}

func newPatchTree(q SurfaceRequest, scale float64) (*patchTree, bool) {
	bound, ok := secondBound(q)
	if !ok {
		return nil, false
	}
	nu, nv := q.USamples, q.VSamples
	points := make([]Vec3, (nu+1)*(nv+1))
	for i := 0; i <= nu; i++ {
		for j := 0; j <= nv; j++ {
			u, v := q.at(i, j)
			points[i*(nv+1)+j], _, _, _, _, _ = q.patch(u, v)
		}
	}
	p := &patchTree{q: q, scale: scale, bound: bound, nodes: make([]hitNode, 0, 2*nu*nv)}
	var build func(i0, i1, j0, j1 int) int
	build = func(i0, i1, j0, j1 int) int {
		k := len(p.nodes)
		p.nodes = append(p.nodes, hitNode{i0: i0, i1: i1, j0: j0, j1: j1, left: -1, right: -1})
		n := hitNode{i0: i0, i1: i1, j0: j0, j1: j1, left: -1, right: -1}
		if i1-i0 == 1 && j1-j0 == 1 {
			u0, v0 := q.at(i0, j0)
			u1, v1 := q.at(i1, j1)
			c := [4]Vec3{points[i0*(nv+1)+j0], points[i1*(nv+1)+j0], points[i0*(nv+1)+j1], points[i1*(nv+1)+j1]}
			n.lo, n.hi = box(c, bound(v0, v1)*((u1-u0)*(u1-u0)+(v1-v0)*(v1-v0))/8)
		} else {
			if i1-i0 >= j1-j0 {
				m := (i0 + i1) / 2
				n.left, n.right = build(i0, m, j0, j1), build(m, i1, j0, j1)
			} else {
				m := (j0 + j1) / 2
				n.left, n.right = build(i0, i1, j0, m), build(i0, i1, m, j1)
			}
			a, b := p.nodes[n.left], p.nodes[n.right]
			n.lo = Vec3{math.Min(a.lo.X, b.lo.X), math.Min(a.lo.Y, b.lo.Y), math.Min(a.lo.Z, b.lo.Z)}
			n.hi = Vec3{math.Max(a.hi.X, b.hi.X), math.Max(a.hi.Y, b.hi.Y), math.Max(a.hi.Z, b.hi.Z)}
		}
		p.nodes[k] = n
		return k
	}
	build(0, nu, 0, nv)
	root := p.nodes[0]
	p.center = root.lo.add(root.hi).mul(.5)
	p.radius = root.hi.sub(root.lo).norm() / 2
	return p, true
}

// box is the bounding box of four points, inflated by margin.
func box(c [4]Vec3, margin float64) (Vec3, Vec3) {
	lo, hi := c[0], c[0]
	for _, p := range c[1:] {
		lo = Vec3{math.Min(lo.X, p.X), math.Min(lo.Y, p.Y), math.Min(lo.Z, p.Z)}
		hi = Vec3{math.Max(hi.X, p.X), math.Max(hi.Y, p.Y), math.Max(hi.Z, p.Z)}
	}
	m := Vec3{margin, margin, margin}
	return lo.sub(m), hi.add(m)
}

// slab is where the line o + t d, t in [t0, t1], enters the box, if it
// meets it.
func slab(lo, hi, o, d Vec3, t0, t1 float64) (float64, bool) {
	for _, a := range [3][4]float64{{lo.X, hi.X, o.X, d.X}, {lo.Y, hi.Y, o.Y, d.Y}, {lo.Z, hi.Z, o.Z, d.Z}} {
		if a[3] == 0 {
			if a[2] < a[0] || a[2] > a[1] {
				return 0, false
			}
			continue
		}
		ta, tb := (a[0]-a[2])/a[3], (a[1]-a[2])/a[3]
		if ta > tb {
			ta, tb = tb, ta
		}
		t0, t1 = math.Max(t0, ta), math.Min(t1, tb)
		if t0 > t1 {
			return 0, false
		}
	}
	return t0, true
}

// rect is a parameter rectangle under a leaf, depth levels below it.
type rect struct {
	u0, u1, v0, v1 float64
	depth          int
	lo, hi         Vec3
}

// first is the first hit along the unit direction d from o, for t in (lo,
// hi), skipping the point at own's parameters when own is given (the
// sample a line leaves or arrives at). It is undecided when an undecided
// rectangle or root comes before the first certain hit.
func (p *patchTree) first(o, d Vec3, lo, hi float64, own *[2]float64) lineHit {
	return p.search(o, d, lo, hi, own, false)
}

// any is a certain hit anywhere in (lo, hi), if there is one, whatever
// undecided parts come before it: undecided only when there is none.
func (p *patchTree) any(o, d Vec3, lo, hi float64, own *[2]float64) lineHit {
	return p.search(o, d, lo, hi, own, true)
}

func (p *patchTree) search(o, d Vec3, lo, hi float64, own *[2]float64, any bool) lineHit {
	q := p.q
	bu, bv := hitBand*(q.UMax-q.UMin), hitBand*(q.VMax-q.VMin)
	best := lineHit{state: hitNone, t: hi}
	undecided := math.Inf(1)
	visits := 0
	limit := func() float64 {
		if any {
			return best.t
		}
		return math.Min(best.t, undecided)
	}
	type entry = hitEntry
	stack, rects := p.stack[:0], p.rects[:0]
	defer func() { p.stack, p.rects = stack[:0], rects[:0] }()
	p.queries++
	if t, ok := slab(p.nodes[0].lo, p.nodes[0].hi, o, d, lo, hi); ok {
		stack = append(stack, entry{0, t})
	}
	for len(stack) > 0 && !(any && best.state == hitFound) {
		e := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if e.t >= limit() {
			continue
		}
		n := p.nodes[e.node]
		if n.left >= 0 {
			a, aok := slab(p.nodes[n.left].lo, p.nodes[n.left].hi, o, d, lo, limit())
			b, bok := slab(p.nodes[n.right].lo, p.nodes[n.right].hi, o, d, lo, limit())
			// Push the farther child first, so the nearer is searched first.
			if aok && bok && a < b {
				stack = append(stack, entry{n.right, b}, entry{n.left, a})
			} else {
				if aok {
					stack = append(stack, entry{n.left, a})
				}
				if bok {
					stack = append(stack, entry{n.right, b})
				}
			}
			continue
		}
		u0, v0 := q.at(n.i0, n.j0)
		u1, v1 := q.at(n.i1, n.j1)
		rects = append(rects[:0], rect{u0, u1, v0, v1, 0, n.lo, n.hi})
		for len(rects) > 0 && !(any && best.state == hitFound) {
			r := rects[len(rects)-1]
			rects = rects[:len(rects)-1]
			entry, ok := slab(r.lo, r.hi, o, d, lo, limit())
			if !ok || entry >= limit() {
				continue
			}
			visits++
			if visits > maxHitVisits {
				undecided = math.Min(undecided, entry)
				continue
			}
			uc, vc := (r.u0+r.u1)/2, (r.v0+r.v1)/2
			if u, v, t, inverse, ok := p.newton(o, d, uc, vc); ok {
				ulo, uhi := math.Min(r.u0, u), math.Max(r.u1, u)
				vlo, vhi := math.Min(r.v0, v), math.Max(r.v1, v)
				if inverse*math.Sqrt2*p.bound(vlo, vhi)*((uhi-ulo)+(vhi-vlo)) < 1 {
					// The root is the hull's only one.
					// Closed, and as wide as the band: a root on a shared
					// corner may round just outside every rectangle there.
					in := u >= r.u0-bu && u <= r.u1+bu && v >= r.v0-bv && v <= r.v1+bv
					mine := own != nil && math.Abs(u-own[0]) <= 8*bu && math.Abs(v-own[1]) <= 8*bv
					edge := math.Abs(u-q.UMin) <= bu || math.Abs(u-q.UMax) <= bu || math.Abs(v-q.VMin) <= bv || math.Abs(v-q.VMax) <= bv
					inside := u > q.UMin-bu && u < q.UMax+bu && v > q.VMin-bv && v < q.VMax+bv
					switch {
					case mine || t <= lo || t >= limit():
					case edge && inside:
						undecided = math.Min(undecided, t)
					case in:
						best = lineHit{hitFound, t, u, v}
					}
					continue
				}
			}
			if r.depth == maxHitDepth {
				undecided = math.Min(undecided, entry)
				continue
			}
			for _, c := range [4][4]float64{{r.u0, uc, r.v0, vc}, {uc, r.u1, r.v0, vc}, {r.u0, uc, vc, r.v1}, {uc, r.u1, vc, r.v1}} {
				rects = append(rects, p.rectangle(c[0], c[1], c[2], c[3], r.depth+1))
			}
		}
	}
	p.visits += visits
	if undecided < best.t && !(any && best.state == hitFound) {
		return lineHit{state: hitUndecided, t: undecided}
	}
	return best
}

func (p *patchTree) rectangle(u0, u1, v0, v1 float64, depth int) rect {
	var c [4]Vec3
	for k, uv := range [4][2]float64{{u0, v0}, {u1, v0}, {u0, v1}, {u1, v1}} {
		c[k], _, _, _, _, _ = p.q.patch(uv[0], uv[1])
	}
	lo, hi := box(c, p.bound(v0, v1)*((u1-u0)*(u1-u0)+(v1-v0)*(v1-v0))/8)
	return rect{u0, u1, v0, v1, depth, lo, hi}
}

// newton solves X(u, v) = o + t d from (u, v), returning the root and
// ‖J⁻¹‖_F there. It gives up beyond |v| = 8, where the family's chart is
// still finite, or after 30 steps.
func (p *patchTree) newton(o, d Vec3, u, v float64) (float64, float64, float64, float64, bool) {
	x, _, _, _, _, _ := p.q.patch(u, v)
	t := x.sub(o).dot(d)
	tol := 1e-12 * p.scale
	for k := 0; k < 30; k++ {
		x, xu, xv, _, _, _ := p.q.patch(u, v)
		f := x.sub(o.add(d.mul(t)))
		a3 := d.mul(-1)
		c23, c31, c12 := xv.cross(a3), a3.cross(xu), xu.cross(xv)
		det := xu.dot(c23)
		if !(math.Abs(det) > 0) {
			return 0, 0, 0, 0, false
		}
		if f.norm() <= tol {
			// ‖J⁻¹‖_F with t measured in units of λ = |X_u|, so that
			// J's columns are alike and the test does not depend on the
			// scale: J′ = [X_u, X_v, −λd] has rows λc23, λc31, c12 over
			// λ det.
			l := xu.norm()
			inverse := math.Sqrt(l*l*(c23.dot(c23)+c31.dot(c31))+c12.dot(c12)) / (l * math.Abs(det))
			return u, v, t, inverse, true
		}
		// J δ = −f, by Cramer's rule with J⁻¹'s rows c23, c31, c12 over det.
		u -= f.dot(c23) / det
		v -= f.dot(c31) / det
		t -= f.dot(c12) / det
		if !(math.Abs(v) <= 8 && math.Abs(u) <= 1e3) {
			return 0, 0, 0, 0, false
		}
	}
	return 0, 0, 0, 0, false
}

// occlusion is a lit sample's state under first-hit semantics: its
// incident path meets the patch first (shadowed), the first hit along
// either path cannot be decided (undecided), or its outgoing ray meets
// the patch again at distance block (blocked).
type occlusion struct {
	shadowed, undecided, blocked bool
	block                        float64
}

// occluder applies first-hit semantics to a ray study's samples: a lit
// sample is shadowed when its incident path meets the patch before it, and
// its outgoing ray is blocked at the first point where it meets the patch
// again. Either test undecided leaves the sample undecided.
type occluder struct {
	tree  *patchTree
	light RaysRequest
}

func newOccluder(q SurfaceRequest, r RaysRequest, scale float64) (*occluder, bool) {
	t, ok := newPatchTree(q, scale)
	if !ok {
		return nil, false
	}
	return &occluder{t, r}, true
}

// apply is the state of p, the sample at (u, v) as ray returns it.
// Parallel light arrives from beyond the patch's bounding sphere, and an
// outgoing ray is followed to it. An unlit sample has none.
func (o *occluder) apply(p mirrorPoint, u, v float64) occlusion {
	if !p.Lit {
		return occlusion{}
	}
	own := &[2]float64{u, v}
	beyond := p.X.sub(o.tree.center).norm() + o.tree.radius + o.tree.scale
	start, length := p.X.sub(p.I.mul(beyond)), beyond
	if o.light.Light == "point" {
		start, length = o.light.Source, p.X.sub(o.light.Source).norm()
	}
	switch h := o.tree.any(start, p.I, 0, length*(1+1e-12), own); h.state {
	case hitFound:
		return occlusion{shadowed: true}
	case hitUndecided:
		return occlusion{undecided: true}
	}
	out := p.R
	if p.Total {
		out = p.I.sub(p.N.mul(2 * p.I.dot(p.N)))
	}
	switch h := o.tree.first(p.X, out, 0, beyond, own); h.state {
	case hitFound:
		return occlusion{blocked: true, block: h.t}
	case hitUndecided:
		return occlusion{undecided: true}
	}
	return occlusion{}
}

// reached says whether p's branch k caustic point is reached before the
// outgoing ray is blocked: a real point at or beyond the block is not.
func (o occlusion) reached(p mirrorPoint, k int) bool {
	return !o.blocked || p.Mu[k] <= 0 || 1/p.Mu[k] < o.block
}
