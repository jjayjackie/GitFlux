// Runs the node:test suites with Node's own runner and type stripping, portably (Linux, macOS, Windows).
//
//   node scripts/run-tests.mjs <unit|integration|all> [--test-reporter=<name> [--test-reporter-destination=<dest>]] [--test-*=...]
//
// unit         test/unit/**/*.test.ts, plus the legacy test/*.test.ts files still at the root of test/
// integration  test/integration/**/*.test.ts
// all          both
//
// Git runs in an isolated environment (scripts/git-env.mjs). The run fails when a test directory that exists holds no
// test file, when no test ran, and when any test was skipped, marked todo or cancelled: this project has no skipped
// tests. Counts go to stdout and, on GitHub Actions, to the job summary.

import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isolatedGitEnv } from "./git-env.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEST_FILE = /\.test\.(?:ts|mts|js|mjs)$/;

/** Each suite: directories searched recursively, and directories searched at their top level only (legacy layout). */
const SUITES = {
  unit: { recursive: ["test/unit"], flat: ["test"] },
  integration: { recursive: ["test/integration"], flat: [] },
};

const [suite, ...rest] = process.argv.slice(2);
if (!suite || !["unit", "integration", "all"].includes(suite)) {
  console.error("Usage: node scripts/run-tests.mjs <unit|integration|all> [--test-reporter=...] [--test-*=...]");
  process.exit(2);
}

/** @param {string} directory @returns {string[]} */
function walk(directory) {
  /** @type {string[]} */
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...walk(path));
    else if (entry.isFile() && TEST_FILE.test(entry.name)) found.push(path);
  }
  return found;
}

/** @param {"unit" | "integration"} name */
function collect(name) {
  const { recursive, flat } = SUITES[name];
  /** @type {string[]} */
  const files = [];
  /** @type {string[]} */
  const problems = [];
  let existing = 0;
  for (const directory of recursive) {
    const absolute = join(root, directory);
    if (!existsSync(absolute)) continue;
    existing++;
    const found = walk(absolute);
    if (found.length === 0) problems.push(`${directory}/ exists but holds no *.test.ts file`);
    files.push(...found);
  }
  for (const directory of flat) {
    const absolute = join(root, directory);
    if (!existsSync(absolute)) continue;
    for (const entry of readdirSync(absolute)) {
      const path = join(absolute, entry);
      if (TEST_FILE.test(entry) && statSync(path).isFile()) files.push(path);
    }
  }
  return { files, problems, existing };
}

const names = suite === "all" ? /** @type {const} */ (["unit", "integration"]) : [/** @type {"unit" | "integration"} */ (suite)];
/** @type {string[]} */
const files = [];
/** @type {string[]} */
const problems = [];
for (const name of names) {
  const found = collect(name);
  problems.push(...found.problems);
  if (found.existing === 0 && found.files.length === 0) {
    // The suite's directory is not there yet: the tests are being moved into it. Say so where CI shows it.
    const notice = `No ${SUITES[name].recursive.join(", ")}/ directory: the ${name} suite has no tests yet.`;
    console.log(process.env.GITHUB_ACTIONS ? `::warning title=${name} tests::${notice}` : notice);
  }
  files.push(...found.files);
}
if (problems.length > 0) {
  for (const problem of problems) console.error(`error: ${problem}`);
  process.exit(1);
}
const unique = [...new Set(files)].sort();
if (unique.length === 0) {
  if (suite === "integration") process.exit(0); // the warning above explains it
  console.error(`error: no test files found for the ${suite} suite`);
  process.exit(1);
}

