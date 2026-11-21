package engine3

import (
	"fmt"
	"math"
	"slices"
	"sort"
	"strconv"

	"tangentgarden/engine/expr"
)

// A bounded scan of one implicit study along one scalar, the level c or the
// shape parameter a, for the places where its mesh's reading changes
// (docs/mathematics.md, Scanning for topology changes).
//
// The scan meshes the study at evenly spaced values of the axis, both ends
// exact, and keeps only each mesh's reading (ScanReading), never the mesh.
// Each pair of neighboring samples whose readings differ is a bracket, and
// brackets are bisected, all of them one level before any goes deeper, to
// the depth asked for. A midpoint that reads like neither end splits its
// bracket in two. Each candidate is then looked for again on two other
// grids, one cell finer (which moves the lattice inside the same box) and
// one half again as fine: the change must appear between the same coarse
// samples there, or within two coarse steps beyond them, and is bisected
// there to the same width. A candidate is the mesh's evidence of a change
// between two values on these grids; it never certifies that F has a
// critical value there, nor that nothing changes between two samples that
// read alike. Every value meshed is cleaned of floating-point tails first
// (generated), so a value shown and set is the value meshed.
//
// Work is bounded by the calls to the mesher and the base grid cells they
// mesh in all; each call is also bounded by the mesher's own limits.
// Bisection stops early when going on would leave too little for the
// rechecks (reserved). Step makes at most one call, so a caller can stop
// between calls.

// ScanRequest is one study and the axis it is scanned along: "level" moves
// Implicit.Level, "a" moves Implicit.A, which F must read. The scan covers
// [From, To] with Samples evenly spaced values and bisects each bracket
// Depth times; Recheck looks for each candidate on two other grids.
// Implicit's sections are ignored.
type ScanRequest struct {
	Implicit ImplicitRequest `json:"implicit"`
	Axis     string          `json:"axis"`
	From     float64         `json:"from"`
	To       float64         `json:"to"`
	Samples  int             `json:"samples"`
	Depth    int             `json:"depth"`
	Recheck  bool            `json:"recheck"`
	// Critical looks for F's critical points beside each candidate
	// (scan_critical.go).
	Critical bool `json:"critical"`
}

// ScanReading is what one mesh shows, without the mesh:
//   - "complete": closed, two-sided, uncut, nothing left out (no surface at
//     all is complete, with no pieces);
//   - "cut": the box cuts it open, and nothing else is wrong;
//   - "incomplete": Why says what was left out: "open" (cells left out
//     beside points where F is not finite, or an edge on more than two
//     triangles), "poles" (F changes sign across a pole or a jump),
//     "refinement" (refinement stopped at its budget), "crossings" (sheets
//     meeting that could not be meshed) or "one-sided";
//   - "refused": the mesher refused the study, and Why is its message.
//
// Pieces holds the Euler characteristics of a complete or cut mesh's
// closed pieces, ascending, and Cut those of the pieces the box cuts open.
// Singular counts its vertices without a normal, where ∇F vanishes or is
// not finite.
type ScanReading struct {
	Status    string `json:"status"`
	Pieces    []int  `json:"pieces"`
	Cut       []int  `json:"cut"`
	Why       string `json:"why,omitempty"`
	Singular  int    `json:"singular"`
	Triangles int    `json:"triangles"`
}

// ScanSample is one value of the axis meshed on the study's own grid, by
// the coarse pass or by bisection.
type ScanSample struct {
	Value   float64     `json:"value"`
	Coarse  bool        `json:"coarse"`
	Reading ScanReading `json:"reading"`
}

// ScanRecheck is a candidate looked for on another grid, of Cells along
// the box's longest side, between the coarse samples either side of it (or
// the neighboring candidates, where they are nearer). Before and After are
// the readings at Lo and Hi on that grid. Outcome is "agrees" when they
// are the candidate's, and Lo and Hi are then that grid's bracket, bisected
// to the candidate's width; "below" or "above" when the change on that grid
// lies beyond that coarse sample; "differs" for any other reading, and
// "unresolved" when either end is incomplete or refused there.
type ScanRecheck struct {
	Cells   int         `json:"cells"`
	Lo      float64     `json:"lo"`
	Hi      float64     `json:"hi"`
	Before  ScanReading `json:"before"`
	After   ScanReading `json:"after"`
	Depth   int         `json:"depth"`
	Outcome string      `json:"outcome"`
}

