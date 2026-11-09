package engine3

import (
	"errors"
	"fmt"
	"math"
	"math/big"
	"reflect"
	"sort"
	"strings"
	"testing"
)

// harmonicCorpus is the independent benchmark: curves chosen for what they ask
// of a fit, each with its known knot type where it has one.
type corpusCurve struct {
	name   string
	source Request
	// Knot invariants, |Δ(−1)| and the odd part of |Δ(2)|; zero for a curve
	// that is not an embedded knot.
	det, two int
	// Terms that reproduce it exactly in its own parameter; zero when it has
	// no finite expansion within the budget.
	exact int
}

func harmonicCorpus() []corpusCurve {
	return []corpusCurve{
		{"trefoil T(2,3)", torusStudy(2, 3, 2, 0.75), 3, 3, 4},
		{"harmonic trefoil", expressionStudy("sin(t)+2*sin(2*t)", "cos(t)-2*cos(2*t)", "-sin(3*t)", 0, 2*math.Pi), 3, 3, 3},
		{"cinquefoil T(2,5)", torusStudy(2, 5, 2, 0.75), 5, 11, 4},
		{"T(3,5)", torusStudy(3, 5, 2, 0.75), 1, 151, 4},
		{"T(5,8)", torusStudy(5, 8, 2, 0.75), 5, 139090655, 4},
		{"figure-eight", expressionStudy("(2+cos(2*t))*cos(3*t)", "(2+cos(2*t))*sin(3*t)", "sin(4*t)", 0, 2*math.Pi), 5, 1, 4},
		{"Viviani", expressionStudy("1+cos(t)", "sin(t)", "2*sin(t/2)", 0, 4*math.Pi), 1, 1, 2},
		{"lifted deltoid", expressionStudy("2*cos(t)+cos(2*t)", "2*sin(t)-sin(2*t)", "0.5*sin(3*t)", 0, 2*math.Pi), 0, 0, 3},
		{"lifted astroid", expressionStudy("cos(t)^3", "sin(t)^3", "0.25*sin(4*t)", 0, 2*math.Pi), 0, 0, 3},
		{"spiky ring", expressionStudy("cos(t)", "sin(t)", "exp(1.5*cos(5*t))/4", 0, 2*math.Pi), 0, 0, 0},
		{"cornered ring", expressionStudy("cos(t)", "sin(t)", "abs(sin(3*t))", 0, 2*math.Pi), 0, 0, 0},
		{"hurried knot", expressionStudy("sin(t+0.9*sin(t))+2*sin(2*(t+0.9*sin(t)))", "cos(t+0.9*sin(t))-2*cos(2*(t+0.9*sin(t)))", "-sin(3*(t+0.9*sin(t)))", 0, 2*math.Pi), 3, 3, 0},
		{"stalling knot", expressionStudy("sin(t+0.98*sin(t))+2*sin(2*(t+0.98*sin(t)))", "cos(t+0.98*sin(t))-2*cos(2*(t+0.98*sin(t)))", "-sin(3*(t+0.98*sin(t)))", 0, 2*math.Pi), 3, 3, 0},
	}
}

