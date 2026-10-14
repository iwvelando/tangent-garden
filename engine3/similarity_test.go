package engine3

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"tangentgarden/engine/expr"
	"testing"
)

// Similar copies of the spatial presets: each study is moved by the
// similarity p ↦ s p + T and computed again, and every number of its result
// is compared with the original's under the same map (see the error budgets
// in docs/mathematics.md, "Scale and translation").
//
// testdata/presets.json holds every spatial preset's configuration, exactly
// as web/spatial/presets.ts gives it to the engine (keyed by name; a
// configuration is the request). Regenerate it after adding or changing a
// spatial preset (Vite resolves the presets' imports, which Node cannot):
//
//	node --input-type=module -e 'import {createServer} from "vite"; const s = await createServer({logLevel: "silent", server: {ws: false}}); const {spatialPresets} = await s.ssrLoadModule("/web/spatial/presets.ts"); await s.close(); process.stdout.write("{\n" + spatialPresets.map((p) => JSON.stringify(p.name) + ": " + JSON.stringify(p.config)).join(",\n") + "\n}\n")' > engine3/testdata/presets.json

// similarity is the map p ↦ s p + T.
type similarity struct {
	name  string
	scale float64
	shift Vec3
}

func (m similarity) point(p Vec3) Vec3 { return p.mul(m.scale).add(m.shift) }

// The copies. Scales are powers of two, so scaling every input and every
// homogeneous operation is exact and any difference from the original is a
// threshold that does not scale. The shift is far from the studies, which
// span a few units: thousands of times their size. Only curves are made
// tinier: a surface's domain and a level set's box are at least 10⁻⁶ wide.
var similarities = []similarity{
	{"tiny", 0x1p-16, Vec3{}},
	{"tinier", 0x1p-40, Vec3{}},
	{"huge", 0x1p10, Vec3{}},
	{"far", 1, Vec3{5000, -3000, 4000}},
}

func spatialPresets(t testing.TB) map[string]Request {
	t.Helper()
	b, err := os.ReadFile("testdata/presets.json")
	if err != nil {
		t.Fatal(err)
	}
	var all map[string]Request
	if err := json.Unmarshal(b, &all); err != nil {
		t.Fatal(err)
	}
	return all
}

func number(v float64) string { return "(" + strconv.FormatFloat(v, 'g', -1, 64) + ")" }

// affine returns the expression s e + T for one coordinate of a position.
func affine(e string, s, shift float64) string {
	out := number(s) + "*(" + e + ")"
	if shift != 0 {
		out = number(shift) + "+" + out
	}
	return out
}

// pulled returns e with x, y and z replaced by the original point (p − T)/s
// of the copy's point p, so the copy reads the original field there.
func pulled(e string, m similarity) string {
	var b strings.Builder
	shift := map[string]float64{"x": m.shift.X, "y": m.shift.Y, "z": m.shift.Z}
	for i := 0; i < len(e); {
		c := e[i]
		if c < 'a' || c > 'z' {
			b.WriteByte(c)
			i++
			continue
		}
		j := i
		for j < len(e) && e[j] >= 'a' && e[j] <= 'z' {
			j++
		}
		word := e[i:j]
		if d, ok := shift[word]; ok {
			if d != 0 {
				word = "(" + word + "-" + number(d) + ")"
			}
			word = "(" + word + "/" + number(m.scale) + ")"
		}
		b.WriteString(word)
		i = j
	}
	return b.String()
}

// harmonicKnot is the torus knot c as the harmonic curve it is: (R + r cos
// qt)(cos pt, sin pt) + r sin qt ẑ expands into four terms. The knot's
// format has no center, and its radii are confined to 0.1–20, so a copy
// moves this form, and the original is compared in it too.
func harmonicKnot(c Request) Request {
	p, q, R, r := float64(c.P), float64(c.Q), c.Radius, c.Tube
	c.Format = "harmonic"
	c.Harmonic = HarmonicCurve{
		Terms: []HarmonicTerm{
			{Frequency: p, Cosine: Vec3{R, 0, 0}, Sine: Vec3{0, R, 0}},
			{Frequency: p + q, Cosine: Vec3{r / 2, 0, 0}, Sine: Vec3{0, r / 2, 0}},
			{Frequency: p - q, Cosine: Vec3{r / 2, 0, 0}, Sine: Vec3{0, r / 2, 0}},
			{Frequency: q, Sine: Vec3{0, 0, r}},
		},
		Min: 0, Max: 2 * math.Pi,
	}
	return c
}

