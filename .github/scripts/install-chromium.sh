#!/usr/bin/env bash
# Installs Playwright's Chromium and the Ubuntu packages it needs on a runner.
#
# The browser comes from Playwright's CDN in seconds. Its ~25 MB of fonts and
# libraries come from the runner image's Ubuntu mirror, through the cached
# archive and the cut-off and retry in apt-cutoff.sh. If both attempts stall,
# the step fails in about eight minutes, naming the cause, rather than using
# up the job.
set -euo pipefail
# shellcheck source=SCRIPTDIR/apt-cutoff.sh
source "$(dirname "$0")/apt-cutoff.sh"

# Playwright runs apt-get itself, so the archive is set in apt's
# configuration rather than on the command line.
use_cached_archive
with_cutoff Chromium npx playwright install --with-deps chromium
