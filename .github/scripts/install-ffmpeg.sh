#!/usr/bin/env bash
# Installs ffmpeg (for ffprobe, which independently decodes exported MP4
# files in the browser tests) on a runner, after install-chromium.sh has
# refreshed the package lists and pointed apt at the cached archive. Its ~50
# packages come from the Ubuntu mirror, through the cut-off and retry in
# apt-cutoff.sh: a cold archive once timed two shards out (#494).
set -euo pipefail
# shellcheck source=SCRIPTDIR/apt-cutoff.sh
source "$(dirname "$0")/apt-cutoff.sh"

with_cutoff ffmpeg sudo apt-get install -y --no-install-recommends ffmpeg
# Drop packages from an older image or Playwright that apt no longer lists,
# so the archive does not grow with every image.
sudo apt-get autoclean
# apt leaves the archive root-owned; the cache is saved as the runner.
sudo chown -R "$(id -u):$(id -g)" "$archives"
