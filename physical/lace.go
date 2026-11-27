package physical

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"math/cmplx"
	"runtime"
	"strconv"
	"time"

	"tangentgarden/engine"
)

// The rim policies: what happens where the lace's lines and gaps become
// too fine for the profile.
const (
	// RimMotif keeps whole tiles, largest first, while every gap or web
	// holds the profile's minimum; the lace ends tile by tile.
	RimMotif = "motif"
	// RimClean cuts the lace at a circle joined to a frame band, leaving a
	// plain border to the plaque's edge.
	RimClean = "rim"
	// RimCrop enlarges a disk of the lace about its center to the plaque,
	// framed at the plaque's edge.
	RimCrop = "crop"
)

// SettingsVersion is the version of the settings a package records.
const SettingsVersion = 1

// LaceSolidRequest asks for a plaque made from a lace study.
//
//   - Lace is the source: its generation settings and static isometry.
//     The view window and zoom detail are ignored, so the camera never
//     changes the solid; only Rim and Clip choose what is kept.
//   - Diameter is the plaque's, 10–300 mm.
//   - Clip is in model units (the rim is 1): the crop's radius,
//     0.05–0.95, or the clean rim's, 0.05–0.98, where 0 chooses it from
//     the whole-motif cutoff.
//   - Border is the plain margin around the lace for the motif cutoff and
//     the clean rim, 0 for the profile's wall or the line, whichever is
//     wider; at most 20 mm.
//   - Grid is the field's step, 0.05–1 mm, 0 for 0.2 mm.
type LaceSolidRequest struct {
	Version  int                `json:"version"`
	Lace     engine.LaceRequest `json:"lace"`
	Diameter float64            `json:"diameter"`
	Design   Design             `json:"design"`
	Rim      string             `json:"rim"`
	Clip     float64            `json:"clip,omitempty"`
	Border   float64            `json:"border,omitempty"`
	Grid     float64            `json:"grid,omitempty"`
	// Lines chooses what the plan is made of: the motif (the default),
	// the tile sides, or both.
	Lines   string  `json:"lines,omitempty"`
	Profile Profile `json:"profile"`
}

// The line choices.
const (
	LinesMotif = "motif"
	LinesSides = "sides"
	LinesBoth  = "both"
)

// LaceSource is what the source patch was, before any physical cutoff.
type LaceSource struct {
	Tiles       int     `json:"tiles"`
	Strokes     int     `json:"strokes"`
	Pieces      int     `json:"pieces"`
	BeyondDepth int     `json:"beyondDepth"`
	NearRim     int     `json:"nearRim"`
	Stopped     string  `json:"stopped"`
	Pending     int     `json:"pending"`
	Coverage    float64 `json:"coverage"`
}

// LaceCutoff is what the physical policy kept. Reason is "manufacturing"
// when tiles were left out for the profile, "clip" when a circle cut the
// lace, and "source" when the patch itself ends first. Radius is in model
// units: where the first left-out tile begins, the clip, or the source's
// farthest stroke.
type LaceCutoff struct {
	Admitted int     `json:"admitted"`
	Tiles    []int   `json:"tiles"`
	Reason   string  `json:"reason"`
	Radius   float64 `json:"radius"`
	Rounds   int     `json:"rounds"`
	// Unresolved counts kept tiles too small for the grid, which a clean
	// rim or crop can keep; the motif cutoff never does.
	Unresolved   int     `json:"unresolved"`
	FailedRounds int     `json:"failedRounds"`
	LeastScale   float64 `json:"leastScale"`
}

// LaceStats are the work and storage one preparation used.
type LaceStats struct {
	Strokes      int                `json:"strokes"`
	Nodes        int                `json:"nodes"`
	Evaluations  int                `json:"evaluations"`
	Vertices     int                `json:"vertices"`
	Triangles    int                `json:"triangles"`
	PairTests    int                `json:"pairTests"`
	MeshBytes    int                `json:"meshBytes"`
	PackageBytes int                `json:"packageBytes"`
	WorkingBytes int                `json:"workingBytes"`
	Millis       map[string]float64 `json:"millis"`
	// Deviation is the farthest a contour vertex lies from the exact
	// boundary, in millimeters, measured at every vertex; Chord the
	// plaque polygon's greatest distance inside its circle.
	Deviation float64 `json:"deviation"`
	// Memory is the Go runtime's memory obtained from the system, set by
	// the WebAssembly bridge after a build: there it only grows, so it is
	// the peak.
	Memory uint64 `json:"memory,omitempty"`
	// Specks counts pieces under a grid step that Clean filled.
	Specks int     `json:"specks"`
	Chord  float64 `json:"chord"`
}