// similar returns the study to compare and its copy under m, or ok false
// when m cannot be expressed: surfaces and mirrors are placed at the
// origin, so they are only scaled, and they and level sets are not made
// tinier than their least widths allow. A torus knot is compared as its
// harmonic form, and the tangent reach, at most 20, is shortened in both
// studies so the copy's reach is within it; likewise a vector field's
// escape radius, at most 100000.
func similar(q Request, m similarity) (Request, Request, bool) {
	s := m.scale
	if q.Format == "" || q.Format == "torus" {
		q = harmonicKnot(q)
	}
	if q.Format == "surface" || q.Format == "rays" {
		if m.shift != (Vec3{}) {
			return q, q, false
		}
	}
	if (q.Format == "surface" || q.Format == "rays" || q.Format == "implicit") && m.scale < 0x1p-20 {
		return q, q, false
	}
	if q.Field.Escape*s > 1e5 {
		q.Field.Escape = 1e5 / s
	}
	if q.Length*s > 20 {
		q.Length = 20 / s
	}
	c := q
	c.Length *= s
	c.Pole = m.point(q.Pole)
	c.Inversion.Center = m.point(q.Inversion.Center)
	c.Inversion.Radius *= s
	c.Coil.Radius *= s
	c.Frame.Offset *= s
	c.Frame.Width *= s
	c.Canal.Radius *= s
	c.Involute.Offset *= s
	c.Involute.Family.From *= s
	c.Involute.Family.To *= s
	c.Unwinding.Offset *= s
	c.Ruled.Thread = Thread{
		X: affine(q.Ruled.Thread.X, s, m.shift.X),
		Y: affine(q.Ruled.Thread.Y, s, m.shift.Y),
		Z: affine(q.Ruled.Thread.Z, s, m.shift.Z),
	}
	c.Curve.X = affine(q.Curve.X, s, m.shift.X)
	c.Curve.Y = affine(q.Curve.Y, s, m.shift.Y)
	c.Curve.Z = affine(q.Curve.Z, s, m.shift.Z)
	c.Harmonic.Center = m.point(q.Harmonic.Center)
	c.Harmonic.Terms = nil
	for _, term := range q.Harmonic.Terms {
		term.Cosine, term.Sine = term.Cosine.mul(s), term.Sine.mul(s)
		c.Harmonic.Terms = append(c.Harmonic.Terms, term)
	}
	// A trajectory of V moved by m is a trajectory of s V(m⁻¹(p)), in the
	// same time. The escape sphere stays about the origin, so a shifted
	// copy's holds the original's moved sphere.
	c.Field.X = number(s) + "*(" + pulled(q.Field.X, m) + ")"
	c.Field.Y = number(s) + "*(" + pulled(q.Field.Y, m) + ")"
	c.Field.Z = number(s) + "*(" + pulled(q.Field.Z, m) + ")"
	c.Field.Seeds = nil
	for _, seed := range q.Field.Seeds {
		c.Field.Seeds = append(c.Field.Seeds, m.point(seed))
	}
	c.Field.Escape = s*q.Field.Escape + m.shift.norm()
	c.Pursuit.Pursuers = nil
	for _, p := range q.Pursuit.Pursuers {
		at := m.point(Vec3{p.X, p.Y, p.Z})
		c.Pursuit.Pursuers = append(c.Pursuit.Pursuers, SpatialPursuer{at.X, at.Y, at.Z, s * p.Speed})
	}
	c.Pursuit.Capture *= s
	// Surfaces: lengths scale, and so do the parameters that are lengths.
	switch q.Surface.Kind {
	case "ellipsoid", "torus":
		c.Surface.A, c.Surface.B, c.Surface.C = s*q.Surface.A, s*q.Surface.B, s*q.Surface.C
	case "cylinder":
		c.Surface.A, c.Surface.B = s*q.Surface.A, s*q.Surface.B
		c.Surface.VMin, c.Surface.VMax = s*q.Surface.VMin, s*q.Surface.VMax
	case "paraboloid":
		c.Surface.A, c.Surface.B = q.Surface.A/s, q.Surface.B/s
		c.Surface.UMin, c.Surface.UMax = s*q.Surface.UMin, s*q.Surface.UMax
		c.Surface.VMin, c.Surface.VMax = s*q.Surface.VMin, s*q.Surface.VMax
	case "monkey":
		c.Surface.A = q.Surface.A / (s * s)
		c.Surface.UMin, c.Surface.UMax = s*q.Surface.UMin, s*q.Surface.UMax
		c.Surface.VMin, c.Surface.VMax = s*q.Surface.VMin, s*q.Surface.VMax
	}
	c.Surface.Offset *= s
	c.Surface.Reach *= s
	c.Rays.Source = m.point(q.Rays.Source)
	c.Rays.Length *= s
	c.Rays.Receiver.At *= s
	c.Rays.Receiver.C1 *= s
	c.Rays.Receiver.C2 *= s
	c.Rays.Receiver.Size *= s
	// F moved by m, in units of length, so its level and gradient scale too.
	c.Implicit.F = number(s) + "*(" + pulled(q.Implicit.F, m) + ")"
	c.Implicit.Level *= s
	lo := m.point(Vec3{q.Implicit.Box.XMin, q.Implicit.Box.YMin, q.Implicit.Box.ZMin})
	hi := m.point(Vec3{q.Implicit.Box.XMax, q.Implicit.Box.YMax, q.Implicit.Box.ZMax})
	c.Implicit.Box = Box{lo.X, hi.X, lo.Y, hi.Y, lo.Z, hi.Z}
	if n := q.Implicit.Sections.Normal; n.norm() > 0 {
		along := m.shift.dot(n.mul(1 / n.norm()))
		c.Implicit.Sections.From = s*q.Implicit.Sections.From + along
		c.Implicit.Sections.To = s*q.Implicit.Sections.To + along
	}
	return q, c, true
}

// How a number of a result moves under p ↦ s p + T.
type kind int

const (
	asExact     kind = iota // counts, indices and flags: unchanged, exactly
	asUnchanged             // directions, angles, parameters and times
	asPosition              // s p + T
	asLength                // s ℓ
	asCurvature             // κ / s
	asArea                  // s² A
	asDensity               // ρ / s², per unit area
	asOffset                // s d + n̂·T, a plane's offset along its normal n̂
	asAxis                  // a unit vector defined up to its sign
)

