package engine3

import "math"

// FrameRequest chooses a frame (T, U, V) along the curve and the framed
// geometry built from it. Kind is "rotation-minimizing" (parallel transport,
// the default for drawing) or "frenet" (U = principal normal, V = binormal, a
// diagnostic that is undefined where curvature vanishes). Reference is N₀:
// projected onto the normal plane where each unbroken stretch begins, it sets
// the transported U there. The offset direction is D = cos θ U + sin θ V with
// θ(s) = Angle + 2π Twist s/L, s the arc length and L its total, so Twist
// counts whole turns over the drawn curve. The ribbon is r + uD for
// |u| ≤ Width; Strands offset curves r + Offset·D turn by 2πk/Strands.
// A Frenet frame uses neither Reference, which is then not validated, nor
// Closure: it is periodic on a closed loop by construction.
// Closure decides a closed loop's seam: "seam" shows where the transported
// frame returns rotated; "distribute" turns it back by −α s/L along the loop.
type FrameRequest struct {
	Kind      string  `json:"kind"`
	Reference Vec3    `json:"reference"`
	Angle     float64 `json:"angle"`
	Twist     float64 `json:"twist"`
	Offset    float64 `json:"offset"`
	Width     float64 `json:"width"`
	Strands   int     `json:"strands"`
	Closure   string  `json:"closure"`
}

// FrameGlyph is the frame at a representative sample: Normal is U and
// Binormal is V, whichever frame is chosen, with V = T × U.
type FrameGlyph struct {
	SampleIndex int  `json:"sampleIndex"`
	Point       Vec3 `json:"point"`
	Tangent     Vec3 `json:"tangent"`
	Normal      Vec3 `json:"normal"`
	Binormal    Vec3 `json:"binormal"`
}

// FrameSeam marks where a closed loop's offset direction fails to return:
// Start is D at the first sample, End is D carried around to the last (the
// same point), and Angle is the signed turn from Start to End about T.
type FrameSeam struct {
	Point Vec3    `json:"point"`
	Start Vec3    `json:"start"`
	End   Vec3    `json:"end"`
	Angle float64 `json:"angle"`
}

// FrameResult shares the base's parameter indices. Breaks adds the Frenet
// normal's reversals (Flips) to the base's breaks; Undefined counts samples
// where the Frenet frame has no normal. Pieces counts the unbroken stretches,
// each started from N₀, and Fallbacks the stretches where N₀ was tangent and
// the coordinate axis least aligned with T was used instead. Closed is set
// for an unbroken closed loop; Holonomy is then the transported U's signed
// return angle about T (rotation-minimizing only) and Correction the twist
// distributed along the loop to cancel it. Length is L.
type FrameResult struct {
	Kind       string       `json:"kind"`
	Frames     []FrameGlyph `json:"frames"`
	Strands    [][]*Vec3    `json:"strands"`
	Breaks     []bool       `json:"breaks"`
	Length     float64      `json:"length"`
	Pieces     int          `json:"pieces"`
	Undefined  int          `json:"undefined"`
	Flips      int          `json:"flips"`
	Fallbacks  int          `json:"fallbacks"`
	Closed     bool         `json:"closed"`
	Holonomy   float64      `json:"holonomy"`
	Correction float64      `json:"correction"`
	Seam       *FrameSeam   `json:"seam,omitempty"`
}

const maxFrameStrands = 12

func (f FrameRequest) validate() error {
	bounded := func(v Vec3) bool {
		return v.valid() && math.Max(math.Abs(v.X), math.Max(math.Abs(v.Y), math.Abs(v.Z))) <= 1e5
	}
	switch {
	case f.Kind != "rotation-minimizing" && f.Kind != "frenet":
		return fieldErr("frame.kind", "choose a rotation-minimizing or Frenet frame")
	case f.Kind == "rotation-minimizing" && (!bounded(f.Reference) || f.Reference.norm() == 0):
		return fieldErr(axis("frame.reference", f.Reference, scalarBounded), "the reference normal N₀ must be nonzero, finite, and within ±100000")
	case !finite(f.Angle) || math.Abs(f.Angle) > 1000:
		return fieldErr("frame.angle", "the angle θ₀ must be finite and within ±1000 radians")
	case !finite(f.Twist) || math.Abs(f.Twist) > 100:
		return fieldErr("frame.twist", "twist must be finite and within ±100 turns")
	case !finite(f.Offset) || f.Offset < 0 || f.Offset > 1e5:
		return fieldErr("frame.offset", "the offset distance d must be finite, from 0 to 100000")
	case !finite(f.Width) || f.Width < 0 || f.Width > 1e5:
		return fieldErr("frame.width", "the ribbon half-width w must be finite, from 0 to 100000")
	case f.Strands < 0 || f.Strands > maxFrameStrands:
		return fieldErr("frame.strands", "use 0–12 offset strands")
	case f.Closure != "seam" && f.Closure != "distribute":
		return fieldErr("frame.closure", "closure must show the seam or distribute the correction")
	}
	return nil
}

