package engine

import (
	"errors"
	"math"
	"math/big"
	"reflect"
	"testing"
)

func garden(depth int, minRadius float64, maxCircles int) GardenRequest {
	return GardenRequest{Seed: GardenSeed, Depth: depth, MinRadius: minRadius, MaxCircles: maxCircles}
}

func mustGarden(t *testing.T, q GardenRequest) GardenResult {
	t.Helper()
	r, err := ComputeGarden(q)
	if err != nil {
		t.Fatal(err)
	}
	n := len(r.Curvature)
	for name, length := range map[string]int{
		"x": len(r.X), "y": len(r.Y), "radius": len(r.Radius),
		"weightedX": len(r.WeightedX), "weightedY": len(r.WeightedY),
		"generation": len(r.Generation), "parents": len(r.Parents), "opposite": len(r.Opposite),
	} {
		if length != n {
			t.Fatalf("%s has %d entries, curvature %d", name, length, n)
		}
	}
	return r
}

// The seed is the enclosing unit circle (curvature −1) around radius-1/2
// circles at (∓1/2, 0) and a radius-1/3 circle at (0, 2/3), in that order.
func TestGardenSeedCircles(t *testing.T) {
	r := mustGarden(t, garden(0, 0.001, 5000))
	want := []struct{ b, bx, by, x, y, radius float64 }{
		{-1, 0, 0, 0, 0, 1},
		{2, -1, 0, -0.5, 0, 0.5},
		{2, 1, 0, 0.5, 0, 0.5},
		{3, 0, 2, 0, 2.0 / 3, 1.0 / 3},
	}
	if len(r.Curvature) != len(want) {
		t.Fatalf("depth 0 has %d circles, want the 4 seeds", len(r.Curvature))
	}
	for i, w := range want {
		if r.Curvature[i] != w.b || r.WeightedX[i] != w.bx || r.WeightedY[i] != w.by {
			t.Errorf("seed %d is (%v, %v, %v), want (%v, %v, %v)", i, r.Curvature[i], r.WeightedX[i], r.WeightedY[i], w.b, w.bx, w.by)
		}
		if r.X[i] != w.x || r.Y[i] != w.y || r.Radius[i] != w.radius {
			t.Errorf("seed %d is at (%v, %v) radius %v, want (%v, %v) radius %v", i, r.X[i], r.Y[i], r.Radius[i], w.x, w.y, w.radius)
		}
		if math.Signbit(r.X[i]) && r.X[i] == 0 {
			t.Errorf("seed %d has a negative zero x", i)
		}
		if r.Generation[i] != 0 || r.Opposite[i] != -1 || r.Parents[i] != [3]float64{-1, -1, -1} {
			t.Errorf("seed %d has ancestry %v/%v at generation %v", i, r.Parents[i], r.Opposite[i], r.Generation[i])
		}
	}
	if r.Omitted.Depth != 4 || r.Omitted.Radius != 0 || r.Stopped != "" {
		t.Errorf("depth 0 omitted %+v, stopped %q; want the four first gaps cut by depth", r.Omitted, r.Stopped)
	}
}

// The first generation fills the four gaps of the seed in index order:
// replacing the enclosing circle, each radius-1/2 circle, then the top one.
// Values are worked by hand from the tangencies, not from the recurrence.
func TestGardenFirstGeneration(t *testing.T) {
	r := mustGarden(t, garden(1, 0.001, 5000))
	want := []struct {
		b, bx, by float64
		parents   [3]float64
		opposite  float64
	}{
		// Radius 1/15 at (0, 4/15): 2/3 − 4/15 = 1/3 + 1/15 from the top
		// circle, and √(1/4 + 16/225) = 1/2 + 1/15 from each side circle.
		{15, 0, 4, [3]float64{1, 2, 3}, 0},
		// Radius 1/6 at (±1/2, 2/3), opposite the side circle replaced: 5/6 from the origin is 1 − 1/6.
		{6, 3, 4, [3]float64{0, 2, 3}, 1},
		{6, -3, 4, [3]float64{0, 1, 3}, 2},
		// Radius 1/3 at (0, −2/3), the mirror image of the top seed.
		{3, 0, -2, [3]float64{0, 1, 2}, 3},
	}
	if len(r.Curvature) != 8 {
		t.Fatalf("depth 1 has %d circles, want 8", len(r.Curvature))
	}
	for k, w := range want {
		i := 4 + k
		if r.Curvature[i] != w.b || r.WeightedX[i] != w.bx || r.WeightedY[i] != w.by {
			t.Errorf("circle %d is (%v, %v, %v), want (%v, %v, %v)", i, r.Curvature[i], r.WeightedX[i], r.WeightedY[i], w.b, w.bx, w.by)
		}
		if r.Parents[i] != w.parents || r.Opposite[i] != w.opposite || r.Generation[i] != 1 {
			t.Errorf("circle %d came from %v replacing %v at generation %v, want %v replacing %v at 1", i, r.Parents[i], r.Opposite[i], r.Generation[i], w.parents, w.opposite)
		}
	}
	if r.Omitted.Depth != 12 {
		t.Errorf("depth 1 left %d gaps by depth, want 4 × 3", r.Omitted.Depth)
	}
}

