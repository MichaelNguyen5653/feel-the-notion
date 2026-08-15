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