// kinds classifies every number of a result by its path: the JSON names
// from the result down, without indices. A Vec3 is classified as a whole.
// The flat arrays mesh.vertices, implicit.positions and implicit.normals
// are classified by their strides.
var kinds = map[string]kind{
	"bounds.center": asPosition, "bounds.radius": asLength,
	"base": asPosition, "minus": asPosition, "plus": asPosition, "radius": asLength,
	"rulings.from": asPosition, "rulings.to": asPosition,
	"adaptive.*.points": asPosition, "adaptive.*.at": asUnchanged, "adaptive.*.reach": asPosition, "adaptive.*.reachAt": asUnchanged, "adaptive.*.tolerance": asLength,
	"canal.circles.center": asPosition, "canal.circles.points": asPosition, "canal.circles.radius": asLength,
	"canal.circles.sphere": asLength, "canal.meridians": asPosition, "canal.gap": asLength, "canal.steepest": asUnchanged,
	"composition.constructions.contact": asPosition, "composition.constructions.foot": asPosition,
	"composition.constructions.image": asPosition, "composition.curve": asPosition,
	"projection.constructions.contact": asPosition, "projection.constructions.foot": asPosition,
	"projection.constructions.image": asPosition, "projection.feet": asPosition, "projection.points": asPosition,
	"projection.pole":     asPosition,
	"diagnostics.tangent": asUnchanged, "diagnostics.normal": asUnchanged, "diagnostics.binormal": asUnchanged,
	"diagnostics.center": asPosition, "diagnostics.curvature": asCurvature, "diagnostics.torsion": asCurvature,
	"diagnostics.length": asLength, "diagnostics.min": asUnchanged, "diagnostics.max": asUnchanged,
	"field.arrows.point": asPosition, "field.arrows.velocity": asLength, "field.ends.point": asPosition,
	"field.ends.time": asUnchanged, "field.paths": asPosition,
	"frame.correction": asUnchanged, "frame.holonomy": asUnchanged, "frame.length": asLength,
	"frame.frames.tangent": asUnchanged, "frame.frames.normal": asUnchanged, "frame.frames.binormal": asUnchanged,
	"frame.frames.point": asPosition, "frame.seam.angle": asUnchanged, "frame.seam.end": asUnchanged,
	"frame.seam.point": asPosition, "frame.seam.start": asUnchanged, "frame.strands": asPosition,
	"harmonic.center": asPosition, "harmonic.chains.joints": asPosition, "harmonic.chains.point": asPosition,
	"harmonic.positions.joints": asPosition, "harmonic.positions.point": asPosition, "harmonic.period": asUnchanged,
	"harmonic.terms.cosine": asLength, "harmonic.terms.sine": asLength, "harmonic.terms.frequency": asUnchanged,
	"implicit.box.xMin": asPosition, "implicit.box.xMax": asPosition, "implicit.box.yMin": asPosition,
	"implicit.box.yMax": asPosition, "implicit.box.zMin": asPosition, "implicit.box.zMax": asPosition,
	"implicit.sections.paths.points": asPosition, "implicit.sections.offset": asOffset, "implicit.sections.polygon": asPosition,
	"inversion.center": asPosition, "inversion.correspondences.image": asPosition,
	"inversion.correspondences.source": asPosition, "inversion.points": asPosition, "inversion.pole": asPosition,
	"inversion.radius": asLength, "inversion.source": asPosition,
	"involute.members.offset": asLength, "involute.members.points": asPosition,
	"involute.strings.from": asPosition, "involute.strings.to": asPosition,
	"pursuit.capture.time": asUnchanged, "pursuit.end": asUnchanged, "pursuit.final": asPosition,
	"pursuit.paths": asPosition, "pursuit.polygons.points": asPosition,
	"rays.caustics.normals": asAxis, "rays.caustics.points": asPosition,
	"rays.lines.back": asPosition, "rays.lines.end": asPosition, "rays.lines.point": asPosition,
	"rays.lines.start": asPosition, "rays.source": asPosition, "rays.receiver.corners": asPosition,
	"rays.receiver.size": asLength, "rays.surface.normals": asUnchanged, "rays.surface.points": asPosition,
	"ruled.gap": asLength, "ruled.deviation": asUnchanged,
	"surface.focal.normals": asUnchanged, "surface.focal.points": asPosition, "surface.lines.end": asPosition,
	"surface.lines.point": asPosition, "surface.offset.normals": asUnchanged, "surface.offset.points": asPosition,
	"surface.surface.normals": asUnchanged, "surface.surface.points": asPosition,
	"surfaceDiagnostics.curvature": asCurvature, "surfaceDiagnostics.direction": asAxis,
	"surfaceDiagnostics.focal": asPosition, "surfaceDiagnostics.normals": asUnchanged,
	"surfaceDiagnostics.points": asPosition, "surfaceDiagnostics.u": asUnchanged, "surfaceDiagnostics.v": asUnchanged,
	"probe.t": asUnchanged, "probe.point": asPosition, "probe.tangent": asUnchanged, "probe.normal": asUnchanged,
	"probe.binormal": asUnchanged, "probe.center": asPosition, "probe.curvature": asCurvature,
	"probe.torsion": asCurvature, "probe.length": asLength, "probe.minus": asPosition, "probe.plus": asPosition,
	"probe.foot": asPosition, "probe.source": asPosition, "probe.image": asPosition, "probe.members": asPosition,
	"probe.chain.joints": asPosition, "probe.chain.point": asPosition,
}

// strides gives each place of a flat array's stride its kind and name.
var strides = map[string][]struct {
	kind kind
	name string
}{
	"mesh.vertices": {
		{asPosition, ""}, {asPosition, ""}, {asPosition, ""},
		{asUnchanged, ".normal"}, {asUnchanged, ".normal"}, {asUnchanged, ".normal"},
		{asUnchanged, ".phase"},
	},
	"implicit.positions": {{asPosition, ""}},
	"implicit.normals":   {{asUnchanged, ""}},
}

// lookup finds a path's kind, reading adaptive.<path>.points as
// adaptive.*.points. A surface's parameters that are lengths scale.
func lookup(path string, q Request) (kind, bool) {
	if strings.HasPrefix(path, "adaptive.") {
		if i := strings.LastIndexByte(path, '.'); i > 0 {
			path = "adaptive.*" + path[i:]
		}
	}
	if path == "surfaceDiagnostics.u" || path == "surfaceDiagnostics.v" {
		// A surface built on a curve is probed at base parameters u and at
		// distances v along a developable's ruling or across a framed
		// ribbon, at fractions of a ruled surface's ruling, or at turns
		// round a canal's circle.
		if q.Format != "surface" && q.Format != "rays" {
			if path == "surfaceDiagnostics.v" && (q.Construction == "developable" || q.Construction == "framed") {
				return asLength, true
			}
			return asUnchanged, true
		}
		k := q.Surface.Kind
		if k == "paraboloid" || k == "monkey" || (k == "cylinder" && path == "surfaceDiagnostics.v") {
			return asLength, true
		}
	}
	// A parallel beam's flux is an area of beam and its irradiance a
	// multiple of the beam's; a point source's flux is a solid angle and
	// its irradiance per unit area.
	switch path {
	case "rays.receiver.emitted", "rays.receiver.received", "rays.receiver.outside",
		"rays.receiver.away", "rays.receiver.total", "rays.receiver.edge":
		if q.Rays.Light == "point" {
			return asUnchanged, true
		}
		return asArea, true
	case "rays.receiver.irradiance", "rays.receiver.peak":
		if q.Rays.Light == "point" {
			return asDensity, true
		}
		return asUnchanged, true
	case "composition.pole":
		// Only a projected input has a pole; any other's is zero.
		if q.projected() {
			return asPosition, true
		}
		return asExact, true
	}
	k, ok := kinds[path]
	return k, ok
}

