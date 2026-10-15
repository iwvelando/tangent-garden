package engine3

import (
	"encoding/json"
	"errors"
	"math"
)

// The surface probe between samples: a patch, its offset or one of its
// focal sheets described at any (u, v) of its domain, or a surface built on
// a curve evaluated at any parameter at any (t, v), not only at a grid
// sample. The patch is analytic, so the point is evaluated exactly there,
// and it is described by the function that describes each grid sample
// (patchAt, offsetAt, focalAt), so a point at a sample reads exactly what
// the sample does. A surface built on a curve is described likewise
// (canalAt, ruledAt), from the curve and its frame evaluated at t, and at a
// sample from the sample's own.

// SurfaceQuery places the surface probe at the parameters (U, V): a
// patch's (u, v), or on a surface built on a curve the curve's t and the
// place across it, as its grid's columns measure it (see
// SurfaceDiagnostics). The notebook makes it from the probe's place; it is
// never typed, so it is refused rather than named as a field when
// malformed.
type SurfaceQuery struct {
	U float64 `json:"u"`
	V float64 `json:"v"`
}

// errSurfacePoint refuses a surface point on a study without a surface it
// can evaluate at any point.
var errSurfacePoint = errors.New("the surface probe stands between samples only on a surface patch, or on a canal, ribbon or ruled surface built on a curve evaluated at any parameter")

// pointedAnywhere reports whether a study's surface can be described at any
// point: a patch, or a surface built on a curve evaluated at any parameter.
// A ribbon without a width has no surface, which surfacePoint refuses.
func (c Request) pointedAnywhere() bool {
	if c.Format == "surface" {
		return true
	}
	switch c.Construction {
	case "", "developable", "canal", "framed", "ruled":
		return c.probedAnywhere()
	}
	return false
}

// sampleAt is sample i's parameter of n over [lo, hi], as the sampling loop
// places it, rounded at each step as the WebAssembly build rounds it, so
// that a grid's rows and a point's test for a sample agree on every
// architecture: arm64 may otherwise fuse its multiply-add differently in
// each place it is inlined.
func sampleAt(lo, hi float64, i, n int) float64 {
	f := float64(i) / float64(n)
	return float64(lo*(1-f)) + float64(hi*f)
}

// curvePoint describes a surface of kind built on a curve sampled n times
// over [lo, hi], whose grid's columns run from from to to, at one point
// (t, v), as its grid does: one row and one column, whose Along is the
// nearest sample. It refuses a point outside the curve's domain or the
// columns. place describes the point, given the sample at t when t is
// exactly one, so that it reads as the grid does there, or −1.
func curvePoint(kind string, n int, lo, hi, from, to float64, periodic bool, place func(d *SurfaceDiagnostics, t float64, sample int, v float64)) func(SurfaceQuery) (*SurfaceDiagnostics, error) {
	return func(at SurfaceQuery) (*SurfaceDiagnostics, error) {
		if !(at.U >= lo && at.U <= hi && at.V >= from && at.V <= to) {
			return nil, errors.New("the surface probe's (t, v) lies outside the curve's domain or across the surface")
		}
		d := newSurfaceDiagnostics(kind, 1, 1)
		d.Periodic = periodic
		i := nearest(at.U, lo, hi, n)
		d.Along[0], d.U[0], d.V[0] = i, at.U, at.V
		sample := -1
		if sampleAt(lo, hi, i, n) == at.U {
			sample = i
		}
		place(d, at.U, sample, at.V)
		return d, nil
	}
}

// checkSurfacePoint refuses a surface query outside the patch's domain.
func checkSurfacePoint(q SurfaceRequest, at SurfaceQuery) error {
	if !(at.U >= q.UMin && at.U <= q.UMax && at.V >= q.VMin && at.V <= q.VMax) {
		return errors.New("the surface probe's (u, v) lies outside the domain")
	}
	return nil
}

// nearest is the sample index nearest x on n steps over [lo, hi].
func nearest(x, lo, hi float64, n int) int {
	return max(0, min(n, int(math.Round((x-lo)/(hi-lo)*float64(n)))))
}