// knotInvariants finds the crossings of a closed polygon's projection, labels
// its arcs, and evaluates the Alexander matrix's minor at −1 and 2 exactly. A
// polygon with no crossings is the unknot; an unusable projection returns ok
// false, which a generic direction avoids.
func knotInvariants(path []Vec3) (det, two int64, crossings int, ok bool) {
	// A generic rotation, so that no two polygon edges project collinearly.
	project := func(p Vec3) (float64, float64, float64) {
		a, b, c := 0.6123, 0.7911, 0.3119
		x := math.Cos(a)*p.X - math.Sin(a)*p.Y
		y := math.Sin(a)*p.X + math.Cos(a)*p.Y
		z := p.Z
		y, z = math.Cos(b)*y-math.Sin(b)*z, math.Sin(b)*y+math.Cos(b)*z
		x, z = math.Cos(c)*x+math.Sin(c)*z, -math.Sin(c)*x+math.Cos(c)*z
		return x, y, z
	}
	n := len(path)
	xs, ys, zs := make([]float64, n), make([]float64, n), make([]float64, n)
	for i, p := range path {
		xs[i], ys[i], zs[i] = project(p)
	}
	type crossing struct {
		overEdge, underEdge int
		overAt, underAt     float64
		sign                int
	}
	var all []crossing
	for i := 0; i < n; i++ {
		i2 := (i + 1) % n
		ax, ay := xs[i2]-xs[i], ys[i2]-ys[i]
		for j := i + 2; j < n; j++ {
			j2 := (j + 1) % n
			if j2 == i {
				continue
			}
			bx, by := xs[j2]-xs[j], ys[j2]-ys[j]
			d := ax*by - ay*bx
			if d == 0 {
				continue
			}
			ex, ey := xs[j]-xs[i], ys[j]-ys[i]
			u, v := (ex*by-ey*bx)/d, (ex*ay-ey*ax)/d
			if u < 0 || u >= 1 || v < 0 || v >= 1 {
				continue
			}
			zi, zj := zs[i]+u*(zs[i2]-zs[i]), zs[j]+v*(zs[j2]-zs[j])
			c := crossing{overEdge: i, underEdge: j, overAt: u, underAt: v}
			if zi < zj {
				c.overEdge, c.underEdge, c.overAt, c.underAt = j, i, v, u
			}
			// Sign of (over direction × under direction).
			ox, oy, ux, uy := ax, ay, bx, by
			if zi < zj {
				ox, oy, ux, uy = bx, by, ax, ay
			}
			if ox*uy-oy*ux > 0 {
				c.sign = 1
			} else {
				c.sign = -1
			}
			all = append(all, c)
		}
	}
	if len(all) == 0 {
		return 1, 1, 0, true
	}
	if len(all) > 400 {
		return 0, 0, len(all), false
	}
	// An arc runs from one undercrossing to the next along the traversal.
	type event struct {
		position float64
		index    int
	}
	unders := make([]event, len(all))
	for i, c := range all {
		unders[i] = event{float64(c.underEdge) + c.underAt, i}
	}
	sort.Slice(unders, func(a, b int) bool { return unders[a].position < unders[b].position })
	arcAt := func(position float64) int {
		i := sort.Search(len(unders), func(k int) bool { return unders[k].position > position })
		return i % len(unders)
	}
	m := len(all)
	matrix := func(t int64) [][]*big.Int {
		rows := make([][]*big.Int, m)
		for k := range rows {
			rows[k] = make([]*big.Int, m)
			for l := range rows[k] {
				rows[k][l] = new(big.Int)
			}
		}
		for rank, e := range unders {
			c := all[e.index]
			over := arcAt(float64(c.overEdge) + c.overAt)
			incoming := rank
			outgoing := (rank + 1) % m
			add := func(arc int, value int64) { rows[rank][arc].Add(rows[rank][arc], big.NewInt(value)) }
			add(over, 1-t)
			if c.sign > 0 {
				add(incoming, t)
				add(outgoing, -1)
			} else {
				add(incoming, -1)
				add(outgoing, t)
			}
		}
		return rows
	}
	minor := func(t int64) *big.Int {
		rows := matrix(t)
		rows = rows[:m-1]
		for i := range rows {
			rows[i] = rows[i][:m-1]
		}
		return bareiss(rows)
	}
	odd := func(v *big.Int) int64 {
		w := new(big.Int).Abs(v)
		for w.Sign() != 0 && w.Bit(0) == 0 {
			w.Rsh(w, 1)
		}
		return w.Int64()
	}
	if m == 1 {
		return 1, 1, m, true
	}
	return new(big.Int).Abs(minor(-1)).Int64(), odd(minor(2)), m, true
}

// bareiss is an exact integer determinant.
func bareiss(a [][]*big.Int) *big.Int {
	n := len(a)
	previous := big.NewInt(1)
	sign := 1
	for k := 0; k < n-1; k++ {
		if a[k][k].Sign() == 0 {
			swap := -1
			for i := k + 1; i < n; i++ {
				if a[i][k].Sign() != 0 {
					swap = i
					break
				}
			}
			if swap < 0 {
				return new(big.Int)
			}
			a[k], a[swap] = a[swap], a[k]
			sign = -sign
		}
		for i := k + 1; i < n; i++ {
			for j := k + 1; j < n; j++ {
				v := new(big.Int).Mul(a[i][j], a[k][k])
				v.Sub(v, new(big.Int).Mul(a[i][k], a[k][j]))
				a[i][j] = v.Quo(v, previous)
			}
		}
		previous = a[k][k]
	}
	d := new(big.Int).Set(a[n-1][n-1])
	if sign < 0 {
		d.Neg(d)
	}
	return d
}

func fitPolygon(c HarmonicCurve, n int) []Vec3 {
	path := make([]Vec3, n)
	for j := range path {
		path[j], _, _, _ = c.evaluate(2 * math.Pi * float64(j) / float64(n))
	}
	return path
}