// class is what a kind's budget is: positions and lengths, directions and
// other pure numbers, or curvatures.
func (k kind) class() string {
	switch k {
	case asPosition, asLength, asOffset, asArea:
		return "length"
	case asCurvature, asDensity:
		return "curvature"
	}
	return "number"
}

// budget is how far a copy may stray from its original.
type budget struct {
	// worst is the largest difference allowed of each class, in units of
	// the number's own size plus the study's scale for its kind (see
	// comparison.unit), or of its distance from the origin for a position.
	worst map[string]float64
	// skipped tells which results are not compared at all, and tolerated
	// which may differ in their counts, flags and gaps, when the reasons
	// in budgetFor apply.
	skipped, tolerated func(path string) bool
}

func never(string) bool { return false }

func prefixed(prefixes ...string) func(string) bool {
	return func(path string) bool {
		for _, p := range prefixes {
			if strings.HasPrefix(path, p) {
				return true
			}
		}
		return false
	}
}

// chaotic names the presets whose trajectories separate exponentially, so
// that any change in rounding, as moving them brings, grows to the size of
// the attractor within the interval drawn.
var chaotic = map[string]bool{"Lorenz's two wings": true}

// numeric reports a study with a curve differentiated numerically: a
// custom curve, a trajectory or chase, a derived input, or a ruled
// surface's second thread.
func numeric(q Request) bool {
	switch q.Format {
	case "surface", "rays", "implicit":
		return false
	}
	return q.analytic() == "" || q.Construction == "ruled" && q.Ruled.Partner == "thread"
}

// budgetFor is the error budget of a copy of q under m (see
// docs/mathematics.md, "Scale and translation").
func budgetFor(q Request, m similarity) budget {
	if m.shift == (Vec3{}) {
		// Scaled by a power of two, a study's arithmetic is exact, so every
		// number agrees to rounding and every decision is the same. The one
		// exception is a numerically differenced r‴, whose stability test
		// has an absolute floor (jerk, in diagnostics.go): a tiny copy finds
		// torsions the original cannot, and so normals of a framed ribbon's
		// surface probe, which needs the torsion's slope.
		b := budget{worst: map[string]float64{"length": 1e-13, "number": 1e-13, "curvature": 1e-13}, skipped: never, tolerated: never}
		tolerated := []string{}
		if m.scale < 1 && q.analytic() == "" {
			tolerated = append(tolerated, "diagnostics.torsion", "diagnostics.unknown", "surfaceDiagnostics.", "probe.torsion")
		}
		// A seed rests where the field's speed is below an absolute 10⁻⁹
		// (fieldGeometry, in flow.go, as the field's note in the notebook
		// states), which a tinier copy's seeds fall below.
		if m.scale < 0x1p-20 && q.Format == "field" {
			tolerated = append(tolerated, "field.resting")
		}
		// A framed ribbon's probe tests its tangent plane against the
		// larger of S_t, a length per parameter, and S_u, the unit offset
		// direction (shape, as ruledProbe calls it): in a tinier copy S_t is
		// far below 1 and no normal is found.
		if m.scale < 0x1p-20 && q.Construction == "framed" {
			tolerated = append(tolerated, "surfaceDiagnostics.")
		}
		b.tolerated = prefixed(tolerated...)
		return b
	}
	// Far from the origin every position is rounded to the shift's ulp,
	// about 10⁻¹² of a study a few units across; evaluated points keep
	// that, and directions and curvatures found from exact derivatives
	// lose a little more.
	b := budget{worst: map[string]float64{"length": 1e-11, "number": 1e-9, "curvature": 1e-9}, skipped: never, tolerated: never}
	if q.Format == "field" || q.Format == "pursuit" {
		// Trajectories are integrated to 10⁻¹⁰ (pursuits 10⁻¹²) of the
		// distance from the origin, so a far copy's steps are thousands of
		// times coarser, and fewer.
		b.worst = map[string]float64{"length": 1e-4, "number": 1e-4, "curvature": 1e-4}
		b.tolerated = prefixed("field.ends.steps")
	}
	if numeric(q) {
		// A curve differentiated numerically, from positions rounded at the
		// shift, loses that rounding over each power of the step, more so
		// for a derived input, differentiated from a differentiated base:
		// its tangent keeps about 10⁻⁸, and its second and third
		// derivatives little near where the curve slows. Its curvature,
		// torsion and Frenet frame, and the normals of a developable's
		// mesh, are compared only at scale, and the curvature it finds
		// known or unknown, and the faces it omits, may change.
		b.worst["length"] = math.Max(b.worst["length"], 1e-6)
		b.worst["number"] = math.Max(b.worst["number"], 1e-4)
		b.skipped = prefixed("diagnostics.", "mesh.vertices.normal", "frame.frames.normal", "frame.frames.binormal",
			"probe.normal", "probe.binormal", "probe.center", "probe.curvature", "probe.torsion")
		b.tolerated = prefixed("omitted", "mesh.", "field.ends.steps")
	}
	if q.Format != "surface" && q.Format != "rays" && q.Format != "implicit" {
		// The surface probe of a surface built on a curve differences it
		// numerically, whatever the curve, so it is compared only at
		// scale.
		skipped := b.skipped
		b.skipped = func(path string) bool { return skipped(path) || strings.HasPrefix(path, "surfaceDiagnostics.") }
	}
	if q.Format == "implicit" {
		// A grid moved far from the origin samples F at points rounded
		// differently, so where the original's F is exactly zero at a grid
		// point (a gyroid through the box's corners, a torus through grid
		// points) the moved mesh is triangulated differently. It is
		// compared by its geometry instead of by index (see compare): every
		// original vertex and section point within a hundredth of a cell
		// of the copy's, and every point of the copy within 10⁻⁹ of a cell
		// of the original's level set.
		b.skipped = prefixed("implicit.positions", "implicit.normals", "implicit.triangles", "implicit.cut",
			"implicit.open", "implicit.components", "implicit.sections.paths", "implicit.sections.polygon", "implicit.marks")
		b.worst["cells"], b.worst["level"] = 1e-2, 1e-9
	}
	return b
}

// deviation is the largest difference of each class between a copy and its
// original, and where it was found, with the discrete differences.
type deviation struct {
	worst map[string]float64
	where map[string]string
	// discrete lists the counts, flags, indices, gaps and lengths that
	// differ beyond the budget's tolerance.
	discrete []string
	// unknown lists the numbers no kind classifies.
	unknown map[string]bool
}