// Independent checks on everything returned: Descartes' identity on each
// circle's quadruple, in exact integers, for curvatures and for weighted
// centers as complex numbers; tangency to each generator with a
// scale-aware residual, internal for the enclosing circle; containment;
// disjoint interiors; and distinct identities.
func checkPacking(t *testing.T, r GardenResult) {
	t.Helper()
	n := len(r.Curvature)
	exact := func(v float64) *big.Int {
		if v != math.Trunc(v) || math.Abs(v) > 1<<53 {
			t.Fatalf("%v is not an exact integer", v)
		}
		return big.NewInt(int64(v))
	}
	sq := func(a *big.Int) *big.Int { return new(big.Int).Mul(a, a) }
	seen := map[[3]float64]int{}
	for i := 0; i < n; i++ {
		key := [3]float64{r.Curvature[i], r.WeightedX[i], r.WeightedY[i]}
		if j, ok := seen[key]; ok {
			t.Fatalf("circles %d and %d share the identity %v", j, i, key)
		}
		seen[key] = i
		// The returned geometry agrees with the identity.
		b := r.Curvature[i]
		if math.Abs(r.Radius[i]-1/math.Abs(b)) > 0 || r.X[i] != r.WeightedX[i]/b+0 || r.Y[i] != r.WeightedY[i]/b+0 {
			t.Fatalf("circle %d's geometry disagrees with its curvature and weighted center", i)
		}
		if i == 0 {
			continue
		}
		if math.Hypot(r.X[i], r.Y[i])+r.Radius[i] > 1+1e-15 {
			t.Fatalf("circle %d leaves the enclosing circle", i)
		}
		if r.Generation[i] == 0 {
			continue
		}
		quad := []int{i}
		for _, p := range r.Parents[i] {
			if p < 0 || int(p) >= i {
				t.Fatalf("circle %d has generator %v, not an earlier circle", i, p)
			}
			quad = append(quad, int(p))
		}
		o := int(r.Opposite[i])
		if o < 0 || o >= i {
			t.Fatalf("circle %d replaces %d, not an earlier circle", i, o)
		}
		// Both quadruples, the new one and the one it replaced in, satisfy
		// (Σb)² = 2Σb² and (Σz)² = 2Σz² with z = b·(x + iy).
		for _, q := range [][]int{quad, {o, quad[1], quad[2], quad[3]}} {
			sb, sb2 := new(big.Int), new(big.Int)
			sx, sy, sre, sim := new(big.Int), new(big.Int), new(big.Int), new(big.Int)
			for _, k := range q {
				bk, xk, yk := exact(r.Curvature[k]), exact(r.WeightedX[k]), exact(r.WeightedY[k])
				sb.Add(sb, bk)
				sb2.Add(sb2, sq(bk))
				sx.Add(sx, xk)
				sy.Add(sy, yk)
				// z² = (x² − y²) + 2xy i
				sre.Add(sre, new(big.Int).Sub(sq(xk), sq(yk)))
				sim.Add(sim, new(big.Int).Mul(big.NewInt(2), new(big.Int).Mul(xk, yk)))
			}
			if sq(sb).Cmp(new(big.Int).Lsh(sb2, 1)) != 0 {
				t.Fatalf("curvatures of %v break Descartes' identity", q)
			}
			re := new(big.Int).Sub(sq(sx), sq(sy))
			im := new(big.Int).Mul(big.NewInt(2), new(big.Int).Mul(sx, sy))
			if re.Cmp(new(big.Int).Lsh(sre, 1)) != 0 || im.Cmp(new(big.Int).Lsh(sim, 1)) != 0 {
				t.Fatalf("weighted centers of %v break the complex Descartes identity", q)
			}
		}
		for _, k := range quad[1:] {
			d := math.Hypot(r.X[i]-r.X[k], r.Y[i]-r.Y[k])
			want := r.Radius[i] + r.Radius[k]
			if r.Curvature[k] < 0 {
				want = r.Radius[k] - r.Radius[i]
			}
			scale := math.Hypot(r.X[i], r.Y[i]) + math.Hypot(r.X[k], r.Y[k]) + r.Radius[i] + r.Radius[k]
			if math.Abs(d-want) > 64*0x1p-52*scale {
				t.Fatalf("circle %d is not tangent to generator %d: distance %v, want %v", i, k, d, want)
			}
		}
	}
	for i := 1; i < n; i++ {
		for j := i + 1; j < n; j++ {
			d := math.Hypot(r.X[i]-r.X[j], r.Y[i]-r.Y[j])
			if d < r.Radius[i]+r.Radius[j]-64*0x1p-52*(2+r.Radius[i]+r.Radius[j]) {
				t.Fatalf("circles %d and %d overlap", i, j)
			}
		}
	}
	if r.Duplicates != 0 {
		t.Fatalf("%d duplicate branches were generated", r.Duplicates)
	}
}

