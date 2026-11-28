package threebody

import (
	"math"

	"tangentgarden/engine"
)

// Case is one reference configuration, in the fixture units: G = 1, total
// mass 1, and lengths such that the body farthest from the center of mass
// starts at distance 1. Published data is mapped there by m′ = m/M,
// r′ = r/λ, v′ = v√(λ/M) and t′ = t√(M/λ³), with λ that farthest distance
// in the published units; Length is λ and TimeFactor √(M/λ³). Cases built
// in these units have both 1. The three classifications are separate:
// whether the orbit is periodic, what is established about its stability,
// and what the integration observed.
type Case struct {
	Name       string  `json:"name"`
	Title      string  `json:"title"`
	Source     string  `json:"source"`
	Bodies     []Body  `json:"bodies"`
	Length     float64 `json:"length"`
	TimeFactor float64 `json:"timeFactor"`
	// The period in fixture units, 0 when none is known, and as published.
	Period          float64 `json:"period"`
	PublishedPeriod float64 `json:"publishedPeriod"`
	Duration        float64 `json:"duration"`
	Periodicity     string  `json:"periodicity"`
	Stability       string  `json:"stability"`
	Observed        string  `json:"observed"`
}

// normalize maps published masses, positions and velocities (G = 1) to the
// fixture units. Nothing is recentered: the center of mass keeps its place,
// scaled.
func normalize(m []float64, r, v [][2]float64) ([]Body, float64, float64) {
	M := 0.0
	var c [2]float64
	for i := range m {
		M += m[i]
		c[0] += m[i] * r[i][0]
		c[1] += m[i] * r[i][1]
	}
	c[0], c[1] = c[0]/M, c[1]/M
	lambda := 0.0
	for i := range r {
		lambda = math.Max(lambda, math.Hypot(r[i][0]-c[0], r[i][1]-c[1]))
	}
	speed := math.Sqrt(lambda / M)
	out := make([]Body, len(m))
	for i := range m {
		out[i] = Body{
			Mass:     m[i] / M,
			Position: engine.Vec{X: r[i][0] / lambda, Y: r[i][1] / lambda},
			Velocity: engine.Vec{X: v[i][0] * speed, Y: v[i][1] * speed},
		}
	}
	return out, lambda, math.Sqrt(M / (lambda * lambda * lambda))
}

// lagrange is the equilateral relative equilibrium of masses m (total 1)
// about their center of mass at the origin, turning counterclockwise at
// ω = √(M/s³), sized so the farthest body is at distance 1.
func lagrange(m []float64) ([]Body, float64) {
	var q [3][2]float64
	var c [2]float64
	for k := range q {
		th := math.Pi/2 + 2*math.Pi*float64(k)/3
		q[k] = [2]float64{math.Cos(th) / math.Sqrt(3), math.Sin(th) / math.Sqrt(3)}
		c[0] += m[k] * q[k][0]
		c[1] += m[k] * q[k][1]
	}
	far := 0.0
	for k := range q {
		q[k][0] -= c[0]
		q[k][1] -= c[1]
		far = math.Max(far, math.Hypot(q[k][0], q[k][1]))
	}
	side := 1 / far
	omega := math.Sqrt(1 / (side * side * side))
	out := make([]Body, 3)
	for k := range q {
		x, y := q[k][0]*side, q[k][1]*side
		out[k] = Body{Mass: m[k], Position: engine.Vec{X: x, Y: y}, Velocity: engine.Vec{X: -omega * y, Y: omega * x}}
	}
	return out, 2 * math.Pi / omega
}

