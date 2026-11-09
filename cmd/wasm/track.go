//go:build js && wasm

package main

import (
	"encoding/json"
	"syscall/js"
	"tangentgarden/engine"
)

// A planar study's moving constructions at every sample, asked for only when
// a reveal needs them, so the study's own reply is what it always was. The
// track's flat numbers and flags leave the JSON.
func registerTrack() {
	js.Global().Set("tangentGardenTrack", js.FuncOf(func(this js.Value, args []js.Value) any {
		if len(args) != 1 {
			return `{"error":"expected one JSON request"}`
		}
		var q engine.Request
		if err := json.Unmarshal([]byte(args[0].String()), &q); err != nil {
			return refusal(err)
		}
		track, err := engine.Track(q)
		if err != nil {
			return refusal(err)
		}
		return liftReply(&track, `{"error":"nonfinite construction track"}`, nil, nil, map[string]map[string]any{})
	}))
}
