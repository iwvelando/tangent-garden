//go:build js && wasm

package main

import (
	"encoding/json"
	"syscall/js"
	"tangentgarden/engine"
)

// The Apollonian garden's circles travel as lifted parallel arrays, like the
// loom's paths. The adapter retains nothing between requests.
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
}
