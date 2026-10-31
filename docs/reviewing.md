# Reviewing changes

Use this procedure for a PR, branch or local diff, including a review started in a fresh context. [AGENTS.md](../AGENTS.md) remains the policy; [Contributing](contributing.md) holds implementation and verification procedures. The repository-local [tangent-garden-review skill](../.agents/skills/tangent-garden-review/SKILL.md) selects the relevant procedures for an agent. In Codex, invoke it with `$tangent-garden-review` and the PR or revision to review. The procedure also works when the reviewing tool does not load skills.

## Establish the review

Record the target base, merge base and reviewed head, or the base revision and uncommitted scope for a local diff. Distinguish review-only work from an authorized takeover that includes fixes. Preserve user edits and use isolated scratch copies or compiler overlays for experiments. A review request does not by itself authorize posting comments, merging or deploying.

An authorized takeover after an implementer's handoff includes the PR's CI. The implementer opens the PR without waiting for it, so its first results are the reviewer's to read: rerun, correct and refresh durations under [Verification-only follow-ups](contributing.md#verification-only-follow-ups), or treat a failure as a finding when its cause is the change. Read the handoff for the full run's revision and any spec file still unrecorded in the shard durations.

Read the intended behavior and compatibility promises, then independently reconstruct the implementation from code. Treat the author's explanation, reported checks and existing test names as claims to verify. Separate personally reproduced evidence from reported evidence. Follow the user's validation scope and the default product-iteration procedure: targeted checks support early artwork and interaction feedback, while final verification belongs to the implementing session or its designated integration stage. Do not require a full `make pre-pr` merely to offer feedback on an early product preview. Use [Validation scope and handoff](contributing.md#validation-scope-and-handoff) to track that work.

## Follow the change beyond the diff

Trace changed values through affected callers, including sampling, refinement, derived inputs, diagnostics, the stateful worker, drawing and exports where relevant. Identify the assumptions each caller supplies and what it observes. Recheck newly merged helpers and consumers on the target branch; conflict resolution can change the effective scope even when the feature itself is unchanged. Assess the rebased revision rather than carrying forward an earlier verdict unchanged.

Load guidance by the behavior touched; there is no need to read every topic for every review:

| Change or risk | Read and apply |
| --- | --- |
| Numerical guards, stencils, regularity, transformed studies | [Numerical changes](contributing.md#numerical-changes), the affected mathematical definition and its error budgets |
| Shared evaluators, parser transformations, caches, repeated requests | [Shared paths and state](contributing.md#shared-paths-and-state) and the relevant architecture section |
| Hot paths, nested evaluations, allocation, transport | [Transport and performance](contributing.md#transport-and-performance) |
| Weak assertions, unexplored thresholds or suspiciously easy passes | [Meaningful regression assertions](contributing.md#meaningful-regression-assertions) and [Mutation testing](contributing.md#mutation-testing) |
| Settings, controls, defaults, help or changed limits | [Documentation and indirect behavior](contributing.md#documentation-and-indirect-behavior); the applicable preset, field, link and layout procedures |
| Asynchronous controls, playback tests or flaky CI | [Running the tests](contributing.md#running-the-tests), [CI shards](contributing.md#ci-shards), and [Safari and iOS](contributing.md#safari-and-ios) when applicable |

## Application consistency and complete flows

For a new or substantially changed interface, read the implementation's integration plan and [Application integration and user walkthrough](contributing.md#application-integration-and-user-walkthrough). Compare the actual entry, retained study/view ownership, preferences, controls, gestures, help/errors and sharing/export experience with the named application precedents. Follow a complete user flow, including return and incoming links, rather than assessing only the signature artwork or isolated components. Use browser interaction and targeted tests for the material risks; report which layouts and input methods were actually exercised. Passing screenshots do not establish reachable controls or correct scrolling.

Treat owner-approved product choices as context, not proof of correctness. Independently check supported edited inputs beyond the authored presets, including domain gaps and degenerate cases relevant to the numerical path. Distinguish a deliberate product difference from a bug or an unapproved scope change. Do not redesign a sound interface to satisfy a preference the owner has not expressed. Material product changes made during an authorized takeover return to the exploration checkpoint before final verification.

## Challenge the approach

Identify the assumption most likely to fail and choose a small experiment that could disprove it. For numerics, examine both false acceptance and false rejection under the relevant transformations and near the decision boundary. For state, examine request sequences and storage ownership. For a new option, trace indirect effects and the transition back from edited values. For performance, inspect nested work and eager construction before interpreting timing; after an allocation saving, check that the path's existing allocation bounds, not only the new one, still reject the regressions they name. The contributing procedures specify the detailed checks.

Read assertions before running tests. Establish that fixtures reach the claimed state and use the relevant production entry point. A passing comparison between two empty outputs proves little. A full suite adds breadth over existing assertions; it does not supply missing assertions, prove the approach, or replace numerical reasoning. Choose targeted tests and mutations to resolve concrete doubts, and use final verification for integration confidence.

When comparing with the base, distinguish a newly introduced regression, an incomplete fix of an existing defect, and an interaction introduced during integration. Do not attribute a CI package-install failure or an inherited test race to the numerical change without evidence. A deliberately throttled reproduction can establish a race more usefully than repeatedly running the full suite under uncontrolled load. Before accepting a per-test timing amendment, check whether the same wait has recurred in recent changes; a shared cause needs a shared fix or a reported decision, not another amended call site.

## Findings and verification

Classify each material observation as a demonstrated bug, performance regression, coverage gap, integration requirement, defensive improvement, documentation inconsistency or optional cleanup. For a defect, give the triggering input or sequence, expected and actual behavior, affected code location and evidence. A reproduction is preferred; when it is unavailable, state the reasoning and uncertainty. Coverage gaps and defensive improvements are not automatically production bugs. Prioritize by user impact, not by the number of follow-up edits.

If fixes are authorized, reproduce the relevant behavioral failure before changing code and confirm the fix under that protection. Recheck affected callers after integrating it. If the task is review-only, report the findings and retain reproducible evidence without changing the submitted implementation. In either case, a sound change may need no edits; do not invent findings or require a fixed number of tests or mutations.

The review report records:

- The revision and scope reviewed, including whether later integration was examined.
- Prioritized findings with locations and evidence; optional cleanup is separate.
- Checks personally run, the failing cases reproduced, mutation survivors when tested, and author-reported checks clearly identified as such.
- Unresolved questions, deferred checks and the stage owning final verification; state when that stage is unassigned.

Apply [AGENTS.md's final verification requirements and exceptions](../AGENTS.md#verification), including [Verification-only follow-ups](contributing.md#verification-only-follow-ups) after a successful full run. Resource scheduling and test quality are separate: honor an authorized targeted-only phase, then have the designated integration or review stage complete final verification in a quiet slot. A review verdict and completion of final verification are separate statements.

## Communication and completion

Do not commit PR-specific review reports, validation guides, handoff notes, mutation logs, or other review artifacts. Keep working records and human validation instructions outside the repository or in an ignored local directory such as `.codex/`, and link them in the chat handoff when useful. Do not add files such as `docs/prNNN-validation.md`. Durable mathematical, usage, architecture and contributor documentation still belongs in the repository when the change requires an update; PR-specific evidence belongs in the PR description.

Progress messages emphasize a finding, decision, failure or meaningful stage change. Avoid repeatedly narrating green test counts or remaining CI shards. If a higher-priority instruction requires an update during an unchanged wait, keep it to a brief status; do not start extra checks just to produce news. A repository skill cannot override that external update cadence.

Lead the final response with the verdict, material changes, verification status and any remaining user action. Link detailed evidence and requested validation instructions instead of repeating the command log. Include material uncertainty and deferred work even when keeping the response short.

For an authorized takeover, update the PR description before handing it back: replace stale instructions to run deferred checks with their actual status, identify the reviewed and tested revisions, and distinguish author-reported evidence, personally performed checks and CI results. A green CI run does not establish that a local command ran. Keep unfinished checks and their owner explicit. If updating the PR is outside the task's authorization, supply the corrected handoff text to the user. A human validation guide complements this status; it does not replace it.

Stop when material review hypotheses are resolved or clearly qualified, required verification is complete or explicitly deferred under the user's authorization, and the handoff is accurate. Additional experiments need a concrete unresolved risk or new evidence. Pending required CI remains pending verification; use bounded waits and avoid repeating unaffected local checks while it runs. A sound implementation needs no edits merely to demonstrate review effort.

When the takeover authorizes merging, merge only once material findings are resolved, required verification is complete and CI passes on the final head. Then follow the `main` run through its deploy and live smoke tests ([Deployment](development.md#deployment)); report a failed deploy rather than retrying it another way. Finish with the post-merge handoff in [Review, completion and downstream handoff](contributing.md#review-completion-and-downstream-handoff): the outcome comment, reconciled issue bodies and downstream refreshes.

## Evaluating the review procedure

When evaluating a change to this guide or the skill, use fresh-context reviews of held-out or future changes. Supply the initial revision, intended behavior and authorized validation scope without later fixes, suspected findings or the evaluator's conclusions. Include sound changes as well as defects. Compare substantive defect recovery, false positives, useful regression coverage, appropriate no-change conclusions and resource cost under comparable conditions.

Replaying examples used to write the guidance can check that it is usable, but does not establish generalization or parity between models. Record whether an evaluation was independent and what it actually exercised. A skill-format validator checks packaging, not review quality. Keep temporary evaluation artifacts outside the working tree unless a maintained evaluation is explicitly requested.
