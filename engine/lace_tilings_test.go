package engine

import (
	"math"
	"strconv"
	"strings"
	"testing"
)

// Issue #389's research: further regular tilings {p,q}. The checks here
// take p and q from the tiling's name, not from the generator, and compare
// the shipped generator with the exact one in lace_exact_test.go.

var researchTilings = []string{"7,3", "5,4", "4,5", "3,7"}

func tilingPQ(t testing.TB, id string) (int, int) {
	t.Helper()
	parts := strings.Split(id, ",")
	if len(parts) != 2 {
		t.Fatalf("tiling %q", id)
	}
	p, err1 := strconv.Atoi(parts[0])
	q, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil {
		t.Fatalf("tiling %q", id)
	}
	return p, q
}

func tiling(id string, depth, maxTiles int, starPoint float64) LaceRequest {
	return LaceRequest{Tiling: id, Depth: depth, MaxTiles: maxTiles, StarPoint: starPoint}
}

// The shipped generator and the exact one make the same patch: the same
// tiles in the same order with the same parents and sides crossed, the
// same corners and sides as identities, the same counts of tiles around
// each, and the same counters, at every cutoff. Every tile's distance from
// the center agrees with the exact one.
func TestLaceAgreesWithExactGenerator(t *testing.T) {
	for _, id := range researchTilings {
		p, q := tilingPQ(t, id)
		for _, cut := range [][2]int{{0, 1}, {1, 1000}, {2, 3}, {3, 50}, {4, 1000}, {5, 400}, {6, 1000}, {8, 1000}, {8, 777}} {
			r := mustLace(t, tiling(id, cut[0], cut[1], 0.3))
			x := exactGenerate(p, q, cut[0], cut[1], LaceMaxCandidates)
			name := id + " depth " + strconv.Itoa(cut[0]) + " limit " + strconv.Itoa(cut[1])
			compareExact(t, name, p, r, x)
		}
	}
}

func compareExact(t *testing.T, name string, p int, r LaceResult, x *exactLace) {
	t.Helper()
	n := len(r.Center)
	if n != len(x.center) {
		t.Fatalf("%s: %d tiles, exact %d", name, n, len(x.center))
	}
	for i := range n {
		if int(r.Depth[i]) != x.depth[i] || int(r.Parent[i]) != x.parent[i] || int(r.Via[i]) != x.via[i] {
			t.Fatalf("%s: tile %d depth %v parent %v via %v, exact %d %d %d", name, i, r.Depth[i], r.Parent[i], r.Via[i], x.depth[i], x.parent[i], x.via[i])
		}
		if r.Reversed[i] != (x.depth[i]%2 == 1) {
			t.Fatalf("%s: tile %d reversed %v at depth %d", name, i, r.Reversed[i], x.depth[i])
		}
	}
	// Vertex and edge indices name exact identities one to one.
	vertexOf, edgeOf := map[int]string{}, map[int]string{}
	byVertex, byEdge := map[string]int{}, map[string]int{}
	match := func(kind string, m map[int]string, back map[string]int, index int, key string) {
		if k, ok := m[index]; ok && k != key {
			t.Fatalf("%s: %s %d is two exact points", name, kind, index)
		}
		if j, ok := back[key]; ok && j != index {
			t.Fatalf("%s: exact %s is both %d and %d", name, kind, j, index)
		}
		m[index], back[key] = key, index
	}
	for i := range n {
		for k := range p {
			match("vertex", vertexOf, byVertex, int(r.Corners[p*i+k]), x.corners[i][k])
			match("edge", edgeOf, byEdge, int(r.Sides[p*i+k]), x.sides[i][k])
		}
	}
	if len(vertexOf) != len(r.Vertex) || len(edgeOf) != len(r.EdgeA) {
		t.Fatalf("%s: %d of %d vertices and %d of %d edges are corners and sides", name, len(vertexOf), len(r.Vertex), len(edgeOf), len(r.EdgeA))
	}
	for v, key := range vertexOf {
		if int(r.VertexTiles[v]) != x.vertexTiles[key] {
			t.Fatalf("%s: vertex %d has %v tiles, exact %d", name, v, r.VertexTiles[v], x.vertexTiles[key])
		}
	}
	for e, key := range edgeOf {
		if int(r.EdgeTiles[e]) != x.edgeTiles[key] {
			t.Fatalf("%s: edge %d has %v tiles, exact %d", name, e, r.EdgeTiles[e], x.edgeTiles[key])
		}
	}
	if r.Processed != x.processed || r.Duplicates != x.duplicate || r.Omitted.Depth != x.omitted ||
		r.Omitted.Precision != 0 || r.Stopped != x.stopped || r.Pending != x.pending {
		t.Fatalf("%s: processed %d, duplicates %d, omitted %+v, stopped %q with %d pending; exact %d, %d, %d, %q, %d",
			name, r.Processed, r.Duplicates, r.Omitted, r.Stopped, r.Pending, x.processed, x.duplicate, x.omitted, x.stopped, x.pending)
	}
	worst := 0.0
	for i := range n {
		c := cz(r.Center[i])
		got := 2 * math.Atanh(math.Hypot(real(c), imag(c)))
		want := math.Acosh(x.coshFromCenter(i))
		worst = math.Max(worst, math.Abs(got-want))
	}
	if worst > laceBudget {
		t.Errorf("%s: distances from the center within %v of exact, budget %v", name, worst, laceBudget)
	}
}