// pointProbe describes the patch, its offset or its focal sheet, as the
// grid's diagnostics do, at the one point (u, v): one row and one column,
// whose Along is the nearest row. A focal sheet's normal is oriented as at
// the nearest grid sample, or, where that has none, as the grid oriented
// it there, so the probe keeps one side as it passes between samples.
func pointProbe(q SurfaceRequest, grid *SurfaceDiagnostics, at SurfaceQuery, scale float64) *SurfaceDiagnostics {
	d := newSurfaceDiagnostics(grid.Kind, 1, 1)
	i, j := nearest(at.U, q.UMin, q.UMax, q.USamples), nearest(at.V, q.VMin, q.VMax, q.VSamples)
	d.Along[0], d.U[0], d.V[0] = i, at.U, at.V
	s := q.point(at.U, at.V, scale)
	switch grid.Kind {
	case "patch":
		d.patchAt(0, 0, s)
	case "offset":
		d.Distance, d.Folds = grid.Distance, grid2[bool](1, 1)
		d.offsetAt(0, 0, s)
	case "focal":
		d.Sheet, d.Feet = grid.Sheet, grid2[*Vec3](1, 1)
		before := grid.Normals[i][j]
		if before == nil && i > 0 {
			before = grid.Normals[i-1][j]
		}
		if before == nil && j > 0 {
			before = grid.Normals[i][j-1]
		}
		d.focalAt(q, 0, 0, s, before, scale)
	}
	d.clip(scale)
	return d
}

// surfacePoint places a study's surface probe at its query: a patch's from
// the study's own diagnostics, or a surface built on a curve's by its own
// description, with centers judged against the study's size as its grid's
// are.
func (out *Result) surfacePoint(c Request, at SurfaceQuery) (*SurfaceDiagnostics, error) {
	if c.Format != "surface" {
		if out.surfaceAt == nil {
			return nil, errors.New("the surface probe needs a surface to describe: a ribbon needs a width")
		}
		d, err := out.surfaceAt(at)
		if err != nil {
			return nil, err
		}
		d.clip(out.Bounds.Radius)
		return d, nil
	}
	q := c.Surface
	if err := checkSurfacePoint(q, at); err != nil {
		return nil, err
	}
	if out.Probe == nil {
		return nil, errors.New("the surface probe needs the patch, its offset or a focal sheet to describe")
	}
	return pointProbe(q, out.Probe, at, out.surfaceScale), nil
}

// SurfaceProbeOnly returns only a surface study's probe at its query, for
// a probe moved over a study already drawn. It keeps the last study it
// computed, as ProbeOnly does, so moving the probe evaluates one point,
// not the whole study again.
func SurfaceProbeOnly(c Request) (*SurfaceDiagnostics, error) {
	if c.SurfaceProbe == nil {
		return nil, errors.New("no surface probe was asked for")
	}
	if !c.pointedAnywhere() {
		return nil, errSurfacePoint
	}
	at := c.SurfaceProbe
	c.SurfaceProbe = nil
	c.surfaceTarget()
	key, err := json.Marshal(c)
	if err != nil {
		c.SurfaceProbe = at
		r, err := Compute(c)
		return r.SurfaceProbe, err
	}
	probeStudy.Lock()
	defer probeStudy.Unlock()
	if probeStudy.key != string(key) {
		c.SurfaceProbe = at
		r, err := Compute(c)
		if err != nil {
			return nil, err
		}
		probeStudy.key, probeStudy.out = string(key), &r
		return r.SurfaceProbe, nil
	}
	return probeStudy.out.surfacePoint(c, *at)
}

// surfaceTarget asks a study probed at a point for its surface's
// diagnostics, unless it asks for a patch's offset's or focal sheet's.
func (c *Request) surfaceTarget() {
	if !c.OffsetDiagnostics && c.FocalDiagnostics == 0 {
		c.SurfaceDiagnostics = true
	}
}