// LaceSolid is a prepared plaque.
type LaceSolid struct {
	Validated bool        `json:"validated"`
	Checks    []CheckItem `json:"checks"`
	Mesh      Report      `json:"mesh"`
	Cells     CellReport  `json:"cells"`
	Problems  []Cell      `json:"problems"`
	Narrow    []float64   `json:"narrow"`
	FusedAt   []float64   `json:"fusedAt"`
	Source    LaceSource  `json:"source"`
	Cutoff    LaceCutoff  `json:"cutoff"`
	Stats     LaceStats   `json:"stats"`
	// Scale is millimeters per model unit; Clip the clip circle in model
	// units, 0 for none; Radius the plaque's.
	Scale  float64 `json:"scale"`
	Clip   float64 `json:"clip"`
	Radius float64 `json:"radius"`
	Levels Levels  `json:"levels"`
	// FaceDown says the solid was turned over (Mesh.TurnOver): its top
	// view undoes the turn.
	FaceDown bool `json:"faceDown"`
	// Grid is the step used, chosen when the request left it automatic.
	Grid float64 `json:"grid"`
	// Simplified is what removing features below the minimums changed.
	Simplified   SimplifyReport `json:"simplified"`
	SimplifiedAt []float64      `json:"simplifiedAt"`

	Solid    *Mesh  `json:"-"`
	Package  []byte `json:"-"`
	Settings []byte `json:"-"`
	scales   []float64
}

func (q *LaceSolidRequest) validate() error {
	bad := func(field, msg string) error { return &FieldError{field, msg} }
	in := func(v, lo, hi float64) bool { return v >= lo && v <= hi }
	if q.Version != 0 && q.Version != SettingsVersion {
		return bad("version", fmt.Sprintf("settings version %d is not supported; this build reads version %d", q.Version, SettingsVersion))
	}
	if !in(q.Diameter, 10, 300) {
		return bad("diameter", "Diameter must be 10–300 mm.")
	}
	if q.Design.Treatment != Raised && q.Design.Treatment != Recessed {
		return bad("design.treatment", "Choose raised or recessed.")
	}
	if !(q.Design.Line > 0) || q.Design.Line > 20 {
		return bad("design.line", "Line width must be above 0 and at most 20 mm.")
	}
	if !(q.Design.Floor >= 0) || q.Design.Floor > 20 {
		return bad("design.floor", "Floor must be 0–20 mm; 0 makes openwork.")
	}
	if !(q.Design.Relief > 0) || q.Design.Relief > 20 {
		return bad("design.relief", "Relief must be above 0 and at most 20 mm.")
	}
	switch q.Rim {
	case RimMotif:
	case RimClean:
		if q.Clip != 0 && !in(q.Clip, 0.05, 0.98) {
			return bad("clip", "The rim's radius must be 0.05–0.98 of the disk, or automatic.")
		}
	case RimCrop:
		if !in(q.Clip, 0.05, 0.95) {
			return bad("clip", "The crop's radius must be 0.05–0.95 of the disk.")
		}
	default:
		return bad("rim", "Choose whole tiles, a clean rim or a crop.")
	}
	if q.Border != 0 && !(q.Border > 0 && q.Border <= 20) {
		return bad("border", "Border must be above 0 and at most 20 mm.")
	}
	if q.Grid != 0 && !in(q.Grid, 0.05, 1) {
		return bad("grid", "Grid step must be 0.05–1 mm, or automatic.")
	}
	switch q.Lines {
	case "", LinesMotif, LinesSides, LinesBoth:
	default:
		return bad("lines", "Choose the motif, the tile sides or both.")
	}
	return q.Profile.Validate()
}

