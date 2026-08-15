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
import { isInsideCodeFence } from "./.build/codeFence.js";

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
