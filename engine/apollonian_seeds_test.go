package engine

import (
	"errors"
	"math"
	"math/big"
	"math/rand"
	"reflect"
	"testing"
)

// The garden's catalog of enclosing seeds. The checks here use the
// exact identities the engine returns and recompute everything else in
// big-integer or 256-bit arithmetic, never through the generator's own
// recurrence or float conversion.

const ulp = 0x1p-52

// The value p + q√3 to 256 bits.
func bigRoot3(p, q int64) *big.Float {
	s := new(big.Float).SetPrec(256).SetInt64(3)
	s.Sqrt(s)
	v := new(big.Float).SetPrec(256).SetInt64(q)
	v.Mul(v, s)
	return v.Add(v, new(big.Float).SetPrec(256).SetInt64(p))
}

func relErr(got float64, want *big.Float) float64 {
	w, _ := want.Float64()
	if w == 0 {
		return math.Abs(got)
	}
	d := new(big.Float).SetPrec(256).SetFloat64(got)
	d.Sub(d, want)
	e, _ := d.Float64()
	return math.Abs(e / w)
}

// Conversion keeps a few units of relative error even when p and q√3
// nearly cancel, as they do in powers of the unit 2 − √3.
func TestRoot3FloatIsAccurate(t *testing.T) {
	cases := []qr{{0, 0}, {1, 0}, {-7, 0}, {0, 1}, {0, -5}, {3, -2}, {-3, 2}, {2, -1}, {7, -4}}
	// (2 − √3)^n and (2 + √3)^n, n up to 27, have p and q near 2^52.
	a := qr{1, 0}
	for n := 0; n < 28; n++ {
		cases = append(cases, a, qr{-a.p, -a.q}, qr{a.p, -a.q})
		a = qr{2*a.p - 3*a.q, 2*a.q - a.p} // × (2 − √3)
	}
	rnd := rand.New(rand.NewSource(385))
	for k := 0; k < 20000; k++ {
		p := rnd.Int63n(1<<53) - 1<<52
		q := rnd.Int63n(1<<53) - 1<<52
		cases = append(cases, qr{p, q}, qr{p >> uint(rnd.Intn(50)), q})
	}
	worst := 0.0
	for _, c := range cases {
		got := c.float()
		e := relErr(got, bigRoot3(c.p, c.q))
		if e > 6*ulp {
			t.Fatalf("%d + %d√3: %v has relative error %.3g ulp", c.p, c.q, got, e/ulp)
		}
		worst = math.Max(worst, e)
		if want := bigRoot3(c.p, c.q).Sign(); c.sign() != want {
			t.Fatalf("%d + %d√3: sign %d, want %d", c.p, c.q, c.sign(), want)
		}
	}
	t.Logf("%d values, worst relative error %.3g ulp", len(cases), worst/ulp)
}

// The exact pieces of circle i: curvature b, and the center numerators X
// and Y, each p + q√3, with weighted center (X, Y)/denominator.
type exactCircle struct{ b, x, y [2]*big.Int }

func exactOf(t *testing.T, r GardenResult, i int) exactCircle {
	t.Helper()
	if len(r.Exact) != 6*len(r.Curvature) {
		t.Fatalf("exact identity has %d entries for %d circles", len(r.Exact), len(r.Curvature))
	}
	get := func(k int) *big.Int {
		v := r.Exact[6*i+k]
		if v != math.Trunc(v) || math.Abs(v) > 1<<53 {
			t.Fatalf("circle %d's exact entry %v is not a safe integer", i, v)
		}
		return big.NewInt(int64(v))
	}
	return exactCircle{[2]*big.Int{get(0), get(1)}, [2]*big.Int{get(2), get(3)}, [2]*big.Int{get(4), get(5)}}
}

// Arithmetic in ℤ[√3] on pairs of big integers.
func zAdd(a, b [2]*big.Int) [2]*big.Int {
	return [2]*big.Int{new(big.Int).Add(a[0], b[0]), new(big.Int).Add(a[1], b[1])}
}
func zSub(a, b [2]*big.Int) [2]*big.Int {
	return [2]*big.Int{new(big.Int).Sub(a[0], b[0]), new(big.Int).Sub(a[1], b[1])}
}
func zMul(a, b [2]*big.Int) [2]*big.Int {
	pp := new(big.Int).Mul(a[0], b[0])
	qq := new(big.Int).Mul(a[1], b[1])
	pp.Add(pp, qq.Mul(qq, big.NewInt(3)))
	pq := new(big.Int).Mul(a[0], b[1])
	return [2]*big.Int{pp, pq.Add(pq, new(big.Int).Mul(a[1], b[0]))}
}
func zEq(a, b [2]*big.Int) bool { return a[0].Cmp(b[0]) == 0 && a[1].Cmp(b[1]) == 0 }
func zInt(v int64) [2]*big.Int  { return [2]*big.Int{big.NewInt(v), big.NewInt(0)} }
func zZero() [2]*big.Int        { return zInt(0) }

