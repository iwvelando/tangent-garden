package engine3

import "math"

// ruledColumns is the number of steps across a framed or ruled surface's
// probe grid, so it has ruledColumns + 1 columns, from one edge of the
// rulings to the other.
const ruledColumns = 24

// spanned returns ruledColumns + 1 evenly spaced values from from to to.
func spanned(from, to float64) []float64 {
	v := make([]float64, ruledColumns+1)
	for k := range v {
		f := float64(k) / ruledColumns
		v[k] = from*(1-f) + to*f
	}
	return v
}

// ruledSample is a ruled surface S(t, u) = a(t) + u d(t) at one grid point:
// X with its derivatives S_t, S_u, S_tt and S_tu (S_uu vanishes). Point is
// false where the surface has no point; Regular is false where it has a
// point but no tangent plane by the drawing's own guard; an S_t that is not
// valid means the tangent plane cannot be found; Known is false where the
// second derivatives cannot be found stably.
type ruledSample struct {
	X, St, Su, Stt, Stu   Vec3
	Point, Regular, Known bool
}

// ruledProbe describes a ruled surface built on the base on the grid of
// probeRows rows along t and the given columns u. at gives the sample
// at base sample i and ruling parameter u. flip reverses the normal
// S_t × S_u so that it matches the drawing's. With named, the branches are
// named by line of curvature, 0 along the ruling and 1 across it, as on a
// developable, where the ruling is a principal direction; otherwise they
// are numbered κ₁ ≥ κ₂. A closed surface's last row repeats its first and
// is not counted, as a canal's does. It also returns the grid's size, the farthest of its
// points from the first, which scales its tolerances.
func ruledProbe(kind string, n int, closed bool, lo, hi float64, columns []float64, at func(i int, u float64) ruledSample, flip func(u float64) bool, named bool) (*SurfaceDiagnostics, float64) {
	rows := probeRows(n)
	d := newSurfaceDiagnostics(kind, len(rows), len(columns))
	d.closed = closed
	copy(d.V, columns)
	samples := grid2[ruledSample](len(rows), len(d.V))
	size := 0.0
	var origin *Vec3
	for r, i := range rows {
		d.Along[r], d.U[r] = i, sampleAt(lo, hi, i, n)
		for k, u := range d.V {
			s := at(i, u)
			samples[r][k] = s
			if !s.Point {
				continue
			}
			x := s.X
			if origin == nil {
				origin = &x
			}
			size = math.Max(size, x.sub(*origin).norm())
		}
	}
	if size == 0 {
		size = 1
	}
	for r, i := range rows {
		if closed && i == n {
			d.repeatFirst(r)
			continue
		}
		for k, u := range d.V {
			d.ruledAt(r, k, samples[r][k], flip(u), named, size)
		}
	}
	return d, size
}

// repeatFirst makes row r, a closed surface's last, its first row again,
// so that the probe reads the same at both ends.
func (d *SurfaceDiagnostics) repeatFirst(r int) {
	copy(d.Points[r], d.Points[0])
	copy(d.Normals[r], d.Normals[0])
	for k := 0; k < 2; k++ {
		copy(d.Curvature[k][r], d.Curvature[k][0])
		copy(d.Direction[k][r], d.Direction[k][0])
	}
	if d.UnknownPlane != nil {
		copy(d.UnknownPlane[r], d.UnknownPlane[0])
	}
}

