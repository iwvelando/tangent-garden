package engine3

import (
	"fmt"
	"math"

	"tangentgarden/engine/refine"
)

// View is what the drawing shows, which refined curves are refined to as
// well as to their own tolerance (see focus). Center is the point in the
// middle of the page, Right and Up the page's directions (unit and
// perpendicular), and Width and Height the page's half extents on the
// plane through Center facing the viewer. An orthographic view has no
// Distance. A perspective's eye is Distance behind Center, looking along
// Up × Right, and draws nothing nearer to it than Near: a point p is drawn
// at Right·(p − c)/(Width w) across and Up·(p − c)/(Height w) up, within
// ±1 on the page, where w = 1 + (Up × Right)·(p − c)/Distance is its
// distance ahead of the eye over Distance (1 throughout for an
// orthographic view).
type View struct {
	// Pixels is the device-pixel size of the receiver view; curves ignore it.
	Pixels   [2]int  `json:"pixels,omitempty"`
	Center   Vec3    `json:"center"`
	Right    Vec3    `json:"right"`
	Up       Vec3    `json:"up"`
	Width    float64 `json:"width"`
	Height   float64 `json:"height"`
	Distance float64 `json:"distance,omitempty"`
	Near     float64 `json:"near,omitempty"`
}

// maxViews is the most views a piece of a flight may have.
const maxViews = 32

// validate refuses a view that is not a frame of a page.
func (v View) validate() error {
	positive := func(x float64) bool { return x > 0 && !math.IsInf(x, 1) }
	unit := func(u Vec3) bool { return u.valid() && math.Abs(u.norm()-1) < 1e-9 }
	switch {
	case v.Pixels[0] < 0 || v.Pixels[1] < 0 || v.Pixels[0] > 32768 || v.Pixels[1] > 32768:
		return fmt.Errorf("the view has at most 32768 pixels each way")
	case !v.Center.valid():
		return fmt.Errorf("the view's center must be finite")
	case !unit(v.Right) || !unit(v.Up) || math.Abs(v.Right.dot(v.Up)) > 1e-9:
		return fmt.Errorf("the view's right and up must be perpendicular unit vectors")
	case !positive(v.Width) || !positive(v.Height):
		return fmt.Errorf("the view's width and height must be positive and finite")
	case v.Distance == 0 && v.Near != 0:
		return fmt.Errorf("an orthographic view has no near distance")
	case v.Distance != 0 && (!positive(v.Distance) || !positive(v.Near)):
		return fmt.Errorf("a perspective view's distance and near distance must be positive and finite")
	}
	return nil
}

