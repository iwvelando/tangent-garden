package engine

import (
	"math"
	"testing"
)

// The disk studies as web/presets.ts authors them, from the fixture.
func diskPresets(t *testing.T) []preset {
	t.Helper()
	var out []preset
	for _, p := range loadPresets(t) {
		if p.Config.Curve.Format == "implicit" && p.Config.Curve.Implicit.Disk != nil {
			out = append(out, p)
		}
	}
	if len(out) != 6 {
		t.Fatalf("%d disk studies in the fixture, want 6", len(out))
	}
	return out
}

// turned is p turned by θ about the origin.
func turned(p Vec, θ float64) Vec {
	c, s := math.Cos(θ), math.Sin(θ)
	return Vec{c*p.X - s*p.Y, s*p.X + c*p.Y}
}

// Each curated study, through Compute, at its opening a and at a frame of
// its motion: the nodal count against the test's own zeros, every diameter
// reaching the boundary twice, rings closed for a round mode; the drawing's
// m-fold symmetry, turning by π/m onto itself and exchanging the levels c
// and −c; and every family level on its own level set.
func TestDiskCatalogDrawsItsModes(t *testing.T) {
	for _, p := range diskPresets(t) {
		for _, a := range []float64{p.Config.Curve.A, p.Config.Curve.A + 0.61} {
			q := p.Config
			q.Curve.A = a
			res, err := Compute(q)
			if err != nil || res.Contours == nil {
				t.Fatalf("%s: %v", p.Title, err)
			}
			v := q.Curve.Implicit
			d := *v.Disk
			m, k, R := d.Order, d.Ring, d.Radius
			cr := res.Contours
			if cr.Disk == nil || cr.Disk.Order != m || cr.Disk.Ring != k {
				t.Fatalf("%s: reply %+v", p.Title, cr.Disk)
			}
			h := (v.Window.XMax - v.Window.XMin) / float64(v.Cells)
			tol := drawingTolerance * (v.Window.XMax - v.Window.XMin)
			bound := math.Max(tol, h/math.Sqrt2)
			center := (float64(m)/math.Pi + 1.2) * h
			own := exactNodal(m, k, R, a)
			u := ownMode(m, k, R, a)
			// Nodal count: 2m ends on the boundary, one per diameter end.
			ends := 0
			closed := 0
			for _, c := range cr.Curve.Contours {
				if c.Closed {
					closed++
					continue
				}
				for _, e := range []Vec{c.Points[0], c.Points[len(c.Points)-1]} {
					if math.Abs(e.Norm()-R) <= 1e-12*R {
						ends++
					}
				}
			}
			if v.Level == 0 && ends != 2*m {
				t.Errorf("%s, a = %g: %d ends on the boundary, want %d", p.Title, a, ends, 2*m)
			}
			if v.Level == 0 && m == 0 && closed != k-1 {
				t.Errorf("%s: %d closed rings, want %d", p.Title, closed, k-1)
			}
			// Every vertex on its level; level 0 near the exact set.
			for _, set := range append([]LevelSet{cr.Curve}, cr.Family...) {
				if len(set.Contours) == 0 {
					t.Fatalf("%s: level %g drew nothing", p.Title, set.Level)
				}
				for _, c := range set.Contours {
					for _, x := range c.Points {
						if math.Abs(u(x)-set.Level) > 2e-14 {
							t.Fatalf("%s, a = %g: u − c = %.3g at a vertex of level %g", p.Title, a, u(x)-set.Level, set.Level)
						}
						if set.Level == 0 && x.Norm() > center && own.dist(x) > bound {
							t.Fatalf("%s, a = %g: a vertex %.3g cells from the exact nodal set", p.Title, a, own.dist(x)/h)
						}
					}
				}
			}
			// The normals point along the independent mode's gradient.
			if len(cr.Normals) < 12 {
				t.Fatalf("%s: %d normals", p.Title, len(cr.Normals))
			}
			for _, n := range cr.Normals {
				e := 1e-6 * R
				own := Vec{
					(u(n.Point.Add(Vec{e, 0})) - u(n.Point.Sub(Vec{e, 0}))) / (2 * e),
					(u(n.Point.Add(Vec{0, e})) - u(n.Point.Sub(Vec{0, e}))) / (2 * e),
				}
				if n.Gradient.Sub(own).Norm() > 1e-5*own.Norm()+1e-9 {
					t.Fatalf("%s, a = %g: normal at %v has gradient %v, independently %v", p.Title, a, n.Point, n.Gradient, own)
				}
			}
			// Symmetry: turning by π/m carries level c onto level −c.
			if m == 0 {
				continue
			}
			byLevel := map[float64]LevelSet{}
			for _, set := range append([]LevelSet{cr.Curve}, cr.Family...) {
				byLevel[set.Level] = set
			}
			for _, set := range append([]LevelSet{cr.Curve}, cr.Family...) {
				mirror, ok := byLevel[-set.Level]
				if !ok {
					continue
				}
				ix := indexChords([]LevelSet{mirror}, h)
				for _, c := range set.Contours {
					for _, x := range c.Points {
						y := turned(x, math.Pi/float64(m))
						if x.Norm() <= center || y.Norm() > R-h {
							continue
						}
						if dist := ix.near(y, 3); dist > bound {
							t.Fatalf("%s, a = %g: level %g turned by π/%d is %.3g cells from level %g", p.Title, a, set.Level, m, dist/h, -set.Level)
						}
					}
				}
			}
		}
	}
}

