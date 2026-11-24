package shorten

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"testing"
)

// The shipped seeds' films are frozen (#410): user loops share this
// package, its replies and its transport, and must leave the flowers and
// the convex loop byte for byte as they were. Each preset of
// web/shorten/model.ts is solved as the page asks for it, sampled at nine
// times across its film, and its reply's JSON hashed. Go fuses multiply-
// adds on arm64 and not on amd64, so each architecture has its own hashes,
// taken from main's engine at cd9eb27. On amd64, math.Exp's assembly also
// fuses them when the CPU has AVX and FMA (math/exp_amd64.go), so the
// flowers, which call it, have a second hash, "amd64+fma", as CI's runners
// give it; Rosetta reports neither feature. The convex loop never calls it.
// SEED_HASHES=1 prints them.
var frozenSeeds = []struct {
	name string
	q    FrameRequest
	hash map[string]string
}{
	{"A flower remembering a circle", FrameRequest{Bloom: &BloomRequest{Seed: Bloom{Radius: 1, Petals: 5, Depth: 0.3}, Nodes: 512, Tau: 0.0025, Horizon: 0.999}}, map[string]string{
		"arm64":     "1cc856fb82404dd04134e915d83e30bf77cce94077c8d15193d645d60afb5148",
		"amd64":     "7e6c920bcf9e114f9b16c4b329957565376bfdddd90b0de72982f65ea1e2fbe1",
		"amd64+fma": "c323723aa3e9edb928e482325d40f946cbd9aae03af5c79a060ffd07e08df7f0",
	}},
	{"A trefoil folding into a circle", FrameRequest{Bloom: &BloomRequest{Seed: Bloom{Radius: 1, Petals: 3, Depth: 0.5}, Nodes: 512, Tau: 0.0025, Horizon: 0.999}}, map[string]string{
		"arm64":     "568a6268eb8310e1cc467fbd95d8ca4400944546d0053fe8997a3a960a18f34c",
		"amd64":     "f7408e0e9de6b795144d5fa69631e976282610b79e2429cbd6f156116ed7118d",
		"amd64+fma": "4839708f42dc81f0604a7b20fd94c59425d9c9ca8b141d7806123b411f4f1c3e",
	}},
	{"Six petals, a nest that grows", FrameRequest{Bloom: &BloomRequest{Seed: Bloom{Radius: 1, Petals: 6, Depth: 0.3}, Nodes: 512, Tau: 0.0025, Horizon: 0.999}}, map[string]string{
		"arm64":     "0a587d146ba978f52a297a2dc8b47e30ae6e69ae7e745dce58b9489ab30f32a3",
		"amd64":     "3135c1d49c16816a138ee70ea69e795e5be671db11fc39f48a881746be1bf850",
		"amd64+fma": "81547b404d69609c1eae0fdb63de5bcdbd0edcf5e2282714cf64f09a23afd13d",
	}},
	{"Eight petals and their faint future", FrameRequest{Bloom: &BloomRequest{Seed: Bloom{Radius: 1, Petals: 8, Depth: 0.15, Ruffles: 32, Ruffle: 0.01, Phase: 0.4}, Nodes: 512, Tau: 0.0025, Horizon: 0.999}}, map[string]string{
		"arm64":     "38b99e5ae3cfc4a7de2d420320b83101c5a9ccecae9b8d3ea5ca8e3b452f033b",
		"amd64":     "0edf9ac7111e42df50da7dfc1234452f91847adf9ef3fb3c81f255469ebe1bf4",
		"amd64+fma": "8b3961dd46e38fb3379b95efaefac7e3e9d43b8d0d5b7f7d6e2eda42748834d4",
	}},
	{"A gently rippled convex loop", FrameRequest{Convex: &Request{Seed: Seed{Radius: 1, Mode: 3, Epsilon: 1.0 / 16}, Nodes: 256, Tau: 0.005, Horizon: 0.999}}, map[string]string{
		"arm64": "13d4d2149852c9676372847f2a93ede9733f04871ceaedd6b057157c66616d0f",
		"amd64": "6eb8bed3f09f2582101805eba780969a5a762f8d828f66cf4ab97fbef7b55cef",
	}},
}

func TestShippedSeedFilmsAreUnchanged(t *testing.T) {
	print := os.Getenv("SEED_HASHES") != ""
	for _, s := range frozenSeeds {
		f, err := s.q.Solve()
		if err != nil {
			t.Fatal(s.name, err)
		}
		head, _ := f.Frames(nil)
		times := []float64{}
		for k := range 9 {
			times = append(times, head.End*float64(k*k*k)/512)
		}
		r, err := f.Frames(times)
		if err != nil {
			t.Fatal(s.name, err)
		}
		b, _ := json.Marshal(r)
		got := fmt.Sprintf("%x", sha256.Sum256(b))
		if print {
			fmt.Printf("%s\t%s\t%s\n", runtime.GOARCH, s.name, got)
			continue
		}
		want, ok := s.hash[runtime.GOARCH]
		if !ok {
			t.Skipf("no frozen hashes for %s", runtime.GOARCH)
		}
		if fused, ok := s.hash[runtime.GOARCH+"+fma"]; ok && got == fused {
			continue
		}
		if got != want {
			t.Errorf("%s: reply hash %s, want %s", s.name, got, want)
		}
	}
}
