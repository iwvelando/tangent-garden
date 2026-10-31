# Contributing: procedures for particular changes

[AGENTS.md](../AGENTS.md) states the rules every change follows. This page holds the step-by-step procedures for particular kinds of change: which files each one touches and which tests it needs. Read the section for a change before making it.

## Project delivery

Use this procedure for assignments tracked in GitHub issues or a design brief under `docs/projects/`. It is shared by all implementers and reviewers, regardless of agent or session. It supplements the numerical, state, TDD and verification procedures below; a ready issue does not waive them.

### Information ownership

| Information | Authoritative home |
| --- | --- |
| Accepted motivation, visual goals, scope boundaries and wave rationale | A stable design brief under `docs/projects/` |
| A feature's current agreed outcome and acceptance criteria | Its parent GitHub issue |
| A specific implementation assignment | A child GitHub issue |
| Readiness, active work and prerequisites | Issue labels, native parent/sub-issue and blocking relationships |
| Shipped mathematics, interfaces, limits and usage | Code, tests and the permanent repository guides |
| Change explanation and verification evidence | The implementation PR |
| Discussion, experiments and superseded decisions | Issue or PR comments |

Do not append progress, deferred tasks or completed-work narratives to a brief. Amend it only for an intentional change in direction; link the owner's decision. Keep the issue body coherent as the current assignment, and explain material edits in a comment. Settled mathematical definitions and interface contracts must move into permanent documentation in the implementation PR. A downstream implementer should not need to reconstruct the contract from an old comment thread. If shipped behavior disagrees with the accepted requirement, report the discrepancy; do not silently redefine either one.

### Hierarchy and tracking

Use one parent issue per feature, retaining its brief identifier in the title, such as `[R02] Parameter atlas`. Group work into wave milestones without inventing dates. Use native sub-issues for implementation slices, and native blocked-by relationships only for real prerequisites. Milestone order is scheduling guidance, not a dependency. A parent is an acceptance record; ordinarily assign its implementation children rather than the whole feature. Keep the hierarchy to feature and implementation levels unless a deeper level has a concrete benefit.

For the expansion, use these labels:

- `expansion`: the project filter, on parents and children.
- Exactly one of `kind:feature`, `kind:implementation`, or `kind:research`.
- On open issues, exactly one of `stage:needs-design`, `stage:ready`, `stage:active`, or `stage:review`. A feature parent can remain active while its children proceed. `needs-design` means the current brief is insufficient for an implementation assignment, not that its subject was rejected.

Use native issue state for completion and native relationships for blockers, not parallel prose status lists. `stage:ready` describes specification readiness; it is executable only when its prerequisites are merged and usable. An optional GitHub Project is a view of these issues, not another source of requirements or independently maintained status. Search closed issues too before creating replacements or follow-ups. Milestone and sub-issue percentages count issues, not effort or fulfillment of the visual goals.

### Preparing an assignment

Use the [feature template](../.github/ISSUE_TEMPLATE/expansion-feature.md) for a parent and the [implementation template](../.github/ISSUE_TEMPLATE/expansion-implementation.md) for a slice or research task. A ready implementation issue must state:

1. The user outcome, parent criteria it advances, and signature still or motion when visual behavior is involved.
2. Included and excluded work, identifying settled constraints separately from suggested implementation choices.
3. Focused current documentation, code entry points and regression tests, plus the revision last used to check this context. Prefer paths and symbols over line numbers that will drift.
4. Each prerequisite and the exact capability consumed from it. A bare issue link is insufficient. State what the assignment must expose for known downstream consumers without prematurely prescribing a general framework.
5. Observable acceptance criteria: mathematical invariants, invalid and singular cases, preservation of existing behavior, and relevant transitions, cancellation, links and exports.
6. Feature-specific verification and documentation obligations, including the early-intent and pre-verification exploration checkpoints and representative performance observations where applicable. Reference common requirements instead of copying them. Separate the targeted iteration phase from final verification; record any additional user-authorized deferral and its owner.

Usually make a slice one independently mergeable, deployable PR including its necessary tests, documentation and tracked artwork. Do not routinely separate engine, UI, tests and documentation into different assignments. A shared primitive can be separate when it has an independently testable contract and an identified consumer. Every merge to `main` deploys, so a later slice must not be needed to repair a knowingly incomplete public interaction.

Fully specify near-term work against the current code. Keep later feature parents concise and `stage:needs-design` until their dependencies and design questions are settled. For research, specify a bounded experiment, independent checks and a go/no-go decision. Completing an experiment does not complete its parent feature or authorize silently abandoning its intended outcome.

### Application integration and user walkthrough

Before building a substantial interface, add a short integration plan to the issue's implementation plan. Identify the entry and return/adoption flow, ownership of the source study and views, global preferences, and the existing controls, renderers, gestures, link and export paths to reuse. Name concrete application precedents and deliberate departures. Inspect those precedents in code and in the running app where behavior matters. Sharing an encoder alone does not establish a consistent export experience. Keep this plan in the issue, not a new permanent design document.

Issues should be precise about mathematics, compatibility, invalid inputs and observable outcomes. Distinguish those constraints from candidate artwork, default values and presentation choices to settle during early exploration. Describe the user's path through the feature as well as its output. Establish one representative end-to-end experience, including its normal sharing/export path, before expanding the catalog; an early partial preview must identify what is missing.

