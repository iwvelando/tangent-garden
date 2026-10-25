package engine3

import "math"

// ReceiverInset is a finer raster of the visible part of the window.
// Rect is its lower and upper coordinates in the window's unit square.
// Irradiance uses the window's peak for shading; it never changes the
// window's accounting. Its arrays use the ordinary lifted transport.
type ReceiverInset struct {
	Rect       [4]float64  `json:"rect"`
	Irradiance [][]float64 `json:"irradiance"`
	Split      int         `json:"split,omitempty"`
	Exhausted  bool        `json:"exhausted,omitempty"`
}

type receiverRegion struct {
	rect          [4]float64
	width, height int
}

// receive keeps the original window raster independent of the view. The
// optional inset has its own bounded pass: zooming must not change the
// reported collected flux or the normalization peak.
func (q SurfaceRequest) receive(r RaysRequest, samples [][]mirrorPoint, scale float64, cache *rayCache) *Receiver {
	out := q.receiveRaster(r, samples, scale, cache, nil)
	rc := r.Receiver
	if rc.RefineView && rc.view != nil {
		if region := rc.region(*rc.view); region != nil {
			fine := q.receiveRaster(r, samples, scale, cache, region)
			out.Inset = &ReceiverInset{region.rect, fine.Irradiance, fine.Split, fine.Exhausted}
			return out
		}
	}
	if cache != nil {
		cache.insetRaster = rasterScratch{}
	}
	return out
}

// region clips the receiver's unit square against the view's five planes
// in homogeneous coordinates. Extrema of the clipped polygon bound the
// visible window, including windows that cross the eye or near plane.
// The largest projected derivatives along its axes set the bin counts,
// about one device pixel per bin, capped at 1024 in either direction.
func (r ReceiverRequest) region(v View) *receiverRegion {
	if v.Pixels[0] <= 0 || v.Pixels[1] <= 0 {
		return nil
	}
	origin := r.window(r.C1-r.Size/2, r.C2-r.Size/2)
	a := r.window(r.C1+r.Size/2, r.C2-r.Size/2).sub(origin)
	b := r.window(r.C1-r.Size/2, r.C2+r.Size/2).sub(origin)
	forward := v.Up.cross(v.Right)
	page := func(p [2]float64) [3]float64 {
		d := origin.add(a.mul(p[0])).add(b.mul(p[1])).sub(v.Center)
		w := 1.0
		if v.Distance > 0 {
			w += forward.dot(d) / v.Distance
		}
		return [3]float64{v.Right.dot(d) / v.Width, v.Up.dot(d) / v.Height, w}
	}
	polygon := [][2]float64{{0, 0}, {1, 0}, {1, 1}, {0, 1}}
	near := 0.0
	if v.Distance > 0 {
		near = v.Near / v.Distance
	}
	for plane := 0; plane < 5; plane++ {
		distance := func(p [2]float64) float64 {
			q := page(p)
			switch plane {
			case 0:
				return q[2] + q[0]
			case 1:
				return q[2] - q[0]
			case 2:
				return q[2] + q[1]
			case 3:
				return q[2] - q[1]
			}
			return q[2] - near
		}
		clipped := make([][2]float64, 0, len(polygon)+1)
		for i, p := range polygon {
			q := polygon[(i+1)%len(polygon)]
			dp, dq := distance(p), distance(q)
			if dp >= 0 {
				clipped = append(clipped, p)
			}
			if (dp < 0) != (dq < 0) {
				t := dp / (dp - dq)
				clipped = append(clipped, [2]float64{p[0] + t*(q[0]-p[0]), p[1] + t*(q[1]-p[1])})
			}
		}
		polygon = clipped
		if len(polygon) == 0 {
			return nil
		}
	}
	rect := [4]float64{1, 1, 0, 0}
	density := [2]float64{}
	for _, p := range polygon {
		for k := 0; k < 2; k++ {
			rect[k] = math.Min(rect[k], p[k])
			rect[k+2] = math.Max(rect[k+2], p[k])
		}
		q := page(p)
		for k, axis := range []Vec3{a, b} {
			dx, dy, dw := v.Right.dot(axis)/v.Width, v.Up.dot(axis)/v.Height, 0.0
			if v.Distance > 0 {
				dw = forward.dot(axis) / v.Distance
			}
			dx = (dx*q[2] - q[0]*dw) / (q[2] * q[2]) * float64(v.Pixels[0]) / 2
			dy = (dy*q[2] - q[1]*dw) / (q[2] * q[2]) * float64(v.Pixels[1]) / 2
			density[k] = math.Max(density[k], math.Hypot(dx, dy))
		}
	}
	if rect[2]-rect[0] < 1e-12 || rect[3]-rect[1] < 1e-12 {
		return nil
	}
	bins := func(k int) int { return int(math.Max(1, math.Min(1024, math.Ceil((rect[k+2]-rect[k])*density[k])))) }
	return &receiverRegion{rect, bins(0), bins(1)}
}
