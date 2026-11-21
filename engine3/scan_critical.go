package engine3

import (
	"math"
	"sort"

	"tangentgarden/engine/expr"
)

// Issue #406's optional arm: beside each candidate, points where Newton's
// method finds F's gradient vanishing. Scanning the level, these solve
// ∇F = 0; scanning a, they solve ∇ₓF = 0 and F = c together, for x and a.
// Seeds are the study's grid points where the sampled gradient is least
// among their neighbors. Derivatives are central differences of F. A
// converged point is numerical evidence that F has a critical point there,
// with the value and Morse index read from the differences: not a proof,
// and not a proof that no other critical point lies near.

// ScanCritical is one critical value found near a candidate: the level F
// takes there (or, scanning a, the a), the Morse index (the Hessian's
// negative eigenvalues, or -1 where it is too nearly singular to say), the
// points found with that value and index, and the first of them.
type ScanCritical struct {
	Value  float64 `json:"value"`
	Index  int     `json:"index"`
	Points int     `json:"points"`
	At     Vec3    `json:"at"`
}

const (
	maxCriticalSeeds      = 64
	maxCriticalIterations = 40
)

// critical finds the critical values beside each change, box or singular
// candidate: within twice its spread's width of the spread, or, scanning
// the level, within the change's possible lag from the point's Hessian.
func (s *Scan) critical() {
	q := s.base
	cache := map[float64]expr.SpatialField{}
	fieldAt := func(a float64) expr.SpatialField {
		if f, ok := cache[a]; ok {
			return f
		}
		f, _, err := expr.ParseSpatialFieldUses(q.F, a)
		if err != nil {
			f = func(x, y, z, t float64) float64 { return math.NaN() }
		}
		if len(cache) > 256 {
			clear(cache)
		}
		cache[a] = f
		return f
	}
	n := q.Box.shape(q.Cells)
	sides := q.Box.sides()
	h := [3]float64{sides[0] / float64(n[0]), sides[1] / float64(n[1]), sides[2] / float64(n[2])}
	hmin := math.Min(h[0], math.Min(h[1], h[2]))
	diag := math.Sqrt(sides[0]*sides[0] + sides[1]*sides[1] + sides[2]*sides[2])
	node := func(i, j, k int) Vec3 {
		return Vec3{q.Box.XMin + float64(i)*h[0], q.Box.YMin + float64(j)*h[1], q.Box.ZMin + float64(k)*h[2]}
	}
	for ci := range s.cands {
		c := &s.cands[ci]
		c.Critical = []ScanCritical{}
		if c.Kind == "unresolved" {
			continue
		}
		mid := c.Lo + (c.Hi-c.Lo)/2
		a := q.A
		if s.q.Axis == "a" {
			a = mid
		}
		f := fieldAt(a)
		F := func(p Vec3) float64 { return f(p.X, p.Y, p.Z, 0) }
		// The grid's values, their range and its gradient scale.
		idx := func(i, j, k int) int { return i + (n[0]+1)*(j+(n[1]+1)*k) }
		vals := make([]float64, (n[0]+1)*(n[1]+1)*(n[2]+1))
		lo, hi := math.Inf(1), math.Inf(-1)
		for k := 0; k <= n[2]; k++ {
			for j := 0; j <= n[1]; j++ {
				for i := 0; i <= n[0]; i++ {
					v := F(node(i, j, k))
					vals[idx(i, j, k)] = v
					if finite(v) {
						lo, hi = math.Min(lo, v), math.Max(hi, v)
					}
				}
			}
		}
		if !(hi > lo) {
			continue
		}
		gscale := (hi - lo) / diag
		target := q.Level
		if s.q.Axis == "level" {
			target = mid
		}
		// Seeds: interior grid points whose sampled |∇F|² is least among
		// their 26 neighbors, nearest the candidate's value first.
		g2 := func(i, j, k int) float64 {
			dx := (vals[idx(i+1, j, k)] - vals[idx(i-1, j, k)]) / (2 * h[0])
			dy := (vals[idx(i, j+1, k)] - vals[idx(i, j-1, k)]) / (2 * h[1])
			dz := (vals[idx(i, j, k+1)] - vals[idx(i, j, k-1)]) / (2 * h[2])
			return dx*dx + dy*dy + dz*dz
		}
		type seed struct {
			p    Vec3
			miss float64
		}
		var seeds []seed
		for k := 2; k < n[2]-1; k++ {
			for j := 2; j < n[1]-1; j++ {
				for i := 2; i < n[0]-1; i++ {
					v := g2(i, j, k)
					if !finite(v) || !finite(vals[idx(i, j, k)]) {
						continue
					}
					least := true
					for d := 0; d < 27 && least; d++ {
						di, dj, dk := d%3-1, d/3%3-1, d/9-1
						if d != 13 {
							w := g2(i+di, j+dj, k+dk)
							least = !(w < v) || !finite(w)
						}
					}
					if least {
						seeds = append(seeds, seed{node(i, j, k), math.Abs(vals[idx(i, j, k)] - target)})
					}
				}
			}
		}
		sort.SliceStable(seeds, func(x, y int) bool { return seeds[x].miss < seeds[y].miss })
		seeds = seeds[:min(len(seeds), maxCriticalSeeds)]
		// Within twice the spread's width of it: the grids' disagreement
		// measures how far the mesh may see a change from its cause, as a
		// birth seen late.
		w := 2 * (c.Spread[1] - c.Spread[0])
		hmax := math.Max(h[0], math.Max(h[1], h[2]))
		var found []ScanCritical
		var points [][]Vec3
		for _, sd := range seeds {
			p, v, ok := newtonCritical(fieldAt, s.q.Axis == "a", sd.p, a, q.Level, hmin, gscale, q.Box)
			if !ok {
				continue
			}
			at := q.A
			if s.q.Axis == "a" {
				at = v
			}
			index, big := morseIndex(fieldAt(at), p, hmin)
			// Scanning the level, a grid sees a change late or early by as
			// much as F grows from the critical point to the farthest a
			// grid point can be from it, √3 h/2 away: ½ |λ|max (√3 h/2)².
			reach := w
			if s.q.Axis == "level" {
				reach = math.Max(reach, big*3*hmax*hmax/8)
			}
			if v < c.Spread[0]-reach || v > c.Spread[1]+reach {
				continue
			}
			group := -1
			for k, g := range found {
				if g.Index == index && math.Abs(g.Value-v) <= 1e-9*math.Max(1, math.Abs(v)) {
					group = k
				}
			}
			if group < 0 {
				found = append(found, ScanCritical{Value: v, Index: index, At: p})
				points = append(points, nil)
				group = len(found) - 1
			}
			// Seeds converging to one point count it once.
			fresh := true
			for _, o := range points[group] {
				fresh = fresh && o.sub(p).norm() > 1e-6*diag
			}
			if fresh {
				points[group] = append(points[group], p)
				found[group].Points++
			}
		}
		sort.Slice(found, func(x, y int) bool { return found[x].Value < found[y].Value })
		c.Critical = append(c.Critical, found...)
	}
}