// transport carries u from (x0, t0) to (x1, t1) by the double reflection
// method of Wang, Jüttler, Zheng and Liu (2008): reflect in the plane
// bisecting the chord, then in the one taking the reflected tangent to t1.
// Each reflection preserves angles, so the frame stays orthonormal and a
// rotated start stays rotated by the same angle.
func transport(u, x0, t0, x1, t1 Vec3) Vec3 {
	reflect := func(v, n Vec3, c float64) Vec3 { return v.sub(n.mul(2 * n.dot(v) / c)) }
	if v := x1.sub(x0); v.dot(v) > 0 {
		u, t0 = reflect(u, v, v.dot(v)), reflect(t0, v, v.dot(v))
	}
	if v := t1.sub(t0); v.dot(v) > 1e-24 {
		u = reflect(u, v, v.dot(v))
	}
	return u.sub(t1.mul(u.dot(t1))).unit()
}

// start projects the reference onto the normal plane of t, or reports that
// it is (nearly) tangent and uses the least aligned coordinate axis.
func start(reference, t Vec3) (Vec3, bool) {
	u := reference.sub(t.mul(reference.dot(t)))
	if u.norm() > 1e-6*reference.norm() {
		return u.unit(), false
	}
	axis := Vec3{1, 0, 0}
	if math.Abs(t.Y) < math.Abs(t.X) && math.Abs(t.Y) <= math.Abs(t.Z) {
		axis = Vec3{0, 1, 0}
	} else if math.Abs(t.Z) < math.Abs(t.X) && math.Abs(t.Z) < math.Abs(t.Y) {
		axis = Vec3{0, 0, 1}
	}
	return axis.sub(t.mul(axis.dot(t))).unit(), true
}

// carried is the frame field frames builds: U and V where ok, the arc length
// at every sample, and the offset direction D turned by an extra angle.
// Spin is the rate in arc length at which D turns about T within a
// rotation-minimizing frame, (2π·Twist + Correction)/L; a Frenet frame's D
// turns at τ + 2π·Twist/L, so its Spin leaves out τ.
type carried struct {
	us, vs    []Vec3
	ok        []bool
	arc       []float64
	direction func(i int, turn float64) Vec3
	spin      float64
	closed    bool
}