// focus is the refinement of a view (see refine.Focus): the pieces that
// meet the view, or its margin of half its width and height on each side
// that a wider panel or a short pan shows, are refined to refine.Epsilon
// of its half diagonal, the fraction of the study's radius the rest is
// refined to, and to chords no longer than a quarter of that half
// diagonal, ahead of the rest. In a perspective, both grow with a piece's
// depth, w at its nearest point but at least the near distance's: a
// length there is drawn 1/w as long as on the view's plane.
func (v View) focus() refine.Focus[Vec3] {
	r := math.Hypot(v.Width, v.Height)
	forward := v.Up.cross(v.Right)
	perspective := v.Distance > 0
	// The page coordinates scaled by w, and w, at p: linear in p, so each
	// edge of the margin is a plane.
	page := func(p Vec3) (x, y, w float64) {
		d := p.sub(v.Center)
		w = 1
		if perspective {
			w = 1 + forward.dot(d)/v.Distance
		}
		return v.Right.dot(d) / v.Width, v.Up.dot(d) / v.Height, w
	}
	nearest := 0.0
	if perspective {
		nearest = v.Near / v.Distance
	}
	focus := refine.Focus[Vec3]{
		Tolerance: refine.Epsilon * r,
		Chord:     r / 4,
		// The box of the points, grown by grow, misses the margin when all
		// eight of its corners lie beyond one of its planes.
		Meets: func(points []*Vec3, grow float64) bool {
			lo, hi := Vec3{math.Inf(1), math.Inf(1), math.Inf(1)}, Vec3{math.Inf(-1), math.Inf(-1), math.Inf(-1)}
			for _, p := range points {
				if p != nil {
					lo = Vec3{math.Min(lo.X, p.X), math.Min(lo.Y, p.Y), math.Min(lo.Z, p.Z)}
					hi = Vec3{math.Max(hi.X, p.X), math.Max(hi.Y, p.Y), math.Max(hi.Z, p.Z)}
				}
			}
			var beyond [5]int
			for corner := 0; corner < 8; corner++ {
				c := lo.sub(Vec3{grow, grow, grow})
				if corner&1 != 0 {
					c.X = hi.X + grow
				}
				if corner&2 != 0 {
					c.Y = hi.Y + grow
				}
				if corner&4 != 0 {
					c.Z = hi.Z + grow
				}
				x, y, w := page(c)
				for k, out := range [5]bool{x > 2*w, x < -2*w, y > 2*w, y < -2*w, perspective && w < nearest} {
					if out {
						beyond[k]++
					}
				}
			}
			for _, n := range beyond {
				if n == 8 {
					return false
				}
			}
			return true
		},
	}
	if perspective {
		focus.Scale = func(points []*Vec3, _ float64) float64 {
			w := math.Inf(1)
			for _, p := range points {
				if p != nil {
					_, _, depth := page(*p)
					w = math.Min(w, depth)
				}
			}
			return math.Max(w, nearest)
		}
	} else {
		focus.Scale = func([]*Vec3, float64) float64 { return 1 }
	}
	return focus
}

// viewsFocus is the refinement of a piece of a flight, several views at
// once (see focus): a piece that meets any of them is refined as finely as
// the finest of those it meets asks at its depth, ahead of the rest. Each
// view's tolerance and chord limit are the same multiples of its size, so
// they are the first view's, scaled by each view's size over the first's;
// one view is refined exactly as alone.
func viewsFocus(views []View) refine.Focus[Vec3] {
	foci := make([]refine.Focus[Vec3], len(views))
	for k, v := range views {
		foci[k] = v.focus()
	}
	return refine.Focus[Vec3]{
		Tolerance: foci[0].Tolerance,
		Chord:     foci[0].Chord,
		Meets: func(points []*Vec3, grow float64) bool {
			for _, f := range foci {
				if f.Meets(points, grow) {
					return true
				}
			}
			return false
		},
		Scale: func(points []*Vec3, grow float64) float64 {
			k := math.Inf(1)
			for _, f := range foci {
				if f.Meets(points, grow) {
					k = math.Min(k, f.Tolerance/foci[0].Tolerance*f.Scale(points, grow))
				}
			}
			return k
		},
	}
}

// focus is the request's refinement to what the drawing shows: its view,
// a flight's piece, or nil for neither.
func (c Request) focus() *refine.Focus[Vec3] {
	switch {
	case c.View != nil:
		f := c.View.focus()
		return &f
	case len(c.Views) > 0:
		f := viewsFocus(c.Views)
		return &f
	}
	return nil
}

// validateViews refuses a request's views that are not frames of the page,
// a piece of more than maxViews, or both a view and a piece.
func (c Request) validateViews() error {
	if c.View != nil && len(c.Views) > 0 {
		return fmt.Errorf("a study is refined to one view or to a flight's views, not both")
	}
	if len(c.Views) > maxViews {
		return fmt.Errorf("a flight's piece has at most %d views", maxViews)
	}
	if c.View != nil {
		if err := c.View.validate(); err != nil {
			return err
		}
	}
	for _, v := range c.Views {
		if err := v.validate(); err != nil {
			return err
		}
	}
	return nil
}
