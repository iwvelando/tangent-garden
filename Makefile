.PHONY: install wasm bench preset-hashes preset-fixtures test test-go test-wasm test-scripts test-browser test-webkit test-durations typecheck vet format format-check build dev dev-lan preview preview-lan check pre-pr clean share-card thumbnails

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
	node --test scripts/preset-hashes.test.mjs
	node scripts/test-wasm.mjs
	node scripts/test-dev-worker.mjs
# Tests of the project scripts that need no engine.
test-scripts:
	node --test scripts/test-durations.test.mjs
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
test: test-go test-wasm test-scripts typecheck
test-browser: build
	npx playwright test
test-webkit: build
	WEBKIT=1 npx playwright test --project=webkit
# Records each spec file's mean duration over CI runs' timing reports, which
# CI's Chromium shards are packed by (tests/shards.ts).
test-durations:
	@test -n "$(RUN)" || { echo 'usage: make test-durations RUN="<CI run id>..."'; exit 2; }
	@dir=$$(mktemp -d) && for run in $(RUN); do \
		gh run download $$run -p 'chromium-test-timings-*' -D "$$dir/$$run" || { rm -rf "$$dir"; exit 1; }; \
	done && node scripts/test-durations.mjs $(addprefix "$$dir"/,$(RUN)); status=$$?; rm -rf "$$dir"; exit $$status
build:
	npm run build
share-card: build
	node scripts/build-share-card.mjs
check: format-check vet test build
# Everything a pull request needs locally (AGENTS.md, Verification). The
# browser suite rebuilds, since thumbnails rewrites web/examples after its
# build, and regenerated thumbnails must be committed.
pre-pr: check thumbnails
	$(MAKE) test-browser
	@dirty=$$(git status --porcelain web/examples); if [ -n "$$dirty" ]; then printf 'Commit the regenerated gallery files:\n%s\n' "$$dirty"; exit 1; fi
	@echo "pre-pr: check, thumbnails and the full browser suite passed"
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
# Rewrites the engines' copies of the 2D and 3D presets that their Go tests read.
preset-fixtures:
	node scripts/preset-fixtures.mjs
