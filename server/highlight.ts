// Syntax tokens for git.diff.file, from Prism's tokenizer, in the compact per-line encoding of shared/schemas.ts
// (tokenLineSchema): `[length, scope, length, scope, …]` per line, lengths in UTF-16 code units, `scope` an index into
// TOKEN_SCOPES. The language comes from the file's name through an explicit table, never from auto-detection; only the
// grammars imported below exist.
//
// API
//   languageFor(path) → Prism language name | null
//   highlightLines(lines, language) → Tokens | null   one entry per line; null for an unknown language, a line longer
//                                                      than LINE_MAX, text past HIGHLIGHT_MAX_BYTES, or any failure
//   streamToTokens(stream, length, lineCount) → Tokens | null
//                                                      the pure conversion (unit-tested): depth first, the innermost
//                                                      token's scope wins; a type missing from the table takes a known
//                                                      alias, else its enclosing token's scope; a token across lines is
//                                                      split at each line break; text after the last token is plain.
//                                                      Null unless the stream's text is exactly `length` long and makes
//                                                      `lineCount` lines.
//   scopeFor(type, alias, enclosing) → number          the scope index of one Prism token.

import Prism from "prismjs";
// Grammars beyond those prism.js itself holds (markup, css, clike, javascript). Each reads the global `Prism` that
// prism.js sets in Node, and builds on the grammars it extends, so the order matters: a grammar after its parents.
import "prismjs/components/prism-markup-templating.js"; // markup → (php)
import "prismjs/components/prism-typescript.js"; // javascript
import "prismjs/components/prism-jsx.js"; // markup, javascript
import "prismjs/components/prism-tsx.js"; // jsx, typescript
import "prismjs/components/prism-json.js";
import "prismjs/components/prism-yaml.js"; // (markdown's front matter)
import "prismjs/components/prism-markdown.js"; // markup, (yaml)
import "prismjs/components/prism-graphql.js"; // (markdown)
import "prismjs/components/prism-scss.js"; // css
import "prismjs/components/prism-less.js"; // css
import "prismjs/components/prism-toml.js";
import "prismjs/components/prism-ini.js";
import "prismjs/components/prism-bash.js";
import "prismjs/components/prism-python.js";
import "prismjs/components/prism-ruby.js"; // clike
import "prismjs/components/prism-go.js"; // clike
import "prismjs/components/prism-rust.js";
import "prismjs/components/prism-java.js"; // clike
import "prismjs/components/prism-kotlin.js"; // clike
import "prismjs/components/prism-scala.js"; // java
import "prismjs/components/prism-swift.js";
import "prismjs/components/prism-c.js"; // clike
import "prismjs/components/prism-cpp.js"; // c
import "prismjs/components/prism-csharp.js"; // clike
import "prismjs/components/prism-php.js"; // markup-templating
import "prismjs/components/prism-sql.js";
import "prismjs/components/prism-lua.js";
import "prismjs/components/prism-dart.js"; // clike
import "prismjs/components/prism-haskell.js";
import "prismjs/components/prism-elixir.js";
import "prismjs/components/prism-perl.js";
import "prismjs/components/prism-r.js";
import "prismjs/components/prism-powershell.js";
import "prismjs/components/prism-protobuf.js"; // clike
import "prismjs/components/prism-latex.js";
import "prismjs/components/prism-diff.js";
import "prismjs/components/prism-docker.js";
import "prismjs/components/prism-makefile.js";
import { HIGHLIGHT_MAX_BYTES } from "../shared/limits.ts";
import { TOKEN_SCOPES, type TokenLine, type TokenScope, type Tokens } from "../shared/schemas.ts";

// Prism's types, taken from the value: Paseo's compiler resolves every type-only import against the installed package,
// and prismjs ships no typings (server/prism.d.ts declares it for tsc only).
type Piece = ReturnType<typeof Prism.tokenize>[number];
export type TokenStream = Piece | Piece[];
type Grammar = NonNullable<(typeof Prism.languages)[string]>;

