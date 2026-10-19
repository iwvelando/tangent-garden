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
// the partner described by Ruled, or "canal" for the envelope of spheres
// described by Canal, whose angle is carried by Frame, or "none" for the
// curve alone. The constructions built on a curve act on the curve Input
// names (see composed): the base, its tangent-foot curve or orthotomic from
// Pole, its involute described by Unwinding, or its coil described
// by Coil. Length applies only to the
// developable. Format "field" makes
// the base the first trajectory of the vector field described by Field, and
// "pursuit" the first pursuer's path in the chase described by Pursuit.
// Format "surface" is not a curve: it studies the patch described by
// Surface, and every other field is ignored. Format "rays" lights that
// patch, as a mirror, with the light described by Rays; the surface study's
// offset and normal reach are ignored too. Format "implicit" is the level
// set described by Implicit, and every other field is ignored.
type Request struct {
	Format       string           `json:"format"`
	Construction string           `json:"construction"`
	Input        string           `json:"input"`
	Involute     InvoluteRequest  `json:"involute"`
	Unwinding    UnwindingRequest `json:"unwinding"`
	Coil         CoilRequest      `json:"coil"`
	Pole         Vec3             `json:"pole"`
	Harmonic     HarmonicCurve    `json:"harmonic"`
	Inversion    InversionRequest `json:"inversion"`
	Frame        FrameRequest     `json:"frame"`
	Ruled        RuledRequest     `json:"ruled"`
	Canal        CanalRequest     `json:"canal"`
	Field        FieldRequest     `json:"field"`
	Pursuit      PursuitRequest   `json:"pursuit"`
	Surface      SurfaceRequest   `json:"surface"`
	Rays         RaysRequest      `json:"rays"`
	Implicit     ImplicitRequest  `json:"implicit"`
	Curve        Curve            `json:"curve"`
	Radius       float64          `json:"radius"`
	Tube         float64          `json:"tube"`
	Length       float64          `json:"length"`
	P            int              `json:"p"`
	Q            int              `json:"q"`
	Samples      int              `json:"samples"`
	Lines        int              `json:"lines"`
	// Diagnostics asks for the base curve's curvature, torsion, and Frenet
	// frame at every sample. Surface, ray, and implicit studies ignore it.
	Diagnostics bool `json:"diagnostics"`
	// SurfaceDiagnostics asks for the principal curvatures, directions and
	// focal points of a surface patch, or of the canal, tangent developable,
	// ruled surface or framed ribbon (with a width) built on a curve; other
	// studies ignore it.
	SurfaceDiagnostics bool `json:"surfaceDiagnostics"`
	// LightDiagnostics asks a ray study for its outgoing wavefront's
	// principal curvatures, directions and foci at every sample, in place
	// of the surface's (see lightProbe); other studies ignore it.
	LightDiagnostics bool `json:"lightDiagnostics"`
	// OffsetDiagnostics asks a surface study with an offset for the
	// offset's principal curvatures, directions and centers at every
	// sample, in place of the patch's (see offsetProbe); other studies
	// ignore it.
	OffsetDiagnostics bool `json:"offsetDiagnostics"`
	// FocalDiagnostics, 1 or 2, asks a surface study for that focal
	// sheet's principal curvatures, directions and centers at every
	// sample, in place of the patch's (see focalProbe); 0 asks for none,
	// and other studies ignore it.
	FocalDiagnostics int `json:"focalDiagnostics"`
	// Adaptive refines the drawn curves between their uniform samples (see
	// refinePath); surface, ray, and implicit studies ignore it.
	Adaptive bool `json:"adaptive"`
	// AdaptiveSurface, with Adaptive, also adds columns to the surface a
	// curve construction draws where refinement adds points to the curves
	// on it (see surfaceColumns); without Adaptive it changes nothing.
	AdaptiveSurface bool `json:"adaptiveSurface"`
	// AdaptiveFrame, with Adaptive, gives each refined curve its reach
	// (see RefinedPath), which the bounds take in; without Adaptive it
	// changes nothing.
	AdaptiveFrame bool `json:"adaptiveFrame,omitempty"`
	// View is what the drawing shows, when it is zoomed in and refined to
	// it (see View); it changes nothing but the refined curves.
	View *View `json:"view,omitempty"`
	// Views are the frames of a piece of a camera flight, in place of
	// View: each refined curve is refined, where it meets any of them, as
	// finely as the finest it meets asks (see viewsFocus).
	Views []View `json:"views,omitempty"`
	// Probe asks for the curve the construction acts on described at one
	// parameter, at or between samples (see ProbePoint), for a torus knot,
	// harmonic or custom curve. It asks for the diagnostics too, and changes
	// nothing else in the result.
	Probe *ProbeQuery `json:"probe,omitempty"`
	// SurfaceProbe asks a surface study for its probe at one point, at or
	// between grid samples (see pointProbe): the patch's, or its offset's or
	// focal sheet's when their diagnostics are asked for, which it asks for
	// too. It changes nothing else in the result.
	SurfaceProbe *SurfaceQuery `json:"surfaceProbe,omitempty"`
	// units are the base curve's units (see units), which compute sets
	// from its size.
	units units
}
type Ruling struct {
	SampleIndex int  `json:"sampleIndex"`
	From        Vec3 `json:"from"`
	To          Vec3 `json:"to"`
}
type Result struct {
	Bounds  Bounds    `json:"bounds"`
	Invalid int       `json:"invalid"`
	Breaks  []bool    `json:"breaks"`
	Base    []*Vec3   `json:"base"`
	Minus   []*Vec3   `json:"minus"`
	Plus    []*Vec3   `json:"plus"`
	Mesh    CurveMesh `json:"mesh"`
	Rulings []Ruling  `json:"rulings"`
	Radius  float64   `json:"radius"`
	Omitted int       `json:"omitted"`
	// Involute is present only for the involute construction, which leaves
	// the developable's Minus, Plus, Mesh, and Rulings empty.
	Involute   *InvoluteResult   `json:"involute,omitempty"`
	Projection *ProjectionResult `json:"projection,omitempty"`
	Inversion  *InversionResult  `json:"inversion,omitempty"`
	// Composition is present only when a construction acts on a derived
	// input curve, which then fills Base.
	Composition *CompositionResult `json:"composition,omitempty"`
	// Frame is present only for the framed construction, whose ribbon uses
	// Mesh, Minus, Plus, and Rulings with the frame's own breaks.
	Frame *FrameResult `json:"frame,omitempty"`
	// Ruled is present only for the ruled construction, whose surface uses
	// Mesh and Rulings, with the partner thread in Plus and Minus empty.
	Ruled *RuledResult `json:"ruled,omitempty"`
	// Canal is present only for the canal construction, whose surface uses
	// Mesh, with Frame describing the frame that carries its angle; Minus,
	// Plus and Rulings are empty.
	Canal *CanalResult `json:"canal,omitempty"`
	// Harmonic is present only for a harmonic curve, under any construction.
	Harmonic *HarmonicResult `json:"harmonic,omitempty"`
	// Field is present only for a vector field, under any construction.
	Field *FieldResult `json:"field,omitempty"`
	// Pursuit is present only for a spatial pursuit, under any construction.
	Pursuit *PursuitResult `json:"pursuit,omitempty"`
	// Surface is present only for a surface study, which leaves every
	// curve field empty.
	Surface *SurfaceResult `json:"surface,omitempty"`
	// Rays is present only for a ray study, which leaves every curve field
	// empty.
	Rays *RaysResult `json:"rays,omitempty"`
	// Implicit is present only for an implicit surface, which leaves every
	// curve field empty.
	Implicit *ImplicitResult `json:"implicit,omitempty"`
	// Diagnostics is present only when requested, for a curve.
	Diagnostics *DiagnosticsResult `json:"diagnostics,omitempty"`
	// Probe is present only when requested, for a surface patch, canal,
	// developable, ruled surface or framed ribbon with a width.
	Probe *SurfaceDiagnostics `json:"surfaceDiagnostics,omitempty"`
	// Adaptive is present only when refinement was requested, for a curve
	// it can refine.
	Adaptive *AdaptiveResult `json:"adaptive,omitempty"`
	// CurveProbe is present only when requested, for a curve.
	CurveProbe *ProbePoint `json:"probe,omitempty"`
	// SurfaceProbe is present only when requested, for a surface patch or a
	// surface built on a curve evaluated at any parameter: one row and one
	// column at the asked (u, v) or (t, v).
	SurfaceProbe *SurfaceDiagnostics `json:"surfaceProbe,omitempty"`
	// surfaceScale is a surface study's size, which sets its probe's
	// tolerances.
	surfaceScale float64
	// surfaceAt describes a surface built on a curve at one point, for its
	// probe between samples (see curvePoint); it is set with the surface's
	// probe, and asked for only where the curve is evaluated at any
	// parameter (see pointedAnywhere).
	surfaceAt func(SurfaceQuery) (*SurfaceDiagnostics, error)
	// probing places the curve probe over the computed study.
	probing *probing
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
// A chord shorter than 10⁻⁷ of the curve's size is rounding, whatever the
// speed.
func jumps(a, b, middle Vec3, step, size float64) bool {
	displacement := b.sub(a)
	chord := displacement.norm()
	return chord > 8*middle.norm()*step+1e-7*size || displacement.dot(middle) < -1e-8*chord*middle.norm()
}

func Compute(c Request) (Result, error) {
	if c.Probe != nil {
		if !c.probedAnywhere() {
			return Result{}, errProbe
		}
		c.Diagnostics = true
	}
	if c.SurfaceProbe != nil {
		if !c.pointedAnywhere() {
			return Result{}, errSurfacePoint
		}
		c.surfaceTarget()
	}
	out, err := compute(c)
	if err == nil && out.Diagnostics != nil {
		out.Diagnostics.clip(out.Bounds.Radius)
	}
	if err == nil && c.Probe != nil {
		out.CurveProbe = out.probing.probe(*c.Probe, out.Diagnostics, out.Bounds.Radius)
	}
	if err == nil && c.SurfaceProbe != nil {
		if out.SurfaceProbe, err = out.surfacePoint(c, *c.SurfaceProbe); err != nil {
			return Result{}, err
		}
	}
	// A patch, its offset, its focal sheets and a wavefront place their own
	// focal points: the patch and its offset as its focal sheets, a focal
	// sheet against the patch's size, the wavefront as its caustics.
	switch {
	case err != nil || out.Probe == nil:
	case out.Probe.Kind == "patch", out.Probe.Kind == "offset", out.Probe.Kind == "focal", out.Probe.Kind == "wavefront":
	default:
		out.Probe.clip(out.Bounds.Radius)
	}
	return out, err
}

// binormal is the unit binormal of a curve with velocity v and acceleration
// a, defined only where r′ × r″ clears a noise floor scaled by the curve's
// size: where it does not, the curvature vanishes and the developable,
// the Frenet frame and the probe have no normal.
func (c Request) binormal(v, a Vec3, lo, hi float64) (Vec3, bool) {
	b := v.cross(a)
	scale := math.Max(a.norm(), v.norm()/(hi-lo))
	tolerance := 1e-6 // numerical second derivatives have a finite noise floor
	switch c.analytic() {
	case "harmonic":
		scale, tolerance = c.Harmonic.curvatureScale(), 1e-8
	case "torus":
		scale, tolerance = float64(c.P*c.P)*(c.Radius+c.Tube)+float64(2*c.P*c.Q+c.Q*c.Q)*c.Tube, 1e-8
	}
	if a.valid() && b.norm() > tolerance*v.norm()*scale {
		return b.unit(), true
	}
	return Vec3{}, false
}

func compute(c Request) (Result, error) {
	if c.Format == "surface" {
		return surfaces(c.Surface, c.SurfaceDiagnostics, c.OffsetDiagnostics, c.FocalDiagnostics)
	}
	if c.Format == "rays" {
		return rays(c.Surface, c.Rays, c.SurfaceDiagnostics, c.LightDiagnostics)
	}
	if c.Format == "implicit" {
		return implicit(c.Implicit)
	}
	if err := c.validateViews(); err != nil {
		return Result{}, err
	}
	if c.Samples < 240 || c.Samples > 2400 {
		return Result{}, fieldErr("samples", "use 240–2400 samples and 12–240 rulings")
	}
	if c.Lines < 12 || c.Lines > 240 {
		return Result{}, fieldErr("lines", "use 240–2400 samples and 12–240 rulings")
	}
	involute := c.Construction == "involute"
	projection := c.Construction == "tangent-foot" || c.Construction == "orthotomic"
	inversion := c.Construction == "inversion"
	framed := c.Construction == "framed"
	ruled := c.Construction == "ruled"
	canal := c.Construction == "canal"
	developable := c.Construction == "" || c.Construction == "developable"
	none := c.Construction == "none"
	if !involute && !projection && !inversion && !framed && !ruled && !canal && !developable && !none {
		return Result{}, fieldErr("construction", "unknown spatial construction")
	}
	if err := c.validateInput(); err != nil {
		return Result{}, err
	}
	if developable && (!finite(c.Length) || c.Length <= 0 || c.Length > 20) {
		return Result{}, fieldErr("length", "tangent reach must be finite and between 0 (exclusive) and 20")
	}
	if projection && !poleBounded(c.Pole) {
		return Result{}, fieldErr(axis("pole", c.Pole, bounded), "pole coordinates must be finite and within ±100000")
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
	if canal {
		if err := c.Canal.validate(); err != nil {
			return Result{}, err
		}
		if err := c.Canal.frame(c.Frame).validate(); err != nil {
			return Result{}, err
		}
	}
	var flow *flowCurve
	var chase *spatialChase
	var integrated evaluation
	if c.Format == "field" {
		var err error
		if flow, err = c.Field.compile(); err != nil {
			return Result{}, err
		}
		integrated = flow.flows[0].evaluation(flow.f, c.Field.Max-c.Field.Min)
	}
	if c.Format == "pursuit" {
		var err error
		if chase, err = c.Pursuit.compile(); err != nil {
			return Result{}, err
		}
		integrated = chase.evaluation()
	}
	evaluate, lo, hi, closed, err := compile(c, integrated)
	dynamic := c.Format == "field" || c.Format == "pursuit"
	if err != nil {
		return Result{}, err
	}
	// The base's own units measure whether it, or a curve derived from it,
	// stands still or jumps (see units).
	baseUnits := evaluate.units(lo, hi, absolute)
	c.units = baseUnits
	if c.Probe != nil {
		if err := checkProbe(*c.Probe, lo, hi); err != nil {
			return Result{}, err
		}
	}
	// A derived input replaces the curve every construction acts on, and
	// is broken wherever the base is.
	composed := c.composed()
	var baseCurve []*Vec3
	var baseTangents []Vec3
	var baseBreaks []bool
	var reached []bool
	var restarts []float64
	// The involute or coil input's position alone, for refinement.
	var unwoundAt func(float64) Vec3
	baseEvaluate := evaluate
	// The base's cusps that a projected input continues across.
	var crossing map[int]float64
	if composed {
		baseCurve, baseTangents, baseBreaks = baseSamples(c, evaluate, lo, hi, c.Samples, closed)
		if c.projected() {
			crossing = baseUnits.crossings(evaluate, baseBreaks, lo, hi, closed)
		}
		switch {
		case c.projected():
			evaluate = composedEvaluation(c.Input, c.Pole, evaluate, lo, hi, baseUnits)
		case c.Input == "coil":
			if evaluate, unwoundAt, closed, err = c.Coil.evaluation(evaluate, lo, hi, baseCurve, baseTangents, baseBreaks, closed, baseUnits); err != nil {
				return Result{}, err
			}
		default:
			if evaluate, unwoundAt, reached, restarts, err = c.Unwinding.evaluation(evaluate, lo, hi, baseCurve, baseBreaks, baseUnits); err != nil {
				return Result{}, err
			}
			// A closed curve's involute ends a whole length of string from
			// where it began.
			closed = false
		}
	}
	var radius func(float64) (float64, float64, float64, bool)
	if canal {
		if radius, err = c.Canal.radius(hi - lo); err != nil {
			return Result{}, err
		}
	}
	var partner func(float64) (Vec3, Vec3, Vec3, bool, bool)
	if ruled {
		if partner, err = c.Ruled.partner(evaluate, lo, hi, closed); err != nil {
			return Result{}, err
		}
	}
	n := c.Samples
	out := Result{Base: make([]*Vec3, n+1), Minus: make([]*Vec3, n+1), Plus: make([]*Vec3, n+1), Breaks: make([]bool, n+1), Mesh: emptyMesh(), Rulings: make([]Ruling, 0, c.Lines)}
	// Only a study asked for the probe keeps what places it; constructions
	// fill in their points below.
	if c.Probe != nil {
		out.probing = &probing{c: c, evaluate: evaluate, third: jerk(c, evaluate, lo, hi), lo: lo, hi: hi, closed: closed}
	}
	normals, tangents := make([]Vec3, n+1), make([]Vec3, n+1)
	speeds, middles := make([]float64, n+1), make([]float64, n)
	valid := make([]bool, n+1)
	var velocities, accelerations []Vec3
	if c.Diagnostics || c.SurfaceDiagnostics && (canal || developable || framed || ruled) {
		velocities, accelerations = make([]Vec3, n+1), make([]Vec3, n+1)
	}
	for i := 0; i <= n; i++ {
		t := lo*(1-float64(i)/float64(n)) + hi*float64(i)/float64(n)
		r, v, a, ok := evaluate(t)
		if !ok || !r.valid() || !v.valid() || c.units.still(v) {
			out.Invalid++
			continue
		}
		tangent := v.unit()
		tangents[i] = tangent
		speeds[i] = v.norm()
		if velocities != nil {
			velocities[i], accelerations[i] = v, a
		}
		minus, plus := r.sub(tangent.mul(c.Length)), r.add(tangent.mul(c.Length))
		out.Base[i] = &r
		out.Minus[i] = &minus
		out.Plus[i] = &plus
		normals[i], valid[i] = c.binormal(v, a, lo, hi)
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
	if c.Diagnostics {
		out.Diagnostics = diagnose(c, evaluate, lo, hi, out.Base, velocities, accelerations, normals, valid, closed)
	}
	for i := 0; i < n; i++ {
		// Check inside every interval as well as at sample points, so a pole or
		// stationary point between samples does not become a connecting face.
		_, middle, _, ok := evaluate(lo + (hi-lo)*(float64(i)+0.5)/float64(n))
		middles[i] = math.NaN()
		if ok && middle.valid() {
			middles[i] = middle.norm()
		}
		disconnected := out.Base[i] == nil || out.Base[i+1] == nil || !ok || !middle.valid() || c.units.still(middle) || tangents[i].dot(tangents[i+1]) < 0
		if !disconnected && c.Format == "parametric" && !composed {
			// A chord through an asymptote is not a local tangent segment.
			disconnected = jumps(*out.Base[i], *out.Base[i+1], middle, (hi-lo)/float64(n), c.units.size)
		}
		// A derived input has no asymptote of its own: each foot lies on
		// the sphere with diameter from the base point to the pole, and an
		// involute point lies |c − s| from the base point, so it breaks
		// where the base does.
		_, crosses := crossing[i]
		disconnected = disconnected || composed && baseBreaks[i+1] && !crosses
		out.Breaks[i+1] = disconnected
	}
	// A projection joins across the cusps of the base that its tangent
	// line continues through.
	if projection {
		crossing = c.units.crossings(evaluate, out.Breaks, lo, hi, closed)
	}
	// Refinement breaks the intervals where it finds the curve stopping or
	// jumping between samples, so no surface is joined across them.
	if c.refines() {
		out.Adaptive = &AdaptiveResult{}
		position := c.position(baseEvaluate)
		if unwoundAt != nil {
			position = unwoundAt
		}
		var broken []int
		out.Adaptive.Base, broken = c.refine(out.Base, out.Breaks, position, lo, hi)
		for _, i := range broken {
			out.Breaks[i+1] = true
		}
	}
	if out.Diagnostics != nil {
		out.Diagnostics.measure(out.Base, speeds, middles, out.Breaks, (hi-lo)/float64(n))
	}
	// Each sheet's vertices at a sample, on the curve and on its edge, are
	// shared by the intervals on both sides of it.
	type station struct {
		base, minus, plus *Vec3
		normal            Vec3
	}
	joined := func(i int) bool {
		return !out.Breaks[i+1] && valid[i] && valid[i+1] && normals[i].dot(normals[i+1]) >= 0
	}
	var columns [][]float64
	between := map[float64]station{}
	if developable && c.refinesSurface() {
		// Refined along the curve, the sheets gain a tangent at each column
		// where the curve and its edges r ± LT drew points and its normal is
		// defined, turning with neither sample's. A gap or jump an edge finds
		// between samples leaves that interval's faces out.
		edge := func(sign float64) func(float64) Vec3 {
			return func(t float64) Vec3 {
				r, v, _, ok := evaluate(t)
				if !ok || !r.valid() || !v.valid() || c.units.still(v) {
					return Vec3{math.NaN(), 0, 0}
				}
				return r.add(v.unit().mul(sign * c.Length))
			}
		}
		minus, broken := c.refine(out.Minus, out.Breaks, edge(-1), lo, hi)
		plus, more := c.refine(out.Plus, out.Breaks, edge(1), lo, hi)
		out.Adaptive.Minus, out.Adaptive.Plus = minus, plus
		torn := map[int]bool{}
		for _, i := range append(broken, more...) {
			torn[i] = true
		}
		sheets := joined
		surface := func(i int) bool { return sheets(i) && !torn[i] }
		columns, _, out.Adaptive.Capped = surfaceColumns(n, surface, surfaceVertices/4, out.Adaptive.Base, minus, plus)
		for i, positions := range columns {
			kept := positions[:0]
			for _, at := range positions {
				r, v, a, ok := evaluate(parameterAt(lo, hi, n, at))
				if !ok || !r.valid() || !v.valid() || c.units.still(v) {
					continue
				}
				normal, defined := c.binormal(v, a, lo, hi)
				if !defined || normal.dot(normals[i]) < 0 || normal.dot(normals[i+1]) < 0 {
					continue
				}
				d := v.unit().mul(c.Length)
				m, p := r.sub(d), r.add(d)
				between[at] = station{&r, &m, &p, normal}
				kept = append(kept, at)
			}
			columns[i] = kept
			out.Adaptive.Columns += len(kept)
		}
		joined = surface
	}
	stationAt := func(at float64) station {
		if at == math.Trunc(at) {
			j := int(at)
			return station{out.Base[j], out.Minus[j], out.Plus[j], normals[j]}
		}
		return between[at]
	}
	type key struct {
		side, on int
		at       float64
	}
	listed := map[key]int32{}
	for i := 0; i < n && developable; i++ {
		if !joined(i) {
			out.Omitted++
			continue
		}
		stops := stations(i, columns)
		for s := 1; s < len(stops); s++ {
			from, to := stationAt(stops[s-1]), stationAt(stops[s])
			for _, side := range []int{-1, 1} {
				vertex := func(at float64, on int, g station) int32 {
					k := key{side, on, at}
					v, ok := listed[k]
					if !ok {
						point := g.base
						if on == 1 && side < 0 {
							point = g.minus
						} else if on == 1 {
							point = g.plus
						}
						v = out.Mesh.vertex(*point, g.normal.mul(float64(side)), at/float64(n))
						listed[k] = v
					}
					return v
				}
				a, b, c, d := vertex(stops[s-1], 0, from), vertex(stops[s-1], 1, from), vertex(stops[s], 0, to), vertex(stops[s], 1, to)
				out.Mesh.triangle(i+1, a, b, c)
				out.Mesh.triangle(i+1, b, d, c)
			}
		}
	}
	// A harmonic curve's generating vectors and ellipses, and a field's
	// trajectories or a pursuit's paths, frame as their own families under
	// every construction.
	var generating [][]*Vec3
	if c.Format == "harmonic" {
		out.Harmonic, generating = harmonicGeometry(c, lo, hi)
	}
	if c.Format == "field" {
		out.Field, generating = fieldGeometry(c, flow.f, flow.timed, flow.flows)
	}
	if c.Format == "pursuit" {
		out.Pursuit, generating = pursuitGeometry(c, chase)
	}
	if out.Invalid == n+1 {
		switch {
		case composed && c.Input == "coil":
			return Result{}, fmt.Errorf("the input curve has no regular sample: the coil stands still or is undefined; change its radius, angle or turns, or choose another input curve")
		case composed && reached != nil:
			return Result{}, fmt.Errorf("the input curve has no regular sample: the base curve is straight where its arc length reaches, so its involute stands still; choose another input curve")
		case composed:
			return Result{}, fmt.Errorf("the input curve has no regular sample: it stands still or is undefined; move the pole or choose another input curve")
		case !dynamic:
			return Result{}, fmt.Errorf("no regular finite samples; check the expressions and domain")
		case c.Format == "field" && !none:
			return Result{}, fmt.Errorf("trajectory 1 has no regular sample: its seed rests, escapes, or meets a singularity at once; choose another first seed")
		case c.Format == "pursuit" && !none:
			return Result{}, fmt.Errorf("pursuer 1 has no regular sample: it stands still or is caught at once; give it a speed or move it")
		case !moves(generating) && c.Format == "field":
			return Result{}, fmt.Errorf("no trajectory moves; check the field, seeds, and escape radius")
		case !moves(generating) && (chase.Capture == nil || chase.Capture.Time > lo):
			// A chase caught at once is drawn as its starts; its note says why.
			return Result{}, fmt.Errorf("no pursuer moves; give a pursuer a speed or lengthen the interval")
		}
	}
	// The base under a derived input frames with the pole as its own family.
	parent := -1
	if composed {
		out.Composition = composition(c, baseCurve, baseTangents, baseBreaks, closed, out.Base, out.Breaks, reached)
		out.Composition.Crossed = crossed(crossing, out.Breaks)
		out.Composition.Restarts = restarts
		if c.refines() {
			if out.Adaptive == nil {
				out.Adaptive = &AdaptiveResult{}
			}
			curve := out.Composition.Curve
			out.Adaptive.Parent, _ = c.refine(curve, out.Composition.Breaks, c.baseOnly().position(baseEvaluate), lo, hi)
		}
		parent = len(generating)
		generating = append(generating, out.Composition.Curve)
		if c.projected() {
			generating = append(generating, []*Vec3{&out.Composition.Pole})
		}
	}
	// bound frames the study: its families, each with the reach of the
	// refined path drawn on it (paths[k] for families[k], when the study
	// frames its reach), and the generating families, the curve beneath a
	// derived input with its own.
	bound := func(families [][]*Vec3, paths ...*RefinedPath) {
		all := append(families, generating...)
		reach := make([][]Vec3, len(all))
		for k, path := range paths {
			reach[k] = reachOf(path)
		}
		if parent >= 0 && out.Adaptive != nil {
			reach[len(families)+parent] = reachOf(out.Adaptive.Parent)
		}
		out.Bounds = fitReach(all, reach)
		out.Radius = out.Bounds.Radius
	}
	// The refined paths, none when the study is not refined.
	refined := out.Adaptive
	if refined == nil {
		refined = &AdaptiveResult{}
	}
	if none {
		out.Minus, out.Plus = []*Vec3{}, []*Vec3{}
		bound([][]*Vec3{out.Base}, refined.Base)
		return out, nil
	}
	if framed {
		frame := frames(c, &out, tangents, speeds, middles, normals, valid, closed, lo, hi)
		if c.Frame.Width > 0 {
			along := frame.along(c, evaluate, lo, hi)
			out.probing.highlight(func(t float64, _, _ Vec3, at *ProbePoint) {
				if g, ok := along(t); ok {
					d := g.direction(c.Frame.Angle).mul(c.Frame.Width)
					at.Minus, at.Plus = pointAt(g.r.sub(d)), pointAt(g.r.add(d))
				}
			})
		}
		if out.Adaptive != nil {
			// Each strand on its own, like the involutes.
			for k, strand := range out.Frame.Strands {
				path, _ := c.refine(strand, out.Frame.Breaks, frame.strand(c, evaluate, k, lo, hi), lo, hi)
				out.Adaptive.Strands = append(out.Adaptive.Strands, path)
			}
		}
		if c.Frame.Width > 0 {
			frame.ribbon(c, &out, evaluate, lo, hi)
		}
		if c.SurfaceDiagnostics && c.Frame.Width > 0 {
			out.Probe, out.surfaceAt = framedProbe(c, evaluate, lo, hi, out.Base, velocities, accelerations, frame)
		}
		families := [][]*Vec3{out.Base, out.Minus, out.Plus}
		families = append(families, out.Frame.Strands...)
		bound(families, append([]*RefinedPath{refined.Base, refined.Minus, refined.Plus}, refined.Strands...)...)
		return out, nil
	}
	if canal {
		framing := c
		framing.Frame = c.Canal.frame(c.Frame)
		frame := frames(framing, &out, tangents, speeds, middles, normals, valid, closed, lo, hi)
		if err := canalSurface(c, &out, evaluate, radius, frame, tangents, accelerations, speeds, middles, lo, hi, closed); err != nil {
			return Result{}, err
		}
		// The meridians come first among what the canal draws.
		families := append([][]*Vec3{out.Base}, out.Canal.drawn()...)
		bound(families, append([]*RefinedPath{refined.Base}, refined.Meridians...)...)
		return out, nil
	}
	if ruled {
		out.probing.highlight(func(t float64, _, _ Vec3, at *ProbePoint) {
			if p, _, _, ok, inside := partner(c.Ruled.Rate*t + c.Ruled.Shift); ok && inside {
				at.Plus = pointAt(p)
			}
		})
		if err := ruledSurface(c, &out, evaluate, partner, tangents, accelerations, speeds, lo, hi, closed); err != nil {
			return Result{}, err
		}
		bound([][]*Vec3{out.Base, out.Plus}, refined.Base, refined.Partner)
		return out, nil
	}
	if projection {
		out.probing.highlight(func(_ float64, r, tangent Vec3, at *ProbePoint) {
			at.Foot = pointAt(project("tangent-foot", c.Pole, r, tangent))
			at.Image = pointAt(project(c.Construction, c.Pole, r, tangent))
		})
		out.Projection = projections(c, out.Base, tangents)
		out.Projection.cross(c, evaluate, crossing, out.Breaks, lo, hi)
		if out.Adaptive != nil {
			points, breaks := out.Projection.Points, out.Breaks
			if out.Projection.Breaks != nil {
				breaks = out.Projection.Breaks
			}
			var broken []int
			out.Adaptive.Projection, broken = c.refine(points, breaks, func(t float64) Vec3 {
				r, v, a, ok := evaluate(t)
				line, defined := c.units.line(v, a)
				if !ok || !r.valid() || !defined {
					return Vec3{math.NaN(), 0, 0}
				}
				return project(c.Construction, c.Pole, r, line)
			}, lo, hi)
			// Refinement may yet find a crossed cusp broken between samples.
			for _, i := range broken {
				if _, crosses := crossing[i]; crosses {
					out.Projection.Breaks[i+1] = true
				}
			}
			if out.Projection.Breaks != nil {
				out.Projection.Crossed = crossed(crossing, out.Projection.Breaks)
			}
		}
		out.Minus, out.Plus = []*Vec3{}, []*Vec3{}
		bound([][]*Vec3{out.Base, out.Projection.Points, out.Projection.Feet, {&out.Projection.Pole}}, refined.Base, refined.Projection)
		return out, nil
	}
	if inversion {
		q := inversions(c, evaluate, lo, hi, out.Base, tangents, out.Breaks)
		out.probing.highlight(func(_ float64, r, tangent Vec3, at *ProbePoint) {
			if source := pointAt(c.Inversion.source(c.Pole, r, tangent)); source != nil {
				at.Source, at.Image = source, pointAt(invert(q.Center, q.Radius, *source))
			}
		})
		if out.Adaptive != nil {
			// Refinement decides each passage through the center in place of
			// the uniform midpoint test.
			q.Breaks, q.Crossings = append([]bool(nil), out.Breaks...), 0
			var broken []int
			out.Adaptive.Image, broken = c.refine(q.Points, q.Breaks, func(t float64) Vec3 {
				r, v, _, ok := evaluate(t)
				if !ok || !r.valid() || !v.valid() || c.units.still(v) {
					return Vec3{math.NaN(), 0, 0}
				}
				return invert(q.Center, q.Radius, c.Inversion.source(c.Pole, r, v.unit()))
			}, lo, hi)
			for _, i := range broken {
				q.Breaks[i+1] = true
			}
			q.Crossings = len(broken)
		}
		out.Inversion = q
		out.Minus, out.Plus = []*Vec3{}, []*Vec3{}
		// A base source repeats the base, which leaves the fit unchanged.
		bound([][]*Vec3{out.Base, q.Source, q.Points, {&q.Center}}, refined.Base, nil, refined.Image)
		return out, nil
	}
	if involute {
		result, arcs, err := involutes(c.Involute, evaluate, lo, hi, out.Base, tangents, speeds, middles, out.Breaks, c.Lines, c.units)
		if err != nil {
			return Result{}, err
		}
		out.Involute = result
		out.probing.highlight(func(t float64, _, _ Vec3, at *ProbePoint) {
			at.Members = make([]*Vec3, len(result.Members))
			for k, m := range result.Members {
				at.Members[k] = pointAt(arcs.member(m.Offset)(t))
			}
		})
		if out.Adaptive != nil {
			// Each member on its own: one's break is not another's.
			for _, m := range result.Members {
				path, _ := c.refine(m.Points, out.Breaks, arcs.member(m.Offset), lo, hi)
				out.Adaptive.Involute = append(out.Adaptive.Involute, path)
			}
		}
		out.Minus, out.Plus = []*Vec3{}, []*Vec3{}
		families := [][]*Vec3{out.Base}
		for _, m := range result.Members {
			families = append(families, m.Points)
		}
		bound(families, append([]*RefinedPath{refined.Base}, refined.Involute...)...)
		return out, nil
	}
	out.probing.highlight(func(_ float64, r, tangent Vec3, at *ProbePoint) {
		minus, plus := r.sub(tangent.mul(c.Length)), r.add(tangent.mul(c.Length))
		at.Minus, at.Plus = &minus, &plus
	})
	for i := 0; i < c.Lines; i++ {
		j := i * n / (c.Lines - 1)
		if out.Base[j] != nil {
			out.Rulings = append(out.Rulings, Ruling{j, *out.Minus[j], *out.Plus[j]})
		}
	}
	if c.SurfaceDiagnostics {
		out.Probe, out.surfaceAt = developableProbe(c, evaluate, lo, hi, closed, out.Base, velocities, accelerations, valid)
	}
	bound([][]*Vec3{out.Base, out.Minus, out.Plus}, refined.Base, refined.Minus, refined.Plus)
	return out, nil
}