Before each owner preview, perform a focused walkthrough of the implemented flow: enter, discover controls, edit, select, manipulate the drawing, play/seek, share/export and return, as applicable. Check a short desktop viewport and phone portrait/landscape layouts, loading/refusal states, keyboard focus, gesture/scroll ownership and endpoint edits. Ensure every action is reachable, related controls stay together, and an intended parameter change remains perceptible under the framing policy. Compare appearance, help and error presentation with the named precedents. Use browser interaction and targeted assertions; this is not a full-suite gate. Distinguish simulated touch/phone layouts from actual-device results, and identify incomplete or phone-only checks in the handoff rather than claiming them passed.

When feedback exposes a class of problem, inspect its related controls and shared causes before returning another preview. A clipped action warrants checking the whole scrolling/navigation arrangement; an inconsistent refusal warrants checking the shared error presentation. Add regression assertions for the underlying behavior and affected callers, without turning every visual preference into a global rule. Supported user inputs must be exercised beyond authored examples, including ordinary domain gaps, degenerate inputs and expensive cases appropriate to the feature.

### Starting and coordinating work

1. Read `AGENTS.md`, the assigned issue and relevant comments, its parent, the brief's principles and relevant proposal, and the prerequisite outcomes and current documentation. With `gh`, read the body/comments and native relationships, for example `gh issue view <number> --comments` and `gh issue view <number> --json parent,subIssues,blockedBy,blocking`. Use the repository explicitly when outside its checkout. Check `gh help` or use `gh api` if the installed CLI lacks a field or relationship command.
2. Recheck the assignment against current `main`. A closed prerequisite may have been rejected rather than implemented, and a PR may be merged without delivering the capability assumed by this issue. Confirm the actual merged code, contract and required verification. Refresh stale context; discuss material contradictions before dependent implementation.
3. Record a concise plan, the working branch and active implementer/session identifier in an issue comment; set `stage:active`. Check existing claims first. A shared GitHub account or assignee cannot distinguish concurrent agent sessions. Link the PR when opened. Ordinary implementation decisions remain with the implementer; seek direction for changes to accepted scope, incompatible contracts or genuinely unresolved product choices.
4. Coordinate edits to shared evaluators, animation, links and transport with other active work. Use isolated checkouts and preview ports where needed. Use targeted checks during product iteration as described below; schedule final full verification in a quiet slot. Additional limits follow [Validation scope and handoff](#validation-scope-and-handoff). Do not infer a final-verification waiver from concurrent work or from a different documentation-only PR.
5. Follow red-green-refactor and the applicable procedures below. Keep the issue's acceptance criteria intact through refactoring and integration. After rebasing, reassess consumers and dependencies before relying on earlier checks.

### Product iteration before final verification

For new features and substantial visual or interaction changes, targeted verification is the default during development and owner feedback. This procedure authorizes that staging without a fresh testing-waiver request for each iteration. Use red-green-refactor, the relevant numerical and state regressions, a rebuilt production browser target, and focused visual inspection. Do not run `make pre-pr` between feedback iterations or before offering an early local product preview. Broaden a targeted check when a concrete shared-path risk requires it, not merely because another iteration ended.

Two owner checkpoints bracket iteration. The first, **early intent**, confirms the visual and interaction direction before the work is built out. Bring the signature still, representative motion and central interaction to it through the real computation/rendering path. Exercise edited values, cancellation and restoration, and inspect desktop and narrow layouts before expanding the catalog or polishing secondary controls. Present images or a usable preview with a short list of the product decisions to assess, and report the tested revision and remaining checks. If the owner has requested sign-off at this point, wait for it. Otherwise continue within the agreed scope; the early checkpoint is not an approval gate.

The second, **pre-verification exploration**, comes when the work is otherwise ready for `make pre-pr`: scope implemented, targeted checks green, durable documentation written, and the artwork the change affects regenerated. Stop there and hand the owner a production build to explore and try to break, before the expensive full run. Give the preview's URL and the revision or working-tree state it serves, rebuilding first so it matches the tree. Serve it with `make preview-lan` (HTTPS on all interfaces), not `make preview`, and hand over the `https://` network address it prints, such as `https://10.x.x.x:4173`, so the owner can open it on a phone as well as the desktop; a `127.0.0.1` URL reaches neither a phone nor HTTPS-only behavior. While browser tests may run, which use port 4173, serve it on another port: `npm run preview:lan -- --port 4180 --strictPort`. List what to try: the central interactions, limits and refusals, edge cases already tested, and anything known to be rough or only checkable on a phone. Then wait for the owner's go-ahead. Fix each finding with a targeted red/green check, and offer the checkpoint again after substantial changes. This checkpoint is a gate unless the owner waives it for the assignment, or the work is unattended (a cloud or scheduled agent). In that case, record in the handoff that the exploration is still owed. It replaces neither phone checks nor review.

During iteration, regenerate the artwork needed to assess the change. The complete thumbnail regeneration/gallery check and full `make pre-pr` belong to final verification after the pre-verification exploration checkpoint, before the final PR/review handoff. The implementing session owns this stage unless another stage is explicitly designated. A draft PR may collect feedback or CI earlier, but must state that local final verification is pending. Later behavioral changes require final verification again under the existing exceptions; an early full pass is not a substitute for testing the final implementation. Phone-only checks remain separately identified and owned.

For work that multiplies geometry or computation, specify two different forms of evidence. Enforced limits and regression assertions establish bounded work, queues and retained storage. Representative measurements through the actual worker, transport and renderer establish whether the signature interaction and motion are usable. Record the study/settings, device/browser, revision, method and observed latency or memory where measured, including cancellation responsiveness and an expensive supported case. Operation counts are not heap measurements; worker timings are not achieved device frame rates. Never invent a universal timing threshold or use headless FPS as a benchmark. Use [Transport and performance](#transport-and-performance) for applicable baseline comparisons. Resolve an unsatisfactory signature experience before acceptance, rather than treating a passing cap test as product approval.

### Keeping assignments current

When the owner agrees to a material scope or acceptance change, update the implementation issue body and every affected parent or downstream body in the same work phase, before continuing work that relies on it. State the current requirement coherently, including intentional compatibility changes; remove superseded promises. Add a concise comment linking or identifying the owner's decision and explaining what changed. Comments preserve history, but a final comment alone does not repair a contradictory body. Ordinary implementation choices do not require permission; reducing agreed scope or changing an incompatible contract still does.

Before review handoff and again at completion, compare the bodies with the actual delivered behavior and agreed verification scope. A new shared-engine change needs explicit scope and affected consumers even when discovered while curating presets. Refresh a brief only if the accepted direction changes, and put shipped definitions in permanent guides. Do not rewrite an unmet requirement as delivered without the owner's agreement.

### Review, completion and downstream handoff

The PR describes the final behavior, important design choices and verification on identified revisions. Link the implementation issue with a closing keyword only when that PR fulfills it; link the parent without a closing keyword unless the entire feature is accepted. Follow [Reviewing changes](reviewing.md), including an independent assessment of the approach. Feature review must evaluate the signature artwork and motion as well as correctness; merged children alone do not prove that the promised experience exists.

In an implementer-to-reviewer handoff, the implementer owns scope reconciliation, exploration iterations and local final verification, unless the owner explicitly transfers unfinished work. Then push the branch, open the PR, reconcile the issue bodies, set `stage:review` and leave the handoff, and stop: do not wait for CI or act on its results. The implementer's context is the largest in the delivery, so each turn spent on CI costs most there; the reviewer reads CI from a fresh one. Record the exact tested revision, CI as pending for the reviewer, outstanding work and its new owner, including any spec file added without a recorded duration. After handing off, stop implementation and avoid competing checks or edits. The designated reviewer owns independent assessment, warranted fixes and their verification, and CI from the handed-off head to the final one: reading failures, rerunning shards, and making timing corrections and duration refreshes under [Verification-only follow-ups](#verification-only-follow-ups). Merge, deployment follow-through and issue closure belong to that stage only when explicitly authorized; a role name or a ready label grants no merge permission. Material product changes during review return to the exploration checkpoint. A correct unchanged implementation can retain its revision-matching verification; review does not require another full run solely because the agent changed.

When handing an unmerged PR to review, set `stage:review` and leave the implementation issue open. Report outstanding checks explicitly. A PR request is not permission to merge. The authorized merger/integration stage owns the post-merge handoff; an implementer without merge authority leaves these steps clearly pending for that stage.

Keep routine issue updates to decisions, scope changes, blockers and links to evidence. Maintain one current PR verification section with revision-specific results, remaining checks and owners; mark superseded handoffs clearly rather than repeating the full test log in successive comments. A takeover may need a detailed resumable checkpoint with working-tree state and active commands, but it must distinguish temporary context from the final contract. At merge, leave the single definitive outcome below and reconcile stale pending statements with links to their resolution. Do not claim local checks from CI or overwrite historical results with a newer revision.

An implementation issue is complete when the agreed change is merged, required verification is satisfied (or its explicitly authorized disposition is recorded), durable documentation is updated, and downstream context reflects the result. If auto-closing on merge precedes a remaining required check, track that obligation explicitly and do not declare dependent work ready or the feature fully verified until its requirements are met.

At completion, remove open-stage labels, reconcile current PR/issue statements about pending checks with their resolutions, and assess the parent independently of child counts. Close a wave milestone when its feature acceptance is complete and no required work remains. Preserve historical verification evidence. Leave one concise outcome comment:

```markdown
Delivered: the capability now available.
Integration: merged PR and commit; current interface, documentation and test links.
Verification: link to the PR's revision-specific evidence and any authorized limits.
Differences: agreed changes from the original assignment, or none.
Follow-ups: issue links and whether they are required or optional.
Downstream: which issue bodies were refreshed and which are now executable.
```

Update dependent issue bodies with the actual interface, documentation and tests they should use. Preserve dependency relationships as traceability unless the dependency itself was mistaken; verify their completion rather than deleting the history. If the result changes an expected contract, reconcile consumers before marking them ready. A downstream readiness update is not authorization to start an unassigned task.

Close a parent only after its feature-level acceptance criteria are satisfied, including artwork, supported controls, links, exports and required verification. An optional improvement can be a separate issue; deferring a required criterion keeps the parent open unless the project owner explicitly agrees to revise scope. Record the disposition of rejected or superseded work and its replacement, if any; do not count it as delivered. Substantial scope changes update the parent and, when direction changes, the brief. Keep pending on-device checks and verification obligations in issues/PRs rather than permanent documentation.

## Running the tests

- `make check` runs formatting checks, Go vet, native tests with race and coverage, a real WASM bridge test, TypeScript checks, and the production build.
- `make test-browser` runs the production integration checks. It needs a Chromium installation (`npx playwright install chromium`).
- `make test-webkit` runs `tests/webkit.spec.ts` and `tests/mobile-inputs.spec.ts` in WebKit (`npx playwright install webkit`). `make pre-pr` runs it on macOS, where CI's `webkit` job runs too; on another platform it skips it with a notice and leaves it to CI.
- Playwright tests the production build in `dist/`. `make test-browser`, `make test-webkit` and `make thumbnails` rebuild it first. A targeted `npx playwright test` does not, and locally it reuses a preview already serving port 4173.
- `make thumbnails` rewrites `web/examples/thumbnails.json` after it builds, so run `npm run build` again before a targeted run.
- Prettier formats `web/`, `scripts/` and `tests/` only (`npm run format`). Never run it over `docs/` or `README.md`: it rewraps the Markdown.
- A test that opens a study by changing only the fragment of the current path (`page.goto("/?study=4d#s=…")`) does not reload the page, so the previous study can still be settled on screen. Wait for the app to remove `#s=`, which it does once it has read the link, and poll reads rather than reading once, as `tests/tesseract-loop.spec.ts` does. To reproduce such a race, defer the app's `hashchange` listener in an init script.
- React shows a `<select>`'s first option when its value is not among the options, so asserting the visible option can pass while the state is wrong. Assert the state.
- Chromium ends a slider's drag when a child is inserted directly into its fieldset. Put content that appears or disappears beside a slider in a wrapper.
- A sweep across presets (layout, help text) must wait for each preset to settle, or it tests nothing.
- The smoke test's compression check fails against a local `BASE_URL`; it is meant for the deployed site.
- TypeScript checks (`make typecheck`, and `tsc` in the build) cover `web/` only, not `tests/` or `scripts/`. A test fixture that builds a result type by hand is not checked against it, so when a result gains a field, search the tests for its other fields (`rg crossingsExhausted tests`) and add it there too.
- Keep intermediate form values valid unless testing validation. Validation may open a section before a test clicks its toggle; wait for the intended state and open it only if needed. Editing endpoints before widening their range can avoid that race.
- Await completion of an action before retrying it. A click abandoned by a short timeout may still land after **Pause** has become **Resume**. A pause test's animation must last long enough that natural completion cannot race the pause; test completion separately at an appropriate duration.
- Shared assertion helpers inherit Playwright's configured timeout unless a particular behavior requires a justified override. A hard-coded default can silently defeat the configured allowance (15 s per wait and 60 s per test, in every run; `playwright.config.ts`). When correcting one, reproduce the failing wait with a controlled delay where practical, retain the original assertions, and exercise the affected callers. Do not lengthen a deadline that is itself a product requirement to hide a regression.
- Investigate suspected races with controlled delays or CPU throttling when useful. Preserve the behavioral assertions when adjusting timing. An isolated pass is evidence about load sensitivity, not proof that a failure is unrelated to the change. Locate the failing step and compare with the base before using AGENTS.md's limited rerun exception; a package-download failure calls for CI infrastructure diagnosis, not weaker geometry assertions.
- Before amending a timing failure, check whether the same wait has failed or been amended before (`git log -G timeout -- tests/`). When the demonstrated cause is shared with other specs, lengthening the call sites that failed this time only moves the next failure to another: fix it in the shared helper, or report the shared cause for a decision when the fix would change a shared default such as the configured timeout. The spatial notebook's lazy startup was such a cause, and is why every run now has CI's allowance.

### Validation scope and handoff

New-feature development uses [Product iteration before final verification](#product-iteration-before-final-verification) by default: targeted checks support early previews and feedback, and the implementing session owns final full verification. That is scheduled verification, not a waiver of the final requirements.

Follow the user's testing scope. When implementation is explicitly limited to targeted checks so parallel work fits the machine, hand off the tested revision, any uncommitted changes, exact commands and results, reproduced failures, and deferred checks with the reason. Name the designated integration or review stage that owns final verification, or mark it unassigned; do not silently omit that work or describe the targeted run as a full pass. Schedule the full run in a quiet slot instead of starting competing suites. Use an isolated preview port for concurrent targeted browser work, as [Development](development.md#checks-and-tests) describes.

`make pre-pr` checks existing assertions and generated artifacts. It does not run deployed-site benchmarks, the whole-preset deployed comparison, or targeted mutations. Those remain separate checks when required by the change; if the user's scope defers them too, record each deferral. A larger run cannot supply an assertion that no test makes. After a rebase, reassess changed dependencies and consumers before deciding which prior results still apply. Final verification follows [AGENTS.md](../AGENTS.md#verification), including its Markdown-only, demonstrated timing and verification-only follow-up exceptions.

### Verification-only follow-ups

After a successful complete `make pre-pr`, reuse that result without regenerating thumbnails or repeating the full local suite only when the entire subsequent diff consists of Markdown documentation, scheduling-only values in `tests/test-durations.json`, or a limited timeout correction for one or two demonstrated browser-test timing failures. A shared helper correction must be confined to the implicated helper and tested through its affected callers. This exception applies to later CI failures too; it does not require the successful local run to have failed first. Markdown-only changes retain their separate exception. After an implementer-to-reviewer handoff, the reviewer makes these follow-ups for what the PR's CI shows.

- Confirm that application code, dependencies, build and test infrastructure, fixtures, baselines, assertions, test selection and shard count are unchanged, apart from the allowed duration values or timeout correction. A merge bringing other changes invalidates this exception. Do not add retries, skip tests, or weaken an intended behavioral deadline to qualify.
- For a timeout correction, establish the cause, confirm it is unrelated to the application change, and reproduce it before fixing it where practical. Run all affected specs with the corrected helper, including the failing conditions and relevant CI timeout configuration. Use the build and preview procedure above for browser checks.
- For a duration refresh, follow [CI shards](#ci-shards) and run `tests/shards.spec.ts` to check coverage, deterministic placement and balance. Final CI must run all shards with the new assignment; a local unsharded run does not exercise that assignment.
- Confirm `git status --porcelain web/examples` is empty and required CI checks pass on the final head. Until CI finishes, report final verification as pending. Other required evidence, such as deployed comparisons and mutations, must still be completed or explicitly deferred; this exception only avoids repeating unaffected checks.

Record the revision and final lines of the successful full run, the exact subsequent diff, targeted commands and results, final head and CI result. Describe this as an earlier full pass plus verified follow-ups, never as a full local run on the final head. If eligibility or the failure's cause is uncertain, investigate and use the normal full-run requirement. AGENTS.md's separate exception for one or two timing failures during the full run still applies on its own terms.

## Numerical changes

Use this procedure for tolerances, stencils and regularity decisions. Read the affected definition and [numerical policy](mathematics.md#numerical-policy), including the relevant [planar](mathematics.md#scale-and-translation) or [spatial](mathematics.md#spatial-scale-and-translation) error budgets. Those definitions remain the source of the actual limits.

1. In the implementation plan, identify the changed contract, consumers, accepted and rejected examples, fallback behavior and expected evaluation cost. For each compared quantity, state its length and parameter units and the source of its rounding. Trace nested derivatives and normalization: a unit direction still carries uncertainty from its input stencil. Full- and half-step stencils may share samples and correlated errors, so agreement alone does not prove resolution.
2. Choose a small test matrix from the failure mechanism. Consider length scale, translation, parameter rate, orientation, endpoints and interior points, reduced and production sample counts, refinement, composed inputs and diagnostics. Vary independent quantities independently; combine them where an interaction matters. Scaling length does not test parameter units. A tilted line exposes rounding hidden by an axis-aligned zero coordinate. Sample count changes which parameters are visited even when stencil spacing is independent of it. Do not require an exhaustive cross product or stronger invariance than the documented contract supports.
3. Pair an analytically resolved case near the acceptance boundary with an unresolved or degenerate case near the rejection boundary. Exercise exact zero and a missing or sizeless reference when relevant, including their fallback units. Observe geometry and classifications returned by production code; derive expectations independently. Preserve the intended ordinary-path behavior of existing studies before sharing their code path.
4. Observe the regression fail before changing behavior, then make it pass. Challenge the decision with [targeted mutations](#mutation-testing) in both directions and verify all affected consumers, not just the reported example. Apply the architecture and performance checks in [Transport and performance](#transport-and-performance), including the second CPU architecture for borderline numerics.

### Meaningful regression assertions

An equality test needs evidence that its fixture exercises the promised condition: relevant rays, gaps, virtual branches, surface probes or cache hits must actually exist. Check the expected absence in a contrasting case when that distinguishes the behavior. If the claim includes construction lines and a derived curve, assert both; an unchanged curve does not prove its strings or normals were emitted.

Prefer assertions that explain which geometric or state invariant failed. Retain exact comparisons when numerical or drawing identity is the contract. A whole-result architecture-specific digest needs a reason for its scope and accompanying checks that help diagnose a mismatch; do not replace an exact identity requirement with a loose tolerance. Use existing preset loaders and similarity helpers so transformations cover every dimensional field. Screenshots collected for inspection are useful observations, but are not automated regression assertions.

## Shared paths and state

Before changing a shared evaluator, parser transformation or retained state, identify the production entry point and its affected consumers: sampling, refinement, composed inputs, diagnostics, the worker, drawing and exports as applicable. Read their definitions in [Architecture](architecture.md). Search for an existing helper before adding another; share notebook-independent behavior, parsers, preset loaders and test transformations where their contracts match. Do not merge distinct numerical contracts merely because their formulas look alike.

Repeat that discovery after rebasing or integrating related work. Main may now have a suitable helper, a stateful wrapper or new consumers outside the diff. Extend coverage for those interactions; a clean merge and a passing stateless test do not establish correctness through the worker.

For stateful computation, compare a sequence through the production entry point with stateless results. Exercise warm reuse, relevant edits, invalidation and failures. Ensure earlier results remain unchanged and that modifying delivered nested arrays or pointers cannot corrupt future replies. Account for transport consuming output storage. Inspect every request field read by cached work when checking key completeness; validation must still run on cache hits. State and test retained-storage bounds and release conditions. The receiver tests in `engine3/receiver_test.go` provide examples of sequence equality, ownership and allocation assertions.

For parser transformations, preserve domain errors and nonfinite behavior, including negative radicands and overflow. Source-size and nesting limits alone do not bound the cost of a transformed expression: check its evaluation work at accepted nesting limits. When an optional precision path cannot establish its prerequisites, handle errors explicitly and retain the ordinary evaluator rather than assuming an earlier validation makes failure impossible.

## Documentation and indirect behavior

When behavior changes, search for the old description and limit as well as the changed identifier. Check the mathematical definition, numerical-policy summary, limitations, usage text, control help, visible notes and code comments. After integration, repeat the search for descriptions added on main. Keep durable definitions in the mathematical and architecture guides and verification evidence in the PR. Stable project design briefs may live in `docs/projects/`; they describe intent and acceptance, not delivery status. Do not keep backlogs, handoff logs or lists of pending checks in `docs/`, including those briefs: open work belongs in GitHub issues, and checks for a change belong in its PR. See [Project delivery](#project-delivery).

Trace all uses of a newly enabled flag. Help and tests must cover indirect behavior such as a larger zoom limit, clamping when the option is disabled, playback and export differences. Test reverse transitions from edited values and the preset's opening state; testing only enablement can miss a visible consequence of disabling it. Use the help tiers and limits in [AGENTS.md](../AGENTS.md#help-text).

## Thumbnails

Preset fingerprints cover definitions, not numerical or rendering output, so unchanged fingerprints do not prove thumbnails are current. The gallery hides a thumbnail whose fingerprint no longer matches its preset, and `tests/gallery.spec.ts` fails until it is redrawn.

## Side-by-side fields

- Side-by-side fields go in `.pair` as `Field`s, whose CSS subgrid gives labels, controls and help their own shared rows. Do not bottom-align or otherwise couple them.
- `tests/layout.spec.ts` opens every paired help toggle in every preset at desktop and phone widths. Extend its setups when a pair appears only under another setting.
- Put clearance between a pair and neighboring controls on a containing block's padding or grid gap, not on the subgrid `Field` children. First-open portrait layouts on iOS have omitted clearance from those margins until a dropdown or another native action triggers layout again. In `web/atlas.css`, `.atlas-ranges` owns both its leading padding after Grid size/Framing and its trailing padding before Generate; its child fields have zero margins. Do not repair only the trailing gap when adding a new pair above it.
- Do not stack a block field's bottom margin with the next pair's child top margins. The atlas's Parameter pair field has zero margins and owns 16px of trailing padding; Grid size/Framing children have zero margins. This gives the same 16px gap as the following range boundary, instead of 14px + 14px. Help outside a `.field`, such as atlas-entry help, also needs an explicit 8px control-to-help margin; `.field .hint` styles only help inside a Field. Compare its brief and expanded forms with an ordinary field at both widths.
- Check both boundaries immediately after opening, before focusing or opening a native control, and after portrait/landscape transitions. `tests/webkit.spec.ts` covers these atlas gaps, including a constructed stylesheet that suppresses the preceding pair's child bottom margins. That controlled reproduction proves spacing no longer depends on them; it does not replace checking the first paint on an actual phone over HTTPS.

## Adding a preset

- A new 2D or 3D preset needs its engine's copy of the presets regenerated, `engine/testdata/presets.json` and `engine3/testdata/presets.json`: run `make preset-fixtures`.
- Raise every count of the notebook's presets: in `tests/gallery.spec.ts`, and in `tests/notebook-consistency.spec.ts`, where the 3D test counts both the example titles and their eyebrows.
- Choosing a preset replaces the whole study, as a link does. Each notebook's `presetStudy` (`planar-link.ts`, `spatial/link.ts`, `tesseract/link.ts`) returns its full link study, the preset's own fields over the notebook's defaults, so nothing of the previous study (animation, probe, layers, line weight) carries over. `tests/preset-study.ts` checks every preset against that.
- Tests choose presets through `choosePreset` in `tests/helpers.ts`.
- A preset that turns an option on needs a test that plays the preset's own animation with the option on.
- Run `make thumbnails` and commit the new thumbnail (AGENTS.md, **Verification**).
- The 3D engine never treats a `parametric` curve as closed, even one that returns over a whole period, so a loop (`repeat: "loop"`) on it is refused. Write a curve that should loop as `harmonic`.

### Framing a 3D preset

Compute a 3D preset's `view` rather than adjusting it by screenshot. The turntable's eye lies along `(−cos p·sin y, sin p, cos p·cos y)` for yaw y and pitch p (`camera` in `web/spatial/scene.ts`), so solve y and p from the direction to look from, then check once.

- The screen's rows are right = `(cos y, 0, sin y)` and up = `(sin p·sin y, cos p, −sin p·cos y)`. To center a point q in an orthographic view, set `panX = −right·(q − c)` and `panY = −up·(q − c)`, with c the study's bounds center (`Result.Bounds.Center`). The visible height is about `2·1.16·radius/zoom`.
- y is up on the page at pitch 0, so a curve in the xy-plane faces the reader at yaw 0, pitch 0; z stays upright only near p = −π/2.
- To try framings without rebuilding, open the study by link, `/?study=3d#s=` followed by base64url(deflateRaw(JSON `{v: 1, notebook: "3d", study}`)), with `study` built from `presetStudy(index)` and overrides, in a throwaway spec.
- A closed convex patch hides what lies inside it, such as the surface probe's centers and normal-section circles. Set `sight.probe` to show them behind sheets, or look into an open patch from its concave side. Principal circles lie in planes containing the normal, so look about 45° off the normal, diagonal to both principal directions.
- A probe flight with `camera: "hold"` reframes to take in the probe's circles, which can shrink the drawing; `"current"` keeps the preset's view.

## Adding a numeric field

- Use `ScalarInput` (`web/ScalarInput.tsx`), never `<input type="number">`, and add the field to `tests/scalar-fields.spec.ts`.
- Only whole-number counts (samples, lines, offsets) and animation settings stay numeric.

## Generated numeric defaults

Editable defaults computed from other numbers can acquire binary arithmetic tails: `1.65 - 1` becomes `0.6499999999999999`, and `1.6 * 0.75` becomes `1.2000000000000002`. The exact center rule introduced for the roulette atlas addresses a related midpoint problem; it does not clean endpoints on its own.

- Normalize only defaults produced by arithmetic, not a directly copied source value such as a zero-arm range's upper rolling radius. `roundedGenerated` in `web/atlas.ts` searches for the shortest decimal within `Number.EPSILON * max(abs(computedValue), operandScale)`. Carry `operandScale` from the operation: the original value for the roulette multiplications, the larger magnitude of a coordinate/coefficient and its range half-width for sums/differences, and the largest endpoint magnitude for grid interpolation. A tolerance scaled only to the small result of cancellation misses `1.15 - 1`, whose raw result is `0.1499999999999999`. If none is shorter, keep the original. Preserve finite/increasing endpoints and distinct subnormals. This removes rounding-sized tails without a fixed decimal-place or significant-digit cutoff that would erase small or precise values.
- Do not change a frozen source, raw scalar text or endpoints explicitly entered by the user. `ScalarInput` should continue to display and resolve those normally; do not hide the issue with a global formatting change.
- Clean generated interior grid values with their interpolation budget as well; otherwise an adopted choice can carry a tail into the next excursion. Preserve the frozen center independently, before cleanup. The interpolation's rounding scale is the larger magnitude of the source value and either endpoint. Comparing only with the source magnitude loses a small coordinate between endpoints near ±1: for example, the midpoint of −1.2 and 0.8 differs from −0.2 by more than its own one-epsilon budget. Snap the center only within the endpoint-aware rounding budget; an off-center range keeps its own midpoint and all entered endpoints stay exact.
- Cover negative and near-zero coordinates, meaningful long precision, subnormals, both grid sizes, and reopening after adopting off-center variants. Sweep every axis and cell through repeated adoption with independent exact-decimal expectations, including values near the minimum half-width where subtraction cancels. Assert the actual generated numbers and the unchanged source/full-quality center request, with an ordinary WASM comparison for representative studies. Tests belong in `tests/gallery.spec.ts` with the atlas's existing defaults and ownership cases.

## Adding a validation error

A validation error about one field is a `FieldError` (in `engine`, `engine3` or `engine4`) carrying the field's request path, shown under that control. A new path needs:

- its label in the notebook's field map: `web/planar-fields.ts`, `web/spatial/fields.ts` or `web/tesseract/fields.ts`;
- cases in the engine's `fielderror_test.go`;
- cases in the notebook's label table: `tests/planar-field-error-labels.spec.ts`, `tests/spatial-field-error-labels.spec.ts` or `tests/tesseract-field-errors.spec.ts`.

## Study link fields

A new or renamed configuration, layer or animation field needs:

- its entry in the notebook's link schema (`planar-link.ts`, `spatial/link.ts`, `tesseract/link.ts`). `tsc` enforces coverage;
- a default that reproduces the previous drawing for older links;
- a case in `tests/study-link.spec.ts`.

## Transport and performance

[Architecture](architecture.md) describes the typed mesh reply (`cmd/wasm/mesh.go`) and the lifted arrays (`cmd/wasm/lift`).

- Bulk geometry other than a mesh should be a slice, or a slice of slices, of a kind `cmd/wasm/lift` moves out of the JSON: `engine3.Vec3`, `*engine3.Vec3` (nil for a gap), `[3]float64` or `[4]float64` (the 4D vectors), `float64`, `*float64`, or `bool` (packed flags). Then it reaches the page in the float64 buffer and is restored in place with no change on either side. A slice of structs of numbers, or a new bridge function that returns plain JSON, puts the cost back.
- Representative optical rays (`engine3.Ray`) lift too, packed as 16 floats per ray with explicit indices, coordinates and flags; see [architecture](architecture.md). Other structs still travel as JSON unless a transport kind is added.
- A new kind needs a case in both `lift.go` and `web/lifted.ts`, and in their tests.
- A 2D result still travels as plain JSON, because it is small (under 3 MB, a few percent of most presets' time). A 2D array that grows large needs `engine.Vec` added as a kind before the planar bridge can lift it.
- Time a transport or engine change against the deployed site with `make bench ARGS="--compare <site>"` (3D only) or `make preset-hashes ARGS="--compare <site> --only <name>"` (any notebook), never by headless frame rate. In WASM, allocation costs more than arithmetic, so profile allocations first ([architecture](architecture.md), **Measuring**).
- Check that every preset's result is bit for bit identical with `make preset-hashes ARGS="--compare <site>"`, and again with `--refine on` and `--refine off`, since a reader can switch refinement on any preset.
- Native Go tests can disagree between arm64 and amd64: arm64 fuses multiply-adds, and the default amd64 build and WASM do not. On an arm64 machine, a borderline numerical change needs `GOARCH=amd64 go test` too.
- Which multiply-adds arm64 fuses depends on where a function is inlined. An evaluator that must return a sample's point exactly, such as refinement between samples, has to call the very function the sample loop calls (as `(*caustic).at` is shared), not a copy of its arithmetic.
- Inspect how much work an evaluator call triggers, especially for derived inputs and nested stencils. Reuse already computed values only at the same numerical input, preserving evaluation order and exact argument identity where output depends on them. Build fallback evaluators only when used; their construction may itself sample the curve.
- Measure the affected expensive composed case as well as the direct case. A correctness fix can regress cost even when every output is unchanged. Distinguish necessary additional work from avoidable duplicate evaluations, and report allocation improvements separately from measured speed improvements. Use meaningful operation or allocation bounds where appropriate; noisy headless timing is not a substitute.
- An absolute allocation bound loses its margin when later work removes unrelated allocation on the same path, and can then pass with the very regression it names restored. When a change lowers allocation on a path, rerun the regressions named by that path's existing bounds, not only by a bound you add (the receiver budgets in `engine3/receiver_test.go` share one path), and tighten any that now pass, updating the observed and regressed figures in its comment. Prefer bounds that do not erode: a with-and-without difference, or an object count that rejects work per column.

## CI shards

CI runs the Chromium tests in six shards packed by each spec file's recorded duration (`tests/shards.ts`, read through `TEST_SHARD` in `playwright.config.ts`), not by Playwright's `--shard`, which splits by test count and leaves heavy files bunched in one shard. Every spec file on disk is placed, and a new one counts as the average until it is recorded, so durations never decide whether a test runs, only how evenly. Each shard uploads its per-test durations as `chromium-test-timings-<shard>`.

- Refresh the durations after adding, splitting or removing any spec file, or when comparable runs show a sustained gap of several minutes in shard test-execution time: `make test-durations RUN="<run id> <run id> <run id>"` (needs `gh`), then commit `tests/test-durations.json`. Each file takes its mean over the runs that recorded it. Give three or more recent runs with comparable test workloads: one runner can take half again as long as another over the same files, and 3D files vary most, so durations from a single run leave the next run's shards several minutes apart. A run can be the pull request's own, since every shard uploads its timings even when it fails; a run missing a canceled shard still counts for the files its other shards ran. A PR that adds a spec file is handed to review with it unrecorded, since only CI runs can record it; the reviewer refreshes from the PR's runs.
- Check main's latest duration refresh and its source runs before starting another. Compare the test-execution steps and timing artifacts, excluding queue, installation and startup delays as evidence for rebalancing. Reports include retry attempts; investigate retry-heavy failures separately rather than treating them as ordinary workload. One slow runner alone does not justify a refresh. After integration, reassess the current assignment and avoid repeating maintenance already completed on main. Schedule warranted maintenance before final verification when possible; a later scheduling-only refresh can use [Verification-only follow-ups](#verification-only-follow-ups).
- `tests/shards.spec.ts` checks the balance of recorded files only, so an unrecorded file never fails it, but it packs at the average and can leave one shard minutes longer than the rest.
- A single file longer than a balanced shard's share can't be packed around. Split that file instead.
- Changing the shard count needs only the matrix in `.github/workflows/ci.yml`.

The native race pass runs in its own three-shard `race` job, and `check` runs `make check SKIP_RACE=1`. Under race detection the `engine3` package alone took 15 minutes of the 20 `check` allows. `scripts/go-race.mjs` lists every test, example and fuzz target with `go test -list`, sorts the names, and gives every third name to the same shard, so the shards together run every test once. Reproduce one shard with `make test-go-race RACE_SHARD=2/3`; `make test-go` and `make check` still run the whole pass locally. If a shard nears its limit, raise the count in the matrix.

When a shard fails on a wait for a study to settle (`aria-busy` = "false") or on a test's time limit:

- Rerun the failed shards once (`gh run rerun --failed`) before investigating. Headless Chromium renders WebGL in software, using every core it can, so a heavy 3D study is far slower on a runner than locally, and an extra render pass adds settle time no GPU shows.
- If the same wait fails again, compare its test's duration with main's from the same day's runs, using the `chromium-test-timings-<shard>` reports (`startTime`, `duration` and `file:line` also show what ran beside it), before blaming the branch.
- A test that reads the drawing between a result's arrival and its redraw can see the previous study's state for a few milliseconds. To reproduce it, delay `Worker.prototype.postMessage` in an init script and record `aria-busy` with a `MutationObserver`; effects that redraw a result should be layout effects.

## Mutation testing

Use targeted mutations to refine tests of numerical logic, sampling, validation, state restoration and cancellation.

1. Select plausible faults from the changed contract: a wrong scale or span power, a missing reference term, a looser or stricter threshold, exact zero accepted, one caller bypassing a guard, stale state, shared output storage, or excess evaluation work. Choose applicable faults rather than a fixed quota or only reverting the old code.
2. Inject them in temporary copies or compiler overlays, confirm they compile, and run the relevant tests. A compile failure is not a detected behavioral fault.
3. Investigate survivors: distinguish an equivalent change, a variation inside the allowed margin, and missing coverage. Add a test when the survivor violates the contract and repeat; do not tune tests merely to reject acceptable alternatives.
4. Restore any temporary edits and discard scratch tooling afterward.

Do not add one-off mutation scripts or a maintained mutation framework unless explicitly requested. Report the tested scope, detected and surviving faults, and why each survivor is acceptable or still a coverage gap. A targeted run is not an exhaustive mutation score. Use [meaningful regression assertions](#meaningful-regression-assertions) so a passing comparison cannot hide an empty fixture.

## Safari and iOS

Safari and every iOS browser use WebKit. Playwright's WebKit uses the macOS user-agent stylesheet and focus rules, so it misses some of what an iPhone does.

- **Focus rings after a tap.** iOS Safari treats a programmatic `focus()` after a tap as `:focus-visible` and draws a ring. A menu that moves focus after a pointer action marks itself quiet with `useQuietFocus` (`web/quiet-focus.ts`), as `NotebookMode` does for its picker.
- **Radio and checkbox size.** iOS Safari gives `input[type=radio|checkbox]` a small fixed size, so `appearance: none` with `inset: 0` does not stretch the input over its label. Set `width: 100%; height: 100%` explicitly. To reproduce it in a test, add a weak author rule (`input { width: 16px; height: 16px }`) through a constructed stylesheet (`new CSSStyleSheet()` with `document.adoptedStyleSheets`), which the CSP allows.
- **Button clicks and blur.** Safari does not focus a button when it is clicked, so a blur's `relatedTarget` is null when the reader clicks a menu's own button. Cover click, focus and blur behavior in `tests/webkit.spec.ts` (`make test-webkit`).
- **On-device checks.** Check on a phone over HTTPS with `make preview-lan`: WebKit is several times slower on plain HTTP.
- **Asking for them.** When a change touches controls, touch or gestures, layout at phone width, or the cost of drawing and playback, list what to check on a phone in the PR's verification items: the controls at phone width, and the affected presets in motion. Report them as pending, never as passing. They are not recorded in `docs/`.
