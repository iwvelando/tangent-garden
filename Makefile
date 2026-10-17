.PHONY: install wasm bench preset-hashes test test-go test-wasm test-browser test-webkit test-durations typecheck vet format format-check build dev dev-lan preview preview-lan check clean share-card thumbnails

install:
	npm ci
wasm:
	npm run wasm
# Race detection forces atomic coverage counters. Instrumenting those counter
# accesses under -race makes the numerical suites much slower than
# running race detection and coverage separately. Both passes run every test.
test-go:
	go test -race -timeout 20m ./...
	go test -cover -timeout 20m ./...
test-wasm: wasm
	node --test scripts/preset-hashes.test.mjs scripts/test-durations.test.mjs
	node scripts/test-wasm.mjs
	node scripts/test-dev-worker.mjs
# Times large implicit surfaces and curve meshes; ARGS="--compare <site or directory>" adds another engine.
bench: wasm
	node scripts/bench-spatial.mjs $(ARGS)
# Hashes and times every preset in all three notebooks; ARGS="--compare <site or directory>" shows any that another engine draws differently.
preset-hashes: wasm
	node scripts/preset-hashes.mjs $(ARGS)
typecheck:
	npx tsc --noEmit
vet:
	go vet ./...
	GOOS=js GOARCH=wasm go vet ./cmd/wasm
format:
	gofmt -w engine engine3 engine4 cmd
	npm run format
format-check:
	@files=$$(gofmt -l engine engine3 engine4 cmd); if [ -n "$$files" ]; then printf 'Run gofmt on:\n%s\n' "$$files"; exit 1; fi
	npm run format:check
test: test-go test-wasm typecheck
test-browser: build
	npx playwright test
test-webkit: build
	WEBKIT=1 npx playwright test --project=webkit
# Records each spec file's duration from a CI run's timing reports, which
# CI's Chromium shards are packed by (tests/shards.ts).
test-durations:
	@test -n "$(RUN)" || { echo "usage: make test-durations RUN=<CI run id>"; exit 2; }
	@dir=$$(mktemp -d) && gh run download $(RUN) -p 'chromium-test-timings-*' -D "$$dir" && \
		node scripts/test-durations.mjs "$$dir"/*/test-timings.json; status=$$?; rm -rf "$$dir"; exit $$status
build:
	npm run build
share-card: build
	node scripts/build-share-card.mjs
check: format-check vet test build
dev:
	npm run dev
# Reachable from other devices on the local network, such as a phone.
dev-lan:
	npm run dev:lan
preview:
	npm run preview
# Serves the build to other devices on the local network, such as a phone.
preview-lan:
	npm run preview:lan
clean:
	rm -rf dist public/engine.wasm public/wasm_exec.js public/GO-LICENSE.txt public/LICENSE.txt public/THIRD-PARTY-NOTICES.txt
thumbnails: build
	node scripts/build-thumbnails.mjs