// Descartes' identities on four circles, exactly: (Σb)² = 2Σb², and with
// weighted centers as complex numbers, (ΣZ)² = 2ΣZ², which holds for the
// stored numerators D·z too, since both sides scale by D².
func exactDescartes(cs []exactCircle) (curvature, centers bool) {
	sb, sb2 := zZero(), zZero()
	sx, sy, sre, sim := zZero(), zZero(), zZero(), zZero()
	for _, c := range cs {
		sb = zAdd(sb, c.b)
		sb2 = zAdd(sb2, zMul(c.b, c.b))
		sx = zAdd(sx, c.x)
		sy = zAdd(sy, c.y)
		sre = zAdd(sre, zSub(zMul(c.x, c.x), zMul(c.y, c.y)))
		sim = zAdd(sim, zMul(zInt(2), zMul(c.x, c.y)))
	}
	two := zInt(2)
	curvature = zEq(zMul(sb, sb), zMul(two, sb2))
	re := zSub(zMul(sx, sx), zMul(sy, sy))
	im := zMul(two, zMul(sx, sy))
	centers = zEq(re, zMul(two, sre)) && zEq(im, zMul(two, sim))
	return
}

// Two circles are tangent exactly when |b₂z₁ − b₁z₂|² = (b₁ + b₂)², which
// holds for either sign of curvature; with numerators X = D·z, the left
// side carries D².
func exactTangent(c1, c2 exactCircle, d int64) bool {
	dx := zSub(zMul(c2.b, c1.x), zMul(c1.b, c2.x))
	dy := zSub(zMul(c2.b, c1.y), zMul(c1.b, c2.y))
	left := zAdd(zMul(dx, dx), zMul(dy, dy))
	s := zAdd(c1.b, c2.b)
	return zEq(left, zMul(zMul(s, s), zInt(d*d)))
}

func seedGarden(seed string, depth int, minRadius float64, maxCircles int) GardenRequest {
	return GardenRequest{Seed: seed, Depth: depth, MinRadius: minRadius, MaxCircles: maxCircles}
}

// The catalog: the original, three more integral root quadruples and two
// seeds exact in ℤ[√3], the last of eight circles.
var catalogSeeds = []string{GardenSeed, "-2,3,6,7", "-3,5,8,8", "-6,11,14,15", "3-2r3,1,1,1", "-1,3,3,3,3,3,3,3"}

func TestGardenSeedCatalog(t *testing.T) {
	if got := GardenSeedIDs(); !reflect.DeepEqual(got, catalogSeeds) {
		t.Fatalf("catalog %v, want %v", got, catalogSeeds)
	}
	for _, id := range catalogSeeds[1:] {
		r, err := ComputeGarden(seedGarden(id, 0, 0.001, 5000))
		if err != nil {
			t.Fatalf("%s: %v", id, err)
		}
		n := len(r.Curvature)
		if n != r.Seeds || (n != 4 && n != 8) {
			t.Fatalf("%s: depth 0 has %d circles, seeds %d", id, n, r.Seeds)
		}
		cs := make([]exactCircle, n)
		for i := range cs {
			cs[i] = exactOf(t, r, i)
			if r.Generation[i] != 0 || r.Opposite[i] != -1 {
				t.Fatalf("%s: seed %d has ancestry", id, i)
			}
		}
		if r.Curvature[0] >= 0 || r.Radius[0] != 1 || r.X[0] != 0 || r.Y[0] != 0 {
			t.Fatalf("%s: circle 0 is not the enclosing unit circle: b %v, radius %v at (%v, %v)", id, r.Curvature[0], r.Radius[0], r.X[0], r.Y[0])
		}
		d := int64(r.Denominator)
		if n == 4 {
			if b, z := exactDescartes(cs); !b || !z {
				t.Fatalf("%s: the seed breaks Descartes' identity (curvature %v, centers %v)", id, b, z)
			}
			for i := 0; i < 4; i++ {
				for j := i + 1; j < 4; j++ {
					if !exactTangent(cs[i], cs[j], d) {
						t.Fatalf("%s: seeds %d and %d are not tangent", id, i, j)
					}
				}
			}
			continue
		}
		// Six around one: each ring circle touches the enclosing circle,
		// the center and its two neighbors, and nothing else.
		for k := 0; k < 6; k++ {
			ring, next, across := 2+k, 2+(k+1)%6, 2+(k+3)%6
			for _, other := range []int{0, 1, next} {
				if !exactTangent(cs[ring], cs[other], d) {
					t.Fatalf("%s: ring circle %d does not touch %d", id, ring, other)
				}
			}
			if exactTangent(cs[ring], cs[across], d) {
				t.Fatalf("%s: ring circle %d touches %d across the ring", id, ring, across)
			}
		}
		if exactTangent(cs[0], cs[1], d) {
			t.Fatalf("%s: the center touches the enclosing circle", id)
		}
	}
}