// laceStrokes reads the patch's motif strokes in millimeters, with each
// tile's scale |T'(0)| = 1/|a|², the stroke ranges of each tile and the
// source piece of each stroke: strokes whose ends meet share a piece.
func laceStrokes(res *engine.LaceResult, scale, half float64, lines string) (strokes []Stroke, first []int, piece []int32, scales []float64, pieces int) {
	n := len(res.Center)
	per, sides := 0, 0
	if res.ArcFirst == nil && n > 0 {
		per = len(res.ArcStart) / n
	}
	if n > 0 {
		sides = len(res.Sides) / n
	}
	motif := lines != LinesSides
	withSides := lines == LinesSides || lines == LinesBoth
	first = make([]int, n+1)
	scales = make([]float64, n)
	for i := range n {
		t := res.Transform[i]
		scales[i] = 1 / (t[0]*t[0] + t[1]*t[1])
		lo, hi := i*per, (i+1)*per
		if res.ArcFirst != nil {
			lo, hi = int(res.ArcFirst[i]), int(res.ArcFirst[i+1])
		}
		first[i] = len(strokes)
		v := func(p engine.Vec) complex128 { return complex(p.X*scale, p.Y*scale) }
		for k := lo; k < hi && motif; k++ {
			strokes = append(strokes, Stroke{
				A: v(res.ArcStart[k]), B: v(res.ArcEnd[k]), C: v(res.ArcCenter[k]),
				R: res.ArcRadius[k] * scale, Straight: res.ArcStraight[k], Half: half, Tile: i,
			})
		}
		// The tile's sides, each a geodesic between two of its corners;
		// a side shared by two tiles is a stroke of each.
		for k := 0; k < sides && withSides; k++ {
			e := int(res.Sides[sides*i+k])
			strokes = append(strokes, Stroke{
				A: v(res.Vertex[int(res.EdgeA[e])]), B: v(res.Vertex[int(res.EdgeB[e])]), C: v(res.EdgeCenter[e]),
				R: res.EdgeRadius[e] * scale, Straight: res.EdgeStraight[e], Half: half, Tile: i,
			})
		}
	}
	first[n] = len(strokes)
	// Pieces: union strokes whose ends agree within a micrometer.
	parent := make([]int32, len(strokes))
	for i := range parent {
		parent[i] = int32(i)
	}
	var find func(int32) int32
	find = func(x int32) int32 {
		for parent[x] != x {
			parent[x] = parent[parent[x]]
			x = parent[x]
		}
		return x
	}
	const q = 1e-3
	ends := map[[2]int64][]int32{}
	for s, st := range strokes {
		for _, p := range []complex128{st.A, st.B} {
			kx, ky := int64(math.Floor(real(p)/q)), int64(math.Floor(imag(p)/q))
			for dx := int64(-1); dx <= 1; dx++ {
				for dy := int64(-1); dy <= 1; dy++ {
					for _, o := range ends[[2]int64{kx + dx, ky + dy}] {
						other := strokes[o]
						if cmplx.Abs(other.A-p) < q || cmplx.Abs(other.B-p) < q {
							parent[find(int32(s))] = find(o)
						}
					}
				}
			}
			ends[[2]int64{kx, ky}] = append(ends[[2]int64{kx, ky}], int32(s))
		}
	}
	ids := map[int32]int32{}
	piece = make([]int32, len(strokes))
	for s := range strokes {
		r := find(int32(s))
		if _, ok := ids[r]; !ok {
			ids[r] = int32(len(ids))
		}
		piece[s] = ids[r]
	}
	return strokes, first, piece, scales, len(ids)
}

