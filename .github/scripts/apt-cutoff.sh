# shellcheck shell=bash
# Sourced by the install scripts: cuts off and retries an install that
# downloads from the runner image's Ubuntu mirror, which has stalled at
# ~40 KB/s for ten minutes or more.
#
# The workflow caches apt's archive ($APT_ARCHIVES), so a warm runner
# downloads nothing. A cold one can still meet a stalled mirror: each attempt
# is cut off after three minutes and retried once, and apt resumes the
# partial downloads, perhaps from a faster mirror. If both attempts stall,
# the step fails naming the mirror, with an `Upstream:` error that means
# rerun the job and open no issue (docs/contributing.md, Recording failures
# and bugs).

archives="${APT_ARCHIVES:?set APT_ARCHIVES to the cached package directory}"

# Points every apt command in the job, including those Playwright runs
# itself, at the cached archive.
use_cached_archive() {
  mkdir -p "$archives/partial"
  # apt downloads as its sandbox user.
  sudo chown _apt "$archives/partial"
  printf 'Dir::Cache::Archives "%s/";\nAPT::Keep-Downloaded-Packages "true";\n' "$archives" |
    sudo tee /etc/apt/apt.conf.d/99cached-archives > /dev/null
}

# After a cut-off. `timeout` stops the command it ran, but not an apt-get
# that command started under sudo: that keeps downloading and holds dpkg's
# lock, so dpkg could not finish its packages and the retry never ran
# (#492). Stop apt-get, let a running dpkg finish, then finish any package
# left half installed. The retry's own apt-get reports anything still wrong.
release_apt() {
  sudo pkill -TERM -x apt-get || true
  for _ in $(seq 30); do
    pgrep -x 'apt-get|dpkg' > /dev/null || break
    sleep 1
  done
  sudo pkill -KILL -x apt-get || true
  sudo dpkg --configure -a || echo "::warning::dpkg could not finish the interrupted packages; retrying anyway."
}

# with_cutoff <what> <command…>: runs the command at most twice, each time
# for at most three minutes.
with_cutoff() {
  local what=$1
  shift
  for attempt in 1 2; do
    if timeout --kill-after=30s 3m "$@"; then
      return 0
    fi
    echo "::warning::Installing $what (attempt $attempt) failed or took over three minutes."
    release_apt
  done
  echo "::error::Upstream: installing $what stalled twice on the Ubuntu mirror; rerun the job (no issue needed)."
  return 1
}