// Everything returned for any seed, checked independently: the exact
// Descartes identities on each circle's quadruple and on the quadruple it
// replaced in (when that circle is in the packing), exact tangency to its
// generators, the returned centers and radii against a 256-bit evaluation
// of the identity, scale-aware float tangency, containment, disjoint
// interiors, distinct identities and breadth-first parentage.
type packingErrors struct {
	center, radius, tangency float64 // worst, relative to the radius or scale
	maxCoefficient           float64 // largest |p| or |q| stored
}

func checkSeedPacking(t *testing.T, r GardenResult) packingErrors {
	t.Helper()
	n := len(r.Curvature)
	var worst packingErrors
	cs := make([]exactCircle, n)
	seen := map[[6]float64]int{}
	d := int64(r.Denominator)
	if d <= 0 {
		t.Fatalf("denominator %d", d)
	}
	scale := bigRoot3(0, 0)
	{
		e := exactOf(t, r, 0)
		scale = bigRoot3(-e.b[0].Int64(), -e.b[1].Int64())
	}
	for i := 0; i < n; i++ {
		cs[i] = exactOf(t, r, i)
		var key [6]float64
		copy(key[:], r.Exact[6*i:6*i+6])
		for _, v := range key {
			worst.maxCoefficient = math.Max(worst.maxCoefficient, math.Abs(v))
		}
		if j, ok := seen[key]; ok {
			t.Fatalf("circles %d and %d share the identity %v", j, i, key)
		}
		seen[key] = i
		// Returned geometry against the exact identity at 256 bits:
		// radius |b₀|/b, center (X/D)/b·|b₀| in units of the enclosing radius.
		c := cs[i]
		b := bigRoot3(c.b[0].Int64(), c.b[1].Int64())
		radius := new(big.Float).SetPrec(256).Quo(scale, new(big.Float).Abs(b))
		cx := new(big.Float).SetPrec(256).Quo(bigRoot3(c.x[0].Int64(), c.x[1].Int64()), b)
		cx.Mul(cx, scale).Quo(cx, new(big.Float).SetInt64(d))
		cy := new(big.Float).SetPrec(256).Quo(bigRoot3(c.y[0].Int64(), c.y[1].Int64()), b)
		cy.Mul(cy, scale).Quo(cy, new(big.Float).SetInt64(d))
		if e := relErr(r.Radius[i], radius); e > 8*ulp {
			t.Fatalf("circle %d's radius %v is %.3g ulp from its identity", i, r.Radius[i], e/ulp)
		} else {
			worst.radius = math.Max(worst.radius, e)
		}
		wx, _ := cx.Float64()
		wy, _ := cy.Float64()
		ce := math.Hypot(r.X[i]-wx, r.Y[i]-wy) / ulp
		if ce > 16 {
			t.Fatalf("circle %d's center is %.3g ulp from its identity", i, ce)
		}
		worst.center = math.Max(worst.center, ce)
		if i == 0 {
			continue
		}
		if math.Hypot(r.X[i], r.Y[i])+r.Radius[i] > 1+1e-14 {
			t.Fatalf("circle %d leaves the enclosing circle", i)
		}
		if i > 0 && r.Generation[i] < r.Generation[i-1] {
			t.Fatalf("circle %d precedes an earlier generation", i)
		}
		if r.Generation[i] == 0 {
			continue
		}
		quad := []exactCircle{c}
		idx := []int{i}
		for _, p := range r.Parents[i] {
			if p < 0 || int(p) >= i {
				t.Fatalf("circle %d has generator %v, not an earlier circle", i, p)
			}
			quad = append(quad, cs[int(p)])
			idx = append(idx, int(p))
		}
		if b, z := exactDescartes(quad); !b || !z {
			t.Fatalf("circle %d and its generators break Descartes' identity", i)
		}
		if o := int(r.Opposite[i]); o >= 0 {
			if o >= i {
				t.Fatalf("circle %d replaces %d, not an earlier circle", i, o)
			}
			if b, z := exactDescartes([]exactCircle{cs[o], quad[1], quad[2], quad[3]}); !b || !z {
				t.Fatalf("circle %d's opposite %d and generators break Descartes' identity", i, o)
			}
		} else if r.Generation[i] != 1 {
			t.Fatalf("circle %d at generation %v has no opposite circle", i, r.Generation[i])
		}
		for _, k := range idx[1:] {
			if !exactTangent(c, cs[k], d) {
				t.Fatalf("circle %d is not exactly tangent to generator %d", i, k)
			}
			dist := math.Hypot(r.X[i]-r.X[k], r.Y[i]-r.Y[k])
			want := r.Radius[i] + r.Radius[k]
			if r.Curvature[k] < 0 {
				want = r.Radius[k] - r.Radius[i]
			}
			s := math.Hypot(r.X[i], r.Y[i]) + math.Hypot(r.X[k], r.Y[k]) + r.Radius[i] + r.Radius[k]
			res := math.Abs(dist-want) / s
			if res > 64*ulp {
				t.Fatalf("circle %d is not tangent to generator %d: distance %v, want %v", i, k, dist, want)
			}
			worst.tangency = math.Max(worst.tangency, res)
		}
	}
	for i := 1; i < n; i++ {
		for j := i + 1; j < n; j++ {
			dist := math.Hypot(r.X[i]-r.X[j], r.Y[i]-r.Y[j])
			if dist < r.Radius[i]+r.Radius[j]-64*ulp*(2+r.Radius[i]+r.Radius[j]) {
				t.Fatalf("circles %d and %d overlap", i, j)
			}
		}
	}
	if r.Duplicates != 0 {
		t.Fatalf("%d duplicate branches were generated", r.Duplicates)
	}
	return worst
}