// Ring sizes: {7,3} and {5,4} hold p·F(2n) tiles at depth n ≥ 1, F the
// Fibonacci numbers; every tiling's rings are the exact generator's, and
// a depth's omissions are the next ring, each tile counted once.
func TestLaceTilingRings(t *testing.T) {
	fib := []int{0, 1}
	for len(fib) < 20 {
		fib = append(fib, fib[len(fib)-1]+fib[len(fib)-2])
	}
	for _, id := range researchTilings {
		p, q := tilingPQ(t, id)
		x := exactGenerate(p, q, 9, 1<<20, 1<<22)
		ring := make([]int, 10)
		for _, d := range x.depth {
			ring[d]++
		}
		if id == "7,3" || id == "5,4" {
			for n := 1; n < len(ring); n++ {
				if ring[n] != p*fib[2*n] {
					t.Errorf("%s: exact ring %d holds %d, want %d·F(%d) = %d", id, n, ring[n], p, 2*n, p*fib[2*n])
				}
			}
		}
		for d := 0; d <= 8; d++ {
			r := computeLace(tiling(id, d, 1<<20, 0.3), laceLimits{d, 1 << 22, lacePolicy})
			count := make([]int, d+1)
			for _, v := range r.Depth {
				count[int(v)]++
			}
			for n := range count {
				if count[n] != ring[n] {
					t.Fatalf("%s depth %d: ring %d holds %d, exact %d", id, d, n, count[n], ring[n])
				}
			}
			if r.Omitted.Depth != ring[d+1] || r.Omitted.Precision != 0 || r.Stopped != "" {
				t.Errorf("%s depth %d omits %+v, stopped %q; want %d beyond depth", id, d, r.Omitted, r.Stopped, ring[d+1])
			}
		}
		t.Logf("%s rings %v", id, ring)
	}
}

// A smaller tile limit gives the breadth-first prefix of a larger one, so
// tile numbers and addresses survive changed cutoffs; and the candidate
// ceiling never binds before the tile limit.
func TestLaceTilingLimitPrefix(t *testing.T) {
	for _, id := range researchTilings {
		p, _ := tilingPQ(t, id)
		full := mustLace(t, tiling(id, 8, 1000, 0.3))
		for _, n := range []int{1, 2, 9, 100, 333} {
			if n > len(full.Center) {
				continue
			}
			r := mustLace(t, tiling(id, 8, n, 0.3))
			if len(r.Center) != n || !reflectEqual(r.Center, full.Center[:n]) || !reflectEqual(r.Parent, full.Parent[:n]) ||
				!reflectEqual(r.Via, full.Via[:n]) || !reflectEqual(r.ArcStart, full.ArcStart[:2*p*n]) {
				t.Errorf("%s: limit %d is not the breadth-first prefix", id, n)
			}
		}
		if full.Processed > p*LaceMaxTiles || full.Processed >= LaceMaxCandidates {
			t.Errorf("%s: %d tiles examined %d candidates", id, len(full.Center), full.Processed)
		}
	}
}

// With the production policy, an unlimited patch to the deepest supported
// depth is resolved without any omission for precision, and is the exact
// generator's patch.
func TestLaceTilingPrecisionAtDepth8(t *testing.T) {
	for _, id := range researchTilings {
		p, q := tilingPQ(t, id)
		r := computeLace(tiling(id, 8, 1<<20, 0.3), laceLimits{8, 1 << 22, lacePolicy})
		x := exactGenerate(p, q, 8, 1<<20, 1<<22)
		if r.Omitted.Precision != 0 || len(r.Center) != len(x.center) {
			t.Errorf("%s depth 8 unlimited: %d tiles (exact %d), %d left out for precision", id, len(r.Center), len(x.center), r.Omitted.Precision)
		}
	}
}

// Duality: bringing a corner of a {p,q} patch to the disk's center and
// turning it half a turn lays its tile centers on the {q,p} tiling's
// vertices and its vertices on that tiling's tile centers, wherever both
// finite patches are complete. Both are measured from the returned
// geometry, within the budget in hyperbolic distance.
func TestLaceDuals(t *testing.T) {
	for _, pair := range [][2]string{{"5,4", "4,5"}, {"4,5", "5,4"}, {"7,3", "3,7"}} {
		src := mustLace(t, tiling(pair[0], 8, 1000, 0.3))
		iso := LaceIsometry{Offset: src.VertexRadius, Direction: math.Pi / 2, Rotation: math.Pi}
		a := mustLace(t, LaceRequest{Tiling: pair[0], Depth: 8, MaxTiles: 1000, StarPoint: 0.3, Isometry: &iso})
		b := mustLace(t, tiling(pair[1], 8, 1000, 0.3))
		// Points well inside both patches' complete disks.
		reach := 0.98 * math.Min(a.Coverage.Radius, b.Coverage.Radius)
		if reach < 0.5 {
			t.Fatalf("%v: complete only to radius %v", pair, reach)
		}
		match := func(what string, from, to []Vec) int {
			n := 0
			for _, z := range from {
				if math.Hypot(z.X, z.Y) > reach {
					continue
				}
				n++
				best := math.Inf(1)
				for _, w := range to {
					best = math.Min(best, dist(cz(z), cz(w)))
				}
				if best > laceBudget {
					t.Errorf("%v: %s at %v is %v from the nearest", pair, what, z, best)
					return n
				}
			}
			return n
		}
		n1 := match("a moved vertex", a.Vertex, b.Center)
		n2 := match("a dual tile center", b.Center, a.Vertex)
		n3 := match("a moved tile center", a.Center, b.Vertex)
		n4 := match("a dual vertex", b.Vertex, a.Center)
		if n1 != n2 || n3 != n4 || n1 < 20 || n3 < 20 {
			t.Errorf("%v: within radius %.3f, %d vertices against %d centers and %d centers against %d vertices", pair, reach, n1, n2, n3, n4)
		}
		t.Logf("%v: within radius %.3f, %d vertex–center and %d center–vertex pairs", pair, reach, n1, n3)
	}
}

func reflectEqual[T comparable](a, b []T) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