/** A line longer than this (minified code, data) gives the whole side no tokens: tokenising it is slow and useless. */
export const LINE_MAX = 5_000;

/** File extensions (lower case, without the dot) to Prism language names. */
const BY_EXTENSION: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  json: "json",
  jsonc: "json",
  html: "markup",
  htm: "markup",
  xhtml: "markup",
  xml: "markup",
  svg: "markup",
  plist: "markup",
  vue: "markup",
  css: "css",
  scss: "scss",
  less: "less",
  md: "markdown",
  markdown: "markdown",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  ini: "ini",
  cfg: "ini",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  py: "python",
  pyw: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  scala: "scala",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  hxx: "cpp",
  cs: "csharp",
  php: "php",
  sql: "sql",
  lua: "lua",
  dart: "dart",
  hs: "haskell",
  ex: "elixir",
  exs: "elixir",
  pl: "perl",
  pm: "perl",
  r: "r",
  ps1: "powershell",
  psm1: "powershell",
  proto: "protobuf",
  tex: "latex",
  diff: "diff",
  patch: "diff",
  graphql: "graphql",
  gql: "graphql",
  mk: "makefile",
};

/** Whole file names (lower case) that say their language. Ignore files and the like have none. */
const BY_NAME: Record<string, string | null> = {
  dockerfile: "docker",
  containerfile: "docker",
  makefile: "makefile",
  gnumakefile: "makefile",
  gemfile: "ruby",
  rakefile: "ruby",
  ".bashrc": "bash",
  ".zshrc": "bash",
  ".profile": "bash",
  ".gitconfig": "ini",
  ".editorconfig": "ini",
  ".gitignore": null,
  ".gitattributes": null,
  ".dockerignore": null,
  ".npmignore": null,
};

/** Every language languageFor can answer, and so every one highlightLines accepts. */
const REGISTERED: ReadonlySet<string> = new Set([...Object.values(BY_EXTENSION), ...Object.values(BY_NAME).filter((name): name is string => name !== null)]);

export function languageFor(path: string): string | null {
  const name = (path.split(/[\\/]/).pop() ?? "").toLowerCase();
  if (Object.hasOwn(BY_NAME, name)) return BY_NAME[name];
  if (name.startsWith("dockerfile.") || name.endsWith(".dockerfile")) return "docker";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  const extension = name.slice(dot + 1);
  return Object.hasOwn(BY_EXTENSION, extension) ? BY_EXTENSION[extension] : null;
}

// --- scopes ------------------------------------------------------------------------------------

/** Prism token types (and aliases) to TOKEN_SCOPES. A type not here takes a known alias, else its parent's scope. */
const SCOPES: Record<string, TokenScope> = {
  keyword: "keyword",
  important: "keyword",
  atrule: "keyword",
  rule: "keyword",
  string: "string",
  "template-string": "string",
  "triple-quoted-string": "string",
  "attr-value": "string",
  char: "char",
  entity: "char",
  comment: "comment",
  prolog: "comment",
  cdata: "comment",
  "doc-comment": "comment",
  doctype: "meta",
  number: "number",
  unit: "number",
  hexcode: "number",
  color: "number",
  boolean: "literal",
  constant: "literal",
  nil: "literal",
  null: "literal",
  builtin: "built_in",
  "class-name": "class",
  "maybe-class-name": "class",
  type: "type",
  "type-definition": "type",
  generic: "type",
  namespace: "type",
  function: "function",
  "function-variable": "function",
  method: "function",
  parameter: "params",
  variable: "variable",
  "assign-left": "variable",
  environment: "variable",
  property: "property",
  "property-access": "property",
  "literal-property": "property",
  "string-property": "property",
  key: "attr",
  "attr-name": "attr",
  attribute: "meta",
  decorator: "meta",
  annotation: "meta",
  macro: "meta",
  directive: "meta",
  shebang: "meta",
  delimiter: "meta",
  coord: "meta",
  operator: "operator",
  spread: "operator",
  punctuation: "punctuation",
  hr: "punctuation",
  tag: "tag",
  selector: "selector",
  regex: "regexp",
  symbol: "symbol",
  lifetime: "symbol",
  atom: "symbol",
  inserted: "addition",
  deleted: "deletion",
  strike: "deletion",
  interpolation: "subst",
  title: "section",
  section: "section",
  table: "section",
  bold: "strong",
  italic: "emphasis",
  url: "link",
  code: "code",
  "code-snippet": "code",
  "code-block": "code",
  blockquote: "quote",
  list: "bullet",
  "plain-text": "none",
};

