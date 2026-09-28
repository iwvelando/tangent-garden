// Package engine3 defines spatial constructions independently of planar geometry.
package engine3

import (
	"fmt"
	"math"
)

type Vec3 struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
}

func (a Vec3) add(b Vec3) Vec3    { return Vec3{a.X + b.X, a.Y + b.Y, a.Z + b.Z} }
func (a Vec3) sub(b Vec3) Vec3    { return a.add(b.mul(-1)) }
func (a Vec3) mul(s float64) Vec3 { return Vec3{a.X * s, a.Y * s, a.Z * s} }
func (a Vec3) dot(b Vec3) float64 { return a.X*b.X + a.Y*b.Y + a.Z*b.Z }
func (a Vec3) cross(b Vec3) Vec3 {
	return Vec3{a.Y*b.Z - a.Z*b.Y, a.Z*b.X - a.X*b.Z, a.X*b.Y - a.Y*b.X}
}
func (a Vec3) norm() float64 { return math.Sqrt(a.dot(a)) }
func (a Vec3) unit() Vec3    { return a.mul(1 / a.norm()) }

// P and Q are coprime integer winding numbers. Length is the half-length
// of each tangent ruling, measured in world units, not parameter units.
//
// Construction is "developable" (or empty) for the tangent developable, or
// "involute" for the filaments described by Involute, or "tangent-foot" /
// "orthotomic" for projections from Pole, or "inversion" for the sphere
// inversion described by Inversion, or "framed" for the ribbon and offset
// strands described by Frame, or "ruled" for the surface joining the curve to
// the partner described by Ruled. Length applies only to the developable.
type Request struct {
	Format       string           `json:"format"`
	Construction string           `json:"construction"`
	Involute     InvoluteRequest  `json:"involute"`
	Pole         Vec3             `json:"pole"`
	Harmonic     HarmonicCurve    `json:"harmonic"`
	Inversion    InversionRequest `json:"inversion"`
	Frame        FrameRequest     `json:"frame"`
	Ruled        RuledRequest     `json:"ruled"`
	Curve        Curve            `json:"curve"`
	Radius       float64          `json:"radius"`
	Tube         float64          `json:"tube"`
	Length       float64          `json:"length"`
	P            int              `json:"p"`
	Q            int              `json:"q"`
	Samples      int              `json:"samples"`
	Lines        int              `json:"lines"`
}
type Vertex struct {
	SampleIndex int     `json:"sampleIndex"`
	Position    Vec3    `json:"position"`
	Normal      Vec3    `json:"normal"`
	Phase       float64 `json:"phase"`
}
type Ruling struct {
	SampleIndex int  `json:"sampleIndex"`
	From        Vec3 `json:"from"`
	To          Vec3 `json:"to"`
}
type Result struct {
	Bounds  Bounds   `json:"bounds"`
	Invalid int      `json:"invalid"`
	Breaks  []bool   `json:"breaks"`
	Base    []*Vec3  `json:"base"`
	Minus   []*Vec3  `json:"minus"`
	Plus    []*Vec3  `json:"plus"`
	Mesh    []Vertex `json:"mesh"`
	Rulings []Ruling `json:"rulings"`
	Radius  float64  `json:"radius"`
	Omitted int      `json:"omitted"`
	// Involute is present only for the involute construction, which leaves
	// the developable's Minus, Plus, Mesh, and Rulings empty.
	Involute   *InvoluteResult   `json:"involute,omitempty"`
	Projection *ProjectionResult `json:"projection,omitempty"`
	Inversion  *InversionResult  `json:"inversion,omitempty"`
	// Frame is present only for the framed construction, whose ribbon uses
	// Mesh, Minus, Plus, and Rulings with the frame's own breaks.
	Frame *FrameResult `json:"frame,omitempty"`
	// Ruled is present only for the ruled construction, whose surface uses
	// Mesh and Rulings, with the partner thread in Plus and Minus empty.
	Ruled *RuledResult `json:"ruled,omitempty"`
	// Harmonic is present only for a harmonic curve, under any construction.
	Harmonic *HarmonicResult `json:"harmonic,omitempty"`
}

// knot gives r, r′, r″ analytically; no numerical derivative or hidden
// planar coordinate is involved. z is the torus's axial coordinate.
func knot(c Request, t float64) (Vec3, Vec3, Vec3) {
	p, q := float64(c.P), float64(c.Q)
	cp, sp, cq, sq := math.Cos(p*t), math.Sin(p*t), math.Cos(q*t), math.Sin(q*t)
	h := c.Radius + c.Tube*cq
	dh, ddh := -c.Tube*q*sq, -c.Tube*q*q*cq
	return Vec3{h * cp, h * sp, c.Tube * sq},
		Vec3{dh*cp - p*h*sp, dh*sp + p*h*cp, c.Tube * q * cq},
		Vec3{(ddh-p*p*h)*cp - 2*p*dh*sp, (ddh-p*p*h)*sp + 2*p*dh*cp, -c.Tube * q * q * sq}
}

