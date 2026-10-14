package engine3

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
)

// Refinement to the view: with a view, the pieces of each refined curve
// that the drawing shows are refined to a tolerance of the view's own size
// at their depth. Expectations come from the view's geometry, evaluated
// here independently of the engine's.

func viewed(c Request, v View) Request {
	c.Adaptive = true
	c.View = &v
	return c
}

// orthographic is a view looking down −z, with x to the right and y up.
func orthographic(center Vec3, width, height float64) View {
	return View{Center: center, Right: Vec3{1, 0, 0}, Up: Vec3{0, 1, 0}, Width: width, Height: height}
}

// pageOf places p on the view's page: x and y as fractions of its half
// width and height (within ±1 where drawn), and w, the depth ratio, the
// distance ahead of the eye over the view's distance (1 throughout for an
// orthographic view).
func pageOf(v View, p Vec3) (x, y, w float64) {
	d := p.sub(v.Center)
	w = 1
	if v.Distance > 0 {
		forward := v.Up.cross(v.Right)
		w = 1 + forward.dot(d)/v.Distance
	}
	return v.Right.dot(d) / (v.Width * w), v.Up.dot(d) / (v.Height * w), w
}

// viewChords measures a refined path's chords against the exact curve at
// 32 parameters inside each. A chord is in view when any of those points,
// or an end, lies on the view's page ahead of its near distance. inView is
// its largest error as a multiple of the view's tolerance at the chord's
// nearest depth (w, at least the near distance's); all is the largest
// error of any chord, longest the longest chord in view as a multiple of
// its limit at that depth, and shown the number of chords in view.
func viewChords(points []*Vec3, ts []float64, exact func(float64) Vec3, v View, tolerance, limit float64) (inView, all, longest float64, shown int) {
	nearest := 0.0
	if v.Distance > 0 {
		nearest = v.Near / v.Distance
	}
	for k := 1; k < len(points); k++ {
		a, b := points[k-1], points[k]
		if a == nil || b == nil {
			continue
		}
		worst, meets, w := 0.0, false, math.Inf(1)
		look := func(p Vec3) {
			x, y, depth := pageOf(v, p)
			w = math.Min(w, depth)
			if depth*math.Max(v.Distance, 1) >= v.Near && math.Abs(x) <= 1 && math.Abs(y) <= 1 {
				meets = true
			}
		}
		look(*a)
		look(*b)
		for j := 1; j < 32; j++ {
			p := exact(ts[k-1] + (ts[k]-ts[k-1])*float64(j)/32)
			worst = math.Max(worst, distanceToSegment(p, *a, *b))
			look(p)
		}
		all = math.Max(all, worst)
		if meets {
			shown++
			w = math.Max(w, nearest)
			inView = math.Max(inView, worst/(tolerance*w))
			longest = math.Max(longest, b.sub(*a).norm()/(limit*w))
		}
	}
	return inView, all, longest, shown
}

// parameters gives the curve's parameter at each point of a path sampled
// over [lo, hi] at n intervals.
func parameters(path *RefinedPath, lo, hi float64, n int) []float64 {
	ts := make([]float64, len(path.At))
	for k, u := range path.At {
		ts[k] = lo + (hi-lo)*u/float64(n)
	}
	return ts
}

// sameStudy reports whether two results agree in everything but their
// refined curves.
func sameStudy(t *testing.T, a, b Result) bool {
	t.Helper()
	a.Adaptive, b.Adaptive = nil, nil
	x, err := json.Marshal(a)
	if err != nil {
		t.Fatal(err)
	}
	y, _ := json.Marshal(b)
	return string(x) == string(y)
}

