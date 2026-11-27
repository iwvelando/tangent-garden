package physical

import (
	"errors"
	"math"
	"math/cmplx"
	"sort"
)

// Polygon is a counterclockwise outer loop and the clockwise loops of its
// holes, as indices into a shared point list.
type Polygon struct {
	Outer []int32
	Holes [][]int32
}

type box struct{ lo, hi complex128 }

func loopBox(pts []complex128, l []int32) box {
	b := box{pts[l[0]], pts[l[0]]}
	for _, v := range l {
		p := pts[v]
		b.lo = complex(math.Min(real(b.lo), real(p)), math.Min(imag(b.lo), imag(p)))
		b.hi = complex(math.Max(real(b.hi), real(p)), math.Max(imag(b.hi), imag(p)))
	}
	return b
}

func (b box) holds(c box) bool {
	return real(c.lo) >= real(b.lo) && imag(c.lo) >= imag(b.lo) && real(c.hi) <= real(b.hi) && imag(c.hi) <= imag(b.hi)
}

// inLoop reports whether x lies inside the loop, by crossings of a ray.
func inLoop(pts []complex128, l []int32, x complex128) bool {
	in := false
	for k := range l {
		a, b := pts[l[k]], pts[l[(k+1)%len(l)]]
		if (imag(a) > imag(x)) != (imag(b) > imag(x)) {
			t := (imag(x) - imag(a)) / (imag(b) - imag(a))
			if real(a)+t*(real(b)-real(a)) > real(x) {
				in = !in
			}
		}
	}
	return in
}

// Nest groups disjoint, simple, oriented loops into polygons: each
// counterclockwise loop is an outer boundary, and each clockwise loop a
// hole of the smallest counterclockwise loop around it. A clockwise loop
// inside none is an orphan, returned by index.
func Nest(pts []complex128, loops [][]int32) (polys []Polygon, orphans []int) {
	type piece struct {
		loop int
		area float64
		b    box
	}
	var outers, holes []piece
	for i, l := range loops {
		a := Area(pts, l)
		p := piece{i, math.Abs(a), loopBox(pts, l)}
		if a > 0 {
			outers = append(outers, p)
		} else {
			holes = append(holes, p)
		}
	}
	sort.SliceStable(outers, func(i, j int) bool { return outers[i].area < outers[j].area })
	index := map[int]int{}
	for k, o := range outers {
		index[o.loop] = k
		polys = append(polys, Polygon{Outer: loops[o.loop]})
	}
	for _, h := range holes {
		x := pts[loops[h.loop][0]]
		found := -1
		for k, o := range outers {
			if o.area > h.area && o.b.holds(h.b) && inLoop(pts, loops[o.loop], x) {
				found = k
				break
			}
		}
		if found < 0 {
			orphans = append(orphans, h.loop)
			continue
		}
		polys[found].Holes = append(polys[found].Holes, loops[h.loop])
	}
	return polys, orphans
}

// ErrStalled is returned when ear clipping finds no ear: the polygon was
// not simple, or its holes touched.
var ErrStalled = errors.New("the triangulation found no ear")

type earList struct {
	pts        []complex128
	pt         []int32 // point of each node
	prev, next []int32
	dead       []bool
}

func (e *earList) add(p int32, after int32) int32 {
	n := int32(len(e.pt))
	e.pt = append(e.pt, p)
	e.dead = append(e.dead, false)
	if after < 0 {
		e.prev = append(e.prev, n)
		e.next = append(e.next, n)
		return n
	}
	e.prev = append(e.prev, after)
	e.next = append(e.next, e.next[after])
	e.prev[e.next[after]] = n
	e.next[after] = n
	return n
}

func (e *earList) at(n int32) complex128 { return e.pts[e.pt[n]] }

// turn is twice the signed area of the corner at n: positive when convex.
func (e *earList) turn(n int32) float64 {
	a, b, c := e.at(e.prev[n]), e.at(n), e.at(e.next[n])
	return cross(b-a, c-b)
}