func TestGardenSeedsArePackings(t *testing.T) {
	for _, id := range catalogSeeds[1:] {
		for _, q := range []GardenRequest{
			seedGarden(id, 4, 1e-4, 5000),
			seedGarden(id, 12, 0.002, 5000),
			seedGarden(id, GardenMaxDepth, 1e-9, GardenMaxCircles),
		} {
			r := mustGarden(t, q)
			if len(r.Curvature) < 50 {
				t.Fatalf("%+v has only %d circles", q, len(r.Curvature))
			}
			w := checkSeedPacking(t, r)
			for i := r.Seeds; i < len(r.Curvature); i++ {
				if r.Radius[i] < q.MinRadius || r.Generation[i] > float64(q.Depth) {
					t.Fatalf("%+v admitted circle %d of radius %v at generation %v", q, i, r.Radius[i], r.Generation[i])
				}
			}
			t.Logf("%s depth %d r %g: %d circles; worst center %.2g ulp, radius %.2g ulp, tangency %.2g ulp; largest coefficient %.3g",
				id, q.Depth, q.MinRadius, len(r.Curvature), w.center, w.radius/ulp, w.tangency/ulp, w.maxCoefficient)
		}
	}
}

func TestGardenSeedsAreDeterministic(t *testing.T) {
	for _, id := range catalogSeeds[1:] {
		q := seedGarden(id, 10, 0.004, 3000)
		a, b := mustGarden(t, q), mustGarden(t, q)
		if len(a.Curvature) < 100 || !reflect.DeepEqual(a, b) {
			t.Fatalf("%s: repeated requests differ", id)
		}
	}
}

// The symmetry each seed claims, checked exactly on a packing that only the
// radius cutoff limits: every identity's image is an identity. The claimed
// group is also maximal among the mirrors and quarter, half and sixth turns
// about the center: no other of those maps the packing to itself.
type exactMap func(x, y [2]*big.Int) (X, Y [2]*big.Int, ok bool)