// ScanCandidate is a bracket [Lo, Hi] of the axis whose ends read
// differently, Before at Lo and After at Hi. Kind is "box" when the pieces
// the box cuts differ between them, "change" when only closed pieces do,
// and "unresolved" when either is incomplete or refused. Two
// brackets either side of a class that lasts only between them, and that
// is unresolved or whose every sample has singular vertices, are one candidate
// Through that sample: "unresolved" for an unresolved middle, and
// "singular" when Before and After read alike. Depth is the bisections
// made; Singular lists the values sampled in the bracket whose mesh has a
// vertex without a normal. Stability is "stable" when both rechecks
// agree, "unstable" when either does not, and "unchecked" when they were
// not made. Spread is the smallest interval holding the bracket on the
// study's grid and on every grid that agrees.
type ScanCandidate struct {
	Lo        float64      `json:"lo"`
	Hi        float64      `json:"hi"`
	Before    ScanReading  `json:"before"`
	After     ScanReading  `json:"after"`
	Kind      string       `json:"kind"`
	Through   *ScanSample  `json:"through,omitempty"`
	Depth     int          `json:"depth"`
	Singular  []float64    `json:"singular"`
	Lattice   *ScanRecheck `json:"lattice,omitempty"`
	Finer     *ScanRecheck `json:"finer,omitempty"`
	Stability string       `json:"stability"`
	Spread    [2]float64   `json:"spread"`
	// Critical values found beside the candidate: null when the search was
	// not made, and empty when it found none.
	Critical []ScanCritical `json:"critical"`
	// Merged counts the box candidates a merged box interval holds; 0 for
	// any other candidate.
	Merged int `json:"merged,omitempty"`
}

// ScanResult is the scan so far. Stop is "running", "complete", "calls" or
// "cells" (a work limit stopped it) or "canceled". Calls and Cells count
// the mesher calls made and the base grid cells they meshed, rechecks
// included. Unresolved and Singular count the study-grid samples that were
// incomplete or refused, and that had a vertex without a normal.
type ScanResult struct {
	Axis       string          `json:"axis"`
	From       float64         `json:"from"`
	To         float64         `json:"to"`
	Samples    []ScanSample    `json:"samples"`
	Candidates []ScanCandidate `json:"candidates"`
	Calls      int             `json:"calls"`
	Cells      int             `json:"cells"`
	Stop       string          `json:"stop"`
	Unresolved int             `json:"unresolved"`
	Singular   int             `json:"singular"`
	// Curtailed: bisection stopped short of the depth asked for, to keep
	// the rechecks within the work limits.
	Curtailed bool `json:"curtailed"`
}

const (
	minScanSamples, maxScanSamples = 3, 65
	maxScanDepth                   = 12
)

// Work limits over a whole scan; variables so tests can lower them.
var (
	maxScanCalls = 1024
	maxScanCells = 64_000_000
)

type scanBracket struct {
	lo, hi float64
	depth  int
}

// A recheck in progress: its candidate, its grid, and how far it has got.
type scanRun struct {
	candidate int
	finer     bool
	// 0 reads the low end, 1 the high end, 2 bisects.
	phase  int
	haveHi bool
	// How far an end may move outward when the change on this grid lies
	// beyond it: a coarse step at a time, at most maxScanWiden steps, and
	// never past a neighboring change or the range.
	widen       int
	floor, ceil float64
	step        float64
	want        int
}

// The coarse steps a recheck may look beyond its first interval.
const maxScanWiden = 2

// Scan is one scan in progress.
type Scan struct {
	q        ScanRequest
	base     ImplicitRequest
	readings map[float64]ScanReading
	coarse   map[float64]bool
	brackets []scanBracket
	// Stage: 0 coarse, 1 bisection, 2 rechecks, 3 done.
	stage, next, pass int
	cands             []ScanCandidate
	runs              []scanRun
	calls, cells      int
	stop              string
	curtailed         bool
}