type comparison struct {
	m      similarity
	q      Request
	b      budget
	radius float64 // the original's bounding radius, its scale
	d      *deviation
}

func (c comparison) unit(k kind) float64 {
	switch k {
	case asPosition, asLength, asOffset:
		return c.m.scale * c.radius
	case asCurvature:
		return 1 / (c.m.scale * c.radius)
	case asArea:
		return c.m.scale * c.m.scale * c.radius * c.radius
	case asDensity:
		return 1 / (c.m.scale * c.m.scale * c.radius * c.radius)
	}
	return 1
}

func (c comparison) expect(k kind, v, shift float64) float64 {
	switch k {
	case asPosition, asOffset:
		return c.m.scale*v + shift
	case asLength:
		return c.m.scale * v
	case asCurvature:
		return v / c.m.scale
	case asArea:
		return c.m.scale * c.m.scale * v
	case asDensity:
		return v / (c.m.scale * c.m.scale)
	}
	return v
}

func (c comparison) number(path string, k kind, want, got, shift float64) {
	if c.b.skipped(path) {
		return
	}
	if k == asExact {
		if want != got && !(math.IsNaN(want) && math.IsNaN(got)) {
			c.discrete(path, fmt.Sprintf("%v, want %v", got, want))
		}
		return
	}
	e := c.expect(k, want, shift)
	if math.IsNaN(e) || math.IsNaN(got) {
		if math.IsNaN(e) != math.IsNaN(got) {
			c.discrete(path, fmt.Sprintf("%v, want %v", got, e))
		}
		return
	}
	// Positions are measured against their distance from the moved origin
	// as well, the rounding a shift brings.
	size := math.Abs(e)
	if k == asPosition || k == asOffset {
		size = math.Abs(e-shift) + math.Abs(shift)
	}
	r := math.Abs(got-e) / (size + c.unit(k))
	if class := k.class(); r > c.d.worst[class] {
		c.d.worst[class] = r
		c.d.where[class] = fmt.Sprintf("%s: %v, want %v", path, got, e)
	}
}

func (c comparison) discrete(path, what string) {
	if c.b.skipped(path) || c.b.tolerated(path) {
		return
	}
	if len(c.d.discrete) < 12 {
		c.d.discrete = append(c.d.discrete, path+": "+what)
	} else if len(c.d.discrete) == 12 {
		c.d.discrete = append(c.d.discrete, "…")
	}
}

var vecType = reflect.TypeOf(Vec3{})

func join(path, name string) string {
	if path == "" {
		return name
	}
	return path + "." + name
}

// walk compares want and got, values of the same type at path.
func (c comparison) walk(path string, want, got reflect.Value) {
	switch want.Kind() {
	case reflect.Pointer, reflect.Interface:
		if want.IsNil() != got.IsNil() {
			c.discrete(path, fmt.Sprintf("nil %v, want nil %v", got.IsNil(), want.IsNil()))
			return
		}
		if !want.IsNil() {
			c.walk(path, want.Elem(), got.Elem())
		}
	case reflect.Struct:
		if want.Type() == vecType {
			k, ok := lookup(path, c.q)
			if !ok {
				c.d.unknown[path] = true
				return
			}
			w, g := want.Interface().(Vec3), got.Interface().(Vec3)
			if k == asAxis {
				// A principal direction is an axis: either sign is the
				// same direction.
				if w.dot(g) < 0 {
					w = w.mul(-1)
				}
				k = asUnchanged
			}
			c.number(path+".x", k, w.X, g.X, c.m.shift.X)
			c.number(path+".y", k, w.Y, g.Y, c.m.shift.Y)
			c.number(path+".z", k, w.Z, g.Z, c.m.shift.Z)
			return
		}
		for i := 0; i < want.NumField(); i++ {
			f := want.Type().Field(i)
			name := strings.Split(f.Tag.Get("json"), ",")[0]
			if name == "-" || !f.IsExported() {
				continue
			}
			if f.Anonymous && name == "" {
				c.walk(path, want.Field(i), got.Field(i))
				continue
			}
			if name == "" {
				name = f.Name
			}
			c.walk(join(path, name), want.Field(i), got.Field(i))
		}
	case reflect.Slice, reflect.Array:
		if want.Len() != got.Len() {
			c.discrete(path, fmt.Sprintf("length %d, want %d", got.Len(), want.Len()))
			return
		}
		if stride, ok := strides[path]; ok {
			shifts := [3]float64{c.m.shift.X, c.m.shift.Y, c.m.shift.Z}
			for i := 0; i < want.Len(); i++ {
				place := stride[i%len(stride)]
				c.number(path+place.name, place.kind, want.Index(i).Float(), got.Index(i).Float(), shifts[i%len(stride)%3])
			}
			return
		}
		for i := 0; i < want.Len(); i++ {
			c.walk(path, want.Index(i), got.Index(i))
		}
	case reflect.Map:
		if want.Len() != got.Len() {
			c.discrete(path, "map size differs")
		}
		for _, key := range want.MapKeys() {
			c.walk(path+"."+fmt.Sprint(key), want.MapIndex(key), got.MapIndex(key))
		}
	case reflect.Float32, reflect.Float64:
		k, ok := lookup(path, c.q)
		if !ok {
			k = asExact
			if want.Float() != math.Trunc(want.Float()) {
				c.d.unknown[path] = true
				return
			}
		}
		shift := 0.0
		if k == asOffset {
			if n := c.q.Implicit.Sections.Normal; n.norm() > 0 {
				shift = c.m.shift.dot(n.mul(1 / n.norm()))
			}
		}
		if k == asPosition {
			// A box's bounds, by their axis.
			switch path[len(path)-4] {
			case 'x':
				shift = c.m.shift.X
			case 'y':
				shift = c.m.shift.Y
			case 'z':
				shift = c.m.shift.Z
			}
		}
		c.number(path, k, want.Float(), got.Float(), shift)
	case reflect.Bool, reflect.String, reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		if !want.Equal(got) {
			c.discrete(path, fmt.Sprintf("%v, want %v", got, want))
		}
	default:
		c.d.unknown[path+" ("+want.Kind().String()+")"] = true
	}
}

