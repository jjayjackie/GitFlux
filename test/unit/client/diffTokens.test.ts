import assert from "node:assert/strict";
import { test } from "node:test";
import { TOKEN_SCOPES } from "../../../shared/schemas.ts";
import { scopeName, styledRuns, tokensOf } from "../../../client/views/detail/diff/tokens.ts";

const scope = (name: (typeof TOKEN_SCOPES)[number]) => TOKEN_SCOPES.indexOf(name);
const KEYWORD = scope("keyword");
const STRING = scope("string");
const COMMENT = scope("comment");

/** Runs as `[text, scope, marked]`, to compare readably. */
const read = (text: string, runs: ReturnType<typeof styledRuns>) => runs.map((run) => [text.slice(run.start, run.end), run.scope, run.marked]);

test("without tokens or marks, a slice is one plain run; an empty line or slice has none", () => {
  assert.deepEqual(read("let x = 1", styledRuns("let x = 1", undefined, [])), [["let x = 1", "none", false]]);
  assert.equal(styledRuns("", [3, KEYWORD], []).length, 0);
  assert.equal(styledRuns("abc", [3, KEYWORD], [], 2, 2).length, 0);
  assert.equal(styledRuns("abc", undefined, [], 5, 9).length, 0);
});

test("tokens colour their stretches, and text past the last token is plain", () => {
  const text = 'const s = "hi"; // note';
  const tokens = [5, KEYWORD, 5, 0, 4, STRING];
  assert.deepEqual(read(text, styledRuns(text, tokens, [])), [
    ["const", "keyword", false],
    [" s = ", "none", false],
    ['"hi"', "string", false],
    ["; // note", "none", false],
  ]);
});

test("tokens longer than the line are cut at its end", () => {
  assert.deepEqual(read("ab", styledRuns("ab", [10, COMMENT], [])), [["ab", "comment", false]]);
});

test("a change mark splits the runs it crosses, keeping each run's colour", () => {
  const text = "return value;";
  const tokens = [6, KEYWORD, 7, 0];
  // "rn val" changed: across the keyword's end and into the plain text.
  assert.deepEqual(read(text, styledRuns(text, tokens, [[4, 10]])), [
    ["retu", "keyword", false],
    ["rn", "keyword", true],
    [" val", "none", true],
    ["ue;", "none", false],
  ]);
});

test("overlapping or unordered marks are merged", () => {
  const runs = styledRuns("abcdefgh", undefined, [
    [5, 7],
    [1, 3],
    [2, 4],
  ]);
  assert.deepEqual(read("abcdefgh", runs), [
    ["a", "none", false],
    ["bcd", "none", true],
    ["e", "none", false],
    ["fg", "none", true],
    ["h", "none", false],
  ]);
});

test("a wrapped row draws only its slice: a slice can cut a token and a mark", () => {
  const text = "keyword string tail";
  const tokens = [7, KEYWORD, 1, 0, 6, STRING];
  const runs = styledRuns(text, tokens, [[5, 10]], 4, 12);
  assert.deepEqual(read(text, runs), [
    ["o", "keyword", false],
    ["rd", "keyword", true],
    [" ", "none", true],
    ["st", "string", true],
    ["ri", "string", false],
  ]);
  // The rows of a line together cover it exactly.
  const rows = [
    [0, 6],
    [6, 13],
    [13, text.length],
  ];
  const joined = rows.flatMap(([from, to]) => styledRuns(text, tokens, [[5, 10]], from, to)).map((run) => text.slice(run.start, run.end));
  assert.equal(joined.join(""), text);
});

test("neighbouring tokens of the same scope are drawn as one run", () => {
  assert.deepEqual(read("aabb", styledRuns("aabb", [2, STRING, 2, STRING], [])), [["aabb", "string", false]]);
  assert.deepEqual(read("aabb", styledRuns("aabb", [2, 0, 0, KEYWORD, 2, 0], [])), [["aabb", "none", false]]);
});

test("astral characters count as two UTF-16 units, as the daemon counts them", () => {
  const text = "🐇=x"; // the rabbit is two units
  assert.equal(text.length, 4);
  const runs = styledRuns(text, [2, STRING, 1, 0, 1, KEYWORD], []);
  assert.deepEqual(read(text, runs), [
    ["🐇", "string", false],
    ["=", "none", false],
    ["x", "keyword", false],
  ]);
});

test("an unknown scope number is plain text; a line's tokens are found by its number", () => {
  assert.equal(scopeName(99999), "none");
  assert.equal(scopeName(KEYWORD), "keyword");
  const tokens = [[1, KEYWORD], [2, STRING]];
  assert.deepEqual(tokensOf(tokens, 2), [2, STRING]);
  assert.equal(tokensOf(tokens, 0), undefined);
  assert.equal(tokensOf(undefined, 1), undefined);
  assert.equal(tokensOf(tokens, null), undefined);
});
