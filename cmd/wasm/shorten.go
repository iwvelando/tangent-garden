//go:build js && wasm

package main

import (
	"encoding/json"
	"syscall/js"
	"tangentgarden/engine/shorten"
)

// frozenFilm is the one solved curve-shortening film the worker retains:
// the latest request's evolution, from whose checkpoints any time is
// recomputed. A request with other settings replaces it. Samples are a pure
// function of the request and time, so retention changes only latency.
var frozenFilm struct {
	key  string
	film shorten.Evolution
}

// A user loop's outline (#410) may hold 4,096 points; every other
// request keeps the 8 KiB ceiling.
const shortenRequestLimit, loopOutlineLimit = 8192, 262144

// tangentGardenShorten solves (or reuses) an evolution and replies with its
// summary and the loop at each requested time; the vertices travel as
// lifted arrays (docs/architecture.md, curve-shortening interfaces).
func registerShorten() {
	js.Global().Set("tangentGardenShorten", js.FuncOf(func(this js.Value, args []js.Value) any {
		if len(args) != 1 || len(args[0].String()) > loopOutlineLimit {
			return `{"error":"curve-shortening request is too large"}`
		}
		var q shorten.FrameRequest
		if err := json.Unmarshal([]byte(args[0].String()), &q); err != nil {
			return refusal(err)
		}
		if len(args[0].String()) > shortenRequestLimit && (q.Loop == nil || len(q.Loop.Loop.Points) == 0) {
			return `{"error":"curve-shortening request is too large"}`
		}
		fresh := false
		settings := q
		settings.Times = nil
		key, _ := json.Marshal(settings)
		if frozenFilm.film == nil || frozenFilm.key != string(key) {
			film, err := q.Evolve()
			if err != nil {
				return refusal(err)
			}
			frozenFilm.key, frozenFilm.film, fresh = string(key), film, true
		}
		reply, err := frozenFilm.film.Frames(q.Times)
		if err != nil {
			return refusal(err)
		}
		reply.Fresh = fresh
		return liftReply(&reply, `{"error":"nonfinite curve-shortening result"}`, nil, nil, map[string]map[string]any{})
	}))
}