// nearby is the largest distance from a point of one set to the nearest
// of the other, both ways (their Hausdorff distance), with the first set
// moved by m.
func nearby(m similarity, want, got []Vec3) float64 {
	moved := make([]Vec3, len(want))
	for i, p := range want {
		moved[i] = m.point(p)
	}
	return math.Max(farthest(moved, got), farthest(got, moved))
}

// farthest is the largest distance from a point of a to its nearest in b,
// found on a grid of cells about as wide as b's points are apart.
func farthest(a, b []Vec3) float64 {
	if len(a) == 0 || len(b) == 0 {
		if len(a) == len(b) {
			return 0
		}
		return math.Inf(1)
	}
	lo, hi := b[0], b[0]
	for _, p := range b {
		lo = Vec3{math.Min(lo.X, p.X), math.Min(lo.Y, p.Y), math.Min(lo.Z, p.Z)}
		hi = Vec3{math.Max(hi.X, p.X), math.Max(hi.Y, p.Y), math.Max(hi.Z, p.Z)}
	}
	cell := hi.sub(lo).norm()/math.Cbrt(float64(len(b))) + 1e-300
	key := func(p Vec3) [3]int {
		q := p.sub(lo).mul(1 / cell)
		return [3]int{int(math.Floor(q.X)), int(math.Floor(q.Y)), int(math.Floor(q.Z))}
	}
	grid := map[[3]int][]Vec3{}
	for _, p := range b {
		grid[key(p)] = append(grid[key(p)], p)
	}
	worst := 0.0
	for _, p := range a {
		k, best := key(p), math.Inf(1)
		// Search outward ring by ring until a ring's nearest point beats
		// the distance the next ring could hold.
		for ring := 0; ring < 1<<20 && float64(ring-1)*cell < best; ring++ {
			for i := -ring; i <= ring; i++ {
				for j := -ring; j <= ring; j++ {
					for l := -ring; l <= ring; l++ {
						if max(abs(i), abs(j), abs(l)) != ring {
							continue
						}
						for _, q := range grid[[3]int{k[0] + i, k[1] + j, k[2] + l}] {
							best = math.Min(best, p.sub(q).norm())
						}
					}
				}
			}
		}
		worst = math.Max(worst, best)
	}
	return worst
}

func abs(i int) int { return max(i, -i) }

// offLevel is how far p is from the level set F = c, to first order:
// |F − c| / |∇F|, with ∇F differenced over a millionth of a cell.
func offLevel(f expr.SpatialField, c float64, p Vec3, cell float64) float64 {
	h := 1e-6 * cell
	at := func(q Vec3) float64 { return f(q.X, q.Y, q.Z, 0) }
	g := Vec3{
		at(p.add(Vec3{h, 0, 0})) - at(p.sub(Vec3{h, 0, 0})),
		at(p.add(Vec3{0, h, 0})) - at(p.sub(Vec3{0, h, 0})),
		at(p.add(Vec3{0, 0, h})) - at(p.sub(Vec3{0, 0, h})),
	}.mul(1 / (2 * h))
	if g.norm() == 0 {
		return 0
	}
	return math.Abs(at(p)-c) / g.norm()
}

// vertices are an implicit mesh's positions, its sections' points, and
// the corners of their planes in the box.
func vertices(r *ImplicitResult) (mesh, sections, polygons []Vec3) {
	for i := 0; i+2 < len(r.Positions); i += 3 {
		mesh = append(mesh, Vec3{r.Positions[i], r.Positions[i+1], r.Positions[i+2]})
	}
	for _, s := range r.Sections {
		polygons = append(polygons, s.Polygon...)
		for _, p := range s.Paths {
			sections = append(sections, p.Points...)
		}
	}
	return mesh, sections, polygons
}

// captureTie accepts a different reported pair only when both pairs are
// adjacent and at the capture distance in both returned final states.
// A symmetric chase can capture several pairs at once; translating it
// changes which rounded gap is smallest. The 10⁻⁶ relative gap budget is
// separate from the much looser trajectory-position budget.
func captureTie(want, got *PursuitResult, eps, scale float64) bool {
	if want == nil || got == nil || want.Capture == nil || got.Capture == nil || len(want.Final) != len(got.Final) {
		return false
	}
	n := len(want.Final)
	for _, pair := range [][2]int{
		{want.Capture.Pursuer, want.Capture.Target},
		{got.Capture.Pursuer, got.Capture.Target},
	} {
		i, j := pair[0], pair[1]
		if i < 0 || i >= n || j != (i+1)%n {
			return false
		}
		for _, state := range []struct {
			points []Vec3
			scale  float64
		}{{want.Final, 1}, {got.Final, scale}} {
			gap := state.points[j].sub(state.points[i]).norm() / state.scale
			if !finite(gap) || math.Abs(gap-eps) > 1e-6*eps {
				return false
			}
		}
	}
	return true
}