// BuildLaceSolid prepares a plaque from a lace study: it scales the
// source's strokes to millimeters, chooses what to keep by the rim policy,
// builds the solid, checks it as a mesh and against the profile, and
// writes the 3MF package.
func BuildLaceSolid(q LaceSolidRequest, lim Limits) (*LaceSolid, error) {
	if err := q.validate(); err != nil {
		return nil, err
	}
	clock := time.Now()
	millis := map[string]float64{}
	lap := func(name string) {
		now := time.Now()
		millis[name] += float64(now.Sub(clock).Microseconds()) / 1000
		clock = now
	}
	q.Version = SettingsVersion
	q.Lace.Window, q.Lace.MinRadius = nil, 0
	// An automatic grid step is 0.2 mm, or the least that keeps the field
	// within its node ceiling.
	if q.Grid == 0 {
		h := 0.2
		for n := int(math.Ceil(q.Diameter/h)) + 5; n*n > lim.Nodes; n = int(math.Ceil(q.Diameter/h)) + 5 {
			h *= 1.05
		}
		s0 := math.Round(h*1000) / 1000
		if n := int(math.Ceil(q.Diameter/s0)) + 5; n*n > lim.Nodes {
			s0 += 0.001
		}
		q.Grid = s0
	}
	if q.Border == 0 {
		q.Border = math.Max(q.Profile.Wall, q.Design.Line)
	}
	res, err := engine.ComputeLace(q.Lace)
	if err != nil {
		return nil, err
	}
	lap("lace")
	R := q.Diameter / 2
	line, half := q.Design.Line, q.Design.Line/2
	need := q.Design.CellNeed(q.Profile)
	wallNeed, gapNeed := WallNeed(q.Profile), GapNeed(q.Profile)
	h := q.Grid
	s := &LaceSolid{Radius: R, Levels: q.Design.Levels(), Grid: q.Grid}
	// The frame: raised, a band of the line's width joining the cut lace;
	// recessed, the slab's own material at full height, at least a wall
	// wide, so that the plaque sits flat when turned over.
	frame := line
	if q.Design.Treatment == Recessed {
		// A grid step over the wall, so that sampling never finds the
		// frame itself narrower than the wall.
		frame = math.Max(line, wallNeed+q.Grid)
	}
	switch q.Rim {
	case RimCrop:
		s.Scale = (R - frame) / q.Clip
	default:
		s.Scale = R - q.Border
	}
	if !(s.Scale > 4*h) {
		return nil, &FieldError{"border", "The border leaves no room for the lace."}
	}
	strokes, first, piece, scales, pieces := laceStrokes(&res, s.Scale, half, q.Lines)
	s.scales = scales
	s.Source = LaceSource{
		Tiles: len(res.Center), Strokes: len(strokes), Pieces: pieces,
		BeyondDepth: res.Omitted.Depth, NearRim: res.Omitted.Precision,
		Stopped: res.Stopped, Pending: res.Pending, Coverage: res.Coverage.Radius,
	}
	if len(strokes) > lim.Strokes {
		return nil, limitError{"number of strokes"}
	}
	cap := math.Max(need, math.Max(wallNeed, gapNeed))/2 + 2*h
	var evaluations int
	// gather is the plan of the given tiles' strokes, with each stroke's
	// piece.
	gather := func(tiles []int) ([]Stroke, []int32) {
		var out []Stroke
		var comp []int32
		for _, i := range tiles {
			out = append(out, strokes[first[i]:first[i+1]]...)
			comp = append(comp, piece[first[i]:first[i+1]]...)
		}
		return out, comp
	}
	nearest := func(i int) float64 {
		d := math.Inf(1)
		for _, st := range strokes[first[i]:first[i+1]] {
			d = math.Min(d, st.Distance(0))
		}
		return d
	}
	// A tile is resolved when the grid spans its fundamental triangle's
	// incircle at least twice; smaller tiles are left out before any
	// check, since the grid could not show their cells.
	inradius := triangleInradius(&res)
	resolved := func(i int) bool { return scales[i]*s.Scale*inradius >= 2*h }
	all := make([]int, len(res.Center))
	for i := range all {
		all[i] = i
	}
	// motif runs the whole-motif cutoff: tiles inside the lace's disk,
	// then, while a cell fails or separate pieces fuse, every tile no
	// larger than the largest of the smallest tiles around each failure
	// is left out.
	motif := func() ([]int, error) {
		var kept []int
		for _, i := range all {
			ok := resolved(i)
			for _, st := range strokes[first[i]:first[i+1]] {
				if farthest(st)+st.Half > s.Scale {
					ok = false
				}
			}
			if ok {
				kept = append(kept, i)
			}
		}
		for {
			if len(kept) == 0 {
				fewer := ""
				if q.Lines == LinesBoth {
					fewer = " draw the motif or the tile sides alone,"
				}
				return nil, fmt.Errorf("At %g mm with %g mm lines, no whole tile keeps its gaps: enlarge the plaque, narrow the lines,%s or choose a clean rim or crop with Remove features below the minimums.", q.Diameter, line, fewer)
			}
			s.Cutoff.Rounds++
			if s.Cutoff.Rounds > lim.Rounds {
				return nil, fmt.Errorf("the whole-motif cutoff did not settle in %d rounds", lim.Rounds)
			}
			plan, comp := gather(kept)
			p := Plan{Strokes: plan, Outer: s.Scale, Plaque: R}
			g, err := Sample(p, h, cap, lim)
			if err != nil {
				return nil, err
			}
			g.Clean()
			evaluations += g.Evaluations
			cells := AnalyzeCells(g, p, comp, need)
			threshold := math.Inf(-1)
			failed := false
			consider := func(tiles []int) {
				failed = true
				least := math.Inf(1)
				for _, t := range tiles {
					least = math.Min(least, scales[t])
				}
				threshold = math.Max(threshold, least)
			}
			for _, c := range cells.Cells {
				if c.Status != CellPass {
					consider(c.Tiles)
				}
			}
			for _, group := range cells.Fused {
				member := map[int32]bool{}
				for _, c := range group {
					member[c] = true
				}
				var tiles []int
				for _, i := range kept {
					if member[piece[first[i]]] {
						tiles = append(tiles, i)
					}
				}
				consider(tiles)
			}
			if !failed {
				return kept, nil
			}
			s.Cutoff.FailedRounds++
			// Each round's grid is garbage now: collect it rather than
			// let rounds pile up before the collector's next turn.
			g, cells = nil, CellReport{}
			runtime.GC()
			var next []int
			for _, i := range kept {
				if scales[i] > threshold {
					next = append(next, i)
				}
			}
			kept = next
		}
	}
	var kept []int
	var plan Plan
	var comp []int32
	base := Base{Radius: R, Segments: circleSegments(R, h)}
	switch q.Rim {
	case RimMotif:
		if kept, err = motif(); err != nil {
			return nil, err
		}
		plan.Strokes, comp = gather(kept)
		plan.Outer, plan.Plaque = s.Scale, R
	case RimClean, RimCrop:
		rho := 0.0
		if q.Rim == RimCrop {
			rho = R - frame
			s.Clip = q.Clip
		} else if q.Clip != 0 {
			rho = q.Clip * s.Scale
			s.Clip = q.Clip
		} else {
			// From the whole-motif cutoff: up to the nearest left-out
			// tile's band, or around the whole patch.
			whole, err := motif()
			if err != nil {
				return nil, err
			}
			inWhole := map[int]bool{}
			for _, i := range whole {
				inWhole[i] = true
			}
			rho = math.Inf(1)
			far := 0.0
			for _, i := range all {
				if !inWhole[i] {
					rho = math.Min(rho, nearest(i)-half)
				} else {
					for _, st := range strokes[first[i]:first[i+1]] {
						far = math.Max(far, farthest(st)+half)
					}
				}
			}
			if math.IsInf(rho, 1) {
				rho = far + need
			}
			rho = math.Min(rho, s.Scale-frame)
			s.Clip = rho / s.Scale
		}
		if rho+frame > R+1e-9 || rho < 4*h {
			return nil, &FieldError{"clip", "The rim leaves no room for its frame inside the plaque."}
		}
		for _, i := range all {
			if nearest(i) <= rho+half {
				kept = append(kept, i)
			}
		}
		plan.Strokes, comp = gather(kept)
		if q.Design.Treatment == Recessed {
			plan.Clip, plan.Outer, plan.Plaque = rho, rho, R
		} else {
			plan.Clip, plan.Frame, plan.Outer, plan.Plaque = rho, line, rho+line, R
			base.Framed = q.Rim == RimCrop
		}
	}
	lap("cutoff")
	s.Cutoff.Tiles, s.Cutoff.Admitted = kept, len(kept)
	s.Cutoff.LeastScale = math.Inf(1)
	inKept := map[int]bool{}
	for _, i := range kept {
		inKept[i] = true
		s.Cutoff.LeastScale = math.Min(s.Cutoff.LeastScale, scales[i])
	}
	if len(kept) == 0 {
		s.Cutoff.LeastScale = 0
	}
	switch {
	case q.Rim != RimMotif:
		s.Cutoff.Reason, s.Cutoff.Radius = "clip", s.Clip
	case len(kept) < len(all):
		s.Cutoff.Reason = "manufacturing"
		s.Cutoff.Radius = math.Inf(1)
		for _, i := range all {
			if !inKept[i] {
				s.Cutoff.Radius = math.Min(s.Cutoff.Radius, nearest(i)/s.Scale)
			}
		}
	default:
		s.Cutoff.Reason = "source"
		for _, st := range strokes {
			s.Cutoff.Radius = math.Max(s.Cutoff.Radius, farthest(st)/s.Scale)
		}
	}

	g, err := Sample(plan, h, cap, lim)
	if err != nil {
		return nil, err
	}
	s.Stats.Specks = g.Clean()
	evaluations += g.Evaluations
	s.Cells = AnalyzeCells(g, plan, comp, need)
	// An automatic clean rim draws in by 3% of its radius while a cell
	// fails against the frame, within the round ceiling.
	for q.Rim == RimClean && q.Clip == 0 && !q.Design.Simplify && (s.Cells.Failed > 0 || s.Cells.Unresolved > 0) {
		s.Cutoff.Rounds++
		s.Cutoff.FailedRounds++
		if s.Cutoff.Rounds > lim.Rounds {
			break
		}
		rho := plan.Clip * 0.97
		if rho < 4*h {
			break
		}
		s.Clip = rho / s.Scale
		kept = kept[:0]
		for _, i := range all {
			if nearest(i) <= rho+half {
				kept = append(kept, i)
			}
		}
		plan.Strokes, comp = gather(kept)
		plan.Clip, plan.Outer = rho, rho+plan.Frame
		if g, err = Sample(plan, h, cap, lim); err != nil {
			return nil, err
		}
		s.Stats.Specks = g.Clean()
		evaluations += g.Evaluations
		s.Cells = AnalyzeCells(g, plan, comp, need)
		runtime.GC()
	}
	if q.Design.Simplify {
		s.Simplified = g.Simplify(q.Design.Treatment != Recessed, wallNeed, gapNeed, plan.Outer, R)
		s.Stats.Specks += g.Clean()
		s.Cells = AnalyzeCells(g, plan, comp, need)
		for _, p := range append(append([]complex128(nil), s.Simplified.Removed...), s.Simplified.Filled...) {
			s.SimplifiedAt = append(s.SimplifiedAt, real(p), imag(p))
		}
	}
	s.Cutoff.Tiles, s.Cutoff.Admitted = kept, len(kept)
	if q.Rim == RimClean {
		s.Cutoff.Radius = s.Clip
	}
	for _, i := range kept {
		if !resolved(i) {
			s.Cutoff.Unresolved++
		}
	}
	lap("cells")
	cs, err := g.Contour(lim)
	if err != nil {
		return nil, err
	}
	s.Stats.Deviation = deviation(g, plan, cs, s.Simplified.changed)
	s.Stats.Nodes = g.NX * g.NY
	// The grid is done with: let it go before the mesh's stages, so its
	// arrays and the mesh's never peak together.
	g = nil
	runtime.GC()
	lap("contour")
	m, err := SolidifyWithin(cs, base, q.Design.Levels(), lim)
	if err != nil {
		return nil, err
	}
	if q.Design.FaceDown {
		m.TurnOver(math.Max(s.Levels.Plan, s.Levels.Rest))
		s.FaceDown = true
	}
	s.Solid = m
	cs = nil
	runtime.GC()
	lap("solid")
	s.Mesh = Check(m, lim)
	lap("check")
	settings, err := json.Marshal(q)
	if err != nil {
		return nil, err
	}
	s.Settings = settings
	var pkg bytes.Buffer
	title := fmt.Sprintf("Hyperbolic lace {%s}, %s, %s mm", res.Tiling, q.Design.Treatment, strconv.FormatFloat(q.Diameter, 'f', -1, 64))
	if err := Write3MF(&pkg, m, PackageInfo{Title: title, Settings: settings,
		Translate: [2]float64{q.Profile.Envelope[0] / 2, q.Profile.Envelope[1] / 2}}, lim); err != nil {
		return nil, err
	}
	s.Package = pkg.Bytes()
	lap("package")

	// Highlights for the preview: failing or unresolved cells, narrow
	// gaps and fused pieces, each list bounded.
	for _, c := range s.Cells.Cells {
		// Source cells simplifying filled away were asked for, not failures.
		if q.Design.Simplify && c.Vanished {
			continue
		}
		if c.Status != CellPass && len(s.Problems) < 2000 {
			s.Problems = append(s.Problems, c)
		}
	}
	for k, p := range s.Cells.Narrow {
		// Simplifying replaces the narrow-gap advisory with what it removed.
		if k >= 20000 || q.Design.Simplify {
			break
		}
		s.Narrow = append(s.Narrow, real(p), imag(p))
	}
	fusedPiece := map[int32]bool{}
	for _, group := range s.Cells.Fused {
		for _, c := range group {
			fusedPiece[c] = true
		}
	}
	for k, st := range plan.Strokes {
		// Pieces simplifying joined were asked for, not failures.
		if fusedPiece[comp[k]] && !q.Design.Simplify && len(s.FusedAt) < 40000 {
			mp := midpoint(st)
			s.FusedAt = append(s.FusedAt, real(mp), imag(mp))
		}
	}

	s.Stats.Strokes = len(plan.Strokes)
	s.Stats.Evaluations = evaluations
	s.Stats.Vertices = len(m.V) / 3
	s.Stats.Triangles = len(m.T) / 3
	s.Stats.PairTests = s.Mesh.PairTests
	s.Stats.MeshBytes = 8*len(m.V) + 4*len(m.T)
	s.Stats.PackageBytes = len(s.Package)
	// The grid's arrays at their peak: the field, nearest strokes,
	// contour vertex ids, clearances, labels and distance transform.
	s.Stats.WorkingBytes = s.Stats.Nodes * (8 + 4 + 8 + 8 + 4 + 4 + 8 + 8 + 8)
	if !base.Framed {
		s.Stats.Chord = R * (1 - math.Cos(math.Pi/float64(base.Segments)))
	}
	s.Stats.Millis = millis
	s.Checks = s.checks(q)
	s.Validated = true
	for _, c := range s.Checks {
		if c.Required && c.Status != StatusPass {
			s.Validated = false
		}
	}
	return s, nil
}

