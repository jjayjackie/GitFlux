// Checks the client's translation resources (architecture §8) the way the SDK validates them, and more strictly.
//
//   node scripts/check-i18n.mjs
//
// Fails (exit 1) when:
// - client/i18n/ exists but client/i18n/locales/en.json or zh-CN.json is missing;
// - a locale file is not an object whose leaves are all non-empty strings, or uses a key the SDK refuses;
// - a locale file's name is not a canonical language tag;
// - the key sets differ (i18next plural forms _zero/_one/_two/_few/_many/_other count as one base key: English needs
//   _one and _other, every other language at least _other);
// - a key's {{placeholders}} differ from English (compared form by form, as the SDK does);
// - client code names a key, as a string literal, that en.json does not have: t("…"), messages.message("…"),
//   i18n.t(messages, "…") and client.i18n.t(messages, "…").
// Warns about English keys no code names literally (keys reached through a template such as t(`error.${code}.title`)
// count as named when their prefix matches).
// Passes with a notice when client/i18n/ does not exist yet.
//
// Node built-ins only.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const i18nDirectory = join(root, "client", "i18n");
const localesDirectory = join(i18nDirectory, "locales");
const REQUIRED = ["en", "zh-CN"];
const PLURAL = /_(zero|one|two|few|many|other)$/;
const RESERVED = new Set(["__proto__", "constructor", "prototype"]);
const onActions = Boolean(process.env.GITHUB_ACTIONS);

/** @type {string[]} */
const errors = [];
/** @type {string[]} */
const warnings = [];
const fail = (message) => errors.push(message);

if (!existsSync(i18nDirectory)) {
  console.log("check-i18n: client/i18n/ does not exist yet; nothing to check.");
  process.exit(0);
}

/** The SDK's placeholder pattern (translations.tsx). @param {string} value */
function placeholders(value) {
  return [...new Set([...value.matchAll(/{{-?\s*([^},\s]+)(?:[^}]*)}}/g)].map((match) => match[1]))].sort();
}

/**
 * Flattens a resource into "a.b.c" → string, reporting what the SDK would refuse.
 * @param {unknown} resource @param {string} locale @param {string} [prefix] @param {Map<string, string>} [into]
 */
function flatten(resource, locale, prefix = "", into = new Map()) {
  if (!resource || typeof resource !== "object" || Array.isArray(resource)) {
    fail(`${locale}: ${prefix || "the file"} must be an object of strings`);
    return into;
  }
  for (const [key, value] of Object.entries(resource)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!key || key.includes(".") || RESERVED.has(key)) {
      fail(`${locale}: invalid key "${path}" (empty, contains ".", or reserved)`);
      continue;
    }
    if (typeof value === "string") {
      if (!value.trim()) fail(`${locale}: ${path} is empty`);
      into.set(path, value);
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      if (Object.keys(value).length === 0) fail(`${locale}: ${path} is an empty object`);
      flatten(value, locale, path, into);
    } else {
      fail(`${locale}: ${path} must be a string or an object, not ${Array.isArray(value) ? "an array" : typeof value}`);
    }
  }
  return into;
}

/** Groups flat keys by base key: base → { plain: boolean, forms: Set<suffix> }. @param {Map<string, string>} flat */
function bases(flat) {
  /** @type {Map<string, { plain: boolean, forms: Set<string> }>} */
  const result = new Map();
  for (const key of flat.keys()) {
    const match = PLURAL.exec(key);
    const base = match ? key.slice(0, -match[0].length) : key;
    const entry = result.get(base) ?? { plain: false, forms: new Set() };
    if (match) entry.forms.add(match[1]);
    else entry.plain = true;
    result.set(base, entry);
  }
  return result;
}

// --- the locale files -------------------------------------------------------------------------------------------

/** @type {Map<string, Map<string, string>>} */
const locales = new Map();
for (const tag of REQUIRED) {
  if (!existsSync(join(localesDirectory, `${tag}.json`))) fail(`client/i18n/locales/${tag}.json is missing`);
}
const files = existsSync(localesDirectory) ? readdirSync(localesDirectory).filter((name) => name.endsWith(".json")) : [];
for (const name of files.sort()) {
  const tag = name.slice(0, -".json".length);
  let canonical;
  try {
    canonical = Intl.getCanonicalLocales(tag)[0];
  } catch {
    canonical = undefined;
  }
  if (canonical !== tag) fail(`client/i18n/locales/${name}: "${tag}" is not a canonical language tag${canonical ? ` (use "${canonical}")` : ""}`);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(join(localesDirectory, name), "utf8"));
  } catch (error) {
    fail(`client/i18n/locales/${name}: not valid JSON (${error.message})`);
    continue;
  }
  locales.set(tag, flatten(parsed, tag));
}