// Corpus is the reference configurations.
func Corpus() []Case {
	var cases []Case

	// The figure-eight, as printed on Montgomery's page (thanks to Simó):
	// masses 1, G = 1, r₁ = −r₂ = (−0.97000436, 0.24308753), r₃ = 0,
	// v₃ = (0.93240737, 0.86473146), v₁ = v₂ = −v₃/2. Many secondary
	// sources negate every value, the same orbit turned by π. The page
	// prints no period; 6.32591398 is the published value for these data.
	r1 := [2]float64{-0.97000436, 0.24308753}
	v3 := [2]float64{0.93240737, 0.86473146}
	v1 := [2]float64{-v3[0] / 2, -v3[1] / 2}
	bodies, lambda, tf := normalize([]float64{1, 1, 1},
		[][2]float64{r1, {-r1[0], -r1[1]}, {0, 0}},
		[][2]float64{v1, v1, v3})
	cases = append(cases, Case{
		Name: "figure-eight", Title: "Figure-eight",
		Source: "Chenciner and Montgomery (2000); initial conditions by Simó, as printed at people.ucsc.edu/~rmont/NbdyB.html",
		Bodies: bodies, Length: lambda, TimeFactor: tf,
		PublishedPeriod: 6.32591398, Period: 6.32591398 * tf, Duration: 3 * 6.32591398 * tf,
		Periodicity: "periodic: a choreography, each body on the same curve a third of a period apart",
		Stability:   "linearly stable (Roberts 2007) and, numerically, KAM stable (Simó)",
		Observed:    "over 100 time units the history stays within 4·10⁻⁹ of an independent high-precision reference, and the labeled positions and velocities return within 6·10⁻¹⁰ after one period",
	})

	equal := []float64{1.0 / 3, 1.0 / 3, 1.0 / 3}
	bodies, period := lagrange(equal)
	cases = append(cases, Case{
		Name: "lagrange-equal", Title: "Lagrange's triangle, equal masses",
		Source: "Lagrange (1772): an equilateral relative equilibrium", Bodies: bodies, Length: 1, TimeFactor: 1,
		Period: period, Duration: 2 * period,
		Periodicity: "periodic: a rigid rotation",
		Stability:   "linearly unstable: Routh's value 27(m₁m₂+m₁m₃+m₂m₃)/M² is 9, above 1",
		Observed:    "rounding alone breaks the rotation: the history stays within 10⁻⁶ of an independent high-precision reference only until t = 72.6",
	})

	routh := []float64{0.97, 0.025, 0.005}
	bodies, period = lagrange(routh)
	cases = append(cases, Case{
		Name: "lagrange-routh", Title: "Lagrange's triangle, one heavy body",
		Source: "Lagrange (1772); Routh (1875)", Bodies: bodies, Length: 1, TimeFactor: 1,
		Period: period, Duration: 6 * period,
		Periodicity: "periodic: a rigid rotation",
		Stability:   "linearly stable: Routh's value 27(m₁m₂+m₁m₃+m₂m₃)/M² is 0.79, below 1",
		Observed:    "over 100 time units the history stays within 4·10⁻⁹ of an independent high-precision reference",
	})

	// An inner circular binary (0.4, 0.4; separation 0.2) and a third body
	// (0.2) on a circular orbit 1.25 from the binary's center.
	vOut := math.Sqrt(1 / 1.25)
	cases = append(cases, Case{
		Name: "hierarchical", Title: "Hierarchical triple",
		Source: "constructed; Mardling and Aarseth (2001) criterion", Length: 1, TimeFactor: 1,
		Bodies: []Body{
			{Mass: 0.4, Position: engine.Vec{X: -0.35}, Velocity: engine.Vec{Y: -1 - 0.2*vOut}},
			{Mass: 0.4, Position: engine.Vec{X: -0.15}, Velocity: engine.Vec{Y: 1 - 0.2*vOut}},
			{Mass: 0.2, Position: engine.Vec{X: 1}, Velocity: engine.Vec{Y: 0.8 * vOut}},
		},
		Duration:    20,
		Periodicity: "not known to be periodic",
		Stability:   "regular by the empirical Mardling–Aarseth criterion (outer to inner separation 6.25 against about 3.1), not proven",
		Observed:    "over 100 time units the history stays within 10⁻⁷ of an independent high-precision reference",
	})

	// Burrau's problem: masses 3, 4, 5 at rest at the corners of a 3-4-5
	// right triangle, each opposite the side of its own length.
	bodies, lambda, tf = normalize([]float64{3, 4, 5},
		[][2]float64{{1, 3}, {-2, -1}, {1, -1}}, make([][2]float64, 3))
	cases = append(cases, Case{
		Name: "pythagorean", Title: "Pythagorean problem",
		Source: "Burrau (1913); Szebehely and Peters (1967)", Bodies: bodies, Length: lambda, TimeFactor: tf,
		Duration:    math.Min(100, 70*tf),
		Periodicity: "not periodic: it ends with the lightest body ejected and the others bound",
		Stability:   "unstable: it disintegrates",
		Observed:    "the history stays within 10⁻⁶ of an independent high-precision reference until t = 28.1 and within 10⁻³ until t = 37.3; later positions are not reproducible, but the outcome is: under perturbations of 10⁻¹³ body 1 is still ejected",
	})

	// Lagrange's equal-mass triangle with body 1 moved outward by 10⁻⁶.
	bodies, _ = lagrange(equal)
	bodies[0].Position = bodies[0].Position.Mul(1 + 1e-6)
	cases = append(cases, Case{
		Name: "broken-triangle", Title: "A broken triangle",
		Source: "Lagrange's equal-mass triangle, body 1 moved outward by 10⁻⁶", Bodies: bodies, Length: 1, TimeFactor: 1,
		Duration:    60,
		Periodicity: "not periodic",
		Stability:   "a perturbation of a linearly unstable equilibrium",
		Observed:    "the history stays within 10⁻⁶ of an independent high-precision reference until t = 83.8",
	})
	// Two bodies falling together from rest, the third above them: a
	// terminal to inspect, not an orbit. The history stops where bodies 1
	// and 2 come within the encounter floor.
	cases = append(cases, Case{
		Name: "head-on", Title: "A head-on encounter",
		Source: "constructed: bodies 1 and 2 at rest 0.5 apart", Length: 1, TimeFactor: 1,
		Bodies: []Body{
			{Mass: 0.45, Position: engine.Vec{X: -0.25}},
			{Mass: 0.45, Position: engine.Vec{X: 0.25}},
			{Mass: 0.1, Position: engine.Vec{Y: 10.0 / 9}},
		},
		Duration:    2,
		Periodicity: "not periodic: a collision orbit",
		Stability:   "not applicable: Newtonian point masses collide, which the study does not continue",
		Observed:    "the history stops where bodies 1 and 2 come within 10⁻⁴ of each other, at t = 0.4126",
	})
	return cases
}

func caseNamed(name string) Case {
	for _, c := range Corpus() {
		if c.Name == name {
			return c
		}
	}
	panic("no case " + name)
}
