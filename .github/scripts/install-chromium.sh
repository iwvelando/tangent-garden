#!/usr/bin/env bash
# Installs Playwright's Chromium and the Ubuntu packages it needs on a runner.
#
# The browser comes from Playwright's CDN in seconds. Its ~25 MB of fonts and
# libraries come from the runner image's Ubuntu mirror, which has stalled at
# ~40 KB/s for ten minutes or more. So apt keeps every package it downloads in
# $APT_ARCHIVES, which the workflow caches: a warm runner installs them with no
# download, and later apt commands in the job (ffmpeg) share the archive.
#
# A cold runner can still meet a stalled mirror. Each attempt is cut off after
# three minutes and retried once; apt resumes partial downloads, and a new
# connection may reach a faster mirror. If both attempts stall, the step fails
# in about seven minutes, naming the cause, rather than using up the job.
set -euo pipefail

archives="${APT_ARCHIVES:?set APT_ARCHIVES to the cached package directory}"
mkdir -p "$archives/partial"
# apt downloads as its sandbox user.
sudo chown _apt "$archives/partial"
# Playwright runs apt-get itself, so the archive is set in apt's configuration
# rather than on the command line.
printf 'Dir::Cache::Archives "%s/";\nAPT::Keep-Downloaded-Packages "true";\n' "$archives" |
  sudo tee /etc/apt/apt.conf.d/99cached-archives > /dev/null

for attempt in 1 2; do
  if timeout --kill-after=30s 3m npx playwright install --with-deps chromium; then
    exit 0
  fi
  echo "::warning::Installing Chromium (attempt $attempt) failed or took over three minutes."
  # Finish any package an interrupted dpkg left half installed.
  sudo dpkg --configure -a
done
echo "::error::Installing Chromium failed twice. The Ubuntu mirror is probably stalled; rerun the job."
exit 1
