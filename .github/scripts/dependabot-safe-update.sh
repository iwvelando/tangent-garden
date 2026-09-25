#!/usr/bin/env bash
# Reads a Dependabot PR body on stdin and its head commit message in $COMMIT_MESSAGE.
# Exits 0 only if the PR changes no dependency's major version.
#
# Every Dependabot PR body has a line starting "Bumps" or "Updates" that says
# "from <old> to <new>" for each dependency, grouped or not. Only those lines count:
# the quoted upstream release notes below them mention other versions. The commit's
# `update-type` metadata is not enough on its own: security updates sometimes omit it.
set -euo pipefail

pairs=$(grep -E '^(Bumps|Updates) ' | grep -oE 'from `?v?[0-9][^ `]* to `?v?[0-9][^ `]*' | sed -E 's/[`v]//g; s/^from //; s/ to / /; s/\.$//' || true)
if [ -z "$pairs" ]; then
  echo "No version changes found; leaving it for a human."
  exit 1
fi

status=0
while read -r old new; do
  if [ "${old%%.*}" != "${new%%.*}" ]; then
    echo "major: $old -> $new"
    status=1
  else
    echo "ok:    $old -> $new"
  fi
done <<<"$pairs"

if grep -q 'update-type: version-update:semver-major' <<<"${COMMIT_MESSAGE:-}"; then
  echo "commit metadata says semver-major"
  status=1
fi
exit $status
