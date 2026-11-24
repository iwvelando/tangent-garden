package shorten

import "math"

// cells buckets items by integer grid cell in an open hash table of
// linked lists, without maps: WebAssembly's maps cost far more than these
// slices. A cell may hold several items and an item several cells.
type cells struct {
	mask         uint64
	head         []int32
	next, item   []int32
	cellX, cellY []int64
}

func newCells(capacity int) *cells {
	size := 16
	for size < 2*capacity {
		size *= 2
	}
	c := &cells{mask: uint64(size - 1), head: make([]int32, size)}
	for i := range c.head {
		c.head[i] = -1
	}
	return c
}

func (c *cells) slot(x, y int64) uint64 {
	return (uint64(x)*0x9E3779B97F4A7C15 ^ uint64(y)*0xC2B2AE3D27D4EB4F) >> 17 & c.mask
}

func (c *cells) add(x, y int64, item int) {
	s := c.slot(x, y)
	c.next = append(c.next, c.head[s])
	c.item = append(c.item, int32(item))
	c.cellX = append(c.cellX, x)
	c.cellY = append(c.cellY, y)
	c.head[s] = int32(len(c.item) - 1)
}

// each calls fn with every item in cell (x, y).
func (c *cells) each(x, y int64, fn func(item int)) {
	for e := c.head[c.slot(x, y)]; e >= 0; e = c.next[e] {
		if c.cellX[e] == x && c.cellY[e] == y {
			fn(int(c.item[e]))
		}
	}
}

func cellOf(v, size float64) int64 { return int64(math.Floor(v / size)) }

// segmentCells buckets each edge i → i+1 of a closed polygon in every
// cell its box, grown by pad, meets.
func segmentCells(x, y []float64, size, pad float64) *cells {
	n := len(x)
	g := newCells(2 * n)
	for i := range n {
		j := (i + 1) % n
		x0, x1 := cellOf(min(x[i], x[j])-pad, size), cellOf(max(x[i], x[j])+pad, size)
		y0, y1 := cellOf(min(y[i], y[j])-pad, size), cellOf(max(y[i], y[j])+pad, size)
		for a := x0; a <= x1; a++ {
			for b := y0; b <= y1; b++ {
				g.add(a, b, i)
			}
		}
	}
	return g
}
