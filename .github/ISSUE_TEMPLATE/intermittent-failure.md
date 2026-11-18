---
name: Intermittent failure
about: A test or CI job that failed for a reason other than the change under test
title: "Intermittent: <test name>: <error in a few words>"
labels: "ci-flake"
---

<!-- Search open and closed issues for the test's name first. If one covers this failure, add the occurrence there instead. A job that never acquired a GitHub Actions runner needs no issue: rerun it. See docs/contributing.md, Recording failures and bugs. -->

## Failure

<!-- The test (file and name), the browser or job, and the first line of the error. -->

## Occurrences

<!-- One line each, from `make ci-failure RUN=<run id>`: date, run and attempt, job and runner image, test, error. Later occurrences go in comments. -->

## What is known

<!-- Whether it passed when rerun, whether it reproduces locally, what the log, trace or crash report shows, and any related issue. State what is inferred as inference. -->