func (q ScanRequest) validate() error {
	if q.Axis != "level" && q.Axis != "a" {
		return fieldErr("scan.axis", "scan the level c or the shape parameter a")
	}
	if !bounded(q.From) {
		return fieldErr("scan.from", "the scan's range must be finite and within ±100000")
	}
	if !bounded(q.To) {
		return fieldErr("scan.to", "the scan's range must be finite and within ±100000")
	}
	if !(q.To > q.From) {
		return fieldErr("scan.to", "the scan must end above where it starts")
	}
	if q.Samples < minScanSamples || q.Samples > maxScanSamples {
		return fieldErr("scan.samples", "use %d–%d samples", minScanSamples, maxScanSamples)
	}
	if q.Depth < 0 || q.Depth > maxScanDepth {
		return fieldErr("scan.depth", "use 0–%d bisections", maxScanDepth)
	}
	return nil
}

// NewScan validates the request and the study, and parses F once to learn
// whether it reads a.
func NewScan(q ScanRequest) (*Scan, error) {
	if err := q.validate(); err != nil {
		return nil, err
	}
	base := q.Implicit
	base.Sections = SectionRequest{Normal: Vec3{0, 0, 1}}
	if err := base.validate(); err != nil {
		return nil, err
	}
	uses, err := parseField(base)
	if err != nil {
		return nil, err
	}
	if q.Axis == "a" && !uses {
		return nil, fieldErr("scan.axis", "F does not read a, so there is no shape parameter to scan")
	}
	return &Scan{q: q, base: base, readings: map[float64]ScanReading{}, coarse: map[float64]bool{}, stop: "running"}, nil
}

// parseField parses F as sample does, and reports whether it reads a.
func parseField(q ImplicitRequest) (bool, error) {
	_, uses, err := expr.ParseSpatialFieldUses(q.F, q.A)
	if err != nil {
		return false, named("implicit.f", fmt.Errorf("F(x, y, z): %w", err))
	}
	if uses.T {
		return false, fieldErr("implicit.f", "F(x, y, z) cannot use t; animate a or the level instead")
	}
	return uses.A, nil
}

// RunScan steps a scan to its end.
func RunScan(q ScanRequest) (ScanResult, error) {
	s, err := NewScan(q)
	if err != nil {
		return ScanResult{}, err
	}
	for s.Step() {
	}
	return s.Result(), nil
}

// Cancel stops the scan before its next call.
func (s *Scan) Cancel() {
	if s.stop == "running" {
		s.stop = "canceled"
		s.finish()
	}
}

// scale is the operands' scale of every value the scan computes: each is
// interpolated, halved or stepped from the range's ends.
func (s *Scan) scale() float64 { return math.Max(math.Abs(s.q.From), math.Abs(s.q.To)) }

// study is the base study at value v of the axis, on a grid of cells.
func (s *Scan) study(v float64, cells int) ImplicitRequest {
	q := s.base
	q.Cells = cells
	if s.q.Axis == "level" {
		q.Level = v
	} else {
		q.A = v
	}
	return q
}

// reserved reports whether bisecting bracket k once more leaves room in
// the work limits for the rechecks of every bracket found so far. Each
// recheck reads its two ends and is bisected about as often as its
// bracket was, so with bracket k one deeper they need, on each recheck
// grid, 2 + depth calls a bracket. A bracket with an unresolved end is not
// rechecked; widening a recheck's interval is not reserved.
func (s *Scan) reserved(k int) bool {
	calls, cells := s.calls+1, s.cells+gridCells(s.base.Box, s.base.Cells)
	if s.q.Recheck {
		for _, finer := range []bool{false, true} {
			g := scanGrid(s.base, finer)
			if g == 0 {
				continue
			}
			n := gridCells(s.base.Box, g)
			for j, b := range s.brackets {
				if !resolved(s.readings[b.lo]) || !resolved(s.readings[b.hi]) {
					continue
				}
				d := b.depth
				if j == k {
					d++
				}
				calls += 2 + d
				cells += (2 + d) * n
			}
		}
	}
	return calls <= maxScanCalls && cells <= maxScanCells
}