const english = locales.get("en");
if (english) {
  if (english.size === 0) fail("en: no messages (the SDK requires English messages)");
  const englishBases = bases(english);
  for (const [base, entry] of englishBases) {
    if (entry.plain && entry.forms.size > 0) fail(`en: ${base} is both a plain key and a plural`);
    if (entry.forms.size > 0 && (!entry.forms.has("one") || !entry.forms.has("other")))
      fail(`en: plural ${base} needs both ${base}_one and ${base}_other (has ${[...entry.forms].map((form) => `_${form}`).join(", ")})`);
  }
  for (const [tag, flat] of locales) {
    if (tag === "en") continue;
    const localBases = bases(flat);
    for (const [base, entry] of englishBases) {
      const local = localBases.get(base);
      if (!local) fail(`${tag}: missing ${entry.forms.size > 0 ? `plural ${base}_other` : base}`);
      else if (entry.forms.size > 0 && !local.forms.has("other")) fail(`${tag}: plural ${base} needs ${base}_other`);
      else if (entry.forms.size === 0 && !local.plain) fail(`${tag}: ${base} is a plural here but a plain key in English`);
    }
    for (const [base, entry] of localBases) {
      if (!englishBases.has(base)) fail(`${tag}: ${base}${entry.forms.size > 0 ? " (plural)" : ""} is not an English key`);
      else if (entry.plain && englishBases.get(base)?.forms.size) fail(`${tag}: ${base} is a plain key here but a plural in English`);
    }
    // Placeholders, form by form, as the SDK compares them: a form English lacks is compared with English's _other.
    for (const [key, value] of flat) {
      const match = PLURAL.exec(key);
      const source = english.get(key) ?? (match ? english.get(`${key.slice(0, -match[0].length)}_other`) : undefined);
      if (source === undefined) continue; // reported above
      const want = placeholders(source).join(", ");
      const have = placeholders(value).join(", ");
      if (want !== have) fail(`${tag}: ${key} has placeholders {${have}}, English has {${want}}`);
    }
  }
}

// --- keys named by client code ----------------------------------------------------------------------------------

/** @param {string} directory @returns {string[]} */
function sources(directory) {
  if (!existsSync(directory)) return [];
  /** @type {string[]} */
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") found.push(...sources(path));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) found.push(path);
  }
  return found;
}

const scanned = [...sources(join(root, "client")), join(root, "index.client.tsx")].filter((file) => existsSync(file));
const LITERAL_PATTERNS = [
  /(?<![\w$.])t\(\s*(["'])((?:(?!\1)[^\\\n])+)\1/g, // t("key") from useTranslation
  /\.message\(\s*(["'])((?:(?!\1)[^\\\n])+)\1/g, // messages.message("key")
  /\.t\(\s*[\w$.]+\s*,\s*(["'])((?:(?!\1)[^\\\n])+)\1/g, // i18n.t(messages, "key"), client.i18n.t(messages, "key")
];
const TEMPLATE_PATTERNS = [/(?<![\w$.])t\(\s*`([^`$]*)\$\{/g, /\.message\(\s*`([^`$]*)\$\{/g, /\.t\(\s*[\w$.]+\s*,\s*`([^`$]*)\$\{/g];

/** @type {Map<string, string[]>} key → where it is named */
const named = new Map();
/** @type {Set<string>} */
const prefixes = new Set();
for (const file of scanned) {
  const text = readFileSync(file, "utf8");
  const where = relative(root, file).split("\\").join("/");
  for (const pattern of LITERAL_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const line = text.slice(0, match.index).split("\n").length;
      const key = match[2];
      named.set(key, [...(named.get(key) ?? []), `${where}:${line}`]);
    }
  }
  for (const pattern of TEMPLATE_PATTERNS) for (const match of text.matchAll(pattern)) if (match[1].length >= 2) prefixes.add(match[1]);
}

if (english) {
  for (const [key, places] of [...named].sort(([a], [b]) => a.localeCompare(b))) {
    if (!english.has(key) && !english.has(`${key}_other`)) fail(`code names "${key}", which en.json does not have (${places.slice(0, 3).join(", ")}${places.length > 3 ? ", …" : ""})`);
  }
  const used = (key) => {
    const match = PLURAL.exec(key);
    const base = match ? key.slice(0, -match[0].length) : key;
    return named.has(key) || named.has(base) || [...prefixes].some((prefix) => key.startsWith(prefix));
  };
  const unused = [...english.keys()].filter((key) => !used(key));
  if (unused.length > 0) {
    warnings.push(
      `${unused.length} English key(s) no code names literally (they may be reached dynamically): ${unused.slice(0, 40).join(", ")}${unused.length > 40 ? ", …" : ""}`,
    );
  }
}

// --- report -----------------------------------------------------------------------------------------------------

for (const warning of warnings) console.log(onActions ? `::warning title=check-i18n::${warning}` : `warning: ${warning}`);
const summary = [...locales].map(([tag, flat]) => `${tag} ${flat.size} keys`).join(", ");
console.log(`check-i18n: ${summary || "no locale files"}; ${scanned.length} source file(s) scanned, ${named.size} key(s) named.`);
if (errors.length > 0) {
  console.error(`check-i18n: ${errors.length} problem(s):`);
  for (const error of errors) console.error(`  - ${error}`);
  if (onActions) console.log(`::error title=check-i18n::${errors.length} translation problem(s); see the log above`);
  process.exit(1);
}
console.log("check-i18n: OK");