// Halving that must be exact; ok is false when it is not, which is itself
// proof that the image is not in the packing.
func zHalf(a [2]*big.Int) ([2]*big.Int, bool) {
	if a[0].Bit(0) != 0 || a[1].Bit(0) != 0 {
		return a, false
	}
	return [2]*big.Int{new(big.Int).Rsh(a[0], 1), new(big.Int).Rsh(a[1], 1)}, true
}

var root3 = [2]*big.Int{big.NewInt(0), big.NewInt(1)}

// A turn by a multiple of 30° that is exact on ℤ[√3]: cos and sin as
// (2cos, 2sin) in ℤ[√3].
func exactTurn(c2, s2 [2]*big.Int) exactMap {
	return func(x, y [2]*big.Int) ([2]*big.Int, [2]*big.Int, bool) {
		X, ok1 := zHalf(zSub(zMul(c2, x), zMul(s2, y)))
		Y, ok2 := zHalf(zAdd(zMul(s2, x), zMul(c2, y)))
		return X, Y, ok1 && ok2
	}
}

var symmetries = map[string]exactMap{
	"mirror x": func(x, y [2]*big.Int) ([2]*big.Int, [2]*big.Int, bool) {
		return zSub(zZero(), x), y, true
	},
	"mirror y": func(x, y [2]*big.Int) ([2]*big.Int, [2]*big.Int, bool) {
		return x, zSub(zZero(), y), true
	},
	"half turn":    exactTurn(zInt(-2), zInt(0)),
	"quarter turn": exactTurn(zInt(0), zInt(2)),
	"third turn":   exactTurn(zInt(-1), root3),
	"sixth turn":   exactTurn(zInt(1), root3),
}

func TestGardenSeedSymmetry(t *testing.T) {
	want := map[string][]string{
		GardenSeed:         {"mirror x", "mirror y", "half turn"},
		"-2,3,6,7":         {"mirror x"},
		"-3,5,8,8":         {"mirror x"},
		"-6,11,14,15":      {},
		"3-2r3,1,1,1":      {"mirror x", "third turn"},
		"-1,3,3,3,3,3,3,3": {"mirror x", "mirror y", "half turn", "third turn", "sixth turn"},
	}
	for _, id := range catalogSeeds {
		r := mustGarden(t, seedGarden(id, 12, 0.015, 5000))
		if r.Omitted.Depth != 0 || r.Stopped != "" || r.Omitted.Radius == 0 {
			t.Fatalf("%s: want only the radius cutoff to bind; omitted %+v, stopped %q", id, r.Omitted, r.Stopped)
		}
		if id == GardenSeed {
			// The original carries no exact array; its identity is the
			// integer triple.
			r.Exact = make([]float64, 0, 6*len(r.Curvature))
			for i := range r.Curvature {
				r.Exact = append(r.Exact, r.Curvature[i], 0, r.WeightedX[i], 0, r.WeightedY[i], 0)
			}
		}
		keys := map[string]bool{}
		all := make([]exactCircle, len(r.Curvature))
		for i := range all {
			all[i] = exactOf(t, r, i)
			keys[exactKey(all[i].b, all[i].x, all[i].y)] = true
		}
		for name, m := range symmetries {
			closed := true
			for _, c := range all {
				X, Y, ok := m(c.x, c.y)
				if !ok || !keys[exactKey(c.b, X, Y)] {
					closed = false
					break
				}
			}
			claimed := false
			for _, s := range want[id] {
				claimed = claimed || s == name
			}
			if closed != claimed {
				t.Errorf("%s: %s maps the packing to itself: %v, claimed %v", id, name, closed, claimed)
			}
		}
	}
}

func exactKey(b, x, y [2]*big.Int) string {
	return b[0].String() + "," + b[1].String() + ";" + x[0].String() + "," + x[1].String() + ";" + y[0].String() + "," + y[1].String()
}

// No two seeds make similar packings: the radii of the twelve largest
// circles inside the enclosing one, which similarity preserves once the
// enclosing radius is 1, differ between every pair.
func TestGardenSeedsAreDistinct(t *testing.T) {
	spectra := map[string][]float64{}
	for _, id := range catalogSeeds {
		r := mustGarden(t, seedGarden(id, 12, 0.05, 5000))
		radii := append([]float64(nil), r.Radius[1:]...)
		sortDescending(radii)
		if len(radii) < 12 {
			t.Fatalf("%s has only %d circles above radius 0.05", id, len(radii))
		}
		spectra[id] = radii[:12]
	}
	for i, a := range catalogSeeds {
		for _, b := range catalogSeeds[i+1:] {
			same := true
			for k := range spectra[a] {
				same = same && math.Abs(spectra[a][k]-spectra[b][k]) < 1e-9
			}
			if same {
				t.Errorf("%s and %s have the same twelve largest radii", a, b)
			}
		}
	}
}

