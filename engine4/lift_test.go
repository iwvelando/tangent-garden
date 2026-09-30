package engine4

import (
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"strings"
	"testing"
)

func liftRequest(t *testing.T, mode string, center Vec3, support, height float64) Request {
	t.Helper()
	data, _ := json.Marshal(map[string]any{"object": "lift", "mode": mode, "samples": 8,
		"lift": map[string]any{"center": center, "support": support, "height": height, "angle": math.Pi / 4,
			"from": Vec3{-5, 0, 0}, "to": Vec3{5, 0, 0}, "radiusFrom": .05, "radiusTo": 2.5}})
	var q Request
	if err := json.Unmarshal(data, &q); err != nil {
		t.Fatal(err)
	}
	return q
}
func liftResult(t *testing.T, q Request) Result {
	t.Helper()
	r, err := Compute(q)
	if err != nil {
		t.Fatal(err)
	}
	return r
}
func sourcePaths(r Result, source string) []Path {
	var out []Path
	for _, p := range r.Paths {
		if p.Source == source && !p.Guide {
			out = append(out, p)
		}
	}
	return out
}
func TestLiftMissingMiddle(t *testing.T) {
	q := liftRequest(t, "reference", Vec3{}, 2, .32)
	r := liftResult(t, q)
	// epsilon=.02 gives missing radius sqrt(3), independently of sampling.
	pieces := sourcePaths(r, "lift/thread/2")
	if len(pieces) != 2 {
		t.Fatalf("two visible intervals required, got %d", len(pieces))
	}
	for i, p := range pieces {
		if p.Role != "reference" || p.Branch == "" {
			t.Fatal("missing interval identity", p)
		}
		for _, v := range p.Points {
			if dot(v, v) < 3-1e-10 {
				t.Fatalf("invisible interval joined: %v", v)
			}
		}
		endpoint := p.Points[len(p.Points)-1]
		if i == 1 {
			endpoint = p.Points[0]
		}
		if math.Abs(math.Abs(endpoint[0])-math.Sqrt(3)) > 1e-10 {
			t.Fatal("crossing not exact", endpoint)
		}
	}
	q.Mode = "lifted"
	full := sourcePaths(liftResult(t, q), "lift/thread/2")
	if len(full) != 1 {
		t.Fatal("lifted centerline lost connectivity")
	}
	// The declared xw presentation rotates exterior points too, with w=0.
	if math.Abs(full[0].Points[0][0]+3/math.Sqrt(2)) > 1e-10 {
		t.Fatal("undeclared projection")
	}
}

func TestLiftCircleSeamContactIsOnePresentInterval(t *testing.T) {
	for _, samples := range []int{8, 64, 256} {
		q := liftRequest(t, "reference", Vec3{-1.75, 0, .5}, 3.5/math.Sqrt(.75), .32)
		q.Samples = samples
		r := liftResult(t, q)
		paths := sourcePaths(r, "lift/circle")
		if len(paths) != 1 {
			t.Fatalf("one seam contact required, got %d paths", len(paths))
		}
		p := paths[0]
		if !reflect.DeepEqual(p.Parameters, []float64{0, 0}) || !reflect.DeepEqual(p.Points, []Vec3{{1.75, 0, .5}, {1.75, 0, .5}}) {
			t.Fatal("seam contact must have one canonical parameter and exact coordinates", p)
		}
		if r.Lift.VisibleIntervals != 6 {
			t.Fatal("seam contact counted twice", r.Lift)
		}
		q.Mode = "lifted"
		if liftResult(t, q).Lift.VisibleIntervals != 6 {
			t.Fatal("linked construction reports a different reference count")
		}
	}
}

