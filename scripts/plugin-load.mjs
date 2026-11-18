// Proves that a real, headless Paseo daemon compiles and runs this checkout as a plugin.
//
//   node scripts/plugin-load.mjs [--paseo-version <version|latest>] [--hosts 1|2] [--plugin-dir <path>]
//
// Run `npm ci --omit=dev` in the plugin directory first, as the manifest's build step does on a Git install
// (a directory install does not run the build step).
//
// What it does, per host: a fresh PASEO_HOME in a temporary directory; `paseo daemon config set` for
// `daemon.listen 127.0.0.1:<free port>`, `daemon.relay.enabled false` and `pluginsEnabled true`;
// `paseo daemon start --home <home>`; `paseo plugin install <plugin dir> --home <home> --json`; then it polls
// `paseo plugin ls --home <home> --json` until `gitflux` reports `running` (or `failed`), and finally
// `paseo daemon stop --home <home>`. On failure it prints `paseo plugin logs gitflux` and the daemon log.
// With --hosts 2 it starts two isolated daemons (two homes, two ports) and checks that installation is per host:
// install on A only → B does not list it; install on B → both run; remove from A → B still runs.
//
// Minimal headless configuration (verified against the CLI and server sources of 0.14.0 and 0.16.0):
// - `pluginsEnabled` is the daemon-wide switch (root of config.json); without it an installed plugin stays
//   `disabled`. It is set before the first start so nothing has to be reloaded.
// - The relay is off and the daemon listens on loopback only. No login, pairing, provider binary or GUI is needed to
//   start the daemon, install a directory plugin or list plugins.
// - `daemon start` (managed) ignores PASEO_LISTEN and relay overrides in the environment, which is why the settings go
//   through `daemon config set` rather than the environment. PASEO_HOME and PASEO_HOST are removed from the
//   environment so `--home` is the only selector (both set at once is TARGET_AMBIGUOUS).
//
// The CLI (npm package @getpaseo/cli, bin `paseo`) is installed into a temporary prefix unless PASEO_BIN points at one.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ID = "gitflux";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";

// --- arguments -----------------------------------------------------------------------------------------------------

const options = { paseoVersion: "latest", hosts: 1, pluginDir: root };
const argv = process.argv.slice(2);
for (let index = 0; index < argv.length; index++) {
  const [flag, inline] = argv[index].includes("=") ? argv[index].split(/=(.*)/s) : [argv[index], undefined];
  const value = () => inline ?? argv[++index] ?? fatal(`${flag} needs a value`);
  if (flag === "--paseo-version") options.paseoVersion = value();
  else if (flag === "--hosts") options.hosts = Number(value());
  else if (flag === "--plugin-dir") options.pluginDir = resolve(value());
  else fatal(`unknown argument ${argv[index]}`);
}
if (options.hosts !== 1 && options.hosts !== 2) fatal("--hosts must be 1 or 2");
if (!/^(latest|\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?)$/.test(options.paseoVersion)) fatal(`--paseo-version ${options.paseoVersion} is not a version`);
if (!existsSync(join(options.pluginDir, "paseo-plugin.json"))) fatal(`${options.pluginDir} has no paseo-plugin.json`);
const manifestId = JSON.parse(readFileSync(join(options.pluginDir, "paseo-plugin.json"), "utf8")).id;
if (manifestId !== PLUGIN_ID) fatal(`paseo-plugin.json id is ${manifestId}, expected ${PLUGIN_ID}`);
for (const dependency of ["vscode-diff", "strip-json-comments", "prismjs"]) {
  if (!existsSync(join(options.pluginDir, "node_modules", dependency)))
    fatal(`node_modules/${dependency} is missing: run npm ci --omit=dev in ${options.pluginDir} first`);
}

/** @param {string} message @returns {never} */
function fatal(message) {
  console.error(`plugin-load: ${message}`);
  if (process.env.GITHUB_ACTIONS) console.log(`::error title=plugin-load::${message}`);
  process.exit(1);
}

const log = (message) => console.log(`plugin-load: ${message}`);
const scratch = mkdtempSync(join(tmpdir(), "gitflux-plugin-load-"));

// --- the CLI -------------------------------------------------------------------------------------------------------