// frames builds the frame at every sample, then the ribbon (in the result's
// mesh, edges and cross-lines, as for the developable) and offset strands.
// Arc length uses Simpson's rule per interval and is not carried across a
// break; the frame restarts from N₀ after one.
func frames(c Request, out *Result, tangents []Vec3, speeds, middles []float64, binormals []Vec3, defined []bool, closed bool, lo, hi float64) carried {
	f := c.Frame
	base := out.Base
	n := len(base) - 1
	h := (hi - lo) / float64(n)
	q := &FrameResult{Kind: f.Kind, Breaks: append([]bool(nil), out.Breaks...), Frames: make([]FrameGlyph, 0, c.Lines)}
	arc := make([]float64, n+1)
	for i := 0; i < n; i++ {
		arc[i+1] = arc[i]
		if base[i] != nil && base[i+1] != nil && !out.Breaks[i+1] && finite(middles[i]) {
			arc[i+1] += h / 6 * (speeds[i] + 4*middles[i] + speeds[i+1])
		}
	}
	q.Length = arc[n]
	us, vs := make([]Vec3, n+1), make([]Vec3, n+1)
	ok := make([]bool, n+1)
	frenet := f.Kind == "frenet"
	for i := 0; i <= n; i++ {
		if base[i] == nil {
			continue
		}
		t := tangents[i]
		switch {
		case frenet:
			// A closed curve's last sample repeats the first.
			if !defined[i] {
				if !closed || i < n {
					q.Undefined++
				}
				continue
			}
			vs[i] = binormals[i]
			us[i] = vs[i].cross(t)
		case i == 0 || base[i-1] == nil || out.Breaks[i]:
			var fallback bool
			us[i], fallback = start(f.Reference, t)
			if fallback {
				q.Fallbacks++
			}
		default:
			us[i] = transport(us[i-1], *base[i-1], tangents[i-1], *base[i], t)
		}
		if !frenet {
			vs[i] = t.cross(us[i])
		}
		ok[i] = true
	}
	for i := 0; i < n; i++ {
		if frenet && ok[i] && ok[i+1] && !q.Breaks[i+1] && binormals[i].dot(binormals[i+1]) < 0 {
			q.Breaks[i+1] = true
			q.Flips++
		}
	}
	for i := 0; i <= n; i++ {
		if ok[i] && (i == 0 || !ok[i-1] || q.Breaks[i]) {
			q.Pieces++
		}
	}
	q.Closed = closed && q.Pieces == 1 && ok[0] && ok[n]
	if q.Closed && !frenet {
		q.Holonomy = math.Atan2(us[0].cross(us[n]).dot(tangents[0]), us[0].dot(us[n]))
		if f.Closure == "distribute" {
			q.Correction = -q.Holonomy
		}
	}
	// The distributed correction turns the frame itself about T, and θ turns
	// D within it, both in proportion to arc length.
	if q.Correction != 0 {
		for i := range us {
			if ok[i] {
				psi := q.Correction * arc[i] / q.Length
				us[i], vs[i] = us[i].mul(math.Cos(psi)).add(vs[i].mul(math.Sin(psi))), vs[i].mul(math.Cos(psi)).sub(us[i].mul(math.Sin(psi)))
			}
		}
	}
	direction := func(i int, turn float64) Vec3 {
		theta := f.Angle + turn
		if q.Length > 0 {
			theta += 2 * math.Pi * f.Twist * arc[i] / q.Length
		}
		return us[i].mul(math.Cos(theta)).add(vs[i].mul(math.Sin(theta)))
	}
	q.Strands = make([][]*Vec3, f.Strands)
	for k := range q.Strands {
		q.Strands[k] = make([]*Vec3, n+1)
		for i := range base {
			if ok[i] {
				p := base[i].add(direction(i, 2*math.Pi*float64(k)/float64(f.Strands)).mul(f.Offset))
				q.Strands[k][i] = &p
			}
		}
	}
	if q.Closed {
		d0, dn := direction(0, 0), direction(n, 0)
		if angle := math.Atan2(d0.cross(dn).dot(tangents[0]), d0.dot(dn)); math.Abs(angle) > 1e-9 {
			q.Seam = &FrameSeam{Point: *base[0], Start: d0, End: dn, Angle: angle}
		}
	}
	for line := 0; line < c.Lines; line++ {
		i := line * n / (c.Lines - 1)
		if ok[i] {
			q.Frames = append(q.Frames, FrameGlyph{i, *base[i], tangents[i], us[i], vs[i]})
		}
	}
	out.Minus, out.Plus = []*Vec3{}, []*Vec3{}
	if f.Width > 0 {
		out.Minus, out.Plus = make([]*Vec3, n+1), make([]*Vec3, n+1)
		for i := range base {
			if ok[i] {
				d := direction(i, 0).mul(f.Width)
				minus, plus := base[i].sub(d), base[i].add(d)
				out.Minus[i], out.Plus[i] = &minus, &plus
			}
		}
		for i := 0; i < n; i++ {
			if !ok[i] || !ok[i+1] || q.Breaks[i+1] {
				out.Omitted++
				continue
			}
			vertex := func(j int, p *Vec3, normal Vec3) Vertex { return Vertex{i + 1, *p, normal, float64(j) / float64(n)} }
			for _, triangle := range [][3]int{{0, 1, 2}, {1, 3, 2}} {
				corners := [4]*Vec3{out.Minus[i], out.Plus[i], out.Minus[i+1], out.Plus[i+1]}
				a, b, d := corners[triangle[0]], corners[triangle[1]], corners[triangle[2]]
				normal := b.sub(*a).cross(d.sub(*a))
				if !(normal.norm() > 0) {
					continue
				}
				normal = normal.unit()
				out.Mesh = append(out.Mesh, vertex(i+triangle[0]/2, a, normal), vertex(i+triangle[1]/2, b, normal), vertex(i+triangle[2]/2, d, normal))
			}
		}
		for line := 0; line < c.Lines; line++ {
			i := line * n / (c.Lines - 1)
			if ok[i] {
				out.Rulings = append(out.Rulings, Ruling{i, *out.Minus[i], *out.Plus[i]})
			}
		}
	}
	out.Frame = q
	spin := 0.0
	if q.Length > 0 {
		spin = (2*math.Pi*f.Twist + q.Correction) / q.Length
	}
	// The ribbon closes where the frame returns to itself.
	return carried{us, vs, ok, arc, direction, spin, q.Closed && q.Seam == nil}
}