func TestLiftCircleVisibleArcAcrossSeamCountsOnce(t *testing.T) {
	for _, samples := range []int{8, 64, 256} {
		q := liftRequest(t, "reference", Vec3{-1.75, 0, .5}, 1, .32)
		q.Samples = samples
		r := liftResult(t, q)
		paths := sourcePaths(r, "lift/circle")
		if len(paths) != 2 {
			t.Fatalf("two parameter pieces required without bridging the hole, got %d", len(paths))
		}
		// Distance to the center is 3.5 |cos(pi*t)|; r_missing=sqrt(.75).
		cut := math.Acos(math.Sqrt(.75)/3.5) / math.Pi
		for i, p := range paths {
			wantLo, wantHi := 0., cut
			if i == 1 {
				wantLo, wantHi = 1-cut, 1.
			}
			if math.Abs(p.Parameters[0]-wantLo) > 1e-12 || math.Abs(p.Parameters[len(p.Parameters)-1]-wantHi) > 1e-12 {
				t.Fatal("incorrect wrapped arc endpoints", p.Parameters)
			}
			for _, v := range p.Points {
				d := sub(v, q.Lift.Center)
				if dot(d, d) < .75-1e-12 {
					t.Fatal("missing circle interval bridged", v)
				}
			}
		}
		if paths[0].Points[0] != paths[1].Points[len(paths[1].Points)-1] {
			t.Fatal("wrapped arc lost exact seam continuity")
		}
		if r.Lift.VisibleIntervals != 9 { // eight line intervals and one connected circular arc
			t.Fatal("parameter seam inflated connected interval count", r.Lift)
		}
		q.Mode = "lifted"
		if liftResult(t, q).Lift.VisibleIntervals != 9 {
			t.Fatal("linked construction reports a different reference count")
		}
	}
}

func TestLiftSeamContactsBelongToAdjacentArcButLineEndsStayDistinct(t *testing.T) {
	for _, cy := range []float64{-1, 1} {
		q := liftRequest(t, "reference", Vec3{1.75, cy, .5}, 1/math.Sqrt(.75), .32)
		p := sourcePaths(liftResult(t, q), "lift/circle")
		if len(p) != 1 || p[0].Parameters[0] == p[0].Parameters[len(p[0].Parameters)-1] {
			t.Fatal("seam contact duplicated outside its adjacent present arc", p)
		}
		if cy > 0 && p[0].Parameters[len(p[0].Parameters)-1] != 1 || cy < 0 && p[0].Parameters[0] != 0 {
			t.Fatal("arc lost its seam endpoint", p)
		}
	}
	q := liftRequest(t, "reference", Vec3{}, 3/math.Sqrt(.75), .32)
	r := liftResult(t, q)
	p := sourcePaths(r, "lift/thread/2")
	if len(p) != 2 || p[0].Points[0][0] != -3 || p[1].Points[0][0] != 3 || r.Lift.VisibleIntervals != 10 {
		t.Fatal("open line endpoints were identified as a circle seam", p, r.Lift)
	}
}
func TestLiftSlabAndExterior(t *testing.T) {
	for _, height := range []float64{0, .01, .02} {
		r := liftResult(t, liftRequest(t, "reference", Vec3{}, 2, height))
		if len(sourcePaths(r, "lift/thread/2")) != 1 {
			t.Fatal("height at/below thickness removed material")
		}
	}
	r := liftResult(t, liftRequest(t, "reference", Vec3{10, 0, 0}, 2, 1))
	if len(sourcePaths(r, "lift/thread/2")) != 1 {
		t.Fatal("exterior changed")
	}
}
func TestLiftWholeAbsenceTangencyAndDrift(t *testing.T) {
	if len(sourcePaths(liftResult(t, liftRequest(t, "reference", Vec3{}, 20, 1)), "lift/thread/2")) != 0 {
		t.Fatal("wholly absent segment retained")
	}
	// Choose L so r_missing=1, with the middle thread tangent at y=1.
	q := liftRequest(t, "reference", Vec3{0, 1, 0}, 2/math.Sqrt(3), .32)
	p := sourcePaths(liftResult(t, q), "lift/thread/2")
	if len(p) != 1 || p[0].Points[0][0] != -3 || p[0].Points[len(p[0].Points)-1][0] != 3 {
		t.Fatal("tangency cut a present thread")
	}
	for _, cx := range []float64{2.5, 3, 3.5} {
		r := liftResult(t, liftRequest(t, "reference", Vec3{cx, 0, 0}, 2, .32))
		for _, p := range sourcePaths(r, "lift/thread/2") {
			for _, v := range p.Points {
				if (v[0]-cx)*(v[0]-cx) < 3-1e-10 {
					t.Fatal("drift bridged missing endpoint")
				}
			}
		}
	}
}
func TestLiftCircleExactClipping(t *testing.T) {
	r := liftResult(t, liftRequest(t, "reference", Vec3{1.75, 0, .5}, .5, .32))
	paths := sourcePaths(r, "lift/circle")
	if len(paths) != 1 {
		t.Fatalf("circle must keep one open arc, got %d", len(paths))
	}
	p := paths[0]
	radius := .5 * math.Sqrt(.75)
	for _, v := range []Vec3{p.Points[0], p.Points[len(p.Points)-1]} {
		d := sub(v, Vec3{1.75, 0, .5})
		if math.Abs(math.Sqrt(dot(d, d))-radius) > 1e-10 {
			t.Fatal("circle boundary residual", v)
		}
	}
	if p.Points[0] == p.Points[len(p.Points)-1] {
		t.Fatal("missing circle interval joined")
	}
}
func TestLiftExistingTesseractUnaffected(t *testing.T) {
	r := liftResult(t, Request{Mode: "section", Count: 1})
	if r.Sections[0].Vertices != 8 || r.Sections[0].Edges != 12 || r.Sections[0].Faces != 6 {
		t.Fatal("existing cube changed", r.Sections)
	}
}

