package engine3

// Engine computes a sequence of studies in one worker. Unlike Compute,
// it retains a bounded set of ray evaluations for the current receiver
// study. Call it serially; returned results belong to the caller.
// The zero value is ready to use.
type Engine struct {
	rays *rayCache
}

type rayCache struct {
	surface  SurfaceRequest
	light    RaysRequest
	samples  [][]mirrorPoint
	receiver *receiverTrace
	raster   rasterScratch
}

func (c *rayCache) samplesFor(nu, nv int) [][]mirrorPoint {
	if c == nil {
		return grid2[mirrorPoint](nu+1, nv+1)
	}
	if c.samples == nil {
		c.samples = grid2[mirrorPoint](nu+1, nv+1)
	}
	return c.samples
}

// Compute preserves the stateless engine's results while reusing traced
// rays if only the receiver or its diagnostics change. Neither output
// arrays nor receiver crossings are cached: transport may consume output,
// and the moving plane changes every crossing.
func (e *Engine) Compute(c Request) (Result, error) {
	if c.Format != "rays" || c.Rays.Receiver.Plane == "none" {
		e.rays = nil
	} else {
		light := c.Rays
		light.Receiver = ReceiverRequest{}
		if e.rays == nil || e.rays.surface != c.Surface || e.rays.light != light {
			// A family used just once cannot benefit. Remember its key,
			// but defer all tracing storage until the family repeats.
			e.rays = &rayCache{surface: c.Surface, light: light}
		} else {
			c.rayCache = e.rays
		}
	}
	out, err := Compute(c)
	if err != nil {
		e.rays = nil
	}
	return out, err
}

// Receiver traces retain only world-space crossings' inputs and emitted
// flux, not landing coordinates or bins. Columns are allocated lazily,
// within 16 MiB, and a change in refinement level drops the previous grid.
// These conservative charges include each entry's padding and row header.
const maxReceiverTraceBytes = 16 << 20

type receiverRay struct {
	x, r         Vec3
	traced, done bool
}
type receiverFlux struct {
	flux             float64
	lit, total, done bool
}
type receiverTrace struct {
	levels, bytes, count int
	landingBytes         int
	landings             [][]receiverLanding
	corners              [][]receiverRay
	midpoints            [maxReceiverRefine + 1][][]receiverFlux
}

func (c *rayCache) receiverGrid(nu, nv, levels int) *receiverTrace {
	if c == nil {
		return nil
	}
	if c.receiver == nil || c.receiver.levels != levels {
		t := &receiverTrace{levels: levels, corners: make([][]receiverRay, (nu<<levels)+1)}
		t.bytes = 24 * len(t.corners)
		t.landings = make([][]receiverLanding, len(t.corners))
		t.landingBytes = 24 * len(t.landings)
		for level := 0; level <= levels; level++ {
			t.midpoints[level] = make([][]receiverFlux, nu<<level)
			t.bytes += 24 * len(t.midpoints[level])
		}
		c.receiver = t
	}
	return c.receiver
}

func traceSlot[T any](t *receiverTrace, columns [][]T, i, j, rows, charge int) *T {
	if columns[i] == nil {
		bytes := rows*charge + 24
		if t.bytes+bytes > maxReceiverTraceBytes {
			return nil
		}
		columns[i] = make([]T, rows)
		t.bytes += bytes
	}
	return &columns[i][j]
}

func (t *receiverTrace) corner(i, j, rows int, evaluate func() mirrorPoint) mirrorPoint {
	if t == nil {
		return evaluate()
	}
	slot := traceSlot(t, t.corners, i, j, rows, 64)
	if slot == nil {
		return evaluate()
	}
	if !slot.done {
		p := evaluate()
		*slot = receiverRay{p.X, p.R, p.traced(), true}
		t.count++
	}
	return mirrorPoint{X: slot.x, R: slot.r, Lit: slot.traced}
}

func (t *receiverTrace) emission(level, i, j, rows int, evaluate func() receiverFlux) receiverFlux {
	if t == nil {
		return evaluate()
	}
	slot := traceSlot(t, t.midpoints[level], i, j, rows, 24)
	if slot == nil {
		return evaluate()
	}
	if !slot.done {
		*slot = evaluate()
		slot.done = true
		t.count++
	}
	return *slot
}

// Landing coordinates change with the plane. Reuse their private columns
// only as scratch, clearing them before every frame; at most 8 MiB is
// retained, independently of the trace budget and of frames visited.
const maxReceiverLandingBytes = 8 << 20

type receiverLanding struct {
	p                [2]float64
	traced, ok, done bool
}

func (t *receiverTrace) landingGrid(columns int) [][]receiverLanding {
	if t == nil {
		return make([][]receiverLanding, columns)
	}
	points := append([][]receiverLanding(nil), t.landings...)
	for _, column := range points {
		clear(column)
	}
	return points
}
func (t *receiverTrace) landingColumn(i, rows int) []receiverLanding {
	column := make([]receiverLanding, rows)
	if t != nil && t.landingBytes+rows*32+24 <= maxReceiverLandingBytes {
		t.landings[i] = column
		t.landingBytes += rows*32 + 24
	}
	return column
}
