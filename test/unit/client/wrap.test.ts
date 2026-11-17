import assert from "node:assert/strict";
import { test } from "node:test";
import { codeMetrics, lineColumns, numberWidth, tabColumns, wrap, wrapColumn } from "../../../client/views/detail/diff/wrap.ts";

// VS Code's own cases, from monospaceLineBreaksComputer.test.ts in 1.142.0: `|` marks where a row starts. As there, a
// character is 7 pixels wide and a full-width one 14, and tabs are four columns.
const widths = { half: 7, full: 14 };
function rows(annotated: string, column: number) {
  const text = annotated.replaceAll("|", "");
  const { breaks } = wrap(text, column, widths);
  let out = text;
  for (const at of [...breaks].reverse()) out = out.slice(0, at) + "|" + out.slice(at);
  assert.equal(out, annotated);
}

test("a line wraps where VS Code wraps it: after a word or a closing mark, before an opening one", () => {
  for (const line of ["", "aaa", "aaaaa", "aaaaa|a", "aaaaa|.", "aaaaa|a.|aaa.|aa", "aaaaa|a..|aaa.|aa", "aaaaa|a...|aaa.|aa", "aaaaa|a....|aaa.|aa"]) rows(line, 5);
  for (const line of ["\t", "\t|aaa", "\t|a\t|aa", "aa\ta", "aa\t|aa"]) rows(line, 5);
  for (const line of ["aaa.|aa", "aaa(.|aa", "aaa))|).aaa", "aaa))|).|aaaa", "aaa)|().|aaa", "aaa|(().|aaa", "aa.|(().|aaa", "aa.|(.).|aaa"]) rows(line, 5);
  rows("this is a line of |text, text that sits |on a line", 23);
  rows("this is a line of |(text), text that sits |on a line", 24);
});

test("Chinese and Japanese break between any two characters, but not before a closing mark", () => {
  for (const line of ["aa 安|安", "あ 安|安", "ああ|安安", "aa |安)安|安", "aa あ|安あ)|安", "aa |(安aa|安", "你好|1111"]) rows(line, 5);
});

test("a surrogate pair is never broken", () => {
  rows("🐇👬🌖🌞🏇🍼🐇👬🌖🌞🏇🍼🐇👬🌖🌞🏇🍼🐇👬🌖🌞🏇🍼|🐇👬🌖🌞🏇🍼🐇👬🌖🌞🏇🍼🐇👬🌖🌞🏇🍼🐇👬🌖🌞🏇🍼|🐇👬", 49);
  rows("🐇👬|&|🌞🌖", 4);
  rows('factory, |"xtxtfunc|(x"🌞🏇🍼🌞🏇🍼🐇|&👬🌖🌞👬🌖🌞🏇🍼|🐇👬x"', 17);
});

test("the rows after the first are set in as far as the line is", () => {
  rows(" *123456789012345678901234567890123456|7890", 38);
  assert.equal(wrap(" *123456789012345678901234567890123456" + "7890", 38, widths).indent, 1);
  assert.equal(wrap("\t\tx".padEnd(40, "y"), 20, widths).indent, 8);
  // Indented so far that a full-width character would not fit after: not set in at all.
  assert.equal(wrap(" ".repeat(19) + "x".repeat(10), 20, widths).indent, 0);
});

test("a tab reaches to the next tab stop from the start of the line, wherever its row starts", () => {
  assert.deepEqual([...tabColumns("a\tbc\td", widths)], [[1, 3], [4, 2]]);
  // A Chinese character takes two columns here, a surrogate pair two.
  assert.deepEqual([...tabColumns("中\tx", widths)], [[1, 2]]);
  assert.deepEqual([...tabColumns("🐇x\t", widths)], [[3, 1]]);
});

test("the code's sizes follow the font size: upstream's fixed 16 pixels give upstream's sizes", () => {
  assert.deepEqual(codeMetrics(16), { fontSize: 16, lineHeight: 24, indicator: 16, bar: 24, digit: 16 * 0.6 });
  // Smaller: the folded region's bar keeps 24 pixels to be pressed; larger, it grows with the line.
  assert.equal(codeMetrics(13).lineHeight, 20);
  assert.equal(codeMetrics(13).bar, 24);
  assert.equal(codeMetrics(20).bar, 30);
  // A line-number column holds the last line's digits: upstream's 0.6 of the size per digit, and 12 pixels.
  assert.equal(numberWidth(16, 999), 16 * 0.6 * 3 + 12);
  assert.equal(numberWidth(10, 0), 10 * 0.6 + 12);
});

test("an unwrapped line is as wide as its columns; wrapping follows the measured width of the size drawn", () => {
  assert.equal(lineColumns("abc", widths), 3);
  assert.equal(lineColumns("a\tb", widths), 5); // the tab reaches column 4
  assert.equal(lineColumns("中x", widths), 3);
  assert.equal(lineColumns("🐇", widths), 2);
  // The same text, twice the font: half the columns fit, so it wraps sooner.
  const text = "word ".repeat(20).trim();
  const small = wrap(text, wrapColumn(352, widths), widths).breaks.length;
  const large = wrap(text, wrapColumn(352, { half: 14, full: 28 }), { half: 14, full: 28 }).breaks.length;
  assert.ok(large > small, `${large} > ${small}`);
});
