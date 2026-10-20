package engine3

import "math"

// CuspidalEdge is a curve along which the offset X + dn folds: the image of
// a curve in the parameter plane where 1 − dκᵢ = 0, so that dX_d = (I −
// dA) dX loses rank along eᵢ there and the offset meets focal sheet Branch.
// Points are on the offset, each at its place (I, J) on the parameter grid
// in sample steps, u = UMin + I·(UMax − UMin)/USamples and v likewise, one
// of them a whole number: the grid edge it crosses. A Closed edge returns
// to its first point after its last, which it does not repeat.
type CuspidalEdge struct {
	Branch int       `json:"branch"`
	Closed bool      `json:"closed"`
	Points []Vec3    `json:"points"`
	I      []float64 `json:"i"`
	J      []float64 `json:"j"`
}

// cuspidalEdges traces each branch's level set 1 − dκᵢ = 0 over the
// parameter grid, whose samples it is given, by marching squares. Each
// grid edge whose two ends lie on opposite sides holds one crossing, found
// on the patch itself, between its samples, by the Illinois method; a cell
// with all four edges crossed (a saddle) is split by the side its center
// lies on. Crossings are joined cell to cell into curves. A cell with a
// corner without a normal (a chart singularity) is left out, so an edge
// stops beside it. When the patch's first and last rows (or columns)
// coincide, as across an ellipsoid's or a torus's seam, they are one row,
// and an edge crosses the seam.
func (q SurfaceRequest) cuspidalEdges(samples [][]surfacePoint, scale float64) []CuspidalEdge {
	nu, nv, d := q.USamples, q.VSamples, q.Offset
	seam := func(n, m int, at func(k, l int) Vec3) bool {
		for l := 0; l <= m; l++ {
			if at(0, l).sub(at(n, l)).norm() > 1e-12*scale {
				return false
			}
		}
		return true
	}
	seamU := seam(nu, nv, func(k, l int) Vec3 { return samples[k][l].X })
	seamV := seam(nv, nu, func(k, l int) Vec3 { return samples[l][k].X })
	wrap := func(k, n int, closed bool) int {
		if closed && k == n {
			return 0
		}
		return k
	}
	out := []CuspidalEdge{}
	for branch := range 2 {
		f := func(s surfacePoint) float64 {
			if !s.Normal {
				return math.NaN()
			}
			return 1 - d*s.Kappa[branch]
		}
		// A grid edge from sample (i, j), along u (alongV false) or v,
		// named by its wrapped start.
		type edge struct {
			alongV bool
			i, j   int
		}
		name := func(alongV bool, i, j int) edge {
			if alongV {
				return edge{true, wrap(i, nu, seamU), j}
			}
			return edge{false, i, wrap(j, nv, seamV)}
		}
		type crossing struct {
			ok   bool
			i, j float64
			x    Vec3
		}
		crossings := map[edge]crossing{}
		order := []edge{}
		// cross finds the crossing on the grid edge from (i, j) to (i+di,
		// j+dj), once for both cells beside it.
		cross := func(i, j, di, dj int) edge {
			e := name(dj == 1, i, j)
			if _, seen := crossings[e]; seen {
				return e
			}
			u0, v0 := q.at(i, j)
			u1, v1 := q.at(i+di, j+dj)
			t, ok := root(func(t float64) float64 {
				return f(q.point(u0+t*(u1-u0), v0+t*(v1-v0), scale))
			}, f(samples[i][j]), f(samples[i+di][j+dj]))
			c := crossing{i: float64(i) + t*float64(di), j: float64(j) + t*float64(dj)}
			if s := q.point(u0+t*(u1-u0), v0+t*(v1-v0), scale); ok && s.Normal {
				c.ok, c.x = true, s.X.add(s.N.mul(d))
			}
			crossings[e] = c
			order = append(order, e)
			return e
		}
		next := map[edge][]edge{}
		join := func(a, b edge) {
			if crossings[a].ok && crossings[b].ok {
				next[a], next[b] = append(next[a], b), append(next[b], a)
			}
		}
		for i := 0; i < nu; i++ {
			for j := 0; j < nv; j++ {
				corner := [4]float64{f(samples[i][j]), f(samples[i+1][j]), f(samples[i+1][j+1]), f(samples[i][j+1])}
				missing := false
				for _, c := range corner {
					missing = missing || math.IsNaN(c)
				}
				if missing {
					continue
				}
				// Edge k runs from corner k to corner k + 1, the cell's
				// sides counterclockwise in (u, v).
				starts := [4][4]int{{i, j, 1, 0}, {i + 1, j, 0, 1}, {i, j + 1, 1, 0}, {i, j, 0, 1}}
				at := func(k int) edge {
					s := starts[k]
					return cross(s[0], s[1], s[2], s[3])
				}
				center := func() float64 {
					u0, v0 := q.at(i, j)
					u1, v1 := q.at(i+1, j+1)
					return f(q.point((u0+u1)/2, (v0+v1)/2, scale))
				}
				for _, pair := range march(corner, center) {
					join(at(pair[0]), at(pair[1]))
				}
			}
		}
		visited := map[edge]bool{}
		walk := func(start edge) CuspidalEdge {
			c := CuspidalEdge{Branch: branch + 1, Points: []Vec3{}, I: []float64{}, J: []float64{}}
			previous, at := start, start
			for {
				visited[at] = true
				p := crossings[at]
				c.Points, c.I, c.J = append(c.Points, p.x), append(c.I, p.i), append(c.J, p.j)
				following, found := edge{}, false
				for _, n := range next[at] {
					if n != previous {
						following, found = n, true
						break
					}
				}
				if !found || following == start || visited[following] {
					c.Closed = found && following == start && len(c.Points) > 2
					return c
				}
				previous, at = at, following
			}
		}
		// Open edges first, from either end, then the loops.
		for _, e := range order {
			if !visited[e] && len(next[e]) == 1 {
				out = append(out, walk(e))
			}
		}
		for _, e := range order {
			if !visited[e] && len(next[e]) == 2 {
				out = append(out, walk(e))
			}
		}
	}
	return out
}

