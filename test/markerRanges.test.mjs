/**
 * Tests for the marker scanner. Run with:
 *   node --test test/markerRanges.test.mjs
 *
 * The scanner is compiled from src/markerRanges.ts by test/build-test.mjs so
 * the tests exercise the shipped code rather than a copy.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { findMarkerRanges } from "./.build/markerRanges.js";

/** Renders what the reader would see if every found range were hidden. */
function hide(text) {
	const ranges = findMarkerRanges(text);
	let out = "";
	let i = 0;
	for (const r of ranges) {
		out += text.slice(i, r.from);
		i = r.to;
	}
	return out + text.slice(i);
}

test("bold markers are found on both sides", () => {
	assert.equal(hide("a **bold** b"), "a bold b");
});

test("italic with single asterisk", () => {
	assert.equal(hide("a *it* b"), "a it b");
});

test("underscore emphasis", () => {
	assert.equal(hide("a __b__ and _i_ c"), "a b and i c");
});

test("highlight and strikethrough", () => {
	assert.equal(hide("a ==hi== and ~~no~~ b"), "a hi and no b");
});

test("inline code backticks", () => {
	assert.equal(hide("run `npm test` now"), "run npm test now");
});

test("heading hashes and the following space", () => {
	assert.equal(hide("## Heading"), "Heading");
	assert.equal(hide("###### Six"), "Six");
});

test("heading plus inline emphasis together", () => {
	assert.equal(hide("## A **bold** title"), "A bold title");
});

test("unmatched delimiter is left alone", () => {
	// A lone asterisk is literal text. Hiding it would delete a character the
	// reader can see.
	assert.equal(hide("2 * 3 = 6"), "2 * 3 = 6");
	assert.equal(hide("a *dangling"), "a *dangling");
});

test("escaped delimiter is left alone", () => {
	assert.equal(hide("a \\*not emphasis\\* b"), "a \\*not emphasis\\* b");
});

test("longest delimiter wins: ** beats *", () => {
	const r = findMarkerRanges("**b**");
	assert.deepEqual(r, [
		{ from: 0, to: 2 },
		{ from: 3, to: 5 },
	]);
});

test("code fences are skipped entirely", () => {
	assert.deepEqual(findMarkerRanges("```js"), []);
	assert.deepEqual(findMarkerRanges("$$"), []);
	assert.deepEqual(findMarkerRanges("   ```"), []);
});

test("list and quote markers are NOT hidden", () => {
	// Structural, and Obsidian already preserves the quote marker's width.
	assert.equal(hide("- a bullet"), "- a bullet");
	assert.equal(hide("> a quote"), "> a quote");
	assert.equal(hide("1. numbered"), "1. numbered");
	assert.equal(hide("- [ ] a task"), "- [ ] a task");
});

test("empty span produces no ranges", () => {
	// Nothing between the delimiters means nothing would reflow.
	assert.deepEqual(findMarkerRanges("****"), []);
});

test("lineFrom offsets every range", () => {
	const r = findMarkerRanges("**b**", 100);
	assert.deepEqual(r, [
		{ from: 100, to: 102 },
		{ from: 103, to: 105 },
	]);
});

test("ranges are sorted and never overlap", () => {
	const r = findMarkerRanges("## **a** and `b` and ==c==");
	for (let i = 1; i < r.length; i++) {
		assert.ok(r[i].from >= r[i - 1].to, `range ${i} overlaps its predecessor`);
	}
});

// ── inline code spans: contents are code, not markdown ──────────────────────

test("underscores inside an inline code span are not hidden as emphasis", () => {
	// The reported bug: `_VARIABLE_A_` had its two underscores paired and
	// hidden like real emphasis, rendering as "VARIABLEA_" instead of the
	// literal code text.
	assert.equal(hide("`_VARIABLE_A_`"), "_VARIABLE_A_");
});

test("inline code span hides only its two backticks", () => {
	const r = findMarkerRanges("`_VARIABLE_A_`");
	assert.deepEqual(r, [
		{ from: 0, to: 1 },
		{ from: 13, to: 14 },
	]);
});

test("markers before and after a code span on the same line still hide", () => {
	assert.equal(hide("**bold** `_A_` __also bold__"), "bold _A_ also bold");
});

