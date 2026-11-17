// Syntax tokens for git.diff.file: highlight.js's HTML turned into the compact per-line encoding of
// shared/schemas.ts (tokenLineSchema): `[length, scope, length, scope, …]` per line, lengths in UTF-16 code units,
// `scope` an index into TOKEN_SCOPES. The language comes from the file's name through an explicit table, never from
// highlightAuto; only the languages in that table are registered.
//
// API
//   languageFor(path) → highlight.js language name | null
//   highlightLines(lines, language) → Tokens | null   one entry per line; null when the language is unknown or fails
//   htmlToTokens(html, lineCount?) → Tokens            the pure conversion (unit-tested): nested spans, innermost scope
//                                                      wins; a span without an `hljs-` class takes its parent's scope;
//                                                      an `hljs-` scope missing from TOKEN_SCOPES maps to the nearest
//                                                      one, else to none; entities decoded; a token across lines is
//                                                      split at each line break; text after the last token is plain.
//   scopeIndex(classAttribute) → number | null         the scope of one span's class attribute.

import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import dart from "highlight.js/lib/languages/dart";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import elixir from "highlight.js/lib/languages/elixir";
import go from "highlight.js/lib/languages/go";
import haskell from "highlight.js/lib/languages/haskell";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import latex from "highlight.js/lib/languages/latex";
import less from "highlight.js/lib/languages/less";
import lua from "highlight.js/lib/languages/lua";
import makefile from "highlight.js/lib/languages/makefile";
import markdown from "highlight.js/lib/languages/markdown";
import objectivec from "highlight.js/lib/languages/objectivec";
import perl from "highlight.js/lib/languages/perl";
import php from "highlight.js/lib/languages/php";
import powershell from "highlight.js/lib/languages/powershell";
import protobuf from "highlight.js/lib/languages/protobuf";
import python from "highlight.js/lib/languages/python";
import r from "highlight.js/lib/languages/r";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scala from "highlight.js/lib/languages/scala";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { TOKEN_SCOPES, type TokenLine, type TokenScope, type Tokens } from "../shared/schemas.ts";

type LanguageFn = Parameters<typeof hljs.registerLanguage>[1];

const LANGUAGES: Record<string, unknown> = {
  bash,
  c,
  cpp,
  csharp,
  css,
  dart,
  diff,
  dockerfile,
  elixir,
  go,
  haskell,
  ini,
  java,
  javascript,
  json,
  kotlin,
  latex,
  less,
  lua,
  makefile,
  markdown,
  objectivec,
  perl,
  php,
  powershell,
  protobuf,
  python,
  r,
  ruby,
  rust,
  scala,
  scss,
  sql,
  swift,
  typescript,
  xml,
  yaml,
};
for (const [name, language] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, language as LanguageFn);

/** File extensions (lower case, without the dot) to language names. */
const BY_EXTENSION: Record<string, string> = {
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hh: "cpp",
  hpp: "cpp",
  hxx: "cpp",
  cs: "csharp",
  css: "css",
  dart: "dart",
  diff: "diff",
  patch: "diff",
  ex: "elixir",
  exs: "elixir",
  go: "go",
  hs: "haskell",
  ini: "ini",
  toml: "ini",
  cfg: "ini",
  java: "java",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  json: "json",
  jsonc: "json",
  kt: "kotlin",
  kts: "kotlin",
  tex: "latex",
  less: "less",
  lua: "lua",
  mk: "makefile",
  md: "markdown",
  markdown: "markdown",
  m: "objectivec",
  mm: "objectivec",
  pl: "perl",
  pm: "perl",
  php: "php",
  ps1: "powershell",
  psm1: "powershell",
  proto: "protobuf",
  py: "python",
  pyw: "python",
  r: "r",
  rb: "ruby",
  rs: "rust",
  scala: "scala",
  scss: "scss",
  sql: "sql",
  swift: "swift",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescript",
  html: "xml",
  htm: "xml",
  xhtml: "xml",
  xml: "xml",
  svg: "xml",
  plist: "xml",
  vue: "xml",
  yml: "yaml",
  yaml: "yaml",
};

/** Whole file names (lower case) that say their language. */
const BY_NAME: Record<string, string> = {
  dockerfile: "dockerfile",
  containerfile: "dockerfile",
  makefile: "makefile",
  gnumakefile: "makefile",
  gemfile: "ruby",
  rakefile: "ruby",
  ".bashrc": "bash",
  ".zshrc": "bash",
  ".profile": "bash",
  ".gitconfig": "ini",
  ".editorconfig": "ini",
};

export function languageFor(path: string): string | null {
  const name = (path.split(/[\\/]/).pop() ?? "").toLowerCase();
  if (Object.hasOwn(BY_NAME, name)) return BY_NAME[name];
  if (name.startsWith("dockerfile.")) return "dockerfile";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  const extension = name.slice(dot + 1);
  return Object.hasOwn(BY_EXTENSION, extension) ? BY_EXTENSION[extension] : null;
}