// march returns which of a cell's sides its level set joins: side k runs
// from corner k to corner k + 1 (mod 4), counterclockwise, and a corner of
// value 0 or more counts as above. A cell with every side crossed is a
// saddle, split by its center's side (center is called only then; a center
// without a value takes the corners' mean): where the center lies with
// corners 0 and 2, they meet through it and corners 1 and 3 are cut off.
func march(corner [4]float64, center func() float64) [][2]int {
	side := func(c float64) bool { return c >= 0 }
	crossed := []int{}
	for k := range 4 {
		if side(corner[k]) != side(corner[(k+1)%4]) {
			crossed = append(crossed, k)
		}
	}
	if len(crossed) == 2 {
		return [][2]int{{crossed[0], crossed[1]}}
	}
	if len(crossed) < 4 {
		return nil
	}
	c := center()
	if math.IsNaN(c) {
		c = (corner[0] + corner[1] + corner[2] + corner[3]) / 4
	}
	if side(c) == side(corner[0]) {
		return [][2]int{{0, 1}, {2, 3}}
	}
	return [][2]int{{3, 0}, {1, 2}}
}

// root finds where g, continuous on [0, 1] with g(0) = g0 and g(1) = g1 on
// opposite sides of zero (g0 ≥ 0 counting as above), crosses zero, by the
// Illinois variant of regula falsi; it reports false when g has no value
// somewhere it looked, and returns its last estimate.
func root(g func(float64) float64, g0, g1 float64) (float64, bool) {
	lo, hi, flo, fhi := 0.0, 1.0, g0, g1
	if flo == 0 {
		return 0, true
	}
	side := 0
	for range 100 {
		t := (lo*fhi - hi*flo) / (fhi - flo)
		if !(t > lo && t < hi) {
			t = (lo + hi) / 2
		}
		ft := g(t)
		if math.IsNaN(ft) {
			return t, false
		}
		if ft == 0 || hi-lo < 1e-15 || math.Abs(ft) < 1e-15 {
			return t, true
		}
		if (ft >= 0) == (fhi >= 0) {
			hi, fhi = t, ft
			if side == -1 {
				flo /= 2
			}
			side = -1
		} else {
			lo, flo = t, ft
			if side == 1 {
				fhi /= 2
			}
			side = 1
		}
	}
	return (lo*fhi - hi*flo) / (fhi - flo), true
}