// afford reports whether one more call on a grid of cells fits the work
// limits, and stops the scan when it does not.
func (s *Scan) afford(cells int) bool {
	if s.calls >= maxScanCalls {
		s.stop = "calls"
	} else if s.cells+gridCells(s.base.Box, cells) > maxScanCells {
		s.stop = "cells"
	} else {
		return true
	}
	s.finish()
	return false
}

// gridCells counts the cells of the box's grid of cells along its longest
// side.
func gridCells(b Box, cells int) int {
	n := b.shape(cells)
	return n[0] * n[1] * n[2]
}

func (s *Scan) read(v float64, cells int) ScanReading {
	s.calls++
	s.cells += gridCells(s.base.Box, cells)
	return scanRead(s.study(v, cells))
}

// scanRead meshes one study and reads it.
func scanRead(q ImplicitRequest) ScanReading {
	res, err := implicit(q)
	if err != nil {
		return ScanReading{Status: "refused", Why: err.Error(), Pieces: []int{}, Cut: []int{}}
	}
	m := res.Implicit
	r := ScanReading{Pieces: []int{}, Cut: []int{}, Singular: m.Singular, Triangles: len(m.Triangles) / 3}
	open, sided := false, true
	for _, c := range m.Components {
		open = open || !c.Closed
		sided = sided && c.Orientable
	}
	switch {
	case m.Discontinuities > 0:
		// Before open edges, which an edge rejected as a pole leaves.
		r.Status, r.Why = "incomplete", "poles"
	case m.Nonfinite > 0 || len(m.Open) > 0:
		r.Status, r.Why = "incomplete", "open"
	case m.Refinement.Exhausted:
		r.Status, r.Why = "incomplete", "refinement"
	case m.CrossingsUnresolved > 0 || m.CrossingsExhausted:
		r.Status, r.Why = "incomplete", "crossings"
	case !sided:
		r.Status, r.Why = "incomplete", "one-sided"
	case len(m.Cut) > 0:
		r.Status = "cut"
	case open:
		// Not closed and not cut: an edge on more than two triangles.
		r.Status, r.Why = "incomplete", "open"
	default:
		r.Status = "complete"
	}
	if r.Status == "complete" || r.Status == "cut" {
		cut := cutPieces(m)
		for k, c := range m.Components {
			if cut[k] {
				r.Cut = append(r.Cut, c.Euler)
			} else {
				r.Pieces = append(r.Pieces, c.Euler)
			}
		}
		slices.Sort(r.Pieces)
		slices.Sort(r.Cut)
	}
	return r
}

// cutPieces marks the pieces with an edge on the box, numbering pieces as
// topology does: in the order of their first triangle.
func cutPieces(m *ImplicitResult) []bool {
	out := make([]bool, len(m.Components))
	if len(m.Cut) == 0 {
		return out
	}
	parent := make([]int32, len(m.Positions)/3)
	for k := range parent {
		parent[k] = int32(k)
	}
	find := func(v int32) int32 {
		for parent[v] != v {
			parent[v] = parent[parent[v]]
			v = parent[v]
		}
		return v
	}
	for k := 0; k < len(m.Triangles); k += 3 {
		for e := range 3 {
			a, b := find(m.Triangles[k+e]), find(m.Triangles[k+(e+1)%3])
			if a != b {
				parent[max(a, b)] = min(a, b)
			}
		}
	}
	piece := map[int32]int{}
	for k := 0; k < len(m.Triangles); k += 3 {
		if r := find(m.Triangles[k]); piece[r] == 0 {
			piece[r] = len(piece) + 1
		}
	}
	for k := 0; k < len(m.Cut); k++ {
		out[piece[find(m.Cut[k])]-1] = true
	}
	return out
}

func resolved(r ScanReading) bool { return r.Status == "complete" || r.Status == "cut" }

// same reports whether two readings are one class: every unresolved
// reading is one class, whatever its reason, since an incomplete mesh
// shows no topology to compare.
func same(a, b ScanReading) bool {
	if !resolved(a) || !resolved(b) {
		return !resolved(a) && !resolved(b)
	}
	return slices.Equal(a.Pieces, b.Pieces) && slices.Equal(a.Cut, b.Cut)
}