// compare computes q and its copy under m with every diagnostic and
// compares their results under the copy's budget.
func compare(t *testing.T, q Request, m similarity) (*deviation, budget, bool) {
	t.Helper()
	q.Diagnostics, q.SurfaceDiagnostics = true, true
	ref, cp, ok := similar(q, m)
	if !ok {
		return nil, budget{}, false
	}
	// A curve evaluated at any parameter is probed too, between samples.
	if ref.probedAnywhere() {
		lo, hi := ref.Curve.Min, ref.Curve.Max
		if ref.Format == "harmonic" {
			lo, hi = ref.Harmonic.Min, ref.Harmonic.Max
		}
		at := lo + 0.3719*(hi-lo)
		ref.Probe, cp.Probe = &ProbeQuery{T: &at}, &ProbeQuery{T: &at}
	}
	want, err := Compute(ref)
	if err != nil {
		t.Fatalf("original: %v", err)
	}
	got, err := Compute(cp)
	if err != nil {
		t.Fatalf("copy: %v", err)
	}
	b := budgetFor(ref, m)
	if m.shift != (Vec3{}) && captureTie(want.Pursuit, got.Pursuit, ref.Pursuit.Capture, m.scale) {
		tolerated := b.tolerated
		b.tolerated = func(path string) bool {
			return tolerated(path) || path == "pursuit.capture.pursuer" || path == "pursuit.capture.target"
		}
	}
	d := &deviation{worst: map[string]float64{}, where: map[string]string{}, unknown: map[string]bool{}}
	comparison{m: m, q: ref, b: b, radius: want.Bounds.Radius, d: d}.walk("", reflect.ValueOf(want), reflect.ValueOf(got))
	if want.Implicit != nil && b.skipped("implicit.positions") {
		// The moved mesh and sections have every point of the original's
		// (within the budget's share of a grid cell), and every point they
		// add, where the original's F is exactly zero at a grid point or a
		// corner, lies on the original's level set.
		box := ref.Implicit.Box
		cell := math.Max(box.XMax-box.XMin, math.Max(box.YMax-box.YMin, box.ZMax-box.ZMin)) / float64(ref.Implicit.Cells)
		f, _, err := expr.ParseSpatialField(ref.Implicit.F, ref.Implicit.A)
		if err != nil {
			t.Fatal(err)
		}
		wm, ws, wp := vertices(want.Implicit)
		gm, gs, gp := vertices(got.Implicit)
		moved := func(ps []Vec3) []Vec3 {
			out := make([]Vec3, len(ps))
			for i, p := range ps {
				out[i] = m.point(p)
			}
			return out
		}
		worst := func(class, what string, r float64) {
			if r /= cell; r > d.worst[class] || d.where[class] == "" {
				d.worst[class], d.where[class] = math.Max(r, d.worst[class]), what
			}
		}
		worst("cells", "an original mesh vertex", farthest(moved(wm), gm))
		worst("cells", "an original section point", farthest(moved(ws), gs))
		worst("cells", "a section plane's corner", nearby(m, wp, gp))
		for _, p := range append(gm, gs...) {
			worst("level", "a moved point off the level set", offLevel(f, ref.Implicit.Level, p.sub(m.shift).mul(1/m.scale), cell))
		}
	}
	return d, b, true
}

// similarlyMoved checks a copy of q under m against q, under the copy's
// budget.
func similarlyMoved(t *testing.T, q Request, m similarity) {
	t.Helper()
	d, b, ok := compare(t, q, m)
	if !ok {
		t.Skip("surfaces and mirrors are placed at the origin, so they are only scaled, and only curves are made tinier")
	}
	for p := range d.unknown {
		t.Errorf("unclassified %s", p)
	}
	for _, e := range d.discrete {
		t.Errorf("differs: %s", e)
	}
	t.Logf("worst %v at %v", d.worst, d.where)
	for class, worst := range d.worst {
		if limit := b.worst[class]; worst > limit {
			t.Errorf("%s differ by %.3g, beyond %.0g, at %s", class, worst, limit, d.where[class])
		}
	}
}

