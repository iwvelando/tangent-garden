//go:build js && wasm

package main

import (
	"encoding/json"
	"syscall/js"
	"tangentgarden/engine"
)

// frozenGarden is the one inverted packing a glide's frames move: the
// latest frame request's settings and their source. A frame for other
// settings replaces it; it lives as long as the worker. Generation is
// deterministic, so a fresh worker freezes the same packing.
var frozenGarden *engine.GardenSource

// The Apollonian garden's circles travel as lifted parallel arrays, like the
// loom's paths. tangentGardenGarden retains nothing between requests;
// tangentGardenGardenFrame inverts the frozen packing about one pole of its
// glide and replies with the image coordinates alone.
func registerGarden() {
	js.Global().Set("tangentGardenGarden", js.FuncOf(func(this js.Value, args []js.Value) any {
		if len(args) != 1 || len(args[0].String()) > 4096 {
			return `{"error":"garden request is too large"}`
		}
		var q engine.GardenRequest
		if err := json.Unmarshal([]byte(args[0].String()), &q); err != nil {
			return refusal(err)
		}
		result, err := engine.ComputeGarden(q)
		if err != nil {
			return refusal(err)
		}
		return liftReply(&result, `{"error":"nonfinite garden result"}`, nil, nil, map[string]map[string]any{})
	}))
	js.Global().Set("tangentGardenGardenFrame", js.FuncOf(func(this js.Value, args []js.Value) any {
		if len(args) != 1 || len(args[0].String()) > 4096 {
			return `{"error":"garden frame request is too large"}`
		}
		var f engine.GardenFrameRequest
		if err := json.Unmarshal([]byte(args[0].String()), &f); err != nil {
			return refusal(err)
		}
		if frozenGarden == nil || !frozenGarden.Matches(f.Garden) {
			source, err := engine.NewGardenSource(f.Garden)
			if err != nil {
				return refusal(err)
			}
			frozenGarden = source
		}
		frame, err := frozenGarden.Frame(f)
		if err != nil {
			return refusal(err)
		}
		return liftReply(&frame, `{"error":"nonfinite garden frame"}`, nil, nil, map[string]map[string]any{})
	}))
}