// A trefoil knot at 240 samples, seen from above through a window 0.06
// wide: the chords the window shows follow the knot to its tolerance,
// 2 × 10⁻⁴ of its half diagonal, with none longer than a quarter of it,
// and the rest to the study's.
func TestViewRefinesWhatItShows(t *testing.T) {
	c := study()
	c.Samples = 240
	c.Construction = "none"
	curve := func(u float64) Vec3 { return trefoilAt(c, u) }
	v := orthographic(curve(1), 0.03, 0.02)
	r := refinedStudy(t, viewed(c, v))
	path := r.Adaptive.Base
	checkPath(t, path, r.Base, r.Breaks)
	r0 := math.Hypot(v.Width, v.Height)
	tolerance := 2e-4 * r0
	if math.Abs(path.View-tolerance) > 1e-15 {
		t.Fatalf("view tolerance %g, want %g", path.View, tolerance)
	}
	if path.View > path.Tolerance/10 {
		t.Fatalf("view tolerance %g is not well below the study's %g", path.View, path.Tolerance)
	}
	if path.Exhausted || path.Unresolved != 0 || path.Breaks != 0 {
		t.Fatalf("exhausted %v, unresolved %d, breaks %d", path.Exhausted, path.Unresolved, path.Breaks)
	}
	ts := parameters(path, 0, 2*math.Pi, c.Samples)
	inView, all, longest, shown := viewChords(path.Points, ts, curve, v, tolerance, r0/4)
	if inView > 1.5 || longest > 1 || shown < 8 {
		t.Fatalf("in view, %d chords stray %g view tolerances and reach %g of the chord limit", shown, inView, longest)
	}
	if all > 1.5*path.Tolerance {
		t.Fatalf("chord error %g exceeds the study's tolerance %g", all, path.Tolerance)
	}
	// So is the margin of half the view's width and height on each side.
	margin := v
	margin.Width, margin.Height = 2*v.Width, 2*v.Height
	if e, _, _, _ := viewChords(path.Points, ts, curve, margin, tolerance, r0/4); e > 1.5 {
		t.Fatalf("chords in the view's margin stray %g view tolerances", e)
	}
	// Without the view, the chords there stray far beyond its tolerance.
	plain := refinedStudy(t, c)
	if plain.Adaptive.Base.View != 0 {
		t.Fatal("refined to a view without one")
	}
	if e, _, _, _ := viewChords(plain.Adaptive.Base.Points, parameters(plain.Adaptive.Base, 0, 2*math.Pi, c.Samples), curve, v, tolerance, r0/4); e < 3 {
		t.Fatalf("the study's refinement already follows the view: %g view tolerances", e)
	}
	if !sameStudy(t, r, plain) {
		t.Fatal("the view changed the rest of the result")
	}
}

// A thin helix running 20 units toward an eye on its axis: in a
// perspective, each chord is refined to the view's tolerance at its own
// depth, which grows in proportion to its distance from the eye, so the
// far turns, drawn small, are refined more coarsely than the near ones.
// The nearest piece is the last, so the finest tolerance is not the first.
func TestViewTolerancesGrowWithDepth(t *testing.T) {
	c := custom("0.05*sin(30*t)", "0.05*cos(30*t)", "t-20", 0, 20)
	c.Construction = "none"
	c.Samples = 2400
	curve := func(u float64) Vec3 { return Vec3{0.05 * math.Sin(30*u), 0.05 * math.Cos(30*u), u - 20} }
	// The eye at z = 1 looks down −z; the view's plane is at z = 0.
	v := View{Center: Vec3{}, Right: Vec3{1, 0, 0}, Up: Vec3{0, 1, 0}, Width: 0.1, Height: 0.1, Distance: 1, Near: 0.01}
	r := refinedStudy(t, viewed(c, v))
	path := r.Adaptive.Base
	checkPath(t, path, r.Base, r.Breaks)
	r0 := math.Hypot(v.Width, v.Height)
	tolerance := 2e-4 * r0
	// The nearest piece starts on the view's plane, where w is 1.
	if math.Abs(path.View-tolerance) > 1e-15 {
		t.Fatalf("view tolerance %g, want %g", path.View, tolerance)
	}
	if 20*tolerance > path.Tolerance {
		t.Fatalf("the farthest turn's view tolerance %g is not below the study's %g", 21*tolerance, path.Tolerance)
	}
	if path.Exhausted || path.Unresolved != 0 || path.Breaks != 0 {
		t.Fatalf("exhausted %v, unresolved %d, breaks %d", path.Exhausted, path.Unresolved, path.Breaks)
	}
	ts := parameters(path, 0, 20, c.Samples)
	inView, _, longest, shown := viewChords(path.Points, ts, curve, v, tolerance, r0/4)
	if inView > 1.5 || longest > 1 || shown < 1000 {
		t.Fatalf("in view, %d chords stray %g view tolerances at their depth and reach %g of the chord limit", shown, inView, longest)
	}
	// Ten units out, chords stray more than three of the near tolerances:
	// the far turns were not refined as finely as the near ones.
	far := 0.0
	for k := 1; k < len(path.Points); k++ {
		if ts[k] > 10 {
			continue
		}
		for j := 1; j < 32; j++ {
			p := curve(ts[k-1] + (ts[k]-ts[k-1])*float64(j)/32)
			far = math.Max(far, distanceToSegment(p, *path.Points[k-1], *path.Points[k]))
		}
	}
	if far < 3*tolerance {
		t.Fatalf("far chords stray only %g, within three near tolerances %g", far, tolerance)
	}
	// Chord limits grow with depth too: a straight line toward the eye,
	// sampled every 1/12, is cut to a quarter of the half diagonal, 0.035,
	// near the view's plane, and left whole 10 units out, where its limit
	// is over 0.35.
	line := custom("0.01", "0.01", "t-20", 0, 20)
	line.Construction = "none"
	line.Samples = 240
	straight := refinedStudy(t, viewed(line, v)).Adaptive.Base
	ts = parameters(straight, 0, 20, line.Samples)
	near, whole := 0.0, math.Inf(1)
	for k := 1; k < len(straight.Points); k++ {
		length := straight.Points[k].sub(*straight.Points[k-1]).norm()
		switch {
		case ts[k-1] > 19.5:
			near = math.Max(near, length)
		case ts[k] < 10:
			whole = math.Min(whole, length)
		}
	}
	if near > r0/4*1.5 || whole < 20.0/240*(1-1e-9) {
		t.Fatalf("chords near the view's plane reach %g; far ones are cut to %g", near, whole)
	}
}