// ruledAt describes the ruled surface at grid point (r, k), whose sample is
// s, with its normal reversed by flip and its branches named as ruledProbe
// names them, against the grid's size.
func (d *SurfaceDiagnostics) ruledAt(r, k int, s ruledSample, flip, named bool, size float64) {
	if !s.Point {
		return
	}
	x := s.X
	d.Points[r][k] = &x
	counted := d.counted(r)
	count := func(c *int) {
		if counted {
			*c++
		}
	}
	if !s.Regular {
		count(&d.Singular)
		return
	}
	if !s.St.valid() {
		// No tangent plane can be found: r″ or r‴ is unknown.
		count(&d.Unknown)
		count(&d.UnknownPlanes)
		d.markUnknownPlane(r, k)
		return
	}
	p := shape(s.X, s.St, s.Su, s.Stt, s.Stu, Vec3{}, flip, size)
	if !p.Normal && d.Kind == "framed" {
		// S_t has units of length per parameter, whereas S_u = D is a
		// unit direction. Compare their angle, independent of study size.
		// Keep shape's arithmetic for points it already describes, so an
		// existing study retains its result bit for bit on every platform.
		cross := s.St.cross(s.Su)
		if area := cross.norm(); area > 1e-9*s.St.norm()*s.Su.norm() {
			n := cross.mul(1 / area)
			if flip {
				n = n.mul(-1)
			}
			p = principal(s.X, s.St, s.Su, n, s.Stt.dot(n), s.Stu.dot(n), 0, area, size)
		}
	}
	if !p.Normal {
		count(&d.Singular)
		return
	}
	nrm := p.N
	d.Normals[r][k] = &nrm
	if !s.Known || !finite(p.Kappa[0]) || !finite(p.Kappa[1]) {
		count(&d.Unknown)
		return
	}
	order := [2]int{0, 1}
	if named {
		ruling := s.Su.unit()
		if math.Abs(p.Dir[1].dot(ruling)) > math.Abs(p.Dir[0].dot(ruling)) {
			order = [2]int{1, 0}
		}
	}
	for b, from := range order {
		kappa, e := p.Kappa[from], p.Dir[from]
		d.Curvature[b][r][k] = &kappa
		if !p.Umbilic {
			d.Direction[b][r][k] = &e
		}
	}
	if p.Umbilic {
		count(&d.Umbilics)
	}
}

// ruledPoint describes a ruled surface at one point (t, u) for its probe
// between samples, as ruledProbe describes its grid: from the sample's own
// at a sample (at), and otherwise from the curve evaluated at t (between),
// against the grid's size, with the ruling through it. A closed surface's
// end reads as its start, as its grid's last row does.
func ruledPoint(kind string, n int, closed bool, lo, hi float64, columns []float64, at func(i int, u float64) ruledSample, between func(t, u float64) ruledSample, flip func(u float64) bool, named bool, size float64) func(SurfaceQuery) (*SurfaceDiagnostics, error) {
	return curvePoint(kind, n, lo, hi, columns[0], columns[len(columns)-1], false, func(d *SurfaceDiagnostics, t float64, sample int, u float64) {
		if closed && sample == n {
			sample = 0
		}
		sampled := func(u float64) ruledSample {
			if sample >= 0 {
				return at(sample, u)
			}
			return between(t, u)
		}
		s := sampled(u)
		d.ruledAt(0, 0, s, flip(u), named, size)
		// The ruling through it, from end to end.
		if from, to := sampled(columns[0]), sampled(columns[len(columns)-1]); s.Point && from.Point && to.Point {
			d.Through = []Vec3{from.X, to.X}
		}
	})
}