// jumps reports a chord from a to b, one parameter step apart, that the
// midpoint velocity cannot account for: an asymptote, not a local segment.
// Comparing displacement with midpoint speed also catches sub-grid poles.
func jumps(a, b, middle Vec3, step float64) bool {
	displacement := b.sub(a)
	chord := displacement.norm()
	return chord > 8*middle.norm()*step+1e-7 || displacement.dot(middle) < -1e-8*chord*middle.norm()
}

func Compute(c Request) (Result, error) {
	if c.Samples < 240 || c.Samples > 2400 || c.Lines < 12 || c.Lines > 240 {
		return Result{}, fmt.Errorf("use 240–2400 samples and 12–240 rulings")
	}
	involute := c.Construction == "involute"
	projection := c.Construction == "tangent-foot" || c.Construction == "orthotomic"
	inversion := c.Construction == "inversion"
	framed := c.Construction == "framed"
	ruled := c.Construction == "ruled"
	developable := c.Construction == "" || c.Construction == "developable"
	if !involute && !projection && !inversion && !framed && !ruled && !developable {
		return Result{}, fmt.Errorf("unknown spatial construction")
	}
	if developable && (!finite(c.Length) || c.Length <= 0 || c.Length > 20) {
		return Result{}, fmt.Errorf("tangent reach must be finite and between 0 (exclusive) and 20")
	}
	if projection && (!c.Pole.valid() || math.Max(math.Abs(c.Pole.X), math.Max(math.Abs(c.Pole.Y), math.Abs(c.Pole.Z))) > 1e5) {
		return Result{}, fmt.Errorf("pole coordinates must be finite and within ±100000")
	}
	if inversion {
		if err := c.Inversion.validate(c.Pole); err != nil {
			return Result{}, err
		}
	}
	if framed {
		if err := c.Frame.validate(); err != nil {
			return Result{}, err
		}
	}
	if ruled {
		if err := c.Ruled.validate(); err != nil {
			return Result{}, err
		}
	}
	evaluate, lo, hi, closed, err := compile(c)
	if err != nil {
		return Result{}, err
	}
	var partner func(float64) (Vec3, Vec3, bool, bool)
	if ruled {
		if partner, err = c.Ruled.partner(evaluate, lo, hi, closed); err != nil {
			return Result{}, err
		}
	}
	n := c.Samples
	out := Result{Base: make([]*Vec3, n+1), Minus: make([]*Vec3, n+1), Plus: make([]*Vec3, n+1), Breaks: make([]bool, n+1), Mesh: make([]Vertex, 0, n*12), Rulings: make([]Ruling, 0, c.Lines)}
	normals, tangents := make([]Vec3, n+1), make([]Vec3, n+1)
	speeds, middles := make([]float64, n+1), make([]float64, n)
	valid := make([]bool, n+1)
	for i := 0; i <= n; i++ {
		t := lo*(1-float64(i)/float64(n)) + hi*float64(i)/float64(n)
		r, v, a, ok := evaluate(t)
		if !ok || !r.valid() || !v.valid() || v.norm() < 1e-9 {
			out.Invalid++
			continue
		}
		tangent := v.unit()
		tangents[i] = tangent
		speeds[i] = v.norm()
		minus, plus := r.sub(tangent.mul(c.Length)), r.add(tangent.mul(c.Length))
		out.Base[i] = &r
		out.Minus[i] = &minus
		out.Plus[i] = &plus
		b := v.cross(a)
		scale := math.Max(a.norm(), v.norm()/(hi-lo))
		if c.Format == "harmonic" {
			scale = c.Harmonic.curvatureScale()
		} else if c.Format != "parametric" {
			scale = float64(c.P*c.P)*(c.Radius+c.Tube) + float64(2*c.P*c.Q+c.Q*c.Q)*c.Tube
		}
		tolerance := 1e-8
		if c.Format == "parametric" {
			tolerance = 1e-6
		} // numerical second derivatives have a finite noise floor
		valid[i] = a.valid() && b.norm() > tolerance*v.norm()*scale
		if valid[i] {
			normals[i] = b.unit()
		}
	}
	if closed {
		out.Base[n] = out.Base[0]
		out.Minus[n] = out.Minus[0]
		out.Plus[n] = out.Plus[0]
		normals[n] = normals[0]
		tangents[n] = tangents[0]
		speeds[n] = speeds[0]
		valid[n] = valid[0]
	}
	for i := 0; i < n; i++ {
		// Check inside every interval as well as at sample points, so a pole or
		// stationary point between samples does not become a connecting face.
		_, middle, _, ok := evaluate(lo + (hi-lo)*(float64(i)+0.5)/float64(n))
		middles[i] = math.NaN()
		if ok && middle.valid() {
			middles[i] = middle.norm()
		}
		disconnected := out.Base[i] == nil || out.Base[i+1] == nil || !ok || !middle.valid() || middle.norm() < 1e-9 || tangents[i].dot(tangents[i+1]) < 0
		if !disconnected && c.Format == "parametric" {
			// A chord through an asymptote is not a local tangent segment.
			disconnected = jumps(*out.Base[i], *out.Base[i+1], middle, (hi-lo)/float64(n))
		}
		out.Breaks[i+1] = disconnected
		if !developable {
			continue
		}
		if disconnected || !valid[i] || !valid[i+1] || normals[i].dot(normals[i+1]) < 0 {
			out.Omitted++
			continue
		}
		for _, side := range []int{-1, 1} {
			edge := out.Plus
			if side < 0 {
				edge = out.Minus
			}
			vertex := func(j int, point *Vec3) Vertex {
				return Vertex{i + 1, *point, normals[j].mul(float64(side)), float64(j) / float64(n)}
			}
			a, b, c, d := vertex(i, out.Base[i]), vertex(i, edge[i]), vertex(i+1, out.Base[i+1]), vertex(i+1, edge[i+1])
			out.Mesh = append(out.Mesh, a, b, c, b, d, c)
		}
	}
	if out.Invalid == n+1 {
		return Result{}, fmt.Errorf("no regular finite samples; check the expressions and domain")
	}
	// A harmonic curve's generating vectors and ellipses frame as their own
	// families under every construction.
	var generating [][]*Vec3
	if c.Format == "harmonic" {
		out.Harmonic, generating = harmonicGeometry(c, lo, hi)
	}
	if framed {
		frames(c, &out, tangents, speeds, middles, normals, valid, closed, lo, hi)
		families := [][]*Vec3{out.Base, out.Minus, out.Plus}
		families = append(families, out.Frame.Strands...)
		out.Bounds = fit(append(families, generating...)...)
		out.Radius = out.Bounds.Radius
		return out, nil
	}
	if ruled {
		if err := ruledSurface(c, &out, partner, tangents, speeds, lo, hi, closed); err != nil {
			return Result{}, err
		}
		out.Bounds = fit(append([][]*Vec3{out.Base, out.Plus}, generating...)...)
		out.Radius = out.Bounds.Radius
		return out, nil
	}
	if projection {
		out.Projection = projections(c, out.Base, tangents)
		out.Minus, out.Plus = []*Vec3{}, []*Vec3{}
		out.Bounds = fit(append([][]*Vec3{out.Base, out.Projection.Points, out.Projection.Feet, {&out.Projection.Pole}}, generating...)...)
		out.Radius = out.Bounds.Radius
		return out, nil
	}
	if inversion {
		q := inversions(c, evaluate, lo, hi, out.Base, tangents, out.Breaks)
		out.Inversion = q
		out.Minus, out.Plus = []*Vec3{}, []*Vec3{}
		// A base source repeats the base, which leaves the fit unchanged.
		out.Bounds = fit(append([][]*Vec3{out.Base, q.Source, q.Points, {&q.Center}}, generating...)...)
		out.Radius = out.Bounds.Radius
		return out, nil
	}
	if involute {
		result, err := involutes(c.Involute, evaluate, lo, hi, out.Base, tangents, speeds, middles, out.Breaks, c.Lines)
		if err != nil {
			return Result{}, err
		}
		out.Involute = result
		out.Minus, out.Plus = []*Vec3{}, []*Vec3{}
		families := [][]*Vec3{out.Base}
		for _, m := range result.Members {
			families = append(families, m.Points)
		}
		out.Bounds = fit(append(families, generating...)...)
		out.Radius = out.Bounds.Radius
		return out, nil
	}
	for i := 0; i < c.Lines; i++ {
		j := i * n / (c.Lines - 1)
		if out.Base[j] != nil {
			out.Rulings = append(out.Rulings, Ruling{j, *out.Minus[j], *out.Plus[j]})
		}
	}
	out.Bounds = fit(append([][]*Vec3{out.Base, out.Minus, out.Plus}, generating...)...)
	out.Radius = out.Bounds.Radius
	return out, nil
}
