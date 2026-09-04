/**
 * Tests for the code-fence guard.
 *
 * Both block behaviours consult this before acting. A false positive is
 * harmless — the editor's own behaviour takes over. A false negative is not:
 * Backspace would strip a "#" that is a comment, in the user's code.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import {
	codeFenceContent,
	findCodeFence,
	findFencedLines,
	findFenceSpans,
	isInsideCodeFence,
} from "./.build/codeFence.js";

const docOf = (lines) => EditorState.create({ doc: lines.join("\n") }).doc;

const DOC = [
	"prose", // 1
	"```js", // 2
	"# not a heading", // 3
	"- not a bullet", // 4
	"```", // 5
	"after", // 6
];

test("lines inside a fence are inside", () => {
	const doc = docOf(DOC);
	assert.equal(isInsideCodeFence(doc, 3), true);
	assert.equal(isInsideCodeFence(doc, 4), true);
});

test("lines outside a fence are outside", () => {
	const doc = docOf(DOC);
	assert.equal(isInsideCodeFence(doc, 1), false);
	assert.equal(isInsideCodeFence(doc, 6), false);
});

test("the opening fence line itself is outside", () => {
	assert.equal(isInsideCodeFence(docOf(DOC), 2), false);
});

test("the closing fence line is inside", () => {
	// It still belongs to the block, and nothing useful acts on it anyway.
	assert.equal(isInsideCodeFence(docOf(DOC), 5), true);
});

test("an unclosed fence runs to the end of the document", () => {
	const doc = docOf(["```", "code", "more code"]);
	assert.equal(isInsideCodeFence(doc, 3), true);
});

test("tilde fences work too", () => {
	const doc = docOf(["~~~", "code", "~~~", "after"]);
	assert.equal(isInsideCodeFence(doc, 2), true);
	assert.equal(isInsideCodeFence(doc, 4), false);
});

test("a fence closes only with its own character", () => {
	// ``` containing ~~~ is one block, not two.
	const doc = docOf(["```", "~~~", "still code", "```", "after"]);
	assert.equal(isInsideCodeFence(doc, 3), true);
	assert.equal(isInsideCodeFence(doc, 5), false);
});

test("an indented fence inside a list still counts", () => {
	const doc = docOf(["- item", "  ```", "  code", "  ```", "after"]);
	assert.equal(isInsideCodeFence(doc, 3), true);
	assert.equal(isInsideCodeFence(doc, 5), false);
});

test("the first line is never inside", () => {
	assert.equal(isInsideCodeFence(docOf(["```", "code"]), 1), false);
});

test("a document with no fences is never inside", () => {
	const doc = docOf(["one", "two", "three"]);
	for (let n = 1; n <= 3; n++) assert.equal(isInsideCodeFence(doc, n), false);
});

// ── the fence's own bounds ─────────────────────────────────────────────────

test("findCodeFence reports the opening and closing lines", () => {
	const doc = docOf(DOC);
	assert.deepEqual(findCodeFence(doc, 3), { openLine: 2, closeLine: 5 });
});

test("the opening fence line belongs to its own block", () => {
	// Cmd+A on the ``` should reach the code, not the one line under the caret.
	assert.deepEqual(findCodeFence(docOf(DOC), 2), { openLine: 2, closeLine: 5 });
});

test("a line outside any fence has none", () => {
	const doc = docOf(DOC);
	assert.equal(findCodeFence(doc, 1), null);
	assert.equal(findCodeFence(doc, 6), null);
});

test("an unclosed fence reports no closing line", () => {
	assert.deepEqual(findCodeFence(docOf(["```", "code"]), 2), { openLine: 1, closeLine: null });
});

test("the second of two blocks is found, not the first", () => {
	const doc = docOf(["```", "a", "```", "prose", "```", "b", "```"]);
	assert.deepEqual(findCodeFence(doc, 6), { openLine: 5, closeLine: 7 });
});

// ── what Cmd+A selects in a code block ─────────────────────────────────────

test("the content range covers the code and excludes the fences", () => {
	const doc = docOf(DOC);
	const range = codeFenceContent(doc, 3);
	assert.equal(doc.sliceString(range.from, range.to), "# not a heading\n- not a bullet");
});

test("every line of a block selects the same code", () => {
	// Whichever line the caret is on — fences included — one press gives the
	// whole block.
	const doc = docOf(DOC);
	const expected = codeFenceContent(doc, 3);
	for (const line of [2, 3, 4, 5]) {
		assert.deepEqual(codeFenceContent(doc, line), expected, `from line ${line}`);
	}
});

test("an unclosed block runs to the end of the document", () => {
	const doc = docOf(["prose", "```", "a", "b"]);
	const range = codeFenceContent(doc, 3);
	assert.equal(doc.sliceString(range.from, range.to), "a\nb");
});

test("an empty block has no content to select", () => {
	// The caller escalates rather than selecting nothing.
	assert.equal(codeFenceContent(docOf(["```", "```"]), 1), null);
});

test("a line outside a fence has no content range", () => {
	assert.equal(codeFenceContent(docOf(DOC), 1), null);
});

// ── findFencedLines: the single-scan version used on the per-line hot path ──

test("findFencedLines agrees with isInsideCodeFence, one call for the whole doc", () => {
	const doc = docOf(DOC);
	const fenced = findFencedLines(doc);
	for (let n = 1; n <= doc.lines; n++) {
		assert.equal(fenced.has(n), isInsideCodeFence(doc, n), `line ${n}`);
	}
});

test("the opening fence line is excluded, interior lines and the closer are included", () => {
	const fenced = findFencedLines(docOf(DOC));
	assert.equal(fenced.has(2), false, "opener");
	assert.equal(fenced.has(3), true);
	assert.equal(fenced.has(4), true);
	assert.equal(fenced.has(5), true, "closer");
	assert.equal(fenced.has(1), false);
	assert.equal(fenced.has(6), false);
});

test("tilde fences are found too", () => {
	const fenced = findFencedLines(docOf(["~~~", "code", "~~~", "after"]));
	assert.deepEqual([...fenced], [2, 3]);
});

test("an unterminated fence runs to the end of the document", () => {
	const fenced = findFencedLines(docOf(["prose", "```", "a", "b", "c"]));
	assert.deepEqual([...fenced], [3, 4, 5]);
});

test("a fence closes only with its own marker: nested/mismatched fences stay one block", () => {
	// ``` containing ~~~ must not let the ~~~ be mistaken for a close/open of
	// its own — everything through the matching ``` stays inside one fence.
	const doc = docOf(["```", "~~~", "still code", "```", "after"]);
	const fenced = findFencedLines(doc);
	assert.deepEqual([...fenced], [2, 3, 4]);
});

test("a document with no fences yields an empty set", () => {
	const fenced = findFencedLines(docOf(["one", "two", "three"]));
	assert.equal(fenced.size, 0);
});

test("two separate blocks each contribute their own lines", () => {
	const doc = docOf(["```", "a", "```", "prose", "```", "b", "```"]);
	const fenced = findFencedLines(doc);
	assert.deepEqual([...fenced], [2, 3, 6, 7]);
});

/**
 * Whole-fence spans.
 *
 * findFencedLines answers "is this line code?", which is the right question
 * for hiding syntax but the wrong one for moving or deleting a block: it
 * excludes the opening fence, and it cannot say where the block a line belongs
 * to starts and ends. Dragging and deleting need the span, both markers
 * included, reachable from any line in it.
 */

