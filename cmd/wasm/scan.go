//go:build js && wasm

package main

import (
	"encoding/json"
	"syscall/js"
	"tangentgarden/engine3"
)

// The topology-change scan (engine3/scan.go). One scan belongs to this
// disposable worker, as in registerSpatialFit: {"start": request} replaces
// it, and {"step": true} makes at most one mesher call and returns the scan
// as it stands. The page steps it until it stops, and cancels it by
// closing the worker. Every numerical decision is Go's. The reply holds
// readings only, never geometry, so it travels as plain JSON.
func registerScan() {
	var current *engine3.Scan
	js.Global().Set("tangentGardenImplicitScan", js.FuncOf(func(this js.Value, args []js.Value) any {
		if len(args) != 1 || len(args[0].String()) > 65536 {
			current = nil
			return `{"error":"scan request is too large"}`
		}
		var q struct {
			Start *engine3.ScanRequest `json:"start"`
			Step  bool                 `json:"step"`
		}
		if err := json.Unmarshal([]byte(args[0].String()), &q); err != nil {
			current = nil
			return refusal(err)
		}
		if q.Start != nil {
			s, err := engine3.NewScan(*q.Start)
			if err != nil {
				current = nil
				return refusal(err)
			}
			current = s
		}
		if current == nil {
			return `{"error":"start a scan before stepping it"}`
		}
		if q.Step {
			current.Step()
		}
		text, err := json.Marshal(current.Result())
		if err != nil {
			return `{"error":"non-finite scan result"}`
		}
		return string(text)
	}))
}