// What a view does not show is refined as without it, to the byte: a
// perspective looking away from the curve, with all of it behind the eye,
// an orthographic view no finer than the study, and a view on a study that
// is not refined.
func TestViewThatShowsNothingFinerChangesNothing(t *testing.T) {
	c := custom("0.05*sin(30*t)", "0.05*cos(30*t)", "-t", 0, 20)
	c.Construction = "none"
	plain := refinedStudy(t, c)
	want, _ := json.Marshal(plain)
	for name, v := range map[string]View{
		"behind": {Center: Vec3{0, 0, 2}, Right: Vec3{0, 1, 0}, Up: Vec3{1, 0, 0}, Width: 0.1, Height: 0.1, Distance: 1, Near: 0.01},
		"coarse": orthographic(Vec3{0, 0, -10}, 40, 30),
	} {
		r := refinedStudy(t, viewed(c, v))
		if got, _ := json.Marshal(r); string(got) != string(want) {
			t.Fatalf("%s: the view changed the study", name)
		}
	}
	// A helix 0.001 across running from 0.05 to 0.4 ahead of the eye, all
	// nearer than the near distance 0.5, where nothing is drawn.
	close := custom("0.001*sin(300*t)", "0.001*cos(300*t)", "0.6+t", 0, 0.35)
	close.Construction = "none"
	plain = refinedStudy(t, close)
	want, _ = json.Marshal(plain)
	nearer := View{Center: Vec3{}, Right: Vec3{1, 0, 0}, Up: Vec3{0, 1, 0}, Width: 0.1, Height: 0.1, Distance: 1, Near: 0.5}
	if got, _ := json.Marshal(refinedStudy(t, viewed(close, nearer))); string(got) != string(want) {
		t.Fatal("pieces nearer than the near distance were refined to the view")
	}
	// Brought within the near distance, it is.
	nearer.Near = 0.01
	if refinedStudy(t, viewed(close, nearer)).Adaptive.Base.View == 0 {
		t.Fatal("pieces beyond the near distance were not refined to the view")
	}
	c.Adaptive = false
	uniform, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	v := orthographic(Vec3{}, 0.01, 0.01)
	c.View = &v
	r, err := Compute(c)
	if err != nil {
		t.Fatal(err)
	}
	if r.Adaptive != nil || !sameStudy(t, r, uniform) {
		t.Fatal("a view changed a study that is not refined")
	}
}