// triangleInradius is the Euclidean inradius, in model units, of the
// unmoved seed's fundamental triangle with corners at its center, a side's
// midpoint and a corner, its curved side taken straight.
func triangleInradius(res *engine.LaceResult) float64 {
	p := 3.0
	if len(res.Tiling) > 0 {
		if v, err := strconv.Atoi(res.Tiling[:1]); err == nil {
			p = float64(v)
		}
	}
	m := math.Tanh(res.Apothem / 2)
	r := res.VertexRadius
	v := cmplx.Rect(r, math.Pi/p)
	area := m * r * math.Sin(math.Pi/p) / 2
	return 2 * area / (m + r + cmplx.Abs(v-complex(m, 0)))
}

// circleSegments is the plaque polygon's side count: chords within a
// hundredth of the grid step of the circle, at least 64.
func circleSegments(r, h float64) int {
	return max(64, int(math.Ceil(math.Pi/math.Acos(1-0.01*h/r))))
}

// deviation measures every contour vertex's exact distance from the
// plan's boundary, from the strokes nearest the four nodes around it.
func deviation(g *Grid, p Plan, cs *Contours, changed []bool) float64 {
	worst := 0.0
	for _, x := range cs.Points {
		i, j := g.index(x)
		// Where simplifying moved the boundary on purpose, the exact plan's
		// boundary is not the measure.
		if changed != nil {
			moved := false
			for _, d := range [4][2]int{{0, 0}, {1, 0}, {0, 1}, {1, 1}} {
				if k := (j+d[1])*g.NX + i + d[0]; k >= 0 && k < len(changed) && changed[k] {
					moved = true
				}
			}
			if moved {
				continue
			}
		}
		v := math.Inf(1)
		for _, d := range [4][2]int{{0, 0}, {1, 0}, {0, 1}, {1, 1}} {
			k := (j+d[1])*g.NX + i + d[0]
			if k >= 0 && k < len(g.Near) && g.Near[k] >= 0 {
				st := p.Strokes[g.Near[k]]
				v = math.Min(v, st.Distance(x)-st.Half)
			}
		}
		r := cmplx.Abs(x)
		if p.Clip > 0 {
			v = math.Max(v, r-p.Clip)
		}
		if p.Frame > 0 {
			v = math.Min(v, math.Abs(r-p.Clip-p.Frame/2)-p.Frame/2)
		}
		v = math.Max(v, r-p.Outer)
		if !math.IsInf(v, 0) {
			worst = math.Max(worst, math.Abs(v))
		}
	}
	return worst
}