func TestLiftReturnedMembershipProjectionAndBounds(t *testing.T) {
	for _, center := range []Vec3{{}, {.37, -.26, .1}, {1.75, 0, .5}, {0, 0, 5}} {
		for _, support := range []float64{.05, 1.2, 2, 20} {
			q := liftRequest(t, "lifted", center, support, .32)
			q.Samples = 64
			r := liftResult(t, q)
			expected := support * math.Sqrt(.75)
			if math.Abs(r.Lift.MissingRadius-expected) > 1e-12 || r.Lift.Thickness != .02 {
				t.Fatal("incorrect slab diagnostic", r.Lift)
			}
			for _, path := range r.Paths {
				if path.Guide {
					continue
				}
				if len(path.Parameters) != len(path.Points) || len(path.FourPoints) != len(path.Points) {
					t.Fatal("lost parameter correspondence")
				}
				for i, v := range path.FourPoints {
					d := Vec3{v[0] - center[0], v[1] - center[1], v[2] - center[2]}
					s2 := dot(d, d) / (support * support)
					height := 0.
					if s2 < 1 {
						height = .32 * math.Pow(1-s2, 2)
					}
					if math.Abs(v[3]-height) > 1e-13 {
						t.Fatal("returned coordinate violates bump", v)
					}
					want := Vec3{(v[0] - v[3]) / math.Sqrt(2), v[1], v[2]}
					if math.Sqrt(dot(sub(want, path.Points[i]), sub(want, path.Points[i]))) > 1e-12 {
						t.Fatal("projection does not use returned w")
					}
					if norm(v) > r.Radius+1e-12 {
						t.Fatal("framing too small")
					}
				}
			}
			q.Mode = "reference"
			reference := liftResult(t, q)
			q.Lift.Angle = -2.1
			if !reflect.DeepEqual(reference, liftResult(t, q)) {
				t.Fatal("presentation altered reference membership")
			}
			for _, path := range reference.Paths {
				if !path.Guide {
					for _, v := range path.FourPoints {
						d := Vec3{v[0] - center[0], v[1] - center[1], v[2] - center[2]}
						s2 := dot(d, d) / (support * support)
						height := 0.
						if s2 < 1 {
							height = .32 * math.Pow(1-s2, 2)
						}
						if v[3] != 0 || height > .02+1e-9 {
							t.Fatal("slab membership violated")
						}
					}
				}
			}
		}
	}
}
func TestLiftCircleTangenciesAndContactIdentity(t *testing.T) {
	// Internal sphere tangency leaves one point of the circle, at x=-1.75.
	q := liftRequest(t, "reference", Vec3{1.75, 0, .5}, 3.5/math.Sqrt(.75), .32)
	p := sourcePaths(liftResult(t, q), "lift/circle")
	if len(p) != 1 || len(p[0].Points) != 2 || p[0].Points[0] != p[0].Points[1] || math.Abs(p[0].Points[0][0]+1.75) > 1e-10 {
		t.Fatal("isolated circle contact lost", p)
	}
	q.Lift.Center = Vec3{0, 0, .5}
	q.Lift.Support = 1.75 / math.Sqrt(.75)
	if len(sourcePaths(liftResult(t, q), "lift/circle")) != 1 {
		t.Fatal("coincident boundary circle lost")
	}
	q.Lift.Center = Vec3{1.75, 0, .5}
	q.Lift.Support = .05
	q.Samples = 8
	r := liftResult(t, q)
	circle := sourcePaths(r, "lift/circle")
	if len(circle) != 1 || circle[0].Parameters[0] <= 0 || circle[0].Parameters[len(circle[0].Parameters)-1] >= 1 {
		t.Fatal("subsample seam hole bridged")
	}
}
func TestLiftReferenceIgnoresInactivePresentationAngle(t *testing.T) {
	q := liftRequest(t, "reference", Vec3{}, 2, .32)
	before := liftResult(t, q)
	q.Lift.Angle = 1e9
	if !reflect.DeepEqual(before, liftResult(t, q)) {
		t.Fatal("inactive presentation angle changed the reference slice")
	}
}
func TestLiftTinyKnownMissingIntervalIsNotBridged(t *testing.T) {
	q := liftRequest(t, "reference", Vec3{.123, 0, 0}, .05, .020000001)
	paths := sourcePaths(liftResult(t, q), "lift/thread/2")
	if len(paths) != 2 {
		t.Fatalf("tiny analytic interval between subdivisions must stay open, got %d pieces", len(paths))
	}
}
func TestLiftReferenceCoordinatesLieInDeclaredSlice(t *testing.T) {
	r := liftResult(t, liftRequest(t, "reference", Vec3{}, 2, .32))
	for _, path := range r.Paths {
		for _, v := range path.FourPoints {
			if v[3] != 0 {
				t.Fatal("reference geometry must occupy w = 0", v)
			}
		}
	}
}
func TestLiftActualChordConvergence(t *testing.T) {
	for _, mode := range []string{"reference", "lifted"} {
		errors := []float64{}
		for _, n := range []int{64, 128, 256} {
			q := liftRequest(t, mode, Vec3{.7, .4, .2}, 2, 1)
			q.Samples = n
			r := liftResult(t, q)
			worst := 0.
			for _, path := range r.Paths {
				if path.Guide {
					continue
				}
				for j := 1; j < len(path.Parameters); j++ {
					u := (path.Parameters[j-1] + path.Parameters[j]) / 2
					// Independent source and bump at the midpoint of an emitted chord.
					var v Vec3
					if path.Source == "lift/circle" {
						v = Vec3{1.75 * math.Cos(2*math.Pi*u), 1.75 * math.Sin(2*math.Pi*u), .5}
					} else {
						var k int
						fmt.Sscanf(path.Source, "lift/thread/%d", &k)
						v = Vec3{-3 + 6*u, float64(k-2) / 2, 0}
					}
					if mode == "lifted" {
						d := sub(v, q.Lift.Center)
						s2 := dot(d, d) / 4
						h := 0.
						if s2 < 1 {
							h = math.Pow(1-s2, 2)
						}
						v[0] = (v[0] - h) / math.Sqrt(2)
					}
					midpoint := Vec3{}
					for k := range midpoint {
						midpoint[k] = (path.Points[j-1][k] + path.Points[j][k]) / 2
					}
					d := sub(v, midpoint)
					worst = math.Max(worst, math.Sqrt(dot(d, d)))
				}
			}
			errors = append(errors, worst)
		}
		if errors[0]/errors[1] < 3.7 || errors[1]/errors[2] < 3.7 {
			t.Fatal("actual chord convergence", mode, errors)
		}
	}
}
func TestLiftValidationAndWorkBounds(t *testing.T) {
	q := liftRequest(t, "lifted", Vec3{}, 2, 10)
	q.Samples = 256
	r := liftResult(t, q)
	if len(r.Paths) > 75 || r.EmittedPoints > 2500 || r.Evaluations > 2700 {
		t.Fatal("fixed source budget exceeded", r.EmittedPoints, r.Evaluations, len(r.Paths))
	}
	// A high lift can exceed the whole guide/motion envelope. Check the
	// returned geometry, not just the framing formula at the default height.
	for _, path := range r.Paths {
		for _, v := range path.FourPoints {
			if norm(v) > r.Radius+1e-12 {
				t.Fatal("high lifted centerline lies outside the framing sphere", v, r.Radius)
			}
		}
	}
	for _, edit := range []struct {
		name   string
		change func(*Request)
	}{
		{"Reference", func(q *Request) { q.Mode = "section" }},
		{"parameters", func(q *Request) { q.Lift = nil }},
		{"Lift center", func(q *Request) { q.Lift.Center[1] = 21 }},
		{"Drift start", func(q *Request) { q.Lift.From[2] = math.NaN() }},
		{"Drift end", func(q *Request) { q.Lift.To[0] = math.Inf(1) }},
		{"radius L", func(q *Request) { q.Lift.Support = .049 }},
		{"Support start", func(q *Request) { q.Lift.RadiusFrom = 21 }},
		{"Support end", func(q *Request) { q.Lift.RadiusTo = 0 }},
		{"height A", func(q *Request) { q.Lift.Height = -.01 }},
		{"height A", func(q *Request) { q.Lift.Height = 10.01 }},
		{"xw angle", func(q *Request) { q.Mode = "lifted"; q.Lift.Angle = math.NaN() }},
		{"samples", func(q *Request) { q.Samples = 257 }},
	} {
		bad := liftRequest(t, "reference", Vec3{}, 2, 1)
		edit.change(&bad)
		if _, err := Compute(bad); err == nil || !strings.Contains(err.Error(), edit.name) {
			t.Fatal("validation", edit.name, err)
		}
	}
}
func TestLiftLargeBoundaryApproachesTangentPlane(t *testing.T) {
	departures := []float64{}
	for _, support := range []float64{10, 20} {
		radius := support * math.Sqrt(.75)
		q := liftRequest(t, "reference", Vec3{radius, 0, 0}, support, .32)
		paths := sourcePaths(liftResult(t, q), "lift/thread/4") // y=1, plane tangent at x=0
		x := paths[0].Points[len(paths[0].Points)-1][0]
		expected := 1 / (2 * radius)
		if math.Abs(x-expected) > 1/(4*radius*radius*radius) {
			t.Fatal("boundary/tangent-plane departure", x, expected)
		}
		departures = append(departures, x)
	}
	if math.Abs(departures[0]/departures[1]-2) > .01 {
		t.Fatal("quadratic departure scale", departures)
	}
}
func BenchmarkLiftMaximumSamples(b *testing.B) {
	q := Request{Object: "lift", Mode: "lifted", Samples: 256, Lift: &LiftParameters{Support: 2, Height: 10, Angle: math.Pi / 4, From: Vec3{-5, 0, 0}, To: Vec3{5, 0, 0}, RadiusFrom: .05, RadiusTo: 2.5}}
	b.ReportAllocs()
	for b.Loop() {
		if _, err := Compute(q); err != nil {
			b.Fatal(err)
		}
	}
}