/** The environment every paseo command runs with: --home is the only daemon selector. */
const env = { ...process.env };
for (const name of ["PASEO_HOME", "PASEO_HOST", "PASEO_LISTEN", "PASEO_RELAY_ENABLED", "PORT"]) delete env[name];
env.NO_COLOR = "1";

function installCli() {
  if (process.env.PASEO_BIN) return process.env.PASEO_BIN;
  const prefix = join(scratch, "cli");
  const spec = `@getpaseo/cli@${options.paseoVersion}`;
  log(`installing ${spec} into a temporary prefix`);
  const npm = isWindows ? "npm.cmd" : "npm";
  const result = spawnSync(npm, ["install", "--prefix", prefix, "--no-save", "--no-audit", "--no-fund", "--no-package-lock", spec], {
    stdio: "inherit",
    env,
    shell: isWindows,
  });
  if (result.status !== 0) fatal(`npm install ${spec} failed (exit ${result.status})`);
  const bin = join(prefix, "node_modules", ".bin", isWindows ? "paseo.cmd" : "paseo");
  if (!existsSync(bin)) fatal(`${spec} installed no paseo binary at ${bin}`);
  return bin;
}
const paseo = installCli();

/**
 * Runs `paseo <args>`; resolves with its output whatever the exit code.
 * @param {string[]} args @param {{ timeoutMs?: number }} [settings]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
function run(args, { timeoutMs = 300_000 } = {}) {
  return new Promise((done) => {
    const child = spawn(paseo, args, { env, shell: isWindows, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const timer = setTimeout(() => {
      stderr += `\n[plugin-load: timed out after ${timeoutMs} ms]`;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      done({ code: 1, stdout, stderr: `${stderr}\n${error.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ code: code ?? 1, stdout, stderr });
    });
  });
}

/** Runs and requires success. @param {string[]} args @param {{ timeoutMs?: number }} [settings] */
async function must(args, settings) {
  const result = await run(args, settings);
  if (result.code !== 0) throw new Error(`paseo ${args.join(" ")} failed (exit ${result.code})\n${result.stdout}\n${result.stderr}`);
  return result;
}

/** Parses the JSON a `--json` command printed (the CLI may print notices to stderr only). @param {string} text */
function parseJson(text) {
  const start = text.search(/[[{]/);
  if (start < 0) throw new Error(`expected JSON, got: ${text.slice(0, 500)}`);
  return JSON.parse(text.slice(start));
}

/** @returns {Promise<number>} a free loopback port */
function freePort() {
  return new Promise((done, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => done(port));
    });
  });
}

// --- hosts ---------------------------------------------------------------------------------------------------------

/**
 * @typedef {{ label: string, home: string, port: number, started: boolean }} Host
 */

/** @param {string} label @returns {Promise<Host>} */
async function startHost(label) {
  const home = mkdtempSync(join(scratch, `home-${label}-`));
  const port = await freePort();
  const host = { label, home, port, started: false };
  log(`host ${label}: home ${home}, listening on 127.0.0.1:${port}`);
  await must(["daemon", "config", "set", "daemon.listen", `127.0.0.1:${port}`, "--home", home]);
  await must(["daemon", "config", "set", "daemon.relay.enabled", "false", "--home", home]);
  await must(["daemon", "config", "set", "pluginsEnabled", "true", "--home", home]);
  hosts.push(host);
  const started = await run(["daemon", "start", "--home", home, "--timeout", "240"], { timeoutMs: 300_000 });
  process.stdout.write(started.stdout);
  if (started.code !== 0) {
    await dumpDaemonLog(host);
    throw new Error(`host ${label}: paseo daemon start failed (exit ${started.code})\n${started.stderr}`);
  }
  host.started = true;
  return host;
}

/** @param {Host} host */
async function stopHost(host) {
  if (!host.started) return;
  const stopped = await run(["daemon", "stop", "--home", host.home], { timeoutMs: 60_000 });
  if (stopped.code !== 0) {
    console.error(`plugin-load: host ${host.label}: graceful stop failed, forcing\n${stopped.stderr}`);
    await run(["daemon", "stop", "--home", host.home, "--force"], { timeoutMs: 60_000 });
  }
  host.started = false;
}

/** @param {Host} host */
async function dumpDaemonLog(host) {
  const file = join(host.home, "daemon.log");
  console.error(`\n----- host ${host.label}: ${file} (last 300 lines) -----`);
  console.error(existsSync(file) ? readFileSync(file, "utf8").split("\n").slice(-300).join("\n") : "(no daemon log)");
}