// Every spatial preset, tiny, tinier, huge and far from the origin, gives
// the same study moved: the same counts, flags and gaps, and the same
// numbers to within the copy's budget.
func TestSimilarPresets(t *testing.T) {
	all := spatialPresets(t)
	names := make([]string, 0, len(all))
	for n := range all {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, m := range similarities {
		for _, name := range names {
			t.Run(m.name+"/"+name, func(t *testing.T) {
				// Each case repeatedly exercises the same evaluation paths.
				// Running them together makes atomic coverage counters contend
				// severely under -race -cover, exceeding the CI time budget.
				if chaotic[name] && m.shift != (Vec3{}) {
					t.Skip("chaotic: a far copy's trajectories separate from the original's")
				}
				similarlyMoved(t, all[name], m)
			})
		}
	}
}

// Studies no preset is, moved likewise: the tangent feet of a helix wound
// by a faster coil, refined between samples, and a line inverted in a sphere about a point it
// passes through, whose image runs off to infinity there and returns.
func TestSimilarStudies(t *testing.T) {
	feet := custom("2*cos(t)+0.2*cos(29*t)", "2*sin(t)+0.2*sin(29*t)", "t/3", -3, 3)
	feet.Construction, feet.Pole, feet.Adaptive, feet.Samples = "tangent-foot", Vec3{0.5, 0, 0}, true, 240
	through := custom("t", "0.5*t", "0", -10, 10.13)
	through.Construction, through.Samples = "inversion", 240
	through.Inversion = InversionRequest{Center: Vec3{}, Radius: 1, Input: "base"}
	if r, err := Compute(feet); err != nil || r.Adaptive == nil || r.Adaptive.Projection == nil || r.Adaptive.Projection.Inserted == 0 {
		t.Fatalf("the feet are not refined: %v", err)
	}
	if r, err := Compute(through); err != nil || r.Inversion.Crossings != 1 {
		t.Fatalf("the line's image does not pass through infinity once: %v", err)
	}
	for name, q := range map[string]Request{"feet": feet, "through": through} {
		for _, m := range append(append([]similarity{}, similarities...), extremes...) {
			t.Run(m.name+"/"+name, func(t *testing.T) { similarlyMoved(t, q, m) })
		}
	}
}

// A family's bounds scale with it, however small: the radius is not held
// at a floor that a tiny study's own size is below.
func TestFitScalesWithItsPoints(t *testing.T) {
	helix := func(s float64) []*Vec3 {
		var out []*Vec3
		for i := 0; i <= 64; i++ {
			u := float64(i) / 8
			out = append(out, &Vec3{s * math.Cos(u), s * math.Sin(u), s * u / 4})
		}
		return out
	}
	want := fit(helix(1))
	for _, s := range []float64{0x1p-16, 0x1p-30, 0x1p10} {
		got := fit(helix(s))
		if got.Radius != s*want.Radius || got.Center != want.Center.mul(s) {
			t.Errorf("scale %g: bounds %+v, want %+v scaled", s, got, want)
		}
	}
	// A single point has no size, and keeps a radius it can be framed by.
	if b := fit([]*Vec3{{1e-9, 0, 0}}); !(b.Radius > 0) {
		t.Errorf("a single point's radius is %g", b.Radius)
	}
}

// A curve's size, which its floors are measured in, scales with it and
// does not move with it; a curve standing still, its points apart only by
// rounding, has none.
func TestExtentIsTheCurvesOwn(t *testing.T) {
	helix := func(m similarity) func(float64) Vec3 {
		return func(u float64) Vec3 { return m.point(Vec3{2 * math.Cos(u), 2 * math.Sin(u), u / 3}) }
	}
	want := extent(helix(similarity{scale: 1}), 0, 6)
	if want <= 0 {
		t.Fatalf("the helix's size is %g", want)
	}
	for _, m := range append(append([]similarity{}, similarities...), extremes...) {
		if got := extent(helix(m), 0, 6); math.Abs(got-m.scale*want) > 1e-9*m.scale*want {
			t.Errorf("%s: size %g, want %g", m.name, got, m.scale*want)
		}
	}
	still := func(u float64) Vec3 { return Vec3{5000, -3000, 4000}.mul(1 + 4e-16*math.Sin(13*u)) }
	if got := extent(still, 0, 6); got != 0 {
		t.Errorf("a point that stands still has size %g", got)
	}
}

// A family's bounds move with it: where most of its points share a
// coordinate up to rounding, as a level curve's do, the rounding a shift
// adds does not make its quartiles distinct and trim its other points as
// outliers.
func TestFitMovesWithItsPoints(t *testing.T) {
	family := func(shift Vec3) []*Vec3 {
		var out []*Vec3
		for i := 0; i <= 900; i++ {
			u := float64(i) / 90
			p := Vec3{math.Cos(u), -math.Pi / 2, math.Sin(u)}
			if i%3 == 0 {
				p.Y += 5 * math.Sin(u)
			}
			// Each point is reached from the shift by its own path, so the
			// shared coordinate is rounded differently at each, by about
			// the shift's ulp.
			a := 7 * math.Sin(13*float64(i))
			q := shift.add(Vec3{a, a, a}).add(p.sub(Vec3{a, a, a}))
			out = append(out, &q)
		}
		return out
	}
	want := fit(family(Vec3{}))
	for _, shift := range []Vec3{{5000, -3000, 4000}, {60000, -50000, 70000}} {
		got := fit(family(shift))
		if math.Abs(got.Radius-want.Radius) > 1e-9*want.Radius || got.Center.sub(want.Center.add(shift)).norm() > 1e-9*want.Radius {
			t.Errorf("shift %v: bounds %+v, want %+v moved", shift, got, want)
		}
	}
}

// extremes are copies beyond the presets': larger, and farther from the
// origin, near the edge of the coordinates a study accepts.
var extremes = []similarity{
	{"larger", 0x1p16, Vec3{}},
	{"farther", 1, Vec3{60000, -50000, 70000}},
}

// sameGaps checks that every copy of c, the presets' and the extremes, has
// c's gaps and breaks.
func sameGaps(t *testing.T, c Request) {
	t.Helper()
	want, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range append(append([]similarity{}, similarities...), extremes...) {
		_, copied, _ := similar(c, m)
		got, err := Compute(copied)
		if err != nil {
			t.Fatalf("%s: %v", m.name, err)
		}
		for i := range want.Base {
			if (got.Base[i] == nil) != (want.Base[i] == nil) || got.Breaks[i] != want.Breaks[i] {
				t.Errorf("%s: sample %d is %v, break %v; want %v, break %v", m.name, i, got.Base[i], got.Breaks[i], want.Base[i], want.Breaks[i])
			}
		}
	}
}

// A numerically differentiated curve's cusp stays a gap at every scale and
// far from the origin: the cardioid traced by the tangent feet of the unit
// circle from a point on it stops at that point, sample 240 of 480.
func TestCuspSurvivesSimilarity(t *testing.T) {
	c := unitCircle(480)
	c.Input = "tangent-foot"
	c.Pole = Vec3{-1, 0, 0}
	want, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	if want.Base[240] != nil || !want.Breaks[240] || !want.Breaks[241] {
		t.Fatalf("the cusp is drawn: %v, breaks %v %v", want.Base[240], want.Breaks[240], want.Breaks[241])
	}
	sameGaps(t, c)
}

// A jump stays a break at every scale: y = |t − 1|/(t − 1) steps from −1
// to 1 between samples 119 and 120, while the curve moves along x.
func TestJumpSurvivesSimilarity(t *testing.T) {
	c := custom("t", "abs(t-1)/(t-1)", "0", 0, 2.01)
	c.Samples = 240
	want, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	for i, b := range want.Breaks {
		if b != (i == 120) {
			t.Fatalf("break %d is %v", i, b)
		}
	}
	sameGaps(t, c)
}

// An acceleration that is not stable stays unknown at every scale: y =
// |t|^1.5 has r″ ~ |t|^−½ at t = 0, sample 120 of 240, so the curvature
// there is unknown, as is the binormal.
func TestUnstableAccelerationSurvivesSimilarity(t *testing.T) {
	c := custom("t", "abs(t)*sqrt(abs(t))", "0", -1, 1)
	c.Samples = 240
	c.Diagnostics = true
	want, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	if want.Diagnostics.Curvature[120] != nil {
		t.Fatalf("the curvature at the singular point is %v", *want.Diagnostics.Curvature[120])
	}
	for _, m := range append(append([]similarity{}, similarities...), extremes...) {
		_, copied, _ := similar(c, m)
		got, err := Compute(copied)
		if err != nil {
			t.Fatalf("%s: %v", m.name, err)
		}
		for i, k := range want.Diagnostics.Curvature {
			if (got.Diagnostics.Curvature[i] == nil) != (k == nil) {
				t.Errorf("%s: curvature %d is known %v, want %v", m.name, i, got.Diagnostics.Curvature[i] != nil, k != nil)
			}
		}
	}
}

// A cusp at the end of the domain, where the stencils are one-sided, stays
// a gap far from the origin: the tangent feet of a circle, lifted by a
// wave, from a point it passes at t = ±π.
func TestEndpointCuspSurvivesSimilarity(t *testing.T) {
	c := Request{Format: "harmonic", Construction: "developable", Input: "tangent-foot", Pole: Vec3{-1, 0, 0},
		Samples: 1200, Lines: 24, Length: 1, Harmonic: HarmonicCurve{Terms: []HarmonicTerm{
			{Frequency: 1, Cosine: Vec3{1, 0, 0}, Sine: Vec3{0, 1, 0}},
			{Frequency: 2, Sine: Vec3{0, 0, 0.35}},
		}, Min: -math.Pi, Max: math.Pi}}
	want, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	if want.Base[0] != nil || want.Base[c.Samples] != nil {
		t.Fatalf("the cusps are drawn: %v, %v", want.Base[0], want.Base[c.Samples])
	}
	sameGaps(t, c)
}