// Triangulate fills a polygon with counterclockwise triangles: holes are
// joined to the outer loop by bridges (each hole, in order of its
// rightmost point, to a visible point found along a ray to the right),
// and ears are clipped from the joined loop. A polygon of n points and h
// holes gives n + 2h − 2 triangles, every one using only its points.
func Triangulate(pts []complex128, p Polygon) ([][3]int32, error) {
	e := &earList{pts: pts}
	ring := func(l []int32) int32 {
		last := int32(-1)
		for _, v := range l {
			last = e.add(v, last)
		}
		return last
	}
	start := ring(p.Outer)
	type hole struct {
		node int32
		x    float64
	}
	var hs []hole
	for _, h := range p.Holes {
		last := ring(h)
		// The hole's rightmost node, lowest y among ties.
		best := last
		for n := e.next[last]; ; n = e.next[n] {
			if real(e.at(n)) > real(e.at(best)) || real(e.at(n)) == real(e.at(best)) && imag(e.at(n)) < imag(e.at(best)) {
				best = n
			}
			if n == last {
				break
			}
		}
		hs = append(hs, hole{best, real(e.at(best))})
	}
	sort.SliceStable(hs, func(i, j int) bool { return hs[i].x > hs[j].x })
	for _, h := range hs {
		bridge, err := e.visible(start, h.node)
		if err != nil {
			return nil, err
		}
		// bridge → hole … → hole' → bridge' → bridge's old next.
		m2 := e.add(e.pt[h.node], e.prev[h.node])
		_ = m2
		// Splice: the hole's ring is m … prev(m) → m2; open it between m2 and m.
		e.next[m2] = -1
		after := e.next[bridge]
		b2 := e.add(e.pt[bridge], bridge)
		_ = b2
		// Now bridge → b2 → after; rewire to bridge → m … m2 → b2 → after.
		e.next[bridge] = h.node
		e.prev[h.node] = bridge
		e.next[m2] = b2
		e.prev[b2] = m2
		e.next[b2] = after
		e.prev[after] = b2
	}
	tris, err := e.clip(start)
	if err != nil {
		return nil, err
	}
	flip(pts, tris)
	return tris, nil
}

// flip makes the triangulation locally Delaunay by Lawson's edge flips:
// an inner edge whose opposite vertex lies inside the other triangle's
// circumcircle is replaced by the other diagonal of their quadrilateral,
// when that keeps both triangles counterclockwise. Loop edges belong to
// one triangle and are never flipped, so the boundary is kept. Small,
// well-shaped triangles keep a solid's self-intersection check local.
func flip(pts []complex128, tris [][3]int32) {
	type slot struct{ t, k int32 }
	edge := make(map[[2]int32]slot, 3*len(tris))
	for i, tr := range tris {
		for k := range 3 {
			edge[[2]int32{tr[k], tr[(k+1)%3]}] = slot{int32(i), int32(k)}
		}
	}
	queue := make([][2]int32, 0, 3*len(tris))
	for e := range edge {
		if _, ok := edge[[2]int32{e[1], e[0]}]; ok && e[0] < e[1] {
			queue = append(queue, e)
		}
	}
	// A deterministic order, whatever the map's.
	sort.Slice(queue, func(i, j int) bool {
		if queue[i][0] != queue[j][0] {
			return queue[i][0] < queue[j][0]
		}
		return queue[i][1] < queue[j][1]
	})
	limit := 50 * len(tris)
	for len(queue) > 0 && limit > 0 {
		limit--
		e := queue[len(queue)-1]
		queue = queue[:len(queue)-1]
		s1, ok1 := edge[e]
		s2, ok2 := edge[[2]int32{e[1], e[0]}]
		if !ok1 || !ok2 {
			continue
		}
		a, b := e[0], e[1]
		c := tris[s1.t][(s1.k+2)%3]
		d := tris[s2.t][(s2.k+2)%3]
		if incircle(pts[a], pts[b], pts[c], pts[d]) <= 1e-12 {
			continue
		}
		// The new triangles c, a, d and d, b, c must both turn left.
		if cross(pts[a]-pts[c], pts[d]-pts[c]) <= 0 || cross(pts[b]-pts[d], pts[c]-pts[d]) <= 0 {
			continue
		}
		t1, t2 := s1.t, s2.t
		for _, x := range [][2]int32{{a, b}, {b, c}, {c, a}, {b, a}, {a, d}, {d, b}} {
			delete(edge, x)
		}
		tris[t1] = [3]int32{c, a, d}
		tris[t2] = [3]int32{d, b, c}
		for _, t := range []int32{t1, t2} {
			for k := range 3 {
				edge[[2]int32{tris[t][k], tris[t][(k+1)%3]}] = slot{t, int32(k)}
			}
		}
		for _, x := range [][2]int32{{c, a}, {a, d}, {d, b}, {b, c}} {
			if _, ok := edge[[2]int32{x[1], x[0]}]; ok {
				queue = append(queue, x)
			}
		}
	}
}