func (s *LaceSolid) checks(q LaceSolidRequest) []CheckItem {
	out := sizeChecks(q.Design, q.Profile)
	r := s.Mesh
	simplify := q.Design.Simplify
	const fixRemove = "Turn on Remove features below the minimums"
	geometry := func(id, label string, ok bool, value float64, detail, hint string) {
		out = append(out, CheckItem{ID: id, Label: label, Required: true, Status: pass(ok), Evidence: Measured, Value: value, Detail: detail, Hint: hint})
	}
	const bug = "This should not happen: please report the settings that made it."
	geometry("closed", "Closed two-manifold", r.Closed && r.Nonmanifold == 0 && r.NonmanifoldVertices == 0,
		float64(r.Boundary+r.Nonmanifold+r.NonmanifoldVertices), "every edge between exactly two triangles, one fan at every vertex", bug)
	geometry("oriented", "Outward orientation", r.Oriented, r.Volume, "every edge used once each way; every piece encloses positive volume", bug)
	bodyHint := "Add a floor, or frame the lace with a clean rim or a crop, so that every piece is held."
	if !q.Design.Openwork() {
		bodyHint = bug
	}
	geometry("components", "One body", r.Components == 1 && r.Nested == 0, float64(r.Components), "pieces joined through edges", bodyHint)
	geometry("degenerate", "No degenerate triangles", r.Degenerate == 0, float64(r.Degenerate), "", bug)
	si := CheckItem{ID: "intersections", Label: "No self-intersection", Required: true, Evidence: Measured,
		Value: float64(r.SelfIntersections + r.Touching), Detail: fmt.Sprintf("%d triangle pairs tested", r.PairTests), Hint: bug}
	switch {
	case r.Unresolved:
		si.Status, si.Detail = StatusUnresolved, "the pair-test ceiling stopped the check"
		si.Hint = "Choose a smaller plaque or a coarser grid step."
	default:
		si.Status = pass(r.SelfIntersections == 0 && r.Touching == 0)
	}
	out = append(out, si)
	c := s.Cells
	cellWhat := "Gaps between raised lines"
	if q.Design.Treatment == Recessed {
		cellWhat = "Webs between grooves"
	}
	// With simplifying, source cells filled away are what was asked for,
	// not failures.
	failed := c.Failed
	if simplify {
		failed -= c.Vanished
	}
	cell := CheckItem{ID: "cells", Label: cellWhat, Required: true, Evidence: Sampled, Value: 2 * c.Worst().Radius, Limit: c.Need,
		Detail: fmt.Sprintf("%d cells: %d fail (%d vanished), %d unresolved; sampled lower bound, true diameter at most %.3g mm more",
			c.Count, c.Failed, c.Vanished, c.Unresolved, 2*c.Allowance),
		Hint: fixRemove + ", or enlarge the plaque, narrow the lines, or draw the rim or crop in."}
	switch {
	case failed > 0:
		cell.Status = StatusFail
	case c.Unresolved > 0:
		cell.Status = StatusUnresolved
	default:
		cell.Status = StatusPass
	}
	out = append(out, cell)
	separate := CheckItem{ID: "separate", Label: "Separate pieces stay apart", Required: true, Evidence: Sampled,
		Status: pass(len(c.Fused) == 0), Value: float64(len(c.Fused)), Limit: c.Need,
		Detail: fmt.Sprintf("%d source pieces; groups closer than the minimum: %d", s.Source.Pieces, len(c.Fused)),
		Hint:   fixRemove + " to join them deliberately, or enlarge the plaque or narrow the lines."}
	if simplify && len(c.Fused) > 0 {
		separate.Required, separate.Status, separate.Hint = false, StatusWarn, ""
		separate.Detail += "; joined by removing features below the minimums"
	}
	out = append(out, separate)
	if simplify {
		out = append(out, CheckItem{ID: "simplified", Label: "Features below the minimums removed", Evidence: Sampled,
			Status: StatusWarn, Value: s.Simplified.RemovedArea + s.Simplified.FilledArea,
			Detail: fmt.Sprintf("%.3g mm² of material thinner than %.3g mm removed, %.3g mm² of gaps narrower than %.3g mm filled",
				s.Simplified.RemovedArea, WallNeed(q.Profile), s.Simplified.FilledArea, GapNeed(q.Profile))})
	} else {
		narrow := CheckItem{ID: "narrow", Label: "Narrow gap area", Evidence: Sampled, Value: c.NarrowArea, Status: StatusPass,
			Detail: "wedge corners, cusps and channels no disk of the minimum reaches"}
		if c.NarrowArea > 0 {
			narrow.Status = StatusWarn
		}
		out = append(out, narrow)
	}
	// Simplifying removes whatever is below the minimums, which a grid
	// fine enough for the minimums can judge; otherwise every kept tile
	// must be resolved.
	resolution := CheckItem{ID: "resolution", Label: "Every kept tile resolved by the grid", Required: true, Evidence: Exact,
		Status: pass(s.Cutoff.Unresolved == 0), Value: float64(s.Cutoff.Unresolved),
		Detail: fmt.Sprintf("grid step %.3g mm; %d specks under a step filled", q.Grid, s.Stats.Specks),
		Hint:   fixRemove + ", lower the grid step, or draw the rim or crop in."}
	if simplify {
		least := math.Min(WallNeed(q.Profile), GapNeed(q.Profile))
		resolution.Label = "Grid fine enough for the minimums"
		resolution.Status, resolution.Value, resolution.Limit = pass(q.Grid <= least/2), q.Grid, least/2
		resolution.Hint = "Lower the grid step to half the smallest minimum or less."
	}
	out = append(out, resolution)
	top := math.Max(s.Levels.Plan, s.Levels.Rest)
	env := q.Profile.Envelope
	out = append(out, CheckItem{ID: "envelope", Label: "Fits the build envelope", Required: true, Evidence: Exact,
		Status: pass(q.Diameter <= math.Min(env[0], env[1]) && top <= env[2]), Value: q.Diameter, Limit: math.Min(env[0], env[1]),
		Hint: "Choose a smaller plaque, or a printer with a larger bed."})
	if q.Design.FaceDown && q.Design.Treatment == Raised && !q.Design.Openwork() {
		out = append(out, CheckItem{ID: "face-down", Label: "Face down", Evidence: Exact, Status: StatusWarn,
			Detail: "the floor prints on top, bridging every gap between the lines",
			Hint:   "Print raised plaques face up, or as openwork."})
	}
	return out
}
