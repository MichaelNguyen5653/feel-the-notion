/**
 * Tests for what a drag actually picks up.
 *
 * The bug these exist to prevent: selecting three paragraphs, grabbing one
 * handle, and watching a single line come away while the rest stayed put.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { EditorState, EditorSelection } from "@codemirror/state";
import { resolveDragRange } from "./.build/dragRange.js";

/** A doc with two multi-line paragraphs separated by a blank line. */
const DOC = [
	"para one line A", // 1
	"para one line B", // 2
	"", // 3
	"para two line A", // 4
	"para two line B", // 5
	"para two line C", // 6
].join("\n");

function docOf(text = DOC) {
	return EditorState.create({ doc: text }).doc;
}

function textOf(doc, range) {
	return doc.sliceString(range.from, range.to);
}

// ── granularity: line ──────────────────────────────────────────────────────

test("line granularity picks up exactly one line", () => {
	const doc = docOf();
	const r = resolveDragRange(doc, 1, "line");
	assert.equal(textOf(doc, r), "para one line A");
	assert.deepEqual([r.firstLine, r.lastLine], [1, 1]);
});

// ── granularity: paragraph ─────────────────────────────────────────────────

test("paragraph granularity picks up the whole paragraph from its first line", () => {
	const doc = docOf();
	const r = resolveDragRange(doc, 1, "paragraph");
	assert.equal(textOf(doc, r), "para one line A\npara one line B");
});

test("paragraph granularity works from the middle of a paragraph", () => {
	const doc = docOf();
	const r = resolveDragRange(doc, 5, "paragraph");
	assert.equal(textOf(doc, r), "para two line A\npara two line B\npara two line C");
	assert.deepEqual([r.firstLine, r.lastLine], [4, 6]);
});

test("paragraph granularity stops at a blank line", () => {
	const doc = docOf();
	const r = resolveDragRange(doc, 2, "paragraph");
	assert.equal(r.lastLine, 2, "must not cross the blank line into paragraph two");
});

test("a blank line is its own block", () => {
	const doc = docOf();
	const r = resolveDragRange(doc, 3, "paragraph");
	assert.deepEqual([r.firstLine, r.lastLine], [3, 3]);
});

test("paragraph granularity handles the first and last lines of the document", () => {
	const doc = docOf();
	assert.equal(resolveDragRange(doc, 1, "paragraph").firstLine, 1);
	assert.equal(resolveDragRange(doc, 6, "paragraph").lastLine, 6);
});

// ── multi-block selection wins ─────────────────────────────────────────────

test("dragging from inside a multi-block selection carries every selected block", () => {
	const doc = docOf();
	// Select from paragraph one into paragraph two.
	const sel = EditorSelection.single(doc.line(1).from + 2, doc.line(5).from + 2);
	const r = resolveDragRange(doc, 4, "line", sel);
	assert.deepEqual([r.firstLine, r.lastLine], [1, 5], "should span the whole selection");
});

test("selection beats line granularity", () => {
	const doc = docOf();
	const sel = EditorSelection.single(doc.line(4).from, doc.line(6).to);
	const r = resolveDragRange(doc, 5, "line", sel);
	assert.deepEqual([r.firstLine, r.lastLine], [4, 6], "not just line 5");
});

test("selection beats paragraph granularity when it is larger", () => {
	const doc = docOf();
	const sel = EditorSelection.single(doc.line(1).from, doc.line(5).to);
	const r = resolveDragRange(doc, 2, "paragraph", sel);
	assert.deepEqual([r.firstLine, r.lastLine], [1, 5], "selection spans the blank line too");
});

test("a selection NOT containing the handle is ignored", () => {
	// Grabbing a block outside the selection drags that block, not the
	// selection — otherwise the handle would lie about what it picks up.
	const doc = docOf();
	const sel = EditorSelection.single(doc.line(1).from, doc.line(2).to);
	const r = resolveDragRange(doc, 5, "line", sel);
	assert.deepEqual([r.firstLine, r.lastLine], [5, 5]);
});

test("a single-block selection does not trigger block dragging", () => {
	// Selecting a few words inside one paragraph then dragging its handle
	// should behave exactly as if nothing were selected.
	const doc = docOf();
	const sel = EditorSelection.single(doc.line(4).from + 1, doc.line(4).from + 6);
	const r = resolveDragRange(doc, 4, "paragraph", sel);
	assert.deepEqual([r.firstLine, r.lastLine], [4, 6], "falls through to paragraph logic");
});

test("an empty cursor selection is ignored", () => {
	const doc = docOf();
	const sel = EditorSelection.single(doc.line(4).from + 3);
	const r = resolveDragRange(doc, 4, "line", sel);
	assert.deepEqual([r.firstLine, r.lastLine], [4, 4]);
});

test("no selection argument is safe", () => {
	const doc = docOf();
	const r = resolveDragRange(doc, 1, "line", undefined);
	assert.deepEqual([r.firstLine, r.lastLine], [1, 1]);
});

test("ranges never exceed the document", () => {
	const doc = docOf();
	for (let n = 1; n <= doc.lines; n++) {
		for (const g of ["line", "paragraph"]) {
			const r = resolveDragRange(doc, n, g);
			assert.ok(r.from >= 0 && r.to <= doc.length, `line ${n} / ${g} out of bounds`);
			assert.ok(r.from <= r.to, `line ${n} / ${g} inverted`);
		}
	}
});

test("single-line document is handled", () => {
	const doc = docOf("only line");
	const r = resolveDragRange(doc, 1, "paragraph");
	assert.equal(textOf(doc, r), "only line");
});
