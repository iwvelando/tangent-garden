package engine3

// Refinement queues are private scratch, one per level: unsplit leaves in
// one queue remain live while the next level is filled. Every used entry
// is overwritten before reading; no queue is part of a returned result.
type receiverCell struct{ i, j, side int }

const maxReceiverQueueBytes = 8 << 20

type receiverQueues struct {
	levels [maxReceiverRefine + 1][]receiverCell
	bytes  int
}

// cells reuses a level's queue within a separate 8 MiB budget. A larger
// level that cannot be retained still computes normally, without evicting
// the other levels. The ray family's release or a refinement change drops
// these queues along with its traces.
func (t *receiverTrace) cells(level, count int) []receiverCell {
	if t == nil {
		return make([]receiverCell, count)
	}
	q := &t.queues
	cells := q.levels[level]
	if cap(cells) >= count {
		return cells[:count]
	}
	// Three machine integers per cell; 24 bytes also conservatively bounds
	// storage on 32-bit targets. Include the retained slice header.
	bytes := q.bytes + (count-cap(cells))*24
	if cells == nil {
		bytes += 24
	}
	if bytes > maxReceiverQueueBytes {
		return make([]receiverCell, count)
	}
	cells = make([]receiverCell, count)
	q.levels[level], q.bytes = cells, bytes
	return cells
}
