package engine

import "math"

// anchoredNormals spaces normals as normals does, but restarts the spacing
// on each contour at its own origin (see anchorNormals). A piece that
// splits, joins or appears elsewhere then leaves this one's normals in
// place. Each contour takes the normals that fit its length, so their
// number can differ from n by about half the number of contours.
func (s *sheet) anchoredNormals(set LevelSet, n int) []Normal {
	set = s.anchorNormals(set)
	out := []Normal{}
	_, total := levelChords(set.Contours)
	if !(total > 0) {
		return out
	}
	for _, c := range set.Contours {
		chords, _ := levelChords([]Contour{c})
		out = s.place(out, chords, total, n, set.Level)
	}
	return out
}

// anchorNormals gives each closed contour a geometric arc-length origin:
// its lower intersection with a vertical line through its arc-length
// centroid. The origin moves with the contour, rather than advancing to a
// new grid edge. It is recomputed from each absolute frame, so playback,
// scrubbing and export agree without carrying points across reconnections.
// Only the normals' private traversal changes; drawing geometry is intact.
func (s *sheet) anchorNormals(set LevelSet) LevelSet {
	out := LevelSet{Level: set.Level, Contours: append([]Contour(nil), set.Contours...)}
	for k, c := range out.Contours {
		if !c.Closed || len(c.Points) < 3 {
			continue
		}
		origin := c.Points[0].X
		length, weighted := 0.0, 0.0
		for j, p := range c.Points {
			q := c.Points[(j+1)%len(c.Points)]
			l := q.Sub(p).Norm()
			length += l
			weighted += ((p.X - origin) + (q.X - origin)) * .5 * l
		}
		if !(length > 0) {
			continue
		}
		x := origin + weighted/length
		anchor, index := Vec{X: x, Y: math.Inf(1)}, -1
		for j, p := range c.Points {
			q := c.Points[(j+1)%len(c.Points)]
			if !((p.X <= x && q.X > x) || (q.X <= x && p.X > x)) {
				continue
			}
			u := (x - p.X) / (q.X - p.X)
			y := p.Y + (q.Y-p.Y)*u
			if y < anchor.Y {
				anchor.Y, index = y, j
			}
		}
		if index < 0 {
			continue
		}
		projected, ok := s.project(anchor, set.Level)
		if !ok {
			continue
		}
		// Projection stays on the local chord's piece, using the same
		// distance guard as the representative normals themselves.
		p, q := c.Points[index], c.Points[(index+1)%len(c.Points)]
		if projected.Sub(anchor).Norm() > q.Sub(p).Norm() {
			continue
		}
		points := make([]Vec, 0, len(c.Points)+1)
		points = append(points, projected)
		for j := 1; j <= len(c.Points); j++ {
			v := c.Points[(index+j)%len(c.Points)]
			if v != points[len(points)-1] {
				points = append(points, v)
			}
		}
		if points[len(points)-1] == points[0] {
			points = points[:len(points)-1]
		}
		out.Contours[k].Points = points
	}
	return out
}
