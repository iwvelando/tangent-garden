package engine

import (
	"math"
)

// Attractor is a curated planar iterated map, (x, y) ↦ (x', y'), with both
// coordinates updated from the previous point:
//
//	clifford: x' = sin(a y) + c cos(a x),  y' = sin(b x) + d cos(b y)
//	dejong:   x' = sin(a y) − cos(b x),    y' = sin(c x) − cos(d y)
//	henon:    x' = 1 − a x² + y,           y' = b x
//
// From Start, the first Discard iterates are dropped and the next Iterates
// are counted in a grid of Cells near-square cells along the longer side of
// Window, or of their own bounding box when Fit is set. The Window stands in
// for a fit when nothing is accumulated.
type Attractor struct {
	Map      string  `json:"map"`
	A        float64 `json:"a"`
	B        float64 `json:"b"`
	C        float64 `json:"c"`
	D        float64 `json:"d"`
	Start    Vec     `json:"start"`
	Discard  int     `json:"discard"`
	Iterates int     `json:"iterates"`
	Fit      bool    `json:"fit"`
	Window   Window  `json:"window"`
	Cells    int     `json:"cells"`
}

// AttractorResult is how often the accumulated iterates visit each cell of
// the window: Counts is row-major from (XMin, YMin), rows upward, and an
// iterate on the window's upper edge counts in the last cell. Accumulated
// iterates outside the window are counted in Outside, not binned. Escape is
// the number of the iterate that left |x|, |y| ≤ 100000, which ends the
// orbit, or 0. Orbit is the start and the first iterates, discarded or not,
// never more than were computed.
type AttractorResult struct {
	Window      Window   `json:"window"`
	Columns     int      `json:"columns"`
	Rows        int      `json:"rows"`
	Counts      []uint32 `json:"counts"`
	Max         uint32   `json:"max"`
	Accumulated int      `json:"accumulated"`
	Outside     int      `json:"outside"`
	Escape      int      `json:"escape"`
	Orbit       []Vec    `json:"orbit"`
}

// An orbit ends when it leaves this bound, which also keeps a fitted window
// within the bounds any window must meet.
const escapeBound = 1e5

// Work bounds: iterates discarded and accumulated. A fitted window iterates
// the accumulated span twice, once to find it and once to count it.
var maxDiscard, maxIterates = 1_000_000, 5_000_000

func (v Attractor) validate() error {
	if v.Map != "clifford" && v.Map != "dejong" && v.Map != "henon" {
		return fieldErr("map", "choose the Clifford, de Jong, or Hénon map")
	}
	for i, x := range []float64{v.A, v.B, v.C, v.D} {
		if !finite(x) || math.Abs(x) > 1000 {
			return fieldErr([]string{"a", "b", "c", "d"}[i], "the map's coefficients must be finite and within ±1000")
		}
	}
	if start := bound(escapeBound); !start(v.Start.X) || !start(v.Start.Y) {
		return fieldErr(coordinate("start", v.Start, start), "the start must be finite and within ±100000")
	}
	if v.Discard < 0 || v.Discard > maxDiscard {
		return fieldErr("discard", "discard 0–1,000,000 iterates")
	}
	if v.Iterates < 0 || v.Iterates > maxIterates {
		return fieldErr("iterates", "accumulate 0–5,000,000 iterates")
	}
	if v.Cells < minCells || v.Cells > maxCells {
		return fieldErr("cells", "a density grid needs 4–1024 cells along the window's longer side")
	}
	return within("window", v.Window.validate())
}

func (v Attractor) step() func(Vec) Vec {
	a, b, c, d := v.A, v.B, v.C, v.D
	switch v.Map {
	case "clifford":
		return func(p Vec) Vec {
			return Vec{math.Sin(a*p.Y) + c*math.Cos(a*p.X), math.Sin(b*p.X) + d*math.Cos(b*p.Y)}
		}
	case "dejong":
		return func(p Vec) Vec {
			return Vec{math.Sin(a*p.Y) - math.Cos(b*p.X), math.Sin(c*p.X) - math.Cos(d*p.Y)}
		}
	}
	return func(p Vec) Vec { return Vec{1 - a*p.X*p.X + p.Y, b * p.X} }
}

// widen centers a range narrower than 0.000001 in one that wide, within
// the escape bound.
func widen(lo, hi float64) (float64, float64) {
	if hi-lo >= 1e-6 {
		return lo, hi
	}
	lo = min(max(-escapeBound, lo/2+hi/2-5e-7), escapeBound-1e-6)
	hi = lo + 1e-6
	for hi-lo < 1e-6 {
		hi = math.Nextafter(hi, math.Inf(1))
	}
	return lo, hi
}

// density iterates the map and counts the accumulated iterates, with lines
// iterates from the start as construction.
func (v Attractor) density(lines int) (*AttractorResult, error) {
	if err := v.validate(); err != nil {
		return nil, err
	}
	step := v.step()
	// iterate applies the map n times from p, visiting each iterate by its
	// number within the run, and returns the last one kept and the number
	// of the iterate that escaped, or 0.
	iterate := func(p Vec, n int, visit func(k int, p Vec)) (Vec, int) {
		for k := 1; k <= n; k++ {
			q := step(p)
			if !(math.Abs(q.X) <= escapeBound && math.Abs(q.Y) <= escapeBound) {
				return p, k
			}
			p = q
			visit(k, p)
		}
		return p, 0
	}
	out := &AttractorResult{Orbit: []Vec{v.Start}}
	orbit := func(k int, p Vec) {
		if k <= lines {
			out.Orbit = append(out.Orbit, p)
		}
	}
	p, escape := iterate(v.Start, v.Discard, orbit)
	w := v.Window
	if escape > 0 {
		out.Escape = escape
	} else if v.Fit {
		fit := Window{math.Inf(1), math.Inf(-1), math.Inf(1), math.Inf(-1)}
		n := 0
		iterate(p, v.Iterates, func(_ int, q Vec) {
			fit = Window{min(fit.XMin, q.X), max(fit.XMax, q.X), min(fit.YMin, q.Y), max(fit.YMax, q.Y)}
			n++
		})
		if n > 0 {
			fit.XMin, fit.XMax = widen(fit.XMin, fit.XMax)
			fit.YMin, fit.YMax = widen(fit.YMin, fit.YMax)
			w = fit
		}
	}
	nx, ny := gridShape(w, v.Cells)
	out.Window, out.Columns, out.Rows = w, nx, ny
	out.Counts = make([]uint32, nx*ny)
	if escape > 0 {
		return out, nil
	}
	width, height := w.XMax-w.XMin, w.YMax-w.YMin
	_, escape = iterate(p, v.Iterates, func(k int, q Vec) {
		orbit(v.Discard+k, q)
		out.Accumulated++
		if q.X < w.XMin || q.X > w.XMax || q.Y < w.YMin || q.Y > w.YMax {
			out.Outside++
			return
		}
		i := min(nx-1, int((q.X-w.XMin)/width*float64(nx)))
		j := min(ny-1, int((q.Y-w.YMin)/height*float64(ny)))
		c := &out.Counts[j*nx+i]
		*c++
		out.Max = max(out.Max, *c)
	})
	if escape > 0 {
		out.Escape = v.Discard + escape
	}
	return out, nil
}