// gradient of F by fourth-order central differences of step d.
func fdGradient(F func(Vec3) float64, p Vec3, d float64) Vec3 {
	diff := func(e Vec3) float64 {
		return (F(p.sub(e.mul(2*d))) - 8*F(p.sub(e.mul(d))) + 8*F(p.add(e.mul(d))) - F(p.add(e.mul(2*d)))) / (12 * d)
	}
	return Vec3{diff(Vec3{1, 0, 0}), diff(Vec3{0, 1, 0}), diff(Vec3{0, 0, 1})}
}

func fdHessian(F func(Vec3) float64, p Vec3, d float64) [3][3]float64 {
	var H [3][3]float64
	for j, e := range [3]Vec3{{1, 0, 0}, {0, 1, 0}, {0, 0, 1}} {
		gp, gm := fdGradient(F, p.add(e.mul(d)), d), fdGradient(F, p.sub(e.mul(d)), d)
		col := gp.sub(gm).mul(1 / (2 * d))
		H[0][j], H[1][j], H[2][j] = col.X, col.Y, col.Z
	}
	for i := range 3 {
		for j := i + 1; j < 3; j++ {
			m := (H[i][j] + H[j][i]) / 2
			H[i][j], H[j][i] = m, m
		}
	}
	return H
}

// morseIndex counts the Hessian's negative eigenvalues, or -1 when one is
// within 10⁻⁶ of the largest in size, and returns the largest's size.
func morseIndex(f expr.SpatialField, p Vec3, h float64) (int, float64) {
	F := func(v Vec3) float64 { return f(v.X, v.Y, v.Z, 0) }
	lam, _ := eigen3(fdHessian(F, p, 1e-2*h))
	big := math.Max(math.Abs(lam[0]), math.Max(math.Abs(lam[1]), math.Abs(lam[2])))
	index := 0
	for _, l := range lam {
		if math.Abs(l) <= 1e-6*big || !finite(l) {
			return -1, big
		}
		if l < 0 {
			index++
		}
	}
	return index, big
}