// Step makes at most one mesher call, and reports whether the scan goes
// on.
func (s *Scan) Step() bool {
	for s.stop == "running" {
		switch s.stage {
		case 0:
			if s.next == s.q.Samples {
				s.bracketCoarse()
				s.stage = 1
				continue
			}
			if !s.afford(s.base.Cells) {
				return false
			}
			// The range's ends are as entered: lerp's hi·i/n need not
			// return hi at i = n.
			var v float64
			switch s.next {
			case 0:
				v = s.q.From
			case s.q.Samples - 1:
				v = s.q.To
			default:
				v = generated(lerp(s.q.From, s.q.To, s.next, s.q.Samples-1), s.scale())
			}
			s.readings[v] = s.read(v, s.base.Cells)
			s.coarse[v] = true
			s.next++
			return true
		case 1:
			if s.pass >= s.q.Depth {
				s.candidates()
				s.stage = 2
				continue
			}
			// Every bracket is bisected once before any is bisected again.
			k := slices.IndexFunc(s.brackets, func(b scanBracket) bool { return b.depth == s.pass })
			if k < 0 {
				s.pass++
				continue
			}
			b := s.brackets[k]
			m := generated(b.lo+(b.hi-b.lo)/2, s.scale())
			if !(m > b.lo && m < b.hi) {
				// No double lies between: the bracket is as narrow as it gets.
				s.brackets[k].depth = s.q.Depth
				continue
			}
			if !s.reserved(k) {
				// The rechecks need what is left: bisection stops here.
				s.curtailed = true
				s.candidates()
				s.stage = 2
				continue
			}
			if !s.afford(s.base.Cells) {
				return false
			}
			r := s.read(m, s.base.Cells)
			s.readings[m] = r
			switch {
			case same(r, s.readings[b.lo]):
				s.brackets[k] = scanBracket{m, b.hi, b.depth + 1}
			case same(r, s.readings[b.hi]):
				s.brackets[k] = scanBracket{b.lo, m, b.depth + 1}
			default:
				s.brackets = slices.Insert(s.brackets, k+1, scanBracket{m, b.hi, b.depth + 1})
				s.brackets[k] = scanBracket{b.lo, m, b.depth + 1}
			}
			return true
		case 2:
			if s.next >= len(s.runs) {
				s.stop = "complete"
				s.finish()
				return false
			}
			if s.recheck(&s.runs[s.next]) {
				return true
			}
		}
	}
	return false
}

// recheck advances one recheck by at most one call, and reports whether it
// made one; a finished recheck moves the scan to the next.
func (s *Scan) recheck(run *scanRun) bool {
	c := &s.cands[run.candidate]
	r := c.Lattice
	if run.finer {
		r = c.Finer
	}
	done := func(outcome string) {
		r.Outcome = outcome
		c.Stability, c.Spread = stability(*c)
		s.next++
	}
	var v float64
	switch run.phase {
	case 0:
		v = r.Lo
	case 1:
		v = r.Hi
	default:
		v = generated(r.Lo+(r.Hi-r.Lo)/2, s.scale())
		if r.Depth >= run.want || !(v > r.Lo && v < r.Hi) {
			done("agrees")
			return false
		}
	}
	if !s.afford(r.Cells) {
		return false
	}
	got := s.read(v, r.Cells)
	switch run.phase {
	case 0:
		r.Before = got
		run.phase = 1
		if run.haveHi {
			s.judge(run, r, c, done)
		}
	case 1:
		r.After, run.haveHi = got, true
		s.judge(run, r, c, done)
	default:
		switch {
		case same(got, r.Before):
			r.Lo, r.Before = v, got
		case same(got, r.After):
			r.Hi, r.After = v, got
		case got.Singular > 0:
			// The change on this grid is at this singular sample.
			r.Lo, r.Hi, r.Before, r.After = v, v, got, got
			done("agrees")
			return true
		default:
			done("differs")
			return true
		}
		r.Depth++
	}
	return true
}

