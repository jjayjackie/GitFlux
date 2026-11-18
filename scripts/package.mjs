// Builds the release archives into dist/:
//
//   gitflux-<version>.tgz          the plugin as a user installs it: everything package.json's `files`
//                                             names, plus package.json and package-lock.json (Paseo's manifest build
//                                             step runs `npm ci --omit=dev` against that lock)
//   gitflux-<version>-bundled.tgz  the same with production node_modules already installed, for hosts
//                                             without registry access (install the extracted directory as is)
//   SHA256SUMS                                sha256sum-compatible checksums of both
//
// Checks first: the manifest's id, the version (and, on a tag build, that the tag is v<version>), that both entries
// and every local media file are packaged, and that nothing secret-looking is. Archives are reproducible: sorted
// entries, fixed owner, modes and mtime (SOURCE_DATE_EPOCH, else the last commit's time), gzip without a timestamp.
//
// Node built-ins plus the `tar` and `npm` commands of the runner. GNU tar gives the reproducible ordering; elsewhere
// the script still works, without that guarantee.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const stageRoot = join(dist, ".stage");

/** @param {string} message @returns {never} */
function die(message) {
  console.error(`package: ${message}`);
  if (process.env.GITHUB_ACTIONS) console.log(`::error title=package::${message}`);
  process.exit(1);
}

// --- identity and version ----------------------------------------------------------------------------------------

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(root, "paseo-plugin.json"), "utf8"));
const version = String(pkg.version ?? "");
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
if (pkg.name !== "gitflux") die(`package.json name is "${pkg.name}", expected "gitflux"`);
if (!SEMVER.test(version)) die(`package.json version "${version}" is not a semantic version`);
if (manifest.id !== "gitflux") die(`paseo-plugin.json id is "${manifest.id}", expected "gitflux"`);
if (typeof manifest.name !== "string" || !manifest.name.trim()) die("paseo-plugin.json has no name");
if (!Array.isArray(manifest.build) || !manifest.build.some((command) => command.join(" ").startsWith("npm ci")))
  die("paseo-plugin.json build no longer runs npm ci; the archive layout assumes it does");
if (process.env.GITHUB_REF_TYPE === "tag" && process.env.GITHUB_REF_NAME !== `v${version}`)
  die(`tag ${process.env.GITHUB_REF_NAME} does not match package.json version ${version} (expected v${version})`);
if (!existsSync(join(root, "package-lock.json"))) die("package-lock.json is missing");
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
if (lock.name !== pkg.name || lock.version !== version || lock.packages?.[""]?.version !== version)
  die("package-lock.json does not match package.json (name or version); let CI's lockfile job regenerate it");

const name = `gitflux-${version}`;
const epoch = Number(process.env.SOURCE_DATE_EPOCH ?? gitTime() ?? 315532800);

function gitTime() {
  try {
    return execFileSync("git", ["log", "-1", "--format=%ct"], { cwd: root, encoding: "utf8" }).trim() || undefined;
  } catch {
    return undefined;
  }
}

// --- the file list -------------------------------------------------------------------------------------------------

const IGNORED = new Set([".DS_Store", "node_modules", ".git", "Thumbs.db"]);

/** @param {string} directory @returns {string[]} paths relative to root, with "/" */
function walk(directory) {
  /** @type {string[]} */
  const found = [];
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    if (IGNORED.has(entry.name)) continue;
    const path = posix.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...walk(path));
    else if (entry.isFile()) found.push(path);
    else die(`${path} is neither a file nor a directory (symbolic links are not packaged)`);
  }
  return found;
}

/** A `files` entry: a file, a directory, or a pattern with * and ? in its last segment. @param {string} pattern */
function expand(pattern) {
  const clean = pattern.replace(/\/+$/, "");
  if (!/[*?]/.test(clean)) {
    const absolute = join(root, clean);
    if (!existsSync(absolute)) return [];
    return statSync(absolute).isDirectory() ? walk(clean) : [clean];
  }
  const directory = posix.dirname(clean);
  if (/[*?]/.test(directory)) die(`files entry "${pattern}": patterns are supported in the last segment only`);
  const matcher = new RegExp(`^${posix.basename(clean).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]")}$`);
  const absolute = join(root, directory);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute)
    .filter((entry) => matcher.test(entry) && !IGNORED.has(entry))
    .flatMap((entry) => {
      const path = directory === "." ? entry : posix.join(directory, entry);
      return statSync(join(root, path)).isDirectory() ? walk(path) : [path];
    });
}

if (!Array.isArray(pkg.files) || pkg.files.length === 0) die("package.json has no files list");
const files = [...new Set(["package.json", "package-lock.json", ...pkg.files.flatMap(expand)])].sort();
for (const required of ["paseo-plugin.json", "index.client.tsx", "index.server.ts", "LICENSE"]) {
  if (!files.includes(required)) die(`${required} is not packaged: check package.json files`);
}
for (const media of [...(manifest.media ?? []), ...(manifest.icon ? [manifest.icon] : [])]) {
  if (/^https:/.test(media)) continue;
  if (!files.includes(media)) die(`paseo-plugin.json names ${media}, which is not packaged`);
}

