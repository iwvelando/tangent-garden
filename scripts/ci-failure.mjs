// Describes a CI run's failed tests as occurrence lines for an issue, and
// finds the issues that already mention each test, so an intermittent
// failure is counted in one place (docs/contributing.md, Recording failures
// and bugs). `make ci-failure RUN=<run id>`; needs `gh`.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// What a failed job's log says: the runner image, each failed test with the
// first line of its first attempt's error, and the outage an install step
// named when it stalled through its own retries (.github/scripts/
// apt-cutoff.sh), which needs a rerun and no issue.
export function parseJobLog(log) {
  const lines = log
    .replace(/\x1b\[[0-9;]*m/g, "")
    .split("\n")
    // GitHub puts a timestamp before every line.
    .map((line) => line.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, ""));
  const name = lines.find((l) => l.startsWith("Image: "))?.slice(7);
  // The image's own version follows its name; the provisioner's comes first.
  const version = lines
    .slice(lines.findIndex((l) => l.startsWith("Image: ")) + 1)
    .find((l) => l.startsWith("Version: "))
    ?.slice(9);
  const failures = [];
  let current = null;
  for (const line of lines) {
    const head = /^ {2}\d+\) \[(.+?)\] › (.+?):\d+:\d+ › (.*)$/.exec(line);
    if (head) {
      current = {
        project: head[1],
        file: head[2],
        title: head[3].trim(),
        error: "",
        pageLost: false,
      };
      failures.push(current);
    } else if (!line.startsWith("    ") && line.trim()) current = null;
    else if (/^ {4}Retry #\d+/.test(line)) current = null;
    else if (current) {
      if (!current.error && line.trim()) current.error = line.trim();
      if (/has been closed|crashed/i.test(line)) current.pageLost = true;
    }
  }
  const upstream =
    lines
      .map((l) => /^##\[error\]Upstream: (.*)$/.exec(l)?.[1])
      .find(Boolean) ?? "";
  return {
    image: name ? `${name} ${version ?? ""}`.trim() : "",
    failures,
    upstream,
  };
}

// One failure of one test, as a line for an issue comment.
export function occurrence({ date, url, run, attempt, job, image, failure }) {
  return (
    `- ${date}, [run ${run}, attempt ${attempt}](${url}), job \`${job}\`` +
    `${image ? ` on ${image}` : ""}: \`${failure.file}\` › ${failure.title}. ` +
    failure.error +
    (failure.pageLost ? " (the page closed or crashed under the test)" : "")
  );
}

// A job that failed before or after its tests, as a line: an upstream outage
// to rerun, or a log still to read.
export function outsideTests({
  date,
  url,
  run,
  attempt,
  job,
  image,
  upstream,
}) {
  return (
    `- ${date}, [run ${run}, attempt ${attempt}](${url}), job \`${job}\`` +
    `${image ? ` on ${image}` : ""}: ` +
    (upstream
      ? `upstream, ${upstream}`
      : "failed outside the tests; read its log.")
  );
}

function gh(...args) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 1 << 28,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// A log carries color codes, which a newer gh prints only when told to and
// an older one does not know the flag for.
function jobLog(repo, id) {
  const path = `repos/${repo}/actions/jobs/${id}/logs`;
  try {
    return gh("api", "--allow-escape-sequences", path);
  } catch {
    return gh("api", path);
  }
}

function main() {
  const run = process.argv[2];
  if (!/^\d+$/.test(run ?? "")) {
    console.error("usage: node scripts/ci-failure.mjs <CI run id>");
    process.exit(2);
  }
  const repo = gh(
    "repo",
    "view",
    "--json",
    "nameWithOwner",
    "--jq",
    ".nameWithOwner",
  ).trim();
  const attempts = Number(
    gh("api", `repos/${repo}/actions/runs/${run}`, "--jq", ".run_attempt"),
  );
  const seen = new Set();
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const jobs = JSON.parse(
      gh(
        "api",
        `repos/${repo}/actions/runs/${run}/attempts/${attempt}/jobs?per_page=100`,
        "--jq",
        // `verify` only reports the others.
        '[.jobs[] | select(.conclusion == "failure" and .name != "verify")]',
      ),
    );
    for (const job of jobs) {
      // An attempt that reran only the failed jobs lists the others again.
      if (seen.has(job.id)) continue;
      seen.add(job.id);
      const { image, failures, upstream } = parseJobLog(jobLog(repo, job.id));
      const url = `https://github.com/${repo}/actions/runs/${run}/attempts/${attempt}`;
      if (failures.length === 0)
        console.log(
          outsideTests({
            date: job.completed_at.slice(0, 10),
            url,
            run,
            attempt,
            job: job.name,
            image,
            upstream,
          }),
        );
      for (const failure of failures) {
        console.log(
          occurrence({
            date: job.completed_at.slice(0, 10),
            url,
            run,
            attempt,
            job: job.name,
            image,
            failure,
          }),
        );
        // The last part of a title is the test's own name.
        const name = failure.title.split(" › ").at(-1);
        const issues = JSON.parse(
          gh(
            "issue",
            "list",
            "--state",
            "all",
            "--search",
            `"${name.replaceAll('"', "")}"`,
            "--json",
            "number,title,state",
          ),
        );
        for (const issue of issues)
          console.log(
            `    mentioned in #${issue.number} (${issue.state.toLowerCase()}): ${issue.title}`,
          );
        if (issues.length === 0)
          console.log("    no issue mentions this test by name");
      }
    }
  }
  if (seen.size === 0) console.log(`Run ${run} has no failed job.`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
