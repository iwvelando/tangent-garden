package engine

import (
	"errors"
	"fmt"
	"math"
	"math/big"
	"reflect"
	"testing"
)

// The split-diameter family (apollonian_split.go). Its seeds are checked
// against closed forms worked from the geometry, not the generator's
// formulas: circles of radii r and 1 − r centered at (r − 1, 0) and (r, 0),
// and the top circle tangent to all three, of radius ρ = r(1 − r)/(1 − r + r²)
// (from Descartes' theorem on −1, 1/r, 1/(1 − r)), centered 1 − ρ from the
// origin and r + ρ from the left circle's center.

// admittedSplits lists every split the engine admits.
func admittedSplits() [][2]int64 {
	var out [][2]int64
	for n := int64(2); n <= 100; n++ {
		for m := int64(1); m < n; m++ {
			if new(big.Int).GCD(nil, nil, big.NewInt(m), big.NewInt(n)).Int64() == 1 && 20*m >= n && 20*(n-m) >= n {
				out = append(out, [2]int64{m, n})
			}
		}
	}
	return out
}

func splitGarden(m, n int64, depth int, minRadius float64, maxCircles int) GardenRequest {
	return seedGarden(fmt.Sprintf("split %d/%d", m, n), depth, minRadius, maxCircles)
}

// exactly converts p/q to the nearest float64.
func exactly(p, q int64) float64 {
	f, _ := new(big.Rat).SetFrac64(p, q).Float64()
	return f
}

func TestGardenSplitSeedsForEveryFraction(t *testing.T) {
	splits := admittedSplits()
	if len(splits) < 2500 {
		t.Fatalf("only %d admitted splits", len(splits))
	}
	worst := 0.0
	for _, f := range splits {
		m, n := f[0], f[1]
		r, err := ComputeGarden(splitGarden(m, n, 0, 1, 4))
		if err != nil {
			t.Fatalf("%d/%d: %v", m, n, err)
		}
		if len(r.Curvature) != 4 || r.Seeds != 4 || r.Root != 1 {
			t.Fatalf("%d/%d: %d circles, seeds %d, root %d", m, n, len(r.Curvature), r.Seeds, r.Root)
		}
		cs := make([]exactCircle, 4)
		g := new(big.Int)
		for i := range cs {
			cs[i] = exactOf(t, r, i)
			if cs[i].b[1].Sign() != 0 || cs[i].x[1].Sign() != 0 || cs[i].y[1].Sign() != 0 {
				t.Fatalf("%d/%d: circle %d has a √3 part", m, n, i)
			}
			g.GCD(nil, nil, g, new(big.Int).Abs(cs[i].b[0]))
		}
		if g.Int64() != 1 {
			t.Fatalf("%d/%d: curvatures share the factor %v", m, n, g)
		}
		if b, z := exactDescartes(cs); !b || !z {
			t.Fatalf("%d/%d: the seed breaks Descartes' identity (curvature %v, centers %v)", m, n, b, z)
		}
		d := int64(r.Denominator)
		for i := 0; i < 4; i++ {
			for j := i + 1; j < 4; j++ {
				if !exactTangent(cs[i], cs[j], d) {
					t.Fatalf("%d/%d: seeds %d and %d are not tangent", m, n, i, j)
				}
			}
		}
		// Independent closed forms, in enclosing radii.
		rr := exactly(m, n)
		rho := rr * (1 - rr) / (1 - rr + rr*rr)
		want := [][3]float64{{0, 0, 1}, {rr - 1, 0, rr}, {rr, 0, 1 - rr}}
		for i, w := range want {
			e := math.Max(math.Abs(r.X[i]-w[0]), math.Max(math.Abs(r.Y[i]-w[1]), math.Abs(r.Radius[i]-w[2])))
			if e > 4*ulp {
				t.Fatalf("%d/%d: circle %d at (%v, %v) radius %v, want %v", m, n, i, r.X[i], r.Y[i], r.Radius[i], w)
			}
			worst = math.Max(worst, e)
		}
		top := []float64{
			math.Abs(r.Radius[3] - rho),
			math.Abs(math.Hypot(r.X[3], r.Y[3]) - (1 - rho)),
			math.Abs(math.Hypot(r.X[3]-(rr-1), r.Y[3]) - (rr + rho)),
		}
		for _, e := range top {
			if e > 8*ulp {
				t.Fatalf("%d/%d: the top circle misses its closed form by %v", m, n, e)
			}
			worst = math.Max(worst, e)
		}
		if r.Y[3] <= 0 {
			t.Fatalf("%d/%d: the third seed is below the diameter", m, n)
		}
	}
	t.Logf("%d splits; worst closed-form error %.2g ulp", len(splits), worst/ulp)
}