// --- secret-looking content ----------------------------------------------------------------------------------------

const SECRET_NAMES = [
  /^\.env(\..+)?$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /\.(pem|key|p12|pfx|jks|keystore|ppk)$/i,
  /^\.netrc$/i,
  /^\.git-credentials$/i,
];
/** @type {Array<[RegExp, string]>} */
const SECRET_CONTENT = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key"],
  [/\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/, "a GitHub token"],
  [/\bnpm_[A-Za-z0-9]{36}\b/, "an npm token"],
  [/\bAKIA[0-9A-Z]{16}\b/, "an AWS access key"],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}\b/, "a Slack token"],
  [/\bsk-(ant-)?[A-Za-z0-9_-]{32,}\b/, "an API key"],
];

/** @param {string} directory staging directory @param {string[]} list paths relative to it @param {boolean} scanContent */
function checkSecrets(directory, list, scanContent) {
  /** @type {string[]} */
  const found = [];
  for (const path of list) {
    const file = basename(path);
    if (SECRET_NAMES.some((pattern) => pattern.test(file))) found.push(`${path}: secret-like file name`);
    if (file === ".npmrc" && /_auth(Token)?\s*=|_password\s*=/i.test(readFileSync(join(directory, path), "utf8")))
      found.push(`${path}: .npmrc with credentials`);
    if (!scanContent) continue;
    const buffer = readFileSync(join(directory, path));
    if (buffer.includes(0)) continue; // binary
    const text = buffer.toString("utf8");
    for (const [pattern, what] of SECRET_CONTENT) if (pattern.test(text)) found.push(`${path}: contains what looks like ${what}`);
  }
  if (found.length > 0) die(`refusing to package secret-looking content:\n  ${found.join("\n  ")}`);
}

// --- staging and archiving -----------------------------------------------------------------------------------------

/** @param {string} directory @param {string} [prefix] @returns {string[]} every file below, relative, with "/" */
function listTree(directory, prefix = "") {
  /** @type {string[]} */
  const found = [];
  for (const entry of readdirSync(join(directory, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...listTree(directory, path));
    else found.push(path);
  }
  return found;
}

const gnuTar = (() => {
  const result = spawnSync("tar", ["--version"], { encoding: "utf8" });
  if (result.error) die(`the tar command is not available: ${result.error.message}`);
  return /GNU tar/.test(result.stdout);
})();
if (!gnuTar) console.warn("package: tar is not GNU tar; the archives are valid but not byte-for-byte reproducible");

/** Archives `parent/<name>` as `<name>/…` into `output` (gzip). @param {string} parent @param {string} output */
function archive(parent, output) {
  const tarFile = `${output}.tar`;
  const args = gnuTar
    ? ["--sort=name", `--mtime=@${epoch}`, "--owner=0", "--group=0", "--numeric-owner", "--mode=u+rw,go+r,go-w,a+X", "--format=gnu", "-cf", tarFile, "-C", parent, name]
    : ["-cf", tarFile, "-C", parent, name];
  const result = spawnSync("tar", args, { stdio: "inherit" });
  if (result.status !== 0) die(`tar failed (exit ${result.status})`);
  writeFileSync(output, gzipSync(readFileSync(tarFile), { level: 9 }));
  rmSync(tarFile);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(stageRoot, { recursive: true });

// (a) the source archive
const plainParent = join(stageRoot, "plain");
const plainDirectory = join(plainParent, name);
for (const path of files) {
  const target = join(plainDirectory, ...path.split("/"));
  mkdirSync(dirname(target), { recursive: true });
  cpSync(join(root, ...path.split("/")), target);
}
checkSecrets(plainDirectory, files, true);
const plainArchive = join(dist, `${name}.tgz`);
archive(plainParent, plainArchive);
console.log(`package: ${relative(root, plainArchive)} (${files.length} files)`);

// (b) the same with production dependencies installed
const bundledParent = join(stageRoot, "bundled");
const bundledDirectory = join(bundledParent, name);
cpSync(plainDirectory, bundledDirectory, { recursive: true });
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const install = spawnSync(npm, ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
  cwd: bundledDirectory,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (install.status !== 0) die(`npm ci --omit=dev failed in the staging copy (exit ${install.status}); is package-lock.json in sync?`);
const bundledFiles = listTree(bundledDirectory);
checkSecrets(bundledDirectory, bundledFiles, false);
const bundledArchive = join(dist, `${name}-bundled.tgz`);
archive(bundledParent, bundledArchive);
console.log(`package: ${relative(root, bundledArchive)} (${bundledFiles.length} files)`);

// (c) checksums
const sums = [plainArchive, bundledArchive]
  .map((file) => `${createHash("sha256").update(readFileSync(file)).digest("hex")}  ${basename(file)}`)
  .join("\n");
writeFileSync(join(dist, "SHA256SUMS"), sums + "\n");
rmSync(stageRoot, { recursive: true, force: true });
console.log(`package: dist/SHA256SUMS\n${sums}`);
console.log(`package: source archive contents:\n  ${files.join("\n  ")}`);