// visible finds a node of the outer list, from start, that the hole node
// m sees: the nearer end of the first edge a ray from m to the right
// meets, or the reflex node inside the triangle that would hide it making
// the least angle with the ray.
func (e *earList) visible(start, m int32) (int32, error) {
	mp := e.at(m)
	hx := math.Inf(1)
	var hit int32 = -1
	var at complex128
	for n := start; ; {
		nx := e.next[n]
		a, b := e.at(n), e.at(nx)
		if imag(a) != imag(b) && (imag(a) <= imag(mp)) == (imag(mp) <= imag(b)) || imag(a) == imag(mp) && imag(b) == imag(mp) {
			var x float64
			if imag(a) == imag(b) {
				x = math.Min(real(a), real(b))
			} else {
				t := (imag(mp) - imag(a)) / (imag(b) - imag(a))
				x = real(a) + t*(real(b)-real(a))
			}
			if x > real(mp) && x < hx {
				hx = x
				at = complex(x, imag(mp))
				// The edge's end farther right.
				if real(a) > real(b) {
					hit = n
				} else {
					hit = nx
				}
				if a == at {
					hit = n
				} else if b == at {
					hit = nx
				}
			}
		}
		n = nx
		if n == start {
			break
		}
	}
	if hit < 0 {
		return -1, errors.New("a hole lies outside its polygon")
	}
	pp := e.at(hit)
	if pp == at {
		return e.inside(hit, mp), nil
	}
	// Reflex nodes inside the triangle m, at, pp hide pp.
	best, bestTan, bestDist := hit, math.Inf(1), math.Inf(1)
	for n := start; ; {
		r := e.at(n)
		if n != hit && real(r) >= real(mp) && inTriangle(mp, at, pp, r) && e.turn(n) <= 0 {
			tan := math.Abs(imag(r)-imag(mp)) / (real(r) - real(mp))
			d := math.Hypot(real(r)-real(mp), imag(r)-imag(mp))
			if tan < bestTan || tan == bestTan && d < bestDist {
				best, bestTan, bestDist = n, tan, d
			}
		}
		n = e.next[n]
		if n == start {
			break
		}
	}
	return e.inside(best, mp), nil
}

// inside picks, among the nodes at n's point, one whose corner opens
// toward x: an earlier bridge may have duplicated the point.
func (e *earList) inside(n int32, x complex128) int32 {
	p := e.pt[n]
	for k := n; ; {
		if e.pt[k] == p && e.locallyInside(k, x) {
			return k
		}
		k = e.next[k]
		if k == n {
			break
		}
	}
	return n
}

func (e *earList) locallyInside(n int32, x complex128) bool {
	a, b, c := e.at(e.prev[n]), e.at(n), e.at(e.next[n])
	if cross(b-a, c-b) >= 0 {
		return cross(c-b, x-b) >= 0 && cross(x-b, a-b) >= 0
	}
	return !(cross(a-b, x-b) > 0 && cross(x-b, c-b) > 0)
}

// inTriangle reports p inside or on the counterclockwise or clockwise
// triangle a, b, c.
func inTriangle(a, b, c, p complex128) bool {
	d1, d2, d3 := cross(b-a, p-a), cross(c-b, p-b), cross(a-c, p-c)
	neg := d1 < 0 || d2 < 0 || d3 < 0
	pos := d1 > 0 || d2 > 0 || d3 > 0
	return !(neg && pos)
}

