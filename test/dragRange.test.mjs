/**
 * Tests for what a drag picks up, and at what indent it lands.
 *
 * Covers the reported problems:
 *   1. grabbing any line must take the whole block, children included
 *   2. a selection's blank edges must not travel with it
 *   3. dropping into an indented context must adopt that indent
 *   4. blank lines must never be swallowed by the block above
 *   5. drop depth is chosen during the drag, but only where indenting is legal
 */

import test from "node:test";
import assert from "node:assert/strict";
import { EditorState, EditorSelection } from "@codemirror/state";
import {
	resolveDragRange,
	reindentBlock,
	indentWidth,
	isBlockStart,
	allowedIndents,
	pickIndent,
	detectIndentUnit,
	isListItem,
} from "./.build/dragRange.js";

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
const listDoc = (lines) => EditorState.create({ doc: lines.join("\n") }).doc;
const textOf = (d, r) => d.sliceString(r.from, r.to);

// ── whole block, from any line ─────────────────────────────────────────────

test("two prose lines at the same indent are two blocks", () => {
	// Reported with a screenshot: dragging one line of a run of plain lines
	// moved the whole run and re-indented all of it. Soft wrapping does not
	// create document lines, so consecutive lines here are separate blocks the
	// reader sees on separate rows — not one wrapped paragraph.
	const d = doc();
	for (const line of [1, 2]) {
		const r = resolveDragRange(d, line, "paragraph");
		assert.deepEqual([r.firstLine, r.lastLine], [line, line], `from line ${line}`);
	}
});

test("a link line drags alone, not the plain lines above it", () => {
	// The exact reported document: a link sitting under three plain lines.
	// Dropping it one level deeper used to indent all four.
	const d = listDoc([
		"This is the way to do it",
		"    This is not the way",
		"This is not the way to do it",
		"[Feel the Notion](https://example.com)",
		"- This is the way",
	]);
	const r = resolveDragRange(d, 4, "paragraph");
	assert.deepEqual([r.firstLine, r.lastLine], [4, 4]);
	assert.equal(textOf(d, r), "[Feel the Notion](https://example.com)");
});

test("a plain line still carries a line indented under it", () => {
	const d = listDoc(["This is the way to do it", "    This is not the way", "back out"]);
	const r = resolveDragRange(d, 1, "paragraph");
	assert.deepEqual([r.firstLine, r.lastLine], [1, 2], "the indented child comes along");
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

test("a heading drags alone, not with the paragraph under it", () => {
	// Changed deliberately. An earlier version had the heading carry the
	// paragraph below it as "its content", which was my choice rather than a
	// requirement — and it shared a root cause with the reported bug where a
	// list item carried unrelated paragraphs. A structured block now owns only
	// what is indented beneath it, which is both predictable and what Notion
	// does: a heading is its own block.
	const d = doc();
	const r = resolveDragRange(d, 10, "paragraph");
	assert.deepEqual([r.firstLine, r.lastLine], [10, 10]);
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

// ── drop-indent selection ──────────────────────────────────────────────────


test("flat prose offers no indent choice", () => {
	// The stated requirement: no indent in context means no indent selection.
	const d = listDoc(["plain one", "plain two", "plain three"]);
	assert.deepEqual(allowedIndents(d, 2, 4), [0]);
	assert.deepEqual(allowedIndents(d, 3, 4), [0]);
});

test("dropping at the very top offers no choice", () => {
	const d = listDoc(["first", "second"]);
	assert.deepEqual(allowedIndents(d, 1, 4), [0], "nothing above to indent under");
});

test("a top-level list item allows one level deeper", () => {
	const d = listDoc(["- item", "next"]);
	assert.deepEqual(allowedIndents(d, 2, 4), [0, 4]);
});

test("a nested item allows every level up to one deeper", () => {
	const d = listDoc(["- parent", "    - child", "next"]);
	assert.deepEqual(allowedIndents(d, 3, 4), [0, 4, 8]);
});

test("markdown's one-level rule is respected", () => {
	// Nesting more than one level past the line above is silently flattened by
	// the renderer, so it is never offered.
	const d = listDoc(["- parent", "next"]);
	const levels = allowedIndents(d, 2, 4);
	assert.equal(Math.max(...levels), 4, "must not offer two levels deeper");
});

test("blank lines are skipped when looking for context", () => {
	const d = listDoc(["    - deep item", "", "", "next"]);
	assert.deepEqual(allowedIndents(d, 4, 4), [0, 4, 8], "context is the deep item");
});

test("indented prose still offers its own depth", () => {
	const d = listDoc(["- item", "    continuation prose", "next"]);
	const levels = allowedIndents(d, 3, 4);
	assert.ok(levels.includes(4), "should offer the prose's own indent");
	assert.equal(Math.max(...levels), 4, "prose is not a list, so no deeper level");
});

test("pickIndent snaps to the nearest legal level", () => {
	assert.equal(pickIndent([0, 4, 8], 5), 4);
	assert.equal(pickIndent([0, 4, 8], 7), 8);
	assert.equal(pickIndent([0, 4, 8], 100), 8, "clamps to the deepest");
	assert.equal(pickIndent([0, 4, 8], -3), 0, "clamps to the shallowest");
	assert.equal(pickIndent([0], 99), 0, "single option always wins");
});

test("indent unit is detected from the document", () => {
	assert.equal(detectIndentUnit(listDoc(["- a", "  - b"])), 2);
	assert.equal(detectIndentUnit(listDoc(["- a", "    - b"])), 4);
	assert.equal(detectIndentUnit(listDoc(["- a", "\t- b"])), 4, "a tab reads as 4 columns");
});

test("indent unit falls back when the document has none", () => {
	assert.equal(detectIndentUnit(listDoc(["flat", "also flat"]), 4), 4);
});

test("isListItem distinguishes items from prose", () => {
	assert.equal(isListItem("- a"), true);
	assert.equal(isListItem("  1. a"), true);
	assert.equal(isListItem("# heading"), false);
	assert.equal(isListItem("plain"), false);
});

// ── a plain line does not get absorbed by the structured line above it ──────

test("the paragraph under a heading drags alone, not the heading", () => {
	// Found while making Cmd+A code-block aware. The upward walk stepped INTO
	// the heading and then stopped there, so it returned the HEADING's range:
	// grabbing "trailing paragraph" dragged "# A heading" instead.
	const d = doc();
	const r = resolveDragRange(d, 11, "paragraph");
	assert.deepEqual([r.firstLine, r.lastLine], [11, 11]);
	assert.equal(textOf(d, r), "trailing paragraph");
});

test("the line after a closing fence is its own block", () => {
	const d = listDoc(["```", "code", "```", "after"]);
	const r = resolveDragRange(d, 4, "paragraph");
	assert.deepEqual([r.firstLine, r.lastLine], [4, 4], "must not carry the fence");
});

test("the line after a list item is still its own block", () => {
	const d = listDoc(["- item", "plain line"]);
	const r = resolveDragRange(d, 2, "paragraph");
	assert.deepEqual([r.firstLine, r.lastLine], [2, 2]);
});

test("an indented continuation still joins the item above it", () => {
	// The rule is same-or-shallower indent, so a genuinely nested continuation
	// must still travel with its parent.
	const d = listDoc(["- item", "    continuation"]);
	const r = resolveDragRange(d, 2, "paragraph");
	assert.deepEqual([r.firstLine, r.lastLine], [1, 2]);
});
