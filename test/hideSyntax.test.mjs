/**
 * Integration tests for the hide-syntax decorations.
 *
 * These build a real CodeMirror RangeSet over a real EditorState document,
 * exercising the same order-and-overlap invariants the editor enforces at
 * runtime. RangeSetBuilder THROWS if ranges arrive out of order, so a scanner
 * bug on any line would crash the editor rather than degrade — worth a test
 * even though the scanner itself is covered separately.
 *
 * No DOM, so EditorView is not constructed; the decoration-building logic is
 * reproduced here against the same findMarkerRanges the plugin calls.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { EditorState, RangeSetBuilder } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { findMarkerRanges } from "./.build/markerRanges.js";
import { findFencedLines } from "./.build/codeFence.js";

const hidden = Decoration.replace({});

/** Mirrors buildDecorations() in src/hideSyntax.ts, over the whole document. */
function build(doc) {
	const state = EditorState.create({ doc });
	const builder = new RangeSetBuilder();
	const fencedLines = findFencedLines(state.doc);
	for (let n = 1; n <= state.doc.lines; n++) {
		if (fencedLines.has(n)) continue;
		const line = state.doc.line(n);
		for (const r of findMarkerRanges(line.text, line.from)) {
			builder.add(r.from, r.to, hidden);
		}
	}
	return { set: builder.finish(), state };
}

function countRanges(set) {
	let n = 0;
	const iter = set.iter();
	while (iter.value) {
		n++;
		iter.next();
	}
	return n;
}

test("builds over a realistic multi-line document without throwing", () => {
	const doc = [
		"# A Heading With **bold**",
		"",
		"Plain paragraph with *italic* and `code` and ==highlight==.",
		"",
		"## Second heading",
		"- a bullet with **bold**",
		"- [ ] a task with ~~strike~~",
		"> a quote with _emphasis_",
		"",
		"```js",
		"const x = **not markdown**;",
		"```",
		"",
		"Final line with 2 * 3 = 6 and a lone _underscore.",
	].join("\n");

	const { set } = build(doc);
	assert.ok(countRanges(set) > 0, "should find markers");
});

test("every range stays inside its own line", () => {
	const doc = ["# H **b**", "second **c** line", "third `d` line"].join("\n");
	const { state } = build(doc);

	for (let n = 1; n <= state.doc.lines; n++) {
		const line = state.doc.line(n);
		for (const r of findMarkerRanges(line.text, line.from)) {
			assert.ok(r.from >= line.from, `range starts before line ${n}`);
			assert.ok(r.to <= line.to, `range ends past line ${n}`);
		}
	}
});

test("code fence contents produce no ranges", () => {
	// build() now consults findFencedLines before scanning each line, so the
	// fence's own line-at-a-time blindness (findMarkerRanges has no block
	// context) no longer reaches the decorations that actually render.
	const doc = ["```", "**this is not bold**", "```"].join("\n");
	const { set } = build(doc);
	assert.equal(countRanges(set), 0, "content inside a fence must not be hidden");
});

test("underscores inside a fenced code block are not hidden", () => {
	// The reported bug: `_VARIABLE_A_` on its own line inside a fence used to
	// have its underscores paired as emphasis and hidden, rendering as
	// "VARIABLEA_" instead of the literal code.
	const doc = ["```", "_VARIABLE_A_", "```"].join("\n");
	const { set } = build(doc);
	assert.equal(countRanges(set), 0);
});

test("an empty document is fine", () => {
	const { set } = build("");
	assert.equal(countRanges(set), 0);
});

test("a document of only markers is fine", () => {
	const { set } = build("****\n____\n``\n");
	assert.equal(countRanges(set), 0, "empty spans yield nothing to hide");
});

test("hidden ranges never cover a whole line's visible content", () => {
	// If a bug ever made a range span the entire line, the line would vanish
	// from view entirely. Guard against that specifically.
	const doc = ["# Heading", "**bold**", "`code`"].join("\n");
	const { state } = build(doc);
	for (let n = 1; n <= state.doc.lines; n++) {
		const line = state.doc.line(n);
		const ranges = findMarkerRanges(line.text, line.from);
		const covered = ranges.reduce((sum, r) => sum + (r.to - r.from), 0);
		assert.ok(
			covered < line.text.length,
			`line ${n} (${JSON.stringify(line.text)}) would be entirely hidden`
		);
	}
});
