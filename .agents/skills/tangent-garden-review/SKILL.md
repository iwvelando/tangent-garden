---
name: tangent-garden-review
description: Review a Tangent Garden PR, branch, or local diff for approach, correctness, regression coverage, and repository standards, including fresh-context reviews and authorized takeovers. Use for review requests, not ordinary implementation merely because it touches this repository.
---

# Tangent Garden review

Produce an evidence-based review of the requested change. Use the repository's [AGENTS.md](../../../AGENTS.md) as policy and [Reviewing changes](../../../docs/reviewing.md) as the review procedure. Read both unless already in context. Resolve these links from this skill's directory; they refer to the containing checkout, not a globally installed copy.

## Frame the review

Establish the requested behavior, compatibility promises, target base, merge base, reviewed revision and any uncommitted scope. Determine whether the user requested findings only or also authorized fixes. Preserve user work; keep experiments isolated. Do not turn a review into an implementation takeover or externally post findings without authorization.

Record the authorized validation scope before choosing checks. Targeted-only work may be intentional resource scheduling. Distinguish checks you perform from checks the author reports, and track who owns deferred final verification. Use [Validation scope and handoff](../../../docs/contributing.md#validation-scope-and-handoff); do not launch competing full suites to compensate for a narrower implementation phase.

## Select context and challenge assumptions

Read the diff and enough surrounding production code to reconstruct the approach independently. Use the routing table in [Reviewing changes](../../../docs/reviewing.md#follow-the-change-beyond-the-diff) to load only applicable contributing procedures and mathematical or architecture definitions. Follow affected callers outside the diff, including consumers introduced during integration.

Keep a short working record in internal notes or a concise artifact, rather than a running chat log: each material contract, a plausible failing assumption, the affected consumer, and evidence that would resolve it. Focus according to the change:

- For numerical decisions, challenge units, fallback scales and propagated rounding; test acceptance as well as rejection. Vary independent quantities independently and include relevant production sampling.
- For regression coverage, inspect assertions and prove that fixtures reach the named condition. Identify which promised output or caller a passing test could leave unchecked.
- For shared or retained state, follow the real worker entry point, repeated requests, cache keys, validation and ownership. Recheck helpers and consumers after a rebase.
- For performance, account for work inside nested evaluators and construction of unused fallback paths. Separate necessary numerical work from duplicate work.
- For controls and documentation, trace indirect effects and reverse transitions from edited values. Distinguish product failures from test races using the actual failing sequence.

These are prompts for selecting evidence, not a mandatory test matrix for every PR. Apply the detailed procedures to the relevant risks. Choose the smallest test, mutation or inspection that can disprove a doubtful assumption. A full suite cannot supply a missing assertion; a test failure is not evidence of a product defect until its cause is understood.

## Resolve and report

Resolve material hypotheses or state their uncertainty. Classify demonstrated defects, performance regressions, coverage gaps, integration work, defensive improvements, documentation inconsistencies and optional cleanup separately. For a defect, provide the trigger, expected and actual behavior, location and evidence. A sound change can receive a no-findings conclusion; do not impose a quota of findings, edits or mutations.

For authorized fixes, follow the repository's red-green-refactor and final verification procedures, including [Verification-only follow-ups](../../../docs/contributing.md#verification-only-follow-ups) when applicable. Reassess the resulting revision and affected consumers after integration. For review-only work, leave the submitted implementation unchanged and report reproducible findings.

Use the report contents in [Findings and verification](../../../docs/reviewing.md#findings-and-verification): reviewed revision and scope, prioritized findings, checks actually performed, unresolved questions and deferred verification with its owner. State the review verdict separately from completion of final verification. Never imply that packaging validation or a replay of known examples establishes reviewer quality; follow [Evaluating the review procedure](../../../docs/reviewing.md#evaluating-the-review-procedure) when that is the user's task.

Follow [Communication and completion](../../../docs/reviewing.md#communication-and-completion): report meaningful developments, keep required unchanged-status updates brief, and link detailed evidence. For an authorized takeover, replace stale PR handoff instructions with actual final status. Stop when material hypotheses are resolved or qualified, required verification is complete or explicitly deferred, and the handoff is accurate; additional experiments need a concrete unresolved risk.
