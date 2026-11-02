package engine

import (
	"errors"
	"math"
	"math/cmplx"
)

// Moving the lace (docs/mathematics.md, Moving the lace): a disk isometry
// M carries the finite patch without regenerating it. Tile i's
// transformation T_i places its corners, sides and motif as images of the
// seed's, so M∘T_i places the moved tile, and its sides are read off the
// composed reflections exactly as generation reads them.

// LaceSource is a generated patch frozen for moving: its tiles, incidence
// and transformations, and which tile places each vertex and edge. It
// holds one patch, at most LaceMaxTiles tiles, and never changes after
// generation.
type LaceSource struct {
	q        LaceRequest
	seed     laceSeed
	topology LaceResult
	place    []mobius
	// 7·tile + k for the tile that first has a vertex as corner k, or an
	// edge as side k.
	vertexOwner, edgeOwner []int
}

// NewLaceSource validates the request and generates its patch, unmoved;
// the request's isometry is checked but not applied.
func NewLaceSource(q LaceRequest) (*LaceSource, error) {
	if err := q.validate(); err != nil {
		return nil, err
	}
	return generateLace(q, laceLimits{q.Depth, LaceMaxCandidates, lacePolicy}), nil
}

// LaceFrameRequest asks for a frozen patch moved along a motion: the
// isometry LacePathAt gives at Progress from Lace's isometry. Lace's
// generation settings must be the source's.
type LaceFrameRequest struct {
	Lace     LaceRequest `json:"lace"`
	Motion   LaceMotion  `json:"motion"`
	Progress float64     `json:"progress"`
}

// LaceFrame is a moved patch's geometry alone, indexed as the source's
// LaceResult; tiles, incidence and orientation are the source's.
type LaceFrame struct {
	Progress     float64      `json:"progress"`
	Isometry     LaceIsometry `json:"isometry"`
	Center       []Vec        `json:"center"`
	Transform    [][4]float64 `json:"transform"`
	Vertex       []Vec        `json:"vertex"`
	EdgeCenter   []Vec        `json:"edgeCenter"`
	EdgeRadius   []float64    `json:"edgeRadius"`
	EdgeStraight []bool       `json:"edgeStraight"`
	ArcStart     []Vec        `json:"arcStart"`
	ArcEnd       []Vec        `json:"arcEnd"`
	ArcCenter    []Vec        `json:"arcCenter"`
	ArcRadius    []float64    `json:"arcRadius"`
	ArcStraight  []bool       `json:"arcStraight"`
	Coverage     LaceCoverage `json:"coverage"`
}

// LacePathAt is the motion's isometry at progress p in [0, 1]:
// a(p) = r(p)·e^{iφ(p)} with r(p) = (1 − s)·r₀ + s·r₁, s = (1 − cos 2πp)/2,
// φ(p) = φ₀ + 2π·orbits·p and θ(p) = θ₀ + 2π·turns·p, from the static
// isometry (r₀, φ₀, θ₀) and the motion's farthest offset r₁. The offset
// swells from r₀ to r₁ halfway and returns, resting at both, so |a| never
// exceeds the larger. Angles are returned within half a turn of their
// start, φ₀ + 2π·rem(orbits·p) with rem(x) = x − round(x), so that p = 0
// and p = 1 give the start exactly, and p = ½ gives r₁ exactly.
func LacePathAt(start LaceIsometry, m LaceMotion, p float64) LaceIsometry {
	s := (1 - math.Cos(2*math.Pi*rem(p))) / 2
	return LaceIsometry{
		Offset:    (1-s)*start.Offset + s*m.Offset,
		Direction: start.Direction + 2*math.Pi*rem(float64(m.Orbits)*p),
		Rotation:  start.Rotation + 2*math.Pi*rem(float64(m.Turns)*p),
	}
}

func rem(x float64) float64 { return x - math.Round(x) }

// isometry is T(z) = e^{iθ}(z − a)/(1 − āz) normalized: with
// n = 1/√(1 − |a|²), its matrix is [[e^{iθ/2}n, −a·e^{iθ/2}n],
// [−ā·e^{−iθ/2}n, e^{−iθ/2}n]], so |A|² − |B|² = 1.
func isometry(iso LaceIsometry) mobius {
	a := cmplx.Rect(iso.Offset, iso.Direction)
	n := complex(1/math.Sqrt((1-iso.Offset)*(1+iso.Offset)), 0)
	half := cmplx.Rect(1, iso.Rotation/2) * n
	return mobius{a: half, b: -a * half}
}

