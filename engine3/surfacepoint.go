package engine3

import (
	"encoding/json"
	"errors"
	"math"
)

// The surface probe between samples: a patch, its offset or one of its
// focal sheets described at any (u, v) of its domain, not only at a grid
// sample. The patch is analytic, so the point is evaluated exactly there,
// and it is described by the function that describes each grid sample
// (patchAt, offsetAt, focalAt), so a point at a sample reads exactly what
// the sample does.

// SurfaceQuery places the surface probe at the parameters (U, V). The
// notebook makes it from the probe's place; it is never typed, so it is
// refused rather than named as a field when malformed.
type SurfaceQuery struct {
	U float64 `json:"u"`
	V float64 `json:"v"`
}

// errSurfacePoint refuses a surface point on a study that is not a patch.
var errSurfacePoint = errors.New("the surface probe stands between samples only on a surface patch")

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

// surfacePoint places a surface study's probe at its query, from the
// study's own diagnostics.
func (out *Result) surfacePoint(q SurfaceRequest, at SurfaceQuery) (*SurfaceDiagnostics, error) {
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
	if c.Format != "surface" {
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
	return probeStudy.out.surfacePoint(c.Surface, *at)
}

// surfaceTarget asks a surface study probed at a point for the patch's
// diagnostics, unless it asks for its offset's or a focal sheet's.
func (c *Request) surfaceTarget() {
	if !c.OffsetDiagnostics && c.FocalDiagnostics == 0 {
		c.SurfaceDiagnostics = true
	}
}
