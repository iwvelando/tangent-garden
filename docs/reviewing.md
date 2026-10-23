# Reviewing changes

Use this procedure for a PR, branch or local diff, including a review started in a fresh context. [AGENTS.md](../AGENTS.md) remains the policy; [Contributing](contributing.md) holds implementation and verification procedures. The repository-local [tangent-garden-review skill](../.agents/skills/tangent-garden-review/SKILL.md) selects the relevant procedures for an agent. In Codex, invoke it with `$tangent-garden-review` and the PR or revision to review. The procedure also works when the reviewing tool does not load skills.

## Establish the review

Record the target base, merge base and reviewed head, or the base revision and uncommitted scope for a local diff. Distinguish review-only work from an authorized takeover that includes fixes. Preserve user edits and use isolated scratch copies or compiler overlays for experiments. A review request does not by itself authorize posting comments, merging or deploying.

Read the intended behavior and compatibility promises, then independently reconstruct the implementation from code. Treat the author's explanation, reported checks and existing test names as claims to verify. Separate personally reproduced evidence from reported evidence. Follow the user's validation scope: a targeted-only implementation handoff is legitimate when authorized, and final verification may belong to a later stage. Use [Validation scope and handoff](contributing.md#validation-scope-and-handoff) to track that work.

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

## Challenge the approach

Identify the assumption most likely to fail and choose a small experiment that could disprove it. For numerics, examine both false acceptance and false rejection under the relevant transformations and near the decision boundary. For state, examine request sequences and storage ownership. For a new option, trace indirect effects and the transition back from edited values. For performance, inspect nested work and eager construction before interpreting timing. The contributing procedures specify the detailed checks.

Read assertions before running tests. Establish that fixtures reach the claimed state and use the relevant production entry point. A passing comparison between two empty outputs proves little. A full suite adds breadth over existing assertions; it does not supply missing assertions, prove the approach, or replace numerical reasoning. Choose targeted tests and mutations to resolve concrete doubts, and use final verification for integration confidence.

When comparing with the base, distinguish a newly introduced regression, an incomplete fix of an existing defect, and an interaction introduced during integration. Do not attribute a CI package-install failure or an inherited test race to the numerical change without evidence. A deliberately throttled reproduction can establish a race more usefully than repeatedly running the full suite under uncontrolled load.

## Findings and verification

Classify each material observation as a demonstrated bug, performance regression, coverage gap, integration requirement, defensive improvement, documentation inconsistency or optional cleanup. For a defect, give the triggering input or sequence, expected and actual behavior, affected code location and evidence. A reproduction is preferred; when it is unavailable, state the reasoning and uncertainty. Coverage gaps and defensive improvements are not automatically production bugs. Prioritize by user impact, not by the number of follow-up edits.

If fixes are authorized, reproduce the relevant behavioral failure before changing code and confirm the fix under that protection. Recheck affected callers after integrating it. If the task is review-only, report the findings and retain reproducible evidence without changing the submitted implementation. In either case, a sound change may need no edits; do not invent findings or require a fixed number of tests or mutations.

The review report records:

- The revision and scope reviewed, including whether later integration was examined.
- Prioritized findings with locations and evidence; optional cleanup is separate.
- Checks personally run, the failing cases reproduced, mutation survivors when tested, and author-reported checks clearly identified as such.
- Unresolved questions, deferred checks and the stage owning final verification; state when that stage is unassigned.

Apply [AGENTS.md's final verification requirements and exceptions](../AGENTS.md#verification). Resource scheduling and test quality are separate: honor an authorized targeted-only phase, then have the designated integration or review stage run final checks on the final revision in a quiet slot. A review verdict and completion of final verification are separate statements.

## Evaluating the review procedure

When evaluating a change to this guide or the skill, use fresh-context reviews of held-out or future changes. Supply the initial revision, intended behavior and authorized validation scope without later fixes, suspected findings or the evaluator's conclusions. Include sound changes as well as defects. Compare substantive defect recovery, false positives, useful regression coverage, appropriate no-change conclusions and resource cost under comparable conditions.

Replaying examples used to write the guidance can check that it is usable, but does not establish generalization or parity between models. Record whether an evaluation was independent and what it actually exercised. A skill-format validator checks packaging, not review quality. Keep temporary evaluation artifacts outside the working tree unless a maintained evaluation is explicitly requested.
