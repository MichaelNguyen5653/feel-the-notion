/**
 * Tests for where "Insert a new line" puts its line.
 *
 * The row exists so there is a way out of a block that has swallowed the end
 * of the note — a table or a code block with nothing under it. Putting the
 * line after the CURRENT line would split those in half, which is the failure
 * the row is meant to fix, so the answer is always the end of the block.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { blankLineAfter } from "./.build/blankLine.js";

const docOf = (lines) => EditorState.create({ doc: lines.join("\n") }).doc;

test("a paragraph is its own block", () => {
	assert.equal(blankLineAfter(docOf(["one", "two"]), 1), 1);
});

test("the first row of a table resolves to the last row", () => {
	// Splitting a table here is the whole reason the row is block-aware.
	const doc = docOf(["| a | b |", "| - | - |", "| 1 | 2 |", "after"]);
	assert.equal(blankLineAfter(doc, 1), 3);
});

test("a middle row of a table resolves to the last row", () => {
	const doc = docOf(["| a | b |", "| - | - |", "| 1 | 2 |"]);
	assert.equal(blankLineAfter(doc, 2), 3);
});

test("a table running to the end of the note resolves to the last line", () => {
	assert.equal(blankLineAfter(docOf(["| a |", "| - |"]), 1), 2);
});

test("an indented table row is still a table row", () => {
	assert.equal(blankLineAfter(docOf(["  | a |", "  | - |", "after"]), 1), 2);
});

test("a paragraph above a table does not absorb it", () => {
	// Only a line that is itself a row walks the run.
	assert.equal(blankLineAfter(docOf(["intro", "| a |", "| - |"]), 1), 1);
});

test("the opening fence of a code block resolves to its closing fence", () => {
	const doc = docOf(["```js", "const x = 1;", "```", "after"]);
	assert.equal(blankLineAfter(doc, 1), 3);
});

test("a line of code resolves to the closing fence", () => {
	assert.equal(blankLineAfter(docOf(["```", "code", "```"]), 2), 3);
});

test("an unclosed fence resolves to the end of the note", () => {
	assert.equal(blankLineAfter(docOf(["```", "code"]), 1), 2);
});

test("a list item resolves past its children", () => {
	const doc = docOf(["- item", "    - child", "    - child", "next"]);
	assert.equal(blankLineAfter(doc, 1), 3);
});

test("a list item with no children is its own block", () => {
	assert.equal(blankLineAfter(docOf(["- one", "- two"]), 1), 1);
});

test("a blank line is its own block", () => {
	assert.equal(blankLineAfter(docOf(["one", "", "two"]), 2), 2);
});

test("the last line of the note resolves to itself", () => {
	assert.equal(blankLineAfter(docOf(["one", "two"]), 2), 2);
});