// A trefoil, a figure-eight and an unknotted ring identify themselves, which
// establishes the invariant before it judges a fit.
func TestKnotInvariantsOfKnownKnots(t *testing.T) {
	sampled := func(c Request, lo, hi float64) []Vec3 {
		base, _, _, _, err := compile(c, nil)
		if err != nil {
			t.Fatal(err)
		}
		at := c.position(base)
		path := make([]Vec3, 3000)
		for j := range path {
			path[j] = at(lo + (hi-lo)*float64(j)/3000)
		}
		return path
	}
	for _, c := range []struct {
		name     string
		source   Request
		lo, hi   float64
		det, two int64
	}{
		{"ring", expressionStudy("2*cos(t)", "2*sin(t)", "0.1*sin(2*t)", 0, 2*math.Pi), 0, 2 * math.Pi, 1, 1},
		{"trefoil", torusStudy(2, 3, 2, 0.75), 0, 2 * math.Pi, 3, 3},
		{"cinquefoil", torusStudy(2, 5, 2, 0.75), 0, 2 * math.Pi, 5, 11},
		{"figure-eight", expressionStudy("(2+cos(2*t))*cos(3*t)", "(2+cos(2*t))*sin(3*t)", "sin(4*t)", 0, 2*math.Pi), 0, 2 * math.Pi, 5, 1},
		{"T(3,5)", torusStudy(3, 5, 2, 0.75), 0, 2 * math.Pi, 1, 151},
		{"T(5,8)", torusStudy(5, 8, 2, 0.75), 0, 2 * math.Pi, 5, 139090655},
	} {
		det, two, _, ok := knotInvariants(sampled(c.source, c.lo, c.hi))
		if !ok || det != c.det || two != c.two {
			t.Errorf("%s: invariants %d, %d (usable %v), want %d, %d", c.name, det, two, ok, c.det, c.two)
		}
	}
}

// polylineReach is the largest distance from a vertex of from to the polygon to.
func polylineReach(from, to []Vec3) float64 {
	worst := 0.0
	for _, p := range from {
		nearest := math.Inf(1)
		for j := 1; j < len(to); j++ {
			nearest = math.Min(nearest, segmentDistance(p, to[j-1], to[j]))
		}
		worst = math.Max(worst, nearest)
	}
	return worst
}

// corpusRow is everything the experiment observes at one budget.
type corpusRow struct {
	rms, max, hausdorff float64
	sameKnot            bool
	terms               int
}

func observe(f *HarmonicFit, count int, det, two int) corpusRow {
	r, err := f.Select(count)
	if err != nil {
		return corpusRow{rms: math.NaN()}
	}
	polygon := append(fitPolygon(r.Curve, HarmonicFitSamples), Vec3{})
	polygon[HarmonicFitSamples] = polygon[0]
	hausdorff := math.Max(polylineReach(polygon, f.outline.Points), polylineReach(f.outline.Points, polygon))
	row := corpusRow{rms: r.RMS / r.Extent, max: r.MaxResidual / r.Extent, hausdorff: hausdorff / r.Extent, terms: len(r.Curve.Terms)}
	if det != 0 {
		d, w, _, ok := knotInvariants(fitPolygon(r.Curve, 3000))
		row.sameKnot = ok && d == int64(det) && w == int64(two)
	}
	return row
}

// TestHarmonicFitCorpus prints the evidence with -v and holds the conclusions
// the proposed contract depends on: in its own parameter an exact curve is
// recovered at its known term count; at the budget of eight an embedded knot
// keeps its type by the source parameter; and the sampled maximum accounts for
// the picture's error, so a separate shape distance need not be computed.
func TestHarmonicFitCorpus(t *testing.T) {
	var log strings.Builder
	fmt.Fprintf(&log, "%-18s %-3s %s\n", "curve", "par", "rel. Hausdorff at 1..8 terms (* = knot type kept); then rms/D at 8, 16, 32")
	for _, c := range harmonicCorpus() {
		for _, parameter := range []string{HarmonicFitArcLength, HarmonicFitSource} {
			f, err := FitHarmonicSource(c.source, parameter)
			if err != nil {
				t.Errorf("%s (%s): %v", c.name, parameter, err)
				continue
			}
			fmt.Fprintf(&log, "%-18s %-3s", c.name, parameter[:3])
			for count := 1; count <= 8; count++ {
				row := observe(f, count, c.det, c.two)
				mark := " "
				if row.sameKnot {
					mark = "*"
				}
				fmt.Fprintf(&log, " %8.2e%s", row.hausdorff, mark)
				if parameter == HarmonicFitSource && c.exact != 0 && count == c.exact && row.max > 1e-11 {
					t.Errorf("%s: %d terms should be exact in its own parameter, max %g", c.name, count, row.max)
				}
				if row.hausdorff > row.max+1e-3 {
					t.Errorf("%s (%s) at %d: the picture's error %g exceeds the sampled maximum %g", c.name, parameter, count, row.hausdorff, row.max)
				}
			}
			full := observe(f, 8, c.det, c.two)
			if c.det != 0 && parameter == HarmonicFitSource && !full.sameKnot {
				t.Errorf("%s: the eight-term source-parameter fit changed knot type", c.name)
			}
			// Beyond the shipped budget, from the orthogonal energies alone.
			tail := func(from int) float64 {
				sum := 0.0
				for _, term := range f.terms[min(from, len(f.terms)):] {
					sum += (term.Cosine.dot(term.Cosine) + term.Sine.dot(term.Sine)) / 2
				}
				return math.Sqrt(sum) / f.outline.Extent
			}
			fmt.Fprintf(&log, " | %.1e %.1e %.1e pts=%d ev=%d\n", tail(8), tail(16), tail(32), len(f.outline.Points), f.outline.Evaluations)
		}
	}
	t.Log("\n" + log.String())
}