// newtonCritical runs Newton's method from p: on ∇F = 0, returning the
// point and F there; or, with shape, on ∇ₓF = 0 and F = c for (x, a),
// returning the point and a. Steps are limited to two cells, the point
// must stay in the box, and convergence needs |∇F| within 10⁻⁸ of the
// field's gradient scale (its range over the box's diagonal).
func newtonCritical(fieldAt func(float64) expr.SpatialField, shape bool, p Vec3, a, c, h, gscale float64, b Box) (Vec3, float64, bool) {
	d := 1e-3 * h
	inside := func(v Vec3) bool {
		return v.X >= b.XMin && v.X <= b.XMax && v.Y >= b.YMin && v.Y <= b.YMax && v.Z >= b.ZMin && v.Z <= b.ZMax
	}
	for range maxCriticalIterations {
		f := fieldAt(a)
		F := func(v Vec3) float64 { return f(v.X, v.Y, v.Z, 0) }
		g := fdGradient(F, p, d)
		r := F(p) - c
		// Converged: the gradient within 10⁻⁸ of the field's scale, and
		// scanning a, F within 10⁻¹⁰ of c.
		if g.norm() <= 1e-8*gscale && (!shape || math.Abs(r) <= 1e-10*math.Max(1, math.Abs(c))) {
			if shape {
				return p, a, true
			}
			return p, F(p), true
		}
		H := fdHessian(F, p, 10*d)
		var dx Vec3
		var da float64
		if !shape {
			x, ok := solve3(H, g)
			if !ok {
				return p, 0, false
			}
			dx = x
		} else {
			// ∂/∂a of ∇F and F, by central differences in a.
			ea := 1e-5 * math.Max(1, math.Abs(a))
			fp, fm := fieldAt(a+ea), fieldAt(a-ea)
			Fp := func(v Vec3) float64 { return fp(v.X, v.Y, v.Z, 0) }
			Fm := func(v Vec3) float64 { return fm(v.X, v.Y, v.Z, 0) }
			ga := fdGradient(Fp, p, d).sub(fdGradient(Fm, p, d)).mul(1 / (2 * ea))
			Fa := (Fp(p) - Fm(p)) / (2 * ea)
			J := [4][4]float64{
				{H[0][0], H[0][1], H[0][2], ga.X},
				{H[1][0], H[1][1], H[1][2], ga.Y},
				{H[2][0], H[2][1], H[2][2], ga.Z},
				{g.X, g.Y, g.Z, Fa},
			}
			x, ok := solve4(J, [4]float64{g.X, g.Y, g.Z, r})
			if !ok {
				return p, 0, false
			}
			dx, da = Vec3{x[0], x[1], x[2]}, x[3]
		}
		if l := dx.norm(); l > 2*h {
			s := 2 * h / l
			dx, da = dx.mul(s), da*s
		}
		p, a = p.sub(dx), a-da
		if !inside(p) || !finite(a) {
			return p, 0, false
		}
	}
	return p, 0, false
}

func solve3(A [3][3]float64, b Vec3) (Vec3, bool) {
	x, ok := solve4([4][4]float64{
		{A[0][0], A[0][1], A[0][2], 0}, {A[1][0], A[1][1], A[1][2], 0}, {A[2][0], A[2][1], A[2][2], 0}, {0, 0, 0, 1},
	}, [4]float64{b.X, b.Y, b.Z, 0})
	return Vec3{x[0], x[1], x[2]}, ok
}

// solve4 solves A x = b by Gaussian elimination with partial pivoting,
// refusing a pivot below 10⁻¹⁴ of the matrix's largest entry.
func solve4(A [4][4]float64, b [4]float64) ([4]float64, bool) {
	big := 0.0
	for i := range 4 {
		for j := range 4 {
			big = math.Max(big, math.Abs(A[i][j]))
		}
	}
	for col := range 4 {
		piv := col
		for r := col + 1; r < 4; r++ {
			if math.Abs(A[r][col]) > math.Abs(A[piv][col]) {
				piv = r
			}
		}
		if !(math.Abs(A[piv][col]) > 1e-14*big) {
			return b, false
		}
		A[col], A[piv] = A[piv], A[col]
		b[col], b[piv] = b[piv], b[col]
		for r := col + 1; r < 4; r++ {
			m := A[r][col] / A[col][col]
			for k := col; k < 4; k++ {
				A[r][k] -= m * A[col][k]
			}
			b[r] -= m * b[col]
		}
	}
	var x [4]float64
	for r := 3; r >= 0; r-- {
		s := b[r]
		for k := r + 1; k < 4; k++ {
			s -= A[r][k] * x[k]
		}
		x[r] = s / A[r][r]
	}
	return x, true
}