// Breaks are judged against the study's tolerance alone: a view on a gap
// narrower than a sample step, or beside it, breaks the same interval once.
func TestViewKeepsBreaks(t *testing.T) {
	n := 240
	h := 2 * math.Pi / float64(n)
	gap := -math.Pi + (130+0.25)*h
	c := custom("t", "0.3*sin(t)", "0.2+0*sqrt((t-a)^2-0.000025)", -math.Pi, math.Pi)
	c.Curve.A = gap
	c.Samples = n
	plain := refinedStudy(t, c)
	if plain.Adaptive.Base.Breaks != 1 {
		t.Fatalf("the study breaks %d times", plain.Adaptive.Base.Breaks)
	}
	at := Vec3{gap, 0.3 * math.Sin(gap), 0.2}
	for _, dx := range []float64{0, 0.01, -0.02} {
		v := orthographic(at.add(Vec3{dx, 0, 0}), 0.004, 0.003)
		r := refinedStudy(t, viewed(c, v))
		if r.Adaptive.Base.View == 0 {
			t.Fatalf("%g: not refined to the view", dx)
		}
		if r.Adaptive.Base.Breaks != 1 || !sameStudy(t, r, plain) {
			t.Fatalf("%g: the view moved a break: %d breaks", dx, r.Adaptive.Base.Breaks)
		}
	}
}

// refinedPaths lists every refined curve of a result.
func refinedPaths(a *AdaptiveResult) map[string]*RefinedPath {
	paths := map[string]*RefinedPath{}
	add := func(name string, p *RefinedPath) {
		if p != nil {
			paths[name] = p
		}
	}
	add("base", a.Base)
	add("parent", a.Parent)
	add("projection", a.Projection)
	add("image", a.Image)
	add("partner", a.Partner)
	add("minus", a.Minus)
	add("plus", a.Plus)
	for k, p := range a.Involute {
		add("involute "+string(rune('0'+k)), p)
	}
	for k, p := range a.Strands {
		add("strand "+string(rune('0'+k)), p)
	}
	for k, p := range a.Meridians {
		add("meridian "+string(rune('0'+k)), p)
	}
	return paths
}

// Every curve a construction refines is refined to the view: the framed
// ribbon's edges and strands, the canal's meridians, the involutes and the
// inversion's image, each about one of its own points.
func TestViewRefinesEveryCurve(t *testing.T) {
	framed := study()
	framed.Construction = "framed"
	framed.Frame = frameRequest()
	framed.Frame.Strands, framed.Frame.Offset, framed.Frame.Width = 2, 0.4, 0.3
	framed.AdaptiveSurface = true
	canal := canalled(study(), 0.2, "1", 3)
	involute := study()
	involute.Construction = "involute"
	involute.Involute = InvoluteRequest{Anchor: 0, Family: InvoluteFamily{Enabled: true, From: -1, To: 1, Count: 3}}
	inversion := study()
	inversion.Construction = "inversion"
	inversion.Inversion = InversionRequest{Center: Vec3{0.3, -0.2, 0.5}, Radius: 1.7, Input: "base"}
	for name, c := range map[string]Request{"framed": framed, "canal": canal, "involute": involute, "inversion": inversion} {
		plain := refinedStudy(t, c)
		paths := refinedPaths(plain.Adaptive)
		if len(paths) < 2 {
			t.Fatalf("%s: only %d refined curves", name, len(paths))
		}
		for path, p := range paths {
			var at *Vec3
			for i := len(p.Points) / 3; i < len(p.Points) && at == nil; i++ {
				at = p.Points[i]
			}
			v := orthographic(*at, 0.05, 0.04)
			r := refinedStudy(t, viewed(c, v))
			q := refinedPaths(r.Adaptive)[path]
			if q == nil || !(q.View > 0) || q.Inserted <= p.Inserted {
				t.Fatalf("%s: %s not refined to a view about its own point", name, path)
			}
		}
	}
}