/** @param {Host} host */
async function dumpPluginLogs(host) {
  const logs = await run(["plugin", "logs", PLUGIN_ID, "--home", host.home]);
  console.error(`\n----- host ${host.label}: paseo plugin logs ${PLUGIN_ID} -----\n${logs.stdout}${logs.stderr}`);
}

/** @param {Host} host @returns {Promise<Array<{ id: string, status: string, enabled: boolean, error?: string }>>} */
async function listPlugins(host) {
  const result = await must(["plugin", "ls", "--home", host.home, "--json"]);
  const list = parseJson(result.stdout);
  if (!Array.isArray(list)) throw new Error(`host ${host.label}: paseo plugin ls --json did not print a list`);
  return list;
}

/** @param {Host} host */
async function install(host) {
  log(`host ${host.label}: paseo plugin install ${options.pluginDir}`);
  const result = await run(["plugin", "install", options.pluginDir, "--home", host.home, "--json"], { timeoutMs: 300_000 });
  if (result.code !== 0) {
    await dumpPluginLogs(host);
    await dumpDaemonLog(host);
    throw new Error(`host ${host.label}: install failed (exit ${result.code})\n${result.stdout}\n${result.stderr}`);
  }
}

/** Waits until the plugin is running on `host`; fails fast when it reports failed. @param {Host} host */
async function expectRunning(host) {
  const deadline = Date.now() + 180_000;
  let last = "";
  while (Date.now() < deadline) {
    const entry = (await listPlugins(host)).find((plugin) => plugin.id === PLUGIN_ID);
    last = entry ? `${entry.status}${entry.error ? `: ${entry.error}` : ""}` : "not listed";
    if (entry?.status === "running" && !entry.error) {
      log(`host ${host.label}: ${PLUGIN_ID} is running`);
      return;
    }
    if (entry?.status === "failed" || (entry && entry.status !== "running" && entry.error)) break;
    await new Promise((done) => setTimeout(done, 2_000));
  }
  await dumpPluginLogs(host);
  await dumpDaemonLog(host);
  throw new Error(`host ${host.label}: ${PLUGIN_ID} is not running (${last})`);
}

/** @param {Host} host */
async function expectAbsent(host) {
  const entry = (await listPlugins(host)).find((plugin) => plugin.id === PLUGIN_ID);
  if (entry) throw new Error(`host ${host.label}: ${PLUGIN_ID} is listed (${entry.status}) although it was never installed there or was removed`);
  log(`host ${host.label}: ${PLUGIN_ID} is not installed, as expected`);
}

/** @param {Host} host */
async function removePlugin(host) {
  log(`host ${host.label}: paseo plugin remove ${PLUGIN_ID}`);
  await must(["plugin", "remove", PLUGIN_ID, "--home", host.home, "--json"]);
}

// --- the run -------------------------------------------------------------------------------------------------------

/** @type {Host[]} */
const hosts = [];
let failure = null;
try {
  const version = await must(["--version"]);
  log(`paseo CLI ${version.stdout.trim()} (${options.paseoVersion}), ${options.hosts} host(s)`);
  if (options.hosts === 1) {
    const host = await startHost("A");
    await install(host);
    await expectRunning(host);
  } else {
    const a = await startHost("A");
    const b = await startHost("B");
    await install(a);
    await expectRunning(a);
    await expectAbsent(b);
    await install(b);
    await expectRunning(b);
    await expectRunning(a);
    await removePlugin(a);
    await expectAbsent(a);
    await expectRunning(b);
  }
} catch (error) {
  failure = error;
} finally {
  for (const host of hosts) {
    try {
      await stopHost(host);
    } catch (error) {
      console.error(`plugin-load: host ${host.label}: stopping failed: ${error.message}`);
    }
  }
}

if (failure) {
  rmSync(scratch, { recursive: true, force: true });
  fatal(failure.message ?? String(failure));
}
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import("node:fs");
  const what = options.hosts === 1 ? "compiled and running" : "per-host installation verified on two daemons";
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Plugin load: Paseo ${options.paseoVersion}\n\n${PLUGIN_ID}: ${what}.\n\n`);
}
rmSync(scratch, { recursive: true, force: true });
log("OK");
