// Prism's tokens as per-line tokens: one entry per line, lengths within the line, the innermost scope winning, tokens
// split across lines, and the languages the file name picks.

import assert from "node:assert/strict";
import { test } from "node:test";
import { highlightLines, LINE_MAX, languageFor, scopeFor, streamToTokens, type TokenStream } from "../../../server/highlight.ts";
import { HIGHLIGHT_MAX_BYTES } from "../../../shared/limits.ts";
import { TOKEN_SCOPES, type TokenLine, type Tokens } from "../../../shared/schemas.ts";

const scope = (name: (typeof TOKEN_SCOPES)[number]) => TOKEN_SCOPES.indexOf(name);

/** The sum of a token line's lengths. */
const covered = (line: TokenLine) => line.reduce((sum, value, index) => (index % 2 === 0 ? sum + value : sum), 0);

/** Each token's text, with its scope's name, read back from the line. */
function spans(text: string, line: TokenLine): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let at = 0;
  for (let n = 0; n < line.length; n += 2) {
    out.push([text.slice(at, at + line[n]), TOKEN_SCOPES[line[n + 1]]]);
    at += line[n];
  }
  return out;
}

const has = (text: string, line: TokenLine, piece: string, name: string) => spans(text, line).some(([t, n]) => t === piece && n === name);

/** One entry per line, and no line's tokens longer than the line. */
function fits(lines: readonly string[], tokens: Tokens | null): Tokens {
  assert.ok(tokens !== null, "tokens");
  assert.equal(tokens.length, lines.length);
  tokens.forEach((line, n) => {
    assert.equal(line.length % 2, 0, `line ${n + 1}: pairs`);
    assert.ok(covered(line) <= lines[n].length, `line ${n + 1}: ${covered(line)} > ${lines[n].length}`);
    for (let i = 0; i < line.length; i += 2) {
      assert.ok(line[i] > 0, `line ${n + 1}: empty token`);
      assert.ok(line[i + 1] >= 0 && line[i + 1] < TOKEN_SCOPES.length, `line ${n + 1}: scope`);
    }
  });
  return tokens;
}

/** A Prism token, as the tokenizer makes them. */
const token = (type: string, content: TokenStream, alias?: string | string[]) => ({ type, content, alias, length: 0 });

// --- the conversion ---------------------------------------------------------------------------------

test("plain text needs no token; a token is one", () => {
  assert.deepEqual(streamToTokens("plain", 5, 1), [[]]);
  assert.deepEqual(streamToTokens([token("keyword", "const"), " x"], 7, 1), [[5, scope("keyword")]]);
  assert.deepEqual(streamToTokens(["a ", token("string", '"b"')], 5, 1), [[2, scope("none"), 3, scope("string")]]);
});

test("adjacent tokens of one scope merge", () => {
  assert.deepEqual(streamToTokens([token("keyword", "a"), token("keyword", "b"), " "], 3, 1), [[2, scope("keyword")]]);
});

test("the innermost scope wins; a type Prism has but the table lacks takes an alias, else its parent's scope", () => {
  // `t${a}` as Prism's javascript makes it.
  const stream = [
    token("template-string", [
      token("template-punctuation", "`", "string"),
      token("string", "t"),
      token("interpolation", [token("interpolation-punctuation", "${", "punctuation"), "a", token("interpolation-punctuation", "}", "punctuation")]),
      token("template-punctuation", "`", "string"),
    ]),
    token("unheard-of", "q", ["nonsense", "keyword"]),
    token("comment", [token("unheard-of", "c")]),
    token("unheard-of", "z"),
  ];
  const [line] = streamToTokens(stream, 10, 1) ?? [];
  assert.deepEqual(spans("`t${a}`qcz", line), [
    ["`t", "string"],
    ["${", "punctuation"],
    ["a", "subst"],
    ["}", "punctuation"],
    ["`", "string"],
    ["q", "keyword"],
    ["c", "comment"],
  ]);
});

test("a token across lines is split at each line break, and every line gets an entry", () => {
  const tokens = streamToTokens(["x ", token("comment", "/* one\ntwo\nthree */"), " y\n\nlast"], 29, 5);
  assert.ok(tokens !== null);
  assert.equal(tokens.length, 5);
  assert.deepEqual(tokens[0], [2, scope("none"), 6, scope("comment")]);
  assert.deepEqual(tokens[1], [3, scope("comment")]);
  assert.deepEqual(tokens[2], [8, scope("comment")]);
  assert.equal(tokens[3].length, 0);
  assert.equal(tokens[4].length, 0);
});