func sortDescending(v []float64) {
	for i := 1; i < len(v); i++ {
		for j := i; j > 0 && v[j] > v[j-1]; j-- {
			v[j], v[j-1] = v[j-1], v[j]
		}
	}
}

// Scaling every curvature by λ leaves weighted centers unchanged and
// scales the drawing by 1/λ, which normalizing to the enclosing radius
// undoes: the same circles, in the same order, with the same geometry. By 2
// the floats are identical; by the unit 2 + √3 they agree to rounding.
func TestGardenSeedScaleCovariance(t *testing.T) {
	for _, id := range catalogSeeds[1:] {
		base := gardenSpecs[id]
		for _, lambda := range []qr{{2, 0}, {2, 1}} {
			scaled := base.scaled(lambda)
			q := seedGarden(id, 12, 0.002, 5000)
			a := mustGarden(t, q)
			b, err := computeGardenFrom(q, scaled, gardenLimits{GardenMaxConfigurations})
			if err != nil {
				t.Fatalf("%s × %v: %v", id, lambda, err)
			}
			if len(a.Curvature) != len(b.Curvature) || !reflect.DeepEqual(a.Parents, b.Parents) || !reflect.DeepEqual(a.Omitted, b.Omitted) {
				t.Fatalf("%s × %v: %d circles against %d, or different ancestry", id, lambda, len(b.Curvature), len(a.Curvature))
			}
			worst := 0.0
			for i := range a.Curvature {
				e := math.Max(math.Abs(a.X[i]-b.X[i]), math.Max(math.Abs(a.Y[i]-b.Y[i]), math.Abs(a.Radius[i]-b.Radius[i])))
				worst = math.Max(worst, e)
				if lambda.q == 0 && e != 0 {
					t.Fatalf("%s × 2: circle %d moved by %g", id, i, e)
				}
				if e > 16*ulp {
					t.Fatalf("%s × %v: circle %d moved by %.3g ulp", id, lambda, i, e/ulp)
				}
			}
			t.Logf("%s × (%d + %d√3): %d circles, largest difference %.2g ulp", id, lambda.p, lambda.q, len(a.Curvature), worst/ulp)
		}
	}
}

// Windowed packings for each seed: the same membership rules as the
// original's tests (TestGardenWindowKeepsEveryVisibleCircle), over a grid of
// small windows and at every seed's cusps.
func TestGardenSeedWindowsKeepEveryVisibleCircle(t *testing.T) {
	for _, id := range catalogSeeds[1:] {
		q := seedGarden(id, 12, 0.001, 5000)
		full := mustGarden(t, q)
		where := map[[6]float64]int{}
		for i := range full.Curvature {
			var k [6]float64
			copy(k[:], full.Exact[6*i:])
			where[k] = i
		}
		checked, kept := 0, 0
		for i := -10; i < 10; i++ {
			for j := -10; j < 10; j++ {
				w := GardenWindow{XMin: float64(i) / 10, XMax: float64(i+1) / 10, YMin: float64(j) / 10, YMax: float64(j+1) / 10}
				r := mustGarden(t, windowed(q, w))
				mine := map[[6]float64]bool{}
				last := -1
				for k := range r.Curvature {
					var key [6]float64
					copy(key[:], r.Exact[6*k:])
					mine[key] = true
					at, ok := where[key]
					if !ok {
						t.Fatalf("%s %+v: circle %v is not in the unwindowed packing", id, w, key)
					}
					if at <= last {
						t.Fatalf("%s %+v: circle %d is out of breadth-first order", id, w, k)
					}
					last = at
				}
				kept += len(r.Curvature)
				for k := range full.Curvature {
					if diskMeets(full, k, w) {
						checked++
						var key [6]float64
						copy(key[:], full.Exact[6*k:])
						if !mine[key] {
							t.Fatalf("%s %+v: visible circle %d is missing", id, w, k)
						}
					}
				}
			}
		}
		if checked < 2000 {
			t.Fatalf("%s: only %d visible circles checked", id, checked)
		}
		t.Logf("%s: %d visible circles kept over 400 windows, %d circles generated", id, checked, kept)
	}
}

