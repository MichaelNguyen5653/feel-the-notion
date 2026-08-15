/**
 * Tests for multi-block selection.
 *
 * Both functions under test are pure (Text + ranges -> result), so they run
 * against real CodeMirror documents and selections with no DOM.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { EditorState, EditorSelection } from "@codemirror/state";
import { selectedLines, snapRangeToBlocks } from "./.build/blockSelection.js";

const DOC = ["first block", "second block", "third block", "fourth block"].join("\n");

function docOf(text = DOC) {
	return EditorState.create({ doc: text }).doc;
}

/** Builds a selection range from absolute positions. */
function range(from, to) {
	return EditorSelection.range(from, to);
}

// ── selectedLines ──────────────────────────────────────────────────────────

test("a selection inside one block highlights nothing", () => {
	const doc = docOf();
	// Native ragged highlight is correct within a block — Notion does this too.
	assert.deepEqual(selectedLines(doc, [range(2, 7)]), []);
});

test("a selection crossing one boundary highlights both blocks", () => {
	const doc = docOf();
	const from = doc.line(1).from + 3;
	const to = doc.line(2).from + 3;
	assert.deepEqual(selectedLines(doc, [range(from, to)]), [1, 2]);
});

test("a selection spanning three blocks highlights all three", () => {
	const doc = docOf();
	const from = doc.line(1).from + 2;
	const to = doc.line(3).from + 2;
	assert.deepEqual(selectedLines(doc, [range(from, to)]), [1, 2, 3]);
});

test("an empty selection highlights nothing", () => {
	const doc = docOf();
	assert.deepEqual(selectedLines(doc, [EditorSelection.cursor(5)]), []);
});

test("multiple cursors each contribute their own blocks", () => {
	const doc = docOf();
	const a = range(doc.line(1).from + 1, doc.line(2).from + 1);
	const b = range(doc.line(3).from + 1, doc.line(4).from + 1);
	assert.deepEqual(selectedLines(doc, [a, b]), [1, 2, 3, 4]);
});

test("overlapping ranges do not produce duplicate lines", () => {
	// Duplicates would make RangeSetBuilder throw at runtime.
	const doc = docOf();
	const a = range(doc.line(1).from, doc.line(3).from);
	const b = range(doc.line(2).from, doc.line(4).from);
	const lines = selectedLines(doc, [a, b]);
	assert.deepEqual(lines, [1, 2, 3, 4]);
	assert.equal(new Set(lines).size, lines.length, "no duplicates");
});

test("result is always ascending", () => {
	const doc = docOf();
	const a = range(doc.line(3).from, doc.line(4).from);
	const b = range(doc.line(1).from, doc.line(2).from);
	const lines = selectedLines(doc, [a, b]);
	for (let i = 1; i < lines.length; i++) {
		assert.ok(lines[i] > lines[i - 1], "must be sorted ascending for RangeSetBuilder");
	}
});

test("a selection ending exactly at a line start still includes that line", () => {
	// Boundary case: dragging just past the newline. Notion shows the next
	// block as selected here, and so do we — recording the choice explicitly.
	const doc = docOf();
	const lines = selectedLines(doc, [range(doc.line(1).from, doc.line(2).from)]);
	assert.deepEqual(lines, [1, 2]);
});

// ── snapRangeToBlocks ──────────────────────────────────────────────────────

test("snapping expands to whole blocks", () => {
	const doc = docOf();
	const snapped = snapRangeToBlocks(doc, range(doc.line(1).from + 4, doc.line(2).from + 4));
	assert.equal(snapped.from, doc.line(1).from);
	assert.equal(snapped.to, doc.line(2).to);
});

test("snapping leaves a single-block selection alone", () => {
	const doc = docOf();
	const original = range(2, 7);
	const snapped = snapRangeToBlocks(doc, original);
	assert.equal(snapped.from, original.from);
	assert.equal(snapped.to, original.to);
});

test("snapping leaves a cursor alone", () => {
	const doc = docOf();
	const cursor = EditorSelection.cursor(5);
	assert.equal(snapRangeToBlocks(doc, cursor).empty, true);
});

test("snapping preserves backwards drag direction", () => {
	// Dragging upward puts head before anchor. Losing that would make a
	// following Shift+Arrow extend from the wrong end.
	const doc = docOf();
	const backwards = EditorSelection.range(doc.line(3).from + 2, doc.line(1).from + 2);
	const snapped = snapRangeToBlocks(doc, backwards);
	assert.ok(snapped.anchor > snapped.head, "anchor should remain after head");
	assert.equal(snapped.from, doc.line(1).from);
	assert.equal(snapped.to, doc.line(3).to);
});

test("snapping is idempotent", () => {
	const doc = docOf();
	const once = snapRangeToBlocks(doc, range(doc.line(1).from + 3, doc.line(2).from + 3));
	const twice = snapRangeToBlocks(doc, once);
	assert.equal(twice.from, once.from);
	assert.equal(twice.to, once.to);
});

test("snapping never selects beyond the document", () => {
	const doc = docOf();
	const snapped = snapRangeToBlocks(doc, range(doc.line(1).from, doc.length));
	assert.ok(snapped.to <= doc.length, "must not exceed document length");
});