// clip removes ears until three nodes remain.
func (e *earList) clip(start int32) ([][3]int32, error) {
	alive := 0
	lo, hi := e.at(start), e.at(start)
	for n := start; ; {
		alive++
		p := e.at(n)
		lo = complex(math.Min(real(lo), real(p)), math.Min(imag(lo), imag(p)))
		hi = complex(math.Max(real(hi), real(p)), math.Max(imag(hi), imag(p)))
		n = e.next[n]
		if n == start {
			break
		}
	}
	// A bucket grid of the nodes, about two to a bucket.
	side := int(math.Max(1, math.Sqrt(float64(alive)/2)))
	w, h := (real(hi)-real(lo))/float64(side)+1e-12, (imag(hi)-imag(lo))/float64(side)+1e-12
	bucket := func(p complex128) (int, int) {
		i := min(int((real(p)-real(lo))/w), side-1)
		j := min(int((imag(p)-imag(lo))/h), side-1)
		return max(i, 0), max(j, 0)
	}
	cells := make([][]int32, side*side)
	for n := start; ; {
		i, j := bucket(e.at(n))
		cells[j*side+i] = append(cells[j*side+i], n)
		n = e.next[n]
		if n == start {
			break
		}
	}
	isEar := func(b int32) bool {
		a, c := e.prev[b], e.next[b]
		pa, pb, pc := e.at(a), e.at(b), e.at(c)
		if cross(pb-pa, pc-pa) <= 0 {
			return false
		}
		lo := complex(math.Min(real(pa), math.Min(real(pb), real(pc))), math.Min(imag(pa), math.Min(imag(pb), imag(pc))))
		hi := complex(math.Max(real(pa), math.Max(real(pb), real(pc))), math.Max(imag(pa), math.Max(imag(pb), imag(pc))))
		i0, j0 := bucket(lo)
		i1, j1 := bucket(hi)
		for j := j0; j <= j1; j++ {
			for i := i0; i <= i1; i++ {
				for _, n := range cells[j*side+i] {
					if e.dead[n] || n == a || n == b || n == c {
						continue
					}
					p := e.at(n)
					if p == pa || p == pb || p == pc {
						continue
					}
					if inTriangle(pa, pb, pc, p) && e.turn(n) <= 0 {
						return false
					}
				}
			}
		}
		return true
	}
	var tris [][3]int32
	n, stall := start, 0
	for alive > 3 {
		if isEar(n) {
			a, c := e.prev[n], e.next[n]
			tris = append(tris, [3]int32{e.pt[a], e.pt[n], e.pt[c]})
			e.dead[n] = true
			e.next[a], e.prev[c] = c, a
			alive--
			n, stall = c, 0
			continue
		}
		n = e.next[n]
		stall++
		if stall > alive {
			return nil, ErrStalled
		}
	}
	a, c := e.prev[n], e.next[n]
	if cross(e.at(n)-e.at(a), e.at(c)-e.at(a)) <= 0 {
		return nil, ErrStalled
	}
	tris = append(tris, [3]int32{e.pt[a], e.pt[n], e.pt[c]})
	return tris, nil
}

// incircle is positive when d lies inside the circle through the
// counterclockwise triangle a, b, c: the classic determinant, divided by
// the fourth power of the triangle's longest edge so that it compares
// shapes, not sizes.
func incircle(a, b, c, d complex128) float64 {
	ad, bd, cd := a-d, b-d, c-d
	la := float64(real(ad)*real(ad)) + float64(imag(ad)*imag(ad))
	lb := float64(real(bd)*real(bd)) + float64(imag(bd)*imag(bd))
	lc := float64(real(cd)*real(cd)) + float64(imag(cd)*imag(cd))
	det := float64(la*cross(bd, cd)) + float64(lb*cross(cd, ad)) + float64(lc*cross(ad, bd))
	e := math.Max(cmplx.Abs(b-a), math.Max(cmplx.Abs(c-b), cmplx.Abs(a-c)))
	return det / (e * e * e * e)
}