// The shipped circumcircle test and the exact linear dual circle decide
// every gap of the original seed the same way, over the same small windows
// as above and the original's own test windows.
func TestGardenLinearDualAgreesOnTheOriginal(t *testing.T) {
	q := garden(12, 0.001, 5000)
	windows := append([]GardenWindow(nil), gardenWindows...)
	for i := -12; i < 12; i++ {
		for j := -12; j < 12; j++ {
			windows = append(windows, GardenWindow{XMin: float64(i) / 12, XMax: float64(i+1) / 12, YMin: float64(j) / 12, YMax: float64(j+1) / 12})
		}
	}
	linear := *gardenSpecs[GardenSeed]
	linear.legacy = false
	for _, w := range windows {
		a := mustGarden(t, windowed(q, w))
		b, err := computeGardenFrom(windowed(q, w), &linear, gardenLimits{GardenMaxConfigurations})
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(a.Curvature, b.Curvature) || !reflect.DeepEqual(a.WeightedX, b.WeightedX) || !reflect.DeepEqual(a.WeightedY, b.WeightedY) || a.Omitted != b.Omitted {
			t.Fatalf("%+v: circumcircle kept %d circles, linear dual %d", w, len(a.Curvature), len(b.Curvature))
		}
	}
}

// A kept circle outside the window survives with its generators for every
// seed, as for the original.
func TestGardenSeedsKeepTheChosenCircle(t *testing.T) {
	for _, id := range catalogSeeds[1:] {
		q := seedGarden(id, 12, 0.001, 5000)
		full := mustGarden(t, q)
		// The smallest circle of generation 5 or more, and a window on the
		// opposite side of the center.
		pick := -1
		for i := range full.Curvature {
			if full.Generation[i] >= 5 && (pick < 0 || full.Radius[i] < full.Radius[pick]) {
				pick = i
			}
		}
		w := GardenWindow{XMin: -full.X[pick] - 0.05, XMax: -full.X[pick] + 0.05, YMin: -full.Y[pick] - 0.05, YMax: -full.Y[pick] + 0.05}
		if diskMeets(full, pick, w) {
			t.Fatalf("%s: the window reaches the kept circle", id)
		}
		e := full.Exact[6*pick:]
		qq := windowed(q, w)
		qq.Keep = &GardenIdentity{Curvature: int64(e[0]), X: int64(e[2]), Y: int64(e[4]), Root: []int64{int64(e[1]), int64(e[3]), int64(e[5])}}
		plain := mustGarden(t, windowed(q, w))
		r := mustGarden(t, qq)
		checkSeedPacking(t, r)
		found := -1
		for i := range r.Curvature {
			same := true
			for k := 0; k < 6; k++ {
				same = same && r.Exact[6*i+k] == full.Exact[6*pick+k]
			}
			if same {
				found = i
			}
		}
		if found < 0 {
			t.Fatalf("%s: the kept circle is missing", id)
		}
		added := len(r.Curvature) - len(plain.Curvature)
		if added < 1 || added > int(full.Generation[pick]) {
			t.Fatalf("%s: keeping a generation-%v circle added %d circles", id, full.Generation[pick], added)
		}
	}
}

func TestGardenSeedRefusals(t *testing.T) {
	for _, c := range []struct {
		q     GardenRequest
		field string
	}{
		{seedGarden("-2,3,6,8", 4, 0.01, 100), "seed"},
		{seedGarden("-1,3,3,3,3,3,3,3", 4, 0.01, 7), "maxCircles"},
		{GardenRequest{Seed: "3-2r3,1,1,1", Depth: 4, MinRadius: 0.01, MaxCircles: 100, Keep: &GardenIdentity{Curvature: 1, Root: []int64{1, 2}}}, "keep.root"},
	} {
		_, err := ComputeGarden(c.q)
		var named *FieldError
		if !errors.As(err, &named) || named.Field != c.field {
			t.Errorf("%+v: got %v, want an error naming %s", c.q, err, c.field)
		}
	}
	if _, err := ComputeGarden(seedGarden("-1,3,3,3,3,3,3,3", 0, 1, 8)); err != nil {
		t.Errorf("eight circles for the ring are refused: %v", err)
	}
}
