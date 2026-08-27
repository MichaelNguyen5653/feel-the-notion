/**
 * Tests for what a block fold hides.
 *
 * The rule being protected: the chevron only appears where folding would
 * actually hide something. A single-line paragraph with nothing under it has
 * no fold, and offering one would be a button that does nothing.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { foldableRange, headingLevel } from "./.build/foldRange.js";

const doc = (lines) => EditorState.create({ doc: lines.join("\n") }).doc;

test("a heading level is its hash count", () => {
	assert.equal(headingLevel("# One"), 1);
	assert.equal(headingLevel("### Three"), 3);
	assert.equal(headingLevel("####### Seven"), 0); // not a heading in markdown
	assert.equal(headingLevel("#NoSpace"), 0);
	assert.equal(headingLevel("plain text"), 0);
});

test("a lone paragraph has nothing to fold", () => {
	const d = doc(["just one line", "", "another"]);
	assert.equal(foldableRange(d, 1), null);
});

test("a blank line has nothing to fold", () => {
	const d = doc(["text", "", "more"]);
	assert.equal(foldableRange(d, 2), null);
});

test("a block folds everything nested under it", () => {
	const d = doc([
		"- parent",     // 1
		"    - child",  // 2
		"    - child",  // 3
		"- sibling",    // 4
	]);
	assert.deepEqual(foldableRange(d, 1), { headLine: 1, lastLine: 3 });
});

test("a leaf child has nothing to fold", () => {
	// A list item is its own block start, so a child with no children of its
	// own owns nothing. Dragging it takes only itself and folding it would
	// hide nothing. Both agree, which is the whole point of sharing the walk.
	const d = doc(["- parent", "    - child", "- sibling"]);
	assert.equal(foldableRange(d, 2), null);
});

test("a child that owns children folds from its own line", () => {
	const d = doc([
		"- parent",             // 1
		"    - child",          // 2
		"        - grandchild", // 3
		"- sibling",            // 4
	]);
	assert.deepEqual(foldableRange(d, 2), { headLine: 2, lastLine: 3 });
});

test("a heading folds down to the next heading of the same level", () => {
	const d = doc([
		"## First",   // 1
		"body",       // 2
		"more body",  // 3
		"## Second",  // 4
	]);
	assert.deepEqual(foldableRange(d, 1), { headLine: 1, lastLine: 3 });
});

test("a heading swallows deeper headings under it", () => {
	const d = doc([
		"# Top",      // 1
		"### Deep",   // 2
		"body",       // 3
		"## Also",    // 4
		"body",       // 5
		"# Next",     // 6
	]);
	assert.deepEqual(foldableRange(d, 1), { headLine: 1, lastLine: 5 });
});

test("a heading stops at a shallower heading", () => {
	const d = doc(["### Deep", "body", "# Top"]);
	assert.deepEqual(foldableRange(d, 1), { headLine: 1, lastLine: 2 });
});

test("a heading with an empty section has nothing to fold", () => {
	const d = doc(["## First", "## Second"]);
	assert.equal(foldableRange(d, 1), null);
});

test("blank lines before the next heading are not part of the section", () => {
	// Otherwise the fold's ellipsis sits on a blank line below the section,
	// leaving a stray gap where the content used to be.
	const d = doc(["## First", "body", "", "", "## Second"]);
	assert.deepEqual(foldableRange(d, 1), { headLine: 1, lastLine: 2 });
});

test("the last heading in a note folds to the end", () => {
	const d = doc(["## Last", "body", "more"]);
	assert.deepEqual(foldableRange(d, 1), { headLine: 1, lastLine: 3 });
});

test("a line number outside the document is not foldable", () => {
	const d = doc(["one"]);
	assert.equal(foldableRange(d, 0), null);
	assert.equal(foldableRange(d, 2), null);
});