// TestHarmonicFitEveryPreset runs the fit on every shipped spatial study: beyond
// the authored corpus, each must be fitted or refused with a reason, never fail
// otherwise, and each fit must be an ordinary closed study. An open one is then
// closed explicitly, and must fit or be refused for another reason; closing a
// closed one must change nothing. With -v it prints the catalog admission
// offers.
func TestHarmonicFitEveryPreset(t *testing.T) {
	presets := spatialPresets(t)
	titles := make([]string, 0, len(presets))
	for title := range presets {
		titles = append(titles, title)
	}
	sort.Strings(titles)
	refusals := map[string]int{}
	admitted, exact, joined := 0, 0, 0
	var log strings.Builder
	for _, title := range titles {
		config := presets[title]
		f, err := FitHarmonicSource(config, HarmonicFitSource)
		var open *HarmonicOpenError
		if errors.As(err, &open) {
			c, err := CloseHarmonicSource(config, HarmonicFitSource)
			if err != nil {
				if strings.Contains(err.Error(), "open") {
					t.Errorf("%s: closing still refuses it as open", title)
				}
				refusals["closed, then "+err.Error()]++
				continue
			}
			joined++
			r := selected(t, c, 8)
			if r.Joined <= 0 || r.Curve.validate() != nil {
				t.Errorf("%s: unusable closed-up fit, joined %g", title, r.Joined)
			}
			fmt.Fprintf(&log, "%-46.46s closed  terms %d  max/D %.1e  joined/L %.2f  ev %d\n", title, len(r.Curve.Terms), r.MaxResidual/r.Extent, r.Joined/r.Length, c.outline.Evaluations)
			continue
		}
		if err != nil {
			reason := err.Error()
			if len(reason) > 58 {
				reason = reason[:58]
			}
			refusals[reason]++
			continue
		}
		admitted++
		r := selected(t, f, 8)
		rel := r.MaxResidual / r.Extent
		if rel <= 1e-11 {
			exact++
		}
		if len(r.Curve.Terms) == 0 || len(r.Curve.Terms) > 8 || r.Curve.validate() != nil {
			t.Errorf("%s: unusable fit %+v", title, r.Curve)
		}
		if !reflect.DeepEqual(r, selected(t, closedUp(t, config, HarmonicFitSource), 8)) {
			t.Errorf("%s: closing a closed preset changed its fit", title)
		}
		arc := selected(t, fitted(t, config, HarmonicFitArcLength), 8)
		fmt.Fprintf(&log, "%-46.46s terms %d  source max/D %.1e  arc max/D %.1e  ev %d\n", title, len(r.Curve.Terms), rel, arc.MaxResidual/arc.Extent, f.outline.Evaluations)
	}
	fmt.Fprintf(&log, "%d presets: %d admitted, %d exact in their own parameter; %d more fitted once closed\n", len(presets), admitted, exact, joined)
	reasons := make([]string, 0, len(refusals))
	for reason := range refusals {
		reasons = append(reasons, reason)
	}
	sort.Strings(reasons)
	for _, reason := range reasons {
		fmt.Fprintf(&log, "%4d refused: %s\n", refusals[reason], reason)
	}
	t.Log("\n" + log.String())
	// Durable as presets are added: most closed direct presets are finite sums,
	// recovered exactly by their own parameter, so a change that loses them shows.
	if admitted < 40 {
		t.Errorf("only %d presets admitted", admitted)
	}
	if joined < 20 {
		t.Errorf("only %d open presets fitted once closed", joined)
	}
	if exact*10 < admitted*9 {
		t.Errorf("only %d of %d admitted presets are exact in their own parameter", exact, admitted)
	}
}
