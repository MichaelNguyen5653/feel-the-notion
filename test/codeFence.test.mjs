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
import { codeFenceContent, findCodeFence, isInsideCodeFence } from "./.build/codeFence.js";

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