// Frame moves the frozen patch along the request's motion.
func (s *LaceSource) Frame(f LaceFrameRequest) (LaceFrame, error) {
	if err := f.Lace.validate(); err != nil {
		return LaceFrame{}, err
	}
	q := f.Lace
	q.Isometry = nil
	if q != s.q {
		return LaceFrame{}, errors.New("the frame's lace settings are not the frozen patch's")
	}
	if err := f.Motion.validate(); err != nil {
		return LaceFrame{}, err
	}
	if !finite(f.Progress) || f.Progress < 0 || f.Progress > 1 {
		return LaceFrame{}, fieldErr("progress", "progress must be 0–1")
	}
	var start LaceIsometry
	if f.Lace.Isometry != nil {
		start = *f.Lace.Isometry
	}
	iso := LacePathAt(start, f.Motion, f.Progress)
	g, err := s.geometry(iso)
	if err != nil {
		return LaceFrame{}, err
	}
	return LaceFrame{
		Progress: f.Progress, Isometry: iso,
		Center: g.Center, Transform: g.Transform, Vertex: g.Vertex,
		EdgeCenter: g.EdgeCenter, EdgeRadius: g.EdgeRadius, EdgeStraight: g.EdgeStraight,
		ArcStart: g.ArcStart, ArcEnd: g.ArcEnd, ArcCenter: g.ArcCenter, ArcRadius: g.ArcRadius,
		ArcStraight: g.ArcStraight, Coverage: g.Coverage,
	}, nil
}

// result is the whole patch under an isometry, its topology copied so
// that the caller owns every array.
func (s *LaceSource) result(iso LaceIsometry) (LaceResult, error) {
	g, err := s.geometry(iso)
	if err != nil {
		return LaceResult{}, err
	}
	t := s.topology
	r := t
	r.Depth = append([]float64(nil), t.Depth...)
	r.Parent = append([]float64(nil), t.Parent...)
	r.Via = append([]float64(nil), t.Via...)
	r.Reversed = append([]bool(nil), t.Reversed...)
	r.Corners = append([]float64(nil), t.Corners...)
	r.Sides = append([]float64(nil), t.Sides...)
	r.VertexTiles = append([]float64(nil), t.VertexTiles...)
	r.EdgeA = append([]float64(nil), t.EdgeA...)
	r.EdgeB = append([]float64(nil), t.EdgeB...)
	r.EdgeTiles = append([]float64(nil), t.EdgeTiles...)
	r.Center, r.Transform, r.Vertex = g.Center, g.Transform, g.Vertex
	r.EdgeCenter, r.EdgeRadius, r.EdgeStraight = g.EdgeCenter, g.EdgeRadius, g.EdgeStraight
	r.ArcStart, r.ArcEnd, r.ArcCenter, r.ArcRadius, r.ArcStraight = g.ArcStart, g.ArcEnd, g.ArcCenter, g.ArcRadius, g.ArcStraight
	r.Isometry, r.Coverage = iso, g.Coverage
	return r, nil
}