// Reporters: the caller's (default spec on stdout), and always a TAP file this script reads the counts from.
/** @type {string[]} */
const reporters = [];
/** @type {string[]} */
const destinations = [];
/** @type {string[]} */
const passthrough = [];
for (let index = 0; index < rest.length; index++) {
  const arg = rest[index];
  const [flag, inline] = arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, undefined];
  if (flag === "--test-reporter" || flag === "--test-reporter-destination") {
    const value = inline ?? rest[++index];
    if (value === undefined) {
      console.error(`error: ${flag} needs a value`);
      process.exit(2);
    }
    (flag === "--test-reporter" ? reporters : destinations).push(value);
  } else if (flag.startsWith("--test-")) {
    passthrough.push(arg);
  } else {
    console.error(`error: unexpected argument ${arg}`);
    process.exit(2);
  }
}
if (reporters.length === 0) reporters.push("spec");
while (destinations.length < reporters.length) destinations.push("stdout");
if (destinations.length > reporters.length) {
  console.error("error: more --test-reporter-destination than --test-reporter options");
  process.exit(2);
}
const resultsDirectory = join(root, "test-results");
mkdirSync(resultsDirectory, { recursive: true });
const tapFile = join(resultsDirectory, `${suite}.tap`);
reporters.push("tap");
destinations.push(tapFile);

const args = ["--test"];
reporters.forEach((reporter, index) => args.push(`--test-reporter=${reporter}`, `--test-reporter-destination=${destinations[index]}`));
args.push(...passthrough, ...unique.map((file) => relative(root, file)));

console.log(`Running ${unique.length} test file(s) for the ${suite} suite with Node ${process.version}`);
const child = spawn(process.execPath, args, { cwd: root, env: isolatedGitEnv(), stdio: "inherit" });
const code = await new Promise((done) => {
  child.on("error", (error) => {
    console.error(error);
    done(1);
  });
  child.on("close", (status, signal) => done(signal ? 1 : (status ?? 1)));
});

// The last unindented "# <name> <number>" lines are the run's totals.
const tap = existsSync(tapFile) ? readFileSync(tapFile, "utf8") : "";
/** @type {Record<string, number>} */
const totals = {};
for (const line of tap.split(/\r?\n/)) {
  const match = /^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) ([\d.]+)$/.exec(line);
  if (match) totals[match[1]] = Number(match[2]);
}
const marked = tap
  .split(/\r?\n/)
  .map((line) => /^\s*(?:not )?ok \d+ - (.*?) # (SKIP|TODO)\b/i.exec(line))
  .filter((match) => match !== null)
  .map((match) => `${match[2].toUpperCase()}: ${match[1]}`);

const count = (name) => totals[name] ?? 0;
/** @type {string[]} */
const failures = [];
if (code !== 0) failures.push(`node --test exited with ${code}`);
if (!("tests" in totals)) failures.push("the test run reported no totals");
else if (count("tests") === 0) failures.push("no test ran");
if (count("skipped") > 0) failures.push(`${count("skipped")} test(s) skipped`);
if (count("todo") > 0) failures.push(`${count("todo")} test(s) marked todo`);
if (count("cancelled") > 0) failures.push(`${count("cancelled")} test(s) cancelled`);

const line = `tests ${count("tests")}, passed ${count("pass")}, failed ${count("fail")}, cancelled ${count("cancelled")}, skipped ${count("skipped")}, todo ${count("todo")}`;
console.log(`\n${suite}: ${line} (${Math.round(count("duration_ms"))} ms)`);
for (const entry of marked) console.error(`  ${entry}`);

if (process.env.GITHUB_STEP_SUMMARY) {
  const status = failures.length === 0 ? "passed" : "failed";
  const summary = [
    `### Tests: ${suite} on ${process.platform}, Node ${process.version} (${status})`,
    "",
    "| Files | Tests | Passed | Failed | Cancelled | Skipped | Todo | Duration |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    `| ${unique.length} | ${count("tests")} | ${count("pass")} | ${count("fail")} | ${count("cancelled")} | ${count("skipped")} | ${count("todo")} | ${(count("duration_ms") / 1000).toFixed(1)} s |`,
    "",
    ...failures.map((failure) => `- ${failure}`),
    ...marked.map((entry) => `- ${entry}`),
    "",
  ].join("\n");
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`error: ${failure}`);
  process.exit(1);
}
