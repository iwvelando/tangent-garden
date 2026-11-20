---
name: Intermittent failure
about: A test or CI job that failed for a reason other than the change under test
title: "Intermittent: <test name>: <error in a few words>"
labels: "ci-flake"
---

<!-- Search open and closed issues for the test's name first. If one covers this failure, add the occurrence there instead. An upstream failure, which nothing in this repository could change, needs no issue: rerun it. That covers a runner never acquired or lost, a GitHub service error, an install step ending `Upstream:`, and a WebKit loss the crash retry passed. See docs/contributing.md, Upstream failures get no issue. -->

## Failure

<!-- The test (file and name), the browser or job, and the first line of the error. -->

## Occurrences

<!-- One line each, from `make ci-failure RUN=<run id>`: date, run and attempt, job and runner image, test, error. Later occurrences go in comments. -->

## What is known

<!-- Whether it passed when rerun, whether it reproduces locally, what the log, trace or crash report shows, and any related issue. State what is inferred as inference. -->

## What this repository can change

<!-- Required. The test, script, timeout, retry or product code that could remove or absorb this failure. If nothing here could, do not open this issue: rerun the job. -->