test("a stream that does not match the text gives nothing", () => {
  assert.equal(streamToTokens("ab", 3, 1), null);
  assert.equal(streamToTokens("a\nb", 3, 1), null);
});

test("scopes of single tokens", () => {
  assert.equal(scopeFor("keyword", undefined, 0), scope("keyword"));
  assert.equal(scopeFor("class-name", undefined, 0), scope("class"));
  assert.equal(scopeFor("builtin", undefined, 0), scope("built_in"));
  assert.equal(scopeFor("regex", undefined, 0), scope("regexp"));
  assert.equal(scopeFor("inserted", undefined, 0), scope("addition"));
  assert.equal(scopeFor("deleted", undefined, 0), scope("deletion"));
  assert.equal(scopeFor("triple-quoted-string", "string", 0), scope("string"));
  assert.equal(scopeFor("unheard-of", "operator", 0), scope("operator"));
  assert.equal(scopeFor("unheard-of", undefined, scope("string")), scope("string"));
  assert.equal(scopeFor("unheard-of", undefined, 0), scope("none"));
});

// --- Prism on real code -------------------------------------------------------------------------------

test("javascript: comments with markup characters, strings, a comment over lines, a template with an interpolation", () => {
  const lines = ["// a <tag> & \"quote\"", "const s = 'x<y>&z';", "/* multi", "   line */ let n = 1;", "", "function f(a) { return `t${a}`; }"];
  const tokens = fits(lines, highlightLines(lines, "javascript"));
  assert.deepEqual(spans(lines[0], tokens[0]), [[lines[0], "comment"]]);
  assert.ok(has(lines[1], tokens[1], "'x<y>&z'", "string"));
  assert.ok(has(lines[1], tokens[1], "const", "keyword"));
  assert.ok(has(lines[2], tokens[2], "/* multi", "comment"));
  assert.ok(has(lines[3], tokens[3], "   line */", "comment"));
  assert.equal(tokens[4].length, 0);
  assert.ok(has(lines[5], tokens[5], "`t", "string"));
  assert.ok(has(lines[5], tokens[5], "${", "punctuation"));
  assert.ok(has(lines[5], tokens[5], "`", "string"));
});

test("a template literal over lines stays a string on each, with its interpolation inside", () => {
  const lines = ["const t = `one", "${n + 1} two", "three`;"];
  const tokens = fits(lines, highlightLines(lines, "typescript"));
  assert.ok(has(lines[0], tokens[0], "`one", "string"));
  assert.ok(has(lines[1], tokens[1], "${", "punctuation"));
  assert.ok(has(lines[1], tokens[1], "1", "number"));
  assert.ok(has(lines[1], tokens[1], " two", "string"));
  assert.ok(has(lines[2], tokens[2], "three`", "string"));
});

test("python: a triple-quoted string over lines", () => {
  const lines = ['s = """one', "two", 'three"""', "x = 1"];
  const tokens = fits(lines, highlightLines(lines, "python"));
  assert.ok(has(lines[0], tokens[0], '"""one', "string"));
  assert.deepEqual(spans(lines[1], tokens[1]), [["two", "string"]]);
  assert.ok(has(lines[2], tokens[2], 'three"""', "string"));
  assert.ok(has(lines[3], tokens[3], "1", "number"));
});

test("lines split from CRLF text tokenise as the same lines", () => {
  const text = "x = 1\r\ny = 'two'\r\n";
  const lines = text.split(/\r\n|\r|\n/);
  const tokens = fits(lines, highlightLines(lines, "python"));
  assert.ok(has(lines[1], tokens[1], "'two'", "string"));
  assert.equal(tokens[2].length, 0);
});

test("markup counts characters as written: entities are their own text, not what they stand for", () => {
  const lines = ['<a href="x&amp;y">&lt;b&gt; & "q"</a>', "<!-- note -->"];
  const tokens = fits(lines, highlightLines(lines, "markup"));
  assert.ok(has(lines[0], tokens[0], "&lt;", "char"));
  assert.ok(has(lines[0], tokens[0], "&gt;", "char"));
  assert.ok(has(lines[0], tokens[0], "href", "attr"));
  assert.ok(has(lines[0], tokens[0], "a", "tag"));
  assert.deepEqual(spans(lines[1], tokens[1]), [[lines[1], "comment"]]);
});