// judge compares a recheck's two ends with the candidate: the same change
// between them is bisected to the candidate's width; a change beyond an
// end moves that end outward, while it may.
func (s *Scan) judge(run *scanRun, r *ScanRecheck, c *ScanCandidate, done func(string)) {
	switch {
	case !resolved(r.Before) || !resolved(r.After):
		done("unresolved")
	case end(r.Before, c.Before, c.After) && end(r.After, c.After, c.Before):
		// The same change lies between these samples on this grid, or at
		// an end that reads as a singular state of it: coarse samples land
		// on round values, and critical levels often are.
		run.phase, run.want = 2, 0
		for w := r.Hi - r.Lo; w > c.Hi-c.Lo && run.want < maxScanDepth+2*maxScanWiden; w /= 2 {
			run.want++
		}
	case same(r.Before, c.After) && run.widen < maxScanWiden && r.Lo > run.floor:
		r.Lo = math.Max(run.floor, generated(r.Lo-run.step, s.scale()))
		run.widen++
		run.phase = 0
	case same(r.After, c.Before) && run.widen < maxScanWiden && r.Hi < run.ceil:
		r.Hi = math.Min(run.ceil, generated(r.Hi+run.step, s.scale()))
		run.widen++
		run.phase = 1
	case same(r.Before, c.After):
		done("below")
	case same(r.After, c.Before):
		done("above")
	default:
		done("differs")
	}
}

// end reports whether a recheck's end reads as the candidate's side, or
// as neither side with a vertex without a normal: the singular state at
// the change itself.
func end(got, side, other ScanReading) bool {
	return same(got, side) || got.Singular > 0 && !same(got, other)
}

// scanGrid is the recheck grid: one cell more along the longest side (one
// fewer at the limit), which moves the lattice inside the same box, or one
// half again as many, as far as the mesher's limits allow, and otherwise
// two thirds as many; 0 when no such grid differs from the study's.
func scanGrid(q ImplicitRequest, finer bool) int {
	fits := func(c int) bool {
		n := q.Box.shape(c)
		return c >= minImplicitCells && c <= maxImplicitCells && n[0]*n[1]*n[2] <= maxImplicitGrid
	}
	if !finer {
		if fits(q.Cells + 1) {
			return q.Cells + 1
		}
		if fits(q.Cells - 1) {
			return q.Cells - 1
		}
		return 0
	}
	for c := int(math.Round(1.5 * float64(q.Cells))); c > q.Cells+1; c-- {
		if fits(c) {
			return c
		}
	}
	// At the mesher's limit, two thirds as many instead.
	if c := int(math.Round(2 * float64(q.Cells) / 3)); c < q.Cells-1 && fits(c) {
		return c
	}
	return 0
}

// stability reads a candidate's rechecks, and the interval holding its
// bracket on every grid that agrees.
func stability(c ScanCandidate) (string, [2]float64) {
	spread := [2]float64{c.Lo, c.Hi}
	settled, agree := 0, 0
	for _, r := range []*ScanRecheck{c.Lattice, c.Finer} {
		if r == nil || r.Outcome == "pending" || r.Outcome == "skipped" {
			continue
		}
		settled++
		if r.Outcome == "agrees" {
			agree++
			spread = [2]float64{math.Min(spread[0], r.Lo), math.Max(spread[1], r.Hi)}
		}
	}
	switch {
	case settled > agree:
		return "unstable", spread
	case settled == 2:
		return "stable", spread
	}
	return "unchecked", spread
}

func (s *Scan) values() []float64 {
	vals := make([]float64, 0, len(s.readings))
	for v := range s.readings {
		vals = append(vals, v)
	}
	sort.Float64s(vals)
	return vals
}

// bracketCoarse makes a bracket of each neighboring pair sampled so far
// that read differently.
func (s *Scan) bracketCoarse() {
	vals := s.values()
	s.brackets = nil
	for k := 1; k < len(vals); k++ {
		if !same(s.readings[vals[k-1]], s.readings[vals[k]]) {
			s.brackets = append(s.brackets, scanBracket{vals[k-1], vals[k], 0})
		}
	}
}

