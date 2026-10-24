package engine3

import "slices"

// Engine computes a sequence of studies in one worker. Unlike Compute,
// it retains a bounded set of ray evaluations for the current receiver
// study. Call it serially; returned results belong to the caller.
// The zero value is ready to use.
type Engine struct {
	rays *rayCache
}

type rayCache struct {
	surface      SurfaceRequest
	light        RaysRequest
	samples      [][]mirrorPoint
	baseLandings [][]receiverLanding
	geometry     *rayGeometry
	receiver     *receiverTrace
	raster       rasterScratch
	probe        *SurfaceDiagnostics
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

// The coarse landing grid is bounded by the surface's 14,400-cell limit.
// Every entry is overwritten by receiveRaster before use, including when a
// view inset follows the window pass. Nothing here belongs to a result.
func (c *rayCache) receiverBase(nu, nv int) [][]receiverLanding {
	if c == nil {
		return grid2[receiverLanding](nu+1, nv+1)
	}
	if len(c.baseLandings) != nu+1 || len(c.baseLandings[0]) != nv+1 {
		c.baseLandings = grid2[receiverLanding](nu+1, nv+1)
	}
	return c.baseLandings
}

// Compute preserves the stateless engine's results while reusing traced
// rays and the current diagnostics while only the receiver changes.
// Output arrays belong to each result: transport may consume them. Receiver
// crossings use private scratch and are recomputed for every pass as the plane moves.
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
	queues               receiverQueues
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

// A single validated patch has at most 14,400 cells. Retain only its current
// geometry, alongside the existing bounded traces; a new family drops both.
// Diagnostics are retained separately (see diagnostics), since the probe
// target can change while the geometry stays.
type rayGeometry struct {
	rays     *RaysResult
	samples  [][]mirrorPoint
	families [][]*Vec3
	scale    float64
}

func (c *rayCache) geometryFor(q SurfaceRequest, r RaysRequest) (*rayGeometry, error) {
	if c != nil && c.geometry != nil {
		return c.geometry, nil
	}
	g, err := buildRayGeometry(q, r, c)
	if err == nil && c != nil {
		c.geometry = g
	}
	return g, err
}

// diagnostics retains only the current target of a repeated receiver family.
// The family key covers every surface and light field; receiver coordinates
// affect neither the patch nor its outgoing wavefront. A single grid is bounded
// by the validated surface sample limits, and turning the probe off releases it.
func (c *rayCache) diagnostics(q SurfaceRequest, r RaysRequest, samples [][]mirrorPoint, scale float64, surface, light bool) *SurfaceDiagnostics {
	kind := "patch"
	if light {
		kind = "wavefront"
	}
	if !surface && !light {
		if c != nil {
			c.probe = nil
		}
		return nil
	}
	if c != nil && c.probe != nil && c.probe.Kind == kind {
		return copyReceiverDiagnostics(c.probe)
	}
	var d *SurfaceDiagnostics
	if light {
		d = lightProbe(q, r, samples, focalReach*scale)
	} else {
		patch := grid2[surfacePoint](q.USamples+1, q.VSamples+1)
		for i := range patch {
			for j := range patch[i] {
				u, v := q.at(i, j)
				patch[i][j] = q.point(u, v, scale)
			}
		}
		d = patchProbe(q, patch, scale)
	}
	if c != nil {
		// The bridge may consume every delivered slice while lifting the
		// result, and callers may edit pointees too. Retain a private copy.
		c.probe = copyReceiverDiagnostics(d)
	}
	return d
}

func copyReceiverDiagnostics(d *SurfaceDiagnostics) *SurfaceDiagnostics {
	out := *d
	out.Along, out.U, out.V = slices.Clone(d.Along), slices.Clone(d.U), slices.Clone(d.V)
	out.Points, out.Normals = clonePointGrid(d.Points), clonePointGrid(d.Normals)
	for k := range d.Curvature {
		out.Curvature[k] = clonePointGrid(d.Curvature[k])
		out.Direction[k] = clonePointGrid(d.Direction[k])
		out.Focal[k] = clonePointGrid(d.Focal[k])
	}
	// Patch/wavefront diagnostics have none of these optional grids today.
	// Copy them as well so result ownership covers the entire descriptor.
	out.UnknownPlane, out.Folds = cloneGrid(d.UnknownPlane), cloneGrid(d.Folds)
	out.Feet, out.Through = clonePointGrid(d.Feet), slices.Clone(d.Through)
	if d.Light != nil {
		l := *d.Light
		l.Incident = clonePointGrid(l.Incident)
		l.Surface = clonePointGrid(l.Surface)
		l.Outgoing = clonePointGrid(l.Outgoing)
		l.State = cloneGrid(l.State)
		out.Light = &l
	}
	return &out
}

// Clone all public storage. In particular, copying only the slice headers
// would let the WASM lifter clear cached rows or a caller edit cached points.
// Pack values together so fresh ownership does not mean one allocation per
// point. Nil rows, gaps and empty slices retain their JSON representation.
func clonePointGrid[T any](source [][]*T) [][]*T {
	out := cloneGrid(source)
	count := 0
	for _, row := range source {
		count += len(row)
	}
	points := make([]T, count)
	at := 0
	for i, row := range source {
		for j, p := range row {
			if p != nil {
				points[at+j] = *p
				out[i][j] = &points[at+j]
			}
		}
		at += len(row)
	}
	return out
}

// cloneGrid copies a grid's rows into one backing array.
func cloneGrid[T any](source [][]T) [][]T {
	if source == nil {
		return nil
	}
	count := 0
	for _, row := range source {
		count += len(row)
	}
	out, values := make([][]T, len(source)), make([]T, count)
	at := 0
	for i, row := range source {
		end := at + len(row)
		if row != nil {
			out[i] = values[at:end:end]
			copy(out[i], row)
		}
		at = end
	}
	return out
}

func cloneSheet(s SurfaceSheet) SurfaceSheet {
	s.Points, s.Normals = clonePointGrid(s.Points), clonePointGrid(s.Normals)
	s.AlongU, s.AlongV, s.Faces = cloneGrid(s.AlongU), cloneGrid(s.AlongV), cloneGrid(s.Faces)
	return s
}

func cloneRayGeometry(source *RaysResult) *RaysResult {
	out := *source
	out.Surface = cloneSheet(source.Surface)
	out.Caustics = slices.Clone(source.Caustics)
	for i := range out.Caustics {
		out.Caustics[i].SurfaceSheet = cloneSheet(source.Caustics[i].SurfaceSheet)
	}
	out.Lines = slices.Clone(source.Lines)
	out.UCurves, out.VCurves, out.Clipped = slices.Clone(source.UCurves), slices.Clone(source.VCurves), slices.Clone(source.Clipped)
	if source.Source != nil {
		p := *source.Source
		out.Source = &p
	}
	if source.Edges != nil {
		edges := slices.Clone(*source.Edges)
		for i := range edges {
			e := &edges[i]
			e.Points, e.Feet = slices.Clone(e.Points), slices.Clone(e.Feet)
			e.I, e.J = slices.Clone(e.I), slices.Clone(e.J)
		}
		out.Edges = &edges
	}
	return &out
}