export function highlightLines(lines: readonly string[], language: string): Tokens | null {
  if (!hljs.getLanguage(language)) return null;
  try {
    const html = hljs.highlight(lines.join("\n"), { language, ignoreIllegals: true }).value;
    return htmlToTokens(html, lines.length);
  } catch {
    return null;
  }
}

// --- scopes ------------------------------------------------------------------------------------

const INDEX: ReadonlyMap<string, number> = new Map(TOKEN_SCOPES.map((scope, index) => [scope, index]));

/** highlight.js scopes (with their sub-scopes, dot-joined) that TOKEN_SCOPES names otherwise. */
const NEAREST: Record<string, TokenScope> = {
  "title.class": "class",
  "title.class.inherited": "class",
  "title.function": "function",
  "title.function.invoke": "function",
  "variable.language": "variable",
  "variable.constant": "variable",
  "char.escape": "char",
  "meta-keyword": "keyword",
  "meta-string": "string",
  "selector-tag": "selector",
  "selector-id": "selector",
  "selector-class": "selector",
  "selector-attr": "selector",
  "selector-pseudo": "selector",
  "template-tag": "template",
  "template-variable": "variable",
  "builtin-name": "built_in",
};

/**
 * The scope of a span's class attribute: `hljs-title class_` is title.class (sub-scopes end in underscores). A span
 * without an `hljs-` class (`language-xml` around embedded code) is null: it keeps its parent's scope.
 */
export function scopeIndex(classAttribute: string): number | null {
  const classes = classAttribute.split(/\s+/).filter(Boolean);
  const main = classes.find((name) => name.startsWith("hljs-"));
  if (main === undefined) return null;
  const base = main.slice("hljs-".length);
  const subs = classes.filter((name) => name !== main && /^[A-Za-z0-9-]+_+$/.test(name)).map((name) => name.replace(/_+$/, ""));
  const candidates = [[base, ...subs].join("."), ...subs.map((_, n) => [base, ...subs.slice(0, subs.length - 1 - n)].join("."))];
  for (const name of candidates) {
    if (Object.hasOwn(NEAREST, name)) return INDEX.get(NEAREST[name]) ?? 0;
    const direct = INDEX.get(name);
    if (direct !== undefined) return direct;
  }
  const head = base.split("-")[0] ?? "";
  return INDEX.get(head) ?? 0;
}

// --- HTML to tokens ------------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** The text of an entity's name (`amp`, `#39`, `#x27`), or null when it is not one. */
function decodeEntity(name: string): string | null {
  if (Object.hasOwn(ENTITIES, name)) return ENTITIES[name];
  const numeric = /^#(?:x([0-9a-fA-F]{1,6})|([0-9]{1,7}))$/.exec(name);
  if (!numeric) return null;
  const code = numeric[1] !== undefined ? parseInt(numeric[1], 16) : Number(numeric[2]);
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return null;
  return String.fromCodePoint(code);
}

export function htmlToTokens(html: string, lineCount?: number): Tokens {
  const lines: Tokens = [];
  let line: TokenLine = [];
  let runScope = 0;
  let runLength = 0;
  const stack: number[] = [0];

  const flush = () => {
    if (runLength === 0) return;
    const last = line.length - 1;
    if (last >= 1 && line[last] === runScope) line[last - 1] += runLength;
    else line.push(runLength, runScope);
    runLength = 0;
  };
  const endLine = () => {
    flush();
    // Plain text at the end needs no token.
    while (line.length >= 2 && line[line.length - 1] === 0) line.length -= 2;
    lines.push(line);
    line = [];
  };
  const text = (length: number) => {
    if (length <= 0) return;
    const scope = stack[stack.length - 1] ?? 0;
    if (scope !== runScope) {
      flush();
      runScope = scope;
    }
    runLength += length;
  };

  let n = 0;
  while (n < html.length) {
    const char = html[n];
    if (char === "<") {
      const close = html.indexOf(">", n);
      if (close === -1) {
        text(1); // not a tag after all
        n++;
        continue;
      }
      const tag = html.slice(n + 1, close);
      if (tag.startsWith("/")) {
        if (tag.slice(1).trim().toLowerCase() === "span" && stack.length > 1) stack.pop();
      } else if (/^span\b/i.test(tag)) {
        const classes = /\bclass\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? "";
        stack.push(scopeIndex(classes) ?? stack[stack.length - 1] ?? 0);
        if (tag.trimEnd().endsWith("/")) stack.pop(); // a span that closes itself holds nothing
      }
      n = close + 1;
    } else if (char === "&") {
      const semi = html.indexOf(";", n);
      const decoded = semi !== -1 && semi - n <= 12 ? decodeEntity(html.slice(n + 1, semi)) : null;
      if (decoded === null) {
        text(1);
        n++;
      } else {
        text(decoded.length);
        n = semi + 1;
      }
    } else if (char === "\n") {
      endLine();
      n++;
    } else {
      let end = n + 1;
      while (end < html.length && html[end] !== "<" && html[end] !== "&" && html[end] !== "\n") end++;
      text(end - n);
      n = end;
    }
  }
  endLine();
  if (lineCount !== undefined) {
    while (lines.length < lineCount) lines.push([]);
    lines.length = lineCount;
  }
  return lines;
}