// At 1/2 the family's seed is the original's, so the packing is the
// original's circle for circle: the same identities, geometry and ancestry.
// Windowed, the linear dual decides each gap as the original's test does.
func TestGardenSplitHalfIsTheOriginal(t *testing.T) {
	for _, w := range []*GardenWindow{nil, {XMin: 0.3, XMax: 0.4, YMin: 0.45, YMax: 0.55}, {XMin: -0.1, XMax: 0.1, YMin: -0.05, YMax: 0.05}} {
		a, b := garden(12, 0.001, 5000), splitGarden(1, 2, 12, 0.001, 5000)
		a.Window, b.Window = w, w
		o, s := mustGarden(t, a), mustGarden(t, b)
		for name, pair := range map[string][2]any{
			"curvature": {o.Curvature, s.Curvature}, "weightedX": {o.WeightedX, s.WeightedX},
			"weightedY": {o.WeightedY, s.WeightedY}, "x": {o.X, s.X}, "y": {o.Y, s.Y},
			"radius": {o.Radius, s.Radius}, "parents": {o.Parents, s.Parents},
			"opposite": {o.Opposite, s.Opposite}, "omitted": {o.Omitted, s.Omitted},
		} {
			if !reflect.DeepEqual(pair[0], pair[1]) {
				t.Fatalf("window %+v: %s differs from the original seed's", w, name)
			}
		}
		if len(o.Curvature) < 20 {
			t.Fatalf("window %+v: only %d circles", w, len(o.Curvature))
		}
	}
}

// r and 1 − r are mirror images across the vertical axis: the same
// identities with X negated, and the same packing drawn reversed.
func TestGardenSplitMirror(t *testing.T) {
	for _, f := range [][2]int64{{1, 20}, {1, 5}, {2, 7}, {37, 97}} {
		m, n := f[0], f[1]
		a := mustGarden(t, splitGarden(m, n, 12, 0.002, 5000))
		b := mustGarden(t, splitGarden(n-m, n, 12, 0.002, 5000))
		if len(a.Curvature) != len(b.Curvature) || a.Denominator != b.Denominator {
			t.Fatalf("%d/%d: %d circles, its mirror %d", m, n, len(a.Curvature), len(b.Curvature))
		}
		mirror := map[[3]float64]bool{}
		for i := range b.Curvature {
			e := b.Exact[6*i:]
			mirror[[3]float64{e[0], -e[2], e[4]}] = true
		}
		for i := range a.Curvature {
			e := a.Exact[6*i:]
			if !mirror[[3]float64{e[0], e[2], e[4]}] {
				t.Fatalf("%d/%d: circle %d has no mirror image in %d/%d", m, n, i, n-m, n)
			}
		}
		// Each member is also symmetric across the diameter. A circle's
		// image below it can be a generation deeper (the top seed's is
		// generation 1), so this is checked where depth binds nowhere, and
		// below the top seed's radius, which a seed keeps but its image
		// does not.
		c := mustGarden(t, splitGarden(m, n, 12, 0.04, 5000))
		if c.Omitted.Depth != 0 || c.Omitted.Radius == 0 {
			t.Fatalf("%d/%d: the radius-limited packing is cut by depth: %+v", m, n, c.Omitted)
		}
		self := map[[3]float64]bool{}
		for i := range c.Curvature {
			e := c.Exact[6*i:]
			self[[3]float64{e[0], e[2], e[4]}] = true
		}
		for k := range self {
			if !self[[3]float64{k[0], k[1], -k[2]}] {
				t.Fatalf("%d/%d: circle %v has no image across the diameter", m, n, k)
			}
		}
	}
}

func TestGardenSplitRefusals(t *testing.T) {
	q := func(split []int64) GardenRequest {
		return GardenRequest{Seed: GardenSplitSeed, Depth: 4, MinRadius: 0.01, MaxCircles: 100, Split: split}
	}
	for _, c := range []struct {
		name string
		q    GardenRequest
	}{
		{"missing", q(nil)},
		{"one number", q([]int64{1})},
		{"three numbers", q([]int64{1, 4, 1})},
		{"zero", q([]int64{0, 5})},
		{"one", q([]int64{5, 5})},
		{"negative", q([]int64{-1, 5})},
		{"beyond one", q([]int64{6, 5})},
		{"zero denominator", q([]int64{1, 0})},
		{"negative denominator", q([]int64{-1, -4})},
		{"not in lowest terms", q([]int64{2, 10})},
		{"denominator above 100", q([]int64{50, 101})},
		{"below 1/20", q([]int64{1, 21})},
		{"above 19/20", q([]int64{20, 21})},
		{"another seed", GardenRequest{Seed: GardenSeed, Depth: 4, MinRadius: 0.01, MaxCircles: 100, Split: []int64{1, 3}}},
	} {
		_, err := ComputeGarden(c.q)
		var named *FieldError
		if !errors.As(err, &named) || named.Field != "split" {
			t.Errorf("%s: got %v, want an error naming split", c.name, err)
		}
	}
	for _, f := range [][2]int64{{1, 20}, {19, 20}, {1, 2}, {1, 3}, {37, 97}, {5, 99}} {
		if _, err := ComputeGarden(q([]int64{f[0], f[1]})); err != nil {
			t.Errorf("%d/%d is refused: %v", f[0], f[1], err)
		}
	}
}
