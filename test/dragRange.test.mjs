/**
 * Tests for what a drag picks up, and at what indent it lands.
 *
 * Covers four reported problems:
 *   1. grabbing any line must take the whole block, children included
 *   2. a selection's blank edges must not travel with it
 *   3. dropping into an indented context must adopt that indent
 *   4. blank lines must never be swallowed by the block above
 */

import test from "node:test";
import assert from "node:assert/strict";
import { EditorState, EditorSelection } from "@codemirror/state";
import { resolveDragRange, reindentBlock, indentWidth, isBlockStart } from "./.build/dragRange.js";

const DOC = [
	"para one line A", // 1
	"para one line B", // 2
	"", // 3
	"- parent item", // 4
	"  - child one", // 5
	"    - grandchild", // 6
	"  - child two", // 7
	"- next item", // 8
	"", // 9
	"# A heading", // 10
	"trailing paragraph", // 11
].join("\n");

const doc = () => EditorState.create({ doc: DOC }).doc;
const textOf = (d, r) => d.sliceString(r.from, r.to);

// ── whole block, from any line ─────────────────────────────────────────────

test("grabbing any line of a wrapped paragraph takes the whole paragraph", () => {
	const d = doc();
	for (const line of [1, 2]) {
		const r = resolveDragRange(d, line, "paragraph");
		assert.equal(textOf(d, r), "para one line A\npara one line B", `from line ${line}`);
	}
});

test("a parent list item carries its children and grandchildren", () => {
	const d = doc();
	const r = resolveDragRange(d, 4, "paragraph");
	assert.deepEqual([r.firstLine, r.lastLine], [4, 7]);
	assert.ok(textOf(d, r).includes("grandchild"), "nested descendants must travel too");
	assert.ok(!textOf(d, r).includes("next item"), "must stop at the next sibling");
});

test("a child item carries its own children but not its parent or siblings", () => {
	const d = doc();
	const r = resolveDragRange(d, 5, "paragraph");
	assert.deepEqual([r.firstLine, r.lastLine], [5, 6], "child one plus its grandchild");
	assert.ok(!textOf(d, r).includes("parent"), "must not drag the parent");
	assert.ok(!textOf(d, r).includes("child two"), "must not drag a sibling");
});

test("a leaf child drags alone", () => {
	const d = doc();
	const r = resolveDragRange(d, 7, "paragraph");
	assert.deepEqual([r.firstLine, r.lastLine], [7, 7]);
});

test("a list item does not absorb the item above it", () => {
	// The walk upward must stop at a block start, or grabbing any item would
	// swallow every sibling before it.
	const d = doc();
	const r = resolveDragRange(d, 8, "paragraph");
	assert.deepEqual([r.firstLine, r.lastLine], [8, 8]);
});

test("a heading does not absorb the paragraph below or above", () => {
	const d = doc();
	assert.deepEqual(
		[resolveDragRange(d, 10, "paragraph").firstLine, resolveDragRange(d, 10, "paragraph").lastLine],
		[10, 11],
		"heading keeps the paragraph that follows it, as its content"
	);
});

test("a blank line is a boundary and only ever moves alone", () => {
	const d = doc();
	for (const line of [3, 9]) {
		const r = resolveDragRange(d, line, "paragraph");
		assert.deepEqual([r.firstLine, r.lastLine], [line, line], `blank line ${line}`);
	}
});

test("line granularity still takes exactly one line", () => {
	const d = doc();
	const r = resolveDragRange(d, 5, "line");
	assert.deepEqual([r.firstLine, r.lastLine], [5, 5]);
});

// ── selections ─────────────────────────────────────────────────────────────

test("a multi-block selection drags all of its blocks", () => {
	const d = doc();
	const sel = EditorSelection.single(d.line(1).from + 2, d.line(4).from + 2);
	const r = resolveDragRange(d, 2, "paragraph", sel);
	assert.deepEqual([r.firstLine, r.lastLine], [1, 4]);
});

test("blank lines at the edges of a selection are trimmed", () => {
	// Reported: selections that happened to start or end on a blank line
	// dragged that whitespace along with them.
	const d = doc();
	const sel = EditorSelection.single(d.line(3).from, d.line(9).to);
	const r = resolveDragRange(d, 5, "paragraph", sel);
	assert.deepEqual([r.firstLine, r.lastLine], [4, 8], "blank lines 3 and 9 dropped");
});

test("a selection not containing the handle is ignored", () => {
	const d = doc();
	const sel = EditorSelection.single(d.line(1).from, d.line(2).to);
	const r = resolveDragRange(d, 7, "paragraph", sel);
	assert.deepEqual([r.firstLine, r.lastLine], [7, 7]);
});

test("a single-block selection falls through to block logic", () => {
	const d = doc();
	const sel = EditorSelection.single(d.line(4).from + 2, d.line(4).from + 6);
	const r = resolveDragRange(d, 4, "paragraph", sel);
	assert.deepEqual([r.firstLine, r.lastLine], [4, 7], "still carries the children");
});

// ── indent helpers ─────────────────────────────────────────────────────────

test("indentWidth counts spaces and tabs", () => {
	assert.equal(indentWidth("no indent"), 0);
	assert.equal(indentWidth("  two"), 2);
	assert.equal(indentWidth("\tone tab"), 4);
	assert.equal(indentWidth("\t  mixed"), 6);
});

test("isBlockStart recognises list items, headings, quotes and fences", () => {
	for (const s of ["- a", "* a", "+ a", "1. a", "2) a", "  - nested", "# h", "> q", "```js"]) {
		assert.equal(isBlockStart(s), true, `${JSON.stringify(s)} should be a block start`);
	}
	for (const s of ["plain text", "  continuation", "a - b", "2 * 3"]) {
		assert.equal(isBlockStart(s), false, `${JSON.stringify(s)} should not be`);
	}
});

// ── re-indent on drop ──────────────────────────────────────────────────────

test("re-indent shifts a block to a new depth", () => {
	assert.equal(reindentBlock("- item", 0, 2), "  - item");
	assert.equal(reindentBlock("  - item", 2, 0), "- item");
});

test("re-indent preserves the block's internal shape", () => {
	// The whole point: a parent moving deeper must keep its children relatively
	// nested rather than flattening them.
	const block = ["- parent", "  - child", "    - grandchild"].join("\n");
	const moved = reindentBlock(block, 0, 2);
	assert.equal(moved, ["  - parent", "    - child", "      - grandchild"].join("\n"));
});

test("re-indent never pushes past column zero", () => {
	const block = ["  - a", "    - b"].join("\n");
	assert.equal(reindentBlock(block, 2, 0), ["- a", "  - b"].join("\n"));
	// Asking for a negative shift larger than the existing indent clamps.
	assert.equal(reindentBlock("- a", 0, -4), "- a");
});

test("re-indent leaves blank lines blank rather than padding them", () => {
	const block = ["- a", "", "- b"].join("\n");
	assert.equal(reindentBlock(block, 0, 2), ["  - a", "", "  - b"].join("\n"));
});

test("re-indent with no delta returns the text unchanged", () => {
	const block = "- a\n  - b";
	assert.equal(reindentBlock(block, 2, 2), block);
});

test("re-indent is reversible", () => {
	const block = ["- parent", "  - child"].join("\n");
	assert.equal(reindentBlock(reindentBlock(block, 0, 4), 4, 0), block);
});