// developableProbe describes the tangent developable r + uT for
// |u| ≤ length, at u = ±length·k/12 for k = 1…12. It leaves out u = 0, the
// edge of regression, where the two sheets meet in a cusp along the curve
// and the surface is singular. The ruling is written S = r + w r′ with w = u/|r′|, the
// same points, so that its second derivatives need only r‴. The drawing's
// normal is sign(u)·B, which is the reverse of S_t × S_u on both sides.
// A sample without the drawing's binormal is singular along its whole
// ruling, as the drawing leaves its faces out, unless r″ is unknown there:
// its tangent plane is then unknown. It also returns the surface's
// description at any point (see ruledPoint).
func developableProbe(c Request, evaluate evaluation, lo, hi float64, closed bool, base []*Vec3, velocities, accelerations []Vec3, defined []bool) (*SurfaceDiagnostics, func(SurfaceQuery) (*SurfaceDiagnostics, error)) {
	n := len(base) - 1
	third := jerk(c, evaluate, lo, hi)
	// The ruling at t, through r with velocity v and acceleration a, and
	// whether the drawing's binormal is defined there.
	ruling := func(r, v, a Vec3, defined bool, t, u float64) ruledSample {
		w := u / v.norm()
		// Without r″ the binormal is unknown rather than absent, and so is
		// S_t: the tangent plane is unknown, not singular.
		s := ruledSample{X: r.add(v.mul(w)), St: v.add(a.mul(w)), Su: v, Stu: a, Point: true, Regular: defined || !a.valid()}
		if !defined {
			return s
		}
		j, ok := third(t, v)
		s.Stt, s.Known = a.add(j.mul(w)), ok
		return s
	}
	at := func(i int, u float64) ruledSample {
		if base[i] == nil {
			return ruledSample{}
		}
		f := float64(i) / float64(n)
		return ruling(*base[i], velocities[i], accelerations[i], defined[i], lo*(1-f)+hi*f, u)
	}
	// Between samples, as the sampling loop finds the curve and its
	// binormal at a sample.
	between := func(t, u float64) ruledSample {
		r, v, a, ok := evaluate(t)
		if !ok || !r.valid() || !v.valid() || c.units.still(v) {
			return ruledSample{}
		}
		_, defined := c.binormal(v, a, lo, hi)
		return ruling(r, v, a, defined, t, u)
	}
	half := ruledColumns / 2
	columns := make([]float64, 0, ruledColumns)
	for k := half; k >= 1; k-- {
		columns = append(columns, -c.Length*float64(k)/float64(half))
	}
	for k := 1; k <= half; k++ {
		columns = append(columns, c.Length*float64(k)/float64(half))
	}
	flip := func(float64) bool { return true }
	d, size := ruledProbe("developable", n, closed, lo, hi, columns, at, flip, true)
	return d, ruledPoint("developable", n, closed, lo, hi, columns, at, between, flip, true, size)
}

// framedProbe describes the framed ribbon r + uD for |u| ≤ Width from the
// frame's own equations rather than its transported samples. In arc length
// s, with bent = κN the curve's curvature vector and P = T × D, D turns
// about T at a rate Ω and toward T only as the curve bends:
//
//	D_s = −(bent·D)T + ΩP,  P_s = −(bent·P)T − ΩD,
//
// so D_ss = −(bent_s·D + 2Ω bent·P)T − (bent·D)bent + Ω_s P − Ω²D. Ω is the
// frame's spin for a rotation-minimizing frame, and τ + 2π·Twist/L for a
// Frenet frame, whose Ω_s = τ_s is differenced from τ at nearby t. These
// need r‴; the drawn normal is D × S_t. Between samples D is the frame
// carried to t (see along). It also returns the ribbon's description at
// any point (see ruledPoint).
func framedProbe(c Request, evaluate evaluation, lo, hi float64, base []*Vec3, velocities, accelerations []Vec3, frame carried) (*SurfaceDiagnostics, func(SurfaceQuery) (*SurfaceDiagnostics, error)) {
	n := len(base) - 1
	third := jerk(c, evaluate, lo, hi)
	frenet := c.Frame.Kind == "frenet"
	twist := frame.spin
	turning := torsionSlope(c, evaluate, lo, hi, third)
	// The cross-line at t, through r with velocity v and acceleration a,
	// along D.
	line := func(r, v, a, D Vec3, t, u float64) ruledSample {
		s := ruledSample{X: r.add(D.mul(u)), Su: D, Point: true, Regular: true}
		j, ok := third(t, v)
		if !a.valid() || !ok {
			s.St = Vec3{math.NaN(), math.NaN(), math.NaN()}
			return s
		}
		speed := v.norm()
		T := v.mul(1 / speed)
		P := T.cross(D)
		along := T.dot(a)
		bent := a.sub(T.mul(along)).mul(1 / (speed * speed))
		// d/dt of |r′| twice, and of bent, converted to arc length.
		along2 := speed*bent.dot(a) + T.dot(j)
		bentS := j.sub(T.mul(along2)).sub(bent.mul(along * speed)).mul(1 / (speed * speed)).sub(bent.mul(2 * along / speed)).mul(1 / speed)
		omega, omegaS, known := twist, 0.0, true
		if frenet {
			b := v.cross(a)
			omega += b.dot(j) / b.dot(b)
			var dt float64
			dt, known = turning(t)
			omegaS = dt / speed
		}
		Ds := T.mul(-bent.dot(D)).add(P.mul(omega))
		Dss := T.mul(-(bentS.dot(D) + 2*omega*bent.dot(P))).sub(bent.mul(bent.dot(D))).add(P.mul(omegaS)).sub(D.mul(omega * omega))
		Dt, Dtt := Ds.mul(speed), Ds.mul(along).add(Dss.mul(speed*speed))
		s.St, s.Stu = v.add(Dt.mul(u)), Dt
		s.Stt, s.Known = a.add(Dtt.mul(u)), known && finite(omega) && finite(omegaS)
		return s
	}
	at := func(i int, u float64) ruledSample {
		if !frame.ok[i] {
			return ruledSample{}
		}
		f := float64(i) / float64(n)
		return line(*base[i], velocities[i], accelerations[i], frame.direction(i, 0), lo*(1-f)+hi*f, u)
	}
	carriedTo := frame.along(c, evaluate, lo, hi)
	between := func(t, u float64) ruledSample {
		g, ok := carriedTo(t)
		if !ok {
			return ruledSample{}
		}
		_, _, a, _ := evaluate(t)
		return line(g.r, g.v, a, g.direction(c.Frame.Angle), t, u)
	}
	columns := spanned(-c.Frame.Width, c.Frame.Width)
	flip := func(float64) bool { return true }
	d, size := ruledProbe("framed", n, frame.closed, lo, hi, columns, at, flip, false)
	return d, ruledPoint("framed", n, frame.closed, lo, hi, columns, at, between, flip, false, size)
}