// A view must be a frame of the page: Right and Up unit and
// perpendicular, positive half extents, and, for a perspective, a positive
// near distance; every number finite.
func TestViewRefusesWhatIsNotAView(t *testing.T) {
	good := View{Center: Vec3{}, Right: Vec3{1, 0, 0}, Up: Vec3{0, 1, 0}, Width: 1, Height: 1, Distance: 2, Near: 0.1}
	if _, err := Compute(viewed(study(), good)); err != nil {
		t.Fatal(err)
	}
	for name, change := range map[string]func(*View){
		"center":      func(v *View) { v.Center.X = math.NaN() },
		"right":       func(v *View) { v.Right = Vec3{2, 0, 0} },
		"up":          func(v *View) { v.Up = Vec3{1, 1, 0}.unit() },
		"width":       func(v *View) { v.Width = 0 },
		"height":      func(v *View) { v.Height = math.Inf(1) },
		"distance":    func(v *View) { v.Distance = -1 },
		"near":        func(v *View) { v.Near = 0 },
		"orthonear":   func(v *View) { v.Distance = 0 },
		"nonfinite":   func(v *View) { v.Distance = math.Inf(1) },
		"near beyond": func(v *View) { v.Near = math.NaN() },
	} {
		v := good
		change(&v)
		if name == "orthonear" {
			// An orthographic view has no near distance.
			if _, err := Compute(viewed(study(), v)); err == nil {
				t.Fatalf("%s: a near distance without a perspective accepted", name)
			}
			continue
		}
		_, err := Compute(viewed(study(), v))
		if err == nil || !strings.Contains(err.Error(), "view") {
			t.Fatalf("%s: %v", name, err)
		}
	}
}

// The view's own tests of a piece, on boxes placed by hand. A box meets
// the view when it, grown on every side, reaches the view's margin, here
// an orthographic page 0.1 by 0.1 about the origin, 0.2 by 0.2 with its
// margin. In a perspective down −z from z = 1, its page on z = 0, nothing
// nearer than 0.25 is drawn, and a piece's depth is its nearest point's,
// but never nearer than the near distance, even for a piece reaching
// behind the eye.
func TestViewPlacesPieces(t *testing.T) {
	v := View{Center: Vec3{}, Right: Vec3{1, 0, 0}, Up: Vec3{0, 1, 0}, Width: 0.1, Height: 0.1, Distance: 1, Near: 0.25}
	f := v.focus()
	o := orthographic(Vec3{}, 0.1, 0.1).focus()
	box := func(points ...Vec3) []*Vec3 {
		out := make([]*Vec3, len(points))
		for k := range points {
			out[k] = &points[k]
		}
		return out
	}
	// A box 0.01 beyond the margin on any side, at any depth, meets it
	// only when grown by more than 0.01.
	for _, side := range []float64{1, -1} {
		piece := box(Vec3{side * 0.21, 0, 5}, Vec3{side * 0.25, 0.01, -5})
		if o.Meets(piece, 0.009) || !o.Meets(piece, 0.011) {
			t.Fatalf("side %g: a box 0.01 beyond the margin, grown by 0.009 and 0.011", side)
		}
		piece = box(Vec3{0, side * 0.21, 5}, Vec3{0.01, side * 0.25, -5})
		if o.Meets(piece, 0.009) || !o.Meets(piece, 0.011) {
			t.Fatalf("side %g: a box 0.01 beyond the margin's top or bottom", side)
		}
	}
	// Nearer than 0.25 from the eye, at z > 0.75, nothing is drawn.
	if f.Meets(box(Vec3{0, 0, 0.8}, Vec3{0.001, 0, 0.9}), 0) || !f.Meets(box(Vec3{0, 0, 0.7}, Vec3{0.001, 0, 0.8}), 0) {
		t.Fatal("pieces nearer than the near distance, and across it")
	}
	for _, c := range []struct {
		points []*Vec3
		want   float64
	}{
		{box(Vec3{0, 0, -2}, Vec3{0, 0, -1}), 2},
		{box(Vec3{0, 0, 0.5}, Vec3{0, 0, -1}), 0.5},
		{box(Vec3{0, 0, 2}, Vec3{0, 0, -1}), 0.25},
	} {
		if got := f.Scale(c.points, 0); math.Abs(got-c.want) > 1e-15 {
			t.Fatalf("depth %g, want %g", got, c.want)
		}
	}
	// An orthographic view has no depth.
	if got := o.Scale(box(Vec3{0, 0, 100}, Vec3{0, 0, -100}), 0); got != 1 {
		t.Fatalf("orthographic depth %g", got)
	}
}