// geometry places every tile by M∘T_i, M the isometry: centers M∘T_i(0),
// each vertex and edge by the tile that first has it, and each tile's
// motif, through the same formulas generation uses. An isometry with no
// offset and no rotation is the identity, and T_i is used as it is, so
// the unmoved patch is reproduced exactly. Every vertex must stay
// resolved under the precision floor; within the supported limits the
// moved gap 1 − |M z|² ≥ (1 − |z|²)(1 − |a|)/(1 + |a|) stays far above it.
func (s *LaceSource) geometry(iso LaceIsometry) (LaceResult, error) {
	t := &s.topology
	n, nv, ne := len(s.place), len(s.vertexOwner), len(s.edgeOwner)
	g := make([]mobius, n)
	if iso.Offset == 0 && iso.Rotation == 0 {
		copy(g, s.place)
	} else {
		m := isometry(iso)
		for i, p := range s.place {
			g[i] = m.then(p)
		}
	}
	r := LaceResult{
		Center:       make([]Vec, n),
		Transform:    make([][4]float64, n),
		Vertex:       make([]Vec, nv),
		EdgeCenter:   make([]Vec, ne),
		EdgeRadius:   make([]float64, ne),
		EdgeStraight: make([]bool, ne),
		ArcStart:     make([]Vec, 0, n*LaceStrokes),
		ArcEnd:       make([]Vec, 0, n*LaceStrokes),
		ArcCenter:    make([]Vec, 0, n*LaceStrokes),
		ArcRadius:    make([]float64, 0, n*LaceStrokes),
		ArcStraight:  make([]bool, 0, n*LaceStrokes),
	}
	seed := &s.seed
	vertices := make([]complex128, nv)
	for v, o := range s.vertexOwner {
		z := g[o/7].apply(seed.vertex[o%7])
		if rimGap(z) < lacePolicy.floor {
			return LaceResult{}, errors.New("the moved patch comes too near the rim to place reliably")
		}
		vertices[v] = z
		r.Vertex[v] = Vec{real(z), imag(z)}
	}
	for e, o := range s.edgeOwner {
		i, k := o/7, o%7
		a, b := int(t.Corners[7*i+k]), int(t.Corners[7*i+(k+1)%7])
		c, radius, straight := line(g[i], seed.reflect[k], vertices[a], vertices[b])
		r.EdgeCenter[e] = Vec{real(c), imag(c)}
		r.EdgeRadius[e] = radius
		r.EdgeStraight[e] = straight
	}
	for i, p := range g {
		c := p.apply(0)
		r.Center[i] = Vec{real(c), imag(c)}
		r.Transform[i] = [4]float64{real(p.a), imag(p.a), real(p.b), imag(p.b)}
		for k := range 7 {
			m, st, next := p.apply(seed.mid[k]), p.apply(seed.star[k]), p.apply(seed.mid[(k+1)%7])
			for half, ends := range [2][2]complex128{{m, st}, {st, next}} {
				c, radius, straight := line(p, seed.strokes[2*k+half], ends[0], ends[1])
				r.ArcStart = append(r.ArcStart, Vec{real(ends[0]), imag(ends[0])})
				r.ArcEnd = append(r.ArcEnd, Vec{real(ends[1]), imag(ends[1])})
				r.ArcCenter = append(r.ArcCenter, Vec{real(c), imag(c)})
				r.ArcRadius = append(r.ArcRadius, radius)
				r.ArcStraight = append(r.ArcStraight, straight)
			}
		}
	}
	r.Coverage = s.coverage(&r, vertices)
	return r, nil
}

// coverage is the largest disk about the center inside the moved patch.
// The center lies in a tile when it is on the tile's side of each of its
// seven geodesics: outside every geodesic circle (|c|² = 1 + ρ² > ρ²), so
// the tile's center must be too, and on any diameter. If it lies in the
// patch, nothing nearer than the patch's boundary, its edges with one
// tile, is missing, so the radius is the nearest point of those edges. A
// geodesic circle's nearest point to the center, at distance
// |c| − ρ = 1/(|c| + ρ), lies on the edge exactly when the edge's ends
// subtend an obtuse angle there; otherwise an end is nearest.
func (s *LaceSource) coverage(r *LaceResult, vertices []complex128) LaceCoverage {
	t := &s.topology
	inside := false
	for i := range r.Center {
		center := complex(r.Center[i].X, r.Center[i].Y)
		ok := true
		for k := range 7 {
			e := int(t.Sides[7*i+k])
			if r.EdgeStraight[e] {
				continue
			}
			c := complex(r.EdgeCenter[e].X, r.EdgeCenter[e].Y)
			if cmplx.Abs(center-c) < r.EdgeRadius[e] {
				ok = false
				break
			}
		}
		if ok {
			inside = true
			break
		}
	}
	if !inside {
		return LaceCoverage{}
	}
	radius := 1.0
	for e := range r.EdgeCenter {
		if t.EdgeTiles[e] != 1 {
			continue
		}
		u, w := vertices[int(t.EdgeA[e])], vertices[int(t.EdgeB[e])]
		d := math.Min(cmplx.Abs(u), cmplx.Abs(w))
		if r.EdgeStraight[e] {
			if real(u)*real(w)+imag(u)*imag(w) <= 0 {
				d = 0
			}
		} else {
			c := complex(r.EdgeCenter[e].X, r.EdgeCenter[e].Y)
			rho := r.EdgeRadius[e]
			q := c * complex(1-rho/cmplx.Abs(c), 0)
			if real(u-q)*real(w-q)+imag(u-q)*imag(w-q) <= 0 {
				d = 1 / (cmplx.Abs(c) + rho)
			}
		}
		radius = math.Min(radius, d)
	}
	return LaceCoverage{Radius: radius, Distance: 2 * math.Atanh(radius)}
}