// At twice the authored cells, the drawing converges where the grid
// limits it: the diameters' ends on the boundary and the chords where they
// meet at the center come closer to the exact nodal set.
func TestDiskCatalogConvergesAtCenterAndBoundary(t *testing.T) {
	for _, p := range diskPresets(t) {
		v := p.Config.Curve.Implicit
		d := *v.Disk
		if d.Order == 0 || v.Level != 0 {
			continue
		}
		m, k, R := d.Order, d.Ring, d.Radius
		own := exactNodal(m, k, R, p.Config.Curve.A)
		var endErr, centerErr [2]float64
		for i, cells := range []int{v.Cells, 2 * v.Cells} {
			w := v
			w.Cells = cells
			w.Family.Enabled = false
			res, _, err := w.contours(p.Config.Curve.A, 0)
			if err != nil {
				t.Fatal(err)
			}
			h := (w.Window.XMax - w.Window.XMin) / float64(cells)
			center := (float64(m)/math.Pi + 1.2) * h * 2
			for _, c := range res.Curve.Contours {
				if !c.Closed {
					for _, e := range []Vec{c.Points[0], c.Points[len(c.Points)-1]} {
						endErr[i] = math.Max(endErr[i], own.dist(e))
					}
				}
				for j := 1; j < len(c.Points); j++ {
					mid := c.Points[j-1].Add(c.Points[j]).Mul(.5)
					if mid.Norm() <= center {
						centerErr[i] = math.Max(centerErr[i], own.dist(mid))
					}
				}
			}
		}
		// Rounding is the floor where the drawing is already exact.
		if !(endErr[1] <= 0.6*endErr[0] || endErr[0] <= 1e-12) {
			t.Errorf("%s: boundary ends %.3g then %.3g from the diameters", p.Title, endErr[0], endErr[1])
		}
		if !(centerErr[1] <= 0.6*centerErr[0] || centerErr[0] <= 1e-12) {
			t.Errorf("%s: center %.3g then %.3g from the diameters", p.Title, centerErr[0], centerErr[1])
		}
		t.Logf("%s: ends %.2g → %.2g, center %.2g → %.2g", p.Title, endErr[0], endErr[1], centerErr[0], centerErr[1])
	}
}

// ringCrests returns the signed height, as a fraction of the peak, of
// J_m's extremum in each of the mode's k rings, from the reference series.
func ringCrests(m, k int) []float64 {
	z := zerosOf(m)
	var out []float64
	lo := 0.0
	for l := 0; l < k; l++ {
		best := 0.0
		for i := 0; i <= 400; i++ {
			x := lo + (z[l]-lo)*float64(i)/400
			if v := refBessel(m, x); math.Abs(v) > math.Abs(best) {
				best = v
			}
		}
		out = append(out, best/besselPeaks[m])
		lo = z[l]
	}
	return out
}

// Every level a curated study rests on stays clear of its rings' crests:
// a level just under a crest draws loops a cell or two across, which a
// turning grid resolves differently every frame. So none lies within 0.04
// below a crest it can reach, and every loop of a nonzero level is at
// least three cells across, at its opening and through its turn.
func TestDiskCatalogLevelsClearTheCrests(t *testing.T) {
	// The levels a study's motion rests on besides its opening, from
	// web/presets.ts: Rings sweeps its level between −0.35 and 0.35.
	rests := map[string][]float64{"Rings of a struck drum": {-0.35, 0.35}}
	for _, p := range diskPresets(t) {
		v := p.Config.Curve.Implicit
		d := *v.Disk
		levels := append([]float64{v.Level}, rests[p.Title]...)
		if v.Family.Enabled {
			for i := range v.Family.Count {
				u := float64(i) / float64(v.Family.Count-1)
				levels = append(levels, v.Family.From*(1-u)+v.Family.To*u)
			}
		}
		for _, c := range levels {
			for _, crest := range ringCrests(d.Order, d.Ring) {
				// A turning mode has crests of both signs in every ring.
				for _, h := range []float64{crest, -crest} {
					if d.Order == 0 && h != crest {
						continue
					}
					if gap := math.Abs(h) - math.Abs(c); c*h > 0 && gap >= 0 && gap < 0.04 {
						t.Errorf("%s: level %g is %.3f under a crest of %.3f", p.Title, c, gap, h)
					}
				}
			}
		}
		h := (v.Window.XMax - v.Window.XMin) / float64(v.Cells)
		for _, rest := range levels[:1+len(rests[p.Title])] {
			w := v
			w.Level = rest
			for _, a := range []float64{0, 0.2, 0.41} {
				res, _, err := w.contours(a, 0)
				if err != nil {
					t.Fatal(err)
				}
				for _, set := range append([]LevelSet{res.Curve}, res.Family...) {
					// Level 0's closed pieces are cut by crossing nodal
					// lines, not loops round a crest.
					if set.Level == 0 {
						continue
					}
					for _, c := range set.Contours {
						if !c.Closed {
							continue
						}
						lo, hi := c.Points[0], c.Points[0]
						for _, q := range c.Points {
							lo = Vec{math.Min(lo.X, q.X), math.Min(lo.Y, q.Y)}
							hi = Vec{math.Max(hi.X, q.X), math.Max(hi.Y, q.Y)}
						}
						if span := math.Min(hi.X-lo.X, hi.Y-lo.Y); span < 3*h {
							t.Errorf("%s, a = %g: a loop of level %g is %.1f cells across", p.Title, a, set.Level, span/h)
						}
					}
				}
			}
		}
	}
}
