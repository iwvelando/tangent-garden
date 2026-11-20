// The CI install scripts (.github/scripts/install-*.sh) under bash, with the
// commands they call replaced by stubs, so their recovery from a stalled
// Ubuntu mirror can be checked off a runner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scripts = join(import.meta.dirname, "..", ".github", "scripts");

// Each install attempt reads its outcome from a list in `plan`: `ok`, or
// `stall`, which fails as `timeout` does at its cut-off and leaves an apt-get
// running that holds dpkg's lock (the `lock` file) until it is killed, as
// Playwright's `sudo apt-get` outlives the `npx` that `timeout` stops.
const stubs = {
  // Runs the command as is, but keeps the scripts' system writes local.
  sudo: `case "$1" in
  tee) cat > /dev/null ;;
  chown) ;;
  *) exec "$@" ;;
esac`,
  // Drops its own options and runs the command.
  timeout: `while [ "\${1#-}" != "$1" ] || [ "$1" = 3m ]; do shift; done
exec "$@"`,
  npx: `exec "$STUBS/attempt" npx "$@"`,
  "apt-get": `case "$1" in
  install) exec "$STUBS/attempt" apt-get "$@" ;;
  *) echo "apt-get $*" >> "$STUBS/log" ;;
esac`,
  attempt: `n=$(( $(cat "$STUBS/count" 2>/dev/null || echo 0) + 1 ))
echo $n > "$STUBS/count"
outcome=$(sed -n "\${n}p" "$STUBS/plan")
echo "attempt $n: $* -> $outcome" >> "$STUBS/log"
if [ "$outcome" = stall ]; then touch "$STUBS/lock"; exit 124; fi`,
  dpkg: `echo "dpkg $*" >> "$STUBS/log"
if [ -e "$STUBS/lock" ]; then
  echo "dpkg: error: dpkg frontend lock was locked by /usr/bin/apt-get process" >&2
  exit 2
fi`,
  pkill: `echo "pkill $*" >> "$STUBS/log"
rm -f "$STUBS/lock"`,
  pgrep: `[ -e "$STUBS/lock" ]`,
  sleep: ``,
};

function run(script, plan) {
  const dir = mkdtempSync(join(tmpdir(), "apt-cutoff-"));
  for (const [name, body] of Object.entries(stubs)) {
    writeFileSync(join(dir, name), `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(join(dir, name), 0o755);
  }
  writeFileSync(join(dir, "plan"), plan.join("\n") + "\n");
  const result = spawnSync("bash", [join(scripts, script)], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      STUBS: dir,
      APT_ARCHIVES: join(dir, "archives"),
    },
  });
  const log = existsSync(join(dir, "log"))
    ? readFileSync(join(dir, "log"), "utf8")
    : "";
  const attempts = log.split("\n").filter((l) => l.startsWith("attempt "));
  return { ...result, log, attempts };
}

for (const script of ["install-chromium.sh", "install-ffmpeg.sh"]) {
  test(`${script} installs at once when the mirror is quick`, () => {
    const r = run(script, ["ok"]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.attempts.length, 1);
  });

  // #492: the retry used to end at dpkg's lock instead of running.
  test(`${script} releases dpkg's lock from a cut-off attempt and retries`, () => {
    const r = run(script, ["stall", "ok"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.attempts.length, 2, r.log);
    // The leftover apt-get is stopped before dpkg finishes its packages.
    const log = r.log.split("\n");
    const kill = log.findIndex((l) => l.startsWith("pkill"));
    const configure = log.findIndex((l) => l === "dpkg --configure -a");
    assert.ok(kill >= 0 && configure > kill, r.log);
    assert.match(r.stdout, /::warning::/);
  });

  test(`${script} names an upstream stall after two attempts`, () => {
    const r = run(script, ["stall", "stall"]);
    assert.equal(r.status, 1);
    assert.equal(r.attempts.length, 2, r.log);
    assert.match(r.stdout, /^::error::Upstream: /m);
  });
}
