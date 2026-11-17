// highlight.js's HTML as per-line tokens: lengths add up to the line, nested spans, entities, tokens across lines.

import assert from "node:assert/strict";
import { test } from "node:test";
import { highlightLines, htmlToTokens, languageFor, scopeIndex } from "../../../server/highlight.ts";
import { TOKEN_SCOPES, type TokenLine } from "../../../shared/schemas.ts";

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

test("plain text needs no token; a span is one", () => {
  assert.deepEqual(htmlToTokens("plain"), [[]]);
  assert.deepEqual(htmlToTokens('<span class="hljs-keyword">const</span> x'), [[5, scope("keyword")]]);
  assert.deepEqual(htmlToTokens('a <span class="hljs-string">"b"</span>'), [[2, 0, 3, scope("string")]]);
});

test("the innermost scope wins, and a span without an hljs- class keeps its parent's", () => {
  const html = '<span class="hljs-meta">#<span class="hljs-keyword">include</span> x</span><span class="language-css"><span class="hljs-number">1</span>z</span>';
  const [line] = htmlToTokens(html);
  assert.deepEqual(spans("#include x1z", line), [
    ["#", "meta"],
    ["include", "keyword"],
    [" x", "meta"],
    ["1", "number"],
  ]);
});

test("sub-scopes and unknown scopes map to the nearest one, else to none", () => {
  assert.equal(scopeIndex("hljs-title class_"), scope("class"));
  assert.equal(scopeIndex("hljs-title function_"), scope("function"));
  assert.equal(scopeIndex("hljs-title class_ inherited__"), scope("class"));
  assert.equal(scopeIndex("hljs-variable language_"), scope("variable"));
  assert.equal(scopeIndex("hljs-selector-tag"), scope("selector"));
  assert.equal(scopeIndex("hljs-template-variable"), scope("variable"));
  assert.equal(scopeIndex("hljs-meta-keyword"), scope("keyword"));
  assert.equal(scopeIndex("hljs-keyword"), scope("keyword"));
  assert.equal(scopeIndex("hljs-formula"), scope("none"));
  assert.equal(scopeIndex("language-xml"), null);
});

test("entities count as the one character they stand for", () => {
  const [line] = htmlToTokens('<span class="hljs-string">&quot;a&amp;b&lt;c&gt;&#x27;&#39;&quot;</span> &unknown; x');
  const text = "\"a&b<c>''\" &unknown; x";
  assert.deepEqual(spans(text, line), [["\"a&b<c>''\"", "string"]]);
  assert.ok(covered(line) <= text.length);
});

test("a token across lines is split at each line break, and every line gets an entry", () => {
  const tokens = htmlToTokens('x <span class="hljs-comment">/* one\ntwo\nthree */</span> y\n\nlast', 5);
  assert.equal(tokens.length, 5);
  assert.deepEqual(tokens[0], [2, 0, 6, scope("comment")]);
  assert.deepEqual(tokens[1], [3, scope("comment")]);
  assert.deepEqual(tokens[2], [8, scope("comment")]);
  assert.deepEqual(tokens[3], []);
  assert.deepEqual(tokens[4], []);
});

test("highlight.js on real code: one entry per line, never longer than the line", () => {
  const lines = ["// a <tag> & \"quote\"", "const s = 'x<y>&z';", "/* multi", "   line */ let n = 1;", "", "function f(a) { return `t${a}`; }"];
  const tokens = highlightLines(lines, "javascript");
  assert.ok(tokens !== null);
  assert.equal(tokens.length, lines.length);
  tokens.forEach((line, n) => assert.ok(covered(line) <= lines[n].length, `line ${n + 1}: ${covered(line)} > ${lines[n].length}`));
  assert.deepEqual(spans(lines[0], tokens[0]), [[lines[0], "comment"]]);
  assert.ok(spans(lines[3], tokens[3]).some(([text, name]) => text === "   line */" && name === "comment"));
  assert.ok(spans(lines[1], tokens[1]).some(([text, name]) => text === "'x<y>&z'" && name === "string"));
});

test("lines split from CRLF text tokenise as the same lines", () => {
  const text = "x = 1\r\ny = 'two'\r\n";
  const lines = text.split(/\r\n|\r|\n/);
  const tokens = highlightLines(lines, "python");
  assert.ok(tokens !== null);
  assert.equal(tokens.length, lines.length);
  tokens.forEach((line, n) => assert.ok(covered(line) <= lines[n].length));
});

test("an unknown language gives no tokens", () => {
  assert.equal(highlightLines(["x"], "no-such-language"), null);
});

test("languages come from the file's name, never guessed", () => {
  assert.equal(languageFor("src/index.ts"), "typescript");
  assert.equal(languageFor("App.TSX"), "typescript");
  assert.equal(languageFor("a/b/script.py"), "python");
  assert.equal(languageFor("Dockerfile"), "dockerfile");
  assert.equal(languageFor("docker/Dockerfile.dev"), "dockerfile");
  assert.equal(languageFor("Makefile"), "makefile");
  assert.equal(languageFor("index.html"), "xml");
  assert.equal(languageFor("README"), null);
  assert.equal(languageFor(".env"), null);
  assert.equal(languageFor("data.unknownext"), null);
});