func TestGardenIsAPacking(t *testing.T) {
	for _, q := range []GardenRequest{
		garden(4, 0.0001, 5000),
		garden(12, 0.01, 5000),
		garden(12, 0.002, 5000),
		garden(GardenMaxDepth, 1e-9, GardenMaxCircles),
	} {
		r := mustGarden(t, q)
		if len(r.Curvature) < 50 {
			t.Fatalf("%+v has only %d circles to check", q, len(r.Curvature))
		}
		checkPacking(t, r)
		for i := range r.Curvature {
			if i >= 4 && (r.Radius[i] < q.MinRadius || r.Generation[i] > float64(q.Depth)) {
				t.Fatalf("%+v admitted circle %d of radius %v at generation %v", q, i, r.Radius[i], r.Generation[i])
			}
			if i > 0 && r.Generation[i] < r.Generation[i-1] {
				t.Fatalf("circle %d precedes an earlier generation", i)
			}
		}
	}
}

// Only the radius cutoff binds here, so the finite packing is every circle
// of at least that radius. The full packing is symmetric in both axes,
// though the generator meets the bottom circle a generation after the top
// one, so the symmetry independently checks that nothing was left out.
func TestGardenRadiusCutoffIsComplete(t *testing.T) {
	r := mustGarden(t, garden(12, 0.01, 5000))
	if r.Omitted.Depth != 0 || r.Stopped != "" || r.Omitted.Radius == 0 {
		t.Fatalf("want only the radius cutoff to bind; omitted %+v, stopped %q", r.Omitted, r.Stopped)
	}
	keys := map[[3]float64]bool{}
	for i := range r.Curvature {
		keys[[3]float64{r.Curvature[i], r.WeightedX[i], r.WeightedY[i]}] = true
	}
	for k := range keys {
		for _, m := range [][3]float64{{k[0], -k[1], k[2]}, {k[0], k[1], -k[2]}} {
			if !keys[m] {
				t.Fatalf("%v has no mirror image %v", k, m)
			}
		}
	}
}

func TestGardenIsDeterministic(t *testing.T) {
	q := garden(10, 0.004, 3000)
	a, b := mustGarden(t, q), mustGarden(t, q)
	if len(a.Curvature) < 100 || !reflect.DeepEqual(a, b) {
		t.Fatal("repeated requests differ")
	}
}

// Each cutoff reports itself, and no other.
func TestGardenCutoffsAreDistinct(t *testing.T) {
	byCount := mustGarden(t, garden(12, 1e-6, 100))
	if byCount.Stopped != "count" || len(byCount.Curvature) != 100 || byCount.Pending == 0 {
		t.Errorf("count: stopped %q with %d circles and %d pending", byCount.Stopped, len(byCount.Curvature), byCount.Pending)
	}
	seeds := mustGarden(t, garden(12, 1e-6, 4))
	if seeds.Stopped != "count" || len(seeds.Curvature) != 4 {
		t.Errorf("four circles: stopped %q with %d circles", seeds.Stopped, len(seeds.Curvature))
	}
	byDepth := mustGarden(t, garden(3, 1e-6, 5000))
	if byDepth.Stopped != "" || byDepth.Omitted.Depth == 0 || byDepth.Omitted.Radius != 0 || byDepth.Pending != 0 {
		t.Errorf("depth: %+v, stopped %q, %d pending", byDepth.Omitted, byDepth.Stopped, byDepth.Pending)
	}
	// 4 + 4·3 + 4·3² + 4·3³ circles fill every gap up to generation 3.
	if len(byDepth.Curvature) != 4+4+12+36 {
		t.Errorf("depth 3 has %d circles, want 56", len(byDepth.Curvature))
	}
	byRadius := mustGarden(t, garden(12, 1, 5000))
	if len(byRadius.Curvature) != 4 || byRadius.Omitted.Radius != 4 || byRadius.Omitted.Depth != 0 {
		t.Errorf("radius 1: %d circles, omitted %+v", len(byRadius.Curvature), byRadius.Omitted)
	}
	work, err := computeGarden(garden(12, 1e-6, 5000), gardenLimits{configurations: 50})
	if err != nil {
		t.Fatal(err)
	}
	if work.Stopped != "configurations" || work.Processed != 50 || work.Pending == 0 {
		t.Errorf("work: stopped %q after %d configurations with %d pending", work.Stopped, work.Processed, work.Pending)
	}
	checkPacking(t, work)
}