test("an unmatched backtick changes nothing else on the line", () => {
	// No closing backtick on the line — it is literal text, same as a lone `*`.
	assert.equal(hide("a `dangling and **bold**"), "a `dangling and bold");
});

test("plain text yields nothing", () => {
	assert.deepEqual(findMarkerRanges("just a normal sentence."), []);
});

test("hiding never changes visible character count except by markers", () => {
	// Property check: the hidden result must always be a subsequence of the
	// input. Catches any range that points outside the line.
	for (const s of [
		"**a** *b* `c` ==d== ~~e~~",
		"# H with **bold**",
		"no markers here",
		"*a* *b* *c*",
		"a ** b",
	]) {
		const out = hide(s);
		let i = 0;
		for (const ch of out) {
			i = s.indexOf(ch, i);
			assert.notEqual(i, -1, `output of ${JSON.stringify(s)} is not a subsequence`);
			i++;
		}
	}
});

// ── links ──────────────────────────────────────────────────────────────────
//
// Reported: the scanner walked straight through link syntax, so any paired _
// or * inside a URL or a note name was treated as emphasis and hidden. A
// wikipedia link came out reading ".../Foo bar baz" while being edited, which
// is not a cosmetic problem — the reader cannot see their own URL. Markdown
// does not treat those underscores as emphasis either, so hiding them was
// wrong on the spec as well as on the eye.

test("an inline link's destination is left alone", () => {
	assert.equal(
		hide("[link](https://en.wikipedia.org/wiki/Foo_bar_baz)"),
		"[link](https://en.wikipedia.org/wiki/Foo_bar_baz)"
	);
});

test("an inline link's text is left alone", () => {
	assert.equal(hide("[my_page_name](https://example.com)"), "[my_page_name](https://example.com)");
});

test("doubled underscores in a URL survive too", () => {
	assert.equal(hide("see [docs](https://x.com/a__b__c) here"), "see [docs](https://x.com/a__b__c) here");
});

test("an image is left alone", () => {
	assert.equal(hide("![alt_text](path/to/a_b_c.png)"), "![alt_text](path/to/a_b_c.png)");
});

test("an image nested inside a link is left alone", () => {
	assert.equal(
		hide("[![img](a_b_c.png)](https://x.com/d_e_f)"),
		"[![img](a_b_c.png)](https://x.com/d_e_f)"
	);
});

test("a wikilink is left alone", () => {
	assert.equal(hide("[[My_Note_Name]]"), "[[My_Note_Name]]");
});

test("a wikilink with an alias is left alone", () => {
	assert.equal(hide("[[My_Note|the_alias]]"), "[[My_Note|the_alias]]");
});

test("an embed is left alone", () => {
	assert.equal(hide("![[embed_file_here.png]]"), "![[embed_file_here.png]]");
});

test("a bare URL is left alone", () => {
	assert.equal(hide("visit https://x.com/a_b_c today"), "visit https://x.com/a_b_c today");
});

test("an angle-bracket autolink is left alone", () => {
	assert.equal(hide("<https://x.com/a_b_c>"), "<https://x.com/a_b_c>");
});

test("emphasis outside a link is still hidden", () => {
	// The point is to skip links, not to give up on the rest of the line.
	assert.equal(hide("**bold** [a_b](c_d) _it_"), "bold [a_b](c_d) it");
});

test("emphasis on both sides of a bare URL is still hidden", () => {
	assert.equal(hide("_a_ https://x.com/p_q _b_"), "a https://x.com/p_q b");
});

test("an unclosed bracket does not swallow the rest of the line", () => {
	// A stray "[" is ordinary text. If it ate everything after it, a single
	// typed bracket would silently switch marker hiding off for that line.
	assert.equal(hide("[oops _italic_ here"), "[oops italic here");
});

test("an unclosed link destination does not swallow the rest of the line", () => {
	assert.equal(hide("[text](unclosed _italic_ here"), "[text](unclosed italic here");
});

test("bracketed text that is not a link keeps its emphasis hidden", () => {
	// "[a] _b_" has no destination, so it is not a link at all.
	assert.equal(hide("[a] _b_"), "[a] b");
});