// torsionSlope returns dτ/dt. With b = r′ × r″, τ = b·r‴/|b|² and
// b′ = r′ × r‴, so τ′ = b·r⁗/|b|² − 2(b·r‴)(b·(r′ × r‴))/|b|⁴, exactly for
// a curve with an analytic r⁗. Otherwise τ is differenced at two steps
// scaled to the span, and discarded where they disagree, as jerk does for
// r‴.
func torsionSlope(c Request, evaluate evaluation, lo, hi float64, third func(float64, Vec3) (Vec3, bool)) func(float64) (float64, bool) {
	fourth := snap(c)
	if fourth != nil {
		return func(t float64) (float64, bool) {
			_, v, a, ok := evaluate(t)
			j, fine := third(t, v)
			b := v.cross(a)
			bb := b.dot(b)
			d := b.dot(fourth(t))/bb - 2*b.dot(j)*b.dot(v.cross(j))/(bb*bb)
			return d, ok && fine && finite(d)
		}
	}
	tau := func(t float64) (float64, bool) {
		_, v, a, ok := evaluate(t)
		if !ok || !v.valid() || !a.valid() {
			return 0, false
		}
		j, ok := third(t, v)
		b := v.cross(a)
		tau := b.dot(j) / b.dot(b)
		return tau, ok && finite(tau)
	}
	span := hi - lo
	f := func(t float64) (Vec3, bool) {
		v, ok := tau(t)
		return Vec3{X: v}, ok
	}
	return func(t float64) (float64, bool) {
		d, ok := slope(f, t, lo, hi, span*1e-3)
		d2, ok2 := slope(f, t, lo, hi, span*5e-4)
		here, fine := tau(t)
		if !ok || !ok2 || !fine || !finite(d.X) || !finite(d2.X) || math.Abs(d.X-d2.X) > 1e-2*math.Max(math.Abs(d.X), math.Abs(d2.X))+1e-4*math.Max(1, math.Abs(here))/span {
			return 0, false
		}
		return d2.X, true
	}
}