// A gap whose circle is both too small and too deep counts under radius:
// depth is reported only where it, not the radius, left a gap unfilled.
// At depth 1 and minimum radius 0.2, only the bottom circle (radius 1/3) is
// admitted; its three gaps hold circles of radius 1/15, 1/6 and 1/6.
func TestGardenRadiusTakesPrecedenceInReports(t *testing.T) {
	r := mustGarden(t, garden(1, 0.2, 5000))
	if len(r.Curvature) != 5 || r.Curvature[4] != 3 || r.WeightedY[4] != -2 {
		t.Fatalf("want the seeds and the bottom circle, got curvatures %v", r.Curvature)
	}
	if r.Omitted != (GardenOmitted{Radius: 6, Depth: 0}) {
		t.Fatalf("omitted %+v, want 3 + 3 gaps by radius", r.Omitted)
	}
}

// A circle exactly at the minimum radius is kept: radius 1/15 is the same
// double whether computed from curvature 15 or entered.
func TestGardenKeepsACircleAtTheMinimumRadius(t *testing.T) {
	at := mustGarden(t, garden(1, 1.0/15, 5000))
	above := mustGarden(t, garden(1, math.Nextafter(1.0/15, 1), 5000))
	if len(at.Curvature) != 8 || len(above.Curvature) != 7 {
		t.Fatalf("at 1/15: %d circles, just above: %d; want 8 and 7", len(at.Curvature), len(above.Curvature))
	}
}

// At the hard ceilings, work stays within its limits.
func TestGardenWorkIsBounded(t *testing.T) {
	r := mustGarden(t, garden(GardenMaxDepth, 5e-324, GardenMaxCircles))
	if len(r.Curvature) != GardenMaxCircles || r.Stopped != "count" {
		t.Fatalf("%d circles, stopped %q", len(r.Curvature), r.Stopped)
	}
	if r.Processed > GardenMaxConfigurations || r.Pending > GardenMaxCircles {
		t.Fatalf("processed %d, pending %d", r.Processed, r.Pending)
	}
	for _, b := range r.Curvature {
		if math.Abs(b) > 1<<53 {
			t.Fatalf("curvature %v is beyond exact transport", b)
		}
	}
}

func TestGardenRefusesInvalidRequests(t *testing.T) {
	for _, c := range []struct {
		q     GardenRequest
		field string
	}{
		{GardenRequest{Seed: "", Depth: 4, MinRadius: 0.01, MaxCircles: 100}, "seed"},
		{garden(-1, 0.01, 100), "depth"},
		{garden(13, 0.01, 100), "depth"},
		{garden(4, 0, 100), "minRadius"},
		{garden(4, -0.01, 100), "minRadius"},
		{garden(4, 1.0000000000000002, 100), "minRadius"},
		{garden(4, math.NaN(), 100), "minRadius"},
		{garden(4, math.Inf(1), 100), "minRadius"},
		{garden(4, 0.01, 3), "maxCircles"},
		{garden(4, 0.01, 5001), "maxCircles"},
	} {
		_, err := ComputeGarden(c.q)
		var named *FieldError
		if !errors.As(err, &named) || named.Field != c.field {
			t.Errorf("%+v: got %v, want an error naming %s", c.q, err, c.field)
		}
	}
	for _, q := range []GardenRequest{garden(0, 1, 4), garden(12, 5e-324, 5000)} {
		if _, err := ComputeGarden(q); err != nil {
			t.Errorf("%+v is at its bounds but refused: %v", q, err)
		}
	}
}

func TestCheckedDescartesOverflow(t *testing.T) {
	if _, ok := descartes(math.MaxInt64/2, 1, 0, 0); ok {
		t.Error("an overflowing replacement was accepted")
	}
	if _, ok := descartes(1<<52, 1<<52, 0, 0); ok {
		t.Error("a replacement beyond 2^53 was accepted")
	}
	if v, ok := descartes(2, 2, 3, -1); !ok || v != 15 {
		t.Errorf("2(2+2+3) − (−1) = %v, %v", v, ok)
	}
}