// candidates turns the brackets into candidates, joining two either side
// of a class that lasts only between them and is unresolved or singular,
// and plans the rechecks.
func (s *Scan) candidates() {
	s.cands = nil
	vals := s.values()
	singular := func(lo, hi float64) []float64 {
		out := []float64{}
		for _, v := range vals {
			if v >= lo && v <= hi && s.readings[v].Singular > 0 {
				out = append(out, v)
			}
		}
		return out
	}
	bs := slices.Clone(s.brackets)
	sort.Slice(bs, func(i, j int) bool { return bs[i].lo < bs[j].lo })
	for k := 0; k < len(bs); k++ {
		b := bs[k]
		c := ScanCandidate{Lo: b.lo, Hi: b.hi, Before: s.readings[b.lo], After: s.readings[b.hi], Depth: b.depth}
		if k+1 < len(bs) {
			n := bs[k+1]
			mid := s.readings[b.hi]
			odd := singular(b.hi, n.lo)
			// Every sample of the middle class is singular: a blip.
			blip := len(odd) > 0
			for _, v := range vals {
				if v >= b.hi && v <= n.lo && s.readings[v].Singular == 0 {
					blip = false
				}
			}
			if same(mid, s.readings[n.lo]) && (!resolved(mid) || blip) {
				through := b.hi
				if len(odd) > 0 {
					through = odd[0]
				}
				c.Hi, c.After, c.Depth = n.hi, s.readings[n.hi], min(b.depth, n.depth)
				c.Through = &ScanSample{Value: through, Coarse: s.coarse[through], Reading: s.readings[through]}
				k++
			}
		}
		switch {
		case !resolved(c.Before) || !resolved(c.After) || c.Through != nil && !resolved(c.Through.Reading):
			c.Kind = "unresolved"
		case c.Through != nil && same(c.Before, c.After):
			c.Kind = "singular"
		case !slices.Equal(c.Before.Cut, c.After.Cut):
			// What the box cuts changes. A change only in closed pieces,
			// beside cut ones that stay the same, is a change.
			c.Kind = "box"
		default:
			c.Kind = "change"
		}
		c.Singular = singular(c.Lo, c.Hi)
		c.Stability, c.Spread = "unchecked", [2]float64{c.Lo, c.Hi}
		s.cands = append(s.cands, c)
	}
	s.runs = nil
	s.next = 0
	if !s.q.Recheck {
		return
	}
	coarse := []float64{}
	for _, v := range vals {
		if s.coarse[v] {
			coarse = append(coarse, v)
		}
	}
	for k := range s.cands {
		c := &s.cands[k]
		if c.Kind == "unresolved" || c.Kind == "singular" {
			continue
		}
		// The coarse samples either side, or the neighboring candidates'
		// nearer ends.
		lo, hi := s.q.From, s.q.To
		floor, ceil := s.q.From, s.q.To
		for _, v := range coarse {
			if v <= c.Lo {
				lo = v
			}
			if v >= c.Hi {
				hi = v
				break
			}
		}
		// A singular or unresolved neighbor is no change, and does not
		// narrow the interval.
		for j := k - 1; j >= 0; j-- {
			if n := s.cands[j]; n.Kind == "change" || n.Kind == "box" {
				lo, floor = math.Max(lo, n.Hi), n.Hi
				break
			}
		}
		for j := k + 1; j < len(s.cands); j++ {
			if n := s.cands[j]; n.Kind == "change" || n.Kind == "box" {
				hi, ceil = math.Min(hi, n.Lo), n.Lo
				break
			}
		}
		step := (s.q.To - s.q.From) / float64(s.q.Samples-1)
		for _, finer := range []bool{false, true} {
			cells := scanGrid(s.base, finer)
			if cells == 0 {
				continue
			}
			r := &ScanRecheck{Cells: cells, Lo: lo, Hi: hi, Outcome: "pending"}
			if finer {
				c.Finer = r
			} else {
				c.Lattice = r
			}
			s.runs = append(s.runs, scanRun{candidate: k, finer: finer, floor: floor, ceil: ceil, step: step})
		}
	}
}