test("tsx: tags, attributes and an expression inside markup", () => {
  const lines = ["export const el = (n: number) => <div className=\"a\">{n + 1}</div>;"];
  const tokens = fits(lines, highlightLines(lines, "tsx"));
  assert.ok(has(lines[0], tokens[0], "div", "tag"));
  assert.ok(has(lines[0], tokens[0], "className", "attr"));
  assert.ok(has(lines[0], tokens[0], "number", "built_in") || has(lines[0], tokens[0], "number", "keyword"));
  assert.ok(has(lines[0], tokens[0], "1", "number"));
});

test("jsx: text between tags stays plain", () => {
  const lines = ["const a = <p>hello world</p>;"];
  const tokens = fits(lines, highlightLines(lines, "jsx"));
  assert.ok(has(lines[0], tokens[0], "p", "tag"));
  assert.ok(!spans(lines[0], tokens[0]).some(([text, name]) => text.includes("hello") && name !== "none"));
});

test("the diff's own case: a comment line has a token", () => {
  const lines = ["// a comment", "const a = 'y';", "let b = 2;", ""];
  const tokens = fits(lines, highlightLines(lines, "typescript"));
  assert.deepEqual(tokens[0], [12, scope("comment")]);
});

test("an unknown language, a very long line or too much text gives no tokens", () => {
  assert.equal(highlightLines(["x"], "no-such-language"), null);
  assert.equal(highlightLines(["x"], "extend"), null);
  assert.equal(highlightLines(["x"], "clike"), null);
  assert.equal(highlightLines(["ok", "x".repeat(LINE_MAX + 1)], "javascript"), null);
  const many = Array.from({ length: Math.ceil(HIGHLIGHT_MAX_BYTES / 100) + 1 }, () => "y".repeat(99));
  assert.equal(highlightLines(many, "javascript"), null);
  assert.ok(highlightLines(["x".repeat(LINE_MAX)], "javascript") !== null);
});

test("every language a file name can pick is loaded and tokenises", () => {
  const names = [
    "a.js", "a.mjs", "a.cjs", "a.jsx", "a.ts", "a.mts", "a.cts", "a.tsx", "a.json", "a.jsonc", "a.html", "a.htm", "a.xml",
    "a.svg", "a.vue", "a.css", "a.scss", "a.less", "a.md", "a.markdown", "a.yml", "a.yaml", "a.toml", "a.ini", "a.sh",
    "a.bash", "a.zsh", "a.py", "a.rb", "a.go", "a.rs", "a.java", "a.kt", "a.kts", "a.swift", "a.c", "a.h", "a.cpp", "a.cc",
    "a.hpp", "a.cs", "a.php", "a.sql", "a.lua", "a.dart", "a.scala", "a.hs", "a.ex", "a.exs", "a.pl", "a.r", "a.ps1",
    "a.proto", "a.tex", "a.diff", "a.patch", "Dockerfile", "Makefile", "a.graphql",
  ];
  const lines = ["# x = 1 // \"s\" <b>", "+ 'two' { y: 3 }", "<?php echo 1; ?>", ""];
  for (const name of names) {
    const language = languageFor(name);
    assert.ok(language !== null, `${name}: language`);
    assert.ok(highlightLines(lines, language) !== null, `${name}: ${language} tokenises`);
    fits(lines, highlightLines(lines, language));
  }
});

test("languages come from the file's name, never guessed", () => {
  assert.equal(languageFor("src/index.ts"), "typescript");
  assert.equal(languageFor("App.TSX"), "tsx");
  assert.equal(languageFor("a/b/script.py"), "python");
  assert.equal(languageFor("win\\path\\main.go"), "go");
  assert.equal(languageFor("Dockerfile"), "docker");
  assert.equal(languageFor("docker/Dockerfile.dev"), "docker");
  assert.equal(languageFor("Makefile"), "makefile");
  assert.equal(languageFor("index.html"), "markup");
  assert.equal(languageFor("README"), null);
  assert.equal(languageFor(".env"), null);
  assert.equal(languageFor(".gitignore"), null);
  assert.equal(languageFor("sub/.gitattributes"), null);
  assert.equal(languageFor("data.unknownext"), null);
});