test("every line of a fence maps to the same span, markers included", () => {
	const doc = docOf(["intro", "```js", "code", "```", "after"]);
	const spans = findFenceSpans(doc);

	for (const line of [2, 3, 4]) {
		assert.deepEqual(spans.get(line), { firstLine: 2, lastLine: 4 }, `line ${line}`);
	}
});

test("lines outside a fence map to nothing", () => {
	const spans = findFenceSpans(docOf(["intro", "```", "code", "```", "after"]));
	assert.equal(spans.get(1), undefined);
	assert.equal(spans.get(5), undefined);
});

test("two fences produce two distinct spans", () => {
	const doc = docOf(["```", "a", "```", "prose", "```", "b", "```"]);
	const spans = findFenceSpans(doc);
	assert.deepEqual(spans.get(2), { firstLine: 1, lastLine: 3 });
	assert.deepEqual(spans.get(6), { firstLine: 5, lastLine: 7 });
	assert.equal(spans.get(4), undefined);
});

test("an unclosed fence runs to the end of the document", () => {
	// Half-typed code is the normal state of a fence being written. Reporting
	// no span would leave the drag and the delete acting on one line again,
	// which is the behaviour being fixed.
	const doc = docOf(["intro", "```", "code", "more"]);
	assert.deepEqual(findFenceSpans(doc).get(3), { firstLine: 2, lastLine: 4 });
});

test("a fence closes only with its own marker", () => {
	const doc = docOf(["```", "~~~", "still code", "```", "after"]);
	assert.deepEqual(findFenceSpans(doc).get(2), { firstLine: 1, lastLine: 4 });
	assert.equal(findFenceSpans(doc).get(5), undefined);
});

test("an indented fence is still a fence", () => {
	// The whole point of the insert fix is that fences can carry indentation.
	const doc = docOf(["- item", "  ```", "  code", "  ```"]);
	assert.deepEqual(findFenceSpans(doc).get(3), { firstLine: 2, lastLine: 4 });
});

test("an empty fence is a two-line span", () => {
	assert.deepEqual(findFenceSpans(docOf(["```", "```"])).get(1), { firstLine: 1, lastLine: 2 });
});

test("a document with no fences yields an empty map", () => {
	assert.equal(findFenceSpans(docOf(["one", "two"])).size, 0);
});