// finish settles the candidates when the scan stops before rechecking.
func (s *Scan) finish() {
	if s.stage < 2 {
		if s.stage == 0 {
			s.bracketCoarse()
		}
		s.candidates()
		s.runs = nil
		for k := range s.cands {
			s.cands[k].Lattice, s.cands[k].Finer = nil, nil
		}
	}
	// A recheck the scan stopped before finishing is skipped.
	for k := range s.cands {
		for _, r := range []*ScanRecheck{s.cands[k].Lattice, s.cands[k].Finer} {
			if r != nil && r.Outcome == "pending" {
				r.Outcome = "skipped"
			}
		}
		s.cands[k].Stability, s.cands[k].Spread = stability(s.cands[k])
	}
	if s.q.Critical && s.stop != "canceled" {
		s.critical()
		// Only once the search has found no critical point beside them.
		s.cands = mergeBoxes(s.cands, (s.q.To-s.q.From)/float64(s.q.Samples-1))
	}
	s.stage = 3
}

// Result is the scan as it stands.
func (s *Scan) Result() ScanResult {
	out := ScanResult{Axis: s.q.Axis, From: s.q.From, To: s.q.To, Samples: []ScanSample{}, Candidates: []ScanCandidate{},
		Calls: s.calls, Cells: s.cells, Stop: s.stop, Curtailed: s.curtailed}
	for _, v := range s.values() {
		r := s.readings[v]
		out.Samples = append(out.Samples, ScanSample{Value: v, Coarse: s.coarse[v], Reading: r})
		if !resolved(r) {
			out.Unresolved++
		}
		if r.Singular > 0 {
			out.Singular++
		}
	}
	for _, c := range s.cands {
		for _, r := range []**ScanRecheck{&c.Lattice, &c.Finer} {
			if *r != nil {
				copy := **r
				*r = &copy
			}
		}
		out.Candidates = append(out.Candidates, c)
	}
	return out
}

// generated is a value the scan computed, cleaned of floating-point tails
// before it is meshed, as roundedGenerated (web/atlas-queue.ts) cleans the
// app's generated defaults: the shortest decimal of at most 15 significant
// digits within rounding of its operands' scale, scale, or the value
// itself when there is none. Fifteen digits, which every double keeps, so
// a value that is itself a meaningful double, as a multiple of π, stays.
func generated(v, scale float64) float64 {
	if !finite(v) || v == 0 {
		return v
	}
	budget := 0x1p-52 * math.Max(math.Abs(v), scale)
	for digits := 1; digits <= 15; digits++ {
		short, err := strconv.ParseFloat(strconv.FormatFloat(v, 'g', digits, 64), 64)
		if err == nil && finite(short) && math.Abs(short-v) <= budget {
			return short
		}
	}
	return v
}

// mergeBoxes joins each run of two or more box candidates that the mesh
// cannot tell apart into one box interval: every one unstable, none with a
// critical point found beside it, and each beginning within a coarse step
// of where the one before ends, with no other candidate between. A face
// whose cut band is thinner than a cell reads a cascade of such changes.
// The interval reads Before at its first end and After at its last, its
// spread is theirs together, and Merged counts the candidates it holds.
func mergeBoxes(cands []ScanCandidate, step float64) []ScanCandidate {
	joins := func(c ScanCandidate) bool {
		return c.Kind == "box" && c.Stability == "unstable" && len(c.Critical) == 0
	}
	out := []ScanCandidate{}
	for k := 0; k < len(cands); {
		j := k + 1
		for joins(cands[k]) && j < len(cands) && joins(cands[j]) && cands[j].Lo-cands[j-1].Hi < step {
			j++
		}
		if j-k < 2 {
			out = append(out, cands[k])
			k = j
			continue
		}
		first, last := cands[k], cands[j-1]
		m := ScanCandidate{Lo: first.Lo, Hi: last.Hi, Before: first.Before, After: last.After, Kind: "box", Depth: first.Depth,
			Singular: []float64{}, Stability: "unstable", Spread: first.Spread, Critical: []ScanCritical{}, Merged: j - k}
		for _, c := range cands[k:j] {
			m.Depth = min(m.Depth, c.Depth)
			m.Singular = append(m.Singular, c.Singular...)
			m.Spread = [2]float64{math.Min(m.Spread[0], c.Spread[0]), math.Max(m.Spread[1], c.Spread[1])}
		}
		out = append(out, m)
		k = j
	}
	return out
}