const INDEX: ReadonlyMap<string, number> = new Map(TOKEN_SCOPES.map((scope, index) => [scope, index]));

function known(name: string): number | null {
  return Object.hasOwn(SCOPES, name) ? (INDEX.get(SCOPES[name]) ?? 0) : null;
}

export function scopeFor(type: string, alias: string | string[] | undefined, enclosing: number): number {
  const own = known(type);
  if (own !== null) return own;
  for (const name of alias === undefined ? [] : Array.isArray(alias) ? alias : [alias]) {
    const scope = known(name);
    if (scope !== null) return scope;
  }
  return enclosing;
}

// --- tokens to lines ------------------------------------------------------------------------------

export function streamToTokens(stream: TokenStream, length: number, lineCount: number): Tokens | null {
  const lines: Tokens = [];
  let line: TokenLine = [];
  let seen = 0; // characters gone through, line breaks included

  const push = (count: number, scope: number) => {
    if (count <= 0) return;
    const last = line.length - 1;
    if (last >= 1 && line[last] === scope) line[last - 1] += count;
    else line.push(count, scope);
  };
  const endLine = () => {
    // Plain text at the end needs no token.
    while (line.length >= 2 && line[line.length - 1] === 0) line.length -= 2;
    lines.push(line);
    line = [];
  };
  const text = (piece: string, scope: number) => {
    let start = 0;
    for (;;) {
      const newline = piece.indexOf("\n", start);
      const end = newline === -1 ? piece.length : newline;
      push(end - start, scope);
      seen += end - start;
      if (newline === -1) return;
      seen += 1;
      endLine();
      start = newline + 1;
    }
  };
  const walk = (node: TokenStream, scope: number, depth: number) => {
    if (depth > 100) throw new Error("tokens nested too deep");
    if (typeof node === "string") text(node, scope);
    else if (Array.isArray(node)) for (const child of node) walk(child, scope, depth + 1);
    else walk(node.content, scopeFor(node.type, node.alias, scope), depth + 1);
  };

  walk(stream, 0, 0);
  endLine();
  return seen === length && lines.length === lineCount ? lines : null;
}

export function highlightLines(lines: readonly string[], language: string): Tokens | null {
  if (!REGISTERED.has(language)) return null;
  const grammar = Prism.languages[language];
  if (grammar === undefined || typeof grammar !== "object") return null;
  if (lines.some((line) => line.length > LINE_MAX)) return null;
  const text = lines.join("\n");
  if (text.length > HIGHLIGHT_MAX_BYTES) return null;
  try {
    // As Prism.highlight does, without making HTML: the grammars' tokenize hooks (php's templating, jsx's text) run.
    const env: Record<string, unknown> = { code: text, grammar, language };
    Prism.hooks.run("before-tokenize", env);
    const code = env.code;
    const used = env.grammar as Grammar | undefined;
    if (typeof code !== "string" || used === undefined || typeof used !== "object") return null;
    env.tokens = Prism.tokenize(code, used);
    Prism.hooks.run("after-tokenize", env);
    return streamToTokens(env.tokens as TokenStream, text.length, lines.length);
  } catch {
    return null;
  }
}
